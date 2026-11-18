# Theme — duostream

## Part 1 — Token summary
Dark only (Kick "edge" design tokens).
- Backgrounds: --bg-lowest #090b0f (page), --bg-default #181b1f (bars, cards, menus), --bg-highest #23272b (inputs, chips), --bg-800 #2e3237 (hover), --bg-neutral #3a3d43 (secondary buttons)
- Text: --fg #ffffff, --fg-subtle #a9adb5, --fg-muted #757981; --line #ffffff1a (1px dividers)
- Brand: --brand #53fc18 (Kick volt green), --brand-hover #00e300, --brand-fg #090b0f (text on green)
- Live/critical: --live #e51147; Twitch: --twitch #9147ff
- Radius: --radius-sm 4px, --radius-md 6px, --radius-lg 8px, --radius-xl 12px; pills 999px
- Layout: --nav-h 60px, --side-w 256px, --side-w-collapsed 64px, --chat-w 340px
- Font: Inter (400/600/700, bundled TTF), base 14px/1.43; page title 28px/700; section title 20px/700; card title 14px/700
- Buttons: height 36 (sm 32, xs 26), radius 6, weight 600; icon buttons 36x36
- Grids: stream cards minmax(300px,1fr) gap 24/16; category cards minmax(150px,1fr) 3:4 art
- Shadows: menus 0 8px 24px #000c
- Platform marks: Twitch glitch on #9147ff, Kick K on #53fc18 (black glyph)

```css
:root {
  color-scheme: dark;
  --bg-lowest: #090b0f;      /* surface-bg-lowest  asphaltBlack-950 */
  --bg-default: #181b1f;     /* surface-bg-default asphaltBlack-900 */
  --bg-highest: #23272b;     /* surface-bg-highest asphaltBlack-850 */
  --bg-800: #2e3237;
  --bg-neutral: #3a3d43;     /* neutral-bg-default asphaltBlack-750 */
  --fg: #ffffff;             /* surface-fg-default */
  --fg-subtle: #a9adb5;      /* surface-fg-subtle asphaltBlack-300 */
  --fg-muted: #757981;
  --fg-nontext: #ffffff66;
  --line: #ffffff1a;
  --brand: #53fc18;          /* voltGreen-150 */
  --brand-hover: #00e300;
  --brand-fg: #090b0f;
  --live: #e51147;           /* critical-bg strawberry-500 */
  --twitch: #9147ff;
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 12px;
  --nav-h: 60px;
  --side-w: 256px;
  --side-w-collapsed: 64px;
  --chat-w: 340px;
}
```

## Part 2 — Full stylesheet (ui/app.css)

