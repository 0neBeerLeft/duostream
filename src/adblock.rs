//! Twitch ad blocking via a local HLS playlist proxy.
//!
//! The player loads `http://127.0.0.1:<port>/<token>/s/<id>.m3u8`. Every refresh we fetch Twitch's real media
//! playlist and drop stitched-ad segments (real segments are tagged `#EXTINF:x,live`). While an ad
//! break is running we try a backup playlist from a different player type, which is often ad-free.
//! Segments are renumbered with our own media sequence so switching sources never confuses the player.
//!
//! Rewind (DVR): Twitch and Kick delete segment URLs ~5 minutes after they appear (measured 2026-11-23), so a
//! rewind window longer than that needs our own copy. For the main player ("dvr" sessions) every segment is
//! downloaded once into %TEMP%\duostream-dvr\<session>\ as it appears and the player is served from there,
//! so there is no extra download. Files leave the window after DVR_SECS and the folder goes with the session.
use crate::common::*;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const BACKUP_TYPES: [&str; 3] = ["embed", "popout", "autoplay"];
const DVR_SEGMENTS: usize = 3600;
/// Rewind window of dvr sessions (segments on disk). Sessions without dvr keep only what the CDN keeps.
const DVR_SECS: f64 = 30.0 * 60.0;
const NO_DVR_SECS: f64 = 4.0 * 60.0;
/// Playlist reloads only repeat the newest ~this many seconds (HLS delta updates, `_HLS_skip`), so a long
/// rewind history doesn't mean re-sending and re-parsing thousands of lines every two seconds.
const CAN_SKIP_SECS: f64 = 60.0;

struct Seg {
    seq: u64,
    dur: f64,
    url: String,
    disc: bool,
    /// fMP4 init segment (`#EXT-X-MAP`) this segment needs; None for MPEG-TS streams.
    map: Option<String>,
}

struct Session {
    key: String, // "platform:login", one live session per channel
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
    /// This stream is in an ad break right now (per stream: multiview / PiP play several at once).
    ad_break: bool,
    /// Discontinuities dropped off the front of the rewind window (EXT-X-DISCONTINUITY-SEQUENCE).
    disc_seq: u64,
    filter: bool,
    id: u64,
    port: u16,
    /// Segment cache folder (dvr sessions only).
    dir: Option<PathBuf>,
    /// fMP4 init segment URLs, by index (served as /m/<session>/<index>, cached like segments).
    maps: Vec<String>,
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Some(d) = &self.dir {
            let _ = std::fs::remove_dir_all(d);
        }
    }
}

fn dvr_root() -> PathBuf {
    std::env::temp_dir().join(if cfg!(debug_assertions) { "duostream-dvr-dev" } else { "duostream-dvr" })
}

/// Files being downloaded right now, so the player and the prefetcher never fetch the same segment twice.
static INFLIGHT: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

/// Make sure `path` holds the bytes of `url`: done already, wait for the download in progress, or fetch it now.
fn fetch_to(path: &Path, url: &str) -> Result<(), String> {
    loop {
        if path.is_file() {
            return Ok(());
        }
        {
            let mut g = INFLIGHT.lock().unwrap();
            let set = g.get_or_insert_with(HashSet::new);
            if !set.contains(path) {
                set.insert(path.to_path_buf());
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(50)); // someone else is downloading it
    }
    let r = (|| {
        let resp = http().get(url).call().map_err(err_str)?;
        let tmp = path.with_extension("part");
        let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        std::io::copy(&mut resp.into_reader(), &mut f).map_err(|e| e.to_string())?;
        drop(f);
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())
    })();
    if let Some(set) = INFLIGHT.lock().unwrap().as_mut() {
        set.remove(path);
    }
    r
}

struct Proxy {
    port: u16,
    /// Random path prefix for player URLs. The proxy answers on 127.0.0.1 with CORS open (hls.js
    /// needs it), so without this any website in any browser could read what is playing here.
    token: String,
    /// Separate prefix for /ti, which is handed to twitch.tv pages.
    ti_token: String,
    sessions: Mutex<HashMap<u64, Arc<Mutex<Session>>>>,
}

static PROXY: OnceLock<Option<Proxy>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
pub static ADS_BLOCKED: AtomicU64 = AtomicU64::new(0);
/// Twitch "Client-Integrity" header set captured from a real twitch.tv page (drops need it).
pub static INTEGRITY: Mutex<Option<serde_json::Value>> = Mutex::new(None);

/// Where the twitch.tv page script reports integrity headers (None if the proxy isn't running).
pub fn ti_url() -> Option<String> {
    proxy().map(|p| format!("http://127.0.0.1:{}/{}/ti", p.port, p.ti_token))
}

