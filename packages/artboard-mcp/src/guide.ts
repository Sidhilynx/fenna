// What a model is told about the format. The element and property lists are
// generated from the schema, so they can never drift from what the parser
// accepts. The craft notes are ours: short, concrete, model-agnostic.

import { BOARD_SIZES, ELEMENTS, INLINE_TAGS, INPUT_TYPES, LIMITS, PROPERTIES, SHAPE_KINDS } from "@opendeck/artboard";

/** Short form, sent as the server's instructions on connect. */
export const INSTRUCTIONS = `You edit a Fenna Design file: a folder on the user's computer with design.json (title, pages, where each artboard sits, tweaks, text styles) and one HTML file per artboard. The user watches each change land on their canvas.
Start with design_overview. Call format_guide once before your first write: an artboard is ONE root <div> of a fixed size holding plain HTML with inline styles only (no <style>, classes or scripts).
To change an artboard: read_artboards, then edit_artboard with exact text quoted from it (a word, a style value, one element). Use write_artboard for a new artboard, or to redesign one whole.
Change only what was asked; leave every other artboard, position, size and color as it is.
Writes are checked; a refused write returns the exact problems with line numbers. Fix them and write again.
Comments: read_comments shows what people asked for; answer each thread you act on with comment.
Tweaks are the design's CSS variables (var(--accent)); change one with update_design and every artboard that uses it follows. Prefer them, and text styles (data-style="Body"), over repeating raw values.
Never invent statistics, quotes or names: use [bracketed placeholders] and tell the user.`;

function compact(tags: readonly string[]): string {
  const blocks = Object.keys(ELEMENTS).filter((t) => !["span", "b", "i", "u", "br", "li", "tr", "th", "td"].includes(t));
  return blocks.every((t) => tags.includes(t)) ? "everything" : tags.join(", ");
}

function propertyTable(): string {
  const groups: Record<string, string[]> = {};
  for (const [name, spec] of Object.entries(PROPERTIES)) {
    const values = spec.options ? `: ${spec.options.join(" | ")}` : "";
    (groups[spec.group] ??= []).push(`${name}${values}${spec.pinnedOnly ? " (position:absolute only)" : ""} — on ${compact(spec.on)}`);
  }
  return Object.entries(groups)
    .map(([g, lines]) => `${g.toUpperCase()}\n${lines.map((l) => `  ${l}`).join("\n")}`)
    .join("\n");
}

export function formatGuide(): string {
  const blocks = (ELEMENTS.div!.children as readonly string[]).join(" ");
  return `# The Fenna Design format

## Files
- design.json: the title, pages, each artboard's place on the canvas (x, y, w, h, page, title), the order, the tweaks and the text styles. Change it with update_design and arrange_artboards, never by writing artboards.
- artboards/<Name>.html: one artboard. You write and read only its root element; the head (title, the tweaks as :root variables, the text styles) is written for you.
- assets/: images. An <img src> is "assets/<file>"; never a URL or a data: URI. You cannot add files; use an image already there, an <svg>, or shapes.

## An artboard
One root <div> with a width and a height in px: its size on the canvas. Usual sizes: ${BOARD_SIZES.map((b) => `${b.name} ${b.width}×${b.height}${b.expand === "fill" ? " (a page: pass expand:\"fill\" and it grows down with its content)" : ""}`).join(", ")}.
Example:
<div style="width:1080px;height:1080px;padding:96px;background:#f4f1ea;display:flex;flex-direction:column;justify-content:space-between;color:#1c1b19">
  <p data-style="Caption" style="margin:0;color:var(--accent)">Saturday 14 June</p>
  <h1 data-style="Heading 1" style="margin:0">Open studio</h1>
</div>
It is ordinary HTML and CSS: block layout by default, display:flex or display:grid to lay children out, gap and padding for space. box-sizing is border-box everywhere. The base font is Inter. Headings and paragraphs keep the browser's default margins: set margin:0 when you lay out with gap.
Lengths are px (or % where a percentage makes sense); no em, rem, vw or pt (letter-spacing takes em). Colors: #hex, rgb(), hsl(), transparent, or var(--tweak). No color names.

## Elements
- Containers: div holds ${blocks}. Text never sits directly in a div: wrap it in p or a heading.
- Text: h1–h6, p, label, button, and a (a link; it may also be a block styled as a button). Inside them only text and ${INLINE_TAGS.join(" ")}.
- a href: https://…, mailto:…, or another artboard's file ("Pricing.html"): in the app's play view, clicking it opens that artboard. This is how screens link to each other.
- ul / ol of li; an li may hold a nested list after its text.
- img (src, alt), svg (one self-contained graphic: no scripts or outside references, ≤${LIMITS.svgBytes / 1024} KB), table of tr with th / td, hr.
- input (type ${INPUT_TYPES.join("|")}, value, placeholder): a picture of a field, for mock-ups.
- x-shape kind="${SHAPE_KINDS.join("|")}": a filled shape; background is its fill, width and height its size.
- data-style="<name>" on text applies one of the design's text styles (design_overview lists them); inline styles on the element win.
- Limits: ${LIMITS.elementsPerArtboard} elements per artboard, divs nest ${LIMITS.divDepth} deep, ${LIMITS.maxArtboards} artboards per design.

## Every property
${propertyTable()}

## Designs people want to look at
- Fit the artboard: add up the heights before you write (a line of text is about font-size × line-height; padding and gaps count). Nothing may run past the root's width or height; if it doesn't fit, cut words or shrink the layout, never the artboard.
- Size boxes to their longest word (about 0.55 × font-size per character) so headings don't break mid-word.
- One type scale and one spacing step per design (e.g. 8/16/24/48); reuse the text styles.
- One accent, used sparingly: the primary button, one underline, one number. Use var(--accent) for it so the user can change it once.
- Text keeps 4.5:1 contrast with what is behind it (3:1 for large headings).
- A dark variant of a screen is the same layout with the colors swapped: copy the artboard, change backgrounds and text colors, keep sizes and spacing.
- Phone screens: 16–24px side padding, rows at least 48px tall, body text 15–17px.
- Rows and columns of facts are a table or a grid, not text lined up with spaces.
- New artboards go beside the others (leave x and y out); don't stack one on top of another.
- Change only what was asked. A small request gets a small edit (edit_artboard).
`;
}