```css
/* Kick "edge" design tokens (dark theme), taken from kick.com's stylesheet.
   Additions for search suggestions, mini player, plugins and settings are at the end. */
@font-face { font-family: "Inter"; font-weight: 400; src: url("fonts/Inter-Regular.ttf") format("truetype"); }
@font-face { font-family: "Inter"; font-weight: 600; src: url("fonts/Inter-SemiBold.ttf") format("truetype"); }
@font-face { font-family: "Inter"; font-weight: 700; src: url("fonts/Inter-Bold.ttf") format("truetype"); }

:root {
  color-scheme: dark;
  --bg-lowest: #090b0f;      /* surface-bg-lowest  asphaltBlack-950 */
  --bg-default: #181b1f;     /* surface-bg-default asphaltBlack-900 */
  --bg-highest: #23272b;     /* surface-bg-highest asphaltBlack-850 */
  --bg-800: #2e3237;
  --bg-neutral: #3a3d43;     /* neutral-bg-default asphaltBlack-750 */
  --fg: #ffffff;             /* surface-fg-default */
  --fg-subtle: #a9adb5;      /* surface-fg-subtle asphaltBlack-300 */
  --fg-muted: #757981;
  --fg-nontext: #ffffff66;
  --line: #ffffff1a;
  --brand: #53fc18;          /* voltGreen-150 */
  --brand-hover: #00e300;
  --brand-fg: #090b0f;
  --live: #e51147;           /* critical-bg strawberry-500 */
  --twitch: #9147ff;
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 12px;
  --nav-h: 60px;
  --side-w: 256px;
  --side-w-collapsed: 64px;
  --chat-w: 340px;
}

* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg-lowest); color: var(--fg); font: 400 14px/1.43 "Inter", system-ui, sans-serif; overflow: hidden; -webkit-font-smoothing: antialiased; user-select: none; }
button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; padding: 0; }
input { font: inherit; color: inherit; }
a { color: inherit; text-decoration: none; }
img { display: block; }
.hidden { display: none !important; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: #ffffff26; border-radius: 99px; }
::-webkit-scrollbar-thumb:hover { background: #ffffff40; }
::-webkit-scrollbar-track { background: transparent; }

/* ---------------------------------------------------------------- buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 16px; border-radius: var(--radius-md); font-weight: 600; font-size: 14px; white-space: nowrap; transition: background .12s; }
.btn.sm { height: 32px; padding: 0 12px; }
.btn.primary { background: var(--brand); color: var(--brand-fg); }
.btn.primary:hover { background: var(--brand-hover); }
.btn.secondary { background: var(--bg-neutral); color: var(--fg); }
.btn.secondary:hover { background: #454950; }
.btn.ghost:hover { background: var(--bg-highest); }
.btn.twitch { background: var(--twitch); color: #fff; }
.btn.twitch:hover { background: #772ce8; }
.btn svg { width: 18px; height: 18px; }
.icon-btn { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-md); color: var(--fg); }
.icon-btn:hover { background: var(--bg-highest); }
.icon-btn svg { width: 20px; height: 20px; }

/* ---------------------------------------------------------------- navbar */
.navbar { position: fixed; inset: 0 0 auto 0; height: var(--nav-h); z-index: 30; display: flex; align-items: center; gap: 8px; padding: 0 16px 0 12px; background: var(--bg-default); }
.navbar .left { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; }
.logo { display: flex; align-items: center; gap: 9px; margin: 0 14px 0 6px; font-weight: 600; font-size: 19px; letter-spacing: -.6px; color: var(--brand); text-decoration: none; }
.logo .mark { height: .95em; width: auto; flex: none; }
.logo .word { color: #fff; }
.navlink { height: 36px; padding: 0 12px; display: inline-flex; align-items: center; border-radius: var(--radius-md); font-weight: 600; font-size: 15px; color: var(--fg); }
.navlink:hover { background: var(--bg-highest); }
.navlink.active { color: var(--brand); }
.search { flex: 0 1 480px; display: flex; align-items: center; height: 40px; background: var(--bg-lowest); border: 1px solid var(--bg-neutral); border-radius: var(--radius-lg); padding: 0 6px 0 14px; transition: border-color .12s; }
.search:focus-within { border-color: var(--brand); }
.search input { flex: 1; min-width: 0; height: 100%; background: transparent; border: 0; outline: 0; font-size: 14px; }
.search input::placeholder { color: var(--fg-subtle); }
.search .icon-btn { width: 30px; height: 30px; color: var(--fg-subtle); }
.navbar .right { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex: 1; }
.shield { color: var(--fg-muted); }
.shield.on { color: var(--brand); }
.nav-avatar { position: relative; width: 36px; height: 36px; border-radius: 50%; }
.nav-avatar img, .nav-avatar .ph { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; }

/* ---------------------------------------------------------------- layout */
.layout { position: fixed; inset: var(--nav-h) 0 0 0; display: flex; }
.sidebar { width: var(--side-w); flex: none; background: var(--bg-lowest); overflow-y: auto; overflow-x: hidden; padding: 10px 8px 20px; border-right: 1px solid var(--line); }
.sidebar.collapsed { width: var(--side-w-collapsed); padding: 10px 8px; }
.side-head { display: flex; align-items: center; justify-content: space-between; height: 36px; padding: 0 8px; font-weight: 700; font-size: 14px; color: var(--fg); }
.side-head .toggle { width: 28px; height: 28px; color: var(--fg-subtle); }
.collapsed .side-head span, .collapsed .side-row .sinfo, .collapsed .side-row .count, .collapsed .side-more, .collapsed .side-empty { display: none; }
.collapsed .side-head { justify-content: center; padding: 0; }
.side-section + .side-section { margin-top: 18px; }
.side-row { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 8px; border-radius: var(--radius-md); cursor: pointer; }
.side-row:hover { background: var(--bg-default); }
.collapsed .side-row { padding: 0 6px; }
.side-row .sinfo { flex: 1; min-width: 0; }
.side-row .name { font-weight: 700; font-size: 14px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.side-row .cat { font-size: 12px; line-height: 16px; color: var(--fg-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.side-row .count { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
.side-row .count .live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--live); }
.side-row.offline .name { color: var(--fg-subtle); }
.side-row.offline .avatar img { filter: grayscale(1) brightness(.7); }
.side-row.offline .count { color: var(--fg-muted); font-weight: 400; font-size: 12px; }
.side-more { display: block; width: 100%; text-align: left; padding: 6px 8px; font-weight: 600; font-size: 13px; color: var(--brand); }
.side-more:hover { text-decoration: underline; }
.side-empty { padding: 4px 8px; color: var(--fg-subtle); font-size: 13px; }

.main { flex: 1; min-width: 0; overflow-y: auto; overflow-x: hidden; }
.page { padding: 24px 32px 48px; max-width: 2200px; }
.page-title { font-size: 28px; font-weight: 700; line-height: 36px; margin: 0 0 16px; letter-spacing: -.3px; }
.section-title { display: flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 700; margin: 8px 0 16px; }
.section-title .sub { font-size: 14px; font-weight: 400; color: var(--fg-subtle); }
.section-title .spacer { flex: 1; }
.pills { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
.pill { height: 32px; padding: 0 14px; border-radius: 999px; background: var(--bg-highest); font-weight: 600; font-size: 14px; color: var(--fg); display: inline-flex; align-items: center; }
.pill:hover { background: var(--bg-800); }
.pill.active { background: var(--fg); color: var(--bg-lowest); }
.filter { display: flex; align-items: center; height: 36px; width: 280px; background: var(--bg-highest); border-radius: var(--radius-md); padding: 0 12px; border: 1px solid transparent; }
.filter:focus-within { border-color: var(--brand); }
.filter input { flex: 1; background: transparent; border: 0; outline: 0; }
.filter input::placeholder { color: var(--fg-subtle); }

/* ---------------------------------------------------------------- avatar + platform badge */
.avatar { position: relative; flex: none; width: 32px; height: 32px; }
.avatar img, .avatar .ph { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; background: var(--bg-highest); }
.avatar .ph { display: flex; align-items: center; justify-content: center; font-weight: 700; color: var(--fg-subtle); }
.avatar.live-ring img, .avatar.live-ring .ph { box-shadow: 0 0 0 2px var(--bg-lowest), 0 0 0 4px var(--brand); }
.badge { position: absolute; right: -3px; bottom: -3px; width: 14px; height: 14px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font: 700 10px/1 "Inter"; box-shadow: 0 0 0 2px var(--bg-lowest); }
.badge.t { background: var(--twitch); color: #fff; }
.badge.k { background: var(--brand); color: var(--brand-fg); }
.avatar.lg { width: 40px; height: 40px; }
.avatar.xl { width: 64px; height: 64px; }
.avatar.xl .badge { width: 20px; height: 20px; font-size: 13px; right: -2px; bottom: -2px; border-radius: 6px; }

/* ---------------------------------------------------------------- cards */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 24px 16px; }
.card { min-width: 0; cursor: pointer; }
.thumb { position: relative; aspect-ratio: 16 / 9; border-radius: var(--radius-lg); overflow: hidden; background: var(--bg-default); }
.thumb img { width: 100%; height: 100%; object-fit: cover; transition: transform .2s ease; }
.card:hover .thumb img { transform: scale(1.04); }
.thumb .live-tag { position: absolute; top: 8px; left: 8px; padding: 1px 6px; border-radius: var(--radius-sm); background: var(--live); color: #fff; font-weight: 700; font-size: 12px; line-height: 18px; text-transform: uppercase; }
.thumb .viewers { position: absolute; bottom: 8px; left: 8px; padding: 1px 6px; border-radius: var(--radius-sm); background: #000000b3; font-weight: 600; font-size: 12px; line-height: 18px; }
.thumb .uptime { position: absolute; bottom: 8px; right: 8px; padding: 1px 6px; border-radius: var(--radius-sm); background: #000000b3; font-size: 12px; line-height: 18px; color: var(--fg-subtle); }
.meta { display: flex; gap: 10px; margin-top: 10px; }
.meta .text { min-width: 0; flex: 1; }
.meta .title { font-weight: 700; font-size: 14px; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card:hover .meta .title { color: var(--brand); }
.meta .chan { font-size: 14px; line-height: 20px; color: var(--fg-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta .cat { font-size: 14px; line-height: 20px; color: var(--fg-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta .cat:hover { color: var(--brand); }
.skeleton .thumb { animation: pulse 1.4s ease-in-out infinite; }
.skeleton .bar { height: 12px; border-radius: 4px; background: var(--bg-default); margin-top: 6px; animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .55; } }
.empty { padding: 80px 20px; text-align: center; }
.empty h2 { font-size: 20px; margin: 12px 0 6px; }
.empty p { color: var(--fg-subtle); margin: 0 0 20px; }
.error-box { padding: 10px 14px; border-radius: var(--radius-md); background: #e5114726; color: #ff959a; margin-bottom: 16px; }

/* ---------------------------------------------------------------- channel page */
.channel { display: flex; flex-direction: column; min-height: 100%; }
.player { position: relative; width: 100%; background: #000; aspect-ratio: 16 / 9; max-height: calc(100vh - var(--nav-h) - 120px); overflow: hidden; }
.theater .player { max-height: calc(100vh - var(--nav-h)); height: calc(100vh - var(--nav-h)); aspect-ratio: auto; }
.player video { width: 100%; height: 100%; object-fit: contain; background: #000; display: block; }
.player .state { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; padding: 20px; }
.player .state h3 { margin: 0; font-size: 20px; }
.player .state p { margin: 0; color: var(--fg-subtle); max-width: 520px; }
.spinner { width: 40px; height: 40px; border-radius: 50%; border: 3px solid #ffffff26; border-top-color: var(--brand); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.controls { position: absolute; inset: auto 0 0 0; height: 64px; padding: 20px 12px 6px; display: flex; align-items: center; gap: 4px; background: linear-gradient(transparent, #000000cc); opacity: 0; transition: opacity .2s; }
.player:hover .controls, .player.paused .controls, .player.menu-open .controls { opacity: 1; }
.player.idle .controls { opacity: 0; }
.player.idle { cursor: none; }
.controls .icon-btn { color: #fff; }
.controls .icon-btn:hover { background: #ffffff1a; }
.vol { display: flex; align-items: center; }
.vol input { width: 0; opacity: 0; transition: width .15s, opacity .15s; accent-color: var(--brand); }
.vol:hover input, .vol input:focus { width: 90px; opacity: 1; margin: 0 8px 0 2px; }
.live-ind { display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; font-weight: 700; font-size: 13px; text-transform: uppercase; }
.live-ind .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--live); }
.adtag { margin-left: 10px; padding: 2px 8px; border-radius: var(--radius-sm); background: #53fc1826; color: var(--brand); font-weight: 600; font-size: 12px; }
.controls .grow { flex: 1; }
.qmenu { position: absolute; right: 12px; bottom: 64px; min-width: 180px; background: var(--bg-default); border-radius: var(--radius-lg); padding: 6px; box-shadow: 0 8px 24px #000a; z-index: 5; }
.qmenu .head { padding: 6px 10px; font-weight: 700; color: var(--fg-subtle); font-size: 12px; text-transform: uppercase; }
.qmenu button { display: flex; width: 100%; align-items: center; justify-content: space-between; padding: 8px 10px; border-radius: var(--radius-md); font-size: 14px; }
.qmenu button:hover { background: var(--bg-highest); }
.qmenu button.sel { color: var(--brand); font-weight: 600; }
.qmenu .row { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; font-size: 14px; }
.switch { width: 36px; height: 20px; border-radius: 99px; background: var(--bg-neutral); position: relative; transition: background .15s; }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s; }
.switch.on { background: var(--brand); }
.switch.on::after { transform: translateX(16px); }

.info { display: flex; gap: 16px; padding: 16px 24px; }
.info .who { flex: 1; min-width: 0; }
.info .uname { display: flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 700; line-height: 28px; }
.info .stitle { font-weight: 600; font-size: 14px; line-height: 20px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.info .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; align-items: center; }
.tag { height: 24px; padding: 0 10px; border-radius: 999px; background: var(--bg-highest); font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; color: var(--fg); }
.tag.cat { color: var(--brand); background: #53fc181a; }
.info .actions { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.info .actions .row { display: flex; gap: 8px; }
.info .stats { display: flex; align-items: center; gap: 14px; font-size: 14px; color: var(--fg-subtle); font-variant-numeric: tabular-nums; }
.info .stats .v { display: inline-flex; align-items: center; gap: 6px; color: var(--fg); font-weight: 700; }
.info .stats .v svg { width: 16px; height: 16px; color: var(--brand); }
.offline-tag { padding: 2px 8px; border-radius: var(--radius-sm); background: var(--bg-highest); color: var(--fg-subtle); font-weight: 700; font-size: 12px; }
.live-pill { padding: 1px 6px; border-radius: var(--radius-sm); background: var(--live); color: #fff; font-weight: 700; font-size: 12px; }

/* ---------------------------------------------------------------- chat */
.chat { width: var(--chat-w); flex: none; display: flex; flex-direction: column; background: var(--bg-lowest); border-left: 1px solid var(--line); }
.chat-head { height: 52px; flex: none; display: flex; align-items: center; justify-content: space-between; padding: 0 8px 0 16px; border-bottom: 1px solid var(--line); font-weight: 700; font-size: 16px; }
.chat-log { flex: 1; overflow-y: auto; padding: 8px 10px 8px 14px; font-size: 14px; line-height: 22px; user-select: text; }
.msg { padding: 3px 6px; border-radius: var(--radius-sm); overflow-wrap: anywhere; }
.msg:hover { background: var(--bg-default); }
.msg .u { font-weight: 700; cursor: pointer; }
.msg .t { color: #ffffffe6; }
.msg img.em { display: inline-block; height: 28px; max-width: 112px; vertical-align: middle; margin: -4px 1px; }
.msg.sys { color: var(--fg-subtle); font-size: 13px; }
.chat-paused { position: absolute; left: 50%; transform: translateX(-50%); bottom: 132px; padding: 6px 12px; border-radius: 999px; background: var(--bg-highest); font-weight: 600; font-size: 13px; box-shadow: 0 4px 12px #0008; }
.chat-foot { flex: none; padding: 10px 12px 12px; }
.chat-input { display: flex; align-items: center; min-height: 44px; background: var(--bg-highest); border: 1px solid transparent; border-radius: var(--radius-lg); padding: 0 6px 0 12px; }
.chat-input:focus-within { border-color: var(--brand); }
.chat-input input { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; height: 42px; }
.chat-input input::placeholder { color: var(--fg-subtle); }
.chat-foot .row { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; color: var(--fg-subtle); font-size: 12px; }
.chat-signin { text-align: center; padding: 8px 0 4px; color: var(--fg-subtle); }
.chat-signin .btn { margin-top: 8px; width: 100%; }

/* ---------------------------------------------------------------- sign-in */
.gate { position: fixed; inset: 0; z-index: 50; background: var(--bg-lowest); display: flex; align-items: center; justify-content: center; overflow: auto; }
.gate .box { width: 440px; max-width: calc(100% - 32px); background: var(--bg-default); border-radius: var(--radius-xl); padding: 32px; }
.gate .logo { margin: 0 0 18px; justify-content: center; font-size: 28px; }
.gate h1 { font-size: 24px; margin: 0 0 6px; text-align: center; }
.gate .lead { text-align: center; color: var(--fg-subtle); margin: 0 0 24px; }
.provider { border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 16px; }
.provider + .provider { margin-top: 12px; }
.provider .phead { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 16px; }
.provider .phead .grow { flex: 1; }
.provider .btn { width: 100%; margin-top: 12px; height: 40px; }
.provider .note { color: var(--fg-subtle); font-size: 13px; margin-top: 10px; }
.provider .code { font: 700 32px/1.2 "Inter"; letter-spacing: 4px; text-align: center; color: var(--twitch); margin: 12px 0 4px; user-select: text; }
.provider .field { display: block; width: 100%; height: 40px; margin-top: 8px; padding: 0 12px; background: var(--bg-lowest); border: 1px solid var(--bg-neutral); border-radius: var(--radius-md); outline: 0; }
.provider .field:focus { border-color: var(--brand); }
.provider .mono { font-family: Consolas, monospace; color: var(--brand); user-select: text; }
.signed { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.signed .grow { flex: 1; font-weight: 600; }
.provider .signed .btn { width: auto; margin-top: 0; height: 30px; padding: 0 12px; font-size: 13px; flex: none; }
.ok-pill { padding: 2px 8px; border-radius: 999px; background: #53fc1826; color: var(--brand); font-size: 12px; font-weight: 700; }
.gate .continue { width: 100%; margin-top: 20px; height: 40px; }

.toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 60; padding: 10px 16px; border-radius: var(--radius-lg); background: var(--bg-highest); box-shadow: 0 8px 24px #000a; font-weight: 600; max-width: 560px; }

.menu { position: fixed; z-index: 70; min-width: 200px; background: var(--bg-default); border-radius: var(--radius-lg); padding: 6px; box-shadow: 0 8px 24px #000c; }
.menu button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border-radius: var(--radius-md); text-align: left; }
.menu button:hover { background: var(--bg-highest); }
.menu button svg { width: 18px; height: 18px; flex: none; }
.menu .sep { height: 1px; background: var(--line); margin: 6px 0; }
.menu .who { padding: 8px 10px; display: flex; gap: 10px; align-items: center; font-weight: 700; }

/* ---------------------------------------------------------------- search suggestions */
.search { position: relative; }
.suggest { position: absolute; top: 46px; left: 0; right: 0; z-index: 40; background: var(--bg-default); border-radius: var(--radius-lg); padding: 6px; box-shadow: 0 12px 32px #000c; max-height: 420px; overflow-y: auto; }
.sg-row { display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 10px; border-radius: var(--radius-md); cursor: pointer; }
.sg-row:hover, .sg-row.sel { background: var(--bg-highest); }
.sg-row .sinfo { flex: 1; min-width: 0; }
.sg-row .name { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sg-row .cat { font-size: 12px; color: var(--fg-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sg-row .count { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
.sg-row .live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--live); }
.sg-row .off { font-size: 12px; color: var(--fg-muted); }
.sg-loading { padding: 12px; color: var(--fg-subtle); font-size: 13px; }

/* ---------------------------------------------------------------- mini player */
.mini { position: fixed; right: 20px; bottom: 20px; width: 400px; z-index: 45; border-radius: var(--radius-lg); overflow: hidden; background: #000; box-shadow: 0 16px 40px #000d; border: 1px solid var(--line); }
.mini .player { aspect-ratio: 16 / 9; max-height: none; height: auto; }
.mini .controls { height: 48px; padding: 12px 6px 2px; }
.mini #cTheater, .mini #cGear, .mini #cChat, .mini #cFull, .mini .live-ind, .mini #pButtons { display: none; }
.mini-bar { display: flex; align-items: center; gap: 10px; padding: 8px 6px 8px 12px; background: var(--bg-default); }
.mini-bar .sinfo { flex: 1; min-width: 0; }
.mini-bar .name { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mini-bar .cat { font-size: 12px; color: var(--fg-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ---------------------------------------------------------------- plugins + settings */
.plugin-btn.on { color: var(--brand); }
.icon-btn.on { color: var(--brand); }
.plugin-list { display: flex; flex-direction: column; gap: 10px; }
.plugin-card { display: flex; align-items: center; gap: 14px; padding: 14px 16px; background: var(--bg-default); border-radius: var(--radius-lg); }
.pc-icon { width: 40px; height: 40px; flex: none; border-radius: var(--radius-md); background: #53fc181a; color: var(--brand); display: flex; align-items: center; justify-content: center; }
.pc-icon svg { width: 22px; height: 22px; }
.pc-body { flex: 1; min-width: 0; }
.pc-name { font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 6px; }
.pc-ver { font-weight: 400; font-size: 12px; color: var(--fg-muted); }
.pc-desc { color: var(--fg-subtle); font-size: 13px; margin-top: 2px; }
.pc-author { color: var(--fg-muted); font-size: 12px; margin-top: 4px; }
.pc-actions { display: flex; align-items: center; gap: 10px; flex: none; }
.pc-src { font-size: 11px; color: var(--fg-muted); }
.row-actions { display: flex; gap: 8px; margin-top: 10px; }
.row-actions .btn svg { width: 16px; height: 16px; }
.hint { color: var(--fg-subtle); font-size: 13px; margin: 0 0 10px; }
.hint code, .docs code { background: var(--bg-highest); padding: 1px 5px; border-radius: 4px; font-size: 12px; user-select: text; }
.source-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; background: var(--bg-default); border-radius: var(--radius-md); margin-bottom: 6px; font-size: 13px; word-break: break-all; }
.source-add { display: flex; gap: 8px; margin-top: 8px; }
.source-add input { flex: 1; height: 32px; padding: 0 10px; background: var(--bg-lowest); border: 1px solid var(--bg-neutral); border-radius: var(--radius-md); outline: 0; }
.source-add input:focus { border-color: var(--brand); }
.docs { background: var(--bg-default); border-radius: var(--radius-lg); padding: 18px 20px; line-height: 1.6; user-select: text; }
.docs pre { background: var(--bg-lowest); border-radius: var(--radius-md); padding: 12px 14px; overflow-x: auto; margin: 8px 0 14px; }
.docs pre code { background: none; padding: 0; font-size: 12.5px; }
.setting { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; background: var(--bg-default); border-radius: var(--radius-lg); margin-bottom: 10px; }
.setting p { margin: 2px 0 0; color: var(--fg-subtle); font-size: 13px; }
.setting .switch { flex: none; }
.msg.hl { background: #53fc1814; box-shadow: inset 3px 0 0 var(--brand); }
.msg .pre { color: var(--fg-muted); font-size: 12px; margin-right: 6px; font-variant-numeric: tabular-nums; }

/* ---------------------------------------------------------------- v0.4: platform marks */
.badge svg { width: 72%; height: 72%; display: block; }
.badge.big { position: static; width: 24px; height: 24px; border-radius: 6px; box-shadow: none; flex: none; }
.badge.inline { position: static; display: inline-flex; width: 18px; height: 18px; border-radius: 5px; box-shadow: none; vertical-align: -3px; margin-right: 4px; }
.section-title .badge.big { width: 26px; height: 26px; }
.ptag { gap: 5px; padding: 0 9px 0 7px; }
.ptag svg { width: 12px; height: 12px; }
.ptag.t svg { color: var(--twitch); }
.ptag.k svg { color: var(--brand); }
.btn.xs { height: 26px; padding: 0 10px; font-size: 12px; border-radius: var(--radius-sm); }
.btn.xs svg { width: 14px; height: 14px; }
.hint { color: var(--fg-subtle); font-size: 13px; line-height: 1.5; }
.grow { flex: 1; min-width: 0; }
.muted { color: var(--fg-muted); }

/* channel tabs */
.ch-tabs { padding: 0 24px 40px; }
.tabbar { display: flex; gap: 24px; border-bottom: 1px solid var(--line); margin-bottom: 20px; }
.tabbar button { height: 44px; font-weight: 600; font-size: 15px; color: var(--fg-subtle); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tabbar button:hover { color: var(--fg); }
.tabbar button.active { color: var(--fg); border-bottom-color: var(--brand); }
.tab-loading { display: flex; justify-content: center; padding: 32px; }
.about { display: flex; flex-direction: column; gap: 24px; }
.about-main { background: var(--bg-default); border-radius: var(--radius-xl); padding: 20px 24px; max-width: 900px; }
.about-main h3 { margin: 0 0 4px; font-size: 18px; }
.about .followers { color: var(--fg-subtle); margin-bottom: 12px; }
.about .followers b { color: var(--fg); }
.about .bio { margin: 0; white-space: pre-wrap; line-height: 1.6; user-select: text; max-width: 75ch; }
.socials { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.social { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 999px; background: var(--bg-highest); font-weight: 600; font-size: 13px; }
.social:hover { background: var(--bg-800); color: var(--brand); }
.social svg { width: 14px; height: 14px; }
.panels { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 320px)); gap: 16px; }
.panel h4 { margin: 0 0 8px; font-size: 15px; }
.panel img { width: 100%; border-radius: var(--radius-md); }
.panel img.clickable { cursor: pointer; }
.panel .ptext { margin-top: 8px; color: var(--fg-subtle); font-size: 13px; white-space: pre-wrap; user-select: text; overflow-wrap: anywhere; }
.vgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px 16px; }
.vcard { cursor: pointer; min-width: 0; }
.vcard .thumb .dur { position: absolute; bottom: 8px; right: 8px; padding: 1px 6px; border-radius: var(--radius-sm); background: #000000c0; font-weight: 600; font-size: 12px; }
.vcard .thumb .now { position: absolute; top: 8px; left: 8px; padding: 1px 6px; border-radius: var(--radius-sm); background: var(--brand); color: var(--brand-fg); font-weight: 700; font-size: 12px; }
.vcard:hover .thumb img { transform: scale(1.04); }
.vcard.playing .thumb { box-shadow: 0 0 0 2px var(--brand); }
.vtitle { margin-top: 8px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vcard:hover .vtitle { color: var(--brand); }
.vmeta { color: var(--fg-subtle); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* VOD controls */
.controls .seek { position: absolute; left: 12px; right: 12px; top: 2px; width: auto; accent-color: var(--brand); height: 14px; cursor: pointer; }
.vtime { margin-left: 10px; font-size: 13px; font-variant-numeric: tabular-nums; color: #fff; }
#cBackLive { margin-left: 10px; }
.vod-title { position: absolute; top: 0; left: 0; right: 0; padding: 12px 16px 24px; background: linear-gradient(#000000b0, transparent); font-weight: 600; opacity: 0; transition: opacity .2s; pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.player:hover .vod-title, .player.paused .vod-title { opacity: 1; }

/* categories */
.cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 20px 14px; }
.cat-card { cursor: pointer; min-width: 0; }
.cat-card .art { aspect-ratio: 3 / 4; border-radius: var(--radius-lg); overflow: hidden; background: var(--bg-default); }
.cat-card .art img { width: 100%; height: 100%; object-fit: cover; transition: transform .2s; }
.cat-card:hover .art img { transform: scale(1.04); }
.cat-card.skeleton .art { animation: pulse 1.4s ease-in-out infinite; }
.cname { margin-top: 8px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cat-card:hover .cname { color: var(--brand); }
.cmeta { display: flex; align-items: center; gap: 6px; color: var(--fg-subtle); font-size: 13px; }
.cmeta .plats { display: inline-flex; gap: 4px; margin-left: auto; }
.cmeta .plats svg { width: 13px; height: 13px; }
.cmeta .plats svg:first-child { color: var(--twitch); }
.cmeta .plats svg:last-child { color: var(--brand); }
.cat-head { display: flex; gap: 20px; align-items: flex-end; }
.cat-head img { width: 110px; aspect-ratio: 3 / 4; object-fit: cover; border-radius: var(--radius-lg); }
.cat-head .sub { color: var(--fg-subtle); }
.cat-head .tags { display: flex; gap: 6px; }

/* drops */
.drop-camp { background: var(--bg-default); border-radius: var(--radius-xl); padding: 16px; margin-bottom: 14px; }
.dc-head { display: flex; align-items: center; gap: 14px; }
.dc-head img { width: 48px; height: 64px; object-fit: cover; border-radius: var(--radius-md); flex: none; }
.dc-name { font-weight: 700; font-size: 15px; }
.dc-sub { color: var(--fg-subtle); font-size: 13px; }
.dc-sub .warn { color: #ffb800; }
.dc-items { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-top: 14px; }
.drop-item { background: var(--bg-highest); border-radius: var(--radius-lg); padding: 10px; min-width: 0; }
.di-img { height: 64px; display: flex; align-items: center; justify-content: center; color: var(--fg-subtle); }
.di-img img { max-height: 64px; max-width: 100%; object-fit: contain; }
.di-img svg { width: 32px; height: 32px; }
.di-name { margin-top: 8px; font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pbar { height: 6px; border-radius: 99px; background: var(--bg-neutral); margin: 8px 0 6px; overflow: hidden; }
.pbar i { display: block; height: 100%; background: var(--brand); border-radius: 99px; }
.di-meta { font-size: 12px; color: var(--fg-subtle); min-height: 26px; display: flex; align-items: center; }

/* chat extras */
.chat-head .grow { flex: 1; }
.chat-head > span:first-child { display: inline-flex; align-items: center; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.msg { position: relative; }
.msg .bdg { display: inline-block; width: 18px; height: 18px; vertical-align: -4px; margin-right: 3px; border-radius: 3px; }
.msg .bdg.kb, .ucard .bdg.kb { display: inline-flex; align-items: center; justify-content: center; }
.bdg.kb svg { width: 14px; height: 14px; }
.ucard .bdg { display: inline-block; width: 20px; height: 20px; margin-right: 4px; border-radius: 3px; }
.msg .rline { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--fg-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.msg .rline svg { width: 12px; height: 12px; flex: none; }
.msg .rline span { overflow: hidden; text-overflow: ellipsis; }
.msg .mact { position: absolute; right: 4px; top: 2px; width: 26px; height: 26px; border-radius: var(--radius-sm); background: var(--bg-highest); display: none; align-items: center; justify-content: center; }
.msg .mact svg { width: 15px; height: 15px; }
.msg:hover .mact { display: inline-flex; }
.msg .mact:hover { color: var(--brand); }
.clink { color: var(--brand); cursor: pointer; text-decoration: underline; }
.chat-foot { position: relative; }
.chat-foot .row .as { margin-right: 8px; }
.chat-pop { position: absolute; left: 12px; right: 12px; bottom: calc(100% - 4px); max-height: 360px; overflow: auto; background: var(--bg-default); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: 0 -8px 24px #0009; z-index: 6; padding: 6px; }
.ac-row { display: block; width: 100%; text-align: left; padding: 6px 10px; border-radius: var(--radius-md); font-weight: 600; }
.ac-row.sel, .ac-row:hover { background: var(--bg-highest); color: var(--brand); }
.reply-bar { display: flex; align-items: center; gap: 8px; padding: 6px 4px 8px 8px; color: var(--fg-subtle); font-size: 13px; }
.reply-bar > svg { width: 16px; height: 16px; flex: none; }
.reply-bar b { color: var(--fg); }
.reply-bar small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.reply-bar .icon-btn { width: 28px; height: 28px; }
.chat-input .em-btn { width: 32px; height: 32px; color: var(--fg-subtle); }
.chat-input .em-btn:hover { color: var(--brand); }
.em-picker input { width: 100%; height: 34px; padding: 0 10px; border-radius: var(--radius-md); background: var(--bg-highest); border: 1px solid transparent; outline: 0; margin-bottom: 6px; }
.em-picker input:focus { border-color: var(--brand); }
.em-group { font-size: 12px; font-weight: 700; color: var(--fg-subtle); text-transform: uppercase; padding: 8px 4px 4px; }
.em-row { display: flex; flex-wrap: wrap; gap: 2px; }
.em-cell { width: 40px; height: 40px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; }
.em-cell:hover { background: var(--bg-highest); }
.em-cell img { max-width: 32px; max-height: 32px; }
.em-cell.locked { opacity: .35; filter: grayscale(1); }
.pts-btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px; border-radius: var(--radius-md); font-weight: 700; color: var(--fg); }
.pts-btn:hover { background: var(--bg-highest); }
.pts-btn img, .pts-btn svg { width: 18px; height: 18px; color: var(--brand); }
.pts-claim { padding: 1px 6px; border-radius: var(--radius-sm); background: var(--brand); color: var(--brand-fg); font-size: 11px; }
.pts-menu { padding: 6px; }
.pts-head { display: flex; align-items: center; gap: 8px; font-size: 15px; }
.pts-head img, .pts-head svg { width: 22px; height: 22px; color: var(--brand); }
.pts-head span { color: var(--fg-subtle); font-size: 13px; }
.pts-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.reward { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 6px; border-radius: var(--radius-lg); background: var(--bg-highest); text-align: center; }
.reward:hover { box-shadow: inset 0 0 0 1px var(--rc); }
.reward.dim { opacity: .5; }
.reward .ri { width: 40px; height: 40px; border-radius: var(--radius-md); background: var(--rc); display: flex; align-items: center; justify-content: center; }
.reward .ri img { width: 28px; height: 28px; }
.reward .ri svg { width: 22px; height: 22px; color: #000; }
.reward .rt { font-size: 12px; font-weight: 600; line-height: 1.3; }
.reward .rc { font-size: 12px; color: var(--fg-subtle); }
.pts-menu .field { width: 100%; margin: 8px 0; }
.row-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }

/* user card */
.ucard { position: fixed; z-index: 60; width: 320px; max-height: 70vh; overflow: auto; background: var(--bg-default); border: 1px solid var(--line); border-radius: var(--radius-xl); box-shadow: 0 12px 32px #000c; padding: 14px; }
.uc-head { display: flex; gap: 12px; align-items: flex-start; }
.uc-name { font-weight: 700; font-size: 16px; }
.uc-sub { color: var(--fg-subtle); font-size: 12px; }
.uc-badges { margin-top: 4px; }
.uc-bio { margin-top: 10px; font-size: 13px; color: var(--fg-subtle); white-space: pre-wrap; user-select: text; }
.uc-recent { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; }
.uc-label { font-size: 12px; font-weight: 700; color: var(--fg-subtle); text-transform: uppercase; margin-bottom: 6px; }
.uc-msg { font-size: 13px; padding: 3px 0; overflow-wrap: anywhere; user-select: text; }
.uc-msg img.em { display: inline-block; height: 22px; vertical-align: middle; }
.uc-actions { display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end; }

/* pop-out chat window */
/* ---------------------------------------------------------------- v0.5: search + browse */
.sg-head { padding: 8px 12px 4px; font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: var(--fg-muted); }
.sg-art { width: 32px; height: 42px; flex: none; border-radius: 4px; overflow: hidden; background: var(--bg-highest); }
.sg-art img { width: 100%; height: 100%; object-fit: cover; }
.sg-row .plats { display: inline-flex; gap: 4px; margin-left: auto; }
.sg-row .plats svg { width: 13px; height: 13px; }
.sg-row .plats svg:first-child { color: var(--twitch); }
.sg-row .plats svg:last-child { color: var(--brand); }
.sg-row.recent > svg, .sg-row.all > svg { width: 18px; height: 18px; color: var(--fg-subtle); flex: none; margin: 0 7px; }
.sg-row.all { border-top: 1px solid var(--line); }
.sg-row.all .name { color: var(--brand); }
.sg-x { width: 26px; height: 26px; margin-left: auto; color: var(--fg-muted); }
.sg-x svg { width: 14px; height: 14px; }
.pill .pc { margin-left: 6px; font-size: 12px; opacity: .65; }
.chan-list { display: flex; flex-direction: column; gap: 6px; max-width: 900px; }
.chan-row { display: flex; align-items: center; gap: 16px; padding: 12px 14px; border-radius: var(--radius-lg); cursor: pointer; }
.chan-row:hover { background: var(--bg-default); }
.cr-name { font-weight: 700; font-size: 16px; }
.cr-sub { color: var(--fg-subtle); display: flex; align-items: center; gap: 6px; }
.filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 18px; }
.filters .spacer { flex: 1; }
.fsel { height: 34px; padding: 0 30px 0 12px; border-radius: 999px; background: var(--bg-highest); border: 1px solid transparent; color: var(--fg); font-weight: 600; font-size: 13px; outline: 0; cursor: pointer;
  appearance: none; background-image: linear-gradient(45deg, transparent 50%, var(--fg-subtle) 50%), linear-gradient(135deg, var(--fg-subtle) 50%, transparent 50%);
  background-position: calc(100% - 15px) 15px, calc(100% - 10px) 15px; background-size: 5px 5px; background-repeat: no-repeat; }
.fsel:hover { background-color: var(--bg-800); }
.fsel:focus { border-color: var(--brand); }
.fsel option { background: var(--bg-default); }
.fchip { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: 999px; background: var(--bg-highest); font-weight: 600; font-size: 13px; }
.fchip svg { width: 15px; height: 15px; }
.fchip:hover { background: var(--bg-800); }
.fchip.on { background: #53fc1826; color: var(--brand); }
.load-more { display: flex; justify-content: center; padding: 28px 0 8px; min-height: 60px; }
.ctags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.ctag { height: 20px; padding: 0 8px; border-radius: 999px; background: var(--bg-highest); font-size: 11px; font-weight: 600; color: var(--fg-subtle); }
.ctag:hover { background: var(--bg-800); color: var(--fg); }
.thumb video.pv { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #000; opacity: 0; transition: opacity .25s; }
.thumb video.pv.on { opacity: 1; }
.thumb > span { z-index: 1; }
.fy { margin-bottom: 28px; }
.live-ind.behind .dot { background: var(--fg-muted); }
.live-ind.behind { color: var(--fg-subtle); }
#cTime { margin-left: 10px; }

.update-bar { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 80; display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 16px; border-radius: var(--radius-xl); background: var(--bg-default); border: 1px solid var(--line); box-shadow: 0 10px 30px #000c; }
.update-bar > svg { width: 18px; height: 18px; color: var(--brand); }
.update-bar b { color: var(--brand); }

body.popout > #chat { position: fixed; inset: 0; width: auto; border-left: 0; display: flex; }
.chat-log { min-height: 0; }
body.popout .empty svg { width: 40px; height: 40px; color: var(--fg-muted); }
```
