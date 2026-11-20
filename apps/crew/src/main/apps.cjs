// Apps on a bot's computer (docs/spec/crew-apps.md, tier 1). An app is a
// folder Files/Apps/<name>/ with an app.json and web files. Each app runs in
// its own in-memory session: pages come from crewapp://<slug>/<name>/ and
// nothing else, the network is limited to the origins the person granted,
// no permission is ever given, and no download is kept. The page gets one
// global, `crew` (app-preload.cjs). Every call it makes comes back here,
// where the app is identified by its session (never by a name the page
// sends) and the grant is checked again.
//
// The parts that decide what an app may do (URL parsing, the content
// security policy, the network rule, grants, the rate limit) are plain
// functions, so they are tested without Electron.

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const electron = require("electron");
const F = require("./format.cjs");

const packaged = typeof electron === "object" && electron.app && electron.app.isPackaged;
const SHEET = packaged ? require(path.join(process.resourcesPath, "mcp", "crew-sheet.cjs")) : require("@opendeck/sheet");
const DOC = packaged ? require(path.join(process.resourcesPath, "mcp", "crew-doc.cjs")) : require("@opendeck/doc");

const SCHEME = "crewapp";
const PARTITION_PREFIX = "crewapp-";
const RANK = { none: 0, read: 1, write: 2 };
const TOOL_TIMEOUT_MS = 10_000;
const TOOL_RESULT_MAX = 64 * 1024;
const READ_MAX = 8 * 1024 * 1024;
const WRITE_MAX = 10 * 1024 * 1024;
const TELL_MAX = 2000;
const TELL_PER_HOUR = 6;
const HOUR_MS = 60 * 60 * 1000;
const CELLS_MAX = 500;
const ROWS_MAX = 500;
const COLS_MAX = 40;
const TEXT_MAX = 200_000;
const GRANT_CACHE_MS = 2000;
const WATCH_DEBOUNCE_MS = 300;
const TYPES = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json; charset=utf-8", txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", mp4: "video/mp4", webm: "video/webm",
};

const MSG = {
  outside: "A page can only reach its own app's folder.",
  notApp: "This page isn't an app.",
  noTool: (name) => `The app doesn't define a tool "${name}". Add it to tools in app.json first.`,
};

const mb = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
const iso = (ms) => new Date(ms).toISOString();
const lstatOrNull = (p) => {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return null;
    throw e;
  }
};

/** A grant as the grants file holds it, checked; null when it is not one. */
function asGrant(v) {
  if (!v || typeof v !== "object") return null;
  if (!F.APP_DOCUMENTS.includes(v.documents)) return null;
  if (!Array.isArray(v.network) || !v.network.every((o) => typeof o === "string")) return null;
  if (typeof v.bot !== "boolean") return null;
  return { documents: v.documents, network: v.network.slice(), bot: v.bot };
}

/**
 * The permissions an app runs with: what the person allowed, cut down to
 * what its manifest asks for now. A manifest that asks for more keeps the
 * old grant until the person allows the new one; one that asks for less
 * loses the rest at once.
 */
function clampGrant(granted, app) {
  if (!granted || !app) return { ...F.NO_GRANT, network: [] };
  const asked = app.permissions;
  return {
    documents: RANK[granted.documents] <= RANK[asked.documents] ? granted.documents : asked.documents,
    network: granted.network.filter((o) => asked.network.includes(o)),
    bot: granted.bot && asked.bot,
  };
}

/** The partition an app runs in: its own in-memory session. */
const partitionOf = (slug, name) => `${PARTITION_PREFIX}${slug}-${name}`;

/**
 * crewapp://<slug>/<name>/<path> as its parts, or null. The path is decoded
 * segment by segment; an empty path (or a trailing slash) is the app's entry
 * (rel ""). Anything with an empty, dot or slash-carrying part is refused.
 */
function parseAppUrl(text) {
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.protocol !== `${SCHEME}:`) return null;
  const parts = u.pathname.split("/").slice(1);
  if (!parts.length || parts[0] === "") return null;
  let segs;
  try {
    segs = parts.map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
  const trailing = segs.length > 1 && segs.at(-1) === "";
  const rest = trailing ? segs.slice(1, -1) : segs.slice(1);
  if (rest.some((s) => s === "" || s === "." || s === ".." || s.includes("/") || s.includes("\\"))) return null;
  return { slug: u.hostname, name: segs[0], rel: rest.join("/") };
}

