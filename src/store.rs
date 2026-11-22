use crate::common::Platform;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, PartialEq)]
pub struct Follow {
    pub platform: Platform,
    pub login: String,
}

/// Settings live in config.json. Sign-ins and website sessions are NOT written there: they go to
/// secrets.dat, encrypted with Windows DPAPI (only this Windows account can read it). The secret
/// fields still deserialize from config.json so older installs migrate on the first save.
#[derive(Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub follows: Vec<Follow>,
    pub volume: f32,
    pub low_latency: bool,
    pub show_chat: bool,
    /// "t:login" / "k:slug" → profile picture URL, so offline follows keep their avatar.
    pub avatars: std::collections::HashMap<String, String>,
    #[serde(skip_serializing)]
    pub twitch: Option<crate::auth::TwitchAuth>,
    #[serde(skip_serializing)]
    pub kick: Option<crate::auth::KickAuth>,
    pub adblock: bool,
    pub sidebar_collapsed: bool,
    /// Windows notification when a followed channel goes live.
    pub notify_live: bool,
    /// Closing the window keeps duostream running in the tray (for notifications).
    pub close_to_tray: bool,
    /// plugin id -> enabled
    pub plugins: std::collections::HashMap<String, bool>,
    /// v0.6 flag: the ad block plugin was installed once.
    pub plugins_seeded: bool,
    /// Built-in plugins installed once each (ad block, 7TV, BTTV, FFZ); an uninstall is respected afterwards.
    pub seeded_plugins: Vec<String>,
    /// Followed channels ("t:login" / "k:slug") with go-live notifications turned off.
    pub notify_muted: Vec<String>,
    /// Start with Windows (hidden in the tray).
    pub autostart: bool,
    /// Extra plugin shop sources (URLs of registry.json files).
    pub plugin_sources: Vec<String>,
    /// twitch.tv website session (auth-token cookie), only used for drops.
    #[serde(skip_serializing)]
    pub twitch_web_token: String,
    /// GQL client id that accepted the website token for drops.
    pub twitch_drops_client: String,
    /// kick.com website session (session_token cookie): Kick chat, follows and drops.
    #[serde(skip_serializing)]
    pub kick_web_token: String,
    /// Claim channel-point bonuses and finished drops automatically.
    pub auto_claim: bool,
    /// Last Client-Integrity header set captured from twitch.tv (drops).
    #[serde(skip_serializing)]
    pub twitch_integrity: serde_json::Value,
    /// Chat Enhancer settings (filters, highlights, appearance, users, notifications).
    /// Owned and validated by ui/enhancer.js; stored as-is.
    pub chat_enhancer: serde_json::Value,
    /// Followed categories: { name, twitch, kick, art }.
    pub followed_categories: Vec<serde_json::Value>,
    /// Hidden channels ("t:login" / "k:slug") and categories (lowercase name).
    pub hidden_channels: Vec<String>,
    pub hidden_categories: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            follows: Vec::new(),
            volume: 70.0,
            low_latency: false,
            show_chat: true,
            avatars: Default::default(),
            twitch: None,
            kick: None,
            adblock: true,
            sidebar_collapsed: false,
            notify_live: true,
            close_to_tray: true,
            plugins: Default::default(),
            plugins_seeded: false,
            seeded_plugins: Vec::new(),
            notify_muted: Vec::new(),
            autostart: false,
            plugin_sources: Vec::new(),
            twitch_web_token: String::new(),
            twitch_drops_client: String::new(),
            kick_web_token: String::new(),
            auto_claim: true,
            twitch_integrity: serde_json::Value::Null,
            chat_enhancer: serde_json::Value::Null,
            followed_categories: Vec::new(),
            hidden_channels: Vec::new(),
            hidden_categories: Vec::new(),
        }
    }
}

/// Everything sensitive, stored encrypted in secrets.dat.
#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Secrets {
    twitch: Option<crate::auth::TwitchAuth>,
    kick: Option<crate::auth::KickAuth>,
    twitch_web_token: String,
    kick_web_token: String,
    twitch_integrity: serde_json::Value,
}

