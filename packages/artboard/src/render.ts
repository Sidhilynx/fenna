// One renderer for every surface: the canvas, the focused view, the Home
// cover, the panel's preview and the exports all show an artboard through
// `artboardMarkup`.

import { serializeStyle } from "@opendeck/format";
import { type ArtboardDoc, type ArtboardNode, type ArtboardTheme, VOID_TAGS, artboardCss, escapeAttr, escapeText } from "./artboard.ts";

export interface RenderOptions {
  theme?: Partial<ArtboardTheme>;
  /** Tag every element with data-od="<address>", so a click can be traced back to the tree. */
  annotate?: boolean;
  /** Where an image in assets/ is loaded from; null leaves it out. */
  asset?: (src: string) => string | null;
  /** "body" for a page of its own; ":host" inside a shadow root. */
  scope?: "body" | ":host";
}

function renderNode(node: ArtboardNode, opts: RenderOptions, addr: string): string {
  if (node.type === "text") return escapeText(node.text);
  let attrs = opts.annotate ? ` data-od="${addr}"` : "";
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === "src") {
      const src = opts.asset ? opts.asset(v) : v;
      if (src) attrs += ` src="${escapeAttr(src)}"`;
    } else attrs += ` ${k}="${escapeAttr(v)}"`;
  }
  if (node.tag === "img") attrs += ' draggable="false"';
  const style = serializeStyle(node.style);
  if (style) attrs += ` style="${escapeAttr(style)}"`;
  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attrs}>`;
  if (node.tag === "svg") return `<svg${attrs}>${node.raw ?? ""}</svg>`;
  let i = 0;
  const inner = node.children.map((c) => renderNode(c, opts, c.type === "element" ? (addr === "" ? String(i++) : `${addr}.${i++}`) : addr)).join("");
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

/** An artboard as browser markup: its stylesheet and its one root element. */
export function artboardMarkup(doc: ArtboardDoc, opts: RenderOptions = {}): { css: string; html: string } {
  return { css: artboardCss(doc, opts.theme, opts.scope ?? "body"), html: renderNode(doc.root, opts, "") };
}

export interface StandaloneOptions extends Partial<ArtboardTheme> {
  title?: string;
  /** Each assets/ path as a data: URI, so the page needs no other file. */
  assets?: ReadonlyMap<string, string>;
  /** Extra CSS for the page (the fonts, embedded). */
  css?: string;
}

/** One artboard as a web page that needs nothing else: for export. */
export function standaloneHtml(doc: ArtboardDoc, opts: StandaloneOptions = {}): string {
  return pagesHtml([{ doc, width: 0, height: 0 }], opts);
}

/**
 * Several artboards as one document, each on a page of its own size: what
 * "all artboards" prints to PDF. With one artboard and no size it is a plain page.
 */
export function pagesHtml(pages: { doc: ArtboardDoc; width: number; height: number }[], opts: StandaloneOptions = {}): string {
  const asset = (src: string) => opts.assets?.get(src) ?? (opts.assets ? null : src);
  const paged = pages.length > 1 || (pages[0]?.width ?? 0) > 0;
  const first = pages[0]!.doc;
  const all: ArtboardDoc = { ...first, root: { ...first.root, children: pages.map((p) => p.doc.root) } };
  const css = [
    artboardCss(all, opts),
    ...(paged ? pages.flatMap((p, i) => [`@page p${i} { size: ${p.width}px ${p.height}px; margin: 0; }`, `.page-${i} { page: p${i}; width: ${p.width}px; height: ${p.height}px; overflow: hidden; break-after: page; }`]) : []),
    ...(opts.css ? [opts.css] : []),
  ].join("\n");
  const body = pages.map((p, i) => (paged ? `<div class="page-${i}">${renderNode(p.doc.root, { asset }, "")}</div>` : renderNode(p.doc.root, { asset }, ""))).join("\n");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeText(opts.title ?? first.title ?? "Untitled")}</title>
<style>
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
