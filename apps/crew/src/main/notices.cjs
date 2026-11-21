// The bot's notification center: what its computer told the person while they
// were not looking. Site notifications, finished downloads, ended runs, fired
// watches and reminders are kept per bot, newest first, at most 100. The list
// lives in the bot's folder (notices.json) and is written a moment after each
// change, so a burst of events costs one write. The page reads it through
// crew:notices and is told when it changes (crew:notices event).

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const F = require("./format.cjs");

const KINDS = ["site", "download", "run", "watch", "reminder", "account"];
const MAX = 100;
const SAVE_MS = 300;
const TITLE_MAX = 200;
const BODY_MAX = 1000;
const ORIGIN_MAX = 300;
const PATH_MAX = 500;
const NOTE_MAX = 300;
const DEFAULT_TITLE = { site: "Notification", download: "Download", run: "Run", watch: "Watch", reminder: "Reminder", account: "Google account" };

const clip = (s, n) => {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function readList(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    const items = Array.isArray(v && v.items) ? v.items.filter((n) => n && typeof n === "object" && KINDS.includes(n.kind)).slice(0, MAX) : [];
    const unread = Number.isInteger(v && v.unread) ? Math.max(0, Math.min(v.unread, items.length)) : 0;
    return { items, unread };
  } catch {
    return { items: [], unread: 0 };
  }
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/**
 * @param {object} o
 * @param {(slug: string) => string} o.botDir  the bot's folder (store.botDir)
 * @param {(channel: string, payload: unknown) => void} [o.broadcast]
 * @param {() => Date} [o.now]
 */
function createNotices({ botDir, broadcast = () => {}, now = () => new Date() }) {
  /** slug → { items (newest first), unread } */
  const lists = new Map();
  /** slugs with a change not yet written. */
  const dirty = new Set();
  let timer = null;

  const fileOf = (slug) => path.join(botDir(slug), "notices.json");

  function load(slug) {
    let l = lists.get(slug);
    if (!l) lists.set(slug, (l = readList(fileOf(slug))));
    return l;
  }

  function write(slug) {
    const l = lists.get(slug);
    if (!l) return;
    if (!fs.existsSync(botDir(slug))) return;
    writeAtomic(fileOf(slug), `${JSON.stringify(l, null, 2)}\n`);
  }

  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    for (const slug of dirty) {
      try {
        write(slug);
      } catch {
        // The bot's folder may be going away; the list is still in memory.
      }
    }
    dirty.clear();
  }

  function changed(slug) {
    dirty.add(slug);
    if (!timer) {
      timer = setTimeout(flush, SAVE_MS);
      if (timer && timer.unref) timer.unref();
    }
    broadcast("crew:notices", { slug });
  }

  const state = (slug) => {
    const l = load(slug);
    return { items: l.items.slice(), unread: l.unread };
  };

  return {
    /** Keeps one notice for the bot. kind is one of KINDS; a missing title gets the kind's name. */
    add(slug, notice) {
      if (!notice || !KINDS.includes(notice.kind)) throw new Error(`A notice's kind is one of ${KINDS.join(", ")}.`);
      const title = clip(String(notice.title ?? "").trim(), TITLE_MAX) || DEFAULT_TITLE[notice.kind];
      const at = typeof notice.at === "string" && !Number.isNaN(Date.parse(notice.at)) ? new Date(notice.at).toISOString() : now().toISOString();
      const item = { id: crypto.randomBytes(6).toString("hex"), at, kind: notice.kind, title, body: clip(String(notice.body ?? "").trim(), BODY_MAX) };
      if (notice.origin) item.origin = clip(notice.origin, ORIGIN_MAX);
      if (notice.path) item.path = clip(notice.path, PATH_MAX);
      const l = load(slug);
      l.items.unshift(item);
      if (l.items.length > MAX) l.items.length = MAX;
      l.unread = Math.min(l.unread + 1, l.items.length);
      changed(slug);
      return item;
    },

    /** The notices, newest first. */
    list: (slug) => state(slug).items,

    /** The notices and how many of them the person has not seen. */
    state,

    clear(slug) {
      const l = load(slug);
      l.items = [];
      l.unread = 0;
      changed(slug);
      return state(slug);
    },

    /** The person opened the center: everything is read. */
    markRead(slug) {
      const l = load(slug);
      if (l.unread === 0) return state(slug);
      l.unread = 0;
      changed(slug);
      return state(slug);
    },

    /** Writes what is waiting now (Crew is quitting). */
    flush,
  };
}

/**
 * The page's calls about notices and reminders (src/shared/contract.ts). The
 * caller passes the notices object from createNotices, which it also feeds.
 * @param {object} o
 * @param {Electron.IpcMain} o.ipcMain
 * @param {(e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => void} o.assertSender
 * @param {ReturnType<import("./store.cjs").createStore>} o.store
 * @param {ReturnType<import("./watches.cjs").createWatches>} o.watches
 * @param {ReturnType<typeof createNotices>} o.notices
 */
function registerNoticesIpc({ ipcMain, assertSender, store, watches, notices }) {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (e, ...args) => {
      assertSender(e);
      return fn(...args);
    });
  const slugArg = (v) => {
    if (!F.isSlug(v) || !store.readBot(v)) throw new Error(`"${String(v).slice(0, 60)}" is not a bot's folder name.`);
    return v;
  };

  handle("crew:notices", (slug) => notices.state(slugArg(slug)));
  handle("crew:clearNotices", (slug) => notices.clear(slugArg(slug)));
  handle("crew:readNotices", (slug) => notices.markRead(slugArg(slug)));

  handle("crew:addReminder", (slug, input) => {
    const s = slugArg(slug);
    if (!input || typeof input !== "object") throw new Error('Send the reminder as { at, note }, like { at: "2026-11-20T09:00:00", note: "Call Sam" }.');
    const note = typeof input.note === "string" ? input.note.trim() : "";
    if (!note) throw new Error("Write what to remind the bot about, in 1 to 300 characters.");
    if (note.length > NOTE_MAX) throw new Error(`The note is ${note.length} characters; the most is ${NOTE_MAX}. Shorten it.`);
    if (typeof input.at !== "string" || Number.isNaN(Date.parse(input.at))) throw new Error('Pick a time for the reminder, like "2026-11-20T09:00".');
    // A reminder is a one-time timer watch: the note is the person's words.
    return watches.add(s, { kind: "timer", at: new Date(input.at).toISOString(), note });
  });

  return notices;
}

module.exports = { createNotices, registerNoticesIpc, NOTICE_KINDS: KINDS, NOTICE_MAX: MAX };
