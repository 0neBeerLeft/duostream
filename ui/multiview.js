"use strict";
// ================================================================== Multiview
// Several live streams tiled in one window. The focused tile has the sound and the chat; click any tile to
// switch. Streams go through the same local proxy as the main player (Twitch ads stripped), quality follows
// the tile size unless picked by hand, and every tile reconnects by itself and waits for offline streamers.

I.grid = svg('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>');
I.focusLayout = svg('<rect x="3" y="4" width="12" height="16" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1"/><rect x="17" y="13" width="4" height="7" rx="1"/>');
I.plus = svg('<path d="M12 5v14M5 12h14"/>');

const MV_MAX = 6;
const MV = {
  tiles: [], // { id, platform, login, display, avatar, info, q, qName, url, hls, el, video, rec, stallT, stallAt }
  focus: null, // id of the tile with sound + chat
  layout: "grid", // "grid" | "focus"
  mounted: false,
  seq: 0,
};

const mvTile = (platform, login) => ({ id: ++MV.seq, platform, login, display: login, avatar: null, info: null, q: null, qName: null, url: null, hls: null, el: null, video: null, rec: null, stallT: -1, stallAt: 0 });
const mvFocused = () => MV.tiles.find((t) => t.id === MV.focus) || null;
const mvAlive = (t) => MV.mounted && MV.tiles.includes(t) && !!t.el;

function mvSave() {
  try {
    localStorage.setItem("mv:v1", JSON.stringify({
      layout: MV.layout,
      focus: MV.tiles.findIndex((t) => t.id === MV.focus),
      tiles: MV.tiles.map((t) => ({ platform: t.platform, login: t.login, display: t.display, avatar: t.avatar, q: t.q })),
    }));
  } catch {}
}
(function mvRestore() {
  try {
    const d = JSON.parse(localStorage.getItem("mv:v1") || "null");
    if (!d) return;
    MV.layout = d.layout === "focus" ? "focus" : "grid";
    MV.tiles = (d.tiles || []).slice(0, MV_MAX).map((x) => Object.assign(mvTile(x.platform, x.login), { display: x.display || x.login, avatar: x.avatar || null, q: x.q || null }));
    MV.focus = (MV.tiles[d.focus] || MV.tiles[0])?.id ?? null;
  } catch {}
})();

function mvNavCount() {
  const c = $("#mvCount");
  if (c) c.textContent = MV.tiles.length ? String(MV.tiles.length) : "";
}

// ------------------------------------------------------------------ adding / removing
function mvAdd(platform, login, opts = {}) {
  login = login.toLowerCase();
  let t = MV.tiles.find((x) => x.platform === platform && x.login === login);
  if (!t) {
    if (MV.tiles.length >= MV_MAX) { toast(`Multiview holds up to ${MV_MAX} streams. Remove one first.`); return; }
    t = mvTile(platform, login);
    const known = sidebarRows().find((r) => r.platform === platform && r.login === login);
    t.display = opts.display || known?.live?.display || login;
    t.avatar = opts.avatar || known?.live?.avatar || known?.avatar || null;
    if (opts.front) MV.tiles.unshift(t); else MV.tiles.push(t);
    if (!MV.focus || opts.focus) MV.focus = t.id;
    if (!opts.quiet) toast(`${t.display} added to multiview`);
  } else if (opts.focus) MV.focus = t.id;
  mvSave();
  mvNavCount();
  if (S.view === "multi") mvRender();
  else if (!opts.stay) setView("multi");
}

function mvRemove(id) {
  const t = MV.tiles.find((x) => x.id === id); if (!t) return;
  mvStopMedia(t);
  if (t.rec) clearTimeout(t.rec.timer);
  t.el?.remove();
  MV.tiles = MV.tiles.filter((x) => x !== t);
  if (MV.focus === id) MV.focus = MV.tiles[0]?.id ?? null;
  mvSave();
  mvNavCount();
  mvSync();
  mvAudio();
  const f = mvFocused();
  if (f) mvChat(f);
  else if (S.ch?.multi) leaveChannel();
}

