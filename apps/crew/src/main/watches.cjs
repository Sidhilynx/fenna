// Waiting without looking. A bot sets a watch (a site's notification, one
// element on an open tab, a web page, or a time) and Crew watches for it.
// When one fires, Crew holds what happened for 10 seconds, then wakes the
// bot with a run whose trigger is "watch" and whose text says what happened,
// one line per event. Watches and the bot's to-do list live in its folder
// (watches.json, todos.json). The bot changes them through its crew tools,
// the person through the bot's Details. Nothing here looks at a screen:
// pages are read as text, and the browser reports element changes.

const crypto = require("node:crypto");

// The limits and kinds, restated from apps/crew/src/shared/contract.ts
// (WATCH_KINDS, WATCH_MAX, PAGE_EVERY_MIN). This file can't import the .ts
// contract, so keep these in step with it.
const WATCH_KINDS = ["notification", "element", "page", "timer"];
const WATCH_MAX = 20;
const PAGE_EVERY_MIN = 5;

const TODO_MAX = 100;
const TODO_TEXT_MAX = 200;
const NOTE_MAX = 300;
const MATCH_MAX = 200;
const URL_MAX = 2000;
/** The text a page or element showed last, kept in full in memory and cut to this in the watch file. */
const SEEN_MAX = 4096;
/** One event's words in a wake. */
const EVENT_MAX = 1500;
/** Lines a page change lists; the last one says how many more there are. */
const DIFF_LINES = 20;
const BUNDLE_MS = 10_000;
/** A notification watch that fired this recently is not fired again by its tab's title. */
const TITLE_SKIP_MS = 10_000;
/** Events held for a bot's next wake; the oldest drop out, with a note. */
const BUNDLE_MAX = 50;
const WAKES_PER_HOUR = 12;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
/** The longest one setTimeout waits (about 24.8 days); longer waits are split. */
const MAX_DELAY = 2_147_000_000;

