// Picking a color: the standard swatches (a gray row, then four rows of
// hues) or a custom one (saturation and brightness, hue, hex). A custom pick
// is shown while dragging and saved once, on release.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CELL_COLOR_PALETTE } from "@opendeck/sheet";

interface Props {
  anchor: HTMLElement;
  /** "above" hangs over a toolbar button; "beside" opens next to a menu row. */
  place?: "above" | "beside";
  /** What the empty swatch means: "Automatic" for text and borders, "None" for fill. */
  none: string;
  value: string | undefined;
  onPick(color: string | undefined): void;
  onClose(): void;
}

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s: max ? d / max : 0, v: max };
}

const ROWS = CELL_COLOR_PALETTE;
const COLS = ROWS[0]!.length;

export function ColorPanel({ anchor, place = "above", none, value, onPick, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"standard" | "custom">("standard");
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const start = (value && hexToHsv(value)) || { h: 214, s: 0.75, v: 0.9 };
  const [hsv, setHsv] = useState(start);
  const [hex, setHex] = useState(value ?? hsvToHex(start.h, start.s, start.v));
  const live = hsvToHex(hsv.h, hsv.s, hsv.v);
  const latest = useRef(hsv);
  latest.current = hsv;

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left: number;
    let top: number;
    if (place === "beside") {
      left = r.right + w + 4 <= window.innerWidth - 8 ? r.right + 4 : r.left - w - 4;
      top = r.top - 6;
    } else {
      left = r.left + r.width / 2 - w / 2;
      top = r.top - h - 6;
      if (top < 8) top = r.bottom + 6;
    }
    setPos({ left: Math.max(8, Math.min(window.innerWidth - w - 8, left)), top: Math.max(8, Math.min(window.innerHeight - h - 8, top)) });
  }, [anchor, place, tab]);

  useEffect(() => {
    if (!pos) return;
    panel.current?.querySelector<HTMLElement>(".cp-swatch.on, .cp-tab.on")?.focus();
  }, [pos === null]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.contains(t) || (t instanceof Element && t.closest(".menu, .bp-panel"))) return;
      onClose();
    };
    window.addEventListener("mousedown", away, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  const pick = (c: string | undefined) => {
    onPick(c);
    onClose();
  };

  /** Drag on an element; `at` gets the pointer's place as 0–1 across and down. */
  const drag = (e: React.PointerEvent<HTMLElement>, at: (x: number, y: number) => void) => {
    const el = e.currentTarget;
    const box = el.getBoundingClientRect();
    const read = (ev: { clientX: number; clientY: number }) =>
      at(Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width)), Math.max(0, Math.min(1, (ev.clientY - box.top) / box.height)));
    read(e);
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => read(ev);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      const c = hsvToHex(latest.current.h, latest.current.s, latest.current.v);
      setHex(c);
      onPick(c);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const nudge = (e: React.KeyboardEvent, key: "sv" | "h") => {
    const d = e.shiftKey ? 0.1 : 0.02;
    let next = hsv;
    if (key === "h" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) next = { ...hsv, h: (hsv.h + (e.key === "ArrowRight" ? 360 : -360) * d + 360) % 360 };
    else if (key === "sv" && e.key === "ArrowLeft") next = { ...hsv, s: Math.max(0, hsv.s - d) };
    else if (key === "sv" && e.key === "ArrowRight") next = { ...hsv, s: Math.min(1, hsv.s + d) };
    else if (key === "sv" && e.key === "ArrowUp") next = { ...hsv, v: Math.min(1, hsv.v + d) };
    else if (key === "sv" && e.key === "ArrowDown") next = { ...hsv, v: Math.max(0, hsv.v - d) };
    else if (e.key === "Enter") return pick(live);
    else return;
    e.preventDefault();
    setHsv(next);
    setHex(hsvToHex(next.h, next.s, next.v));
  };

  const swatches = () => [...(panel.current?.querySelectorAll<HTMLButtonElement>(".cp-grid .cp-swatch") ?? [])];

  return createPortal(
    <div
      ref={panel}
      className="cp-panel"
      role="dialog"
      aria-label="Colors"
      style={pos ?? { visibility: "hidden", left: 0, top: 0 }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
          anchor.focus();
        }
      }}
    >
      <div className="cp-tabs" role="tablist">
        {(["standard", "custom"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`cp-tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
            {t === "standard" ? "Standard" : "Custom"}
          </button>
        ))}
      </div>
      {tab === "standard" ? (
        <>
          <button className={`cp-none${value ? "" : " on"}`} onClick={() => pick(undefined)}>
            <span className="cp-none-swatch" aria-hidden />
            {none}
          </button>
          <div
            className="cp-grid"
            role="grid"
            onKeyDown={(e) => {
              const list = swatches();
              const i = list.indexOf(document.activeElement as HTMLButtonElement);
              if (i < 0) return;
              const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? COLS : e.key === "ArrowUp" ? -COLS : 0;
              if (!step) return;
              e.preventDefault();
              list[Math.max(0, Math.min(list.length - 1, i + step))]?.focus();
            }}
          >
            {ROWS.map((row, r) => (
              <div key={r} className={`cp-row${r === 0 ? " grays" : ""}`} role="row">
                {row.map((c) => (
                  <button
                    key={c}
                    className={`cp-swatch${value?.toLowerCase() === c ? " on" : ""}`}
                    style={{ background: c }}
                    title={c}
                    aria-label={c}
                    tabIndex={value?.toLowerCase() === c || (!value && r === 0 && c === row[0]) ? 0 : -1}
                    onClick={() => pick(c)}
                  />
                ))}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="cp-custom">
          <div
            className="cp-plane"
            role="slider"
            tabIndex={0}
            aria-label="Saturation and brightness"
            aria-valuetext={live}
            style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
            onPointerDown={(e) => drag(e, (x, y) => setHsv((c) => ({ ...c, s: x, v: 1 - y })))}
            onKeyDown={(e) => nudge(e, "sv")}
          >
            <span className="cp-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: live }} />
          </div>
          <div
            className="cp-hue"
            role="slider"
            tabIndex={0}
            aria-label="Hue"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            onPointerDown={(e) => drag(e, (x) => setHsv((c) => ({ ...c, h: x * 360 })))}
            onKeyDown={(e) => nudge(e, "h")}
          >
            <span className="cp-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, top: "50%", background: `hsl(${hsv.h} 100% 50%)` }} />
          </div>
          <input
            className="cp-hex"
            value={hex}
            maxLength={7}
            aria-label="Hex color"
            spellCheck={false}
            onChange={(e) => {
              setHex(e.target.value);
              const p = hexToHsv(e.target.value);
              if (p) setHsv(p);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const p = hexToHsv(hex);
                if (p) pick(hsvToHex(p.h, p.s, p.v));
              }
            }}
          />
        </div>
      )}
    </div>,
    document.body,
  );
}
