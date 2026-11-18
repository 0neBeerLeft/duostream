"use strict";
// Chat Enhancer settings UI (Settings → Chat). Built on app.js helpers ($, esc, I, S, PICON, msgHTML).
// Inputs update CE immediately; only structural actions (add/remove rule, tab switch, reset)
// re-render the form, so typing never loses focus.

const CE_TABS = [["general", "General"], ["filters", "Filters"], ["highlights", "Highlights"], ["appearance", "Appearance"], ["users", "Users"], ["notify", "Notifications"]];

function openChatSettings(tab) {
  S.settingsTab = "chat";
  if (tab) S.ceTab = tab;
  if (S.view === "accounts") renderMain(); else setView("accounts");
}

const ceGet = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), CE.cfg);
function ceSet(path, value) {
  CE.update((c) => {
    const keys = path.split(".");
    let o = c;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys.at(-1)] = value;
  });
}

// ---------------------------------------------------------------- small form builders
const ceSwitch = (path, label, hint = "") => `<div class="ce-row"><div><b>${label}</b>${hint ? `<p>${hint}</p>` : ""}</div><button class="switch ${ceGet(path) ? "on" : ""}" data-ce="${path}"></button></div>`;
const ceRange = (path, label, min, max, step = 1, unit = "") => `<div class="ce-row"><div><b>${label}</b></div><div class="ce-range"><input type="range" min="${min}" max="${max}" step="${step}" value="${ceGet(path)}" data-ce="${path}" data-num><span data-out="${path}">${ceGet(path)}${unit}</span></div></div>`;
const ceSelect = (path, label, opts, hint = "") => `<div class="ce-row"><div><b>${label}</b>${hint ? `<p>${hint}</p>` : ""}</div><select class="ce-sel" data-ce="${path}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(ceGet(path)) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
const ceColor = (path, title) => {
  const v = ceGet(path) || "";
  return `<span class="ce-swatch ${v ? "" : "empty"}" title="${title}"><input type="color" value="${esc(v.slice(0, 7) || "#2dd4bf")}" data-ce="${path}" data-color><button class="ce-swatch-x" data-ceclear="${path}" title="Clear">${I.close}</button></span>`;
};
const platSel = (attr, val) => `<select class="ce-sel sm" ${attr}>${[["any", "Both platforms"], ["Twitch", "Twitch only"], ["Kick", "Kick only"]].map(([v, l]) => `<option value="${v}" ${val === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
const typeSel = (attr, val, opts) => `<select class="ce-sel sm" ${attr}>${opts.map(([v, l]) => `<option value="${v}" ${val === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;

function ceRuleRow(kind, r, i) {
  const err = CE.errors[r.id];
  const ph = r.type === "user" ? "names, comma separated (twitch:name or kick:name for one platform)" : r.type === "regex" ? "regular expression, e.g. ^!\\w+" : "words or phrases, comma separated";
  const hlExtras = kind === "highlights" ? `
      <div class="ce-rule-hl">${ceColor(`highlights.rules.${i}.color`, "Text color")}${ceColor(`highlights.rules.${i}.bg`, "Background")}
        <label class="ce-check"><input type="checkbox" ${r.sound ? "checked" : ""} data-rf="sound" data-kind="${kind}" data-i="${i}">Sound</label>
        <label class="ce-check"><input type="checkbox" ${r.emph ? "checked" : ""} data-rf="emph" data-kind="${kind}" data-i="${i}">Emphasis</label></div>` : "";
  return `<div class="ce-rule ${r.enabled ? "" : "off"}">
    <div class="ce-rule-top">
      <button class="switch ${r.enabled ? "on" : ""}" data-rtoggle="${kind}|${i}" title="Enable / disable"></button>
      ${typeSel(`data-rf="type" data-kind="${kind}" data-i="${i}"`, r.type, [["words", "Words"], ["user", "Users"], ["regex", "Regex"]])}
      ${platSel(`data-rf="platform" data-kind="${kind}" data-i="${i}"`, r.platform || "any")}
      <input class="ce-label" placeholder="Name (optional)" value="${esc(r.label || "")}" data-rf="label" data-kind="${kind}" data-i="${i}" spellcheck="false">
      <button class="icon-btn" data-rdel="${kind}|${i}" title="Delete rule">${I.trash}</button>
    </div>
    <input class="ce-val ${err ? "bad" : ""}" placeholder="${esc(ph)}" value="${esc(r.value || "")}" data-rf="value" data-kind="${kind}" data-i="${i}" spellcheck="false">
    <div class="ce-err" data-err="${r.id}">${err ? esc(err) : ""}</div>${hlExtras}
  </div>`;
}

function ceBuiltinHl(key, label, hint) {
  const h = CE.cfg.highlights[key];
  return `<div class="ce-rule ${h.enabled ? "" : "off"}">
    <div class="ce-rule-top"><button class="switch ${h.enabled ? "on" : ""}" data-ce="highlights.${key}.enabled"></button><div class="grow"><b>${label}</b><p class="hint" style="margin:0">${hint}</p></div></div>
    <div class="ce-rule-hl">${ceColor(`highlights.${key}.color`, "Text color")}${ceColor(`highlights.${key}.bg`, "Background")}
      <label class="ce-check"><input type="checkbox" ${h.sound ? "checked" : ""} data-cebox="highlights.${key}.sound">Sound</label>
      <label class="ce-check"><input type="checkbox" ${h.emph ? "checked" : ""} data-cebox="highlights.${key}.emph">Emphasis</label></div>
  </div>`;
}

// ---------------------------------------------------------------- page
function renderChatSettings() {
  const box = $("#ceSettings"); if (!box) return;
  const t = S.ceTab, c = CE.cfg;
  let body = "";
  if (t === "general") {
    body = `${ceSwitch("general.enabled", "Chat Enhancer", "Filters, highlights, user tools and appearance below. Turn off to show chat exactly as received.")}
      ${ceSwitch("general.timestamps", "Timestamps", "Time next to every message.")}
      ${ceSwitch("general.badges", "Badges", "Subscriber, moderator, VIP and other chat badges.")}
      ${ceSwitch("general.platformIcon", "Platform indicator", "Small Twitch / Kick mark before each name.")}
      ${ceSwitch("general.linkify", "Clickable links")}
      <div class="ce-row"><div><b>Hidden this session</b><p>Messages removed by your filters since the app started.</p></div><span class="ce-stat">${CE.stats.hidden.toLocaleString()}</span></div>
      <div class="ce-row"><div><b>Reset Chat Enhancer</b><p>Restore every setting to its default. Your user list (favorites, ignores, notes) is kept.</p></div><button class="btn secondary sm" data-ceact="resetAll">${S.ceConfirm === "all" ? "Click again to confirm" : "Reset all"}</button></div>`;
  } else if (t === "filters") {
    body = `${ceSwitch("filters.links", "Hide messages with links", "Links from the broadcaster and moderators are always shown.")}
      ${ceSwitch("filters.bots", "Hide bots", "Nightbot, StreamElements, Moobot, Fossabot, BotRix and other known bots.")}
      ${ceSwitch("filters.spam.enabled", "Hide spam and repeats", "Broadcaster and moderators are never hidden.")}
      ${c.filters.spam.enabled ? `<div class="ce-sub">${ceSwitch("filters.spam.sameUser", "Hide when one person repeats themselves")}
        ${ceRange("filters.spam.copies", "Hide copy-paste after this many copies", 2, 10)}
        ${ceRange("filters.spam.windowSec", "Within", 5, 120, 5, "s")}</div>` : ""}
      <div class="ce-row"><div><b>Platforms shown</b><p>Hide one platform's messages entirely.</p></div><div class="ce-plats">
        <label class="ce-check">${PICON.Twitch}<input type="checkbox" ${c.filters.platforms.Twitch ? "checked" : ""} data-cebox="filters.platforms.Twitch">Twitch</label>
        <label class="ce-check">${PICON.Kick}<input type="checkbox" ${c.filters.platforms.Kick ? "checked" : ""} data-cebox="filters.platforms.Kick">Kick</label></div></div>
      <div class="ce-h">Filter rules <span class="hint">Case-insensitive. Words match whole words only.</span><span class="grow"></span><button class="btn primary sm" data-ceact="addFilter">${I.sparkle}Add rule</button></div>
      ${c.filters.rules.map((r, i) => ceRuleRow("filters", r, i)).join("") || '<p class="hint">No filter rules yet.</p>'}
      ${ceTester()}`;
  } else if (t === "highlights") {
    body = `${ceBuiltinHl("mention", "Mentions of you", "Your Twitch or Kick name in a message.")}
      ${ceBuiltinHl("favorite", "Favorite users", "People you marked as favorite (right-click a message).")}
      ${ceBuiltinHl("broadcaster", "Broadcaster", "The streamer.")}
      ${ceBuiltinHl("mod", "Moderators", "Moderators and staff.")}
      ${ceBuiltinHl("vip", "VIPs", "")}
      ${ceBuiltinHl("sub", "Subscribers", "Subscribers and founders.")}
      <div class="ce-h">Custom highlights <span class="hint">The first matching rule wins.</span><span class="grow"></span><button class="btn primary sm" data-ceact="addHl">${I.sparkle}Add highlight</button></div>
      ${c.highlights.rules.map((r, i) => ceRuleRow("highlights", r, i)).join("") || '<p class="hint">No custom highlights yet.</p>'}
      ${ceTester()}`;
  } else if (t === "appearance") {
    body = `${ceRange("appearance.fontSize", "Font size", 11, 22, 1, "px")}
      ${ceSelect("appearance.font", "Font", [["Inter", "Inter"], ["System", "System"], ["Segoe UI", "Segoe UI"], ["Mono", "Monospace"]])}
      ${ceSelect("appearance.spacing", "Message spacing", [["compact", "Tight"], ["normal", "Normal"], ["relaxed", "Relaxed"]])}
      ${ceRange("appearance.emoteSize", "Emote size", 18, 56, 2, "px")}
      ${ceSelect("appearance.nameColors", "Username colors", [["platform", "Each user's color"], ["mono", "All white"]], "Custom colors you set for a user always win.")}
      ${ceSwitch("appearance.compact", "Compact mode", "Tightest spacing and no reply-context line.")}
      ${ceRange("appearance.dimOthers", "Opacity of normal messages", 30, 100, 5, "%")}`;
  } else if (t === "users") {
    const users = Object.entries(c.users).sort((a, b) => (a[1].name || a[0]).localeCompare(b[1].name || b[0]));
    body = `<p class="hint" style="margin-top:0">Twitch and Kick accounts are separate, even with the same name. Right-click any chat message for quick actions.</p>
      <form class="ce-adduser" id="ceAddUser">${typeSel('id="ceAddPlat"', "Twitch", [["Twitch", "Twitch"], ["Kick", "Kick"]])}<input id="ceAddName" placeholder="username" spellcheck="false"><button class="btn primary sm" type="submit">Add</button></form>
      ${users.length ? `<div class="ce-users">${users.map(([uid, u]) => {
        const p = uid.startsWith("k:") ? "Kick" : "Twitch", login = uid.slice(2);
        return `<div class="ce-user">
          ${pbadge(p, "inline")}<span class="ce-uname" style="color:${esc(u.color || "var(--fg)")}">${esc(u.name || login)}</span>
          <span class="grow"></span>
          <button class="ce-tag ${u.fav ? "on" : ""}" data-uact="fav|${uid}">${I.star}Favorite</button>
          <button class="ce-tag ${u.ignore ? "on bad" : ""}" data-uact="ignore|${uid}">${I.ban}Ignored</button>
          <button class="ce-tag ${u.color ? "on" : ""}" data-uact="color|${uid}">${I.palette}Color</button>
          <button class="ce-tag ${u.note ? "on" : ""}" data-uact="note|${uid}" title="${esc(u.note || "")}">${I.note}Note</button>
          <button class="icon-btn" data-uact="del|${uid}" title="Forget this user">${I.trash}</button>
        </div>`;
      }).join("")}</div>` : '<p class="hint">Nobody here yet. Favorites, ignored users, custom colors and notes show up here.</p>'}`;
  } else if (t === "notify") {
    body = `${ceSwitch("notify.sound", "Highlight sounds", "Plays for highlights that have Sound turned on.")}
      <div class="ce-row"><div><b>Volume</b></div><div class="ce-range"><input type="range" min="0" max="100" step="5" value="${c.notify.volume}" data-ce="notify.volume" data-num><span data-out="notify.volume">${c.notify.volume}%</span><button class="btn secondary xs" data-ceact="testSound">Test</button></div></div>
      ${ceSwitch("notify.desktopOnMention", "Desktop notification when mentioned", "Only while DuoStream isn't the active window.")}`;
  }
  const reset = t === "general" || t === "users" ? "" : `<button class="btn secondary xs" data-ceact="reset|${t}">${S.ceConfirm === t ? "Click again to confirm" : "Reset this section"}</button>`;
  box.innerHTML = `<div class="ce-layout">
    <nav class="ce-nav">${CE_TABS.map(([k, l]) => `<button class="${t === k ? "on" : ""}" data-cetab="${k}">${l}</button>`).join("")}</nav>
    <section class="ce-body"><div class="ce-body-head"><h2>${CE_TABS.find((x) => x[0] === t)[1]}</h2>${reset}</div>${body}</section>
    <aside class="ce-preview"><div class="ce-prev-head">Live preview</div><div class="ce-prev-log chat-log" id="cePreview"></div></aside>
  </div>`;
  renderCePreview();
  ceRunTest();
}

function ceTester() {
  const p = S.ch?.platform || "Twitch";
  return `<div class="ce-tester"><div class="ce-h" style="margin-top:0">Test a message</div>
    <div class="ce-test-row">${typeSel('id="ceTestPlat"', p, [["Twitch", "Twitch"], ["Kick", "Kick"]])}
      ${typeSel('id="ceTestRole"', "", [["", "Viewer"], ["moderator/1", "Moderator"], ["vip/1", "VIP"], ["subscriber/1", "Subscriber"], ["broadcaster/1", "Broadcaster"]])}
      <input id="ceTestUser" placeholder="username" value="viewer123" spellcheck="false"></div>
    <input id="ceTestText" class="ce-val" placeholder="Type a chat message to see what happens to it" spellcheck="false">
    <div class="ce-test-out" id="ceTestOut"></div></div>`;
}
function ceRunTest() {
  const out = $("#ceTestOut"); if (!out) return;
  const text = $("#ceTestText").value;
  if (!text.trim()) { out.innerHTML = '<span class="hint">Results appear as you type.</span>'; return; }
  const platform = $("#ceTestPlat").value;
  const r = CE.test({ user: $("#ceTestUser").value.trim() || "viewer", text, platform, badges: $("#ceTestRole").value ? [$("#ceTestRole").value] : [] }, { platform, me: myName(platform) });
  out.innerHTML = r.hidden ? `<span class="ce-res bad">${I.ban}Hidden · ${esc(r.why)}</span>` : r.hl ? `<span class="ce-res hl" style="${r.hl.bg ? `background:${esc(r.hl.bg)}` : ""}">${I.sparkle}${esc(r.why)}</span>` : `<span class="ce-res ok">Shown normally</span>`;
}

/** Sample messages rendered through the real pipeline + renderer. */
function renderCePreview() {
  const box = $("#cePreview"); if (!box) return;
  const platform = S.ch?.platform || (S.st.kick && !S.st.twitch ? "Kick" : "Twitch");
  const me = "you"; // generic in the preview (never shows your real account name)
  const kappa = "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0";
  const samples = [
    { name: "StreamerName", color: "#ff6b8a", badges: ["broadcaster/1"], spans: [{ t: "text", v: "Welcome in everyone! " }, { t: "emote", v: kappa }] },
    { name: "ModeratorMax", color: "#00a3ff", badges: ["moderator/1"], spans: [{ t: "text", v: "Remember to be nice in chat" }] },
    { name: "FriendlyViewer", color: "#53fc18", badges: ["subscriber/12"], spans: [{ t: "text", v: `hey @${me} did you see that play?` }] },
    { name: "LinkPoster", color: "#ffb800", badges: [], spans: [{ t: "text", v: "check this out https://example.com/clip" }] },
    { name: "Nightbot", color: "#7c3aed", badges: [], spans: [{ t: "text", v: "Follow the socials with !socials" }] },
    { name: "vip_viewer", color: "#c026d3", badges: ["vip/1"], spans: [{ t: "text", v: "that was insane " }, { t: "emote", v: kappa }, { t: "emote", v: kappa }] },
  ];
  const ctx = { platform, me };
  box.innerHTML = samples.map((s, i) => {
    const m = { ...s, login: s.name.toLowerCase(), id: "", platform, seq: -1 - i, ts: Date.now() - (6 - i) * 60000 };
    const shown = CE.process(m, ctx, true);
    if (!shown) return `<div class="ce-prev-hidden">${I.ban}${esc(s.name)}'s message is hidden: ${esc(CE.test({ user: m.login, text: m.spans.map((x) => (x.t === "text" ? x.v : "")).join(""), platform, badges: s.badges }, ctx).why)}</div>`;
    return msgHTML(shown);
  }).join("");
}

// keep preview / chat in sync with every change (main window and pop-out)
CE.onChange(() => {
  rerenderChat();
  renderCePreview();
  ceRunTest();
  // inline rule errors without re-rendering the form
  document.querySelectorAll("[data-err]").forEach((n) => {
    const e = CE.errors[n.dataset.err] || "";
    n.textContent = e;
    n.previousElementSibling?.classList?.toggle("bad", !!e);
  });
});

// ---------------------------------------------------------------- events (delegated)
document.addEventListener("click", (e) => {
  const tab = e.target.closest("[data-stab2]");
  if (tab) { S.settingsTab = tab.dataset.stab2; renderMain(); return; }
  if (!e.target.closest("#ceSettings")) return;
  const ct = e.target.closest("[data-cetab]");
  if (ct) { S.ceTab = ct.dataset.cetab; S.ceConfirm = null; renderChatSettings(); return; }
  const sw = e.target.closest("button.switch[data-ce]");
  if (sw) { const on = !sw.classList.contains("on"); sw.classList.toggle("on", on); ceSet(sw.dataset.ce, on); if (/spam\.enabled|enabled$/.test(sw.dataset.ce)) renderChatSettings(); return; }
  const rt = e.target.closest("[data-rtoggle]");
  if (rt) { const [kind, i] = rt.dataset.rtoggle.split("|"); CE.update((c) => { const r = c[kind].rules[+i]; r.enabled = !r.enabled; }); renderChatSettings(); return; }
  const rd = e.target.closest("[data-rdel]");
  if (rd) { const [kind, i] = rd.dataset.rdel.split("|"); CE.update((c) => c[kind].rules.splice(+i, 1)); renderChatSettings(); return; }
  const clr = e.target.closest("[data-ceclear]");
  if (clr) { e.preventDefault(); ceSet(clr.dataset.ceclear, ""); renderChatSettings(); return; }
  const ua = e.target.closest("[data-uact]");
  if (ua) {
    const [act, uid] = ua.dataset.uact.split("|");
    const p = uid.startsWith("k:") ? "Kick" : "Twitch", login = uid.slice(2), u = CE.cfg.users[uid] || {};
    const after = () => renderChatSettings();
    if (act === "fav") CE.setUser(p, login, { fav: !u.fav });
    else if (act === "ignore") CE.setUser(p, login, { ignore: !u.ignore });
    else if (act === "color") { editUserColor(p, login, u.name || login).then(after); return; }
    else if (act === "note") { editUserNote(p, login, u.name || login).then(after); return; }
    else if (act === "del") CE.update((c) => { delete c.users[uid]; });
    after();
    return;
  }
  const act = e.target.closest("[data-ceact]");
  if (!act) return;
  const a = act.dataset.ceact;
  if (a === "addFilter") CE.update((c) => c.filters.rules.push({ id: CE.newId(), enabled: true, type: "words", value: "", platform: "any", label: "" }));
  else if (a === "addHl") CE.update((c) => c.highlights.rules.push({ id: CE.newId(), enabled: true, type: "words", value: "", platform: "any", color: "", bg: "#2dd4bf26", sound: false, emph: true, label: "" }));
  else if (a === "testSound") { CE.beep(true); return; }
  else if (a === "resetAll" || a.startsWith("reset|")) {
    const key = a === "resetAll" ? "all" : a.split("|")[1];
    if (S.ceConfirm !== key) { S.ceConfirm = key; renderChatSettings(); setTimeout(() => { if (S.ceConfirm === key) { S.ceConfirm = null; renderChatSettings(); } }, 4000); return; }
    S.ceConfirm = null;
    CE.reset(key === "all" ? null : key);
    toast(key === "all" ? "Chat Enhancer reset to defaults" : "Section reset");
  }
  renderChatSettings();
});

// value inputs: ranges/selects/colors/text update live, without re-rendering the form
document.addEventListener("input", (e) => {
  const t = e.target;
  if (!t.closest?.("#ceSettings")) return;
  if (t.matches("[data-ce]")) {
    const v = "num" in t.dataset ? +t.value : t.value;
    const out = document.querySelector(`[data-out="${t.dataset.ce}"]`);
    if (out) out.textContent = v + (t.dataset.ce.includes("fontSize") || t.dataset.ce.includes("emoteSize") ? "px" : t.dataset.ce.includes("windowSec") ? "s" : /dimOthers|volume/.test(t.dataset.ce) ? "%" : "");
    if ("color" in t.dataset) t.closest(".ce-swatch")?.classList.remove("empty");
    ceSet(t.dataset.ce, v);
    return;
  }
  if (t.matches("[data-rf]") && (t.tagName === "INPUT" && t.type !== "checkbox")) {
    const { kind, i, rf } = t.dataset;
    CE.update((c) => { c[kind].rules[+i][rf] = t.value; });
    return;
  }
  if (t.matches("#ceTestText, #ceTestUser")) ceRunTest();
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (!t.closest?.("#ceSettings")) return;
  if (t.matches("select[data-ce]")) { ceSet(t.dataset.ce, t.value); return; }
  if (t.matches("[data-cebox]")) { ceSet(t.dataset.cebox, t.checked); return; }
  if (t.matches("[data-rf]")) {
    const { kind, i, rf } = t.dataset;
    CE.update((c) => { c[kind].rules[+i][rf] = t.type === "checkbox" ? t.checked : t.value; });
    if (rf === "type") renderChatSettings(); // placeholder text depends on the type
    return;
  }
  if (t.matches("#ceTestPlat, #ceTestRole")) ceRunTest();
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "ceAddUser") return;
  e.preventDefault();
  const name = $("#ceAddName").value.trim().replace(/^@/, "");
  if (!name) return;
  CE.setUser($("#ceAddPlat").value, name.toLowerCase(), { fav: true }, name);
  renderChatSettings();
});
