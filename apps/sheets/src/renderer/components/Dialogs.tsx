// The few dialogs: locale, time zone, custom number format, custom sort,
// resize, and a new dropdown.

import { useEffect, useMemo, useState } from "react";
import { colToLetter, formatCellRef, formatCellValue, formatPattern, LIMITS, listTimeZones, LOCALES, parseRangeRef, systemSettings } from "@opendeck/sheet";
import { Dialog, Icon, MenuButton } from "@opendeck/shell";
import {
  activeCellRef,
  createDropdownDef,
  currentSheet,
  getState,
  resizeTo,
  selectionBounds,
  setCellType,
  setLocale,
  setState,
  setTimeZone,
  sortActiveSheet,
  styleSelection,
  tableAround,
  useSheets,
} from "../store.ts";

export function SheetDialogs() {
  const dialog = useSheets((s) => s.dialog);
  const close = () => {
    setState({ dialog: null });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".grid-host")?.focus());
  };
  if (dialog === "locale") return <LocaleDialog onClose={close} />;
  if (dialog === "timezone") return <TimeZoneDialog onClose={close} />;
  if (dialog === "customFormat") return <CustomFormatDialog onClose={close} />;
  if (dialog === "customSort") return <CustomSortDialog onClose={close} />;
  if (dialog === "resizeCol") return <ResizeDialog kind="col" onClose={close} />;
  if (dialog === "resizeRow") return <ResizeDialog kind="row" onClose={close} />;
  if (dialog === "newDropdown") return <NewDropdownDialog onClose={close} />;
  return null;
}

function Actions({ onClose, label, disabled }: { onClose(): void; label: string; disabled?: boolean }) {
  return (
    <div className="dlg-actions">
      <button type="button" className="btn ghost" onClick={onClose}>
        Cancel
      </button>
      <button type="submit" className="btn primary" disabled={disabled}>
        {label}
      </button>
    </div>
  );
}

/** A searchable list of choices with the chosen one checked; Enter applies. */
function Choices<T extends { id: string; label: string }>({ groups, value, onChange, onApply }: { groups: { heading?: string; items: T[] }[]; value: string; onChange(id: string): void; onApply(): void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  useEffect(() => {
    document.querySelector(".dlg-opt.on")?.scrollIntoView({ block: "center" });
  }, []);
  const shown = groups.map((g) => ({ ...g, items: g.items.filter((i) => !q || i.label.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)) })).filter((g) => g.items.length);
  const flat = shown.flatMap((g) => g.items);
  return (
    <>
      <input
        className="dlg-search"
        data-autofocus
        placeholder="Search"
        value={query}
        aria-label="Search"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          const i = flat.findIndex((x) => x.id === value);
          const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
          if (next) {
            onChange(next.id);
            requestAnimationFrame(() => document.querySelector(".dlg-opt.on")?.scrollIntoView({ block: "nearest" }));
          }
        }}
      />
      <div className="dlg-list" role="listbox" aria-label="Choices">
        {shown.map((g, gi) => (
          <div key={gi}>
            {g.heading && <div className="dlg-group">{g.heading}</div>}
            {g.items.map((i) => (
              <div key={i.id} role="option" aria-selected={i.id === value} className={`dlg-opt${i.id === value ? " on" : ""}`} onClick={() => onChange(i.id)} onDoubleClick={onApply}>
                <span>{i.label}</span>
                {i.id === value && <Icon name="check" size={16} />}
              </div>
            ))}
          </div>
        ))}
        {!flat.length && <div className="dlg-none">Nothing matches.</div>}
      </div>
    </>
  );
}

function LocaleDialog({ onClose }: { onClose(): void }) {
  const current = useSheets((s) => s.workbook?.index.locale ?? "en-US");
  const [value, setValue] = useState(current);
  const apply = () => {
    if (value !== current) void setLocale(value);
    onClose();
  };
  return (
    <Dialog title="Locale" onClose={onClose} width={420}>
      <form
        className="dlg-form"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <p className="dlg-note">How numbers, money and dates look, and how typed dates are read (3/4 is March 4th or April 3rd).</p>
        <Choices groups={[{ items: [...LOCALES] }]} value={value} onChange={setValue} onApply={apply} />
        <Actions onClose={onClose} label="Apply" />
      </form>
    </Dialog>
  );
}

