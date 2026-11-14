// The Fenna Design format: what an artboard may hold. The parser, the
// editor's panel, the MCP guide and the tests all read these tables; nothing
// else lists elements or properties (AGENTS.md rule 1).

import {
  type Check,
  anyOf,
  aspectRatio,
  border,
  color,
  enumOf,
  filter,
  flex,
  fontFamily,
  fontWeight,
  length,
  lengthOrPct,
  letterSpacing,
  lineHeight,
  number,
  objectPosition,
  paint,
  percentage,
  repeatOf,
  shadow,
  span,
  textDecoration,
  tracks,
  transform,
  SHAPE_KINDS as FORMAT_SHAPE_KINDS,
} from "@opendeck/format";

export const FORMAT = "fenna-design/0";

export const LIMITS = {
  elementsPerArtboard: 300,
  divDepth: 16,
  textChars: 20_000,
  maxArtboards: 40,
  maxPages: 20,
  titleChars: 200,
  tableRows: 100,
  tableCols: 24,
  notesItems: 2000,
  strokePoints: 4000,
  svgBytes: 64 * 1024,
  minSize: 16,
  maxSize: 8000,
} as const;

export const SHAPE_KINDS = FORMAT_SHAPE_KINDS;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Property groups, in the order the properties panel shows them. */
export const GROUPS = ["size", "layout", "text", "appearance", "effects", "link", "advanced"] as const;
export type PropertyGroup = (typeof GROUPS)[number];

export interface BoardSize {
  name: string;
  width: number;
  height: number;
  /** "fill": the artboard grows down with what it holds (a web page). */
  expand?: "fit" | "fill";
}

export const BOARD_SIZES: readonly BoardSize[] = [
  { name: "Artboard", width: 800, height: 600 },
  { name: "Phone", width: 390, height: 844 },
  { name: "Social", width: 1080, height: 1080 },
  { name: "Page", width: 1280, height: 800, expand: "fill" },
];

export const DEFAULT_TEXT_STYLES: Record<string, string> = {
  "Heading 1": "font-size: 72px; font-weight: 700; line-height: 1.1;",
  Body: "font-size: 24px; font-weight: 400; line-height: 1.4;",
  Caption: "font-size: 16px; font-weight: 400; line-height: 1.4;",
};

export const LAYER_KINDS = ["Column", "Row", "Grid", "Box", "Heading", "Text", "Image", "Shape", "Link", "Button", "List", "Item", "Table", "Rule", "Input"] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];

export interface ElementSpec {
  kind: string;
  /** Tags it may hold; "inline": text and inline tags; "none": empty; "raw": kept verbatim (svg). */
  children: readonly string[] | "inline" | "none" | "raw";
  attrs?: readonly string[];
}

