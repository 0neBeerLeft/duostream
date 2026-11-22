use crate::common::*;
use serde_json::{json, Value};
use std::sync::mpsc::Sender;
use std::time::Duration;
use tungstenite::Message;

/// Fallback only: Kick retired this key; current credentials come from `realtime_credentials`.
const LEGACY_KEY: (&str, &str) = ("32cbd69e4b950bf97679", "us2");

/// Any request through curl.exe (same Cloudflare reason as `curl_json`). Body is piped via stdin.
fn curl_req(method: &str, url: &str, bearer: Option<&str>, body: Option<&Value>) -> Result<Value, String> {
    use std::io::Write;
    use std::os::windows::process::CommandExt;
    let auth = bearer.map(|t| format!("Authorization: Bearer {t}"));
    let mut args: Vec<&str> = vec![
        "-s", "-S", "--compressed", "--max-time", "15", "-w", "\n%{http_code}", "-A", UA, "-X", method,
        "-H", "Accept: application/json", "-H", "x-app-platform: web", "-H", "Referer: https://kick.com/",
    ];
    if let Some(a) = &auth {
        args.extend(["-H", a.as_str()]);
    }
    if body.is_some() {
        args.extend(["-H", "Content-Type: application/json", "--data-binary", "@-"]);
    }
    args.push(url);
    let mut child = std::process::Command::new("curl.exe")
        .args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .creation_flags(0x0800_0000)
        .spawn()
        .map_err(|e| e.to_string())?;
    {
        let mut stdin = child.stdin.take().ok_or("no stdin")?;
        if let Some(b) = body {
            stdin.write_all(b.to_string().as_bytes()).map_err(|e| e.to_string())?;
        }
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let (json, code) = text.trim_end().rsplit_once('\n').ok_or("empty response")?;
    match code.trim() {
        "200" | "201" | "204" => Ok(serde_json::from_str(json).unwrap_or(Value::Null)),
        "401" | "403" => Err(format!("not authorized (HTTP {})", code.trim())),
        c => Err(format!("HTTP {c}: {}", json.chars().take(200).collect::<String>())),
    }
}

fn curl_post_json(url: &str, body: &Value) -> Result<Value, String> {
    curl_req("POST", url, None, Some(body))
}

fn find_key(v: &Value, key: &str) -> Option<String> {
    match v {
        Value::Object(m) => m.get(key).and_then(|x| x.as_str().map(String::from)).or_else(|| m.values().find_map(|x| find_key(x, key))),
        Value::Array(a) => a.iter().find_map(|x| find_key(x, key)),
        _ => None,
    }
}

fn find_channels(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) if s.starts_with("chatrooms.") || s.starts_with("chatroom_") || s.starts_with("channel.") || s.starts_with("channel_") => {
            out.push(s.clone())
        }
        Value::Object(m) => m.values().for_each(|x| find_channels(x, out)),
        Value::Array(a) => a.iter().for_each(|x| find_channels(x, out)),
        _ => {}
    }
}

