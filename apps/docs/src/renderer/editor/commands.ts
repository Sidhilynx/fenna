// What the toolbar, the menus and the shortcuts do to the page.
//
// Changes inside text (a heading, a list, a mark, a chip) are made on the
// page the way the browser makes them, then saved at once as one undo step
// (changed()). Changes to whole blocks (insert a table, delete a block,
// resize an image, add a table row) are made to the tab's blocks through the
// store, and the page is drawn again.

import { type Dropdown, type ElementNode, type TextColor, TEXT_COLORS, formatDate, newBlockId } from "@opendeck/doc";
import { api, plainError } from "../api.ts";
import { editTab, toast } from "../store.ts";
import { caretInto } from "./caret.ts";
import { localDate } from "./lines.ts";
import { changed, currentBlock, listAt, pageEl, restoreSelection } from "./page.ts";

const el = (tag: string, attrs: Record<string, string> = {}, children: ElementNode["children"] = []): ElementNode => ({ type: "element", tag, attrs, children });
const txt = (text: string) => ({ type: "text" as const, text });

export type BlockStyle = "p" | "h1" | "h2" | "h3" | "blockquote" | "pre";

/** The block style the caret is in, for menus. */
export function styleAt(): BlockStyle | "ul" | "ol" | "check" | null {
  const b = currentBlock();
  if (!b) return null;
  const tag = b.tagName.toLowerCase();
  if (tag === "ul") return b.hasAttribute("data-checklist") ? "check" : "ul";
  if (tag === "ol") return "ol";
  return (["p", "h1", "h2", "h3", "blockquote", "pre"].includes(tag) ? tag : null) as BlockStyle | null;
}

/** Turn the block the caret is in into a heading, text, a quote or code. */
export function setStyle(tag: BlockStyle) {
  if (!restoreSelection()) return;
  const list = listAt();
  if (list) document.execCommand(list.tagName === "OL" ? "insertOrderedList" : "insertUnorderedList");
  document.execCommand("formatBlock", false, tag);
  void changed();
}

/** Make the block a bulleted, numbered or check list; the same kind again turns it back into text. */
export function toggleList(kind: "ul" | "ol" | "check") {
  if (!restoreSelection()) return;
  const list = listAt();
  const now = list ? (list.tagName === "OL" ? "ol" : list.hasAttribute("data-checklist") ? "check" : "ul") : null;
  if (now === kind) {
    list!.removeAttribute("data-checklist");
    document.execCommand(kind === "ol" ? "insertOrderedList" : "insertUnorderedList");
  } else if (now && (now === "ol") === (kind === "ol")) {
    // Bulleted ⇄ checklist: the same list, marked or not.
    list!.toggleAttribute("data-checklist", kind === "check");
  } else {
    document.execCommand(kind === "ol" ? "insertOrderedList" : "insertUnorderedList");
    if (kind === "check") listAt()?.setAttribute("data-checklist", "");
  }
  void changed();
}

/** Inline code: wrap the selection, or unwrap it when it's already code. */
export function toggleCode() {
  if (!restoreSelection()) return;
  const sel = document.getSelection()!;
  const n = sel.anchorNode;
  const code = (n?.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element | null))?.closest("code");
  if (code && pageEl()?.contains(code)) {
    code.replaceWith(...code.childNodes);
  } else {
    if (sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    const c = document.createElement("code");
    c.textContent = r.toString();
    r.deleteContents();
    r.insertNode(c);
    sel.collapse(c, 1);
  }
  void changed();
}

/**
 * Link the selection to `href`, showing `text` (the selection's own text if
 * it is left the same); an empty address removes the link.
 */
export function setLink(href: string, text = "") {
  if (!restoreSelection()) return;
  const url = href.trim();
  const sel = document.getSelection()!;
  // Inside a link with nothing selected: the change is to that whole link.
  const n = sel.anchorNode;
  const inLink = (n?.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element | null))?.closest("a");
  if (inLink && sel.isCollapsed && pageEl()?.contains(inLink)) {
    const r = document.createRange();
    r.selectNodeContents(inLink);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  const shown = text.trim();
  if (!url) document.execCommand("unlink");
  else if (sel.isCollapsed || (shown && shown !== sel.toString().trim())) {
    const a = document.createElement("a");
    a.setAttribute("href", url);
    a.textContent = shown || url;
    if (inLink) inLink.replaceWith(a);
    else document.execCommand("insertHTML", false, a.outerHTML);
  } else document.execCommand("createLink", false, url);
  void changed();
}

