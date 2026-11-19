// A date and time picker drawn in Crew's pixel style, in place of the
// system's datetime-local popup. The value is a datetime-local string
// ("2026-11-20T09:00", or "" for none). The calendar opens in a layer on the
// page, so a small window doesn't cut it off.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { PixelIcon } from "./PixelIcon.tsx";
import { addMonths, dayStart, localInputValue, monthGrid, nextQuarter, parseLocalInput } from "./clockModel.ts";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const GAP = 6;
const pad = (n: number) => String(n).padStart(2, "0");
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Fri 20 Nov 2026, 09:00": the picked time on the field. */
function fieldText(d: Date): string {
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" })}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Spin({ label, value, max, step, onChange }: { label: string; value: number; max: number; step: number; onChange(v: number): void }) {
  const by = (n: number) => onChange((((value + n) % (max + 1)) + max + 1) % (max + 1));
  const onKey = (e: KeyboardEvent) => {
    const moves: Record<string, () => void> = {
      ArrowUp: () => by(step),
      ArrowDown: () => by(-step),
      PageUp: () => by(step * 3),
      PageDown: () => by(-step * 3),
      Home: () => onChange(0),
      End: () => onChange(max - (max % step)),
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    move();
  };
  return (
    <div className="pdt-spin">
      <button type="button" className="pdt-arrow up" tabIndex={-1} aria-hidden onClick={() => by(step)}>
        <PixelIcon name="chevron-down" size={12} />
      </button>
      <div className="pdt-spin-value" role="spinbutton" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={pad(value)} onKeyDown={onKey}>
        {pad(value)}
      </div>
      <button type="button" className="pdt-arrow" tabIndex={-1} aria-hidden onClick={() => by(-step)}>
        <PixelIcon name="chevron-down" size={12} />
      </button>
    </div>
  );
}

export function PixelDateTime({ value, min, onChange, label }: { value: string; min: Date; onChange(value: string): void; label: string }) {
  const picked = parseLocalInput(value);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => dayStart(picked ?? min));
  const [focusDay, setFocusDay] = useState<Date>(() => dayStart(picked ?? min));
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  const minDay = dayStart(min);
  const base = picked ?? nextQuarter(min);

  const show = () => {
    const start = dayStart(picked ?? min);
    setMonth(start);
    setFocusDay(start);
    setPos(null);
    setOpen(true);
    moveFocus.current = true;
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  /** Sets the value, keeping it after `min`: a day earlier than now's time gets the next quarter hour. */
  const commit = (d: Date) => {
    onChange(localInputValue(d.getTime() <= min.getTime() ? nextQuarter(min) : d));
  };

  const pickDay = (day: Date) => {
    if (day < minDay) return;
    setFocusDay(day);
    if (day.getMonth() !== month.getMonth()) setMonth(day);
    commit(new Date(day.getFullYear(), day.getMonth(), day.getDate(), base.getHours(), base.getMinutes()));
  };

  const setTime = (h: number, m: number) => {
    const day = picked ? dayStart(picked) : dayStart(base);
    commit(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m));
  };

  // Place the layer under the field, or above it when there is no room below.
  useLayoutEffect(() => {
    if (!open || !trigger.current || !pop.current) return;
    const r = trigger.current.getBoundingClientRect();
    const w = pop.current.offsetWidth;
    const h = pop.current.offsetHeight;
    const below = r.bottom + GAP + h <= window.innerHeight - GAP;
    const top = below ? r.bottom + GAP : Math.max(GAP, r.top - GAP - h);
    const left = Math.max(GAP, Math.min(r.left, window.innerWidth - w - GAP));
    setPos({ left, top });
  }, [open]);

  // Keyboard focus follows the focused day when the layer opens and when arrows move it.
  useEffect(() => {
    if (!open || !pos || !moveFocus.current) return;
    moveFocus.current = false;
    grid.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  }, [open, pos, focusDay]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !trigger.current?.contains(t)) close(false);
    };
    const gone = () => close(false);
    window.addEventListener("mousedown", away, true);
    window.addEventListener("resize", gone);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("resize", gone);
    };
  }, [open]);

  const onGridKey = (e: KeyboardEvent) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: Date | null = null;
    if (e.key in steps) next = new Date(focusDay.getFullYear(), focusDay.getMonth(), focusDay.getDate() + steps[e.key]!);
    else if (e.key === "PageUp" || e.key === "PageDown") next = addMonths(focusDay, e.key === "PageUp" ? -1 : 1);
    else if (e.key === "Home") next = new Date(focusDay.getFullYear(), focusDay.getMonth(), focusDay.getDate() - ((focusDay.getDay() + 6) % 7));
    else if (e.key === "End") next = new Date(focusDay.getFullYear(), focusDay.getMonth(), focusDay.getDate() + (6 - ((focusDay.getDay() + 6) % 7)));
    if (!next) return;
    e.preventDefault();
    if (next < minDay) next = minDay;
    moveFocus.current = true;
    setFocusDay(next);
    if (next.getMonth() !== month.getMonth() || next.getFullYear() !== month.getFullYear()) setMonth(next);
  };

  const days = monthGrid(month.getFullYear(), month.getMonth());
  const canBack = new Date(month.getFullYear(), month.getMonth(), 1) > minDay;
  const title = month.toLocaleDateString([], { month: "long", year: "numeric" });
  const today = dayStart(new Date());

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`field pdt-field${picked ? "" : " unset"}`}
        aria-label={`${label}: ${picked ? fieldText(picked) : "not set"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            show();
          }
        }}
      >
        <PixelIcon name="clock" size={14} />
        <span className="ell">{picked ? fieldText(picked) : "Pick a date and time"}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            className="pdt-pop px-frame"
            role="dialog"
            aria-label={label}
            style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden", left: 0, top: 0 }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close(true);
              }
            }}
          >
            <div className="pdt-head">
              <button type="button" className="icon-btn pdt-nav back" aria-label="Previous month" disabled={!canBack} onClick={() => setMonth(addMonths(month, -1))}>
                <PixelIcon name="chevron-right" size={14} />
              </button>
              <span className="pdt-month" aria-live="polite">
                {title}
              </span>
              <button type="button" className="icon-btn pdt-nav" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
                <PixelIcon name="chevron-right" size={14} />
              </button>
            </div>
            <div className="pdt-grid" role="grid" aria-label={title} ref={grid} onKeyDown={onGridKey}>
              {WEEKDAYS.map((w) => (
                <span key={w} className="pdt-wd" aria-hidden>
                  {w}
                </span>
              ))}
              {days.map((d) => {
                const outside = d.getMonth() !== month.getMonth();
                const past = d < minDay;
                const selected = !!picked && sameDay(d, picked);
                const cls = ["pdt-day", outside && "outside", sameDay(d, today) && "today", selected && "on"].filter(Boolean).join(" ");
                return (
                  <button
                    key={d.getTime()}
                    type="button"
                    className={cls}
                    tabIndex={sameDay(d, focusDay) ? 0 : -1}
                    disabled={past}
                    aria-pressed={selected}
                    aria-label={d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                    onClick={() => pickDay(d)}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="pdt-time">
              <span className="pdt-time-label">Time</span>
              <Spin label="Hour" value={base.getHours()} max={23} step={1} onChange={(h) => setTime(h, base.getMinutes())} />
              <span className="pdt-colon" aria-hidden>
                :
              </span>
              <Spin label="Minute" value={base.getMinutes()} max={59} step={5} onChange={(m) => setTime(base.getHours(), m)} />
            </div>
            <div className="pdt-foot">
              <button
                type="button"
                className="btn small ghost"
                onClick={() => {
                  onChange("");
                  close(true);
                }}
              >
                Clear
              </button>
              <span className="grow" />
              <button type="button" className="btn small" onClick={() => pickDay(today)}>
                Today
              </button>
              <button
                type="button"
                className="btn small primary"
                onClick={() => {
                  if (!picked) commit(base);
                  close(true);
                }}
              >
                Done
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
