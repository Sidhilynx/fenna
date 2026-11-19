// A Crew pixel icon: a 12 by 12 grid drawn as an inline SVG in currentColor, so
// it takes the text color. Horizontal runs of filled pixels become one rect.

import { PIXEL_ICONS, type PixelIconName } from "./pixelIcons.ts";

export interface Run {
  x: number;
  y: number;
  w: number;
}

/** The filled pixels of a grid as horizontal runs. `on` is the character that is filled. */
export function gridRuns(rows: readonly string[], on = "x"): Run[] {
  const out: Run[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== on) {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end] === on) end++;
      out.push({ x, y, w: end - x });
      x = end;
    }
  });
  return out;
}

const cache = new Map<PixelIconName, Run[]>();

function runsFor(name: PixelIconName): Run[] {
  let runs = cache.get(name);
  if (!runs) {
    runs = gridRuns(PIXEL_ICONS[name]);
    cache.set(name, runs);
  }
  return runs;
}

export function PixelIcon({ name, size = 16, title }: { name: PixelIconName; size?: number; title?: string }) {
  return (
    <svg
      className="pixel-icon"
      width={size}
      height={size}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      fill="currentColor"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {runsFor(name).map((r) => (
        <rect key={`${r.x},${r.y}`} x={r.x} y={r.y} width={r.w} height={1} />
      ))}
    </svg>
  );
}
