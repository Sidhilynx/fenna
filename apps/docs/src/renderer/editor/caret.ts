// Positions in the page as (block id, text offset): they survive the page
// being drawn again from the file, where DOM nodes don't. A chip (a date, a
// dropdown) and a line break each count as one character.

import type { CaretPos } from "../store.ts";

const isChip = (n: Node): n is HTMLElement => n instanceof HTMLElement && n.isContentEditable === false && n.getAttribute("contenteditable") === "false";

/** The block (a direct child of the article) holding `node`. */
export function blockOf(article: HTMLElement, node: Node | null): HTMLElement | null {
  let n: Node | null = node;
  while (n && n.parentNode !== article) n = n.parentNode;
  return n instanceof HTMLElement ? n : null;
}

/** Text length of a node, as positions count it. */
function lengthOf(n: Node): number {
  if (n.nodeType === Node.TEXT_NODE) return (n as Text).data.length;
  if (n instanceof HTMLBRElement) return 1;
  if (isChip(n)) return 1;
  let len = 0;
  for (const c of n.childNodes) len += lengthOf(c);
  return len;
}

/** Offset of (node, offset) from the start of `root`. */
export function offsetIn(root: Node, node: Node, offset: number): number {
  let total = 0;
  let found = false;
  const walk = (n: Node): void => {
    if (found) return;
    if (n === node) {
      if (n.nodeType === Node.TEXT_NODE) total += offset;
      else for (let i = 0; i < offset && i < n.childNodes.length; i++) total += lengthOf(n.childNodes[i]!);
      found = true;
      return;
    }
    if (n.nodeType === Node.TEXT_NODE || n instanceof HTMLBRElement || isChip(n)) {
      if (n.contains(node)) {
        found = true;
        return;
      }
      total += lengthOf(n);
      return;
    }
    for (const c of n.childNodes) {
      walk(c);
      if (found) return;
    }
  };
  walk(root);
  return total;
}

/** The DOM point `offset` characters into `root` (clamped to its end). */
export function pointAt(root: Node, offset: number): { node: Node; offset: number } {
  let left = Math.max(0, offset);
  let result: { node: Node; offset: number } | null = null;
  const walk = (n: Node): void => {
    if (result) return;
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n as Text).data.length;
      if (left <= len) result = { node: n, offset: left };
      else left -= len;
      return;
    }
    if (n instanceof HTMLBRElement || isChip(n)) {
      const parent = n.parentNode!;
      const i = Array.prototype.indexOf.call(parent.childNodes, n);
      if (left === 0) result = { node: parent, offset: i };
      else left -= 1;
      return;
    }
    for (const c of n.childNodes) {
      walk(c);
      if (result) return;
    }
  };
  walk(root);
  if (result) return result;
  // Past the end: the end of the last text, or the start of the block.
  const texts = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  while (texts.nextNode()) last = texts.currentNode as Text;
  if (last && !isChip(last.parentNode!)) return { node: last, offset: last.data.length };
  return { node: root, offset: root.childNodes.length && root.lastChild instanceof HTMLBRElement ? root.childNodes.length - 1 : root.childNodes.length };
}

/** Where the caret is in the article, or null when it isn't in it. */
export function getCaret(article: HTMLElement): CaretPos | null {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount || !article.contains(sel.focusNode)) return null;
  const block = blockOf(article, sel.focusNode);
  if (!block?.id) return null;
  return { block: block.id, offset: offsetIn(block, sel.focusNode!, sel.focusOffset) };
}

/** Put the caret at a saved position; a missing block puts it at the end of the nearest one. */
export function setCaret(article: HTMLElement, pos: CaretPos | null, focus = true): boolean {
  const block = pos ? (article.querySelector<HTMLElement>(`:scope > [id="${CSS.escape(pos.block)}"]`) ?? null) : null;
  if (!block) return false;
  const p = pointAt(block, pos!.offset);
  const sel = document.getSelection();
  if (!sel) return false;
  if (focus) article.focus({ preventScroll: true });
  const r = document.createRange();
  r.setStart(p.node, p.offset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  return true;
}

/** Caret at the start (or end) of an element. */
export function caretInto(el: Node, atEnd = false) {
  const sel = document.getSelection();
  if (!sel) return;
  const r = document.createRange();
  const p = atEnd ? pointAt(el, Number.MAX_SAFE_INTEGER) : pointAt(el, 0);
  r.setStart(p.node, p.offset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** A DOM range over characters [start, end) of a block. */
export function rangeIn(block: HTMLElement, start: number, end: number): Range {
  const a = pointAt(block, start);
  const b = pointAt(block, end);
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  return r;
}

/** Text of a block as positions count it (chips and line breaks as one character each). */
export function blockText(block: Node): string {
  let s = "";
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) s += (n as Text).data;
    else if (n instanceof HTMLBRElement) s += "\n";
    else if (isChip(n)) s += "￼";
    else for (const c of n.childNodes) walk(c);
  };
  walk(block);
  return s;
}
