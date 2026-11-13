// The Fenna Slides subset: which elements exist, what they may contain,
// and which style properties each takes.
//
// This table is the single source of truth. The validator enforces it, the
// editor's inspector panels are generated from it, the MCP server's prompt
// describes it, and the exporters only ever see what it allows. To add a
// property: add it here with a check and the elements it applies to, then
// teach the PPTX exporter about it.

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
} from "./css.ts";

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;

export const LIMITS = {
  elementsPerSlide: 300,
  divDepth: 16,
  svgBytes: 64 * 1024,
  textChars: 20_000,
  tableRows: 100,
  tableCols: 24,
  notesChars: 8_000,
} as const;

/** Element kinds, as the editor and the AI think about them. */
export type Kind = "slide" | "group" | "text" | "list" | "item" | "inline" | "image" | "graphic" | "table" | "row" | "cell" | "shape" | "rule" | "notes";

export interface ElementSpec {
  kind: Kind;
  /** Tags this element may hold, or "inline" for inline content (text + inline tags). */
  children: readonly string[] | "inline" | "none" | "raw";
  /** Attributes beyond the global ones (id, style). */
  attrs?: readonly string[];
}

const BLOCKS = ["div", "h1", "h2", "h3", "p", "ul", "ol", "img", "svg", "table", "hr", "x-shape"] as const;
export const INLINE_TAGS = ["span", "b", "i", "u", "a", "br"] as const;

export const ELEMENTS: Record<string, ElementSpec> = {
  section: { kind: "slide", children: [...BLOCKS, "aside"], attrs: ["data-transition", "data-section", "hidden"] },
  div: { kind: "group", children: BLOCKS, attrs: ["data-style", "data-build"] },
  h1: { kind: "text", children: "inline", attrs: ["data-style", "data-build", "data-fit"] },
  h2: { kind: "text", children: "inline", attrs: ["data-style", "data-build", "data-fit"] },
  h3: { kind: "text", children: "inline", attrs: ["data-style", "data-build", "data-fit"] },
  p: { kind: "text", children: "inline", attrs: ["data-style", "data-build", "data-fit"] },
  ul: { kind: "list", children: ["li"], attrs: ["data-style", "data-build"] },
  ol: { kind: "list", children: ["li"], attrs: ["data-style", "data-build"] },
  li: { kind: "item", children: "inline" },
  span: { kind: "inline", children: "inline" },
  b: { kind: "inline", children: "inline" },
  i: { kind: "inline", children: "inline" },
  u: { kind: "inline", children: "inline" },
  a: { kind: "inline", children: "inline", attrs: ["href"] },
  br: { kind: "inline", children: "none" },
  img: { kind: "image", children: "none", attrs: ["src", "alt", "data-build"] },
  svg: { kind: "graphic", children: "raw", attrs: ["viewBox", "aria-label", "data-build", "xmlns", "width", "height", "fill", "preserveAspectRatio"] },
  table: { kind: "table", children: ["tr"], attrs: ["data-build"] },
  tr: { kind: "row", children: ["th", "td"] },
  th: { kind: "cell", children: "inline" },
  td: { kind: "cell", children: "inline" },
  hr: { kind: "rule", children: "none", attrs: ["data-build"] },
  "x-shape": { kind: "shape", children: "none", attrs: ["kind", "data-build"] },
  aside: { kind: "notes", children: "inline" },
};

export const SHAPE_KINDS = ["rect", "rounded", "ellipse", "diamond", "triangle", "arrow-right", "arrow-left", "arrow-up", "arrow-down", "line"] as const;
export const TRANSITIONS = ["none", "fade", "push", "morph"] as const;
export const BUILDS = ["fade", "rise", "drop", "scale", "left", "right"] as const;

// Element groups used by the property table.
const BOX = ["section", "div", "h1", "h2", "h3", "p", "ul", "ol", "img", "svg", "table", "hr", "x-shape"];
const TEXTY = ["section", "div", "h1", "h2", "h3", "p", "ul", "ol", "table", "th", "td", "li"];
const CONTAINERS = ["section", "div"];
const ALL_BUT_SECTION = BOX.filter((t) => t !== "section");
const PAINTED = ["section", "div", "h1", "h2", "h3", "p", "ul", "ol", "img", "table", "x-shape", "tr"];
const STROKED = ["div", "h1", "h2", "h3", "p", "ul", "ol", "img", "table", "x-shape", "hr", "svg"];

