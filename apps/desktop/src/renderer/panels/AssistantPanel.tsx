// Fenna Slides' chat column: the shell's ChatPanel, told what a deck is and
// what the user is looking at (slide, selection) so "this" means what's on
// their screen.

import { getAt, wordsOf } from "@opendeck/format";
import { type ChatView, ChatPanel } from "@opendeck/shell";
import { useCallback } from "react";
import { kindOf } from "../editor/selection.ts";
import { currentSlide, getState, setAgent, setState, useEditor } from "../editor/store.ts";

const SUGGESTIONS = ["Make a 6-slide deck about our Q3 results", "Tighten the wording on this slide", "Turn this list into a table", "Give every slide a consistent title style"];
const clip = (t: string, max: number) => t.replace(/\s+/g, " ").trim().slice(0, max);

/** What the AI is told the user is looking at, and the same in a few words. */
function deckView(): ChatView | null {
  const s = getState();
  const cur = currentSlide(s);
  if (!s.deck || !cur) return null;
  const slide = cur.slide;
  const n = s.current + 1;
  const selected = slide
    ? s.selection.map((a) => {
        const el = getAt(slide, a);
        return { kind: kindOf(el), id: el?.attrs.id, tag: el?.tag, text: el ? clip(wordsOf(el), 120) : "" };
      })
    : [];
  const one = selected[0];
  const label = !selected.length
    ? `Slide ${n}`
    : selected.length === 1 && one
      ? `Slide ${n} · ${one.kind}${one.text ? ` “${one.text.slice(0, 28)}${one.text.length > 28 ? "…" : ""}”` : ""}`
      : `Slide ${n} · ${selected.length} items`;
  return { context: { slide: { n, id: cur.id, firstWords: slide ? clip(wordsOf(slide), 80) : "" }, slideCount: s.deck.slides.length, selected }, label };
}

export function AssistantPanel() {
  const draft = useEditor((s) => s.chatDraft);
  // Re-render when what the user is looking at changes.
  useEditor((s) => `${s.current}|${s.selection.join(",")}|${currentSlide(s)?.source.length ?? 0}`);
  const taken = useCallback(() => setState({ chatDraft: "" }), []);
  return (
    <ChatPanel
      noun="deck"
      view={deckView()}
      suggestions={SUGGESTIONS}
      intro="Ask for a new deck, or for changes to what you’ve selected."
      placeholder="Ask for an edit, or describe what to make"
      draft={draft}
      onDraftTaken={taken}
      onWorking={setAgent}
    />
  );
}
