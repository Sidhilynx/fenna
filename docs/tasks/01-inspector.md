# Task 01 — The Design panel (inspector)

Read `AGENTS.md` first. This task replaces the placeholder in
`apps/desktop/src/renderer/panels/Inspector.tsx`.

## What it is

The right-hand panel (296px wide, class `right-panel`, already laid out by
`App.tsx`) that shows and changes the selected element's design. With
nothing selected it shows the slide's settings. Every change is one undo
step and is written immediately.

## Files you may create or change

- `apps/desktop/src/renderer/panels/Inspector.tsx` (replace the placeholder)
- `apps/desktop/src/renderer/panels/inspector/*.tsx` (new, any helpers you need)
- `apps/desktop/src/renderer/panels/inspector.css` (new; import it from Inspector.tsx)

Nothing else. Do not edit `styles.css`, the store, the editor, or any package.

## APIs you use (read these files; don't re-implement them)

From `../editor/store.ts`:
- `useEditor(selector)` — read state. Relevant: `s.selection: string[]` (element
  addresses), `s.deck` (`LoadedDeck`: `index.theme`, `index.sections`, `slides`),
  `currentSlide(s)` → `{ id, slide: ElementNode | null, source }`.
- `editSlide(label, (slide, ctx) => newSlide)` — apply ONE change as one undo step.
- `editIndex(label, (index) => newIndex)` — change deck.json (sections, theme).
- `toast(text)` — short message.

From `@opendeck/format`:
- `getAt(slide, addr)`, `getStyle(el, name)`, `setStyle(slide, addr, name, value | null, ctx)`,
  `setStyles(slide, addr, {name: value|null}, ctx)`, `setAttr(slide, addr, name, value | null, ctx)`,
  `resolvedStyle(el, theme)` (what an element ends up with, text style included).
- `PROPERTIES` (every property: `group`, `on` = tags it applies to, `check`), `TRANSITIONS`,
  `addTableRow`, `removeTableRow`, `addTableColumn`, `removeTableColumn`, `setHeaderRow`, `elementChildren`.
- `setSection(index, slideId, title)` for the slide's section title.

From `../editor/commands.ts`: `isPinned(el)`, `setPinned(on)`.
From `../ui/icons.tsx`: `Icon` (names: alignLeft, alignCenter, alignRight, alignJustify, plus, close, chevronDown, check, layers…).
From `../ui/Menu.tsx`: `MenuButton` for every dropdown.

A property is offered ONLY if `PROPERTIES[name].on` includes the element's tag.
Write values exactly in the format's grammar (px lengths like `24px`, colors
as `#rrggbb` or `var(--name)`). If `setStyle` throws an `EditError`, `editSlide`
already shows its message; leave the field showing the old value.

## Layout of the panel

Sections, top to bottom, each with a small uppercase-free heading
(`font-size: var(--fs-sm)`, `color: var(--text-2)`, 12px padding), separated by
1px `var(--line)` rules. Rows are a label (88px, `var(--text-3)`) and a control.
Controls are 28px tall, `background: var(--field)`, `border: 1px solid transparent`,
`border-radius: var(--r-md)`; focus shows `var(--sel)` border. Numbers right-aligned
with a unit suffix in `var(--text-3)`.

### Nothing selected → "Slide"
- Background: color control (see Color below) for the section's `background`.
- Transition: dropdown of `TRANSITIONS` (`data-transition` attribute on the section; "none" removes it).
- Section: text field; starts a section at this slide (`setSection`); empty removes it.
- Skip in show: checkbox (the `hidden` attribute, value "").

### Element selected (one) → name in the header (`labelOf` from `../editor/selection.ts`)
1. **Position** (only if `position` applies to the tag)
   - Segmented control "In layout | Pinned" → `setPinned(false|true)`.
   - When pinned: X / Y (left/top), W / H (width/height) number fields, px.
   - When in layout: W / H fields (blank = auto).
2. **Text** (only if `font-size` applies to the tag)
   - Text style: dropdown of `Object.keys(theme.textStyles)` plus "None" → `data-style` attribute.
   - Font: dropdown of `theme.fonts` families + "Default" (removes `font-family`).
   - Weight: dropdown 300/400/500/600/700 named Light/Regular/Medium/Semibold/Bold.
   - Size: number (px), with ↑/↓ keys (shift = ×10).
   - Line height (unitless number) and Letter spacing (px), side by side.
   - Color (see Color).
   - Align: 4 icon buttons (left/center/right/justify) → `text-align`.
   - Case: dropdown None/UPPERCASE/lowercase/Capitalize → `text-transform`.
   Show the RESOLVED value (`resolvedStyle`) as the field value; if it comes
   from the text style rather than the element, show it in `var(--text-3)`.
3. **Appearance**
   - Background (Color, with "None"), Opacity (0–1 number + slider),
     Radius (px), Border: none/solid/dashed/dotted toggle + width + color.
4. **Table** (only for `<table>`): Rows and Columns counters (+/− buttons
   calling the table ops, adding/removing at the end), "Header row" checkbox.
5. **Image** (only for `<img>`): Fit: Cover/Contain, Description (the `alt`).

### Several selected
Header "N items". Show only Position (Pinned toggle, applies to all) and
Appearance → Opacity. Apply the change to every selected address inside ONE
`editSlide` call.

## Color control
A swatch + text field. The swatch opens a small popover (use a positioned
`div`, close on Esc/outside click) with: the theme colors as swatches
(`var(--name)` is the value written; tooltip = name), then a hex field.
Typing a hex that is valid updates on Enter/blur. Show theme colors by
name in the field (e.g. "accent") when the value is `var(--accent)`.

## Behavior rules
- Fields commit on Enter and on blur, never per keystroke. Esc reverts.
- After the AI or a reload changes the slide, the fields show the new values
  (derive from state; don't keep stale local copies when not focused).
- Every control has a label (`aria-label` when the visible label is elsewhere).
- Width: everything fits 296px; long values ellipsize.

## Done when
- [ ] All sections above work on the sample deck (`examples/sample-deck`).
- [ ] Typecheck passes: `npx tsc -p apps/desktop/tsconfig.json`.
- [ ] No raw hex colors or font sizes in your CSS; tokens only.
- [ ] Summary lists what works, what doesn't, and any core change needed.
