use crate::common::*;
use serde_json::{json, Value};
use std::sync::mpsc::Sender;
use std::time::Duration;
use tungstenite::Message;

const CLIENT_ID: &str = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const GQL: &str = "https://gql.twitch.tv/gql";
const NODE: &str = "title viewersCount createdAt language freeformTags{name} previewImageURL(width:640,height:360) broadcaster{login displayName profileImageURL(width:70)} game{displayName}";
const TOKEN_HASH: &str = "0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712";

fn gql(body: Value) -> Result<Value, String> {
    let v: Value = http()
        .post(GQL)
        .set("Client-ID", CLIENT_ID)
        .send_json(body)
        .map_err(err_str)?
        .into_json()
        .map_err(|e| e.to_string())?;
    if v["data"].is_null() {
        return Err(format!("Twitch API error: {}", v.get("errors").unwrap_or(&v)));
    }
    Ok(v)
}

/// GQL call as the signed-in user (token issued to the TV client id).
fn gql_user(token: &str, body: Value) -> Result<Value, String> {
    let v: Value = http()
        .post(GQL)
        .set("Client-ID", crate::auth::TWITCH_CLIENT_ID)
        .set("Authorization", &format!("OAuth {token}"))
        .send_json(body)
        .map_err(err_str)?
        .into_json()
        .map_err(|e| e.to_string())?;
    if let Some(e) = v.get("errors") {
        return Err(format!("Twitch: {e}"));
    }
    Ok(v)
}

/// Follow or unfollow a channel on the signed-in Twitch account.
pub fn set_follow(token: &str, target_login: &str, follow: bool) -> Result<(), String> {
    let v = gql(json!({ "query": "query($l:String!){user(login:$l){id}}", "variables": { "l": target_login } }))?;
    let id = v["data"]["user"]["id"].as_str().ok_or("channel not found")?.to_string();
    let q = if follow {
        "mutation($id:ID!){followUser(input:{targetID:$id,disableNotifications:false}){follow{followedAt} error{code}}}"
    } else {
        "mutation($id:ID!){unfollowUser(input:{targetID:$id}){follow{followedAt}}}"
    };
    let r = gql_user(token, json!({ "query": q, "variables": { "id": id } }))?;
    if let Some(code) = r["data"]["followUser"]["error"]["code"].as_str() {
        return Err(format!("Twitch refused the follow: {code}"));
    }
    Ok(())
}

fn card(n: &Value) -> Option<StreamCard> {
    let b = &n["broadcaster"];
    let login = b["login"].as_str()?.to_string();
    Some(StreamCard {
        platform: Platform::Twitch,
        display: b["displayName"].as_str().unwrap_or(&login).to_string(),
        login,
        title: n["title"].as_str().unwrap_or("").to_string(),
        viewers: n["viewersCount"].as_u64().unwrap_or(0),
        thumb: n["previewImageURL"].as_str().map(String::from),
        category: n["game"]["displayName"].as_str().unwrap_or("").to_string(),
        avatar: b["profileImageURL"].as_str().map(String::from),
        started: n["createdAt"].as_str().map(String::from),
        tags: n["freeformTags"].as_array().map(|a| a.iter().filter_map(|t| t["name"].as_str().map(String::from)).collect()).unwrap_or_default(),
        language: n["language"].as_str().unwrap_or("").to_lowercase(),
    })
}

/// Browse page: live streams with filters. Returns (cards, next cursor).
pub fn browse(sort: &str, language: &str, tag: &str, drops: bool, after: Option<&str>) -> Result<(Vec<StreamCard>, Option<String>), String> {
    let mut opts = vec![format!("sort:{}", match sort { "viewers_asc" => "VIEWER_COUNT_ASC", "recent" => "RECENT", _ => "VIEWER_COUNT" })];
    if !language.is_empty() && language.chars().all(|c| c.is_ascii_alphabetic()) {
        opts.push(format!("languages:[{}]", language.to_uppercase()));
    }
    if drops {
        opts.push("systemFilters:[DROPS_ENABLED]".into());
    }
    let (decl, vars) = if tag.is_empty() {
        ("$a:Cursor", json!({ "a": after }))
    } else {
        opts.push("freeformTags:$t".into());
        ("$a:Cursor,$t:[String!]", json!({ "a": after, "t": [tag] }))
    };
    let q = format!("query({decl}){{streams(first:30,after:$a,options:{{{}}}){{edges{{cursor node{{{NODE}}}}} pageInfo{{hasNextPage}}}}}}", opts.join(","));
    let v = gql(json!({ "query": q, "variables": vars }))?;
    let edges = v["data"]["streams"]["edges"].as_array().cloned().unwrap_or_default();
    let next = if v["data"]["streams"]["pageInfo"]["hasNextPage"] == true { edges.last().and_then(|e| e["cursor"].as_str()).map(String::from) } else { None };
    Ok((edges.iter().filter_map(|e| card(&e["node"])).collect(), next))
}