/** Opening multiview while a stream is playing brings that stream along as the first tile. */
function mvAdoptCurrent() {
  if (!S.ch || S.ch.multi) return;
  const { platform, login, info } = S.ch;
  const live = info?.live && !S.ch.vod;
  leaveChannel();
  if (live) mvAdd(platform, login, { display: info.display, avatar: info.avatar, front: true, focus: true, quiet: true, stay: true });
}

function mvFocus(id) {
  if (MV.focus === id) return;
  MV.focus = id;
  mvSave();
  mvSync();
  mvAudio();
  const t = mvFocused();
  if (t) mvChat(t);
  if (MV.layout === "focus") mvRequality();
}

function mvSetLayout(l) {
  MV.layout = l;
  mvSave();
  mvSync();
  mvRequality();
}

// ------------------------------------------------------------------ view
function mvRender() {
  const main = $("#main");
  if (!MV.mounted || !$("#mv")) {
    MV.mounted = true;
    main.innerHTML = `<div class="mv" id="mv">
      <div class="mv-bar">
        <div class="mv-title">${I.grid}<b>Multiview</b><span class="sub" id="mvSub"></span></div>
        <span class="grow"></span>
        <div class="seg" id="mvLayout">
          <button data-mvlayout="grid" title="Grid (G)">${I.grid}</button>
          <button data-mvlayout="focus" title="Focus (G)">${I.focusLayout}</button>
        </div>
        <div class="mv-vol" title="Volume of the stream you're listening to">${I.vol}<input type="range" id="mvVol" min="0" max="100"></div>
        <button class="icon-btn" id="mvChatBtn" title="Show chat">${I.chat}</button>
        <button class="icon-btn" id="mvFull" title="Fullscreen">${I.full}</button>
        <button class="btn secondary sm" id="mvClear">Clear</button>
        <button class="btn primary sm" id="mvAddBtn">${I.plus}Add stream</button>
      </div>
      <div class="mv-grid" id="mvGrid"></div>
    </div>`;
    for (const t of MV.tiles) { t.el = null; t.url = null; }
    mvObserve();
  }
  mvSync();
  for (const t of MV.tiles) if (!t.hls && !t.rec) mvStart(t);
  mvAudio();
  const f = mvFocused();
  if (f?.info) mvChat(f);
  mvNavCount();
}

function mvSync() {
  const grid = $("#mvGrid"); if (!grid || !MV.mounted) return;
  const n = MV.tiles.length;
  $("#mv").classList.toggle("empty", !n);
  $$("[data-mvlayout]").forEach((b) => b.classList.toggle("on", b.dataset.mvlayout === MV.layout));
  const sub = $("#mvSub"); if (sub) sub.textContent = n ? `${n} of ${MV_MAX}` : "";
  const cb = $("#mvChatBtn"); if (cb) cb.classList.toggle("hidden", !!S.st.show_chat || S.popped || !n);
  if (!n) {
    $("#mvSlot")?.remove();
    grid.innerHTML = mvEmptyHTML();
    return;
  }
  $(".mv-empty", grid)?.remove();
  for (const t of MV.tiles) {
    if (!t.el) { mvTileEl(t); grid.appendChild(t.el); }
    t.el.classList.toggle("focused", t.id === MV.focus && n > 1);
    mvHead(t);
  }
  mvLayout();
}

