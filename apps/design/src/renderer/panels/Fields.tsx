// The properties panel's controls: a section that folds, a labelled row, and
// the fields in it. A field shows the value it was given; typing changes a
// draft, and Enter or leaving the field commits it (Esc puts it back).

import { type ReactNode, useEffect, useId, useState } from "react";
import { Icon, type IconName, readPref, writePref } from "@opendeck/shell";

export function Section({ title, id, open: startOpen = true, children }: { title: string; id: string; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(() => readPref(`design.section.${id}`, startOpen));
  const body = useId();
  return (
    <section className="pp-section">
      <button
        className="pp-section-head"
        aria-expanded={open}
        aria-controls={body}
        onClick={() => {
          writePref(`design.section.${id}`, !open);
          setOpen(!open);
        }}
      >
        <span>{title}</span>
        <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
      </button>
      {open && (
        <div className="pp-section-body" id={body}>
          {children}
        </div>
      )}
    </section>
  );
}

export function Row({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="pp-row">
      <span className="pp-label" title={title ?? label}>
        {label}
      </span>
      <div className="pp-control">{children}</div>
    </div>
  );
}

/** A draft of `value` that follows it until the field is being typed in. */
function useDraft(value: string, commit: (v: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  return {
    value: draft ?? value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onBlur: () => {
      if (draft !== null && draft !== value) commit(draft);
      setDraft(null);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      if (e.key === "Enter") e.currentTarget.blur();
      else if (e.key === "Escape") {
        setDraft(null);
        // Leave the field after the draft is dropped, so its blur commits nothing.
        const el = e.currentTarget;
        window.setTimeout(() => el.blur());
      }
    },
  };
}

export function TextField({ value, label, placeholder, dim, mono, icon, onCommit }: { value: string; label: string; placeholder?: string; dim?: boolean; mono?: boolean; icon?: IconName; onCommit(v: string): void }) {
  const draft = useDraft(value, (v) => onCommit(v.trim()));
  return (
    <label className={`pp-field${dim ? " dim" : ""}${mono ? " mono" : ""}`}>
      {icon && <Icon name={icon} size={14} />}
      <input {...draft} aria-label={label} placeholder={placeholder} spellCheck={false} />
    </label>
  );
}

/** A number with a unit. Arrow keys step it (Shift: by ten); emptying it commits null. */
export function NumberField({ value, label, unit = "px", min, max, step = 1, dim, onCommit }: { value: number | null; label: string; unit?: string; min?: number; max?: number; step?: number; dim?: boolean; onCommit(v: number | null): void }) {
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const shown = value === null ? "" : String(Math.round(value * 100) / 100);
  const draft = useDraft(shown, (v) => {
    const n = parseFloat(v);
    if (!v.trim()) onCommit(null);
    else if (Number.isFinite(n)) onCommit(clamp(n));
  });
  return (
    <label className={`pp-field num${dim ? " dim" : ""}`}>
      <input
        {...draft}
        aria-label={label}
        inputMode="decimal"
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            const base = parseFloat(draft.value);
            onCommit(clamp((Number.isFinite(base) ? base : 0) + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
          } else draft.onKeyDown(e);
        }}
      />
      {unit && <span className="pp-unit">{unit}</span>}
    </label>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function SelectField({ value, label, options, dim, onChange }: { value: string; label: string; options: readonly Option[]; dim?: boolean; onChange(v: string): void }) {
  const known = options.some((o) => o.value === value);
  return (
    <label className={`pp-field select${dim ? " dim" : ""}`}>
      <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()}>
        {!known && <option value={value}>{value || "—"}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={14} />
    </label>
  );
}

export interface SegOption {
  value: string;
  title: string;
  icon?: IconName;
  text?: string;
  /** Turn the icon by this many degrees (one arrow drawn four ways). */
  turn?: number;
}

/** Buttons for one choice of a few. `value` null: none is on. Pressing the one that is on calls `onChange(null)` when `clear`. */
export function Segmented({ value, label, options, clear, onChange }: { value: string | null; label: string; options: readonly SegOption[]; clear?: boolean; onChange(v: string | null): void }) {
  return (
    <div className="pp-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} className="pp-seg-btn" aria-pressed={o.value === value} aria-label={o.title} title={o.title} onClick={() => onChange(clear && o.value === value ? null : o.value)}>
          {o.icon ? <Icon name={o.icon} size={16} style={o.turn ? { transform: `rotate(${o.turn}deg)` } : undefined} /> : o.text}
        </button>
      ))}
    </div>
  );
}

export function IconToggle({ icon, title, on, onClick }: { icon: IconName; title: string; on: boolean; onClick(): void }) {
  return (
    <button className="icon-btn pp-toggle" aria-pressed={on} aria-label={title} title={title} onClick={onClick}>
      <Icon name={icon} size={16} />
    </button>
  );
}
