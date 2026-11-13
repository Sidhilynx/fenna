// Reading and writing a board's files. Pure text in, text out, so the
// editor (in the browser) and the MCP server (in Node) share it.

import { DEFAULT_SETTINGS, FORMAT, LEGACY_FORMAT, LIMITS, type BoardItem, type BoardMeta, type BoardVersion, type ItemKind } from "./schema.ts";
import { checkItems, type Problem } from "./validate.ts";

export interface ParsedCanvas {
  items: BoardItem[];
  /** Entries that failed the check, written back untouched. */
  kept: unknown[];
  problems: Problem[];
  /** Why canvas.json can't be read at all; the file must not be saved over. */
  broken: string | null;
}

/** board.json. A missing or damaged file gives a usable board, titled from the folder. */
export function parseMeta(text: string | null, fallbackTitle: string): { meta: BoardMeta; problems: Problem[] } {
  const problems: Problem[] = [];
  let raw: Record<string, unknown> = {};
  if (text === null) problems.push({ where: "board.json", message: "board.json is missing; it will be written on the next change." });
  else {
    try {
      const v = JSON.parse(text);
      if (v && typeof v === "object" && !Array.isArray(v)) raw = v;
      else problems.push({ where: "board.json", message: "board.json is not an object." });
    } catch (e) {
      problems.push({ where: "board.json", message: `board.json is not valid JSON (${(e as Error).message}).` });
    }
  }
  if (raw.format !== undefined && raw.format !== FORMAT && raw.format !== LEGACY_FORMAT) problems.push({ where: "board.json", message: `This board is format ${String(raw.format)}; this app reads ${FORMAT}.` });
  const s = (raw.settings && typeof raw.settings === "object" ? raw.settings : {}) as Record<string, unknown>;
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, LIMITS.titleChars) : fallbackTitle;
  return {
    meta: {
      format: FORMAT,
      title,
      settings: {
        shortcuts: typeof s.shortcuts === "boolean" ? s.shortcuts : DEFAULT_SETTINGS.shortcuts,
        chime: typeof s.chime === "boolean" ? s.chime : DEFAULT_SETTINGS.chime,
      },
    },
    problems,
  };
}

/** canvas.json: { "items": [...] }. */
export function parseCanvas(text: string | null): ParsedCanvas {
  if (text === null) return { items: [], kept: [], problems: [], broken: null };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { items: [], kept: [], problems: [], broken: `canvas.json is not valid JSON (${(e as Error).message})` };
  }
  const list = data && typeof data === "object" && !Array.isArray(data) ? (data as { items?: unknown }).items : undefined;
  if (!Array.isArray(list)) return { items: [], kept: [], problems: [], broken: 'canvas.json has no "items" list' };
  if (list.length > LIMITS.items) return { items: [], kept: [], problems: [], broken: `canvas.json has ${list.length} items; the most a board holds is ${LIMITS.items}` };
  return { ...checkItems(list), broken: null };
}

export const metaText = (meta: BoardMeta) => `${JSON.stringify(meta, null, 2)}\n`;

/** One item per line: diffs stay readable and a big board stays small. */
export function canvasText(items: readonly BoardItem[], kept: readonly unknown[] = []): string {
  const all = [...items, ...kept];
  if (!all.length) return '{\n  "items": []\n}\n';
  return `{\n  "items": [\n${all.map((it) => `    ${JSON.stringify(it)}`).join(",\n")}\n  ]\n}\n`;
}

/** The files of a new, empty board. */
export function newBoardFiles(title: string): Record<string, string> {
  const meta: BoardMeta = { format: FORMAT, title: title.trim().slice(0, LIMITS.titleChars) || "Untitled board", settings: { ...DEFAULT_SETTINGS } };
  return { "board.json": metaText(meta), "canvas.json": canvasText([]) };
}

/** history.json, newest first; anything damaged is dropped. */
export function parseHistory(text: string | null): BoardVersion[] {
  if (!text) return [];
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return [];
    return arr.filter((v): v is BoardVersion => !!v && typeof v.id === "string" && typeof v.at === "number" && typeof v.author === "string" && typeof v.title === "string" && Array.isArray(v.items));
  } catch {
    return [];
  }
}

const PREFIX: Record<ItemKind, string> = { sticky: "s", text: "t", shape: "sh", frame: "f", connector: "c", drawing: "d", table: "tb", sticker: "st", image: "img" };

/** A short id for a new item of `kind`, not in `taken`. */
export function newId(kind: ItemKind, taken: { has(id: string): boolean }): string {
  for (;;) {
    const id = `${PREFIX[kind]}-${Math.random().toString(36).slice(2, 8)}`;
    if (!taken.has(id)) return id;
  }
}
