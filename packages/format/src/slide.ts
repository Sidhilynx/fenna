// One slide file: parse it, check it against the subset, write it back out.
//
// A slide is exactly one <section> holding a small, closed set of HTML
// elements with inline styles (schema.ts). Writes are all-or-nothing: a
// slide with any error is refused as a whole, with diagnostics that name the
// element, the line and column, and the nearest supported change, so a model
// can fix its own output in one round. Warnings never block.

import { parseDocument } from "htmlparser2";
import type { ChildNode, Element as DomElement } from "domhandler";
import render from "dom-serializer";
import { type Declaration, type ValueContext, parseStyle, serializeStyle, splitTop, px } from "./css.ts";
import { BUILDS, ELEMENTS, IGNORED_PROPERTIES, INLINE_TAGS, LIMITS, PROPERTIES, SHAPE_KINDS, SUGGESTIONS, TRANSITIONS } from "./schema.ts";

export interface TextNode {
  type: "text";
  text: string;
}

export interface ElementNode {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  style: Declaration[];
  children: SlideNode[];
  /** Inner markup of an <svg>, kept verbatim (it is one opaque graphic). */
  raw?: string;
  line: number;
  col: number;
}

export type SlideNode = ElementNode | TextNode;

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  line: number;
  col: number;
  /** Path from the section, e.g. "section > div:2 > p:1" (1-based among elements). */
  path: string;
}

export interface ParseResult {
  slide: ElementNode | null;
  diagnostics: Diagnostic[];
  /** True when there are no errors. */
  ok: boolean;
}

export const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const GLOBAL_ATTRS = new Set(["id", "style"]);
const IMAGE_SRC_RE = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g|webp|gif|svg|avif)$/i;
const HREF_RE = /^(https?:\/\/\S+|mailto:\S+|#slide-\d{1,3})$/;

const EMPTY_CTX: ValueContext = { colorTokens: new Set(), families: new Set() };

function lineCol(src: string, index: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, col: index - last };
}

interface Walk {
  src: string;
  ctx: ValueContext;
  diags: Diagnostic[];
  elements: number;
}

function report(w: Walk, severity: Severity, code: string, message: string, at: { line: number; col: number }, path: string) {
  w.diags.push({ severity, code, message, line: at.line, col: at.col, path });
}

/** Parse and check one slide file's text. */
export function parseSlide(html: string, ctx: ValueContext = EMPTY_CTX): ParseResult {
  const w: Walk = { src: html, ctx, diags: [], elements: 0 };
  const doc = parseDocument(html, {
    withStartIndices: true,
    withEndIndices: true,
    lowerCaseTags: false,
    lowerCaseAttributeNames: false,
    recognizeSelfClosing: true,
  });

  const top = doc.children.filter((n) => !(n.type === "text" && !n.data.trim()) && n.type !== "comment");
  const sections = top.filter((n): n is DomElement => n.type === "tag" && n.name.toLowerCase() === "section");
  const origin = { line: 1, col: 1 };
  if (sections.length !== 1 || top.length !== 1) {
    report(w, "error", "slide-root", "a slide file holds exactly one <section> and nothing else", origin, "");
    if (sections.length === 0) return { slide: null, diagnostics: w.diags, ok: false };
  }
  const slide = convert(sections[0]!, w, "section", 0);
  if (slide) checkSlide(slide, w);
  const ok = !w.diags.some((d) => d.severity === "error");
  return { slide, diagnostics: w.diags, ok };
}

