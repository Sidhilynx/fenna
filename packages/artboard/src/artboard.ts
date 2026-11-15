// One artboard file: parse it, check it against the format, write it back.
//
// An artboard is a web page with one root element and inline styles: what an
// AI writes when asked for HTML. The <style> in its head is written by the
// serializer (the design's variables and text styles, so the file looks right
// opened on its own); only its :root variables are read back. A file with any
// error is refused whole, with problems that name the line and how to fix it.

import { parseDocument } from "htmlparser2";
import type { ChildNode, Element as DomElement } from "domhandler";
import render from "dom-serializer";
import { type Declaration, type ValueContext, parseStyle, serializeStyle } from "@opendeck/format";
import { BLOCKS, DEFAULT_TEXT_STYLES, ELEMENTS, HREF_RE, IMAGE_SRC_RE, INLINE_TAGS, INPUT_TYPES, LIMITS, PROPERTIES, SHAPE_KINDS, TWEAK_RE, nearestProperty } from "./schema.ts";

export interface TextNode {
  type: "text";
  text: string;
}

export interface ElementNode {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  style: Declaration[];
  children: ArtboardNode[];
  /** Inner markup of an <svg>, kept verbatim. */
  raw?: string;
  line: number;
  col: number;
}

export type ArtboardNode = ElementNode | TextNode;

export interface ArtboardDoc {
  title: string;
  /** The :root variables the file carries (the design's tweaks when it was saved). */
  vars: Record<string, string>;
  root: ElementNode;
}

/** What the design gives every artboard: its variables and named text styles. */
export interface ArtboardTheme {
  tweaks: Record<string, string>;
  textStyles: Record<string, string>;
}

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  line: number;
  col: number;
  /** Path from the root, e.g. "div > div:2 > p:1" (1-based among same tags). */
  path: string;
}

export interface ParseResult {
  doc: ArtboardDoc | null;
  diagnostics: Diagnostic[];
  /** True when there are no errors. */
  ok: boolean;
}

export const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const GLOBAL_ATTRS = new Set(["id", "style"]);
const EMPTY_CTX: ValueContext = { colorTokens: new Set(), families: new Set() };
const ROOT_RE = /:root\s*\{([^}]*)\}/;
/** Selectors the serializer writes itself; anything else in a <style> is reported. */
const OWN_RULE_RE = /^(:root|body|\*|button, input|x-shape(\[kind="[a-z-]+"\])?|\[data-style="[^"]*"\])$/;

function lineCol(src: string, index: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = src.indexOf("\n"); i >= 0 && i < index; i = src.indexOf("\n", i + 1)) {
    line++;
    last = i;
  }
  return { line, col: index - last };
}

interface Walk {
  src: string;
  ctx: ValueContext;
  diags: Diagnostic[];
  elements: number;
  textChars: number;
}

function report(w: Walk, severity: Severity, code: string, message: string, at: { line: number; col: number }, path: string) {
  w.diags.push({ severity, code, message, line: at.line, col: at.col, path });
}

function findAll(nodes: ChildNode[], name: string, out: DomElement[] = []): DomElement[] {
  for (const n of nodes) {
    if (n.type !== "tag" && n.type !== "style" && n.type !== "script") continue;
    const el = n as DomElement;
    if (el.name.toLowerCase() === name) out.push(el);
    findAll(el.children as ChildNode[], name, out);
  }
  return out;
}

function textOf(node: ChildNode): string {
  if (node.type === "text") return node.data;
  return "children" in node ? (node.children as ChildNode[]).map(textOf).join("") : "";
}

/** The `--name: value` pairs of a stylesheet's :root rule. */
export function rootVars(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of (ROOT_RE.exec(css)?.[1] ?? "").split(";")) {
    const i = decl.indexOf(":");
    const name = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (i > 0 && TWEAK_RE.test(name) && value) out[name] = value;
  }
  return out;
}

