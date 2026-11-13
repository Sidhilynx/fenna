import { useMemo, useState } from "react";
import { layouts, parseSlide, valueContext } from "@opendeck/format";
import { addSlide, useEditor } from "../editor/store.ts";
import { FitSlide } from "../SlideView.tsx";
import { Dialog } from "@opendeck/shell";

/** Pick a layout for a new slide; previews use this deck's own theme. */
export function NewSlideDialog({ onClose }: { onClose(): void }) {
  const index = useEditor((s) => s.deck?.index ?? null);
  const [active, setActive] = useState(0);
  const items = useMemo(() => {
    if (!index) return [];
    const ctx = valueContext(index);
    return layouts(index.theme).map((l) => ({ l, slide: parseSlide(l.html("preview"), ctx).slide! }));
  }, [index]);
  if (!index) return null;
  const pick = (key: string) => {
    onClose();
    void addSlide(key);
  };
  return (
    <Dialog title="New slide" onClose={onClose} width={720}>
      <div
        className="layout-grid"
        role="listbox"
        aria-label="Layouts"
        onKeyDown={(e) => {
          const cols = 3;
          const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
          if (d) {
            e.preventDefault();
            const n = Math.max(0, Math.min(items.length - 1, active + d));
            setActive(n);
            (e.currentTarget.children[n] as HTMLElement | undefined)?.focus();
          }
          // Enter and Space reach the focused button natively.
        }}
      >
        {items.map(({ l, slide }, i) => (
          <button key={l.key} className="layout-item" role="option" aria-selected={i === active} tabIndex={i === active ? 0 : -1} data-autofocus={i === 0 || undefined} onFocus={() => setActive(i)} onClick={() => pick(l.key)}>
            <span className="layout-thumb">
              <FitSlide slide={slide} theme={index.theme} />
            </span>
            <span className="layout-label">{l.label}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
