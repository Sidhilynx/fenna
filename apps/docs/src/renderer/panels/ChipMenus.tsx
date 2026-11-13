// What opens when a chip on the page is clicked: a dropdown's options, or a
// date to pick.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Menu } from "@opendeck/shell";
import { setChipDate, setChipValue } from "../editor/commands.ts";
import { type ChipEvent, onChip } from "../editor/page.ts";
import { getState } from "../store.ts";

export function ChipMenus() {
  const [open, setOpen] = useState<ChipEvent | null>(null);
  useEffect(() => onChip(setOpen), []);
  if (!open) return null;
  if (open.kind === "date") return <DatePopover chip={open.el} onClose={() => setOpen(null)} />;
  const dd = getState().doc?.index.dropdowns.find((d) => d.id === open.el.dataset.dropdown);
  if (!dd) return null;
  return (
    <Menu
      anchor={open.el}
      label={dd.name}
      onClose={() => setOpen(null)}
      entries={[{ heading: dd.name }, ...dd.options.map((o) => ({ label: o.label, checked: o.id === open.el.dataset.value, icon: <span className="od-swatch" data-color={o.color} aria-hidden />, onSelect: () => setChipValue(open.el, dd, o.id) }))]}
    />
  );
}

function DatePopover({ chip, onClose }: { chip: HTMLElement; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [value, setValue] = useState(chip.getAttribute("datetime") ?? "");

  useLayoutEffect(() => {
    const r = chip.getBoundingClientRect();
    const w = ref.current?.offsetWidth ?? 220;
    setPos({ left: Math.max(8, Math.min(window.innerWidth - w - 8, r.left)), top: r.bottom + 4 });
  }, [chip]);

  // Focus once placed: the popover is hidden while it is measured, and a hidden field can't take focus.
  const placed = pos !== null;
  useEffect(() => {
    if (placed) ref.current?.querySelector("input")?.focus();
  }, [placed]);

  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener("mousedown", away, true);
    return () => window.removeEventListener("mousedown", away, true);
  }, [onClose]);

  const save = () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setChipDate(chip, value);
    onClose();
  };

  return (
    <div ref={ref} className="date-pop" role="dialog" aria-label="Date" style={pos ?? { visibility: "hidden" }} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <input id="chip-date" type="date" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      <button className="btn primary" onClick={save}>
        Set
      </button>
    </div>
  );
}
