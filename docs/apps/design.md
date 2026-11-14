# Fenna Design: the artboard canvas

An open-source, AI-native design canvas that lives on the user's computer.
A document is a folder with `design.json`, one HTML file per artboard, and
assets. Any AI that speaks MCP can read and edit it; the user edits by
clicking and typing, dragging, drawing, or through the properties panel.

Stage: production (verified and finished 2026-11-14, see `docs/reviews/design-2026-11-14.md`).

## Brief

```
app                 apps/design
format              packages/artboard
mcp                 packages/artboard-mcp (draft for build)
example             examples/sample-design
reference           example-screenshots-designs/ (22 captures)
task                docs/tasks/design-build.md
```

## Structure

- One format: a design folder has `design.json` (title, pages, artboard
  positions and presentation order, tweaks, text styles, fonts),
  `artboards/<name>.html` (standalone semantic HTML with inline CSS and an
  injected `<style>:root { ... }</style>` of the design's tweaks),
  `assets/` (images and media), `notes.json` (stickies and freehand pencil
  drawings outside artboards), `comments.json` (threads on artboards and
  layers) and `history.json` (recent revisions).
- One renderer: `artboardMarkup(doc)` in `packages/artboard` returns the
  body markup and the stylesheet; the canvas, the focused view, the Home
  cover and the exports all go through it. On the canvas each artboard is a
  shadow root (its stylesheet plus the body), scaled with the view, so
  in-place text editing and selection work as in slides.
- Edits go through the format: change the parsed tree, write
  `serializeArtboard(tree)`; the properties panel, the Code tab, the floating
  bar and the MCP server all end in the same writer. A file that fails to
  parse is shown with its problems and never written over.
- Export: PNG and PDF are made by the main process from the standalone HTML
  in a hidden window (`capturePage` at the scale, `printToPDF` at the
  artboard's size), as the slides app does; HTML is the file with assets as
  data URIs. "All artboards" exports follow `order` within the page.
- Structure follows `apps/whiteboard` (main process, shell wiring, store
  with commit/preview/undo, canvas gestures, dock, zoom menu, floating bar,
  comments, history, export) and `apps/desktop` (format-backed editing,
  properties fields, color control, in-place text editing). Shared UI comes
  from `packages/shell`. `docs/tasks/design-build.md` names the files.

## Agent tasks

Run with two models on fresh copies of `examples/sample-design`. The sample
holds a "Card" artboard (as in the reference), a "Landing" artboard (1280 px
wide page), a tweak `--accent`, the three named text styles, one image in
`assets/`, and one open comment asking for a change.

1. Make a 1080×1080 social post from a short brief (event name, date,
   place, one line of copy): a new artboard on the first page, placed beside
   the others, the theme's styles and `--accent`, nothing overflowing.
2. Make a phone screen (390×844) of a settings page with a header, a list of
   six rows with labels and values, and a primary button at the bottom, as a
   new artboard; then a second artboard "Settings · Dark" linked from a
   button on the first, with the same layout in dark colors.
3. Act on the open comment (it asks for a change to a layer on "Card"),
   change exactly that, and reply in the thread saying what was done.
4. Change `--accent` for the whole design and make "Landing" use it for its
   primary button and headline underline, without touching other artboards'
   text.

## Decisions

- 2026-11-13: Artboards are plain standalone HTML with inline CSS, so an AI
  that already writes web pages writes them on the first try, and the panel,
  the Code tab and the file show the same declarations. No runtime, no
  scripts.
- 2026-11-13: The format package builds on `@opendeck/format` (value
  checks, parse and serialize of inline styles, tree edits) instead of
  copying it; the element and property tables are its own.
- 2026-11-13: Tweaks are the design's CSS variables, kept in `design.json`
  and written into every artboard's `:root` on save, so a file is complete
  on its own and one change moves the whole design.

- 2026-11-13: Format and server were rewritten after the stage-1 draft: the
  head of an artboard file is generated (tweaks, text styles, shapes), tools
  read and edit only the root element, history stores whole versions, links
  may point at other artboards (`href="Pricing.html"`).
- 2026-11-14: PNG export sets the viewport and pixel ratio through the DevTools
  protocol, never the hidden window's size, which Windows clamps to the screen.

## Build and finish summary

Checked: `npm run typecheck` (all projects) and `npm test` (38 files, 385
tests) pass. In the running app, on a copy of the sample: the canvas renders
the sample, an artboard and a layer select, the properties panel (tree, Size,
Layout, Text, Appearance, Effects, Link, Export, Advanced), Code and Tweaks
tabs open, and double-click typing in a heading saves
`artboards/Card.html` and undo restores it.

The flows above, exports on disk and the four agent tasks (Gemini 3.8 Flash and
Claude Sonnet 4.6) were checked in `docs/reviews/design-2026-11-14.md`.

Guesses: shape kinds in the dock are rect, ellipse, arrow-right and line;
"Layout guides" outlines the layer under the pointer and what the selected
container holds; History keeps 30 whole versions.

Core changes needed: none beyond `scripts/` and root `package.json`
(already changed for the new app).