/** Place the tiles as 16:9 rectangles that are as big as the area allows (no letterbox bars), centered. */
function mvLayout() {
  const grid = $("#mvGrid"); if (!grid || !MV.mounted) return;
  const PAD = 8, GAP = 8, R = 9 / 16;
  const W = grid.clientWidth - PAD * 2, H = grid.clientHeight - PAD * 2;
  const n = MV.tiles.length;
  if (W <= 0 || H <= 0 || !n) return;
  const rects = []; // in tile order; rects[n] = the "add" slot if there is room for one
  const focusT = MV.layout === "focus" && n > 1 ? mvFocused() : null;
  if (focusT) {
    const k = n - 1;
    // the small tiles either stack beside the big one or line up under it: whichever leaves it bigger
    const sR = Math.min(W * 0.26, (H - GAP * (k - 1)) / k / R);
    const bR = Math.min(W - sR - GAP, H / R);
    const sB = Math.min((W - GAP * (k - 1)) / k, H * 0.26 / R);
    const bB = Math.min(W, (H - sB * R - GAP) / R);
    const others = MV.tiles.filter((t) => t !== focusT);
    const big = {}, small = [];
    if (bR >= bB) {
      const totalW = bR + GAP + sR, x0 = PAD + (W - totalW) / 2;
      Object.assign(big, { x: x0, y: PAD + (H - bR * R) / 2, w: bR, h: bR * R });
      const colH = k * sR * R + (k - 1) * GAP, y0 = PAD + (H - colH) / 2;
      others.forEach((_, i) => small.push({ x: x0 + bR + GAP, y: y0 + i * (sR * R + GAP), w: sR, h: sR * R }));
    } else {
      const totalH = bB * R + GAP + sB * R, y0 = PAD + (H - totalH) / 2;
      Object.assign(big, { x: PAD + (W - bB) / 2, y: y0, w: bB, h: bB * R });
      const rowW = k * sB + (k - 1) * GAP, x0 = PAD + (W - rowW) / 2;
      others.forEach((_, i) => small.push({ x: x0 + i * (sB + GAP), y: y0 + bB * R + GAP, w: sB, h: sB * R }));
    }
    let i = 0;
    for (const t of MV.tiles) rects.push(t === focusT ? big : small[i++]);
  } else {
    // try every column count and keep the one with the biggest tiles
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const w = Math.min((W - GAP * (cols - 1)) / cols, (H - GAP * (rows - 1)) / rows / R);
      const score = rows > cols ? w * 0.85 : w; // a tall stack only wins when it is clearly bigger
      if (!best || score > best.score + 0.5) best = { cols, rows, w, score };
    }
    const { cols, rows, w } = best, h = w * R;
    const y0 = PAD + (H - (rows * h + (rows - 1) * GAP)) / 2;
    const cells = n < MV_MAX && cols * rows > n ? n + 1 : n; // a free cell becomes the "add" slot
    for (let i = 0; i < cells; i++) {
      const r = Math.floor(i / cols), inRow = Math.min(cols, cells - r * cols);
      const x0 = PAD + (W - (inRow * w + (inRow - 1) * GAP)) / 2; // a partial last row is centered
      rects.push({ x: x0 + (i % cols) * (w + GAP), y: y0 + r * (h + GAP), w, h });
    }
  }
  const put = (e, r) => Object.assign(e.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  MV.tiles.forEach((t, i) => t.el && put(t.el, rects[i]));
  let slot = $("#mvSlot");
  if (rects[n]) {
    if (!slot) { slot = el(`<button class="mv-slot" id="mvSlot">${I.plus}<span>Add stream</span></button>`); grid.appendChild(slot); }
    put(slot, rects[n]);
  } else slot?.remove();
}

function mvEmptyHTML() {
  const live = sidebarRows().filter((r) => r.live).slice(0, 8);
  return `<div class="mv-empty">${I.grid}<h2>Watch several streams at once</h2>
    <p>Add up to ${MV_MAX} streams from Twitch and Kick. Click a tile to hear it and see its chat.</p>
    <button class="btn primary" id="mvAddBtn2">${I.plus}Add stream</button>
    ${live.length ? `<div class="mv-quick">${live.map((r) => `<button class="mv-q-item" data-mvadd="${r.platform}|${esc(r.login)}">${avatar(r.platform, r.live.avatar || r.avatar, r.live.display)}<span>${esc(r.live.display)}</span></button>`).join("")}</div>` : ""}
  </div>`;
}

