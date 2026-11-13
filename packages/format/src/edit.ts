// Editing a slide's tree.
//
// Every change the editor makes (a style in the inspector, typed text, a
// drag, an insert, a paste) is one of these operations. Each takes a slide
// and returns a NEW slide (the input is never mutated, so undo and React
// stay simple) and each result is checked against the format before it is
// returned: an edit can't produce a slide the validator would refuse.
//
// Elements are addressed the way the renderer tags them: the chain of
// element-child indices from the section, joined by "." ("" = the section).

import { type ValueContext } from "./css.ts";
import { ELEMENTS, PROPERTIES } from "./schema.ts";
import { type ElementNode, type SlideNode, ID_RE, parseSlide, serializeSlide } from "./slide.ts";

export class EditError extends Error {}

export type Address = string;

const EMPTY_CTX: ValueContext = { colorTokens: new Set(), families: new Set() };

export function cloneNode<T extends SlideNode>(n: T): T {
  if (n.type === "text") return { ...n };
  return { ...n, attrs: { ...n.attrs }, style: n.style.map((d) => ({ ...d })), children: n.children.map(cloneNode) } as T;
}

export function elementChildren(n: ElementNode): ElementNode[] {
  return n.children.filter((c): c is ElementNode => c.type === "element");
}

export function getAt(slide: ElementNode, addr: Address): ElementNode | null {
  if (addr === "") return slide;
  let cur: ElementNode = slide;
  for (const part of addr.split(".")) {
    const next = elementChildren(cur)[Number(part)];
    if (!next) return null;
    cur = next;
  }
  return cur;
}

export function parentAddress(addr: Address): Address {
  const i = addr.lastIndexOf(".");
  return i < 0 ? "" : addr.slice(0, i);
}

export function lastIndex(addr: Address): number {
  return Number(addr.slice(addr.lastIndexOf(".") + 1));
}

export function childAddress(parent: Address, index: number): Address {
  return parent === "" ? String(index) : `${parent}.${index}`;
}

/** Index of the i-th element child within `children` (which also holds text nodes). */
function rawIndex(n: ElementNode, elementIndex: number): number {
  let seen = -1;
  for (let i = 0; i < n.children.length; i++) {
    if (n.children[i]!.type === "element" && ++seen === elementIndex) return i;
  }
  return n.children.length;
}

/** Copy the slide, apply `fn` to the copy at `addr`, check the result. */
function change(slide: ElementNode, addr: Address, fn: (el: ElementNode, root: ElementNode) => void, ctx: ValueContext): ElementNode {
  const root = cloneNode(slide);
  const el = getAt(root, addr);
  if (!el) throw new EditError(`nothing at ${addr || "the slide"}`);
  fn(el, root);
  return checked(root, ctx);
}

/** Re-validate; an edit may not introduce errors the slide didn't have. */
function checked(root: ElementNode, ctx: ValueContext): ElementNode {
  const r = parseSlide(serializeSlide(root), ctx);
  const err = r.diagnostics.find((d) => d.severity === "error");
  if (!r.slide || err) throw new EditError(err?.message ?? "the edit made the slide invalid");
  return root;
}

// ── Styles and attributes ───────────────────────────────────────────────

/** Set (or with null, remove) one style property. Values are checked. */
export function setStyle(slide: ElementNode, addr: Address, name: string, value: string | null, ctx: ValueContext = EMPTY_CTX): ElementNode {
  return setStyles(slide, addr, { [name]: value }, ctx);
}

/** Set several style properties at once (one undo step for a drag). */
export function setStyles(slide: ElementNode, addr: Address, props: Record<string, string | null>, ctx: ValueContext = EMPTY_CTX): ElementNode {
  return change(
    slide,
    addr,
    (el) => {
      for (const [name, value] of Object.entries(props)) {
        const prop = PROPERTIES[name];
        if (!prop) throw new EditError(`${name} is not a supported property`);
        if (!prop.on.includes(el.tag)) throw new EditError(`${name} does not apply to <${el.tag}>`);
        const at = el.style.findIndex((d) => d.name === name);
        if (value === null || value === "") {
          if (at >= 0) el.style.splice(at, 1);
          continue;
        }
        const v = value.trim().replace(/\s+/g, " ");
        const problem = prop.check(v, ctx);
        if (problem) throw new EditError(`${name}: ${problem}`);
        if (at >= 0) el.style[at] = { name, value: v };
        else el.style.push({ name, value: v });
      }
    },
    ctx,
  );
}