/// Live streams whose title matches.
pub fn search_streams(q: &str) -> Result<Vec<StreamCard>, String> {
    let query = format!("query($q:String!){{searchStreams(userQuery:$q,first:30){{edges{{node{{{NODE}}}}}}}}}");
    let v = gql(json!({ "query": query, "variables": { "q": q } }))?;
    Ok(v["data"]["searchStreams"]["edges"].as_array().cloned().unwrap_or_default().iter().filter_map(|e| card(&e["node"])).collect())
}

/// Search results page: categories and past videos (channels come from `search`).
pub fn search_extra(q: &str) -> Result<(Vec<Value>, Vec<Value>), String> {
    let query = "query($q:String!){searchFor(userQuery:$q,platform:\"web\"){games{items{displayName viewersCount boxArtURL(width:285,height:380)}} videos{items{id title lengthSeconds viewCount publishedAt previewThumbnailURL(width:320,height:180) owner{login displayName} game{displayName}}}}}";
    let v = gql(json!({ "query": query, "variables": { "q": q } }))?;
    let s = &v["data"]["searchFor"];
    let games = s["games"]["items"].as_array().cloned().unwrap_or_default().iter()
        .map(|g| json!({ "name": g["displayName"], "art": g["boxArtURL"], "viewers": g["viewersCount"] })).collect();
    let videos = s["videos"]["items"].as_array().cloned().unwrap_or_default().iter().map(|n| json!({
        "platform": "Twitch", "id": n["id"], "title": n["title"], "seconds": n["lengthSeconds"], "views": n["viewCount"], "date": n["publishedAt"],
        "thumb": n["previewThumbnailURL"], "category": n["game"]["displayName"], "login": n["owner"]["login"], "display": n["owner"]["displayName"],
    })).collect();
    Ok((games, videos))
}

pub fn top_streams(category: &str) -> Result<Vec<StreamCard>, String> {
    let category = category.trim();
    let (v, edges) = if category.is_empty() {
        let v = gql(json!({ "query": format!("{{streams(first:30){{edges{{node{{{NODE}}}}}}}}}") }))?;
        (v, "/data/streams/edges")
    } else {
        let q = format!("query($g:String!){{game(name:$g){{streams(first:30){{edges{{node{{{NODE}}}}}}}}}}}");
        let v = gql(json!({ "query": q, "variables": { "g": category } }))?;
        if v["data"]["game"].is_null() {
            return Err(format!("No Twitch category named \"{category}\""));
        }
        (v, "/data/game/streams/edges")
    };
    match v.pointer(edges).and_then(Value::as_array) {
        Some(a) => Ok(a.iter().filter_map(|e| card(&e["node"])).collect()),
        None => Err(format!("Twitch API error: {}", v.get("errors").unwrap_or(&Value::Null))),
    }
}

/// Live status for many channels: one `users(logins:)` call per 100 channels (results keep input order).
pub fn live_status(logins: &[String]) -> Result<Vec<(String, Option<String>, Option<StreamCard>)>, String> {
    let mut out = Vec::new();
    let q = format!("query($l:[String!]){{users(logins:$l){{login profileImageURL(width:70) stream{{{NODE}}}}}}}");
    for chunk in logins.chunks(100) {
        let v = gql(json!({ "query": q, "variables": { "l": chunk } }))?;
        let users = v["data"]["users"].as_array().cloned().unwrap_or_default();
        for (i, l) in chunk.iter().enumerate() {
            let u = users.get(i).cloned().unwrap_or(Value::Null);
            out.push((l.clone(), u["profileImageURL"].as_str().map(String::from), card(&u["stream"])));
        }
    }
    Ok(out)
}

/// Channel search for the search-box suggestions: (login, display, avatar, live (viewers, category)).
pub fn search(q: &str) -> Result<Vec<(String, String, Option<String>, Option<(u64, String)>)>, String> {
    let query = "query($q:String!){searchFor(userQuery:$q,platform:\"web\"){channels{items{login displayName profileImageURL(width:50) stream{viewersCount game{displayName}}}}}}";
    let v = gql(json!({ "query": query, "variables": { "q": q } }))?;
    let items = v["data"]["searchFor"]["channels"]["items"].as_array().cloned().unwrap_or_default();
    Ok(items
        .iter()
        .filter_map(|u| {
            let login = u["login"].as_str()?.to_string();
            let s = &u["stream"];
            let live = (!s.is_null()).then(|| (s["viewersCount"].as_u64().unwrap_or(0), s["game"]["displayName"].as_str().unwrap_or("").to_string()));
            Some((login.clone(), u["displayName"].as_str().unwrap_or(&login).to_string(), u["profileImageURL"].as_str().map(String::from), live))
        })
        .collect())
}