/** The selected text (or the link's text when the caret is in one), for the link box. */
export function selectedText(): string {
  if (!restoreSelection()) return "";
  const sel = document.getSelection()!;
  if (!sel.isCollapsed) return sel.toString().replace(/s+/g, " ").trim();
  const n = sel.anchorNode;
  return (n?.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element | null))?.closest("a")?.textContent ?? "";
}

// ── Color and highlight ─────────────────────────────────────────────────
// The browser applies a color across blocks and around existing color
// correctly; it is asked to use marker colors, which are then turned into
// the format's own <span data-text> and <mark>.

const COLOR_MARK: Record<TextColor | "default", string> = { red: "rgb(0, 0, 1)", yellow: "rgb(0, 0, 2)", green: "rgb(0, 0, 3)", teal: "rgb(0, 0, 4)", purple: "rgb(0, 0, 5)", default: "rgb(0, 0, 6)" };
const HIGHLIGHT_MARK = "rgb(0, 0, 7)";
const toHex = (rgb: string) => `#${rgb.match(/d+/g)!.map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
const colorFromMark = (value: string): TextColor | "default" | null => {
  const probe = document.createElement("span");
  probe.style.color = value;
  const rgb = probe.style.color;
  return (Object.entries(COLOR_MARK).find(([, v]) => v === rgb)?.[0] as TextColor | "default" | undefined) ?? null;
};

function unwrap(el: Element) {
  el.replaceWith(...el.childNodes);
}

export function setTextColor(color: TextColor | null) {
  const page = pageEl();
  if (!page || !restoreSelection() || document.getSelection()!.isCollapsed) return;
  // The format's colors become the browser's own, so it can split and replace them.
  for (const s of page.querySelectorAll<HTMLElement>("span[data-text]")) {
    const f = document.createElement("font");
    f.setAttribute("color", toHex(COLOR_MARK[s.dataset.text as TextColor] ?? COLOR_MARK.default));
    f.append(...s.childNodes);
    s.replaceWith(f);
  }
  document.execCommand("styleWithCSS", false, "false");
  document.execCommand("foreColor", false, toHex(COLOR_MARK[color ?? "default"]));
  for (const el of page.querySelectorAll<HTMLElement>("font[color], span[style]")) {
    const name = colorFromMark(el.getAttribute("color") ?? el.style.color);
    if (!name || name === "default") {
      if (el.tagName === "FONT" || name === "default") unwrap(el);
      continue;
    }
    const span = document.createElement("span");
    span.dataset.text = name;
    span.append(...el.childNodes);
    el.replaceWith(span);
  }
  void changed();
}

export function setHighlight(on: boolean) {
  const page = pageEl();
  if (!page || !restoreSelection()) return;
  const sel = document.getSelection()!;
  if (on) {
    if (sel.isCollapsed) return;
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("hiliteColor", false, toHex(HIGHLIGHT_MARK));
    document.execCommand("styleWithCSS", false, "false");
    for (const el of page.querySelectorAll<HTMLElement>("[style]")) {
      if (el.style.backgroundColor !== HIGHLIGHT_MARK) continue;
      el.style.removeProperty("background-color");
      const m = document.createElement("mark");
      m.append(...el.childNodes);
      el.replaceWith(m);
    }
  } else {
    const r = sel.getRangeAt(0);
    for (const m of page.querySelectorAll("mark")) if (r.intersectsNode(m)) unwrap(m);
  }
  void changed();
}

/** The color and highlight where the selection starts, for menus. */
export function colorAt(): { color: TextColor | null; highlight: boolean } {
  if (!restoreSelection()) return { color: null, highlight: false };
  const n = document.getSelection()!.anchorNode;
  const el = n?.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element | null);
  const c = el?.closest<HTMLElement>("span[data-text]")?.dataset.text as TextColor | undefined;
  return { color: c && (TEXT_COLORS as readonly string[]).includes(c) ? c : null, highlight: !!el?.closest("mark") };
}

/** The link the caret is in, if any. */
export function linkAt(): string {
  if (!restoreSelection()) return "";
  const n = document.getSelection()?.anchorNode ?? null;
  return ((n?.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element | null))?.closest("a")?.getAttribute("href")) ?? "";
}

/**
 * Insert inline markup (a chip) at the caret, followed by a space to type on.
 * Placed by hand, not with insertHTML: at the end of a line Chromium puts an
 * uneditable element after the paragraph instead of in it.
 */
function insertInline(html: string) {
  const page = pageEl();
  if (!page || !restoreSelection()) return false;
  const sel = document.getSelection()!;
  const r = sel.getRangeAt(0);
  r.deleteContents();
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const piece = tpl.content.firstChild;
  if (!piece) return false;
  // A plain space at the end of a line wouldn't show; this one does, and typing goes after it.
  const space = document.createTextNode("\u00a0");
  r.insertNode(space);
  r.insertNode(piece);
  const block = [...page.children].find((b) => b.contains(piece));
  // An empty line's placeholder <br> goes once the line has something in it.
  if (block?.lastChild instanceof HTMLBRElement && block.lastChild.previousSibling) block.lastChild.remove();
  const after = document.createRange();
  after.setStart(space, 1);
  sel.removeAllRanges();
  sel.addRange(after);
  void changed();
  return true;
}

/** Put a date chip at the caret; returns it, so its picker can open. */
export function insertDate(iso = localDate()): HTMLElement | null {
  if (!insertInline(`<time class="od-date" datetime="${iso}" contenteditable="false">${formatDate(iso)}</time>`)) return null;
  const n = document.getSelection()?.focusNode ?? null;
  const block = n && pageEl()?.contains(n) ? currentBlock() : null;
  const chips = block ? [...block.querySelectorAll<HTMLElement>(`time[datetime="${iso}"]`)] : [];
  return chips.find((c) => c.nextSibling === n || c.nextSibling?.nextSibling === n) ?? chips[chips.length - 1] ?? null;
}

/** A link to another tab at the caret, named as the tab is. */
export function insertTabLink(id: string, name: string) {
  const a = document.createElement("a");
  a.setAttribute("href", `#${id}`);
  a.textContent = name;
  insertInline(a.outerHTML);
}