function TimeZoneDialog({ onClose }: { onClose(): void }) {
  const current = useSheets((s) => s.workbook?.index.timeZone ?? "UTC");
  const [value, setValue] = useState(current);
  const groups = useMemo(() => {
    const all = listTimeZones();
    const mine = systemSettings().timeZone;
    const yours = all.filter((z) => z.id === mine);
    return [
      ...(yours.length ? [{ heading: "Your time zone", items: yours }] : []),
      { heading: yours.length ? "Other time zones" : undefined, items: all.filter((z) => z.id !== mine) },
    ];
  }, []);
  const apply = () => {
    if (value !== current) void setTimeZone(value);
    onClose();
  };
  return (
    <Dialog title="Time zone" onClose={onClose} width={440}>
      <form
        className="dlg-form"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <p className="dlg-note">The current date and time (NOW and TODAY) use this time zone for everyone who opens this sheet.</p>
        <Choices groups={groups} value={value} onChange={setValue} onApply={apply} />
        <Actions onClose={onClose} label="Apply" />
      </form>
    </Dialog>
  );
}

const PATTERNS = ["#,##0.00", "#,##0", "0.0%", "$#,##0;($#,##0)", "yyyy-mm-dd", "mmm d, yyyy", "h:mm AM/PM", "0.00E+00"];

function CustomFormatDialog({ onClose }: { onClose(): void }) {
  const cell = currentSheet()?.cells[activeCellRef()];
  const [pattern, setPattern] = useState(cell?.s?.customFmt ?? "#,##0.00");
  const wb = getState().workbook;
  const sample = typeof (getState().evaluated.get(currentSheet()?.id ?? "")?.get(activeCellRef()) ?? cell?.v) === "number" ? Number(getState().evaluated.get(currentSheet()!.id)?.get(activeCellRef()) ?? cell?.v) : 1234.5;
  const preview = pattern.trim() ? formatPattern(sample, pattern, wb?.index.locale) : "";
  return (
    <Dialog title="Custom format" onClose={onClose} width={400}>
      <form
        className="dlg-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pattern.trim()) return;
          void styleSelection({ numFmt: "custom", customFmt: pattern.trim() });
          onClose();
        }}
      >
        <label htmlFor="cf">Pattern</label>
        <input id="cf" data-autofocus value={pattern} maxLength={100} spellCheck={false} onChange={(e) => setPattern(e.target.value)} />
        <p className="dlg-preview">
          <span className="dlg-note">Shows</span> {preview || "—"}
        </p>
        <div className="dlg-chips">
          {PATTERNS.map((p) => (
            <button key={p} type="button" className={`btn ghost dlg-chip${p === pattern ? " on" : ""}`} onClick={() => setPattern(p)}>
              {p}
            </button>
          ))}
        </div>
        <Actions onClose={onClose} label="Apply" disabled={!pattern.trim()} />
      </form>
    </Dialog>
  );
}

