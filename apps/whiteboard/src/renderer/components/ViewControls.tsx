// Top right of the board: the timer and the zoom menu, as in the reference.

import { useEffect, useRef, useState } from "react";
import { Icon, MenuButton, shortcut, toast } from "@opendeck/shell";
import { addTime, fitBoard, getState, pauseTimer, redo, resumeTimer, startTimer, stopTimer, toggleSetting, undo, useBoard, zoomIn, zoomOut, zoomTo } from "../store.ts";

const PRESETS = [1, 3, 5, 10, 15];

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** Three soft notes, unless the person turned the chime off. */
function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880, 990].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      const t = ctx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.55);
    });
    window.setTimeout(() => void ctx.close(), 1500);
  } catch {
    /* no audio device */
  }
}

/** Seconds left on a running timer. */
const left = () => {
  const t = getState().timer;
  return t.endsAt === null ? t.left : Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000));
};

export function ViewControls() {
  const zoom = useBoard((s) => s.view.zoom);
  const settings = useBoard((s) => s.meta?.settings);
  const canUndo = useBoard((s) => s.undo.length > 0);
  const canRedo = useBoard((s) => s.redo.length > 0);
  const timer = useBoard((s) => s.timer);
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const pct = Math.round(zoom * 100);

  useEffect(() => {
    if (!timer.running || timer.endsAt === null) return;
    const id = window.setInterval(() => {
      tick((n) => n + 1);
      if (left() <= 0) {
        stopTimer();
        if (getState().meta?.settings.chime) chime();
        toast("Time’s up.");
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [timer.running, timer.endsAt]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [open]);

  return (
    <div className="wb-view" ref={wrap} onPointerDown={(e) => e.stopPropagation()}>
      <div className="wb-pill">
        <button className={`icon-btn wb-timer${timer.running ? " on" : ""}`} aria-haspopup="dialog" aria-expanded={open} aria-label={timer.running ? `Timer, ${clock(left())} left` : "Timer"} title="Timer" onClick={() => setOpen(!open)}>
          <Icon name="timer" size={18} />
          {timer.running && <span className="wb-timer-left">{clock(left())}</span>}
        </button>
        <MenuButton
          className="btn ghost wb-zoom"
          label="Zoom"
          title="Zoom"
          align="end"
          entries={() => [
            { label: "Zoom in", shortcut: shortcut("Mod++"), onSelect: zoomIn },
            { label: "Zoom out", shortcut: shortcut("Mod+−"), onSelect: zoomOut },
            { label: "Fit the board", shortcut: "Shift+1", onSelect: () => fitBoard() },
            "separator",
            { heading: `Now ${pct}%` },
            ...[25, 50, 75, 100, 150, 200].map((z) => ({ label: `${z}%`, checked: z === pct, onSelect: () => zoomTo(z / 100) })),
            "separator",
            { label: "Single-key tool shortcuts", checked: !!settings?.shortcuts, onSelect: () => toggleSetting("shortcuts") },
            { label: "Timer chime", checked: !!settings?.chime, onSelect: () => toggleSetting("chime") },
            "separator",
            { label: "Undo", shortcut: shortcut("Mod+Z"), disabled: !canUndo, onSelect: undo },
            { label: "Redo", shortcut: shortcut("Mod+Shift+Z"), disabled: !canRedo, onSelect: redo },
          ]}
        >
          {pct}%
          <Icon name="chevronDown" size={14} />
        </MenuButton>
      </div>
      {open && (
        <div
          className="wb-timer-pop"
          role="dialog"
          aria-label="Timer"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          {timer.running ? (
            <>
              <div className="wb-timer-big" aria-live="polite">
                {clock(left())}
              </div>
              <div className="wb-timer-row">
                {timer.endsAt === null ? (
                  <button className="btn" autoFocus onClick={resumeTimer}>
                    Resume
                  </button>
                ) : (
                  <button className="btn" autoFocus onClick={pauseTimer}>
                    Pause
                  </button>
                )}
                <button className="btn" onClick={() => addTime(60)}>
                  +1 min
                </button>
                <button className="btn ghost" onClick={stopTimer}>
                  Stop
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="wb-timer-head">Start a timer</div>
              <div className="wb-timer-row">
                {PRESETS.map((m, i) => (
                  <button key={m} className="btn" autoFocus={i === 2} onClick={() => startTimer(m * 60)}>
                    {m} min
                  </button>
                ))}
              </div>
              <div className="wb-timer-note">{settings?.chime ? "A chime plays when it ends." : "The chime is off (zoom menu)."}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
