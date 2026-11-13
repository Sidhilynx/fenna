// Suggesting mode: typing and deleting become suggestions instead of
// changes. New text goes into <ins data-sid>, removed text is wrapped in
// <del data-sid> (or, if it was the user's own suggestion, really removed).
// Typing over a selection is one suggestion: a <del> and an <ins> sharing a
// sid. Structure (new paragraphs, lists, formatting) changes directly.

const SID = () => `s${crypto.randomUUID().slice(0, 8)}`;

function mark(tag: "ins" | "del", sid: string): HTMLElement {
  const el = document.createElement(tag);
  el.dataset.sid = sid;
  el.dataset.by = "you";
  el.dataset.at = String(Date.now());
  return el;
}

const mine = (el: Element | null, tag: "ins" | "del") => !!el && el.tagName.toLowerCase() === tag && (el as HTMLElement).dataset.by === "you" && !!(el as HTMLElement).dataset.sid;
const closestMark = (n: Node | null, tag: "ins" | "del", article: HTMLElement): HTMLElement | null => {
  let cur: Node | null = n;
  while (cur && cur !== article) {
    if (cur instanceof HTMLElement && cur.tagName.toLowerCase() === tag && cur.dataset.sid) return cur;
    cur = cur.parentNode;
  }
  return null;
};

/** Text nodes inside a range, each with the part of it the range covers. */
function textSlices(range: Range): { node: Text; start: number; end: number }[] {
  const out: { node: Text; start: number; end: number }[] = [];
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) {
    out.push({ node: root as Text, start: range.startOffset, end: range.endOffset });
    return out;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    if (!range.intersectsNode(t)) continue;
    const start = t === range.startContainer ? range.startOffset : 0;
    const end = t === range.endContainer ? range.endOffset : t.data.length;
    if (end > start) out.push({ node: t, start, end });
  }
  return out;
}

/** Isolate [start, end) of a text node as its own node. */
function isolate(t: Text, start: number, end: number): Text {
  let node = t;
  if (start > 0) node = node.splitText(start);
  if (end - start < node.data.length) node.splitText(end - start);
  return node;
}

/**
 * Mark a range as deleted. Text that is the user's own suggested insertion
 * is removed for real; text already marked deleted stays as it is. Returns
 * the deletion marks made, in order.
 */
export function suggestDelete(range: Range, article: HTMLElement, sid = SID()): HTMLElement[] {
  const made: HTMLElement[] = [];
  for (const s of textSlices(range)) {
    if (closestMark(s.node, "del", article)) continue;
    const piece = isolate(s.node, s.start, s.end);
    const ins = closestMark(piece, "ins", article);
    if (ins && mine(ins, "ins")) {
      piece.remove();
      if (!ins.textContent) ins.remove();
      continue;
    }
    // Next to a deletion of ours: grow it instead of starting another.
    const prev = piece.previousSibling;
    const next = piece.nextSibling;
    if (prev instanceof HTMLElement && mine(prev, "del")) {
      prev.append(piece);
      if (!made.includes(prev)) made.push(prev);
      continue;
    }
    if (next instanceof HTMLElement && mine(next, "del")) {
      next.prepend(piece);
      if (!made.includes(next)) made.push(next);
      continue;
    }
    const del = mark("del", sid);
    piece.replaceWith(del);
    del.append(piece);
    made.push(del);
  }
  return made;
}

function placeCaret(node: Node, offset: number) {
  const sel = document.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Insert text as a suggestion at the caret, continuing the user's own insertion when the caret is in or right after one. */
export function suggestInsert(text: string, article: HTMLElement, sid?: string) {
  const sel = document.getSelection();
  if (!sel?.rangeCount) return;
  const r = sel.getRangeAt(0);
  let { startContainer: node, startOffset: offset } = r;
  // Never type inside a deletion: step out after it.
  const del = closestMark(node, "del", article);
  if (del) {
    node = del.parentNode!;
    offset = Array.prototype.indexOf.call(node.childNodes, del) + 1;
  }
  const ins = closestMark(node, "ins", article);
  if (ins && mine(ins, "ins")) {
    if (node.nodeType === Node.TEXT_NODE) {
      (node as Text).insertData(offset, text);
      placeCaret(node, offset + text.length);
    } else {
      const t = document.createTextNode(text);
      node.insertBefore(t, node.childNodes[offset] ?? null);
      placeCaret(t, text.length);
    }
    return;
  }
  // Right after one of ours (the caret sits just past its end): keep typing in it.
  const before = node.nodeType === Node.TEXT_NODE ? (offset === 0 ? node.previousSibling : null) : node.childNodes[offset - 1] ?? null;
  if (before instanceof HTMLElement && mine(before, "ins") && !sid) {
    const t = document.createTextNode(text);
    before.append(t);
    placeCaret(t, text.length);
    return;
  }
  const el = mark("ins", sid ?? SID());
  const t = document.createTextNode(text);
  el.append(t);
  if (node.nodeType === Node.TEXT_NODE) {
    const tail = (node as Text).splitText(offset);
    tail.parentNode!.insertBefore(el, tail);
  } else node.insertBefore(el, node.childNodes[offset] ?? null);
  // An empty block's placeholder <br> goes once there is text.
  const next = el.nextSibling;
  if (next instanceof HTMLBRElement && !next.nextSibling) next.remove();
  placeCaret(t, text.length);
}

/**
 * Handle one input in Suggesting mode. Returns true when it was handled
 * (and the browser's own change prevented).
 */
export function suggestInput(e: InputEvent, article: HTMLElement): boolean {
  const sel = document.getSelection();
  if (!sel?.rangeCount) return false;
  const t = e.inputType;
  if (t === "insertText" || t === "insertReplacementText" || t === "insertFromPaste" || t === "insertFromDrop") {
    const text = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
    if (!text) return false;
    e.preventDefault();
    const range = sel.getRangeAt(0);
    let sid: string | undefined;
    if (!range.collapsed) {
      sid = SID();
      const made = suggestDelete(range, article, sid);
      const last = made[made.length - 1];
      if (last) placeCaret(last.parentNode!, Array.prototype.indexOf.call(last.parentNode!.childNodes, last) + 1);
      else sel.collapseToEnd();
    }
    suggestInsert(text.replace(/\r?\n/g, " "), article, sid);
    return true;
  }
  if (t.startsWith("delete")) {
    const backward = t.includes("Backward");
    const unit = t.includes("Word") ? "word" : t.includes("Line") ? "lineboundary" : "character";
    let range = sel.getRangeAt(0);
    if (range.collapsed) {
      sel.modify("extend", backward ? "backward" : "forward", unit);
      range = sel.getRangeAt(0);
    }
    // Across blocks (joining two paragraphs) is a change of structure: let it happen.
    const startBlock = (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : (range.startContainer as Element))?.closest("[id]");
    const endBlock = (range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentElement : (range.endContainer as Element))?.closest("[id]");
    if (range.collapsed || startBlock !== endBlock) {
      if (!range.collapsed) sel.collapse(backward ? range.endContainer : range.startContainer, backward ? range.endOffset : range.startOffset);
      return false;
    }
    e.preventDefault();
    const made = suggestDelete(range.cloneRange(), article);
    // The caret goes to the near side of what was marked.
    const edge = backward ? made[0] : made[made.length - 1];
    if (edge?.isConnected) placeCaret(edge.parentNode!, Array.prototype.indexOf.call(edge.parentNode!.childNodes, edge) + (backward ? 0 : 1));
    else sel.collapseToStart();
    return true;
  }
  return false;
}
