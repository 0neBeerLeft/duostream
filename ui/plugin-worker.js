"use strict";
// Plugin sandbox. Every plugin runs in its own Web Worker built from this file + the plugin's code.
// A worker has no DOM, no window.__TAURI__ and no Tauri invoke key, so a plugin cannot call app
// commands (chat as you, spend points, change settings, install plugins). It only gets the `api`
// below, and everything it asks for goes through the host in app.js (Plugins), which checks it.
//
// `__INIT` is prepended by the host: { manifest, appVersion, icons, storage, state }.

const __hooks = Object.create(null);
const __unload = [];
const __clicks = new Map(); // ui id -> onClick
const __waits = new Map(); // request id -> resolve
let __seq = 0;
let __state = __INIT.state;
const __store = __INIT.storage || {};

const __post = (m) => { try { postMessage(m); } catch (e) { console.error("[plugin]", e); } };
const __id = () => ++__seq;
const __ask = (what) => new Promise((resolve) => { const rid = __id(); __waits.set(rid, resolve); __post({ t: "req", rid, what }); });
const __text = (v) => String(v ?? "").slice(0, 500);

function __uiItem(kind, opts) {
  const id = __id();
  const props = { icon: typeof opts.icon === "string" ? opts.icon : "", title: __text(opts.title), active: !!opts.active, text: __text(opts.text), visible: !!opts.visible };
  if (typeof opts.onClick === "function") __clicks.set(id, opts.onClick);
  __post({ t: "ui", kind, id, props });
  return {
    id, props,
    update(o = {}) {
      if ("icon" in o) props.icon = typeof o.icon === "string" ? o.icon : "";
      if ("title" in o) props.title = __text(o.title);
      if ("active" in o) props.active = !!o.active;
      if ("text" in o) props.text = __text(o.text);
      if ("visible" in o) props.visible = !!o.visible;
      if (typeof o.onClick === "function") __clicks.set(id, o.onClick);
      __post({ t: "ui", kind, id, props });
    },
    remove() { __clicks.delete(id); __post({ t: "ui-rm", kind, id }); },
  };
}

const api = Object.freeze({
  id: __INIT.manifest.id,
  manifest: __INIT.manifest,
  appVersion: __INIT.appVersion,
  icons: __INIT.icons,
  on(event, fn) {
    if (typeof fn !== "function") return;
    (__hooks[event] ||= []).push(fn);
    __post({ t: "hook", event: String(event) });
  },
  onUnload(fn) { if (typeof fn === "function") __unload.push(fn); },
  toast(text) { __post({ t: "toast", text: __text(text) }); },
  addStyle(css) {
    const id = __id();
    __post({ t: "style", id, css: String(css ?? "").slice(0, 100000) });
    return { remove() { __post({ t: "style-rm", id }); } };
  },
  addNavButton(opts = {}) { const it = __uiItem("nav", opts); return { update: it.update, remove: it.remove }; },
  addPlayerButton(opts = {}) { const it = __uiItem("player", opts); return { update: it.update, remove: it.remove }; },
  addPlayerBadge(text) {
    const it = __uiItem("badges", { text, visible: false });
    return { show(v = true) { it.update({ visible: v }); }, setText(t) { it.update({ text: t }); }, remove: it.remove };
  },
  storage: Object.freeze({
    get(key, def) { const k = String(key); return k in __store ? structuredClone(__store[k]) : def; },
    set(key, val) { const k = String(key); __store[k] = structuredClone(val); __post({ t: "store", key: k, value: val }); },
  }),
  channel() { return __state.channel ? { ...__state.channel } : null; },
  view() { return __state.view; },
  me() { return { ...__state.me }; },
  openChannel(platform, login) { __post({ t: "open", platform: String(platform), login: String(login) }); },
  reloadPlayer() { __post({ t: "reload" }); },
  adStatus() { return __ask("adStatus"); },
  /** Emotes this plugin adds to the emote picker: [{ name, url }] (https images). Replaces the previous list. */
  setEmotes(list) {
    const clean = (Array.isArray(list) ? list : []).slice(0, 5000)
      .filter((e) => e && typeof e.name === "string" && typeof e.url === "string" && e.url.startsWith("https://"))
      .map((e) => ({ name: e.name.slice(0, 100), url: e.url.slice(0, 500) }));
    __post({ t: "emotes", list: clean });
  },
});

function __run(event, payload) {
  for (const fn of __hooks[event] || []) {
    try { fn(payload); } catch (e) { console.error(`[plugin ${api.id}]`, e); }
  }
}

/** chat:message hooks may return false (hide) or a changed message object. */
function __chat(list) {
  return list.map((m) => {
    let cur = m;
    for (const fn of __hooks["chat:message"] || []) {
      try {
        const r = fn(cur);
        if (r === false) return null;
        if (r && typeof r === "object") cur = r;
      } catch (e) { console.error(`[plugin ${api.id}]`, e); }
    }
    return cur;
  });
}

onmessage = (e) => {
  const m = e.data || {};
  if (m.state) __state = m.state;
  if (m.t === "event") __run(m.event, m.payload);
  else if (m.t === "click") { const fn = __clicks.get(m.id); if (fn) try { fn(); } catch (err) { console.error(err); } }
  else if (m.t === "chat") {
    const out = __chat(m.msgs);
    try { postMessage({ t: "chat-res", rid: m.rid, out }); } catch { postMessage({ t: "chat-res", rid: m.rid, out: m.msgs }); } // un-clonable result
  } else if (m.t === "reply") { const r = __waits.get(m.rid); __waits.delete(m.rid); r?.(m.value); }
  else if (m.t === "unload") { for (const fn of __unload) { try { fn(); } catch (err) { console.error(err); } } }
};
