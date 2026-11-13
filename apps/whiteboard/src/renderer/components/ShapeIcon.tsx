// A shape kind drawn as an icon, from the same outlines the board uses.

import { shapePath, type ShapeKind } from "@opendeck/board";

const BOX: Partial<Record<ShapeKind, [number, number, number, number]>> = {
  square: [3.5, 3.5, 13, 13],
  circle: [3, 3, 14, 14],
  cylinder: [5, 2.75, 10, 14.5],
  person: [4.5, 3, 11, 14],
};

export function ShapeIcon({ kind, size = 18 }: { kind: ShapeKind; size?: number }) {
  const [x, y, w, h] = BOX[kind] ?? [2.75, 5, 14.5, 10];
  const { body, detail } = shapePath(kind, x, y, w, h);
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" aria-hidden>
      <path d={body} />
      {detail && <path d={detail} />}
    </svg>
  );
}
