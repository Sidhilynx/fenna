# Fenna Whiteboard (whiteboard)

Stage: production
Reference: `example-screenshots-whiteboard/` (images), and
`example-screenshots-whiteboard/claude-tools/` (Claude's whiteboard tools and
skills, when present; internal, never copied or published)
Code: `apps/whiteboard`, `packages/board`, `packages/board-mcp`

## What it is for

An infinite canvas for thinking with an AI beside you: brainstorms, retros,
flowcharts, diagrams, plans laid out in space. People put down sticky notes,
text, shapes and frames, connect them with arrows, move and group them, and
comment. A board is a folder on their computer, so it outlives the app, and
any AI that speaks MCP can read and change it while they watch. In five
minutes a person should be able to start a board, add stickies and shapes,
connect them, arrange them, and ask the AI to lay out or tidy a board.

## What it must do

The catalogue in `example-screenshots-whiteboard/catalogue.md` (local, like
the images) maps each flow to its reference images; this list is the scope.

- Create, open, save: Home with recent boards (a legible thumbnail); open a
  folder; start blank or from a prompt; every change saved; undo and redo;
  version history with restore.
- Canvas: pan (hand tool, space-drag, scroll), zoom (Ctrl+wheel, pinch,
  the zoom menu with zoom in/out, fit, presets), a dot or grid background,
  smooth with thousands of items.
- Tools (bottom bar): select, hand, text, frame, sticky note, connector
  (arrow), shapes (the full shape library shown in the reference), and
  whatever else the bar shows (each catalogued). Single-key shortcuts for
  tools, with the setting to turn them off.
- Items: sticky notes (colors, author name), text (styles such as Body,
  bold, italic, link, lists, alignment), shapes with text inside, frames
  that hold items and move with them, connectors that stay attached to
  items as they move (solid or dashed, colors, arrowheads), images.
- Selecting and arranging: click, shift-click, marquee; move, resize,
  rotate (with the angle badge); the floating bar for the selection; the
  "…" menu (lock, cut, copy, paste, duplicate, bring to front, send to back,
  group, ungroup, tidy up, delete, ask the AI) with its shortcuts.
- Comments on items.
- Timer (with the chime setting), as the reference shows.
- Work with the AI: the Ask button, Ctrl+K on a selection, the chat column.
- Export: PNG (and SVG if cheap), from the Export panel.

## What it must not do

- Accounts, invitations, public links, "Follow me", live cursors of other
  people, "send to" another company's app, usage limits. A board is a
  folder; sharing it is sharing the folder (as in docs and sheets).
- "Turn this board into slides/docs" for now (a later feature across apps).
- Nested frames more than one level deep.

## Decided before building

- Names: app `@opendeck/whiteboard` in `apps/whiteboard`; format
  `@opendeck/board` in `packages/board`; MCP server `@opendeck/board-mcp` in
  `packages/board-mcp` (CLI `packages/board-mcp/src/cli.ts`, flag
  `--board=<folder>`, server name `Fenna Whiteboard`); sample
  `examples/sample-board`; environment variable `OPENDECK_BOARD`; channel
  prefix `board`, asset scheme `odboard`. `scripts/shot.mjs` and
  `scripts/agy-try.mjs --board` already expect these names.
- File layout: a folder with `board.json` (format `fenna-whiteboard/0`, title,
  settings, people), `canvas.json` (every item with a stable id; z-order is
  array order), `comments.json` (the shell's thread format, anchored to an
  item id), `history.json` (versions), `assets/` (images). Coordinates are
  board units (1 unit = 1 CSS pixel at 100%).
- Item kinds, shape kinds, colors, line styles and arrowheads are lists in
  `packages/board/src/schema.ts`; the UI, the validator and the MCP server
  read them from there.
- One renderer: a single function draws an item (SVG), used by the canvas,
  PNG/SVG export and the Home thumbnail.
- Structure follows `apps/sheets` (main process, shell wiring, review
  harness, chat assistant, export) with names changed. Shared UI comes from
  `packages/shell` (Menu, MenuButton, Icon, ChatPanel, comments, Home,
  ExportButton, createAssistant).

## Agent tasks

Run with two models on fresh copies of `examples/sample-board`. The sample
must hold what tasks 3 and 4 need (a few stickies, one open comment asking
for a change).

1. Make a retro board from notes: three frames (Went well, To improve,
   Actions), the notes as stickies in the right frames, colored per frame,
   neatly in rows.
2. Draw a flowchart: Start, "Enter email", a decision "Valid?", yes to
   "Create account" and End, no back to "Enter email" with a label on the
   arrow. Shapes of the right kinds, connected, nothing overlapping.
3. Act on the open comment (it asks for a change to a sticky), and reply in
   the thread saying what was done.
4. Group the loose stickies by theme into labelled frames and tidy them up,
   without changing their text.

## Decisions

- 2026-11-13: canvas.json is `{ "items": [...] }`, one item per line. An item names its frame (`frame`); frames hold no child list. Connector ends are `{item, side?}` or `{x, y}`, so arrows follow items.
- 2026-11-13: Colors are names, never hex: pale fills (yellow … gray) and inks (default … purple), drawn darker on the light theme, so boards read in both themes.
- 2026-11-13: One renderer (`packages/board/src/render.ts`) and one text wrapper (`text.ts`) for canvas, PNG/SVG export, Home cover and the MCP layout check. Selection chrome is HTML over the SVG.
- 2026-11-13: Deleting a frame in the app deletes what it holds (undo brings it back); through MCP it keeps them unless `with_contents`. Connectors with a deleted end go too.
- 2026-11-13: Stickers are our own vector drawings; the reference's illustrations are another company's.
- 2026-11-13: Export (PNG at 2×, SVG with the font and images inside) stands in for Share, as in docs and sheets.
- 2026-11-13: The MCP server places items for the model (in frames that grow toward free space, or beside the board) and lays diagrams out along their connectors (`arrange`, `flow`); every result ends with a layout check.
- 2026-11-13: Tool descriptions say the board is the person's work: add beside it, never clear or rename it unasked (Gemini Flash cleared the sample in a test run).
- 2026-11-13: The family is called Fenna, by Sidhilynx ("Fenna Whiteboard"); MCP server `fenna-whiteboard`, format marker `fenna-whiteboard/0` (the old marker is still read). Chosen after a trademark and name search; Lynx and the open- names were taken.
- 2026-11-13: No login or account in the app. Demand is measured by release downloads, not by users; a future cloud service will be optional. Home's bottom-left shows an available update, never a person.

## Reviews

- [whiteboard-2026-11-13](../reviews/whiteboard-2026-11-13.md): verify and finish; stage moved to production.