pub fn resolve(login: &str) -> Result<Resolved, String> {
    let q = "query($l:String!){user(login:$l){login displayName profileImageURL(width:70) stream{title viewersCount createdAt game{displayName}}}}";
    let v = gql(json!({ "query": q, "variables": { "l": login } }))?;
    let u = &v["data"]["user"];
    if u.is_null() {
        return Err(format!("Twitch channel \"{login}\" not found"));
    }
    let s = &u["stream"];
    let mut r = Resolved {
        display: u["displayName"].as_str().unwrap_or(login).to_string(),
        title: s["title"].as_str().unwrap_or("").to_string(),
        category: s["game"]["displayName"].as_str().unwrap_or("").to_string(),
        viewers: s["viewersCount"].as_u64().unwrap_or(0),
        live: !s.is_null(),
        avatar: u["profileImageURL"].as_str().map(String::from),
        started: s["createdAt"].as_str().map(String::from),
        ..Default::default()
    };
    if !r.live {
        return Ok(r);
    }

    match master(login, "site")? {
        Some(v) => r.variants = v,
        None => r.live = false,
    }
    Ok(r)
}

/// Fetch a playback token for `player_type` and return the quality variants (None = offline).
pub fn master(login: &str, player_type: &str) -> Result<Option<Vec<Variant>>, String> {
    let tok = gql(json!({
        "operationName": "PlaybackAccessToken",
        "extensions": { "persistedQuery": { "version": 1, "sha256Hash": TOKEN_HASH } },
        "variables": { "isLive": true, "login": login, "isVod": false, "vodID": "", "playerType": player_type }
    }))
    .ok()
    .filter(|v| !v["data"]["streamPlaybackAccessToken"].is_null())
    .map(Ok)
    .unwrap_or_else(|| {
        gql(json!({
            "query": "query($l:String!,$p:String!){streamPlaybackAccessToken(channelName:$l,params:{platform:\"web\",playerBackend:\"mediaplayer\",playerType:$p}){value signature}}",
            "variables": { "l": login, "p": player_type }
        }))
    })?;
    let t = &tok["data"]["streamPlaybackAccessToken"];
    let (value, sig) = (t["value"].as_str().unwrap_or(""), t["signature"].as_str().unwrap_or(""));
    if value.is_empty() {
        return Err("Twitch refused a playback token".into());
    }
    let p: u32 = (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos()) % 9_999_999;
    let url = format!(
        "https://usher.ttvnw.net/api/channel/hls/{login}.m3u8?allow_source=true&allow_audio_only=true&fast_bread=true&playlist_include_framerate=true&player=twitchweb&p={p}&sig={sig}&token={}",
        enc(value)
    );
    match http().get(&url).call() {
        Ok(resp) => Ok(Some(parse_master(&resp.into_string().map_err(|e| e.to_string())?, &url))),
        Err(ureq::Error::Status(404, _)) => Ok(None),
        Err(e) => Err(err_str(e)),
    }
}

// ---------------------------------------------------------------- channel pages

/// Bio, follower count, social links and panels.
pub fn about(login: &str) -> Result<Value, String> {
    let q = "query($l:String!){user(login:$l){description createdAt followers{totalCount} channel{socialMedias{name title url}} panels{id type ... on DefaultPanel{title description imageURL linkURL}}}}";
    let v = gql(json!({ "query": q, "variables": { "l": login } }))?;
    let u = &v["data"]["user"];
    if u.is_null() {
        return Err("channel not found".into());
    }
    let socials: Vec<Value> = u["channel"]["socialMedias"].as_array().cloned().unwrap_or_default().iter()
        .map(|s| json!({ "name": s["name"], "title": s["title"], "url": s["url"] })).collect();
    let panels: Vec<Value> = u["panels"].as_array().cloned().unwrap_or_default().iter()
        .filter(|p| p["type"] == "DEFAULT")
        .map(|p| json!({ "title": p["title"], "text": p["description"], "image": p["imageURL"], "link": p["linkURL"] })).collect();
    Ok(json!({ "bio": u["description"], "followers": u["followers"]["totalCount"], "created": u["createdAt"], "socials": socials, "panels": panels }))
}

pub fn videos(login: &str) -> Result<Vec<Value>, String> {
    let q = "query($l:String!){user(login:$l){videos(first:30,sort:TIME){edges{node{id title lengthSeconds viewCount publishedAt previewThumbnailURL(width:320,height:180) game{displayName}}}}}}";
    let v = gql(json!({ "query": q, "variables": { "l": login } }))?;
    Ok(v["data"]["user"]["videos"]["edges"].as_array().cloned().unwrap_or_default().iter().map(|e| {
        let n = &e["node"];
        json!({ "id": n["id"], "title": n["title"], "seconds": n["lengthSeconds"], "views": n["viewCount"], "date": n["publishedAt"],
                "thumb": n["previewThumbnailURL"], "category": n["game"]["displayName"] })
    }).collect())
}

