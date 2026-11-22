// 7TV emotes: shows 7TV emotes in Twitch and Kick chat, and adds them to the emote picker.
// Global emotes + the channel's own set (7TV links Kick channels by Kick user id).
let global = null;
let emotes = new Map(); // name -> image url
let current = "";

const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

function imageUrl(e) {
  const h = e.data && e.data.host;
  if (!h || !h.url || !Array.isArray(h.files)) return null;
  const f = h.files.find((x) => x.name === "1x.webp") || h.files[0];
  return f ? `https:${h.url}/${f.name}` : null;
}

function fill(list) {
  const m = new Map();
  for (const e of list) { const u = imageUrl(e); if (u && e.name) m.set(e.name, u); }
  return m;
}

async function load(ch) {
  const key = ch ? `${ch.platform}:${ch.login}` : "";
  current = key;
  try { global ||= (await getJson("https://7tv.io/v3/emote-sets/global")).emotes || []; } catch { global = global || null; }
  emotes = fill(global || []); // global right away; the channel's set follows
  let own = [];
  if (ch && ch.userId) {
    try {
      const u = await getJson(`https://7tv.io/v3/users/${ch.platform === "Kick" ? "kick" : "twitch"}/${ch.userId}`);
      own = (u.emote_set && u.emote_set.emotes) || [];
    } catch { /* channel has no 7TV account */ }
  }
  if (current !== key) return; // switched channel meanwhile
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
api.on("chat:message", (m) => (m.system || !emotes.size ? m : swap(m)));
load(api.channel());
