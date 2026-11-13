// One renderer for every surface: the editor canvas, thumbnails, the grid
// view, present mode and the PDF/PNG export all show a slide through this
// file, so what you edit is exactly what you present and export.
//
// It turns a parsed slide (from @opendeck/format) into browser markup:
// text styles resolved, theme colors as CSS custom properties on the slide,
// asset paths pointed at wherever the host serves the deck, and (for the
// editor) every element tagged with its address so a click maps back to the
// document and to what the AI is told is selected.

import { type ElementNode, type SlideNode, type Theme, SLIDE_HEIGHT, SLIDE_WIDTH, resolvedStyle, serializeStyle } from "@opendeck/format";

export interface RenderOptions {
  /** Prefix for assets/… paths (e.g. "odasset://deck-123/"). Default: relative. */
  assetBase?: string;
  /** Tag elements with data-od="<address>" for selection. */
  annotate?: boolean;
}

/**
 * An element's address on its slide: the chain of element-child indices from
 * the section, joined by "." ("" is the section itself, "1.0" the first
 * child of the second child). Stable for a given file; the AI and the editor
 * both use it, alongside an element's own id when it has one.
 */
export type Address = string;

const VOID = new Set(["br", "img", "hr"]);

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** CSS custom properties for the theme's colors, e.g. "--accent:#ff6b35;". */
export function themeVars(theme: Theme): string {
  return Object.entries(theme.colors)
    .map(([k, v]) => `--${k}:${v};`)
    .join("");
}

function render(node: SlideNode, theme: Theme, opts: RenderOptions, addr: Address): string {
  if (node.type === "text") return esc(node.text);
  const decls = resolvedStyle(node, theme);
  let attrs = "";
  if (node.attrs.id) attrs += ` id="${escAttr(node.attrs.id)}"`;
  if (opts.annotate) attrs += ` data-od="${addr}"`;
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === "id" || k === "data-style") continue;
    if (k === "src") attrs += ` src="${escAttr((opts.assetBase ?? "") + v)}"`;
    else if (k === "hidden") continue;
    else attrs += ` ${k}="${escAttr(v)}"`;
  }
  let style = serializeStyle(decls);
  if (node.tag === "section") style = `${themeVars(theme)}${style}`;
  if (style) attrs += ` style="${escAttr(style)}"`;

  const tag = node.tag === "section" ? "section" : node.tag;
  if (VOID.has(tag)) return `<${tag}${attrs}>`;
  if (tag === "svg") return `<svg${attrs}>${node.raw ?? ""}</svg>`;

  let i = 0;
  const inner = node.children
    .map((c) => {
      if (c.type === "text") return render(c, theme, opts, addr);
      const childAddr = addr === "" ? String(i) : `${addr}.${i}`;
      i++;
      return render(c, theme, opts, childAddr);
    })
    .join("");
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

/** The slide's markup: one <section class="od-slide">, 1920×1080, to be shown inside a scaled frame. */
export function slideMarkup(slide: ElementNode, theme: Theme, opts: RenderOptions = {}): string {
  const html = render(slide, theme, opts, "");
  return html.replace(/^<section/, '<section class="od-slide"');
}

/** Walk to the element at an address. */
export function elementAt(slide: ElementNode, addr: Address): ElementNode | null {
  if (addr === "") return slide;
  let cur: ElementNode = slide;
  for (const part of addr.split(".")) {
    const kids = cur.children.filter((c): c is ElementNode => c.type === "element");
    const next = kids[Number(part)];
    if (!next) return null;
    cur = next;
  }
  return cur;
}

/** Google Fonts stylesheet URL for the theme's Google faces, or null. */
export function googleFontsUrl(theme: Theme): string | null {
  const faces = theme.fonts.filter((f) => f.source === "google");
  if (!faces.length) return null;
  const fams = faces.map((f) => {
    const name = f.family.replace(/ /g, "+");
    const w = f.weights?.length ? `:wght@${[...f.weights].sort((a, b) => a - b).join(";")}` : "";
    return `family=${name}${w}`;
  });
  return `https://fonts.googleapis.com/css2?${fams.join("&")}&display=swap`;
}

/** @font-face rules for fonts shipped in the deck's assets/ folder. */
export function fontFaceCss(theme: Theme, assetBase = ""): string {
  return theme.fonts
    .filter((f) => f.source !== "google")
    .map((f) => `@font-face{font-family:"${f.family}";src:url("${assetBase}${f.source}");font-display:block}`)
    .join("\n");
}

const SHAPES: Record<string, string> = {
  rect: "",
  rounded: "border-radius:24px",
  ellipse: "border-radius:50%",
  diamond: "clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)",
  triangle: "clip-path:polygon(50% 0,100% 100%,0 100%)",
  "arrow-right": "clip-path:polygon(0 30%,60% 30%,60% 0,100% 50%,60% 100%,60% 70%,0 70%)",
  "arrow-left": "clip-path:polygon(100% 30%,40% 30%,40% 0,0 50%,40% 100%,40% 70%,100% 70%)",
  "arrow-up": "clip-path:polygon(30% 100%,30% 40%,0 40%,50% 0,100% 40%,70% 40%,70% 100%)",
  "arrow-down": "clip-path:polygon(30% 0,30% 60%,0 60%,50% 100%,100% 60%,70% 60%,70% 0)",
  line: "height:0!important;background:none!important;border-top:4px solid currentColor",
};

/**
 * The base stylesheet every surface loads once. It pins down everything the
 * browser would otherwise decide (margins, default sizes, box model) so a
 * slide looks the same in the editor, in present mode, and in the export.
 */
export const BASE_CSS = `
.od-slide{position:relative;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;
  font-family:Inter,Arial,sans-serif;font-size:32px;line-height:1.4;color:#151515;background:#ffffff;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-kerning:normal}
.od-slide *{box-sizing:border-box;margin:0;min-width:0}
.od-slide div{display:flex;flex-direction:column}
.od-slide h1{font-size:96px;font-weight:600;line-height:1.1}
.od-slide h2{font-size:64px;font-weight:600;line-height:1.15}
.od-slide h3{font-size:44px;font-weight:600;line-height:1.2}
.od-slide p{line-height:1.4}
.od-slide h1,.od-slide h2,.od-slide h3,.od-slide p,.od-slide li,.od-slide td,.od-slide th{overflow-wrap:normal;word-break:normal}
.od-slide ul,.od-slide ol{padding-left:1.25em}
.od-slide li+li{margin-top:0.3em}
.od-slide a{color:inherit;text-decoration:underline}
.od-slide img{display:block;object-fit:cover}
.od-slide svg{display:block;flex:none}
.od-slide table{border-collapse:collapse;width:100%}
.od-slide th,.od-slide td{padding:0.35em 0.6em;text-align:left;vertical-align:top;border-bottom:1px solid color-mix(in srgb,currentColor 22%,transparent)}
.od-slide th{font-weight:600}
.od-slide hr{border:0;border-top:2px solid currentColor;width:100%}
.od-slide x-shape{display:block;background:#8a867f;color:#8a867f;min-width:8px;min-height:8px}
${Object.entries(SHAPES)
  .filter(([, css]) => css)
  .map(([k, css]) => `.od-slide x-shape[kind="${k}"]{${css}}`)
  .join("\n")}
.od-slide aside{display:none}
`;

