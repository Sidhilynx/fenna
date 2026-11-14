// An artboard on its own, filling the window: the play view. Fit shows all
// of it; Fill makes it as wide as the window and scrolls. A link to another
// artboard of the design opens that artboard here.

import { useLayoutEffect, useRef, useState } from "react";
import { themeOf, type ArtboardDoc, type ArtboardTheme } from "@opendeck/artboard";
import { Icon, MenuButton, toast } from "@opendeck/shell";
import { artboardExportMenu } from "../export.ts";
import { boardRect, pageBoards, setFocus, setState, useDesign } from "../store.ts";
import { ArtboardView } from "./ArtboardView.tsx";

/** An artboard scaled to a box: all of it (`fit`), or as wide as the box. */
export function Scaled({ file, doc, theme, width, height, mode, max = 1 }: { file: string; doc: ArtboardDoc; theme: ArtboardTheme; width: number; height: number; mode: "fit" | "fill"; max?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setRoom({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  const scale = !room.w ? 0 : mode === "fill" ? room.w / width : Math.min(max, room.w / width, room.h / height);
  return (
    <div ref={box} className={`dg-scaled ${mode}`}>
      {scale > 0 && (
        <div className="dg-scaled-size" style={{ width: width * scale, height: height * scale }}>
          <div className="dg-scaled-art" style={{ width, height, transform: `scale(${scale})` }}>
            <ArtboardView file={file} doc={doc} theme={theme} />
          </div>
        </div>
      )}
    </div>
  );
}

export function FocusView({ file }: { file: string }) {
  const index = useDesign((s) => s.index);
  const doc = useDesign((s) => s.boards.get(file)?.doc ?? null);
  const mode = useDesign((s) => s.focusMode);
  useDesign((s) => s.heights);
  const rect = boardRect(file);
  const board = index.boards[file];
  if (!doc || !rect || !board) return null;
  const others = pageBoards();
  const step = (by: number) => {
    const next = others[(others.indexOf(file) + by + others.length) % others.length];
    if (next) setFocus(next);
  };

  return (
    <div
      className="dg-focus"
      tabIndex={-1}
      ref={(el) => el?.focus({ preventScroll: true })}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          step(e.key === "ArrowRight" ? 1 : -1);
        }
      }}
      onClick={(e) => {
        const link = (e.nativeEvent.composedPath() as HTMLElement[]).find((n) => n.tagName === "A");
        const href = link?.getAttribute("href") ?? "";
        if (!link) return;
        e.preventDefault();
        if (href in index.boards) setFocus(href);
        else if (/\.html$/.test(href)) toast(`This design has no artboard “${href}”.`);
        else if (/^(https?:|mailto:)/.test(href)) window.open(href, "_blank", "noopener");
      }}
    >
      <header className="dg-focus-bar">
        <button className="icon-btn" aria-label="Back to the canvas" title="Back (Esc)" onClick={() => setFocus(null)}>
          <Icon name="arrowLeft" size={18} />
        </button>
        <h2 className="dg-focus-title">{board.title}</h2>
        <span className="dg-fill" />
        <MenuButton className="icon-btn" label={`Export ${board.title}`} title="Export" align="end" entries={() => artboardExportMenu(file)}>
          <Icon name="download" size={18} />
        </MenuButton>
        <div className="dg-seg" role="group" aria-label="Size">
          {(["fill", "fit"] as const).map((m) => (
            <button key={m} className="dg-seg-btn" aria-pressed={mode === m} title={m === "fill" ? "As wide as the window" : "All of it in the window"} onClick={() => setState({ focusMode: m })}>
              {m === "fill" ? "Fill" : "Fit"}
            </button>
          ))}
        </div>
      </header>
      <div className="dg-focus-stage">
        <Scaled file={file} doc={doc} theme={themeOf(index)} width={rect.w} height={rect.h} mode={mode} />
      </div>
    </div>
  );
}
