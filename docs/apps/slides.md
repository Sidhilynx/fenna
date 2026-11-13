# Fenna Slides (slides)

Stage: production
Reference: `example-screenshots-slides/`
Code: `apps/desktop`, `packages/format`, `packages/render`, `packages/mcp`

## What it is for

A slide editor for people who build decks with an AI beside them: pitches,
reviews, plans, talks. A deck is a folder on their computer (`deck.json` and
one HTML file per slide), so it outlives the app and any AI that speaks MCP
can read and edit it while they watch. In five minutes a person should be
able to start a deck from a starter, edit a slide on the canvas, ask the AI
for a change, comment on an element, present, and export.

## What it must do

- Create, open, save: Home with recent decks and starters; open a folder;
  every change saved as it is made, with undo and redo. Rename the deck from
  its title menu. (Home and the window strip are the shell's.)
- Edit: select, type, drag and resize with guides; insert text, images,
  tables and shapes (reference 134753, 134806); the Design panel for the
  slide, an element or several (134642, 140101, 140126, 140137); theme
  colors, fonts and text styles. Formatting bar over a selected text box.
- Slides: thumbnails with sections, the slide menu (134257, 135248), new
  slide from layouts (134702), grid view by section (135932), speaker notes,
  View menu toggles for thumbnails and notes (134708), zoom menu (134653).
- Work with the AI: the chat column, with what the user is looking at
  (slide, selection) as context; comments on an element, optionally sent to
  the AI (134323, 134357). Edits from the AI land live on the canvas.
- Present: full screen, transitions, builds (134624).
- Export: PDF, PNG of a slide, one-file web page, PowerPoint with deck fonts
  or basic fonts (134630, 134559).

## What it must not do

- Accounts, invitations, public links, presence or "Follow me" (134434,
  134546 share half, 134714). The deck is a folder; sharing it is sharing
  the folder.
- "Send to" another company's app (134546, Google Slides).
- Connectors (lines that stay attached to shapes) in this version; see
  Decisions.

## Agent tasks

1. Act on the open comments: make the changes they ask for and reply in each
   thread saying what was done.
2. Change a row of a table on a named slide, and leave a comment on another
   slide's element asking a question.
3. Add a slide after a given one that turns facts from another slide into a
   table, in the deck's look, using only facts already in the deck.

## Decisions

- Export only, no Share panel, as in docs: a local-first deck has no server
  to invite people to. 2026-11-12.
- The MCP server edits like a file editor: `read_slides` returns each slide
  as the exact text on disk (not JSON), `edit_slide` replaces exact quoted
  text, `write_slide(s)` writes whole slides. Modeled on the reference
  product's own slide tooling. 2026-11-12.
- Comments are read and written through MCP (`read_comments`, `comment`);
  a thread is anchored by slide, element address and the element's words,
  in `@opendeck/format` (`anchor.ts`), shared by the editor and the server.
  2026-11-12.
- The header matches docs: the title opens a menu (Rename, Undo, Redo) and
  the chat toggle reads "Show chat" / "Hide chat"; no sparkle mark. 2026-11-12.
- Grid view and "Slide thumbnails" off hide the strip; Add slide and View
  then float at the stage's top left, as in reference 135932. 2026-11-12.
- The Design panel starts closed in windows narrower than 1280px, so the
  slide gets the room; it remembers the person's choice after that.
  2026-11-12.
- Shapes have single-key shortcuts (R, Shift+R, O, D, L) shown in the shape
  menu with one glyph each from the shared set. 2026-11-12.
- No connectors in v1: they need a new element in the format, the renderer,
  editor handles and the PowerPoint exporter. Lines and arrow shapes cover
  diagrams until then. 2026-11-12.
- 2026-11-13: The family is called Fenna, by Sidhilynx ("Fenna Slides"); MCP server `fenna-slides`, format marker `fenna-slides/0` (the old marker is still read). Chosen after a trademark and name search; Lynx and the open- names were taken.
- 2026-11-13: No login or account in the app. Demand is measured by release downloads, not by users; a future cloud service will be optional. Home's bottom-left shows an available update, never a person.

## Build summary

Written after the fact by the finish pass (the builder left none): the
canvas editor, format and validator, renderer, Design panel, strip, grid,
present, exports, comments, chat and a draft MCP server were in place and
working. See `docs/reviews/slides-2026-11-12.md` for what the finish pass
changed.
