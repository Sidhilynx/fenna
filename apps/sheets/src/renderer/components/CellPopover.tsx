// What opens from a cell: a dropdown's choices, the person picker, the date
// picker, and a filtered column's choices.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { colToLetter, formatCellRef, formatCellValue, parseRangeRef, serialOf, serialToDate } from "@opendeck/sheet";
import { Icon, Menu, type MenuEntry } from "@opendeck/shell";
import { addPersonDef, currentSheet, dropdownOf, getState, setCellType, setColumnFilter, setState, sortActiveSheet, useSheets } from "../store.ts";

export interface CellPopoverAt {
  r: number;
  c: number;
  kind: "dropdown" | "person" | "date" | "filter";
  anchor: HTMLElement;
}

const plain = { t: undefined, dropdownId: undefined, person: undefined } as const;

export function CellPopover({ at, onClose }: { at: CellPopoverAt; onClose(): void }) {
  const sheet = useSheets((s) => currentSheet(s));
  const people = useSheets((s) => s.workbook?.index.people ?? []);
  if (!sheet) return null;
  const cell = sheet.cells[formatCellRef(at.r, at.c)];
  const where = { r: at.r, c: at.c };

  if (at.kind === "dropdown") {
    const dd = dropdownOf(cell?.dropdownId);
    const entries: MenuEntry[] = [
      ...(dd ? [{ heading: dd.name }] : []),
      ...(dd?.options ?? []).map((o) => ({
        label: o.label,
        icon: <span className={`opt-dot opt-${o.color}`} aria-hidden />,
        checked: cell?.v === o.label || cell?.v === o.id,
        onSelect: () => void setCellType({ v: o.label }, where),
      })),
      "separator",
      { label: "Clear", disabled: !cell?.v, onSelect: () => void setCellType({ v: undefined }, where) },
      { label: "New dropdown…", icon: <Icon name="plus" size={16} />, onSelect: () => setState({ dialog: "newDropdown" }) },
      { label: "Remove dropdown", icon: <Icon name="eraser" size={16} />, onSelect: () => void setCellType({ ...plain }, where) },
    ];
    return <Menu anchor={at.anchor} entries={entries} label="Choices" onClose={onClose} />;
  }

  if (at.kind === "person") {
    const cur = cell?.person?.name;
    const entries: MenuEntry[] = [
      ...(people.length ? [] : [{ note: "Type a name to add someone." } as const]),
      ...people.map((p) => ({
        label: p.name,
        hint: p.email,
        icon: <span className="c-avatar menu-avatar">{p.name.slice(0, 1).toUpperCase()}</span>,
        checked: cur === p.name,
        onSelect: () => void setCellType({ t: "person", person: p, v: p.name }, where),
      })),
      ...(cur ? ["separator" as const, { label: "Clear", onSelect: () => void setCellType({ t: "person", person: undefined, v: undefined }, where) }] : []),
      "separator",
      { label: "Remove person", icon: <Icon name="eraser" size={16} />, onSelect: () => void setCellType({ ...plain }, where) },
    ];
    return (
      <Menu
        anchor={at.anchor}
        entries={entries}
        label="People"
        onClose={onClose}
        prompt={{
          placeholder: "Find or add a person",
          filter: true,
          onSubmit: (name) => {
            const p = { name: name.trim().slice(0, 120) };
            void addPersonDef(p).then(() => setCellType({ t: "person", person: p, v: p.name }, where));
          },
        }}
      />
    );
  }

  if (at.kind === "date") return <DatePop at={at} onClose={onClose} />;
  return <FilterPop at={at} onClose={onClose} />;
}

/** A card hung under a cell's chip or filter button. */
function usePlaced(anchor: HTMLElement, onClose: () => void) {
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    setPos({ left: Math.max(8, Math.min(window.innerWidth - w - 8, r.left)), top });
  }, [anchor]);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!card.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", away, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  return { card, style: pos ?? { visibility: "hidden" as const, left: 0, top: 0 }, placed: !!pos };
}

