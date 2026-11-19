// The chrome of a window on a bot's computer: the title bar (icon, title,
// minimize, maximize or restore, close), dragging by the title bar, resizing
// from every edge and corner, and focus on any press. The body is whatever the
// app renders. Positions and sizes live in windows.ts; this only sends actions.

import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Glyph } from "./Glyph.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { FileIcon } from "./FileIcon.tsx";
import type { FileIconName } from "./fileIcons.ts";
import { resizeRect, type Edge, type Rect, type Size, type WindowAction, type WindowState } from "./windows.ts";

const EDGES: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

interface Gesture {
  kind: "move" | "resize";
  edge: Edge | null;
  x: number;
  y: number;
  start: Rect;
}

/** Buttons in the title bar take their own presses; the bar does not drag or toggle for them. */
const onControl = (target: EventTarget): boolean => target instanceof Element && target.closest("button") !== null;

export function WindowFrame({
  win,
  rank,
  focused,
  icon,
  desk,
  dispatch,
  onClose,
  children,
}: {
  win: WindowState;
  /** The window's place in the stack, from 0 at the back. */
  rank: number;
  focused: boolean;
  icon: FileIconName;
  desk: Size;
  dispatch(action: WindowAction): void;
  onClose(): void;
  children: ReactNode;
}) {
  const gesture = useRef<Gesture | null>(null);

  const begin = (e: ReactPointerEvent<HTMLElement>, kind: Gesture["kind"], edge: Edge | null) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { kind, edge, x: e.clientX, y: e.clientY, start: { x: win.x, y: win.y, w: win.w, h: win.h } };
  };

  const track = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.kind === "move") {
      if (dx !== 0 || dy !== 0) dispatch({ type: "move", id: win.id, x: g.start.x + dx, y: g.start.y + dy });
    } else if (g.edge) {
      dispatch({ type: "resize", id: win.id, rect: resizeRect(g.start, g.edge, dx, dy, desk) });
    }
  };

  const end = () => {
    gesture.current = null;
  };

  const toggleMax = () => dispatch({ type: win.max ? "unmaximize" : "maximize", id: win.id });

  return (
    <section
      className={`win${focused ? " focused" : ""}${win.max ? " max" : ""}`}
      aria-label={win.title}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: 1 + rank }}
      onPointerDownCapture={() => {
        if (!focused) dispatch({ type: "focus", id: win.id });
      }}
    >
      <div
        className="win-bar win-head"
        onPointerDown={(e) => {
          if (onControl(e.target) || win.max) return;
          begin(e, "move", null);
        }}
        onPointerMove={track}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={(e) => {
          if (!onControl(e.target)) toggleMax();
        }}
      >
        <FileIcon name={icon} size={16} />
        <span className="win-title ell">{win.title}</span>
        <span className="grow" />
        <div className="window-controls">
          <button
            type="button"
            className="icon-btn win-btn"
            aria-label="Minimize"
            title="Minimize"
            onClick={() => dispatch({ type: "minimize", id: win.id })}
          >
            <Glyph name="minimize" size={12} />
          </button>
          <button type="button" className="icon-btn win-btn" aria-label={win.max ? "Restore" : "Maximize"} title={win.max ? "Restore" : "Maximize"} onClick={toggleMax}>
            <PixelIcon name={win.max ? "restore" : "maximize"} size={12} />
          </button>
          <button type="button" className="icon-btn win-btn win-close" aria-label="Close" title="Close" onClick={onClose}>
            <PixelIcon name="close" size={12} />
          </button>
        </div>
      </div>

      <div className="win-body">{children}</div>

      {!win.max &&
        EDGES.map((edge) => (
          <div
            key={edge}
            className="win-edge"
            data-edge={edge}
            aria-hidden
            onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
              e.stopPropagation();
              begin(e, "resize", edge);
            }}
            onPointerMove={track}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ))}
    </section>
  );
}
