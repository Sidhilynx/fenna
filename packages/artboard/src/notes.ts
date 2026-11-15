// notes.json: what sits on the canvas beside the artboards. Sticky notes and
// pencil strokes are for the people working on the design; they are never
// part of an artboard or an export.

import { LIMITS } from "./schema.ts";

export const FILL_COLORS = ["yellow", "orange", "pink", "green", "blue", "purple", "gray"] as const;
export type FillColor = (typeof FILL_COLORS)[number];

export const FILL_VALUES: Record<FillColor, string> = {
  yellow: "#fbe38e",
  orange: "#f7bd94",
  pink: "#f5b8d0",
  green: "#b7e3a8",
  blue: "#acd4f6",
  purple: "#cbc0fb",
  gray: "#d6d6d6",
};

/** Text on a sticky, in both themes (the fills are light). */
export const STICKY_INK = "#1b1b1b";

/** Pencil widths the dock offers, thin to thick. */
export const STROKE_WIDTHS = [2, 4, 8, 12, 20] as const;

export interface StickyNote {
  id: string;
  kind: "sticky";
  text: string;
  fill: FillColor;
  x: number;
  y: number;
  w: number;
  h: number;
  page: string;
}

export interface StrokeNote {
  id: string;
  kind: "stroke";
  /** Canvas points, in order. */
  points: [number, number][];
  width: number;
  dashed?: boolean;
  page: string;
}

export type NoteItem = StickyNote | StrokeNote;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 10_000_000;

/** Notes read leniently: an entry that makes no sense is left out and counted. */
export function parseNotes(text: string | null, firstPage = "page-1"): { items: NoteItem[]; problems: string[] } {
  if (!text) return { items: [], problems: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { items: [], problems: [`notes.json is not valid JSON (${(e as Error).message})`] };
  }
  const list = raw && typeof raw === "object" ? (raw as { items?: unknown }).items : null;
  if (!Array.isArray(list)) return { items: [], problems: ['notes.json has no "items" list'] };
  const items: NoteItem[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  for (const v of list.slice(0, LIMITS.notesItems) as Record<string, unknown>[]) {
    const id = v && typeof v.id === "string" && v.id && !ids.has(v.id) ? v.id.slice(0, 64) : null;
    const page = v && typeof v.page === "string" ? v.page : firstPage;
    if (id && v.kind === "sticky" && finite(v.x) && finite(v.y)) {
      const size = (n: unknown, d: number) => (finite(n) && n >= 40 ? Math.min(2000, Math.round(n)) : d);
      items.push({ id, kind: "sticky", text: typeof v.text === "string" ? v.text.slice(0, 4000) : "", fill: (FILL_COLORS as readonly unknown[]).includes(v.fill) ? (v.fill as FillColor) : "yellow", x: Math.round(v.x), y: Math.round(v.y), w: size(v.w, 200), h: size(v.h, 200), page });
    } else if (id && v.kind === "stroke" && Array.isArray(v.points)) {
      const points = (v.points as unknown[]).filter((p): p is [number, number] => Array.isArray(p) && finite(p[0]) && finite(p[1])).slice(0, LIMITS.strokePoints).map((p): [number, number] => [p[0], p[1]]);
      if (points.length < 2) {
        dropped++;
        continue;
      }
      items.push({ id, kind: "stroke", points, width: finite(v.width) && v.width > 0 ? Math.min(64, v.width) : 4, ...(v.dashed === true ? { dashed: true } : {}), page });
    } else {
      dropped++;
      continue;
    }
    ids.add(id);
  }
  return { items, problems: dropped ? [`${dropped} ${dropped === 1 ? "entry" : "entries"} in notes.json can't be read and ${dropped === 1 ? "is" : "are"} not shown`] : [] };
}

/** One item a line, so a change shows as one line in a diff. */
export function notesText(items: readonly NoteItem[]): string {
  if (!items.length) return '{\n  "items": []\n}\n';
  return `{\n  "items": [\n${items.map((it) => `    ${JSON.stringify(it)}`).join(",\n")}\n  ]\n}\n`;
}

/** The box a note takes on the canvas. */
export function noteBounds(n: NoteItem): { x: number; y: number; w: number; h: number } {
  if (n.kind === "sticky") return { x: n.x, y: n.y, w: n.w, h: n.h };
  const xs = n.points.map((p) => p[0]);
  const ys = n.points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Is the canvas point within `slop` of the stroke's line? */
export function onStroke(n: StrokeNote, x: number, y: number, slop: number): boolean {
  const reach = slop + n.width / 2;
  for (let i = 1; i < n.points.length; i++) {
    const [ax, ay] = n.points[i - 1]!;
    const [bx, by] = n.points[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
    if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= reach) return true;
  }
  return false;
}
