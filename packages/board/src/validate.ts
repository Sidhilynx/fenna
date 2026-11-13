// Checking items against the schema. Each problem says what is wrong and how
// to fix it, in words a person or a model can act on. Used when a board is
// read from disk and when the MCP server takes items from a model.

import {
  ALIGNS,
  CAPS,
  FILL_COLORS,
  INK_COLORS,
  ITEM_KINDS,
  KIND_FIELDS,
  LIMITS,
  LINE_STYLES,
  ROUTES,
  SHAPE_KINDS,
  SIDES,
  STICKER_IDS,
  TEXT_SIZES,
  type BoardItem,
  type End,
  type ItemKind,
} from "./schema.ts";

export interface Problem {
  /** Where: "items[3].color", "s-12.color", "canvas.json". */
  where: string;
  message: string;
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length]!;
}

/** The closest of `options` to `word`, if it is close. */
export function closest(word: string, options: readonly string[]): string | null {
  const w = word.toLowerCase();
  let best: string | null = null;
  let bestD = Infinity;
  for (const o of options) {
    const lo = o.toLowerCase();
    const d = lo.startsWith(w) || w.startsWith(lo) ? 1 : distance(w, lo);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best !== null && bestD <= Math.max(2, Math.floor(w.length / 3)) ? best : null;
}

const quote = (v: unknown) => (typeof v === "string" ? `"${v.length > 40 ? `${v.slice(0, 39)}…` : v}"` : JSON.stringify(v));

export function oneOfMessage(field: string, value: unknown, allowed: readonly string[]): string {
  const near = typeof value === "string" ? closest(value, allowed) : null;
  return `${field} ${quote(value)} is not one of the choices${near ? `; did you mean "${near}"?` : "."} Allowed: ${allowed.join(", ")}.`;
}

/** Common wrong names for fields, and the field meant. */
const ALIASES: Record<string, string[]> = {
  w: ["width"],
  h: ["height"],
  content: ["text"],
  text: ["title", "label"],
  label: ["text", "title"],
  name: ["title"],
  fontSize: ["size"],
  textSize: ["size"],
  textStyle: ["size"],
  fillColor: ["fill", "color"],
  background: ["fill", "color"],
  strokeColor: ["stroke"],
  border: ["stroke"],
  shapeKind: ["shape"],
  type: ["kind"],
  start: ["from"],
  end: ["to"],
  source: ["from"],
  target: ["to"],
  startArrow: ["startCap"],
  endArrow: ["endCap"],
  routing: ["route"],
  dashed: ["lineStyle"],
  angle: ["rotation"],
  parent: ["frame"],
  frameId: ["frame"],
  groupId: ["group"],
  url: ["link"],
  rows: ["cells"],
  emoji: ["sticker"],
  image: ["src"],
};

function fieldMessage(kind: ItemKind, key: string): string {
  const fields = KIND_FIELDS[kind];
  const near = ALIASES[key]?.find((a) => fields.includes(a)) ?? closest(key, fields);
  return `A ${kind} has no field "${key}"${near ? `; did you mean "${near}"?` : "."} A ${kind} takes: ${fields.join(", ")}.`;
}

type Raw = Record<string, unknown>;

class Checker {
  problems: Problem[] = [];
  readonly where: string;
  constructor(where: string) {
    this.where = where;
  }
  add(field: string, message: string) {
    this.problems.push({ where: field ? `${this.where}.${field}` : this.where, message });
  }
  num(o: Raw, k: string, opts: { required?: boolean; min?: number; max?: number } = {}) {
    const v = o[k];
    if (v === undefined) {
      if (opts.required) this.add(k, `${k} is missing; give a number.`);
      return;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) return this.add(k, `${k} must be a number, not ${quote(v)}.`);
    if (opts.min !== undefined && v < opts.min) this.add(k, `${k} is ${v}; it must be at least ${opts.min}.`);
    if (opts.max !== undefined && v > opts.max) this.add(k, `${k} is ${v}; it must be at most ${opts.max}.`);
  }
  str(o: Raw, k: string, max: number, required = false) {
    const v = o[k];
    if (v === undefined) {
      if (required) this.add(k, `${k} is missing; give text (it may be "").`);
      return;
    }
    if (typeof v !== "string") return this.add(k, `${k} must be text, not ${quote(v)}.`);
    if (v.length > max) this.add(k, `${k} is ${v.length} characters; the most is ${max}.`);
  }
  bool(o: Raw, k: string) {
    if (o[k] !== undefined && typeof o[k] !== "boolean") this.add(k, `${k} must be true or false, not ${quote(o[k])}.`);
  }
  oneOf(o: Raw, k: string, allowed: readonly string[], required = false) {
    const v = o[k];
    if (v === undefined) {
      if (required) this.add(k, `${k} is missing. Allowed: ${allowed.join(", ")}.`);
      return;
    }
    if (typeof v !== "string" || !allowed.includes(v)) this.add(k, oneOfMessage(k, v, allowed));
  }
  id(o: Raw, k: string) {
    const v = o[k];
    if (v !== undefined && (typeof v !== "string" || !ID_RE.test(v))) this.add(k, `${k} must be an item id (letters, digits, - and _), not ${quote(v)}.`);
  }
}

export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function checkEnd(c: Checker, o: Raw, k: "from" | "to") {
  const e = o[k];
  if (!e || typeof e !== "object" || Array.isArray(e)) return c.add(k, `${k} is missing or not an object; give {"item": "<id>"} to attach to an item, or {"x": 100, "y": 200} for a spot.`);
  const end = e as Raw;
  const keys = Object.keys(end);
  if ("item" in end) {
    if (typeof end.item !== "string" || !ID_RE.test(end.item)) c.add(`${k}.item`, `${k}.item must be an item id, not ${quote(end.item)}.`);
    if (end.side !== undefined && (typeof end.side !== "string" || !(SIDES as readonly string[]).includes(end.side))) c.add(`${k}.side`, oneOfMessage("side", end.side, SIDES));
    const extra = keys.filter((x) => x !== "item" && x !== "side");
    if (extra.length) c.add(k, `An end on an item takes item and side only, not ${extra.join(", ")}.`);
  } else {
    for (const a of ["x", "y"] as const) if (typeof end[a] !== "number" || !Number.isFinite(end[a])) c.add(`${k}.${a}`, `${k}.${a} must be a number; give {"item": "<id>"} or {"x": …, "y": …}.`);
    const extra = keys.filter((x) => x !== "x" && x !== "y");
    if (extra.length) c.add(k, `An end at a spot takes x and y only, not ${extra.join(", ")}${extra.includes("id") ? '; to attach to an item, use {"item": "<id>"}' : ""}.`);
  }
}

/** Problems with one item, as the file or a model gave it. Fields are checked against the kind's list. */
export function checkItem(raw: unknown, where: string): Problem[] {
  const c = new Checker(where);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    c.add("", "An item must be an object with an id and a kind.");
    return c.problems;
  }
  const o = raw as Raw;
  if (typeof o.id !== "string" || !ID_RE.test(o.id)) c.add("id", `id must be letters, digits, - and _ (up to 64), not ${quote(o.id)}.`);
  if (typeof o.kind !== "string" || !(ITEM_KINDS as readonly string[]).includes(o.kind)) {
    c.add("kind", oneOfMessage("kind", o.kind, ITEM_KINDS));
    return c.problems;
  }
  const kind = o.kind as ItemKind;
  for (const key of Object.keys(o)) {
    if (key === "id" || key === "kind" || KIND_FIELDS[kind].includes(key)) continue;
    c.add(key, fieldMessage(kind, key));
  }
  if (kind !== "connector") {
    c.num(o, "x", { required: true, min: -LIMITS.coord, max: LIMITS.coord });
    c.num(o, "y", { required: true, min: -LIMITS.coord, max: LIMITS.coord });
    c.num(o, "width", { required: true, min: kind === "drawing" || kind === "text" ? 1 : LIMITS.minSize, max: LIMITS.size });
    c.num(o, "height", { required: true, min: kind === "drawing" || kind === "text" ? 1 : LIMITS.minSize, max: LIMITS.size });
    c.num(o, "rotation", { min: -360, max: 360 });
    c.str(o, "link", LIMITS.linkChars);
  }
  c.bool(o, "locked");
  c.id(o, "frame");
  c.id(o, "group");
  for (const k of ["bold", "italic", "list"]) c.bool(o, k);
  c.oneOf(o, "size", TEXT_SIZES);
  c.oneOf(o, "align", ALIGNS);
  switch (kind) {
    case "sticky":
      c.str(o, "text", LIMITS.textChars, true);
      c.oneOf(o, "color", FILL_COLORS);
      c.str(o, "author", 80);
      break;
    case "text":
      c.str(o, "text", LIMITS.textChars, true);
      c.oneOf(o, "color", INK_COLORS);
      break;
    case "shape":
      c.oneOf(o, "shape", SHAPE_KINDS, true);
      c.str(o, "text", LIMITS.textChars);
      c.oneOf(o, "fill", [...FILL_COLORS, "none"]);
      c.oneOf(o, "stroke", INK_COLORS);
      c.oneOf(o, "lineStyle", LINE_STYLES);
      if (typeof o.color === "string" && (FILL_COLORS as readonly string[]).includes(o.color) && !(INK_COLORS as readonly string[]).includes(o.color)) c.add("color", `A shape's color is its text color (${INK_COLORS.join(", ")}); to fill the shape ${o.color}, use fill: "${o.color}".`);
      else c.oneOf(o, "color", INK_COLORS);
      break;
    case "frame":
      c.str(o, "title", LIMITS.titleChars, true);
      c.oneOf(o, "color", FILL_COLORS);
      if (o.frame !== undefined) c.add("frame", "A frame can't sit inside another frame; remove its frame field.");
      break;
    case "connector":
      checkEnd(c, o, "from");
      checkEnd(c, o, "to");
      c.oneOf(o, "route", ROUTES);
      c.oneOf(o, "lineStyle", LINE_STYLES);
      c.oneOf(o, "color", INK_COLORS);
      c.oneOf(o, "startCap", CAPS);
      c.oneOf(o, "endCap", CAPS);
      c.str(o, "label", 200);
      break;
    case "drawing": {
      const p = o.points;
      if (!Array.isArray(p) || p.length < 4 || p.length % 2 || !p.every((n) => typeof n === "number" && Number.isFinite(n))) c.add("points", "points must be an even list of numbers, x and y in turn, at least two points: [0, 0, 40, 20].");
      else if (p.length / 2 > LIMITS.points) c.add("points", `A drawing has at most ${LIMITS.points} points; this one has ${p.length / 2}.`);
      c.oneOf(o, "color", INK_COLORS);
      c.oneOf(o, "lineStyle", LINE_STYLES);
      break;
    }
    case "table": {
      const cells = o.cells;
      if (!Array.isArray(cells) || !cells.length || !cells.every((r) => Array.isArray(r) && r.length && r.every((x) => typeof x === "string" && x.length <= 2000))) {
        c.add("cells", 'cells must be rows of text, the first row the header: [["Name", "Owner"], ["Docs", "Ana"]].');
      } else {
        const width = (cells[0] as unknown[]).length;
        if (!cells.every((r) => (r as unknown[]).length === width)) c.add("cells", `Every row needs ${width} cells, as many as the first row.`);
        if (cells.length * width > LIMITS.tableCells) c.add("cells", `A table has at most ${LIMITS.tableCells} cells.`);
      }
      c.oneOf(o, "color", FILL_COLORS);
      break;
    }
    case "sticker":
      c.oneOf(o, "sticker", STICKER_IDS, true);
      break;
    case "image":
      if (typeof o.src !== "string" || !/^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(o.src)) c.add("src", 'src must name a file in the board\'s assets folder: "assets/photo.png".');
      c.str(o, "alt", 500);
      break;
  }
  return c.problems;
}

