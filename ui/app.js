"use strict";
// duostream front end. Talks to the Rust backend through Tauri commands/events.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const appWindow = window.__TAURI__.window.getCurrentWindow();
const APP_VERSION = "0.6.0";
window.addEventListener("error", (e) => invoke("js_log", { msg: `${new Date().toISOString()} ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}` }).catch(() => {}));
window.addEventListener("unhandledrejection", (e) => invoke("js_log", { msg: `${new Date().toISOString()} unhandled: ${e.reason?.stack || e.reason}` }).catch(() => {}));

// ------------------------------------------------------------------ helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(n ?? 0);
const parseTs = (s) => { if (!s) return null; let x = s.trim().replace(" ", "T"); if (!/Z|[+-]\d\d:?\d\d$/.test(x)) x += "Z"; const t = Date.parse(x); return isNaN(t) ? null : t; };
const upShort = (s) => { const t = parseTs(s); if (!t) return ""; const m = Math.max(0, Math.floor((Date.now() - t) / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`; };
const upClock = (s) => { const t = parseTs(s); if (!t) return ""; const x = Math.max(0, Math.floor((Date.now() - t) / 1000)); return `${String(Math.floor(x / 3600)).padStart(2, "0")}:${String(Math.floor(x / 60) % 60).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
const akey = (p, l) => (p === "Twitch" ? "t:" : "k:") + l;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const svg = (d, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const I = {
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  heart: svg('<path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6a5 5 0 1 1 7.5 6.6Z"/>'),
  heartFill: svg('<path fill="currentColor" d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6a5 5 0 1 1 7.5 6.6Z"/>'),
  play: svg('<path fill="currentColor" stroke="none" d="M7 4.5v15l12-7.5z"/>'),
  pause: svg('<path fill="currentColor" stroke="none" d="M6 4h4v16H6zM14 4h4v16h-4z"/>'),
  vol: svg('<path fill="currentColor" d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  mute: svg('<path fill="currentColor" d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>'),
  full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  unfull: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  theater: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 15h20"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  chevL: svg('<path d="m15 18-6-6 6-6"/>'),
  chevR: svg('<path d="m9 18 6-6-6-6"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  shield: svg('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
  chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.5A8 8 0 1 1 21 12Z"/>'),
  arrowCollapse: svg('<path d="M13 17l5-5-5-5M6 17l5-5-5-5"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  accounts: svg('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 3a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>'),
  puzzle: svg('<path d="M10 3h4v3a2 2 0 1 0 4 0V3h3v7h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H3v-7h3a2 2 0 1 0 0-4H3V3h7z"/>'),
  expand: svg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5"/>'),
  bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>'),
  sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  star: svg('<path fill="currentColor" d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  note: svg('<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 12h8M8 16h5"/>'),
  copy: svg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
  ban: svg('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'),
  palette: svg('<path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.2-1-1.6-1-2.7 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/>'),
  at: svg('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>'),
  sparkle: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
  smile: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>'),
  reply: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  popout: svg('<path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
  points: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10" />'),
  gift: svg('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>'),
  live: svg('<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  scissors: svg('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>'),
  pip: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="11" width="8" height="7" rx="1" fill="currentColor"/>'),
};

// Platform marks (Twitch glitch, Kick K) shown on avatars, tags and account rows.
const PICON = {
  Twitch: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>',
  Kick: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z"/></svg>',
};
const pbadge = (p, cls = "") => `<span class="badge ${p === "Twitch" ? "t" : "k"} ${cls}" title="${p}">${PICON[p]}</span>`;
const ptag = (p) => `<span class="tag ptag ${p === "Twitch" ? "t" : "k"}">${PICON[p]}${p}</span>`;

function avatar(platform, url, name, cls = "", ring = false) {
  const letter = esc((name || "?").slice(0, 1).toUpperCase());
  const img = url
    ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;ph&quot;>${letter}</div>'">`
    : `<div class="ph">${letter}</div>`;
  return `<div class="avatar ${cls} ${ring ? "live-ring" : ""}">${img}${pbadge(platform)}</div>`;
}

// per-channel memory: volume + quality
const chPrefKey = (ch) => `chp:${akey(ch.platform, ch.login)}`;
function chPref(ch) { try { return JSON.parse(localStorage.getItem(chPrefKey(ch)) || "{}"); } catch { return {}; } }
function setChPref(ch, patch) { try { localStorage.setItem(chPrefKey(ch), JSON.stringify({ ...chPref(ch), ...patch })); } catch {} }
const fmtDur = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`; };
const ago = (d) => { const t = parseTs(d); if (!t) return ""; const s = (Date.now() - t) / 1000; const u = [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"]].find(([n]) => s >= n); if (!u) return "just now"; const n = Math.floor(s / u[0]); return `${n} ${u[1]}${n > 1 ? "s" : ""} ago`; };

// Viewer counts tween from their last shown value, flashing green (up) or red (down).
const countMemo = new Map();
function animateCounts(root = document) {
  root.querySelectorAll("[data-n]").forEach((node) => {
    const k = node.dataset.k, n = +node.dataset.n, full = "full" in node.dataset;
    const show = (x) => (full ? Math.round(x).toLocaleString() : fmt(Math.round(x)));
    const prev = countMemo.get(k);
    countMemo.set(k, n);
    if (prev == null || prev === n) { node.textContent = show(n); return; }
    node.textContent = show(prev);
    node.classList.remove("cnt-up", "cnt-down");
    void node.offsetWidth;
    node.classList.add(n > prev ? "cnt-up" : "cnt-down");
    const t0 = performance.now(), dur = 900;
    const step = (t) => {
      const f = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - f, 3);
      node.textContent = show(prev + (n - prev) * e);
      if (f < 1 && node.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 4500);
}

// ------------------------------------------------------------------ state
const S = {
  st: null, // backend AppState
  view: "following",
  browse: { cards: [], loading: false, error: null, at: 0, tab: "foryou", more: false, loadingMore: false, twitchCursor: null, kickPage: null,
    f: { platform: "all", sort: "viewers", language: "", tag: "", drops: false } },
  forYou: { at: 0, sections: null },
  following: { tab: "live" },
  search: null,
  chatRaw: [], // raw (pre-filter) messages, so Chat Enhancer changes can re-render instantly
  chatView: { platform: "all", query: "", paused: false, pending: 0 },
  settingsTab: "app",
  ceTab: "general",
  follows: { rows: null, loading: false },
  ch: null, // current channel (also while minimized)
  mini: false, // channel is playing in the mini player
  chatGen: 0,
  theater: false,
  twitchCode: null,
  kickBusy: false,
  preview: false,
  shop: { tab: "installed", registry: [], loading: false, error: null },
  cats: { list: [], loading: false, error: null, at: 0 },
  cat: null, // { name, twitch, kick, cards, loading, error }
  drops: { data: null, loading: false },
  popped: false, // chat lives in its own window
  popout: false, // this window IS the pop-out chat
  chatMsgs: [], // recent message objects (user cards, @-completion)
  replyTo: null,
  points: null,
  badges: {}, // Twitch "set/version" -> url
  kickSubBadges: [],
};
const signedIn = () => !!(S.st && (S.st.twitch || S.st.kick || S.preview));
const isFollowed = (p, l) => S.st.follows.some((f) => f.platform === p && f.login === l);

// ================================================================== plugin host
// Plugins are plain JS run with an `api` object. See PLUGINS.md for the full reference.
const Plugins = {
  installed: [], // { manifest, code, enabled } from the backend
  loaded: new Map(), // id -> { api, unload: [], hooks: {event: [fn]} }
  ui: { nav: [], player: [], badges: [] },

  emit(event, payload) {
    for (const [id, p] of this.loaded) for (const fn of p.hooks[event] || []) {
      try { fn(payload); } catch (e) { console.error(`[plugin ${id}]`, e); }
    }
  },
  /** chat:message hooks may return false (hide) or a changed message object. */
  filterChat(m) {
    for (const [id, p] of this.loaded) for (const fn of p.hooks["chat:message"] || []) {
      try { const r = fn(m); if (r === false) return null; if (r && typeof r === "object") m = r; } catch (e) { console.error(`[plugin ${id}]`, e); }
    }
    return m;
  },

  makeApi(manifest) {
    const id = manifest.id;
    const rec = { hooks: {}, unload: [] };
    const own = (list, item) => { item.owner = id; list.push(item); return item; };
    const api = {
      id, manifest, appVersion: APP_VERSION, icons: I,
      on(event, fn) { (rec.hooks[event] ||= []).push(fn); },
      onUnload(fn) { rec.unload.push(fn); },
      toast,
      addStyle(css) { const s = document.createElement("style"); s.dataset.plugin = id; s.textContent = css; document.head.appendChild(s); rec.unload.push(() => s.remove()); return s; },
      addNavButton(opts) {
        const item = own(Plugins.ui.nav, { ...opts });
        renderNav();
        return { update(o) { Object.assign(item, o); renderNav(); }, remove() { Plugins.ui.nav = Plugins.ui.nav.filter((x) => x !== item); renderNav(); } };
      },
      addPlayerButton(opts) {
        const item = own(Plugins.ui.player, { ...opts });
        renderPlayerExtras();
        return { update(o) { Object.assign(item, o); renderPlayerExtras(); }, remove() { Plugins.ui.player = Plugins.ui.player.filter((x) => x !== item); renderPlayerExtras(); } };
      },
      addPlayerBadge(text) {
        const item = own(Plugins.ui.badges, { text, visible: false });
        return { show(v = true) { item.visible = v; renderPlayerExtras(); }, setText(t) { item.text = t; renderPlayerExtras(); }, remove() { Plugins.ui.badges = Plugins.ui.badges.filter((x) => x !== item); renderPlayerExtras(); } };
      },
      storage: {
        get(key, def) { try { const v = localStorage.getItem(`plugin:${id}:${key}`); return v === null ? def : JSON.parse(v); } catch { return def; } },
        set(key, val) { try { localStorage.setItem(`plugin:${id}:${key}`, JSON.stringify(val)); } catch {} },
      },
      channel() { return S.ch ? { platform: S.ch.platform, login: S.ch.login, display: S.ch.info.display, title: S.ch.info.title, category: S.ch.info.category, live: S.ch.info.live, viewers: S.ch.info.viewers } : null; },
      view() { return S.view; },
      me() { return { twitch: S.st.twitch?.name || null, kick: S.st.kick?.name || null }; },
      openChannel(platform, login) { openChannel(platform, login); },
      reloadPlayer() { if (S.ch?.info.live) startPlayback(); },
      adStatus() { return invoke("ad_status"); },
    };
    return { api, rec };
  },

  load(p) {
    const m = p.manifest;
    if (this.loaded.has(m.id)) return;
    const { api, rec } = this.makeApi(m);
    this.loaded.set(m.id, rec);
    try {
      new Function("api", `"use strict";\n${p.code}\n//# sourceURL=plugin-${m.id}.js`)(api);
    } catch (e) {
      console.error(e);
      toast(`Plugin "${m.name}" failed to start: ${e.message}`);
      this.unload(m.id);
    }
  },

  unload(id) {
    const rec = this.loaded.get(id);
    if (!rec) return;
    for (const fn of rec.unload) { try { fn(); } catch (e) { console.error(e); } }
    this.loaded.delete(id);
    for (const k of Object.keys(this.ui)) this.ui[k] = this.ui[k].filter((x) => x.owner !== id);
    renderNav();
    renderPlayerExtras();
  },

  async refresh() {
    this.installed = await invoke("plugins_list");
    for (const p of this.installed) {
      if (p.enabled && !this.loaded.has(p.manifest.id)) this.load(p);
      if (!p.enabled && this.loaded.has(p.manifest.id)) this.unload(p.manifest.id);
    }
    for (const id of [...this.loaded.keys()]) if (!this.installed.some((p) => p.manifest.id === id)) this.unload(id);
  },
};

// ------------------------------------------------------------------ sign-in gate / accounts
function providersHTML() {
  const tw = S.st.twitch, kk = S.st.kick;
  const twitchBody = tw
    ? `<div class="signed">${avatar("Twitch", tw.avatar, tw.name, "lg")}<div class="grow">${esc(tw.name)}</div><button class="btn secondary sm" data-act="signout" data-p="Twitch">Sign out</button></div>`
    : S.twitchCode
      ? `<div class="note">Your browser opened twitch.tv/activate. Confirm this code there:</div>
         <div class="code">${esc(S.twitchCode)}</div>
         <div class="note" style="text-align:center">Waiting for approval…</div>
         <button class="btn secondary" data-act="tw-cancel">Cancel</button>`
      : `<div class="note">Your Twitch follows load automatically. Chat and follow buttons act on your account.</div>
         <button class="btn twitch" data-act="tw-login">Continue with Twitch</button>`;
  const kickBody = kk
    ? `<div class="signed">${avatar("Kick", kk.avatar, kk.name, "lg")}<div class="grow">${esc(kk.name)}</div><button class="btn secondary sm" data-act="signout" data-p="Kick">Sign out</button></div>
       ${S.st.kick_drops ? ""
         : `<div class="note">You're on the old Kick sign-in, which can't load your follows or drops. Switch once to fix that.</div>
            <button class="btn primary" data-act="kick-web">Switch to the new Kick login</button>`}`
    : S.kickBusy
      ? `<div class="note">Log in to Kick in the window that opened. It closes by itself when you're done.</div>
         <button class="btn secondary" data-act="kick-cancel">Cancel</button>`
      : `<div class="note">Your Kick follows load automatically. Chat, follow buttons and drops act on your account.</div>
         <button class="btn primary" data-act="kick-web">Continue with Kick</button>`;
  return `
    <div class="provider"><div class="phead">${pbadge("Twitch", "big")}<span class="grow">Twitch</span>${tw ? '<span class="ok-pill">Signed in</span>' : ""}</div>${twitchBody}</div>
    <div class="provider"><div class="phead">${pbadge("Kick", "big")}<span class="grow">Kick</span>${kk ? '<span class="ok-pill">Signed in</span>' : ""}</div>${kickBody}</div>`;
}

function renderGate() {
  $("#gate").innerHTML = `<div class="gate-drag" data-tauri-drag-region></div><div class="box">
      <div class="logo"><svg class="mark" viewBox="0 0 314 215" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-width="20" stroke-linejoin="round"><polygon points="131.14,10 227.86,10 120.86,117 24.14,117"/><polygon points="193.14,98 289.86,98 182.86,205 86.14,205"/></g></svg><span class="word">duostream</span></div>
      <h1>Log in</h1>
      <p class="lead">Sign in to Twitch, Kick, or both to start watching.</p>
      ${providersHTML()}
      ${signedIn() ? '<button class="btn primary continue" data-act="enter">Continue</button>' : ""}
    </div>`;
}

async function onProviderAction(act, btn) {
  try {
    if (act === "tw-login") {
      const [code] = await invoke("twitch_login_start");
      S.twitchCode = code;
    } else if (act === "tw-cancel") {
      await invoke("login_cancel");
      S.twitchCode = null;
    } else if (act === "kick-web") {
      await invoke("drops_connect", { platform: "Kick" });
      S.kickBusy = true;
    } else if (act === "kick-cancel") {
      S.kickBusy = false;
    } else if (act === "kick-login") {
      const clientId = $("#kickId").value.trim();
      const secretInput = $("#kickSecret").value.trim();
      S.kickBusy = true;
      rerenderAuth();
      try {
        toast(await invoke("kick_login", { clientId, clientSecret: secretInput || (S.st.has_kick_secret ? "__keep__" : "") }));
      } finally {
        S.kickBusy = false;
      }
    } else if (act === "signout") {
      await invoke("sign_out", { platform: btn.dataset.p });
    } else if (act === "enter") {
      enterApp();
      return;
    }
  } catch (e) {
    toast(String(e));
  }
  S.st = await invoke("get_state");
  rerenderAuth();
}

function rerenderAuth() {
  if (!$("#gate").classList.contains("hidden")) renderGate();
  if (S.view === "accounts") renderMain();
  renderNav();
}

// ------------------------------------------------------------------ navbar
function renderNav() {
  if (!S.st) return;
  const navView = ["categories", "category"].includes(S.view) ? "browse" : S.view;
  $$(".navlink").forEach((a) => a.classList.toggle("active", a.dataset.view === navView));
  const r = $("#navRight");
  const accts = [["Twitch", S.st.twitch], ["Kick", S.st.kick]].filter(([, a]) => a);
  r.innerHTML = `
    ${Plugins.ui.nav.map((b, i) => `<button class="icon-btn plugin-btn ${b.active ? "on" : ""}" data-pnav="${i}" title="${esc(b.title || "")}">${b.icon || I.puzzle}</button>`).join("")}
    <button class="icon-btn" data-view-btn="plugins" title="Plugins">${I.puzzle}</button>
    ${accts.length < 2 ? '<button class="btn secondary sm" data-view-btn="accounts">Add account</button>' : ""}
    ${accts.map(([p, a]) => `<button class="nav-avatar" data-acct="${p}" title="${esc(a.name)} on ${p}">${avatar(p, a.avatar, a.name)}</button>`).join("")}`;
}

function openMenu(x, y, items) {
  closeMenu();
  const m = el(`<div class="menu" id="ctxMenu">${items
    .map((it, i) => (it === "-" ? '<div class="sep"></div>' : it.html ? `<div class="who">${it.html}</div>` : `<button data-i="${i}">${it.icon || ""}<span>${esc(it.label)}</span></button>`))
    .join("")}</div>`);
  document.body.appendChild(m);
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(x, innerWidth - w - 8) + "px";
  m.style.top = Math.min(y, innerHeight - h - 8) + "px";
  m.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    closeMenu();
    items[+b.dataset.i].run();
  });
}
function closeMenu() { $("#ctxMenu")?.remove(); }

// ------------------------------------------------------------------ search + suggestions
// suggestItems: flat list of selectable rows: { kind: "channel"|"category"|"recent"|"all", ... }
let suggestItems = [], suggestIdx = -1, suggestSeq = 0;
const recentSearches = () => { try { return JSON.parse(localStorage.getItem("recentSearches") || "[]"); } catch { return []; } };
function addRecent(q) {
  q = q.trim(); if (!q) return;
  const list = [q, ...recentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  try { localStorage.setItem("recentSearches", JSON.stringify(list)); } catch {}
}
function showRecent() {
  const list = recentSearches();
  if (!list.length) { hideSuggest(); return; }
  suggestItems = list.map((q) => ({ kind: "recent", q }));
  suggestIdx = -1;
  $("#suggest").classList.remove("hidden");
  renderSuggest();
}
const runSuggest = debounce(async (q) => {
  const seq = ++suggestSeq;
  if (!q.trim()) { showRecent(); return; }
  if (q.trim().length < 2 || /twitch\.tv|kick\.com/.test(q)) { hideSuggest(); return; }
  const box = $("#suggest");
  if (!suggestItems.length || suggestItems[0].kind === "recent") box.innerHTML = `<div class="sg-loading">Searching Twitch and Kick…</div>`;
  box.classList.remove("hidden");
  const r = await invoke("suggest", { q }).catch(() => ({ channels: [], categories: [] }));
  if (seq !== suggestSeq) return;
  suggestItems = [
    ...r.channels.filter((c) => !isHiddenChannel(c.platform, c.login)).map((c) => ({ kind: "channel", ...c })),
    ...r.categories.filter((c) => !isHiddenCategory(c.name)).map((c) => ({ kind: "category", ...c })),
    { kind: "all", q: q.trim() },
  ];
  suggestIdx = -1;
  renderSuggest();
}, 200);

function renderSuggest() {
  const box = $("#suggest");
  let lastKind = null;
  box.innerHTML = suggestItems.map((s, i) => {
    const head = s.kind !== lastKind && (s.kind === "channel" || s.kind === "category" || s.kind === "recent") ? `<div class="sg-head">${{ channel: "Channels", category: "Categories", recent: "Recent searches" }[s.kind]}</div>` : "";
    lastKind = s.kind;
    const sel = i === suggestIdx ? "sel" : "";
    if (s.kind === "channel") return head + `<div class="sg-row ${sel}" data-sg="${i}">
      ${avatar(s.platform, s.avatar, s.display)}
      <div class="sinfo"><div class="name">${esc(s.display)}</div>${s.live ? `<div class="cat">${esc(s.category || "Live")}</div>` : ""}</div>
      ${s.live ? `<span class="count"><span class="live-dot"></span>${fmt(s.viewers)}</span>` : '<span class="off">Offline</span>'}</div>`;
    if (s.kind === "category") return head + `<div class="sg-row ${sel}" data-sg="${i}">
      <div class="sg-art">${s.art ? `<img src="${esc(s.art)}" alt="">` : ""}</div>
      <div class="sinfo"><div class="name">${esc(s.name)}</div><div class="cat">${fmt(s.viewers || 0)} viewers</div></div>
      <span class="plats">${s.twitch ? PICON.Twitch : ""}${s.kick ? PICON.Kick : ""}</span></div>`;
    if (s.kind === "recent") return head + `<div class="sg-row recent ${sel}" data-sg="${i}">${I.refresh}<div class="sinfo"><div class="name">${esc(s.q)}</div></div><button class="icon-btn sg-x" data-sgdel="${esc(s.q)}" title="Remove">${I.close}</button></div>`;
    return `<div class="sg-row all ${sel}" data-sg="${i}">${I.search}<div class="sinfo"><div class="name">See all results for "${esc(s.q)}"</div></div></div>`;
  }).join("") || `<div class="sg-loading">Nothing found</div>`;
}
function hideSuggest() { suggestSeq++; $("#suggest")?.classList.add("hidden"); suggestItems = []; suggestIdx = -1; }

function pickSuggestion(s) {
  const input = $("#searchInput");
  if (s.kind === "channel") { addRecent(input.value || s.display); input.value = ""; input.blur(); openChannel(s.platform, s.login); }
  else if (s.kind === "category") { addRecent(input.value || s.name); input.value = ""; input.blur(); hideSuggest(); openCategory(s); }
  else if (s.kind === "recent") { input.value = s.q; doSearch(s.q); }
  else doSearch(s.q);
}

async function doSearch(q) {
  q = q.trim();
  hideSuggest();
  if (!q) return;
  const low = q.toLowerCase();
  const pick = (marker, p) => { const i = low.indexOf(marker); if (i < 0) return null; const name = q.slice(i + marker.length).split(/[/?#]/)[0]; return name ? [p, name] : null; };
  const link = pick("twitch.tv/", "Twitch") || pick("kick.com/", "Kick");
  const input = $("#searchInput");
  input.value = "";
  input.blur();
  if (link) return openChannel(link[0], link[1]);
  addRecent(q);
  openSearchPage(q);
}

// ------------------------------------------------------------------ search results page
async function openSearchPage(q) {
  S.search = { q, tab: S.search?.q === q ? S.search.tab : "channels", data: null };
  const mine = S.search;
  setView("search");
  try { mine.data = await invoke("search_all", { q }); } catch (e) { mine.data = { error: String(e) }; }
  if (S.search === mine && S.view === "search") renderMain();
}

function renderSearchPage() {
  const s = S.search, d = s.data;
  const tabs = [["channels", "Channels"], ["live", "Live"], ["categories", "Categories"], ["videos", "Videos"]];
  const count = (k) => (d && !d.error ? (d[k] || []).length : null);
  let body;
  if (!d) body = s.tab === "categories" ? "" : `<div class="grid">${skeletons(8)}</div>`;
  else if (d.error) body = `<div class="error-box">${esc(d.error)}</div>`;
  else if (s.tab === "channels") {
    const list = d.channels.filter((c) => !isHiddenChannel(c.platform, c.login));
    body = list.length ? `<div class="chan-list">${list.map((c) => `<div class="chan-row" data-open="${c.platform}|${esc(c.login)}">
        ${avatar(c.platform, c.avatar, c.display, "xl", c.live)}
        <div class="grow"><div class="cr-name">${esc(c.display)}</div><div class="cr-sub">${c.live ? `<span class="live-dot"></span>${fmt(c.viewers)} watching${c.category ? ` · ${esc(c.category)}` : ""}` : "Offline"}</div></div>
        ${ptag(c.platform)}</div>`).join("")}</div>` : `<div class="empty"><h2>No channels found</h2></div>`;
  } else if (s.tab === "live") {
    const list = d.live.filter(visibleCard);
    body = list.length ? `<div class="grid">${list.map(cardHTML).join("")}</div>` : `<div class="empty"><h2>Nobody live matches "${esc(s.q)}"</h2></div>`;
  } else if (s.tab === "categories") {
    const list = d.categories.filter((c) => !isHiddenCategory(c.name));
    S.searchCats = list;
    body = list.length ? `<div class="cat-grid">${list.map((x, i) => catCardHTML(x, i, "scat")).join("")}</div>` : `<div class="empty"><h2>No categories found</h2></div>`;
  } else {
    body = d.videos.length ? `<div class="vgrid">${d.videos.map((x, i) => `<div class="vcard" data-svod="${i}">
        <div class="thumb">${x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy">` : ""}<span class="dur">${fmtDur(x.seconds)}</span></div>
        <div class="vtitle" title="${esc(x.title)}">${esc(x.title || "Untitled")}</div>
        <div class="vmeta">${esc(x.display)} · ${fmt(x.views || 0)} views · ${esc(ago(x.date))}</div></div>`).join("")}</div>` : `<div class="empty"><h2>No videos found</h2><p>Video search covers Twitch only.</p></div>`;
  }
  $("#main").innerHTML = `<div class="page">
    <h1 class="page-title">Results for "${esc(s.q)}"</h1>
    <div class="pills">${tabs.map(([k, l]) => `<button class="pill ${s.tab === k ? "active" : ""}" data-stab="${k}">${l}${count(k) != null ? ` <span class="pc">${count(k)}</span>` : ""}</button>`).join("")}</div>
    ${body}</div>`;
}

const catCardHTML = (x, i, attr = "cat") => `<div class="cat-card" data-${attr}="${i}">
  <div class="art">${x.art ? `<img src="${esc(x.art)}" alt="" loading="lazy">` : ""}</div>
  <div class="cname" title="${esc(x.name)}">${esc(x.name)}</div>
  <div class="cmeta">${fmt(x.viewers || 0)} viewers <span class="plats">${x.twitch ? PICON.Twitch : ""}${x.kick ? PICON.Kick : ""}</span></div></div>`;

// ------------------------------------------------------------------ hidden channels / categories
const isHiddenChannel = (p, l) => (S.st?.hidden_channels || []).includes(akey(p, (l || "").toLowerCase()));
const isHiddenCategory = (name) => !!name && (S.st?.hidden_categories || []).includes(name.toLowerCase());
const visibleCard = (c) => !isHiddenChannel(c.platform, c.login) && !isHiddenCategory(c.category);
async function setHidden(kind, key, on) {
  S.st = await invoke("set_hidden", { kind, key, on });
  toast(on ? `Hidden. Undo in Settings.` : "Unhidden");
  renderMain();
  renderSidebar();
}
const isFollowedCategory = (name) => (S.st?.followed_categories || []).some((c) => c.name?.toLowerCase() === name?.toLowerCase());
async function toggleCategoryFollow(c) {
  const on = !isFollowedCategory(c.name);
  S.st = await invoke("set_category_follow", { category: { name: c.name, twitch: c.twitch || null, kick: c.kick || null, art: c.art || null }, on });
  toast(on ? `Following ${c.name}` : `Unfollowed ${c.name}`);
  renderMain();
}

// ------------------------------------------------------------------ sidebar
function sidebarRows() {
  const rows = S.follows.rows
    ? S.follows.rows.map((r) => ({ ...r, avatar: r.avatar || S.st.avatars[akey(r.platform, r.login)] }))
    : S.st.follows.map((f) => ({ platform: f.platform, login: f.login, avatar: S.st.avatars[akey(f.platform, f.login)], live: null }));
  rows.sort((a, b) => (b.live ? b.live.viewers + 1 : 0) - (a.live ? a.live.viewers + 1 : 0) || a.login.localeCompare(b.login));
  return rows;
}

let sideShowAll = false;
function renderSidebar() {
  const sb = $("#sidebar");
  const collapsed = S.st.sidebar_collapsed;
  sb.classList.toggle("collapsed", collapsed);
  sb.classList.toggle("hidden", S.theater && S.view === "channel");
  const rows = sidebarRows();
  const live = rows.filter((r) => r.live);
  const shown = collapsed ? live : sideShowAll ? rows : rows.slice(0, Math.max(live.length + 5, 10));
  const rec = sortCards(S.browse.cards, "viewers").filter((c) => !isFollowed(c.platform, c.login) && visibleCard(c)).slice(0, collapsed ? 5 : 8);
  const row = (p, login, name, av, lv) => `
    <div class="side-row ${lv ? "" : "offline"}" data-open="${p}|${esc(login)}" ${collapsed
      ? `data-tip="${esc(name)}|${esc(lv ? lv.category || "Live" : "Offline")}|${lv ? fmt(lv.viewers) : ""}|${esc(lv?.title || "")}"`
      : `title="${esc(lv ? `${name} · ${lv.category}\n${lv.title}` : name)}"`}>
      ${avatar(p, av, name, "", collapsed && !!lv)}
      ${collapsed && lv ? `<span class="mini-count">${fmt(lv.viewers)}</span>` : ""}
      <div class="sinfo"><div class="name">${esc(name)}</div>${lv ? `<div class="cat">${esc(lv.category || "Live")}</div>` : ""}</div>
      <div class="count">${lv ? `<span class="live-dot"></span><span data-n="${lv.viewers}" data-k="s:${akey(p, login)}">${fmt(lv.viewers)}</span>` : "Offline"}</div>
    </div>`;
  sb.innerHTML = `
    <div class="side-section">
      <div class="side-head"><span>Following</span><button class="icon-btn toggle" id="sideCollapse" title="${collapsed ? "Expand" : "Collapse"}">${collapsed ? I.chevR : I.chevL}</button></div>
      ${rows.length === 0 ? '<div class="side-empty">Channels you follow show up here.</div>' : ""}
      ${shown.map((r) => row(r.platform, r.login, r.live ? r.live.display : r.login, r.live?.avatar || r.avatar, r.live)).join("")}
      ${!collapsed && rows.length > shown.length ? '<button class="side-more" id="sideMore">Show more</button>' : ""}
      ${!collapsed && sideShowAll && rows.length > 10 ? '<button class="side-more" id="sideLess">Show less</button>' : ""}
    </div>
    ${rec.length ? `<div class="side-section">
      <div class="side-head"><span>Recommended</span>${collapsed ? '<i class="side-div"></i>' : ""}</div>
      ${rec.map((c) => row(c.platform, c.login, c.display, c.avatar, c)).join("")}
    </div>` : ""}`;
  animateCounts(sb);
}

// ------------------------------------------------------------------ cards
function cardHTML(c) {
  const t = c.thumb ? (c.platform === "Twitch" ? `${c.thumb}${c.thumb.includes("?") ? "&" : "?"}t=${Math.floor(Date.now() / 120000)}` : c.thumb) : "";
  const tags = (c.tags || []).slice(0, 3);
  return `<div class="card" data-open="${c.platform}|${esc(c.login)}" data-cat-name="${esc(c.category || "")}">
    <div class="thumb" data-preview="${c.platform}|${esc(c.login)}">${t ? `<img src="${esc(t)}" alt="" loading="lazy">` : ""}
      <span class="live-tag">Live</span>
      <span class="viewers">${fmt(c.viewers)} viewers</span>
      ${c.started ? `<span class="uptime">${upShort(c.started)}</span>` : ""}
    </div>
    <div class="meta">${avatar(c.platform, c.avatar, c.display, "lg")}
      <div class="text"><div class="title" title="${esc(c.title)}">${esc(c.title || "Untitled stream")}</div>
        <div class="chan">${esc(c.display)}</div>
        ${c.category ? `<div class="cat">${esc(c.category)}</div>` : ""}
        ${tags.length ? `<div class="ctags">${tags.map((x) => `<button class="ctag" data-tag="${esc(x)}">${esc(x)}</button>`).join("")}</div>` : ""}</div>
    </div>
  </div>`;
}
const skeletons = (n) => Array.from({ length: n }, () => `<div class="card skeleton"><div class="thumb"></div><div class="meta"><div class="avatar lg"><div class="ph"></div></div><div class="text"><div class="bar" style="width:80%"></div><div class="bar" style="width:45%"></div></div></div></div>`).join("");

// ------------------------------------------------------------------ pages
function renderMain() {
  renderNav();
  const main = $("#main");
  $("#chat").classList.toggle("hidden", S.view !== "channel" || !S.st.show_chat || S.popped);
  if (S.view === "channel") return; // channel page manages its own DOM
  document.body.classList.remove("theater");
  if (S.view === "following") {
    const rows = sidebarRows();
    const live = rows.filter((r) => r.live).map((r) => r.live);
    const loading = S.follows.rows === null;
    const fcats = S.st.followed_categories || [];
    const ftabs = `<div class="pills"><button class="pill ${S.following.tab === "live" ? "active" : ""}" data-ftab="live">Live</button><button class="pill ${S.following.tab === "categories" ? "active" : ""}" data-ftab="categories">Categories${fcats.length ? ` <span class="pc">${fcats.length}</span>` : ""}</button></div>`;
    if (S.following.tab === "categories") {
      S.followCats = fcats;
      main.innerHTML = `<div class="page"><h1 class="page-title">Following</h1>${ftabs}
        ${fcats.length ? `<div class="cat-grid">${fcats.map((x, i) => catCardHTML({ ...x, viewers: S.cats.list.find((c) => c.name.toLowerCase() === x.name.toLowerCase())?.viewers || 0 }, i, "fcat")).join("")}</div>`
          : `<div class="empty"><h2>No followed categories yet</h2><p>Open a category and press Follow. They show up here and shape your For you page.</p><button class="btn primary" data-view-btn="categories">Browse categories</button></div>`}</div>`;
      return;
    }
    main.innerHTML = `<div class="page">
      <h1 class="page-title">Following</h1>
      ${ftabs}
      <div class="section-title">Live channels <span class="sub">${loading ? "Checking who's live…" : `${live.length} of ${rows.length} live`}</span><span class="spacer"></span>
        <button class="icon-btn" id="refreshFollows" title="Refresh">${I.refresh}</button></div>
      ${loading ? `<div class="grid">${skeletons(8)}</div>`
        : live.length ? `<div class="grid">${live.map(cardHTML).join("")}</div>`
        : `<div class="empty">${svg('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/>', 'width="44" height="44" style="color:#757981"')}
            <h2>${rows.length ? "Nobody you follow is live right now" : "You're not following anyone yet"}</h2>
            <p>${rows.length ? "duostream checks every 90 seconds and notifies you when someone goes live." : "Follow channels from Browse or a channel page."}</p>
            <button class="btn primary" data-view-btn="browse">Browse live channels</button></div>`}
    </div>`;
  } else if (S.view === "categories") {
    const c = S.cats;
    main.innerHTML = `<div class="page">
      <h1 class="page-title">Browse</h1>
      <div class="pills"><button class="pill" data-view-btn="browse">Livestreams</button><button class="pill active">Categories</button></div>
      <div class="section-title">Top categories <span class="sub">Twitch and Kick combined</span><span class="spacer"></span>
        <button class="icon-btn" id="refreshCats" title="Refresh">${I.refresh}</button></div>
      ${c.error && !c.list.length ? `<div class="error-box">${esc(c.error)}</div>` : ""}
      <div class="cat-grid">${c.loading && !c.list.length ? Array.from({ length: 14 }, () => '<div class="cat-card skeleton"><div class="art"></div></div>').join("")
        : c.list.map((x, i) => `<div class="cat-card" data-cat="${i}">
            <div class="art">${x.art ? `<img src="${esc(x.art)}" alt="" loading="lazy">` : ""}</div>
            <div class="cname" title="${esc(x.name)}">${esc(x.name)}</div>
            <div class="cmeta">${fmt(x.viewers)} viewers <span class="plats">${x.twitch ? PICON.Twitch : ""}${x.kick ? PICON.Kick : ""}</span></div>
          </div>`).join("")}</div>
    </div>`;
  } else if (S.view === "category") {
    const c = S.cat;
    main.innerHTML = `<div class="page">
      <div class="cat-head">${c.art ? `<img src="${esc(c.art)}" alt="">` : ""}<div>
        <h1 class="page-title" style="margin:0 0 6px">${esc(c.name)}</h1>
        <div class="sub">${c.cards ? `${fmt(c.cards.reduce((a, x) => a + x.viewers, 0))} watching · ${c.cards.length} live channels` : "Loading…"}</div>
        <div class="tags" style="margin-top:8px">${c.twitch ? ptag("Twitch") : ""}${c.kick ? ptag("Kick") : ""}</div>
        <div class="row-actions" style="justify-content:flex-start;margin-top:12px">
          <button class="btn ${isFollowedCategory(c.name) ? "secondary" : "primary"} sm" data-catfollow>${isFollowedCategory(c.name) ? I.heartFill : I.heart}${isFollowedCategory(c.name) ? "Following" : "Follow"}</button>
          <button class="btn secondary sm" data-cathide="${esc(c.name)}">Hide category</button></div></div></div>
      ${c.error ? `<div class="error-box">${esc(c.error)}</div>` : ""}
      <div class="grid" style="margin-top:20px">${!c.cards ? skeletons(12) : c.cards.filter(visibleCard).length ? c.cards.filter(visibleCard).map(cardHTML).join("") : '<div class="empty"><h2>Nobody is live in this category</h2></div>'}</div>
    </div>`;
  } else if (S.view === "drops") {
    renderDropsPage();
  } else if (S.view === "search") {
    renderSearchPage();
  } else if (S.view === "browse") {
    const b = S.browse, f = b.f;
    const pills = `<div class="pills"><button class="pill ${b.tab === "foryou" ? "active" : ""}" data-btab="foryou">For you</button><button class="pill ${b.tab === "live" ? "active" : ""}" data-btab="live">Livestreams</button><button class="pill" data-view-btn="categories">Categories</button></div>`;
    if (b.tab === "foryou") { main.innerHTML = `<div class="page"><h1 class="page-title">Browse</h1>${pills}<div id="forYou"></div></div>`; renderForYou(); return; }
    const sel = (id, val, opts) => ddHTML(id, val, opts);
    const cards = sortCards(b.cards.filter(visibleCard), f.sort);
    main.innerHTML = `<div class="page">
      <h1 class="page-title">Browse</h1>${pills}
      <div class="filters">
        ${sel("platform", f.platform, [["all", "Twitch + Kick"], ["Twitch", "Twitch only"], ["Kick", "Kick only"]])}
        ${sel("sort", f.sort, [["viewers", "Most viewers"], ["viewers_asc", "Fewest viewers"], ["recent", "Recently started"]])}
        ${sel("language", f.language, LANGS)}
        <button class="fchip ${f.drops ? "on" : ""}" data-filter-drops>${I.gift}Drops enabled</button>
        ${f.tag ? `<button class="fchip on" data-filter-tag-clear>#${esc(f.tag)} ${I.close}</button>` : ""}
        <span class="spacer"></span>
        <button class="icon-btn" id="refreshBrowse" title="Refresh">${I.refresh}</button>
      </div>
      ${f.drops && f.platform !== "Twitch" ? '<p class="hint" style="margin:-6px 0 12px">Drops filter shows Twitch streams only.</p>' : ""}
      ${b.error && !b.cards.length ? `<div class="error-box">${esc(b.error)}</div>` : ""}
      <div class="grid" id="browseGrid">${b.loading && !b.cards.length ? skeletons(12) : cards.map(cardHTML).join("")}</div>
      ${!b.loading && !cards.length && !b.error ? '<div class="empty"><h2>No streams match these filters</h2></div>' : ""}
      <div class="load-more" id="loadMore">${b.loadingMore ? '<div class="spinner"></div>' : b.more ? "" : b.cards.length ? '<span class="hint">That\'s everything</span>' : ""}</div>
    </div>`;
  } else if (S.view === "accounts") {
    const stabs = `<div class="pills"><button class="pill ${S.settingsTab !== "chat" ? "active" : ""}" data-stab2="app">Accounts &amp; app</button><button class="pill ${S.settingsTab === "chat" ? "active" : ""}" data-stab2="chat">Chat</button></div>`;
    if (S.settingsTab === "chat") { main.innerHTML = `<div class="page ce-page"><h1 class="page-title">Settings</h1>${stabs}<div id="ceSettings"></div></div>`; renderChatSettings(); return; }
    main.innerHTML = `<div class="page" style="max-width:560px">
      <h1 class="page-title">Settings</h1>${stabs}
      <div class="section-title" style="font-size:16px">Accounts</div>
      ${providersHTML()}
      <div class="section-title" style="font-size:16px;margin-top:28px">App</div>
      ${updateRowHTML()}
      <div class="setting"><div><b>Go-live notifications</b><p>Get a Windows notification when a channel you follow goes live.</p></div><button class="switch ${S.st.notify_live ? "on" : ""}" data-pref="notifyLive"></button></div>
      <div class="setting"><div><b>Keep running in the tray</b><p>Closing the window keeps duostream in the system tray so notifications keep working.</p></div><button class="switch ${S.st.close_to_tray ? "on" : ""}" data-pref="closeToTray"></button></div>
      <div class="setting"><div><b>Auto-claim rewards</b><p>Claim channel point bonuses and finished drops automatically.</p></div><button class="switch ${S.st.auto_claim ? "on" : ""}" data-pref="autoClaim"></button></div>
      <div class="section-title" style="font-size:16px;margin-top:28px">Hidden</div>
      ${[...(S.st.hidden_channels || []).map((k) => ["channel", k, `${k.startsWith("t:") ? "Twitch" : "Kick"} · ${k.slice(2)}`]), ...(S.st.hidden_categories || []).map((k) => ["category", k, `Category · ${k}`])]
        .map(([kind, key, label]) => `<div class="source-row"><span>${esc(label)}</span><button class="btn secondary sm" data-unhide="${kind}|${esc(key)}">Unhide</button></div>`).join("")
        || '<p class="hint">Nothing hidden. Right-click a stream to hide a channel or its category.</p>'}
    </div>`;
  } else if (S.view === "plugins") {
    renderPluginsPage();
  }
}

/** Page-enter animation: only when the view changes, not on background re-renders. */
let enterTimer;
function playEnter() {
  const m = $("#main"); if (!m) return;
  m.classList.remove("enter");
  void m.offsetWidth; // restart the animation
  m.classList.add("enter");
  clearTimeout(enterTimer);
  enterTimer = setTimeout(() => m.classList.remove("enter"), 900);
}

function setView(v) {
  if (S.view === "channel" && v !== "channel") minimizeOrLeave();
  const changed = S.view !== v;
  S.view = v;
  $("#main").scrollTop = 0;
  if (changed) playEnter();
  if (v === "browse" && Date.now() - S.browse.at > 120000) loadBrowse();
  if (v === "categories" && Date.now() - S.cats.at > 120000) loadCategories();
  if (v === "drops") loadDrops();
  if (v === "plugins") loadShop();
  renderMain();
  renderSidebar();
  Plugins.emit("view", { view: v });
}

// ------------------------------------------------------------------ plugins page / shop
const OFFICIAL_PLUGINS = "https://raw.githubusercontent.com/0neBeerLeft/duostream/main/plugins/registry.json";
const verNewer = (a = "0", b = "0") => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function loadShop() {
  S.shop.loading = true;
  S.shop.error = null;
  const entries = [];
  try {
    const reg = await (await fetch("store/registry.json")).json();
    for (const p of reg.plugins) entries.push({ ...p, source: "builtin", base: "store/" });
  } catch (e) { S.shop.error = "Couldn't read the built-in plugin list."; }
  // the official online shop (plugins/ folder of the GitHub repo) + any sources the user added
  for (const url of [OFFICIAL_PLUGINS, ...(S.st.plugin_sources || [])]) {
    try {
      const reg = JSON.parse(await invoke("fetch_text_url", { url }));
      for (const p of reg.plugins || []) {
        const i = entries.findIndex((x) => x.id === p.id);
        const entry = { ...p, source: url, base: url, official: url === OFFICIAL_PLUGINS };
        if (i < 0) entries.push(entry);
        else if (verNewer(p.version, entries[i].version)) entries[i] = entry; // newer online version wins
      }
    } catch (e) { if (url !== OFFICIAL_PLUGINS) S.shop.error = `Couldn't load source ${url}: ${e}`; }
  }
  S.shop.registry = entries;
  S.shop.loading = false;
  // only the Shop tab shows registry data; re-rendering the Installed tab here caused a flicker
  if (S.view === "plugins" && S.shop.tab === "shop") renderPluginsPage();
}

async function installFromShop(entry) {
  try {
    const getText = async (rel) => {
      if (entry.source === "builtin") return await (await fetch(entry.base + rel)).text();
      return await invoke("fetch_text_url", { url: new URL(rel, entry.base).href });
    };
    const manifest = JSON.parse(await getText(entry.manifest));
    const code = await getText(entry.code);
    if (manifest.id !== entry.id) throw new Error("manifest id doesn't match the shop listing");
    Plugins.unload(manifest.id);
    await invoke("plugin_install", { manifest, code });
    await Plugins.refresh();
    toast(`Installed ${manifest.name}`);
    if (manifest.id === "adblock" && S.ch?.platform === "Twitch" && S.ch.info.live) startPlayback();
  } catch (e) {
    toast(`Install failed: ${e.message || e}`);
  }
  renderPluginsPage();
}

function renderPluginsPage() {
  if (S.view !== "plugins") return;
  const tab = S.shop.tab;
  const installedIds = new Map(Plugins.installed.map((p) => [p.manifest.id, p]));
  const pluginCard = (m, right) => `
    <div class="plugin-card">
      <div class="pc-icon">${I.puzzle}</div>
      <div class="pc-body">
        <div class="pc-name">${esc(m.name)} <span class="pc-ver">v${esc(m.version || "1.0.0")}</span>${m.builtin ? '<span class="tag" style="margin-left:6px">Built-in</span>' : ""}</div>
        <div class="pc-desc">${esc(m.description || "")}</div>
        <div class="pc-author">by ${esc(m.author || "unknown")}</div>
      </div>
      <div class="pc-actions">${right}</div>
    </div>`;
  let body = "";
  if (tab === "installed") {
    body = Plugins.installed.length
      ? Plugins.installed.map((p) => pluginCard(p.manifest, `
          <button class="switch ${p.enabled ? "on" : ""}" data-ptoggle="${esc(p.manifest.id)}" title="${p.enabled ? "Disable" : "Enable"}"></button>
          <button class="btn secondary sm" data-puninstall="${esc(p.manifest.id)}">Uninstall</button>`)).join("")
      : `<div class="empty" style="padding:40px"><h2>No plugins installed</h2><p>Get some from the Shop tab.</p></div>`;
    body += `<div class="row-actions"><button class="btn secondary sm" id="openPluginsDir">${I.folder}Open plugins folder</button><button class="btn secondary sm" id="reloadPlugins">${I.refresh}Reload plugins</button></div>`;
  } else if (tab === "shop") {
    body = S.shop.loading ? `<div class="grid-list">${skeletons(3)}</div>` : S.shop.registry.map((e) => {
      const inst = installedIds.get(e.id);
      const btn = !inst ? `<button class="btn primary sm" data-pinstall="${esc(e.source)}|${esc(e.id)}">Install</button>`
        : (inst.manifest.version !== e.version ? `<button class="btn primary sm" data-pinstall="${esc(e.source)}|${esc(e.id)}">Update</button>` : `<span class="ok-pill">Installed</span>`);
      return pluginCard(e, btn + (e.source !== "builtin" && !e.official ? `<div class="pc-src" title="${esc(e.source)}">community</div>` : ""));
    }).join("");
    body += `
      <div class="section-title" style="font-size:16px;margin-top:28px">Plugin sources</div>
      <p class="hint">Anyone can publish plugins: host a <code>registry.json</code> (see the Make your own tab) and add its https:// link here.</p>
      ${(S.st.plugin_sources || []).map((u, i) => `<div class="source-row"><span>${esc(u)}</span><button class="btn secondary sm" data-srcdel="${i}">Remove</button></div>`).join("")}
      <form class="source-add" id="srcForm"><input id="srcInput" placeholder="https://example.com/duostream/registry.json" spellcheck="false"><button class="btn secondary sm" type="submit">Add source</button></form>
      ${S.shop.error ? `<div class="error-box" style="margin-top:12px">${esc(S.shop.error)}</div>` : ""}`;
  } else {
    body = `<div class="docs">
      <p>A plugin is a folder with two files inside your plugins folder. Drop a folder in, then press <b>Reload plugins</b>.</p>
      <pre><code>%APPDATA%\\duostream\\plugins\\my-plugin\\
  manifest.json
  plugin.js</code></pre>
      <p><b>manifest.json</b></p>
      <pre><code>{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "you",
  "description": "What it does in one sentence."
}</code></pre>
      <p><b>plugin.js</b> runs with an <code>api</code> object:</p>
      <pre><code>// show a button in the top bar
const btn = api.addNavButton({ icon: api.icons.bell, title: "Hello", onClick: () => api.toast("Hi!") });

// change or hide chat messages
api.on("chat:message", (m) => {
  if (m.name === "Nightbot") return false;          // hide
  if (/hello/i.test(m.spans.map(s => s.v).join(""))) m.highlight = true;
  return m;
});

// react to navigation
api.on("channel:open", (ch) => api.toast("Watching " + ch.display));
api.on("channel:leave", () => {});

// clean up when disabled
api.onUnload(() => btn.remove());</code></pre>
      <p>Full reference: <code>PLUGINS.md</code> in the duostream folder. To share plugins, host a <code>registry.json</code>:</p>
      <pre><code>{ "name": "My plugins",
  "plugins": [ { "id": "my-plugin", "name": "My Plugin", "version": "1.0.0",
                 "author": "you", "description": "…",
                 "manifest": "my-plugin/manifest.json", "code": "my-plugin/plugin.js" } ] }</code></pre>
      <p class="hint">Plugins run with the same access as the app (like browser extensions). Only install plugins you trust.</p>
    </div>`;
  }
  $("#main").innerHTML = `<div class="page" style="max-width:900px">
    <h1 class="page-title">Plugins</h1>
    <div class="pills">
      <button class="pill ${tab === "installed" ? "active" : ""}" data-shoptab="installed">Installed (${Plugins.installed.length})</button>
      <button class="pill ${tab === "shop" ? "active" : ""}" data-shoptab="shop">Shop</button>
      <button class="pill ${tab === "docs" ? "active" : ""}" data-shoptab="docs">Make your own</button>
    </div>
    <div class="plugin-list">${body}</div>
  </div>`;
}

// ------------------------------------------------------------------ hover preview (muted live preview on stream cards)
const Preview = {
  timer: null, el: null, hls: null, thumb: null, cache: new Map(),
  start(thumb) {
    if (this.thumb === thumb) return;
    this.stop();
    this.thumb = thumb;
    this.timer = setTimeout(async () => {
      const [p, l] = thumb.dataset.preview.split("|");
      let vars = this.cache.get(akey(p, l));
      if (!vars) {
        try { const info = await invoke("resolve", { platform: p, login: l }); vars = info.variants; this.cache.set(akey(p, l), vars); } catch { return; }
      }
      if (this.thumb !== thumb || !vars?.length) return;
      const v = vars[vars.length - 1]; // lowest quality is plenty for a preview
      const video = document.createElement("video");
      video.className = "pv"; video.muted = true; video.playsInline = true;
      thumb.appendChild(video);
      this.el = video;
      const h = new Hls({ maxBufferLength: 6, liveSyncDurationCount: 2, enableWorker: true });
      this.hls = h;
      h.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      h.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) this.stop(); });
      video.addEventListener("playing", () => video.classList.add("on"));
      h.loadSource(v.url);
      h.attachMedia(video);
    }, 650);
  },
  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    if (this.el) { this.el.remove(); this.el = null; }
    this.thumb = null;
  },
};
document.addEventListener("mouseover", (e) => {
  const t = e.target.closest?.("[data-preview]");
  if (t) Preview.start(t); else if (Preview.thumb) Preview.stop();
  // collapsed sidebar: hover card with name / category / viewers
  const tipRow = e.target.closest?.("[data-tip]");
  let tip = $("#sideTip");
  if (!tipRow) { tip?.classList.remove("on"); return; }
  if (!tip) { tip = el('<div class="side-tip" id="sideTip"></div>'); document.body.appendChild(tip); }
  const [name, cat, viewers, title] = tipRow.dataset.tip.split("|");
  tip.innerHTML = `<div class="st-name">${name}</div><div class="st-cat">${viewers ? `<span class="live-dot"></span>${viewers} · ` : ""}${cat}</div>${title ? `<div class="st-title">${title}</div>` : ""}`;
  const r = tipRow.getBoundingClientRect();
  tip.style.top = `${r.top + r.height / 2}px`;
  tip.style.left = `${r.right + 10}px`;
  tip.classList.add("on");
});

/** Animated open/close for the chat column (and the sidebar collapse). */
function setChatOpen(open) {
  const c = $("#chat");
  if (open) {
    c.classList.remove("hidden", "anim-out");
    c.classList.add("anim-in");
    setTimeout(() => c.classList.remove("anim-in"), 320);
  } else {
    if (c.classList.contains("hidden")) return;
    c.classList.add("anim-out");
    setTimeout(() => { c.classList.add("hidden"); c.classList.remove("anim-out"); }, 240);
  }
}

// ------------------------------------------------------------------ categories
async function loadCategories() {
  S.cats.loading = true;
  if (S.view === "categories") renderMain();
  try { S.cats.list = await invoke("categories"); S.cats.error = null; } catch (e) { S.cats.error = String(e); }
  S.cats.loading = false;
  S.cats.at = Date.now();
  if (S.view === "categories") renderMain();
}

async function openCategory(c) {
  S.cat = { ...c, cards: null, error: null };
  const mine = S.cat;
  setView("category");
  try {
    mine.cards = await invoke("category_streams", { twitchName: c.twitch || null, kickSlug: c.kick || null });
  } catch (e) { mine.error = String(e); mine.cards = []; }
  if (S.cat === mine && S.view === "category") renderMain();
}

// ------------------------------------------------------------------ drops
async function loadDrops() {
  S.drops.loading = true;
  renderDropsPage();
  try { S.drops.data = await invoke("drops_status"); } catch (e) { S.drops.data = { error: String(e) }; }
  S.drops.loading = false;
  renderDropsPage();
}

function renderDropsPage() {
  if (S.view !== "drops") return;
  const d = S.drops.data;
  const bar = (p, max) => { const f = Math.max(0, Math.min(1, max ? p / max : p)); return `<div class="pbar"><i style="width:${(f * 100).toFixed(1)}%"></i></div>`; };
  const section = (p) => {
    const x = d?.[p === "Twitch" ? "twitch" : "kick"];
    const connected = x?.connected;
    const head = `<div class="section-title">${pbadge(p, "big")} ${p} drops<span class="spacer"></span>
      ${connected ? `<button class="btn secondary sm" data-drops-disconnect="${p}">Disconnect</button>` : `<button class="btn ${p === "Twitch" ? "twitch" : "primary"} sm" data-drops-connect="${p}">Connect ${p}</button>`}</div>`;
    if (!d) return head + `<div class="grid-list">${skeletons(2)}</div>`;
    const note = !connected ? `<p class="hint">${p === "Twitch"
      ? "Drops need your twitch.tv website session. Click Connect and log in to Twitch in the window that opens. It closes by itself when you're done."
      : "Drop progress needs your kick.com website session. Click Connect and log in to Kick in the window that opens. Campaigns below are shown without progress until then."}</p>` : "";
    if (x?.error) return head + note + `<div class="error-box">${esc(x.error)}</div>`;
    const camps = (x?.campaigns || []).filter((c) => { const end = Date.parse(c.ends || c.ends_at || ""); return isNaN(end) || end > Date.now(); });
    if (!camps.length) return head + note + (connected || p === "Kick" ? '<div class="empty" style="padding:30px"><h2>No active campaigns</h2></div>' : "");
    return head + note + camps.map((c) => {
      const tw = p === "Twitch";
      const game = tw ? c.game : c.category?.name;
      const art = tw ? c.art : c.category?.image_url;
      const items = tw ? c.drops : (c.rewards || []);
      return `<div class="drop-camp">
        <div class="dc-head">${art ? `<img src="${esc(art)}" alt="">` : ""}<div class="grow"><div class="dc-name">${esc(c.name)}</div>
          <div class="dc-sub">${esc(game || "")}${c.ends || c.ends_at ? ` · ends ${new Date(c.ends || c.ends_at).toLocaleDateString()}` : ""}${tw && c.connected === false ? ' · <span class="warn">account not linked</span>' : ""}</div></div>
          ${tw && c.connected === false && c.link ? `<button class="btn secondary sm" data-ext="${esc(c.link)}">Link account</button>` : ""}
          ${!tw && c.connect_url ? `<button class="btn secondary sm" data-ext="${esc(c.connect_url)}">Link account</button>` : ""}
          <button class="btn primary sm" data-drops-watch="${p}|${esc(game || "")}|${esc(tw ? "" : c.category?.slug || "")}">Watch</button></div>
        <div class="dc-items">${items.length ? items.map((r) => {
          const need = tw ? r.required : r.required_units;
          const have = tw ? r.progress || 0 : (r.progress || 0) <= 1 ? (r.progress || 0) * (need || 1) : r.progress;
          const done = have >= (need || 1);
          return `<div class="drop-item"><div class="di-img">${(tw ? r.image : r.image_url) ? `<img src="${esc(tw ? r.image : r.image_url)}" alt="">` : I.gift}</div>
            <div class="di-name" title="${esc(r.name)}">${esc(r.name || "Reward")}</div>
            ${bar(have, need)}<div class="di-meta">${r.claimed ? "Claimed ✓" : done ? `<button class="btn primary xs" data-drops-claim="${p}|${esc(tw ? r.instance || "" : r.id)}|${esc(c.id)}">Claim</button>` : `${Math.floor(have)}/${need || "?"} min`}</div></div>`;
        }).join("") : `<div class="hint">${tw ? "Start watching a stream of this game to see progress." : ""}</div>`}</div>
      </div>`;
    }).join("");
  };
  $("#main").innerHTML = `<div class="page" style="max-width:1100px">
    <h1 class="page-title">Drops</h1>
    <p class="hint" style="margin-top:-8px">Watch a drops-enabled stream in duostream and progress counts on your account. ${S.st.auto_claim ? "Finished drops are claimed automatically." : ""}
      <button class="icon-btn" id="refreshDrops" title="Refresh" style="vertical-align:middle">${I.refresh}</button></p>
    ${section("Twitch")}
    <div style="height:28px"></div>
    ${section("Kick")}
  </div>`;
}

// ------------------------------------------------------------------ custom dropdowns (Browse filters)
const DD_ICONS = { platform: () => I.accounts, sort: () => svg('<path d="M3 6h13M3 12h9M3 18h5M17 8l4-4 4 4M21 4v16"/>'), language: () => svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>') };
const ddOpts = {};
function ddHTML(id, val, opts) {
  ddOpts[id] = opts;
  const cur = opts.find(([v]) => v === val) || opts[0];
  return `<div class="dd" data-dd="${id}"><button class="dd-btn ${val ? "set" : ""}">${DD_ICONS[id]?.() || ""}<span>${esc(cur[1])}</span><svg class="dd-caret" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button></div>`;
}
function openDropdown(box) {
  closeDropdown();
  const id = box.dataset.dd, opts = ddOpts[id] || [];
  const cur = S.browse.f[id];
  const r = box.getBoundingClientRect();
  const m = el(`<div class="dd-menu" id="ddMenu" data-for="${id}">${opts.map(([v, l]) => `<button class="dd-opt ${v === cur ? "sel" : ""}" data-ddv="${esc(v)}"><span>${esc(l)}</span>${v === cur ? svg('<path d="m5 12 5 5 9-10"/>') : ""}</button>`).join("")}</div>`);
  document.body.appendChild(m);
  m.style.left = `${Math.min(r.left, innerWidth - m.offsetWidth - 8)}px`;
  m.style.top = `${Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 8)}px`;
  m.style.minWidth = `${r.width}px`;
  box.classList.add("open");
}
function closeDropdown() { $("#ddMenu")?.remove(); $$(".dd.open, .dd-native.open").forEach((d) => d.classList.remove("open")); }

// Every native <select> gets the custom dropdown look. The <select> stays (hidden) as the source of
// truth, so code reading .value or listening for "change" keeps working unchanged.
const DD_CARET = '<svg class="dd-caret" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';
function enhanceSelect(sel) {
  if (sel.dataset.enh) return;
  sel.dataset.enh = "1";
  sel.classList.add("sel-native");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dd-native" + (sel.classList.contains("sm") ? " sm" : "");
  const sync = () => { btn.innerHTML = `<span>${esc(sel.options[sel.selectedIndex]?.text || "")}</span>${DD_CARET}`; };
  sync();
  sel.after(btn);
  sel.addEventListener("change", sync);
  btn.addEventListener("click", (e) => { e.stopPropagation(); openSelectMenu(sel, btn); });
}
function openSelectMenu(sel, btn) {
  if (btn.classList.contains("open")) { closeDropdown(); return; }
  closeDropdown();
  const r = btn.getBoundingClientRect();
  const m = el(`<div class="dd-menu" id="ddMenu">${[...sel.options].map((o, i) => `<button class="dd-opt ${i === sel.selectedIndex ? "sel" : ""}" data-selopt="${i}"><span>${esc(o.text)}</span>${i === sel.selectedIndex ? svg('<path d="m5 12 5 5 9-10"/>') : ""}</button>`).join("")}</div>`);
  document.body.appendChild(m);
  m.style.minWidth = `${r.width}px`;
  m.style.left = `${Math.min(r.left, innerWidth - m.offsetWidth - 8)}px`;
  const below = r.bottom + 6 + m.offsetHeight < innerHeight;
  m.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - m.offsetHeight - 6)}px`;
  btn.classList.add("open");
  m.addEventListener("click", (e) => {
    const b = e.target.closest("[data-selopt]");
    if (!b) return;
    e.stopPropagation();
    sel.selectedIndex = +b.dataset.selopt;
    closeDropdown();
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
// upgrade selects as they appear (only inspects newly added nodes, so busy chat costs nothing)
new MutationObserver((muts) => {
  for (const mu of muts) for (const n of mu.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.tagName === "SELECT") enhanceSelect(n);
    else if (n.firstElementChild) n.querySelectorAll("select:not([data-enh])").forEach(enhanceSelect);
  }
}).observe(document.documentElement, { childList: true, subtree: true });

// ------------------------------------------------------------------ data loading
const LANGS = [["", "Any language"], ["en", "English"], ["es", "Spanish"], ["pt", "Portuguese"], ["de", "German"], ["fr", "French"], ["ru", "Russian"], ["ar", "Arabic"], ["tr", "Turkish"], ["it", "Italian"], ["ja", "Japanese"], ["ko", "Korean"], ["pl", "Polish"], ["he", "Hebrew"], ["zh", "Chinese"]];
function sortCards(list, sort) {
  const l = [...list];
  if (sort === "viewers_asc") l.sort((a, b) => a.viewers - b.viewers);
  else if (sort === "recent") l.sort((a, b) => (parseTs(b.started) || 0) - (parseTs(a.started) || 0));
  else l.sort((a, b) => b.viewers - a.viewers);
  return l;
}

let browseSeq = 0;
async function loadBrowse(more = false) {
  const b = S.browse, f = b.f;
  if (more && (b.loadingMore || !b.more)) return;
  const seq = more ? browseSeq : ++browseSeq;
  if (more) b.loadingMore = true; else { b.loading = true; b.cards = []; b.twitchCursor = null; b.kickPage = null; }
  if (S.view === "browse" && b.tab === "live") renderMain();
  try {
    const r = await invoke("browse_page", {
      platform: f.platform, sort: f.sort, language: f.language, tag: f.tag, drops: f.drops,
      twitchCursor: more ? b.twitchCursor : null, kickPage: more ? b.kickPage : null, first: !more,
    });
    if (seq !== browseSeq) return;
    const seen = new Set(b.cards.map((c) => akey(c.platform, c.login)));
    b.cards.push(...r.cards.filter((c) => !seen.has(akey(c.platform, c.login))));
    b.twitchCursor = r.twitch_cursor; b.kickPage = r.kick_page;
    b.more = !!(r.twitch_cursor || r.kick_page);
    b.error = null;
  } catch (e) { if (seq === browseSeq) b.error = String(e); }
  if (seq !== browseSeq) return;
  b.loading = false; b.loadingMore = false; b.at = Date.now();
  if (S.view === "browse" && b.tab === "live") {
    const main = $("#main"), top = main.scrollTop;
    renderMain();
    main.scrollTop = top;
  }
  renderSidebar();
}

// ------------------------------------------------------------------ For you
async function loadForYou() {
  const fy = S.forYou;
  fy.at = Date.now();
  // favourite categories = followed categories + categories your followed channels stream most
  const counts = new Map();
  for (const c of S.st.followed_categories || []) counts.set(c.name.toLowerCase(), { c, n: 100 });
  for (const r of sidebarRows()) if (r.live?.category) {
    const k = r.live.category.toLowerCase();
    const e = counts.get(k) || { c: { name: r.live.category, twitch: r.platform === "Twitch" ? r.live.category : null, kick: null }, n: 0 };
    e.n++; counts.set(k, e);
  }
  const favs = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.c).filter((c) => !isHiddenCategory(c.name));
  // match Kick slugs for favourites through the categories list
  if (!S.cats.list.length) await loadCategories();
  const norm = (s) => (s || "").toLowerCase().split(" (")[0].replace(/[^a-z0-9]/g, "");
  for (const c of favs) if (!c.kick) c.kick = S.cats.list.find((x) => norm(x.name) === norm(c.name))?.kick || null;
  const catStreams = await Promise.all(favs.map((c) => invoke("category_streams", { twitchName: c.twitch || c.name, kickSlug: c.kick || null }).catch(() => [])));
  if (!S.browse.cards.length) await loadBrowse();
  const followed = new Set(S.st.follows.map((f) => akey(f.platform, f.login)));
  const notFollowed = (c) => !followed.has(akey(c.platform, c.login)) && visibleCard(c);
  const all = [...S.browse.cards, ...catStreams.flat()];
  const uniq = (list) => { const s = new Set(); return list.filter((c) => { const k = akey(c.platform, c.login); if (s.has(k)) return false; s.add(k); return true; }); };
  const twoHours = Date.now() - 2 * 3600e3;
  fy.sections = [
    { title: "Live channels you follow", cards: sidebarRows().filter((r) => r.live).map((r) => r.live).filter(visibleCard).slice(0, 8), more: "following" },
    ...favs.map((c, i) => ({ title: `Popular in ${c.name}`, cards: catStreams[i].filter(notFollowed).slice(0, 8), cat: c })),
    { title: "Rising: started in the last 2 hours", cards: uniq(all.filter((c) => (parseTs(c.started) || 0) > twoHours)).filter(notFollowed).sort((a, b) => b.viewers - a.viewers).slice(0, 8) },
    { title: "Smaller channels in your categories", cards: uniq(catStreams.flat().filter((c) => c.viewers >= 5 && c.viewers <= 1500)).filter(notFollowed).sort((a, b) => b.viewers - a.viewers).slice(0, 8) },
  ].filter((s) => s.cards.length);
  renderForYou();
}

function renderForYou() {
  const box = $("#forYou"); if (!box) return;
  const fy = S.forYou;
  if (!fy.sections) {
    box.innerHTML = `<div class="section-title">Loading your page…</div><div class="grid">${skeletons(8)}</div>`;
    if (Date.now() - fy.at > 5000) loadForYou();
    return;
  }
  box.innerHTML = fy.sections.map((s, i) => `<section class="fy">
      <div class="section-title">${esc(s.title)}<span class="spacer"></span>${s.cat ? `<button class="btn secondary sm" data-fycat="${i}">See all</button>` : s.more ? `<button class="btn secondary sm" data-view-btn="${s.more}">See all</button>` : ""}</div>
      <div class="grid">${s.cards.map(cardHTML).join("")}</div></section>`).join("")
    || `<div class="empty"><h2>Follow some channels or categories</h2><p>Your For you page is built from what you watch.</p></div>`;
  if (Date.now() - fy.at > 300000) loadForYou();
}

function applyFollows(rows) {
  S.follows.rows = rows;
  if (S.view === "following") renderMain();
  renderSidebar();
}

async function loadFollows() {
  if (S.follows.loading) return;
  S.follows.loading = true;
  try {
    const rows = await invoke("follows_status");
    S.st = await invoke("get_state");
    applyFollows(rows);
  } catch (e) {
    console.error(e);
  }
  S.follows.loading = false;
}

async function toggleFollow(p, l) {
  const on = !isFollowed(p, l);
  try {
    await invoke("set_follow", { platform: p, login: l, on });
    S.st = await invoke("get_state");
    toast(`${on ? "Followed" : "Unfollowed"} ${l}${p === "Twitch" && S.st.twitch ? " on Twitch" : ""}`);
    if (S.ch && S.ch.platform === p && S.ch.login === l) { renderChannelInfo(); if (on) $("#followBtn")?.classList.add("pop"); }
    renderSidebar();
    loadFollows();
  } catch (e) {
    toast(`Couldn't ${on ? "follow" : "unfollow"} ${l}: ${e}`);
  }
}

// ------------------------------------------------------------------ channel page + player
let hls = null, idleTimer = null, uptimeTimer = null, infoTimer = null;

function destroyPlayer() {
  if (hls) { hls.destroy(); hls = null; }
  const v = $("#video");
  if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
  clearInterval(uptimeTimer); clearInterval(infoTimer);
}

function leaveChannel() {
  const had = !!S.ch;
  destroyPlayer();
  S.ch = null;
  S.mini = false;
  S.playerEl = null;
  $("#mini")?.remove();
  S.chatGen = -1;
  S.points = null;
  S.replyTo = null;
  if (had) invoke("chat_leave");
  $("#chat").classList.add("hidden");
  document.body.classList.remove("theater");
  S.theater = false;
  if (had) Plugins.emit("channel:leave", {});
}

/** Leaving the channel page while something is playing shrinks it into the corner mini player. */
function minimizeOrLeave() {
  const v = $("#video");
  if (!S.ch || !v || v.paused || !S.playerEl) { leaveChannel(); return; }
  S.mini = true;
  S.theater = false;
  document.body.classList.remove("theater");
  $("#chat").classList.add("hidden");
  $("#qmenu")?.remove();
  const box = el(`<div class="mini" id="mini">
      <div class="mini-video"></div>
      <div class="mini-bar">
        ${avatar(S.ch.platform, S.ch.info.avatar, S.ch.info.display)}
        <div class="sinfo"><div class="name">${esc(S.ch.info.display)}</div><div class="cat">${esc(S.ch.info.category || "")}</div></div>
        <button class="icon-btn" id="miniExpand" title="Back to channel">${I.expand}</button>
        <button class="icon-btn" id="miniClose" title="Close">${I.close}</button>
      </div>
    </div>`);
  document.body.appendChild(box);
  $(".mini-video", box).appendChild(S.playerEl);
}

function restoreFromMini() {
  if (!S.ch || !S.mini) return;
  S.mini = false;
  const playerEl = S.playerEl;
  $("#mini")?.remove();
  S.view = "channel";
  buildChannelDOM(playerEl);
  $("#chat").classList.toggle("hidden", !S.st.show_chat || S.popped);
  renderNav();
  renderSidebar();
}

async function openChannel(platform, login) {
  login = login.toLowerCase();
  closeMenu();
  hideSuggest();
  if (S.ch && S.ch.platform === platform && S.ch.login === login && S.mini) { restoreFromMini(); return; }
  if (S.ch) leaveChannel();
  S.view = "channel";
  const known = sidebarRows().find((r) => r.platform === platform && r.login === login);
  S.ch = { platform, login, info: { display: known?.live?.display || login, title: known?.live?.title || "", category: known?.live?.category || "", viewers: 0, live: false, variants: [], avatar: known?.live?.avatar || known?.avatar }, loading: true, error: null, sel: 0, paused: false, retries: 0, tab: "about", about: null, videos: null, clips: null, vod: null, emotes: null };
  const ch = S.ch;
  S.chatMsgs = []; S.chatRaw = [];
  S.replyTo = null;
  S.points = null;
  S.badges = {};
  S.kickSubBadges = [];
  renderNav();
  buildChannelDOM(null);
  buildChat();
  renderSidebar();
  loadChannelTab();
  if (platform === "Twitch") {
    S.chatGen = await invoke("chat_join", { platform, login, display: ch.info.display, kickChatroom: null, kickUserId: null, kickChannelId: null });
    invoke("twitch_badges", { login }).then((b) => { if (S.ch === ch) S.badges = b; });
    if (S.st.twitch) invoke("points_status", { login }).then((p) => { if (S.ch === ch) { S.points = p; renderPoints(); } }).catch(() => {});
  }
  try {
    const info = await invoke("resolve", { platform, login });
    if (S.ch !== ch) return;
    ch.info = info;
    ch.loading = false;
    const q = chPref(ch).q;
    if (q) { const i = info.variants.findIndex((v) => v.name === q); if (i > 0) ch.sel = i; }
    if (platform === "Kick") S.chatGen = await invoke("chat_join", { platform, login, display: info.display, kickChatroom: info.kick_chatroom, kickUserId: info.kick_user_id, kickChannelId: info.kick_channel_id });
    renderChannelInfo();
    if (info.live && info.variants.length) startPlayback();
    else setPlayerState("offline");
  } catch (e) {
    if (S.ch !== ch) return;
    ch.loading = false;
    ch.error = String(e);
    setPlayerState("error");
    renderChannelInfo();
  }
  if (S.ch === ch) Plugins.emit("channel:open", { platform, login, display: ch.info.display, live: ch.info.live, title: ch.info.title, category: ch.info.category });
  uptimeTimer = setInterval(() => { const u = $("#uptime"); if (u && S.ch?.info.started) u.textContent = upClock(S.ch.info.started); }, 1000);
  infoTimer = setInterval(refreshInfo, 60000);
}

async function refreshInfo() {
  if (!S.ch) return;
  const ch = S.ch;
  try {
    const info = await invoke("resolve", { platform: ch.platform, login: ch.login });
    if (S.ch !== ch) return;
    const wasLive = ch.info.live;
    ch.info = { ...info, variants: ch.info.variants.length ? ch.info.variants : info.variants };
    renderChannelInfo();
    if (!wasLive && info.live && !ch.vod) { ch.info.variants = info.variants; startPlayback(); }
  } catch {}
}

function createPlayer() {
  const p = el(`<div class="player paused" id="player">
      <video id="video" playsinline></video>
      <div class="state" id="pstate"><div class="spinner"></div></div>
      <div class="vod-title hidden" id="vodTitle"></div>
      <button class="big-play" id="bigPlay" title="Play">${I.play}</button>
      <div class="controls" id="controls">
        <input type="range" class="seek hidden" id="cSeek" min="0" max="1000" value="0">
        <button class="icon-btn" id="cPlay" title="Pause (space)">${I.pause}</button>
        <div class="vol"><button class="icon-btn" id="cMute" title="Mute (m)">${I.vol}</button><input type="range" id="cVol" min="0" max="100"></div>
        <button class="live-ind" id="cLive" title="Jump to live"><span class="dot"></span>Live</button>
        <span class="vtime hidden" id="cTime">0:00 / 0:00</span>
        <button class="btn secondary xs hidden" id="cBackLive">${I.live}Back to live</button>
        <span id="pBadges"></span>
        <span class="grow"></span>
        <span id="pButtons"></span>
        <button class="icon-btn" id="cClip" title="Save the last 60 seconds as a clip">${I.scissors}</button>
        <button class="icon-btn" id="cPip" title="Picture-in-picture (floats over other windows)">${I.pip}</button>
        <button class="icon-btn" id="cChat" title="Show / hide chat">${I.chat}</button>
        <button class="icon-btn" id="cGear" title="Settings">${I.gear}</button>
        <button class="icon-btn" id="cTheater" title="Theater mode (t)">${I.theater}</button>
        <button class="icon-btn" id="cFull" title="Fullscreen (f)">${I.full}</button>
      </div>
    </div>`);
  const v = $("video", p);
  const vol0 = S.ch ? chPref(S.ch).vol ?? S.st.volume ?? 70 : S.st.volume ?? 70;
  v.volume = vol0 / 100;
  $("#cVol", p).value = vol0;
  const seek = $("#cSeek", p);
  let seeking = false;
  // VOD: 0..duration. Live: the rewind window the local proxy keeps (up to ~2 hours).
  const range = () => {
    if (S.ch?.vod) return isFinite(v.duration) ? [0, v.duration] : null;
    if (!v.seekable.length) return null;
    const a = v.seekable.start(0), b = v.seekable.end(v.seekable.length - 1);
    return b - a > 45 ? [a, b] : null;
  };
  // Live: map the bar against hls liveSyncPosition (stable) instead of the raw playlist end, which
  // moves on every playlist refresh and made the bar jump. Hysteresis keeps LIVE / Go live steady.
  let isBehind = false;
  const liveEdge = (r) => Math.max(r[0] + 1, Math.min(r[1], hls?.liveSyncPosition ?? r[1]));
  v.addEventListener("timeupdate", () => {
    const r = range();
    const live = !S.ch?.vod;
    seek.classList.toggle("hidden", !r);
    if (!r) { $("#cTime", p).classList.add("hidden"); $("#cLive", p).classList.remove("behind"); isBehind = false; return; }
    const end = live ? liveEdge(r) : r[1];
    const behind = live ? Math.max(0, end - v.currentTime) : 0;
    if (live) isBehind = isBehind ? behind > 5 : behind > 10;
    if (!seeking) {
      const f = live && !isBehind ? 1 : Math.min(1, Math.max(0, (v.currentTime - r[0]) / (end - r[0])));
      seek.value = Math.round(f * 1000);
      seek.style.setProperty("--p", f * 100 + "%");
    }
    $("#cTime", p).classList.toggle("hidden", live && !isBehind);
    $("#cTime", p).textContent = live ? `-${fmtDur(behind)}` : `${fmtDur(v.currentTime)} / ${fmtDur(v.duration)}`;
    $("#cLive", p).classList.toggle("behind", live && isBehind);
  });
  seek.addEventListener("input", () => { seeking = true; seek.style.setProperty("--p", seek.value / 10 + "%"); });
  $("#bigPlay", p).onclick = (e) => { e.stopPropagation(); togglePause(); };
  seek.addEventListener("change", () => {
    seeking = false;
    const r = range(); if (!r) return;
    const f = seek.value / 1000;
    if (!S.ch?.vod && f > 0.99) { v.currentTime = liveEdge(r); return; } // dragged to the end = back to live
    const end = S.ch?.vod ? r[1] : liveEdge(r);
    v.currentTime = r[0] + f * (end - r[0]);
  });
  $("#cClip", p).onclick = (e) => { e.stopPropagation(); saveClip(); };
  $("#cPip", p).onclick = async (e) => {
    e.stopPropagation();
    const ch = S.ch;
    if (!ch) return;
    if (ch.vod) { toast("Picture-in-picture works for live streams"); return; }
    if (!ch.info.live) { toast("The stream is offline"); return; }
    try {
      await invoke("pip_open", { platform: ch.platform, login: ch.login, display: ch.info.display || ch.login });
      ch.inPip = true;
      destroyPlayerMedia();
      setPlayerState("pip");
    } catch (err) { toast(`Couldn't open picture-in-picture: ${err}`); }
  };
  $("#cBackLive", p).onclick = (e) => { e.stopPropagation(); backToLive(); };
  v.addEventListener("play", syncPlayUI);
  v.addEventListener("pause", syncPlayUI);
  v.addEventListener("volumechange", syncVolUI);
  v.addEventListener("playing", () => { setPlayerState("playing"); Plugins.emit("player:playing", {}); });
  v.addEventListener("waiting", () => { if (!v.paused) setPlayerState("buffering"); });
  p.addEventListener("mousemove", () => {
    p.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!v.paused && !p.classList.contains("menu-open")) p.classList.add("idle"); }, 2500);
  });
  p.addEventListener("dblclick", (e) => { if (!e.target.closest(".controls") && !S.mini) toggleFullscreen(); });
  v.addEventListener("click", () => { if (S.mini) restoreFromMini(); else togglePause(); });
  $("#cPlay", p).onclick = togglePause;
  $("#cMute", p).onclick = () => { v.muted = !v.muted; };
  $("#cVol", p).oninput = (e) => { v.muted = false; v.volume = e.target.value / 100; };
  $("#cVol", p).onchange = (e) => { S.st.volume = +e.target.value; invoke("set_prefs", { volume: +e.target.value }); if (S.ch) setChPref(S.ch, { vol: +e.target.value }); };
  $("#cLive", p).onclick = () => { if (hls && hls.liveSyncPosition) v.currentTime = hls.liveSyncPosition; v.play(); };
  $("#cTheater", p).onclick = toggleTheater;
  $("#cFull", p).onclick = toggleFullscreen;
  $("#cChat", p).onclick = () => {
    if (S.popped) { invoke("popout_chat"); return; }
    S.st.show_chat = !S.st.show_chat;
    invoke("set_prefs", { showChat: S.st.show_chat });
    setChatOpen(S.st.show_chat);
  };
  $("#cGear", p).onclick = (e) => { e.stopPropagation(); toggleQualityMenu(); };
  return p;
}

function buildChannelDOM(existingPlayer) {
  $("#main").innerHTML = `<div class="channel"><div id="playerSlot"></div><div class="info" id="chInfo"></div><div class="ch-tabs" id="chTabs"></div></div>`;
  if (!existingPlayer) playEnter();
  S.playerEl = existingPlayer || createPlayer();
  $("#playerSlot").replaceWith(S.playerEl);
  syncVolUI();
  syncPlayUI();
  renderPlayerExtras();
  renderChannelInfo();
  renderChannelTab();
}

function renderPlayerExtras() {
  const b = $("#pBadges"), btns = $("#pButtons");
  if (!b || !btns) return;
  b.innerHTML = Plugins.ui.badges.filter((x) => x.visible).map((x) => `<span class="adtag">${esc(x.text)}</span>`).join("");
  btns.innerHTML = Plugins.ui.player.map((x, i) => `<button class="icon-btn ${x.active ? "on" : ""}" data-pplayer="${i}" title="${esc(x.title || "")}">${x.icon || I.puzzle}</button>`).join("");
}

function syncPlayUI() {
  const v = $("#video"); if (!v) return;
  $("#cPlay").innerHTML = v.paused ? I.play : I.pause;
  $("#player").classList.toggle("paused", v.paused);
}
function syncVolUI() {
  const v = $("#video"); if (!v) return;
  $("#cMute").innerHTML = v.muted || v.volume === 0 ? I.mute : I.vol;
  $("#cVol").value = v.muted ? 0 : Math.round(v.volume * 100);
  $("#cVol").style.setProperty("--p", $("#cVol").value + "%");
}
function togglePause() { const v = $("#video"); if (!v) return; v.paused ? v.play() : v.pause(); }

function setPlayerState(kind) {
  const p = $("#pstate"); if (!p || !S.ch) return;
  const i = S.ch.info;
  if (kind === "playing") { p.classList.add("hidden"); return; }
  p.classList.remove("hidden");
  if (kind === "buffering" || kind === "loading") p.innerHTML = '<div class="spinner"></div>';
  else if (kind === "offline") p.innerHTML = document.documentElement.classList.contains("browser-preview")
    ? `<h3>Browser preview</h3><p>Live playback and chat are available in the desktop app. This channel is sample data.</p>`
    : `${avatar(S.ch.platform, i.avatar, i.display, "xl")}<h3>${esc(i.display)} is offline</h3><p>Chat is still open.</p>`;
  else if (kind === "error") p.innerHTML = `<h3>Playback stopped</h3><p>${esc(S.ch.error || "Something went wrong.")}</p><button class="btn secondary" id="retryBtn" style="margin-top:8px">Retry</button>`;
  else if (kind === "pip") {
    p.innerHTML = `<div class="pip-note">${I.pip}</div><h3>Playing in picture-in-picture</h3><p>The stream is in its floating window. Chat stays here.</p><button class="btn secondary" id="pipBackBtn" style="margin-top:8px">Bring it back</button>`;
    $("#pipBackBtn").onclick = () => window.__TAURI__.event.emit("pip-close");
  }
  const r = $("#retryBtn"); if (r) r.onclick = () => { const { platform, login } = S.ch; leaveChannel(); openChannel(platform, login); };
}

async function startPlayback() {
  const ch = S.ch; if (!ch) return;
  const v = $("#video");
  if (hls) { hls.destroy(); hls = null; }
  setPlayerState("loading");
  syncVodUI();
  // Always load a concrete quality playlist ("Auto" = best). Kick's master playlist has no CORS
  // header, so the page can't read it; the per-quality playlists and segments can be read.
  const vod = ch.vod;
  const vars = vod ? vod.variants : ch.info.variants;
  const sel = vod ? vod.sel : ch.sel;
  const idx = sel === 0 && vars.length > 1 ? 1 : Math.min(sel, vars.length - 1);
  if (vod && /\.mp4(\?|$)/.test(vars[idx].url)) { // Twitch clips are plain MP4 files
    v.removeAttribute("src");
    v.src = vars[idx].url;
    v.play().catch(() => {});
    return;
  }
  const url = vod ? vars[idx].url : await invoke("play_url", { platform: ch.platform, login: ch.login, name: vars[idx].name, url: vars[idx].url });
  if (S.ch !== ch || ch.vod !== vod) return;
  const low = !!S.st.low_latency && !vod;
  hls = new Hls(vod
    ? { maxBufferLength: 60, backBufferLength: 30, enableWorker: true, startPosition: 0 }
    // start ~3-6 s behind live; a huge max latency so rewinding (DVR) is never yanked back to live
    : { lowLatencyMode: low, liveSyncDuration: low ? 3 : 6, liveMaxLatencyDuration: 7200, maxBufferLength: 30, backBufferLength: 90, enableWorker: true });
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); toast("Muted autoplay. Click the speaker to unmute."); });
  });
  hls.on(Hls.Events.ERROR, (_, d) => {
    if (!d.fatal) return;
    if (d.type === Hls.ErrorTypes.NETWORK_ERROR && ch.retries < 5) { ch.retries++; setTimeout(() => hls && hls.startLoad(), 1500); return; }
    if (d.type === Hls.ErrorTypes.MEDIA_ERROR && ch.retries < 5) { ch.retries++; hls.recoverMediaError(); return; }
    ch.error = d.details === "manifestLoadError" ? "The stream couldn't be loaded. It may have just ended." : `Player error: ${d.details}`;
    setPlayerState("error");
  });
  hls.on(Hls.Events.FRAG_LOADED, () => { ch.retries = 0; });
  hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) invoke("js_log", { msg: `hls fatal ${d.type} ${d.details} ${d.response?.code || ""}` }); });
  hls.loadSource(url);
  hls.attachMedia(v);
}

