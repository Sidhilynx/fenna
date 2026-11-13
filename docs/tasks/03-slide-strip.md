# Task 03 — Slide strip: menu, multi-select, drag to reorder

Read `AGENTS.md` first. This task upgrades
`apps/desktop/src/renderer/SlideStrip.tsx` (the thumbnail column).

## Files you may change

- `apps/desktop/src/renderer/SlideStrip.tsx`
- `apps/desktop/src/renderer/strip.css` (new; import it from SlideStrip.tsx; existing
  `.strip*` / `.thumb*` rules in styles.css stay — add to them here, don't copy them)

## APIs (read the files)

`./editor/store.ts`: `useEditor`, `getState`, `setState`, `goTo`, `addSlide(layoutKey?, afterIndex?)`,
`duplicateSlides(ids)`, `deleteSlides(ids)`, `moveSlides(ids, toIndex)`, `toggleSkip(ids)`,
`editIndex`. State: `s.slideSelection` (ids selected in the strip), `s.current`.
`@opendeck/format`: `setSection`. `./ui/Menu.tsx`: `Menu`, `shortcut`. `./ui/icons.tsx`: `Icon` (`dots`).

## Behavior

- Click: current slide (keep existing `goTo`), and slideSelection = [that id].
- Ctrl/Cmd+click toggles a slide in slideSelection; Shift+click selects the range from the current.
- Hovering a thumbnail shows a "…" button at its bottom-right (24px, `icon-btn`
  style, `var(--raised)` background); it opens the same menu as right-click.
- Menu (for the selection, or the clicked slide): Duplicate slide (Mod+D), Copy link to slide
  (copies `#slide-N` to the clipboard with `navigator.clipboard.writeText`), Skip slide / Show slide,
  separator, Add slide after, Start a section here (prompts inline: the section label becomes an
  input above the thumbnail; Enter saves with `setSection`), Move up, Move down (disabled at the ends),
  separator, Delete slide (danger, Backspace/Delete).
- Keyboard while the strip has focus (make the nav focusable, `tabIndex={0}`, visible focus ring):
  ↑/↓ change the current slide; Shift+↑/↓ extend the selection; Delete/Backspace deletes the selection
  (or the current slide); Mod+D duplicates; Alt+↑/↓ moves the selection up/down by one.
  These must NOT fire while the canvas has a selected element or you're typing anywhere.
- Drag to reorder: dragging a thumbnail (or the selection) shows a 2px `var(--sel)` line where it
  will land; dropping calls `moveSlides(ids, index)` (index in the list WITHOUT the moved slides).
  Auto-scroll the strip when dragging near its top/bottom edge. Use pointer events, not HTML5 DnD.
- Double-click a section label to rename it inline (`setSection`; empty removes it).

## Done when
- [ ] All of the above work on the sample deck.
- [ ] Typecheck passes.
- [ ] Tokens only in CSS.
- [ ] Summary of what works and anything you could not do.
