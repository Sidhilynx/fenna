// The bot's disk: the folders a bot works in, as the person sees them, and
// everything the person can do with them. A disk path is "/"-separated and
// starts with a root:
//
//   Files/...      the bot's workspace                 (botDir/workspace)
//   Documents/...  its Fenna documents, one entry each (botDir/library)
//   Downloads/...  what its browser saved              (botDir/workspace/downloads)
//   Trash/...      thrown away, with where it came from (botDir/trash, trash/.index.json)
//
// Every path is checked here before anything touches the file system, and
// nothing outside the bot's folder is read or written. The roots, quotas and
// file kinds are restated from apps/crew/src/shared/contract.ts (DISK_ROOTS,
// DISK_QUOTAS_GB, FILE_KINDS); keep them in step with it.

const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const F = require("./format.cjs");

const DISK_ROOTS = ["Files", "Documents", "Downloads", "Trash"];
const DISK_QUOTAS_GB = [1, 2, 5, 10, 20, 50];
const DEFAULT_QUOTA_GB = 5;
const GB = 1024 ** 3;
const MB = 1024 ** 2;
const IMPORT_MAX = 200 * MB;
const NAME_MAX = 255;
const USED_TTL_MS = 10_000;
const MAX_PATHS = 500;
const DOC_KINDS = ["doc", "sheet", "deck", "board", "design"];
const TRASH_INDEX = ".index.json";
/** Where files the person attaches to a message are saved: a folder in Files. */
const INBOX = "Files/Inbox";
const OUTSIDE = "That file is outside this bot's disk.";
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

const KIND_OF_EXT = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", avif: "image", bmp: "image",
  mp4: "video", webm: "video", mov: "video", mkv: "video",
  mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", flac: "audio",
  pdf: "pdf",
  txt: "text", md: "text", log: "text",
  csv: "table", tsv: "table", xlsx: "table", xls: "table",
  js: "code", ts: "code", py: "code", html: "code", css: "code", json: "code",
  zip: "archive", "7z": "archive", tar: "archive", gz: "archive",
};

const TYPE_OF_EXT = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  avif: "image/avif", bmp: "image/bmp",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  log: "text/plain; charset=utf-8", json: "application/json; charset=utf-8",
  js: "text/javascript; charset=utf-8", ts: "text/plain; charset=utf-8", py: "text/plain; charset=utf-8",
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
  zip: "application/zip", "7z": "application/x-7z-compressed", tar: "application/x-tar", gz: "application/gzip",
};

/** Where each root lives inside a bot's folder. */
const ROOT_PATH = { Files: ["workspace"], Documents: ["library"], Downloads: ["workspace", "downloads"], Trash: ["trash"] };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const lstatOrNull = (p) => {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return null;
    throw e;
  }
};
const isDir = (p) => {
  const st = lstatOrNull(p);
  return !!st && st.isDirectory();
};
const readdirSafe = (dir) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
const iso = (ms) => new Date(ms).toISOString();

function sizeText(n) {
  if (n < MB) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < GB) return `${(n / MB).toFixed(1)} MB`;
  return `${(n / GB).toFixed(2)} GB`;
}

/** A name in a disk path, or a name the person typed, checked. Throws with what to change. */
function checkSegment(s) {
  if (s.length > NAME_MAX) throw new Error(`That name is ${s.length} characters; the most is ${NAME_MAX}.`);
  if (/[\x00-\x1f\x7f]/.test(s)) throw new Error("A name can't contain a control character.");
  if (s.startsWith(".")) throw new Error("Names that start with a dot are hidden on the bot's disk.");
  if (/[. ]$/.test(s)) throw new Error("A name can't end with a dot or a space.");
  if (WINDOWS_RESERVED.test(s)) throw new Error(`"${s}" is a name Windows keeps for itself. Pick another name.`);
}

/** Whether a name found in a folder is one Crew shows and can address. */
function nameOk(name) {
  if (/[\\:]/.test(name)) return false;
  try {
    checkSegment(name);
    return true;
  } catch {
    return false;
  }
}

/** A name the person typed (a new folder, a rename): trimmed and checked. */
function checkName(name) {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) throw new Error("Say a name.");
  if (n === "." || n === "..") throw new Error("Pick a name that isn't . or ..");
  if (/[\\/:]/.test(n)) throw new Error("A name can't contain a slash, a backslash or a colon.");
  checkSegment(n);
  return n;
}

/** A disk path split into its parts, each checked. Throws with what to fix. */
function splitPath(p) {
  if (typeof p !== "string" || !p.trim()) throw new Error("Say which file or folder.");
  if (p.length > 4096) throw new Error("That path is too long.");
  if (p.startsWith("/") || p.startsWith("\\")) throw new Error(OUTSIDE);
  const segs = p.split("/");
  for (const s of segs) {
    if (s === "") throw new Error("That path has an empty part. Paths look like Files/notes/a.txt.");
    if (s === "." || s === "..") throw new Error(OUTSIDE);
    if (/[\\:]/.test(s)) throw new Error(OUTSIDE);
    checkSegment(s);
  }
  if (!DISK_ROOTS.includes(segs[0])) throw new Error(OUTSIDE);
  return segs;
}

