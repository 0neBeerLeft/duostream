//! Account sign-in.
//! Twitch: OAuth device-code flow (enter a code at twitch.tv/activate). No secrets needed.
//! Kick: the kick.com website session from the in-app login window (see drops_connect in main.rs).
use crate::common::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{Duration, Instant};

pub const TWITCH_CLIENT_ID: &str = "ue6666qo983tsx6so1t0vnawi233wa";
const TWITCH_SCOPES: &str = "chat:read chat:edit user:read:follows";

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct TwitchAuth {
    pub token: String,
    pub refresh: String,
    pub login: String,
    pub user_id: String,
    pub avatar: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct KickAuth {
    pub token: String,
    pub refresh: String,
    pub username: String,
    pub avatar: Option<String>,
    pub expires_at: i64,
    /// Signed in through kick.com itself (token = website session). False = the old developer-app
    /// sign-in from before v0.7, which is no longer supported (restore asks to sign in again).
    #[serde(default)]
    pub web: bool,
}

pub fn open_browser(url: &str) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).creation_flags(0x0800_0000).spawn();
}

fn form(url: &str, pairs: &[(&str, &str)]) -> Result<Value, String> {
    match http().post(url).send_form(pairs) {
        Ok(r) => r.into_json().map_err(|e| e.to_string()),
        Err(ureq::Error::Status(_, r)) => Err(r.into_string().unwrap_or_default()),
        Err(e) => Err(err_str(e)),
    }
}

// ------------------------------------------------------------------ Twitch

pub struct DeviceCode {
    pub user_code: String,
    pub uri: String,
    device_code: String,
    interval: u64,
    expires: Instant,
}

pub fn twitch_start() -> Result<DeviceCode, String> {
    let v = form("https://id.twitch.tv/oauth2/device", &[("client_id", TWITCH_CLIENT_ID), ("scopes", TWITCH_SCOPES)])?;
    Ok(DeviceCode {
        user_code: v["user_code"].as_str().ok_or("no user code")?.to_string(),
        uri: v["verification_uri"].as_str().unwrap_or("https://www.twitch.tv/activate").to_string(),
        device_code: v["device_code"].as_str().ok_or("no device code")?.to_string(),
        interval: v["interval"].as_u64().unwrap_or(5),
        expires: Instant::now() + Duration::from_secs(v["expires_in"].as_u64().unwrap_or(1800)),
    })
}

/// Blocks until the user approves the code (or it expires).
pub fn twitch_wait(dc: &DeviceCode, cancel: &std::sync::atomic::AtomicBool) -> Result<TwitchAuth, String> {
    while Instant::now() < dc.expires {
        std::thread::sleep(Duration::from_secs(dc.interval));
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        match form(
            "https://id.twitch.tv/oauth2/token",
            &[
                ("client_id", TWITCH_CLIENT_ID),
                ("scopes", TWITCH_SCOPES),
                ("device_code", &dc.device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ],
        ) {
            Ok(v) => {
                let token = v["access_token"].as_str().ok_or("no access token")?.to_string();
                let refresh = v["refresh_token"].as_str().unwrap_or("").to_string();
                return twitch_identify(token, refresh);
            }
            Err(e) if e.contains("authorization_pending") || e.contains("slow_down") => continue,
            Err(e) => return Err(format!("Twitch sign-in failed: {e}")),
        }
    }
    Err("The sign-in code expired. Start again.".into())
}

fn twitch_identify(token: String, refresh: String) -> Result<TwitchAuth, String> {
    let v: Value = http()
        .get("https://id.twitch.tv/oauth2/validate")
        .set("Authorization", &format!("OAuth {token}"))
        .call()
        .map_err(err_str)?
        .into_json()
        .map_err(|e| e.to_string())?;
    let login = v["login"].as_str().ok_or("token has no user")?.to_string();
    let user_id = v["user_id"].as_str().unwrap_or("").to_string();
    let avatar = helix(&token, &format!("https://api.twitch.tv/helix/users?id={user_id}"))
        .ok()
        .and_then(|u| u["data"][0]["profile_image_url"].as_str().map(String::from));
    Ok(TwitchAuth { token, refresh, login, user_id, avatar })
}

/// Validate a stored session, refreshing it if needed.
pub fn twitch_restore(a: &TwitchAuth) -> Result<TwitchAuth, String> {
    if let Ok(t) = twitch_identify(a.token.clone(), a.refresh.clone()) {
        return Ok(t);
    }
    let v = form(
        "https://id.twitch.tv/oauth2/token",
        &[("client_id", TWITCH_CLIENT_ID), ("grant_type", "refresh_token"), ("refresh_token", &a.refresh)],
    )?;
    let token = v["access_token"].as_str().ok_or("refresh failed")?.to_string();
    let refresh = v["refresh_token"].as_str().unwrap_or(&a.refresh).to_string();
    twitch_identify(token, refresh)
}

/// Called every few minutes while running: Some(new session) when the token was refreshed because it
/// expires within 30 minutes or was already rejected; None when it is still good.
pub fn twitch_keep_fresh(a: &TwitchAuth) -> Result<Option<TwitchAuth>, String> {
    let still_good = http()
        .get("https://id.twitch.tv/oauth2/validate")
        .set("Authorization", &format!("OAuth {}", a.token))
        .call()
        .ok()
        .and_then(|r| r.into_json::<Value>().ok())
        .is_some_and(|v| v["expires_in"].as_u64().is_none_or(|s| s == 0 || s > 1800)); // 0 = never expires
    if still_good {
        return Ok(None);
    }
    let v = form(
        "https://id.twitch.tv/oauth2/token",
        &[("client_id", TWITCH_CLIENT_ID), ("grant_type", "refresh_token"), ("refresh_token", &a.refresh)],
    )?;
    let token = v["access_token"].as_str().ok_or("refresh failed")?.to_string();
    let refresh = v["refresh_token"].as_str().unwrap_or(&a.refresh).to_string();
    twitch_identify(token, refresh).map(Some)
}

fn helix(token: &str, url: &str) -> Result<Value, String> {
    http()
        .get(url)
        .set("Client-Id", TWITCH_CLIENT_ID)
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(err_str)?
        .into_json()
        .map_err(|e| e.to_string())
}

/// Logins of every channel the signed-in Twitch account follows.
pub fn twitch_follows(a: &TwitchAuth) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut cursor = String::new();
    for _ in 0..200 {
        let mut url = format!("https://api.twitch.tv/helix/channels/followed?user_id={}&first=100", a.user_id);
        if !cursor.is_empty() {
            url.push_str(&format!("&after={cursor}"));
        }
        let v = helix(&a.token, &url)?;
        for e in v["data"].as_array().cloned().unwrap_or_default() {
            if let Some(l) = e["broadcaster_login"].as_str() {
                out.push(l.to_string());
            }
        }
        match v["pagination"]["cursor"].as_str() {
            Some(c) if !c.is_empty() => cursor = c.to_string(),
            _ => break,
        }
    }
    Ok(out)
}

// ------------------------------------------------------------------ Kick

/// Check a saved kick.com website session (and pick up a changed name/avatar).
pub fn kick_restore(a: &KickAuth) -> Result<KickAuth, String> {
    if !a.web {
        return Err("old Kick sign-in".into());
    }
    let (username, avatar) = crate::kick::me(&a.token)?;
    Ok(KickAuth { username, avatar: avatar.or(a.avatar.clone()), ..a.clone() })
}
