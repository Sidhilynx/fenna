// A color: a swatch that opens the design's tweaks to pick from, and a field
// for a hex value or var(--tweak). The same popover serves the floating bar.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDesign } from "../store.ts";

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const VAR_RE = /^var\((--[a-z][a-z0-9-]*)\)$/;

/** What a person typed, as a value the format takes: "d97757" is "#d97757"; a tweak's bare name is var(--name). */
export function normalizeColor(raw: string, tweaks: Record<string, string>): string {
  const t = raw.trim();
  if (HEX_RE.test(`#${t}`)) return `#${t.toLowerCase()}`;
  if (HEX_RE.test(t)) return t.toLowerCase();
  const name = t.startsWith("--") ? t : `--${t}`;
  return name in tweaks ? `var(${name})` : t;
}

/** The color a value paints with, for a swatch: a tweak resolved, anything else as it is. */
export function paintOf(value: string, tweaks: Record<string, string>): string {
  const m = VAR_RE.exec(value.trim());
  return m ? (tweaks[m[1]!] ?? "transparent") : value;
}

/** `rgb(28, 27, 25)` as the browser reports it, written as #1c1b19. */
export function hexOf(css: string): string {
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(css.trim());
  if (!m) return css;
  if (m[4] !== undefined && Number(m[4]) === 0) return "";
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
}

export function ColorPopover({ anchor, value, allowNone, onPick, onClose }: { anchor: HTMLElement; value: string; allowNone?: boolean; onPick(v: string | null): void; onClose(): void }) {
  const tweaks = useDesign((s) => s.index.tweaks);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [text, setText] = useState(value);
  const colors = Object.entries(tweaks).filter(([, v]) => HEX_RE.test(v) || /^(rgb|hsl)/.test(v));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8));
    const below = r.bottom + 6;
    setPos({ left, top: below + el.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - el.offsetHeight - 6) : below });
    el.querySelector<HTMLElement>("input")?.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="pp-color-pop"
      role="dialog"
      aria-label="Color"
      style={pos ? pos : { left: 0, top: 0, visibility: "hidden" }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      {colors.length > 0 && (
        <>
          <div className="pp-pop-head">Tweaks</div>
          <div className="pp-pop-swatches">
            {colors.map(([name, v]) => (
              <button key={name} className="pp-pop-swatch" aria-pressed={value === `var(${name})`} title={`${name.slice(2)} · ${v}`} aria-label={name.slice(2)} onClick={() => onPick(`var(${name})`)}>
                <span className="pp-swatch" style={{ background: v }} />
              </button>
            ))}
          </div>
        </>
      )}
      <form
        className="pp-pop-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onPick(normalizeColor(text, tweaks));
        }}
      >
        <input className="pp-pop-input" value={text} placeholder="#hex" aria-label="Hex color" spellCheck={false} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn" disabled={!text.trim()}>
          Set
        </button>
      </form>
      {allowNone && (
        <button className="btn ghost pp-pop-none" onClick={() => onPick(null)}>
          No color
        </button>
      )}
    </div>,
    document.body,
  );
}

/** The panel's color row: swatch, then the value as text. `shown` is what is drawn when nothing is set (dimmed). */
export function ColorControl({ value, shown, label, allowNone, onCommit }: { value: string; shown?: string; label: string; allowNone?: boolean; onCommit(v: string | null): void }) {
  const tweaks = useDesign((s) => s.index.tweaks);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const swatch = useRef<HTMLButtonElement>(null);
  const display = value || shown || "";
  useEffect(() => setDraft(null), [value]);
  const paint = paintOf(display, tweaks);

  return (
    <div className={`pp-color${value ? "" : " dim"}`}>
      <button ref={swatch} className="pp-swatch-btn" aria-label={`${label}: choose`} aria-expanded={open} title="Choose a color" onClick={() => setOpen(!open)}>
        <span className={`pp-swatch${paint ? "" : " none"}`} style={paint ? { background: paint } : undefined} />
      </button>
      <input
        className="pp-color-input"
        value={draft ?? display}
        aria-label={label}
        placeholder={allowNone ? "none" : ""}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft.trim() !== value) onCommit(draft.trim() ? normalizeColor(draft, tweaks) : null);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(null);
            const el = e.currentTarget;
            window.setTimeout(() => el.blur());
          }
        }}
      />
      {open && swatch.current && (
        <ColorPopover
          anchor={swatch.current}
          value={display}
          allowNone={allowNone}
          onPick={(v) => {
            setOpen(false);
            onCommit(v);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
