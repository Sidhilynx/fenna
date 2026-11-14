// Editing an artboard's tree.
//
// Every change the editor makes (a field in the properties panel, the Code
// tab, typed text, an insert, a wrap) is one of these. Each takes the root
// and returns a NEW root (the input is never changed, so undo stays simple),
// and each result is checked against the format before it is returned: an
// edit can't produce an artboard the parser would refuse.
//
// Elements are addressed as the renderer tags them: the chain of
// element-child indices from the root, joined by "." ("" is the root).

import { type Address, type Declaration, type ValueContext, childAddress, cloneNode, elementChildren, getAt, lastIndex, parentAddress, parseStyle } from "@opendeck/format";
import { type ArtboardNode, type ElementNode, parseArtboard, serializeBlock } from "./artboard.ts";
import { ELEMENTS, PROPERTIES, layerKind, nearestProperty, type LayerKind } from "./schema.ts";

export class EditError extends Error {}

const EMPTY_CTX: ValueContext = { colorTokens: new Set(), families: new Set() };
const blank = (tag: string, style: Declaration[] = [], children: ArtboardNode[] = [], attrs: Record<string, string> = {}): ElementNode => ({ type: "element", tag, attrs, style, children, line: 0, col: 0 });

/** Index in `children` (which also holds text) of the i-th element child. */
function rawIndex(n: ElementNode, elementIndex: number): number {
  let seen = -1;
  for (let i = 0; i < n.children.length; i++) if (n.children[i]!.type === "element" && ++seen === elementIndex) return i;
  return n.children.length;
}

/** An edit may not leave the artboard with an error. */
function checked(root: ElementNode, ctx: ValueContext): ElementNode {
  const r = parseArtboard(serializeBlock(root), ctx);
  const err = r.diagnostics.find((d) => d.severity === "error");
  if (!r.doc || err) throw new EditError(err?.message ?? "the edit made the artboard invalid");
  return root;
}

function change(root: ElementNode, addr: Address, fn: (el: ElementNode) => void, ctx: ValueContext): ElementNode {
  const next = cloneNode(root) as ElementNode;
  const el = getAt(next, addr) as ElementNode | null;
  if (!el) throw new EditError("that layer is no longer there");
  fn(el);
  return checked(next, ctx);
}

// ── Styles and attributes ──────────────────────────────────────────────────