/// Ask Kick which realtime server to use for this channel's chat (what kick.com itself does).
fn realtime_credentials(channel_id: u64) -> Result<(String, String, Vec<String>), String> {
    let id = format!("duostream-{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    let body = json!({ "client": { "id": id, "type": "web" }, "capabilities": { "accepted_providers": [{ "provider": "pusher" }] } });
    let v = curl_post_json(&format!("https://web.kick.com/api/v1/realtime/channels/{channel_id}/chat/connection"), &body)?;
    let key = find_key(&v, "app_key").ok_or_else(|| format!("no pusher key in reply: {}", v.to_string().chars().take(200).collect::<String>()))?;
    let cluster = find_key(&v, "cluster").unwrap_or_else(|| "us2".into());
    let mut chans = Vec::new();
    find_channels(&v, &mut chans);
    chans.dedup();
    Ok((key, cluster, chans))
}

/// Kick's website API sits behind Cloudflare, which rejects the Rust HTTP stack but accepts
/// Windows' bundled curl.exe. Use curl first, fall back to ureq.
fn curl_json(url: &str) -> Option<Result<Value, String>> {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("curl.exe")
        .args(["-s", "-S", "--compressed", "--max-time", "15", "-w", "\n%{http_code}", "-A", UA, "-H", "Accept: application/json", url])
        .creation_flags(0x0800_0000)
        .output()
        .ok()?;
    let body = String::from_utf8_lossy(&out.stdout);
    let (json, code) = body.trim_end().rsplit_once('\n')?;
    Some(match code.trim() {
        "200" => serde_json::from_str(json).map_err(|e| format!("Kick returned non-JSON: {e}")),
        "403" => Err("Kick blocked the request (Cloudflare 403). Try again shortly.".into()),
        "404" => Err("Kick channel not found".into()),
        c => Err(format!("Kick HTTP {c}")),
    })
}

fn get_json(url: &str) -> Result<Value, String> {
    if let Some(r) = curl_json(url) {
        return r;
    }
    let r = http()
        .get(url)
        .set("Accept", "application/json, text/plain, */*")
        .set("Accept-Language", "en-US,en;q=0.9")
        .set("Referer", "https://kick.com/")
        .call();
    match r {
        Ok(resp) => resp.into_json().map_err(|e| format!("Kick returned non-JSON: {e}")),
        Err(ureq::Error::Status(403, _)) => Err("Kick blocked the request (Cloudflare 403). Try again shortly.".into()),
        Err(ureq::Error::Status(404, _)) => Err("Kick channel not found".into()),
        Err(e) => Err(err_str(e)),
    }
}

fn s(v: &Value) -> Option<String> {
    v.as_str().filter(|x| !x.is_empty()).map(String::from)
}

/// Stream/VOD thumbnail. Kick lists sizes in `srcset` while `src` is the 1280x720 one; cards are
/// ~320 px wide, so the 640w entry looks identical and decodes to a quarter of the memory.
fn thumb(v: &Value) -> Option<String> {
    pick_srcset(v["srcset"].as_str(), 640).or_else(|| s(&v["src"])).or_else(|| s(&v["url"])).or_else(|| s(v))
}

/// Category art: the 285w box art matches Twitch (285x380) instead of the 408x546 original.
fn art(v: &Value) -> Option<String> {
    pick_srcset(v["responsive"].as_str(), 285).or_else(|| s(&v["url"]))
}

/// Avatars are shown at 32-80 px; Kick serves the same picture as -medium (150 px) next to -fullsize (350 px).
fn avatar(u: Option<String>) -> Option<String> {
    u.map(|x| x.replace("-fullsize.webp", "-medium.webp"))
}

/// The smallest srcset entry at least `want` px wide (else the widest one).
fn pick_srcset(set: Option<&str>, want: u32) -> Option<String> {
    let mut best: Option<(u32, &str)> = None;
    for part in set?.split(",") {
        let mut it = part.split_whitespace();
        let (Some(url), Some(w)) = (it.next(), it.next()) else { continue };
        let Ok(w) = w.trim_end_matches("w").parse::<u32>() else { continue };
        let better = match best {
            None => true,
            Some((bw, _)) if bw >= want => w >= want && w < bw,
            Some((bw, _)) => w > bw,
        };
        if better {
            best = Some((w, url));
        }
    }
    best.map(|(_, u)| u.to_string())
}

pub fn top_streams() -> Result<Vec<StreamCard>, String> {
    let mut last_err = String::from("no data");
    for url in [
        "https://kick.com/stream/livestreams/en?page=1&limit=48&sort=desc",
        "https://kick.com/api/v2/livestreams?limit=48&sort=viewer_count_desc",
    ] {
        match get_json(url) {
            Ok(v) => {
                let arr = v["data"].as_array().or_else(|| v.as_array()).cloned().unwrap_or_default();
                let cards: Vec<StreamCard> = arr.iter().filter_map(stream_card).collect();
                if !cards.is_empty() {
                    return Ok(cards);
                }
            }
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

fn channel(slug: &str) -> Result<Value, String> {
    get_json(&format!("https://kick.com/api/v2/channels/{}", enc(slug)))
}

/// The channel endpoint only carries a stream.kick.com thumb0.jpg URL, which answers 403. The livestream
/// endpoint (2 KB) has the real sized thumbnails.
fn live_thumb(slug: &str, fallback: &Value) -> Option<String> {
    if fallback["srcset"].is_string() {
        return thumb(fallback);
    }
    get_json(&format!("https://kick.com/api/v2/channels/{}/livestream", enc(slug)))
        .ok()
        .and_then(|v| thumb(&v["data"]["thumbnail"]))
        .or_else(|| thumb(fallback))
}

pub fn live_card(slug: &str) -> Result<(Option<String>, Option<StreamCard>), String> {
    let v = channel(slug)?;
    let ls = &v["livestream"];
    let avatar = avatar(s(&v["user"]["profile_pic"]));
    if ls.is_null() {
        return Ok((avatar, None));
    }
    Ok((avatar.clone(), Some(StreamCard {
        avatar,
        started: s(&ls["start_time"]).or_else(|| s(&ls["created_at"])),
        platform: Platform::Kick,
        login: slug.to_string(),
        display: s(&v["user"]["username"]).unwrap_or_else(|| slug.to_string()),
        title: s(&ls["session_title"]).unwrap_or_default(),
        viewers: ls["viewer_count"].as_u64().unwrap_or(0),
        thumb: live_thumb(slug, &ls["thumbnail"]),
        category: s(&ls["categories"][0]["name"]).unwrap_or_default(),
        tags: ls["tags"].as_array().map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect()).unwrap_or_default(),
        language: s(&ls["language"]).unwrap_or_default().to_lowercase(),
    })))
}

pub fn resolve(slug: &str, meta: bool) -> Result<Resolved, String> {
    let v = channel(slug)?;
    let ls = &v["livestream"];
    let mut r = Resolved {
        display: s(&v["user"]["username"]).unwrap_or_else(|| slug.to_string()),
        title: s(&ls["session_title"]).unwrap_or_default(),
        category: s(&ls["categories"][0]["name"]).unwrap_or_default(),
        viewers: ls["viewer_count"].as_u64().unwrap_or(0),
        kick_chatroom: v["chatroom"]["id"].as_u64(),
        kick_channel_id: v["id"].as_u64(),
        kick_user_id: v["user_id"].as_u64().or(v["user"]["id"].as_u64()),
        user_id: v["user_id"].as_u64().or(v["user"]["id"].as_u64()).map(|n| n.to_string()),
        avatar: avatar(s(&v["user"]["profile_pic"])),
        started: s(&ls["start_time"]).or_else(|| s(&ls["created_at"])),
        ..Default::default()
    };
    if let (false, Some(url)) = (ls.is_null(), s(&v["playback_url"])) {
        r.live = true;
        if meta {
            return Ok(r);
        }
        r.variants = match fetch_text(&url) {
            Ok(text) => parse_master(&text, &url),
            Err(_) => vec![Variant { name: "Auto".into(), url }],
        };
    }
    Ok(r)
}

// ---------------------------------------------------------------- channel pages

/// Kick user id of a channel (for plugins: 7TV emotes).
pub fn user_id(slug: &str) -> Option<String> {
    let v = channel(slug).ok()?;
    v["user_id"].as_u64().or(v["user"]["id"].as_u64()).map(|n| n.to_string())
}

/// Bio, followers, socials and the channel's subscriber badge images (months -> url).
pub fn about(slug: &str) -> Result<Value, String> {
    let v = channel(slug)?;
    let u = &v["user"];
    let mut socials = Vec::new();
    for (key, title, base) in [
        ("instagram", "Instagram", "https://instagram.com/"), ("twitter", "X", "https://x.com/"), ("youtube", "YouTube", "https://youtube.com/"),
        ("discord", "Discord", "https://discord.gg/"), ("tiktok", "TikTok", "https://tiktok.com/@"), ("facebook", "Facebook", "https://facebook.com/"),
    ] {
        if let Some(h) = s(&u[key]) {
            let url = if h.starts_with("http") { h.clone() } else { format!("{base}{}", h.trim_start_matches('@')) };
            socials.push(json!({ "name": key, "title": title, "url": url }));
        }
    }
    let sub_badges: Vec<Value> = v["subscriber_badges"].as_array().cloned().unwrap_or_default().iter()
        .map(|b| json!({ "months": b["months"], "url": b["badge_image"]["src"] })).collect();
    Ok(json!({ "bio": u["bio"], "followers": v["followers_count"], "socials": socials, "panels": [], "sub_badges": sub_badges, "verified": v["verified"] }))
}

pub fn videos(slug: &str) -> Result<Vec<Value>, String> {
    let v = get_json(&format!("https://kick.com/api/v2/channels/{}/videos", enc(slug)))?;
    Ok(v.as_array().cloned().unwrap_or_default().iter().filter(|x| s(&x["source"]).is_some()).map(|x| json!({
        "id": x["source"], "title": x["session_title"], "seconds": x["duration"].as_u64().map(|ms| ms / 1000), "views": x["views"],
        "date": x["created_at"], "thumb": thumb(&x["thumbnail"]), "category": x["categories"][0]["name"],
    })).collect())
}

pub fn clips(slug: &str) -> Result<Vec<Value>, String> {
    let v = get_json(&format!("https://kick.com/api/v2/channels/{}/clips?sort=view&time=month", enc(slug)))?;
    Ok(v["clips"].as_array().cloned().unwrap_or_default().iter().map(|c| json!({
        "id": c["clip_url"], "title": c["title"], "seconds": c["duration"], "views": c["views"].as_u64().or(c["view_count"].as_u64()),
        "date": c["created_at"], "thumb": c["thumbnail_url"],
    })).collect())
}

/// Quality variants of a VOD master playlist (Kick serves these with CORS, so no proxy needed).
pub fn vod_variants(master: &str) -> Result<Vec<Variant>, String> {
    if !master.starts_with("https://") || !(master.contains(".kick.com/") || master.contains("live-video.net/")) {
        return Err("not a Kick video".into());
    }
    Ok(parse_master(&fetch_text(master)?, master))
}

pub fn categories() -> Result<Vec<Value>, String> {
    let v = get_json("https://kick.com/api/v1/subcategories?limit=40&page=1")?;
    Ok(v["data"].as_array().cloned().unwrap_or_default().iter().map(|c| json!({
        "name": c["name"], "slug": c["slug"], "viewers": c["viewers"], "art": art(&c["banner"]),
    })).collect())
}

fn stream_card(it: &Value) -> Option<StreamCard> {
    let ch = &it["channel"];
    let login = s(&ch["slug"]).or_else(|| s(&it["slug"]))?;
    Some(StreamCard {
        platform: Platform::Kick,
        display: s(&ch["user"]["username"]).unwrap_or_else(|| login.clone()),
        login,
        title: s(&it["session_title"]).unwrap_or_default(),
        viewers: it["viewer_count"].as_u64().or(it["viewers"].as_u64()).unwrap_or(0),
        thumb: thumb(&it["thumbnail"]),
        category: s(&it["categories"][0]["name"]).or_else(|| s(&it["category"]["name"])).unwrap_or_default(),
        avatar: avatar(s(&ch["user"]["profile_pic"]).or_else(|| s(&ch["user"]["profilepic"])).or_else(|| s(&ch["profile_picture"]))),
        started: s(&it["start_time"]).or_else(|| s(&it["created_at"])),
        tags: it["tags"].as_array().map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect()).unwrap_or_default(),
        language: s(&it["language"]).unwrap_or_default().to_lowercase(),
    })
}

/// A stream from web.kick.com's livestream list.
fn web_card(it: &Value) -> Option<StreamCard> {
    let ch = &it["channel"];
    let login = s(&ch["slug"])?;
    Some(StreamCard {
        platform: Platform::Kick,
        display: s(&ch["username"]).unwrap_or_else(|| login.clone()),
        login,
        title: s(&it["title"]).unwrap_or_default(),
        viewers: it["viewer_count"].as_u64().unwrap_or(0),
        thumb: thumb(&it["thumbnail"]),
        category: s(&it["category"]["name"]).unwrap_or_default(),
        avatar: avatar(s(&ch["profile_pic"])),
        started: s(&it["start_time"]),
        tags: it["tags"].as_array().map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect()).unwrap_or_default(),
        language: s(&it["language"]).unwrap_or_default().to_lowercase(),
    })
}

/// Browse page for Kick: (cards, cursor for the next page). `language` is a two-letter code or "" for all.
/// (kick.com/stream/livestreams/<lang> ignores the language, so this uses web.kick.com's list, which filters.)
pub fn browse(language: &str, after: Option<&str>) -> Result<(Vec<StreamCard>, Option<String>), String> {
    let mut url = "https://web.kick.com/api/v1/livestreams?limit=24&sort=viewer_count_desc".to_string();
    if !language.is_empty() && language.len() <= 3 && language.chars().all(|c| c.is_ascii_alphabetic()) {
        url.push_str(&format!("&language={}", language.to_lowercase()));
    }
    if let Some(a) = after.filter(|a| !a.is_empty()) {
        url.push_str(&format!("&after={}", enc(a)));
    }
    let v = get_json(&url)?;
    let cards: Vec<StreamCard> = v["data"]["livestreams"].as_array().cloned().unwrap_or_default().iter().filter_map(web_card).collect();
    let next = s(&v["data"]["pagination"]["next_cursor"]).filter(|_| !cards.is_empty());
    Ok((cards, next))
}

// Channel + category search. Short queries use Kick's instant-search index.
pub fn search(q: &str) -> (Vec<Value>, Vec<Value>) {
    let mut chans = Vec::new();
    let mut cats = Vec::new();
    if q.chars().count() >= 3 {
        if let Ok(v) = get_json(&format!("https://kick.com/api/search?searched_word={}", enc(q))) {
            for c in v["channels"].as_array().cloned().unwrap_or_default() {
                let Some(slug) = s(&c["slug"]) else { continue };
                chans.push(json!({
                    "login": slug, "display": c["user"]["username"], "avatar": avatar(s(&c["user"]["profilePic"])),
                    "live": c["isLive"] == true, "followers": c["followers_count"],
                }));
            }
            for c in v["categories"].as_array().cloned().unwrap_or_default() {
                cats.push(json!({ "name": c["name"], "slug": c["slug"], "viewers": c["viewers"], "art": art(&c["banner"]) }));
            }
        }
    }
    if chans.is_empty() {
        let url = format!("https://search.kick.com/collections/channel/documents/search?q={}&query_by=username&per_page=10", enc(q));
        if let Ok(v) = get_json(&url) {
            for h in v["hits"].as_array().cloned().unwrap_or_default() {
                let d = &h["document"];
                if d["is_banned"] == true {
                    continue;
                }
                let Some(slug) = s(&d["slug"]) else { continue };
                chans.push(json!({ "login": slug, "display": d["username"], "avatar": null, "live": d["is_live"] == true, "followers": d["followers_count"] }));
            }
        }
    }
    chans.sort_by(|a, b| b["live"].as_bool().cmp(&a["live"].as_bool()).then(b["followers"].as_u64().cmp(&a["followers"].as_u64())));
    (chans, cats)
}

pub fn category_streams(slug: &str) -> Result<Vec<StreamCard>, String> {
    let v = get_json(&format!("https://kick.com/stream/livestreams/en?page=1&limit=48&subcategory={}&sort=desc", enc(slug)))?;
    Ok(v["data"].as_array().cloned().unwrap_or_default().iter().filter_map(stream_card).collect())
}

/// Emote picker sets: the channel's own, Global, Emojis.
pub fn emotes(slug: &str) -> Vec<Value> {
    let Ok(v) = get_json(&format!("https://kick.com/emotes/{}", enc(slug))) else { return Vec::new() };
    let mut out = Vec::new();
    for set in v.as_array().cloned().unwrap_or_default() {
        let group = s(&set["slug"]).map(|_| s(&set["user"]["username"]).unwrap_or_else(|| slug.to_string())).or_else(|| s(&set["name"])).unwrap_or_else(|| "Kick".into());
        for e in set["emotes"].as_array().cloned().unwrap_or_default() {
            let (Some(id), Some(name)) = (e["id"].as_u64(), s(&e["name"])) else { continue };
            out.push(json!({
                "name": name, "url": format!("https://files.kick.com/emotes/{id}/fullsize"), "group": group,
                "locked": e["subscribers_only"] == true, "code": format!("[emote:{id}:{name}]"),
            }));
        }
    }
    out
}

pub fn user_card(channel_slug: &str, user: &str) -> Result<Value, String> {
    let u = get_json(&format!("https://kick.com/api/v2/channels/{}/users/{}", enc(channel_slug), enc(user)))?;
    Ok(json!({
        "login": u["slug"], "display": u["username"], "avatar": avatar(s(&u["profile_pic"])), "following_since": u["following_since"],
        "subscribed_for": u["subscribed_for"], "badges": u["badges"],
    }))
}

// ---------------------------------------------------------------- account (kick.com website session)

/// (username, avatar) of the signed-in kick.com session.
pub fn me(session: &str) -> Result<(String, Option<String>), String> {
    let v = curl_req("GET", "https://kick.com/api/v1/user", Some(session), None)?;
    let name = s(&v["username"]).ok_or("Kick session expired")?;
    Ok((name, avatar(s(&v["profile_pic"]).or_else(|| s(&v["profilepic"])))))
}

/// Send a chat message as the signed-in kick.com user. `reply` = (message id, username, text).
pub fn send_message(session: &str, chatroom: u64, text: &str, reply: Option<(&str, &str, &str)>) -> Result<(), String> {
    let body = match reply {
        Some((id, name, orig)) => json!({
            "content": text, "type": "reply",
            "metadata": { "original_message": { "id": id, "content": orig }, "original_sender": { "username": name } },
        }),
        None => json!({ "content": text, "type": "message" }),
    };
    curl_req("POST", &format!("https://kick.com/api/v2/messages/send/{chatroom}"), Some(session), Some(&body)).map(|_| ())
}

// ---------------------------------------------------------------- follows (needs the kick.com website session)

/// Slugs of every channel the kick.com account follows.
pub fn followed(session: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut cursor = String::from("0");
    for _ in 0..500 {
        let v = curl_req("GET", &format!("https://kick.com/api/v2/channels/followed?cursor={cursor}"), Some(session), None)?;
        for c in v["channels"].as_array().cloned().unwrap_or_default() {
            if let Some(slug) = s(&c["channel_slug"]).or_else(|| s(&c["slug"])) {
                out.push(slug.to_lowercase());
            }
        }
        match v["nextCursor"].as_u64().map(|n| n.to_string()).or_else(|| s(&v["nextCursor"])) {
            Some(n) if n != cursor && n != "0" => cursor = n,
            _ => break,
        }
    }
    Ok(out)
}

pub fn set_follow(session: &str, slug: &str, on: bool) -> Result<(), String> {
    let url = format!("https://kick.com/api/v2/channels/{}/follow", enc(slug));
    let empty = json!({});
    curl_req(if on { "POST" } else { "DELETE" }, &url, Some(session), if on { Some(&empty) } else { None }).map(|_| ())
}

// ---------------------------------------------------------------- drops (needs the kick.com website session)

pub fn drop_campaigns() -> Result<Vec<Value>, String> {
    let v = get_json("https://web.kick.com/api/v1/drops/campaigns")?;
    Ok(v["data"].as_array().cloned().unwrap_or_default())
}

pub fn drop_progress(session: &str) -> Result<Vec<Value>, String> {
    let v = curl_req("GET", "https://web.kick.com/api/v1/drops/progress", Some(session), None)?;
    Ok(v["data"].as_array().cloned().unwrap_or_default())
}

pub fn claim_drop(session: &str, campaign: &str, reward: &str) -> Result<(), String> {
    curl_req("POST", "https://web.kick.com/api/v1/drops/claim", Some(session), Some(&json!({ "campaign_id": campaign, "reward_id": reward }))).map(|_| ())
}

/// Kick credits drop progress to viewers connected to its viewer websocket for a live channel.
/// Runs until `alive()` returns false.
pub fn watch_for_drops(session: &str, channel_id: u64, alive: impl Fn() -> bool) -> Result<(), String> {
    const CLIENT_TOKEN: &str = "e1393935a959b4020a4491574f6490129f678acdaa92760471263db43487f823";
    while alive() {
        let tok = {
            use std::os::windows::process::CommandExt;
            let out = std::process::Command::new("curl.exe")
                .args(["-s", "--compressed", "--max-time", "15", "-A", UA, "-H", "Accept: application/json", "-H", &format!("Authorization: Bearer {session}"),
                       "-H", &format!("X-CLIENT-TOKEN: {CLIENT_TOKEN}"), "https://websockets.kick.com/viewer/v1/token"])
                .creation_flags(0x0800_0000)
                .output()
                .map_err(|e| e.to_string())?;
            let v: Value = serde_json::from_slice(&out.stdout).map_err(|_| "Kick viewer token refused".to_string())?;
            s(&v["data"]["token"]).ok_or("Kick viewer token refused")?
        };
        let (mut ws, _) = tungstenite::connect(format!("wss://websockets.kick.com/viewer/v1/connect?token={tok}")).map_err(|e| e.to_string())?;
        if let tungstenite::stream::MaybeTlsStream::NativeTls(st) = ws.get_ref() {
            let _ = st.get_ref().set_read_timeout(Some(Duration::from_secs(1)));
        }
        let handshake = json!({ "type": "channel_handshake", "data": { "message": { "channelId": channel_id.to_string() } } }).to_string();
        ws.send(Message::Text(handshake.clone())).map_err(|e| e.to_string())?;
        let (mut last_ping, mut last_hs) = (std::time::Instant::now(), std::time::Instant::now());
        loop {
            if !alive() {
                return Ok(());
            }
            match ws.read() {
                Ok(_) => {}
                Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
                Err(_) => break, // reconnect with a fresh token
            }
            let msg = if last_hs.elapsed() > Duration::from_secs(120) {
                last_hs = std::time::Instant::now();
                Some(handshake.clone())
            } else if last_ping.elapsed() > Duration::from_secs(15) {
                last_ping = std::time::Instant::now();
                Some(json!({ "type": "ping" }).to_string())
            } else {
                None
            };
            if let Some(m) = msg {
                if ws.send(Message::Text(m)).is_err() {
                    break;
                }
            }
        }
        std::thread::sleep(Duration::from_secs(5));
    }
    Ok(())
}

// ---------------------------------------------------------------- chat (Pusher websocket)

/// Joins a Kick chatroom; messages go to `tx` until `alive()` is false (channel switched).
pub fn spawn_chat(channel_id: Option<u64>, chatroom: u64, tx: Sender<ChatMsg>, alive: impl Fn() -> bool + Send + 'static, with_history: bool) {
    std::thread::spawn(move || {
        for m in channel_id.filter(|_| with_history).map(history).unwrap_or_default() {
            if !alive() || tx.send(m).is_err() {
                return;
            }
        }
        let mut backoff = 1;
        let mut failures_without_join = 0;
        while alive() {
            let mut joined = false;
            // Fresh credentials each attempt; fall back to the legacy key if Kick's endpoint fails.
            let (key, cluster, mut chans) = match channel_id.map(realtime_credentials) {
                Some(Ok(c)) => c,
                Some(Err(e)) => {
                    let _ = tx.send(ChatMsg::system(format!("Couldn't get Kick chat credentials ({e}); trying the old server.")));
                    (LEGACY_KEY.0.to_string(), LEGACY_KEY.1.to_string(), Vec::new())
                }
                None => (LEGACY_KEY.0.to_string(), LEGACY_KEY.1.to_string(), Vec::new()),
            };
            // chat room + the channel's own event channels (kick.com subscribes to these; raids arrive there)
            let mut want = vec![format!("chatrooms.{chatroom}.v2")];
            if let Some(id) = channel_id {
                want.extend([format!("channel.{id}"), format!("channel_{id}")]);
            }
            for room in want {
                if !chans.contains(&room) {
                    chans.push(room);
                }
            }
            let url = format!("wss://ws-{cluster}.pusher.com/app/{key}?protocol=7&client=js&version=8.5.0&flash=false");
            match run_chat(&url, &chans, &tx, &mut joined, &alive) {
                Ok(()) => return,
                Err(e) => {
                    failures_without_join = if joined { 0 } else { failures_without_join + 1 };
                    if failures_without_join >= 3 {
                        let _ = tx.send(ChatMsg::system(format!(
                            "Kick chat isn't available right now (the chat server refused the connection: {e}). Video still works."
                        )));
                        return;
                    }
                    if joined && tx.send(ChatMsg::system("Chat disconnected, reconnecting…")).is_err() {
                        return;
                    }
                    for _ in 0..backoff {
                        if !alive() {
                            return;
                        }
                        std::thread::sleep(Duration::from_secs(1));
                    }
                    backoff = (backoff * 2).min(30);
                }
            }
        }
    });
}

/// A Kick chat message (live Pusher event or history entry) as a ChatMsg.
fn kick_msg(d: &Value) -> ChatMsg {
    let name = s(&d["sender"]["username"]).unwrap_or_else(|| "?".into());
    let badges = d["sender"]["identity"]["badges"].as_array().cloned().unwrap_or_default().iter().filter_map(|b| {
        let t = b["type"].as_str()?;
        Some(match b["count"].as_u64() {
            Some(n) if t == "subscriber" => format!("subscriber/{n}"),
            _ => t.to_string(),
        })
    }).collect();
    // live events carry metadata as an object, history as a JSON string; the sender sits in different places
    let meta = match &d["metadata"] {
        Value::String(t) => serde_json::from_str::<Value>(t).unwrap_or(Value::Null),
        v => v.clone(),
    };
    let reply = (d["type"] == "reply").then(|| Reply {
        name: s(&meta["original_sender"]["username"]).or_else(|| s(&meta["original_message"]["sender"]["username"])).unwrap_or_default(),
        text: s(&meta["original_message"]["content"]).unwrap_or_default(),
    });
    ChatMsg {
        id: s(&d["id"]).unwrap_or_default(),
        login: s(&d["sender"]["slug"]).unwrap_or_else(|| name.to_lowercase()),
        color: name_color(d["sender"]["identity"]["color"].as_str(), &name),
        name,
        spans: emote_spans(d["content"].as_str().unwrap_or("")),
        badges,
        reply,
        ..Default::default()
    }
}

/// The last messages before you joined (oldest first).
fn history(channel_id: u64) -> Vec<ChatMsg> {
    let Ok(v) = get_json(&format!("https://kick.com/api/v2/channels/{channel_id}/messages")) else { return Vec::new() };
    let mut out: Vec<ChatMsg> = v["data"]["messages"].as_array().map(|a| a.iter().map(kick_msg).collect()).unwrap_or_default();
    out.reverse(); // Kick lists newest first
    for m in out.iter_mut() {
        m.history = true;
    }
    out
}

/// Room modes from a ChatroomUpdatedEvent, as "Slow mode (5s)" style labels.
fn kick_modes(d: &Value) -> Vec<(&'static str, Option<String>)> {
    let on = |k: &str| d[k]["enabled"] == true;
    vec![
        ("slow", on("slow_mode").then(|| format!("Slow mode ({}s)", d["slow_mode"]["message_interval"].as_u64().unwrap_or(0)))),
        ("followers", on("followers_mode").then(|| match d["followers_mode"]["min_duration"].as_u64() {
            Some(m) if m > 0 => format!("Followers-only mode ({m} min following)"),
            _ => "Followers-only mode".to_string(),
        })),
        ("subs", on("subscribers_mode").then(|| "Subscribers-only mode".to_string())),
        ("emotes", on("emotes_mode").then(|| "Emote-only mode".to_string())),
    ]
}

fn run_chat(url: &str, channels: &[String], tx: &Sender<ChatMsg>, joined: &mut bool, alive: &dyn Fn() -> bool) -> Result<(), String> {
    let (mut ws, _) = tungstenite::connect(url).map_err(|e| e.to_string())?;
    // short read timeout so a quiet chat still notices the channel switch
    if let tungstenite::stream::MaybeTlsStream::NativeTls(s) = ws.get_ref() {
        let _ = s.get_ref().set_read_timeout(Some(Duration::from_secs(1)));
    }
    for ch in channels {
        let sub = json!({ "event": "pusher:subscribe", "data": { "auth": "", "channel": ch } });
        ws.send(Message::Text(sub.to_string())).map_err(|e| e.to_string())?;
    }
    let mut modes: std::collections::HashMap<&'static str, Option<String>> = Default::default();
    loop {
        if !alive() {
            return Ok(());
        }
        let msg = match ws.read() {
            Ok(m) => m,
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => continue,
            Err(e) => return Err(e.to_string()),
        };
        let Message::Text(t) = msg else { continue };
        let Ok(v) = serde_json::from_str::<Value>(t.as_str()) else { continue };
        let data = || v["data"].as_str().and_then(|d| serde_json::from_str::<Value>(d).ok()).unwrap_or(Value::Null);
        let out: Vec<ChatMsg> = match v["event"].as_str().unwrap_or("") {
            "pusher_internal:subscription_succeeded" => {
                if *joined {
                    continue;
                }
                *joined = true;
                vec![ChatMsg::system("Connected to Kick chat")]
            }
            "pusher:error" => return Err(v["data"]["message"].as_str().unwrap_or("pusher error").to_string()),
            "pusher:ping" => {
                ws.send(Message::Text(json!({"event":"pusher:pong","data":{}}).to_string()))
                    .map_err(|e| e.to_string())?;
                continue;
            }
            "App\\Events\\ChatMessageEvent" => vec![kick_msg(&data())],
            "App\\Events\\MessageDeletedEvent" => {
                let d = data();
                s(&d["message"]["id"]).map(|id| vec![ChatMsg::control("delete", id, "")]).unwrap_or_default()
            }
            "App\\Events\\UserBannedEvent" => {
                let d = data();
                let user = s(&d["user"]["username"]).unwrap_or_default();
                let slug = s(&d["user"]["slug"]).unwrap_or_else(|| user.to_lowercase());
                let what = match d["duration"].as_u64() {
                    Some(m) if d["permanent"] != true => format!("{user} was timed out for {m}m"),
                    _ => format!("{user} was banned"),
                };
                vec![ChatMsg::control("clear_user", slug, what)]
            }
            "App\\Events\\ChatroomClearEvent" => vec![ChatMsg::control("clear_all", "", "Chat was cleared by a moderator")],
            // the streamer you're watching raids ("hosts") another channel: viewers are sent along
            "App\\Events\\ChatMoveToSupportedChannelEvent" => {
                let d = data();
                let target = s(&d["hosted"]["slug"]).or_else(|| s(&d["slug"])).or_else(|| s(&d["hosted"]["username"]).map(|u| u.to_lowercase()));
                let name = s(&d["hosted"]["username"]).or_else(|| target.clone()).unwrap_or_default();
                match target {
                    Some(t) => vec![ChatMsg::control("raid", t, format!("Raiding {name}"))],
                    None => continue,
                }
            }
            // someone raided into this channel
            "App\\Events\\StreamHostEvent" => {
                let d = data();
                let who = s(&d["host_username"]).or_else(|| s(&d["host"]["username"])).unwrap_or_else(|| "Someone".into());
                let n = d["number_viewers"].as_u64().or(d["viewers_count"].as_u64()).unwrap_or(0);
                vec![ChatMsg::system(format!("★ {who} is raiding with {n} viewers"))]
            }
            "App\\Events\\ChatroomUpdatedEvent" => {
                let d = data();
                let first = modes.is_empty();
                let mut lines = Vec::new();
                for (k, now) in kick_modes(&d) {
                    let before = modes.insert(k, now.clone()).flatten();
                    match (now, before) {
                        (Some(n), b) if b.as_deref() != Some(n.as_str()) => lines.push(format!("{n} is on")),
                        (None, Some(b)) if !first => lines.push(format!("{b} is off")),
                        _ => {}
                    }
                }
                lines.into_iter().map(ChatMsg::system).collect()
            }
            _ => continue,
        };
        for m in out {
            if tx.send(m).is_err() {
                return Ok(());
            }
        }
    }
}

// Kick inlines emotes as `[emote:12345:Name]`.
fn emote_spans(text: &str) -> Vec<Span> {
    let mut spans = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("[emote:") {
        let Some(end) = rest[start..].find(']').map(|e| start + e) else { break };
        let inner = &rest[start + 7..end];
        let id = inner.split(':').next().unwrap_or("");
        if start > 0 {
            spans.push(Span::Text(rest[..start].to_string()));
        }
        if id.chars().all(|c| c.is_ascii_digit()) && !id.is_empty() {
            spans.push(Span::Emote(format!("https://files.kick.com/emotes/{id}/fullsize")));
        } else {
            spans.push(Span::Text(rest[start..=end].to_string()));
        }
        rest = &rest[end + 1..];
    }
    if !rest.is_empty() {
        spans.push(Span::Text(rest.to_string()));
    }
    spans
}