pub fn clips(login: &str) -> Result<Vec<Value>, String> {
    let q = "query($l:String!){user(login:$l){clips(first:30,criteria:{period:LAST_MONTH,sort:VIEWS_DESC}){edges{node{slug title viewCount createdAt thumbnailURL durationSeconds}}}}}";
    let v = gql(json!({ "query": q, "variables": { "l": login } }))?;
    Ok(v["data"]["user"]["clips"]["edges"].as_array().cloned().unwrap_or_default().iter().map(|e| {
        let n = &e["node"];
        json!({ "id": n["slug"], "title": n["title"], "seconds": n["durationSeconds"], "views": n["viewCount"], "date": n["createdAt"], "thumb": n["thumbnailURL"] })
    }).collect())
}

/// Quality variants of a past broadcast (raw usher URLs; the caller proxies them for CORS).
pub fn vod_variants(id: &str) -> Result<Vec<Variant>, String> {
    let v = gql(json!({
        "query": "query($id:ID!){videoPlaybackAccessToken(id:$id,params:{platform:\"web\",playerBackend:\"mediaplayer\",playerType:\"site\"}){value signature}}",
        "variables": { "id": id }
    }))?;
    let t = &v["data"]["videoPlaybackAccessToken"];
    let (value, sig) = (t["value"].as_str().ok_or("This video isn't available")?, t["signature"].as_str().unwrap_or(""));
    let url = format!("https://usher.ttvnw.net/vod/{id}.m3u8?allow_source=true&allow_audio_only=true&playlist_include_framerate=true&sig={sig}&token={}", enc(value));
    match http().get(&url).call() {
        Ok(r) => Ok(parse_master(&r.into_string().map_err(|e| e.to_string())?, &url)),
        Err(ureq::Error::Status(403, _)) => Err("This video is for subscribers only".into()),
        Err(e) => Err(err_str(e)),
    }
}

/// Direct MP4 URL of a clip (best quality).
pub fn clip_url(slug: &str) -> Result<String, String> {
    let q = "query($s:ID!){clip(slug:$s){playbackAccessToken(params:{platform:\"web\",playerBackend:\"mediaplayer\",playerType:\"site\"}){value signature} videoQualities{quality sourceURL}}}";
    let v = gql(json!({ "query": q, "variables": { "s": slug } }))?;
    let c = &v["data"]["clip"];
    let best = c["videoQualities"].as_array().and_then(|a| a.first()).and_then(|q| q["sourceURL"].as_str()).ok_or("clip not found")?;
    let t = &c["playbackAccessToken"];
    Ok(format!("{best}?sig={}&token={}", t["signature"].as_str().unwrap_or(""), enc(t["value"].as_str().unwrap_or(""))))
}

pub fn top_games() -> Result<Vec<Value>, String> {
    let v = gql(json!({ "query": "{games(first:30){edges{node{name displayName viewersCount boxArtURL(width:285,height:380)}}}}" }))?;
    Ok(v["data"]["games"]["edges"].as_array().cloned().unwrap_or_default().iter().map(|e| {
        let n = &e["node"];
        json!({ "name": n["displayName"], "viewers": n["viewersCount"], "art": n["boxArtURL"] })
    }).collect())
}

/// "set/version" -> image URL for global badges plus the channel's own (sub/bits) badges.
pub fn badges(login: &str) -> Result<std::collections::HashMap<String, String>, String> {
    let q = "query($l:String!){badges{setID version imageURL(size:DOUBLE)} user(login:$l){broadcastBadges{setID version imageURL(size:DOUBLE)}}}";
    let v = gql(json!({ "query": q, "variables": { "l": login } }))?;
    let mut m = std::collections::HashMap::new();
    let mut add = |a: &Value| {
        for b in a.as_array().cloned().unwrap_or_default() {
            if let (Some(s), Some(ver), Some(u)) = (b["setID"].as_str(), b["version"].as_str(), b["imageURL"].as_str()) {
                m.insert(format!("{s}/{ver}"), u.to_string());
            }
        }
    };
    add(&v["data"]["badges"]);
    add(&v["data"]["user"]["broadcastBadges"]); // channel badges override globals
    Ok(m)
}

