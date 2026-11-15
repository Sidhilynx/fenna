// design.json, and a whole design folder read into memory.
//
// design.json holds what is about the design, not one artboard: its title,
// pages, where each artboard sits on the canvas and in what order they are
// shown, the tweaks (CSS variables every artboard gets) and the named text
// styles.

import { type ValueContext, color, length, parseStyle } from "@opendeck/format";
import { type ArtboardDoc, type ArtboardTheme, type Diagnostic, parseArtboard } from "./artboard.ts";
import { DEFAULT_TEXT_STYLES, FILE_RE, FORMAT, LIMITS, PROPERTIES, TWEAK_RE } from "./schema.ts";

export interface DesignPage {
  id: string;
  name: string;
}

/** Where an artboard sits. `w` and `h` are its size in px; the root element's width and height follow them. */
export interface DesignBoard {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  page: string;
  expand?: "fit" | "fill";
}

export interface DesignIndex {
  format: typeof FORMAT;
  title: string;
  pages: DesignPage[];
  /** By file name inside artboards/. */
  boards: Record<string, DesignBoard>;
  /** Every artboard file once: the order they are listed, shown and exported in. */
  order: string[];
  tweaks: Record<string, string>;
  textStyles: Record<string, string>;
  fonts: string[];
}

export interface Problem {
  where: string;
  message: string;
}

/** A saved version: everything needed to put the design back. */
export interface HistoryEntry {
  id: string;
  at: number;
  author: string;
  label: string;
  index: DesignIndex;
  /** Each artboard's file text, by file name. */
  files: Record<string, string>;
  notes: string;
}

export interface LoadedBoard {
  file: string;
  /** Null when the file can't be read as an artboard; `source` is then left alone on disk. */
  doc: ArtboardDoc | null;
  source: string;
  diagnostics: Diagnostic[];
  /** Why it can't be shown, in one line. */
  broken: string | null;
}

export interface LoadedDesign {
  index: DesignIndex;
  boards: Map<string, LoadedBoard>;
  problems: Problem[];
  /** design.json itself can't be read: nothing may be saved over it. */
  broken: string | null;
}

const NO_CTX: ValueContext = { colorTokens: new Set(), families: new Set() };
const PAGE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clampSize = (v: unknown, dflt: number) => (finite(v) && v > 0 ? Math.min(LIMITS.maxSize, Math.max(LIMITS.minSize, Math.round(v))) : dflt);

/** Is `value` something a tweak may hold: a color or a length. */
export const tweakProblem = (value: string): string | null => (color(value, NO_CTX) === null || length(-LIMITS.maxSize, LIMITS.maxSize)(value, NO_CTX) === null ? null : "a tweak is a color (#hex, rgb(), hsl()) or a length (16px)");

/** Why a named text style's declarations are refused, or null. */
export function textStyleProblem(decls: string): string | null {
  const parsed = parseStyle(decls);
  if (parsed.errors.length) return parsed.errors[0]!;
  for (const d of parsed.decls) {
    const spec = PROPERTIES[d.name];
    if (!spec || spec.group !== "text") return `${d.name} is not a text property`;
    const bad = spec.check(d.value, NO_CTX);
    if (bad) return `${d.name}: ${bad}`;
  }
  return null;
}

export function emptyIndex(title = "Untitled design"): DesignIndex {
  return { format: FORMAT, title, pages: [{ id: "page-1", name: "Page 1" }], boards: {}, order: [], tweaks: { "--accent": "#d97757" }, textStyles: { ...DEFAULT_TEXT_STYLES }, fonts: ["Inter"] };
}

