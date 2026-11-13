// The icon every app on the shell uses. Glyphs live in glyphs.ts (one grid,
// one stroke system); add a glyph there rather than inlining an SVG.

import type { SVGProps } from "react";
import { GLYPHS, type IconName, TINT, strokeFor } from "./glyphs.ts";

export type { IconName } from "./glyphs.ts";

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  const g: { s?: string; t?: string; f?: string; w?: number } = GLYPHS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeFor(size, g.w)}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {g.t && <path d={g.t} fill="currentColor" fillOpacity={TINT} stroke="none" />}
      {g.s && <path d={g.s} />}
      {g.f && <path d={g.f} fill="currentColor" stroke="none" />}
    </svg>
  );
}