function toggleQualityMenu() {
  const player = $("#player");
  const existing = $("#qmenu");
  if (existing) { existing.remove(); player.classList.remove("menu-open"); return; }
  const ch = S.ch; if (!ch) return;
  const vod = ch.vod;
  const items = (vod ? vod.variants : ch.info.variants).map((v, i) => ({
    label: v.name.replace(" (source)", " (Source)"), sel: (vod ? vod.sel : ch.sel) === i,
    run: () => {
      if (vod) { const t = $("#video").currentTime; vod.sel = i; startPlayback().then(() => { const vv = $("#video"); vv.addEventListener("loadedmetadata", () => { vv.currentTime = t; }, { once: true }); }); return; }
      ch.sel = i; setChPref(ch, { q: i === 0 ? null : v.name }); startPlayback();
    },
  }));
  const m = el(`<div class="qmenu" id="qmenu"><div class="head">Quality</div>
    ${items.map((it, i) => `<button data-q="${i}" class="${it.sel ? "sel" : ""}"><span>${esc(it.label)}</span>${it.sel ? "✓" : ""}</button>`).join("")}
    <div style="height:1px;background:var(--line);margin:6px 0"></div>
    <div class="row"><span>Low latency</span><button class="switch ${S.st.low_latency ? "on" : ""}" id="swLow"></button></div>
  </div>`);
  player.appendChild(m);
  player.classList.add("menu-open");
  m.addEventListener("click", (e) => e.stopPropagation());
  $$("button[data-q]", m).forEach((b) => (b.onclick = () => { items[+b.dataset.q].run(); m.remove(); player.classList.remove("menu-open"); }));
  $("#swLow", m).onclick = async (e) => { S.st.low_latency = !S.st.low_latency; e.target.classList.toggle("on"); await invoke("set_prefs", { lowLatency: S.st.low_latency }); startPlayback(); };
}