/// Emote picker: the channel's sub emotes plus (signed in) every emote the user can use.
pub fn emotes(login: &str, token: Option<&str>) -> Vec<Value> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut push = |id: &str, name: &str, group: &str, locked: bool, out: &mut Vec<Value>| {
        if seen.insert(id.to_string()) {
            out.push(json!({ "name": name, "url": format!("https://static-cdn.jtvnw.net/emoticons/v2/{id}/default/dark/2.0"), "group": group, "locked": locked }));
        }
    };
    let mut mine = std::collections::HashSet::new();
    if let Some(t) = token {
        if let Ok(v) = gql_user(t, json!({ "query": "{currentUser{emoteSets{owner{displayName} emotes{id token}}}}" })) {
            for set in v["data"]["currentUser"]["emoteSets"].as_array().cloned().unwrap_or_default() {
                let group = set["owner"]["displayName"].as_str().unwrap_or("Twitch").to_string();
                for e in set["emotes"].as_array().cloned().unwrap_or_default() {
                    if let (Some(id), Some(name)) = (e["id"].as_str(), e["token"].as_str()) {
                        mine.insert(id.to_string());
                        push(id, name, &group, false, &mut out);
                    }
                }
            }
        }
    }
    let q = "query($l:String!){user(login:$l){displayName subscriptionProducts{emotes{id token}}}}";
    if let Ok(v) = gql(json!({ "query": q, "variables": { "l": login } })) {
        let group = v["data"]["user"]["displayName"].as_str().unwrap_or(login).to_string();
        for p in v["data"]["user"]["subscriptionProducts"].as_array().cloned().unwrap_or_default() {
            for e in p["emotes"].as_array().cloned().unwrap_or_default() {
                if let (Some(id), Some(name)) = (e["id"].as_str(), e["token"].as_str()) {
                    let locked = !mine.contains(id);
                    push(id, name, &group, locked, &mut out);
                }
            }
        }
    }
    // channel emotes first
    out.sort_by_key(|e| e["group"].as_str() == Some("Twitch"));
    out
}

pub fn user_card(login: &str) -> Result<Value, String> {
    let q = "query($l:String!){user(login:$l){login displayName description createdAt profileImageURL(width:150) followers{totalCount} stream{viewersCount}}}";
    let v = gql(json!({ "query": q, "variables": { "l": login } }))?;
    let u = &v["data"]["user"];
    if u.is_null() {
        return Err("user not found".into());
    }
    Ok(json!({ "login": u["login"], "display": u["displayName"], "avatar": u["profileImageURL"], "bio": u["description"],
               "created": u["createdAt"], "followers": u["followers"]["totalCount"], "live": !u["stream"].is_null() }))
}

// ---------------------------------------------------------------- channel points

pub fn points(token: &str, login: &str) -> Result<Value, String> {
    let q = "query($l:String!){channel(name:$l){id self{communityPoints{balance availableClaim{id}}} communityPointsSettings{name isEnabled image{url} customRewards{id title cost prompt isEnabled isPaused isInStock isUserInputRequired backgroundColor image{url} defaultImage{url}}}}}";
    let v = gql_user(token, json!({ "query": q, "variables": { "l": login } }))?;
    let c = &v["data"]["channel"];
    let s = &c["communityPointsSettings"];
    let rewards: Vec<Value> = s["customRewards"].as_array().cloned().unwrap_or_default().into_iter()
        .filter(|r| r["isEnabled"] == true)
        .map(|r| json!({
            "id": r["id"], "title": r["title"], "cost": r["cost"], "prompt": r["prompt"], "input": r["isUserInputRequired"],
            "available": r["isPaused"] != true && r["isInStock"] != false, "color": r["backgroundColor"],
            "image": r["image"]["url"].as_str().or(r["defaultImage"]["url"].as_str()),
        }))
        .collect();
    Ok(json!({
        "channel_id": c["id"], "balance": c["self"]["communityPoints"]["balance"], "claim": c["self"]["communityPoints"]["availableClaim"]["id"],
        "name": s["name"].as_str().unwrap_or("Channel Points"), "icon": s["image"]["url"], "enabled": s["isEnabled"] != false, "rewards": rewards,
    }))
}

pub fn claim_points(token: &str, channel_id: &str, claim_id: &str) -> Result<(), String> {
    let q = "mutation($i:ClaimCommunityPointsInput!){claimCommunityPoints(input:$i){claim{id} error{code}}}";
    let v = gql_user(token, json!({ "query": q, "variables": { "i": { "channelID": channel_id, "claimID": claim_id } } }))?;
    match v["data"]["claimCommunityPoints"]["error"]["code"].as_str() {
        Some(c) => Err(c.to_string()),
        None => Ok(()),
    }
}

