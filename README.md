# duostream

Twitch and Kick in one fast desktop app for Windows. It's built with Rust and Tauri, not Electron.

**[Download the latest version](https://github.com/0neBeerLeft/duostream/releases/latest)**: get `duostream_x.y.z_x64-setup.exe` and run it. The app updates itself after that.

## What it does

**Watching**
- Twitch and Kick streams in one app, with follows from both accounts in a single sidebar.
- Ad block for Twitch. It's a plugin you can turn off.
- Rewind live streams up to 30 minutes, and save a clip of what you're watching.
- Multiview: up to 6 streams from both platforms at once.
- Audio only (press A): video off, far less data, and it keeps playing in the tray.
- Sleep timer: stop after 15 minutes to 2 hours, or when the stream ends.
- Follow raids: when the streamer raids someone, duostream can take you along.
- Picture-in-picture, a mini player while you browse, and media keys.
- Past broadcasts and clips, plus each channel's About page: bio, socials and panels.

**Chat**
- Badges, emotes and an emote picker, plus 7TV, BTTV and FFZ emotes (plugins, on by default).
- Recent messages when you join a channel. On Twitch these come from recent-messages.robotty.de (the service Chatterino uses), which sees the channel name. Turn it off in Settings → Chat.
- Deleted messages, timeouts and bans show up, along with slow mode and the other chat modes.
- Click a name for their user card. Replies and @mentions with autocomplete.
- Chat Enhancer: filters, highlights, favorite and ignored users, private notes and appearance settings.
- Pop chat out into its own window.

**Rewards**
- Channel points: see your balance, auto-claim bonus chests and redeem rewards.
- Twitch and Kick drops, with progress tracking and automatic claiming.

**Finding streams**
- Search across both platforms: channels, live streams by title, categories and videos. Paste a stream, video or clip link to open it.
- Browse with filters (platform, language, sort, drops), tags and infinite scroll.
- A "For you" page, and categories you can follow or hide.

**App**
- Go-live notifications you can click to open the stream, with a bell to mute single channels.
- Starts with Windows if you like, quietly in the tray.
- Sign-ins are stored encrypted for your Windows account.
- Plugins and a plugin shop. Plugins run in a sandbox.

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
