// Chat Timestamps: prefixes each chat message with the local time (HH:MM).
const pad = (n) => String(n).padStart(2, "0");

api.on("chat:message", (m) => {
  if (m.system || m.history) return m; // history lines are from before you joined
  const d = new Date();
  return { ...m, prefix: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
});