function mvTileEl(t) {
  t.el = el(`<div class="mv-tile" data-mvid="${t.id}">
      <video playsinline muted></video>
      <div class="mv-state"></div>
      <div class="mv-head" draggable="true">
        <span class="mv-who"></span><span class="grow"></span>
        <button class="mv-qbtn" data-mv="quality" title="Quality"></button>
        <button class="icon-btn" data-mv="sound"></button>
        <button class="icon-btn" data-mv="full" title="Fullscreen">${I.full}</button>
        <button class="icon-btn" data-mv="open" title="Open channel">${I.expand}</button>
        <button class="icon-btn" data-mv="close" title="Remove">${I.close}</button>
      </div>
      <div class="mv-sound">${I.vol}</div>
    </div>`);
  t.video = $("video", t.el);
  t.video.addEventListener("playing", () => mvState(t, "playing"));
  mvState(t, "loading");
}

function mvHead(t) {
  if (!t.el) return;
  const live = sidebarRows().find((r) => r.platform === t.platform && r.login === t.login)?.live;
  const viewers = live?.viewers ?? t.info?.viewers;
  const cat = live?.category || t.info?.category || "";
  $(".mv-who", t.el).innerHTML = `${avatar(t.platform, t.avatar || t.info?.avatar, t.display)}<span class="mv-name">${esc(t.display)}</span>${pbadge(t.platform, "inline")}
    ${viewers ? `<span class="mv-view"><i></i>${fmt(viewers)}</span>` : ""}${cat ? `<span class="mv-cat">${esc(cat)}</span>` : ""}`;
  const isF = t.id === MV.focus;
  const s = $('[data-mv="sound"]', t.el);
  s.innerHTML = isF ? I.vol : I.mute;
  s.title = isF ? "You're listening to this one" : "Listen to this one (sound + chat)";
  $('[data-mv="quality"]', t.el).textContent = t.qName ? `${t.q ? "" : "Auto · "}${t.qName.replace(/ ?\(source\)/i, "")}` : "";
}

function mvState(t, kind) {
  const p = t.el && $(".mv-state", t.el); if (!p) return;
  p.classList.toggle("hidden", kind === "playing");
  if (kind === "loading") p.innerHTML = '<div class="spinner"></div>';
  else if (kind === "reconnecting") p.innerHTML = `<div class="spinner"></div><b>${navigator.onLine ? "Reconnecting…" : "No internet connection"}</b>`;
  else if (kind === "waiting") p.innerHTML = `${avatar(t.platform, t.avatar || t.info?.avatar, t.display, "xl")}<b>${esc(t.display)} is offline</b><span>Joins automatically when they go live</span>`;
  else if (kind === "error") p.innerHTML = `<b>Couldn't load this stream</b>`;
}

// ------------------------------------------------------------------ playback
function mvVariants(t) { const v = t.info?.variants || []; return v.length > 1 ? v.slice(1) : v; } // [0] is "Auto" (master)
const mvHeight = (name) => +(/(\d{3,4})p/.exec(name || "")?.[1] || 0);
/** The smallest quality that still fills the tile at this screen's pixel density (or the pick from the menu). */
function mvPickVariant(t) {
  const list = mvVariants(t);
  if (t.q) { const m = list.find((x) => x.name === t.q); if (m) return m; }
  const need = (t.el?.clientHeight || 360) * (window.devicePixelRatio || 1);
  const sized = list.filter((x) => mvHeight(x.name)).sort((a, b) => mvHeight(a.name) - mvHeight(b.name));
  return sized.find((x) => mvHeight(x.name) >= need) || sized[sized.length - 1] || list[0];
}