/** The Fenna app a folder is a document of, with its title, or null. */
function docInfo(dir, name) {
  const app = F.FENNA_APPS.find((a) => lstatOrNull(path.join(dir, a.marker))?.isFile());
  if (!app) return null;
  const title = readJson(path.join(dir, app.marker))?.title;
  return { kind: app.kind, title: typeof title === "string" && title.trim() ? title.trim() : name };
}

function kindOf(name) {
  const dot = name.lastIndexOf(".");
  return (dot > 0 && KIND_OF_EXT[name.slice(dot + 1).toLowerCase()]) || "other";
}

/** Folders first, then names in natural order, ignoring case. */
function sorted(entries) {
  return entries.sort((a, b) => {
    if ((a.kind === "folder") !== (b.kind === "folder")) return a.kind === "folder" ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}

/** Bytes under a path (links are not followed), the newest change time, and whether a link was found. */
function treeStat(p) {
  const st = lstatOrNull(p);
  if (!st) return { bytes: 0, mtime: 0, links: false };
  if (st.isSymbolicLink()) return { bytes: 0, mtime: st.mtimeMs, links: true };
  if (st.isFile()) return { bytes: st.size, mtime: st.mtimeMs, links: false };
  let out = { bytes: 0, mtime: st.mtimeMs, links: false };
  if (!st.isDirectory()) return out;
  for (const name of readdirSafe(p)) {
    const r = treeStat(path.join(p, name));
    out = { bytes: out.bytes + r.bytes, mtime: Math.max(out.mtime, r.mtime), links: out.links || r.links };
  }
  return out;
}

function copyTree(from, to) {
  const st = fs.lstatSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to);
    for (const name of readdirSafe(from)) copyTree(path.join(from, name), path.join(to, name));
  } else {
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  }
}

/** A name in a folder that is free: "a.txt", then "a (2).txt"; in Documents a slug, "q3-report-2". */
function freeName(dir, name, slugStyle) {
  if (!lstatOrNull(path.join(dir, name))) return name;
  if (slugStyle) return F.uniqueSlug(name, readdirSafe(dir));
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const stem = ext ? name.slice(0, dot) : name;
  for (let n = 2; ; n++) {
    const tail = ` (${n})${ext}`;
    const candidate = `${stem.slice(0, NAME_MAX - tail.length)}${tail}`;
    if (!lstatOrNull(path.join(dir, candidate))) return candidate;
  }
}