export function getStyle(el: ElementNode, name: string): string | undefined {
  return el.style.find((d) => d.name === name)?.value;
}

/** Set (or with null, remove) an attribute the element takes. */
export function setAttr(slide: ElementNode, addr: Address, name: string, value: string | null, ctx: ValueContext = EMPTY_CTX): ElementNode {
  return change(
    slide,
    addr,
    (el) => {
      const allowed = name === "id" || (ELEMENTS[el.tag]?.attrs ?? []).includes(name);
      if (!allowed) throw new EditError(`<${el.tag}> takes no ${name}`);
      if (value === null) delete el.attrs[name];
      else el.attrs[name] = value;
    },
    ctx,
  );
}

// ── Content ─────────────────────────────────────────────────────────────

/** Parse a fragment of slide HTML into nodes, checked as children of `parentTag`. */
export function parseFragment(html: string, parentTag: string, ctx: ValueContext = EMPTY_CTX): SlideNode[] {
  const spec = ELEMENTS[parentTag];
  if (!spec) throw new EditError(`unknown element ${parentTag}`);
  // Wrap in a section (and the parent when it isn't one) to check it in place.
  const wrapped =
    parentTag === "section"
      ? `<section id="frag" style="background:#fff">${html}</section>`
      : parentTag === "tr"
        ? `<section id="frag" style="background:#fff"><table><tr>${html}</tr></table></section>`
        : parentTag === "li"
          ? `<section id="frag" style="background:#fff"><ul><li>${html}</li></ul></section>`
          : ["th", "td"].includes(parentTag)
            ? `<section id="frag" style="background:#fff"><table><tr><${parentTag}>${html}</${parentTag}></tr></table></section>`
            : parentTag === "table"
              ? `<section id="frag" style="background:#fff"><table>${html}</table></section>`
              : `<section id="frag" style="background:#fff"><${parentTag}>${html}</${parentTag}></section>`;
  const r = parseSlide(wrapped, ctx);
  const err = r.diagnostics.find((d) => d.severity === "error");
  if (!r.slide || err) throw new EditError(err?.message ?? "not valid slide content");
  let holder: ElementNode = r.slide;
  const path = parentTag === "section" ? [] : parentTag === "tr" ? ["table", "tr"] : parentTag === "li" ? ["ul", "li"] : ["th", "td"].includes(parentTag) ? ["table", "tr", parentTag] : [parentTag];
  for (const tag of path) {
    const next = elementChildren(holder).find((c) => c.tag === tag);
    if (!next) throw new EditError("not valid slide content");
    holder = next;
  }
  return holder.children;
}

/**
 * Replace an element's content with an HTML fragment: the text of a heading,
 * paragraph or cell (from the text editor), the items of a list, or the
 * children of a group.
 */
export function setContent(slide: ElementNode, addr: Address, html: string, ctx: ValueContext = EMPTY_CTX): ElementNode {
  const target = getAt(slide, addr);
  if (!target) throw new EditError("nothing there");
  const spec = ELEMENTS[target.tag];
  if (!spec || spec.children === "none" || spec.children === "raw") throw new EditError(`<${target.tag}> doesn't hold content`);
  const nodes = parseFragment(html, target.tag, ctx);
  return change(slide, addr, (el) => void (el.children = nodes), ctx);
}

