// What a model is told about the doc format. The element reference is
// generated from the schema, so it can never drift from what the validator
// accepts. The writing notes are ours: short, concrete, model-agnostic.

import { BLOCKS, DROPDOWN_TEMPLATES, INLINE, LIMITS, OPTION_COLORS, TEXT_COLORS } from "@opendeck/doc";

/** Short form, sent as the server's instructions on connect. */
export const INSTRUCTIONS = `You edit a Fenna Docs document: a folder on the user's computer with doc.json (title, the tree of tabs, fonts, dropdowns) and one HTML file per tab.
Start with doc_overview: it lists every tab with its outline (heading block ids).
To change part of a tab, use edit_blocks: replace_text changes words you quote exactly from read_tab; replace, insert and delete work on whole blocks by id. Everything else stays exactly as the user left it. Use write_tab only to create a tab or rewrite one whole.
When doc_overview shows suggesting: true, the user is reviewing every change: write as usual and your edits are saved as suggestions for them to accept or reject. Never write <ins> or <del> yourself.
Comments: read_comments lists what people asked; answer or leave notes with comment. Questions go in comments, changes go in the text.
A tab is ONE <article id="<tab id>"> of blocks, in a small HTML subset with no styles at all. Call format_guide once before your first write.
Read a tab before changing it (read_tab gives its version; pass it back as expected_version). Writes are checked; a refused write returns the exact problems. Fix them and write again.
Never invent facts, figures, quotes or names: use [bracketed placeholders] and tell the user.`;

function blockList(): string {
  return Object.entries(BLOCKS)
    .map(([tag, s]) => {
      const holds = s.children === "inline" ? "text" : s.children === "text" ? "plain text" : s.children === "none" ? "nothing" : (s.children as readonly string[]).map((c) => `<${c}>`).join(", ");
      return `- <${tag}>${s.attrs?.length ? ` [${s.attrs.join(", ")}]` : ""}: ${s.label}; holds ${holds}`;
    })
    .join("\n");
}

function inlineList(): string {
  return Object.entries(INLINE)
    .filter(([tag]) => tag !== "ins" && tag !== "del")
    .map(([tag, s]) => `- <${tag}>${s.attrs?.length ? ` [${s.attrs.join(", ")}]` : ""}: ${s.label}`)
    .join("\n");
}

export function formatGuide(): string {
  return `# The Fenna Docs format

## Files
- doc.json: {"format":"fenna-docs/0","title","tabs":[{"id","title","children":[…]}],"fonts":{"headings":"serif"|"sans","text":"serif"|"sans"},"wide":false,"dropdowns":[{"id","name","options":[{"id","label","color"}]}]}. Change it with update_doc, never by writing tabs.
- tabs/<id>.html: exactly one <article id="<id>"> holding blocks, one per line. Tab ids: a letter, then letters, digits, - or _.
- assets/: images. An <img src> is "assets/<file>"; never a URL or data: URI.
A tab's title is in doc.json (it is shown as the page's title); don't repeat it as the first heading.

## Blocks (direct children of <article>; each has an id)
${blockList()}
List items (<li>) hold text, then optionally one nested <ul> or <ol> (up to ${LIMITS.listDepth} levels). A checklist is <ul data-checklist>; a done item is <li data-checked>.
Tables: <tr> directly in <table> (no thead/tbody); a first row of <th> is the header row. Up to ${LIMITS.tableRows} rows × ${LIMITS.tableCols} columns; cells hold text, not blocks.
Images: <figure id="…" data-width="60"><img src="assets/x.png" alt="what it shows"><figcaption>optional caption</figcaption></figure>. data-width is a percentage of the page width (10–100; default 100).
Block ids: keep the ids of blocks you keep, so comments stay attached. New blocks may leave id out; one is assigned (edit_blocks returns it).

## Inside text
${inlineList()}
Links: https://…, mailto:… or #<tab id or block id> (a link to another tab or a heading).
Colored text: <span data-text="<color>">…</span>, colors: ${TEXT_COLORS.join(", ")}. Use color and <mark> highlights sparingly.
Dates: <time datetime="2026-11-12">…</time>; the text is filled in for you.
Dropdowns: <span data-dropdown="<dropdown id>" data-value="<option id>">…</span>; the label is filled in for you. The dropdown must exist in doc.json first. Colors: ${OPTION_COLORS.join(", ")}. Ready-made: ${DROPDOWN_TEMPLATES.map((d) => `${d.id} (${d.options.map((o) => o.id).join(", ")})`).join("; ")}.
No style, class or other attributes anywhere: how text looks comes from the block it is in and the doc's fonts.

## Suggestions
Text inside <ins data-sid> / <del data-sid> is a suggested change nobody has accepted yet. Leave those marks as they are. When the doc is in Suggesting mode (suggesting: true in doc_overview) your own edits become such marks on their own: write the text as it should read, never the marks.

## Writing well
- One idea per paragraph; short paragraphs. Headings that say what the section concludes, not just its topic.
- h1 for the main sections of a tab, h2 and h3 below them. Don't skip levels.
- Lists for parallel items, a table when items share attributes, a checklist for things to do.
- Change only what was asked. When rewriting part of a tab, use edit_blocks on those blocks.`;
}
