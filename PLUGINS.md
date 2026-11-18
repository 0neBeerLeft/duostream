# duostream plugins

A plugin is a folder with two files, placed in `%APPDATA%\duostream\plugins\`:

```
%APPDATA%\duostream\plugins\my-plugin\
  manifest.json
  plugin.js
```

Open the folder from **Plugins → Installed → Open plugins folder**, drop your plugin in, then press **Reload plugins**.

## manifest.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "you",
  "description": "What it does in one sentence."
}
```

- `id`: lowercase letters, digits, `-` or `_`. Must match the folder name.
- `version`: the shop compares this to offer updates.

## plugin.js

The file runs once when the plugin is enabled, with one variable in scope: `api`.

### Events

```js
api.on("channel:open", (ch) => {});   // { platform, login, display, live, title, category }
api.on("channel:leave", () => {});
api.on("view", ({ view }) => {});      // "following" | "browse" | "channel" | "plugins" | "accounts"
api.on("player:playing", () => {});
api.on("chat:message", (m) => m);      // see below
```

`chat:message` handlers receive each message **after** DuoStream's built-in Chat Enhancer has
processed it (pipeline: normalize → user filters → users → highlights → **plugins** → render).
So plugins never see messages the user filtered out or ignored, and private user notes are
never attached to messages.

```js
// m = { id, login, name, color, system, badges: ["moderator/1", …], reply: { name, text } | null,
//       spans: [{ t: "text", v: "hi " }, { t: "emote", v: "https://…" }],
//       platform: "Twitch" | "Kick", uid: "t:login" | "k:slug", text: "plain text",
//       roles: { broadcaster, mod, vip, sub, bot }, hasLink,
//       ce: { hl: { color, bg, sound, emph, why } | null, fav, color } }   // Chat Enhancer decisions (read-only)
api.on("chat:message", (m) => {
  if (m.name === "Nightbot") return false;   // hide the message
  return { ...m, highlight: true, prefix: "12:01" };   // or change it
});
```

Supported extra fields: `highlight` (green bar), `prefix` (small grey text before the name).

### UI

```js
const btn = api.addNavButton({ icon: api.icons.bell, title: "Tooltip", active: false, onClick: () => {} });
btn.update({ active: true, title: "New tooltip" });
btn.remove();

const pbtn = api.addPlayerButton({ icon: api.icons.gear, title: "Tooltip", onClick: () => {} });

const badge = api.addPlayerBadge("Ad blocked");   // small green tag next to LIVE
badge.show(true); badge.setText("Something"); badge.remove();

api.addStyle(".msg .u { text-decoration: underline; }");   // removed automatically on unload
api.toast("Hello");
```

`api.icons` has the app's SVG icons (`shield`, `bell`, `heart`, `gear`, `chat`, `puzzle`, `play`, …). Any SVG string works as an icon.

### App

```js
api.channel();                        // current channel or null
api.view();                           // current page
api.me();                             // { twitch: "name" | null, kick: "name" | null }
api.openChannel("Twitch", "xqc");
api.reloadPlayer();
await api.adStatus();                 // { ad_break, ads_blocked }
api.storage.get("key", defaultValue); // per-plugin storage
api.storage.set("key", value);
api.appVersion;
```

### Cleanup

Everything a plugin adds through `api` is removed when it is disabled or uninstalled. For anything
else (timers, your own DOM changes) register a cleanup:

```js
const t = setInterval(tick, 1000);
api.onUnload(() => clearInterval(t));
```

## Publishing to the shop

Host a `registry.json` anywhere over HTTPS (a GitHub repo with raw links works):

```json
{
  "name": "My plugins",
  "plugins": [
    {
      "id": "my-plugin",
      "name": "My Plugin",
      "version": "1.0.0",
      "author": "you",
      "description": "What it does.",
      "manifest": "my-plugin/manifest.json",
      "code": "my-plugin/plugin.js"
    }
  ]
}
```

`manifest` and `code` are relative to the registry URL. Users add your registry under
**Plugins → Shop → Plugin sources**.

## Security

Plugins run inside the app with the same access as the app itself, like browser extensions.
Only install plugins from people you trust.
