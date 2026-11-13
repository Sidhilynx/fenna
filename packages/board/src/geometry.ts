// Where things are: boxes, connector routes, hit tests and frames. Pure
// functions over items, shared by the editor, the renderer and the MCP server.

import type { BoardItem, BoxItem, ConnectorItem, End, FrameItem, Side } from "./schema.ts";

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const isBox = (it: BoardItem): it is BoxItem => it.kind !== "connector";
export const isConnector = (it: BoardItem): it is ConnectorItem => it.kind === "connector";
export const onItem = (e: End): e is { item: string; side?: Side } => "item" in e;

export type ById = ReadonlyMap<string, BoardItem>;
export const byId = (items: readonly BoardItem[]): Map<string, BoardItem> => new Map(items.map((it) => [it.id, it]));

const center = (r: Rect): Pt => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** The box a rotated item covers. */
export function rotatedBounds(it: Rect & { rotation?: number }): Rect {
  const deg = it.rotation ?? 0;
  if (!deg) return { x: it.x, y: it.y, width: it.width, height: it.height };
  const a = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const w = it.width * cos + it.height * sin;
  const h = it.width * sin + it.height * cos;
  const c = center(it);
  return { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h };
}

const SIDE_DIR: Record<Exclude<Side, "auto">, Pt> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

function sideToward(box: Rect, toward: Pt): Exclude<Side, "auto"> {
  const c = center(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function sidePoint(box: Rect, side: Exclude<Side, "auto">): Pt {
  switch (side) {
    case "top":
      return { x: box.x + box.width / 2, y: box.y };
    case "bottom":
      return { x: box.x + box.width / 2, y: box.y + box.height };
    case "left":
      return { x: box.x, y: box.y + box.height / 2 };
    case "right":
      return { x: box.x + box.width, y: box.y + box.height / 2 };
  }
}

/** A rough point for an end, before sides are chosen: the item's centre or the spot. */
function roughPoint(e: End, items: ById): Pt | null {
  if (!onItem(e)) return { x: e.x, y: e.y };
  const it = items.get(e.item);
  return it && isBox(it) ? center(rotatedBounds(it)) : null;
}

export interface ResolvedEnd {
  pt: Pt;
  /** Which way the line leaves the end (null: a free end). */
  dir: Pt | null;
  side: Exclude<Side, "auto"> | null;
}

/** Where a connector's two ends are, with the sides they leave from. Null when an end's item is gone. */
export function connectorEnds(c: ConnectorItem, items: ById): { from: ResolvedEnd; to: ResolvedEnd } | null {
  const a = roughPoint(c.from, items);
  const b = roughPoint(c.to, items);
  if (!a || !b) return null;
  const resolve = (e: End, other: Pt): ResolvedEnd => {
    if (!onItem(e)) return { pt: { x: e.x, y: e.y }, dir: null, side: null };
    const box = rotatedBounds(items.get(e.item) as BoxItem);
    const side = !e.side || e.side === "auto" ? sideToward(box, other) : e.side;
    return { pt: sidePoint(box, side), dir: SIDE_DIR[side], side };
  };
  return { from: resolve(c.from, b), to: resolve(c.to, a) };
}

const GAP = 24;

/** The points a connector passes through, first to last. */
export function connectorPoints(c: ConnectorItem, items: ById): Pt[] | null {
  const ends = connectorEnds(c, items);
  if (!ends) return null;
  const { from, to } = ends;
  const p1 = from.pt;
  const p2 = to.pt;
  if (c.route === "straight") return [p1, p2];
  // Step out of each item along its side, then join the two stubs with the
  // best of a few right-angled routes: no doubling back, nothing through the
  // items joined, few bends, short.
  // Ends facing each other closer than two stubs: each stub goes half way.
  let stub = GAP;
  if (from.dir && to.dir && from.dir.x === -to.dir.x && from.dir.y === -to.dir.y) {
    const along = (p2.x - p1.x) * from.dir.x + (p2.y - p1.y) * from.dir.y;
    if (along > 0 && along < GAP * 2) stub = along / 2;
  }
  const a = from.dir ? { x: p1.x + from.dir.x * stub, y: p1.y + from.dir.y * stub } : p1;
  const b = to.dir ? { x: p2.x + to.dir.x * stub, y: p2.y + to.dir.y * stub } : p2;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const middles: Pt[][] = [[{ x: b.x, y: a.y }], [{ x: a.x, y: b.y }], [{ x: mx, y: a.y }, { x: mx, y: b.y }], [{ x: a.x, y: my }, { x: b.x, y: my }]];
  const boxes = [c.from, c.to].map((e) => (onItem(e) ? rotatedBounds(items.get(e.item) as BoxItem) : null));
  let best: Pt[] = [p1, a, b, p2];
  let bestScore = Infinity;
  for (const mid of middles) {
    const pts = simplify([p1, a, ...mid, b, p2]);
    const s = routeScore(pts, from.dir, to.dir, boxes);
    if (s < bestScore) {
      bestScore = s;
      best = pts;
    }
  }
  return best;
}

const dirOf = (a: Pt, b: Pt): Pt => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) });

