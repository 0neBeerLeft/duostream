//! Twitch ad blocking via a local HLS playlist proxy.
//!
//! mpv plays `http://127.0.0.1:<port>/s/<id>.m3u8`. Every refresh we fetch Twitch's real media
//! playlist and drop stitched-ad segments (real segments are tagged `#EXTINF:x,live`). While an ad
//! break is running we try a backup playlist from a different player type, which is often ad-free.
//! Segments are renumbered with our own media sequence so switching sources never confuses mpv.
use crate::common::*;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const BACKUP_TYPES: [&str; 3] = ["embed", "popout", "autoplay"];
const DVR_SEGMENTS: usize = 3600;

struct Seg {
    seq: u64,
    dur: f64,
    url: String,
    disc: bool,
    /// fMP4 init segment (`#EXT-X-MAP`) this segment needs; None for MPEG-TS streams.
    map: Option<String>,
}

struct Session {
    login: String,
    quality: String,
    primary: String,
    backup: Option<String>,
    backup_checked: Option<Instant>,
    segs: VecDeque<Seg>,
    seen: HashSet<String>,
    seen_order: VecDeque<String>,
    next_seq: u64,
    last_src: u8,
    pub ads_blocked: u64,
    filter: bool,
    id: u64,
    port: u16,
}

struct Proxy {
    port: u16,
    sessions: Mutex<HashMap<u64, Arc<Mutex<Session>>>>,
}

static PROXY: OnceLock<Option<Proxy>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
pub static ADS_BLOCKED: AtomicU64 = AtomicU64::new(0);
pub static AD_BREAK: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Twitch "Client-Integrity" header set captured from a real twitch.tv page (drops need it).
pub static INTEGRITY: Mutex<Option<serde_json::Value>> = Mutex::new(None);

/// Port of the local proxy (used by the twitch.tv page script that reports integrity headers).
pub fn port() -> Option<u16> {
    proxy().map(|p| p.port)
}

fn proxy() -> Option<&'static Proxy> {
    PROXY
        .get_or_init(|| {
            let l = TcpListener::bind("127.0.0.1:0").ok()?;
            let port = l.local_addr().ok()?.port();
            std::thread::spawn(move || {
                for s in l.incoming().flatten() {
                    std::thread::spawn(move || handle(s));
                }
            });
            Some(Proxy { port, sessions: Mutex::new(HashMap::new()) })
        })
        .as_ref()
}

/// Register a stream and get the local URL mpv should play. Falls back to the upstream URL.
pub fn wrap(login: &str, quality: &str, upstream: &str, filter: bool) -> String {
    let Some(p) = proxy() else { return upstream.to_string() };
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let s = Session {
        login: login.to_string(),
        quality: quality.to_string(),
        primary: upstream.to_string(),
        backup: None,
        backup_checked: None,
        segs: VecDeque::new(),
        seen: HashSet::new(),
        seen_order: VecDeque::new(),
        next_seq: 0,
        last_src: 0,
        ads_blocked: 0,
        filter,
        id,
        port: p.port,
    };
    let mut map = p.sessions.lock().unwrap();
    map.clear(); // one stream at a time
    map.insert(id, Arc::new(Mutex::new(s)));
    AD_BREAK.store(false, Ordering::Relaxed);
    format!("http://127.0.0.1:{}/s/{id}.m3u8", p.port)
}

/// Local URL that serves `upstream` with CORS headers (Twitch VOD playlists/segments lack them).
pub fn passthrough(upstream: &str) -> String {
    match proxy() {
        Some(p) => format!("http://127.0.0.1:{}/p?u={}", p.port, enc(upstream)),
        None => upstream.to_string(),
    }
}

fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("zz"), 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn allowed_host(url: &str) -> bool {
    let host = url.strip_prefix("https://").and_then(|r| r.split(['/', '?']).next()).unwrap_or("");
    [".ttvnw.net", ".cloudfront.net", ".jtvnw.net", ".twitch.tv"].iter().any(|d| host.ends_with(d))
}