export interface CheckedCanvas {
  /** The items that passed, in order. */
  items: BoardItem[];
  /** Entries that didn't, kept as they were so a save never loses them. */
  kept: unknown[];
  problems: Problem[];
}

/**
 * Check every item and how they point at each other. Items that fail are
 * kept aside untouched; a frame or end that points at nothing is reported
 * (and the item still drawn as well as it can be).
 */
export function checkItems(raw: unknown[], label = "items"): CheckedCanvas {
  const items: BoardItem[] = [];
  const kept: unknown[] = [];
  const problems: Problem[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const where = typeof (r as Raw | null)?.id === "string" ? String((r as Raw).id) : `${label}[${i}]`;
    const p = checkItem(r, where);
    const id = (r as Raw | null)?.id;
    if (typeof id === "string" && seen.has(id)) p.push({ where, message: `Another item already has the id "${id}"; ids must be unique.` });
    if (p.length) {
      problems.push(...p);
      kept.push(r);
      return;
    }
    seen.add(id as string);
    items.push(r as BoardItem);
  });
  const kinds = new Map(items.map((it) => [it.id, it.kind]));
  for (const it of items) {
    if (it.frame !== undefined && kinds.get(it.frame) !== "frame") problems.push({ where: `${it.id}.frame`, message: `"${it.frame}" is not a frame on this board.` });
    if (it.kind === "connector") {
      for (const [k, e] of [["from", it.from], ["to", it.to]] as [string, End][]) {
        if ("item" in e && !kinds.has(e.item)) problems.push({ where: `${it.id}.${k}`, message: `${k} points at "${e.item}", which is not on the board.` });
        else if ("item" in e && kinds.get(e.item) === "connector") problems.push({ where: `${it.id}.${k}`, message: `${k} points at a connector; connect items, not connectors.` });
      }
    }
  }
  return { items, kept, problems };
}

/** One line per problem, for a banner, a test or a tool result. */
export function describeProblems(problems: readonly Problem[], max = 20): string {
  const lines = problems.slice(0, max).map((p) => `- ${p.where}: ${p.message}`);
  if (problems.length > max) lines.push(`- and ${problems.length - max} more`);
  return lines.join("\n");
}