export interface PropertySpec {
  check: Check;
  on: readonly string[];
  /** Inspector grouping; the editor builds its panels from this. */
  group: "layout" | "size" | "text" | "appearance" | "effects";
  /** Only meaningful with position:absolute. */
  pinnedOnly?: boolean;
  /** Inherited by descendants (text properties), as in CSS. */
  inherits?: boolean;
}

const ALIGN = enumOf("start", "center", "end", "stretch", "baseline", "flex-start", "flex-end");

export const PROPERTIES: Record<string, PropertySpec> = {
  // Layout
  position: { check: enumOf("absolute", "relative"), on: ALL_BUT_SECTION, group: "layout" },
  left: { check: anyOf(lengthOrPct(-4000, 4000), enumOf("auto")), on: ALL_BUT_SECTION, group: "layout", pinnedOnly: true },
  top: { check: anyOf(lengthOrPct(-4000, 4000), enumOf("auto")), on: ALL_BUT_SECTION, group: "layout", pinnedOnly: true },
  right: { check: anyOf(lengthOrPct(-4000, 4000), enumOf("auto")), on: ALL_BUT_SECTION, group: "layout", pinnedOnly: true },
  bottom: { check: anyOf(lengthOrPct(-4000, 4000), enumOf("auto")), on: ALL_BUT_SECTION, group: "layout", pinnedOnly: true },
  display: { check: enumOf("flex", "grid", "none"), on: CONTAINERS, group: "layout" },
  "flex-direction": { check: enumOf("row", "column", "row-reverse", "column-reverse"), on: CONTAINERS, group: "layout" },
  "flex-wrap": { check: enumOf("wrap", "nowrap"), on: CONTAINERS, group: "layout" },
  gap: { check: repeatOf(length(0, 512), 1, 2), on: CONTAINERS, group: "layout" },
  "align-items": { check: ALIGN, on: CONTAINERS, group: "layout" },
  "justify-content": { check: enumOf("start", "center", "end", "space-between", "space-around", "space-evenly", "flex-start", "flex-end"), on: CONTAINERS, group: "layout" },
  "justify-items": { check: enumOf("start", "center", "end", "stretch"), on: CONTAINERS, group: "layout" },
  "align-self": { check: anyOf(ALIGN, enumOf("auto")), on: ALL_BUT_SECTION, group: "layout" },
  "justify-self": { check: enumOf("start", "center", "end", "stretch", "auto"), on: ALL_BUT_SECTION, group: "layout" },
  flex: { check: flex, on: ALL_BUT_SECTION, group: "layout" },
  "flex-grow": { check: number(0, 100), on: ALL_BUT_SECTION, group: "layout" },
  "flex-shrink": { check: number(0, 100), on: ALL_BUT_SECTION, group: "layout" },
  "flex-basis": { check: anyOf(length(0, 4000), percentage, enumOf("auto")), on: ALL_BUT_SECTION, group: "layout" },
  "grid-template-columns": { check: tracks, on: CONTAINERS, group: "layout" },
  "grid-template-rows": { check: tracks, on: CONTAINERS, group: "layout" },
  "grid-column": { check: span, on: ALL_BUT_SECTION, group: "layout" },
  "grid-row": { check: span, on: ALL_BUT_SECTION, group: "layout" },
  padding: { check: repeatOf(length(0, 400), 1, 4), on: [...CONTAINERS, "h1", "h2", "h3", "p", "ul", "ol", "th", "td"], group: "layout" },
  overflow: { check: enumOf("hidden", "visible"), on: CONTAINERS, group: "layout" },

  // Size
  width: { check: anyOf(lengthOrPct(0, 4000), enumOf("auto")), on: [...ALL_BUT_SECTION, "th", "td"], group: "size" },
  height: { check: anyOf(lengthOrPct(0, 4000), enumOf("auto")), on: ALL_BUT_SECTION, group: "size" },
  "min-width": { check: anyOf(length(0, 4000), enumOf("min-content", "max-content")), on: ALL_BUT_SECTION, group: "size" },
  "min-height": { check: length(0, 4000), on: ALL_BUT_SECTION, group: "size" },
  "max-width": { check: length(0, 4000), on: ALL_BUT_SECTION, group: "size" },
  "max-height": { check: length(0, 4000), on: ALL_BUT_SECTION, group: "size" },
  "aspect-ratio": { check: aspectRatio, on: ALL_BUT_SECTION, group: "size" },

  // Text
  "font-family": { check: fontFamily, on: TEXTY, group: "text", inherits: true },
  "font-size": { check: length(8, 400), on: TEXTY, group: "text", inherits: true },
  "font-weight": { check: fontWeight, on: [...TEXTY, "span"], group: "text", inherits: true },
  "font-style": { check: enumOf("normal", "italic"), on: [...TEXTY, "span"], group: "text", inherits: true },
  "line-height": { check: lineHeight, on: TEXTY, group: "text", inherits: true },
  "letter-spacing": { check: letterSpacing, on: TEXTY, group: "text", inherits: true },
  "text-align": { check: enumOf("left", "center", "right", "justify"), on: TEXTY, group: "text", inherits: true },
  "text-transform": { check: enumOf("none", "uppercase", "lowercase", "capitalize"), on: TEXTY, group: "text", inherits: true },
  "white-space": { check: enumOf("normal", "nowrap"), on: TEXTY, group: "text", inherits: true },
  "text-decoration": { check: textDecoration, on: [...TEXTY, "span"], group: "text" },
  "font-variant-numeric": { check: enumOf("normal", "tabular-nums"), on: TEXTY, group: "text", inherits: true },
  color: { check: color, on: [...TEXTY, "span", "x-shape", "hr"], group: "text", inherits: true },

  // Appearance
  background: { check: paint, on: PAINTED, group: "appearance" },
  border: { check: border, on: STROKED, group: "appearance" },
  "border-top": { check: border, on: STROKED, group: "appearance" },
  "border-right": { check: border, on: STROKED, group: "appearance" },
  "border-bottom": { check: border, on: STROKED, group: "appearance" },
  "border-left": { check: border, on: STROKED, group: "appearance" },
  "border-radius": { check: repeatOf(lengthOrPct(0, 2000), 1, 4), on: ["div", "h1", "h2", "h3", "p", "ul", "ol", "img", "table", "x-shape"], group: "appearance" },
  opacity: { check: number(0, 1), on: BOX, group: "appearance" },
  "object-fit": { check: enumOf("cover", "contain"), on: ["img"], group: "appearance" },
  "object-position": { check: objectPosition, on: ["img"], group: "appearance" },

  // Effects
  "box-shadow": { check: shadow(true, 4), on: ["div", "h1", "h2", "h3", "p", "ul", "ol", "img", "table", "x-shape"], group: "effects" },
  "text-shadow": { check: shadow(false, 3), on: TEXTY, group: "effects" },
  transform: { check: transform, on: ALL_BUT_SECTION, group: "effects" },
  filter: { check: filter, on: ["div", "h1", "h2", "h3", "p", "img", "svg", "x-shape"], group: "effects" },
  "backdrop-filter": { check: filter, on: ["div"], group: "effects" },
  "mix-blend-mode": { check: enumOf("normal", "multiply", "screen", "overlay", "darken", "lighten"), on: ["div", "h1", "h2", "h3", "p", "img", "svg", "x-shape"], group: "effects" },
};

/** Declarations accepted and dropped silently: harmless leftovers models and pasted HTML often carry. */
export const IGNORED_PROPERTIES = new Set(["box-sizing", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left"]);

/** Properties an editor/AI should reach for, by the closest unsupported one. */
export const SUGGESTIONS: Record<string, string> = {
  margin: "use gap on the parent, or padding",
  "z-index": "later children paint over earlier ones; reorder the element",
  float: "use a flex row",
  "font": "set font-family, font-size, font-weight and line-height separately",
  "background-color": "use background",
  "background-image": "use an <img> with object-fit, or background with a gradient",
  "grid-template-areas": "use grid-template-columns with span",
};
