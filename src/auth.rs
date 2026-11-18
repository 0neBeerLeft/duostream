//! Account sign-in.
//! Twitch: OAuth device-code flow (enter a code at twitch.tv/activate). No secrets needed.
//! Kick: official OAuth 2.1 + PKCE against id.kick.com using the user's own Kick developer app.
use crate::common::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::time::{Duration, Instant};

pub const TWITCH_CLIENT_ID: &str = "ue6666qo983tsx6so1t0vnawi233wa";
const TWITCH_SCOPES: &str = "chat:read chat:edit user:read:follows";
pub const KICK_REDIRECT: &str = "http://localhost:53682/callback";
const KICK_SCOPES: &str = "user:read channel:read chat:write";

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
    /// Signed in through kick.com itself (token = website session) instead of a developer app.
    #[serde(default)]
    pub web: bool,
}

pub fn open_browser(url: &str) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).creation_flags(0x0800_0000).spawn();
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
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
    for _ in 0..20 {
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

fn pkce() -> (String, String) {
    use base64::Engine;
    use rand::RngCore;
    use sha2::Digest;
    let mut buf = [0u8; 48];
    rand::thread_rng().fill_bytes(&mut buf);
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let verifier = b64.encode(buf);
    let challenge = b64.encode(sha2::Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

/// Opens the browser to Kick's consent page and waits for the redirect on localhost.
pub fn kick_login(client_id: &str, client_secret: &str, cancel: &std::sync::atomic::AtomicBool) -> Result<KickAuth, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:53682").map_err(|e| format!("port 53682 busy: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let (verifier, challenge) = pkce();
    let state = pkce().0[..16].to_string();
    let url = format!(
        "https://id.kick.com/oauth/authorize?client_id={}&response_type=code&redirect_uri={}&state={}&scope={}&code_challenge={}&code_challenge_method=S256",
        enc(client_id),
        enc(KICK_REDIRECT),
        state,
        enc(KICK_SCOPES),
        challenge
    );
    open_browser(&url);

    let deadline = Instant::now() + Duration::from_secs(300);
    let code = loop {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        if Instant::now() > deadline {
            return Err("Kick sign-in timed out".into());
        }
        let Ok((mut stream, _)) = listener.accept() else {
            std::thread::sleep(Duration::from_millis(150));
            continue;
        };
        let _ = stream.set_nonblocking(false);
        let mut line = String::new();
        let _ = BufReader::new(&stream).read_line(&mut line);
        let path = line.split_whitespace().nth(1).unwrap_or("");
        let q = path.split_once('?').map(|(_, q)| q).unwrap_or("");
        let get = |k: &str| q.split('&').find_map(|kv| kv.strip_prefix(k).and_then(|v| v.strip_prefix('='))).map(String::from);
        let page = |msg: &str| {
            format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<html><body style=\"background:#0b0e0f;color:#eee;font:16px Segoe UI;display:grid;place-items:center;height:100vh;margin:0\"><div>{msg}</div></body></html>")
        };
        if !path.starts_with("/callback") {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
            continue;
        }
        if let Some(e) = get("error") {
            let _ = stream.write_all(page("Kick sign-in was cancelled. You can close this tab.").as_bytes());
            return Err(format!("Kick sign-in failed: {e}"));
        }
        if get("state").as_deref() != Some(state.as_str()) {
            let _ = stream.write_all(page("Sign-in state mismatch. Please try again.").as_bytes());
            return Err("Kick sign-in state mismatch".into());
        }
        let _ = stream.write_all(page("Signed in to Kick. You can close this tab and return to duostream.").as_bytes());
        break get("code").ok_or("Kick returned no code")?;
    };

    let v = form(
        "https://id.kick.com/oauth/token",
        &[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("redirect_uri", KICK_REDIRECT),
            ("code_verifier", &verifier),
        ],
    )
    .map_err(|e| format!("Kick token exchange failed: {e}"))?;
    kick_finish(&v, None)
}

fn kick_finish(v: &Value, old_refresh: Option<&str>) -> Result<KickAuth, String> {
    let token = v["access_token"].as_str().ok_or("Kick returned no token")?.to_string();
    let refresh = v["refresh_token"].as_str().or(old_refresh).unwrap_or("").to_string();
    let expires_at = now() + v["expires_in"].as_i64().unwrap_or(3600);
    let u: Value = http()
        .get("https://api.kick.com/public/v1/users")
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(err_str)?
        .into_json()
        .map_err(|e| e.to_string())?;
    let me = &u["data"][0];
    Ok(KickAuth {
        token,
        refresh,
        username: me["name"].as_str().unwrap_or("kick user").to_string(),
        avatar: me["profile_picture"].as_str().filter(|s| !s.is_empty()).map(String::from),
        expires_at,
        web: false,
    })
}

pub fn kick_restore(a: &KickAuth, client_id: &str, client_secret: &str) -> Result<KickAuth, String> {
    if a.web {
        // website session: still valid if kick.com still knows who we are
        let (username, avatar) = crate::kick::me(&a.token)?;
        return Ok(KickAuth { username, avatar: avatar.or(a.avatar.clone()), ..a.clone() });
    }
    if a.expires_at > now() + 120 {
        return Ok(a.clone());
    }
    let v = form(
        "https://id.kick.com/oauth/token",
        &[("grant_type", "refresh_token"), ("refresh_token", &a.refresh), ("client_id", client_id), ("client_secret", client_secret)],
    )?;
    kick_finish(&v, Some(&a.refresh))
}

pub fn kick_send(token: &str, broadcaster_user_id: u64, content: &str, reply_to: Option<&str>) -> Result<(), String> {
    let mut body = serde_json::json!({ "type": "user", "broadcaster_user_id": broadcaster_user_id, "content": content });
    if let Some(id) = reply_to {
        body["reply_to_message_id"] = serde_json::json!(id);
    }
    http()
        .post("https://api.kick.com/public/v1/chat")
        .set("Authorization", &format!("Bearer {token}"))
        .send_json(body)
        .map(|_| ())
        .map_err(|e| match e {
            ureq::Error::Status(c, r) => format!("Kick chat error {c}: {}", r.into_string().unwrap_or_default()),
            e => err_str(e),
        })
}
