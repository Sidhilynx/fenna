// The page: the contenteditable <article> the user types in.
//
// While the user types, the browser edits the page directly, and that page
// is the newest version of the tab. A moment after typing stops, the page is
// read back through the format (sanitizeBlocks), so what is saved is always
// valid whatever the browser made; ids the browser copied (splitting a
// paragraph copies its id) are told apart, and written back onto the page.
// Drawing the page from the file happens only on a tab switch, undo, a
// command that rebuilds blocks, or a change from outside once typing pauses.

import { type ElementNode, sanitizeBlocks, sanitizeInline, serializeNode, tabMarkup } from "@opendeck/doc";
import { agent } from "@opendeck/shell";
import { api, assetBase } from "../api.ts";
import { attachPage, ctxOf, flushTyping, getState, goToTab, redo, setState, toast, typingPaused, undo } from "../store.ts";
import { blockOf, blockText, caretInto, getCaret, offsetIn, setCaret } from "./caret.ts";
import { suggestInput, suggestInsert } from "./suggest.ts";

let article: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let dirty = false;
let lastInput = 0;
let idleTimer: number | undefined;
let lastRange: Range | null = null;

const IDLE_MS = 700;

export const pageEl = () => article;

// ── Layout listeners (the margin, the block handles) ──

const layoutListeners = new Set<() => void>();
export function onLayout(fn: () => void): () => void {
  layoutListeners.add(fn);
  return () => layoutListeners.delete(fn);
}
let layoutFrame = 0;
export function emitLayout() {
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => {
    for (const l of layoutListeners) l();
  });
}

// ── Chip clicks (dates, dropdowns) go to the React layer ──

export type ChipEvent = { kind: "dropdown" | "date"; el: HTMLElement };
const chipListeners = new Set<(e: ChipEvent) => void>();
export function onChip(fn: (e: ChipEvent) => void): () => void {
  chipListeners.add(fn);
  return () => chipListeners.delete(fn);
}
/** Open a chip's menu or picker as a click on it would. */
export function openChip(el: HTMLElement) {
  for (const l of chipListeners) l({ kind: el.tagName === "TIME" ? "date" : "dropdown", el });
}

// ── Reading the page back ──

function quiet(fn: () => void) {
  fn();
  observer?.takeRecords();
}

function updateEmpty() {
  if (!article) return;
  const empty = article.children.length <= 1 && !article.textContent && !article.querySelector("img, hr, table, time, span[data-dropdown]");
  article.classList.toggle("is-empty", empty);
}

/** The blocks on the page now, if anything changed since the last read; null if nothing did. */
function pending(): ElementNode[] | null {
  if (!article || !dirty) return null;
  dirty = false;
  const blocks = sanitizeBlocks(article.innerHTML, ctxOf());
  const kids = [...article.children] as HTMLElement[];
  if (kids.length === blocks.length) {
    // The usual case: same blocks, maybe new ids. Write the ids onto the page.
    quiet(() => kids.forEach((k, i) => k.id !== blocks[i]!.attrs.id && (k.id = blocks[i]!.attrs.id!)));
  } else {
    // The browser made something the format folds differently: draw the page from what will be saved.
    const caret = caretByIndex();
    paintBlocks(blocks);
    restoreByIndex(caret);
  }
  return blocks;
}

function caretByIndex(): { index: number; offset: number } | null {
  const sel = document.getSelection();
  if (!article || !sel?.rangeCount || !article.contains(sel.focusNode)) return null;
  const b = blockOf(article, sel.focusNode);
  if (!b) return null;
  return { index: [...article.children].indexOf(b), offset: offsetIn(b, sel.focusNode!, sel.focusOffset) };
}

function restoreByIndex(c: { index: number; offset: number } | null) {
  const b = c && article ? (article.children[Math.min(c.index, article.children.length - 1)] as HTMLElement | undefined) : undefined;
  if (b?.id) setCaret(article!, { block: b.id, offset: c!.offset });
}

