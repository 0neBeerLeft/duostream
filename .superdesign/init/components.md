# Components — duostream (vanilla JS, no framework)

Framework: none. Tauri 2 desktop app (Rust backend) with a plain HTML/CSS/JS front end in `ui/`.
UI is built with template-literal functions in `ui/app.js` that return HTML strings; styles in `ui/app.css`.
Component library: custom. CSS approach: vanilla CSS with design tokens as CSS variables (Kick "edge" dark theme).
Icons: inline stroke SVGs (24x24, stroke-width 2) via `svg()` + `I` map; platform marks via `PICON`.

## Icons + platform marks
- File: `ui/app.js`
- Inline SVG icon helper and the Twitch/Kick platform marks used on avatars and tags

```js
const svg = (d, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

const PICON = {
  Twitch: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>',
  Kick: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z"/></svg>',
};

const pbadge = (p, cls = "") => `<span class="badge ${p === "Twitch" ? "t" : "k"} ${cls}" title="${p}">${PICON[p]}</span>`;

const ptag = (p) => `<span class="tag ptag ${p === "Twitch" ? "t" : "k"}">${PICON[p]}${p}</span>`;
```

## Avatar
- File: `ui/app.js`
- Round avatar with platform badge (bottom-right) and optional green live ring; sizes: default 32, .lg 40, .xl 64

```js
function avatar(platform, url, name, cls = "", ring = false) {
  const letter = esc((name || "?").slice(0, 1).toUpperCase());
  const img = url
    ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;ph&quot;>${letter}</div>'">`
    : `<div class="ph">${letter}</div>`;
  return `<div class="avatar ${cls} ${ring ? "live-ring" : ""}">${img}${pbadge(platform)}</div>`;
}
```

## StreamCard
- File: `ui/app.js`
- Live stream card: 16:9 thumbnail with LIVE tag, viewer count, uptime; avatar + title/channel/category + tag chips

```js
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
```

## CategoryCard
- File: `ui/app.js`
- Box-art category card (3:4) with name, viewers and platform icons

```js
const catCardHTML = (x, i, attr = "cat") => `<div class="cat-card" data-${attr}="${i}">
  <div class="art">${x.art ? `<img src="${esc(x.art)}" alt="" loading="lazy">` : ""}</div>
  <div class="cname" title="${esc(x.name)}">${esc(x.name)}</div>
  <div class="cmeta">${fmt(x.viewers || 0)} viewers <span class="plats">${x.twitch ? PICON.Twitch : ""}${x.kick ? PICON.Kick : ""}</span></div></div>`;
```

## Toast
- File: `ui/app.js`
- Bottom toast notification

```js
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 4500);
}
```

## ContextMenu
- File: `ui/app.js`
- Floating menu (right-click / account menu)

```js
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
```

## ChatMessage
- File: `ui/app.js`
- Chat line: badges, colored username, emotes, reply line, hover reply button

```js
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

function msgHTML(m) {
  if (m.system) return `<div class="msg sys">${esc(m.spans.map((s) => s.v).join(""))}</div>`;
  const spans = [...m.spans];
  // Twitch replies repeat "@parent " at the start of the text; the reply line already shows it.
  if (m.reply && spans[0]?.t === "text") spans[0] = { ...spans[0], v: spans[0].v.replace(/^@\S+\s/, "") };
  const body = spans.map((s) => (s.t === "emote" ? `<img class="em" src="${esc(s.v)}" alt="" loading="lazy">` : linkify(s.v))).join("");
  const me = myName(S.ch?.platform).toLowerCase();
  const mention = me && m.login !== me && new RegExp(`(^|\\W)@?${me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`, "i").test(spans.filter((s) => s.t === "text").map((s) => s.v).join(" "));
  const badges = (m.badges || []).map((b) => badgeHTML(S.ch?.platform, b)).join("");
  return `<div class="msg ${m.highlight || mention ? "hl" : ""}" data-seq="${m.seq}">
    ${m.reply ? `<div class="rline">${I.reply}<span>Replying to <b>@${esc(m.reply.name)}</b>: ${esc(m.reply.text)}</span></div>` : ""}
    ${m.prefix ? `<span class="pre">${esc(m.prefix)}</span>` : ""}${badges}<span class="u" style="color:${esc(m.color)}" data-user="${m.seq}">${esc(m.name)}</span><span class="t">: ${body}</span>
    ${m.id && S.ch && (S.ch.platform === "Twitch" ? S.st.twitch : S.st.kick) ? `<button class="mact" data-reply="${m.seq}" title="Reply">${I.reply}</button>` : ""}
  </div>`;
}
```

## Buttons, switches, pills, tags (CSS-only primitives)
- File: `ui/app.css`
- Classes: `.btn` (+ `.primary` green, `.secondary` grey, `.twitch` purple, `.sm`, `.xs`), `.icon-btn`, `.switch(.on)`, `.pill(.active)`, `.tag(.cat)`, `.fchip(.on)`, `.fsel` (select), `.field` (input)

```html
<button class="btn primary">Follow</button>
<button class="btn secondary sm">Sign out</button>
<button class="icon-btn" title="Refresh"><svg …/></button>
<button class="switch on"></button>
<div class="pills"><button class="pill active">Live</button><button class="pill">Categories</button></div>
<span class="tag cat">Just Chatting</span>
```
