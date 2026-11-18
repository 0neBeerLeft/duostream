# Pages — dependency trees

All pages share: `ui/index.html` (shell), `ui/app.css` (all styles), `ui/app.js` (everything below lives in this one file).

## channel (watch page)
Entry: openChannel → buildChannelDOM (ui/app.js)
Dependencies:
- createPlayer, renderPlayerExtras, toggleQualityMenu, setPlayerState (player + overlay controls)
- renderChannelInfo (avatar xl + name + LIVE pill + title + tags + Follow + viewers/uptime)
- renderChannelTab (About / Videos / Clips tabs)
- buildChat → msgHTML, badgeHTML, renderPoints, toggleEmotePicker, openUserCard
- avatar, pbadge, ptag

## browse
Entry: renderMain (browse) → renderForYou / cardHTML
Dependencies:
- cardHTML → avatar → pbadge
- sortCards, LANGS (filters)
- renderSidebar

## following
Entry: renderMain (following)
Dependencies:
- sidebarRows, cardHTML, catCardHTML, skeletons

## categories / category
Entry: renderMain (categories / category)
Dependencies:
- catCardHTML, cardHTML, ptag, isFollowedCategory

## search
Entry: renderSearchPage
Dependencies:
- avatar, ptag, cardHTML, catCardHTML, fmtDur, ago

## drops
Entry: renderDropsPage
Dependencies:
- pbadge, I.gift

## plugins
Entry: renderPluginsPage

## accounts (settings)
Entry: renderMain (accounts) → providersHTML

## sign-in gate
Entry: renderGate → providersHTML

## Channel page code
- File: `ui/app.js`
- Watch page

```js
function buildChannelDOM(existingPlayer) {
  $("#main").innerHTML = `<div class="channel"><div id="playerSlot"></div><div class="info" id="chInfo"></div><div class="ch-tabs" id="chTabs"></div></div>`;
  S.playerEl = existingPlayer || createPlayer();
  $("#playerSlot").replaceWith(S.playerEl);
  syncVolUI();
  syncPlayUI();
  renderPlayerExtras();
  renderChannelInfo();
  renderChannelTab();
}

function createPlayer() {
  const p = el(`<div class="player paused" id="player">
      <video id="video" playsinline></video>
      <div class="state" id="pstate"><div class="spinner"></div></div>
      <div class="vod-title hidden" id="vodTitle"></div>
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
  v.addEventListener("timeupdate", () => {
    const r = range();
    const live = !S.ch?.vod;
    seek.classList.toggle("hidden", !r);
    if (!r) { $("#cTime", p).classList.add("hidden"); return; }
    if (!seeking) seek.value = Math.round(((v.currentTime - r[0]) / (r[1] - r[0])) * 1000);
    const behind = live ? Math.max(0, (hls?.liveSyncPosition ?? r[1]) - v.currentTime) : 0;
    $("#cTime", p).classList.toggle("hidden", live && behind < 8);
    $("#cTime", p).textContent = live ? `-${fmtDur(behind)}` : `${fmtDur(v.currentTime)} / ${fmtDur(v.duration)}`;
    $("#cLive", p).classList.toggle("behind", live && behind >= 8);
  });
  seek.addEventListener("input", () => { seeking = true; });
  seek.addEventListener("change", () => { seeking = false; const r = range(); if (r) v.currentTime = r[0] + (seek.value / 1000) * (r[1] - r[0]); });
  $("#cClip", p).onclick = (e) => { e.stopPropagation(); saveClip(); };
  $("#cPip", p).onclick = async (e) => {
    e.stopPropagation();
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch (err) { toast(`Picture-in-picture isn't available: ${err.message || err}`); }
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
    $("#chat").classList.toggle("hidden", !S.st.show_chat);
  };
  $("#cGear", p).onclick = (e) => { e.stopPropagation(); toggleQualityMenu(); };
  return p;
}

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
        <button class="btn ${followed ? "secondary" : "primary"}" id="followBtn">${followed ? I.heartFill : I.heart}<span>${followed ? "Following" : "Follow"}</span></button>
      </div>
      ${info.live ? `<div class="stats"><span class="v">${I.user}${(info.viewers || 0).toLocaleString()}</span><span id="uptime">${upClock(info.started)}</span></div>` : ""}
    </div>`;
  $("#followBtn").onclick = () => toggleFollow(platform, login);
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
```

## Browse + For you code
- File: `ui/app.js`
- Browse home

```js
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
```

## Search page code
- File: `ui/app.js`
- Search results

```js
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
```

## Drops page code
- File: `ui/app.js`
- Drops

```js
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
```