function paintBlocks(blocks: ElementNode[]) {
  if (!article) return;
  const s = getState();
  quiet(() => {
    article!.innerHTML = blocks.length ? tabMarkup({ type: "element", tag: "article", attrs: {}, children: blocks }, { assetBase: assetBase(), dropdowns: s.doc?.index.dropdowns ?? [], editable: true }) : "<p><br></p>";
  });
  updateEmpty();
  emitLayout();
}

/** Draw the page from a tab (the file's version). */
export function paint(tab: ElementNode | null, caret: { block: string; offset: number } | null) {
  if (!article) return;
  const hadFocus = document.activeElement === article;
  clearTimeout(idleTimer);
  dirty = false;
  paintBlocks((tab?.children ?? []) as ElementNode[]);
  if (caret) setCaret(article, caret, hadFocus || document.activeElement === document.body);
}

/** Something on the page changed (typing, a command): read it back after a pause. */
function touched() {
  dirty = true;
  lastInput = Date.now();
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => typingPaused(), IDLE_MS);
  updateEmpty();
  emitLayout();
}

/** After a command changed the page: save now, as one undo step. */
export async function changed() {
  dirty = true;
  clearTimeout(idleTimer);
  await flushTyping();
}

// ── Selection ──

/** Put back the selection the user had in the page (a menu took focus). */
export function restoreSelection(): boolean {
  if (!article) return false;
  const sel = document.getSelection();
  if (sel?.rangeCount && article.contains(sel.anchorNode) && document.activeElement === article) return true;
  if (!lastRange || !article.contains(lastRange.startContainer)) return false;
  article.focus({ preventScroll: true });
  sel?.removeAllRanges();
  sel?.addRange(lastRange);
  return true;
}

/** The block the caret is in (restoring the selection first), or null. */
export function currentBlock(): HTMLElement | null {
  if (!article || !restoreSelection()) return null;
  return blockOf(article, document.getSelection()?.focusNode ?? null);
}

let selTimer: number | undefined;
function onSelection() {
  const sel = document.getSelection();
  if (!article || !sel?.rangeCount || !article.contains(sel.anchorNode)) return;
  lastRange = sel.getRangeAt(0).cloneRange();
  clearTimeout(selTimer);
  selTimer = window.setTimeout(() => {
    if (!article) return;
    const r = lastRange;
    if (!r) return;
    const blocks = ([...article.children] as HTMLElement[]).filter((b) => b.id && r.intersectsNode(b)).map((b) => b.id);
    const text = r.collapsed ? "" : r.toString().replace(/\s+/g, " ").trim().slice(0, 400);
    const prev = getState().selection;
    if (prev.text !== text || prev.blocks.join() !== blocks.join()) setState({ selection: { blocks, text } });
  }, 150);
}

// ── Markdown shortcuts ──