function DatePop({ at, onClose }: { at: CellPopoverAt; onClose(): void }) {
  const sheet = currentSheet();
  const cell = sheet?.cells[formatCellRef(at.r, at.c)];
  const d = typeof cell?.v === "number" ? serialToDate(cell.v) : null;
  const iso = d ? d.toISOString().slice(0, 10) : "";
  const [value, setValue] = useState(iso);
  const { card, style, placed } = usePlaced(at.anchor, onClose);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (placed) input.current?.focus();
  }, [placed]);
  const save = (v: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    void setCellType({ t: "date", v: m ? serialOf(Number(m[1]), Number(m[2]), Number(m[3])) : undefined }, { r: at.r, c: at.c });
    onClose();
  };
  const now = new Date();
  return createPortal(
    <div
      ref={card}
      className="pop-card date-pop"
      role="dialog"
      aria-label="Date"
      style={style}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
        if (e.key === "Enter") save(value);
      }}
    >
      <input ref={input} type="date" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Date" />
      <div className="pop-actions">
        <button className="btn ghost" onClick={() => save(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`)}>
          Today
        </button>
        <button className="btn ghost" onClick={() => save("")} disabled={!iso}>
          Clear
        </button>
        <span className="pop-fill" />
        <button className="btn primary" onClick={() => save(value)}>
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}

function FilterPop({ at, onClose }: { at: CellPopoverAt; onClose(): void }) {
  const sheet = currentSheet()!;
  const wb = getState().workbook!;
  const values = getState().evaluated.get(sheet.id);
  const range = sheet.filter ? parseRangeRef(sheet.filter.range) : null;
  const all = useMemo(() => {
    const set = new Set<string>();
    if (range) for (let r = range.r1 + 1; r <= range.r2; r++) {
      const ref = formatCellRef(r, at.c);
      set.add(formatCellValue(values?.get(ref) ?? sheet.cells[ref]?.v ?? null, sheet.cells[ref], wb.index));
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, []);
  const current = sheet.filter?.columnFilters[String(at.c)];
  const [shown, setShown] = useState(() => new Set(current ?? all));
  const [query, setQuery] = useState("");
  const { card, style, placed } = usePlaced(at.anchor, onClose);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (placed) search.current?.focus();
  }, [placed]);
  const visible = all.filter((v) => v.toLowerCase().includes(query.trim().toLowerCase()));
  const apply = () => {
    void setColumnFilter(at.c, shown.size === all.length ? null : [...shown]);
    onClose();
  };
  return createPortal(
    <div
      ref={card}
      className="pop-card filter-pop"
      role="dialog"
      aria-label={`Filter column ${colToLetter(at.c)}`}
      style={style}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="pop-sorts">
        <button className="menu-item" onClick={() => (onClose(), void sortActiveSheet(at.c, true, sheet.filter?.range))}>
          <Icon name="sortAsc" size={16} /> Sort A to Z
        </button>
        <button className="menu-item" onClick={() => (onClose(), void sortActiveSheet(at.c, false, sheet.filter?.range))}>
          <Icon name="sortDesc" size={16} /> Sort Z to A
        </button>
      </div>
      <div className="menu-sep" />
      <input ref={search} className="pop-search" placeholder="Search values" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search values" />
      <div className="pop-links">
        <button className="link-btn" onClick={() => setShown(new Set(all))}>
          Select all
        </button>
        <button className="link-btn" onClick={() => setShown(new Set())}>
          Clear
        </button>
        <span className="pop-count">
          {shown.size} of {all.length}
        </span>
      </div>
      <div className="pop-list" role="group" aria-label="Values to show">
        {visible.map((v) => (
          <label key={v} className="pop-check">
            <input
              type="checkbox"
              checked={shown.has(v)}
              onChange={(e) =>
                setShown((cur) => {
                  const next = new Set(cur);
                  if (e.target.checked) next.add(v);
                  else next.delete(v);
                  return next;
                })
              }
            />
            <span>{v || "(Blanks)"}</span>
          </label>
        ))}
        {!visible.length && <div className="pop-empty">No values match.</div>}
      </div>
      <div className="pop-actions">
        <span className="pop-fill" />
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!shown.size} onClick={apply}>
          OK
        </button>
      </div>
    </div>,
    document.body,
  );
}