function toggleTheater() {
  if (S.mini) return;
  S.theater = !S.theater;
  document.body.classList.toggle("theater", S.theater);
  $(".navbar").classList.toggle("hidden", S.theater);
  $(".layout").style.top = S.theater ? "0" : "";
  renderSidebar();
  renderChannelInfo();
  renderChannelTab();
}

async function toggleFullscreen() {
  const p = $("#player"); if (!p) return;
  if (document.fullscreenElement) await document.exitFullscreen();
  else await p.requestFullscreen().catch(() => {});
}
document.addEventListener("fullscreenchange", () => {
  const on = !!document.fullscreenElement;
  appWindow.setFullscreen(on).catch(() => {});
  document.body.classList.toggle("fs", on);
  const b = $("#cFull"); if (b) b.innerHTML = on ? I.unfull : I.full;
});

function renderChannelInfo() {
  const box = $("#chInfo"); if (!box || !S.ch) return;
  box.classList.toggle("hidden", S.theater);
  const { platform, login, info } = S.ch;
  const followed = isFollowed(platform, login);
  box.innerHTML = `
    ${avatar(platform, info.avatar, info.display, "xl", info.live)}
    <div class="who">
      <div class="uname">${esc(info.display)} ${info.live ? '<span class="live-pill">LIVE</span>' : S.ch.loading ? "" : '<span class="offline-tag">OFFLINE</span>'}</div>
      <div class="stitle" title="${esc(info.title)}">${esc(info.title || (S.ch.loading ? "Loading…" : ""))}</div>
      <div class="tags">${info.category ? `<span class="tag cat">${esc(info.category)}</span>` : ""}${ptag(platform)}</div>
    </div>
    <div class="actions">
      <div class="row">
        <button class="follow-btn ${followed ? "on" : ""}" id="followBtn"><span class="fh">${I.heartFill}<i class="burst"></i></span><span class="fl"><span class="f-a">${followed ? "Following" : "Follow"}</span>${followed ? '<span class="f-b">Unfollow</span>' : ""}</span></button>
      </div>
      ${info.live ? `<div class="stats"><span class="v">${I.user}<span data-n="${info.viewers || 0}" data-k="c:${akey(platform, login)}" data-full>${(info.viewers || 0).toLocaleString()}</span></span><span id="uptime">${upClock(info.started)}</span></div>` : ""}
    </div>`;
  animateCounts(box);
  $("#followBtn").onclick = () => toggleFollow(platform, login);
}