export function insertDropdown(dd: Dropdown) {
  const o = dd.options[0];
  if (!o) return;
  insertInline(`<span class="od-chip" data-dropdown="${dd.id}" data-value="${o.id}" data-color="${o.color}" contenteditable="false">${o.label.replace(/</g, "&lt;")}</span>`);
}

/** Set a dropdown chip to another option. */
export function setChipValue(chip: HTMLElement, dd: Dropdown, optionId: string) {
  const o = dd.options.find((x) => x.id === optionId);
  if (!o) return;
  chip.dataset.value = o.id;
  chip.dataset.color = o.color;
  chip.textContent = o.label;
  void changed();
}

export function setChipDate(chip: HTMLElement, iso: string) {
  chip.setAttribute("datetime", iso);
  chip.textContent = formatDate(iso);
  void changed();
}

// ── Whole blocks ────────────────────────────────────────────────────────

/** Ids on the current tab, so new blocks get fresh ones. */
function takenIds(blocks: ElementNode[]) {
  return new Set(blocks.map((b) => b.attrs.id!));
}

/**
 * Put new blocks after the block the caret is in (or in its place when it is
 * an empty paragraph); at the end when the caret isn't on the page. A text
 * block follows so there is always somewhere to type after them.
 */
export async function insertBlocks(make: (taken: Set<string>) => ElementNode[], label: string, caretIn: "first" | "after" = "after") {
  const at = currentBlock();
  const atId = at?.id ?? null;
  const replace = !!at && at.tagName === "P" && !at.textContent && !at.querySelector("img, time, span[data-dropdown]");
  let focus: string | null = null;
  await editTab(
    label,
    (blocks) => {
      const taken = takenIds(blocks);
      const made = make(taken);
      const i = atId ? blocks.findIndex((b) => b.attrs.id === atId) : -1;
      const pos = i < 0 ? blocks.length : replace ? i : i + 1;
      const next = [...blocks.slice(0, pos), ...made, ...blocks.slice(replace && i >= 0 ? i + 1 : pos)];
      const after = next[pos + made.length];
      let tail: ElementNode[] = [];
      if (!after || after.tag !== "p") {
        const p = el("p", { id: newBlockId(taken) });
        tail = [p];
      }
      focus = caretIn === "first" ? made[0]!.attrs.id! : (tail[0]?.attrs.id ?? after?.attrs.id ?? null);
      return [...next.slice(0, pos + made.length), ...tail, ...next.slice(pos + made.length)];
    },
    { caret: null },
  );
  const page = pageEl();
  const target = focus ? page?.querySelector<HTMLElement>(`:scope > [id="${CSS.escape(focus)}"]`) : null;
  if (target && page) {
    page.focus({ preventScroll: true });
    const cell = target.querySelector("th, td, li, figcaption");
    caretInto(cell ?? target);
    target.scrollIntoView({ block: "nearest" });
  }
}

export function insertTable(rows = 3, cols = 3) {
  void insertBlocks(
    (taken) => [
      el(
        "table",
        { id: newBlockId(taken) },
        Array.from({ length: rows }, (_, r) => el("tr", {}, Array.from({ length: cols }, () => el(r === 0 ? "th" : "td")))),
      ),
    ],
    "Insert table",
    "first",
  );
}