/** Insert nodes into a container at an element index (default: the end). Returns the slide and the first new address. */
export function insert(slide: ElementNode, parent: Address, nodes: SlideNode[], index?: number, ctx: ValueContext = EMPTY_CTX): { slide: ElementNode; at: Address } {
  const host = getAt(slide, parent);
  if (!host) throw new EditError("nothing there");
  const count = elementChildren(host).length;
  let at = index === undefined ? count : Math.max(0, Math.min(count, index));
  // Notes stay last: insert before an <aside>.
  if (host.tag === "section" && index === undefined && elementChildren(host).some((c) => c.tag === "aside")) at = count - 1;
  const next = change(
    slide,
    parent,
    (el) => {
      el.children.splice(rawIndex(el, at), 0, ...nodes.map(cloneNode));
    },
    ctx,
  );
  return { slide: next, at: childAddress(parent, at) };
}

export function insertHtml(slide: ElementNode, parent: Address, html: string, index?: number, ctx: ValueContext = EMPTY_CTX) {
  const host = getAt(slide, parent);
  if (!host) throw new EditError("nothing there");
  return insert(slide, parent, parseFragment(html, host.tag, ctx), index, ctx);
}

export function remove(slide: ElementNode, addr: Address, ctx: ValueContext = EMPTY_CTX): ElementNode {
  if (addr === "") throw new EditError("the slide itself can't be removed here");
  const parent = parentAddress(addr);
  const i = lastIndex(addr);
  return change(slide, parent, (el) => void el.children.splice(rawIndex(el, i), 1), ctx);
}

/** Remove several elements (deepest/last first so addresses stay valid). */
export function removeMany(slide: ElementNode, addrs: Address[], ctx: ValueContext = EMPTY_CTX): ElementNode {
  const sorted = [...new Set(addrs)].filter((a) => a !== "").sort(compareAddressDesc);
  // Skip any element whose ancestor is also being removed.
  const keep = sorted.filter((a) => !sorted.some((b) => b !== a && a.startsWith(b + ".")));
  let out = slide;
  for (const a of keep) out = remove(out, a, ctx);
  return out;
}

function compareAddressDesc(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? -1;
    const y = pb[i] ?? -1;
    if (x !== y) return y - x;
  }
  return 0;
}

/** Copy an element in place, right after itself. Ids on the copy get a fresh suffix. Returns the copy's address. */
export function duplicate(slide: ElementNode, addr: Address, ctx: ValueContext = EMPTY_CTX): { slide: ElementNode; at: Address } {
  const el = getAt(slide, addr);
  if (!el || addr === "") throw new EditError("nothing to duplicate");
  const copy = cloneNode(el);
  const taken = collectIds(slide);
  renameIds(copy, taken);
  // Pinned copies shift so they don't sit exactly on the original.
  if (getStyle(copy, "position") === "absolute") {
    for (const side of ["left", "top"]) {
      const v = getStyle(copy, side);
      const n = v && /^-?\d+(\.\d+)?(px)?$/.test(v) ? parseFloat(v) : null;
      if (n !== null) copy.style = copy.style.map((d) => (d.name === side ? { name: side, value: `${n + 24}px` } : d));
    }
  }
  return insert(slide, parentAddress(addr), [copy], lastIndex(addr) + 1, ctx);
}

export function collectIds(n: ElementNode, out = new Set<string>()): Set<string> {
  if (n.attrs.id) out.add(n.attrs.id);
  for (const c of elementChildren(n)) collectIds(c, out);
  return out;
}

function renameIds(n: ElementNode, taken: Set<string>) {
  if (n.attrs.id) {
    n.attrs.id = uniqueId(n.attrs.id.replace(/-\d+$/, ""), taken);
    taken.add(n.attrs.id);
  }
  for (const c of elementChildren(n)) renameIds(c, taken);
}

export function uniqueId(base: string, taken: Set<string> | string[]): string {
  const set = taken instanceof Set ? taken : new Set(taken);
  const clean = (base.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^[^A-Za-z]+/, "") || "s").slice(0, 56);
  if (!set.has(clean) && ID_RE.test(clean)) return clean;
  for (let i = 2; ; i++) {
    const c = `${clean}-${i}`;
    if (!set.has(c)) return c;
  }
}