/** The value context for an artboard: the design's (when given) plus the variables the file itself declares. */
function contextFor(ctx: ValueContext, vars: Record<string, string>): ValueContext {
  const colorTokens = new Set(ctx.colorTokens);
  for (const name of Object.keys(vars)) colorTokens.add(name.slice(2));
  return { colorTokens, families: ctx.families };
}

/**
 * Parse an artboard. `html` is a whole page, or just the root element (the
 * head is then written on save).
 */
export function parseArtboard(html: string, ctx: ValueContext = EMPTY_CTX): ParseResult {
  const w: Walk = { src: html, ctx, diags: [], elements: 0, textChars: 0 };
  const origin = { line: 1, col: 1 };
  const fail = (): ParseResult => ({ doc: null, diagnostics: w.diags, ok: false });

  if (!html.trim()) {
    report(w, "error", "empty-file", "the artboard is empty: write one root element, e.g. <div style=\"width: 800px; height: 600px; background: #ffffff;\">…</div>", origin, "");
    return fail();
  }

  const dom = parseDocument(html, { withStartIndices: true, withEndIndices: true, lowerCaseTags: false, lowerCaseAttributeNames: false, recognizeSelfClosing: true });
  const top = dom.children as ChildNode[];
  const title = textOf(findAll(top, "title")[0] ?? ({ type: "text", data: "" } as ChildNode)).trim().slice(0, LIMITS.titleChars);
  const css = findAll(top, "style").map(textOf).join("\n");
  const vars = rootVars(css);
  w.ctx = contextFor(ctx, vars);
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const selector = m[1]!.trim().replace(/\s+/g, " ");
    if (!OWN_RULE_RE.test(selector)) {
      report(w, "warning", "style-dropped", `the <style> rule for "${selector.slice(0, 60)}" is not kept: put styles inline on the element (only :root variables are read from <style>)`, origin, "");
      break;
    }
  }

  const body = findAll(top, "body")[0];
  const holder = body ? (body.children as ChildNode[]) : top.flatMap((n) => (n.type === "tag" && (n as DomElement).name.toLowerCase() === "html" ? ((n as DomElement).children as ChildNode[]) : [n]));
  const outside = new Set(["head", "title", "style", "meta", "link"]);
  const roots = holder.filter((n): n is DomElement => (n.type === "tag" || n.type === "script") && !outside.has((n as DomElement).name.toLowerCase()));
  const loose = holder.find((n) => n.type === "text" && n.data.trim());
  if (loose) report(w, "error", "loose-text", "text must be inside an element: wrap it in <p> or a heading within the root <div>", lineCol(html, loose.startIndex ?? 0), "");
  if (!roots.length) {
    report(w, "error", "artboard-root", "an artboard holds exactly one root element (a <div> with a width and a height); none was found", origin, "");
    return fail();
  }
  if (roots.length > 1) {
    report(w, "error", "artboard-root", `an artboard holds exactly one root element; found ${roots.length}. Wrap them in one <div>`, lineCol(html, roots[1]!.startIndex ?? 0), "");
  }
  const rootDom = roots[0]!;
  const rootTag = rootDom.name.toLowerCase();
  if (ELEMENTS[rootTag] && !(BLOCKS as readonly string[]).includes(rootTag)) {
    report(w, "error", "artboard-root", `<${rootTag}> can't be an artboard's root: use a <div>`, lineCol(html, rootDom.startIndex ?? 0), rootTag);
    return fail();
  }
  const root = convert(rootDom, w, rootTag, 0);
  if (!root) return fail();

  if (w.elements > LIMITS.elementsPerArtboard) report(w, "error", "too-many-elements", `an artboard holds at most ${LIMITS.elementsPerArtboard} elements (this has ${w.elements}): split it into two artboards`, origin, rootTag);
  if (w.textChars > LIMITS.textChars) report(w, "error", "too-much-text", `an artboard holds at most ${LIMITS.textChars.toLocaleString("en-US")} characters of text`, origin, rootTag);

  return { doc: { title, vars, root }, diagnostics: w.diags, ok: !w.diags.some((d) => d.severity === "error") };
}