fn random_token() -> String {
    (0..2).map(|_| format!("{:016x}", rand::random::<u64>())).collect()
}

fn proxy() -> Option<&'static Proxy> {
    PROXY
        .get_or_init(|| {
            let _ = std::fs::remove_dir_all(dvr_root());
            let l = TcpListener::bind("127.0.0.1:0").ok()?;
            let port = l.local_addr().ok()?.port();
            std::thread::spawn(move || {
                for s in l.incoming().flatten() {
                    std::thread::spawn(move || handle(s));
                }
            });
            Some(Proxy { port, token: random_token(), ti_token: random_token(), sessions: Mutex::new(HashMap::new()) })
        })
        .as_ref()
}

const MAX_SESSIONS: usize = 8;

/// Register a stream and get the local URL the player should load. Falls back to the upstream URL.
/// `dvr`: keep a rewind window on disk (main player); off for multiview tiles and picture-in-picture.
pub fn wrap(key: &str, login: &str, quality: &str, upstream: &str, filter: bool, dvr: bool) -> String {
    let Some(p) = proxy() else { return upstream.to_string() };
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let s = Session {
        key: key.to_string(),
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
        ad_break: false,
        disc_seq: 0,
        filter,
        id,
        port: p.port,
        dir: dvr.then(|| dvr_root().join(id.to_string())).filter(|d| std::fs::create_dir_all(d).is_ok()),
        maps: Vec::new(),
    };
    let mut map = p.sessions.lock().unwrap();
    // Several streams can play at once (multiview, PiP). A new session replaces the older one for the same
    // channel (reconnect / quality change), and only the most recent few are kept.
    map.retain(|_, x| x.lock().map(|x| x.key != key).unwrap_or(false));
    while map.len() >= MAX_SESSIONS {
        let Some(&oldest) = map.keys().min() else { break };
        map.remove(&oldest);
    }
    map.insert(id, Arc::new(Mutex::new(s)));
    format!("http://127.0.0.1:{}/{}/s/{id}.m3u8", p.port, p.token)
}

/// Is the newest stream of `login` (or the newest stream at all) in an ad break?
pub fn ad_break(login: Option<&str>) -> bool {
    let Some(p) = proxy() else { return false };
    let map = p.sessions.lock().unwrap();
    let mut ids: Vec<u64> = map.keys().copied().collect();
    ids.sort_unstable_by(|a, b| b.cmp(a));
    ids.iter()
        .filter_map(|id| map.get(id)?.lock().ok().map(|s| (s.login.clone(), s.ad_break)))
        .find(|(l, _)| login.is_none_or(|x| l.eq_ignore_ascii_case(x)))
        .is_some_and(|(_, b)| b)
}