function mvStopMedia(t) {
  if (t.hls) { t.hls.destroy(); t.hls = null; }
  if (t.video) { t.video.pause(); t.video.removeAttribute("src"); t.video.load(); }
}

async function mvStart(t, reuse = false) {
  if (!mvAlive(t)) return;
  mvStopMedia(t);
  mvState(t, t.rec ? (t.rec.waiting ? "waiting" : "reconnecting") : "loading");
  try {
    let url = reuse ? t.url : null;
    if (!url) {
      const info = await invoke("resolve", { platform: t.platform, login: t.login });
      if (!mvAlive(t)) return;
      t.info = info;
      t.display = info.display || t.display;
      t.avatar = info.avatar || t.avatar;
      mvHead(t);
      if (t.id === MV.focus) mvChat(t);
      if (!info.live || !info.variants.length) { mvWait(t); return; }
      const v = mvPickVariant(t);
      url = await invoke("play_url", { platform: t.platform, login: t.login, name: v.name, url: v.url, dvr: false }); // tiles don't rewind
      if (!mvAlive(t)) return;
      t.qName = v.name;
      t.url = url;
      mvHead(t);
    }
    // tiles stay near live: no rewind here, small buffers (several streams share the memory)
    const h = new Hls({ liveSyncDuration: 6, liveMaxLatencyDuration: 30, maxBufferLength: 10, backBufferLength: 10, enableWorker: true });
    t.hls = h;
    t.mediaFix = 0;
    h.on(Hls.Events.MANIFEST_PARSED, () => t.video.play().catch(() => {}));
    h.on(Hls.Events.FRAG_BUFFERED, () => {
      const r = t.rec; if (!r) return;
      t.rec = null;
      if (r.waiting) toast(`${t.display} is live. Joined multiview.`);
      else if (r.n > 0) toast(`${t.display} reconnected`);
    });
    h.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal || t.hls !== h) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && t.mediaFix < 2) { t.mediaFix++; h.recoverMediaError(); return; }
      mvRecover(t, d.details);
    });
    h.loadSource(url);
    h.attachMedia(t.video);
    mvAudio();
    try { localStorage.setItem("ds:lastWatch", JSON.stringify({ multi: true, at: Date.now() })); } catch {}
  } catch (e) {
    mvRecover(t, String(e));
  }
}

/** Same back-off as the main player: first retries reuse the stream, then it is looked up again. */
function mvRecover(t, why) {
  if (!mvAlive(t)) return;
  const r = t.rec || (t.rec = { n: 0, waiting: false, timer: null });
  if (r.timer) return;
  mvStopMedia(t);
  mvState(t, r.waiting ? "waiting" : "reconnecting");
  if (why) invoke("js_log", { msg: `multiview ${t.login}: ${why}` });
  r.timer = setTimeout(() => {
    r.timer = null;
    r.n++;
    const reuse = r.n <= 2 && !!t.url && !r.waiting;
    if (!reuse) t.url = null;
    mvStart(t, reuse);
  }, navigator.onLine ? (r.waiting ? 20000 : retryDelay(r.n)) : 30000);
}
function mvWait(t) {
  const r = t.rec || (t.rec = { n: 0, waiting: true, timer: null });
  r.waiting = true;
  t.url = null;
  mvRecover(t);
}
function mvOnline() {
  for (const t of MV.tiles) {
    const r = t.rec;
    if (r?.timer && !r.waiting) { clearTimeout(r.timer); r.timer = null; r.n++; t.url = null; mvStart(t); }
  }
}

/** Sound only from the focused tile, at that channel's remembered volume. */
function mvAudio() {
  for (const t of MV.tiles) {
    if (!t.video) continue;
    const on = t.id === MV.focus;
    t.video.muted = !on;
    if (on) t.video.volume = Math.min(1, (chPref(t).vol ?? 100) / 100);
  }
  const f = mvFocused(), vol = $("#mvVol");
  if (vol) vol.value = f ? (chPref(f).vol ?? 100) : 100;
}

