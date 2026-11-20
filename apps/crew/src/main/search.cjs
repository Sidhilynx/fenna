// Search a bot's disk: names in Files, Documents and Downloads (never Trash),
// and the text inside text files and Fenna documents. The walk goes through
// disk.list and disk.locate, so every path gets the disk's own checks: links
// are never followed, dotfiles are skipped, and nothing outside the bot's
// folder is read. Hits come back as the entries disk.list builds.

const fs = require("node:fs");
const path = require("node:path");

const SEARCH_ROOTS = ["Files", "Documents", "Downloads"];
const TEXT_KINDS = ["text", "code"];
const TABLE_TEXT_EXT = [".csv", ".tsv"];
const DOC_KINDS = ["doc", "sheet", "deck", "board", "design"];
const TEXT_MAX = 2 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const BUDGET_MS = 3_000;
const LIMIT = 50;
const MAX_LIMIT = 200;
const SNIPPET = 120;
const LEAD = 40;
const JSON_TEXT_KEYS = ["text", "title", "label"];

const lower = (s) => s.toLowerCase();

/** Where every word is found in the lowered text: the earliest position, or -1 when one word is missing. */
function matchAt(lowered, words) {
  let first = -1;
  for (const w of words) {
    const i = lowered.indexOf(w);
    if (i < 0) return -1;
    if (first < 0 || i < first) first = i;
  }
  return first;
}

/** About 120 characters of flat text around a match, with ellipses where cut. */
function snippetAt(flat, at) {
  const start = Math.max(0, at - LEAD);
  const end = Math.min(flat.length, start + SNIPPET);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}

/** Visible text of an HTML file: scripts and styles dropped, tags out, common entities decoded. */
function htmlText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** The text fields of a JSON file (text, title, label), in the order they appear. */
function jsonText(raw) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string" && JSON_TEXT_KEYS.includes(k)) out.push(x);
      else walk(x);
    }
  };
  walk(JSON.parse(raw));
  return out.join("\n");
}

/** The cell values of every sheet in a sheet's sheets/ folder, in the cell order the file keeps. */
function sheetText(raw) {
  return Object.values(JSON.parse(raw).cells ?? {})
    .map((c) => (c && (typeof c.v === "string" || typeof c.v === "number") ? String(c.v) : ""))
    .filter(Boolean)
    .join("\n");
}

/** A file's text, or null when it is missing, a link, not a file, or over the size limit. */
function readText(file, max = TEXT_MAX) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > max) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** The files of a folder whose names end in ext, sorted. A link or a missing folder gives none. */
function filesIn(dir, ext) {
  try {
    if (!fs.lstatSync(dir).isDirectory()) return [];
    return fs
      .readdirSync(dir)
      .filter((n) => !n.startsWith(".") && n.endsWith(ext))
      .sort()
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

/** The searchable text of a Fenna document folder, by its kind. */
function documentText(kind, dir) {
  const parts = [];
  const take = (files, read) => {
    for (const file of files) {
      const raw = readText(file);
      if (raw === null) continue;
      try {
        parts.push(read(raw));
      } catch {
        // A broken file has no text to find; the rest of the document still counts.
      }
    }
  };
  if (kind === "doc") take(filesIn(path.join(dir, "tabs"), ".html"), htmlText);
  if (kind === "deck") take(filesIn(path.join(dir, "slides"), ".html"), htmlText);
  if (kind === "sheet") take(filesIn(path.join(dir, "sheets"), ".json"), sheetText);
  if (kind === "board") take([path.join(dir, "canvas.json")], jsonText);
  if (kind === "design") {
    take([path.join(dir, "design.json")], jsonText);
    take(filesIn(path.join(dir, "artboards"), ".html"), htmlText);
  }
  return parts.join("\n");
}

/**
 * @param {object} o
 * @param {ReturnType<import("./disk.cjs").createDisk>} o.disk
 * @param {() => number} [o.now]  the clock (tests set it)
 * @param {number} [o.maxEntries]  entries looked at before the walk stops
 * @param {number} [o.budgetMs]  time before the walk stops
 */
function createSearch({ disk, now = () => Date.now(), maxEntries = MAX_ENTRIES, budgetMs = BUDGET_MS }) {
  /** The flat text of an entry that can be searched by its content, or null. */
  function contentOf(slug, e) {
    if (DOC_KINDS.includes(e.kind)) {
      return documentText(e.kind, disk.locate(slug, e.path).abs);
    }
    const textual = TEXT_KINDS.includes(e.kind) || (e.kind === "table" && TABLE_TEXT_EXT.includes(path.extname(e.name).toLowerCase()));
    if (!textual || e.size > TEXT_MAX) return null;
    const raw = readText(disk.locate(slug, e.path).abs);
    if (raw === null) return null;
    return path.extname(e.name).toLowerCase() === ".html" ? htmlText(raw) : raw;
  }

  /**
   * The hits for a query: every word in a name (name hits first), or every word in a file's text.
   * Newer first within each group. `under` limits the search to one folder.
   * @returns {{ entry: object, snippet?: string }[]}
   */
  function search(slug, query, { limit = LIMIT, under } = {}) {
    const words = lower(String(query ?? "")).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const cap = Number.isFinite(limit) ? Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT) : LIMIT;
    const roots = under ? [String(under)] : SEARCH_ROOTS;
    if (roots.some((r) => r.split("/")[0] === "Trash")) return [];

    const deadline = now() + budgetMs;
    const queue = [...roots];
    const named = [];
    const inText = [];
    let seen = 0;
    let listed = 0;
    let halted = false;

    while (queue.length && !halted) {
      const dir = queue.shift();
      let entries;
      try {
        entries = disk.list(slug, dir).entries;
      } catch (err) {
        // The folder the person named must be there; a folder that goes missing mid-walk is skipped.
        if (listed++ < roots.length) throw err;
        continue;
      }
      for (const e of entries) {
        if (seen >= maxEntries || now() > deadline) {
          halted = true;
          break;
        }
        seen++;
        if (e.kind === "folder") {
          queue.push(e.path);
          continue;
        }
        const label = e.title ? `${e.name} ${e.title}` : e.name;
        if (matchAt(lower(label), words) >= 0) {
          named.push({ entry: e });
          continue;
        }
        let flat = null;
        try {
          flat = contentOf(slug, e);
        } catch {
          flat = null;
        }
        if (flat === null) continue;
        flat = flat.replace(/\s+/g, " ").trim();
        const at = matchAt(lower(flat), words);
        if (at >= 0) inText.push({ entry: e, snippet: snippetAt(flat, at) });
      }
    }

    const newest = (a, b) => Date.parse(b.entry.edited) - Date.parse(a.entry.edited);
    return [...named.sort(newest), ...inText.sort(newest)].slice(0, cap);
  }

  return { search };
}

module.exports = { createSearch };