/** What a container (and the artboard's root) may hold. */
export const BLOCKS = ["div", "h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "button", "label", "input", "ul", "ol", "img", "svg", "table", "hr", "x-shape"] as const;

export const INLINE_TAGS = ["span", "b", "i", "u", "a", "br"] as const;

export const ELEMENTS: Record<string, ElementSpec> = {
  div: { kind: "group", children: BLOCKS, attrs: ["data-style"] },
  h1: { kind: "text", children: "inline", attrs: ["data-style"] },
  h2: { kind: "text", children: "inline", attrs: ["data-style"] },
  h3: { kind: "text", children: "inline", attrs: ["data-style"] },
  h4: { kind: "text", children: "inline", attrs: ["data-style"] },
  h5: { kind: "text", children: "inline", attrs: ["data-style"] },
  h6: { kind: "text", children: "inline", attrs: ["data-style"] },
  p: { kind: "text", children: "inline", attrs: ["data-style"] },
  button: { kind: "button", children: "inline", attrs: ["data-style", "type", "disabled"] },
  label: { kind: "text", children: "inline", attrs: ["data-style", "for"] },
  input: { kind: "input", children: "none", attrs: ["data-style", "type", "value", "placeholder", "disabled"] },
  ul: { kind: "list", children: ["li"], attrs: ["data-style"] },
  ol: { kind: "list", children: ["li"], attrs: ["data-style"] },
  li: { kind: "item", children: "inline", attrs: ["data-style"] },
  span: { kind: "inline", children: "inline" },
  b: { kind: "inline", children: "inline" },
  i: { kind: "inline", children: "inline" },
  u: { kind: "inline", children: "inline" },
  a: { kind: "link", children: "inline", attrs: ["href", "data-style"] },
  br: { kind: "inline", children: "none" },
  img: { kind: "image", children: "none", attrs: ["src", "alt"] },
  svg: { kind: "graphic", children: "raw", attrs: ["viewBox", "aria-label", "xmlns", "width", "height", "fill", "preserveAspectRatio"] },
  table: { kind: "table", children: ["tr"] },
  tr: { kind: "row", children: ["th", "td"] },
  th: { kind: "cell", children: "inline" },
  td: { kind: "cell", children: "inline" },
  hr: { kind: "rule", children: "none" },
  "x-shape": { kind: "shape", children: "none", attrs: ["kind"] },
};

/** `<input type>` values an artboard may show (a picture of a form, never a working one). */
export const INPUT_TYPES = ["text", "email", "password", "search", "number", "checkbox", "radio"] as const;

/** An image is a file in assets/. */
export const IMAGE_SRC_RE = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g|webp|gif|svg|avif)$/i;
/** A link goes to the web, an address, or another artboard of the design ("Pricing.html"). */
export const HREF_RE = /^(https?:\/\/\S+|mailto:\S+|#[A-Za-z][A-Za-z0-9_-]{0,63}|[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.html)$/;
/** An artboard's file name inside artboards/. */
export const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.html$/;
export const TWEAK_RE = /^--[a-z][a-z0-9-]{0,39}$/;

const ALL = Object.keys(ELEMENTS);
const TEXTY = ["div", "h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "button", "label", "input", "ul", "ol", "li", "table", "th", "td"];
const SPANS = [...TEXTY, "span"];
const PAINTED = ["div", "h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "span", "button", "label", "input", "ul", "ol", "li", "img", "table", "tr", "th", "td", "x-shape"];
const STROKED = [...PAINTED, "hr", "svg"];

export interface PropertySpec {
  check: Check;
  on: readonly string[];
  group: PropertyGroup;
  /** The values, when the property takes one of a fixed list: the panel's menu. */
  options?: readonly string[];
  inherits?: boolean;
  /** Only means something on a position:absolute element. */
  pinnedOnly?: boolean;
}

const pick = (...options: string[]) => ({ check: enumOf(...options), options });
const SIZE = anyOf(lengthOrPct(0, LIMITS.maxSize), enumOf("auto", "max-content", "min-content", "fit-content"));
const SIDE = anyOf(lengthOrPct(-LIMITS.maxSize, LIMITS.maxSize), enumOf("auto"));
const TIMING: Check = (v) => (v === "none" || /^[a-z0-9 .,()-]+$/i.test(v) ? null : "expected none, or names, times and easings");

export const PROPERTIES: Record<string, PropertySpec> = {
  width: { check: SIZE, on: ALL, group: "size" },
  height: { check: SIZE, on: ALL, group: "size" },
  "min-width": { check: SIZE, on: ALL, group: "size" },
  "min-height": { check: SIZE, on: ALL, group: "size" },
  "max-width": { check: anyOf(SIZE, enumOf("none")), on: ALL, group: "size" },
  "max-height": { check: anyOf(SIZE, enumOf("none")), on: ALL, group: "size" },
  position: { ...pick("static", "relative", "absolute"), on: ALL, group: "size" },
  left: { check: SIDE, on: ALL, group: "size", pinnedOnly: true },
  top: { check: SIDE, on: ALL, group: "size", pinnedOnly: true },
  right: { check: SIDE, on: ALL, group: "size", pinnedOnly: true },
  bottom: { check: SIDE, on: ALL, group: "size", pinnedOnly: true },

  display: { ...pick("flex", "grid", "block", "inline-block", "inline-flex", "inline", "none"), on: ALL, group: "layout" },
  "flex-direction": { ...pick("row", "column", "row-reverse", "column-reverse"), on: ALL, group: "layout" },
  "flex-wrap": { ...pick("nowrap", "wrap", "wrap-reverse"), on: ALL, group: "layout" },
  gap: { check: repeatOf(length(0, 512), 1, 2), on: ALL, group: "layout" },
  "align-items": { ...pick("stretch", "start", "center", "end", "baseline", "flex-start", "flex-end"), on: ALL, group: "layout" },
  "justify-content": { ...pick("start", "center", "end", "space-between", "space-around", "space-evenly", "flex-start", "flex-end", "stretch"), on: ALL, group: "layout" },
  "justify-items": { ...pick("stretch", "start", "center", "end"), on: ALL, group: "layout" },
  "align-content": { ...pick("stretch", "start", "center", "end", "space-between", "space-around", "flex-start", "flex-end"), on: ALL, group: "layout" },
  "align-self": { ...pick("auto", "stretch", "start", "center", "end", "baseline", "flex-start", "flex-end"), on: ALL, group: "layout" },
  "justify-self": { ...pick("auto", "stretch", "start", "center", "end"), on: ALL, group: "layout" },
  flex: { check: flex, on: ALL, group: "layout" },
  "flex-grow": { check: number(0, 100), on: ALL, group: "layout" },
  "flex-shrink": { check: number(0, 100), on: ALL, group: "layout" },
  "flex-basis": { check: anyOf(lengthOrPct(0, LIMITS.maxSize), enumOf("auto")), on: ALL, group: "layout" },
  "grid-template-columns": { check: tracks, on: ALL, group: "layout" },
  "grid-template-rows": { check: tracks, on: ALL, group: "layout" },
  "grid-column": { check: span, on: ALL, group: "layout" },
  "grid-row": { check: span, on: ALL, group: "layout" },
  padding: { check: repeatOf(length(0, 400), 1, 4), on: ALL, group: "layout" },
  margin: { check: repeatOf(anyOf(lengthOrPct(-400, 400), enumOf("auto")), 1, 4), on: ALL, group: "layout" },

  "font-family": { check: fontFamily, on: TEXTY, group: "text", inherits: true },
  "font-weight": { check: fontWeight, on: SPANS, group: "text", inherits: true },
  "font-size": { check: length(6, 400), on: SPANS, group: "text", inherits: true },
  "font-style": { ...pick("normal", "italic"), on: SPANS, group: "text", inherits: true },
  "line-height": { check: lineHeight, on: TEXTY, group: "text", inherits: true },
  "letter-spacing": { check: letterSpacing, on: SPANS, group: "text", inherits: true },
  color: { check: color, on: [...SPANS, "x-shape", "hr"], group: "text", inherits: true },
  "text-align": { ...pick("left", "center", "right", "justify"), on: TEXTY, group: "text", inherits: true },
  "text-transform": { ...pick("none", "uppercase", "lowercase", "capitalize"), on: SPANS, group: "text", inherits: true },
  "font-variant-numeric": { ...pick("normal", "tabular-nums"), on: TEXTY, group: "text", inherits: true },

  background: { check: paint, on: PAINTED, group: "appearance" },
  opacity: { check: number(0, 1), on: ALL, group: "appearance" },
  "border-radius": { check: repeatOf(lengthOrPct(0, 2000), 1, 4), on: PAINTED, group: "appearance" },
  border: { check: border, on: STROKED, group: "appearance" },
  "border-top": { check: border, on: STROKED, group: "appearance" },
  "border-right": { check: border, on: STROKED, group: "appearance" },
  "border-bottom": { check: border, on: STROKED, group: "appearance" },
  "border-left": { check: border, on: STROKED, group: "appearance" },
  "object-position": { check: objectPosition, on: ["img"], group: "appearance" },

  "box-shadow": { check: shadow(true, 4), on: PAINTED, group: "effects" },
  "text-shadow": { check: shadow(false, 3), on: TEXTY, group: "effects" },
  filter: { check: filter, on: ALL, group: "effects" },
  "backdrop-filter": { check: filter, on: ["div"], group: "effects" },
  "mix-blend-mode": { ...pick("normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion"), on: ALL, group: "effects" },
  transform: { check: transform, on: ALL, group: "effects" },

  "z-index": { check: anyOf(number(-999, 999), enumOf("auto")), on: ALL, group: "advanced" },
  overflow: { ...pick("visible", "hidden", "auto", "scroll"), on: ALL, group: "advanced" },
  cursor: { ...pick("default", "pointer", "text", "move", "not-allowed", "grab", "zoom-in", "zoom-out", "auto"), on: ALL, group: "advanced" },
  "pointer-events": { ...pick("auto", "none"), on: ALL, group: "advanced" },
  "object-fit": { ...pick("fill", "cover", "contain", "none", "scale-down"), on: ["img"], group: "advanced" },
  "overflow-x": { ...pick("visible", "hidden", "auto", "scroll"), on: ALL, group: "advanced" },
  "overflow-y": { ...pick("visible", "hidden", "auto", "scroll"), on: ALL, group: "advanced" },
  "white-space": { ...pick("normal", "nowrap", "pre", "pre-wrap", "pre-line"), on: SPANS, group: "advanced", inherits: true },
  "text-overflow": { ...pick("clip", "ellipsis"), on: TEXTY, group: "advanced" },
  "text-decoration": { check: textDecoration, on: SPANS, group: "advanced" },
  "box-sizing": { ...pick("border-box", "content-box"), on: ALL, group: "advanced" },
  "aspect-ratio": { check: anyOf(aspectRatio, enumOf("auto")), on: ALL, group: "advanced" },
  transition: { check: TIMING, on: ALL, group: "advanced" },
  animation: { check: TIMING, on: ALL, group: "advanced" },
};

/** What the layer tree calls an element. */
export function layerKind(node: { tag: string; style?: { name: string; value: string }[] }): LayerKind {
  const tag = node.tag;
  if (/^h[1-6]$/.test(tag)) return "Heading";
  if (tag === "p" || tag === "span" || tag === "label" || tag === "b" || tag === "i" || tag === "u") return "Text";
  if (tag === "img") return "Image";
  if (tag === "x-shape" || tag === "svg") return "Shape";
  if (tag === "a") return "Link";
  if (tag === "button") return "Button";
  if (tag === "ul" || tag === "ol") return "List";
  if (tag === "li") return "Item";
  if (tag === "table" || tag === "tr" || tag === "th" || tag === "td") return "Table";
  if (tag === "hr") return "Rule";
  if (tag === "input") return "Input";
  const value = (name: string) => node.style?.find((s) => s.name === name)?.value;
  const display = value("display");
  if (display === "grid") return "Grid";
  if (display === "flex" || display === "inline-flex") return value("flex-direction")?.startsWith("column") ? "Column" : "Row";
  return "Box";
}

/** The nearest property name to one that isn't in the format, for "did you mean". */
export function nearestProperty(name: string): string | null {
  let best: string | null = null;
  let bestScore = 3;
  for (const known of Object.keys(PROPERTIES)) {
    const d = distance(name, known, bestScore);
    if (d < bestScore) {
      bestScore = d;
      best = known;
    }
  }
  return best;
}

function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) >= max) return max;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}