impl Secrets {
    fn from_config(c: &Config) -> Self {
        Secrets {
            twitch: c.twitch.clone(),
            kick: c.kick.clone(),
            twitch_web_token: c.twitch_web_token.clone(),
            kick_web_token: c.kick_web_token.clone(),
            twitch_integrity: c.twitch_integrity.clone(),
        }
    }
    fn apply(self, c: &mut Config) {
        c.twitch = self.twitch;
        c.kick = self.kick;
        c.twitch_web_token = self.twitch_web_token;
        c.kick_web_token = self.kick_web_token;
        c.twitch_integrity = self.twitch_integrity;
    }
    fn is_empty(&self) -> bool {
        self.twitch.is_none()
            && self.kick.is_none()
            && self.twitch_web_token.is_empty()
            && self.kick_web_token.is_empty()
            && self.twitch_integrity.is_null()
    }
}

fn dir() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    base.join("duostream")
}

/// Bytes last written to each file, so unchanged state isn't rewritten to disk.
static LAST: Mutex<(Vec<u8>, Vec<u8>)> = Mutex::new((Vec::new(), Vec::new()));

pub fn load() -> Config {
    let d = dir();
    let p = d.join("config.json");
    let mut c = match std::fs::read_to_string(&p) {
        Ok(raw) => match serde_json::from_str::<Config>(raw.trim_start_matches('\u{feff}')) {
            Ok(c) => c,
            Err(_) => {
                // Never silently replace a config we can't read: keep a copy.
                let _ = std::fs::copy(&p, d.join("config.unreadable.json"));
                Config::default()
            }
        },
        Err(_) => Config::default(),
    };
    // Plain-text secrets from an older version: moved into secrets.dat by the save below.
    let legacy = !Secrets::from_config(&c).is_empty();
    let sp = d.join("secrets.dat");
    if let Ok(blob) = std::fs::read(&sp) {
        match dpapi::unprotect(&blob).ok().and_then(|b| serde_json::from_slice::<Secrets>(&b).ok()) {
            Some(s) => s.apply(&mut c),
            None => {
                // Written by another Windows account or corrupted: keep it, sign in again.
                let _ = std::fs::copy(&sp, d.join("secrets.unreadable.dat"));
            }
        }
    }
    if legacy {
        save(&c);
    }
    c
}

pub fn save(c: &Config) {
    let d = dir();
    let _ = std::fs::create_dir_all(&d);
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if let Ok(s) = serde_json::to_vec_pretty(c) {
        if s != last.0 && write_atomic(&d.join("config.json"), &s).is_ok() {
            last.0 = s;
        }
    }
    if let Ok(s) = serde_json::to_vec(&Secrets::from_config(c)) {
        if s != last.1 {
            if let Ok(blob) = dpapi::protect(&s) {
                if write_atomic(&d.join("secrets.dat"), &blob).is_ok() {
                    last.1 = s;
                }
            }
        }
    }
}

/// Write to a temp file, flush it to disk, then rename over the target: a crash or power cut
/// leaves either the old file or the new one, never a half-written one.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("tmp");
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)
}

/// Windows DPAPI (CryptProtectData): data encrypted for the current Windows user.
mod dpapi {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

    const ENTROPY: &[u8] = b"duostream secrets v1";

    fn blob(b: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: b.len() as u32, pbData: b.as_ptr() as *mut u8 }
    }

    fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        // SAFETY: on success the API returns a LocalAlloc'd buffer of cbData bytes, which we copy
        // and then free exactly once.
        unsafe {
            let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            let _ = LocalFree(Some(HLOCAL(out.pbData as *mut core::ffi::c_void)));
            v
        }
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        let input = blob(data);
        let entropy = blob(ENTROPY);
        let mut out = CRYPT_INTEGER_BLOB::default();
        // SAFETY: input/entropy point at live slices for the duration of the call; out is written by the API.
        unsafe { CryptProtectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out) }.map_err(|e| e.to_string())?;
        Ok(take(out))
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        let input = blob(data);
        let entropy = blob(ENTROPY);
        let mut out = CRYPT_INTEGER_BLOB::default();
        // SAFETY: as above.
        unsafe { CryptUnprotectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out) }.map_err(|e| e.to_string())?;
        Ok(take(out))
    }
}
