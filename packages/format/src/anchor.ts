// What a comment thread points at on a slide, and how to find it again: a
// slide id, an element address, and a snippet of the element's text, so a
// thread stays on the right element when other elements move around it.
// The editor and the MCP server both use this, so a thread an AI starts
// lands where a person's would.

import { type Address, elementChildren, getAt } from "./edit.ts";
import { type ElementNode, textOf, wordsOf } from "./slide.ts";

export interface SlideAnchor {
  /** Slide id. */
  slide: string;
  /** Element address on that slide; "" is the slide itself. */
  addr: Address;
  /** The element's text when the thread was last anchored, to find it again. */
  snippet: string;
}

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

/** A stored thread's slide anchor, or null when it isn't one. */
export function slideAnchor(t: Record<string, unknown>): SlideAnchor | null {
  if (!isText(t.slide, 64) || !isText(t.addr, 200) || !/^(\d+(\.\d+)*)?$/.test(t.addr)) return null;
  return { slide: t.slide, addr: t.addr, snippet: isText(t.snippet, 200) ? t.snippet : "" };
}

/** The first words of an element's text, as used to find it again. */
export function snippetOf(el: ElementNode): string {
  return textOf(el).replace(/\s+/g, " ").trim().slice(0, 60);
}

function* walk(el: ElementNode, addr: Address): Generator<[Address, ElementNode]> {
  yield [addr, el];
  const kids = elementChildren(el);
  for (let i = 0; i < kids.length; i++) yield* walk(kids[i]!, addr ? `${addr}.${i}` : String(i));
}

/**
 * Where a thread points on the slide now. Its own address if the element
 * there still has the same text; else the element that has that text now
 * (it moved); else its own address if that still exists (the text was
 * edited, often because of the comment); else the slide.
 */
export function anchorOf(slide: ElementNode, t: Pick<SlideAnchor, "addr" | "snippet">): Address {
  const el = getAt(slide, t.addr);
  if (el && (!t.snippet || snippetOf(el) === t.snippet)) return t.addr;
  if (t.snippet) {
    // A wrapper and the one element inside it share their text: prefer the match nesting closest to the old depth.
    const depth = (a: string) => (a ? a.split(".").length : 0);
    let best: Address | null = null;
    for (const [addr, node] of walk(slide, "")) {
      if (!addr || snippetOf(node) !== t.snippet) continue;
      if (best === null || Math.abs(depth(addr) - depth(t.addr)) < Math.abs(depth(best) - depth(t.addr))) best = addr;
    }
    if (best !== null) return best;
  }
  return el ? t.addr : "";
}

/**
 * The element whose words hold `quote`, as a person would point at it: the
 * innermost one, so "Q3 revenue" finds the heading, not the card around it.
 * Matching ignores case and runs of spaces. Empty when no element holds
 * it; every innermost match when several do, so the caller can say which.
 */
export function findByWords(slide: ElementNode, quote: string): Address[] {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const q = norm(quote);
  if (!q) return [];
  const hits: Address[] = [];
  for (const [addr, node] of walk(slide, "")) {
    if (!addr || node.tag === "aside" || !norm(wordsOf(node)).includes(q)) continue;
    // Drop a match that encloses this one: only the innermost stay.
    for (let i = hits.length - 1; i >= 0; i--) if (addr.startsWith(`${hits[i]}.`)) hits.splice(i, 1);
    hits.push(addr);
  }
  return hits;
}