// ------------------------------------------------------------------ channel tabs: About / Videos / Clips
async function loadChannelTab() {
  const ch = S.ch; if (!ch) return;
  const tab = ch.tab;
  const key = tab === "about" ? "about" : tab;
  if (ch[key] && !ch[key].error) { renderChannelTab(); return; }
  ch[key] = null;
  renderChannelTab();
  try {
    ch[key] = tab === "about"
      ? await invoke("channel_about", { platform: ch.platform, login: ch.login })
      : await invoke("channel_videos", { platform: ch.platform, login: ch.login, kind: tab });
    if (tab === "about" && ch.platform === "Kick") S.kickSubBadges = (ch.about.sub_badges || []).sort((a, b) => b.months - a.months);
  } catch (e) { ch[key] = { error: String(e) }; }
  if (S.ch === ch && ch.tab === tab) renderChannelTab();
}

function renderChannelTab() {
  const box = $("#chTabs"); if (!box || !S.ch) return;
  box.classList.toggle("hidden", S.theater);
  const ch = S.ch, tab = ch.tab;
  const data = ch[tab];
  let body;
  if (!data) body = `<div class="tab-loading"><div class="spinner"></div></div>`;
  else if (data.error) body = `<div class="error-box">${esc(data.error)}</div>`;
  else if (tab === "about") {
    const a = data;
    body = `<div class="about">
      <div class="about-main">
        <h3>About ${esc(ch.info.display)}</h3>
        ${a.followers != null ? `<div class="followers"><b>${fmt(a.followers)}</b> followers</div>` : ""}
        <p class="bio">${a.bio ? esc(a.bio) : '<span class="muted">This channel has no bio yet.</span>'}</p>
        ${a.socials?.length ? `<div class="socials">${a.socials.map((s) => `<button class="social" data-ext="${esc(s.url)}" title="${esc(s.url)}">${I.link}${esc(s.title || s.name)}</button>`).join("")}</div>` : ""}
      </div>
      ${a.panels?.length ? `<div class="panels">${a.panels.map((p) => `<div class="panel">
          ${p.title ? `<h4>${esc(p.title)}</h4>` : ""}
          ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" ${p.link ? `data-ext="${esc(p.link)}" class="clickable"` : ""}>` : ""}
          ${p.text ? `<div class="ptext">${esc(p.text)}</div>` : ""}
        </div>`).join("")}</div>` : ""}
    </div>`;
  } else {
    body = data.length ? `<div class="vgrid">${data.map((x, i) => `<div class="vcard ${ch.vod?.id === x.id ? "playing" : ""}" data-vod="${i}">
        <div class="thumb">${x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy">` : ""}<span class="dur">${fmtDur(x.seconds)}</span>${ch.vod?.id === x.id ? '<span class="now">Now playing</span>' : ""}</div>
        <div class="vtitle" title="${esc(x.title)}">${esc(x.title || "Untitled")}</div>
        <div class="vmeta">${fmt(x.views || 0)} views · ${esc(ago(x.date))}${x.category ? ` · ${esc(x.category)}` : ""}</div>
      </div>`).join("")}</div>` : `<div class="empty" style="padding:40px"><h2>No ${tab === "clips" ? "clips from the last month" : "past broadcasts"}</h2></div>`;
  }
  box.innerHTML = `<div class="tabbar">${[["about", "About"], ["videos", "Videos"], ["clips", "Clips"]].map(([k, l]) => `<button class="${tab === k ? "active" : ""}" data-chtab="${k}">${l}</button>`).join("")}</div>${body}`;
}

async function playVideo(item, kind) {
  const ch = S.ch; if (!ch) return;
  const vod = { id: item.id, kind, title: item.title, variants: [], sel: 0 };
  ch.vod = vod;
  setPlayerState("loading");
  syncVodUI();
  renderChannelTab();
  $("#main").scrollTo({ top: 0, behavior: "smooth" });
  try {
    vod.variants = await invoke("video_play", { platform: ch.platform, id: item.id, kind: kind === "clips" ? "clip" : "video" });
    if (ch.vod !== vod) return;
    if (!vod.variants.length) throw new Error("No playable versions");
    startPlayback();
  } catch (e) {
    if (ch.vod !== vod) return;
    ch.error = String(e.message || e);
    setPlayerState("error");
  }
}

let clipBusy = false;
async function saveClip() {
  if (clipBusy) return;
  if (S.ch?.vod) { toast("Clips work on live streams"); return; }
  if (!S.ch?.info.live) { toast("The stream is offline"); return; }
  clipBusy = true;
  toast("Saving the last 60 seconds…");
  try {
    const path = await invoke("save_clip", { seconds: 60 });
    toast("Clip saved");
    const t = $("#toast");
    t.innerHTML = `Clip saved · <a href="#" id="revealClip" style="color:var(--brand);font-weight:700">Show in folder</a>`;
    $("#revealClip").onclick = (e) => { e.preventDefault(); invoke("reveal_file", { path }); };
  } catch (e) { toast(`Couldn't save clip: ${e}`); }
  clipBusy = false;
}

function backToLive() {
  const ch = S.ch; if (!ch) return;
  ch.vod = null;
  renderChannelTab();
  if (ch.info.live && ch.info.variants.length) startPlayback();
  else { destroyPlayerMedia(); setPlayerState("offline"); syncVodUI(); }
}

function destroyPlayerMedia() {
  if (hls) { hls.destroy(); hls = null; }
  const v = $("#video");
  if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
}

function syncVodUI() {
  const vod = S.ch?.vod;
  $("#cSeek")?.classList.add("hidden"); // timeupdate shows it again when there's something to seek
  $("#cTime")?.classList.add("hidden");
  $("#cLive")?.classList.toggle("hidden", !!vod);
  $("#cClip")?.classList.toggle("hidden", !!vod);
  $("#cBackLive")?.classList.toggle("hidden", !vod);
  const t = $("#vodTitle");
  if (t) { t.classList.toggle("hidden", !vod); t.textContent = vod ? `${vod.kind === "clips" ? "Clip" : "Past broadcast"} · ${vod.title || ""}` : ""; }
  if ($("#cBackLive")) $("#cBackLive").innerHTML = `${I.live}${S.ch?.info.live ? "Back to live" : "Close video"}`;
}

// ------------------------------------------------------------------ chat panel
const myName = (p) => (p === "Twitch" ? S.st.twitch?.name : S.st.kick?.name) || "";

function buildChat() {
  const c = $("#chat");
  c.classList.toggle("hidden", S.popout ? false : !S.st.show_chat || S.popped);
  const p = S.ch.platform;
  const me = p === "Twitch" ? S.st.twitch : S.st.kick;
  c.innerHTML = `
    <div class="chat-head"><span>${S.popout ? `${pbadge(p, "inline")} ${esc(S.ch.info.display)}` : "Chat"}</span><span class="grow"></span>
      <button class="icon-btn ch-tool" id="chatSearchBtn" title="Search chat (Ctrl+F)">${I.search}</button>
      <button class="icon-btn ch-tool" id="chatPauseBtn" title="Pause chat">${I.pause}</button>
      <button class="icon-btn ch-tool" id="chatClearBtn" title="Clear chat view (stays connected)">${I.trash}</button>
      <button class="icon-btn ch-tool" id="chatCfgBtn" title="Chat settings">${I.sliders}</button>
      ${S.popout ? "" : `<button class="icon-btn" id="chatPop" title="Pop out chat">${I.popout}</button><button class="icon-btn" id="chatHide" title="Hide chat">${I.arrowCollapse}</button>`}</div>
    <div class="chat-search hidden" id="chatSearch">
      <div class="cs-input">${I.search}<input id="chatSearchInput" placeholder="Search messages and names" spellcheck="false"><span class="cs-count" id="chatSearchCount"></span></div>
      <div class="cs-plats">${["all", "Twitch", "Kick"].map((x) => `<button class="cs-plat ${x === S.chatView.platform ? "on" : ""}" data-csplat="${x}">${x === "all" ? "All" : PICON[x] + x}</button>`).join("")}</div>
    </div>
    <div class="chat-log" id="chatLog"><div class="msg sys">Welcome to the chat room!</div></div>
    <button class="chat-paused hidden" id="chatPaused">Chat paused · scroll to resume</button>
    <div class="chat-foot">
      <div class="chat-pop hidden" id="chatPopover"></div>
      <div class="reply-bar hidden" id="replyBar"></div>
      ${me ? `<form class="chat-input" id="chatForm" autocomplete="off"><input id="chatText" maxlength="500" placeholder="Send a message" spellcheck="false">
          <button type="button" class="icon-btn em-btn" id="emoteBtn" title="Emotes">${I.smile}</button></form>
        <div class="row"><span class="pts-slot" id="ptsSlot"></span><span class="grow"></span><span class="as">Chatting as <b style="color:var(--fg)">${esc(me.name)}</b></span><button class="btn primary sm" id="chatSend">Chat</button></div>`
      : `<div class="chat-signin">Sign in to ${p} to chat<button class="btn primary" data-view-btn="accounts">Log in</button></div>`}
    </div>`;
  c.style.position = "relative";
  const log = $("#chatLog");
  S.chatView.paused = false;
  S.chatView.pending = 0;
  log.addEventListener("scroll", () => {
    if (atBottom(log) && !S.chatView.paused) { $("#chatPaused").classList.add("hidden"); S.chatView.pending = 0; }
  });
  $("#chatPaused").onclick = () => setChatPaused(false);
  $("#chatPauseBtn").onclick = () => setChatPaused(!S.chatView.paused);
  $("#chatClearBtn").onclick = () => { log.innerHTML = '<div class="msg sys">Chat view cleared. Still connected.</div>'; S.chatMsgs = []; S.chatRaw = []; };
  $("#chatCfgBtn").onclick = () => openChatSettings();
  $("#chatSearchBtn").onclick = () => toggleChatSearch();
  $("#chatSearchInput").addEventListener("input", debounce(applyChatView, 120));
  $("#chatSearchInput").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); toggleChatSearch(false); } });
  if ($("#chatHide")) $("#chatHide").onclick = () => { S.st.show_chat = false; invoke("set_prefs", { showChat: false }); setChatOpen(false); };
  if ($("#chatPop")) $("#chatPop").onclick = () => { invoke("popout_chat").then(() => { S.popped = true; setChatOpen(false); }).catch((e) => toast(String(e))); };
  const form = $("#chatForm");
  if (form) {
    const input = $("#chatText");
    const send = async (e) => {
      e?.preventDefault();
      if (acState.open) { acPick(); return; }
      let text = input.value.trim();
      if (!text) return;
      const reply = S.replyTo;
      if (reply && p === "Twitch" && !text.toLowerCase().startsWith("@" + reply.login.toLowerCase())) text = `@${reply.name} ${text}`;
      input.value = "";
      setReply(null);
      try { await invoke("chat_send", { platform: p, text, replyTo: reply?.id || null, replyName: reply?.name || null, replyText: reply?.text || null }); }
      catch (err) { toast(String(err)); input.value = text; }
    };
    form.onsubmit = send;
    $("#chatSend").onclick = send;
    input.addEventListener("input", updateAutocomplete);
    input.addEventListener("keydown", acKeydown);
    $("#emoteBtn").onclick = (e) => { e.stopPropagation(); toggleEmotePicker(); };
  }
  renderPoints();
}
const atBottom = (n) => n.scrollHeight - n.scrollTop - n.clientHeight < 40;

