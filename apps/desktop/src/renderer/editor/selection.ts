// What a click on the canvas selects, and how selections are named.

import { type ElementNode, getAt, parentAddress, wordsOf } from "@opendeck/format";

/** Elements you pick as a whole: a click inside them selects them, not their parts. */
const WHOLE = new Set(["table", "ul", "ol", "svg"]);
/** Parts that resolve to their nearest text block. */
const INLINE = new Set(["span", "b", "i", "u", "a", "br", "li", "tr", "th", "td"]);

/**
 * Map the element under the pointer to what a single click selects. Inline
 * marks select their text block; anything in a table or list selects the
 * table or list. When `within` (the current selection's parent) contains the
 * hit, the click stays at that depth, so after drilling into a group you keep
 * picking its children.
 */
export function pickAddress(slide: ElementNode, hit: string): string {
  // Climb out of inline/table/list parts.
  let addr = hit;
  for (;;) {
    const el = getAt(slide, addr);
    if (!el || addr === "") return addr;
    if (INLINE.has(el.tag)) {
      addr = parentAddress(addr);
      continue;
    }
    break;
  }
  // The outermost "whole" ancestor wins (a table inside a group: the table).
  const parts = addr.split(".");
  for (let i = 1; i <= parts.length; i++) {
    const a = parts.slice(0, i).join(".");
    const el = getAt(slide, a);
    if (el && WHOLE.has(el.tag)) return a;
  }
  return addr;
}

/** The text-editable target for a double-click: a text block, a whole list, or a single table cell. */
export function editTarget(slide: ElementNode, hit: string): string | null {
  let addr = hit;
  for (;;) {
    const el = getAt(slide, addr);
    if (!el || addr === "") return null;
    if (el.tag === "th" || el.tag === "td") return addr;
    if (["h1", "h2", "h3", "p"].includes(el.tag)) return addr;
    if (el.tag === "ul" || el.tag === "ol") {
      // The outermost list, so nested items edit together.
      let top = addr;
      let up = parentAddress(top);
      while (up !== "" && ["ul", "ol", "li"].includes(getAt(slide, up)?.tag ?? "")) {
        if (["ul", "ol"].includes(getAt(slide, up)!.tag)) top = up;
        up = parentAddress(up);
      }
      return top;
    }
    if (["span", "b", "i", "u", "a", "br", "li"].includes(el.tag)) {
      addr = parentAddress(addr);
      continue;
    }
    return null;
  }
}

const KIND: Record<string, string> = {
  section: "Slide",
  div: "Group",
  h1: "Heading",
  h2: "Heading",
  h3: "Heading",
  p: "Text",
  ul: "List",
  ol: "List",
  img: "Image",
  svg: "Graphic",
  table: "Table",
  th: "Cell",
  td: "Cell",
  hr: "Line",
  "x-shape": "Shape",
};

/** A short name for an element: its text style or kind, then its first words. */
export function labelOf(el: ElementNode | null): string {
  if (!el) return "";
  const name = el.attrs["data-style"] ? el.attrs["data-style"].replace(/-/g, " ") : (KIND[el.tag] ?? el.tag);
  const words = wordsOf(el);
  if (!words || el.tag === "div" || el.tag === "table") return el.tag === "img" && el.attrs.alt ? `${name} · ${el.attrs.alt}` : name;
  return `${name} · ${words.length > 32 ? words.slice(0, 32) + "…" : words}`;
}

export function kindOf(el: ElementNode | null): string {
  return el ? (KIND[el.tag] ?? el.tag) : "";
}