/** design.json read leniently: what can be kept is kept, the rest is reported. */
export function checkIndex(raw: unknown, fallbackTitle = "Untitled design"): { index: DesignIndex; problems: Problem[] } {
  const problems: Problem[] = [];
  const say = (message: string) => problems.push({ where: "design.json", message });
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (obj !== raw) say("design.json must be a JSON object");
  if (obj.format !== undefined && obj.format !== FORMAT) say(`format is "${String(obj.format)}"; this app reads ${FORMAT}`);

  const index = emptyIndex(typeof obj.title === "string" && obj.title.trim() ? obj.title.trim().slice(0, LIMITS.titleChars) : fallbackTitle);

  if (Array.isArray(obj.pages)) {
    const pages: DesignPage[] = [];
    for (const p of obj.pages.slice(0, LIMITS.maxPages) as Record<string, unknown>[]) {
      if (!p || typeof p !== "object") continue;
      const id = typeof p.id === "string" && PAGE_ID_RE.test(p.id) && !pages.some((x) => x.id === p.id) ? p.id : newPageId(pages);
      pages.push({ id, name: typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, LIMITS.titleChars) : `Page ${pages.length + 1}` });
    }
    if (pages.length) index.pages = pages;
  }
  const pageIds = new Set(index.pages.map((p) => p.id));

  if (obj.boards && typeof obj.boards === "object" && !Array.isArray(obj.boards)) {
    for (const [file, value] of Object.entries(obj.boards as Record<string, unknown>)) {
      if (!FILE_RE.test(file)) {
        say(`"${file}" is not an artboard file name (letters, digits, . _ - and .html)`);
        continue;
      }
      if (Object.keys(index.boards).length >= LIMITS.maxArtboards) {
        say(`a design holds at most ${LIMITS.maxArtboards} artboards; the rest are not shown`);
        break;
      }
      const b = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      index.boards[file] = {
        x: finite(b.x) ? Math.round(b.x) : 0,
        y: finite(b.y) ? Math.round(b.y) : 0,
        w: clampSize(b.w, 800),
        h: clampSize(b.h, 600),
        title: typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, LIMITS.titleChars) : file.replace(/\.html$/i, ""),
        page: typeof b.page === "string" && pageIds.has(b.page) ? b.page : index.pages[0]!.id,
        ...(b.expand === "fill" || b.expand === "fit" ? { expand: b.expand } : {}),
      };
    }
  }

  const listed = Array.isArray(obj.order) ? obj.order.filter((f): f is string => typeof f === "string" && f in index.boards) : [];
  index.order = [...new Set(listed)];
  for (const f of Object.keys(index.boards)) if (!index.order.includes(f)) index.order.push(f);

  if (obj.tweaks !== undefined) {
    index.tweaks = {};
    if (obj.tweaks && typeof obj.tweaks === "object" && !Array.isArray(obj.tweaks)) {
      for (const [k, v] of Object.entries(obj.tweaks as Record<string, unknown>)) {
        const name = k.startsWith("--") ? k : `--${k}`;
        if (!TWEAK_RE.test(name)) say(`tweak "${k}" needs a name like --accent (lowercase letters, digits and -)`);
        else if (typeof v !== "string" || tweakProblem(v.trim())) say(`tweak ${name} is "${String(v)}"; ${tweakProblem("") ?? ""}`);
        else index.tweaks[name] = v.trim();
      }
    }
  }

  if (obj.textStyles && typeof obj.textStyles === "object" && !Array.isArray(obj.textStyles)) {
    index.textStyles = {};
    for (const [k, v] of Object.entries(obj.textStyles as Record<string, unknown>)) {
      const name = k.trim().slice(0, 40);
      const bad = typeof v !== "string" ? "it must be CSS declarations" : !name || /["\\\]]/.test(name) ? "its name can't hold quotes or brackets" : textStyleProblem(v);
      if (bad) say(`text style "${k}" is not used: ${bad}`);
      else index.textStyles[name] = (v as string).trim();
    }
  }

  if (Array.isArray(obj.fonts)) index.fonts = obj.fonts.filter((f): f is string => typeof f === "string" && /^[A-Za-z][A-Za-z0-9 -]{0,39}$/.test(f.trim())).map((f) => f.trim());
  return { index, problems };
}

export const indexText = (index: DesignIndex): string => JSON.stringify(index, null, 2) + "\n";

export const themeOf = (index: DesignIndex): ArtboardTheme => ({ tweaks: index.tweaks, textStyles: index.textStyles });