/** Set several style properties (null or "" removes one). Values are checked. */
export function setStyles(root: ElementNode, addr: Address, props: Record<string, string | null>, ctx: ValueContext = EMPTY_CTX): ElementNode {
  return change(
    root,
    addr,
    (el) => {
      for (const [name, value] of Object.entries(props)) {
        const prop = PROPERTIES[name];
        if (!prop) throw new EditError(`${name} is not a property of the design format`);
        const at = el.style.findIndex((d) => d.name === name);
        if (value === null || value.trim() === "") {
          if (at >= 0) el.style.splice(at, 1);
          continue;
        }
        if (!prop.on.includes(el.tag)) throw new EditError(`${name} does not apply to <${el.tag}>`);
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

export const setStyle = (root: ElementNode, addr: Address, name: string, value: string | null, ctx: ValueContext = EMPTY_CTX) => setStyles(root, addr, { [name]: value }, ctx);

export const styleOf = (el: ElementNode, name: string): string | undefined => el.style.find((d) => d.name === name)?.value;

/** Replace every declaration of an element with the ones written as CSS text (the Code tab). */
export function setDeclarations(root: ElementNode, addr: Address, css: string, ctx: ValueContext = EMPTY_CTX): ElementNode {
  const parsed = parseStyle(css.replace(/\n/g, " "));
  if (parsed.errors.length) throw new EditError(parsed.errors[0]!);
  const target = getAt(root, addr);
  if (!target) throw new EditError("that layer is no longer there");
  for (const d of parsed.decls) {
    const prop = PROPERTIES[d.name];
    if (!prop) {
      const near = nearestProperty(d.name);
      throw new EditError(`${d.name} is not a property of the design format${near ? `; did you mean ${near}?` : ""}`);
    }
    if (!prop.on.includes(target.tag)) throw new EditError(`${d.name} does not apply to <${target.tag}>`);
    const problem = prop.check(d.value, ctx);
    if (problem) throw new EditError(`${d.name}: ${problem}`);
  }
  return change(root, addr, (el) => void (el.style = parsed.decls), ctx);
}

/** Set (or with null, remove) an attribute the element takes. */
export function setAttr(root: ElementNode, addr: Address, name: string, value: string | null, ctx: ValueContext = EMPTY_CTX): ElementNode {
  return change(
    root,
    addr,
    (el) => {
      if (name !== "id" && !(ELEMENTS[el.tag]?.attrs ?? []).includes(name)) throw new EditError(`<${el.tag}> takes no ${name}`);
      if (value === null || value === "") delete el.attrs[name];
      else el.attrs[name] = value;
    },
    ctx,
  );
}

// ── Content ────────────────────────────────────────────────────────────────

/** Parse a fragment of artboard HTML into nodes, checked as children of a `parentTag`. */
export function parseFragment(html: string, parentTag: string, ctx: ValueContext = EMPTY_CTX): ArtboardNode[] {
  const path = parentTag === "div" ? [] : parentTag === "li" ? ["ul", "li"] : parentTag === "tr" ? ["table", "tr"] : parentTag === "th" || parentTag === "td" ? ["table", "tr", parentTag] : [parentTag];
  const wrapped = `<div>${path.map((t) => `<${t}>`).join("")}${html}${[...path].reverse().map((t) => `</${t}>`).join("")}</div>`;
  const r = parseArtboard(wrapped, ctx);
  const err = r.diagnostics.find((d) => d.severity === "error");
  if (!r.doc || err) throw new EditError(err?.message ?? "that is not artboard content");
  let holder = r.doc.root;
  for (const tag of path) {
    const next = elementChildren(holder).find((c) => c.tag === tag) as ElementNode | undefined;
    if (!next) throw new EditError("that is not artboard content");
    holder = next;
  }
  return holder.children;
}

/** Replace what an element holds with an HTML fragment (the text of a heading, the items of a list). */
export function setContent(root: ElementNode, addr: Address, html: string, ctx: ValueContext = EMPTY_CTX): ElementNode {
  const target = getAt(root, addr);
  if (!target) throw new EditError("that layer is no longer there");
  const kids = ELEMENTS[target.tag]?.children;
  if (!kids || kids === "none" || kids === "raw") throw new EditError(`<${target.tag}> holds no content`);
  const nodes = parseFragment(html, target.tag, ctx);
  return change(root, addr, (el) => void (el.children = nodes), ctx);
}

/** Put nodes into a container at an element index (default: the end). Returns the new root and the first new address. */
export function insert(root: ElementNode, parent: Address, nodes: ArtboardNode[], index?: number, ctx: ValueContext = EMPTY_CTX): { root: ElementNode; at: Address } {
  const host = getAt(root, parent);
  if (!host) throw new EditError("that layer is no longer there");
  const count = elementChildren(host).length;
  const at = index === undefined ? count : Math.max(0, Math.min(count, index));
  const next = change(root, parent, (el) => void el.children.splice(rawIndex(el, at), 0, ...nodes.map((n) => cloneNode(n))), ctx);
  return { root: next, at: childAddress(parent, at) };
}

export function insertHtml(root: ElementNode, parent: Address, html: string, index?: number, ctx: ValueContext = EMPTY_CTX) {
  const host = getAt(root, parent);
  if (!host) throw new EditError("that layer is no longer there");
  return insert(root, parent, parseFragment(html, host.tag, ctx), index, ctx);
}

export function remove(root: ElementNode, addr: Address, ctx: ValueContext = EMPTY_CTX): ElementNode {
  if (addr === "") throw new EditError("the artboard's root can't be removed; delete the artboard instead");
  return change(root, parentAddress(addr), (el) => void el.children.splice(rawIndex(el, lastIndex(addr)), 1), ctx);
}

const descending = (a: Address, b: Address) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? -1) !== (pb[i] ?? -1)) return (pb[i] ?? -1) - (pa[i] ?? -1);
  return 0;
};

/** Remove several elements (last first, so addresses stay true; one inside another goes with it). */
export function removeMany(root: ElementNode, addrs: Address[], ctx: ValueContext = EMPTY_CTX): ElementNode {
  const sorted = [...new Set(addrs)].filter((a) => a !== "").sort(descending);
  let out = root;
  for (const a of sorted.filter((a) => !sorted.some((b) => b !== a && a.startsWith(b + ".")))) out = remove(out, a, ctx);
  return out;
}

/** Copy an element right after itself. Returns the copy's address. */
export function duplicate(root: ElementNode, addr: Address, ctx: ValueContext = EMPTY_CTX): { root: ElementNode; at: Address } {
  const el = getAt(root, addr) as ElementNode | null;
  if (!el || addr === "") throw new EditError("nothing to duplicate");
  const copy = cloneNode(el) as ElementNode;
  const strip = (n: ElementNode) => {
    delete n.attrs.id;
    for (const c of elementChildren(n)) strip(c as ElementNode);
  };
  strip(copy);
  return insert(root, parentAddress(addr), [copy], lastIndex(addr) + 1, ctx);
}

/** Move an element to another container and index (reordering layers). Returns its new address. */
export function move(root: ElementNode, addr: Address, toParent: Address, toIndex: number, ctx: ValueContext = EMPTY_CTX): { root: ElementNode; at: Address } {
  const el = getAt(root, addr) as ElementNode | null;
  if (!el || addr === "") throw new EditError("nothing to move");
  if (toParent === addr || toParent.startsWith(addr + ".")) throw new EditError("a layer can't move inside itself");
  const fromParent = parentAddress(addr);
  const fromIndex = lastIndex(addr);
  let target = toIndex;
  let parent = toParent;
  // Taking the element out first shifts its later siblings, and anything addressed through them.
  if (fromParent === toParent && toIndex > fromIndex) target -= 1;
  const prefix = fromParent === "" ? "" : fromParent + ".";
  if (toParent !== fromParent && toParent.startsWith(prefix)) {
    const rel = toParent.slice(prefix.length).split(".");
    if (Number(rel[0]) > fromIndex) parent = [childAddress(fromParent, Number(rel[0]) - 1), ...rel.slice(1)].join(".");
  }
  return insert(remove(root, addr, ctx), parent, [el], target, ctx);
}

/** Paint order among its siblings: later ones are in front. */
export function restack(root: ElementNode, addr: Address, where: "front" | "back" | "forward" | "backward", ctx: ValueContext = EMPTY_CTX) {
  const parent = parentAddress(addr);
  const host = getAt(root, parent);
  if (!host || addr === "") throw new EditError("nothing to reorder");
  const count = elementChildren(host).length;
  const i = lastIndex(addr);
  const to = where === "front" ? count : where === "back" ? 0 : where === "forward" ? Math.min(count, i + 2) : Math.max(0, i - 1);
  return move(root, addr, parent, to, ctx);
}

const WRAP_STYLE: Record<"column" | "row" | "grid", Declaration[]> = {
  column: [{ name: "display", value: "flex" }, { name: "flex-direction", value: "column" }, { name: "gap", value: "16px" }],
  row: [{ name: "display", value: "flex" }, { name: "flex-direction", value: "row" }, { name: "gap", value: "16px" }],
  grid: [{ name: "display", value: "grid" }, { name: "grid-template-columns", value: "1fr 1fr" }, { name: "gap", value: "16px" }],
};

/** Put sibling elements into a new container that lays them out. Returns the container's address. */
export function wrapIn(root: ElementNode, addrs: Address[], kind: "column" | "row" | "grid", ctx: ValueContext = EMPTY_CTX): { root: ElementNode; at: Address } {
  const list = [...new Set(addrs)].filter((a) => a !== "");
  if (!list.length) throw new EditError("select a layer inside the artboard to wrap");
  const parent = parentAddress(list[0]!);
  if (list.some((a) => parentAddress(a) !== parent)) throw new EditError("only layers side by side in the same container can be wrapped together");
  if (getAt(root, parent)?.tag !== "div") throw new EditError("only layers inside a container can be wrapped");
  const sorted = list.sort((a, b) => lastIndex(a) - lastIndex(b));
  const nodes = sorted.map((a) => cloneNode(getAt(root, a)!) as ElementNode);
  const wrapper = blank("div", WRAP_STYLE[kind].map((d) => ({ ...d })), nodes);
  return insert(removeMany(root, sorted, ctx), parent, [wrapper], lastIndex(sorted[0]!), ctx);
}

/** Replace a container with what it holds. */
export function unwrap(root: ElementNode, addr: Address, ctx: ValueContext = EMPTY_CTX): ElementNode {
  const el = getAt(root, addr);
  if (!el || addr === "" || el.tag !== "div") throw new EditError("only a container inside the artboard can be unwrapped");
  return insert(remove(root, addr, ctx), parentAddress(addr), elementChildren(el) as ElementNode[], lastIndex(addr), ctx).root;
}

/** Turn a text element into another kind (a paragraph into a heading or a list), keeping its words and the styles that still apply. */
export function setTag(root: ElementNode, addr: Address, tag: string, ctx: ValueContext = EMPTY_CTX): ElementNode {
  const el = getAt(root, addr) as ElementNode | null;
  if (!el || addr === "") throw new EditError("that layer is no longer there");
  if (el.tag === tag) return root;
  const next = cloneNode(el) as ElementNode;
  const allowed = new Set(["id", ...(ELEMENTS[tag]?.attrs ?? [])]);
  for (const k of Object.keys(next.attrs)) if (!allowed.has(k)) delete next.attrs[k];
  next.style = next.style.filter((d) => PROPERTIES[d.name]?.on.includes(tag));
  const wasList = el.tag === "ul" || el.tag === "ol";
  const willList = tag === "ul" || tag === "ol";
  if (wasList && !willList) {
    next.children = (elementChildren(next) as ElementNode[]).flatMap((li, i) => [...(i ? [blank("br")] : []), ...li.children.filter((c) => c.type === "text" || !["ul", "ol"].includes(c.tag))]);
  } else if (!wasList && willList) {
    const items: ElementNode[] = [blank("li")];
    for (const c of next.children) {
      if (c.type === "element" && c.tag === "br") items.push(blank("li"));
      else items[items.length - 1]!.children.push(c);
    }
    next.children = items;
  }
  next.tag = tag;
  return insert(remove(root, addr, ctx), parentAddress(addr), [next], lastIndex(addr), ctx).root;
}

/** The root with its width (and height; or min-height, for an artboard that grows with what it holds) set to the artboard's size. */
export function sizeRoot(root: ElementNode, w: number, h: number, grows = false): ElementNode {
  const tall = grows ? "min-height" : "height";
  // A page that grows keeps its height as a least height, in the same place in the list.
  let style = grows && !root.style.some((d) => d.name === "min-height") ? root.style.map((d) => (d.name === "height" ? { name: tall, value: d.value } : d)) : root.style.filter((d) => !(grows && d.name === "height"));
  for (const [name, value] of [[tall, `${h}px`], ["width", `${w}px`]] as const) style = style.some((d) => d.name === name) ? style.map((d) => (d.name === name ? { name, value } : d)) : [{ name, value }, ...style];
  return JSON.stringify(style) === JSON.stringify(root.style) ? root : { ...root, style };
}

// ── The layer tree ─────────────────────────────────────────────────────────

/** The words of an element as they read on the artboard. */
export function layerText(node: ArtboardNode): string {
  if (node.type === "text") return node.text;
  if (node.tag === "img") return node.attrs.alt ?? "";
  if (node.tag === "input") return node.attrs.value ?? node.attrs.placeholder ?? "";
  return node.children.map(layerText).join(" ").replace(/\s+/g, " ").trim();
}

export interface LayerRow {
  address: Address;
  kind: LayerKind;
  tag: string;
  /** Its words, cut to a line. */
  text: string;
  depth: number;
  hasChildren: boolean;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Does this element show its element children as layers of their own (a container, a list, a table). */
export const holdsLayers = (el: ElementNode) => Array.isArray(ELEMENTS[el.tag]?.children);

/** The rows the properties panel lists: containers and what they hold; the inline parts of a text are not layers. */
export function layerTree(root: ElementNode, collapsed: ReadonlySet<Address> = new Set()): LayerRow[] {
  const rows: LayerRow[] = [];
  const walk = (node: ElementNode, address: Address, depth: number) => {
    const kids = holdsLayers(node) ? (elementChildren(node) as ElementNode[]) : [];
    rows.push({ address, kind: layerKind(node), tag: node.tag, text: clip(layerText(node), 60), depth, hasChildren: kids.length > 0 });
    if (!collapsed.has(address)) kids.forEach((c, i) => walk(c, childAddress(address, i), depth + 1));
  };
  walk(root, "", 0);
  return rows;
}

/** "Heading “Hello from a canvas”": what a layer is called in menus, comments and the chat. */
export function layerLabel(node: ElementNode): string {
  const text = clip(layerText(node), 40);
  return text ? `${layerKind(node)} “${text}”` : layerKind(node);
}

/** The address of the nearest element that is a layer (an inline <b> inside a paragraph is part of the paragraph). */
export function layerAddress(root: ElementNode, addr: Address): Address {
  let at = addr;
  for (;;) {
    if (at === "") return "";
    const parent = getAt(root, parentAddress(at)) as ElementNode | null;
    if (parent && holdsLayers(parent)) return at;
    at = parentAddress(at);
  }
}
