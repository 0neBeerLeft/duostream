#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod adblock;
mod auth;
mod common;
mod kick;
mod store;
mod twitch;

use common::*;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard, OnceLock};
use tauri::{AppHandle, Emitter};

// ------------------------------------------------------------------ shared state

static CFG: OnceLock<Mutex<store::Config>> = OnceLock::new();
static CHAT_GEN: AtomicU64 = AtomicU64::new(0);
static CHAT_OUT: Mutex<Option<mpsc::Sender<twitch::Outgoing>>> = Mutex::new(None);
static CHAT_KICK_ROOM: Mutex<Option<u64>> = Mutex::new(None);
/// Channel whose chat is open (shared with the pop-out chat window).
static CHAT_CTX: Mutex<Option<serde_json::Value>> = Mutex::new(None);
static LOGIN_CANCEL: OnceLock<Mutex<Arc<AtomicBool>>> = OnceLock::new();

fn cfg() -> MutexGuard<'static, store::Config> {
    CFG.get_or_init(|| Mutex::new(store::load())).lock().unwrap_or_else(|e| e.into_inner())
}

fn save() {
    let c = cfg();
    store::save(&c);
}

fn new_cancel() -> Arc<AtomicBool> {
    let m = LOGIN_CANCEL.get_or_init(|| Mutex::new(Arc::new(AtomicBool::new(false))));
    let mut g = m.lock().unwrap();
    g.store(true, Ordering::Relaxed); // cancel any previous attempt
    *g = Arc::new(AtomicBool::new(false));
    g.clone()
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    tauri::async_runtime::spawn_blocking(f).await.expect("worker thread panicked")
}

fn akey(p: Platform, login: &str) -> String {
    format!("{}:{}", if p == Platform::Twitch { "t" } else { "k" }, login)
}

// ------------------------------------------------------------------ state

#[derive(Serialize)]
struct Account {
    name: String,
    avatar: Option<String>,
}

#[derive(Serialize)]
struct AppState {
    twitch: Option<Account>,
    kick: Option<Account>,
    follows: Vec<store::Follow>,
    avatars: HashMap<String, String>,
    volume: f32,
    adblock: bool,
    low_latency: bool,
    sidebar_collapsed: bool,
    show_chat: bool,
    ads_blocked: u64,
    notify_live: bool,
    close_to_tray: bool,
    plugin_sources: Vec<String>,
    auto_claim: bool,
    twitch_drops: bool,
    kick_drops: bool,
    followed_categories: Vec<serde_json::Value>,
    hidden_channels: Vec<String>,
    hidden_categories: Vec<String>,
    notify_muted: Vec<String>,
    autostart: bool,
}

fn snapshot() -> AppState {
    let c = cfg();
    AppState {
        twitch: c.twitch.as_ref().map(|a| Account { name: a.login.clone(), avatar: a.avatar.clone() }),
        kick: c.kick.as_ref().map(|a| Account { name: a.username.clone(), avatar: a.avatar.clone() }),
        follows: c.follows.clone(),
        avatars: c.avatars.clone(),
        volume: c.volume,
        adblock: c.adblock,
        low_latency: c.low_latency,
        sidebar_collapsed: c.sidebar_collapsed,
        show_chat: c.show_chat,
        ads_blocked: adblock::ADS_BLOCKED.load(Ordering::Relaxed),
        notify_live: c.notify_live,
        close_to_tray: c.close_to_tray,
        plugin_sources: c.plugin_sources.clone(),
        auto_claim: c.auto_claim,
        twitch_drops: !c.twitch_web_token.is_empty(),
        kick_drops: !c.kick_web_token.is_empty(),
        followed_categories: c.followed_categories.clone(),
        hidden_channels: c.hidden_channels.clone(),
        hidden_categories: c.hidden_categories.clone(),
        notify_muted: c.notify_muted.clone(),
        autostart: c.autostart,
    }
}

/// Go-live notifications on/off for one followed channel.
#[tauri::command]
fn set_notify(platform: Platform, login: String, on: bool) -> AppState {
    {
        let mut c = cfg();
        let key = akey(platform, &login.to_lowercase());
        c.notify_muted.retain(|k| *k != key);
        if !on {
            c.notify_muted.push(key);
        }
    }
    save();
    snapshot()
}

/// Start with Windows: a Run entry that launches duostream hidden in the tray.
#[tauri::command]
fn set_autostart(on: bool) -> Result<AppState, String> {
    autostart_registry(on)?;
    cfg().autostart = on;
    save();
    Ok(snapshot())
}

fn autostart_registry(on: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let mut cmd = std::process::Command::new("reg");
    if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        cmd.args(["add", KEY, "/v", "duostream", "/t", "REG_SZ", "/d", &format!("\"{}\" --tray", exe.display()), "/f"]);
    } else {
        cmd.args(["delete", KEY, "/v", "duostream", "/f"]);
    }
    let ok = cmd.creation_flags(0x0800_0000).status().map(|s| s.success()).unwrap_or(false);
    if ok || !on {
        Ok(())
    } else {
        Err("Couldn't add duostream to Windows startup".into())
    }
}

/// A pasted Twitch video or clip link: { login, title } of its channel.
#[tauri::command]
async fn twitch_link(kind: String, id: String) -> Result<serde_json::Value, String> {
    blocking(move || twitch::link_owner(&kind, &id)).await
}

/// Platform user id for plugins (used by the pop-out chat window, which has no resolved channel info).
#[tauri::command]
async fn user_id(platform: Platform, login: String) -> Option<String> {
    blocking(move || match platform {
        Platform::Twitch => twitch::user_id(&login),
        Platform::Kick => kick::user_id(&login),
    })
    .await
}

#[tauri::command]
fn set_category_follow(category: serde_json::Value, on: bool) -> AppState {
    {
        let mut c = cfg();
        let name = category["name"].as_str().unwrap_or("").to_lowercase();
        c.followed_categories.retain(|x| x["name"].as_str().unwrap_or("").to_lowercase() != name);
        if on && !name.is_empty() {
            c.followed_categories.push(json!({ "name": category["name"], "twitch": category["twitch"], "kick": category["kick"], "art": category["art"] }));
        }
    }
    save();
    snapshot()
}

/// kind "channel" (key "t:login") or "category" (key = name).
#[tauri::command]
fn set_hidden(kind: String, key: String, on: bool) -> AppState {
    {
        let mut c = cfg();
        let key = key.to_lowercase();
        let list = if kind == "category" { &mut c.hidden_categories } else { &mut c.hidden_channels };
        list.retain(|x| *x != key);
        if on {
            list.push(key);
        }
    }
    save();
    snapshot()
}

