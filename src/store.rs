use crate::common::Platform;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, PartialEq)]
pub struct Follow {
    pub platform: Platform,
    pub login: String,
}

#[derive(Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub follows: Vec<Follow>,
    pub volume: f32,
    pub low_latency: bool,
    pub show_chat: bool,
    /// "t:login" / "k:slug" → profile picture URL, so offline follows keep their avatar.
    pub avatars: std::collections::HashMap<String, String>,
    pub twitch: Option<crate::auth::TwitchAuth>,
    pub kick: Option<crate::auth::KickAuth>,
    pub kick_client_id: String,
    pub kick_client_secret: String,
    pub adblock: bool,
    pub sidebar_collapsed: bool,
    /// Windows notification when a followed channel goes live.
    pub notify_live: bool,
    /// Closing the window keeps duostream running in the tray (for notifications).
    pub close_to_tray: bool,
    /// plugin id -> enabled
    pub plugins: std::collections::HashMap<String, bool>,
    /// Built-in plugins (ad block) are installed once; an uninstall is respected afterwards.
    pub plugins_seeded: bool,
    /// Extra plugin shop sources (URLs of registry.json files).
    pub plugin_sources: Vec<String>,
    /// twitch.tv website session (auth-token cookie), only used for drops.
    pub twitch_web_token: String,
    /// GQL client id that accepted the website token for drops.
    pub twitch_drops_client: String,
    /// kick.com website session (session_token cookie), only used for drops.
    pub kick_web_token: String,
    /// Claim channel-point bonuses and finished drops automatically.
    pub auto_claim: bool,
    /// Last Client-Integrity header set captured from twitch.tv (drops).
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
            kick_client_id: String::new(),
            kick_client_secret: String::new(),
            adblock: true,
            sidebar_collapsed: false,
            notify_live: true,
            close_to_tray: true,
            plugins: Default::default(),
            plugins_seeded: false,
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

fn path() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    base.join("duostream").join("config.json")
}

pub fn load() -> Config {
    let p = path();
    let Ok(raw) = std::fs::read_to_string(&p) else { return Config::default() };
    match serde_json::from_str(raw.trim_start_matches('\u{feff}')) {
        Ok(c) => c,
        Err(_) => {
            // Never silently replace a config we can't read: keep a copy so sign-ins aren't lost.
            let _ = std::fs::copy(&p, p.with_file_name("config.unreadable.json"));
            Config::default()
        }
    }
}

pub fn save(c: &Config) {
    let p = path();
    if let Some(d) = p.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    if let Ok(s) = serde_json::to_string_pretty(c) {
        let _ = std::fs::write(p, s);
    }
}
