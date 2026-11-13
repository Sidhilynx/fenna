import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type ElementNode, notesOf, setNotes } from "@opendeck/format";
import { currentSlide, editSlide } from "../editor/store.ts";

/** Speaker notes, right under the slide on the stage. Saved when you pause or leave the field. */
export function SlideNotes({ slide, slideId, width }: { slide: ElementNode; slideId: string; width: number }) {
  const saved = notesOf(slide);
  const [text, setText] = useState(saved);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  // A different slide, or notes changed elsewhere (the AI): show them unless you're mid-edit.
  useEffect(() => {
    if (!dirty.current) setText(saved);
  }, [saved, slideId]);

  // Grow with the text up to the CSS max-height, then scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, width]);

  const save = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    // Never write one slide's notes into another, if the slide changed under a pending save.
    if (currentSlide()?.id !== slideId) return;
    if (value.trimEnd() !== saved) void editSlide("Edit notes", (s, ctx) => setNotes(s, value, ctx));
  };

  return (
    <textarea
      ref={ref}
      className="slide-notes"
      style={{ width }}
      rows={1}
      aria-label="Speaker notes"
      placeholder="Click to add speaker notes"
      value={text}
      maxLength={8000}
      onChange={(e) => {
        setText(e.target.value);
        dirty.current = true;
        if (timer.current) clearTimeout(timer.current);
        const v = e.target.value;
        timer.current = setTimeout(() => save(v), 800);
      }}
      onBlur={() => dirty.current && save(text)}
      onKeyDown={(e) => {
        if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
      }}
    />
  );
}