/** An imported file's name made safe to save: no folders, control or Windows-reserved characters. */
function cleanName(name) {
  const last = String(name ?? "").split(/[\\/]/).pop() || "";
  let clean = last.replace(/[\x00-\x1f\x7f<>:"|?*]/g, "_").replace(/^\.+/, "").replace(/[. ]+$/, "").trim();
  if (!clean) clean = "file";
  if (WINDOWS_RESERVED.test(clean)) clean = `_${clean}`;
  return clean.slice(0, NAME_MAX);
}

function byteSize(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes.byteLength;
  if (ArrayBuffer.isView(bytes)) return bytes.byteLength;
  throw new Error("A file to import didn't arrive with its bytes.");
}

function toBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The parts of a trash record's origin, or null when it can't be used. */
function originOf(from) {
  if (typeof from !== "string") return null;
  try {
    const segs = splitPath(from);
    return segs[0] === "Trash" || segs.length < 2 ? null : segs;
  } catch {
    return null;
  }
}

function pathList(v) {
  if (!Array.isArray(v) || !v.length) throw new Error("Pick at least one file or folder.");
  if (v.length > MAX_PATHS) throw new Error(`Pick at most ${MAX_PATHS} items at once.`);
  return v;
}

/**
 * @param {object} o
 * @param {{ botDir(slug: string): string }} o.store  the crew store (validates slugs)
 * @param {(channel: string, payload: object) => void} [o.broadcast]
 * @param {(kind: string, title: string) => Record<string, string>} [o.starterFiles]  a new document's files (editors.cjs)
 * @param {string} o.settingsFile  the JSON file the bots' disk sizes are kept in, keyed by slug
 */
function createDisk({ store, broadcast = () => {}, starterFiles = require("./editors.cjs").starterFiles, settingsFile }) {
  /** slug → { at, bytes } */
  const usedCache = new Map();

  const link = () => new Error("A link can't be used on the bot's disk.");

  /** Throws when a link sits on the way from the bot's folder to `abs`, or the folder it is in is outside the bot's folder. */
  function refuseLinks(base, abs) {
    let cur = base;
    for (const part of path.relative(base, abs).split(path.sep).filter(Boolean)) {
      cur = path.join(cur, part);
      const st = lstatOrNull(cur);
      if (!st) break;
      if (st.isSymbolicLink()) throw link();
    }
    let there = abs;
    while (!lstatOrNull(there) && there !== path.dirname(there)) there = path.dirname(there);
    const realBase = fs.realpathSync(base);
    const real = fs.realpathSync(there);
    if (real !== realBase && !real.startsWith(realBase + path.sep)) throw new Error(OUTSIDE);
  }

  /** The bot's folder, which must exist as a bot. */
  function botFolder(slug) {
    const dir = store.botDir(slug);
    const st = lstatOrNull(dir);
    if (st && st.isSymbolicLink()) throw link();
    if (!lstatOrNull(path.join(dir, "bot.md"))) throw new Error(`There is no bot "${slug}".`);
    return dir;
  }

  /** The bot's folder with its roots made, every root checked for links first. */
  function prepare(slug) {
    const base = botFolder(slug);
    for (const r of DISK_ROOTS) {
      const dir = path.join(base, ...ROOT_PATH[r]);
      refuseLinks(base, dir);
      fs.mkdirSync(dir, { recursive: true });
    }
    return base;
  }

  const rootFolders = (base) => Object.fromEntries(DISK_ROOTS.map((r) => [r, path.join(base, ...ROOT_PATH[r])]));

  /** Where a disk path lives. Throws if it is outside the bot's disk or goes through a link. */
  function locate(slug, p) {
    const segs = splitPath(p);
    const base = botFolder(slug);
    const [root, ...rest] = segs;
    const rootAbs = path.join(base, ...ROOT_PATH[root]);
    const abs = path.resolve(rootAbs, ...rest);
    const back = path.relative(rootAbs, abs);
    if (back.startsWith("..") || path.isAbsolute(back)) throw new Error(OUTSIDE);
    refuseLinks(base, abs);
    const isRoot = Object.values(rootFolders(base)).includes(abs);
    return { segs, root, rest, base, abs, isRoot };
  }

  /** Bytes the bot's disk uses. Cached for a few seconds unless `fresh` (quota checks are always fresh). */
  function used(slug, fresh = false) {
    const hit = usedCache.get(slug);
    if (!fresh && hit && Date.now() - hit.at < USED_TTL_MS) return hit.bytes;
    const base = botFolder(slug);
    const bytes = ["workspace", "library", "trash"].reduce((n, d) => n + treeStat(path.join(base, d)).bytes, 0);
    usedCache.set(slug, { at: Date.now(), bytes });
    return bytes;
  }

  const readQuotas = () => {
    const v = readJson(settingsFile);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  };

  function quota(slug) {
    store.botDir(slug);
    const gb = readQuotas()[slug];
    return (DISK_QUOTAS_GB.includes(gb) ? gb : DEFAULT_QUOTA_GB) * GB;
  }

  function assertRoom(slug, bytes) {
    const free = Math.max(0, quota(slug) - used(slug, true));
    if (bytes > free) throw new Error(`That won't fit in the bot's disk. It needs ${sizeText(bytes)}, and ${sizeText(free)} is free.`);
  }

  function readIndex(base) {
    const v = readJson(path.join(base, "trash", TRASH_INDEX));
    return Array.isArray(v) ? v.filter((r) => r && typeof r.name === "string" && typeof r.from === "string") : [];
  }

  const writeIndex = (base, list) => writeAtomic(path.join(base, "trash", TRASH_INDEX), `${JSON.stringify(list, null, 2)}\n`);

  function rootEntries(base) {
    return DISK_ROOTS.map((r) => ({ path: r, name: r, kind: "folder", size: 0, edited: iso(lstatOrNull(rootFolders(base)[r]).mtimeMs) }));
  }

  function documentEntries(base) {
    const lib = path.join(base, "library");
    const out = [];
    for (const name of readdirSafe(lib)) {
      if (!nameOk(name)) continue;
      const dir = path.join(lib, name);
      const st = lstatOrNull(dir);
      if (!st || !st.isDirectory()) continue;
      const info = docInfo(dir, name);
      if (!info) continue;
      const t = treeStat(dir);
      out.push({ path: `Documents/${name}`, name, kind: info.kind, title: info.title, size: t.bytes, edited: iso(t.mtime) });
    }
    return sorted(out);
  }

  function trashEntries(base) {
    const dir = path.join(base, "trash");
    const index = readIndex(base);
    const out = [];
    for (const name of readdirSafe(dir)) {
      if (!nameOk(name)) continue;
      const full = path.join(dir, name);
      const st = lstatOrNull(full);
      if (!st || st.isSymbolicLink()) continue;
      const rec = index.find((r) => r.name === name);
      const from = rec ? rec.from : undefined;
      const shown = from ? from.split("/").pop() : name;
      const info = st.isDirectory() && from && from.startsWith("Documents/") ? docInfo(full, shown) : null;
      const entry = {
        path: `Trash/${name}`,
        name: shown,
        kind: info ? info.kind : st.isDirectory() ? "folder" : kindOf(name),
        size: info ? treeStat(full).bytes : st.isFile() ? st.size : 0,
        edited: iso(st.mtimeMs),
      };
      if (info) entry.title = info.title;
      if (from) entry.from = from;
      out.push(entry);
    }
    return sorted(out);
  }

  /** The entries of a folder. `hide` is one folder inside it that is shown elsewhere (Files' downloads, shown as Downloads). */
  function readFolder(dir, at, hide = null) {
    const out = [];
    for (const name of readdirSafe(dir)) {
      if (!nameOk(name)) continue;
      const full = path.join(dir, name);
      if (full === hide) continue;
      const st = lstatOrNull(full);
      if (!st || st.isSymbolicLink()) continue;
      const p = `${at}/${name}`;
      if (st.isDirectory()) out.push({ path: p, name, kind: "folder", size: 0, edited: iso(st.mtimeMs) });
      else if (st.isFile()) out.push({ path: p, name, kind: kindOf(name), size: st.size, edited: iso(st.mtimeMs) });
    }
    return sorted(out);
  }

  function folderEntries(slug, dir) {
    const loc = locate(slug, dir);
    const at = loc.segs.join("/");
    if (loc.root === "Documents") {
      if (loc.rest.length === 0) return documentEntries(loc.base);
      if (docInfo(loc.abs, loc.rest.at(-1))) throw new Error("A document is one entry. Open it in its editor; it has no folders to open.");
      throw new Error("That folder isn't there.");
    }
    if (loc.root === "Trash" && loc.rest.length === 0) return trashEntries(loc.base);
    const st = lstatOrNull(loc.abs);
    if (!st) throw new Error("That folder isn't there.");
    if (!st.isDirectory()) throw new Error("That isn't a folder.");
    const shownAsDownloads = loc.root === "Files" && loc.rest.length === 0 ? path.join(loc.base, ...ROOT_PATH.Downloads) : null;
    return readFolder(loc.abs, at, shownAsDownloads);
  }

  /**
   * What is in a disk folder: the four roots at the top (dir ""), or the entries of a folder.
   * @returns {{ entries: object[], used: number, quota: number }}
   */
  function list(slug, dir) {
    const base = prepare(slug);
    const entries = dir === undefined || dir === null || dir === "" ? rootEntries(base) : folderEntries(slug, dir);
    return { entries, used: used(slug), quota: quota(slug) };
  }

  function mkdir(slug, p) {
    const loc = locate(slug, p);
    if (loc.rest.length === 0 || loc.isRoot) throw new Error("That folder is already there.");
    if (loc.root === "Documents") throw new Error("Documents holds documents only. Make one with New document.");
    if (loc.root === "Trash") throw new Error("Trash holds only what was thrown away.");
    const name = checkName(loc.segs.at(-1));
    if (lstatOrNull(loc.abs)) throw new Error(`There is already a file called "${name}" there.`);
    if (!isDir(path.dirname(loc.abs))) throw new Error("That folder isn't there.");
    fs.mkdirSync(loc.abs);
    return loc.segs.slice(0, -1).join("/");
  }

  /** Whether two paths name the same entry (a case-only rename on Windows is one entry). */
  const sameEntry = (a, b) => fs.realpathSync.native(a) === fs.realpathSync.native(b);

  function rename(slug, p, name) {
    const loc = locate(slug, p);
    if (loc.isRoot) throw new Error("Files, Documents, Downloads and Trash can't be renamed.");
    if (loc.root === "Trash") throw new Error("Restore it to rename it.");
    const next = checkName(name);
    if (!lstatOrNull(loc.abs)) throw new Error("That file isn't there any more.");
    if (loc.root === "Documents") {
      if (!docInfo(loc.abs, loc.segs.at(-1))) throw new Error("That isn't a document.");
      if (!F.isSlug(next)) throw new Error("A document's name is lowercase letters, digits and dashes, like q3-report.");
    }
    const dest = path.join(path.dirname(loc.abs), next);
    if (lstatOrNull(dest) && !sameEntry(dest, loc.abs)) throw new Error(`There is already a file called "${next}" here.`);
    fs.renameSync(loc.abs, dest);
    return loc.segs.slice(0, -1).join("/");
  }

  function transfer(slug, kind, paths, to) {
    const picked = pathList(paths);
    const dest = locate(slug, to);
    if (!isDir(dest.abs)) throw new Error(lstatOrNull(dest.abs) ? "That isn't a folder." : "That folder isn't there.");
    if (dest.root === "Trash") throw new Error("Use Trash to throw things away, and Restore to bring them back.");
    const copying = kind === "copy";
    const todo = [];
    for (const p of picked) {
      const src = locate(slug, p);
      const label = src.segs.at(-1);
      if (src.isRoot) throw new Error("Files, Documents, Downloads and Trash can't be moved or copied.");
      if (src.root === "Trash") throw new Error("Restore it first. Trash items can't be moved or copied.");
      if (!lstatOrNull(src.abs)) throw new Error(`"${label}" isn't there any more.`);
      if (src.root === "Documents") {
        if (!copying) throw new Error("A document stays in Documents. Copy it instead, or rename it.");
        if (!docInfo(src.abs, label)) throw new Error("That isn't a document.");
      }
      if (dest.root === "Documents" && src.root !== "Documents") throw new Error("Documents holds documents only. Only a document can go there.");
      if (dest.abs === src.abs || dest.abs.startsWith(src.abs + path.sep)) throw new Error("A folder can't go inside itself.");
      if (!copying && path.dirname(src.abs) === dest.abs) continue;
      todo.push(src);
    }
    if (copying) {
      const sizes = todo.map((s) => treeStat(s.abs));
      if (sizes.some((s) => s.links)) throw link();
      assertRoom(slug, sizes.reduce((n, s) => n + s.bytes, 0));
    }
    for (const src of todo) {
      const target = path.join(dest.abs, freeName(dest.abs, src.segs.at(-1), dest.root === "Documents"));
      if (copying) copyTree(src.abs, target);
      else fs.renameSync(src.abs, target);
    }
    usedCache.delete(slug);
    return dest.segs.join("/");
  }

  function trash(slug, paths) {
    const items = pathList(paths).map((p) => {
      const loc = locate(slug, p);
      if (loc.isRoot) throw new Error("Files, Documents, Downloads and Trash can't be thrown away.");
      if (loc.root === "Trash") throw new Error(`"${loc.segs.at(-1)}" is already in Trash.`);
      if (!lstatOrNull(loc.abs)) throw new Error(`"${loc.segs.at(-1)}" isn't there any more.`);
      return loc;
    });
    const base = items[0].base;
    const dir = path.join(base, "trash");
    const index = readIndex(base);
    const now = new Date().toISOString();
    for (const loc of items) {
      if (!lstatOrNull(loc.abs)) throw new Error(`"${loc.segs.at(-1)}" isn't there any more.`);
      const name = freeName(dir, loc.segs.at(-1), false);
      fs.renameSync(loc.abs, path.join(dir, name));
      index.push({ name, from: loc.segs.join("/"), at: now });
      writeIndex(base, index);
    }
    return items[0].segs.slice(0, -1).join("/");
  }

  /** Puts trashed items back where they came from (or in Files when that is gone or taken by a document rule). */
  function restore(slug, paths) {
    const base = botFolder(slug);
    const trashDir = path.join(base, "trash");
    let index = readIndex(base);
    for (const p of pathList(paths)) {
      const segs = splitPath(p);
      if (segs[0] !== "Trash" || segs.length !== 2) throw new Error("Pick items in Trash to restore.");
      const name = segs[1];
      const src = path.join(trashDir, name);
      if (!lstatOrNull(src)) throw new Error(`"${name}" isn't in Trash any more.`);
      const isDoc = isDir(src) && !!docInfo(src, name);
      let origin = originOf(index.find((r) => r.name === name)?.from);
      if (origin && origin[0] === "Documents" && (origin.length !== 2 || !F.isSlug(origin[1]) || !isDoc)) origin = null;
      if (!origin) origin = ["Files", name];
      let parent = locate(slug, origin.slice(0, -1).join("/"));
      if (lstatOrNull(parent.abs) && !isDir(parent.abs)) {
        origin = ["Files", name];
        parent = locate(slug, "Files");
      }
      const finalName = checkName(origin.at(-1));
      fs.mkdirSync(parent.abs, { recursive: true });
      const target = path.join(parent.abs, freeName(parent.abs, finalName, parent.root === "Documents"));
      fs.renameSync(src, target);
      index = index.filter((r) => r.name !== name);
      writeIndex(base, index);
    }
    usedCache.delete(slug);
    return "Trash";
  }

  function emptyTrash(slug) {
    const base = botFolder(slug);
    const dir = path.join(base, "trash");
    for (const name of readdirSafe(dir)) {
      if (name === TRASH_INDEX) continue;
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
    writeIndex(base, []);
    usedCache.delete(slug);
    return "Trash";
  }

  /** Writes files into a checked folder of the bot's disk: names made unique, the quota and the size limit checked first. Returns each saved name and size. */
  function writeImports(slug, dest, files) {
    if (!Array.isArray(files) || !files.length) throw new Error("Pick files to import.");
    if (files.length > MAX_PATHS) throw new Error(`Import at most ${MAX_PATHS} files at once.`);
    const prepared = files.map((f) => {
      if (!f || typeof f !== "object") throw new Error("A file to import is a name and its bytes.");
      const size = byteSize(f.bytes);
      const name = cleanName(f.name);
      if (size > IMPORT_MAX) throw new Error(`${name} is larger than 200 MB.`);
      return { name, bytes: f.bytes, size };
    });
    assertRoom(slug, prepared.reduce((n, f) => n + f.size, 0));
    return prepared.map((f) => {
      const name = freeName(dest.abs, f.name, false);
      fs.writeFileSync(path.join(dest.abs, name), toBuffer(f.bytes), { flag: "wx" });
      return { name, size: f.size };
    });
  }

  function importFiles(slug, to, files) {
    const dest = locate(slug, to);
    if (dest.root === "Documents") throw new Error("Documents holds documents only. Drop files into Files or Downloads.");
    if (dest.root === "Trash") throw new Error("Drop files into Files or Downloads, not Trash.");
    if (!isDir(dest.abs)) throw new Error("That folder isn't there.");
    writeImports(slug, dest, files);
    usedCache.delete(slug);
    return dest.segs.join("/");
  }

  /** Saves files a person attached to a message into Files/Inbox (made if missing), before the bot's run starts. Returns each file's disk path, name, size and absolute path. */
  function inbox(slug, files) {
    prepare(slug);
    const dest = locate(slug, INBOX);
    fs.mkdirSync(dest.abs, { recursive: true });
    const saved = writeImports(slug, dest, files);
    usedCache.delete(slug);
    broadcast("crew:disk", { slug });
    return saved.map((f) => ({ path: `${INBOX}/${f.name}`, name: f.name, size: f.size, abs: path.join(dest.abs, f.name) }));
  }

  /** Runs one operation on the bot's disk. Returns the listing of the folder it affected; tells the windows. */
  function op(slug, o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error('Say what to do, like { op: "mkdir", path: "Files/notes" }.');
    prepare(slug);
    let folder;
    try {
      switch (o.op) {
        case "mkdir":
          folder = mkdir(slug, o.path);
          break;
        case "rename":
          folder = rename(slug, o.path, o.name);
          break;
        case "move":
        case "copy":
          folder = transfer(slug, o.op, o.paths, o.to);
          break;
        case "trash":
          folder = trash(slug, o.paths);
          break;
        case "restore":
          folder = restore(slug, o.paths);
          break;
        case "emptyTrash":
          folder = emptyTrash(slug);
          break;
        case "import":
          folder = importFiles(slug, o.to, o.files);
          break;
        default:
          throw new Error(`There is no "${String(o.op).slice(0, 40)}" operation. Use mkdir, rename, move, copy, trash, restore, emptyTrash or import.`);
      }
    } finally {
      usedCache.delete(slug);
      broadcast("crew:disk", { slug });
    }
    return list(slug, folder);
  }

  /** The address the page loads a file from: crewfile://<slug>/<disk path>. Files only. */
  function url(slug, p) {
    const loc = locate(slug, p);
    const st = lstatOrNull(loc.abs);
    if (!st) throw new Error("That file isn't there any more.");
    if (!st.isFile()) throw new Error("Only files have an address.");
    return `crewfile://${slug}/${loc.segs.map((s) => encodeURIComponent(s)).join("/")}`;
  }

  /** A quota in GB for a bot's disk. Only the sizes the person can choose; throws when the disk holds more than that. */
  function setQuota(slug, gb) {
    prepare(slug);
    if (!DISK_QUOTAS_GB.includes(gb)) throw new Error(`A bot's disk is ${DISK_QUOTAS_GB.join(", ")} GB.`);
    const inUse = used(slug, true);
    if (inUse > gb * GB) throw new Error(`This bot's disk holds ${sizeText(inUse)}, more than ${gb} GB. Empty some space first.`);
    const saved = readQuotas();
    saved[slug] = gb;
    writeAtomic(settingsFile, `${JSON.stringify(saved, null, 2)}\n`);
    broadcast("crew:disk", { slug });
    return list(slug, "");
  }

  /** A file on the bot's disk that may be copied to the person's computer: a file in Files or Downloads. Throws with what to do otherwise. */
  function exportable(slug, p) {
    const loc = locate(slug, p);
    if (loc.root === "Documents") throw new Error("A Fenna document can't be copied to this computer.");
    if (loc.root === "Trash") throw new Error("Restore it from Trash first.");
    const st = lstatOrNull(loc.abs);
    if (!st) throw new Error("That file isn't there any more.");
    if (loc.isRoot || !st.isFile()) throw new Error("Only files can be copied to this computer.");
    return { abs: loc.abs, name: path.basename(loc.abs) };
  }

  /** A name in `dir` that is free on disk and not claimed by this hand-off yet, and claims it: "a.txt", then "a (2).txt"; a slug for documents. */
  function claimName(dir, name, slugStyle, claimed) {
    const takenAt = (n) => !!lstatOrNull(path.join(dir, n)) || claimed.has(path.join(dir, n));
    let n = name;
    if (slugStyle) {
      const claimedHere = [...claimed].filter((c) => path.dirname(c) === dir).map((c) => path.basename(c));
      n = F.uniqueSlug(name, [...readdirSafe(dir), ...claimedHere]);
    } else {
      const dot = name.lastIndexOf(".");
      const ext = dot > 0 ? name.slice(dot) : "";
      const stem = ext ? name.slice(0, dot) : name;
      for (let i = 2; takenAt(n); i++) {
        const tail = ` (${i})${ext}`;
        n = `${stem.slice(0, NAME_MAX - tail.length)}${tail}`;
      }
    }
    claimed.add(path.join(dir, n));
    return n;
  }

  /**
   * Walks a file or folder for a hand-off, in order (a folder before what is in it): the files and folders to make,
   * counted against the file limit as it goes so a huge folder stops early. Links are refused; names hidden on
   * the disk are skipped.
   */
  function gather(abs, to, fromPath, toPath, entries, tally) {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) throw link();
    if (st.isDirectory()) {
      entries.push({ dir: to });
      for (const name of readdirSafe(abs)) {
        if (nameOk(name)) gather(path.join(abs, name), path.join(to, name), `${fromPath}/${name}`, `${toPath}/${name}`, entries, tally);
      }
      return;
    }
    if (!st.isFile()) return;
    tally.files++;
    tally.bytes += st.size;
    if (tally.files > F.LIMITS.handoffFiles) throw new Error(`These come to more than ${F.LIMITS.handoffFiles} files. A hand-off carries at most ${F.LIMITS.handoffFiles} files; send fewer.`);
    entries.push({ abs, to, fromPath, toPath, size: st.size });
  }

  /**
   * Copies files, folders and Fenna documents from one bot's disk to another's, for a hand-off. Files and folders
   * go to the receiver's Files/From <sender>/ (a clash gets " (2)"); a Fenna document goes to its Documents as a
   * copy under a free slug. Nothing is moved, and every path is checked on the sender's disk. All or nothing: the
   * file count, the bytes and the receiver's room are checked before anything is written, and a copy that fails
   * part way is taken back. names: { from, to }, the bots' names for the folder and the messages.
   * @returns {{ files: { name: string, size: number, fromPath: string, toPath: string }[] }}
   */
  function handOff(fromSlug, toSlug, paths, names) {
    const picked = pathList(paths);
    prepare(fromSlug);
    const toBase = prepare(toSlug);
    const folder = `From ${cleanName(names.from)}`;
    const filesDir = path.join(toBase, ...ROOT_PATH.Files, folder);
    const libDir = path.join(toBase, ...ROOT_PATH.Documents);
    const claimed = new Set();
    const tally = { files: 0, bytes: 0 };
    const entries = [];
    let toFiles = false;
    for (const p of picked) {
      const src = locate(fromSlug, p);
      const label = src.segs.at(-1);
      if (src.isRoot) throw new Error("Files, Documents, Downloads and Trash can't be handed over. Pick the files or folders in them.");
      if (src.root === "Trash") throw new Error(`"${label}" is in Trash. Restore it first, then hand it over.`);
      if (!lstatOrNull(src.abs)) throw new Error(`"${label}" isn't there any more.`);
      if (src.root === "Documents") {
        if (src.rest.length !== 1 || !docInfo(src.abs, label)) throw new Error(`"${label}" isn't a document. Documents hands over whole documents only.`);
        const name = claimName(libDir, label, true, claimed);
        gather(src.abs, path.join(libDir, name), p, `Documents/${name}`, entries, tally);
      } else {
        toFiles = true;
        const name = claimName(filesDir, label, false, claimed);
        gather(src.abs, path.join(filesDir, name), p, `Files/${folder}/${name}`, entries, tally);
      }
    }
    const maxBytes = F.LIMITS.handoffMB * MB;
    if (tally.bytes > maxBytes) throw new Error(`These files come to ${sizeText(tally.bytes)}. A hand-off carries at most ${F.LIMITS.handoffMB} MB; send fewer or smaller files.`);
    const free = Math.max(0, quota(toSlug) - used(toSlug, true));
    if (tally.bytes > free) throw new Error(`${names.to}'s disk has ${sizeText(free)} free, and these files need ${sizeText(tally.bytes)}. Nothing was copied; send less, or free some space on its disk.`);
    if (toFiles && lstatOrNull(filesDir) && !isDir(filesDir)) throw new Error(`There is already a file called "${folder}" in ${names.to}'s Files. Ask the person to rename it.`);
    const made = [];
    try {
      if (toFiles && !lstatOrNull(filesDir)) {
        fs.mkdirSync(filesDir, { recursive: true });
        made.push(filesDir);
      }
      for (const e of entries) {
        if (e.dir !== undefined) {
          if (!lstatOrNull(e.dir)) {
            fs.mkdirSync(e.dir);
            made.push(e.dir);
          }
        } else {
          fs.copyFileSync(e.abs, e.to, fs.constants.COPYFILE_EXCL);
          made.push(e.to);
        }
      }
    } catch (err) {
      for (const p of made.reverse()) fs.rmSync(p, { recursive: true, force: true });
      usedCache.delete(toSlug);
      throw err;
    }
    usedCache.delete(toSlug);
    broadcast("crew:disk", { slug: toSlug });
    const files = entries.filter((e) => e.abs !== undefined);
    return { files: files.map((e) => ({ name: e.toPath.split("/").pop(), size: e.size, fromPath: e.fromPath, toPath: e.toPath })) };
  }

  /** A new Fenna document in the bot's Documents. Its folder is named from the title. */
  function newDoc(slug, kind, title) {
    const base = prepare(slug);
    if (!DOC_KINDS.includes(kind)) throw new Error(`A document is one of: ${DOC_KINDS.join(", ")}.`);
    const t = typeof title === "string" ? title.trim() : "";
    if (t.length > 200) throw new Error(`The title is ${t.length} characters; the most is 200.`);
    const label = t || `Untitled ${kind}`;
    const lib = path.join(base, "library");
    const name = F.uniqueSlug(/[a-z0-9]/i.test(label) ? label : `Untitled ${kind}`, readdirSafe(lib));
    const folder = path.join(lib, name);
    fs.mkdirSync(folder);
    try {
      for (const [rel, text] of Object.entries(starterFiles(kind, label))) {
        const file = path.resolve(folder, rel);
        if (path.relative(folder, file).startsWith("..")) throw new Error(OUTSIDE);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text, "utf8");
      }
    } catch (e) {
      fs.rmSync(folder, { recursive: true, force: true });
      throw e;
    }
    usedCache.delete(slug);
    broadcast("crew:disk", { slug });
    return { path: name };
  }

  /** Call before the app is ready: crewfile:// is a standard, secure scheme that can stream. */
  function registerScheme(protocol) {
    protocol.registerSchemesAsPrivileged([{ scheme: "crewfile", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
  }

  /**
   * Serves a file with Range support (video and audio seek). Sandboxed, so a page a bot made can't run script from it.
   * Readable by fetch only from Crew's own page (the built page's origin is file:// or "null"; the dev server is on localhost).
   */
  function serve(request, file, size, type) {
    const origin = request.headers.get("origin");
    const readable = origin === "null" || origin === "file://" || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "");
    const headers = {
      ...(readable ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
      "content-type": type,
      "accept-ranges": "bytes",
      "content-security-policy": "sandbox",
      "x-content-type-options": "nosniff",
      "cache-control": "no-cache",
    };
    let start = 0;
    let end = size - 1;
    let status = 200;
    const range = request.headers.get("range");
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      const unsatisfiable = () => new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
      if (!m || (m[1] === "" && m[2] === "")) return unsatisfiable();
      if (m[1] === "") start = Math.max(0, size - Number(m[2]));
      else {
        start = Number(m[1]);
        if (m[2] !== "") end = Math.min(Number(m[2]), size - 1);
      }
      if (start >= size || end < start) return unsatisfiable();
      status = 206;
      headers["content-range"] = `bytes ${start}-${end}/${size}`;
    }
    const length = Math.max(0, end - start + 1);
    headers["content-length"] = String(length);
    const body = request.method === "HEAD" || length === 0 ? null : Readable.toWeb(fs.createReadStream(file, { start, end }));
    return new Response(body, { status, headers });
  }

  const typeOf = (file) => TYPE_OF_EXT[path.extname(file).slice(1).toLowerCase()] || "application/octet-stream";
  const plain = (status, message) => new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

  /** Call after the app is ready: serves crewfile://<slug>/<disk path> for files only. */
  function handleScheme(protocol) {
    protocol.handle("crewfile", (request) => {
      try {
        const u = new URL(request.url);
        const segs = u.pathname.split("/").slice(1).map((s) => decodeURIComponent(s));
        const loc = locate(u.hostname, segs.join("/"));
        const st = lstatOrNull(loc.abs);
        if (!st || !st.isFile()) return plain(404, "There is no file here.");
        return serve(request, loc.abs, st.size, typeOf(loc.abs));
      } catch (e) {
        return plain(404, e.message);
      }
    });
  }

  return {
    /** Where a disk path lives ({ abs, root, rest, isRoot, base }); throws if it is outside the bot's disk or goes through a link. */
    locate: (slug, p) => {
      prepare(slug);
      return locate(slug, p);
    },
    list,
    op,
    inbox,
    url,
    setQuota,
    quota,
    exportable,
    used: (slug) => used(slug),
    free: (slug, fresh = false) => Math.max(0, quota(slug) - used(slug, fresh)),
    newDoc,
    handOff,
    registerScheme,
    handleScheme,
  };
}

/** Bytes free on the drive a folder is on. 0 when it can't be read, so nothing is saved there. */
function freeOnDrive(dir) {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return 0;
  }
}

module.exports = { createDisk, freeOnDrive, DISK_ROOTS, DISK_QUOTAS_GB, IMPORT_MAX, INBOX, kindOf, sizeText };