function convert(el: DomElement, w: Walk, path: string, divDepth: number): ElementNode | null {
  const at = lineCol(w.src, el.startIndex ?? 0);
  const tag = el.name.toLowerCase();
  const spec = ELEMENTS[tag];
  if (!spec) {
    const hint =
      tag === "img" || tag === "image" ? "" :
      ["h4", "h5", "h6"].includes(tag) ? " (use h3 or p with a font-size)" :
      ["strong", "em"].includes(tag) ? ` (use ${tag === "strong" ? "b" : "i"})` :
      ["script", "style", "link", "iframe", "canvas", "video", "object"].includes(tag) ? " (slides hold no scripts, stylesheets or embeds)" : "";
    report(w, "error", "unknown-tag", `<${tag}> is not part of the slide format${hint}`, at, path);
    return null;
  }
  w.elements++;

  const node: ElementNode = { type: "element", tag, attrs: {}, style: [], children: [], line: at.line, col: at.col };

  // Attributes
  const allowed = new Set([...(spec.attrs ?? []), ...GLOBAL_ATTRS]);
  for (const [rawName, value] of Object.entries(el.attribs)) {
    const name = tag === "svg" ? rawName : rawName.toLowerCase();
    if (/^on/i.test(name)) {
      report(w, "error", "script-attr", `${name} is not allowed: slides hold no scripts`, at, path);
      continue;
    }
    if (name === "class") {
      report(w, "warning", "class-dropped", "class is ignored: put styles inline", at, path);
      continue;
    }
    if (!allowed.has(name)) {
      if (!name.startsWith("data-")) report(w, "warning", "attr-dropped", `<${tag}> takes no ${name} attribute; it was dropped`, at, path);
      continue;
    }
    if (name === "style") continue;
    node.attrs[name] = value;
  }
  if (node.attrs.id !== undefined && !ID_RE.test(node.attrs.id)) {
    report(w, "error", "bad-id", `id "${node.attrs.id}" must start with a letter and use only letters, digits, - and _ (64 max)`, at, path);
  }

  // Styles
  const style = el.attribs.style ?? "";
  if (style) {
    const parsed = parseStyle(style);
    for (const e of parsed.errors) report(w, "error", "style-syntax", e, at, path);
    for (const d of parsed.decls) {
      if (IGNORED_PROPERTIES.has(d.name)) {
        if (d.name.startsWith("margin") && !/^0(px)?$/.test(d.value))
          report(w, "warning", "margin-dropped", `margin is ignored: ${SUGGESTIONS.margin}`, at, path);
        continue;
      }
      const prop = PROPERTIES[d.name];
      if (!prop) {
        const s = SUGGESTIONS[d.name];
        report(w, "error", "unknown-property", `${d.name} is not supported${s ? `: ${s}` : ""}`, at, path);
        continue;
      }
      if (!prop.on.includes(tag)) {
        report(w, "error", "property-misplaced", `${d.name} does not apply to <${tag}>`, at, path);
        continue;
      }
      const problem = prop.check(d.value, w.ctx);
      if (problem) {
        report(w, "error", "bad-value", `${d.name}: ${d.value} — ${problem}`, at, path);
        continue;
      }
      node.style.push(d);
    }
  }

  // Children
  if (spec.children === "raw") {
    node.raw = el.children.map((c) => render(c, { xmlMode: true, decodeEntities: false })).join("");
    checkSvg(node, w, at, path);
    return node;
  }
  const isDiv = tag === "div";
  const depth = divDepth + (isDiv ? 1 : 0);
  if (isDiv && depth > LIMITS.divDepth) report(w, "error", "too-deep", `groups nest at most ${LIMITS.divDepth} deep`, at, path);

  const counters: Record<string, number> = {};
  for (const child of el.children as ChildNode[]) {
    if (child.type === "comment") continue;
    if (child.type === "text") {
      const text = child.data;
      if (spec.children === "inline") node.children.push({ type: "text", text });
      else if (text.trim()) {
        const cat = lineCol(w.src, child.startIndex ?? 0);
        report(w, "error", "loose-text", `text directly inside <${tag}> must be wrapped in <p> or a heading`, cat, path);
      }
      continue;
    }
    if (child.type !== "tag" && child.type !== "script" && child.type !== "style") continue;
    const childTag = (child as DomElement).name.toLowerCase();
    counters[childTag] = (counters[childTag] ?? 0) + 1;
    const childPath = `${path} > ${childTag}:${counters[childTag]}`;
    const fits =
      spec.children === "inline" ? (INLINE_TAGS as readonly string[]).includes(childTag) || (tag === "li" && (childTag === "ul" || childTag === "ol")) :
      spec.children === "none" ? false :
      spec.children.includes(childTag);
    if (!fits && ELEMENTS[childTag]) {
      const cat = lineCol(w.src, child.startIndex ?? 0);
      report(w, "error", "misplaced", `<${childTag}> cannot go inside <${tag}>`, cat, childPath);
      continue;
    }
    const converted = convert(child as DomElement, w, childPath, depth);
    if (converted) node.children.push(converted);
  }
  if (spec.children === "inline") node.children = collapse(node.children, tag === "aside");
  return node;
}

