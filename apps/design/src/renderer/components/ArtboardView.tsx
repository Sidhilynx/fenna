// One artboard drawn by the format's renderer inside a shadow root, so the
// artboard's styles and the app's never meet. Every surface that shows an
// artboard (the canvas, the play view, the panel's preview, Home) uses this.

import { memo, useLayoutEffect, useRef } from "react";
import { artboardMarkup, type ArtboardDoc, type ArtboardTheme } from "@opendeck/artboard";
import { assetUrl } from "../api.ts";

/** The canvas's artboards, by file: where a layer's element and its box on screen are looked up. */
const canvasRoots = new Map<string, ShadowRoot>();

export const layerElement = (file: string, address: string): HTMLElement | null => canvasRoots.get(file)?.querySelector<HTMLElement>(`[data-od="${address}"]`) ?? null;

/** What the editor adds inside the shadow root: nothing in an artboard takes focus or a text selection unless it is being typed into. */
const CHROME = `:host { user-select: none; -webkit-user-select: none; }
[data-od] { cursor: default; }
[contenteditable="true"] { outline: none; cursor: text; user-select: text; -webkit-user-select: text; }
img { -webkit-user-drag: none; }`;

interface Props {
  file: string;
  doc: ArtboardDoc;
  theme: ArtboardTheme;
  /** On the canvas: elements are tagged with their addresses and found by `layerElement`. */
  canvas?: boolean;
  /** This artboard holds the text being typed: its DOM is left alone until typing ends. */
  frozen?: boolean;
  /** Told the height of what it holds, when that changes (an artboard that grows with its content). Give the same function each render. */
  onHeight?(file: string, height: number): void;
}

export const ArtboardView = memo(function ArtboardView({ file, doc, theme, canvas, frozen, onHeight }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const drawn = useRef("");

  // The DOM is replaced only when what it shows changes: an element under the pointer must outlive a click, and images must not reload on every render.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    if (frozen) {
      drawn.current = "";
      return;
    }
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    const { css, html } = artboardMarkup(doc, { theme, annotate: canvas, asset: assetUrl, scope: ":host" });
    const next = `<style>${css}\n${CHROME}</style>${html}`;
    if (next === drawn.current) return;
    drawn.current = next;
    root.innerHTML = next;
  }, [doc, theme, canvas, frozen]);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el?.shadowRoot || !canvas) return;
    canvasRoots.set(file, el.shadowRoot);
    return () => {
      if (canvasRoots.get(file) === el.shadowRoot) canvasRoots.delete(file);
    };
  }, [file, canvas]);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el || !onHeight) return;
    const ro = new ResizeObserver(() => onHeight(file, Math.ceil(el.offsetHeight)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [file, onHeight]);

  return <div ref={host} className="dg-artboard" data-file={canvas ? file : undefined} />;
});
