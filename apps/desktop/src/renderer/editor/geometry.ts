// Measuring rendered slide elements in slide pixels (1920×1080), whatever
// the zoom, and snapping moves to the slide's margins, centre lines and the
// edges of other pinned elements.

import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@opendeck/format";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An element's rect in slide pixels, measured against the rendered section. */
export function slideRect(el: Element, section: Element, scale: number): Rect {
  const s = section.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: (r.left - s.left) / scale, y: (r.top - s.top) / scale, w: r.width / scale, h: r.height / scale };
}

/** An element's rect relative to its offset parent (where left/top apply), in slide pixels. */
export function offsetRect(el: HTMLElement): Rect {
  return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
}

export interface Guide {
  axis: "x" | "y";
  at: number;
}

const MARGIN = 128;
const SNAP = 8;

/** Lines a moving box can snap to: slide edges, margins, centre, other boxes' edges and centres. */
export function snapLines(others: Rect[]): { x: number[]; y: number[] } {
  const x = [0, MARGIN, SLIDE_WIDTH / 2, SLIDE_WIDTH - MARGIN, SLIDE_WIDTH];
  const y = [0, MARGIN, SLIDE_HEIGHT / 2, SLIDE_HEIGHT - MARGIN, SLIDE_HEIGHT];
  for (const o of others) {
    x.push(o.x, o.x + o.w / 2, o.x + o.w);
    y.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  return { x, y };
}

/** Snap a box's left/centre/right (and top/middle/bottom) to the nearest line within reach. */
export function snapBox(r: Rect, lines: { x: number[]; y: number[] }, threshold = SNAP): { dx: number; dy: number; guides: Guide[] } {
  const best = (edges: number[], targets: number[]) => {
    let d = Infinity;
    let at = 0;
    for (const e of edges)
      for (const t of targets) {
        const k = t - e;
        if (Math.abs(k) < Math.abs(d)) {
          d = k;
          at = t;
        }
      }
    return Math.abs(d) <= threshold ? { d, at } : null;
  };
  const bx = best([r.x, r.x + r.w / 2, r.x + r.w], lines.x);
  const by = best([r.y, r.y + r.h / 2, r.y + r.h], lines.y);
  const guides: Guide[] = [];
  if (bx) guides.push({ axis: "x", at: bx.at });
  if (by) guides.push({ axis: "y", at: by.at });
  return { dx: bx?.d ?? 0, dy: by?.d ?? 0, guides };
}

export const round = (n: number) => Math.round(n);