// --- badges
const KICK_BADGE = {
  broadcaster: ["#e51147", '<path d="M3 7h12v10H3zM15 10l6-3v10l-6-3z" fill="#fff"/>'],
  moderator: ["#00a3ff", '<path d="M5 19 15 9l-1.5-1.5L16 5l3 3-2.5 2.5L15 9M5 19l-1 1M7 13l4 4" stroke="#fff" stroke-width="2" fill="none"/>'],
  vip: ["#ffb800", '<path d="M12 4 20 10 12 20 4 10Z" fill="#fff"/>'],
  og: ["#00c48c", '<text x="12" y="16" font-size="10" font-weight="800" text-anchor="middle" fill="#fff" font-family="Inter,sans-serif">OG</text>'],
  founder: ["#ff7a00", '<path d="m12 4 2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16l-5 3 1.2-5.6L4 9.6 9.6 9z" fill="#fff"/>'],
  verified: ["#53fc18", '<path d="m7 12 3.5 3.5L17 9" stroke="#000" stroke-width="2.6" fill="none"/>'],
  staff: ["#7c3aed", '<path d="M7 5h4v5h2V7h2V5h4v6h-2v2h2v6h-4v-2h-2v-3h-2v5H7z" fill="#fff"/>'],
  sub_gifter: ["#c026d3", '<path d="M5 10h14v9H5zM4 7h16v3H4zM12 7v12" stroke="#fff" stroke-width="1.6" fill="none"/>'],
  subscriber: ["#53fc18", '<path d="m12 5 2 4.5 5 .5-3.8 3.3 1.1 4.9L12 15.6 7.7 18.2l1.1-4.9L5 10l5-.5z" fill="#000"/>'],
};
function badgeHTML(p, key) {
  if (p === "Twitch") {
    const u = S.badges[key];
    return u ? `<img class="bdg" src="${esc(u)}" alt="" title="${esc(key.split("/")[0].replace(/[-_]/g, " "))}">` : "";
  }
  const [type, n] = key.split("/");
  if (type === "subscriber" && S.kickSubBadges.length) {
    const b = S.kickSubBadges.find((x) => (+n || 1) >= x.months) || S.kickSubBadges[S.kickSubBadges.length - 1];
    if (b?.url) return `<img class="bdg" src="${esc(b.url)}" alt="" title="Subscriber${n ? ` (${n} months)` : ""}">`;
  }
  const d = KICK_BADGE[type];
  return d ? `<span class="bdg kb" title="${esc(type.replace(/_/g, " "))}" style="background:${d[0]}"><svg viewBox="0 0 24 24">${d[1]}</svg></span>` : "";
}

