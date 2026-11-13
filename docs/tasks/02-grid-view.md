# Task 02 — Grid view

Read `AGENTS.md` first. This task replaces the placeholder in
`apps/desktop/src/renderer/panels/GridView.tsx`.

## What it is

The whole deck at a glance, grouped by section: shown in the centre area
when `state.view === "grid"` (View menu → Grid, or Ctrl+Alt+G).

## Files you may create or change

- `apps/desktop/src/renderer/panels/GridView.tsx` (replace the placeholder)
- `apps/desktop/src/renderer/panels/grid.css` (new; import it from GridView.tsx)

## APIs (read the files)

- `../editor/store.ts`: `useEditor`, `getState`, `setState`, `goTo(index)`, `setView("edit")`,
  `moveSlides(ids, toIndex)`, `deleteSlides(ids)`, `duplicateSlides(ids)`, `toggleSkip(ids)`,
  `editIndex(label, fn)`. State: `s.deck.slides` (`{id, slide, diagnostics}`), `s.deck.index.sections`
  (`{title, start}` — a section runs from its `start` slide to the next section's start),
  `s.current`, `s.slideSelection: string[]` (selected slide ids here).
- `@opendeck/format`: `setSection(index, startId, title)`.
- `../SlideView.tsx`: `FitSlide` (a slide that fills its container's width).
- `../ui/Menu.tsx`: `Menu` (right-click menu), `shortcut("Mod+D")`.

## Layout

- Scrolls vertically inside the centre area (grid-row 2 of `.center`; give your root `grid-row: 2; overflow: auto`).
- Max content width 1120px, centred, 32px side padding.
- Slides before the first section form an untitled group at the top (if any).
- Each section: its title as an editable heading (`var(--fs-lg)`, weight 500;
  click to rename inline, Enter saves via `setSection`, empty title removes the section)
  with a 1px `var(--line)` rule; then a grid of thumbnails, `repeat(auto-fill, minmax(220px, 1fr))`, 20px gap.
- Thumbnail: `FitSlide`, 4px radius, 1px `var(--line)` outline; number below-left
  (`var(--font-mono)`, `var(--text-3)`); skipped slides at 40% opacity; a slide with
  errors shows a small `var(--warn)` dot.
- The current slide has a 2px `var(--sel)` outline; selected slides (slideSelection) too.

## Behavior

- Click selects (and makes current). Ctrl/Cmd+click toggles; Shift+click selects a range.
- Double-click (or Enter) opens that slide in the editor: `goTo(i)` then `setView("edit")`.
- Arrow keys move the current slide across the grid; Delete deletes the selected slides;
  Ctrl+D duplicates them.
- Drag a thumbnail (or a selection) to reorder: show a 2px `var(--sel)` insertion bar
  between thumbnails; drop calls `moveSlides(ids, index)` where index counts the
  REMAINING slides (format's `moveSlides` semantics).
- Right-click: menu with Open, Duplicate, Skip slide / Show slide, Start a section here,
  Delete (danger).
- Esc returns to the editor.

## Done when
- [ ] Works on the sample deck: sections shown, rename a section, reorder by drag, open, delete, duplicate.
- [ ] Typecheck passes.
- [ ] Tokens only in CSS.
- [ ] Summary of what works and anything you could not do.
