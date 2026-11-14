# Task: build Fenna Design (stage 1)

Read first: `AGENTS.md`, `docs/process.md`, `docs/apps/design.md`,
`example-screenshots-designs/catalogue.md` and every image it names, then
`.agent/skills/opendeck-build/SKILL.md` and the skills it points to.

You are the stage-1 builder. Most of this app exists already in two other
apps. Your job is to copy, rename and join, not to invent. Where this task
names a file, start from that file. Do not change `packages/shell`,
`packages/format`, `packages/render`, `packages/board`, any other app, or
anything in `scripts/`. If you need a change there, write it under "Core
changes needed" in the build summary and work around it inside your own
folders.

Folders you create: `apps/design`, `packages/artboard`,
`packages/artboard-mcp`, `examples/sample-design`. Nothing else.

## Order of work

1. `packages/artboard`: schema, parser, validator, serializer, renderer,
   design.json index, notes, tests, and `examples/sample-design` with zero
   problems.
2. `apps/design` main process and app shell (copy of the whiteboard's).
3. Canvas with artboards, pages, zoom, dock, selection, move and resize.
4. Properties panel, Code tab, Tweaks tab, floating bars, in-place text.
5. Focused view, exports, Home cover, comments, history, Ask bar, chat.
6. `packages/artboard-mcp` (draft, marked `draft` in its README), then the
   four agent tasks with two models through `scripts/agy-try.mjs --design`.
7. Full pass: every catalogue image against a capture at 1440×900 and
   1000×700, dark and light; edge cases; tests; typecheck; the hand-over in
   the brief's "Build summary".

Each slice ends with screenshots you have looked at (`scripts/shot.mjs
--app design --file examples/sample-design ...`).

## 1. `packages/artboard` (format)

Copy the package shape of `packages/board` (`package.json`, `tsconfig.json`,
`src/index.ts`, tests beside the sources). Depend on `@opendeck/format`
(workspace) and import from it; never copy its files.

| File | Start from | What it holds |
|---|---|---|
| `src/schema.ts` | `packages/format/src/schema.ts` (pattern), `packages/board/src/schema.ts` (LIMITS, palettes) | `FORMAT = "fenna-design/0"`, `LIMITS`, `ELEMENTS` (slides' table plus `button`, `label`, `input`, `h4`–`h6`; root is any block element, not `section`), `PROPERTIES` (slides' list plus the ones the brief adds; `margin` and `box-sizing` are real properties here), `GROUPS` in panel order (size, layout, text, appearance, effects, link, advanced), `SHAPE_KINDS` from `@opendeck/format`, `LAYER_KINDS` and `layerKind(node)` (Column, Row, Grid, Box, Heading, Text, Image, Shape, Link, Button, List, Item, Table, Rule, Input), `DEFAULT_TEXT_STYLES` (Heading 1 72px, Body 24px, Caption 16px), `BOARD_SIZES` (Artboard 800×600, Phone 390×844, Social 1080×1080, Page 1280 wide). |
| `src/artboard.ts` | `packages/format/src/slide.ts` | `parseArtboard(html, ctx)` → `{ doc: { title, style (the `<style>` text), root: ElementNode }, diagnostics, ok }` reusing `parseStyle`, the value checks and the diagnostic codes of `@opendeck/format`; `serializeArtboard(doc)` (canonical, 2-space indent, `:root` tweaks first in the stylesheet); `newArtboardHtml(size)`. Every diagnostic has a line, a path and a message that says how to fix it. |
| `src/design.ts` | `packages/format/src/deck.ts`, `packages/board/src/board.ts` | `checkIndex(raw)` for design.json (pages, boards, order, tweaks, textStyles, fonts), `indexText`, `newDesignFiles(title)`, `loadDesign(reader)` (every artboard parsed; a file that fails stays listed with its problems and its source), `parseHistory`, `newId`. Tweaks are `--name` keys with a value that passes `color` or `length`. |
| `src/notes.ts` | `packages/board/src/schema.ts` sticky and drawing kinds, `packages/board/src/text.ts` | `notes.json`: `{ items: [...] }` of stickies (text, fill color name, x, y, w, h, page) and strokes (points, width, ink color name, page). Reuse the whiteboard's color names and the text wrap. |
| `src/render.ts` | `packages/render/src/index.ts` | `artboardMarkup(doc, opts)` → `{ css, html }`: the stylesheet (tweaks as `:root`, text styles as `[data-style="…"]` rules, then the file's own basics) and the body markup with `data-od="<address>"` when `annotate`; `standaloneHtml(doc, assets)` for export with assets inlined; `elementAt`, `layerLabel`. One renderer for the canvas, the focused view, the cover and export. |
| `src/edit.ts` | `packages/format/src/edit.ts` (import it) | Only what slides lacks: `wrapIn(tree, addrs, "column"|"row"|"grid")`, `unwrap`, `setTweak`, `applyTextStyle`, `layerTree(root)` (the rows the panel shows). |
| `src/index.ts` | `packages/board/src/index.ts` | Re-exports. |
| `test/*.test.ts` | `packages/format/test`, `packages/board/test` | Parse, check, serialize round trip, broken files, limits (300 elements, depth 16, 40 artboards), the sample loads clean, layer kinds, tweaks written into `:root`. |

`examples/sample-design`: "Card" (880×420, the reference's cream card with
`--accent`), "Landing" (1280 wide, `expand: "fill"`, a nav row, a hero with a
headline, a paragraph, a primary button, three feature columns, an image
from `assets/`), two pages ("Page 1" with both, "Mobile" empty), one open
comment on Card's paragraph asking to shorten it, `history.json` with one
version.

## 2. `apps/design` main process and shell

| File | Start from | Change |
|---|---|---|
| `package.json`, `tsconfig.json`, `vite.config.ts`, `scripts/dev.mjs`, `scripts/build-mcp.mjs`, `build/icon.png` | `apps/whiteboard/*` | Names (`@opendeck/design`, "Fenna Design", `fenna-design-mcp`), the Vite port (5185), `OPENDECK_DESIGN`, default folder `examples/sample-design`, icon from `docs/media/icons/design.png`. |
| `src/main/main.cjs` | `apps/whiteboard/src/main/main.cjs` | Marker `design.json`; file whitelist `design.json`, `notes.json`, `comments.json`, `history.json`, `artboards/*.html`, `assets/*`; `describeDesign` (title, artboard count, the first artboard's file for the cover); prefix `design`, scheme `oddesign`. |
| `src/main/export.cjs` | `apps/desktop/src/main/export.cjs` (PNG via `capturePage`, PDF via `printToPDF` with the artboard's size) and `apps/whiteboard/src/main/export.cjs` (save dialog, `OPENDECK_EXPORT_DIR`) | Channels `designExport:png`, `designExport:pdf`, `designExport:save`; the hidden window loads the standalone HTML; "all artboards" makes one PDF with one page per artboard, or a folder of PNGs. |
| `src/main/assistant.cjs` | `apps/whiteboard/src/main/assistant.cjs` | Server `packages/artboard-mcp/src/cli.ts`, `--design=`, the note and tool labels for the design tools. |

## 3. Renderer: canvas, store, dock, view

| File | Start from | Change |
|---|---|---|
| `src/renderer/main.tsx`, `index.html`, `theme.ts`, `assistant.ts`, `api.ts`, `comments.ts` | `apps/whiteboard/src/renderer/*` | Names; `api.ts` channels `design:*`, `designExport:*`; the comment anchor is `{ file, address?, quote? }`. |
| `src/renderer/store.ts` | `apps/whiteboard/src/renderer/store.ts` | Keep: state and `useDesign` hook, load/reload with own-write detection, save queue, `commit`/`preview`/`undo`/`redo`, history snapshots, View, `zoomTo`/`zoomIn`/`zoomOut`/`fit`/`setView`, selection, panel, agent, clipboard. Replace items with `{ index, boards: Map<file, {doc, source, diagnostics}>, notes, page }`. Selection is `{ file, addresses: string[] }` (addresses as `@opendeck/format` uses them; `""` is the artboard root). Saving writes only the changed artboard file, or design.json, or notes.json. |
| `src/renderer/App.tsx` | `apps/whiteboard/src/renderer/App.tsx` | Same layout and key map; add Shift+G (guides), Shift+2 (zoom to selection), the tool keys from the dock below, Mod+D duplicate, Mod+Enter (focused view). |
| `components/Canvas.tsx` | `apps/whiteboard/src/renderer/components/Canvas.tsx` | Keep the transform math, wheel and pinch, space and middle pan, marquee, move with preview, resize handles, culling, ResizeObserver, fit. Items are artboards (name strip above each, as 204354) and notes. Inside a selected artboard, clicks select layers by `data-od` (as `apps/desktop/src/renderer/editor/Canvas.tsx` does with `pickAddress`); the outline and 4 corner handles come from the whiteboard's SelectionLayer. Drop the whiteboard's connector, table, frame-title and sticker code. |
| `components/ArtboardView.tsx` | `apps/desktop/src/renderer/SlideView.tsx`, `editor/LiveSlide.tsx` | A host element with a shadow root: `<style>` from `artboardMarkup().css`, then the html with `data-od`. In-place editing with `editor/textEdit.ts` (copy as is) and the `FormatBar` pattern. |
| `components/Dock.tsx` | `apps/whiteboard/src/renderer/components/Dock.tsx` | Tools and keys: select V, hand H, text T, artboard A (flyout: the `BOARD_SIZES`), sticky S, pencil P (flyout: 5 widths and dashed, as 204311), shape R (flyout: rect, oval, arrow, line, as 204321), comment C; "Ask" toggle inside the pill. |
| `components/ViewControls.tsx` | `apps/whiteboard/src/renderer/components/ViewControls.tsx` | The pill: Play (focused view), properties toggle, zoom menu with exactly the items of 204431 (Zoom in, Zoom out, Fit artboards Shift+1, Zoom to selection Shift+2, Now N%, presets, Layout guides Shift+G, Undo, Redo). No timer. |
| `components/PagePill.tsx` | shell `MenuButton` | "Page 1 ⌄" at top left with the menu of 205016 (pages with a check and a "…" submenu: Rename, Delete; New page). |
| `components/FloatingBar.tsx` | `apps/whiteboard/src/renderer/components/FloatingBar.tsx` (positioning, Btn, Sep, Popover, more menu) and `apps/desktop/src/renderer/editor/FormatBar.tsx` (text controls) | Artboard selected: fill swatch, align, radius, size, comment, more (204823). Text selected: style menu (Theme tab with the named styles and their px, Custom tab), color, B, I, U, link, list, align, comment, more (204952, 205008). Box or image selected: fill, radius, border, opacity, comment, more. |
| `components/menus.tsx` | `apps/whiteboard/src/renderer/components/menus.tsx` | The "…" and right-click menu: Rename, Duplicate (Mod+D), Cut, Copy, Paste, Wrap in column / row / grid, Unwrap, Bring forward, Send backward, Lock, Delete, Ask (Mod+K). |
| `components/HeaderBar.tsx` | `apps/whiteboard/src/renderer/components/HeaderBar.tsx` | Title menu (Open chat, Comments, Version history, Rename, Duplicate, Refresh, Undo, Redo); the shell `ExportButton` with HTML, PDF, PNG rows and their hints (204200); Show/Hide chat. |
| `components/FocusView.tsx` | `apps/desktop/src/renderer/Present.tsx` (window-level view) | The second header row of 204406 (back, title, export, Fill/Fit); the artboard alone through the same renderer; `<a href="Other.html">` switches artboards. Esc leaves. |
| `components/CommentLayer.tsx`, `RightPanels.tsx`, `AskBar.tsx`, `Home.tsx` | `apps/whiteboard/src/renderer/components/*` | Comments and history as is; the chat context is the design's title, pages, artboards and the selection; the Home cover renders the first artboard with `artboardMarkup` into a scaled shadow root. |
| `components/NotesLayer.tsx` | whiteboard `Canvas.tsx` sticky and pen gestures, `packages/board/src/render.ts` sticky drawing | Stickies and pencil strokes on the canvas, outside artboards, saved to `notes.json`. |
| `styles.css` | `apps/whiteboard/src/renderer/styles.css`, `apps/desktop/src/renderer/styles.css` | Prefix `.dg-`; tokens only from the shell; the artboard is the only colorful thing. |

## 4. Properties panel

| File | Start from | Change |
|---|---|---|
| `panels/Fields.tsx`, `panels/ColorControl.tsx`, `panels/utils.tsx` | `apps/desktop/src/renderer/panels/inspector/Fields.tsx`, `ColorControl.tsx`, `utils.tsx` | Copy as is (drop `computedOf` and `domBox`). |
| `panels/PropertiesPanel.tsx` | `apps/desktop/src/renderer/panels/Inspector.tsx`, `panels/inspector/ElementInspector.tsx` | Tabs Properties / Code / Tweaks and a close button (204834). The layer tree (`layerTree` from the format: chevrons, kind icon, kind, quoted text, drag to reorder and re-parent, selected row). The align row (6 buttons). Sections in this order with exactly these rows: **Size** Width (value + Fixed/Fill/Hug), Height (same), Position (Inline/Absolute, with Left/Top when absolute); **Layout** Layout (Stack/Grid/None), Direction (→ ↓, wrap), Align (3 + 3 + stretch), Gap, Padding (with per-side toggle), Columns/Rows when grid; **Text** Font, Weight, Size, Spacing (line, letter), Color, Align; **Appearance** Fill (with remove), Opacity (field + slider), Radius (with per-corner toggle), Border (none/solid/dashed/dotted, then width and color); **Effects** Shadow, Blur, Blend; **Link** Destination; **Export** preview, Format, Scale, Export button (204856); **Advanced** every remaining property of the schema's advanced group as a labelled field (204910), Overflow as a menu. Every change goes through `setStyle` on the parsed tree and one `commit`. |
| `panels/CodeTab.tsx` | new, small | `<tag>` and the quoted text, then the inline declarations one per line (204931), editable as text; on blur, parse with the format and commit or show the problem. |
| `panels/TweaksTab.tsx` | `apps/desktop/src/renderer/panels/inspector/ThemeSection.tsx` (colors part) | One row per tweak: name, swatch or field (204940); add, rename, remove; a change rewrites `:root` in every artboard through the format. |
| `panels/inspector.css` | `apps/desktop/src/renderer/panels/inspector/inspector.css` | Keep rows and fields; prefix `.dg-`. |

## 5. `packages/artboard-mcp` (draft)

Copy `packages/mcp/src` (cli, index, guide, store) and rename. Tools, shaped
like the slides server, which Claude designed: `design_overview`,
`format_guide` (generated from `packages/artboard` lists), `read_artboards`
(exact HTML with version and problems), `edit_artboard` (find/with, exact
match, all or nothing), `write_artboard` (whole file; `x`, `y`, `w`, `h`,
`page`, `title`, `after` for placement; placed beside the others when `x`
and `y` are left out), `check_artboard`, `delete_artboards`,
`arrange_artboards` (positions, order, page), `read_comments`, `comment`,
`update_design` (title, pages, tweaks, textStyles). Writes are atomic
(`writeText` from `packages/board-mcp/src/store.ts`); a broken file is never
written over. Mark the README `draft`.

## Acceptance

- Every image in the catalogue has a matching capture, both sizes, both
  themes, looked at.
- `examples/sample-design` loads with zero problems; a damaged artboard file
  shows its problems and is byte-identical after any edit attempt.
- Each panel row changes the file (check on disk after a scripted edit).
- Undo after every kind of change; reload after an external edit.
- The four agent tasks pass with two models; traces read; results on disk.
- `npm test` and `npm run typecheck` pass; no new dependencies; no raw hex,
  emoji, TODO, console.log or dead code.
- The hand-over in `docs/apps/design.md` under "Build summary".