let msgSeq = 0;
function msgHTML(m) {
  if (m.system) return `<div class="msg sys">${esc(m.spans.map((s) => s.v).join(""))}</div>`;
  const spans = [...m.spans];
  // Twitch replies repeat "@parent " at the start of the text; the reply line already shows it.
  if (m.reply && spans[0]?.t === "text") spans[0] = { ...spans[0], v: spans[0].v.replace(/^@\S+\s/, "") };
  const g = CE.cfg.general, a = CE.cfg.appearance;
  const body = spans.map((s) => (s.t === "emote" ? `<img class="em" src="${esc(s.v)}" alt="" loading="lazy">` : g.linkify ? linkify(s.v) : esc(s.v))).join("");
  const platform = m.platform || S.ch?.platform;
  const ce = m.ce || {};
  const hl = ce.hl;
  const badges = g.badges ? (m.badges || []).map((b) => badgeHTML(platform, b)).join("") : "";
  // name color: per-user custom color > "readable" (already adjusted by the backend) > single color
  const nameColor = ce.color || (a.nameColors === "mono" ? "var(--fg)" : m.color);
  const note = CE.user(platform, m.login)?.note;
  const ts = g.timestamps ? `<span class="ce-ts">${new Date(m.ts || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>` : m.prefix ? `<span class="pre">${esc(m.prefix)}</span>` : "";
  const hlStyle = hl ? ` style="${hl.bg ? `--hlbg:${esc(hl.bg)};` : ""}${hl.color ? `--hlfg:${esc(hl.color)};` : ""}"` : "";
  const cls = ["msg", hl || m.highlight ? "hl" : "", hl ? "ce-hl" : "", hl?.emph ? "ce-emph" : "", hl?.color ? "ce-hlfg" : ""].filter(Boolean).join(" ");
  return `<div class="${cls}" data-seq="${m.seq}" data-p="${platform}"${hlStyle}>
    ${m.reply && !a.compact ? `<div class="rline">${I.reply}<span>Replying to <b>@${esc(m.reply.name)}</b>: ${esc(m.reply.text)}</span></div>` : ""}
    ${ts}${g.platformIcon ? `<span class="ce-pi ${platform === "Kick" ? "k" : "t"}">${PICON[platform] || ""}</span>` : ""}${badges}${ce.fav ? `<span class="ce-fav" title="Favorite">${I.star}</span>` : ""}<span class="u" style="color:${esc(nameColor)}" data-user="${m.seq}">${esc(m.name)}</span>${note ? `<span class="ce-note" title="${esc(note)}">${I.note}</span>` : ""}<span class="t">: ${body}</span>
    ${m.id && S.ch && (platform === "Twitch" ? S.st.twitch : S.st.kick) ? `<button class="mact" data-reply="${m.seq}" title="Reply">${I.reply}</button>` : ""}
  </div>`;
}
const linkify = (t) => esc(t).replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a class="clink" data-ext="${u}">${u}</a>`);

function setReply(m) {
  S.replyTo = m ? { id: m.id, name: m.name, login: m.login, text: m.spans.map((s) => (s.t === "text" ? s.v : "")).join("").slice(0, 80) } : null;
  const bar = $("#replyBar"); if (!bar) return;
  bar.classList.toggle("hidden", !m);
  if (m) {
    bar.innerHTML = `${I.reply}<span class="grow">Replying to <b>@${esc(m.name)}</b><small>${esc(S.replyTo.text)}</small></span><button class="icon-btn" id="replyX" title="Cancel">${I.close}</button>`;
    $("#replyX").onclick = () => setReply(null);
    $("#chatText")?.focus();
  }
}

// --- @mention autocomplete
const acState = { open: false, items: [], idx: 0, start: 0 };
function chatters() {
  const seen = new Set(), out = [];
  for (let i = S.chatMsgs.length - 1; i >= 0; i--) { const m = S.chatMsgs[i]; if (!seen.has(m.login)) { seen.add(m.login); out.push(m.name); } }
  return out;
}
function updateAutocomplete() {
  const input = $("#chatText"), pop = $("#chatPopover");
  const pos = input.selectionStart, before = input.value.slice(0, pos);
  const mt = before.match(/@(\w*)$/);
  if (!mt) { closeAc(); return; }
  const q = mt[1].toLowerCase();
  acState.items = chatters().filter((n) => n.toLowerCase().startsWith(q)).slice(0, 8);
  if (!acState.items.length) { closeAc(); return; }
  acState.open = true; acState.idx = 0; acState.start = pos - mt[0].length;
  pop.dataset.kind = "ac";
  renderAc();
}
function renderAc() {
  const pop = $("#chatPopover");
  pop.classList.remove("hidden");
  pop.innerHTML = acState.items.map((n, i) => `<button class="ac-row ${i === acState.idx ? "sel" : ""}" data-ac="${i}">@${esc(n)}</button>`).join("");
}
function closeAc() { if (!acState.open) return; acState.open = false; const pop = $("#chatPopover"); if (pop?.dataset.kind === "ac") pop.classList.add("hidden"); }
function acPick(i = acState.idx) {
  const input = $("#chatText"), name = acState.items[i];
  if (!name) return;
  const pos = input.selectionStart;
  input.value = input.value.slice(0, acState.start) + "@" + name + " " + input.value.slice(pos);
  const c = acState.start + name.length + 2;
  input.setSelectionRange(c, c);
  closeAc();
  input.focus();
}
function acKeydown(e) {
  if (!acState.open) { if (e.key === "Escape" && S.replyTo) setReply(null); return; }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); acState.idx = (acState.idx + (e.key === "ArrowDown" ? 1 : -1) + acState.items.length) % acState.items.length; renderAc(); }
  else if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); acPick(); }
  else if (e.key === "Escape") { e.preventDefault(); closeAc(); }
}

// --- emote picker
async function toggleEmotePicker() {
  const pop = $("#chatPopover");
  if (!pop.classList.contains("hidden") && pop.dataset.kind === "em") { pop.classList.add("hidden"); return; }
  closeAc();
  pop.dataset.kind = "em";
  pop.classList.remove("hidden");
  const ch = S.ch;
  if (!ch.emotes) {
    pop.innerHTML = `<div class="tab-loading"><div class="spinner"></div></div>`;
    ch.emotes = await invoke("chat_emotes", { platform: ch.platform, login: ch.login }).catch(() => []);
    if (S.ch !== ch || pop.dataset.kind !== "em") return;
  }
  const render = (q = "") => {
    const list = ch.emotes.filter((e) => !q || e.name.toLowerCase().includes(q));
    const groups = [...new Set(list.map((e) => e.group))];
    $("#emGrid").innerHTML = groups.length ? groups.map((g) => `<div class="em-group">${esc(g)}</div><div class="em-row">${list.filter((e) => e.group === g).map((e) =>
      `<button class="em-cell ${e.locked ? "locked" : ""}" data-em="${ch.emotes.indexOf(e)}" title="${esc(e.name)}${e.locked ? " (subscribers only)" : ""}"><img src="${esc(e.url)}" alt="" loading="lazy"></button>`).join("")}</div>`).join("")
      : `<div class="hint" style="padding:12px">No emotes found.</div>`;
  };
  pop.innerHTML = `<div class="em-picker"><input id="emSearch" placeholder="Search emotes" spellcheck="false"><div class="em-grid" id="emGrid"></div></div>`;
  render();
  $("#emSearch").oninput = (e) => render(e.target.value.trim().toLowerCase());
  $("#emSearch").focus();
}
function insertEmote(e) {
  if (e.locked) { toast("Subscribe to use this emote"); return; }
  const input = $("#chatText"); if (!input) return;
  const code = e.code || e.name;
  const pos = input.selectionStart ?? input.value.length;
  const pre = input.value.slice(0, pos), post = input.value.slice(pos);
  const ins = (pre && !pre.endsWith(" ") ? " " : "") + code + " ";
  input.value = pre + ins + post;
  input.setSelectionRange(pos + ins.length, pos + ins.length);
}

// --- user card
async function openUserCard(m, anchor) {
  $("#userCard")?.remove();
  const ch = S.ch; if (!ch) return;
  const r = anchor.getBoundingClientRect();
  const card = el(`<div class="ucard" id="userCard"><div class="tab-loading"><div class="spinner"></div></div></div>`);
  document.body.appendChild(card);
  const place = () => { card.style.left = Math.max(8, Math.min(r.left - 20, innerWidth - card.offsetWidth - 8)) + "px"; card.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - card.offsetHeight - 8)) + "px"; };
  place();
  const recent = S.chatMsgs.filter((x) => x.login === m.login).slice(-12);
  let info = null;
  try { info = await invoke("user_card", { platform: ch.platform, channel: ch.login, user: m.login }); } catch {}
  if (!$("#userCard")) return;
  const since = info?.following_since ? `Following since ${new Date(info.following_since).toLocaleDateString()}` : info?.created ? `Account created ${new Date(info.created).toLocaleDateString()}` : "";
  card.innerHTML = `
    <div class="uc-head">${avatar(ch.platform, info?.avatar, m.name, "lg")}
      <div class="grow"><div class="uc-name" style="color:${esc(m.color)}">${esc(info?.display || m.name)}</div>
        <div class="uc-sub">${esc(since)}${info?.subscribed_for ? ` · subscribed ${info.subscribed_for} months` : ""}${info?.followers != null ? ` · ${fmt(info.followers)} followers` : ""}</div>
        <div class="uc-badges">${(m.badges || []).map((b) => badgeHTML(ch.platform, b)).join("")}</div></div>
      <button class="icon-btn" data-ucclose title="Close">${I.close}</button></div>
    ${info?.bio ? `<div class="uc-bio">${esc(info.bio)}</div>` : ""}
    <div class="uc-recent"><div class="uc-label">Recent messages</div>${recent.map((x) => `<div class="uc-msg">${x.spans.map((s) => (s.t === "emote" ? `<img class="em" src="${esc(s.v)}" alt="">` : esc(s.v))).join("")}</div>`).join("") || '<div class="hint">None yet</div>'}</div>
    <div class="uc-actions">
      ${myName(ch.platform) ? `<button class="btn secondary sm" data-ucmention="${esc(m.name)}">Mention</button>` : ""}
      ${myName(ch.platform) && m.id ? `<button class="btn secondary sm" data-reply="${m.seq}">Reply</button>` : ""}
      <button class="btn primary sm" data-open="${ch.platform}|${esc(m.login)}">View channel</button>
    </div>`;
  place();
}

// --- channel points (Twitch)
function renderPoints() {
  const slot = $("#ptsSlot"); if (!slot) return;
  const p = S.points;
  if (!p || S.ch?.platform !== "Twitch" || p.enabled === false) { slot.innerHTML = ""; return; }
  const icon = p.icon ? `<img src="${esc(p.icon)}" alt="">` : I.points;
  slot.innerHTML = `<button class="pts-btn" id="ptsBtn" title="${esc(p.name)}">${icon}<b>${fmt(p.balance || 0)}</b>${p.claim ? '<span class="pts-claim">Claim!</span>' : ""}</button>`;
}
function togglePointsMenu() {
  const pop = $("#chatPopover");
  if (!pop.classList.contains("hidden") && pop.dataset.kind === "pts") { pop.classList.add("hidden"); return; }
  const p = S.points; if (!p) return;
  closeAc();
  pop.dataset.kind = "pts";
  pop.classList.remove("hidden");
  pop.innerHTML = `<div class="pts-menu">
    <div class="pts-head">${p.icon ? `<img src="${esc(p.icon)}" alt="">` : I.points}<b>${fmt(p.balance || 0)}</b><span>${esc(p.name)}</span></div>
    <p class="hint">Points build up while you watch here.${S.st.auto_claim ? " Bonus chests are claimed for you." : ""}</p>
    <div class="pts-list">${(p.rewards || []).map((r, i) => `<button class="reward ${r.available && (p.balance || 0) >= r.cost ? "" : "dim"}" data-reward="${i}" style="--rc:${esc(r.color || "#2dd4bf")}">
        <span class="ri">${r.image ? `<img src="${esc(r.image)}" alt="">` : I.gift}</span><span class="rt">${esc(r.title)}</span><span class="rc">${fmt(r.cost)}</span></button>`).join("") || '<div class="hint">This channel has no custom rewards.</div>'}</div>
  </div>`;
}
async function redeemReward(i) {
  const p = S.points, r = p?.rewards?.[i]; if (!r) return;
  if ((p.balance || 0) < r.cost) { toast(`You need ${fmt(r.cost - p.balance)} more points`); return; }
  if (!r.available) { toast("This reward isn't available right now"); return; }
  const pop = $("#chatPopover");
  pop.innerHTML = `<div class="pts-menu"><div class="pts-head"><b>${esc(r.title)}</b><span>${fmt(r.cost)}</span></div>
    ${r.prompt ? `<p class="hint">${esc(r.prompt)}</p>` : ""}
    ${r.input ? `<input class="field" id="rewardText" maxlength="200" placeholder="Your message" spellcheck="false">` : ""}
    <div class="row-actions"><button class="btn secondary sm" data-rcancel>Back</button><button class="btn primary sm" data-rconfirm="${i}">Redeem for ${fmt(r.cost)}</button></div></div>`;
  $("#rewardText")?.focus();
}
async function confirmRedeem(i) {
  const r = S.points?.rewards?.[i]; if (!r) return;
  const text = $("#rewardText")?.value.trim();
  if (r.input && !text) { toast("Type a message first"); return; }
  try {
    await invoke("points_redeem", { login: S.ch.login, reward: r, text: text || null });
    toast(`Redeemed ${r.title}`);
    $("#chatPopover").classList.add("hidden");
    S.points = await invoke("points_status", { login: S.ch.login });
    renderPoints();
  } catch (e) { toast(`Couldn't redeem: ${e}`); }
}

// ------------------------------------------------------------------ backend events
listen("chat", (e) => {
  const { gen, messages } = e.payload;
  if (gen !== S.chatGen) return;
  const log = $("#chatLog"); if (!log) return;
  const stick = atBottom(log) && !S.chatView.paused;
  const ctx = chatCtx();
  const now = Date.now();
  // raw copies (pre-filter) let settings changes re-render the visible chat instantly
  for (const m of messages) { m.ts = now; if (!m.system) { S.chatRaw.push(m); } }
  if (S.chatRaw.length > 400) S.chatRaw.splice(0, S.chatRaw.length - 400);
  // pipeline: Chat Enhancer (normalize/filter/users/highlight) -> plugins -> render
  const shown = messages.map((m) => CE.process(m, ctx)).filter(Boolean).map((m) => Plugins.filterChat(m)).filter(Boolean);
  for (const m of shown) { m.seq = ++msgSeq; if (!m.system) S.chatMsgs.push(m); }
  if (S.chatMsgs.length > 400) S.chatMsgs.splice(0, S.chatMsgs.length - 400);
  notifyHighlights(shown);
  const html = shown.map(msgHTML).join("");
  if (!html) return;
  log.insertAdjacentHTML("beforeend", html);
  while (log.childElementCount > 300) log.firstElementChild.remove();
  if (S.chatView.query || S.chatView.platform !== "all") applyChatView(shown.length);
  if (stick) log.scrollTop = log.scrollHeight;
  else {
    S.chatView.pending += shown.filter((m) => !m.system).length;
    const b = $("#chatPaused");
    b.textContent = S.chatView.paused ? `Chat paused · ${S.chatView.pending} new · click to resume` : `${S.chatView.pending} new messages · scroll to resume`;
    b.classList.remove("hidden");
  }
});
const msgBySeq = (s) => S.chatMsgs.find((m) => m.seq === +s);
const chatCtx = () => ({ platform: S.ch?.platform, me: myName(S.ch?.platform) });

/** Sound + desktop alerts for highlighted messages (throttled inside CE.beep). */
function notifyHighlights(list) {
  let sound = false;
  for (const m of list) {
    const hl = m.ce?.hl;
    if (!hl) continue;
    if (hl.sound) sound = true;
    if (hl.why === "Mentions you" && CE.cfg.notify.desktopOnMention && (document.hidden || !document.hasFocus())) {
      invoke("notify_desktop", { title: `${m.name} mentioned you in ${S.ch?.info?.display || "chat"}`, body: m.text || "" }).catch(() => {});
    }
  }
  if (sound) CE.beep();
}

