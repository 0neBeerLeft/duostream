# duostream — design system

## Product
duostream is a native Windows desktop app (Tauri, 1500×920 default window, min 960×600) for watching **Twitch and Kick in one place**. Viewers follow channels on both platforms, watch live streams and VODs, chat, earn channel points and drops. Audience: gamers and stream viewers who keep the app open for hours, often next to a game. It must feel fast, dense-but-calm, and premium — closer to a native media app than a website.

### Key pages
- **Channel / watch page (primary)**: video player (16:9) with overlay controls; channel info row (avatar, name, LIVE pill, title, category + platform tags, Follow, viewers, uptime); tabs About / Videos / Clips below; chat column on the right.
- Browse (For you sections, filter bar, stream-card grid), Following, Categories, Search results, Drops, Plugins, Settings, sign-in gate.

### Shell
Top navbar 60px (hamburger, logo mark + "duostream" wordmark, links Following / Browse / Drops, centered search, right: plugin icon buttons + account avatars) · left sidebar 256px (Following list: avatar with platform badge, name, category, red live dot + viewer count; offline rows greyed; Recommended section) · main area · right chat column 340px on channel pages.

### Channel page content & features (must all stay present)
- Player controls: play/pause, volume (slider on hover), LIVE indicator (grey when rewound) / time, DVR seek bar for live rewind and VODs, "Back to live", plugin badges ("Ad blocked"), clip button (scissors, save last 60s), picture-in-picture, chat toggle, quality/settings menu (Auto, 1080p60 … + Low latency switch), theater, fullscreen.
- Info row: avatar 64px with live ring + platform badge, display name, LIVE pill / OFFLINE tag, stream title, category tag (accent), platform tag (Twitch purple / Kick green mark), Follow / Following button, viewer count, uptime clock.
- Tabs: About (bio, followers, social links, Twitch panels grid), Videos and Clips (16:9 thumbnails with duration, title, views · date).
- Chat: header (title, pop-out, collapse), message list (badges, colored usernames, emotes 28px, reply-context line, hover reply button, mention highlight), reply bar, input with emote-picker button, row with channel points balance (icon + number, "Claim!"), "Chatting as <name>", Chat send button.

## Identity (keep)
- Logo: two offset rounded parallelograms (volt green mark) + lowercase wordmark "duostream". Use the supplied logo asset; never replace it.
- Platform marks: Twitch glitch on #9147ff, Kick "K" on #53fc18 with black glyph. These platform colors are semantic and must stay.
- Live color: red #e51147 (LIVE pill, live dots).
- Dark UI only.

## Current tokens (baseline)
- Backgrounds: #090b0f page · #181b1f bars/cards · #23272b inputs/chips · #2e3237 hover · #3a3d43 secondary buttons
- Text: #ffffff · subtle #a9adb5 · muted #757981 · lines #ffffff1a
- Brand accent: #53fc18 (hover #00e300), text on accent #090b0f
- Radius 4 / 6 / 8 / 12, pills 999 · Font Inter 400/600/700, base 14px · page titles 28/700 · section 20/700
- Buttons 36px (sm 32, xs 26), weight 600 · icon buttons 36×36 · stroke icons 24 grid, 2px

## Redesign direction (user request)
The user wants a **new visual style** for the app, explored first on the channel page. Directions may change the accent usage, surfaces, typography scale/pairing, spacing, radii, elevation and layout — but must:
- stay dark and comfortable for long sessions;
- keep the logo, Twitch purple / Kick green platform marks and live red semantics;
- keep every feature listed above;
- stay a desktop app layout at ~1500×920 (no marketing-site patterns, no hero sections);
- use one sans-serif UI family (may differ from Inter) plus an optional tabular/mono for numbers; no decorative/serif display fonts.

## Motion
Subtle: 120–200ms ease for hovers and controls fade; player controls auto-hide after 2.5s idle; skeleton pulse for loading.
