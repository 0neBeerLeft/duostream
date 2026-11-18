"use strict";
// Chat Enhancer: DuoStream's built-in chat processing pipeline (not a plugin).
//
//   platform message (ChatMsg from Rust: Twitch IRC / Kick Pusher)
//     -> normalize   adds platform, uid ("t:login" / "k:slug"), plain text, roles, link flag
//     -> filter      user filter rules, links, bots, spam/repeats, platform visibility
//     -> users       ignored users (dropped), favorites, custom name colors
//     -> highlight   first matching highlight rule (mentions, users, words, roles, regex)
//     -> plugins     Plugins.filterChat (runs in app.js AFTER this, so plugins never see
//                    messages the user filtered out, and never receive private notes)
//     -> render      msgHTML in app.js reads m.ce (highlight/favorite/color decisions)
//
// Rules are compiled once per settings change (see compile()); per-message work is a few
// Set lookups and at most one combined RegExp test per rule. Platform data (badges, ids,
// reply metadata) is never removed; the enhancer only adds fields.

const CE = (() => {
  const DEFAULTS = {
    v: 1,
    general: { enabled: true, timestamps: false, badges: true, platformIcon: false, linkify: true },
    appearance: { fontSize: 14, font: "Inter", spacing: "normal", emoteSize: 28, nameColors: "platform", compact: false, dimOthers: 100 },
    filters: {
      links: false,
      bots: false,
      spam: { enabled: false, sameUser: true, copies: 3, windowSec: 20 },
      platforms: { Twitch: true, Kick: true },
      rules: [], // { id, enabled, type: "words"|"regex"|"user", value, platform: "any"|"Twitch"|"Kick", label }
    },
    highlights: {
      mention: { enabled: true, color: "", bg: "#2dd4bf1f", sound: false, emph: true },
      broadcaster: { enabled: false, color: "", bg: "#e5114714", sound: false, emph: false },
      mod: { enabled: false, color: "", bg: "#00a3ff14", sound: false, emph: false },
      vip: { enabled: false, color: "", bg: "#ffb80014", sound: false, emph: false },
      sub: { enabled: false, color: "", bg: "", sound: false, emph: false },
      favorite: { enabled: true, color: "", bg: "#ffb8001a", sound: false, emph: false },
      rules: [], // { id, enabled, type: "words"|"user"|"regex", value, platform, color, bg, sound, emph, label }
    },
    users: {}, // "t:login" | "k:slug" -> { name, fav, ignore, color, note }
    notify: { sound: true, volume: 50, desktopOnMention: false },
  };

  const BOTS = new Set(["nightbot", "streamelements", "moobot", "fossabot", "botrix", "botrixoficial", "wizebot", "streamlabs", "sery_bot",
    "kickbot", "soundalerts", "pokemoncommunitygame", "commanderroot", "blerp", "own3d", "deepbot", "coebot", "phantombot", "ankhbot",
    "vivbot", "supibot", "scriptybot", "streamstickers", "kofistreambot", "tangiabot", "frostytoolsdotcom", "sery_bot"]);
  const LINK_RE = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]{2,}|\b[a-z0-9-]+\.(com|net|org|gg|tv|ly|io|me|ru|xyz|link)\/\S*/i;
  const ROLE_KEYS = ["broadcaster", "mod", "vip", "sub"];

  let cfg = clone(DEFAULTS);
  let compiled = null;
  let saveTimer = null;
  const listeners = new Set();
  // spam memory (bounded): text -> [timestamps], uid|text -> last time
  const seenText = new Map();
  const seenUser = new Map();
  const stats = { hidden: 0 };

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  /** Deep-merge saved settings over defaults so new keys appear after updates. */
  function merge(base, over) {
    if (Array.isArray(base)) return Array.isArray(over) ? over : base;
    if (base && typeof base === "object") {
      const out = {};
      for (const k of Object.keys(base)) out[k] = over && k in over ? merge(base[k], over[k]) : clone(base[k]);
      if (over && typeof over === "object") for (const k of Object.keys(over)) if (!(k in base)) out[k] = over[k]; // e.g. users map
      return out;
    }
    return over === undefined || over === null || typeof over !== typeof base ? base : over;
  }

  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const splitList = (v) => String(v || "").split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const uidOf = (platform, login) => (platform === "Kick" ? "k:" : "t:") + String(login || "").toLowerCase();

  /** "kick:name", "k:name", "twitch:name", "t:name" or plain "name" -> [platform|null, login]. */
  function parseUser(s) {
    const m = s.trim().toLowerCase().replace(/^@/, "").match(/^(twitch|kick|t|k):(.+)$/);
    if (!m) return [null, s.trim().toLowerCase().replace(/^@/, "")];
    return [m[1][0] === "k" ? "Kick" : "Twitch", m[2].trim()];
  }

  /** Words/phrases -> one case-insensitive RegExp matching whole words (Unicode aware). */
  function wordsRe(list) {
    const terms = splitList(list).map(escRe);
    if (!terms.length) return null;
    return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${terms.join("|")})(?![\\p{L}\\p{N}_])`, "iu");
  }

  function safeRe(pattern) {
    if (!pattern || pattern.length > 300) return { error: pattern ? "Pattern is too long (300 characters max)" : "Empty pattern" };
    try { return { re: new RegExp(pattern, "iu") }; } catch (e) {
      try { return { re: new RegExp(pattern, "i") }; } catch (e2) { return { error: e2.message }; }
    }
  }

  /** Build a matcher for a rule: returns { test(m) } or { error }. */
  function matcher(rule) {
    const plat = rule.platform && rule.platform !== "any" ? rule.platform : null;
    const platOk = (m) => !plat || m.platform === plat;
    if (rule.type === "user") {
      const keys = new Set(), any = new Set();
      for (const u of splitList(rule.value)) {
        const [p, login] = parseUser(u);
        if (!login) continue;
        if (p) keys.add(uidOf(p, login)); else any.add(login);
      }
      if (!keys.size && !any.size) return { error: "Add at least one username" };
      return { test: (m) => platOk(m) && (keys.has(m.uid) || any.has(m.login)) };
    }
    if (rule.type === "regex") {
      const r = safeRe(rule.value);
      if (r.error) return { error: r.error };
      let slow = 0;
      return {
        test(m) {
          if (!platOk(m) || slow > 3) return false; // a pathological pattern switches itself off
          const t0 = performance.now();
          const hit = r.re.test(m.text);
          if (performance.now() - t0 > 4) slow++;
          return hit;
        },
      };
    }
    const re = wordsRe(rule.value);
    if (!re) return { error: "Add at least one word or phrase" };
    return { test: (m) => platOk(m) && re.test(m.text) };
  }

  function compile() {
    const errors = {};
    const build = (list, kind) => list.filter((r) => r.enabled).map((r) => {
      const mt = matcher(r);
      if (mt.error) { errors[r.id] = mt.error; return null; }
      return { rule: r, test: mt.test, kind };
    }).filter(Boolean);
    compiled = {
      filters: build(cfg.filters.rules, "filter"),
      highlights: build(cfg.highlights.rules, "highlight"),
      errors,
    };
    return compiled;
  }

  // ---------------------------------------------------------------- pipeline stages
  function normalize(m, ctx) {
    if (m.ce) return m; // already processed (re-render)
    const platform = m.platform || ctx.platform;
    const badges = m.badges || [];
    const has = (p) => badges.some((b) => b === p || b.startsWith(p + "/"));
    const text = (m.spans || []).map((s) => (s.t === "text" ? s.v : "")).join("").trim();
    m.platform = platform;
    m.uid = uidOf(platform, m.login || m.name);
    m.text = text;
    m.roles = {
      broadcaster: has("broadcaster"),
      mod: has("moderator") || has("staff") || has("admin") || has("global_mod"),
      vip: has("vip"),
      sub: has("subscriber") || has("founder"),
      bot: has("bot-badge") || has("bot") || BOTS.has(String(m.login || "").toLowerCase()),
    };
    m.hasLink = LINK_RE.test(text);
    return m;
  }

  function spamKey(m) {
    const t = m.text.toLowerCase().replace(/\s+/g, " ");
    return t || (m.spans || []).filter((s) => s.t === "emote").map((s) => s.v).join(" ");
  }

  /** Returns a reason string if the message should be hidden. `replay` skips spam memory. */
  function filterReason(m, replay) {
    const f = cfg.filters;
    if (f.platforms[m.platform] === false) return `${m.platform} messages are hidden`;
    const user = cfg.users[m.uid];
    if (user?.ignore) return "Ignored user";
    if (f.bots && m.roles.bot) return "Bot";
    if (f.links && m.hasLink && !m.roles.broadcaster && !m.roles.mod) return "Contains a link";
    for (const c of compiled.filters) if (c.test(m)) return `Filter: ${c.rule.label || c.rule.value.slice(0, 40)}`;
    if (f.spam.enabled && !replay && !m.roles.broadcaster && !m.roles.mod) {
      const key = spamKey(m);
      if (key) {
        const now = Date.now(), win = Math.max(3, f.spam.windowSec) * 1000;
        if (f.spam.sameUser) {
          const uk = m.uid + "|" + key, last = seenUser.get(uk);
          seenUser.set(uk, now);
          if (last && now - last < win) return "Repeated message";
        }
        const arr = (seenText.get(key) || []).filter((t) => now - t < win);
        arr.push(now);
        seenText.set(key, arr);
        if (arr.length >= Math.max(2, f.spam.copies)) return "Spam / copy-paste";
        // keep memory bounded on long sessions
        if (seenText.size > 2000) seenText.delete(seenText.keys().next().value);
        if (seenUser.size > 2000) seenUser.delete(seenUser.keys().next().value);
      }
    }
    return null;
  }

  function highlightFor(m, me) {
    const h = cfg.highlights;
    const pick = (o, why) => ({ color: o.color || "", bg: o.bg || "", sound: !!o.sound, emph: !!o.emph, why });
    for (const c of compiled.highlights) if (c.test(m)) return pick(c.rule, c.rule.label || "Highlight rule");
    if (h.mention.enabled && me && m.login !== me.toLowerCase() && mentionRe(me).test(m.text)) return pick(h.mention, "Mentions you");
    if (h.favorite.enabled && cfg.users[m.uid]?.fav) return pick(h.favorite, "Favorite");
    for (const k of ROLE_KEYS) if (h[k].enabled && m.roles[k]) return pick(h[k], k);
    return null;
  }
  const mentionCache = new Map();
  function mentionRe(me) {
    let re = mentionCache.get(me);
    if (!re) { re = new RegExp(`(?<![\\p{L}\\p{N}_])@?${escRe(me)}(?![\\p{L}\\p{N}_])`, "iu"); mentionCache.set(me, re); }
    return re;
  }

  /**
   * Run one message through the pipeline. ctx = { platform, me }.
   * Returns the (annotated) message, or null when it is filtered out.
   */
  function process(m, ctx, replay = false) {
    if (m.system) return m;
    normalize(m, ctx);
    if (!cfg.general.enabled) { m.ce = {}; return m; }
    if (!compiled) compile();
    const why = filterReason(m, replay);
    if (why) { stats.hidden++; return null; }
    const user = cfg.users[m.uid];
    // notes are deliberately NOT copied onto the message: plugins see messages, not notes
    m.ce = {
      hl: highlightFor(m, ctx.me),
      fav: !!user?.fav,
      color: user?.color || "",
    };
    return m;
  }

  /** Explain what would happen to a sample message (settings rule tester). */
  function test(sample, ctx) {
    if (!compiled) compile();
    const m = normalize({ login: sample.user, name: sample.user, spans: [{ t: "text", v: sample.text }], badges: sample.badges || [], platform: sample.platform }, ctx);
    const why = filterReason(m, true);
    if (why) return { hidden: true, why };
    const hl = highlightFor(m, ctx.me);
    return { hidden: false, why: hl ? `Highlighted (${hl.why})` : "Shown normally", hl };
  }

  // ---------------------------------------------------------------- notifications
  let audio = null, lastBeep = 0;
  function beep(force = false) {
    if (!cfg.notify.sound && !force) return;
    const now = Date.now();
    if (!force && now - lastBeep < 1500) return;
    lastBeep = now;
    try {
      audio ||= new AudioContext();
      const t = audio.currentTime, vol = Math.max(0, Math.min(1, cfg.notify.volume / 100)) * 0.25;
      for (const [f, d] of [[880, 0], [1320, 0.09]]) {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0, t + d);
        g.gain.linearRampToValueAtTime(vol, t + d + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.18);
        o.connect(g).connect(audio.destination);
        o.start(t + d); o.stop(t + d + 0.2);
      }
    } catch {}
  }

  // ---------------------------------------------------------------- appearance (CSS variables)
  const FONTS = { Inter: '"Inter", system-ui, sans-serif', System: 'system-ui, "Segoe UI", sans-serif', "Segoe UI": '"Segoe UI", system-ui, sans-serif', Mono: 'Consolas, "Cascadia Mono", monospace' };
  function applyAppearance(target = document.documentElement) {
    const a = cfg.appearance, g = cfg.general;
    const pad = { compact: "1px 6px", normal: "3px 6px", relaxed: "6px 8px" }[a.spacing] || "3px 6px";
    target.style.setProperty("--ce-font-size", `${a.fontSize}px`);
    target.style.setProperty("--ce-line", `${Math.round(a.fontSize * 1.55)}px`);
    target.style.setProperty("--ce-font", FONTS[a.font] || FONTS.Inter);
    target.style.setProperty("--ce-pad", a.compact ? "1px 6px" : pad);
    target.style.setProperty("--ce-emote", `${a.emoteSize}px`);
    target.style.setProperty("--ce-dim", String(Math.max(30, Math.min(100, a.dimOthers)) / 100));
    const cl = document.body.classList;
    cl.toggle("ce-no-badges", !g.badges);
    cl.toggle("ce-compact", !!a.compact);
    cl.toggle("ce-mono-names", a.nameColors === "mono");
    cl.toggle("ce-dim", a.dimOthers < 100);
  }

  // ---------------------------------------------------------------- persistence
  async function load() {
    try {
      const saved = await window.__TAURI__.core.invoke("ce_load");
      cfg = merge(DEFAULTS, saved && typeof saved === "object" ? saved : {});
    } catch { cfg = clone(DEFAULTS); }
    // brand color moved from Kick green to mint teal: migrate highlight colors saved with the old defaults
    const recolor = (v) => (typeof v === "string" && v.toLowerCase().startsWith("#53fc18") ? "#2dd4bf" + v.slice(7) : v);
    for (const h of [...Object.values(cfg.highlights).filter((x) => x && !Array.isArray(x) && typeof x === "object"), ...cfg.highlights.rules]) {
      h.bg = recolor(h.bg);
      h.color = recolor(h.color);
    }
    compile();
    applyAppearance();
    return cfg;
  }
  /** Apply a change immediately; persist shortly after (coalesces slider drags). */
  function update(mutator, { persist = true } = {}) {
    mutator(cfg);
    compile();
    applyAppearance();
    listeners.forEach((fn) => { try { fn(cfg); } catch (e) { console.error(e); } });
    if (persist) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => window.__TAURI__.core.invoke("ce_save", { settings: cfg }).catch((e) => console.error(e)), 350);
    }
  }
  /** Settings saved by another window (main <-> pop-out chat). */
  function adopt(settings) {
    cfg = merge(DEFAULTS, settings || {});
    compile();
    applyAppearance();
    listeners.forEach((fn) => { try { fn(cfg); } catch (e) { console.error(e); } });
  }
  function reset(section) {
    update((c) => {
      if (section) c[section] = clone(DEFAULTS[section]);
      else { const users = c.users; Object.assign(c, clone(DEFAULTS)); c.users = users; } // full reset keeps users
    });
  }

  // ---------------------------------------------------------------- users
  function setUser(platform, login, patch, displayName) {
    const uid = uidOf(platform, login);
    update((c) => {
      const u = { name: displayName || c.users[uid]?.name || login, ...(c.users[uid] || {}), ...patch };
      const empty = !u.fav && !u.ignore && !u.color && !u.note;
      if (empty) delete c.users[uid]; else c.users[uid] = u;
    });
  }

  const newId = () => Math.random().toString(36).slice(2, 10);

  return {
    DEFAULTS, get cfg() { return cfg; }, get errors() { return compiled?.errors || {}; }, stats,
    load, update, adopt, reset, process, test, compile, beep, setUser, uidOf, parseUser, newId,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    user: (platform, login) => cfg.users[uidOf(platform, login)] || null,
  };
})();
