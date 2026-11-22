// BTTV emotes: shows BetterTTV emotes in Twitch chat, and adds them to the emote picker.
// BTTV only supports Twitch channels; on Kick this plugin stays quiet.
let global = null;
let emotes = new Map(); // name -> image url
let current = "";

const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const fill = (list) => new Map(list.filter((e) => e && e.id && e.code).map((e) => [e.code, `https://cdn.betterttv.net/emote/${e.id}/1x`]));

async function load(ch) {
  const key = ch ? `${ch.platform}:${ch.login}` : "";
  current = key;
  if (!ch || ch.platform !== "Twitch") { emotes = new Map(); api.setEmotes([]); return; }
  try { global ||= await getJson("https://api.betterttv.net/3/cached/emotes/global"); } catch { /* offline */ }
  emotes = fill(global || []);
  let own = [];
  if (ch.userId) {
    try {
      const u = await getJson(`https://api.betterttv.net/3/cached/users/twitch/${ch.userId}`);
      own = [...(u.channelEmotes || []), ...(u.sharedEmotes || [])];
    } catch { /* channel has no BTTV emotes */ }
  }
  if (current !== key) return;
  emotes = fill([...(global || []), ...own]);
  api.setEmotes([...emotes].map(([name, url]) => ({ name, url })));
}

/** Replace emote words in a message's text with images. */
function swap(m) {
  let changed = false;
  const spans = [];
  for (const s of m.spans) {
    if (s.t !== "text") { spans.push(s); continue; }
    let buf = "";
    for (const part of s.v.split(/(\s+)/)) {
      const url = emotes.get(part);
      if (url) { if (buf) spans.push({ t: "text", v: buf }); buf = ""; spans.push({ t: "emote", v: url }); changed = true; }
      else buf += part;
    }
    if (buf) spans.push({ t: "text", v: buf });
  }
  return changed ? { ...m, spans } : m;
}

api.on("channel:open", load);
api.on("chat:message", (m) => (m.system || !emotes.size || m.platform !== "Twitch" ? m : swap(m)));
load(api.channel());
