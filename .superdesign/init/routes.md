# Routes — duostream

No URL router. Single-page app with a view state `S.view` switched by `setView(v)` in `ui/app.js`; channel pages are opened with `openChannel(platform, login)`.

| View (S.view) | Render function | Summary |
|---|---|---|
| following | renderMain (following branch) | Following page: pills Live / Categories; grid of live followed streams or followed category cards |
| browse | renderMain (browse branch) + renderForYou | Browse: pills For you / Livestreams / Categories; For-you sections; filter bar (platform, sort, language, drops, tag) + infinite grid |
| categories | renderMain (categories branch) | Top categories grid (Twitch+Kick merged) |
| category | renderMain (category branch) | Category header (box art, viewers, platform tags, Follow/Hide) + stream grid |
| search | renderSearchPage | "Results for …" with pills Channels / Live / Categories / Videos |
| channel | buildChannelDOM + renderChannelInfo + renderChannelTab | Player (16:9, overlay controls) + channel info row + tabs About / Videos / Clips; chat column on the right |
| drops | renderDropsPage | Twitch + Kick drop campaigns with reward progress cards |
| plugins | renderPluginsPage | Plugins: Installed / Shop / Make your own |
| accounts | renderMain (accounts branch) | Settings: accounts, app switches, hidden list |
| (gate) | renderGate | Sign-in screen |
| (#popout window) | applyPopoutContext + buildChat | Pop-out chat window |

## View switch
- File: `ui/app.js`
- Router equivalent

```js
function setView(v) {
  if (S.view === "channel" && v !== "channel") minimizeOrLeave();
  S.view = v;
  $("#main").scrollTop = 0;
  if (v === "browse" && Date.now() - S.browse.at > 120000) loadBrowse();
  if (v === "categories" && Date.now() - S.cats.at > 120000) loadCategories();
  if (v === "drops") loadDrops();
  if (v === "plugins") loadShop();
  renderMain();
  renderSidebar();
  Plugins.emit("view", { view: v });
}
```