const clip = (s, n) => {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const given = (v) => v !== undefined && v !== null && v !== "";

function freshId(list) {
  for (;;) {
    const id = crypto.randomBytes(3).toString("hex");
    if (!list.some((x) => x.id === id)) return id;
  }
}

function noteArg(v) {
  const note = typeof v === "string" ? v.trim() : "";
  if (!note) throw new Error('Say in note what to do when it fires, in 1 to 300 characters, like "Reply to Sam if he asks something".');
  if (note.length > NOTE_MAX) throw new Error(`The note is ${note.length} characters; the most is ${NOTE_MAX}. Shorten it.`);
  return note;
}

function siteOrigin(v) {
  const text = typeof v === "string" ? v.trim() : "";
  let u;
  try {
    u = new URL(text);
  } catch {
    throw new Error(`"${clip(text, 80)}" is not a web address. Give the site as https://name.example, with no path.`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`The origin must be an http or https site, not ${u.protocol}. Use something like https://web.whatsapp.com.`);
  if (u.pathname !== "/" || u.search || u.hash || u.username || u.password) throw new Error(`Give the site without a path, like ${u.origin}. A page's full address goes in a page watch.`);
  return u.origin;
}

function webAddress(v, what) {
  const text = typeof v === "string" ? v.trim() : "";
  if (!text || text.length > URL_MAX) throw new Error(`${what} needs an address of 1 to ${URL_MAX} characters, in full, like https://example.com/pricing.`);
  let u;
  try {
    u = new URL(text);
  } catch {
    throw new Error(`"${clip(text, 80)}" is not a web address. Write it in full, like https://example.com/pricing.`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`${what} needs an http or https address, not ${u.protocol}.`);
  return u.href;
}

function matchArg(v) {
  if (!given(v)) return "";
  const text = typeof v === "string" ? v.trim() : "";
  if (!text) throw new Error("match is words the notification must contain; leave it out to watch every notification from the site.");
  if (text.length > MATCH_MAX) throw new Error(`match is ${text.length} characters; the most is ${MATCH_MAX}.`);
  return text;
}

function everyArg(v, min, what) {
  if (!Number.isInteger(v) || v < min) throw new Error(`${what} needs every as a whole number of minutes, ${min} or more.`);
  return v;
}

/** The time a timer goes off, as ISO: at (a future time) or in (minutes from now). */
function timerAt(input, t) {
  if (given(input.at) === given(input.in)) throw new Error("A timer needs at (a time, like 2026-11-20T09:00:00) or in (minutes from now), not both and not neither.");
  if (given(input.in)) {
    if (typeof input.in !== "number" || !(input.in > 0)) throw new Error("in is minutes from now: a number above 0, like 30.");
    return new Date(t.getTime() + input.in * MINUTE_MS).toISOString();
  }
  const ms = typeof input.at === "string" ? Date.parse(input.at) : NaN;
  if (Number.isNaN(ms)) throw new Error(`"${clip(input.at, 40)}" is not a time. Write at as ISO, like 2026-11-20T09:00:00 (local time) or 2026-11-20T09:00:00Z.`);
  if (ms <= t.getTime()) throw new Error("That time has passed. Give a time in the future, or use in with minutes from now.");
  return new Date(ms).toISOString();
}

/** Lines that changed between two texts, "- " for removed and "+ " for added, at most DIFF_LINES. */
function diffLines(before, after) {
  const lines = (t) => [...new Set(String(t).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean))];
  const a = lines(before);
  const b = lines(after);
  const inA = new Set(a);
  const inB = new Set(b);
  const out = [...a.filter((l) => !inB.has(l)).map((l) => `- ${clip(l, 160)}`), ...b.filter((l) => !inA.has(l)).map((l) => `+ ${clip(l, 160)}`)];
  if (out.length <= DIFF_LINES) return out;
  return [...out.slice(0, DIFF_LINES - 1), `… and ${out.length - (DIFF_LINES - 1)} more lines`];
}

function targetOf(w) {
  if (w.kind === "notification") return `${w.origin}${w.match ? ` containing "${w.match}"` : ""}`;
  if (w.kind === "element") return `an element on ${w.url}`;
  if (w.kind === "page") return `${w.url}, every ${w.every} min`;
  return `${w.at}${w.every ? `, every ${w.every} min` : ""}`;
}

/** One watch as one line for the bot: "id  kind  note — what it watches". */
const watchLine = (w) => `${w.id}  ${w.kind}  ${w.note} — ${targetOf(w)}`;

/** One to-do as one line for the bot: "id  open|done  text". */
const todoLine = (t) => `${t.id}  ${t.done ? "done" : "open"}  ${t.text}`;

/**
 * @param {object} o
 * @param {ReturnType<import("./store.cjs").createStore>} o.store
 * @param {{ enqueue(o: object): object, running(slug: string): object|null, isQueued(slug: string): boolean }} o.runner
 * @param {{ watchElement(slug: string, o: object): Promise<object>, armElement(slug: string, o: object): Promise<void>, unwatchElement(slug: string, id: string): Promise<void>, pageText(slug: string, url: string): Promise<string>, keepSite?(slug: string, origin: string): Promise<{ opened: boolean }>, hasSite?(slug: string, origin: string): boolean }} o.browsers
 * @param {(channel: string, payload: unknown) => void} [o.broadcast]
 * @param {() => Date} [o.now]
 * @param {(fn: () => void, ms: number) => unknown} [o.setTimer]  returns a handle clearTimeout accepts
 */
function createWatches({ store, runner, browsers, broadcast = () => {}, onFire = () => {}, now = () => new Date(), setTimer = (fn, ms) => setTimeout(fn, ms) }) {
  /** key → the armed timer's handle: a watch's next check or time, a bundle's wake-up, the wake-up after a run ends. */
  const timers = new Map();
  /** "slug/id" → the full text a page or element showed last. */
  const seen = new Map();
  /** slug → events waiting for the bot's next wake. */
  const bundles = new Map();
  /** slug → when the bot was woken in the last hour (ms). */
  const wakes = new Map();

  const iso = () => now().toISOString();
  const keyOf = (slug, id) => `${slug}/${id}`;
  const watchKey = (slug, id) => `watch/${keyOf(slug, id)}`;
  const bundleKey = (slug) => `bundle/${slug}`;
  const changed = (slug) => broadcast("crew:watches", { slug });

  /** Calls fn after ms, in steps when ms is longer than one timer can wait. */
  function later(ms, fn) {
    const h = { t: null };
    const step = (left) => {
      h.t = left > MAX_DELAY ? setTimer(() => step(left - MAX_DELAY), MAX_DELAY) : setTimer(fn, left);
    };
    step(Math.max(0, ms));
    return h;
  }

  function disarm(key) {
    const h = timers.get(key);
    if (!h) return;
    clearTimeout(h.t);
    timers.delete(key);
  }

  function arm(key, ms, fn) {
    disarm(key);
    timers.set(
      key,
      later(ms, () => {
        timers.delete(key);
        fn();
      }),
    );
  }

  const find = (slug, id) => store.readWatches(slug).find((w) => w.id === id) || null;

  /** The browser may have closed the tab already; the watch is removed either way. */
  const unwatch = (slug, id) => Promise.resolve().then(() => browsers.unwatchElement(slug, id)).catch(() => {});

  /**
   * A watch fired: its event waits in the bot's bundle. change edits the watch
   * first (what it last saw); a one-shot timer is removed.
   */
  function fire(slug, id, what, change = null) {
    const list = store.readWatches(slug);
    const w = list.find((x) => x.id === id);
    if (!w) return;
    if (change) change(w);
    w.fired = iso();
    w.count += 1;
    if (w.kind === "timer" && !w.every) list.splice(list.indexOf(w), 1);
    store.writeWatches(slug, list);
    bundle(slug, w.note, what, w.chat);
    changed(slug);
    onFire(slug, w, what);
  }

  function setLast(slug, id, text) {
    const list = store.readWatches(slug);
    const w = list.find((x) => x.id === id);
    if (!w) return;
    w.last = clip(text, SEEN_MAX);
    store.writeWatches(slug, list);
  }

  function bundle(slug, note, what, chat) {
    let b = bundles.get(slug);
    if (!b) bundles.set(slug, (b = { events: [], dropped: 0 }));
    b.events.push({ note, what: clip(what, EVENT_MAX), chat });
    if (b.events.length > BUNDLE_MAX) {
      b.events.shift();
      b.dropped++;
    }
    if (!timers.has(bundleKey(slug))) arm(bundleKey(slug), BUNDLE_MS, () => wake(slug));
  }

  /** Wakes the bot with what it is holding, unless it is busy (runEnded tries again) or it has been woken 12 times this hour. */
  function wake(slug) {
    const b = bundles.get(slug);
    if (!b || !b.events.length) return;
    if (runner.running(slug) || runner.isQueued(slug)) return;
    if (!store.readBot(slug)) {
      forget(slug);
      return;
    }
    const t = now().getTime();
    const recent = (wakes.get(slug) || []).filter((at) => t - at < HOUR_MS);
    wakes.set(slug, recent);
    if (recent.length >= WAKES_PER_HOUR) {
      if (!timers.has(bundleKey(slug))) arm(bundleKey(slug), recent[0] + HOUR_MS - t, () => wake(slug));
      return;
    }
    const text = b.events.map((e) => `${e.note} — ${e.what}`).join("\n") + (b.dropped ? `\n(${b.dropped} earlier events were not kept.)` : "");
    bundles.delete(slug);
    recent.push(t);
    // The wake goes to the chat the watch was set in (the newest event's), else the person's current chat: they see it either way.
    const chat = [...b.events].reverse().map((e) => e.chat).find((c) => typeof c === "string" && chatExists(slug, c)) ?? store.readState(slug)?.current;
    runner.enqueue({ slug, trigger: "watch", text, ...(chat ? { chat } : {}) });
  }

  function chatExists(slug, id) {
    const state = store.readState(slug);
    return !!state && Array.isArray(state.chats) && state.chats.some((c) => c.id === id);
  }

  function wakeAll() {
    for (const slug of [...bundles.keys()]) wake(slug);
  }

  async function readPage(slug, url) {
    try {
      return String(await browsers.pageText(slug, url));
    } catch (e) {
      throw new Error(`Could not read ${url}: ${(e && e.message) || e}. Check the address, then add the watch again.`);
    }
  }

  async function checkPage(slug, id) {
    const w = find(slug, id);
    if (!w || w.kind !== "page") return;
    let text;
    try {
      text = await readPage(slug, w.url);
    } catch {
      // Not reachable this time: the next check tries again.
      arm(watchKey(slug, id), w.every * MINUTE_MS, () => checkPage(slug, id));
      return;
    }
    if (!find(slug, id)) return;
    const key = keyOf(slug, id);
    const prev = seen.get(key);
    seen.set(key, text);
    const lines = prev !== undefined && prev !== text ? diffLines(prev, text) : [];
    if (lines.length) fire(slug, id, `changed: ${lines.join(" / ")}`, (x) => (x.last = clip(text, SEEN_MAX)));
    else setLast(slug, id, text);
    arm(watchKey(slug, id), w.every * MINUTE_MS, () => checkPage(slug, id));
  }

  function timerFired(slug, id) {
    const w = find(slug, id);
    if (!w) return;
    fire(slug, id, w.every ? `It is time (every ${w.every} minutes).` : "It is time.");
    if (w.every) arm(watchKey(slug, id), w.every * MINUTE_MS, () => timerFired(slug, id));
  }

  /** A timer at its time; one that passed while Crew was closed goes off now, and a repeating one waits for its next slot. */
  function armTimer(slug, w) {
    const t = now().getTime();
    const due = Date.parse(w.at);
    let wait = due - t;
    if (w.every && t > due) {
      const step = w.every * MINUTE_MS;
      wait = (step - ((t - due) % step)) % step;
    }
    arm(watchKey(slug, w.id), Math.max(0, wait), () => timerFired(slug, w.id));
  }

  function armWatch(slug, w) {
    if (w.kind === "page") arm(watchKey(slug, w.id), w.every * MINUTE_MS, () => checkPage(slug, w.id));
    else if (w.kind === "timer") armTimer(slug, w);
    else if (w.kind === "notification") {
      // The site is heard only through an open tab: keep one open in the background.
      if (browsers.keepSite) Promise.resolve().then(() => browsers.keepSite(slug, w.origin)).catch(() => {});
    } else if (w.kind === "element") {
      // A failed arm keeps the watch saved; it is armed again the next time Crew starts.
      Promise.resolve()
        .then(() => browsers.armElement(slug, { id: w.id, origin: w.origin, url: w.url, selector: w.selector }))
        .catch(() => {});
    }
  }

  /** Validates, saves and arms a watch. Throws with what to fix. */
  async function add(slug, input) {
    const list = store.readWatches(slug);
    if (list.length >= WATCH_MAX) throw new Error(`A bot can hold ${WATCH_MAX} watches, and this one has ${list.length}. Remove one first (watch with action remove; list shows the ids).`);
    if (!WATCH_KINDS.includes(input.kind)) throw new Error(`The kind is one of ${WATCH_KINDS.join(", ")}, not "${clip(input.kind ?? "", 40)}".`);
    const note = noteArg(input.note);
    const id = freshId(list);
    const base = { id, kind: input.kind, note, created: iso(), fired: null, count: 0, ...(typeof input.chat === "string" && input.chat ? { chat: input.chat } : {}) };
    let w;
    if (input.kind === "notification") {
      w = { ...base, origin: siteOrigin(input.origin) };
      const match = matchArg(input.match);
      if (match) w.match = match;
    } else if (input.kind === "element") {
      if (input.selector !== undefined) throw new Error("Give the element by ref: the ref from your latest snapshot, like e12. Crew finds the element's selector itself.");
      if (typeof input.ref !== "string" || !/^e\d{1,6}$/.test(input.ref)) throw new Error('Give ref as the element\'s ref from your latest snapshot, like "e12".');
      const r = await browsers.watchElement(slug, { id, ref: input.ref });
      w = { ...base, origin: r.origin, url: r.url, selector: r.selector, last: clip(r.text, SEEN_MAX) };
      seen.set(keyOf(slug, id), String(r.text));
    } else if (input.kind === "page") {
      const url = webAddress(input.url, "A page watch");
      const every = everyArg(input.every, PAGE_EVERY_MIN, "A page watch");
      const text = await readPage(slug, url);
      w = { ...base, url, every, last: clip(text, SEEN_MAX) };
      seen.set(keyOf(slug, id), text);
    } else {
      w = { ...base, at: timerAt(input, now()) };
      if (given(input.every)) w.every = everyArg(input.every, 1, "A repeating timer");
    }
    if (store.readWatches(slug).length >= WATCH_MAX) {
      seen.delete(keyOf(slug, id));
      if (w.kind === "element") await unwatch(slug, id);
      throw new Error(`A bot can hold ${WATCH_MAX} watches. Remove one first (watch with action remove; list shows the ids).`);
    }
    store.writeWatches(slug, [...store.readWatches(slug), w]);
    armWatch(slug, w);
    changed(slug);
    return w;
  }

  async function remove(slug, id) {
    const list = store.readWatches(slug);
    const w = list.find((x) => x.id === id);
    if (!w) throw new Error(`No watch with id ${clip(String(id ?? ""), 40)}. Watches: ${list.map((x) => x.id).join(", ") || "none"}.`);
    disarm(watchKey(slug, id));
    seen.delete(keyOf(slug, id));
    if (w.kind === "element") await unwatch(slug, id);
    store.writeWatches(slug, list.filter((x) => x !== w));
    changed(slug);
    return store.readWatches(slug);
  }

  function addTodo(slug, text) {
    const t = typeof text === "string" ? text.trim() : "";
    if (!t) throw new Error(`Write the to-do in text, in 1 to ${TODO_TEXT_MAX} characters.`);
    if (t.length > TODO_TEXT_MAX) throw new Error(`The to-do is ${t.length} characters; the most is ${TODO_TEXT_MAX}. Shorten it.`);
    const list = store.readTodos(slug);
    if (list.length >= TODO_MAX) throw new Error(`A to-do list holds ${TODO_MAX} items, and this one has ${list.length}. Finish or remove some first.`);
    list.push({ id: freshId(list), text: t, done: false, created: iso() });
    store.writeTodos(slug, list);
    changed(slug);
    return list;
  }

  /** patch: { done: true | false } or { remove: true }. */
  function setTodo(slug, id, patch) {
    const list = store.readTodos(slug);
    const t = list.find((x) => x.id === id);
    if (!t) throw new Error(`No to-do with id ${clip(String(id ?? ""), 40)}. To-dos: ${list.map((x) => x.id).join(", ") || "none"}.`);
    let next;
    if (patch && patch.remove === true) next = list.filter((x) => x !== t);
    else if (patch && typeof patch.done === "boolean") {
      t.done = patch.done;
      next = list;
    } else throw new Error("Say what to change: done (true or false), or remove.");
    store.writeTodos(slug, next);
    changed(slug);
    return next;
  }

  function onNotification(slug, n) {
    const hay = `${n.title ?? ""}\n${n.body ?? ""}`.toLowerCase();
    for (const w of store.readWatches(slug)) {
      if (w.kind !== "notification" || w.origin !== n.origin) continue;
      if (w.match && !hay.includes(w.match.toLowerCase())) continue;
      const title = String(n.title ?? "").trim() || "Notification";
      const body = String(n.body ?? "").trim();
      fire(slug, w.id, body ? `${title}: ${body}` : title);
    }
  }

  /** A tab's title gained an unread count: a notification watch on its site fires, unless it fired in the last 10 seconds. */
  function onTitleCount(slug, { origin, title, count }) {
    const hay = String(title ?? "").toLowerCase();
    for (const w of store.readWatches(slug)) {
      if (w.kind !== "notification" || w.origin !== origin) continue;
      if (w.match && !hay.includes(w.match.toLowerCase())) continue;
      if (w.fired && now().getTime() - Date.parse(w.fired) < TITLE_SKIP_MS) continue;
      fire(slug, w.id, `New activity: the tab's title is now "${title}".`);
    }
  }

  function onElementChange(slug, id, text) {
    const w = find(slug, id);
    if (!w || w.kind !== "element") return;
    const key = keyOf(slug, id);
    const latest = String(text ?? "");
    const prev = seen.has(key) ? seen.get(key) : (w.last ?? "");
    seen.set(key, latest);
    if (prev === latest) return;
    fire(slug, id, `changed from "${clip(prev, 200)}" to "${clip(latest, 300)}"`, (x) => (x.last = clip(latest, SEEN_MAX)));
  }

  function forget(slug) {
    for (const w of store.readWatches(slug)) {
      disarm(watchKey(slug, w.id));
      seen.delete(keyOf(slug, w.id));
      if (w.kind === "element") void unwatch(slug, w.id);
    }
    disarm(bundleKey(slug));
    bundles.delete(slug);
    wakes.delete(slug);
  }

  return {
    /** Arms every bot's element, page and timer watches. */
    start() {
      for (const slug of store.slugs()) for (const w of store.readWatches(slug)) armWatch(slug, w);
    },

    stop() {
      for (const h of timers.values()) clearTimeout(h.t);
      timers.clear();
      bundles.clear();
      seen.clear();
    },

    /** A bot's run ended: a bot that was busy may be woken now. */
    runEnded() {
      arm("wakeall", 0, wakeAll);
    },

    /** The bot's browser was closed: open again the tabs its notification and element watches listen through. */
    rearm(slug) {
      for (const w of store.readWatches(slug)) if (w.kind === "notification" || w.kind === "element") armWatch(slug, w);
    },

    forget,
    /** The bot's watches; a notification or element watch says whether its site is open to hear it. */
    list: (slug) => store.readWatches(slug).map((w) => (w.kind === "notification" || w.kind === "element") && browsers.hasSite ? { ...w, listening: browsers.hasSite(slug, w.origin) } : w),
    todos: (slug) => store.readTodos(slug),
    add,
    remove,
    addTodo,
    setTodo,
    onNotification,
    onTitleCount,
    onElementChange,
  };
}

module.exports = { createWatches, watchLine, todoLine };