/** Auto quality follows the tile size: re-pick after the layout settles. */
let mvReqTimer = null, mvRO = null;
function mvRequality() {
  clearTimeout(mvReqTimer);
  mvReqTimer = setTimeout(() => {
    for (const t of MV.tiles) {
      if (t.q || !t.hls || !t.info || t.rec) continue;
      const want = mvPickVariant(t);
      if (want && want.name !== t.qName) { t.url = null; mvStart(t); }
    }
  }, 1200);
}
function mvObserve() {
  mvRO?.disconnect();
  if (!window.ResizeObserver) return;
  let first = true;
  mvRO = new ResizeObserver(() => { mvLayout(); if (first) { first = false; return; } mvRequality(); });
  mvRO.observe($("#mvGrid"));
}

// ------------------------------------------------------------------ chat follows the focused tile
async function mvChat(t) {
  if (!t.info || S.popout || S.view !== "multi") return;
  if (S.ch?.multi && S.ch.platform === t.platform && S.ch.login === t.login) return;
  if (S.ch) leaveChannel();
  const info = t.info;
  S.ch = { platform: t.platform, login: t.login, info, multi: true, loading: false, error: null, sel: 0, paused: false, retries: 0, tab: "about", about: null, videos: null, clips: null, vod: null, emotes: null };
  const ch = S.ch;
  S.chatMsgs = []; S.chatRaw = []; S.replyTo = null; S.points = null; S.badges = {}; S.kickSubBadges = [];
  S.chatHistShown = false; S.chatLiveMarked = false;
  buildChat();
  $("#chat").classList.toggle("hidden", !S.st.show_chat || S.popped);
  mvSync();
  const gen = await invoke("chat_join", { platform: t.platform, login: t.login, display: info.display, kickChatroom: info.kick_chatroom ?? null, kickUserId: info.kick_user_id ?? null, kickChannelId: info.kick_channel_id ?? null, history: CE.cfg.general.history !== false });
  if (S.ch !== ch) return;
  S.chatGen = gen;
  if (t.platform === "Twitch") {
    invoke("twitch_badges", { login: t.login }).then((b) => { if (S.ch === ch) S.badges = b; }).catch(() => {});
    if (S.st.twitch) invoke("points_status", { login: t.login }).then((p) => { if (S.ch === ch) { S.points = p; renderPoints(); } }).catch(() => {});
    if (S.st.twitch) loadEmotes(ch);
  }
  Plugins.emit("channel:open", { platform: t.platform, login: t.login, userId: info.user_id || null, display: info.display, live: info.live, title: info.title, category: info.category });
}

/** Leaving the view (or hiding to the tray): stop every stream, keep the list for next time. */
function mvTeardown() {
  if (!MV.mounted) return;
  MV.mounted = false;
  clearTimeout(mvReqTimer);
  mvRO?.disconnect();
  for (const t of MV.tiles) {
    if (t.rec) clearTimeout(t.rec.timer);
    t.rec = null;
    mvStopMedia(t);
    t.el = null; t.video = null; t.url = null;
  }
  if (S.ch?.multi) leaveChannel();
  try { localStorage.removeItem("ds:lastWatch"); } catch {}
}

// Watchdog: a tile whose picture hasn't moved for 15 s gets reconnected.
setInterval(() => {
  if (!MV.mounted) return;
  for (const t of MV.tiles) {
    const v = t.video;
    if (!t.hls || !v || v.paused || t.rec) { t.stallAt = 0; continue; }
    if (v.currentTime !== t.stallT) { t.stallT = v.currentTime; t.stallAt = Date.now(); continue; }
    if (t.stallAt && Date.now() - t.stallAt > 15000) { t.stallAt = 0; mvRecover(t, "stalled"); }
  }
}, 3000);

