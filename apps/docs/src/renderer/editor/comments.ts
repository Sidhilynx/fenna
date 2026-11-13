// Comments on a doc: the shell's comments store, anchored to a passage. A
// thread points at a block (by id) and the words it was left on (the quote),
// so it stays on them when the block around them changes; if the words go,
// it points at the whole block.

import { type DocAnchor, type ElementNode, docAnchor, textOf } from "@opendeck/doc";
import { type Thread, createCommentsStore } from "@opendeck/shell";
import { api } from "../api.ts";
import { getState, toast } from "../store.ts";
import { blockOf, blockText, offsetIn } from "./caret.ts";
import { pageEl, restoreSelection } from "./page.ts";

export type { DocAnchor } from "@opendeck/doc";
export type DocThread = Thread<DocAnchor>;

const blockIn = (tab: string, block: string): ElementNode | null => {
  const t = getState().doc?.tabs.get(tab)?.tab;
  return (t?.children.find((b) => b.type === "element" && b.attrs.id === block) as ElementNode | undefined) ?? null;
};
const clip = (t: string, max: number) => t.replace(/\s+/g, " ").trim().slice(0, max);

const store = createCommentsStore<DocAnchor>({
  read: (rel) => api().read(rel),
  write: (rel, text) => api().write(rel, text),
  onChanged: (fn) => api().onChanged(fn),
  anchor: docAnchor,
  note: "This message is a comment the user left on a passage of the doc (in `selected`). If it asks for a change, make it to that block with edit_blocks (or to what it plainly refers to). Your reply is shown in the comment thread: one or two short sentences. Don't post it with the comment tool too.",
  toast,
  context(thread) {
    const s = getState();
    const block = blockIn(thread.tab, thread.block);
    const tabRef = s.doc?.tabs.get(thread.tab);
    if (!s.doc || !tabRef?.tab) return null;
    return {
      tab: { id: thread.tab },
      selected: { block: thread.block, tag: block?.tag ?? null, quote: thread.quote, blockText: block ? clip(textOf(block), 600) : "(the block was deleted)" },
    };
  },
});

export const useComments = store.use;
export const getComments = store.get;
export const loadComments = store.load;
export const openThread = store.openThread;
export const setAskAssistant = store.setAskAssistant;
export const addComment = store.add;
export const resolveThread = store.resolve;
export const deleteThread = store.remove;

/** Start a comment on the selection (or on the block the caret is in). */
export function newComment(block?: string) {
  const s = getState();
  const page = pageEl();
  if (!s.tab || !page) return;
  if (block) return store.draft({ tab: s.tab, block, quote: "" });
  if (!restoreSelection()) return toast("Put the cursor in the text you want to comment on.");
  const sel = document.getSelection()!;
  const b = blockOf(page, sel.anchorNode);
  if (!b?.id) return;
  const r = sel.getRangeAt(0);
  // A selection across blocks comments on the first block's part of it.
  const end = b.contains(r.endContainer) ? offsetIn(b, r.endContainer, r.endOffset) : blockText(b).length;
  const start = offsetIn(b, r.startContainer, r.startOffset);
  const quote = r.collapsed ? "" : blockText(b).slice(start, end).replace(/￼/g, "").trim().slice(0, 400);
  store.draft({ tab: s.tab, block: b.id, quote });
}

/** Unresolved threads on a tab. */
export function threadsOn(tab: string): DocThread[] {
  return store.get().threads.filter((t) => t.tab === tab && !t.resolved);
}

/** Where a thread's words are on the page now: [start, end) in its block, or null for the whole block. */
export function quoteRange(block: HTMLElement, quote: string): [number, number] | null {
  if (!quote) return null;
  const text = blockText(block);
  const i = text.indexOf(quote);
  return i < 0 ? null : [i, i + quote.length];
}