/** What a value may refer to in this design: its tweaks and fonts. */
export const designContext = (index: DesignIndex): ValueContext => ({ colorTokens: new Set(Object.keys(index.tweaks).map((k) => k.slice(2))), families: new Set(index.fonts) });

export function newPageId(pages: readonly DesignPage[]): string {
  for (let n = pages.length + 1; ; n++) if (!pages.some((p) => p.id === `page-${n}`)) return `page-${n}`;
}

/** A file name for a new artboard called `title`, not taken in the design. */
export function fileFor(title: string, index: DesignIndex): string {
  const base = title.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "Artboard";
  if (!(`${base}.html` in index.boards)) return `${base}.html`;
  for (let n = 2; ; n++) if (!(`${base}-${n}.html` in index.boards)) return `${base}-${n}.html`;
}

const GAP = 80;

/** Where a new w×h artboard goes on a page: right of the last one in its row, clear of every other. */
export function placeBeside(index: DesignIndex, page: string, w: number, h: number): { x: number; y: number } {
  const on = Object.values(index.boards).filter((b) => b.page === page);
  if (!on.length) return { x: GAP, y: GAP };
  const y = Math.min(...on.map((b) => b.y));
  let x = Math.max(...on.map((b) => b.x + b.w)) + GAP;
  const hits = (b: DesignBoard) => x < b.x + b.w + GAP && x + w + GAP > b.x && y < b.y + b.h + GAP && y + h + GAP > b.y;
  for (let blocker = on.find(hits); blocker; blocker = on.find(hits)) x = blocker.x + blocker.w + GAP;
  return { x, y };
}

/** The files of a new design: no artboards yet. */
export function newDesignFiles(title: string): Record<string, string> {
  return {
    "design.json": indexText(emptyIndex(title.trim().slice(0, LIMITS.titleChars) || "Untitled design")),
    "notes.json": '{\n  "items": []\n}\n',
  };
}

export function parseHistory(text: string | null): HistoryEntry[] {
  if (!text) return [];
  try {
    const list = JSON.parse(text) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter((v): v is HistoryEntry => !!v && typeof v.id === "string" && finite(v.at) && typeof v.author === "string" && typeof v.label === "string" && !!v.index && !!v.files && typeof v.files === "object")
      .map((v) => ({ id: v.id, at: v.at, author: v.author, label: v.label, index: checkIndex(v.index).index, files: v.files, notes: typeof v.notes === "string" ? v.notes : "" }));
  } catch {
    return [];
  }
}

/** One artboard's text read as the design sees it. */
export function loadBoard(file: string, source: string | null, index: DesignIndex): LoadedBoard {
  if (source === null) {
    const message = `artboards/${file} is missing`;
    return { file, doc: null, source: "", diagnostics: [{ severity: "error", code: "missing-file", message, line: 1, col: 1, path: "" }], broken: message };
  }
  const r = parseArtboard(source, designContext(index));
  const first = r.diagnostics.find((d) => d.severity === "error");
  return { file, doc: r.ok ? r.doc : null, source, diagnostics: r.diagnostics, broken: first ? `line ${first.line}: ${first.message}` : null };
}

/** Read a design through `read` (a path inside the folder → its text, or null). */
export function loadDesign(read: (rel: string) => string | null, fallbackTitle = "Untitled design"): LoadedDesign {
  const problems: Problem[] = [];
  const text = read("design.json");
  let raw: unknown = {};
  let broken: string | null = null;
  if (text === null) broken = "design.json is missing";
  else {
    try {
      raw = JSON.parse(text);
    } catch (e) {
      broken = `design.json is not valid JSON (${(e as Error).message})`;
    }
  }
  if (broken) problems.push({ where: "design.json", message: broken });
  const checked = checkIndex(raw, fallbackTitle);
  if (!broken) problems.push(...checked.problems);
  const boards = new Map<string, LoadedBoard>();
  for (const file of checked.index.order) {
    const board = loadBoard(file, read(`artboards/${file}`), checked.index);
    boards.set(file, board);
    for (const d of board.diagnostics) if (d.severity === "error") problems.push({ where: `${file}:${d.line}`, message: d.message });
  }
  return { index: checked.index, boards, problems, broken };
}

export function newId(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