/** The content security policy of an app's pages: its own files, and the network origins it was granted. */
function appCsp(origins) {
  const net = origins.join(" ");
  return [
    `default-src 'self' ${SCHEME}:`,
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${SCHEME}:`,
    `media-src 'self' data: blob: ${SCHEME}:`,
    `font-src 'self' data: ${SCHEME}:`,
    `connect-src 'self' ${SCHEME}: ${net}`.trimEnd(),
    `frame-src 'self' ${SCHEME}:`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** Whether a request an app's page makes may go out: its own scheme and data, and granted https or http origins only. */
function requestAllowed(url, origins) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === `${SCHEME}:` || u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") return true;
  if (u.protocol === "https:" || u.protocol === "http:") return origins.includes(u.origin);
  return false;
}

/** Counts events per key in a sliding window: take() is false once `max` have happened in the last `windowMs`. */
function createLimiter({ max, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return {
    take(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      return true;
    },
  };
}

/** A file reader for a Fenna folder (sheets, docs): plain files only, links never followed. */
function folderReader(dir) {
  return {
    read: async (rel) => {
      const full = path.join(dir, rel);
      const st = await fsp.lstat(full).catch(() => null);
      return st && st.isFile() ? fsp.readFile(full, "utf8") : null;
    },
    list: (rel) => fsp.readdir(path.join(dir, rel)).catch(() => []),
  };
}

const cellValue = (v) => {
  if (v === undefined || v === null) return null;
  if (v instanceof SHEET.FormulaError) return v.code;
  return v;
};

/** A Fenna sheet as rows of values: formulas computed, the first rows and columns that have anything. */
async function sheetRows(dir) {
  const wb = await SHEET.loadWorkbook(folderReader(dir));
  const sheets = wb.index.sheets.map((r) => wb.sheets.get(r.id)?.sheet).filter(Boolean);
  const values = SHEET.evaluateAll(new Map(sheets.map((s) => [s.id, s])), wb.index.timeZone);
  return {
    kind: "sheet",
    title: wb.index.title,
    sheets: sheets.map((s) => {
      const vals = values.get(s.id) ?? new Map();
      const used = Object.keys(s.cells).length > 0;
      const b = used ? SHEET.usedBounds(s) : { maxRow: -1, maxCol: -1 };
      const rows = [];
      for (let r = 0; r <= Math.min(b.maxRow, ROWS_MAX - 1); r++) {
        const row = [];
        for (let c = 0; c <= Math.min(b.maxCol, COLS_MAX - 1); c++) {
          const ref = SHEET.formatCellRef(r, c);
          row.push(cellValue(vals.has(ref) ? vals.get(ref) : s.cells[ref]?.v));
        }
        rows.push(row);
      }
      return { title: s.title, rows };
    }),
  };
}

/** A Fenna doc as plain text: its title, then each tab's blocks in order. */
async function docText(dir) {
  const doc = await DOC.loadDoc(folderReader(dir));
  const flat = DOC.flattenTabs(doc.index.tabs);
  const parts = [];
  for (const f of flat) {
    const tab = doc.tabs.get(f.ref.id)?.tab;
    if (!tab) continue;
    const body = tab.children
      .map((b) => DOC.textOf(b).trim())
      .filter(Boolean)
      .join("\n");
    const label = flat.length > 1 ? DOC.tabLabel(doc.index.tabs, f.ref.id) : "";
    parts.push(label && body ? `${label}\n${body}` : label || body);
  }
  return { kind: "doc", title: doc.index.title, text: parts.join("\n\n").slice(0, TEXT_MAX) };
}

/** The cell updates a page asked for, as the sheet package takes them: "=..." is a formula, other text, numbers and booleans are values, null clears. */
function cellUpdates(cells) {
  if (!cells || typeof cells !== "object" || Array.isArray(cells)) throw new Error('Give the cells as an object, like {"A1": "Total", "B2": 42, "B3": "=SUM(B1:B2)"}.');
  const entries = Object.entries(cells);
  if (entries.length > CELLS_MAX) throw new Error(`A call can change at most ${CELLS_MAX} cells.`);
  const out = {};
  for (const [ref, v] of entries) {
    if (!SHEET.parseCellRef(ref)) throw new Error(`"${ref}" is not a cell. Use a reference like B2.`);
    if (v === null) out[ref] = null;
    else if (typeof v === "string" && v.startsWith("=")) out[ref] = { f: v };
    else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[ref] = { v };
    else throw new Error(`The value of ${ref} must be text, a number, a boolean, null, or a formula starting with "=".`);
  }
  return out;
}

/**
 * The apps of the crew. `session` and `ipcMain` are Electron's; `runner`
 * starts a bot's run; `broadcast` tells the page that apps changed.
 */
function createApps({ disk, store, broadcast = () => {}, runner, session, ipcMain, now = () => Date.now() }) {
  const preloadPath = path.join(__dirname, "app-preload.cjs");
  /** partition → { slug, name, ses } for every app whose session is prepared. */
  const byPartition = new Map();
  const bySession = new WeakMap();
  /** webContents id → the tool names its page defined. */
  const toolNames = new Map();
  /** call id → { wcId, resolve, reject, timer }. */
  const pending = new Map();
  const tell = createLimiter({ max: TELL_PER_HOUR, windowMs: HOUR_MS, now });
  const watchers = new Map();
  const timers = new Map();
  const sigs = new Map();
  const grantCache = new Map();

  // ── Files and grants ─────────────────────────────────────────────────

  /** The disk path of an app's folder, or of a file in it. Throws what the disk throws. */
  const appPath = (name, rel = "") => ["Files", "Apps", name, rel].filter((s) => s !== "").join("/");

  /** A file in an app's folder: { abs, st } when it is a file, else null. */
  function fileIn(slug, name, rel) {
    const loc = disk.locate(slug, appPath(name, rel));
    const st = lstatOrNull(loc.abs);
    return st && st.isFile() ? { abs: loc.abs, st } : null;
  }

  /** The folder names under Files/Apps that are apps' names. */
  function folderNames(slug) {
    let loc;
    try {
      loc = disk.locate(slug, "Files/Apps");
    } catch {
      return [];
    }
    let entries;
    try {
      entries = fs.readdirSync(loc.abs, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.filter((d) => d.isDirectory() && F.APP_NAME_RE.test(d.name)).map((d) => d.name).sort();
  }

  /** An app's manifest: the parsed app or null, with every problem (manifest rules, folder name, entry file). */
  function manifest(slug, name) {
    if (!F.APP_NAME_RE.test(name)) return { app: null, problems: [`"${name}" isn't an app's folder name. Use lowercase letters, digits and dashes.`] };
    let text;
    try {
      const f = fileIn(slug, name, "app.json");
      if (!f) return { app: null, problems: [`There is no app.json in Files/Apps/${name}. An app is a folder with an app.json and an index.html.`] };
      text = fs.readFileSync(f.abs, "utf8");
    } catch (e) {
      return { app: null, problems: [e.message] };
    }
    const parsed = F.parseAppManifest(text);
    const problems = [...parsed.problems];
    if (parsed.app) {
      if (parsed.app.name !== name) problems.push(`app.json names the app "${parsed.app.name}", but its folder is "${name}". Rename one of them so they match.`);
      try {
        if (!fileIn(slug, name, parsed.app.entry)) problems.push(`${parsed.app.entry} isn't in the app's folder. Write that file, or change entry in app.json.`);
      } catch (e) {
        problems.push(e.message);
      }
    }
    return { app: problems.length ? null : parsed.app, problems };
  }

  /** What the person allowed the app (its stored grant), or null. */
  function grantOf(slug, name) {
    const hit = readGrants(slug)[name];
    return hit ? asGrant(hit.grant) : null;
  }

  function readGrants(slug) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(store.botDir(slug), "apps.json"), "utf8"));
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  }

  function writeGrants(slug, v) {
    const file = path.join(store.botDir(slug), "apps.json");
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(v, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, file);
  }

  /** The permissions an app runs with right now (cached for a moment: the network check asks on every request). */
  function runGrant(slug, name) {
    const key = `${slug}/${name}`;
    const hit = grantCache.get(key);
    const t = now();
    if (hit && t - hit.at < GRANT_CACHE_MS) return hit.grant;
    const grant = clampGrant(grantOf(slug, name), manifest(slug, name).app);
    grantCache.set(key, { at: t, grant });
    return grant;
  }

  function infoOf(slug, name) {
    const { app, problems } = manifest(slug, name);
    const grant = grantOf(slug, name);
    let updatedAt = iso(0);
    try {
      const f = fileIn(slug, name, "app.json");
      if (f) updatedAt = iso(f.st.mtimeMs);
    } catch {
      /* the problems say why */
    }
    if (!app) {
      return { name, title: name, icon: "app", description: "", entry: "", problems, grant, pending: false, tools: [], permissions: { ...F.NO_GRANT, network: [] }, updatedAt };
    }
    return {
      name,
      title: app.title,
      icon: app.icon,
      description: app.description,
      entry: app.entry,
      problems: [],
      grant,
      pending: !F.grantCovers(grant ?? F.NO_GRANT, app),
      tools: app.tools,
      permissions: app.permissions,
      updatedAt,
    };
  }

  /** The apps in a bot's Files/Apps, each with its problems and grant. */
  function list(slug) {
    sync();
    return folderNames(slug).map((name) => infoOf(slug, name));
  }

  /**
   * The person allows an app what its manifest asks for (grant), or revokes
   * it (null). A grant must cover the whole ask; the stored grant is what
   * the manifest asks for now. Returns the bot's apps.
   */
  function setGrant(slug, name, grant) {
    if (!store.readBot(slug)) throw new Error(`There is no bot "${slug}".`);
    if (!F.APP_NAME_RE.test(name)) throw new Error(`"${name}" isn't an app's folder name.`);
    const all = readGrants(slug);
    if (grant === null) {
      delete all[name];
    } else {
      const { app, problems } = manifest(slug, name);
      if (!app) throw new Error(`${name} can't be allowed yet: ${problems[0]}`);
      const given = asGrant(grant);
      if (!given) throw new Error("A grant is documents (none, read or write), network (a list of origins) and bot (true or false).");
      if (!F.grantCovers(given, app)) {
        throw new Error(`The grant must allow what the app asks for: documents ${app.permissions.documents}, ${app.permissions.network.length} origin(s), bot ${app.permissions.bot ? "yes" : "no"}.`);
      }
      all[name] = { grant: app.permissions, hash: F.manifestHash(app), at: iso(now()) };
    }
    writeGrants(slug, all);
    grantCache.clear();
    broadcast("crew:apps", { slug });
    return list(slug);
  }

  // ── Watching the Apps folders ────────────────────────────────────────

  /** Starts watching each bot's Files/Apps (once it exists); the page hears of changes that differ from the last list. */
  function sync() {
    for (const slug of store.slugs()) {
      if (watchers.has(slug)) continue;
      let dir;
      try {
        dir = disk.locate(slug, "Files/Apps").abs;
      } catch {
        continue;
      }
      if (!lstatOrNull(dir)?.isDirectory()) continue;
      try {
        watchers.set(
          slug,
          fs.watch(dir, { recursive: true }, () => {
            clearTimeout(timers.get(slug));
            timers.set(slug, setTimeout(() => changed(slug), WATCH_DEBOUNCE_MS));
          }),
        );
      } catch {
        /* a folder that can't be watched is read when the page asks */
      }
    }
  }

  function changed(slug) {
    grantCache.clear();
    const sig = JSON.stringify(folderNames(slug).map((name) => infoOf(slug, name)));
    if (sig === sigs.get(slug)) return;
    sigs.set(slug, sig);
    broadcast("crew:apps", { slug });
  }

  // ── The app's session ────────────────────────────────────────────────

  /** Serves crewapp:// for one app only: its files from its folder, with the app's policy headers. */
  function serve(req, info) {
    const u = parseAppUrl(req.url);
    if (!u || u.slug !== info.slug || u.name !== info.name) return plain(403, MSG.outside);
    try {
      let rel = u.rel;
      if (rel === "") rel = manifest(info.slug, info.name).app?.entry ?? "index.html";
      if (!F.insideFolder(rel)) return plain(403, MSG.outside);
      const f = fileIn(info.slug, info.name, rel);
      if (!f) return plain(404, "There is no file here.");
      const headers = {
        "content-type": TYPES[path.extname(f.abs).slice(1).toLowerCase()] || "application/octet-stream",
        "content-security-policy": appCsp(runGrant(info.slug, info.name).network),
        "x-content-type-options": "nosniff",
        "cache-control": "no-cache",
        "content-length": String(f.st.size),
      };
      const body = req.method === "HEAD" ? null : Readable.toWeb(fs.createReadStream(f.abs));
      return new Response(body, { status: 200, headers });
    } catch (e) {
      return plain(404, e.message);
    }
  }

  const plain = (status, message) => new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

  /** The Electron session of one app, prepared once: its scheme, its network rule, and no permissions or downloads. */
  function sessionOf(slug, name) {
    const part = partitionOf(slug, name);
    const hit = byPartition.get(part);
    if (hit) return hit.ses;
    const ses = session.fromPartition(part);
    const info = { slug, name, ses };
    byPartition.set(part, info);
    bySession.set(ses, info);
    ses.protocol.handle(SCHEME, (req) => serve(req, info));
    ses.webRequest.onBeforeRequest((details, cb) => {
      cb({ cancel: !requestAllowed(details.url, runGrant(slug, name).network) });
    });
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    if (typeof ses.setDevicePermissionHandler === "function") ses.setDevicePermissionHandler(() => false);
    ses.on("will-download", (e) => e.preventDefault());
    return ses;
  }

  /** The app a webContents' session belongs to, or null. */
  const appOf = (wc) => (wc && wc.session && bySession.get(wc.session)) || null;

  // ── Calls from the page ──────────────────────────────────────────────

  function docsFolder(slug, p) {
    const text = typeof p === "string" ? p.trim() : "";
    if (!text.startsWith("Documents/")) throw new Error("Say a document in Documents, like Documents/q3-budget.");
    const loc = disk.locate(slug, text);
    if (loc.rest.length !== 1) throw new Error("Name one document in Documents, like Documents/q3-budget.");
    const st = lstatOrNull(loc.abs);
    if (!st || !st.isDirectory()) throw new Error(`There is no document "${text}". The app's docs.list call lists them.`);
    const kind = F.FENNA_APPS.find((a) => lstatOrNull(path.join(loc.abs, a.marker))?.isFile())?.kind ?? null;
    if (!kind) throw new Error(`${text} isn't a Fenna document.`);
    return { dir: loc.abs, kind, title: loc.rest[0] };
  }

  function needDocs(grant, level) {
    if (RANK[grant.documents] < RANK[level]) {
      throw new Error(level === "write" ? "This app can't change Documents. The person can allow Documents (write) for it in the bot's Apps." : "This app can't read Documents. The person can allow Documents for it in the bot's Apps.");
    }
  }

  /** The calls the page makes, each checked against the app's grant. `wc` is the page's webContents. */
  async function call(who, wc, op, args) {
    const { slug, name } = who;
    const grant = runGrant(slug, name);
    const root = appPath(name);
    const str = (v, what, max) => {
      if (typeof v !== "string") throw new Error(`${what} must be text.`);
      if (max && v.length > max) throw new Error(`${what} is ${v.length} characters. The most is ${max}.`);
      return v;
    };
    switch (op) {
      case "files.read": {
        const rel = str(args.path, "The path");
        const f = fileIn(slug, name, rel);
        if (!f) throw new Error(`There is no file at ${rel} in the app's folder.`);
        if (f.st.size > READ_MAX) throw new Error(`That file is ${mb(f.st.size)}. An app can read at most ${mb(READ_MAX)} at a time.`);
        return fs.readFileSync(f.abs, "utf8");
      }
      case "files.write": {
        const rel = str(args.path, "The path");
        const bytes = typeof args.text === "string" ? Buffer.from(args.text, "utf8") : args.bytes instanceof Uint8Array ? Buffer.from(args.bytes) : null;
        if (!bytes) throw new Error("Give the file's text, or its bytes as a Uint8Array.");
        if (bytes.length > WRITE_MAX) throw new Error(`That is ${mb(bytes.length)}. An app can write at most ${mb(WRITE_MAX)} at a time.`);
        if (!rel) throw new Error("Name a file in the app's folder.");
        const loc = disk.locate(slug, appPath(name, rel));
        const st = lstatOrNull(loc.abs);
        if (st && st.isDirectory()) throw new Error(`${rel} is a folder. Pick a file name.`);
        const free = disk.free(slug, true) + (st ? st.size : 0);
        if (bytes.length > free) throw new Error(`There isn't room on the bot's disk for that. It needs ${mb(bytes.length)}, and ${mb(Math.max(0, free))} is free.`);
        fs.mkdirSync(path.dirname(loc.abs), { recursive: true });
        fs.writeFileSync(loc.abs, bytes);
        broadcast("crew:disk", { slug });
        return null;
      }
      case "files.list": {
        const rel = args.path === undefined ? "" : str(args.path, "The path");
        const loc = disk.locate(slug, appPath(name, rel));
        const st = lstatOrNull(loc.abs);
        if (!st || !st.isDirectory()) throw new Error(`There is no folder at ${rel || "the app's folder"}.`);
        return fs.readdirSync(loc.abs, { withFileTypes: true })
          .filter((d) => !d.name.startsWith(".") && (d.isFile() || d.isDirectory()))
          .map((d) => ({ name: d.name, kind: d.isDirectory() ? "folder" : "file" }))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      }
      case "docs.list": {
        needDocs(grant, "read");
        return disk.list(slug, "Documents").entries.map((e) => ({ path: e.path, name: e.name, kind: e.kind, title: e.title ?? e.name }));
      }
      case "docs.read": {
        needDocs(grant, "read");
        const d = docsFolder(slug, args.path);
        if (d.kind === "sheet") return sheetRows(d.dir);
        if (d.kind === "doc") return docText(d.dir);
        throw new Error(`Only sheets and docs can be read. ${args.path} is a ${d.kind}.`);
      }
      case "docs.writeCells": {
        needDocs(grant, "write");
        const d = docsFolder(slug, args.path);
        if (d.kind !== "sheet") throw new Error(`Only sheets have cells. ${args.path} is a ${d.kind}.`);
        const updates = cellUpdates(args.cells);
        const wb = await SHEET.loadWorkbook(folderReader(d.dir));
        const problems = [...wb.problems, ...[...wb.sheets.values()].filter((s) => s.error).map((s) => s.error)];
        if (problems.length) throw new Error(`${args.path} has a problem, so nothing was written: ${problems[0]}`);
        const want = str(args.sheet, "The sheet");
        const ref = wb.index.sheets.find((r) => r.id === want || r.title === want);
        if (!ref) throw new Error(`There is no sheet "${want}" in ${args.path}. Sheets: ${wb.index.sheets.map((r) => r.title).join(", ")}.`);
        const file = SHEET.sheetFile(ref.id);
        if (!F.insideFolder(file)) throw new Error(MSG.outside);
        const next = SHEET.patchCells(wb.sheets.get(ref.id).sheet, updates);
        fs.writeFileSync(path.join(d.dir, file), SHEET.sheetText(next), "utf8");
        broadcast("crew:disk", { slug });
        return null;
      }
      case "bot.tell": {
        if (!grant.bot) throw new Error("This app can't message the bot. The person can allow it in the bot's Apps.");
        const text = str(args.text, "The message", TELL_MAX);
        if (!text.trim()) throw new Error("Say what the bot should know.");
        if (!tell.take(`${slug}/${name}`)) throw new Error(`The app has sent the bot ${TELL_PER_HOUR} messages this hour. Wait a while before sending another.`);
        const title = manifest(slug, name).app?.title ?? name;
        runner.enqueue({ slug, trigger: "app", text: `${title}: ${text.trim()}` });
        return null;
      }
      case "tools.define": {
        const tool = str(args.name, "The tool's name");
        if (!manifest(slug, name).app?.tools.some((t) => t.name === tool)) throw new Error(MSG.noTool(tool));
        toolNamesOf(wc).add(tool);
        return null;
      }
      default:
        throw new Error(`There is no call called ${JSON.stringify(String(op))}.`);
    }
  }

  // ── Tools the page defines ───────────────────────────────────────────

  function toolNamesOf(wc) {
    let names = toolNames.get(wc.id);
    if (!names) {
      names = new Set();
      toolNames.set(wc.id, names);
      wc.once("destroyed", () => toolNames.delete(wc.id));
      wc.on("did-start-navigation", (_e, _url, inPlace, isMainFrame) => {
        if (isMainFrame && !inPlace) names.clear();
      });
    }
    return names;
  }

  /** The names of the tools an app's page has defined, for one webContents. */
  function toolsOf(wc) {
    return [...(toolNames.get(wc.id) ?? [])];
  }

  /**
   * Runs the tool a page defined with crew.tools.define, with `input`, and
   * resolves with its JSON result. Rejects after `timeoutMs` (10 s) or when
   * the result is over 64 KB.
   */
  function callTool(wc, name, input, { timeoutMs = TOOL_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      if (!wc || wc.isDestroyed()) return reject(new Error("The app isn't open."));
      const names = toolNames.get(wc.id);
      if (!names || !names.has(name)) {
        const have = names && names.size ? [...names].join(", ") : "none yet";
        return reject(new Error(`The app has no tool "${name}" running. Its tools: ${have}.`));
      }
      const text = JSON.stringify(input ?? {}) ?? "{}";
      if (text.length > TOOL_RESULT_MAX) return reject(new Error("The input is over 64 KB. Send less."));
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`The tool didn't answer within ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      pending.set(id, { wcId: wc.id, resolve, reject, timer });
      wc.send("crewapp:callTool", { id, name, input: JSON.parse(text) });
    });
  }

  // ── IPC ──────────────────────────────────────────────────────────────

  if (ipcMain) {
    ipcMain.handle("crewapp:call", (e, op, args) => {
      const who = appOf(e.sender);
      if (!who) throw new Error(MSG.notApp);
      return call(who, e.sender, String(op), args && typeof args === "object" ? args : {});
    });
    ipcMain.on("crewapp:info", (e) => {
      const who = appOf(e.sender);
      if (!who) {
        e.returnValue = null;
        return;
      }
      const grant = runGrant(who.slug, who.name);
      e.returnValue = { name: who.name, title: manifest(who.slug, who.name).app?.title ?? who.name, bot: grant.bot, documents: grant.documents, network: grant.network };
    });
    ipcMain.on("crewapp:toolResult", (e, msg) => {
      const p = msg && pending.get(msg.id);
      if (!p || p.wcId !== e.sender.id) return;
      clearTimeout(p.timer);
      pending.delete(msg.id);
      if (!msg.ok) return p.reject(new Error(msg.error || "The tool failed."));
      if (typeof msg.text === "string" && msg.text.length > TOOL_RESULT_MAX) return p.reject(new Error("The tool's result is over 64 KB. Return less."));
      try {
        p.resolve(typeof msg.text === "string" ? JSON.parse(msg.text) : null);
      } catch {
        p.reject(new Error("The tool's result isn't JSON."));
      }
    });
  }

  // ── Webviews ─────────────────────────────────────────────────────────

  /**
   * Webviews of apps: only the app's own partition and its own pages, with
   * the app's preload and nothing more. Their windows and navigation stay in
   * the app. Call on Crew's window; editors' webviews are left to editors.cjs.
   */
  function guard(win) {
    win.webContents.on("will-attach-webview", (e, prefs, params) => {
      const part = String(params.partition || "");
      if (!part.startsWith(PARTITION_PREFIX)) return;
      const u = parseAppUrl(params.src || "");
      if (!u || part !== partitionOf(u.slug, u.name)) {
        e.preventDefault();
        return;
      }
      sessionOf(u.slug, u.name);
      delete prefs.preloadURL;
      prefs.preload = preloadPath;
      prefs.sandbox = true;
      prefs.contextIsolation = true;
      prefs.nodeIntegration = false;
      prefs.nodeIntegrationInSubFrames = false;
      prefs.webSecurity = true;
    });
    win.webContents.on("did-attach-webview", (_e, wc) => {
      const who = appOf(wc);
      if (!who) return;
      wc.setWindowOpenHandler(() => ({ action: "deny" }));
      wc.on("will-navigate", (ev, url) => {
        const u = parseAppUrl(url);
        if (!u || u.slug !== who.slug || u.name !== who.name) ev.preventDefault();
      });
    });
  }

  return {
    list,
    manifest,
    setGrant,
    grantOf,
    partition: partitionOf,
    session: sessionOf,
    preloadPath,
    callTool,
    toolsOf,
    guard,
    /** Whether a webview partition or session belongs to an app (editors.cjs leaves those to this module). */
    ownsPartition: (part) => String(part || "").startsWith(PARTITION_PREFIX),
    ownsSession: (ses) => bySession.has(ses),
    sync,
    /** Something on the bot's disk changed (a bot's write_file, a drop): watch a new Apps folder and tell the page if the apps changed. */
    touched(slug) {
      sync();
      clearTimeout(timers.get(slug));
      timers.set(slug, setTimeout(() => changed(slug), WATCH_DEBOUNCE_MS));
    },
    stop() {
      for (const w of watchers.values()) w.close();
      watchers.clear();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}

module.exports = {
  createApps,
  parseAppUrl,
  appCsp,
  requestAllowed,
  clampGrant,
  createLimiter,
  partitionOf,
  TOOL_TIMEOUT_MS,
  TOOL_RESULT_MAX,
  TELL_PER_HOUR,
  SCHEME,
};
