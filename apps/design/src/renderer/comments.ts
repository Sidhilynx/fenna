// Comments on the design: a thread points at an artboard, and maybe one
// layer of it. The layer's address and first words are kept, so the thread
// follows it when layers around it come and go.

import { anchorOf, getAt, snippetOf } from "@opendeck/format";
import { designAnchor, layerLabel, serializeBlock, type DesignAnchor, type ElementNode } from "@opendeck/artboard";
import { createCommentsStore, toast, type Thread } from "@opendeck/shell";
import { api } from "./api.ts";
import { getState } from "./store.ts";

export type DesignThread = Thread<DesignAnchor>;

/** Where a thread points now: its artboard's root and the layer's address ("" for the whole artboard), or null when the artboard is gone. */
export function threadTarget(t: DesignAnchor): { root: ElementNode; address: string } | null {
  const s = getState();
  const root = s.index && t.file in s.index.boards ? s.boards.get(t.file)?.doc?.root : null;
  if (!root) return null;
  return { root, address: t.addr || t.snippet ? anchorOf(root, t) : "" };
}

/** A line saying what a thread is on: "Main · Heading “Hello from a canvas”". */
export function threadQuote(t: DesignAnchor): string {
  const s = getState();
  const title = s.index?.boards[t.file]?.title;
  if (!title) return "A deleted artboard";
  const at = threadTarget(t);
  const el = at?.address ? (getAt(at.root, at.address) as ElementNode | null) : null;
  return el ? `${title} · ${layerLabel(el)}` : title;
}

export const comments = createCommentsStore<DesignAnchor>({
  read: (rel) => api().read(rel),
  write: (rel, text) => api().write(rel, text),
  onChanged: (fn) => api().onChanged(fn),
  anchor: designAnchor,
  context(thread) {
    const at = threadTarget(thread);
    if (!at) return null;
    const el = at.address ? (getAt(at.root, at.address) as ElementNode | null) : null;
    return { file: thread.file, artboard: getState().index?.boards[thread.file]?.title, ...(el ? { layer: layerLabel(el), html: serializeBlock(el).slice(0, 2000) } : {}) };
  },
  reanchor(thread) {
    const at = threadTarget(thread);
    const el = at?.address ? getAt(at.root, at.address) : null;
    return el && at ? { file: thread.file, addr: at.address, snippet: snippetOf(el) } : { file: thread.file, addr: thread.addr, snippet: thread.snippet };
  },
  note: "This comment is on an artboard of the Fenna Design file open on the user's screen (or on one layer of it; the context gives the file and the layer's HTML). Read the artboard with read_artboards, make the change it asks for with edit_artboard, then reply in the thread with comment, saying what you changed in one sentence.",
  toast,
});
