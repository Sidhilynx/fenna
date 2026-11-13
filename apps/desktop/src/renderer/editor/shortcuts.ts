// Keyboard shortcuts and clipboard for the editor. One place, so menus can
// show the same keys they trigger. Nothing fires while you type in a field
// or in a text box on the slide.

import { useEffect } from "react";
import { elementChildren, getAt, parentAddress } from "@opendeck/format";
import * as cmd from "./commands.ts";
import { newComment } from "./comments.ts";
import { editTarget } from "./selection.ts";
import { addSlide, currentSlide, getState, goTo, redo, select, setState, setView, undo } from "./store.ts";

const ZOOMS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3];

/** Single keys that add a shape, as the shape menu shows them. */
export const SHAPE_KEYS: Record<string, string> = { rect: "R", rounded: "Shift+R", ellipse: "O", diamond: "D", line: "L" };
const SHAPE_BY_KEY = new Map(Object.entries(SHAPE_KEYS).map(([kind, key]) => [key, kind]));

export function zoomStep(dir: 1 | -1) {
  const s = getState();
  const cur = s.zoom === "fit" ? s.fitScale : s.zoom;
  const next = dir > 0 ? ZOOMS.find((z) => z > cur + 0.001) : [...ZOOMS].reverse().find((z) => z < cur - 0.001);
  if (next) setState({ zoom: next });
}

function typingIn(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el?.closest?.("input, textarea, select, [contenteditable='true']");
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = getState();
      if (s.presenting || typingIn(e.target) || document.querySelector(".dialog")) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      const inEdit = s.view === "edit";
      const sel = s.selection;
      const run = (fn: () => unknown) => {
        e.preventDefault();
        void fn();
      };

      if (mod && k.toLowerCase() === "z") return run(e.shiftKey ? redo : undo);
      if (mod && k.toLowerCase() === "y") return run(redo);
      if (k === "F5" || (mod && k === "Enter")) return run(() => setState({ presenting: true }));
      if (mod && (k === "=" || k === "+")) return run(() => zoomStep(1));
      if (mod && k === "-") return run(() => zoomStep(-1));
      if (mod && k === "0") return run(() => setState({ zoom: "fit" }));
      if (mod && e.altKey && k.toLowerCase() === "m") return run(newComment);
      if (mod && e.altKey && k.toLowerCase() === "g") return run(() => setView(s.view === "grid" ? "edit" : "grid"));
      if (mod && e.shiftKey && k.toLowerCase() === "n") return run(() => addSlide());
      if (!inEdit) return;

      if (!mod && !e.altKey && k.length === 1) {
        const kind = SHAPE_BY_KEY.get(`${e.shiftKey ? "Shift+" : ""}${k.toUpperCase()}`);
        if (kind && s.editing === null) return run(() => cmd.insertShape(kind));
      }

      if ((k === "Delete" || k === "Backspace") && sel.length) return run(cmd.deleteSelection);
      if (mod && k.toLowerCase() === "d" && sel.length) return run(cmd.duplicateSelection);
      if (mod && k.toLowerCase() === "g") return run(e.shiftKey ? cmd.ungroupSelection : cmd.groupSelection);
      if (mod && (k === "]" || k === "}")) return run(() => cmd.restack(e.shiftKey ? "front" : "forward"));
      if (mod && (k === "[" || k === "{")) return run(() => cmd.restack(e.shiftKey ? "back" : "backward"));
      if (mod && k.toLowerCase() === "a") {
        const slide = currentSlide()?.slide;
        if (slide) return run(() => select(elementChildren(slide).map((_, i) => String(i)).filter((a) => getAt(slide, a)?.tag !== "aside")));
      }
      if (k === "Enter" && sel.length === 1) {
        const slide = currentSlide()?.slide;
        const t = slide ? editTarget(slide, sel[0]!) : null;
        if (t !== null) return run(() => setState({ editing: t }));
      }
      if (k === "Escape" && sel.length) return run(() => select(sel.length === 1 && parentAddress(sel[0]!) !== "" ? [parentAddress(sel[0]!)] : []));
      if (k.startsWith("Arrow") && sel.length) {
        const step = e.shiftKey ? 10 : 1;
        const dx = k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0;
        const dy = k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0;
        return run(() => cmd.nudge(dx, dy));
      }
      if (!sel.length && (k === "ArrowDown" || k === "PageDown" || k === "ArrowRight")) return run(() => goTo(s.current + 1));
      if (!sel.length && (k === "ArrowUp" || k === "PageUp" || k === "ArrowLeft")) return run(() => goTo(s.current - 1));
      if (k === "Home" && !sel.length) return run(() => goTo(0));
      if (k === "End" && !sel.length) return run(() => goTo((s.deck?.slides.length ?? 1) - 1));
    };

    const onCopy = (e: ClipboardEvent) => {
      if (typingIn(e.target) || getState().view !== "edit") return;
      cmd.copySelection(e);
    };
    const onCut = (e: ClipboardEvent) => {
      if (typingIn(e.target) || getState().view !== "edit") return;
      cmd.copySelection(e, true);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (typingIn(e.target) || getState().view !== "edit") return;
      void cmd.paste(e);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, []);
}