const SHORTCUTS: [RegExp, (block: HTMLElement) => void][] = [
  [/^###$/, () => document.execCommand("formatBlock", false, "h3")],
  [/^##$/, () => document.execCommand("formatBlock", false, "h2")],
  [/^#$/, () => document.execCommand("formatBlock", false, "h1")],
  [/^[-*]$/, () => document.execCommand("insertUnorderedList")],
  [/^1[.)]$/, () => document.execCommand("insertOrderedList")],
  [/^\[ ?\]$/, () => {
    document.execCommand("insertUnorderedList");
    listAt()?.setAttribute("data-checklist", "");
  }],
  [/^>$/, () => document.execCommand("formatBlock", false, "blockquote")],
];

export function listAt(): HTMLElement | null {
  const n = document.getSelection()?.focusNode ?? null;
  const el = n?.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element | null);
  return (el?.closest("ul, ol") as HTMLElement | null) ?? null;
}

/** On a space: "# " makes a heading, "- " a list, and so on, at the start of a paragraph. */
function markdownShortcut(): boolean {
  const sel = document.getSelection();
  if (!article || !sel?.rangeCount || !sel.isCollapsed) return false;
  const block = blockOf(article, sel.focusNode);
  if (!block || block.tagName !== "P") return false;
  const before = blockText(block).slice(0, offsetIn(block, sel.focusNode!, sel.focusOffset));
  const hit = SHORTCUTS.find(([re]) => re.test(before));
  if (!hit) return false;
  const r = document.createRange();
  r.setStart(block, 0);
  r.setEnd(sel.focusNode!, sel.focusOffset);
  sel.removeAllRanges();
  sel.addRange(r);
  document.execCommand("delete");
  hit[1](block);
  return true;
}

/** "```" or "---" then Enter at the start of a paragraph: a code block, a divider. */
function enterShortcut(): boolean {
  const sel = document.getSelection();
  if (!article || !sel?.rangeCount || !sel.isCollapsed) return false;
  const block = blockOf(article, sel.focusNode);
  if (!block || block.tagName !== "P") return false;
  const text = blockText(block);
  if (text !== "```" && text !== "---") return false;
  if (text === "```") {
    block.textContent = "";
    block.append(document.createElement("br"));
    caretInto(block);
    document.execCommand("formatBlock", false, "pre");
  } else {
    const hr = document.createElement("hr");
    hr.setAttribute("contenteditable", "false");
    const p = document.createElement("p");
    p.append(document.createElement("br"));
    block.replaceWith(hr, p);
    caretInto(p);
  }
  return true;
}

// ── Keys ──

const mod = (e: KeyboardEvent) => (navigator.platform.startsWith("Mac") ? e.metaKey : e.ctrlKey);

/** Tab and Shift+Tab: next and previous cell in a table (a new row after the last); indent in a list. */
function tabKey(e: KeyboardEvent): boolean {
  const sel = document.getSelection();
  const n = sel?.focusNode ?? null;
  const el = n?.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element | null);
  const cell = el?.closest("td, th") as HTMLTableCellElement | null;
  if (cell && article?.contains(cell)) {
    const table = cell.closest("table")!;
    const cells = [...table.querySelectorAll("td, th")] as HTMLElement[];
    const i = cells.indexOf(cell);
    let next = cells[i + (e.shiftKey ? -1 : 1)];
    if (!next && !e.shiftKey) {
      const row = table.rows[table.rows.length - 1]!;
      const tr = document.createElement("tr");
      for (let k = 0; k < row.cells.length; k++) {
        const td = document.createElement("td");
        td.append(document.createElement("br"));
        tr.append(td);
      }
      row.parentNode!.append(tr);
      next = tr.cells[0]!;
    }
    if (next) caretInto(next, true);
    return true;
  }
  if (el?.closest("li") && article?.contains(el)) {
    document.execCommand(e.shiftKey ? "outdent" : "indent");
    return true;
  }
  return false;
}

export interface KeyCommands {
  style(tag: "p" | "h1" | "h2" | "h3"): void;
  list(kind: "ul" | "ol" | "check"): void;
  link(): void;
  code(): void;
  comment(): void;
}
let keyCommands: KeyCommands | null = null;
export function setKeyCommands(k: KeyCommands) {
  keyCommands = k;
}