/** Collapse whitespace in inline content the way the browser would render it. */
function collapse(nodes: SlideNode[], keepNewlines: boolean): SlideNode[] {
  const out: SlideNode[] = [];
  for (const n of nodes) {
    if (n.type === "text") {
      const text = keepNewlines ? n.text.replace(/[ \t]+/g, " ") : n.text.replace(/\s+/g, " ");
      if (text) out.push({ type: "text", text });
    } else out.push(n);
  }
  // Trim the ends of the run.
  const first = out[0];
  if (first?.type === "text") first.text = first.text.replace(/^\s+/, "");
  const last = out[out.length - 1];
  if (last?.type === "text") last.text = last.text.replace(/\s+$/, "");
  return out.filter((n) => n.type !== "text" || n.text.length > 0);
}

function checkSvg(node: ElementNode, w: Walk, at: { line: number; col: number }, path: string) {
  const raw = node.raw ?? "";
  if (raw.length > LIMITS.svgBytes) report(w, "error", "svg-too-big", `an <svg> holds at most ${LIMITS.svgBytes / 1024} KB`, at, path);
  if (/<script|<foreignObject/i.test(raw)) report(w, "error", "svg-script", "an <svg> holds no <script> or <foreignObject>", at, path);
  if (/\son[a-z]+\s*=/i.test(raw)) report(w, "error", "svg-script", "an <svg> holds no event handlers", at, path);
  if (/(href|src)\s*=\s*["'](?!#)/i.test(raw) || /url\(\s*['"]?(?!#)/i.test(raw))
    report(w, "error", "svg-external", "an <svg> may only reference its own #ids", at, path);
  if (!node.attrs.viewBox) report(w, "warning", "svg-viewbox", "give the <svg> a viewBox so it scales cleanly", at, path);
  if (/<text[\s>]/i.test(raw)) report(w, "warning", "svg-text", "text inside an <svg> can't be edited or use deck fonts; put labels in <p> elements over it", at, path);
}

const styleValue = (n: ElementNode, name: string) => n.style.find((d) => d.name === name)?.value;

/** Checks that need the whole tree: placement, limits, accessibility, readability. */
function checkSlide(slide: ElementNode, w: Walk) {
  const at = { line: slide.line, col: slide.col };
  if (!slide.attrs.id) report(w, "error", "missing-id", "the <section> needs an id (it is also the file name)", at, "section");
  if (!styleValue(slide, "background")) report(w, "warning", "no-background", "set a background on the section so it never shows the app's color", at, "section");
  if (slide.attrs["data-transition"] && !(TRANSITIONS as readonly string[]).includes(slide.attrs["data-transition"]))
    report(w, "error", "bad-transition", `data-transition must be one of ${TRANSITIONS.join(", ")}`, at, "section");
  if (w.elements > LIMITS.elementsPerSlide)
    report(w, "error", "too-many-elements", `a slide holds at most ${LIMITS.elementsPerSlide} elements; split it`, at, "section");

  const asides = slide.children.filter((c): c is ElementNode => c.type === "element" && c.tag === "aside");
  if (asides.length > 1) report(w, "error", "notes-twice", "a slide has one <aside> of speaker notes", at, "section");
  const lastEl = [...slide.children].reverse().find((c) => c.type === "element");
  if (asides.length === 1 && lastEl !== asides[0]) report(w, "error", "notes-position", "the <aside> of speaker notes must be the section's last child", at, "section");

  const ids = new Map<string, number>();
  const visit = (n: ElementNode, path: string, inheritedSize: number) => {
    const here = { line: n.line, col: n.col };
    if (n.attrs.id) ids.set(n.attrs.id, (ids.get(n.attrs.id) ?? 0) + 1);
    const pinned = styleValue(n, "position") === "absolute";
    for (const d of n.style) {
      if (PROPERTIES[d.name]?.pinnedOnly && !pinned)
        report(w, "warning", "offset-unpinned", `${d.name} only moves an element with position:absolute`, here, path);
    }
    if (n.attrs["data-build"] !== undefined) {
      const [effect, ...rest] = n.attrs["data-build"].split(/\s+/);
      if (!(BUILDS as readonly string[]).includes(effect ?? "") || rest.some((r) => !/^\d{1,2}$/.test(r)))
        report(w, "error", "bad-build", `data-build is "<${BUILDS.join("|")}> [order]"`, here, path);
      else if (!pinned) report(w, "warning", "build-unpinned", "build animations play only on position:absolute elements", here, path);
    }
    if (n.tag === "img") {
      const src = n.attrs.src ?? "";
      if (!IMAGE_SRC_RE.test(src)) report(w, "error", "bad-src", `an image's src is a file in the deck's assets/ folder (e.g. assets/photo.jpg), not "${src.slice(0, 60)}"`, here, path);
      if (n.attrs.alt === undefined) report(w, "warning", "no-alt", 'describe the image in alt (alt="" if decorative)', here, path);
    }
    if (n.tag === "a" && !HREF_RE.test(n.attrs.href ?? "")) report(w, "error", "bad-href", "a link goes to https://, mailto: or #slide-N", here, path);
    if (n.tag === "x-shape" && !(SHAPE_KINDS as readonly string[]).includes(n.attrs.kind ?? ""))
      report(w, "error", "bad-shape", `kind must be one of ${SHAPE_KINDS.join(", ")}`, here, path);
    if (n.tag === "table") {
      const rows = n.children.filter((c): c is ElementNode => c.type === "element");
      if (rows.length > LIMITS.tableRows) report(w, "error", "table-rows", `a table holds at most ${LIMITS.tableRows} rows`, here, path);
      const widths = new Set(rows.map((r) => r.children.filter((c) => c.type === "element").length));
      if (widths.size > 1) report(w, "warning", "table-ragged", "every row should have the same number of cells", here, path);
      if (Math.max(0, ...widths) > LIMITS.tableCols) report(w, "error", "table-cols", `a table holds at most ${LIMITS.tableCols} columns`, here, path);
    }
    if (n.tag === "aside") {
      const chars = textOf(n).length;
      if (chars > LIMITS.notesChars) report(w, "error", "notes-long", `speaker notes hold at most ${LIMITS.notesChars} characters`, here, path);
    }

    const fs = styleValue(n, "font-size");
    const size = fs ? (px(fs) ?? inheritedSize) : inheritedSize;
    if (["h1", "h2", "h3", "p", "li", "td", "th"].includes(n.tag) && textOf(n).trim() && size < 24)
      report(w, "warning", "small-text", `text at ${size}px is hard to read on a projected slide; use 24px or more`, here, path);

    const fam = styleValue(n, "font-family");
    if (fam && w.ctx.families.size) {
      const first = splitTop(fam, ",")[0]!.replace(/^['"]|['"]$/g, "");
      const generic = ["serif", "sans-serif", "monospace", "cursive", "system-ui"];
      if (!w.ctx.families.has(first) && !generic.includes(first) && !BASIC_FACES.has(first))
        report(w, "warning", "font-undeclared", `"${first}" is not one of the deck's fonts; it will fall back`, here, path);
    }

    const counters: Record<string, number> = {};
    for (const c of n.children) {
      if (c.type !== "element") continue;
      counters[c.tag] = (counters[c.tag] ?? 0) + 1;
      visit(c, `${path} > ${c.tag}:${counters[c.tag]}`, defaultSize(c.tag, size));
    }
  };
  visit(slide, "section", 32);
  for (const [id, count] of ids) if (count > 1) report(w, "error", "duplicate-id", `id "${id}" is used ${count} times on this slide`, at, "section");
}

/** Faces present on every desktop, safe without declaring them. */
export const BASIC_FACES = new Set(["Arial", "Helvetica", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Times New Roman", "Courier New"]);

const HEADING_SIZE: Record<string, number> = { h1: 96, h2: 64, h3: 44 };
function defaultSize(tag: string, inherited: number) {
  return HEADING_SIZE[tag] ?? inherited;
}

export function textOf(n: SlideNode): string {
  if (n.type === "text") return n.text;
  if (n.tag === "br") return "\n";
  return n.children.map(textOf).join("");
}

/** An element's words as one line, for labels: blocks, list items and cells kept apart by a space. */
export function wordsOf(n: SlideNode): string {
  const walk = (m: SlideNode): string => {
    if (m.type === "text") return m.text;
    if (m.tag === "br" || m.tag === "aside") return " ";
    return m.children.map(walk).join(ELEMENTS[m.tag]?.children === "inline" ? "" : " ");
  };
  return walk(n).replace(/\s+/g, " ").trim();
}

// ── Serialization ───────────────────────────────────────────────────────

const ATTR_ORDER = ["id", "kind", "src", "alt", "href", "viewBox", "aria-label", "data-style", "data-section", "data-transition", "data-build", "data-fit", "hidden"];

function escapeText(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&#160;");
}
function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function openTag(n: ElementNode): string {
  const names = Object.keys(n.attrs).sort((a, b) => {
    const ia = ATTR_ORDER.indexOf(a);
    const ib = ATTR_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  let s = `<${n.tag}`;
  for (const name of names) {
    const v = n.attrs[name]!;
    s += name === "hidden" && v === "" ? " hidden" : ` ${name}="${escapeAttr(v)}"`;
  }
  if (n.style.length) s += ` style="${escapeAttr(serializeStyle(n.style))}"`;
  return s + ">";
}

const VOID = new Set(["br", "img", "hr"]);

function inline(nodes: SlideNode[]): string {
  return nodes
    .map((c) => {
      if (c.type === "text") return escapeText(c.text);
      if (VOID.has(c.tag)) return openTag(c);
      if (c.tag === "ul" || c.tag === "ol") return block(c, "");
      return `${openTag(c)}${inline(c.children)}</${c.tag}>`;
    })
    .join("");
}

function block(n: ElementNode, indent: string): string {
  if (VOID.has(n.tag)) return indent + openTag(n);
  if (n.tag === "x-shape") return `${indent}${openTag(n)}</x-shape>`;
  if (n.tag === "svg") return `${indent}${openTag(n)}${n.raw ?? ""}</svg>`;
  const spec = ELEMENTS[n.tag]!;
  if (spec.children === "inline") return `${indent}${openTag(n)}${inline(n.children)}</${n.tag}>`;
  const inner = n.children.filter((c): c is ElementNode => c.type === "element").map((c) => block(c, indent + "  "));
  if (!inner.length) return `${indent}${openTag(n)}</${n.tag}>`;
  return `${indent}${openTag(n)}\n${inner.join("\n")}\n${indent}</${n.tag}>`;
}

/** Canonical HTML for a run of block elements (clipboard, fragments). */
export function serializeNodes(nodes: SlideNode[]): string {
  return nodes
    .map((n) => (n.type === "text" ? escapeText(n.text) : ELEMENTS[n.tag]?.kind === "inline" ? inline([n]) : block(n, "")))
    .join("\n");
}

/** The canonical text of a slide. Parsing it again gives the same tree. */
export function serializeSlide(slide: ElementNode): string {
  return block(slide, "") + "\n";
}
