// A disk icon from fileIcons.ts: a 16 by 16 grid drawn as crisp SVG rects, one
// group per palette colour. Colours come from the fi-* classes in styles.css.

import { useMemo } from "react";
import { gridRuns, type Run } from "./PixelIcon.tsx";
import { FILE_ICONS, PX_CLASS, type FileIconName, type PxKey } from "./fileIcons.ts";

interface ColourRuns {
  cls: string;
  runs: Run[];
}

const cache = new Map<FileIconName, ColourRuns[]>();

function groupsFor(name: FileIconName): ColourRuns[] {
  let groups = cache.get(name);
  if (!groups) {
    const rows = FILE_ICONS[name];
    const keys = new Set(rows.join("").split(""));
    groups = [];
    for (const key of keys) {
      if (key === "." || !(key in PX_CLASS)) continue;
      groups.push({ cls: PX_CLASS[key as PxKey], runs: gridRuns(rows, key) });
    }
    cache.set(name, groups);
  }
  return groups;
}

export function FileIcon({ name, size = 16, title }: { name: FileIconName; size?: number; title?: string }) {
  const groups = useMemo(() => groupsFor(name), [name]);
  return (
    <svg
      className="file-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {groups.map((g) => (
        <g key={g.cls} className={g.cls}>
          {g.runs.map((r) => (
            <rect key={`${r.x},${r.y}`} x={r.x} y={r.y} width={r.w} height={1} />
          ))}
        </g>
      ))}
    </svg>
  );
}
