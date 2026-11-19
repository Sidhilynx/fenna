// The Fenna editors (Docs, Sheets, Slides, Whiteboard, Design) inside a bot's computer. The page
// shows a library document in a <webview>; the page asks for it by the
// webview's webContents id, and Crew points that one webview at the
// document's folder with the same narrow folder API the editors use in
// Fenna Workspace, so the bot's edits (through its fenna MCP server) land
// in the open editor live.
//
// The editor pages and the folder hosts come from the Workspace app; the
// build copies them into dist/editors and src/main/editors
// (scripts/build-editors.mjs).
//
// A comment left in such an editor goes to the bot that owns the document:
// the bot runs with the comment as a person's message, and its reply is
// added to the comment's thread in comments.json.

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");

const KINDS = ["deck", "doc", "sheet", "board", "design"];
const SCHEMES = { deck: "odasset", doc: "oddoc", sheet: "odsheet", board: "odboard", design: "oddesign" };
const APP_DIRS = { deck: "desktop", doc: "docs", sheet: "sheets", board: "whiteboard", design: "design" };
const ITEM_RE = /^[\w.-]{1,80}$/;
const COMMENTS_FILE = "comments.json";
const MAX_COMMENT = 4000;
const MAX_QUOTE = 500;
const THREAD_RE = /^[\w-]{1,80}$/;

function loadHosts() {
  const local = path.join(__dirname, "editors", "hosts.cjs");
  return require(fs.existsSync(local) ? local : path.join(__dirname, "..", "..", "..", "workspace", "src", "main", "hosts.cjs"));
}

/** The editor page for a kind: built into Crew, or the editor app's own build in the repo. */
function editorPage(kind) {
  const built = path.join(__dirname, "..", "..", "dist", "editors", kind, "index.html");
  if (fs.existsSync(built)) return built;
  return path.join(__dirname, "..", "..", "..", APP_DIRS[kind], "dist", "index.html");
}

/** An editor's export handlers: copied next to the hosts by the build, or the editor app's own in the repo. */
function loadExport(kind) {
  const local = path.join(__dirname, "editors", `${kind}Export.cjs`);
  return require(fs.existsSync(local) ? local : path.join(__dirname, "..", "..", "..", APP_DIRS[kind], "src", "main", "export.cjs"));
}

/** The schemes the editors load their assets from; main registers them as privileged, with its own, in one call before ready. */
const editorSchemes = () => KINDS.map((k) => SCHEMES[k]);

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/**
 * comments.json text with `comment` added to the end of one thread, or null when
 * the text is missing, damaged, or has no such thread. Other fields are kept.
 */
function appendComment(raw, threadId, comment) {
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.threads)) return null;
  const thread = data.threads.find((t) => t && t.id === threadId);
  if (!thread || !Array.isArray(thread.comments)) return null;
  thread.comments.push(comment);
  return JSON.stringify({ ...data, version: 1 }, null, 2) + "\n";
}

/** The message a bot gets for a comment: the same words as a person's message. */
function commentPrompt({ title, kind, item }, text, quote) {
  return `Comment on "${title}" (${kind}, Documents/${item})${quote ? ` on: "${quote}"` : ""}: ${text}\n\nAnswer in your reply (it is posted back in the comment thread). If it asks for a change, make it in the document first.`;
}

/**
 * The two channels an editor page in a bot's computer may use. `bound` maps the
 * webContents id of each bound webview to the document it shows; a page with no
 * entry is refused. `crew` is the crew object (store and runner).
 */