#[tauri::command]
fn get_state() -> AppState {
    snapshot()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn set_prefs(
    volume: Option<f32>,
    adblock: Option<bool>,
    low_latency: Option<bool>,
    sidebar_collapsed: Option<bool>,
    show_chat: Option<bool>,
    notify_live: Option<bool>,
    close_to_tray: Option<bool>,
    auto_claim: Option<bool>,
) {
    {
        let mut c = cfg();
        if let Some(v) = auto_claim {
            c.auto_claim = v;
        }
        if let Some(v) = notify_live {
            c.notify_live = v;
        }
        if let Some(v) = close_to_tray {
            c.close_to_tray = v;
        }
        if let Some(v) = volume {
            c.volume = v;
        }
        if let Some(v) = adblock {
            c.adblock = v;
        }
        if let Some(v) = low_latency {
            c.low_latency = v;
        }
        if let Some(v) = sidebar_collapsed {
            c.sidebar_collapsed = v;
        }
        if let Some(v) = show_chat {
            c.show_chat = v;
        }
    }
    save();
}

fn import_twitch_follows() -> Result<(), String> {
    let Some(a) = cfg().twitch.clone() else { return Ok(()) };
    let list = auth::twitch_follows(&a)?;
    {
        let mut c = cfg();
        c.follows.retain(|f| f.platform != Platform::Twitch);
        c.follows.extend(list.into_iter().map(|login| store::Follow { platform: Platform::Twitch, login }));
    }
    save();
    forget_follow_rows();
    Ok(())
}

/// Kick follows from the kick.com account (website session), merged with ones followed in the app.
fn import_kick_follows() -> Result<usize, String> {
    let session = cfg().kick_web_token.clone();
    if session.is_empty() {
        return Ok(0);
    }
    let list = kick::followed(&session)?;
    let n = list.len();
    {
        // the account is the source of truth, like Twitch: unfollows made on kick.com go away here too
        let mut c = cfg();
        c.follows.retain(|f| f.platform != Platform::Kick);
        for slug in list {
            if !c.follows.iter().any(|f| f.platform == Platform::Kick && f.login == slug) {
                c.follows.push(store::Follow { platform: Platform::Kick, login: slug });
            }
        }
    }
    save();
    forget_follow_rows();
    log_line(&format!("[follows] imported {n} Kick follows"));
    Ok(n)
}

/// Network trouble (offline, DNS, timeout, Cloudflare hiccup) as opposed to the platform rejecting a session.
fn is_network_error(e: &str) -> bool {
    let e = e.to_ascii_lowercase();
    e.starts_with("network error") || e.contains("http 000") || e.contains("empty response") || e.contains("timed out") || e.contains("cloudflare") || e.contains("http 5")
}

/// Re-validate saved sessions (refreshing tokens) and sync Twitch follows. Returns fresh state + notes.
#[tauri::command]
async fn restore_sessions() -> (AppState, Vec<String>) {
    blocking(|| {
        let mut notes = Vec::new();
        let (tw, kk) = {
            let c = cfg();
            (c.twitch.clone(), c.kick.clone())
        };
        // Only a real rejection signs you out; when Twitch/Kick can't be reached the saved session is kept.
        if let Some(t) = tw {
            match auth::twitch_restore(&t) {
                Ok(a) => cfg().twitch = Some(a),
                Err(e) if is_network_error(&e) => notes.push("Couldn't reach Twitch. You're still signed in; it retries in the background.".to_string()),
                Err(_) => {
                    cfg().twitch = None;
                    notes.push("Your Twitch session expired. Sign in again.".to_string());
                }
            }
        }
        if let Some(k) = kk {
            match auth::kick_restore(&k) {
                Ok(a) => cfg().kick = Some(a),
                Err(_) if !k.web => {
                    cfg().kick = None;
                    notes.push("Kick sign-in changed: please sign in to Kick once more.".to_string());
                }
                Err(e) if is_network_error(&e) => notes.push("Couldn't reach Kick. You're still signed in.".to_string()),
                Err(_) => {
                    cfg().kick = None;
                    notes.push("Your Kick session expired. Sign in again.".to_string());
                }
            }
        }
        forget_follow_rows();
        save();
        if let Err(e) = import_twitch_follows() {
            notes.push(format!("Couldn't load your Twitch follows: {e}"));
        }
        if let Err(e) = import_kick_follows() {
            log_line(&format!("[follows] Kick import failed: {e}"));
            notes.push(format!("Couldn't load your Kick follows ({e}). Reconnect Kick on the Drops page."));
        }
        (snapshot(), notes)
    })
    .await
}

// ------------------------------------------------------------------ content

#[derive(Serialize, Clone)]
struct FollowRow {
    platform: Platform,
    login: String,
    avatar: Option<String>,
    live: Option<StreamCard>,
}

#[tauri::command]
async fn follows_status() -> Vec<FollowRow> {
    blocking(|| follow_rows_cached(std::time::Duration::from_secs(20))).await
}

/// The last follow check, shared by the UI and the background notifier.
static FOLLOW_ROWS: Mutex<Option<(std::time::Instant, Vec<FollowRow>)>> = Mutex::new(None);
/// Held while a check runs: a second caller waits for it and reuses its result instead of starting another.
static FOLLOW_RUN: Mutex<()> = Mutex::new(());
/// Last successful state per channel ("t:login"): used when a check fails, so a hiccup doesn't look like
/// the channel going offline (and then "going live" again a minute later).
static LAST_ROWS: Mutex<Option<HashMap<String, FollowRow>>> = Mutex::new(None);

fn last_known(platform: Platform, login: &str) -> FollowRow {
    let key = akey(platform, login);
    let row = LAST_ROWS.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(&key).cloned());
    row.unwrap_or_else(|| FollowRow { platform, login: login.to_string(), avatar: cfg().avatars.get(&key).cloned(), live: None })
}

/// Kick live checks run on this many threads (each is a curl.exe process).
const KICK_WORKERS: usize = 6;

fn follow_rows_cached(max_age: std::time::Duration) -> Vec<FollowRow> {
    let _running = FOLLOW_RUN.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((t, rows)) = &*FOLLOW_ROWS.lock().unwrap_or_else(|e| e.into_inner()) {
        if t.elapsed() < max_age {
            return rows.clone();
        }
    }
    let rows = follow_rows();
    *FOLLOW_ROWS.lock().unwrap_or_else(|e| e.into_inner()) = Some((std::time::Instant::now(), rows.clone()));
    rows
}

/// Follows changed (follow/unfollow, sign-in): the next check must not reuse old rows.
fn forget_follow_rows() {
    *FOLLOW_ROWS.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// Live status of every followed channel (both platforms), remembering avatars.
fn follow_rows() -> Vec<FollowRow> {
    {
        let follows = cfg().follows.clone();
        let tw: Vec<String> = follows.iter().filter(|f| f.platform == Platform::Twitch).map(|f| f.login.clone()).collect();
        let kk: Vec<String> = follows.iter().filter(|f| f.platform == Platform::Kick).map(|f| f.login.clone()).collect();
        let mut rows = Vec::new();
        if !tw.is_empty() {
            match twitch::live_status(&tw) {
                Ok(v) => rows.extend(v.into_iter().map(|(login, avatar, live)| FollowRow { platform: Platform::Twitch, login, avatar, live })),
                Err(_) => rows.extend(tw.iter().map(|l| last_known(Platform::Twitch, l))),
            }
        }
        // a few workers pull from the list (one curl.exe each), instead of a process per channel at once
        let next = std::sync::atomic::AtomicUsize::new(0);
        let kick_rows: Mutex<Vec<FollowRow>> = Mutex::new(Vec::new());
        std::thread::scope(|sc| {
            for _ in 0..KICK_WORKERS.min(kk.len()) {
                sc.spawn(|| loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(login) = kk.get(i) else { break };
                    let row = match kick::live_card(login) {
                        Ok((avatar, live)) => FollowRow { platform: Platform::Kick, login: login.clone(), avatar, live },
                        Err(_) => last_known(Platform::Kick, login), // Cloudflare / network hiccup
                    };
                    kick_rows.lock().unwrap_or_else(|e| e.into_inner()).push(row);
                });
            }
        });
        rows.extend(kick_rows.into_inner().unwrap_or_else(|e| e.into_inner()));
        {
            let mut g = LAST_ROWS.lock().unwrap_or_else(|e| e.into_inner());
            let last = g.get_or_insert_with(HashMap::new);
            for r in &rows {
                last.insert(akey(r.platform, &r.login), r.clone());
            }
        }
        let changed = {
            let mut c = cfg();
            let mut changed = false;
            for r in &rows {
                if let Some(a) = &r.avatar {
                    changed |= c.avatars.insert(akey(r.platform, &r.login), a.clone()).as_ref() != Some(a);
                }
            }
            changed
        };
        if changed {
            save();
        }
        rows
    }
}

