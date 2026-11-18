// Mention Highlight: marks chat messages that contain your account names.
api.on("chat:message", (m) => {
  if (m.system) return m;
  const me = api.me();
  const names = [me.twitch, me.kick].filter(Boolean).map((n) => n.toLowerCase());
  if (!names.length) return m;
  const text = m.spans.filter((s) => s.t === "text").map((s) => s.v).join(" ").toLowerCase();
  return names.some((n) => text.includes(n)) ? { ...m, highlight: true } : m;
});