/** Lower is better: length, bends, and heavy costs for doubling back or crossing the joined items. */
function routeScore(pts: Pt[], d1: Pt | null, d2: Pt | null, boxes: (Rect | null)[]): number {
  let score = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]!;
    const q = pts[i]!;
    score += Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
    if (p.x !== q.x && p.y !== q.y) score += 10_000;
    for (const [k, box] of boxes.entries()) {
      if (!box) continue;
      // The stub at the item's own end touches it; any other run must stay clear.
      if ((k === 0 && i === 1) || (k === 1 && i === pts.length - 1)) continue;
      if (segmentCrosses(p, q, box)) score += 5_000;
    }
    if (i >= 2) {
      const before = dirOf(pts[i - 2]!, p);
      const now = dirOf(p, q);
      if (before.x === -now.x && before.y === -now.y) score += 10_000;
      else if (before.x !== now.x || before.y !== now.y) score += 30;
    }
  }
  if (d1 && pts.length > 1) {
    const first = dirOf(pts[0]!, pts[1]!);
    if (first.x !== d1.x || first.y !== d1.y) score += 10_000;
  }
  if (d2 && pts.length > 1) {
    const last = dirOf(pts[pts.length - 2]!, pts[pts.length - 1]!);
    if (last.x !== -d2.x || last.y !== -d2.y) score += 10_000;
  }
  return score;
}

/** Does the axis-aligned segment p–q pass through the inside of `box`? */
function segmentCrosses(p: Pt, q: Pt, box: Rect): boolean {
  const x1 = Math.min(p.x, q.x);
  const x2 = Math.max(p.x, q.x);
  const y1 = Math.min(p.y, q.y);
  const y2 = Math.max(p.y, q.y);
  return x2 > box.x + 1 && x1 < box.x + box.width - 1 && y2 > box.y + 1 && y1 < box.y + box.height - 1;
}

/** Drops repeated points and points on a straight run. */
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) out[out.length - 1] = p;
    else out.push(p);
  }
  return out.length >= 2 ? out : [pts[0]!, pts[pts.length - 1]!];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** An SVG path through the points, its corners rounded by `radius`. */
