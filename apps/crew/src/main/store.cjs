// The crew on disk, under <userData>/Crew:
//
//   bots/<slug>/bot.md        settings and how it works
//   bots/<slug>/memory.md     what it remembers (appended by `remember`)
//   bots/<slug>/state.json    sessions, mood, status, last runs
//   bots/<slug>/library/      the Fenna documents it makes
//   bots/<slug>/watches.json  what it waits for (watches.cjs)
//   bots/<slug>/todos.json    its to-do list
//   bots/<slug>/runs/*.jsonl  every event of every run
//   teams/<slug>/team.md      a team's lead and members
//   teams/<slug>/thread.jsonl the team's conversation
//
// Every write goes to a temp file first and is renamed into place, so a
// crash never leaves half a file. Nothing here knows about Electron.

const fs = require("node:fs");
const path = require("node:path");
const F = require("./format.cjs");

const MAX_RUN_FILES_LISTED = 2000;

// The desktop's names and limits, restated from apps/crew/src/shared/contract.ts
// (DESKTOP_APPS, DESKTOP_MAX, SHORTCUT_LABEL_MAX). This file can't import the
// .ts contract, so keep these in step with it.
const DESKTOP_APPS = ["browser", "files", "library", "terminal", "activity", "clock", "connectors", "trash", "code", "processes", "console"];
const DESKTOP_LABELS = { library: "Documents" };
const DESKTOP_MAX = 48;
const SHORTCUT_LABEL_MAX = 40;
const SHORTCUT_ID = /^[a-z0-9-]{1,40}$/;
const APP_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const LIBRARY_FILE = /^[\w.-]{1,80}$/;

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Errors from a list of diagnostics, as one message that says what to fix. */
/** `rel` resolved under `dir`; refuses anything that leaves it, sibling folders with the same prefix included. */
function inside(dir, rel) {
  const target = path.resolve(dir, rel);
  const back = path.relative(dir, target);
  if (!back || back.startsWith("..") || path.isAbsolute(back)) throw new Error("That file is outside the bot's workspace.");
  return target;
}

const LIBRARY_TEXT_CAP = 200 * 1024;

