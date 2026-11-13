// Bringing changes from disk into the loaded deck: read only the slide files
// that changed, keep every slide object that didn't (so nothing showing it
// redraws), and tell which slide a change from outside touched.

import { type LoadedDeck, type LoadedSlide, type ValueContext, parseSlide, valueContext } from "@opendeck/format";
import type { RemoteChange } from "./store.ts";

/** A slide file's path; group 1 is the slide id. */
export const SLIDE_FILE = /^slides\/([A-Za-z][A-Za-z0-9_-]{0,63})\.html$/;

const MISSING = /^slide ".*" is in deck\.json but/;

/** Parse one slide file as loadDeck does (its id must match the file's name). */
export function loadSlide(id: string, source: string, ctx: ValueContext): LoadedSlide {
  const r = parseSlide(source, ctx);
  if (r.slide && r.slide.attrs.id !== id)
    r.diagnostics.push({ severity: "error", code: "id-mismatch", message: `the section's id must be "${id}", the file's name`, line: r.slide.line, col: r.slide.col, path: "section" });
  return { id, slide: r.slide, diagnostics: r.diagnostics, source };
}

/** `deck` with some slide files read again (source null: the file is gone); the index is unchanged. */
export function withSlideFiles(deck: LoadedDeck, files: { id: string; source: string | null }[]): LoadedDeck {
  const ctx = valueContext(deck.index);
  const byId = new Map(deck.slides.map((s) => [s.id, s] as const));
  for (const f of files) {
    if (f.source === null) byId.delete(f.id);
    else if (byId.get(f.id)?.source !== f.source) byId.set(f.id, loadSlide(f.id, f.source, ctx));
  }
  const listed = deck.index.slides.filter((id) => byId.has(id));
  const unlisted = [...byId.keys()].filter((id) => !deck.index.slides.includes(id)).sort();
  const missing = deck.index.slides.filter((id) => !byId.has(id)).map((id) => `slide "${id}" is in deck.json but slides/${id}.html is missing`);
  return { ...deck, slides: [...listed, ...unlisted].map((id) => byId.get(id)!), problems: [...deck.problems.filter((p) => !MISSING.test(p)), ...missing] };
}

/** `next`, with the slide objects of `prev` wherever a slide's file is unchanged (and the theme is the same). */
export function keepUnchanged(prev: LoadedDeck | null, next: LoadedDeck): LoadedDeck {
  if (!prev || JSON.stringify(prev.index.theme) !== JSON.stringify(next.index.theme)) return next;
  const old = new Map(prev.slides.map((s) => [s.id, s] as const));
  return { ...next, slides: next.slides.map((s) => (old.get(s.id)?.source === s.source ? old.get(s.id)! : s)) };
}

/** The slide a change from outside touched: the one in view if it changed, else the last changed in deck order. */
export function remoteChange(prev: LoadedDeck, next: LoadedDeck, inView: string | undefined, at: number): RemoteChange | null {
  const old = new Map(prev.slides.map((s) => [s.id, s] as const));
  const changed = next.slides.filter((s) => s.slide && old.get(s.id)?.source !== s.source);
  const pick = changed.find((s) => s.id === inView) ?? changed[changed.length - 1];
  return pick ? { slideId: pick.id, prev: old.get(pick.id)?.slide ?? null, at } : null;
}