/// Local URL that serves `upstream` with CORS headers (Twitch VOD playlists/segments lack them).
pub fn passthrough(upstream: &str) -> String {
    match proxy() {
        Some(p) => format!("http://127.0.0.1:{}/{}/p?u={}", p.port, p.token, enc(upstream)),
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

/// An ad-free playlist from another player type for the same quality (network only, no locks held).
fn find_backup(login: &str, quality: &str) -> Option<String> {
    for pt in BACKUP_TYPES {
        if let Ok(Some(vars)) = crate::twitch::master(login, pt) {
            let v = vars.iter().find(|v| v.name == quality).or_else(|| vars.iter().find(|v| v.name != "Auto"));
            if let Some(v) = v {
                if let Ok(text) = fetch_text(&v.url) {
                    if !parse(&text, &v.url).has_ads {
                        return Some(v.url.clone());
                    }
                }
            }
        }
    }
    None
}

fn refresh(sess: &Mutex<Session>) -> Result<f64, String> {
    let (primary, filter, login, quality, backup, backup_stale) = {
        let s = sess.lock().unwrap();
        let stale = s.backup_checked.is_none_or(|t| t.elapsed() > Duration::from_secs(120));
        (s.primary.clone(), s.filter, s.login.clone(), s.quality.clone(), s.backup.clone(), stale)
    };
    let text = fetch_text(&primary)?;
    let mut p = parse(&text, &primary);
    if !filter {
        p.has_ads = false;
        for seg in p.segs.iter_mut() {
            seg.2 = false;
        }
    }
    // (new backup url to remember, whether it was looked up again)
    let mut backup_update: Option<(Option<String>, bool)> = None;
    let (src, segs, target, ad_break) = if !p.has_ads {
        (0u8, p.segs, p.target, false)
    } else {
        let mut b = backup;
        if b.is_none() || backup_stale {
            b = find_backup(&login, &quality);
            backup_update = Some((b.clone(), true));
        }
        let mut chosen = None;
        if let Some(u) = &b {
            if let Ok(t) = fetch_text(u) {
                let bp = parse(&t, u);
                if !bp.has_ads {
                    chosen = Some((1u8, bp.segs, bp.target, true));
                } else {
                    backup_update = Some((None, backup_update.is_some_and(|x| x.1)));
                }
            }
        }
        chosen.unwrap_or((0u8, p.segs, p.target, true))
    };
    let mut s = sess.lock().unwrap();
    if let Some((b, looked)) = backup_update {
        s.backup = b;
        if looked {
            s.backup_checked = Some(Instant::now());
        }
    }
    s.ad_break = ad_break;
    let mut first_new = true;
    let mut prefetch: Vec<(PathBuf, String)> = Vec::new();
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
        let seq = s.next_seq;
        if let Some(m) = &map {
            if !s.maps.contains(m) {
                s.maps.push(m.clone());
            }
        }
        if let Some(d) = &s.dir {
            prefetch.push((d.join(format!("{seq}.seg")), url.clone()));
            if let Some(i) = map.as_ref().and_then(|m| s.maps.iter().position(|x| x == m)) {
                prefetch.push((d.join(format!("m{i}.init")), map.clone().unwrap_or_default()));
            }
        }
        s.segs.push_back(Seg { seq, dur, url, disc, map });
        s.next_seq += 1;
    }
    s.last_src = src;
    // The rewind window: DVR_SECS for dvr sessions (served from disk), otherwise only what the CDN still has.
    let window = if s.dir.is_some() { DVR_SECS } else { NO_DVR_SECS };
    let mut total: f64 = s.segs.iter().map(|x| x.dur).sum();
    while s.segs.len() > DVR_SEGMENTS || (total > window && s.segs.len() > 1) {
        let Some(old) = s.segs.pop_front() else { break };
        total -= old.dur;
        if old.disc {
            s.disc_seq += 1;
        }
        if let Some(d) = &s.dir {
            let _ = std::fs::remove_file(d.join(format!("{}.seg", old.seq)));
        }
    }
    while s.seen_order.len() > 400 {
        if let Some(u) = s.seen_order.pop_front() {
            s.seen.remove(&u);
        }
    }
    drop(s);
    if !prefetch.is_empty() {
        // download in order, in the background; the player waits on (never repeats) a download in progress
        std::thread::spawn(move || {
            for (path, url) in prefetch {
                if path.parent().is_some_and(|d| d.is_dir()) {
                    let _ = fetch_to(&path, &url);
                }
            }
        });
    }
    Ok(target)
}

/// Save the last `seconds` of the current live stream into `dir` and return the file path.
/// TS segments concatenate into a valid .ts (remuxed to .mp4 when ffmpeg is installed); fMP4 = init segment +
/// fragments = a valid .mp4. Segments are fetched 4 at a time and written straight to disk.
/// `behind`: how far the viewer is behind the live edge, so the clip ends where they are watching.
pub fn clip(login: Option<&str>, seconds: f64, behind: f64, dir: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let p = proxy().ok_or("player proxy isn't running")?;
    let session = {
        let map = p.sessions.lock().unwrap();
        // newest session of that channel (or the newest overall)
        let mut ids: Vec<u64> = map.keys().copied().collect();
        ids.sort_unstable_by(|a, b| b.cmp(a));
        ids.into_iter()
            .filter_map(|id| map.get(&id).cloned())
            .find(|x| login.is_none_or(|l| x.lock().map(|x| x.login.eq_ignore_ascii_case(l)).unwrap_or(false)))
            .ok_or("Nothing is playing live")?
    };
    // (segment url, init segment url, seq) and the session's cache folder + init segment list
    type Pick = (String, Option<String>, u64);
    type Cache = Option<(PathBuf, Vec<String>)>;
    let (login, picks, cache): (String, Vec<Pick>, Cache) = {
        let s = session.lock().unwrap();
        let mut total = 0.0;
        let mut v = Vec::new();
        let mut skipped = 0.0;
        for seg in s.segs.iter().rev() {
            if skipped + seg.dur / 2.0 < behind {
                skipped += seg.dur;
                continue;
            }
            if total >= seconds {
                break;
            }
            total += seg.dur;
            v.push((seg.url.clone(), seg.map.clone(), seg.seq));
        }
        v.reverse();
        (s.login.clone(), v, s.dir.clone().map(|d| (d, s.maps.clone())))
    };
    if picks.is_empty() {
        return Err("Nothing buffered yet".into());
    }
    // a segment's bytes: from the rewind cache (downloading into it if needed), else straight from the CDN
    let get = |u: &str, cached: Option<PathBuf>| -> Result<Vec<u8>, String> {
        if let Some(p) = cached {
            fetch_to(&p, u)?;
            return std::fs::read(&p).map_err(|e| e.to_string());
        }
        let r = http().get(u).call().map_err(err_str)?;
        let mut b = Vec::new();
        std::io::Read::read_to_end(&mut r.into_reader(), &mut b).map_err(|e| e.to_string())?;
        Ok(b)
    };
    let map = picks.last().and_then(|p| p.1.clone());
    // only keep segments that share the newest init segment (a source switch changes it)
    let urls: Vec<(String, Option<PathBuf>)> = picks
        .into_iter()
        .filter(|p| p.1 == map)
        .map(|p| (p.0, cache.as_ref().map(|(d, _)| d.join(format!("{}.seg", p.2)))))
        .collect();
    let map_cache = map.as_ref().and_then(|m| cache.as_ref().and_then(|(d, maps)| maps.iter().position(|x| x == m).map(|i| d.join(format!("m{i}.init")))));
    let ext = if map.is_some() { "mp4" } else { "ts" };
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let path = dir.join(format!("{login}-{ts}.{ext}"));
    let write = || -> Result<(), String> {
        let mut out = std::io::BufWriter::new(std::fs::File::create(&path).map_err(|e| e.to_string())?);
        if let Some(m) = &map {
            out.write_all(&get(m, map_cache.clone())?).map_err(|e| e.to_string())?;
        }
        for chunk in urls.chunks(4) {
            let parts: Vec<Result<Vec<u8>, String>> = std::thread::scope(|sc| {
                let hs: Vec<_> = chunk.iter().map(|(u, c)| sc.spawn(move || get(u, c.clone()))).collect();
                hs.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("download failed".into()))).collect()
            });
            for part in parts {
                out.write_all(&part?).map_err(|e| e.to_string())?;
            }
        }
        out.flush().map_err(|e| e.to_string())
    };
    if let Err(e) = write() {
        let _ = std::fs::remove_file(&path);
        return Err(e);
    }
    if ext == "ts" {
        if let Some(mp4) = remux_mp4(&path) {
            return Ok(mp4);
        }
    }
    Ok(path)
}

