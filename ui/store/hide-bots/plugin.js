// Hide Chat Bots: drops messages from well-known chat bots.
// Add your own names with: api.storage.set("extra", ["mybot"]) from another plugin, or edit this list.
const BOTS = new Set([
  "nightbot", "streamelements", "moobot", "fossabot", "streamlabs", "wizebot", "deepbot",
  "botrix", "kickbot", "botrixoficial", "sery_bot", "soundalerts", "commanderroot", "pokemoncommunitygame",
  ...api.storage.get("extra", []).map((s) => String(s).toLowerCase()),
]);

api.on("chat:message", (m) => (!m.system && BOTS.has(m.name.toLowerCase()) ? false : m));