function CustomSortDialog({ onClose }: { onClose(): void }) {
  const sheet = currentSheet();
  const wb = getState().workbook;
  const [range, setRange] = useState(() => (sheet ? (tableAround(sheet) ?? "") : ""));
  const r = parseRangeRef(range.replace(/\s+/g, ""));
  const [col, setCol] = useState(() => Math.max(r?.c1 ?? 0, Math.min(r?.c2 ?? 0, selectionBounds().c1)));
  const [desc, setDesc] = useState(false);
  const [header, setHeader] = useState(true);
  if (!sheet || !wb) return null;
  const name = (c: number) => {
    if (!header || !r) return `Column ${colToLetter(c)}`;
    const ref = formatCellRef(r.r1, c);
    const text = formatCellValue(getState().evaluated.get(sheet.id)?.get(ref) ?? sheet.cells[ref]?.v ?? null, sheet.cells[ref], wb.index);
    return text ? `${text} (${colToLetter(c)})` : `Column ${colToLetter(c)}`;
  };
  const cols = r ? Array.from({ length: Math.min(r.c2 - r.c1 + 1, 200) }, (_, i) => r.c1 + i) : [];
  return (
    <Dialog title="Custom sort" onClose={onClose} width={400}>
      <form
        className="dlg-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!r) return;
          void sortActiveSheet(col, !desc, range.replace(/\s+/g, "").toUpperCase(), header);
          onClose();
        }}
      >
        <label htmlFor="sort-range">Range</label>
        <input id="sort-range" data-autofocus value={range} spellCheck={false} aria-invalid={!r} onChange={(e) => setRange(e.target.value)} placeholder="A1:F40" />
        <label className="dlg-check">
          <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> The first row is a header
        </label>
        <span className="dlg-label">Sort by</span>
        <div className="dlg-row">
          <MenuButton className="btn dlg-select" label="Sort by column" entries={() => cols.map((c) => ({ label: name(c), checked: c === col, onSelect: () => setCol(c) }))}>
            <span>{r && col >= r.c1 && col <= r.c2 ? name(col) : "Choose a column"}</span>
            <Icon name="chevronDown" size={14} />
          </MenuButton>
          <div className="dlg-seg" role="radiogroup" aria-label="Order">
            <button type="button" role="radio" aria-checked={!desc} className={!desc ? "on" : ""} onClick={() => setDesc(false)}>
              A → Z
            </button>
            <button type="button" role="radio" aria-checked={desc} className={desc ? "on" : ""} onClick={() => setDesc(true)}>
              Z → A
            </button>
          </div>
        </div>
        <Actions onClose={onClose} label="Sort" disabled={!r || col < r.c1 || col > r.c2} />
      </form>
    </Dialog>
  );
}

function ResizeDialog({ kind, onClose }: { kind: "col" | "row"; onClose(): void }) {
  const sheet = currentSheet();
  const b = selectionBounds();
  const first = kind === "col" ? b.c1 : b.r1;
  const last = kind === "col" ? b.c2 : b.r2;
  const cur = kind === "col" ? (sheet?.colWidths[first] ?? LIMITS.defaultColWidth) : (sheet?.rowHeights[first] ?? LIMITS.defaultRowHeight);
  const [value, setValue] = useState(String(cur));
  const n = Number(value);
  const [min, max] = kind === "col" ? [30, 800] : [18, 400];
  const ok = Number.isFinite(n) && n >= min && n <= max;
  const what = kind === "col" ? (first === last ? `column ${colToLetter(first)}` : `columns ${colToLetter(first)}–${colToLetter(last)}`) : first === last ? `row ${first + 1}` : `rows ${first + 1}–${last + 1}`;
  return (
    <Dialog title={`Resize ${what}`} onClose={onClose} width={340}>
      <form
        className="dlg-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          void resizeTo(kind, first, n);
          onClose();
        }}
      >
        <label htmlFor="rs">{kind === "col" ? "Width" : "Height"} in pixels</label>
        <input id="rs" type="number" min={min} max={max} data-autofocus value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!ok} />
        {!ok && (
          <span className="dlg-error">
            From {min} to {max}.
          </span>
        )}
        <Actions onClose={onClose} label="Resize" disabled={!ok} />
      </form>
    </Dialog>
  );
}

function NewDropdownDialog({ onClose }: { onClose(): void }) {
  const [name, setName] = useState("");
  const [options, setOptions] = useState("");
  const lines = options
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const ok = !!name.trim() && lines.length > 0 && lines.length <= LIMITS.dropdownOptions;
  return (
    <Dialog title="New dropdown" onClose={onClose} width={380}>
      <form
        className="dlg-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          onClose();
          void createDropdownDef(name, lines).then((dd) => dd && setCellType({ t: "dropdown", dropdownId: dd.id }));
        }}
      >
        <label htmlFor="dd-name">Name</label>
        <input id="dd-name" data-autofocus placeholder="Stage" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="dd-options">Choices, one per line</label>
        <textarea id="dd-options" rows={5} placeholder={"Lead\nQualified\nWon\nLost"} value={options} onChange={(e) => setOptions(e.target.value)} />
        {lines.length > LIMITS.dropdownOptions && <span className="dlg-error">At most {LIMITS.dropdownOptions} choices.</span>}
        <Actions onClose={onClose} label="Add to selection" disabled={!ok} />
      </form>
    </Dialog>
  );
}