function embedChannels({ crew, bound }) {
  const shownBy = (sender) => {
    const shown = sender ? bound.get(sender.id) : null;
    if (!shown) throw new Error("Not allowed from this page.");
    return shown;
  };
  return {
    /** { bot } for the page's comment box: the bot that owns the document. */
    host(sender) {
      const { slug } = shownBy(sender);
      const r = crew ? crew.store.readBot(slug) : null;
      const name = r && r.bot && typeof r.bot.name === "string" ? r.bot.name.trim() : "";
      return { bot: name || "the bot" };
    },

    /** Asks the bot about a comment; its answer is added to the thread when the run ends. */
    comment(sender, req) {
      const shown = shownBy(sender);
      const thread = req && req.thread;
      const text = req && typeof req.text === "string" ? req.text.trim() : "";
      if (typeof thread !== "string" || !THREAD_RE.test(thread)) throw new Error("That comment isn't on this document.");
      if (!text) throw new Error("The comment is empty.");
      if (!crew) throw new Error("The bot can't be reached from here.");
      const quote = req && typeof req.quote === "string" ? req.quote.replace(/\s+/g, " ").trim().slice(0, MAX_QUOTE) : "";
      const run = crew.runner.enqueue({ slug: shown.slug, trigger: "person", text: commentPrompt(shown, text.slice(0, MAX_COMMENT), quote) });
      // The run's promise settles however the run ends, so it is the run-end hook.
      run.done
        .then((res) => {
          const answered = res.outcome === "done" && res.text.trim();
          const reply = answered ? res.text.trim() : `Couldn’t answer: ${res.message || "the bot stopped before it replied."}`;
          answerThread(shown.root, thread, reply.slice(0, MAX_COMMENT), !answered);
        })
        // The document may have been removed while the bot worked; then there is no thread to answer.
        .catch(() => {});
      return { runId: run.runId, queued: run.queued };
    },
  };
}

/** Adds the bot's answer to a thread of the document at `root`. Does nothing if the thread is gone. */
function answerThread(root, threadId, text, error) {
  const file = path.join(root, COMMENTS_FILE);
  let raw = null;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    raw = null;
  }
  const next = appendComment(raw, threadId, { id: randomUUID().slice(0, 12), author: "ai", text, at: Date.now(), ...(error ? { error: true } : {}) });
  if (next !== null) writeAtomic(file, next);
}

/**
 * @param {object} o
 * @param {() => Electron.BrowserWindow | null} o.getWin
 * @param {(slug: string) => string} o.libraryDir
 * @param {string} o.userData
 * @param {object | null} [o.crew]  the crew object (store, runner): where a comment's answer comes from
 */