/** Move an element to another container/index (e.g. reorder layers, drag between groups). Returns its new address. */
export function move(slide: ElementNode, addr: Address, toParent: Address, toIndex: number, ctx: ValueContext = EMPTY_CTX): { slide: ElementNode; at: Address } {
  const el = getAt(slide, addr);
  if (!el || addr === "") throw new EditError("nothing to move");
  if (toParent === addr || toParent.startsWith(addr + ".")) throw new EditError("an element can't move inside itself");
  const fromParent = parentAddress(addr);
  const fromIndex = lastIndex(addr);
  let target = toIndex;
  let parent = toParent;
  // Removing first shifts later siblings and deeper addresses in the same parent.
  if (fromParent === toParent && toIndex > fromIndex) target -= 1;
  if (toParent.startsWith(fromParent === "" ? "" : fromParent + ".") && toParent !== fromParent) {
    const rel = toParent.slice(fromParent === "" ? 0 : fromParent.length + 1).split(".");
    const head = Number(rel[0]);
    if (head > fromIndex) parent = childAddress(fromParent, head - 1) + (rel.length > 1 ? "." + rel.slice(1).join(".") : "");
  }
  const without = remove(slide, addr, ctx);
  return insert(without, parent, [el], target, ctx);
}

/** Paint order: "front" | "back" | "forward" | "backward" within the parent. */
export function restack(slide: ElementNode, addr: Address, where: "front" | "back" | "forward" | "backward", ctx: ValueContext = EMPTY_CTX) {
  const parent = parentAddress(addr);
  const host = getAt(slide, parent);
  if (!host) throw new EditError("nothing there");
  const kids = elementChildren(host);
  const i = lastIndex(addr);
  const hasNotes = host.tag === "section" && kids[kids.length - 1]?.tag === "aside";
  const last = kids.length - (hasNotes ? 1 : 0);
  const to = where === "front" ? last : where === "back" ? 0 : where === "forward" ? Math.min(last, i + 2) : Math.max(0, i - 1);
  return move(slide, addr, parent, to, ctx);
}

/** Wrap elements (siblings) in a new group <div>. Returns the group's address. */
export function group(slide: ElementNode, addrs: Address[], ctx: ValueContext = EMPTY_CTX): { slide: ElementNode; at: Address } {
  if (!addrs.length) throw new EditError("nothing to group");
  const parent = parentAddress(addrs[0]!);
  if (addrs.some((a) => parentAddress(a) !== parent)) throw new EditError("only elements side by side in the same container can be grouped");
  const sorted = [...addrs].sort((a, b) => lastIndex(a) - lastIndex(b));
  const nodes = sorted.map((a) => cloneNode(getAt(slide, a)!));
  const first = lastIndex(sorted[0]!);
  const without = removeMany(slide, sorted, ctx);
  const wrapper: ElementNode = { type: "element", tag: "div", attrs: {}, style: [], children: nodes, line: 0, col: 0 };
  return insert(without, parent, [wrapper], first, ctx);
}

/** Replace a group <div> with its children. */
export function ungroup(slide: ElementNode, addr: Address, ctx: ValueContext = EMPTY_CTX): ElementNode {
  const el = getAt(slide, addr);
  if (!el || el.tag !== "div") throw new EditError("only a group can be ungrouped");
  const without = remove(slide, addr, ctx);
  return insert(without, parentAddress(addr), elementChildren(el), lastIndex(addr), ctx).slide;
}

// ── Speaker notes ───────────────────────────────────────────────────────

export function notesOf(slide: ElementNode): string {
  const aside = elementChildren(slide).find((c) => c.tag === "aside");
  if (!aside) return "";
  return aside.children.map((c) => (c.type === "text" ? c.text : c.tag === "br" ? "\n" : "")).join("");
}