function onKeyDown(e: KeyboardEvent) {
  const k = e.key.toLowerCase();
  if (mod(e) && !e.altKey && k === "z") {
    e.preventDefault();
    void (e.shiftKey ? redo() : undo());
    return;
  }
  if (mod(e) && !e.altKey && k === "y") {
    e.preventDefault();
    void redo();
    return;
  }
  if (mod(e) && e.altKey && /^[0-3]$/.test(e.key)) {
    e.preventDefault();
    keyCommands?.style(e.key === "0" ? "p" : (`h${e.key}` as "h1"));
    return;
  }
  if (mod(e) && e.shiftKey && ["7", "8", "9"].includes(e.key)) {
    e.preventDefault();
    keyCommands?.list(e.key === "7" ? "ol" : e.key === "8" ? "ul" : "check");
    return;
  }
  if (mod(e) && e.shiftKey && k === "x") {
    e.preventDefault();
    document.execCommand("strikeThrough");
    return;
  }
  if (mod(e) && !e.shiftKey && k === "k") {
    e.preventDefault();
    keyCommands?.link();
    return;
  }
  if (mod(e) && !e.shiftKey && k === "e") {
    e.preventDefault();
    keyCommands?.code();
    return;
  }
  if (mod(e) && e.altKey && k === "m") {
    e.preventDefault();
    keyCommands?.comment();
    return;
  }
  if (e.key === "Tab" && !mod(e) && !e.altKey && tabKey(e)) {
    e.preventDefault();
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && enterShortcut()) e.preventDefault();
}

// ── Input ──

function onBeforeInput(e: InputEvent) {
  if (!article) return;
  if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
    e.preventDefault();
    void (e.inputType === "historyUndo" ? undo() : redo());
    return;
  }
  if (e.inputType === "insertText" && e.data === " " && getState().mode === "edit" && markdownShortcut()) {
    e.preventDefault();
    return;
  }
  // In a code block, Enter is a new line, not a new block.
  if (e.inputType === "insertParagraph") {
    const n = document.getSelection()?.focusNode ?? null;
    const pre = (n?.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element | null))?.closest("pre");
    if (pre && article.contains(pre)) {
      e.preventDefault();
      document.execCommand("insertLineBreak");
      return;
    }
  }
  if (getState().mode === "suggest") suggestInput(e, article);
}

function onInput(e: Event) {
  // A new list item made by Enter starts unchecked.
  if ((e as InputEvent).inputType === "insertParagraph") {
    const n = document.getSelection()?.focusNode ?? null;
    const li = (n?.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element | null))?.closest("li");
    if (li?.hasAttribute("data-checked") && !li.textContent) li.removeAttribute("data-checked");
  }
}

// ── Paste and drop ──

async function insertImageFiles(files: File[]) {
  const paths: string[] = [];
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    try {
      paths.push(await api().importAsset(f.name || "pasted.png", new Uint8Array(await f.arrayBuffer())));
    } catch (err) {
      toast(`Couldn’t add the image: ${(err as Error).message}`);
    }
  }
  if (paths.length) imageInserter?.(paths);
}
let imageInserter: ((paths: string[]) => void) | null = null;
export function setImageInserter(fn: (paths: string[]) => void) {
  imageInserter = fn;
}
let blockInserter: ((blocks: ElementNode[]) => void) | null = null;
export function setBlockInserter(fn: (blocks: ElementNode[]) => void) {
  blockInserter = fn;
}

function onPaste(e: ClipboardEvent) {
  const data = e.clipboardData;
  if (!data || !article) return;
  e.preventDefault();
  const files = [...data.files].filter((f) => f.type.startsWith("image/"));
  if (files.length) {
    void insertImageFiles(files);
    return;
  }
  const html = data.getData("text/html");
  const text = data.getData("text/plain");
  const sel = document.getSelection();
  const n = sel?.focusNode ?? null;
  const inPre = !!(n?.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element | null))?.closest("pre");
  const suggesting = getState().mode === "suggest";
  if (inPre || (!html && !text.includes("\n")) || suggesting) {
    const plain = (text || (html ? (sanitizeInline(html).map((x) => (x.type === "text" ? x.text : "")).join("")) : "")).replace(/\r\n/g, "\n");
    if (suggesting && !inPre) suggestInsert(plain.replace(/\n+/g, " "), article);
    else document.execCommand("insertText", false, plain);
    return;
  }
  const source = html || text.split(/\r?\n/).map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join("");
  const blocks = sanitizeBlocks(source, ctxOf(), new Set([...article.querySelectorAll(":scope > [id]")].map((b) => b.id)));
  // One paragraph's worth goes into the text where the caret is; more becomes blocks of their own.
  if (blocks.length === 1 && blocks[0]!.tag === "p") {
    document.execCommand("insertHTML", false, blocks[0]!.children.map(serializeNode).join(""));
    return;
  }
  if (blocks.length) blockInserter?.(blocks);
}