/** A page's text with its markup removed: deleted text dropped, blocks on their own lines, entities decoded. */
function plainText(html) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html
    .replace(/<(script|style|del)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|h[1-6]|li|tr|div|article|section|blockquote|pre)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
      }
      return entities[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** "3 slides", "1 sheet": a count with its noun. */
function count(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function problemText(diagnostics) {
  return diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
    .join(" ");
}

/** "Research copy", or "Research copy 2" when that name is taken (any case); kept within the name limit. */
function copyName(name, taken) {
  const used = new Set([...taken].map((n) => String(n).trim().toLowerCase()));
  for (let n = 1; ; n++) {
    const tail = n === 1 ? " copy" : ` copy ${n}`;
    const candidate = `${String(name).trim().slice(0, F.LIMITS.name - tail.length).trim()}${tail}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** A file name for the chat export: "<Name> chat.md" without what a file name can't hold. */
function chatFileName(name) {
  const clean = String(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return `${clean || "Bot"} chat.md`;
}

const TRIGGER_TITLE = { person: "You asked", schedule: "Schedule", bot: "Another bot", welcome: "Welcome", app: "An app" };
const pad = (n) => String(n).padStart(2, "0");
const stamp = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * The transcript as Markdown: a heading per run (date and trigger), the
 * person's words as "**You:**", the bot's replies as "**<name>:**", and its
 * steps as bullet lines.
 * @param {string} name
 * @param {{ file: string, events: object[] }[]} runs  oldest first
 */
function chatMarkdown(name, runs) {
  const out = [`# ${name} chat`, ""];
  if (!runs.length) out.push("Nothing said yet.", "");
  for (const run of runs) {
    const start = run.events.find((e) => e.type === "start");
    const at = stamp((start || run.events[0] || {}).at);
    out.push(`## ${at ? `${at} · ` : ""}${start ? TRIGGER_TITLE[start.trigger] || "Run" : "Run"}`, "");
    const steps = new Map();
    const flush = () => {
      if (steps.size) out.push(...[...steps.values()].map((l) => `- ${l}`), "");
      steps.clear();
    };
    if (start && start.text && start.trigger === "person") out.push(`**You:** ${start.text}`, "");
    for (const e of run.events) {
      if (e.type === "tool") {
        steps.set(e.id, String(e.label).replace(/\s+/g, " ").trim() + (e.status === "failed" ? " (failed)" : ""));
      } else if (e.type === "text" && String(e.text).trim()) {
        flush();
        out.push(`**${name}:** ${String(e.text).trim()}`, "");
      }
    }
    flush();
  }
  return `${out.join("\n").trimEnd()}\n`;
}

/** Built-in windows added after desktops were first saved; each is put on a saved desktop once, so removing it later sticks. */
const LATER_APPS = ["code", "processes", "console"];

/** The desktop a bot starts with: its built-in windows, then one shortcut per Fenna app it is given. */
function defaultDesktop(bot) {
  const windows = DESKTOP_APPS.map((app) => ({ id: app, kind: "app", app, label: DESKTOP_LABELS[app] || app[0].toUpperCase() + app.slice(1) }));
  const fenna = (bot ? bot.connectors : [])
    .filter((c) => c.type === "fenna")
    .map((c) => ({ id: c.app, kind: "fenna", app: c.app, label: F.FENNA_APPS.find((a) => a.id === c.app).name }));
  return [...windows, ...fenna];
}

/** A shortcut's grid cell, kept when it is a whole cell on the desktop grid (0 to 40 each way); anything else is dropped and the icon fills a free cell. */
function withPos(shortcut, pos) {
  const cell = (v) => Number.isInteger(v) && v >= 0 && v <= 40;
  if (!pos || typeof pos !== "object" || !cell(pos.col) || !cell(pos.row)) return shortcut;
  return { ...shortcut, pos: { col: pos.col, row: pos.row } };
}

/** The shortcuts as they are kept, each checked and rebuilt with only its own fields. Throws with the first problem and how to fix it. */
function checkDesktop(items) {
  if (!Array.isArray(items)) throw new Error("The desktop should be a list of shortcuts.");
  if (items.length > DESKTOP_MAX) throw new Error(`A desktop holds at most ${DESKTOP_MAX} shortcuts; this one has ${items.length}. Remove some first.`);
  const ids = new Set();
  return items.map((item, i) => {
    const at = `Shortcut ${i + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${at} is not a shortcut.`);
    const { id } = item;
    if (typeof id !== "string" || !SHORTCUT_ID.test(id)) throw new Error(`${at} has the id "${String(id).slice(0, 60)}". Ids use lowercase letters, digits and dashes, at most 40 characters.`);
    if (ids.has(id)) throw new Error(`Two shortcuts have the id "${id}". Give each one its own id.`);
    ids.add(id);
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!label) throw new Error(`${at} needs a label.`);
    if (label.length > SHORTCUT_LABEL_MAX) throw new Error(`${at}'s label is ${label.length} characters; the most is ${SHORTCUT_LABEL_MAX}.`);
    if (item.kind === "app") {
      if (!DESKTOP_APPS.includes(item.app)) throw new Error(`${at} opens "${String(item.app).slice(0, 40)}", which is not a built-in window. Use one of: ${DESKTOP_APPS.join(", ")}.`);
      return withPos({ id, kind: "app", app: item.app, label }, item.pos);
    }
    if (item.kind === "fenna") {
      const known = F.FENNA_APPS.map((a) => a.id);
      if (!known.includes(item.app)) throw new Error(`${at} opens "${String(item.app).slice(0, 40)}", which is not a Fenna app. Use one of: ${known.join(", ")}.`);
      return withPos({ id, kind: "fenna", app: item.app, label }, item.pos);
    }
    if (item.kind === "web") {
      let url;
      try {
        url = new URL(String(item.url));
      } catch {
        throw new Error(`${at} has the address "${String(item.url).slice(0, 200)}", which is not a web address. Write it in full, like https://example.com.`);
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${at} must open an http or https address, not ${url.protocol}`);
      return withPos({ id, kind: "web", url: url.href, label }, item.pos);
    }
    if (item.kind === "doc") {
      if (typeof item.path !== "string" || !LIBRARY_FILE.test(item.path) || item.path.startsWith(".")) {
        throw new Error(`${at} points at "${String(item.path).slice(0, 80)}", which is not a library file name. Use the path new_document gave.`);
      }
      return withPos({ id, kind: "doc", path: item.path, label }, item.pos);
    }
    if (item.kind === "userapp") {
      if (typeof item.app !== "string" || !APP_NAME.test(item.app)) {
        throw new Error(`${at} opens the app "${String(item.app).slice(0, 40)}", which is not an app name. App names are lowercase letters, digits and dashes, starting with a letter.`);
      }
      return withPos({ id, kind: "userapp", app: item.app, label }, item.pos);
    }
    throw new Error(`${at} has the kind "${String(item.kind).slice(0, 40)}". Kinds are app, fenna, web, doc and userapp.`);
  });
}

/**
 * @param {string} root  the Crew folder
 * @param {object} [opts]
 * @param {(dir: string) => Promise<void>} [opts.trash]  how to delete a folder (the system trash in the app)
 * @param {(slug: string, legacy: object[]) => Record<string, string>} [opts.migrate]
 *   installs connectors an older bot.md holds whole on this computer; returns old name → installed name
 */
function createStore(root, { trash, migrate } = {}) {
  const botsDir = path.join(root, "bots");
  const teamsDir = path.join(root, "teams");
  const botDir = (slug) => {
    if (!F.isSlug(slug)) throw new Error(`"${String(slug).slice(0, 60)}" is not a bot folder name.`);
    return path.join(botsDir, slug);
  };
  const teamDir = (slug) => {
    if (!F.isSlug(slug)) throw new Error(`"${String(slug).slice(0, 60)}" is not a team folder name.`);
    return path.join(teamsDir, slug);
  };
  const removeDir = async (dir) => {
    if (trash) await trash(dir);
    else fs.rmSync(dir, { recursive: true, force: true });
  };

  /** A saved desktop with any LATER_APPS it has never been given, added once (desktop-added.json remembers which). */
  const withNewApps = (slug, items) => {
    const addedFile = path.join(botDir(slug), "desktop-added.json");
    const added = readJson(addedFile);
    const given = Array.isArray(added) ? added : [];
    const missing = LATER_APPS.filter((app) => !given.includes(app) && !items.some((i) => i.kind === "app" && i.app === app));
    if (!LATER_APPS.some((app) => !given.includes(app))) return items;
    const next = [...items, ...missing.map((app) => ({ id: app, kind: "app", app, label: DESKTOP_LABELS[app] || app[0].toUpperCase() + app.slice(1) }))].slice(0, DESKTOP_MAX);
    try {
      writeAtomic(path.join(botDir(slug), "desktop.json"), `${JSON.stringify(next, null, 2)}\n`);
      writeAtomic(addedFile, `${JSON.stringify(LATER_APPS)}\n`);
    } catch {
      /* read-only disk: show them this time, try again next time */
    }
    return next;
  };

  /** A new bot folder with its bot.md, memory and empty state; returns the slug. */
  const makeFolder = (bot, memory) => {
    store.ensure();
    const slug = F.uniqueSlug(bot.name, subdirs(botsDir));
    const dir = path.join(botsDir, slug);
    fs.mkdirSync(path.join(dir, "library"), { recursive: true });
    fs.mkdirSync(path.join(dir, "workspace"), { recursive: true });
    fs.mkdirSync(path.join(dir, "runs"), { recursive: true });
    writeAtomic(path.join(dir, "memory.md"), memory);
    writeAtomic(path.join(dir, "state.json"), F.serializeState(F.emptyState()));
    store.writeBot(slug, bot);
    return slug;
  };

  const store = {
    root,
    botsDir,
    teamsDir,
    botDir,

    ensure() {
      fs.mkdirSync(botsDir, { recursive: true });
      fs.mkdirSync(teamsDir, { recursive: true });
    },

    /** Bot folder names, sorted. Folders without a bot.md, or with a name that isn't a slug, are left out. */
    slugs() {
      return subdirs(botsDir)
        .filter((n) => F.isSlug(n) && fs.existsSync(path.join(botsDir, n, "bot.md")))
        .sort();
    },

    /**
     * A bot.md with connectors written the older way (a whole command or
     * url) has them moved to this computer's connectors and is rewritten
     * with grants, once. If that can't be done the file is left as it is and
     * a warning says why; the app won't change it until then.
     * @returns {{ slug: string, bot: import("@opendeck/crew").Bot | null, diagnostics: import("@opendeck/crew").Diagnostic[], unmoved: string | null } | null}
     */
    readBot(slug) {
      const text = readText(path.join(botDir(slug), "bot.md"));
      if (text === null) return null;
      const r = F.parseBot(text);
      let unmoved = null;
      if (r.legacy.length && r.bot) {
        const errors = problemText(r.diagnostics);
        try {
          if (errors) throw new Error(`fix bot.md first: ${errors}`);
          if (!migrate) throw new Error("connectors can only be installed from the app.");
          const names = migrate(slug, r.legacy);
          r.bot.connectors = r.bot.connectors.map((c) => (c.type === "grant" && names[c.name] ? { ...c, name: names[c.name] } : c));
          store.writeBot(slug, r.bot);
        } catch (e) {
          unmoved = `bot.md holds the connectors ${r.legacy.map((l) => l.name).join(", ")} the older way, and they couldn't be moved to this computer's connectors: ${e.message}`;
          r.diagnostics.push({ severity: "warning", message: unmoved });
        }
      }
      return { slug, bot: r.bot, diagnostics: r.diagnostics, unmoved };
    },

    writeBot(slug, bot) {
      writeAtomic(path.join(botDir(slug), "bot.md"), F.serializeBot(bot));
    },

    /** Make a bot folder from what the person (or a bot) said. Throws with what to fix. */
    createBot(input) {
      const used = store.slugs().map((s) => store.readBot(s)).filter((b) => b && b.bot).map((b) => b.bot);
      const look = F.pickAvatar(String(input.name ?? "").trim(), used);
      const r = F.newBot({ ...input, avatar: input.avatar || look.avatar, color: input.color || look.color });
      const errors = problemText(r.diagnostics);
      if (errors) throw new Error(errors);
      return makeFolder(r.bot, "");
    },

    /**
     * A copy of a bot: "<Name> copy", the same settings and memory, a face no
     * other bot has while one is free; no runs, library or state. Returns its slug.
     */
    duplicateBot(slug) {
      const cur = store.readBot(slug);
      if (!cur || !cur.bot) throw new Error(`There is no bot "${slug}" to duplicate.`);
      if (cur.unmoved) throw new Error(`${cur.unmoved} Fix that first, so they aren't lost.`);
      const others = store.slugs().map((s) => store.readBot(s)).filter((b) => b && b.bot).map((b) => b.bot);
      const name = copyName(cur.bot.name, others.map((b) => b.name));
      const look = F.pickAvatar(name, others);
      const r = F.checkBot({ ...cur.bot, name, avatar: look.avatar, color: look.color });
      const errors = problemText(r.diagnostics);
      if (errors) throw new Error(errors);
      return makeFolder(r.bot, store.readMemory(slug));
    },

    /** Change some settings; the result must pass the same checks as a file. */
    updateBot(slug, patch) {
      const cur = store.readBot(slug);
      if (!cur || !cur.bot) throw new Error(`There is no bot "${slug}" to change.`);
      if (cur.unmoved) throw new Error(`${cur.unmoved} Fix that first, so they aren't lost.`);
      const next = { ...cur.bot };
      for (const k of [...F.BOT_KEYS, "how"]) if (patch && patch[k] !== undefined) next[k] = patch[k];
      if (patch && patch.brain) next.brain = { ...cur.bot.brain, ...patch.brain };
      if (typeof next.schedule === "string") {
        const s = F.parseSchedule(next.schedule);
        if (!("error" in s)) next.schedule = F.formatSchedule(s.schedule);
      }
      const r = F.checkBot(next);
      const errors = problemText(r.diagnostics);
      if (errors) throw new Error(errors);
      store.writeBot(slug, r.bot);
      return r.bot;
    },

    async deleteBot(slug) {
      const dir = botDir(slug);
      if (!fs.existsSync(dir)) throw new Error(`There is no bot "${slug}".`);
      await removeDir(dir);
    },

    readState(slug) {
      return F.parseState(readText(path.join(botDir(slug), "state.json"))).state;
    },

    /** Change the state with fn(state) and write it back. */
    patchState(slug, fn) {
      const s = store.readState(slug);
      fn(s);
      writeAtomic(path.join(botDir(slug), "state.json"), F.serializeState(s));
      return s;
    },

    readMemory(slug) {
      return readText(path.join(botDir(slug), "memory.md")) || "";
    },

    /** Add a line dated on the local calendar to memory.md; the oldest lines go when it passes its limit. */
    appendMemory(slug, note, now = new Date()) {
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const line = `- ${day}: ${String(note).replace(/\s*\n\s*/g, " ").trim()}\n`;
      let text = store.readMemory(slug);
      if (text && !text.endsWith("\n")) text += "\n";
      text += line;
      if (text.length > F.LIMITS.memory) {
        const cut = text.indexOf("\n", text.length - F.LIMITS.memory);
        text = text.slice(cut + 1);
      }
      writeAtomic(path.join(botDir(slug), "memory.md"), text);
    },

    /** The documents in the bot's library, newest first. */
    library(slug) {
      const lib = path.join(botDir(slug), "library");
      const out = [];
      for (const name of subdirs(lib)) {
        if (name.startsWith(".")) continue;
        const app = F.FENNA_APPS.find((a) => fs.existsSync(path.join(lib, name, a.marker)));
        if (!app) continue;
        const marker = path.join(lib, name, app.marker);
        let title = name;
        try {
          const t = JSON.parse(fs.readFileSync(marker, "utf8")).title;
          if (typeof t === "string" && t.trim()) title = t.trim();
        } catch {
          /* titled after its folder */
        }
        let edited = 0;
        for (const f of [marker, ...listFiles(path.join(lib, name), 2)]) {
          try {
            edited = Math.max(edited, fs.statSync(f).mtimeMs);
          } catch {
            /* gone */
          }
        }
        out.push({ path: name, kind: app.kind, title, edited: new Date(edited).toISOString() });
      }
      return out.sort((a, b) => b.edited.localeCompare(a.edited));
    },

    /** A library item as plain text for a read-only preview, with a one-line summary; text is capped at 200 KB. */
    libraryText(slug, id) {
      if (typeof id !== "string" || !/^[\w.-]{1,80}$/.test(id) || id.startsWith(".")) throw new Error("That is not a file in the library.");
      const lib = path.join(botDir(slug), "library");
      const dir = inside(lib, id);
      const app = F.FENNA_APPS.find((a) => fs.existsSync(path.join(dir, a.marker)));
      if (!app) throw new Error("That is not a file in the library.");
      const meta = readJson(path.join(dir, app.marker)) ?? {};
      const safeId = (t) => t && /^[\w.-]{1,80}$/.test(String(t.id));
      if (app.kind === "doc") {
        const tabs = Array.isArray(meta.tabs) ? meta.tabs.filter(safeId) : [];
        let text = "";
        for (const t of tabs) {
          let html = "";
          try {
            html = fs.readFileSync(path.join(dir, "tabs", `${t.id}.html`), "utf8").slice(0, LIBRARY_TEXT_CAP);
          } catch {
            /* an empty tab */
          }
          text += `${text ? "\n\n\n" : ""}${t.title || t.id}\n\n${plainText(html)}`;
          if (text.length > LIBRARY_TEXT_CAP) break;
        }
        return { text: text.slice(0, LIBRARY_TEXT_CAP), summary: count(tabs.length, "tab"), truncated: text.length > LIBRARY_TEXT_CAP };
      }
      if (app.kind === "sheet") {
        const sheets = Array.isArray(meta.sheets) ? meta.sheets.filter(safeId) : [];
        const lines = sheets.map((t) => {
          const cells = readJson(path.join(dir, "sheets", `${t.id}.json`))?.cells;
          let rows = 0;
          let cols = 0;
          for (const ref of Object.keys(cells && typeof cells === "object" ? cells : {})) {
            const m = /^([A-Z]+)(\d+)$/.exec(ref);
            if (!m) continue;
            rows = Math.max(rows, Number(m[2]));
            cols = Math.max(cols, [...m[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0));
          }
          return `${t.title || t.id}: ${count(rows, "row")}, ${count(cols, "column")}`;
        });
        return { text: lines.join("\n"), summary: count(sheets.length, "sheet"), truncated: false };
      }
      if (app.kind === "board") {
        // A whiteboard is shapes on a canvas, not text: a count is all a bot can read of it.
        const items = readJson(path.join(dir, "canvas.json"))?.items;
        return { text: "", summary: `Whiteboard, ${count(Array.isArray(items) ? items.length : 0, "item")}`, truncated: false };
      }
      if (app.kind === "design") {
        const order = Array.isArray(meta.order) ? meta.order.filter((file) => /^[\w.-]{1,80}\.html$/.test(String(file))) : [];
        let text = "";
        for (const file of order) {
          let html = "";
          try {
            html = fs.readFileSync(path.join(dir, "artboards", file), "utf8").slice(0, LIBRARY_TEXT_CAP);
          } catch {
            /* an empty artboard */
          }
          const title = meta.boards?.[file]?.title || file;
          text += `${text ? "\n\n\n" : ""}${title}\n\n${plainText(html)}`;
          if (text.length > LIBRARY_TEXT_CAP) break;
        }
        return { text: text.slice(0, LIBRARY_TEXT_CAP), summary: `Design, ${count(order.length, "artboard")}`, truncated: text.length > LIBRARY_TEXT_CAP };
      }
      const slides = Array.isArray(meta.slides) ? meta.slides : [];
      return { text: "", summary: count(slides.length, "slide"), truncated: false };
    },

    /** The bot's desktop shortcuts in grid order. A missing or broken desktop.json gives the default desktop. */
    readDesktop(slug) {
      const saved = readJson(path.join(botDir(slug), "desktop.json"));
      if (Array.isArray(saved)) {
        let items;
        try {
          items = checkDesktop(saved);
        } catch {
          /* broken: the default desktop below */
        }
        if (items) return withNewApps(slug, items);
      }
      return defaultDesktop(store.readBot(slug)?.bot ?? null);
    },

    /** Replace the bot's desktop with items, checked first; returns what was saved. Throws with what to fix. */
    writeDesktop(slug, items) {
      if (!fs.existsSync(path.join(botDir(slug), "bot.md"))) throw new Error(`There is no bot "${slug}".`);
      const next = checkDesktop(items);
      writeAtomic(path.join(botDir(slug), "desktop.json"), `${JSON.stringify(next, null, 2)}\n`);
      // A desktop saved now already shows the built-ins it wants; later ones are never added back.
      writeAtomic(path.join(botDir(slug), "desktop-added.json"), `${JSON.stringify(LATER_APPS)}\n`);
      return next;
    },

    /** The bot's watches (watches.json); none when the file is missing or broken. */
    readWatches(slug) {
      const v = readJson(path.join(botDir(slug), "watches.json"));
      return Array.isArray(v) ? v : [];
    },

    writeWatches(slug, list) {
      writeAtomic(path.join(botDir(slug), "watches.json"), `${JSON.stringify(list, null, 2)}\n`);
    },

    /** The bot's to-do list (todos.json); none when the file is missing or broken. */
    readTodos(slug) {
      const v = readJson(path.join(botDir(slug), "todos.json"));
      return Array.isArray(v) ? v : [];
    },

    writeTodos(slug, list) {
      writeAtomic(path.join(botDir(slug), "todos.json"), `${JSON.stringify(list, null, 2)}\n`);
    },

    /** The isolated workspace directory on disk for a bot. */
    workspaceDir(slug) {
      const dir = path.join(botDir(slug), "workspace");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    },

    /** List files in the bot's workspace directory. */
    workspaceFiles(slug) {
      const ws = store.workspaceDir(slug);
      const out = [];
      const scan = (currentDir, relDir = "") => {
        try {
          const entries = fs.readdirSync(currentDir, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.name.startsWith(".")) continue;
            const full = path.join(currentDir, ent.name);
            const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
            if (ent.isDirectory()) {
              out.push({ name: ent.name, path: rel, isDir: true, size: 0, edited: new Date(fs.statSync(full).mtimeMs).toISOString() });
              scan(full, rel);
            } else if (ent.isFile()) {
              const st = fs.statSync(full);
              out.push({ name: ent.name, path: rel, isDir: false, size: st.size, edited: new Date(st.mtimeMs).toISOString() });
            }
          }
        } catch {}
      };
      scan(ws);
      return out;
    },

    readWorkspaceFile(slug, relPath) {
      const ws = store.workspaceDir(slug);
      const target = inside(ws, relPath);
      return fs.readFileSync(target, "utf8");
    },

    writeWorkspaceFile(slug, relPath, content) {
      const ws = store.workspaceDir(slug);
      const target = inside(ws, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
      return { path: relPath, size: Buffer.byteLength(content, "utf8"), edited: new Date().toISOString() };
    },

    /** Run file names, newest first. */
    runFiles(slug) {
      let names = [];
      try {
        names = fs.readdirSync(path.join(botDir(slug), "runs"));
      } catch {
        return [];
      }
      return names
        .filter((n) => F.runFileDate(n))
        .sort()
        .reverse()
        .slice(0, MAX_RUN_FILES_LISTED);
    },

    /** Every run of the bot, oldest first, each with its events. */
    allRuns(slug) {
      return store
        .runFiles(slug)
        .reverse()
        .map((file) => ({ file, events: store.readRun(slug, file) }));
    },

    readRun(slug, file) {
      if (!F.runFileDate(file)) throw new Error(`"${file}" is not a run file.`);
      return F.parseRunLog(readText(path.join(botDir(slug), "runs", file)) || "").events;
    },

    hasRun(slug, file) {
      return fs.existsSync(path.join(botDir(slug), "runs", file));
    },

    appendRun(slug, file, event) {
      const dir = path.join(botDir(slug), "runs");
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, file), F.runLine(event));
    },

    // ── Teams ──

    teamSlugs() {
      return subdirs(teamsDir)
        .filter((n) => F.isSlug(n) && fs.existsSync(path.join(teamsDir, n, "team.md")))
        .sort();
    },

    readTeam(slug) {
      const text = readText(path.join(teamDir(slug), "team.md"));
      if (text === null) return null;
      const r = F.parseTeam(text, store.slugs());
      return { slug, team: r.team, diagnostics: r.diagnostics };
    },

    createTeam(team) {
      const r = F.checkTeam(team, store.slugs());
      const errors = problemText(r.diagnostics);
      if (errors) throw new Error(errors);
      store.ensure();
      const slug = F.uniqueSlug(r.team.name, subdirs(teamsDir));
      writeAtomic(path.join(teamsDir, slug, "team.md"), F.serializeTeam(r.team));
      return slug;
    },

    updateTeam(slug, patch) {
      const cur = store.readTeam(slug);
      if (!cur || !cur.team) throw new Error(`There is no team "${slug}".`);
      const next = { ...cur.team };
      for (const k of ["name", "lead", "members", "purpose"]) if (patch && patch[k] !== undefined) next[k] = patch[k];
      const r = F.checkTeam(next, store.slugs());
      const errors = problemText(r.diagnostics);
      if (errors) throw new Error(errors);
      writeAtomic(path.join(teamDir(slug), "team.md"), F.serializeTeam(r.team));
      return r.team;
    },

    async deleteTeam(slug) {
      const dir = teamDir(slug);
      if (!fs.existsSync(dir)) throw new Error(`There is no team "${slug}".`);
      await removeDir(dir);
    },

    appendThread(slug, message) {
      fs.appendFileSync(path.join(teamDir(slug), "thread.jsonl"), JSON.stringify(message) + "\n");
    },

    readThread(slug) {
      return F.parseThread(readText(path.join(teamDir(slug), "thread.jsonl")) || "");
    },
  };
  return store;
}

function listFiles(dir, depth) {
  const out = [];
  if (depth < 0) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile()) out.push(full);
    else if (e.isDirectory()) out.push(...listFiles(full, depth - 1));
  }
  return out;
}

module.exports = { createStore, chatMarkdown, chatFileName, copyName };