/** Rebuild the visible chat from raw messages after a settings change (no reconnect). */
function rerenderChat() {
  const log = $("#chatLog"); if (!log || !S.ch) return;
  const stick = atBottom(log);
  const ctx = chatCtx();
  const shown = S.chatRaw.slice(-300).map((m) => CE.process(m, ctx, true)).filter(Boolean).map((m) => Plugins.filterChat(m)).filter(Boolean);
  for (const m of shown) m.seq ||= ++msgSeq;
  S.chatMsgs = shown.slice();
  log.innerHTML = shown.map(msgHTML).join("") || '<div class="msg sys">No messages match your chat filters yet.</div>';
  applyChatView();
  if (stick) log.scrollTop = log.scrollHeight;
}

function setChatPaused(on) {
  S.chatView.paused = on;
  const b = $("#chatPauseBtn");
  if (b) { b.innerHTML = on ? I.play : I.pause; b.title = on ? "Resume chat" : "Pause chat"; b.classList.toggle("on", on); }
  const log = $("#chatLog");
  if (!on && log) { log.scrollTop = log.scrollHeight; S.chatView.pending = 0; $("#chatPaused").classList.add("hidden"); }
  else if (on) { const p = $("#chatPaused"); p.textContent = "Chat paused · click to resume"; p.classList.remove("hidden"); }
}

function toggleChatSearch(force) {
  const box = $("#chatSearch"); if (!box) return;
  const open = force ?? box.classList.contains("hidden");
  box.classList.toggle("hidden", !open);
  $("#chatSearchBtn")?.classList.toggle("on", open);
  if (open) $("#chatSearchInput").focus();
  else { $("#chatSearchInput").value = ""; S.chatView.platform = "all"; $$(".cs-plat").forEach((x) => x.classList.toggle("on", x.dataset.csplat === "all")); applyChatView(); }
}

/** Search + platform view filter over rendered messages (CSS class toggles only, no re-render). */
function applyChatView(onlyLast = 0) {
  const log = $("#chatLog"); if (!log) return;
  const q = ($("#chatSearchInput")?.value || "").trim().toLowerCase();
  S.chatView.query = q;
  const plat = S.chatView.platform;
  const nodes = onlyLast ? [...log.children].slice(-onlyLast) : [...log.children];
  let hits = 0;
  for (const n of nodes) {
    if (n.classList.contains("sys")) { n.classList.toggle("ce-miss", !!q || plat !== "all"); continue; }
    const okP = plat === "all" || n.dataset.p === plat;
    const okQ = !q || n.textContent.toLowerCase().includes(q);
    n.classList.toggle("ce-miss", !(okP && okQ));
    if (okP && okQ) hits++;
  }
  const c = $("#chatSearchCount");
  if (c && !onlyLast) c.textContent = q || plat !== "all" ? `${hits} found` : "";
}

listen("points", (e) => {
  if (e.payload.gen !== S.chatGen) return;
  S.points = e.payload;
  renderPoints();
});
listen("toast", (e) => toast(e.payload));
listen("drops-connected", async (e) => {
  S.kickBusy = false;
  if (!e.payload.ok || !e.payload.message.startsWith("Kick")) toast(e.payload.message);
  rerenderAuth();
  S.st = await invoke("get_state");
  if (S.view === "drops") loadDrops();
  if (S.view === "accounts") renderMain();
  loadFollows();
});
listen("popout-closed", () => {
  S.popped = false;
  if (S.ch && S.view === "channel") $("#chat").classList.toggle("hidden", !S.st.show_chat);
});
// pop-out window: follow whatever channel the main window opens
listen("chat-context", (e) => { if (S.popout) applyPopoutContext(e.payload); });

listen("auth", async (e) => {
  const { ok, message, platform } = e.payload;
  if (platform === "Kick") S.kickBusy = false;
  else S.twitchCode = null;
  toast(message);
  S.st = await invoke("get_state");
  rerenderAuth();
  if (ok) loadFollows();
});

// pushed every 90 s by the backend's go-live notifier
listen("follows", (e) => { if (signedIn() && !S.popout) applyFollows(e.payload); });

// closed to tray: stop playback so nothing keeps playing invisibly
listen("window-hidden", () => { if (S.ch) { leaveChannel(); if (S.view === "channel") setView("following"); } });

// ------------------------------------------------------------------ global events
document.addEventListener("click", (e) => {
  if (!e.target.closest("#ctxMenu")) closeMenu();
  if (!e.target.closest(".search")) hideSuggest();
  if (!e.target.closest("#qmenu") && !e.target.closest("#cGear")) { $("#qmenu")?.remove(); $("#player")?.classList.remove("menu-open"); }
  if (!e.target.closest("#userCard") && !e.target.closest("[data-user]")) $("#userCard")?.remove();
  if (!e.target.closest("#chatPopover") && !e.target.closest("#emoteBtn") && !e.target.closest("#ptsBtn") && !e.target.closest("#chatText")) $("#chatPopover")?.classList.add("hidden");
  const csp = e.target.closest("[data-csplat]");
  if (csp) { S.chatView.platform = csp.dataset.csplat; $$(".cs-plat").forEach((x) => x.classList.toggle("on", x === csp)); applyChatView(); return; }
  const ext = e.target.closest("[data-ext]");
  if (ext) { e.preventDefault(); invoke("open_external", { url: ext.dataset.ext }); return; }
  const ddv = e.target.closest("[data-ddv]");
  if (ddv) { const id = $("#ddMenu").dataset.for; closeDropdown(); S.browse.f[id] = ddv.dataset.ddv; loadBrowse(); return; }
  const ddBox = e.target.closest("[data-dd]");
  if (ddBox) { if (ddBox.classList.contains("open")) closeDropdown(); else openDropdown(ddBox); return; }
  closeDropdown();
  const sgdel = e.target.closest("[data-sgdel]");
  if (sgdel) {
    e.stopPropagation();
    try { localStorage.setItem("recentSearches", JSON.stringify(recentSearches().filter((x) => x !== sgdel.dataset.sgdel))); } catch {}
    showRecent();
    return;
  }
  const sg = e.target.closest("[data-sg]");
  if (sg) { const s = suggestItems[+sg.dataset.sg]; if (s) pickSuggestion(s); return; }
  const stab = e.target.closest("[data-stab]");
  if (stab && S.search) { S.search.tab = stab.dataset.stab; renderMain(); return; }
  const scat = e.target.closest("[data-scat]");
  if (scat) { const c = S.searchCats?.[+scat.dataset.scat]; if (c) openCategory(c); return; }
  const fcat = e.target.closest("[data-fcat]");
  if (fcat) { const c = S.followCats?.[+fcat.dataset.fcat]; if (c) openCategory(c); return; }
  const svod = e.target.closest("[data-svod]");
  if (svod) {
    const x = S.search?.data?.videos?.[+svod.dataset.svod];
    if (x) openChannel("Twitch", x.login).then(() => playVideo(x, "videos"));
    return;
  }
  const btab = e.target.closest("[data-btab]");
  if (btab) { S.browse.tab = btab.dataset.btab; renderMain(); if (btab.dataset.btab === "live" && !S.browse.cards.length) loadBrowse(); return; }
  if (e.target.closest("[data-filter-drops]")) { S.browse.f.drops = !S.browse.f.drops; loadBrowse(); return; }
  if (e.target.closest("[data-filter-tag-clear]")) { S.browse.f.tag = ""; loadBrowse(); return; }
  const tag = e.target.closest("[data-tag]");
  if (tag) { e.stopPropagation(); S.browse.f.tag = tag.dataset.tag; S.browse.tab = "live"; setView("browse"); loadBrowse(); return; }
  const fyc = e.target.closest("[data-fycat]");
  if (fyc) { const s = S.forYou.sections?.[+fyc.dataset.fycat]; if (s?.cat) openCategory(s.cat); return; }
  if (e.target.closest("[data-catfollow]") && S.cat) { toggleCategoryFollow(S.cat); return; }
  const ch = e.target.closest("[data-cathide]");
  if (ch) { setHidden("category", ch.dataset.cathide, true).then(() => setView("categories")); return; }
  const ft = e.target.closest("[data-ftab]");
  if (ft) { S.following.tab = ft.dataset.ftab; if (ft.dataset.ftab === "categories" && !S.cats.list.length) loadCategories().then(() => renderMain()); renderMain(); return; }
  const uh = e.target.closest("[data-unhide]");
  if (uh) { const [kind, key] = uh.dataset.unhide.split("|"); setHidden(kind, key, false); return; }
  const ctab = e.target.closest("[data-chtab]");
  if (ctab && S.ch) { S.ch.tab = ctab.dataset.chtab; loadChannelTab(); return; }
  const vc = e.target.closest("[data-vod]");
  if (vc && S.ch) { const list = S.ch[S.ch.tab]; const item = list?.[+vc.dataset.vod]; if (item) playVideo(item, S.ch.tab); return; }
  const cat = e.target.closest("[data-cat]");
  if (cat) { const c = S.cats.list[+cat.dataset.cat]; if (c) openCategory(c); return; }
  const usr = e.target.closest("[data-user]");
  if (usr) { const m = msgBySeq(usr.dataset.user); if (m) openUserCard(m, usr); return; }
  const rp = e.target.closest("[data-reply]");
  if (rp) { const m = msgBySeq(rp.dataset.reply); $("#userCard")?.remove(); if (m) setReply(m); return; }
  if (e.target.closest("[data-ucclose]")) { $("#userCard")?.remove(); return; }
  const um = e.target.closest("[data-ucmention]");
  if (um) { const i = $("#chatText"); $("#userCard")?.remove(); if (i) { i.value = `${i.value}${i.value && !i.value.endsWith(" ") ? " " : ""}@${um.dataset.ucmention} `; i.focus(); } return; }
  const ac = e.target.closest("[data-ac]");
  if (ac) { acPick(+ac.dataset.ac); return; }
  const em = e.target.closest("[data-em]");
  if (em && S.ch?.emotes) { insertEmote(S.ch.emotes[+em.dataset.em]); return; }
  if (e.target.closest("#ptsBtn")) { togglePointsMenu(); return; }
  const rw = e.target.closest("[data-reward]");
  if (rw) { redeemReward(+rw.dataset.reward); return; }
  if (e.target.closest("[data-rcancel]")) { togglePointsMenu(); togglePointsMenu(); return; }
  const rc = e.target.closest("[data-rconfirm]");
  if (rc) { confirmRedeem(+rc.dataset.rconfirm); return; }
  const dc = e.target.closest("[data-drops-connect]");
  if (dc) { invoke("drops_connect", { platform: dc.dataset.dropsConnect }).then(() => toast(`Log in to ${dc.dataset.dropsConnect} in the new window`)).catch((x) => toast(String(x))); return; }
  const dd = e.target.closest("[data-drops-disconnect]");
  if (dd) { invoke("drops_disconnect", { platform: dd.dataset.dropsDisconnect }).then(async () => { S.st = await invoke("get_state"); loadDrops(); }); return; }
  const dcl = e.target.closest("[data-drops-claim]");
  if (dcl) {
    const [p, id, campaign] = dcl.dataset.dropsClaim.split("|");
    dcl.disabled = true;
    invoke("drops_claim", { platform: p, id, campaign }).then(() => { toast("Drop claimed"); loadDrops(); }).catch((x) => { toast(`Couldn't claim: ${x}`); dcl.disabled = false; });
    return;
  }
  const dw = e.target.closest("[data-drops-watch]");
  if (dw) {
    const [p, game, slug] = dw.dataset.dropsWatch.split("|");
    openCategory({ name: game, art: null, twitch: p === "Twitch" ? game : null, kick: p === "Kick" ? slug : null });
    return;
  }
  if (e.target.closest("#refreshDrops")) { loadDrops(); return; }
  if (e.target.closest("#refreshCats")) { loadCategories(); return; }
  const prov = e.target.closest("[data-act]");
  if (prov) { e.preventDefault(); onProviderAction(prov.dataset.act, prov); return; }
  const open = e.target.closest("[data-open]");
  if (open) { e.preventDefault(); const [p, l] = open.dataset.open.split("|"); openChannel(p, l); return; }
  const nav = e.target.closest("[data-view]");
  if (nav) { e.preventDefault(); setView(nav.dataset.view); return; }
  const vb = e.target.closest("[data-view-btn]");
  if (vb) { e.preventDefault(); setView(vb.dataset.viewBtn); return; }
  const pn = e.target.closest("[data-pnav]");
  if (pn) { Plugins.ui.nav[+pn.dataset.pnav]?.onClick?.(e); return; }
  const pp = e.target.closest("[data-pplayer]");
  if (pp) { e.stopPropagation(); Plugins.ui.player[+pp.dataset.pplayer]?.onClick?.(e); return; }
  const pref = e.target.closest("[data-pref]");
  if (pref) {
    const key = pref.dataset.pref, on = !pref.classList.contains("on");
    pref.classList.toggle("on", on);
    invoke("set_prefs", { [key]: on }).then(async () => { S.st = await invoke("get_state"); });
    return;
  }
  const tabBtn = e.target.closest("[data-shoptab]");
  if (tabBtn) { S.shop.tab = tabBtn.dataset.shoptab; renderPluginsPage(); return; }
  const pt = e.target.closest("[data-ptoggle]");
  if (pt) {
    const id = pt.dataset.ptoggle, on = !pt.classList.contains("on");
    invoke("plugin_set_enabled", { id, enabled: on }).then(async () => {
      await Plugins.refresh();
      renderPluginsPage();
      toast(`${on ? "Enabled" : "Disabled"} ${Plugins.installed.find((p) => p.manifest.id === id)?.manifest.name || id}`);
      if (id === "adblock" && S.ch?.platform === "Twitch" && S.ch.info.live) startPlayback();
    });
    return;
  }
  const pu = e.target.closest("[data-puninstall]");
  if (pu) {
    const id = pu.dataset.puninstall;
    Plugins.unload(id);
    invoke("plugin_uninstall", { id }).then(async () => {
      await Plugins.refresh();
      renderPluginsPage();
      toast(`Uninstalled ${id}. You can reinstall it from the Shop.`);
      if (id === "adblock" && S.ch?.platform === "Twitch" && S.ch.info.live) startPlayback();
    });
    return;
  }
  const pi = e.target.closest("[data-pinstall]");
  if (pi) {
    const [src, id] = pi.dataset.pinstall.split("|");
    const entry = S.shop.registry.find((x) => x.source === src && x.id === id);
    if (entry) { pi.disabled = true; pi.textContent = "Installing…"; installFromShop(entry); }
    return;
  }
  const sd = e.target.closest("[data-srcdel]");
  if (sd) {
    const list = [...(S.st.plugin_sources || [])];
    list.splice(+sd.dataset.srcdel, 1);
    invoke("set_plugin_sources", { sources: list }).then(async () => { S.st = await invoke("get_state"); loadShop(); });
    return;
  }
  if (e.target.closest("#openPluginsDir")) { invoke("open_plugins_dir"); return; }
  if (e.target.closest("#reloadPlugins")) {
    for (const id of [...Plugins.loaded.keys()]) Plugins.unload(id);
    Plugins.refresh().then(() => { renderPluginsPage(); toast("Plugins reloaded"); });
    return;
  }
  if (e.target.closest("#miniExpand")) { restoreFromMini(); return; }
  if (e.target.closest("#miniClose")) { leaveChannel(); return; }
  const acct = e.target.closest("[data-acct]");
  if (acct) {
    const p = acct.dataset.acct, a = p === "Twitch" ? S.st.twitch : S.st.kick;
    const r = acct.getBoundingClientRect();
    openMenu(r.right - 220, r.bottom + 8, [
      { html: `${avatar(p, a.avatar, a.name, "lg")}<span>${esc(a.name)}<br><small style="color:var(--fg-subtle);font-weight:400">${p}</small></span>` },
      "-",
      { label: "Settings", icon: I.accounts, run: () => setView("accounts") },
      { label: "Plugins", icon: I.puzzle, run: () => setView("plugins") },
      { label: `Sign out of ${p}`, icon: I.logout, run: () => onProviderAction("signout", { dataset: { p } }) },
    ]);
    return;
  }
  if (e.target.closest("#sideCollapse") || e.target.closest("#sideToggle")) {
    S.st.sidebar_collapsed = !S.st.sidebar_collapsed;
    invoke("set_prefs", { sidebarCollapsed: S.st.sidebar_collapsed });
    $("#sideTip")?.classList.remove("on");
    const sb = $("#sidebar");
    sb.classList.add("swap");
    renderSidebar();
    setTimeout(() => sb.classList.remove("swap"), 420);
    return;
  }
  if (e.target.closest("#sideMore")) { sideShowAll = true; renderSidebar(); return; }
  if (e.target.closest("#sideLess")) { sideShowAll = false; renderSidebar(); return; }
  if (e.target.closest("#refreshFollows")) { S.follows.rows = null; renderMain(); loadFollows(); return; }
  if (e.target.closest("#refreshBrowse")) { loadBrowse(); return; }
  if (e.target.closest("#logoLink")) { e.preventDefault(); setView("following"); }
});

// ------------------------------------------------------------------ chat message context menu + dialog
async function copyText(t, what) {
  try { await navigator.clipboard.writeText(t); toast(`Copied ${what}`); } catch { toast("Couldn't copy"); }
}

/** Small in-app dialog. fields: [{ key, label, type: "color"|"textarea"|"text", value }]. Resolves values or null. */
function ceDialog(title, fields, { okLabel = "Save", extra = null } = {}) {
  return new Promise((resolve) => {
    $("#ceDialog")?.remove();
    const d = el(`<div class="ce-dialog-wrap" id="ceDialog"><div class="ce-dialog">
      <div class="ced-title">${esc(title)}</div>
      ${fields.map((f) => `<label class="ced-field"><span>${esc(f.label)}</span>${
        f.type === "textarea" ? `<textarea data-k="${f.key}" rows="4" maxlength="500" spellcheck="false">${esc(f.value || "")}</textarea>`
        : f.type === "color" ? `<span class="ced-color"><input type="color" data-k="${f.key}" value="${esc(f.value || "#2dd4bf")}"><code>${esc(f.value || "#2dd4bf")}</code></span>`
        : `<input data-k="${f.key}" value="${esc(f.value || "")}" spellcheck="false">`}</label>`).join("")}
      <div class="row-actions">${extra ? `<button class="btn secondary sm" data-ced="extra">${esc(extra)}</button><span class="grow"></span>` : ""}<button class="btn secondary sm" data-ced="cancel">Cancel</button><button class="btn primary sm" data-ced="ok">${esc(okLabel)}</button></div>
    </div></div>`);
    document.body.appendChild(d);
    d.querySelectorAll('input[type=color]').forEach((i) => i.addEventListener("input", () => { i.nextElementSibling.textContent = i.value; }));
    const done = (v) => { d.remove(); resolve(v); };
    d.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ced]");
      if (e.target === d) return done(null);
      if (!b) return;
      if (b.dataset.ced === "cancel") return done(null);
      if (b.dataset.ced === "extra") return done({ __extra: true });
      const out = {};
      d.querySelectorAll("[data-k]").forEach((i) => (out[i.dataset.k] = i.value));
      done(out);
    });
    d.addEventListener("keydown", (e) => { if (e.key === "Escape") done(null); if (e.key === "Enter" && e.target.tagName === "INPUT") d.querySelector('[data-ced="ok"]').click(); });
    (d.querySelector("textarea, input:not([type=color])") || d.querySelector("input"))?.focus();
  });
}