function convert(el: DomElement, w: Walk, path: string, divDepth: number): ElementNode | null {
  const at = lineCol(w.src, el.startIndex ?? 0);
  const tag = el.name.toLowerCase();
  const spec = ELEMENTS[tag];
  if (!spec) {
    const why = ["script", "iframe", "canvas", "video", "audio", "object", "embed", "link"].includes(tag)
      ? "artboards hold no scripts, embeds or outside files"
      : ["section", "header", "footer", "main", "nav", "article", "aside", "form"].includes(tag)
        ? "use a <div>"
        : ["strong", "em"].includes(tag)
          ? `use <${tag === "strong" ? "b" : "i"}>`
          : `the elements are: ${Object.keys(ELEMENTS).join(", ")}`;
    report(w, "error", "unknown-tag", `<${tag}> is not part of the design format (${why})`, at, path);
    return null;
  }
  w.elements++;
  const node: ElementNode = { type: "element", tag, attrs: {}, style: [], children: [], line: at.line, col: at.col };

  const allowed = new Set([...(spec.attrs ?? []), ...GLOBAL_ATTRS]);
  for (const [rawName, value] of Object.entries(el.attribs)) {
    const name = tag === "svg" ? rawName : rawName.toLowerCase();
    if (/^on/i.test(name)) {
      report(w, "error", "script-attr", `${name} is not allowed: artboards hold no scripts`, at, path);
      continue;
    }
    if (name === "class") {
      report(w, "warning", "class-dropped", "class is ignored: put the styles inline, or use data-style for a named text style", at, path);
      continue;
    }
    if (!allowed.has(name)) {
      if (!name.startsWith("data-")) report(w, "warning", "attr-dropped", `<${tag}> takes no ${name} attribute; it was dropped`, at, path);
      continue;
    }
    if (name !== "style") node.attrs[name] = value;
  }

  if (node.attrs.id !== undefined && !ID_RE.test(node.attrs.id)) report(w, "error", "bad-id", `id "${node.attrs.id}" must start with a letter and use only letters, digits, - and _ (64 at most)`, at, path);
  if (tag === "x-shape" && !(SHAPE_KINDS as readonly string[]).includes(node.attrs.kind ?? "")) report(w, "error", "bad-shape-kind", `<x-shape> needs kind="${SHAPE_KINDS.join("|")}"`, at, path);
  if (tag === "img" && !IMAGE_SRC_RE.test(node.attrs.src ?? "")) report(w, "error", "bad-src", `<img src> must be a file in assets/, like "assets/photo.png" (not a URL or data: URI); got "${(node.attrs.src ?? "").slice(0, 60)}"`, at, path);
  if (tag === "a" && node.attrs.href !== undefined && !HREF_RE.test(node.attrs.href)) report(w, "error", "bad-href", `href "${node.attrs.href.slice(0, 60)}" must be https://…, mailto:…, or another artboard's file like "Pricing.html"`, at, path);
  if (tag === "input" && node.attrs.type !== undefined && !(INPUT_TYPES as readonly string[]).includes(node.attrs.type)) report(w, "error", "bad-input-type", `<input type> must be one of: ${INPUT_TYPES.join(", ")}`, at, path);

  const parsed = parseStyle(el.attribs.style ?? "");
  for (const e of parsed.errors) report(w, "error", "style-syntax", e, at, path);
  for (const d of parsed.decls) {
    const prop = PROPERTIES[d.name];
    if (!prop) {
      const near = nearestProperty(d.name);
      report(w, "error", "unknown-property", `${d.name} is not a property of the design format.${near ? ` Did you mean ${near}?` : ""} format_guide lists every property`, at, path);
      continue;
    }
    if (!prop.on.includes(tag)) {
      report(w, "error", "property-misplaced", `${d.name} does not apply to <${tag}>; it goes on: ${prop.on.slice(0, 8).join(", ")}${prop.on.length > 8 ? ", …" : ""}`, at, path);
      continue;
    }
    const problem = prop.check(d.value, w.ctx);
    if (problem) {
      report(w, "error", "bad-value", `${d.name}: ${d.value} is refused: ${problem.replace("the theme has no color", "the design has no tweak")}`, at, path);
      continue;
    }
    node.style.push(d);
  }

  if (spec.children === "raw") {
    node.raw = (el.children as ChildNode[]).map((c) => render(c, { xmlMode: true, decodeEntities: false })).join("");
    if (node.raw.length > LIMITS.svgBytes) report(w, "error", "svg-too-big", `an <svg> holds at most ${LIMITS.svgBytes / 1024} KB`, at, path);
    if (/<script|<foreignObject|\bon[a-z]+\s*=|href\s*=\s*["'](?!#)/i.test(node.raw)) report(w, "error", "svg-script", "an <svg> holds no scripts, event handlers, <foreignObject> or outside references", at, path);
    return node;
  }

  const depth = divDepth + (tag === "div" ? 1 : 0);
  if (tag === "div" && depth === LIMITS.divDepth + 1) report(w, "error", "too-deep", `containers nest at most ${LIMITS.divDepth} deep`, at, path);
  if (tag === "table") {
    const rows = (el.children as ChildNode[]).filter((c) => c.type === "tag");
    const cols = Math.max(0, ...rows.map((r) => (r as DomElement).children.filter((c) => c.type === "tag").length));
    if (rows.length > LIMITS.tableRows || cols > LIMITS.tableCols) report(w, "error", "table-too-big", `a table holds at most ${LIMITS.tableRows} rows and ${LIMITS.tableCols} columns`, at, path);
  }

  const counters: Record<string, number> = {};
  for (const child of el.children as ChildNode[]) {
    if (child.type === "text") {
      if (spec.children === "inline") {
        node.children.push({ type: "text", text: child.data });
        w.textChars += child.data.length;
      } else if (child.data.trim()) {
        report(w, "error", "loose-text", `text directly inside <${tag}> must be wrapped in <p> or a heading`, lineCol(w.src, child.startIndex ?? 0), path);
      }
      continue;
    }
    if (child.type !== "tag" && child.type !== "script" && child.type !== "style") continue;
    const childEl = child as DomElement;
    let childTag = childEl.name.toLowerCase();
    // Browsers put table rows inside a <tbody>; the format keeps rows directly in the table.
    if (tag === "table" && ["tbody", "thead", "tfoot"].includes(childTag)) {
      for (const row of childEl.children as ChildNode[]) {
        if (row.type !== "tag") continue;
        childTag = (row as DomElement).name.toLowerCase();
        counters[childTag] = (counters[childTag] ?? 0) + 1;
        const converted = convert(row as DomElement, w, `${path} > ${childTag}:${counters[childTag]}`, depth);
        if (converted) node.children.push(converted);
      }
      continue;
    }
    counters[childTag] = (counters[childTag] ?? 0) + 1;
    const childPath = `${path} > ${childTag}:${counters[childTag]}`;
    const fits =
      spec.children === "inline"
        ? (INLINE_TAGS as readonly string[]).includes(childTag) || (tag === "li" && (childTag === "ul" || childTag === "ol"))
        : spec.children !== "none" && spec.children.includes(childTag);
    if (!fits && ELEMENTS[childTag]) {
      const hint = spec.children === "inline" ? `<${tag}> holds text and ${INLINE_TAGS.join(", ")} only; put <${childTag}> beside it, inside a <div>` : spec.children === "none" ? `<${tag}> holds nothing` : `<${tag}> holds: ${(spec.children as readonly string[]).join(", ")}`;
      report(w, "error", "misplaced", `<${childTag}> cannot go inside <${tag}> (${hint})`, lineCol(w.src, childEl.startIndex ?? 0), childPath);
      continue;
    }
    const converted = convert(childEl, w, childPath, depth);
    if (converted) node.children.push(converted);
  }
  if (spec.children === "inline") node.children = collapse(node.children);
  return node;
}

/** Runs of whitespace in text become one space; the ends are trimmed. */
function collapse(nodes: ArtboardNode[]): ArtboardNode[] {
  const out: ArtboardNode[] = [];
  for (const n of nodes) {
    if (n.type !== "text") out.push(n);
    else if (n.text) out.push({ type: "text", text: n.text.replace(/\s+/g, " ") });
  }
  const first = out[0];
  if (first?.type === "text") first.text = first.text.replace(/^\s+/, "");
  const last = out[out.length - 1];
  if (last?.type === "text") last.text = last.text.replace(/\s+$/, "");
  return out.filter((n) => n.type !== "text" || n.text.length > 0);
}

// ── Writing ────────────────────────────────────────────────────────────────

const ATTR_ORDER = ["id", "kind", "src", "alt", "href", "type", "for", "value", "placeholder", "disabled", "data-style", "viewBox", "aria-label", "xmlns", "width", "height", "fill", "preserveAspectRatio"];
export const VOID_TAGS: ReadonlySet<string> = new Set(["br", "img", "hr", "input"]);

export const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function openTag(n: ElementNode): string {
  const rank = (a: string) => (ATTR_ORDER.indexOf(a) < 0 ? 99 : ATTR_ORDER.indexOf(a));
  const names = Object.keys(n.attrs).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  let s = `<${n.tag}`;
  for (const name of names) s += ` ${name}="${escapeAttr(n.attrs[name]!)}"`;
  if (n.style.length) s += ` style="${escapeAttr(serializeStyle(n.style))}"`;
  return s + ">";
}

function serializeInline(nodes: ArtboardNode[]): string {
  return nodes
    .map((c) => {
      if (c.type === "text") return escapeText(c.text);
      if (VOID_TAGS.has(c.tag)) return openTag(c);
      if (c.tag === "ul" || c.tag === "ol") return `${openTag(c)}${c.children.map((li) => (li.type === "element" ? serializeBlock(li) : "")).join("")}</${c.tag}>`;
      return `${openTag(c)}${serializeInline(c.children)}</${c.tag}>`;
    })
    .join("");
}

/** What a text element holds, as the HTML the file has for it. */
export const contentHtml = (el: ElementNode): string => serializeInline(el.children);

/** One element and what it holds, as the file has it (two-space indent). */
export function serializeBlock(n: ElementNode, indent = ""): string {
  if (VOID_TAGS.has(n.tag)) return indent + openTag(n);
  if (n.tag === "svg") return `${indent}${openTag(n)}${n.raw ?? ""}</svg>`;
  if (ELEMENTS[n.tag]?.children === "inline" || ELEMENTS[n.tag]?.children === "none") return `${indent}${openTag(n)}${serializeInline(n.children)}</${n.tag}>`;
  const inner = n.children.filter((c): c is ElementNode => c.type === "element").map((c) => serializeBlock(c, indent + "  "));
  return inner.length ? `${indent}${openTag(n)}\n${inner.join("\n")}\n${indent}</${n.tag}>` : `${indent}${openTag(n)}</${n.tag}>`;
}

const SHAPE_CSS: Record<string, string> = {
  rect: "",
  rounded: "border-radius: 16px;",
  ellipse: "border-radius: 50%;",
  diamond: "clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);",
  triangle: "clip-path: polygon(50% 0, 100% 100%, 0 100%);",
  "arrow-right": "clip-path: polygon(0 30%, 60% 30%, 60% 0, 100% 50%, 60% 100%, 60% 70%, 0 70%);",
  "arrow-left": "clip-path: polygon(100% 30%, 40% 30%, 40% 0, 0 50%, 40% 100%, 40% 70%, 100% 70%);",
  "arrow-up": "clip-path: polygon(30% 100%, 30% 40%, 0 40%, 50% 0, 100% 40%, 70% 40%, 70% 100%);",
  "arrow-down": "clip-path: polygon(30% 0, 30% 60%, 0 60%, 50% 100%, 100% 60%, 70% 60%, 70% 0);",
  line: "height: 2px; min-height: 2px;",
};

function shapesIn(n: ElementNode, out = new Set<string>()): Set<string> {
  if (n.tag === "x-shape" && n.attrs.kind) out.add(n.attrs.kind);
  for (const c of n.children) if (c.type === "element") shapesIn(c, out);
  return out;
}

/**
 * The stylesheet every surface gives an artboard: the design's variables,
 * border-box sizing, Inter as the base font, the named text styles, and the
 * shapes. `scope` is "body" in a file and ":host" in the editor's shadow root.
 */
export function artboardCss(doc: ArtboardDoc, theme: Partial<ArtboardTheme> = {}, scope: "body" | ":host" = "body"): string {
  const vars = { ...doc.vars, ...(theme.tweaks ?? {}) };
  const styles = theme.textStyles ?? DEFAULT_TEXT_STYLES;
  const root = scope === "body" ? ":root" : ":host";
  // In a shadow root nothing of the page around it may leak in: start from the browser's own defaults, as a file of its own does.
  const reset = scope === ":host" ? "\n  all: initial;\n  display: block;" : "";
  const lines = [
    `${root} {${reset}${Object.entries(vars).map(([k, v]) => `\n  ${k}: ${v};`).join("")}\n}`,
    "* { box-sizing: border-box; }",
    `${scope} { margin: 0; font-family: Inter, system-ui, sans-serif; }`,
    "button, input { font-family: inherit; }",
    ...Object.entries(styles).map(([name, decls]) => `[data-style="${name.replace(/["\\\]]/g, "")}"] { ${decls.trim().replace(/[{}<]/g, "")} }`),
  ];
  const shapes = shapesIn(doc.root);
  if (shapes.size) {
    lines.push("x-shape { display: block; min-width: 8px; min-height: 8px; background: currentColor; }");
    for (const kind of SHAPE_KINDS) if (shapes.has(kind) && SHAPE_CSS[kind]) lines.push(`x-shape[kind="${kind}"] { ${SHAPE_CSS[kind]} }`);
  }
  return lines.join("\n");
}

const indentLines = (text: string, by: string) => text.split("\n").map((l) => by + l).join("\n");

/** The whole file for an artboard, in its one canonical form. `theme` is the design's; without it the file's own variables are kept. */
export function serializeArtboard(doc: ArtboardDoc, theme: Partial<ArtboardTheme> & { title?: string } = {}): string {
  const title = theme.title ?? doc.title;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeText(title || "Untitled")}</title>
  <style>
${indentLines(artboardCss(doc, theme), "    ")}
  </style>
</head>
<body>
${serializeBlock(doc.root, "  ")}
</body>
</html>
`;
}

/** A new, empty artboard of a size. */
export function newArtboard(size: { width: number; height: number; title?: string }): ArtboardDoc {
  return {
    title: size.title ?? "Untitled",
    vars: {},
    root: {
      type: "element",
      tag: "div",
      attrs: {},
      style: [
        { name: "width", value: `${size.width}px` },
        { name: "height", value: `${size.height}px` },
        { name: "padding", value: "48px" },
        { name: "background", value: "#ffffff" },
        { name: "display", value: "flex" },
        { name: "flex-direction", value: "column" },
        { name: "gap", value: "16px" },
        { name: "color", value: "#1c1b19" },
      ],
      children: [],
      line: 1,
      col: 1,
    },
  };
}