/** Set the speaker notes (plain text; empty removes them). */
export function setNotes(slide: ElementNode, text: string, ctx: ValueContext = EMPTY_CTX): ElementNode {
  const root = cloneNode(slide);
  root.children = root.children.filter((c) => !(c.type === "element" && c.tag === "aside"));
  const t = text.replace(/\r\n/g, "\n").trimEnd();
  if (t) {
    const lines = t.split("\n");
    const children: SlideNode[] = [];
    lines.forEach((line, i) => {
      if (i) children.push({ type: "element", tag: "br", attrs: {}, style: [], children: [], line: 0, col: 0 });
      if (line) children.push({ type: "text", text: line });
    });
    root.children.push({ type: "element", tag: "aside", attrs: {}, style: [], children, line: 0, col: 0 });
  }
  return checked(root, ctx);
}

// ── Tables ──────────────────────────────────────────────────────────────

function rowsOf(table: ElementNode) {
  return elementChildren(table).filter((r) => r.tag === "tr");
}

/** Add a row after `after` (-1 = at the top, below a header row if there is one). New cells copy the row above's cell kinds. */
export function addTableRow(slide: ElementNode, tableAddr: Address, after: number, ctx: ValueContext = EMPTY_CTX): ElementNode {
  return change(
    slide,
    tableAddr,
    (t) => {
      const rows = rowsOf(t);
      const model = rows[Math.max(0, Math.min(rows.length - 1, after))];
      const cols = model ? elementChildren(model).length : 1;
      const row: ElementNode = { type: "element", tag: "tr", attrs: {}, style: [], children: [], line: 0, col: 0 };
      for (let c = 0; c < cols; c++) row.children.push({ type: "element", tag: "td", attrs: {}, style: [], children: [], line: 0, col: 0 });
      t.children.splice(rawIndex(t, after + 1), 0, row);
    },
    ctx,
  );
}

export function removeTableRow(slide: ElementNode, tableAddr: Address, row: number, ctx: ValueContext = EMPTY_CTX): ElementNode {
  return change(
    slide,
    tableAddr,
    (t) => {
      if (rowsOf(t).length <= 1) throw new EditError("a table keeps at least one row");
      t.children.splice(rawIndex(t, row), 1);
    },
    ctx,
  );
}

/** Add a column after `after` (-1 = first). Header rows get a <th>. */
export function addTableColumn(slide: ElementNode, tableAddr: Address, after: number, ctx: ValueContext = EMPTY_CTX): ElementNode {
  return change(
    slide,
    tableAddr,
    (t) => {
      for (const r of rowsOf(t)) {
        const cells = elementChildren(r);
        const tag = cells.length && cells.every((c) => c.tag === "th") ? "th" : "td";
        r.children.splice(rawIndex(r, after + 1), 0, { type: "element", tag, attrs: {}, style: [], children: [], line: 0, col: 0 });
      }
      clearColumnWidths(t);
    },
    ctx,
  );
}

export function removeTableColumn(slide: ElementNode, tableAddr: Address, col: number, ctx: ValueContext = EMPTY_CTX): ElementNode {
  return change(
    slide,
    tableAddr,
    (t) => {
      const rows = rowsOf(t);
      if (rows.every((r) => elementChildren(r).length <= 1)) throw new EditError("a table keeps at least one column");
      for (const r of rows) {
        const i = rawIndex(r, col);
        if (i < r.children.length) r.children.splice(i, 1);
      }
      clearColumnWidths(t);
    },
    ctx,
  );
}

/** Column widths would no longer add up after a column change; fall back to automatic widths. */
function clearColumnWidths(t: ElementNode) {
  const first = rowsOf(t)[0];
  if (!first) return;
  for (const c of elementChildren(first)) c.style = c.style.filter((d) => d.name !== "width");
}

/** Make the first row a header row (th) or a plain row (td). */
export function setHeaderRow(slide: ElementNode, tableAddr: Address, on: boolean, ctx: ValueContext = EMPTY_CTX): ElementNode {
  return change(
    slide,
    tableAddr,
    (t) => {
      const first = rowsOf(t)[0];
      if (!first) return;
      for (const c of elementChildren(first)) c.tag = on ? "th" : "td";
    },
    ctx,
  );
}
