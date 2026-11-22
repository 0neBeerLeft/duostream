use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

pub const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Platform {
    Twitch,
    Kick,
}

impl Platform {
    pub fn name(self) -> &'static str {
        match self {
            Platform::Twitch => "Twitch",
            Platform::Kick => "Kick",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct StreamCard {
    pub platform: Platform,
    pub login: String,
    pub display: String,
    pub title: String,
    pub viewers: u64,
    pub thumb: Option<String>,
    pub category: String,
    pub avatar: Option<String>,
    pub started: Option<String>,
    pub tags: Vec<String>,
    pub language: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Variant {
    pub name: String,
    pub url: String,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Resolved {
    pub display: String,
    pub title: String,
    pub category: String,
    pub viewers: u64,
    pub live: bool,
    pub variants: Vec<Variant>,
    pub kick_chatroom: Option<u64>,
    pub kick_channel_id: Option<u64>,
    pub kick_user_id: Option<u64>,
    /// Platform user id (Twitch user id / Kick user id): plugins use it for 7TV, BTTV and FFZ emotes.
    pub user_id: Option<String>,
    pub avatar: Option<String>,
    pub started: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "t", content = "v", rename_all = "lowercase")]
pub enum Span {
    Text(String),
    Emote(String),
}

#[derive(Clone, Debug, Serialize)]
pub struct Reply {
    pub name: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct ChatMsg {
    /// Platform message id (used for replies). Empty for system lines.
    pub id: String,
    /// Account name (lowercase login / Kick slug) for the user card.
    pub login: String,
    pub name: String,
    pub color: String,
    pub spans: Vec<Span>,
    pub system: bool,
    /// Raw badge keys: Twitch "set/version", Kick "type" or "subscriber/<months>".
    pub badges: Vec<String>,
    pub reply: Option<Reply>,
    /// Control lines (not shown as messages): "delete" (target = message id), "clear_user" (target = login,
    /// text = what happened), "clear_all", "own_failed" (Twitch refused your last message), "me" (your own
    /// badges/color, from USERSTATE). Empty for normal and system messages.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub kind: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub target: String,
    /// Sent before you joined (chat history on join); shown dimmed.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub history: bool,
}

impl ChatMsg {
    pub fn system(text: impl Into<String>) -> Self {
        ChatMsg { color: "#a9adb5".into(), spans: vec![Span::Text(text.into())], system: true, ..Default::default() }
    }
    /// A control line; `text` (optional) is shown as a system message by the UI.
    pub fn control(kind: &str, target: impl Into<String>, text: impl Into<String>) -> Self {
        let text = text.into();
        ChatMsg { kind: kind.into(), target: target.into(), system: true, spans: if text.is_empty() { vec![] } else { vec![Span::Text(text)] }, ..Default::default() }
    }
}

pub fn http() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        let mut b = ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).user_agent(UA);
        if let Ok(tls) = native_tls::TlsConnector::new() {
            b = b.tls_connector(Arc::new(tls));
        }
        b.build()
    })
}

pub fn err_str(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, r) => format!("HTTP {code} from {}", r.get_url()),
        ureq::Error::Transport(t) => format!("network error: {t}"),
    }
}

/// Percent-encode everything except unreserved characters.
pub fn enc(s: &str) -> String {
    let mut o = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            o.push(b as char);
        } else {
            o.push_str(&format!("%{b:02X}"));
        }
    }
    o
}

/// Parse "#RRGGBB"; brighten colors that are unreadable on a dark background.
pub fn name_color(hex: Option<&str>, name: &str) -> String {
    let parsed = hex
        .map(|h| h.trim_start_matches('#'))
        .filter(|h| h.len() == 6)
        .and_then(|h| u32::from_str_radix(h, 16).ok())
        .map(|v| ((v >> 16) as u8, (v >> 8) as u8, v as u8));
    let (r, g, b) = parsed.unwrap_or_else(|| {
        const PAL: [(u8, u8, u8); 10] = [
            (255, 99, 99), (99, 160, 255), (99, 230, 130), (255, 170, 60), (220, 120, 255),
            (60, 220, 220), (255, 120, 190), (180, 220, 60), (255, 210, 80), (150, 150, 255),
        ];
        let h = name.bytes().fold(5381u32, |a, c| a.wrapping_mul(33) ^ c as u32);
        PAL[h as usize % PAL.len()]
    });
    let lum = 0.299 * r as f32 + 0.587 * g as f32 + 0.114 * b as f32;
    let (r, g, b) = if lum < 90.0 {
        let k = 0.55;
        let l = |c: u8| (c as f32 + (255.0 - c as f32) * k) as u8;
        (l(r), l(g), l(b))
    } else {
        (r, g, b)
    };
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// Split an HLS attribute list (KEY=VAL,KEY="V,AL") into pairs.
fn hls_attrs(s: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let (mut key, mut val, mut in_key, mut quoted) = (String::new(), String::new(), true, false);
    for ch in s.chars() {
        match ch {
            '=' if in_key => in_key = false,
            '"' if !in_key => quoted = !quoted,
            ',' if !quoted => {
                out.push((std::mem::take(&mut key), std::mem::take(&mut val)));
                in_key = true;
            }
            c if in_key => key.push(c),
            c => val.push(c),
        }
    }
    if !key.is_empty() {
        out.push((key, val));
    }
    out
}

fn attr<'a>(a: &'a [(String, String)], k: &str) -> Option<&'a str> {
    a.iter().find(|(key, _)| key == k).map(|(_, v)| v.as_str())
}

/// Parse an HLS master playlist into named quality variants (with "Auto" first).
pub fn parse_master(text: &str, master_url: &str) -> Vec<Variant> {
    let base = master_url.rsplit_once('/').map(|(b, _)| b).unwrap_or("");
    let mut names = std::collections::HashMap::new();
    let mut out = vec![Variant { name: "Auto".into(), url: master_url.to_string() }];
    let mut pending: Option<String> = None;
    for line in text.lines().map(str::trim) {
        if let Some(rest) = line.strip_prefix("#EXT-X-MEDIA:") {
            let a = hls_attrs(rest);
            if let (Some(g), Some(n)) = (attr(&a, "GROUP-ID"), attr(&a, "NAME")) {
                names.insert(g.to_string(), n.to_string());
            }
        } else if let Some(rest) = line.strip_prefix("#EXT-X-STREAM-INF:") {
            let a = hls_attrs(rest);
            let name = attr(&a, "VIDEO")
                .and_then(|v| names.get(v).cloned())
                .or_else(|| attr(&a, "RESOLUTION").and_then(|r| r.split('x').nth(1)).map(|h| format!("{h}p")))
                .or_else(|| attr(&a, "BANDWIDTH").map(|b| format!("{}k", b.parse::<u64>().unwrap_or(0) / 1000)))
                .unwrap_or_else(|| "stream".into());
            pending = Some(name);
        } else if !line.is_empty() && !line.starts_with('#') {
            if let Some(name) = pending.take() {
                let url = if line.starts_with("http") { line.to_string() } else { format!("{base}/{line}") };
                if !out.iter().any(|v| v.name == name) {
                    out.push(Variant { name, url });
                }
            }
        }
    }
    out
}

pub fn fetch_text(url: &str) -> Result<String, String> {
    http().get(url).call().map_err(err_str)?.into_string().map_err(|e| e.to_string())
}