/// .ts -> .mp4 without re-encoding, if ffmpeg is on PATH (Windows previews .mp4 but not .ts).
fn remux_mp4(ts: &std::path::Path) -> Option<std::path::PathBuf> {
    use std::os::windows::process::CommandExt;
    let mp4 = ts.with_extension("mp4");
    let ok = std::process::Command::new("ffmpeg")
        .args(["-y", "-loglevel", "error", "-i"])
        .arg(ts)
        .args(["-c", "copy", "-movflags", "+faststart"])
        .arg(&mp4)
        .creation_flags(0x0800_0000)
        .status()
        .is_ok_and(|s| s.success());
    if ok {
        let _ = std::fs::remove_file(ts);
        Some(mp4)
    } else {
        let _ = std::fs::remove_file(&mp4);
        None
    }
}

fn render(s: &Session, target: f64, skip: bool) -> String {
    let tok = proxy().map(|p| p.token.as_str()).unwrap_or("");
    // delta update: leave out segments older than CAN_SKIP_SECS from the end (the player already has them)
    let skipped = if skip {
        let mut from_end = 0.0;
        let keep = s.segs.iter().rev().take_while(|x| { from_end += x.dur; from_end <= CAN_SKIP_SECS }).count();
        s.segs.len().saturating_sub(keep.max(1))
    } else {
        0
    };
    let mut o = format!("#EXTM3U\n#EXT-X-VERSION:{}\n", if skipped > 0 { 9 } else { 6 });
    o.push_str(&format!("#EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL={CAN_SKIP_SECS:.1}\n"));
    // Twitch advertises TARGETDURATION:6 for 2 s segments; players keep ~3x target behind live,
    // which made streams ~18 s late. Use the real (max) segment length instead.
    let real = s.segs.iter().map(|x| x.dur).fold(0.0f64, f64::max);
    let target = if real > 0.0 { real } else { target };
    o.push_str(&format!("#EXT-X-TARGETDURATION:{}\n", target.ceil().max(1.0) as u64));
    o.push_str(&format!("#EXT-X-MEDIA-SEQUENCE:{}\n", s.segs.front().map_or(0, |x| x.seq)));
    o.push_str(&format!("#EXT-X-DISCONTINUITY-SEQUENCE:{}\n", s.disc_seq));
    if skipped > 0 {
        o.push_str(&format!("#EXT-X-SKIP:SKIPPED-SEGMENTS={skipped}\n"));
    }
    let mut last_map: Option<&str> = None;
    for seg in s.segs.iter().skip(skipped) {
        if seg.disc {
            o.push_str("#EXT-X-DISCONTINUITY\n");
        }
        if let Some(m) = seg.map.as_deref() {
            if last_map != Some(m) {
                match s.maps.iter().position(|x| x == m).filter(|_| s.dir.is_some()) {
                    Some(i) => o.push_str(&format!("#EXT-X-MAP:URI=\"http://127.0.0.1:{}/{tok}/m/{}/{i}\"\n", s.port, s.id)),
                    None => o.push_str(&format!("#EXT-X-MAP:URI=\"{m}\"\n")),
                }
                last_map = Some(m);
            }
        }
        o.push_str(&format!("#EXTINF:{:.3},live\nhttp://127.0.0.1:{}/{tok}/g/{}/{}\n", seg.dur, s.port, s.id, seg.seq));
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
    let raw_path = line.split_whitespace().nth(1).unwrap_or("");
    let Some(p) = proxy() else { return };
    // Only URLs carrying one of our random prefixes are served.
    let ti_path = format!("/{}/ti", p.ti_token);
    let tok_prefix = format!("/{}", p.token);
    let path = if raw_path == ti_path {
        "/ti"
    } else if let Some(rest) = raw_path.strip_prefix(tok_prefix.as_str()).filter(|r| r.starts_with('/')) {
        rest
    } else {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return;
    };
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
    // /g/<session>/<seq> (segment) and /m/<session>/<index> (init segment): from the rewind cache for dvr
    // sessions, otherwise a redirect to the CDN (keeps long playlists small either way)
    let (is_seg, rest) = match (path.strip_prefix("/g/"), path.strip_prefix("/m/")) {
        (Some(r), _) => (true, Some(r)),
        (None, Some(r)) => (false, Some(r)),
        _ => (false, None),
    };
    if let Some(rest) = rest {
        let mut it = rest.split(['/', '?']);
        let (sid, n) = (it.next().and_then(|x| x.parse::<u64>().ok()), it.next().and_then(|x| x.parse::<u64>().ok()));
        let target = match (sid, n) {
            (Some(sid), Some(n)) => p.sessions.lock().unwrap().get(&sid).cloned().and_then(|s| {
                let s = s.lock().unwrap();
                let url = if is_seg {
                    let first = s.segs.front()?.seq;
                    s.segs.get(n.checked_sub(first)? as usize).map(|x| x.url.clone())?
                } else {
                    s.maps.get(n as usize)?.clone()
                };
                let file = s.dir.as_ref().map(|d| d.join(if is_seg { format!("{n}.seg") } else { format!("m{n}.init") }));
                Some((url, file))
            }),
            _ => None,
        };
        let not_found = "HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        match target {
            Some((url, Some(file))) => match fetch_to(&file, &url).and_then(|_| std::fs::read(&file).map_err(|e| e.to_string())) {
                Ok(bytes) => {
                    let head = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: max-age=3600\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        if url.split('?').next().unwrap_or("").ends_with(".ts") { "video/mp2t" } else { "video/mp4" },
                        bytes.len()
                    );
                    let _ = stream.write_all(head.as_bytes());
                    let _ = stream.write_all(&bytes);
                }
                Err(_) => {
                    let _ = stream.write_all(not_found.as_bytes());
                }
            },
            Some((url, None)) => {
                let _ = stream.write_all(format!("HTTP/1.1 302 Found\r\nLocation: {url}\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes());
            }
            None => {
                let _ = stream.write_all(not_found.as_bytes());
            }
        }
        return;
    }
    let (path, query) = path.split_once('?').unwrap_or((path, ""));
    let skip = query.split('&').any(|kv| kv == "_HLS_skip=YES" || kv == "_HLS_skip=v2");
    let id: Option<u64> = path.strip_prefix("/s/").and_then(|p| p.strip_suffix(".m3u8")).and_then(|p| p.parse().ok());
    let session = id.and_then(|id| proxy()?.sessions.lock().unwrap().get(&id).cloned());
    let Some(session) = session else {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return;
    };
    let refreshed = refresh(&session);
    let body = {
        let s = session.lock().unwrap();
        match refreshed {
            Ok(t) => render(&s, t, skip),
            Err(_) if !s.segs.is_empty() => render(&s, 2.0, skip),
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
