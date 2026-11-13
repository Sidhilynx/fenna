# Fenna Docs (docs)

Stage: production
Reference: `example-screenshots-docs/`
Code: `apps/docs`, `packages/doc`, `packages/doc-mcp`

## What it is for

A writing app for people who draft with an AI beside them: memos, plans,
briefs, notes. A doc is a folder on their computer (one HTML file per tab),
so it outlives the app and any AI that speaks MCP can read and edit it while
they watch. In five minutes a person should be able to start a doc, write
and format it, ask the AI for a change, and comment or suggest edits.

## What it must do

- Create, open, save: Home with recent docs; open a folder; start blank or
  from a prompt; every keystroke saved. (Home is the shell's.)
- Edit: title and body; headings, lists, checklists, quote, code, divider,
  tables, images, dates and dropdown chips; tabs and nested tabs with a "…"
  menu (rename, duplicate, add subtab, move, delete). Reference 001502,
  001620, 001627, 001637, 001700, 001714–001752, 001829, 001853.
- Format a selection: the bar over selected text (AI, comment, style, B I U
  S, code, color and highlight, lists, link). Reference 002617–002652.
- Editing and Suggesting modes; suggestion cards to accept or reject.
  Reference 001522, 001541.
- Comments in the margin, optionally sent to the AI. Reference 001559, 001752,
  002652.
- Work with the AI: the Ask box under the page, and the chat column.
  Reference 001653.
- Share and export: Word, PDF, Markdown, web page. Reference 002054 (export
  half).

## What it must not do

- Accounts, invitations, public links, "send to" another company's app. The
  doc is a folder; sharing it is sharing the folder (see Decisions).
- Emoji reactions on blocks.
- Voice input.

## Agent tasks

1. Act on the open comments: make the changes they ask for and reply in each
   thread saying what was done.
2. Change a phrase in a tab, and leave a comment on a heading asking a
   question.
3. Add a tab after a given one that summarizes two other tabs, using only
   facts from the doc; rename a heading.

## Decisions

- Export only, no Share panel: a local-first doc has no server to invite
  people to; the folder is the thing shared. 2026-11-12.
- One icon set for every app (`packages/shell/renderer/ui/glyphs.ts`): a
  20-unit grid, stroke scaled by size, soft tint and solid accents. No
  third-party icon set anywhere, including the window strip. 2026-11-12.
- Bundled fonts: Inter for the interface, Newsreader for serif text, both
  SIL OFL, so every machine renders the same app. 2026-11-12.
- Menus show a selected item's check at the right in the accent color, as in
  the reference. 2026-11-12.
- The MCP server edits by quoted HTML (`replace_text`) as well as by block
  id, and reads and writes comments; modeled on Claude's own docs tools.
  2026-11-12.
- Editing or Suggesting is part of the doc (doc.json `suggesting`), not the
  window: every editor and every AI on the doc follows it, and an AI's edits
  in Suggesting mode are saved as its suggestions by the server, never by
  the model writing marks. Switching mode is not an undo step. 2026-11-12.
- A tab file the format can't hold is shown as the lenient reader keeps it,
  never as an empty page that the next save would write over. 2026-11-12.
- Export is a panel under its button (reference 002054, export half), and
  links are added in a card under the words (002643), not modal dialogs.
  2026-11-12.
- App icons are one neutral family ("Dot"): a paper shape on an ink tile with
  a round bite and a dot at its bottom-right corner, the same for slides,
  docs and sheets. No accent color in any icon. Drawn by
  `scripts/make-icons.cjs`. 2026-11-12.
- The AI is named for what the user connected: "@Claude", "@Codex" or
  "@Antigravity" in the empty page's hint, the "@" menu and the Ask button,
  with its maker's mark; with nothing connected, "@AI" and the app's icon.
  2026-11-12.
- "@" in the text opens a menu (Ask the AI, Dates, Tabs). Choosing the AI
  opens a box on that line ("Tell Claude what to write or edit"): on an empty
  line it takes the line's place and the AI writes there; under a line with
  words it is about that line. No People section: a local doc has no
  accounts, and a person chip would need a new inline element in
  `packages/doc`. 2026-11-12.
- Beside the line under the pointer: the AI's mark, which opens that box.
  Tables, images and dividers keep a "…" menu instead. The line is found by
  the pointer's height across the whole page column, so the button can be
  reached. 2026-11-12.
- The comment button on the bar opens a Comments column (all threads, open
  or resolved, this tab or all) in the chat's place; new comments start from
  the selection bar or Ctrl+Alt+M. 2026-11-12.
- 2026-11-13: The family is called Fenna, by Sidhilynx ("Fenna Docs"); MCP server `fenna-docs`, format marker `fenna-docs/0` (the old marker is still read). Chosen after a trademark and name search; Lynx and the open- names were taken.
- 2026-11-13: No login or account in the app. Demand is measured by release downloads, not by users; a future cloud service will be optional. Home's bottom-left shows an available update, never a person.

## Build summary

Written after the fact by the finish pass (the builder left none): the
editor, the format and its validator, export to Word, PDF, Markdown and HTML,
comments, suggestions and a draft MCP server were all in place and working.
See `docs/reviews/docs-2026-11-12.md` for what the finish pass changed.