function onDrop(e: DragEvent) {
  const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  e.preventDefault();
  const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY);
  if (pos) {
    const r = document.createRange();
    r.setStart(pos.offsetNode, pos.offset);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  }
  void insertImageFiles(files);
}

// ── Clicks: checkboxes, chips, links ──

function onMouseDown(e: MouseEvent) {
  const t = e.target as HTMLElement;
  const li = t.closest("ul[data-checklist] > li") as HTMLElement | null;
  if (li && article?.contains(li)) {
    const box = li.getBoundingClientRect();
    // The checkbox sits in the item's left gutter.
    if (e.clientX < box.left && e.clientX > box.left - 28 && e.clientY < box.top + 26) {
      e.preventDefault();
      li.toggleAttribute("data-checked");
      void changed();
      return;
    }
  }
  const chip = t.closest("span[data-dropdown], time[datetime]") as HTMLElement | null;
  if (chip && article?.contains(chip)) {
    e.preventDefault();
    for (const l of chipListeners) l({ kind: chip.tagName === "TIME" ? "date" : "dropdown", el: chip });
    return;
  }
  const a = t.closest("a[href]") as HTMLAnchorElement | null;
  const href = a?.getAttribute("href") ?? "";
  if (a && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (/^(https?:|mailto:)/.test(href)) void agent.openUrl(href);
    else if (href.startsWith("#")) void followInternal(href.slice(1));
  }
}

/** A link to "#id": that tab, or the block with that id (in this tab or another). */
async function followInternal(id: string) {
  const doc = getState().doc;
  if (!doc) return;
  let tab = doc.tabs.has(id) ? id : null;
  let block: string | null = null;
  if (!tab)
    for (const [tid, t] of doc.tabs)
      if (t.tab?.children.some((b) => b.type === "element" && b.attrs.id === id)) {
        tab = tid;
        block = id;
        break;
      }
  if (!tab) return toast("That link points at a heading or tab that no longer exists.");
  await goToTab(tab);
  if (block) article?.querySelector<HTMLElement>(`:scope > [id="${CSS.escape(block)}"]`)?.scrollIntoView({ block: "start" });
}

function onClick(e: MouseEvent) {
  // Links inside the page never navigate it.
  if ((e.target as HTMLElement).closest("a")) e.preventDefault();
}

// ── Mounting ──

export function mountPage(el: HTMLElement): () => void {
  article = el;
  document.execCommand("defaultParagraphSeparator", false, "p");
  observer = new MutationObserver(() => touched());
  observer.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-checked", "data-checklist", "data-value", "datetime", "href"] });
  const sel = () => onSelection();
  el.addEventListener("beforeinput", onBeforeInput);
  el.addEventListener("input", onInput);
  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("paste", onPaste);
  el.addEventListener("drop", onDrop);
  el.addEventListener("mousedown", onMouseDown);
  el.addEventListener("click", onClick);
  document.addEventListener("selectionchange", sel);
  attachPage({ pending, caret: () => (article ? getCaret(article) : null), typing: () => dirty && Date.now() - lastInput < IDLE_MS + 300 });
  return () => {
    observer?.disconnect();
    el.removeEventListener("beforeinput", onBeforeInput);
    el.removeEventListener("input", onInput);
    el.removeEventListener("keydown", onKeyDown);
    el.removeEventListener("paste", onPaste);
    el.removeEventListener("drop", onDrop);
    el.removeEventListener("mousedown", onMouseDown);
    el.removeEventListener("click", onClick);
    document.removeEventListener("selectionchange", sel);
    attachPage(null);
    article = null;
  };
}
