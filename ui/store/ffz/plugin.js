// FFZ emotes: shows FrankerFaceZ emotes in Twitch chat, and adds them to the emote picker.
// FFZ only supports Twitch channels; on Kick this plugin stays quiet.
let global = null;
let emotes = new Map(); // name -> image url
let current = "";

const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

/** Emotes from FFZ "sets" objects (only the given set ids, or all). */
function fromSets(sets, ids) {
  const out = [];
  for (const [id, set] of Object.entries(sets || {})) {
    if (ids && !ids.includes(Number(id))) continue;
    for (const e of set.emoticons || []) {
      const url = e.urls && (e.urls["1"] || e.urls["2"]);
      if (e.name && url) out.push([e.name, url.startsWith("//") ? `https:${url}` : url]);
    }
  }
  return out;
}

async function load(ch) {
  const key = ch ? `${ch.platform}:${ch.login}` : "";
  current = key;
  if (!ch || ch.platform !== "Twitch") { emotes = new Map(); api.setEmotes([]); return; }
  if (!global) {
    try { const g = await getJson("https://api.frankerfacez.com/v1/set/global"); global = fromSets(g.sets, g.default_sets); } catch { /* offline */ }
  }
  emotes = new Map(global || []);
  let own = [];
  if (ch.userId) {
    try { own = fromSets((await getJson(`https://api.frankerfacez.com/v1/room/id/${ch.userId}`)).sets); } catch { /* no FFZ room */ }
  }
  if (current !== key) return;
  emotes = new Map([...(global || []), ...own]);
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