fn absolutize(line: &str, base: &str) -> String {
    if line.starts_with("http") {
        line.to_string()
    } else {
        format!("{}/{line}", base.split('?').next().unwrap_or(base).rsplit_once('/').map(|(b, _)| b).unwrap_or(""))
    }
}

/// Serve a proxied file. Playlists get every URI rewritten to go through the proxy too.
fn serve_passthrough(stream: &mut TcpStream, url: &str) {
    let fail = |s: &mut TcpStream, code: &str| {
        let _ = s.write_all(format!("HTTP/1.1 {code}\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes());
    };
    if !allowed_host(url) {
        return fail(stream, "403 Forbidden");
    }
    let Ok(resp) = http().get(url).call() else { return fail(stream, "502 Bad Gateway") };
    let ctype = resp.content_type().to_string();
    let is_list = url.split('?').next().unwrap_or("").ends_with(".m3u8") || ctype.contains("mpegurl");
    let body: Vec<u8> = if is_list {
        let text = resp.into_string().unwrap_or_default();
        text.lines()
            .map(|l| {
                let t = l.trim();
                if !t.is_empty() && !t.starts_with('#') {
                    passthrough(&absolutize(t, url))
                } else if let Some((pre, rest)) = t.split_once("URI=\"") {
                    let (u, post) = rest.split_once('"').unwrap_or((rest, ""));
                    format!("{pre}URI=\"{}\"{post}", passthrough(&absolutize(u, url)))
                } else {
                    t.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
            .into_bytes()
    } else {
        let mut v = Vec::new();
        if std::io::Read::read_to_end(&mut resp.into_reader(), &mut v).is_err() {
            return fail(stream, "502 Bad Gateway");
        }
        v
    };
    let ct = if is_list { "application/vnd.apple.mpegurl" } else if ctype.is_empty() { "application/octet-stream" } else { ctype.as_str() };
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {ct}\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body);
}

struct Parsed {
    target: f64,
    segs: Vec<(f64, String, bool, Option<String>)>, // (duration, url, is_ad, init segment)
    has_ads: bool,
}

fn parse(text: &str, base: &str) -> Parsed {
    let base = base.rsplit_once('/').map(|(b, _)| b).unwrap_or("");
    let mut out = Parsed { target: 2.0, segs: Vec::new(), has_ads: false };
    let mut cur: Option<(f64, bool)> = None;
    let mut map: Option<String> = None;
    for line in text.lines().map(str::trim) {
        if let Some(rest) = line.strip_prefix("#EXT-X-MAP:") {
            map = rest.split_once("URI=\"").and_then(|(_, r)| r.split_once('"')).map(|(u, _)| {
                if u.starts_with("http") { u.to_string() } else { format!("{base}/{u}") }
            });
        } else if let Some(t) = line.strip_prefix("#EXT-X-TARGETDURATION:") {
            out.target = t.parse().unwrap_or(2.0);
        } else if line.starts_with("#EXT-X-DATERANGE") && (line.contains("stitched-ad") || line.contains("twitch-ad")) {
            out.has_ads = true;
        } else if let Some(rest) = line.strip_prefix("#EXTINF:") {
            let (d, title) = rest.split_once(',').unwrap_or((rest, ""));
            let ad = !title.trim().starts_with("live");
            cur = Some((d.parse().unwrap_or(2.0), ad));
        } else if !line.is_empty() && !line.starts_with('#') {
            if let Some((d, ad)) = cur.take() {
                let url = if line.starts_with("http") { line.to_string() } else { format!("{base}/{line}") };
                out.has_ads |= ad;
                out.segs.push((d, url, ad, map.clone()));
            }
        }
    }
    out
}

fn backup_url(s: &mut Session) -> Option<String> {
    let stale = s.backup_checked.map_or(true, |t| t.elapsed() > Duration::from_secs(120));
    if s.backup.is_none() || stale {
        s.backup_checked = Some(Instant::now());
        for pt in BACKUP_TYPES {
            if let Ok(Some(vars)) = crate::twitch::master(&s.login, pt) {
                let v = vars.iter().find(|v| v.name == s.quality).or_else(|| vars.iter().find(|v| v.name != "Auto"));
                if let Some(v) = v {
                    if let Ok(text) = fetch_text(&v.url) {
                        if !parse(&text, &v.url).has_ads {
                            s.backup = Some(v.url.clone());
                            break;
                        }
                    }
                }
            }
        }
    }
    s.backup.clone()
}

fn refresh(s: &mut Session) -> Result<f64, String> {
    let text = fetch_text(&s.primary)?;
    let mut p = parse(&text, &s.primary);
    if !s.filter {
        p.has_ads = false;
        for seg in p.segs.iter_mut() {
            seg.2 = false;
        }
    }
    let (src, segs, target) = if !p.has_ads {
        AD_BREAK.store(false, Ordering::Relaxed);
        (0u8, p.segs, p.target)
    } else {
        AD_BREAK.store(true, Ordering::Relaxed);
        let mut chosen = None;
        if let Some(b) = backup_url(s) {
            if let Ok(t) = fetch_text(&b) {
                let bp = parse(&t, &b);
                if !bp.has_ads {
                    chosen = Some((1u8, bp.segs, bp.target));
                } else {
                    s.backup = None;
                }
            }
        }
        chosen.unwrap_or((0u8, p.segs, p.target))
    };
    let mut first_new = true;
    for (dur, url, ad, map) in segs {
        if ad {
            if s.seen.insert(url.clone()) {
                s.seen_order.push_back(url);
                s.ads_blocked += 1;
                ADS_BLOCKED.fetch_add(1, Ordering::Relaxed);
            }
            continue;
        }
        if !s.seen.insert(url.clone()) {
            continue;
        }
        s.seen_order.push_back(url.clone());
        let disc = first_new && src != s.last_src && s.next_seq > 0;
        first_new = false;
        s.segs.push_back(Seg { seq: s.next_seq, dur, url, disc, map });
        s.next_seq += 1;
    }
    s.last_src = src;
    // Keep up to ~2 hours so the player can rewind (DVR). Segments are listed as short local
    // redirect URLs, so the playlist stays small even with thousands of entries.
    while s.segs.len() > DVR_SEGMENTS {
        s.segs.pop_front();
    }
    while s.seen_order.len() > 400 {
        if let Some(u) = s.seen_order.pop_front() {
            s.seen.remove(&u);
        }
    }
    Ok(target)
}

/// Save the last `seconds` of the current live stream: (channel login, file bytes, extension).
/// TS segments concatenate into a valid .ts; fMP4 = init segment + fragments = valid .mp4.
pub fn clip(seconds: f64) -> Result<(String, Vec<u8>, &'static str), String> {
    let p = proxy().ok_or("player proxy isn't running")?;
    let session = p.sessions.lock().unwrap().values().next().cloned().ok_or("Nothing is playing live")?;
    let (login, picks): (String, Vec<(String, Option<String>)>) = {
        let s = session.lock().unwrap();
        let mut total = 0.0;
        let mut v = Vec::new();
        for seg in s.segs.iter().rev() {
            if total >= seconds {
                break;
            }
            total += seg.dur;
            v.push((seg.url.clone(), seg.map.clone()));
        }
        v.reverse();
        (s.login.clone(), v)
    };
    if picks.is_empty() {
        return Err("Nothing buffered yet".into());
    }
    let get = |u: &str| -> Result<Vec<u8>, String> {
        let r = http().get(u).call().map_err(err_str)?;
        let mut b = Vec::new();
        std::io::Read::read_to_end(&mut r.into_reader(), &mut b).map_err(|e| e.to_string())?;
        Ok(b)
    };
    let mut out = Vec::new();
    let map = picks.last().and_then(|p| p.1.clone());
    // only keep segments that share the newest init segment (a source switch changes it)
    let picks: Vec<_> = picks.into_iter().filter(|p| p.1 == map).collect();
    if let Some(m) = &map {
        out.extend(get(m)?);
    }
    for (u, _) in &picks {
        out.extend(get(u)?);
    }
    Ok((login, out, if map.is_some() { "mp4" } else { "ts" }))
}

fn render(s: &Session, target: f64) -> String {
    let mut o = String::from("#EXTM3U\n#EXT-X-VERSION:6\n");
    // Twitch advertises TARGETDURATION:6 for 2 s segments; players keep ~3x target behind live,
    // which made streams ~18 s late. Use the real (max) segment length instead.
    let real = s.segs.iter().map(|x| x.dur).fold(0.0f64, f64::max);
    let target = if real > 0.0 { real } else { target };
    o.push_str(&format!("#EXT-X-TARGETDURATION:{}\n", target.ceil().max(1.0) as u64));
    o.push_str(&format!("#EXT-X-MEDIA-SEQUENCE:{}\n", s.segs.front().map_or(0, |x| x.seq)));
    let mut last_map: Option<&str> = None;
    for seg in &s.segs {
        if seg.disc {
            o.push_str("#EXT-X-DISCONTINUITY\n");
        }
        if let Some(m) = seg.map.as_deref() {
            if last_map != Some(m) {
                o.push_str(&format!("#EXT-X-MAP:URI=\"{m}\"\n"));
                last_map = Some(m);
            }
        }
        o.push_str(&format!("#EXTINF:{:.3},live\nhttp://127.0.0.1:{}/g/{}/{}\n", seg.dur, s.port, s.id, seg.seq));
    }
    o
}

fn handle(mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut line = String::new();
    let mut body = Vec::new();
    {
        let mut r = BufReader::new(&stream);
        if r.read_line(&mut line).is_err() {
            return;
        }
        let mut h = String::new();
        let mut len = 0usize;
        while r.read_line(&mut h).map(|n| n > 2).unwrap_or(false) {
            if let Some(v) = h.to_ascii_lowercase().strip_prefix("content-length:") {
                len = v.trim().parse().unwrap_or(0);
            }
            h.clear();
        }
        if len > 0 && len < 64 * 1024 {
            body.resize(len, 0);
            let _ = std::io::Read::read_exact(&mut r, &mut body);
        }
    }
    let method = line.split_whitespace().next().unwrap_or("");
    let path = line.split_whitespace().nth(1).unwrap_or("");
    // twitch.tv page script → integrity headers (CORS + private-network preflight allowed)
    if path == "/ti" {
        if method == "POST" {
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&body) {
                if v["integrity"].as_str().map(|s| s.len() > 20).unwrap_or(false) {
                    *INTEGRITY.lock().unwrap() = Some(v);
                }
            }
        }
        let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: https://www.twitch.tv\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Private-Network: true\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return;
    }
    if let Some(u) = path.strip_prefix("/p?u=") {
        serve_passthrough(&mut stream, &pct_decode(u));
        return;
    }
    // /g/<session>/<seq>: redirect to the real segment (keeps long DVR playlists small)
    if let Some(rest) = path.strip_prefix("/g/") {
        let mut it = rest.split('/');
        let (sid, seq) = (it.next().and_then(|x| x.parse::<u64>().ok()), it.next().and_then(|x| x.parse::<u64>().ok()));
        let target = match (sid, seq) {
            (Some(sid), Some(seq)) => proxy()
                .and_then(|p| p.sessions.lock().unwrap().get(&sid).cloned())
                .and_then(|s| {
                    let s = s.lock().unwrap();
                    let first = s.segs.front()?.seq;
                    s.segs.get(seq.checked_sub(first)? as usize).map(|x| x.url.clone())
                }),
            _ => None,
        };
        let resp = match target {
            Some(u) => format!("HTTP/1.1 302 Found\r\nLocation: {u}\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
            None => "HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
        };
        let _ = stream.write_all(resp.as_bytes());
        return;
    }
    let id: Option<u64> = path.strip_prefix("/s/").and_then(|p| p.strip_suffix(".m3u8")).and_then(|p| p.parse().ok());
    let session = id.and_then(|id| proxy()?.sessions.lock().unwrap().get(&id).cloned());
    let Some(session) = session else {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return;
    };
    let body = {
        let mut s = session.lock().unwrap();
        match refresh(&mut s) {
            Ok(t) => render(&s, t),
            Err(_) if !s.segs.is_empty() => render(&s, 2.0),
            Err(_) => {
                let _ = stream.write_all(b"HTTP/1.1 502 Bad Gateway\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                return;
            }
        }
    };
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/vnd.apple.mpegurl\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
}
