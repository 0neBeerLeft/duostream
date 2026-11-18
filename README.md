# duostream

Twitch and Kick in one fast desktop app for Windows. It's built with Rust and Tauri, not Electron.

**[Download the latest version](https://github.com/0neBeerLeft/duostream/releases/latest)**: get `duostream_x.y.z_x64-setup.exe` and run it. The app updates itself after that.

## What it does

**Watching**
- Twitch and Kick streams in one app, with follows from both accounts in a single sidebar.
- Ad block for Twitch. It's a plugin you can turn off.
- Rewind live streams, save the last 60 seconds as a clip, and float the player over other windows (picture-in-picture).
- Past broadcasts and clips, plus each channel's About page: bio, socials and panels.
- A mini player that keeps playing while you browse.

**Chat**
- Badges, emotes and an emote picker.
- Click a name for their user card.
- Replies and @mentions with autocomplete.
- Pop chat out into its own window.

**Rewards**
- Channel points: see your balance, auto-claim bonus chests and redeem rewards.
- Twitch and Kick drops, with progress tracking and automatic claiming.

**Finding streams**
- Search across both platforms: channels, live streams by title, categories and videos.
- Browse with filters (platform, language, sort, drops), tags and infinite scroll.
- A "For you" page, and categories you can follow or hide.

**App**
- Go-live notifications and a tray icon.
- Plugins and a plugin shop.

## Plugins

Plugins are plain JavaScript files.

- The in-app shop reads [`plugins/registry.json`](plugins/registry.json) from this repo.
- To add a plugin, add a folder under `plugins/`, list it in `registry.json`, and open a pull request.
- The full API is in [PLUGINS.md](PLUGINS.md).

## Building it yourself

You need Rust, plus the Tauri CLI (`cargo install tauri-cli --version "^2"`).

```
cargo tauri build
```

The installer is written to `target/release/bundle/nsis/`.

To publish a release, run `publish.ps1`. It builds a signed installer, uploads the source, and creates the GitHub release with the update file.
