// One tab of a doc: parse it, check it against the subset, write it back out.
//
// A tab file is exactly one <article id="…"> whose children are blocks
// (schema.ts), each with an id so the AI and the editor can point at it.
// Two ways in:
//  - strict (files, the AI): anything outside the subset is reported with
//    the line, column and nearest supported form, so a model can fix its own
//    output in one round; a write with any error is refused whole.
//  - lenient (the editor's own page, pasted HTML): whatever the browser made
//    is folded into the subset (div → p, strong → b, stray spans unwrapped),
//    so what is saved is always valid.
// Either way the result is normalized: blocks get ids, empty marks go,
// neighbouring identical marks merge, whitespace collapses.

import { parseDocument } from "htmlparser2";
import type { ChildNode, Element as DomElement } from "domhandler";
import { BLOCKS, BLOCK_ID_RE, DATE_RE, HREF_RE, IMAGE_SRC_RE, INLINE, LIMITS, SUGGESTIONS, TAB_ID_RE, TEXT_COLORS } from "./schema.ts";

export interface TextNode {
  type: "text";
  text: string;
}

export interface ElementNode {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  children: DocNode[];
}

export type DocNode = ElementNode | TextNode;

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  line: number;
  col: number;
  /** Where, e.g. "article > table:2 > tr:3" (1-based among elements). */
  path: string;
}

/** What a tab is checked against: the doc's dropdowns (id → option ids). */
export interface DocContext {
  dropdowns: Map<string, { name: string; options: Map<string, string> }>;
}

export const EMPTY_CONTEXT: DocContext = { dropdowns: new Map() };

export interface ParseResult {
  tab: ElementNode | null;
  diagnostics: Diagnostic[];
  ok: boolean;
}

interface Walk {
  src: string;
  ctx: DocContext;
  lenient: boolean;
  diags: Diagnostic[];
  ids: Set<string>;
  chars: number;
}

const el = (tag: string, attrs: Record<string, string> = {}, children: DocNode[] = []): ElementNode => ({ type: "element", tag, attrs, children });
const txt = (text: string): TextNode => ({ type: "text", text });

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

function report(w: Walk, severity: Severity, code: string, message: string, node: ChildNode | null, path: string) {
  const at = node && typeof node.startIndex === "number" ? lineCol(w.src, node.startIndex) : { line: 1, col: 1 };
  // In lenient mode the browser's markup is folded in silently; only real limits are kept.
  if (w.lenient && code !== "limit") return;
  w.diags.push({ severity, code, message, line: at.line, col: at.col, path });
}

const isTag = (n: ChildNode): n is DomElement => n.type === "tag" || n.type === "script" || n.type === "style";
const tagOf = (n: DomElement) => n.name.toLowerCase();
const NBSP = / /g;

/** All the text under a DOM node (for <pre> and plain-text pieces); <br> is a newline. */
function domText(nodes: ChildNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") out += (n as unknown as { data: string }).data;
    else if (isTag(n)) {
      if (tagOf(n) === "br") out += "\n";
      else if (tagOf(n) !== "script" && tagOf(n) !== "style") {
        out += domText(n.children);
        if (["p", "div", "li", "tr"].includes(tagOf(n))) out += "\n";
      }
    }
  }
  return out;
}

/** A DOM text node's text (entities already decoded by the parser). */
const textData = (n: ChildNode) => (n as unknown as { data: string }).data;

