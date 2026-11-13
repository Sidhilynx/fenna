// Comments on slide elements: the shell's comments store, anchored to slide
// elements. A comment sent to the assistant runs with that element as the
// selection; the run's reply is added to the thread, and its edits land on
// the slide as usual.

import { getAt, wordsOf } from "@opendeck/format";
import { createCommentsStore } from "@opendeck/shell";
import { api } from "../api.ts";
import { kindOf } from "./selection.ts";
import { getState as editorState, toast } from "./store.ts";
import { type SlideAnchor, type Thread, anchorOf, slideAnchor, snippetOf } from "./threads.ts";

export type Draft = SlideAnchor;

const slideOf = (id: string) => editorState().deck?.slides.find((x) => x.id === id)?.slide ?? null;
const clip = (t: string, max: number) => t.replace(/\s+/g, " ").trim().slice(0, max);

const store = createCommentsStore<SlideAnchor>({
  read: (rel) => api().read(rel),
  write: (rel, text) => api().write(rel, text),
  onChanged: (fn) => api().onChanged(fn),
  anchor: slideAnchor,
  note: "This message is a comment the user left on the selected element. If it asks for a change, make it to that element with edit_slide (or to what it plainly refers to). Your reply is shown in the comment thread: one or two short sentences. Don't post it with the comment tool too.",
  toast,
  context(thread) {
    const s = editorState();
    const n = s.deck?.slides.findIndex((x) => x.id === thread.slide) ?? -1;
    const slide = n >= 0 ? s.deck!.slides[n]!.slide : null;
    if (!slide) return null;
    const addr = anchorOf(slide, thread);
    const el = getAt(slide, addr);
    return {
      slide: { n: n + 1, id: thread.slide, firstWords: clip(wordsOf(slide), 80) },
      slideCount: s.deck!.slides.length,
      selected: addr && el ? [{ kind: kindOf(el), id: el.attrs.id, tag: el.tag, text: clip(wordsOf(el), 120) }] : [],
    };
  },
  // The assistant often rewrote the element's text: anchor to what it says now.
  reanchor(t) {
    const slide = slideOf(t.slide);
    const addr = slide ? anchorOf(slide, t) : t.addr;
    const el = slide && addr ? getAt(slide, addr) : null;
    return { slide: t.slide, addr, snippet: el ? snippetOf(el) : t.snippet };
  },
});

export const getComments = store.get;
export const useComments = store.use;
export const loadComments = store.load;
export const openThread = store.openThread;
export const setAskAssistant = store.setAskAssistant;
export const addComment = store.add;
export const resolveThread = store.resolve;
export const deleteThread = store.remove;

/** Open the comment box on the selected element (or the slide, if nothing is selected). */
export function newComment() {
  const s = editorState();
  const cur = s.deck?.slides[s.current];
  if (!cur?.slide || s.view !== "edit") return;
  const addr = s.selection.length === 1 ? s.selection[0]! : "";
  const el = addr ? getAt(cur.slide, addr) : null;
  store.draft({ slide: cur.id, addr, snippet: el ? snippetOf(el) : "" });
}

/** Unresolved threads on a slide, each with where it points now. */
export function threadsOn(slideId: string): { thread: Thread; anchor: string }[] {
  const slide = slideOf(slideId);
  if (!slide) return [];
  return store
    .get()
    .threads.filter((t) => t.slide === slideId && !t.resolved)
    .map((thread) => ({ thread, anchor: anchorOf(slide, thread) }));
}