pub fn redeem(token: &str, channel_id: &str, reward: &Value, text: Option<&str>) -> Result<(), String> {
    let q = "mutation($i:RedeemCommunityPointsCustomRewardInput!){redeemCommunityPointsCustomReward(input:$i){error{code} redemption{id}}}";
    let tx: String = (0..16).map(|_| format!("{:x}", rand::random::<u8>() % 16)).collect();
    let mut input = json!({
        "channelID": channel_id, "cost": reward["cost"], "prompt": reward["prompt"], "rewardID": reward["id"],
        "title": reward["title"], "transactionID": tx,
    });
    if let Some(t) = text {
        input["textInput"] = json!(t);
    }
    let v = gql_user(token, json!({ "query": q, "variables": { "i": input } }))?;
    match v["data"]["redeemCommunityPointsCustomReward"]["error"]["code"].as_str() {
        Some(c) => Err(c.replace('_', " ").to_lowercase()),
        None => Ok(()),
    }
}

/// Tell Twitch the signed-in user is watching `login` (needed for points and drops): fetch an
/// authenticated playlist and touch its newest segment, like the official player does.
pub fn watch_tick(token: &str, client_id: &str, login: &str) -> Result<(), String> {
    let v: Value = http()
        .post(GQL)
        .set("Client-ID", client_id)
        .set("Authorization", &format!("OAuth {token}"))
        .send_json(json!({
            "query": "query($l:String!){streamPlaybackAccessToken(channelName:$l,params:{platform:\"web\",playerBackend:\"mediaplayer\",playerType:\"site\"}){value signature}}",
            "variables": { "l": login }
        }))
        .map_err(err_str)?
        .into_json()
        .map_err(|e| e.to_string())?;
    let t = &v["data"]["streamPlaybackAccessToken"];
    let (value, sig) = (t["value"].as_str().ok_or("no token")?, t["signature"].as_str().unwrap_or(""));
    let url = format!("https://usher.ttvnw.net/api/channel/hls/{login}.m3u8?allow_source=true&sig={sig}&token={}", enc(value));
    let master = http().get(&url).call().map_err(err_str)?.into_string().map_err(|e| e.to_string())?;
    let variant = master.lines().filter(|l| l.starts_with("http")).last().ok_or("offline")?.to_string();
    let list = http().get(&variant).set("Connection", "close").call().map_err(err_str)?.into_string().map_err(|e| e.to_string())?;
    if let Some(seg) = list.lines().filter(|l| l.starts_with("http")).last() {
        http().head(seg).call().map_err(err_str)?;
    }
    Ok(())
}

// ---------------------------------------------------------------- drops (needs the twitch.tv website session)

/// Client ids to try with a website token (Twitch only shows drops to first-party clients).
/// The web client works once integrity headers were captured from twitch.tv.
pub const DROPS_CLIENTS: [&str; 2] = [CLIENT_ID, "kd1unb4b3q4t58fwlpcbzcbnm76a8fp"];

pub fn persisted(client: &str, token: &str, op: &str, hash: &str, vars: Value) -> Result<Value, String> {
    // With integrity headers captured from twitch.tv, impersonate that exact web session.
    let integ = crate::adblock::INTEGRITY.lock().unwrap().clone().filter(|_| client == CLIENT_ID);
    let ua = match &integ {
        Some(i) => i["ua"].as_str().unwrap_or(UA).to_string(),
        None if client == DROPS_CLIENTS[0] => "Dalvik/2.1.0 (Linux; U; Android 16; SM-S911B Build/BP2A.250605.031) tv.twitch.android.app/31.8.0/3108006".into(),
        None => UA.into(),
    };
    let mut req = http()
        .post(GQL)
        .set("Client-ID", client)
        .set("User-Agent", &ua)
        .set("Origin", "https://www.twitch.tv")
        .set("Referer", "https://www.twitch.tv/")
        .set("Authorization", &format!("OAuth {token}"));
    if let Some(i) = &integ {
        for (h, k) in [("Client-Integrity", "integrity"), ("X-Device-Id", "device"), ("Client-Session-Id", "session")] {
            if let Some(v) = i[k].as_str() {
                req = req.set(h, v);
            }
        }
    }
    let v: Value = req
        .send_json(json!({ "operationName": op, "variables": vars, "extensions": { "persistedQuery": { "version": 1, "sha256Hash": hash } } }))
        .map_err(err_str)?
        .into_json()
        .map_err(|e| e.to_string())?;
    if let Some(e) = v.get("errors") {
        return Err(format!("Twitch: {e}"));
    }
    Ok(v)
}