export function insertDivider() {
  void insertBlocks((taken) => [el("hr", { id: newBlockId(taken) })], "Insert divider");
}

export function insertImagesAt(paths: string[]) {
  void insertBlocks((taken) => paths.map((src) => el("figure", { id: newBlockId(taken) }, [el("img", { src, alt: "" })])), paths.length > 1 ? "Insert images" : "Insert image");
}

export async function pickImages() {
  restoreSelection();
  try {
    const paths = await api().pickImages();
    if (paths.length) insertImagesAt(paths);
  } catch (e) {
    toast(`Couldn’t add the image: ${plainError(e)}`);
  }
}

/** Pasted blocks, after the caret's block. */
export function insertPasted(blocks: ElementNode[]) {
  void insertBlocks((taken) => blocks.map((b) => (taken.has(b.attrs.id!) ? { ...b, attrs: { ...b.attrs, id: newBlockId(taken) } } : (taken.add(b.attrs.id!), b))), "Paste");
}

export function deleteBlock(id: string, label = "Delete block") {
  void editTab(label, (blocks) => {
    const next = blocks.filter((b) => b.attrs.id !== id);
    return next.length ? next : [el("p", { id: newBlockId(takenIds(blocks)) })];
  });
}

export function setImageWidth(id: string, width: number | null) {
  void editTab("Resize image", (blocks) => blocks.map((b) => (b.attrs.id === id ? { ...b, attrs: width && width < 100 ? { ...b.attrs, "data-width": String(width) } : (({ "data-width": _w, ...rest }) => rest)(b.attrs) } : b)));
}

export function toggleCaption(id: string) {
  void editTab("Caption", (blocks) =>
    blocks.map((b) => {
      if (b.attrs.id !== id) return b;
      const has = b.children.some((c) => c.type === "element" && c.tag === "figcaption");
      return { ...b, children: has ? b.children.filter((c) => !(c.type === "element" && c.tag === "figcaption")) : [...b.children, el("figcaption", {}, [txt("Caption")])] };
    }),
  );
}

// ── Tables ──────────────────────────────────────────────────────────────

const rowsOf = (t: ElementNode) => t.children.filter((c): c is ElementNode => c.type === "element");

/** Which cell of a table the caret is in: [row, column], or null. */
export function cellAt(tableId: string): [number, number] | null {
  const n = document.getSelection()?.focusNode ?? null;
  const cell = (n?.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element | null))?.closest("td, th") as HTMLTableCellElement | null;
  const table = cell?.closest("table");
  if (!cell || table?.id !== tableId) return null;
  return [(cell.parentElement as HTMLTableRowElement).rowIndex, cell.cellIndex];
}

function editTable(id: string, label: string, fn: (rows: ElementNode[]) => ElementNode[]) {
  void editTab(label, (blocks) => blocks.map((b) => (b.attrs.id === id && b.tag === "table" ? { ...b, children: fn(rowsOf(b)) } : b)));
}

export function addRow(id: string, at?: number) {
  editTable(id, "Add row", (rows) => {
    const width = rowsOf(rows[0] ?? el("tr")).length || 1;
    const row = el("tr", {}, Array.from({ length: width }, () => el("td")));
    const i = at === undefined ? rows.length : at + 1;
    return [...rows.slice(0, i), row, ...rows.slice(i)];
  });
}

export function addColumn(id: string, at?: number) {
  editTable(id, "Add column", (rows) =>
    rows.map((r, ri) => {
      const cells = rowsOf(r);
      if (cells.length >= 20) {
        if (ri === 0) toast("A table has at most 20 columns.");
        return r;
      }
      const i = at === undefined ? cells.length : at + 1;
      const tag = ri === 0 && cells[0]?.tag === "th" ? "th" : "td";
      return { ...r, children: [...cells.slice(0, i), el(tag), ...cells.slice(i)] };
    }),
  );
}

export function deleteRow(id: string, at: number) {
  editTable(id, "Delete row", (rows) => (rows.length > 1 ? rows.filter((_, i) => i !== at) : rows));
}

export function deleteColumn(id: string, at: number) {
  editTable(id, "Delete column", (rows) => rows.map((r) => (rowsOf(r).length > 1 ? { ...r, children: rowsOf(r).filter((_, i) => i !== at) } : r)));
}

/** The first row as headers, or as plain cells. */
export function toggleHeaderRow(id: string) {
  editTable(id, "Header row", (rows) => {
    const first = rows[0];
    if (!first) return rows;
    const isHead = rowsOf(first).every((c) => c.tag === "th");
    return [{ ...first, children: rowsOf(first).map((c) => ({ ...c, tag: isHead ? "td" : "th" })) }, ...rows.slice(1)];
  });
}