export function roundedPath(pts: Pt[], radius = 12): string {
  if (pts.length < 2) return "";
  let d = `M${r2(pts[0]!.x)} ${r2(pts[0]!.y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const la = Math.hypot(b.x - a.x, b.y - a.y);
    const lc = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, la / 2, lc / 2);
    const p = { x: b.x - ((b.x - a.x) / la) * r, y: b.y - ((b.y - a.y) / la) * r };
    const q = { x: b.x + ((c.x - b.x) / lc) * r, y: b.y + ((c.y - b.y) / lc) * r };
    d += `L${r2(p.x)} ${r2(p.y)}Q${r2(b.x)} ${r2(b.y)} ${r2(q.x)} ${r2(q.y)}`;
  }
  const last = pts[pts.length - 1]!;
  return `${d}L${r2(last.x)} ${r2(last.y)}`;
}

/** The point halfway along a polyline, and the direction of the run it's on. */
export function midpoint(pts: Pt[]): { pt: Pt; horizontal: boolean } {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= len || i === pts.length - 1) {
      const t = len ? Math.min(1, left / len) : 0;
      return { pt: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, horizontal: Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) };
    }
    left -= len;
  }
  return { pt: pts[0]!, horizontal: true };
}

/** The box an item covers on the board (a connector: its route's box). */
export function itemBounds(it: BoardItem, items: ById): Rect | null {
  if (isBox(it)) return rotatedBounds(it);
  const pts = connectorPoints(it, items);
  if (!pts) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The box around all of `items` (null for none). */
export function boundsOf(items: readonly BoardItem[], all: ById): Rect | null {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const it of items) {
    const b = itemBounds(it, all);
    if (!b) continue;
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.width);
    y2 = Math.max(y2, b.y + b.height);
  }
  return x1 === Infinity ? null : { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return a.x < b.x + b.width + margin && b.x < a.x + a.width + margin && a.y < b.y + b.height + margin && b.y < a.y + a.height + margin;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/** Distance from `p` to the segment a–b. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function polylineDist(p: Pt, pts: Pt[]): number {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1]!, pts[i]!));
  return d;
}

/** The point in an item's own (unrotated) frame. */
export function toLocal(p: Pt, it: Rect & { rotation?: number }): Pt {
  const deg = it.rotation ?? 0;
  if (!deg) return p;
  const c = center(it);
  const a = (-deg * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

/** The drawing's points on the board. */
export function drawingPoints(d: { x: number; y: number; points: number[] }): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < d.points.length; i += 2) out.push({ x: d.x + d.points[i]!, y: d.y + d.points[i + 1]! });
  return out;
}

/**
 * Is `p` on the item? `slop` (board units) widens lines so they can be
 * clicked. A frame is hit on its title and its body.
 */
export function hitItem(p: Pt, it: BoardItem, items: ById, slop = 6): boolean {
  if (it.kind === "connector") {
    const pts = connectorPoints(it, items);
    return !!pts && polylineDist(p, pts) <= slop;
  }
  const q = toLocal(p, it);
  if (it.kind === "drawing") {
    if (q.x < it.x - slop || q.y < it.y - slop || q.x > it.x + it.width + slop || q.y > it.y + it.height + slop) return false;
    return polylineDist(q, drawingPoints(it)) <= slop + 3;
  }
  const top = it.kind === "frame" ? it.y - 26 : it.y;
  return q.x >= it.x && q.x <= it.x + it.width && q.y >= top && q.y <= it.y + it.height;
}

/** The top item under `p`; frames only when nothing in them is hit. */
export function itemAt(p: Pt, items: readonly BoardItem[], all: ById, slop = 6): BoardItem | null {
  let frame: BoardItem | null = null;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (!hitItem(p, it, all, slop)) continue;
    if (it.kind !== "frame") return it;
    frame ??= it;
  }
  return frame;
}

/** Is `p` on a frame's title (above its top edge)? */
export function onFrameTitle(p: Pt, f: FrameItem): boolean {
  return p.x >= f.x && p.x <= f.x + f.width && p.y >= f.y - 26 && p.y < f.y;
}

/** The top frame whose body holds the centre of `r` (never `except`). */
export function frameAt(r: Rect, items: readonly BoardItem[], except?: string): FrameItem | null {
  const c = center(r);
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind !== "frame" || it.id === except) continue;
    if (c.x >= it.x && c.x <= it.x + it.width && c.y >= it.y && c.y <= it.y + it.height) return it;
  }
  return null;
}

/** Ids of the items in each frame. */
export function frameChildren(items: readonly BoardItem[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const it of items) {
    if (!it.frame) continue;
    const list = out.get(it.frame);
    if (list) list.push(it.id);
    else out.set(it.frame, [it.id]);
  }
  return out;
}