/// Active campaigns merged with the user's progress. Returns (client id that worked, campaigns).
pub fn drops(token: &str, preferred: Option<&str>) -> Result<(String, Vec<Value>), String> {
    let mut clients: Vec<&str> = preferred.into_iter().collect();
    clients.extend(DROPS_CLIENTS.iter().filter(|c| Some(**c) != preferred));
    let mut why = Vec::new();
    for client in clients {
        let dash = match persisted(client, token, "ViewerDropsDashboard", "c16bb890cc8ce7647a96ee69cd313d423a378a3dedadf630a1017cde18975feb", json!({ "fetchRewardCampaigns": false })) {
            Ok(v) => v,
            Err(e) => { why.push(format!("{}: {}", &client[..6], e.chars().take(160).collect::<String>())); continue; }
        };
        let Some(list) = dash["data"]["currentUser"]["dropCampaigns"].as_array().cloned() else {
            why.push(format!("{}: no campaigns returned (user {})", &client[..6], if dash["data"]["currentUser"].is_null() { "not recognised" } else { "ok" }));
            continue;
        };
        let inv = persisted(client, token, "Inventory", "8337eb8541b314040b0edde0c09c5c7a2783ba1960aa9edfbf3bac16d0fec404", json!({ "fetchRewardCampaigns": false })).unwrap_or(Value::Null);
        let progress: Vec<Value> = inv["data"]["currentUser"]["inventory"]["dropCampaignsInProgress"].as_array().cloned().unwrap_or_default();
        let out = list.iter().filter(|c| c["status"] == "ACTIVE").map(|c| {
            let p = progress.iter().find(|p| p["id"] == c["id"]);
            let drops: Vec<Value> = p.and_then(|p| p["timeBasedDrops"].as_array().cloned()).unwrap_or_default().iter().map(|d| json!({
                "id": d["id"], "name": d["benefitEdges"][0]["benefit"]["name"].as_str().or(d["name"].as_str()),
                "image": d["benefitEdges"][0]["benefit"]["imageAssetURL"], "required": d["requiredMinutesWatched"],
                "progress": d["self"]["currentMinutesWatched"], "claimed": d["self"]["isClaimed"], "instance": d["self"]["dropInstanceID"],
            })).collect();
            json!({
                "id": c["id"], "name": c["name"], "game": c["game"]["displayName"], "art": c["game"]["boxArtURL"], "ends": c["endAt"],
                "connected": c["self"]["isAccountConnected"], "link": c["accountLinkURL"], "drops": drops,
            })
        }).collect();
        return Ok((client.to_string(), out));
    }
    Err(format!("Twitch didn't return drops ({})", why.join("; ")))
}

pub fn claim_drop(client: &str, token: &str, instance: &str) -> Result<(), String> {
    let v = persisted(client, token, "DropsPage_ClaimDropRewards", "a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930", json!({ "input": { "dropInstanceID": instance } }))?;
    match v["data"]["claimDropRewards"]["status"].as_str() {
        Some("ELIGIBLE_FOR_ALL") | Some("DROP_INSTANCE_ALREADY_CLAIMED") | None => Ok(()),
        Some(s) => Err(s.to_string()),
    }
}

// ---------------------------------------------------------------- chat (anonymous IRC over websocket)

/// Outgoing chat line: (reply-to message id, text).
pub type Outgoing = (Option<String>, String);

/// Connects to chat. With `auth` = (login, token) you can send messages through the returned sender.
pub fn spawn_chat(login: String, auth: Option<(String, String)>, tx: Sender<ChatMsg>) -> Sender<Outgoing> {
    let (out_tx, out_rx) = std::sync::mpsc::channel::<Outgoing>();
    std::thread::spawn(move || {
        let mut backoff = 1;
        loop {
            match run_chat(&login, auth.as_ref(), &out_rx, &tx) {
                Ok(()) => return, // receiver gone: channel switched
                Err(e) => {
                    if tx.send(ChatMsg::system(format!("Chat disconnected ({e}), reconnecting…"))).is_err() {
                        return;
                    }
                    std::thread::sleep(Duration::from_secs(backoff));
                    backoff = (backoff * 2).min(30);
                }
            }
        }
    });
    out_tx
}

fn run_chat(
    login: &str,
    auth: Option<&(String, String)>,
    outgoing: &std::sync::mpsc::Receiver<Outgoing>,
    tx: &Sender<ChatMsg>,
) -> Result<(), String> {
    let (mut ws, _) = tungstenite::connect("wss://irc-ws.chat.twitch.tv:443").map_err(|e| e.to_string())?;
    if let tungstenite::stream::MaybeTlsStream::NativeTls(s) = ws.get_ref() {
        let _ = s.get_ref().set_read_timeout(Some(Duration::from_millis(150)));
    }
    let (pass, nick) = match auth {
        Some((user, token)) => (format!("PASS oauth:{token}"), format!("NICK {user}")),
        None => ("PASS SCHMOOPIIE".to_string(), "NICK justinfan58213".to_string()),
    };
    for l in ["CAP REQ :twitch.tv/tags twitch.tv/commands".to_string(), pass, nick, format!("JOIN #{login}")] {
        ws.send(Message::Text(l.into())).map_err(|e| e.to_string())?;
    }
    let who = auth.map(|a| format!(" as {}", a.0)).unwrap_or_else(|| " (read-only, sign in to chat)".into());
    if tx.send(ChatMsg::system(format!("Connected to #{login}{who}"))).is_err() {
        return Ok(());
    }
    loop {
        while let Ok((reply_to, text)) = outgoing.try_recv() {
            if let Some((user, _)) = auth {
                let tag = reply_to.as_deref().map(|id| format!("@reply-parent-msg-id={id} ")).unwrap_or_default();
                ws.send(Message::Text(format!("{tag}PRIVMSG #{login} :{text}").into())).map_err(|e| e.to_string())?;
                let own = ChatMsg { login: user.clone(), name: user.clone(), color: "#53fc18".to_string(), spans: vec![Span::Text(text)], ..Default::default() };
                if tx.send(own).is_err() {
                    return Ok(());
                }
            }
        }
        let msg = match ws.read() {
            Ok(m) => m,
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => continue,
            Err(e) => return Err(e.to_string()),
        };
        let Message::Text(t) = msg else { continue };
        let mut any = false;
        for line in t.as_str().split("\r\n").filter(|l| !l.is_empty()) {
            if line.starts_with("PING") {
                ws.send(Message::Text(line.replacen("PING", "PONG", 1).into())).map_err(|e| e.to_string())?;
            } else if let Some(m) = parse_irc(line) {
                if tx.send(m).is_err() {
                    return Ok(());
                }
                any = true;
            }
        }
        if any {
        }
    }
}