/// A go-live notification; clicking it opens that stream. Falls back to a plain notification.
fn live_toast(app: &AppHandle, title: &str, body: &str, arg: String) {
    use tauri_plugin_notification::NotificationExt;
    let app2 = app.clone();
    let shown = tauri_winrt_notification::Toast::new(APP_ID)
        .title(title)
        .text1(body)
        .on_activated(move |_| {
            show_main(&app2);
            let _ = app2.emit("open-arg", arg.clone());
            Ok(())
        })
        .show();
    if shown.is_err() {
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

/// Background loop: refresh follows every 90 s, push them to the UI, and notify on go-live.
fn live_notifier(app: AppHandle) {
    // live set + every channel seen last round: only notify for channels we already knew were
    // offline (newly imported follows that are already live must not trigger "went live").
    type Seen = std::collections::HashSet<(Platform, String)>;
    let mut known: Option<(Seen, Seen)> = None;
    loop {
        let signed_in = {
            let c = cfg();
            c.twitch.is_some() || c.kick.is_some()
        };
        if signed_in {
            let rows = follow_rows_cached(std::time::Duration::from_secs(30));
            let live: std::collections::HashSet<(Platform, String)> = rows.iter().filter(|r| r.live.is_some()).map(|r| (r.platform, r.login.clone())).collect();
            let all: std::collections::HashSet<(Platform, String)> = rows.iter().map(|r| (r.platform, r.login.clone())).collect();
            if let Some((prev_live, prev_all)) = &known {
                if cfg().notify_live {
                    let muted = cfg().notify_muted.clone();
                    for r in rows.iter().filter(|r| {
                        let k = (r.platform, r.login.clone());
                        r.live.is_some() && prev_all.contains(&k) && !prev_live.contains(&k) && !muted.contains(&akey(r.platform, &r.login))
                    }) {
                        let Some(c) = r.live.as_ref() else { continue };
                        let body = if c.category.is_empty() { c.title.clone() } else { format!("{} · {}", c.category, c.title) };
                        let arg = format!("{}:{}", if r.platform == Platform::Twitch { "twitch" } else { "kick" }, r.login);
                        live_toast(&app, &format!("{} is live on {}", c.display, r.platform.name()), &body, arg);
                    }
                }
            }
            known = Some((live, all));
            let _ = app.emit("follows", &rows);
        }
        std::thread::sleep(std::time::Duration::from_secs(90));
    }
}

#[derive(Serialize)]
struct Suggestion {
    platform: Platform,
    login: String,
    display: String,
    avatar: Option<String>,
    live: bool,
    viewers: u64,
    category: String,
}

/// Channels from both platforms for a query, live first. Kick live channels get their viewer count.
fn search_channels(q: &str, twitch_n: usize, kick_n: usize) -> (Vec<Suggestion>, Vec<serde_json::Value>) {
    let q2 = q.to_string();
    let k = std::thread::spawn(move || kick::search(&q2));
    let mut out: Vec<Suggestion> = twitch::search(q)
        .unwrap_or_default()
        .into_iter()
        .take(twitch_n)
        .map(|(login, display, avatar, live)| Suggestion {
            platform: Platform::Twitch,
            login,
            display,
            avatar,
            live: live.is_some(),
            viewers: live.as_ref().map(|l| l.0).unwrap_or(0),
            category: live.map(|l| l.1).unwrap_or_default(),
        })
        .collect();
    let (kch, kcats) = k.join().unwrap_or_default();
    // live Kick channels: fetch viewer counts + avatars (a few, in parallel)
    let handles: Vec<_> = kch
        .into_iter()
        .take(kick_n)
        .map(|c| {
            std::thread::spawn(move || {
                let login = c["login"].as_str().unwrap_or("").to_string();
                let (av, card) = if c["live"] == true || c["avatar"].is_null() { kick::live_card(&login).unwrap_or((None, None)) } else { (None, None) };
                Suggestion {
                    platform: Platform::Kick,
                    display: card.as_ref().map(|x| x.display.clone()).or_else(|| c["display"].as_str().map(String::from)).unwrap_or_else(|| login.clone()),
                    login,
                    avatar: c["avatar"].as_str().map(String::from).or(av),
                    live: card.is_some(),
                    viewers: card.as_ref().map(|x| x.viewers).unwrap_or(0),
                    category: card.map(|x| x.category).unwrap_or_default(),
                }
            })
        })
        .collect();
    out.extend(handles.into_iter().filter_map(|h| h.join().ok()));
    // exact name matches first, then live by viewers
    let ql = q.to_lowercase();
    out.sort_by(|a, b| (b.login == ql).cmp(&(a.login == ql)).then(b.live.cmp(&a.live)).then(b.viewers.cmp(&a.viewers)));
    (out, kcats)
}

/// Search-box instant results: channels (both platforms) + matching categories.
#[tauri::command]
async fn suggest(q: String) -> serde_json::Value {
    let q = q.trim().trim_start_matches('@').to_string();
    if q.chars().count() < 2 {
        return json!({ "channels": [], "categories": [] });
    }
    blocking(move || {
        let q2 = q.clone();
        let tg = std::thread::spawn(move || twitch::search_extra(&q2).map(|(g, _)| g).unwrap_or_default());
        let (chans, kcats) = search_channels(&q, 5, 4);
        let cats = merge_categories(tg.join().unwrap_or_default(), kcats);
        json!({ "channels": chans, "categories": cats.into_iter().take(4).collect::<Vec<_>>() })
    })
    .await
}

fn merge_categories(twitch: Vec<serde_json::Value>, kick: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    let mut out: Vec<serde_json::Value> = twitch
        .into_iter()
        .map(|g| json!({ "name": g["name"], "art": g["art"], "twitch": g["name"], "kick": null, "viewers": g["viewers"] }))
        .collect();
    for c in kick {
        let key = norm_cat(c["name"].as_str().unwrap_or(""));
        match out.iter_mut().find(|o| norm_cat(o["name"].as_str().unwrap_or("")) == key) {
            Some(o) => {
                o["kick"] = c["slug"].clone();
                o["viewers"] = json!(o["viewers"].as_u64().unwrap_or(0) + c["viewers"].as_u64().unwrap_or(0));
            }
            None => out.push(json!({ "name": c["name"], "art": c["art"], "twitch": null, "kick": c["slug"], "viewers": c["viewers"] })),
        }
    }
    out
}

/// Full search page: channels, live streams (by title too), categories and past videos.
#[tauri::command]
async fn search_all(q: String) -> serde_json::Value {
    let q = q.trim().trim_start_matches('@').to_string();
    blocking(move || {
        let (q2, q3) = (q.clone(), q.clone());
        let extra = std::thread::spawn(move || twitch::search_extra(&q2).unwrap_or_default());
        let streams = std::thread::spawn(move || {
            let mut live = twitch::search_streams(&q3).unwrap_or_default();
            // Kick has no title search: match the title/category/name of the top Kick streams
            let ql = q3.to_lowercase();
            if let Ok(k) = kick::top_streams() {
                live.extend(k.into_iter().filter(|c| {
                    c.title.to_lowercase().contains(&ql) || c.category.to_lowercase().contains(&ql) || c.login.contains(&ql) || c.tags.iter().any(|t| t.to_lowercase() == ql)
                }));
            }
            live
        });
        let (chans, kcats) = search_channels(&q, 10, 8);
        let (games, videos) = extra.join().unwrap_or_default();
        let mut live = streams.join().unwrap_or_default();
        live.sort_by_key(|c| std::cmp::Reverse(c.viewers));
        json!({ "channels": chans, "live": live, "categories": merge_categories(games, kcats), "videos": videos })
    })
    .await
}

/// Browse with filters. `platform` "all" | "Twitch" | "Kick"; cursors come back for "load more".
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn browse_page(
    platform: String,
    sort: String,
    language: String,
    tag: String,
    drops: bool,
    twitch_cursor: Option<String>,
    kick_cursor: Option<String>,
    first: bool,
) -> Result<serde_json::Value, String> {
    blocking(move || {
        let want_t = platform != "Kick" && (first || twitch_cursor.is_some());
        // Kick only lists by most viewers (no ascending / start-time sort) and has no drops filter
        let want_k = platform != "Twitch" && !drops && sort == "viewers" && (first || kick_cursor.is_some());
        let (s2, l2, t2) = (sort.clone(), language.clone(), tag.clone());
        let th = std::thread::spawn(move || if want_t { Some(twitch::browse(&s2, &l2, &t2, drops, twitch_cursor.as_deref())) } else { None });
        let k = if want_k { Some(kick::browse(&language, kick_cursor.as_deref())) } else { None };
        let t = th.join().unwrap_or(None);
        let mut cards = Vec::new();
        let mut errs = Vec::new();
        let mut t_next = None;
        let mut k_next = None;
        match t {
            Some(Ok((c, n))) => {
                cards.extend(c);
                t_next = n;
            }
            Some(Err(e)) => errs.push(e),
            None => {}
        }
        match k {
            Some(Ok((c, next))) => {
                let tl = tag.to_lowercase();
                cards.extend(c.into_iter().filter(|x| tl.is_empty() || x.tags.iter().any(|t| t.to_lowercase() == tl)));
                k_next = next;
            }
            Some(Err(e)) => errs.push(e),
            None => {}
        }
        if cards.is_empty() && !errs.is_empty() && first {
            return Err(errs.join(" · "));
        }
        Ok(json!({ "cards": cards, "twitch_cursor": t_next, "kick_cursor": k_next }))
    })
    .await
}

/// Save the last `seconds` of the live stream to Videos\duostream. Returns the file path.
#[tauri::command]
async fn save_clip(seconds: f64, login: Option<String>, behind: Option<f64>) -> Result<String, String> {
    blocking(move || {
        let base = std::env::var_os("USERPROFILE").map(std::path::PathBuf::from).unwrap_or_else(|| ".".into());
        let path = adblock::clip(login.as_deref(), seconds.clamp(5.0, 300.0), behind.unwrap_or(0.0).max(0.0), &base.join("Videos").join("duostream"))?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

/// Show a saved file in Explorer.
#[tauri::command]
fn reveal_file(path: String) {
    // canonical paths, so "..\\" can't point outside the clips folder
    let Ok(p) = std::fs::canonicalize(&path) else { return };
    let videos = std::env::var_os("USERPROFILE").and_then(|u| std::fs::canonicalize(std::path::PathBuf::from(u).join("Videos").join("duostream")).ok());
    if videos.map(|v| p.starts_with(v)).unwrap_or(false) && p.is_file() {
        let p = std::path::PathBuf::from(p.to_string_lossy().trim_start_matches(r"\\?\")); // explorer can't take \\?\ paths
        let _ = std::process::Command::new("explorer").arg(format!("/select,{}", p.display())).spawn();
    }
}

// ------------------------------------------------------------------ plugins
//
// A plugin is a folder in %APPDATA%\duostream\plugins\<id>\ with manifest.json + plugin.js.
// The UI runs plugin.js with a small API (see PLUGINS.md). "adblock" is a built-in plugin:
// installed on first run, and the Twitch ad-filtering proxy only runs while it is enabled.

fn plugins_dir() -> std::path::PathBuf {
    std::env::var_os("APPDATA").map(std::path::PathBuf::from).unwrap_or_else(|| ".".into()).join("duostream").join("plugins")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

fn adblock_active() -> bool {
    cfg().plugins.get("adblock").copied().unwrap_or(false) && plugins_dir().join("adblock").join("plugin.js").is_file()
}

#[derive(Serialize)]
struct InstalledPlugin {
    manifest: serde_json::Value,
    code: String,
    enabled: bool,
}

#[tauri::command]
fn plugins_list() -> Vec<InstalledPlugin> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(plugins_dir()) else { return out };
    let states = cfg().plugins.clone();
    for e in rd.flatten() {
        let dir = e.path();
        let id = e.file_name().to_string_lossy().to_string();
        let (Ok(m), Ok(code)) = (std::fs::read_to_string(dir.join("manifest.json")), std::fs::read_to_string(dir.join("plugin.js"))) else { continue };
        let Ok(manifest) = serde_json::from_str::<serde_json::Value>(m.trim_start_matches('\u{feff}')) else { continue };
        out.push(InstalledPlugin { manifest, code, enabled: states.get(&id).copied().unwrap_or(true) });
    }
    out.sort_by(|a, b| a.manifest["name"].as_str().unwrap_or("").cmp(b.manifest["name"].as_str().unwrap_or("")));
    out
}

fn write_plugin(manifest: &serde_json::Value, code: &str) -> Result<String, String> {
    let id = manifest["id"].as_str().unwrap_or("").to_string();
    if !valid_id(&id) {
        return Err("Plugin id must be lowercase letters, digits, - or _".into());
    }
    if manifest["name"].as_str().unwrap_or("").is_empty() {
        return Err("Plugin manifest needs a name".into());
    }
    let dir = plugins_dir().join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("manifest.json"), serde_json::to_string_pretty(manifest).unwrap_or_default()).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("plugin.js"), code).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
fn plugin_install(manifest: serde_json::Value, code: String) -> Result<(), String> {
    let id = write_plugin(&manifest, &code)?;
    cfg().plugins.insert(id, true);
    save();
    Ok(())
}

#[tauri::command]
fn plugin_uninstall(id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("bad plugin id".into());
    }
    let _ = std::fs::remove_dir_all(plugins_dir().join(&id));
    cfg().plugins.remove(&id);
    save();
    Ok(())
}

#[tauri::command]
fn plugin_set_enabled(id: String, enabled: bool) {
    cfg().plugins.insert(id, enabled);
    save();
}

/// Download a plugin-shop file (registry.json, manifest.json, plugin.js). HTTPS only.
#[tauri::command]
async fn fetch_text_url(url: String) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("Only https:// sources are allowed".into());
    }
    blocking(move || fetch_text(&url)).await
}

#[tauri::command]
fn open_plugins_dir() {
    let d = plugins_dir();
    let _ = std::fs::create_dir_all(&d);
    let _ = std::process::Command::new("explorer").arg(d).spawn();
}

#[tauri::command]
fn set_plugin_sources(sources: Vec<String>) {
    cfg().plugin_sources = sources.into_iter().filter(|s| s.starts_with("https://")).collect();
    save();
}

/// First run: install built-in plugins shipped inside the app (store/<id>/...).
fn seed_builtin_plugins(app: &tauri::App) {
    {
        // v0.6 installed only ad block, marked with plugins_seeded
        let mut c = cfg();
        if c.plugins_seeded && !c.seeded_plugins.iter().any(|x| x == "adblock") {
            c.seeded_plugins.push("adblock".into());
        }
    }
    let res = app.asset_resolver();
    for id in ["adblock", "7tv", "bttv", "ffz"] {
        if cfg().seeded_plugins.iter().any(|x| x == id) {
            continue;
        }
        cfg().seeded_plugins.push(id.to_string());
        let (Some(m), Some(code)) = (res.get(format!("store/{id}/manifest.json")), res.get(format!("store/{id}/plugin.js"))) else { continue };
        let Ok(manifest) = serde_json::from_slice::<serde_json::Value>(&m.bytes) else { continue };
        if write_plugin(&manifest, &String::from_utf8_lossy(&code.bytes)).is_ok() {
            cfg().plugins.insert(id.to_string(), true);
        }
    }
    save();
}

/// Main window hidden in the tray (playback already stopped by the UI): freeze the page and let WebView2 release
/// its memory. `false` wakes it instantly. Live notifications and drop claiming run here in Rust, unaffected.
fn webview_sleep(w: &tauri::WebviewWindow, sleep: bool) {
    let _ = w.with_webview(move |wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use windows_core::Interface;
        let ctrl = wv.controller();
        let Ok(core) = ctrl.CoreWebView2() else { return };
        if let Ok(c19) = core.cast::<ICoreWebView2_19>() {
            let level = if sleep { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
            let _ = c19.SetMemoryUsageTargetLevel(level);
        }
        let Ok(c3) = core.cast::<ICoreWebView2_3>() else { return };
        if sleep {
            let _ = ctrl.SetIsVisible(false); // TrySuspend only works on a non-visible webview
            let _ = c3.TrySuspend(&webview2_com::TrySuspendCompletedHandler::create(Box::new(|_, _| Ok(()))));
        } else {
            let _ = ctrl.SetIsVisible(true);
            let _ = c3.Resume();
        }
    });
}

/// Called by the UI once it has torn down playback after being closed to the tray.
#[tauri::command]
fn tray_sleep(app: AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        if !w.is_visible().unwrap_or(true) {
            webview_sleep(&w, true);
        }
    }
}

fn show_main(app: &AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let was_hidden = !w.is_visible().unwrap_or(true);
        webview_sleep(&w, false);
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if was_hidden {
            let _ = w.emit("window-shown", ()); // refresh anything that changed while asleep
        }
    }
}

#[tauri::command]
async fn resolve(platform: Platform, login: String, meta: Option<bool>) -> Result<Resolved, String> {
    // meta: title / viewers / live only, without fetching playback URLs
    let meta = meta.unwrap_or(false);
    blocking(move || match platform {
        Platform::Twitch => twitch::resolve(&login, meta),
        Platform::Kick => kick::resolve(&login, meta),
    })
    .await
}

/// URL the in-app player should load. Twitch goes through the local ad-filtering proxy.
#[tauri::command]
fn play_url(platform: Platform, login: String, name: String, url: String, dvr: Option<bool>) -> String {
    let dvr = dvr.unwrap_or(true);
    match platform {
        Platform::Twitch => adblock::wrap(&format!("t:{login}"), &login, &name, &url, adblock_active(), dvr),
        // Kick goes through the same local proxy (no ad filter) for rewind + clips.
        Platform::Kick => adblock::wrap(&format!("k:{login}"), &login, &name, &url, false, dvr),
    }
}

/// A plain name: look it up on both platforms; prefer the live one (more viewers wins).
#[tauri::command]
async fn search(name: String) -> Option<Platform> {
    blocking(move || {
        let n1 = name.clone();
        let th = std::thread::spawn(move || twitch::resolve(&n1, true));
        let k = kick::resolve(&name, true);
        let t = th.join().unwrap_or_else(|_| Err("lookup failed".into()));
        match (&t, &k) {
            (Ok(t), Ok(k)) => Some(match (t.live, k.live) {
                (false, true) => Platform::Kick,
                (true, true) if k.viewers > t.viewers => Platform::Kick,
                _ => Platform::Twitch,
            }),
            (Ok(_), Err(_)) => Some(Platform::Twitch),
            (Err(_), Ok(_)) => Some(Platform::Kick),
            _ => None,
        }
    })
    .await
}

/// Follow/unfollow. Twitch follows go to the signed-in account; Kick follows are kept locally.
#[tauri::command]
async fn set_follow(platform: Platform, login: String, on: bool) -> Result<(), String> {
    let login = login.to_lowercase();
    if platform == Platform::Twitch {
        let account = cfg().twitch.clone();
        if let Some(a) = account {
            let l = login.clone();
            blocking(move || twitch::set_follow(&a.token, &l, on)).await?;
        }
    } else {
        let session = cfg().kick_web_token.clone();
        if !session.is_empty() {
            let l = login.clone();
            blocking(move || kick::set_follow(&session, &l, on)).await?;
        }
    }
    {
        let mut c = cfg();
        c.follows.retain(|f| !(f.platform == platform && f.login == login));
        if on {
            c.follows.push(store::Follow { platform, login });
        }
    }
    save();
    forget_follow_rows();
    Ok(())
}

// ------------------------------------------------------------------ sign-in

#[tauri::command]
async fn twitch_login_start(app: AppHandle) -> Result<(String, String), String> {
    let dc = blocking(auth::twitch_start).await?;
    let (code, uri) = (dc.user_code.clone(), dc.uri.clone());
    auth::open_browser(&format!("{uri}?device-code={code}"));
    let cancel = new_cancel();
    std::thread::spawn(move || {
        let r = auth::twitch_wait(&dc, &cancel);
        let payload = match r {
            Ok(a) => {
                let name = a.login.clone();
                cfg().twitch = Some(a);
                save();
                let _ = import_twitch_follows();
                json!({ "platform": "Twitch", "ok": true, "message": format!("Signed in to Twitch as {name}") })
            }
            Err(e) if e == "cancelled" => return,
            Err(e) => json!({ "platform": "Twitch", "ok": false, "message": e }),
        };
        let _ = app.emit("auth", payload);
    });
    Ok((code, uri))
}

#[tauri::command]
fn login_cancel() {
    new_cancel();
}

#[tauri::command]
fn sign_out(platform: Platform) {
    {
        let mut c = cfg();
        match platform {
            Platform::Twitch => {
                c.twitch = None;
                c.follows.retain(|f| f.platform != Platform::Twitch);
            }
            Platform::Kick => {
                c.kick = None;
                c.kick_web_token.clear();
                c.follows.retain(|f| f.platform != Platform::Kick);
            }
        }
    }
    save();
    forget_follow_rows();
}

// ------------------------------------------------------------------ channel tabs, categories, chat extras

#[tauri::command]
async fn channel_about(platform: Platform, login: String) -> Result<serde_json::Value, String> {
    blocking(move || match platform {
        Platform::Twitch => twitch::about(&login),
        Platform::Kick => kick::about(&login),
    })
    .await
}

#[tauri::command]
async fn channel_videos(platform: Platform, login: String, kind: String) -> Result<Vec<serde_json::Value>, String> {
    blocking(move || match (platform, kind.as_str()) {
        (Platform::Twitch, "clips") => twitch::clips(&login),
        (Platform::Twitch, _) => twitch::videos(&login),
        (Platform::Kick, "clips") => kick::clips(&login),
        (Platform::Kick, _) => kick::videos(&login),
    })
    .await
}

/// Playable variants for a VOD (`kind` "video") or a clip (`kind` "clip").
#[tauri::command]
async fn video_play(platform: Platform, id: String, kind: String) -> Result<Vec<Variant>, String> {
    blocking(move || match (platform, kind.as_str()) {
        (Platform::Twitch, "clip") => Ok(vec![Variant { name: "Source".into(), url: twitch::clip_url(&id)? }]),
        (Platform::Twitch, _) => Ok(twitch::vod_variants(&id)?
            .into_iter()
            .map(|v| Variant { url: adblock::passthrough(&v.url), name: v.name })
            .collect()),
        (Platform::Kick, "clip") if id.starts_with("https://") && id.contains(".kick.com/") => Ok(vec![Variant { name: "Source".into(), url: id }]),
        (Platform::Kick, "clip") => Err("bad clip".into()),
        (Platform::Kick, _) => kick::vod_variants(&id),
    })
    .await
}

fn norm_cat(s: &str) -> String {
    let s = s.to_lowercase();
    let s = s.split(" (").next().unwrap_or(&s).to_string(); // "Grand Theft Auto V (GTA)"
    s.chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Top categories on both platforms, merged by name.
#[tauri::command]
async fn categories() -> Result<Vec<serde_json::Value>, String> {
    blocking(|| {
        let th = std::thread::spawn(twitch::top_games);
        let k = kick::categories().unwrap_or_default();
        let t = th.join().unwrap_or_else(|_| Err("failed".into()));
        if t.is_err() && k.is_empty() {
            return Err(t.err().unwrap_or_default());
        }
        let mut out: Vec<serde_json::Value> = Vec::new();
        for g in t.unwrap_or_default() {
            out.push(json!({ "name": g["name"], "art": g["art"], "twitch": g["name"], "kick": null, "twitch_viewers": g["viewers"], "kick_viewers": 0 }));
        }
        for c in k {
            let key = norm_cat(c["name"].as_str().unwrap_or(""));
            match out.iter_mut().find(|o| norm_cat(o["name"].as_str().unwrap_or("")) == key) {
                Some(o) => {
                    o["kick"] = c["slug"].clone();
                    o["kick_viewers"] = c["viewers"].clone();
                }
                None => out.push(json!({ "name": c["name"], "art": c["art"], "twitch": null, "kick": c["slug"], "twitch_viewers": 0, "kick_viewers": c["viewers"] })),
            }
        }
        for o in out.iter_mut() {
            o["viewers"] = json!(o["twitch_viewers"].as_u64().unwrap_or(0) + o["kick_viewers"].as_u64().unwrap_or(0));
        }
        out.sort_by(|a, b| b["viewers"].as_u64().cmp(&a["viewers"].as_u64()));
        Ok(out)
    })
    .await
}

#[tauri::command]
async fn category_streams(twitch_name: Option<String>, kick_slug: Option<String>) -> Result<Vec<StreamCard>, String> {
    blocking(move || {
        let th = std::thread::spawn(move || twitch_name.map(|n| twitch::top_streams(&n)));
        let mut out = kick_slug.map(|s| kick::category_streams(&s).unwrap_or_default()).unwrap_or_default();
        if let Ok(Some(Ok(t))) = th.join() {
            out.extend(t);
        }
        out.sort_by_key(|c| std::cmp::Reverse(c.viewers));
        Ok(out)
    })
    .await
}

#[tauri::command]
async fn chat_emotes(platform: Platform, login: String) -> Vec<serde_json::Value> {
    let token = cfg().twitch.as_ref().map(|a| a.token.clone());
    blocking(move || match platform {
        Platform::Twitch => twitch::emotes(&login, token.as_deref()),
        Platform::Kick => kick::emotes(&login),
    })
    .await
}

#[tauri::command]
async fn user_card(platform: Platform, channel: String, user: String) -> Result<serde_json::Value, String> {
    blocking(move || match platform {
        Platform::Twitch => twitch::user_card(&user),
        Platform::Kick => kick::user_card(&channel, &user),
    })
    .await
}

#[tauri::command]
async fn twitch_badges(login: String) -> HashMap<String, String> {
    blocking(move || twitch::badges(&login).unwrap_or_default()).await
}

/// Picture-in-picture: our own always-on-top player window (the WebView's built-in PiP window
/// can't be titled and shows "tauri.localhost").
#[tauri::command]
async fn pip_open(app: AppHandle, platform: Platform, login: String, display: String) -> Result<(), String> {
    use tauri::Manager;
    let title = format!("{display} · duostream");
    if let Some(w) = app.get_webview_window("pip") {
        let _ = w.set_title(&title);
        let _ = app.emit("pip-target", json!({ "platform": platform, "login": login, "display": display }));
        let _ = w.set_focus();
        return Ok(());
    }
    let hash = format!("index.html#pip={}|{}|{}", if platform == Platform::Kick { "Kick" } else { "Twitch" }, enc(&login), enc(&display));
    let mut b = tauri::WebviewWindowBuilder::new(&app, "pip", tauri::WebviewUrl::App(hash.into()))
        .title(&title)
        .inner_size(480.0, 270.0)
        .min_inner_size(256.0, 144.0)
        .decorations(false)
        .always_on_top(true)
        .shadow(true);
    if let Ok(Some(m)) = app.primary_monitor() {
        let sc = m.scale_factor();
        let (w, h) = (m.size().width as f64 / sc, m.size().height as f64 / sc);
        b = b.position(w - 480.0 - 24.0, h - 270.0 - 72.0);
    }
    let win = b.build().map_err(|e| e.to_string())?;
    let app2 = app.clone();
    win.on_window_event(move |e| {
        if let tauri::WindowEvent::Destroyed = e {
            let _ = app2.emit("pip-closed", ());
        }
    });
    Ok(())
}

/// PiP window "back to app" button: show the main window again.
#[tauri::command]
fn show_main_window(app: AppHandle) {
    show_main(&app);
}

/// Open chat in its own window (it mirrors the main window's channel).
#[tauri::command]
async fn popout_chat(app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("chat") {
        let _ = w.set_focus();
        return Ok(());
    }
    let w = tauri::WebviewWindowBuilder::new(&app, "chat", tauri::WebviewUrl::App("index.html#popout".into()))
        .title("Chat · duostream")
        .inner_size(380.0, 720.0)
        .min_inner_size(300.0, 400.0)
        .build()
        .map_err(|e| e.to_string())?;
    let app2 = app.clone();
    w.on_window_event(move |e| {
        if let tauri::WindowEvent::Destroyed = e {
            let _ = app2.emit("popout-closed", ());
        }
    });
    Ok(())
}

// ------------------------------------------------------------------ channel points

#[tauri::command]
async fn points_status(login: String) -> Result<serde_json::Value, String> {
    let tok = cfg().twitch.as_ref().map(|a| a.token.clone()).ok_or("Sign in to Twitch for channel points")?;
    blocking(move || twitch::points(&tok, &login.to_lowercase())).await
}

#[tauri::command]
async fn points_redeem(login: String, reward: serde_json::Value, text: Option<String>) -> Result<(), String> {
    let tok = cfg().twitch.as_ref().map(|a| a.token.clone()).ok_or("Sign in to Twitch first")?;
    blocking(move || {
        let p = twitch::points(&tok, &login.to_lowercase())?;
        let ch = p["channel_id"].as_str().ok_or("channel not found")?;
        twitch::redeem(&tok, ch, &reward, text.as_deref())
    })
    .await
}

// ------------------------------------------------------------------ drops

/// Sign in to twitch.tv / kick.com inside the app and keep the website session (drops need it).
#[tauri::command]
async fn drops_connect(app: AppHandle, platform: Platform) -> Result<(), String> {
    use tauri::Manager;
    let (label, start, site, cookie) = match platform {
        Platform::Twitch => ("login-twitch", "https://www.twitch.tv/login", "https://www.twitch.tv/", "auth-token"),
        Platform::Kick => ("login-kick", "https://kick.com/", "https://kick.com/", "session_token"),
    };
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.set_focus();
        return Ok(());
    }
    let twitch_script = integrity_script();
    let w = tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(start.parse().map_err(|_| "bad url")?))
        .title(format!("Sign in to {}", platform.name()))
        .inner_size(520.0, 780.0)
        // kick.com has no login page, only a modal: open it by clicking its own "Log In" button
        .initialization_script(if platform == Platform::Twitch {
            twitch_script.as_str()
        } else if platform == Platform::Kick {
            r#"(function(){
                if (location.hostname !== 'kick.com') return;
                var tries = 0;
                var t = setInterval(function(){
                    tries++;
                    if (document.cookie.indexOf('session_token=') >= 0 || tries > 60) { clearInterval(t); return; }
                    var btns = Array.prototype.slice.call(document.querySelectorAll('button, a'));
                    var b = btns.find(function(x){ var s = (x.textContent || '').trim().toLowerCase(); return s === 'log in' || s === 'login' || x.getAttribute('data-testid') === 'login'; });
                    if (b && !document.querySelector('[role=dialog] input[type=password], input[name=password]')) { b.click(); }
                    if (document.querySelector('[role=dialog] input, input[name=emailOrUsername], input[type=password]')) clearInterval(t);
                }, 500);
            })();"#
        } else {
            ""
        })
        .build()
        .map_err(|e| e.to_string())?;
    let site: tauri::Url = site.parse().map_err(|_| "bad url")?;
    let tag = platform.name();
    log_line(&format!("[drops] {tag}: login window opened"));
    std::thread::spawn(move || {
        for i in 0..900u32 {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let cookies = match w.cookies_for_url(site.clone()) {
                Ok(c) => c,
                Err(e) => {
                    log_line(&format!("[drops] {tag}: stopped reading cookies ({e}); window closed?"));
                    return;
                }
            };
            if i % 15 == 0 {
                let names: Vec<&str> = cookies.iter().map(|c| c.name()).collect();
                log_line(&format!("[drops] {tag}: {}s, {} cookies: {}", i, names.len(), names.join(",")));
            }
            let Some(c) = cookies.iter().find(|c| c.name() == cookie && c.value().len() > 10) else { continue };
            let token = adblock_decode(c.value());
            log_line(&format!("[drops] {tag}: found {cookie} ({} chars)", token.len()));
            // Keep the session even if the first drops lookup fails; the Drops page shows the error.
            let result = match platform {
                Platform::Twitch => {
                    // open the drops page so Twitch's own code produces an integrity token we can reuse
                    let started = now_ms();
                    if let Ok(u) = "https://www.twitch.tv/drops/inventory".parse() {
                        let _ = w.navigate(u);
                    }
                    let got = wait_integrity(started, 30);
                    log_line(&format!("[drops] Twitch: integrity captured: {got}"));
                    let r = twitch::drops(&token, None);
                    let mut g = cfg();
                    g.twitch_web_token = token.clone();
                    g.twitch_drops_client = r.as_ref().map(|(c, _)| c.clone()).unwrap_or_else(|_| twitch::DROPS_CLIENTS[0].to_string());
                    r.map(|_| ())
                }
                Platform::Kick => {
                    // One kick.com login = the whole Kick account: chat, follows, drops.
                    match kick::me(&token) {
                        Ok((username, avatar)) => {
                            {
                                let mut g = cfg();
                                g.kick_web_token = token.clone();
                                g.kick = Some(auth::KickAuth { token: token.clone(), username: username.clone(), avatar, web: true, ..Default::default() });
                            }
                            save();
                            let f = import_kick_follows();
                            log_line(&format!("[drops] Kick signed in as {username}; follows import: {f:?}"));
                            let _ = w.app_handle().emit("auth", json!({ "platform": "Kick", "ok": true, "message": format!("Signed in to Kick as {username}") }));
                            Ok(())
                        }
                        Err(e) => Err(e),
                    }
                }
            };
            save();
            log_line(&format!("[drops] {tag}: check result {result:?}"));
            let _ = w.close();
            let msg = match result {
                Ok(()) => json!({ "ok": true, "message": format!("{tag} drops connected") }),
                Err(e) => json!({ "ok": false, "message": format!("Connected to {tag}, but the drops check failed: {e}") }),
            };
            let _ = w.app_handle().emit("drops-connected", msg);
            return;
        }
    });
    Ok(())
}

