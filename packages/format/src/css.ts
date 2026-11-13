// Inline-style parsing and the value grammar of the Fenna Slides format.
//
// A slide's styles live only in `style=""` attributes. This file turns one
// attribute into ordered declarations and checks each value against the
// small grammar the format allows. Nothing here knows about elements; the
// property table in schema.ts says which property goes where.

export interface Declaration {
  name: string;
  value: string;
}

/** Split on a separator at paren depth 0 (so `rgb(1, 2, 3)` stays whole). */
export function splitTop(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (sep === " " ? /\s/.test(ch) : ch === sep)) {
      out.push(input.slice(start, i));
      start = i + 1;
    }
  }
  out.push(input.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

export interface StyleParse {
  decls: Declaration[];
  errors: string[];
}

export function parseStyle(style: string): StyleParse {
  const decls: Declaration[] = [];
  const errors: string[] = [];
  for (const part of splitTop(style, ";")) {
    const colon = part.indexOf(":");
    if (colon <= 0) {
      errors.push(`"${part}" is not a declaration (expected name:value)`);
      continue;
    }
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim().replace(/\s+/g, " ");
    if (!value) {
      errors.push(`${name} has no value`);
      continue;
    }
    // A later duplicate wins, as in CSS; keep the first position.
    const existing = decls.find((d) => d.name === name);
    if (existing) existing.value = value;
    else decls.push({ name, value });
  }
  return { decls, errors };
}

export function serializeStyle(decls: Declaration[]): string {
  return decls.map((d) => `${d.name}:${d.value}`).join(";");
}

// ── Value grammar ───────────────────────────────────────────────────────
// Each check returns null when the value is fine, else a short reason.

export type Check = (value: string, ctx: ValueContext) => string | null;

export interface ValueContext {
  /** Theme color token names (`var(--name)` is allowed for these). */
  colorTokens: ReadonlySet<string>;
  /** Font families the deck declares. Unknown families are a warning, not an error. */
  families: ReadonlySet<string>;
}

const NUM_RE = /^-?(\d+\.?\d*|\.\d+)$/;
const PX_RE = /^(-?(?:\d+\.?\d*|\.\d+))(px)?$/;
const PCT_RE = /^(-?(?:\d+\.?\d*|\.\d+))%$/;

export function num(v: string): number | null {
  return NUM_RE.test(v) ? Number(v) : null;
}

export function px(v: string): number | null {
  const m = PX_RE.exec(v);
  return m ? Number(m[1]) : null;
}

export function pct(v: string): number | null {
  const m = PCT_RE.exec(v);
  return m ? Number(m[1]) : null;
}

export const enumOf =
  (...words: string[]): Check =>
  (v) =>
    words.includes(v) ? null : `expected one of ${words.join(" | ")}`;

export const length =
  (min = -10000, max = 10000): Check =>
  (v) => {
    const n = px(v);
    if (n === null) return /(em|rem|vw|vh|pt|cm|mm|in)$/.test(v) ? "use px (the canvas is 1920×1080 px)" : "expected a px length";
    if (n < min || n > max) return `must be between ${min} and ${max}px`;
    return null;
  };

export const number =
  (min: number, max: number, step?: number): Check =>
  (v) => {
    const n = num(v);
    if (n === null) return "expected a number";
    if (n < min || n > max) return `must be between ${min} and ${max}`;
    if (step && Math.abs(n / step - Math.round(n / step)) > 1e-9) return `must be a multiple of ${step}`;
    return null;
  };

export const anyOf =
  (...checks: Check[]): Check =>
  (v, ctx) => {
    let first: string | null = null;
    for (const c of checks) {
      const r = c(v, ctx);
      if (r === null) return null;
      first ??= r;
    }
    return first;
  };

/** 1..n space-separated values each passing `check`. */
export const repeatOf =
  (check: Check, minCount: number, maxCount: number): Check =>
  (v, ctx) => {
    const parts = splitTop(v, " ");
    if (parts.length < minCount || parts.length > maxCount)
      return `expected ${minCount === maxCount ? minCount : `${minCount}–${maxCount}`} values`;
    for (const p of parts) {
      const r = check(p, ctx);
      if (r) return `${p}: ${r}`;
    }
    return null;
  };

export const percentage: Check = (v) => (pct(v) === null ? "expected a percentage" : null);
export const lengthOrPct = (min?: number, max?: number) => anyOf(length(min, max), percentage);

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FN_RE = /^(rgba?|hsla?)\(\s*[-\d.%\s,/deg]+\)$/i;
const VAR_RE = /^var\(--([a-z][a-z0-9-]{0,39})\)$/;

export const color: Check = (v, ctx) => {
  if (HEX_RE.test(v) || COLOR_FN_RE.test(v) || v === "transparent") return null;
  const m = VAR_RE.exec(v);
  if (m) return ctx.colorTokens.has(m[1]!) ? null : `the theme has no color --${m[1]}`;
  if (/^[a-z]+$/i.test(v)) return "use a hex color or a theme color, not a color name";
  return "expected a color (#hex, rgb(), hsl() or var(--theme-color))";
};

const GRADIENT_RE = /^(repeating-)?(linear|radial)-gradient\((.+)\)$/;
export const gradient: Check = (v, ctx) => {
  const m = GRADIENT_RE.exec(v);
  if (!m) return "expected a linear-gradient() or radial-gradient()";
  const args = splitTop(m[3]!, ",");
  const stops = args.filter((a) => {
    const first = splitTop(a, " ")[0] ?? "";
    return color(first, ctx) === null;
  });
  if (stops.length < 2 || stops.length > 8) return "a gradient needs 2–8 color stops";
  return null;
};

export const paint = anyOf(color, gradient);

export const fontFamily: Check = (v) => {
  const names = splitTop(v, ",");
  if (names.length === 0 || names.length > 6) return "expected 1–6 font families";
  for (const n of names) {
    if (!/^(['"])[A-Za-z0-9 _-]{1,40}\1$|^[A-Za-z][A-Za-z0-9 -]{0,39}$/.test(n)) return `"${n}" is not a font family name`;
  }
  return null;
};

export const fontWeight: Check = anyOf(enumOf("normal", "bold"), number(100, 900, 100));

export const lineHeight: Check = anyOf(number(0.5, 4), length(4, 800), percentage);

export const letterSpacing: Check = (v, ctx) => {
  if (v === "normal") return null;
  const em = /^(-?(?:\d+\.?\d*|\.\d+))em$/.exec(v);
  if (em) return Math.abs(Number(em[1])) <= 1 ? null : "must be within ±1em";
  return length(-24, 40)(v, ctx);
};

const BORDER_STYLES = ["solid", "dashed", "dotted", "double", "none"];
export const border: Check = (v, ctx) => {
  if (v === "none" || v === "0") return null;
  const parts = splitTop(v, " ");
  let style = false;
  for (const p of parts) {
    if (BORDER_STYLES.includes(p)) {
      if (style) return "only one border style";
      style = true;
    } else if (px(p) !== null) {
      const n = px(p)!;
      if (n < 0 || n > 32) return "border width must be 0–32px";
    } else if (color(p, ctx) !== null) return `"${p}" is not a width, style or color`;
  }
  return style ? null : "a border needs a style word (solid, dashed, dotted, double)";
};

/** box-shadow / text-shadow: comma list of `[inset] x y [blur [spread]] color`. */
export const shadow =
  (allowInset: boolean, maxLengths: number): Check =>
  (v, ctx) => {
    if (v === "none") return null;
    const items = splitTop(v, ",");
    if (items.length > 8) return "at most 8 shadows";
    for (const item of items) {
      let lengths = 0;
      let colors = 0;
      for (const p of splitTop(item, " ")) {
        if (p === "inset" && allowInset) continue;
        if (px(p) !== null) lengths++;
        else if (color(p, ctx) === null) colors++;
        else return `"${p}" is not a length or color`;
      }
      if (lengths < 2 || lengths > maxLengths) return `a shadow takes 2–${maxLengths} lengths`;
      if (colors > 1) return "a shadow takes one color";
    }
    return null;
  };

const FN_RE = /^([a-zA-Z-]+)\((.*)\)$/;

function fnList(allowed: Record<string, Check>): Check {
  return (v, ctx) => {
    if (v === "none") return null;
    const seen = new Set<string>();
    for (const f of splitTop(v, " ")) {
      const m = FN_RE.exec(f);
      if (!m) return `"${f}" is not a function`;
      const name = m[1]!;
      const check = allowed[name];
      if (!check) return `${name}() is not supported (use ${Object.keys(allowed).join(", ")})`;
      if (seen.has(name)) return `${name}() appears twice`;
      seen.add(name);
      for (const arg of splitTop(m[2]!, ",")) {
        const r = check(arg, ctx);
        if (r) return `${name}(${arg}): ${r}`;
      }
    }
    return null;
  };
}

export const angle: Check = (v) =>
  /^-?(\d+\.?\d*|\.\d+)(deg|turn|rad)$/.test(v) || v === "0" ? null : "expected an angle (deg, turn, rad)";

export const transform = fnList({
  translate: lengthOrPct(-4000, 4000),
  translateX: lengthOrPct(-4000, 4000),
  translateY: lengthOrPct(-4000, 4000),
  rotate: angle,
  scale: number(0.1, 4),
  skewX: angle,
  skewY: angle,
});

export const filter = fnList({
  blur: length(0, 40),
  brightness: number(0, 3),
  contrast: number(0, 3),
  saturate: number(0, 3),
  grayscale: number(0, 1),
  sepia: number(0, 1),
  invert: number(0, 1),
  "hue-rotate": angle,
});

const TRACK_RE = /^(\d+(\.\d+)?fr|auto|min-content|max-content)$/;
export const tracks: Check = (v, ctx) => {
  const parts = splitTop(v, " ");
  let count = 0;
  for (const p of parts) {
    const rep = /^repeat\((\d+),(.+)\)$/.exec(p.replace(/\s/g, ""));
    if (rep) {
      const n = Number(rep[1]);
      const inner = tracks(rep[2]!, ctx);
      if (inner) return inner;
      count += n * splitTop(rep[2]!, " ").length;
      continue;
    }
    if (!TRACK_RE.test(p) && length(0, 4000)(p, ctx) !== null) return `"${p}" is not a track size (px, fr, auto)`;
    count++;
  }
  return count >= 1 && count <= 24 ? null : "1–24 tracks";
};

export const span: Check = (v) => (/^span [1-9]\d?$/.test(v) ? null : "expected `span N`");

export const flex: Check = (v, ctx) => {
  if (v === "none" || v === "auto") return null;
  const parts = splitTop(v, " ");
  if (parts.length > 3) return "flex takes at most 3 values";
  if (num(parts[0]!) === null) return "flex starts with a grow number";
  if (parts[1] !== undefined && num(parts[1]) === null) return "the second value is the shrink number";
  if (parts[2] !== undefined && anyOf(length(0, 4000), percentage, enumOf("auto"))(parts[2], ctx)) return "the basis is px, % or auto";
  return null;
};

export const aspectRatio: Check = (v) => (/^\d+(\.\d+)?( ?\/ ?\d+(\.\d+)?)?$/.test(v) ? null : "expected N or N / N");

export const textDecoration: Check = (v, ctx) => {
  for (const p of splitTop(v, " ")) {
    if (["none", "underline", "line-through", "solid", "double", "dotted", "dashed", "wavy"].includes(p)) continue;
    if (color(p, ctx) === null) continue;
    return `"${p}" is not a decoration`;
  }
  return null;
};

export const objectPosition: Check = repeatOf(percentage, 2, 2);