// ------------------------------------------------------------------ add-stream picker
function mvPicker() {
  $("#mvPick")?.remove();
  const box = el(`<div class="mv-pick-wrap" id="mvPick"><div class="mv-pick">
      <div class="mv-pick-head"><b>Add a stream</b><span class="grow"></span><button class="icon-btn" data-mvpick-x>${I.close}</button></div>
      <div class="mv-pick-in">${I.search}<input id="mvPickInput" placeholder="Channel name on Twitch or Kick" spellcheck="false" autocomplete="off"></div>
      <div class="mv-pick-list" id="mvPickList"></div>
    </div></div>`);
  document.body.appendChild(box);
  const input = $("#mvPickInput");
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const have = new Set(MV.tiles.map((t) => akey(t.platform, t.login)));
    const live = sidebarRows().filter((r) => r.live && !have.has(akey(r.platform, r.login)) && (!q || r.login.includes(q) || (r.live.display || "").toLowerCase().includes(q)));
    $("#mvPickList").innerHTML =
      (q ? `<button class="mv-pick-row find" data-mvfind="${esc(q)}">${I.search}<span>Find <b>${esc(q)}</b> on Twitch and Kick</span></button>` : "") +
      (live.length ? `<div class="mv-pick-sec">Live now from your follows</div>` + live.slice(0, 30).map((r) => `<button class="mv-pick-row" data-mvadd="${r.platform}|${esc(r.login)}">
          ${avatar(r.platform, r.live.avatar || r.avatar, r.live.display)}<span class="mv-pick-name">${esc(r.live.display)}<small>${esc(r.live.category || "")}</small></span>
          ${pbadge(r.platform, "inline")}<span class="mv-view"><i></i>${fmt(r.live.viewers)}</span></button>`).join("")
        : q ? "" : '<p class="hint" style="padding:12px 16px">None of your follows are live. Type a channel name above.</p>');
  };
  input.addEventListener("input", draw);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") box.remove();
    if (e.key === "Enter") { const first = $(".mv-pick-row", box); first?.click(); }
  });
  box.addEventListener("click", async (e) => {
    if (e.target === box || e.target.closest("[data-mvpick-x]")) { box.remove(); return; }
    const add = e.target.closest("[data-mvadd]");
    if (add) { const [p, l] = add.dataset.mvadd.split("|"); box.remove(); mvAdd(p, l); return; }
    const find = e.target.closest("[data-mvfind]");
    if (find) {
      find.innerHTML = '<div class="spinner sm"></div><span>Looking it up…</span>';
      const name = find.dataset.mvfind;
      const p = await invoke("search", { name }).catch(() => null);
      if (!p) { find.innerHTML = `${I.close}<span>No channel called <b>${esc(name)}</b></span>`; return; }
      box.remove();
      mvAdd(p, name);
    }
  });
  draw();
  input.focus();
}

// ------------------------------------------------------------------ events
document.addEventListener("click", (e) => {
  const add = e.target.closest("#mv [data-mvadd]");
  if (add) { const [p, l] = add.dataset.mvadd.split("|"); mvAdd(p, l); return; }
  if (e.target.closest("#mvAddBtn, #mvAddBtn2, #mvSlot")) { mvPicker(); return; }
  const lay = e.target.closest("[data-mvlayout]");
  if (lay) { mvSetLayout(lay.dataset.mvlayout); return; }
  if (e.target.closest("#mvClear")) {
    for (const t of [...MV.tiles]) mvRemove(t.id);
    return;
  }
  if (e.target.closest("#mvChatBtn")) { S.st.show_chat = true; invoke("set_prefs", { showChat: true }); setChatOpen(true); mvSync(); return; }
  if (e.target.closest("#mvFull")) { if (document.fullscreenElement) document.exitFullscreen(); else $("#mv")?.requestFullscreen().catch(() => {}); return; }
  const tile = e.target.closest(".mv-tile"); if (!tile) return;
  const t = MV.tiles.find((x) => x.id === +tile.dataset.mvid); if (!t) return;
  const act = e.target.closest("[data-mv]")?.dataset.mv;
  if (act === "close") { mvRemove(t.id); return; }
  if (act === "open") { openChannel(t.platform, t.login); return; }
  if (act === "full") { if (document.fullscreenElement) document.exitFullscreen(); else t.el.requestFullscreen().catch(() => {}); return; }
  if (act === "quality") { mvQualityMenu(t, e.target.closest("[data-mv]")); return; }
  mvFocus(t.id); // a click anywhere else on the tile (incl. the speaker) = listen to this one
});
document.addEventListener("dblclick", (e) => {
  const tile = e.target.closest(".mv-tile"); if (!tile || e.target.closest("button")) return;
  if (document.fullscreenElement) document.exitFullscreen(); else tile.requestFullscreen().catch(() => {});
});
document.addEventListener("input", (e) => {
  if (e.target.id !== "mvVol") return;
  const f = mvFocused(); if (!f) return;
  setChPref(f, { vol: +e.target.value });
  if (f.video) { f.video.muted = false; f.video.volume = +e.target.value / 100; }
});