/// Injected into twitch.tv pages we open: reports the Client-Integrity header set Twitch's own
/// code attaches to its GQL requests, so drops queries pass Twitch's integrity check.
fn integrity_script() -> String {
    // JSON-quoted so the URL drops into the script as a string literal ("" = proxy not running)
    let ti = serde_json::to_string(&adblock::ti_url().unwrap_or_default()).unwrap_or_else(|_| "\"\"".into());
    format!(
        r#"(function(){{
  var TI = {ti};
  if (location.hostname.indexOf('twitch.tv') < 0 || !TI) return;
  var of = window.fetch, sent = 0;
  function pick(h, k) {{
    if (!h) return null;
    if (typeof Headers !== 'undefined' && h instanceof Headers) return h.get(k);
    for (var x in h) if (x.toLowerCase() === k.toLowerCase()) return h[x];
    return null;
  }}
  window.fetch = function(input, init) {{
    try {{
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('gql.twitch.tv') >= 0 && Date.now() - sent > 20000) {{
        var h = (init && init.headers) || (input && input.headers);
        var ci = pick(h, 'Client-Integrity');
        if (ci) {{
          sent = Date.now();
          of(TI, {{ method: 'POST', headers: {{ 'content-type': 'text/plain' }},
            body: JSON.stringify({{ integrity: ci, device: pick(h, 'X-Device-Id'), session: pick(h, 'Client-Session-Id'),
              client: pick(h, 'Client-Id'), ua: navigator.userAgent, at: Date.now() }}) }}).catch(function(){{}});
        }}
      }}
    }} catch (e) {{}}
    return of.apply(this, arguments);
  }};
}})();"#
    )
}