/** A fresh block id not in `taken` (and now in it): a letter and five letters or digits. */
export function newBlockId(taken: Set<string>): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  for (;;) {
    const id = letters[Math.floor(Math.random() * 26)]! + Math.floor(Math.random() * 36 ** 5).toString(36).padStart(5, "0");
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

// ── Inline content ─────────────────────────────────────────────────────

const LENIENT_MARKS: Record<string, string> = { strong: "b", em: "i", strike: "s", ins: "u", del: "s", kbd: "code", samp: "code", tt: "code", var: "i", cite: "i" };

function inline(nodes: ChildNode[], w: Walk, path: string, inside: Set<string>): DocNode[] {
  const out: DocNode[] = [];
  for (const n of nodes) {
    if (n.type === "text") {
      const t = textData(n).replace(NBSP, " ").replace(/[ \t\r\n]+/g, " ");
      w.chars += t.length;
      if (t) out.push(txt(t));
      continue;
    }
    if (!isTag(n)) continue;
    let tag = tagOf(n);
    if (tag === "script" || tag === "style") continue;
    // The editor shows dates and dropdowns as chips; they come back as what they are.
    if (w.lenient && n.attribs["data-dropdown"] !== undefined) tag = "span";
    // Suggestions keep their own tags only when marked as suggestions; pasted <ins>/<del> are plain marks.
    if (w.lenient && (tag === "ins" || tag === "del") && n.attribs["data-sid"] === undefined) tag = LENIENT_MARKS[tag]!;
    // Colored text: <span data-text="red">, holding more text.
    if (tag === "span" && n.attribs["data-dropdown"] === undefined && n.attribs["data-text"] !== undefined) {
      const color = n.attribs["data-text"];
      const known = (TEXT_COLORS as readonly string[]).includes(color);
      if (!known) report(w, "error", "color", `text color "${color}" is not one of ${TEXT_COLORS.join(", ")}`, n, path);
      if (!w.lenient) for (const k of Object.keys(n.attribs)) if (k !== "data-text") report(w, "error", "attr", `a colored <span> takes only data-text`, n, path);
      if (!known || inside.has("color")) out.push(...inline(n.children, w, path, inside));
      else out.push(el("span", { "data-text": color }, inline(n.children, w, path, new Set([...inside, "color"]))));
      continue;
    }
    const spec = INLINE[tag];
    if (!spec) {
      if (w.lenient) {
        const mapped = LENIENT_MARKS[tag];
        if (mapped && !inside.has(mapped)) out.push(el(mapped, {}, inline(n.children, w, path, new Set([...inside, mapped]))));
        else {
          // A block inside text (a <p> in a list item, a <div> from a paste): its text, on a new line.
          const blockish = /^(p|div|h[1-6]|blockquote|pre|li|tr|section|article|header|footer|figure|figcaption)$/.test(tag);
          if (blockish && out.length && !(out[out.length - 1]!.type === "element" && (out[out.length - 1] as ElementNode).tag === "br")) out.push(el("br"));
          out.push(...inline(n.children, w, path, inside));
        }
      } else report(w, "error", "unknown-inline", `<${tag}> is not allowed in text${SUGGESTIONS[tag] ? `: ${SUGGESTIONS[tag]}` : ""}`, n, path);
      continue;
    }
    // No mark inside itself, no link in a link, no suggestion in a suggestion.
    const nests = tag === "ins" || tag === "del" ? inside.has("ins") || inside.has("del") : inside.has(tag);
    if (nests) {
      if (!w.lenient) report(w, "warning", "nested", `<${tag}> inside <${tag}> was unwrapped`, n, path);
      out.push(...inline(n.children, w, path, inside));
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(n.attribs)) {
      if (spec.attrs?.includes(k)) attrs[k] = v;
      else if (!w.lenient && k !== "id") report(w, "error", "attr", `<${tag}> takes no ${k}${k === "style" || k === "class" ? " (a doc has no inline styles)" : ""}`, n, path);
    }
    const missing = spec.required?.filter((k) => attrs[k] === undefined) ?? [];
    if (missing.length) {
      if (w.lenient) out.push(...inline(n.children, w, path, inside));
      else report(w, "error", "attr", `<${tag}> needs ${missing.join(" and ")}`, n, path);
      continue;
    }
    if (tag === "a" && !HREF_RE.test(attrs.href!)) {
      if (w.lenient) out.push(...inline(n.children, w, path, inside));
      else report(w, "error", "href", `link "${attrs.href}" is not allowed: use https://…, mailto:… or #<tab id>`, n, path);
      continue;
    }
    if (tag === "time") {
      if (!DATE_RE.test(attrs.datetime!) || Number.isNaN(Date.parse(attrs.datetime!))) {
        report(w, "error", "date", `datetime "${attrs.datetime}" must be a date like 2026-11-12`, n, path);
        continue;
      }
      out.push(el("time", { datetime: attrs.datetime! }, [txt(formatDate(attrs.datetime!))]));
      continue;
    }
    if (tag === "span") {
      const dd = w.ctx.dropdowns.get(attrs["data-dropdown"]!);
      const label = dd?.options.get(attrs["data-value"]!);
      if (!dd || label === undefined) {
        report(w, "error", "dropdown", dd ? `dropdown "${attrs["data-dropdown"]}" has no option "${attrs["data-value"]}"` : `there is no dropdown "${attrs["data-dropdown"]}" (add it with update_doc first)`, n, path);
        if (w.lenient) out.push(...inline(n.children, w, path, inside));
        continue;
      }
      out.push(el("span", { "data-dropdown": attrs["data-dropdown"]!, "data-value": attrs["data-value"]! }, [txt(label)]));
      continue;
    }
    if (spec.children === "none") {
      out.push(el(tag, attrs));
      continue;
    }
    const kids = spec.children === "text" ? [txt(domText(n.children).replace(NBSP, " ").replace(/[ \t\r\n]+/g, " "))] : inline(n.children, w, path, new Set([...inside, tag]));
    out.push(el(tag, attrs, kids));
  }
  return out;
}

/** "Nov 12, 2026" for 2026-11-12 (in UTC, so the date never shifts with the time zone). */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const MERGEABLE = new Set(["b", "i", "u", "s", "code", "mark"]);
const isColor = (n: ElementNode) => n.tag === "span" && n.attrs["data-text"] !== undefined;
/** What an inline element holds; a colored span holds text with marks, a dropdown just its label. */
const holds = (n: ElementNode) => (isColor(n) ? "inline" : INLINE[n.tag]?.children);
const sameAttrs = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(a) === JSON.stringify(b);

/** Drop empty marks, merge neighbours that are the same mark, join text, drop a trailing <br>. */
export function tidyInline(nodes: DocNode[], trailingBr = true): DocNode[] {
  const out: DocNode[] = [];
  for (const raw of nodes) {
    let n = raw;
    if (n.type === "element" && holds(n) === "inline") {
      n = { ...n, children: tidyInline(n.children, false) };
      if (!n.children.length) continue;
    }
    if (n.type === "element" && holds(n) === "text" && !(n.children[0] as TextNode | undefined)?.text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.type === "text" && n.type === "text") {
      out[out.length - 1] = txt(prev.text + n.text);
      continue;
    }
    if (prev && prev.type === "element" && n.type === "element" && prev.tag === n.tag && (MERGEABLE.has(n.tag) || isColor(n)) && sameAttrs(prev.attrs, n.attrs)) {
      out[out.length - 1] = { ...prev, children: tidyInline([...prev.children, ...n.children], false) };
      continue;
    }
    out.push(n);
  }
  if (trailingBr) {
    const last = out[out.length - 1];
    if (last && last.type === "element" && last.tag === "br") out.pop();
    // Collapse the spaces HTML would collapse at the edges of a block.
    const first = out[0];
    if (first?.type === "text") {
      const t = first.text.replace(/^ +/, "");
      if (t) out[0] = txt(t);
      else out.shift();
    }
    const end = out[out.length - 1];
    if (end?.type === "text") {
      const t = end.text.replace(/ +$/, "");
      if (t) out[out.length - 1] = txt(t);
      else out.pop();
    }
  }
  return out;
}

// ── Blocks ─────────────────────────────────────────────────────────────

const INLINE_LIKE = new Set([...Object.keys(INLINE), ...Object.keys(LENIENT_MARKS), "span", "font", "small", "big", "sub", "sup", "abbr", "label", "mark", "q", "img"]);
const CONTAINERS = new Set(["div", "section", "main", "article", "header", "footer", "body", "html", "nav", "aside", "center", "thead", "tbody", "tfoot", "form", "details", "summary"]);

function listItem(n: DomElement, w: Walk, path: string, depth: number): ElementNode {
  const attrs: Record<string, string> = {};
  if (n.attribs["data-checked"] !== undefined) attrs["data-checked"] = "";
  if (!w.lenient) for (const k of Object.keys(n.attribs)) if (k !== "data-checked") report(w, "error", "attr", `<li> takes no ${k}`, n, path);
  const text: ChildNode[] = [];
  const lists: ElementNode[] = [];
  for (const c of n.children) {
    if (isTag(c) && (tagOf(c) === "ul" || tagOf(c) === "ol")) {
      if (depth >= LIMITS.listDepth) report(w, "error", "limit", `lists nest at most ${LIMITS.listDepth} deep`, c, path);
      else lists.push(list(c, w, `${path} > ${tagOf(c)}`, depth + 1, null));
    } else text.push(c);
  }
  return el("li", attrs, [...tidyInline(inline(text, w, path, new Set())), ...lists]);
}

function list(n: DomElement, w: Walk, path: string, depth: number, id: string | null): ElementNode {
  const tag = tagOf(n);
  const attrs: Record<string, string> = id ? { id } : {};
  if (tag === "ul" && n.attribs["data-checklist"] !== undefined) attrs["data-checklist"] = "";
  if (tag === "ol" && n.attribs.start !== undefined && /^\d{1,6}$/.test(n.attribs.start) && n.attribs.start !== "1") attrs.start = n.attribs.start;
  const items: ElementNode[] = [];
  let i = 0;
  for (const c of n.children) {
    if (c.type === "text" && !textData(c).trim()) continue;
    if (isTag(c) && tagOf(c) === "li") items.push(listItem(c, w, `${path} > li:${++i}`, depth));
    else if (isTag(c) && (tagOf(c) === "ul" || tagOf(c) === "ol") && items.length) {
      // A list directly in a list (the browser's way to indent): it belongs to the item before it.
      const prev = items[items.length - 1]!;
      prev.children.push(list(c, w, `${path} > ${tagOf(c)}`, depth + 1, null));
    } else if (w.lenient) items.push(el("li", {}, tidyInline(inline([c], w, path, new Set()))));
    else report(w, "error", "list-child", `a list holds only <li>`, c, path);
  }
  return el(tag, attrs, items.length ? items : [el("li")]);
}

function cell(n: DomElement, w: Walk, path: string, tag: "th" | "td"): ElementNode {
  if (!w.lenient) for (const k of Object.keys(n.attribs)) report(w, "error", "attr", `<${tag}> takes no ${k}${k === "colspan" || k === "rowspan" ? " (cells don't merge)" : ""}`, n, path);
  return el(tag, {}, tidyInline(inline(n.children, w, path, new Set())));
}

function table(n: DomElement, w: Walk, path: string, id: string): ElementNode {
  const rows: ElementNode[] = [];
  const collect = (nodes: ChildNode[]) => {
    for (const c of nodes) {
      if (c.type === "text" && !textData(c).trim()) continue;
      if (!isTag(c)) continue;
      const t = tagOf(c);
      if (t === "tr") {
        const cells: ElementNode[] = [];
        let k = 0;
        for (const d of c.children) {
          if (!isTag(d)) continue;
          const dt = tagOf(d);
          if (dt === "th" || dt === "td") cells.push(cell(d, w, `${path} > tr:${rows.length + 1} > ${dt}:${++k}`, dt));
          else if (!w.lenient) report(w, "error", "table-child", `a row holds only <th> and <td>`, d, path);
        }
        if (cells.length > LIMITS.tableCols) report(w, "error", "limit", `a table has at most ${LIMITS.tableCols} columns`, c, path);
        rows.push(el("tr", {}, cells.slice(0, LIMITS.tableCols)));
      } else if (t === "thead" || t === "tbody" || t === "tfoot") {
        if (!w.lenient) report(w, "error", "table-child", `put <tr> directly in <table>`, c, path);
        collect(c.children);
      } else if (t === "caption" || t === "colgroup") continue;
      else if (!w.lenient) report(w, "error", "table-child", `a table holds only <tr>`, c, path);
    }
  };
  collect(n.children);
  if (rows.length > LIMITS.tableRows) report(w, "error", "limit", `a table has at most ${LIMITS.tableRows} rows`, n, path);
  const kept = rows.slice(0, LIMITS.tableRows).filter((r) => r.children.length);
  // Every row as wide as the widest, so the grid is whole.
  const width = Math.max(1, ...kept.map((r) => r.children.length));
  for (const r of kept) while (r.children.length < width) r.children.push(el((r.children[0] as ElementNode | undefined)?.tag === "th" ? "th" : "td"));
  return el("table", { id }, kept.length ? kept : [el("tr", {}, [el("td")])]);
}

function figure(n: DomElement, w: Walk, path: string, id: string): ElementNode | null {
  const find = (nodes: ChildNode[], tag: string): DomElement | null => {
    for (const c of nodes) {
      if (!isTag(c)) continue;
      if (tagOf(c) === tag) return c;
      const deeper = find(c.children, tag);
      if (deeper) return deeper;
    }
    return null;
  };
  const img = tagOf(n) === "img" ? n : find(n.children, "img");
  // The editor shows images from the doc's asset address; the file path is kept beside it.
  const src = img ? (img.attribs["data-src"] ?? img.attribs.src ?? "") : "";
  if (!img || !IMAGE_SRC_RE.test(src)) {
    report(w, "error", "image", img ? `image "${src}" must be a file in assets/ (assets/<name>.png, .jpg, .webp, .gif, .svg or .avif)` : "a <figure> needs an <img>", img ?? n, path);
    return null;
  }
  const attrs: Record<string, string> = { id };
  const width = n.attribs["data-width"];
  if (width !== undefined) {
    if (/^\d{1,3}$/.test(width) && Number(width) >= 10 && Number(width) <= 100) {
      if (width !== "100") attrs["data-width"] = width;
    } else report(w, "error", "attr", `data-width is a percentage of the page width, 10 to 100`, n, path);
  }
  const image = el("img", { src, ...(img.attribs.alt ? { alt: img.attribs.alt.slice(0, 500) } : {}) });
  const cap = tagOf(n) === "img" ? null : find(n.children, "figcaption");
  const caption = cap ? tidyInline(inline(cap.children, w, `${path} > figcaption`, new Set())) : [];
  return el("figure", attrs, caption.length ? [image, el("figcaption", {}, caption)] : [image]);
}

function blockId(n: DomElement, w: Walk, path: string): string {
  const id = n.attribs.id;
  if (id !== undefined && BLOCK_ID_RE.test(id) && !w.ids.has(id)) {
    w.ids.add(id);
    return id;
  }
  if (id !== undefined && w.ids.has(id)) report(w, "warning", "duplicate-id", `block id "${id}" is used twice; this one got a new id`, n, path);
  else if (id !== undefined) report(w, "warning", "bad-id", `block id "${id}" is not valid (a letter, then letters, digits, - or _); it got a new id`, n, path);
  return newBlockId(w.ids);
}

/** Blocks from a list of DOM nodes (a tab's article, or pasted HTML). */
function blocks(nodes: ChildNode[], w: Walk, out: ElementNode[], path = "article") {
  let pending: ChildNode[] = [];
  const flush = () => {
    const kids = tidyInline(inline(pending, w, path, new Set()));
    pending = [];
    if (kids.length) out.push(el("p", { id: newBlockId(w.ids) }, kids));
  };
  for (const n of nodes) {
    if (n.type === "text") {
      if (!textData(n).trim()) {
        if (pending.length) pending.push(n);
        continue;
      }
      if (w.lenient) pending.push(n);
      else report(w, "error", "loose-text", "text must be inside a block (<p>, <h2>, …)", n, path);
      continue;
    }
    if (!isTag(n)) continue;
    let tag = tagOf(n);
    if (tag === "script" || tag === "style" || tag === "meta" || tag === "link" || tag === "title") continue;
    if (w.lenient) {
      if (/^h[4-6]$/.test(tag)) tag = "h3";
      if (tag === "br" && !pending.length) continue;
      if (INLINE_LIKE.has(tag) && tag !== "img" && !(tag === "span" && n.attribs["data-dropdown"] === undefined && hasBlock(n))) {
        pending.push(n);
        continue;
      }
      if (CONTAINERS.has(tag) || (tag === "span" && hasBlock(n))) {
        if (hasBlock(n)) {
          flush();
          blocks(n.children, w, out, path);
        } else {
          flush();
          pending = [...n.children];
          flush();
        }
        continue;
      }
      if (tag === "li") {
        flush();
        out.push(el("p", { id: newBlockId(w.ids) }, tidyInline(inline(n.children, w, path, new Set()))));
        continue;
      }
      if (tag === "tr" || tag === "td" || tag === "th") {
        flush();
        pending = [...n.children];
        flush();
        continue;
      }
    }
    flush();
    const p = `${path} > ${tag}:${out.length + 1}`;
    const spec = BLOCKS[tag];
    if (!spec && !(w.lenient && tag === "img")) {
      report(w, "error", "unknown-block", `<${tag}> is not a block${SUGGESTIONS[tag] ? `: ${SUGGESTIONS[tag]}` : " (blocks: " + Object.keys(BLOCKS).join(", ") + ")"}`, n, p);
      continue;
    }
    if (out.length >= LIMITS.blocksPerTab) {
      report(w, "error", "limit", `a tab holds at most ${LIMITS.blocksPerTab} blocks`, n, p);
      return;
    }
    if (!w.lenient)
      for (const k of Object.keys(n.attribs)) if (k !== "id" && !spec?.attrs?.includes(k)) report(w, "error", "attr", `<${tag}> takes no ${k}${k === "style" || k === "class" ? " (a doc has no inline styles)" : ""}`, n, p);
    const id = blockId(n, w, p);
    if (tag === "img" || tag === "figure") {
      const f = figure(n, w, p, id);
      if (f) out.push(f);
    } else if (tag === "ul" || tag === "ol") out.push(list(n, w, p, 1, id));
    else if (tag === "table") out.push(table(n, w, p, id));
    else if (tag === "hr") out.push(el("hr", { id }));
    else if (tag === "pre") {
      const lang = n.attribs["data-lang"];
      const text = domText(n.children).replace(NBSP, " ").replace(/\n$/, "");
      w.chars += text.length;
      out.push(el("pre", { id, ...(lang && /^[a-z0-9+#-]{1,20}$/i.test(lang) ? { "data-lang": lang.toLowerCase() } : {}) }, text ? [txt(text)] : []));
    } else out.push(el(tag, { id }, tidyInline(inline(n.children, w, p, new Set()))));
  }
  flush();
}

/** Does this element hold a block (so it is a container, not text)? */
function hasBlock(n: DomElement): boolean {
  return n.children.some((c) => isTag(c) && (BLOCKS[tagOf(c)] !== undefined || CONTAINERS.has(tagOf(c)) || /^h[4-6]$/.test(tagOf(c)) || tagOf(c) === "li" || tagOf(c) === "img" || (tagOf(c) === "span" && hasBlock(c))));
}

function walk(src: string, ctx: DocContext, lenient: boolean): Walk {
  return { src, ctx, lenient, diags: [], ids: new Set(), chars: 0 };
}

/** A tab file: exactly one <article id="…"> of blocks. */
export function parseTab(source: string, ctx: DocContext = EMPTY_CONTEXT): ParseResult {
  const w = walk(source, ctx, false);
  const doc = parseDocument(source, { withStartIndices: true, recognizeSelfClosing: true });
  const roots = doc.children.filter((n) => isTag(n) || (n.type === "text" && textData(n).trim()));
  const root = roots[0];
  if (roots.length !== 1 || !root || !isTag(root) || tagOf(root) !== "article") {
    report(w, "error", "root", "a tab is exactly one <article id=\"…\"> holding its blocks, and nothing else", root ?? null, "");
    return { tab: null, diagnostics: w.diags, ok: false };
  }
  const id = root.attribs.id ?? "";
  if (!TAB_ID_RE.test(id)) report(w, "error", "tab-id", `the <article> needs an id: a letter, then letters, digits, - or _`, root, "article");
  for (const k of Object.keys(root.attribs)) if (k !== "id") report(w, "error", "attr", `<article> takes only an id`, root, "article");
  const out: ElementNode[] = [];
  blocks(root.children, w, out);
  if (w.chars > LIMITS.textChars) report(w, "error", "limit", `a tab holds at most ${LIMITS.textChars} characters`, root, "article");
  const ok = !w.diags.some((d) => d.severity === "error");
  return { tab: el("article", { id }, out), diagnostics: w.diags, ok };
}

/**
 * Blocks from markup the editor or a paste produced: always valid, never
 * refused. Ids already used in `taken` are given to no new block.
 */
export function sanitizeBlocks(html: string, ctx: DocContext = EMPTY_CONTEXT, taken: Set<string> = new Set()): ElementNode[] {
  const w = walk(html, ctx, true);
  w.ids = new Set(taken);
  const doc = parseDocument(html, { recognizeSelfClosing: true });
  const out: ElementNode[] = [];
  blocks(doc.children, w, out);
  return out;
}

/** Inline content from a paste into text (marks kept, blocks become line breaks). */
export function sanitizeInline(html: string, ctx: DocContext = EMPTY_CONTEXT): DocNode[] {
  const w = walk(html, ctx, true);
  return tidyInline(inline(parseDocument(html, { recognizeSelfClosing: true }).children, w, "", new Set()));
}

// ── Writing ────────────────────────────────────────────────────────────

const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function attrsOf(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([k, v]) => (v === "" && (k === "data-checklist" || k === "data-checked") ? ` ${k}` : ` ${k}="${escAttr(v)}"`))
    .join("");
}

export function serializeNode(n: DocNode): string {
  if (n.type === "text") return escText(n.text);
  if (n.tag === "br" || n.tag === "hr" || n.tag === "img") return `<${n.tag}${attrsOf(n.attrs)}>`;
  return `<${n.tag}${attrsOf(n.attrs)}>${n.children.map(serializeNode).join("")}</${n.tag}>`;
}

/** The tab as written to disk: one block per line, in canonical form. */
export function serializeTab(tab: ElementNode): string {
  const body = tab.children.map((b) => serializeNode(b)).join("\n");
  return `<article id="${escAttr(tab.attrs.id ?? "")}">${body ? `\n${body}\n` : "\n"}</article>\n`;
}

// ── Reading ────────────────────────────────────────────────────────────

/** All the text under a node; list items and cells are separated by a space. */
export function textOf(n: DocNode): string {
  if (n.type === "text") return n.text;
  if (n.tag === "br") return "\n";
  const sep = n.tag === "ul" || n.tag === "ol" || n.tag === "tr" || n.tag === "table" ? " " : "";
  return n.children.map(textOf).join(sep);
}

export const elementChildren = (n: ElementNode): ElementNode[] => n.children.filter((c): c is ElementNode => c.type === "element");

/** The block with this id, and its index. */
export function findBlock(tab: ElementNode, id: string): { block: ElementNode; index: number } | null {
  const index = tab.children.findIndex((b) => b.type === "element" && b.attrs.id === id);
  return index < 0 ? null : { block: tab.children[index] as ElementNode, index };
}

/**
 * A tab file as best it can be read, for showing it: exact when the file is
 * valid; otherwise what the lenient reader keeps of its markup (the same one
 * pastes go through), so no readable words are lost from the screen, and
 * the next save writes them back in the format. The diagnostics still say
 * what was wrong.
 */
export function loadTab(id: string, source: string, ctx: DocContext = EMPTY_CONTEXT): ParseResult {
  const r = parseTab(source, ctx);
  if (r.ok) return r;
  const inner = source.replace(/^\s*<article\b[^>]*>/i, "").replace(/<\/article>\s*$/i, "");
  return { tab: el("article", { id }, sanitizeBlocks(inner, ctx)), diagnostics: r.diagnostics, ok: false };
}