fn unescape(v: &str) -> String {
    v.replace("\\s", " ").replace("\\:", ";").replace("\\\\", "\\")
}

fn parse_irc(line: &str) -> Option<ChatMsg> {
    let (tags, rest) = match line.strip_prefix('@') {
        Some(l) => l.split_once(' ')?,
        None => ("", line),
    };
    let tag = |k: &str| tags.split(';').find_map(|kv| kv.strip_prefix(k).and_then(|v| v.strip_prefix('=')));
    let rest = rest.strip_prefix(':')?;
    let (prefix, rest) = rest.split_once(' ')?;
    let (cmd, rest) = rest.split_once(' ').unwrap_or((rest, ""));
    match cmd {
        "PRIVMSG" => {
            let (_, mut text) = rest.split_once(" :")?;
            if let Some(a) = text.strip_prefix("\u{1}ACTION ") {
                text = a.trim_end_matches('\u{1}');
            }
            let nick = prefix.split('!').next().unwrap_or(prefix);
            let name = tag("display-name").filter(|s| !s.is_empty()).map(unescape).unwrap_or_else(|| nick.to_string());
            let reply = tag("reply-parent-display-name").filter(|s| !s.is_empty()).map(|n| Reply {
                name: unescape(n),
                text: unescape(tag("reply-parent-msg-body").unwrap_or("")),
            });
            // Replies start with "@parent " in the text; emote positions still count those characters.
            Some(ChatMsg {
                id: tag("id").unwrap_or("").to_string(),
                login: nick.to_string(),
                color: name_color(tag("color"), &name),
                name,
                spans: emote_spans(text, tag("emotes").unwrap_or("")),
                system: false,
                badges: tag("badges").unwrap_or("").split(',').filter(|b| !b.is_empty()).map(String::from).collect(),
                reply,
            })
        }
        "NOTICE" => {
            let (_, text) = rest.split_once(" :")?;
            Some(ChatMsg::system(text.to_string()))
        }
        "USERNOTICE" => {
            let sys = unescape(tag("system-msg")?);
            let extra = rest.split_once(" :").map(|(_, t)| format!(" — {t}")).unwrap_or_default();
            Some(ChatMsg::system(format!("★ {sys}{extra}")))
        }
        _ => None,
    }
}

fn emote_spans(text: &str, emotes: &str) -> Vec<Span> {
    let mut ranges: Vec<(usize, usize, &str)> = Vec::new();
    for e in emotes.split('/').filter(|s| !s.is_empty()) {
        let Some((id, pos)) = e.split_once(':') else { continue };
        for p in pos.split(',') {
            if let Some((a, b)) = p.split_once('-') {
                if let (Ok(a), Ok(b)) = (a.parse(), b.parse()) {
                    ranges.push((a, b, id));
                }
            }
        }
    }
    if ranges.is_empty() {
        return vec![Span::Text(text.to_string())];
    }
    ranges.sort_by_key(|r| r.0);
    let chars: Vec<char> = text.chars().collect();
    let mut spans = Vec::new();
    let mut i = 0;
    for (a, b, id) in ranges {
        if a < i || b >= chars.len() {
            continue;
        }
        if a > i {
            spans.push(Span::Text(chars[i..a].iter().collect()));
        }
        spans.push(Span::Emote(format!("https://static-cdn.jtvnw.net/emoticons/v2/{id}/default/dark/1.0")));
        i = b + 1;
    }
    if i < chars.len() {
        spans.push(Span::Text(chars[i..].iter().collect()));
    }
    spans
}