function mvQualityMenu(t, btn) {
  const r = btn.getBoundingClientRect();
  const list = mvVariants(t);
  openMenu(r.left, r.bottom + 4, [
    { label: `Auto (fits the tile)${t.q ? "" : " ✓"}`, run: () => { t.q = null; mvSave(); t.url = null; mvStart(t); } },
    "-",
    ...list.map((v) => ({ label: `${v.name}${t.q === v.name ? " ✓" : ""}`, run: () => { t.q = v.name; mvSave(); t.url = null; mvStart(t); } })),
  ]);
}

// drag a tile's header onto another tile to swap them
let mvDragId = null;
document.addEventListener("dragstart", (e) => {
  const h = e.target.closest?.(".mv-head"); if (!h) return;
  mvDragId = +h.closest(".mv-tile").dataset.mvid;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(mvDragId));
});
document.addEventListener("dragover", (e) => { if (mvDragId && e.target.closest?.(".mv-tile")) { e.preventDefault(); e.target.closest(".mv-tile").classList.add("drop"); } });
document.addEventListener("dragleave", (e) => e.target.closest?.(".mv-tile")?.classList.remove("drop"));
document.addEventListener("drop", (e) => {
  const tile = e.target.closest?.(".mv-tile");
  $$(".mv-tile.drop").forEach((x) => x.classList.remove("drop"));
  if (!tile || !mvDragId) return;
  e.preventDefault();
  const a = MV.tiles.findIndex((x) => x.id === mvDragId), b = MV.tiles.findIndex((x) => x.id === +tile.dataset.mvid);
  mvDragId = null;
  if (a < 0 || b < 0 || a === b) return;
  if (MV.layout === "focus" && MV.tiles[b].id === MV.focus) { mvFocus(MV.tiles[a].id); return; }
  [MV.tiles[a], MV.tiles[b]] = [MV.tiles[b], MV.tiles[a]];
  mvSave();
  mvSync();
});
document.addEventListener("dragend", () => { mvDragId = null; $$(".mv-tile.drop").forEach((x) => x.classList.remove("drop")); });

/** Keys while in multiview: 1-6 listen to tile n, M mute, F fullscreen the focused tile, G switch layout. */
function mvKey(e) {
  if (/^[1-6]$/.test(e.key)) { const t = MV.tiles[+e.key - 1]; if (t) mvFocus(t.id); return true; }
  const f = mvFocused();
  if (e.key === "m" && f?.video) { f.video.muted = !f.video.muted; return true; }
  if (e.key === "f" && f?.el) { if (document.fullscreenElement) document.exitFullscreen(); else f.el.requestFullscreen().catch(() => {}); return true; }
  if (e.key === "g") { mvSetLayout(MV.layout === "grid" ? "focus" : "grid"); return true; }
  return false;
}

mvNavCount();
