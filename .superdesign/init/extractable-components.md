# Extractable components

#### Layout Components
## NavBar
- Source: `ui/index.html` + `renderNav` in `ui/app.js`
- Category: layout
- Description: Top bar with green logo, Following/Browse/Drops links, centered search, right-side icons and account avatars
- Extractable props: activeItem (string: "following" | "browse" | "drops", default "following")
- Hardcoded: logo SVG mark, link labels, search placeholder, icons

## Sidebar
- Source: `renderSidebar` in `ui/app.js`
- Category: layout
- Description: Following list with live-first rows and Recommended section
- Extractable props: collapsed (boolean, default false)
- Hardcoded: section titles, row styling

## ChatPanel
- Source: `buildChat` in `ui/app.js`
- Category: layout
- Description: Right chat column with log, input, emote button, points and send button
- Extractable props: none
- Hardcoded: header, placeholder text

#### Basic Components
## StreamCard
- Source: `cardHTML` in `ui/app.js`
- Category: basic
- Description: 16:9 live thumbnail card with LIVE tag, viewers, uptime, avatar, title, channel, category, tags
- Extractable props: none (content-driven)
- Hardcoded: overlay positions, typography

## CategoryCard
- Source: `catCardHTML` in `ui/app.js`
- Category: basic
- Description: 3:4 box-art card with name, viewers, platform icons

## Avatar
- Source: `avatar` in `ui/app.js`
- Category: basic
- Description: Round avatar with Twitch/Kick platform badge and live ring
- Extractable props: platform ("Twitch" | "Kick"), live (boolean, default false)

## Button / Pill / Tag / Switch
- Source: `ui/app.css` (.btn, .pill, .tag, .switch)
- Category: basic
- Description: Green primary / grey secondary buttons, rounded pills, tags, toggle switch