function openMsgMenu(m, x, y) {
  const platform = m.platform || S.ch?.platform;
  const u = CE.user(platform, m.login) || {};
  const signed = !!myName(platform);
  const sel = String(getSelection() || "").trim();
  openMenu(x, y, [
    { html: `${pbadge(platform, "inline")}<span style="color:${esc(m.ce?.color || m.color)}">${esc(m.name)}</span>` },
    "-",
    ...(sel ? [{ label: "Copy selection", icon: I.copy, run: () => copyText(sel, "selection") }] : []),
    ...(signed && m.id ? [{ label: "Reply", icon: I.reply, run: () => setReply(m) }] : []),
    ...(signed ? [{ label: "Mention", icon: I.at, run: () => { const i = $("#chatText"); if (i) { i.value = `${i.value}${i.value && !i.value.endsWith(" ") ? " " : ""}@${m.name} `; i.focus(); } } }] : []),
    { label: "Copy message", icon: I.copy, run: () => copyText(m.text || m.spans.map((s) => s.v).join(""), "message") },
    { label: "Copy username", icon: I.copy, run: () => copyText(m.name, "username") },
    "-",
    { label: u.fav ? "Remove from favorites" : "Add to favorites", icon: I.star, run: () => CE.setUser(platform, m.login, { fav: !u.fav }, m.name) },
    { label: u.color ? "Change name color…" : "Set name color…", icon: I.palette, run: () => editUserColor(platform, m.login, m.name) },
    { label: u.note ? "Edit note…" : "Add private note…", icon: I.note, run: () => editUserNote(platform, m.login, m.name) },
    { label: "Highlight this user", icon: I.sparkle, run: () => { CE.update((c) => c.highlights.rules.push({ id: CE.newId(), enabled: true, type: "user", value: `${platform.toLowerCase()}:${m.login}`, platform: "any", color: "", bg: "#9147ff26", sound: false, emph: true, label: `User ${m.name}` })); toast(`Highlighting ${m.name} (${platform})`); } },
    { label: u.ignore ? "Stop ignoring" : `Ignore on ${platform}`, icon: I.ban, run: () => { CE.setUser(platform, m.login, { ignore: !u.ignore }, m.name); toast(u.ignore ? `Showing ${m.name} again` : `Ignoring ${m.name} on ${platform}. Undo in Settings → Chat → Users`); } },
    "-",
    { label: "View user card", icon: I.user, run: () => { const n = $(`#chatLog [data-user="${m.seq}"]`); if (n) openUserCard(m, n); } },
  ]);
}
async function editUserColor(platform, login, name) {
  const cur = CE.user(platform, login)?.color || "";
  const r = await ceDialog(`Name color for ${name} (${platform})`, [{ key: "color", label: "Color", type: "color", value: cur || "#2dd4bf" }], { extra: cur ? "Remove color" : null });
  if (!r) return;
  CE.setUser(platform, login, { color: r.__extra ? "" : r.color }, name);
}
async function editUserNote(platform, login, name) {
  const cur = CE.user(platform, login)?.note || "";
  const r = await ceDialog(`Private note: ${name} (${platform})`, [{ key: "note", label: "Only you can see this. Plugins can't read it.", type: "textarea", value: cur }], { extra: cur ? "Delete note" : null });
  if (!r) return;
  CE.setUser(platform, login, { note: r.__extra ? "" : r.note.trim() }, name);
}

document.addEventListener("contextmenu", (e) => {
  const msgEl = e.target.closest(".chat-log .msg:not(.sys)");
  if (msgEl && !e.target.closest("a")) {
    const m = msgBySeq(msgEl.dataset.seq);
    if (m) { e.preventDefault(); openMsgMenu(m, e.clientX, e.clientY); return; }
  }
  const open = e.target.closest("[data-open]");
  if (!open) { if (!e.target.closest("input, textarea, .chat-log, pre")) e.preventDefault(); return; }
  e.preventDefault();
  const [p, l] = open.dataset.open.split("|");
  const f = isFollowed(p, l);
  const cat = open.dataset.catName;
  openMenu(e.clientX, e.clientY, [
    { label: "Watch", icon: I.play, run: () => openChannel(p, l) },
    { label: f ? "Unfollow" : "Follow", icon: f ? I.heartFill : I.heart, run: () => toggleFollow(p, l) },
    "-",
    { label: `Hide ${l}`, icon: I.close, run: () => setHidden("channel", akey(p, l.toLowerCase()), true) },
    ...(cat ? [{ label: `Hide category "${cat}"`, icon: I.close, run: () => setHidden("category", cat, true) }] : []),
  ]);
});

document.addEventListener("submit", (e) => {
  if (e.target.id === "searchForm") {
    e.preventDefault();
    const i = $("#searchInput");
    if (suggestIdx >= 0 && suggestItems[suggestIdx]) { pickSuggestion(suggestItems[suggestIdx]); return; }
    doSearch(i.value);
  }
  if (e.target.id === "srcForm") {
    e.preventDefault();
    const url = $("#srcInput").value.trim();
    if (!url.startsWith("https://")) { toast("Plugin sources must start with https://"); return; }
    invoke("set_plugin_sources", { sources: [...(S.st.plugin_sources || []), url] }).then(async () => { S.st = await invoke("get_state"); loadShop(); });
  }
});

document.addEventListener("input", (e) => { if (e.target.id === "searchInput") runSuggest(e.target.value); });
document.addEventListener("focusin", (e) => { if (e.target.id === "searchInput" && !e.target.value.trim()) showRecent(); });
document.addEventListener("change", (e) => {
  const f = e.target.closest?.("[data-filter]");
  if (f) { S.browse.f[f.dataset.filter] = f.value; loadBrowse(); }
});
// infinite scroll on Browse → Livestreams
document.addEventListener("scroll", (e) => {
  const m = e.target;
  if (m.id !== "main" || S.view !== "browse" || S.browse.tab !== "live") return;
  if (m.scrollHeight - m.scrollTop - m.clientHeight < 600) loadBrowse(true);
}, true);

document.addEventListener("keydown", (e) => {
  if (e.target.id === "searchInput" && suggestItems.length) {
    if (e.key === "ArrowDown") { e.preventDefault(); suggestIdx = Math.min(suggestItems.length - 1, suggestIdx + 1); renderSuggest(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); suggestIdx = Math.max(-1, suggestIdx - 1); renderSuggest(); return; }
  }
  if (e.key === "Escape") { hideSuggest(); closeMenu(); }
  if (e.ctrlKey && e.key.toLowerCase() === "k" && !S.popout) { e.preventDefault(); $("#searchInput")?.focus(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === "f" && $("#chatSearch")) { e.preventDefault(); toggleChatSearch(true); return; }
  if (e.target.closest("input")) return;
  if (e.key === "Escape" && S.theater) { toggleTheater(); return; }
  if (S.view !== "channel") return;
  const v = $("#video"); if (!v) return;
  if (e.key === " ") { e.preventDefault(); togglePause(); }
  else if (e.key === "m") v.muted = !v.muted;
  else if (e.key === "f") toggleFullscreen();
  else if (e.key === "t") toggleTheater();
  else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    const d = e.key === "ArrowLeft" ? -10 : 10;
    const end = S.ch?.vod ? v.duration : (hls?.liveSyncPosition ?? Infinity);
    const start = v.seekable.length ? v.seekable.start(0) : 0;
    v.currentTime = Math.max(start, Math.min(end, v.currentTime + d));
  }
});

// ------------------------------------------------------------------ boot
function enterApp() {
  $("#gate").classList.add("hidden");
  $("#shell").classList.remove("hidden");
  $("#sideToggle").innerHTML = I.menu;
  $("#searchBtn").innerHTML = I.search;
  setView(S.st.follows.length ? "following" : "browse");
  loadFollows();
  if (!S.browse.at) loadBrowse();
}

/** Pop-out chat window: show only the chat for whatever channel the main window has open. */
function applyPopoutContext(ctx) {
  const c = $("#chat");
  if (!ctx) {
    S.ch = null;
    S.chatGen = -1;
    c.innerHTML = `<div class="empty" style="padding:60px 20px">${I.chat}<h2>No channel open</h2><p>Open a channel in duostream and its chat shows up here.</p></div>`;
    return;
  }
  if (S.ch && S.chatGen === ctx.gen) return;
  S.ch = { platform: ctx.platform, login: ctx.login, info: { display: ctx.display }, emotes: null };
  S.chatGen = ctx.gen;
  S.chatMsgs = []; S.chatRaw = []; S.replyTo = null; S.points = null; S.badges = {}; S.kickSubBadges = [];
  document.title = `${ctx.display} · chat`;
  buildChat();
  const ch = S.ch;
  if (ch.platform === "Twitch") {
    invoke("twitch_badges", { login: ch.login }).then((b) => { if (S.ch === ch) S.badges = b; });
    if (S.st.twitch) invoke("points_status", { login: ch.login }).then((p) => { if (S.ch === ch) { S.points = p; renderPoints(); } }).catch(() => {});
  } else {
    invoke("channel_about", { platform: "Kick", login: ch.login }).then((a) => { if (S.ch === ch) S.kickSubBadges = (a.sub_badges || []).sort((x, y) => y.months - x.months); }).catch(() => {});
  }
}

/** Our own title-bar buttons (the native Windows bar is off). */
function initWinbar() {
  $("#wbMin").onclick = () => appWindow.minimize();
  $("#wbMax").onclick = () => appWindow.toggleMaximize();
  $("#wbClose").onclick = () => appWindow.close();
  const sync = async () => {
    const max = await appWindow.isMaximized().catch(() => false);
    document.body.classList.toggle("maximized", max);
    $("#wbMax").title = max ? "Restore" : "Maximize";
    $("#wbMax").innerHTML = max
      ? '<svg viewBox="0 0 10 10"><rect x=".5" y="2.5" width="7" height="7"/><path d="M2.5 2.5V.5h7v7h-2"/></svg>'
      : '<svg viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9"/></svg>';
  };
  appWindow.onResized(sync);
  sync();
  // drag the window by empty navbar space (never by buttons, links, inputs or avatars)
  const nav = $(".navbar");
  const interactive = (t) => t.closest("button, a, input, form, select, .nav-avatar, .dd, .search, #suggest");
  nav.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || interactive(e.target)) return;
    if (e.detail === 2) { appWindow.toggleMaximize(); return; }
    appWindow.startDragging();
  });
}

// ------------------------------------------------------------------ updates (GitHub releases, signed)
const Upd = { state: "idle", version: null, error: null, pct: 0, current: APP_VERSION };
/** manual = from the Settings button (shows "up to date" / errors instead of staying quiet). */
async function checkUpdate(manual) {
  if (Upd.state === "downloading" || Upd.state === "installing") return;
  Upd.state = "checking"; Upd.error = null; renderUpdateRow();
  try {
    const u = await invoke("update_check");
    if (u) { Upd.state = "available"; Upd.version = u.version; showUpdateBar(); }
    else { Upd.state = "uptodate"; Upd.version = null; }
  } catch (e) {
    Upd.state = manual ? "error" : "idle";
    Upd.error = String(e);
    invoke("js_log", { msg: `update check: ${e}` });
  }
  renderUpdateRow();
}
async function installUpdate() {
  if (Upd.state === "downloading" || Upd.state === "installing") return;
  Upd.state = "downloading"; Upd.pct = 0;
  renderUpdateRow(); showUpdateBar();
  try { await invoke("update_install"); }
  catch (e) { Upd.state = "error"; Upd.error = String(e); toast(`Update failed: ${e}`); renderUpdateRow(); $("#updateBar")?.remove(); }
}
listen("update-progress", (e) => {
  const p = e.payload;
  if (p.installing) Upd.state = "installing";
  else if (p.total) Upd.pct = Math.min(100, Math.round((p.done / p.total) * 100));
  renderUpdateRow(); showUpdateBar();
});
const updLabel = () => (Upd.state === "downloading" ? `Downloading… ${Upd.pct}%` : Upd.state === "installing" ? "Installing… DuoStream restarts by itself" : "");
function showUpdateBar() {
  if (S.popout) return;
  let bar = $("#updateBar");
  if (!bar) {
    if (Upd.state !== "available") return;
    bar = el('<div class="update-bar" id="updateBar"></div>');
    document.body.appendChild(bar);
  }
  const busy = Upd.state === "downloading" || Upd.state === "installing";
  bar.innerHTML = `${I.refresh}<span>${busy ? updLabel() : `DuoStream <b>${esc(Upd.version)}</b> is available`}</span>
    ${busy ? `<div class="upd-prog"><i style="width:${Upd.state === "installing" ? 100 : Upd.pct}%"></i></div>`
      : `<button class="btn primary sm" data-upd="install">Update now</button><button class="icon-btn" data-upd="later" title="Later">${I.close}</button>`}`;
}
/** Settings → Accounts & app: current version + check / update button. */
function updateRowHTML() {
  const s = Upd.state;
  const status = s === "checking" ? "Checking for updates…"
    : s === "uptodate" ? "You're on the latest version."
    : s === "available" ? `Version ${esc(Upd.version)} is available.`
    : s === "error" ? `Couldn't check: ${esc(Upd.error || "")}`
    : updLabel() || "Updates are signed and install with one click.";
  const btn = s === "available" ? `<button class="btn primary sm" data-upd="install">Update to ${esc(Upd.version)}</button>`
    : s === "downloading" || s === "installing" ? `<div class="upd-prog wide"><i style="width:${s === "installing" ? 100 : Upd.pct}%"></i></div>`
    : `<button class="btn secondary sm" data-upd="check" ${s === "checking" ? "disabled" : ""}>${I.refresh}Check for updates</button>`;
  return `<div class="setting" id="updRow"><div><b>DuoStream ${esc(Upd.current)}</b><p class="${s === "error" ? "upd-err" : ""}">${status}</p></div>${btn}</div>`;
}
function renderUpdateRow() { const r = $("#updRow"); if (r) r.outerHTML = updateRowHTML(); }
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-upd]");
  if (!b) return;
  const a = b.dataset.upd;
  if (a === "check") checkUpdate(true);
  else if (a === "install") installUpdate();
  else if (a === "later") $("#updateBar")?.remove();
});

// ------------------------------------------------------------------ picture-in-picture window (#pip=Platform|login|display)
async function pipBoot() {
  document.body.classList.add("pip");
  ["#gate", "#shell", "#winbar"].forEach((s) => $(s)?.remove());
  const root = el(`<div class="pip-root" id="pipRoot">
    <video id="pipVideo" playsinline muted></video>
    <div class="pip-state" id="pipState"><div class="spinner"></div></div>
    <div class="pip-ui">
      <div class="pip-top"><span class="pip-name" id="pipName"></span><span class="grow"></span>
        <button class="pip-btn" id="pipBack" title="Back to DuoStream">${I.expand}</button>
        <button class="pip-btn close" id="pipClose" title="Close">${I.close}</button></div>
      <div class="pip-bottom">
        <button class="pip-btn" id="pipPlay" title="Pause">${I.pause}</button>
        <button class="pip-btn" id="pipMute" title="Mute">${I.vol}</button>
        <input type="range" id="pipVol" min="0" max="100">
        <span class="grow"></span><span class="pip-live"><span class="dot"></span>LIVE</span>
      </div>
    </div></div>`);
  document.body.appendChild(root);
  const v = $("#pipVideo");
  let ph = null, cur = null;
  const vol0 = S.st.volume ?? 70;
  $("#pipVol").value = vol0;
  $("#pipVol").style.setProperty("--p", vol0 + "%");
  const syncUI = () => {
    $("#pipPlay").innerHTML = v.paused ? I.play : I.pause;
    $("#pipMute").innerHTML = v.muted || v.volume === 0 ? I.mute : I.vol;
  };
  v.addEventListener("play", syncUI); v.addEventListener("pause", syncUI); v.addEventListener("volumechange", syncUI);
  v.addEventListener("playing", () => $("#pipState").classList.add("hidden"));
  async function load(platform, login, display) {
    cur = { platform, login, display };
    document.title = `${display} · duostream`;
    $("#pipName").innerHTML = `${pbadge(platform, "inline")}${esc(display)}`;
    $("#pipState").classList.remove("hidden");
    $("#pipState").innerHTML = '<div class="spinner"></div>';
    if (ph) { ph.destroy(); ph = null; }
    try {
      const info = await invoke("resolve", { platform, login });
      if (!info.live || !info.variants.length) throw new Error(`${display} is offline`);
      const q = (() => { try { return JSON.parse(localStorage.getItem(`chp:${akey(platform, login)}`) || "{}").q; } catch { return null; } })();
      const vi = Math.max(1, info.variants.findIndex((x) => x.name === q));
      const pick = info.variants[Math.min(vi, info.variants.length - 1)];
      const url = await invoke("play_url", { platform, login, name: pick.name, url: pick.url });
      ph = new Hls({ liveSyncDuration: 6, liveMaxLatencyDuration: 7200, enableWorker: true, maxBufferLength: 20 });
      ph.on(Hls.Events.MANIFEST_PARSED, () => { v.muted = false; v.volume = vol0 / 100; v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); });
      ph.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { if (d.type === Hls.ErrorTypes.MEDIA_ERROR) ph.recoverMediaError(); else setTimeout(() => ph?.startLoad(), 1500); } });
      ph.loadSource(url);
      ph.attachMedia(v);
    } catch (e) {
      $("#pipState").innerHTML = `<p>${esc(e.message || e)}</p>`;
    }
  }
  const [platform, login, display] = location.hash.slice(5).split("|").map(decodeURIComponent);
  load(platform, login, display || login);
  listen("pip-target", (e) => load(e.payload.platform, e.payload.login, e.payload.display));
  listen("pip-close", () => appWindow.close());
  $("#pipPlay").onclick = () => (v.paused ? v.play() : v.pause());
  $("#pipMute").onclick = () => { v.muted = !v.muted; };
  $("#pipVol").oninput = (e) => { v.muted = false; v.volume = e.target.value / 100; e.target.style.setProperty("--p", e.target.value + "%"); };
  $("#pipClose").onclick = () => appWindow.close();
  $("#pipBack").onclick = async () => { await invoke("show_main_window"); appWindow.close(); };
  // drag anywhere that isn't a control; double-click goes back to the app
  root.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest("button, input")) return;
    if (e.detail === 2) { $("#pipBack").click(); return; }
    appWindow.startDragging();
  });
  let idle;
  root.addEventListener("mousemove", () => { root.classList.add("active"); clearTimeout(idle); idle = setTimeout(() => root.classList.remove("active"), 2200); });
  root.addEventListener("mouseleave", () => root.classList.remove("active"));
  syncUI();
}

(async function boot() {
  if (location.hash.startsWith("#pip=")) {
    S.st = await invoke("get_state");
    pipBoot();
    return;
  }
  S.st = await invoke("get_state");
  await CE.load();
  // picture-in-picture window closed: resume the stream here
  listen("pip-closed", () => { if (S.ch?.inPip) { S.ch.inPip = false; if (S.ch.info.live && !S.ch.vod) startPlayback(); else setPlayerState("offline"); } });
  // settings saved in another window (main <-> pop-out chat)
  listen("ce-changed", (e) => { if (JSON.stringify(e.payload) !== JSON.stringify(CE.cfg)) CE.adopt(e.payload); });
  if (location.hash === "#popout") {
    S.popout = true;
    document.body.classList.add("popout");
    $("#winbar")?.remove();
    document.body.appendChild($("#chat"));
    $("#chat").classList.remove("hidden");
    $("#gate").classList.add("hidden");
    $("#shell").classList.add("hidden");
    await Plugins.refresh().catch((e) => console.error(e));
    applyPopoutContext(await invoke("chat_context"));
    return;
  }
  initWinbar();
  S.preview = await invoke("preview_mode");
  await Plugins.refresh().catch((e) => console.error(e));
  if (signedIn()) {
    enterApp();
    const arg = await invoke("startup_arg");
    if (arg === "view:chat") openChatSettings();
    else if (arg && arg.startsWith("view:")) setView(arg.slice(5));
    else if (arg) doSearch(arg.replace(/^twitch:/, "twitch.tv/").replace(/^kick:/, "kick.com/"));
  } else {
    $("#gate").classList.remove("hidden");
    renderGate();
  }
  // validate tokens + sync Twitch follows in the background
  invoke("restore_sessions").then(([st, notes]) => {
    S.st = st;
    notes.forEach(toast);
    if (!signedIn()) { leaveChannel(); $("#shell").classList.add("hidden"); $("#gate").classList.remove("hidden"); renderGate(); return; }
    renderNav();
    loadFollows();
  });
  // updates: check GitHub releases shortly after start, then every 6 hours
  setTimeout(() => checkUpdate(false), 8000);
  setInterval(() => checkUpdate(false), 6 * 3600e3);
  // refresh the stream list every 2 min unless you're scrolled into it (infinite scroll)
  setInterval(() => { if (!S.browse.cards.length || (S.view !== "browse" && S.browse.cards.length <= 60)) loadBrowse(); }, 120000);
})();