function createEditors({ getWin, libraryDir, userData, crew = null }) {
  const { createAllHosts, detectProductKind } = loadHosts();
  const all = createAllHosts(userData);
  const hosts = KINDS.map((k) => all[k]);
  const titleOf = (root, kind) => {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(root, `${kind}.json`), "utf8")).title;
      return typeof t === "string" && t.trim() ? t.trim().slice(0, 200) : null;
    } catch {
      return null;
    }
  };
  /** webContents id → what the page shows: its undo (the trust it was given), the bot, and the document. */
  const bound = new Map();

  const pages = new Set(KINDS.map((k) => path.dirname(editorPage(k)).toLowerCase()));
  const isEditorUrl = (url) => {
    if (url === "about:blank") return true;
    if (!url.startsWith("file:")) return false;
    try {
      const file = path.dirname(decodeURIComponent(new URL(url).pathname).replace(/^\/([A-Za-z]:)/, "$1")).toLowerCase();
      return [...pages].some((p) => path.resolve(file) === path.resolve(p) || path.resolve(file).startsWith(path.resolve(p) + path.sep));
    } catch {
      return false;
    }
  };

  /** Which editor a page (an editor webview or one of its hidden print windows) has open. */
  const kindOf = (wc) => KINDS.find((k) => all[k].rootOf(wc)) || null;

  /**
   * Each editor registers its export channels on ipcMain itself, and Slides
   * and Docs use the same names (export:pdf, export:save), so they can't all
   * be registered at once. Crew collects each editor's handlers while it
   * registers, then answers each channel with the handler of the editor the
   * asking page has open.
   */
  function registerExports(ipcMain, preload) {
    /** channel → kind → handler */
    const table = new Map();
    const real = ipcMain.handle;
    for (const kind of KINDS) {
      const h = all[kind];
      ipcMain.handle = (channel, fn) => {
        if (!table.has(channel)) table.set(channel, new Map());
        table.get(channel).set(kind, fn);
      };
      try {
        loadExport(kind).register({
          getWin,
          getRoot: h.rootOf,
          getDeckRoot: h.rootOf,
          setRoot: h.setRoot,
          preload,
          load: (w, hash) => w.loadFile(editorPage(kind), hash ? { hash } : undefined),
          assertSender: h.assertSender,
          trust: h.trust,
        });
      } finally {
        ipcMain.handle = real;
      }
    }
    for (const [channel, byKind] of table) {
      ipcMain.handle(channel, (e, ...args) => {
        const fn = byKind.get(kindOf(e.sender));
        if (!fn) throw new Error("Not allowed from this page.");
        return fn(e, ...args);
      });
    }
  }

  return {
    /** The page-facing API of the folder hosts (deck:read, doc:write …), their asset schemes, and the embed channels. */
    register({ ipcMain, dialog, app, protocol, net, preload }) {
      for (const h of hosts) h.register({ getWin, getTabs: () => null, ipcMain, dialog, app, protocol, net });
      registerExports(ipcMain, preload);
      const embed = embedChannels({ crew, bound });
      ipcMain.handle("embed:host", (e) => embed.host(e.sender));
      ipcMain.handle("embed:comment", (e, req) => embed.comment(e.sender, req));
    },

    /** True for a webview that shows an editor: the shell's own channels accept it too. */
    isEditor: (wc) => !!wc && bound.has(wc.id),

    /** Webviews in Crew's page may only show the editors, with the shell's preload and nothing more. */
    guard(win, preload) {
      win.webContents.on("will-attach-webview", (e, prefs, params) => {
        if (!isEditorUrl(params.src || "about:blank")) {
          e.preventDefault();
          return;
        }
        delete prefs.preloadURL;
        prefs.preload = preload;
        prefs.contextIsolation = true;
        prefs.sandbox = true;
        prefs.nodeIntegration = false;
        prefs.nodeIntegrationInSubFrames = false;
        prefs.webSecurity = true;
      });
      win.webContents.on("did-attach-webview", (_e, wc) => {
        wc.setWindowOpenHandler(() => ({ action: "deny" }));
        wc.on("will-navigate", (e, url) => {
          if (!isEditorUrl(url)) e.preventDefault();
        });
        wc.once("destroyed", () => {
          const shown = bound.get(wc.id);
          if (shown) shown.undo();
          bound.delete(wc.id);
        });
      });
    },

    /** Point the webview with this id (in Crew's own page) at a library document; returns the page to load. */
    open(hostWc, slug, item, webContentsId) {
      if (typeof item !== "string" || !ITEM_RE.test(item) || item.startsWith(".")) throw new Error("That is not a document in the library.");
      const { webContents } = require("electron");
      const wc = webContents.fromId(webContentsId);
      if (!wc || wc.getType() !== "webview" || !wc.hostWebContents || wc.hostWebContents.id !== hostWc.id) throw new Error("Not allowed from this page.");
      const root = path.join(libraryDir(slug), item);
      const kind = fs.existsSync(root) ? detectProductKind(root) : null;
      if (!kind || !KINDS.includes(kind)) throw new Error("That document isn't in the library any more.");
      const prev = bound.get(wc.id);
      if (prev) prev.undo();
      all[kind].setRoot(wc, root);
      const untrust = all[kind].trust(wc);
      const title = titleOf(root, kind) || item;
      bound.set(wc.id, {
        slug,
        item,
        kind,
        root,
        title,
        undo: () => {
          untrust();
          all[kind].setRoot(wc, null);
        },
      });
      const src = pathToFileURL(editorPage(kind));
      src.hash = "embed";
      return { src: src.href, kind, title };
    },
  };
}

/** The files a new, empty document of this kind starts with ({ relative path: text }), from the Workspace hosts. */
function starterFiles(kind, title) {
  if (!KINDS.includes(kind)) throw new Error(`A document is one of: ${KINDS.join(", ")}.`);
  return loadHosts().starterFilesFor(kind, title);
}

module.exports = { createEditors, editorSchemes, starterFiles, KINDS, appendComment, commentPrompt, embedChannels };
