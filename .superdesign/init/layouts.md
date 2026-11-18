# Layouts — duostream

## App shell
- File: `ui/index.html`
- Fixed top navbar (60px), left sidebar (256px, collapsible to 64px), main scroll area, right chat column (340px) on channel pages. A sign-in gate overlays everything when signed out.

```html
﻿<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>duostream</title>
  <link rel="stylesheet" href="app.css">
</head>
<body>
  <!-- sign-in gate -->
  <div id="gate" class="gate hidden"></div>

  <!-- app shell -->
  <div id="shell" class="hidden">
    <header class="navbar">
      <div class="left">
        <button class="icon-btn" id="sideToggle" title="Toggle sidebar"></button>
        <a class="logo" href="#" id="logoLink"><svg class="mark" viewBox="0 0 314 215" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-width="20" stroke-linejoin="round"><polygon points="131.14,10 227.86,10 120.86,117 24.14,117"/><polygon points="193.14,98 289.86,98 182.86,205 86.14,205"/></g></svg><span class="word">duostream</span></a>
        <a class="navlink" href="#" data-view="following">Following</a>
        <a class="navlink" href="#" data-view="browse">Browse</a>
        <a class="navlink" href="#" data-view="drops">Drops</a>
      </div>
      <form class="search" id="searchForm" autocomplete="off">
        <input id="searchInput" placeholder="Search" spellcheck="false">
        <button class="icon-btn" type="submit" id="searchBtn" title="Search"></button>
        <div class="suggest hidden" id="suggest"></div>
      </form>
      <div class="right" id="navRight"></div>
    </header>

    <div class="layout">
      <aside class="sidebar" id="sidebar"></aside>
      <main class="main" id="main"></main>
      <aside class="chat hidden" id="chat"></aside>
    </div>
  </div>

  <div id="toast" class="toast hidden"></div>

  <script src="hls.min.js"></script>
  <script src="app.js"></script>
</body>
</html>

```

## Navbar (right side + active state)
- File: `ui/app.js`
- Top bar: hamburger, green logo mark + 'duostream', nav links (Following / Browse / Drops), centered search with suggestion dropdown, right side plugin buttons + account avatars

```js
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
```

## Sidebar
- File: `ui/app.js`
- Left sidebar: Following list (live first, avatar + name + category + red dot viewers, offline greyed), Recommended section; collapses to avatars only

```js
function sidebarRows() {
  const rows = S.follows.rows
    ? S.follows.rows.map((r) => ({ ...r, avatar: r.avatar || S.st.avatars[akey(r.platform, r.login)] }))
    : S.st.follows.map((f) => ({ platform: f.platform, login: f.login, avatar: S.st.avatars[akey(f.platform, f.login)], live: null }));
  rows.sort((a, b) => (b.live ? b.live.viewers + 1 : 0) - (a.live ? a.live.viewers + 1 : 0) || a.login.localeCompare(b.login));
  return rows;
}

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
    <div class="side-row ${lv ? "" : "offline"}" data-open="${p}|${esc(login)}" title="${esc(lv ? `${name} · ${lv.category}\n${lv.title}` : name)}">
      ${avatar(p, av, name)}
      <div class="sinfo"><div class="name">${esc(name)}</div>${lv ? `<div class="cat">${esc(lv.category || "Live")}</div>` : ""}</div>
      <div class="count">${lv ? `<span class="live-dot"></span>${fmt(lv.viewers)}` : "Offline"}</div>
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
      <div class="side-head"><span>Recommended</span></div>
      ${rec.map((c) => row(c.platform, c.login, c.display, c.avatar, c)).join("")}
    </div>` : ""}`;
}
```

## Search suggestions dropdown
- File: `ui/app.js`
- Dropdown under search: section heads (Channels / Categories / Recent searches), rows with avatar or box art, 'See all results' row

```js
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
```

## Sign-in gate
- File: `ui/app.js`
- Centered 440px card: logo, 'Log in', one bordered card per platform (Twitch device code / Kick one-click)

```js
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
  $("#gate").innerHTML = `<div class="box">
      <div class="logo"><svg class="mark" viewBox="0 0 314 215" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-width="20" stroke-linejoin="round"><polygon points="131.14,10 227.86,10 120.86,117 24.14,117"/><polygon points="193.14,98 289.86,98 182.86,205 86.14,205"/></g></svg><span class="word">duostream</span></div>
      <h1>Log in</h1>
      <p class="lead">Sign in to Twitch, Kick, or both to start watching.</p>
      ${providersHTML()}
      ${signedIn() ? '<button class="btn primary continue" data-act="enter">Continue</button>' : ""}
    </div>`;
}
```

## Chat column
- File: `ui/app.js`
- Right chat panel: header with pop-out + hide, scrolling log, reply bar, input with emote button, points + 'Chatting as' row

```js
function buildChat() {
  const c = $("#chat");
  c.classList.toggle("hidden", S.popout ? false : !S.st.show_chat || S.popped);
  const p = S.ch.platform;
  const me = p === "Twitch" ? S.st.twitch : S.st.kick;
  c.innerHTML = `
    <div class="chat-head"><span>${S.popout ? `${pbadge(p, "inline")} ${esc(S.ch.info.display)}` : "Chat"}</span><span class="grow"></span>
      ${S.popout ? "" : `<button class="icon-btn" id="chatPop" title="Pop out chat">${I.popout}</button><button class="icon-btn" id="chatHide" title="Hide chat">${I.arrowCollapse}</button>`}</div>
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
  log.addEventListener("scroll", () => { if (atBottom(log)) $("#chatPaused").classList.add("hidden"); });
  $("#chatPaused").onclick = () => { log.scrollTop = log.scrollHeight; };
  if ($("#chatHide")) $("#chatHide").onclick = () => { S.st.show_chat = false; invoke("set_prefs", { showChat: false }); c.classList.add("hidden"); };
  if ($("#chatPop")) $("#chatPop").onclick = () => { invoke("popout_chat").then(() => { S.popped = true; c.classList.add("hidden"); }).catch((e) => toast(String(e))); };
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
      try { await invoke("chat_send", { platform: p, text, replyTo: reply?.id || null }); }
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
```

