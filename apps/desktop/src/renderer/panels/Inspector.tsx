// The Design panel (inspector) for the slide and its elements.

import { getAt } from "@opendeck/format";
import { labelOf } from "../editor/selection.ts";
import { currentSlide, useEditor } from "../editor/store.ts";
import { ElementInspector } from "./inspector/ElementInspector.tsx";
import { MultiInspector } from "./inspector/MultiInspector.tsx";
import { SlideInspector } from "./inspector/SlideInspector.tsx";
import { ThemeSection } from "./inspector/ThemeSection.tsx";
import "./inspector.css";

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const slideItem = useEditor((s) => currentSlide(s));
  const deck = useEditor((s) => s.deck);
  const n = useEditor((s) => s.current + 1);

  if (!deck) return <aside className="right-panel" aria-label="Design" />;
  // No slide to design (an empty deck, or a file that cannot be read): the deck's theme still can be.
  if (!slideItem?.slide) {
    return (
      <aside className="right-panel" aria-label="Design">
        <div className="inspector">
          <div className="inspector-head">Deck</div>
          <ThemeSection />
        </div>
      </aside>
    );
  }

  const slide = slideItem.slide;
  let header = `Slide ${n}`;
  let content = <SlideInspector />;

  if (selection.length === 1) {
    const addr = selection[0]!;
    const el = getAt(slide, addr);
    if (el) {
      header = labelOf(el) || "Element";
      content = <ElementInspector element={el} address={addr} theme={deck.index.theme} />;
    }
  } else if (selection.length > 1) {
    header = `${selection.length} items`;
    content = <MultiInspector slide={slide} selection={selection} />;
  }

  return (
    <aside className="right-panel" aria-label="Design">
      <div className="inspector">
        <div className="inspector-head" title={header}>
          {header}
        </div>
        {content}
      </div>
    </aside>
  );
}
