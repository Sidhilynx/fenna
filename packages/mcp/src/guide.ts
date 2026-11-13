// What a model is told about the format. The property reference is
// generated from the schema, so it can never drift from what the validator
// accepts. The craft notes are ours: short, concrete, model-agnostic.

import { BUILDS, ELEMENTS, LIMITS, PROPERTIES, SHAPE_KINDS, SLIDE_HEIGHT, SLIDE_WIDTH, TRANSITIONS } from "@opendeck/format";

/** Short form, sent as the server's instructions on connect. */
export const INSTRUCTIONS = `You edit a Fenna Slides slide deck: a folder on the user's computer with deck.json (title, slide order, sections, theme) and one HTML file per slide. The user watches each change land.
Start with deck_overview. Call format_guide once before your first write: each slide is ONE <section> on a fixed ${SLIDE_WIDTH}×${SLIDE_HEIGHT}px canvas, in a small HTML subset with inline styles only.
To change a slide: read_slides, then edit_slide with exact text quoted from it (a word, a style value, one element). Rewrite a whole slide with write_slide only when it is being redesigned. Build a new deck with write_slides.
Change only what was asked; leave every other slide, position, size and color as it is.
Writes are checked; a refused write returns the exact problems with line numbers. Fix them and write again.
Comments: read_comments shows what people asked for on the deck; answer each thread you act on with comment.
Never invent statistics, quotes or names: use [bracketed placeholders] and tell the user.
Prefer theme colors (var(--name)) and text styles (data-style="name") over raw values, so the deck stays consistent and re-themable.`;

function propertyTable(): string {
  const groups: Record<string, string[]> = {};
  for (const [name, spec] of Object.entries(PROPERTIES)) {
    (groups[spec.group] ??= []).push(`${name}${spec.pinnedOnly ? " (position:absolute only)" : ""} — on ${compact(spec.on)}`);
  }
  return Object.entries(groups)
    .map(([g, lines]) => `${g.toUpperCase()}\n${lines.map((l) => `  ${l}`).join("\n")}`)
    .join("\n");
}

function compact(tags: readonly string[]): string {
  const all = Object.keys(ELEMENTS).filter((t) => !["span", "b", "i", "u", "a", "br", "li", "tr", "aside"].includes(t));
  if (all.every((t) => tags.includes(t))) return "everything";
  return tags.join(", ");
}

export function formatGuide(): string {
  return `# The Fenna Slides format

## Files
- deck.json: {"format":"fenna-slides/0","title","slides":[ids in order],"sections":[{"title","start":slideId}],"theme":{"colors":{name:"#hex"},"fonts":[{"family","source":"google"|"assets/file.woff2","weights":[400,600]}],"textStyles":{name:"css declarations"}}}. Change it with update_deck, never by writing slides.
- slides/<id>.html: exactly one <section id="<id>"> and nothing else. Ids: a letter, then letters, digits, - or _.
- assets/: images and font files. An <img src> is "assets/<file>"; never a URL or data: URI.

## The canvas
${SLIDE_WIDTH}×${SLIDE_HEIGHT}px, always. Lengths are px (a bare number is px) or %; no em, rem, vw, pt.
The <section> and every <div> lay out their children as a flex column by default. Use display:flex + flex-direction:row for rows, display:grid + grid-template-columns for grids, gap for spacing (margin is ignored).
position:absolute pins an element to the slide (or to its nearest position:relative div) with left/top/right/bottom/width/height. Later elements paint on top; list backgrounds first.

## Elements
- Text: h1 h2 h3 p (defaults 96/64/44/32px). Inline inside them: b i u span a br. A span only changes color, weight, style or decoration.
- Lists: ul/ol of li. An li may hold a nested ul/ol after its text.
- Groups: div (invisible unless given background, border or box-shadow).
- img (src, alt), svg (one self-contained graphic: no scripts, no external refs, ≤${LIMITS.svgBytes / 1024}KB; put text labels as <p> over it, not <text> inside), table of tr with th/td (first row of th is the header; width:N% on the first row's cells sets column widths), hr (a line), x-shape kind="${SHAPE_KINDS.join("|")}" (a filled shape; background is its fill).
- aside: speaker notes, plain text, the section's last child. Only add notes when asked.
- section attributes: data-transition="${TRANSITIONS.join("|")}", data-section (unused; sections live in deck.json), hidden (skip in the show).
- data-build="${BUILDS.join("|")} [order]" on a position:absolute element: it animates in during the show.
- data-style="name" on text, lists or divs applies a theme text style; inline styles on the element win.
- Limits: ${LIMITS.elementsPerSlide} elements per slide, divs nest ${LIMITS.divDepth} deep, tables ${LIMITS.tableRows}×${LIMITS.tableCols}.

## Colors
#hex, rgb(), hsl(), transparent, or var(--name) for a theme color. No color names. Gradients: linear-gradient()/radial-gradient() in background.

## Every property
${propertyTable()}

## Making slides people want to look at
- One idea per slide. A statement, a number, a picture or a table beats a list of bullets.
- Keep 128px margins (padding:128px on the section). Body text in a column ~800–1000px wide, never the full 1664px.
- Slides are read from the back of a room, not on a phone. Sizes: titles 64–120px, card titles 40–48px, body and table text 28–36px, labels 24px. NEVER below 24px; if text only fits smaller, cut words or split the slide.
- Fill the slide: the content block should use most of the 824px height (justify-content:space-between on the section, or flex:1 spacers). A small cluster of text at the top of an empty slide looks unfinished.
- Numbers: use only figures the user gave you or that are in the deck. Otherwise write a placeholder like [00%] or [$__] and tell the user — even on a "big number" slide.
- Pick a type scale once (e.g. 120/72/44/32/24) and reuse it through text styles.
- Pick colors once, in the theme: a dark, a light, one or two accents. Every section sets a background. Text keeps 4.5:1 contrast (3:1 at 44px+).
- Budget the height: ${SLIDE_HEIGHT - 256}px inside the margins. A line of text takes about size × line-height; a table row about 2 × its font size. If it doesn't fit, split the slide; never shrink text to cram.
- Repeated slides share structure: headings in the same place, the same padding and gaps, so flipping through doesn't jump.
- Size boxes to their longest word (about 0.6 × font-size per character), or headings will break mid-word.
- Titles introduce the slide in plain words, in one grammar through the deck; read alone, the titles tell the story. Never the shape "X is no longer Y. It is Z." or "It's not X, it's Y"; no dramatic reveals, no filler stats, no emoji unless the brand uses them.
- Backgrounds on purpose: the dark color for the opening and closing slides, the light one for content, the accent for one statement slide (the sentence or number to remember).
- A footer (page number, source, logo) is one position:absolute 24px line at bottom:64px; give that slide padding:128px 128px 160px so nothing else reaches it.
- Sizes the user gives in points are px × 2 here ("36pt" is 72px).
- Rows and columns of facts are a <table>, never divs drawn to look like one: a table stays one editable table in the app and in PowerPoint.
- No filler: no placeholder sections, icons or numbers to fill space. If the deck needs more material, ask.
- Change only what was asked. A small request gets a small edit (edit_slide). Elements a person dragged are position:absolute; keep them where they are.
`;
}
