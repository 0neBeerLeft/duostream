if (!window.__TAURI__) {
  document.documentElement.classList.add("browser-preview");
  const images = [
    "https://images.pexels.com/photos/15367435/pexels-photo-15367435.jpeg?auto=compress&cs=tinysrgb&w=800",
    "https://images.pexels.com/photos/9072394/pexels-photo-9072394.jpeg?auto=compress&cs=tinysrgb&w=800",
    "https://images.pexels.com/photos/7858742/pexels-photo-7858742.jpeg?auto=compress&cs=tinysrgb&w=800",
    "https://images.pexels.com/photos/7862594/pexels-photo-7862594.jpeg?auto=compress&cs=tinysrgb&w=800",
    "https://images.pexels.com/photos/8762788/pexels-photo-8762788.jpeg?auto=compress&cs=tinysrgb&w=800",
  ];
  const data = [
    ["Twitch", "pixelquest", "PixelQuest", "A little adventure, a lot of chaos", "Adventure", 12400, 0],
    ["Kick", "nightowl", "NightOwl", "Late night games with the community", "Just Chatting", 8700, 1],
    ["Twitch", "atlasplays", "AtlasPlays", "Ranked games and good vibes", "Action", 5600, 2],
    ["Twitch", "lunarae", "LunaRae", "Let's make something fun today", "Creative", 3200, 3],
    ["Kick", "cozycrew", "CozyCrew", "Hanging out and playing together", "Just Chatting", 1800, 4],
    ["Twitch", "arcadefox", "ArcadeFox", "One more round!", "Action", 960, 1],
    ["Kick", "questmode", "QuestMode", "Exploring somewhere new", "Adventure", 740, 2],
    ["Twitch", "moonbeam", "Moonbeam", "A cozy stream to end the day", "Creative", 425, 3],
  ];
  const cards = data.map(([platform, login, display, title, category, viewers, image], i) => ({
    platform, login, display, title, category, viewers, thumb: images[image], avatar: null,
    started: new Date(Date.now() - (i + 1) * 1800000).toISOString(), tags: ["English", i % 2 ? "Community" : "Gaming"], language: "en",
  }));
  const categories = ["Just Chatting", "Adventure", "Action", "Creative"].map((name, i) => ({ name, twitch: name, kick: name, art: images[(i + 1) % images.length], viewers: cards.filter((c) => c.category === name).reduce((sum, c) => sum + c.viewers, 0) }));
  const initial = { twitch: null, kick: null, follows: cards.slice(0, 4).map(({ platform, login }) => ({ platform, login })), avatars: {}, followed_categories: [], hidden_channels: [], hidden_categories: [], sidebar_collapsed: false, show_chat: true, volume: 70, notify_live: false, close_to_tray: false, auto_claim: false, plugin_sources: [] };
  let state;
  try { state = { ...initial, ...JSON.parse(localStorage.getItem("duostream-browser-preview") || "{}") }; } catch { state = initial; }
  const save = () => localStorage.setItem("duostream-browser-preview", JSON.stringify(state));
  const search = (q) => {
    const term = q.toLowerCase();
    return { channels: cards.filter((c) => `${c.display} ${c.category}`.toLowerCase().includes(term)).map((c) => ({ ...c, live: true })), live: cards.filter((c) => `${c.display} ${c.category} ${c.title}`.toLowerCase().includes(term)), categories: categories.filter((c) => c.name.toLowerCase().includes(term)), videos: [] };
  };
  const invoke = async (command, args = {}) => {
    switch (command) {
      case "get_state": return state;
      case "preview_mode": return true;
      case "restore_sessions": return [state, []];
      case "startup_arg": case "update_check": case "ce_load": return null;
      case "ce_save": case "js_log": case "chat_leave": return null;
      case "plugins_list": return [];
      case "browse_page": return { cards: cards.filter((c) => (args.platform === "all" || c.platform === args.platform) && (!args.language || c.language === args.language) && (!args.tag || c.tags.includes(args.tag)) && (!args.drops || c.platform === "Twitch")), twitch_cursor: null, kick_page: null };
      case "categories": return categories;
      case "category_streams": return cards.filter((c) => c.category === (args.twitchName || args.kickSlug));
      case "follows_status": return state.follows.map((f) => ({ ...f, live: cards.find((c) => c.platform === f.platform && c.login === f.login) || null }));
      case "search_all": case "suggest": return search(args.q);
      case "set_follow": state.follows = state.follows.filter((f) => f.platform !== args.platform || f.login !== args.login); if (args.on) state.follows.push({ platform: args.platform, login: args.login }); save(); return state;
      case "set_category_follow": state.followed_categories = state.followed_categories.filter((c) => c.name !== args.category.name); if (args.on) state.followed_categories.push(args.category); save(); return state;
      case "set_hidden": { const key = args.kind === "channel" ? "hidden_channels" : "hidden_categories"; state[key] = state[key].filter((x) => x !== args.key); if (args.on) state[key].push(args.key); save(); return state; }
      case "set_prefs": for (const [key, value] of Object.entries(args)) state[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = value; save(); return state;
      case "set_plugin_sources": state.plugin_sources = args.sources; save(); return state;
      case "drops_status": return { twitch: { connected: false, campaigns: [] }, kick: { connected: false, campaigns: [] } };
      case "channel_about": return { bio: "This is an example channel in the browser preview.", followers: 12500, socials: [], panels: [], sub_badges: [] };
      case "channel_videos": case "chat_emotes": return [];
      case "chat_join": return 1;
      case "twitch_badges": return {};
      case "resolve": { const c = cards.find((x) => x.platform === args.platform && x.login === args.login); if (!c) throw new Error("Channel not available in the browser preview."); return { ...c, live: true, variants: [] }; }
      default: throw new Error("This feature is available in the desktop app, not the browser preview.");
    }
  };
  const noop = async () => {};
  window.__TAURI__ = { core: { invoke }, event: { listen: noop }, window: { getCurrentWindow: () => ({ minimize: noop, toggleMaximize: noop, close: noop, isMaximized: async () => false, onResized: noop, startDragging: noop }) } };
}