/// Wait up to `secs` for fresh integrity headers; persist them in the config.
fn wait_integrity(since_ms: u64, secs: u64) -> bool {
    for _ in 0..secs * 2 {
        let got = adblock::INTEGRITY.lock().unwrap().clone();
        if let Some(v) = got.filter(|v| v["at"].as_u64().unwrap_or(0) >= since_ms) {
            cfg().twitch_integrity = v;
            save();
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    false
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Integrity tokens expire after a few hours: reload a hidden twitch.tv drops page to get a new one.
fn refresh_integrity(app: &AppHandle) -> bool {
    use tauri::Manager;
    if app.get_webview_window("twitch-integrity").is_some() {
        return wait_integrity(now_ms() - 1000, 25);
    }
    let start = now_ms();
    let Ok(url) = "https://www.twitch.tv/drops/inventory".parse() else { return false };
    let Ok(w) = tauri::WebviewWindowBuilder::new(app, "twitch-integrity", tauri::WebviewUrl::External(url))
        .visible(false)
        .initialization_script(integrity_script())
        .build()
    else {
        return false;
    };
    let ok = wait_integrity(start, 25);
    let _ = w.close();
    log_line(&format!("[drops] integrity refresh: {ok}"));
    ok
}

fn adblock_decode(s: &str) -> String {
    // cookie values are percent-encoded (Kick's contains %7C)
    let mut out = Vec::new();
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
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

#[tauri::command]
fn drops_disconnect(platform: Platform) {
    {
        let mut c = cfg();
        match platform {
            Platform::Twitch => {
                c.twitch_web_token.clear();
                c.twitch_drops_client.clear();
            }
            Platform::Kick => c.kick_web_token.clear(),
        }
    }
    save();
}

/// Kick campaigns with the user's progress merged into each reward.
fn kick_drops_merged(session: &str) -> Result<Vec<serde_json::Value>, String> {
    let mut camps = kick::drop_campaigns()?;
    let progress = if session.is_empty() { Vec::new() } else { kick::drop_progress(session)? };
    for c in camps.iter_mut() {
        let p = progress.iter().find(|p| p["id"] == c["id"]);
        if let Some(rewards) = c["rewards"].as_array_mut() {
            for r in rewards.iter_mut() {
                let pr = p.and_then(|p| p["rewards"].as_array()).and_then(|a| a.iter().find(|x| x["id"] == r["id"]));
                r["progress"] = pr.map(|x| x["progress"].clone()).unwrap_or(json!(0));
                r["claimed"] = pr.map(|x| x["claimed"].clone()).unwrap_or(json!(false));
                if let Some(img) = r["image_url"].as_str().filter(|u| !u.starts_with("http")) {
                    r["image_url"] = json!(format!("https://ext.cdn.kick.com/{img}"));
                }
            }
        }
    }
    Ok(camps)
}

/// Twitch drops, refreshing the integrity token once if Twitch rejects it.
fn twitch_drops_fresh(app: &AppHandle, web: &str, client: &str) -> Result<(String, Vec<serde_json::Value>), String> {
    let pref = Some(client).filter(|c| !c.is_empty());
    match twitch::drops(web, pref) {
        Err(e) if e.contains("ntegrity") => {
            if refresh_integrity(app) {
                twitch::drops(web, pref)
            } else {
                Err("Twitch's security check couldn't be refreshed. Open the Drops page again in a moment.".into())
            }
        }
        r => r,
    }
}

#[tauri::command]
async fn drops_status(app: AppHandle) -> serde_json::Value {
    let (web, client, session) = {
        let c = cfg();
        (c.twitch_web_token.clone(), c.twitch_drops_client.clone(), c.kick_web_token.clone())
    };
    blocking(move || {
        let tw = if web.is_empty() {
            json!({ "connected": false })
        } else {
            match twitch_drops_fresh(&app, &web, &client) {
                Ok((_, list)) => json!({ "connected": true, "campaigns": list }),
                Err(e) => json!({ "connected": true, "error": e }),
            }
        };
        let kk = match kick_drops_merged(&session) {
            Ok(list) => json!({ "connected": !session.is_empty(), "campaigns": list }),
            Err(e) => json!({ "connected": !session.is_empty(), "error": e }),
        };
        json!({ "twitch": tw, "kick": kk })
    })
    .await
}

#[tauri::command]
async fn drops_claim(platform: Platform, id: String, campaign: Option<String>) -> Result<(), String> {
    let (web, client, session) = {
        let c = cfg();
        (c.twitch_web_token.clone(), c.twitch_drops_client.clone(), c.kick_web_token.clone())
    };
    blocking(move || match platform {
        Platform::Twitch => twitch::claim_drop(&client, &web, &id),
        Platform::Kick => kick::claim_drop(&session, campaign.as_deref().unwrap_or(""), &id),
    })
    .await
}

/// Every 10 minutes: refresh the Twitch token shortly before it expires, so chat, points and follows keep
/// working in long sessions. Chat picks the new token up on its next reconnect.
fn token_keeper() {
    loop {
        std::thread::sleep(std::time::Duration::from_secs(600));
        let Some(a) = cfg().twitch.clone() else { continue };
        match auth::twitch_keep_fresh(&a) {
            Ok(Some(fresh)) => {
                {
                    let mut c = cfg();
                    if c.twitch.as_ref().is_some_and(|x| x.login == fresh.login) {
                        c.twitch = Some(fresh);
                    }
                }
                save();
                log_line("[auth] Twitch token refreshed");
            }
            Ok(None) => {}
            Err(e) => log_line(&format!("[auth] Twitch token refresh failed: {e}")),
        }
    }
}

/// Every 5 minutes: claim finished drops (if auto-claim is on) and notify.
fn drops_claimer(app: AppHandle) {
    use tauri_plugin_notification::NotificationExt;
    loop {
        std::thread::sleep(std::time::Duration::from_secs(300));
        let (web, client, session, auto) = {
            let c = cfg();
            (c.twitch_web_token.clone(), c.twitch_drops_client.clone(), c.kick_web_token.clone(), c.auto_claim)
        };
        if !auto {
            continue;
        }
        let mut claimed = Vec::new();
        if !web.is_empty() {
            if let Ok((_, list)) = twitch_drops_fresh(&app, &web, &client) {
                for c in &list {
                    for d in c["drops"].as_array().cloned().unwrap_or_default() {
                        let done = d["progress"].as_u64().unwrap_or(0) >= d["required"].as_u64().unwrap_or(u64::MAX);
                        if let (true, false, Some(inst)) = (done, d["claimed"] == true, d["instance"].as_str()) {
                            if twitch::claim_drop(&client, &web, inst).is_ok() {
                                claimed.push(format!("{} ({})", d["name"].as_str().unwrap_or("drop"), c["game"].as_str().unwrap_or("Twitch")));
                            }
                        }
                    }
                }
            }
        }
        if !session.is_empty() {
            if let Ok(list) = kick_drops_merged(&session) {
                for c in &list {
                    for r in c["rewards"].as_array().cloned().unwrap_or_default() {
                        let p = r["progress"].as_f64().unwrap_or(0.0);
                        if p >= 1.0 && r["claimed"] != true {
                            if let (Some(cid), Some(rid)) = (c["id"].as_str(), r["id"].as_str()) {
                                if kick::claim_drop(&session, cid, rid).is_ok() {
                                    claimed.push(format!("{} ({})", r["name"].as_str().unwrap_or("drop"), c["category"]["name"].as_str().unwrap_or("Kick")));
                                }
                            }
                        }
                    }
                }
            }
        }
        for c in claimed {
            let _ = app.notification().builder().title("Drop claimed").body(c).show();
        }
    }
}

// ------------------------------------------------------------------ chat

fn gen_alive(gen: u64) -> bool {
    CHAT_GEN.load(Ordering::SeqCst) == gen
}

/// Sleep in small steps; false if the channel changed meanwhile.
fn nap(gen: u64, secs: u64) -> bool {
    for _ in 0..secs {
        if !gen_alive(gen) {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
    gen_alive(gen)
}

/// While a Twitch channel is open: report watching (points + drops) and auto-claim bonus chests.
fn twitch_watcher(app: AppHandle, gen: u64, login: String) {
    let mut n: u64 = 0;
    loop {
        let (tv, web, client, auto) = {
            let c = cfg();
            (c.twitch.clone(), c.twitch_web_token.clone(), c.twitch_drops_client.clone(), c.auto_claim)
        };
        let Some(tv) = tv else { return };
        // Prefer the website session (drops need it); otherwise the TV sign-in.
        let _ = if !web.is_empty() && !client.is_empty() {
            twitch::watch_tick(&web, &client, &login)
        } else {
            twitch::watch_tick(&tv.token, auth::TWITCH_CLIENT_ID, &login)
        };
        if n.is_multiple_of(3) {
            if let Ok(mut p) = twitch::points(&tv.token, &login) {
                if let (true, Some(claim), Some(ch)) = (auto, p["claim"].as_str().map(String::from), p["channel_id"].as_str().map(String::from)) {
                    if twitch::claim_points(&tv.token, &ch, &claim).is_ok() {
                        let _ = app.emit("toast", "Claimed a channel points bonus");
                        p = twitch::points(&tv.token, &login).unwrap_or(p);
                    }
                }
                p["gen"] = json!(gen);
                let _ = app.emit("points", p);
            }
        }
        n += 1;
        if !nap(gen, 20) {
            return;
        }
    }
}

/// Join a channel's chat. Messages arrive as `chat` events tagged with the returned generation.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn chat_join(
    app: AppHandle,
    platform: Platform,
    login: String,
    display: Option<String>,
    kick_chatroom: Option<u64>,
    #[allow(unused_variables)] kick_user_id: Option<u64>,
    kick_channel_id: Option<u64>,
    history: Option<bool>,
) -> u64 {
    let history = history.unwrap_or(true);
    let gen = CHAT_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, rx) = mpsc::channel::<ChatMsg>();
    *CHAT_OUT.lock().unwrap() = None;
    *CHAT_KICK_ROOM.lock().unwrap() = kick_chatroom;
    let ctx = json!({ "gen": gen, "platform": platform, "login": login, "display": display.unwrap_or_else(|| login.clone()) });
    *CHAT_CTX.lock().unwrap() = Some(ctx.clone());
    let _ = app.emit("chat-context", ctx);
    match platform {
        Platform::Twitch => {
            let signed = cfg().twitch.is_some();
            let auth = || cfg().twitch.as_ref().map(|a| (a.login.clone(), a.token.clone()));
            twitch::watch_raids(login.to_lowercase(), tx.clone(), move || gen_alive(gen));
            *CHAT_OUT.lock().unwrap() = Some(twitch::spawn_chat(login.to_lowercase(), auth, tx, move || gen_alive(gen), history));
            if signed {
                let (app2, l) = (app.clone(), login.to_lowercase());
                std::thread::spawn(move || twitch_watcher(app2, gen, l));
            }
        }
        Platform::Kick => {
            match kick_chatroom {
                Some(room) => kick::spawn_chat(kick_channel_id, room, tx, move || gen_alive(gen), history),
                None => {
                    let _ = tx.send(ChatMsg::system("Chat is unavailable for this channel."));
                }
            }
            let session = cfg().kick_web_token.clone();
            if let (false, Some(id)) = (session.is_empty(), kick_channel_id) {
                std::thread::spawn(move || {
                    let _ = kick::watch_for_drops(&session, id, || gen_alive(gen));
                });
            }
        }
    }
    std::thread::spawn(move || {
        // Batch messages so a busy chat doesn't flood the UI with one event per line.
        loop {
            let Ok(first) = rx.recv() else { return };
            let mut batch = vec![first];
            std::thread::sleep(std::time::Duration::from_millis(60));
            while let Ok(m) = rx.try_recv() {
                batch.push(m);
            }
            if CHAT_GEN.load(Ordering::SeqCst) != gen {
                return; // dropping rx stops the chat thread
            }
            let _ = app.emit("chat", json!({ "gen": gen, "messages": batch }));
        }
    });
    gen
}

/// Leaving a channel: stop chat, watch reporting and drop tracking.
#[tauri::command]
fn chat_leave(app: AppHandle) {
    CHAT_GEN.fetch_add(1, Ordering::SeqCst);
    *CHAT_OUT.lock().unwrap() = None;
    *CHAT_CTX.lock().unwrap() = None;
    let _ = app.emit("chat-context", serde_json::Value::Null);
}

#[tauri::command]
fn chat_context() -> Option<serde_json::Value> {
    CHAT_CTX.lock().unwrap().clone()
}

#[tauri::command]
async fn chat_send(platform: Platform, text: String, reply_to: Option<String>, reply_name: Option<String>, reply_text: Option<String>) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Ok(());
    }
    let reply_to = reply_to.filter(|r| !r.is_empty());
    match platform {
        Platform::Twitch => {
            let out = CHAT_OUT.lock().unwrap().clone();
            match out {
                Some(o) if cfg().twitch.is_some() => o.send((reply_to, text)).map_err(|_| "Chat is disconnected".to_string()),
                _ => Err("Sign in to Twitch to chat.".into()),
            }
        }
        Platform::Kick => {
            let a = cfg().kick.clone().filter(|a| a.web).ok_or("Sign in to Kick to chat.")?;
            let room = CHAT_KICK_ROOM.lock().unwrap().ok_or("Channel info is still loading.")?;
            blocking(move || {
                let reply = reply_to.as_deref().map(|id| (id, reply_name.as_deref().unwrap_or(""), reply_text.as_deref().unwrap_or("")));
                kick::send_message(&a.token, room, &text, reply).map_err(|e| format!("Kick didn't send your message: {e}"))
            })
            .await
        }
    }
}

/// `duostream twitch:name` / `duostream kick:name` / a channel URL opens it on launch.
#[tauri::command]
fn startup_arg() -> Option<String> {
    std::env::args().skip(1).find(|a| !a.starts_with("--"))
}

/// Debug builds only: DUOSTREAM_PREVIEW=1 skips the sign-in gate for testing.
#[tauri::command]
fn preview_mode() -> bool {
    cfg!(debug_assertions) && std::env::var_os("DUOSTREAM_PREVIEW").is_some()
}

#[tauri::command]
fn ad_status(login: Option<String>) -> serde_json::Value {
    json!({
        "ad_break": adblock::ad_break(login.as_deref()),
        "ads_blocked": adblock::ADS_BLOCKED.load(Ordering::Relaxed),
    })
}

// ------------------------------------------------------------------ chat enhancer

#[tauri::command]
fn ce_load() -> serde_json::Value {
    cfg().chat_enhancer.clone()
}

/// Save Chat Enhancer settings and tell every window (main + pop-out chat) to apply them.
#[tauri::command]
fn ce_save(app: AppHandle, settings: serde_json::Value) -> Result<(), String> {
    if settings.to_string().len() > 2_000_000 {
        return Err("Chat settings are too large".into());
    }
    cfg().chat_enhancer = settings.clone();
    save();
    let _ = app.emit("ce-changed", settings);
    Ok(())
}

/// Desktop notification (used for chat mentions while the app is in the background).
#[tauri::command]
fn notify_desktop(app: AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt;
    let t: String = title.chars().take(80).collect();
    let b: String = body.chars().take(240).collect();
    let _ = app.notification().builder().title(t).body(b).show();
}

/// Front-end errors go to %APPDATA%\duostream\ui.log (release builds have no devtools).
#[tauri::command]
fn js_log(msg: String) {
    log_line(&msg);
}

fn log_line(msg: &str) {
    use std::io::Write;
    if let Some(d) = std::env::var_os("APPDATA") {
        let p = std::path::PathBuf::from(d).join("duostream").join("ui.log");
        if std::fs::metadata(&p).map(|m| m.len() > 512 * 1024).unwrap_or(false) {
            let _ = std::fs::remove_file(&p);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
            let _ = writeln!(f, "{msg}");
        }
    }
}

#[tauri::command]
fn open_external(url: String) {
    if (url.starts_with("https://") || url.starts_with("http://")) && !url.contains(char::is_whitespace) {
        auth::open_browser(&url);
    }
}

// ------------------------------------------------------------------ updates

/// Check GitHub releases for a newer version: Some({version, notes}) or None.
#[tauri::command]
async fn update_check(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let u = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(u.map(|u| json!({ "version": u.version, "notes": u.body })))
}

/// Download + install the update (reporting `update-progress` events), then restart.
#[tauri::command]
async fn update_install(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let Some(u) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? else { return Ok(()) };
    let (a1, a2) = (app.clone(), app.clone());
    let mut done: u64 = 0;
    u.download_and_install(
        move |chunk, total| {
            done += chunk as u64;
            let _ = a1.emit("update-progress", json!({ "done": done, "total": total }));
        },
        move || {
            let _ = a2.emit("update-progress", json!({ "installing": true }));
        },
    )
    .await
    .map_err(|e| e.to_string())?;
    app.restart();
}

/// Installed version (from tauri.conf.json).
#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Windows labels toasts by AppUserModelID. Register ours (name + icon) so notifications say
/// "duostream" instead of borrowing PowerShell's, even when the app wasn't installed.
const APP_ID: &str = "com.duostream.app";

fn register_notification_identity(identifier: &str) {
    use std::os::windows::process::CommandExt;
    let Some(dir) = std::env::var_os("APPDATA").map(|d| std::path::PathBuf::from(d).join("duostream")) else { return };
    let _ = std::fs::create_dir_all(&dir);
    let icon = dir.join("icon.png");
    let _ = std::fs::write(&icon, include_bytes!("../icons/icon.png"));
    let key = format!(r"HKCU\Software\Classes\AppUserModelId\{identifier}");
    for (name, val) in [("DisplayName", "duostream".to_string()), ("IconUri", icon.to_string_lossy().into_owned())] {
        let _ = std::process::Command::new("reg")
            .args(["add", &key, "/v", name, "/t", "REG_SZ", "/d", &val, "/f"])
            .creation_flags(0x0800_0000)
            .status();
    }
}

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("{info}\n{}\n", std::backtrace::Backtrace::force_capture());
        if let Some(d) = std::env::var_os("APPDATA") {
            let p = std::path::PathBuf::from(d).join("duostream");
            let _ = std::fs::create_dir_all(&p);
            let _ = std::fs::write(p.join("crash.log"), msg);
        }
    }));
    register_notification_identity(APP_ID);
    {
        let saved = cfg().twitch_integrity.clone();
        if !saved.is_null() {
            *adblock::INTEGRITY.lock().unwrap() = Some(saved);
        }
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch (desktop shortcut, `duostream.exe twitch:name`): show this window instead.
            show_main(app);
            if let Some(arg) = argv.get(1).filter(|a| !a.is_empty()) {
                let _ = app.emit("open-arg", arg.clone());
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            seed_builtin_plugins(app);
            if cfg().autostart {
                let _ = autostart_registry(true); // the exe may have moved (update / reinstall)
            }
            if !std::env::args().any(|a| a == "--tray") {
                use tauri::Manager;
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                }
            }
            let open = MenuItem::with_id(app, "open", "Open duostream", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main").tooltip("duostream").menu(&menu).show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, e| match e.id.as_ref() {
                "quit" => app.exit(0),
                "open" => show_main(app),
                _ => {}
            })
            .on_tray_icon_event(|tray, e| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                    show_main(tray.app_handle());
                }
            })
            .build(app)?;
            let handle = app.handle().clone();
            std::thread::spawn(move || live_notifier(handle));
            let handle = app.handle().clone();
            std::thread::spawn(move || drops_claimer(handle));
            std::thread::spawn(token_keeper);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    if cfg().close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                        let _ = window.emit("window-hidden", ());
                    } else {
                        tauri::Manager::app_handle(window).exit(0); // pop-out chat / PiP would otherwise be left without the app
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            tray_sleep,
            get_state,
            set_prefs,
            restore_sessions,
            follows_status,
            resolve,
            play_url,
            search,
            set_follow,
            twitch_login_start,
            login_cancel,
            sign_out,
            chat_join,
            chat_send,
            ad_status,
            startup_arg,
            preview_mode,
            suggest,
            plugins_list,
            plugin_install,
            plugin_uninstall,
            plugin_set_enabled,
            fetch_text_url,
            open_plugins_dir,
            set_plugin_sources,
            open_external,
            js_log,
            ce_load,
            pip_open,
            show_main_window,
            ce_save,
            notify_desktop,
            update_check,
            update_install,
            app_version,
            search_all,
            browse_page,
            save_clip,
            reveal_file,
            set_category_follow,
            set_hidden,
            chat_leave,
            chat_context,
            channel_about,
            channel_videos,
            video_play,
            categories,
            category_streams,
            chat_emotes,
            user_card,
            twitch_badges,
            popout_chat,
            points_status,
            points_redeem,
            drops_connect,
            drops_disconnect,
            drops_status,
            drops_claim,
            set_notify,
            twitch_link,
            set_autostart,
            user_id
        ])
        .run(tauri::generate_context!())
        .expect("failed to start duostream");
}
