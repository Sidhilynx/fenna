# Task 04 — Theme section in the Design panel

Read `AGENTS.md` first.

## What it is

When nothing is selected, the Design panel shows the slide's settings
(`panels/inspector/SlideInspector.tsx`). Below them, add a **Theme** section for
the whole deck: its colors, fonts and text styles. A theme change restyles
every slide that uses it (slides refer to theme colors as `var(--name)` and to
text styles with `data-style="name"`), so this is how people restyle a deck.

## Files you may create or change

- `apps/desktop/src/renderer/panels/inspector/ThemeSection.tsx` (new)
- `apps/desktop/src/renderer/panels/inspector/SlideInspector.tsx` (render `<ThemeSection />` at the end)
- `apps/desktop/src/renderer/panels/inspector.css` (add rules at the end)

## APIs (read the files)

- `../../editor/store.ts`: `useEditor` (`s.deck.index.theme`: `{ colors: Record<name, hex>, fonts: {family, source, weights?}[], textStyles: Record<name, css> }`), `editIndex(label, (index) => newIndex)` — ONE call per change; it validates (bad values show a message and nothing is saved).
- `@opendeck/format`: `parseStyle(css)` → `{decls: {name, value}[]}`, `serializeStyle(decls)`, `PROPERTIES` (for valid text-style properties: only those whose `on` includes `"p"` and whose `group` is `"text"` or `"appearance"`).
- `./ColorControl.tsx` (`ColorControl`) and `./Fields.tsx` (number/text fields) — reuse them.
- `../../ui/Menu.tsx` (`MenuButton`), `../../ui/Dialog.tsx` (`Dialog`).

## The section

1. **Colors** — one row per theme color: a swatch (opens `ColorControl`'s picker; editing
   changes `theme.colors[name]`), the name (click to rename inline; renaming must also rewrite
   every slide's `var(--old)`? NO — renaming is not offered; names are fixed once used. Show the
   name as plain text), and the hex. A "+ Add color" row asks for a name (lowercase letters,
   digits, `-`) and a hex. Removing a color: a small "×" on hover; `editIndex` refuses it if a
   slide uses it — that refusal message is shown automatically.
2. **Fonts** — the deck's font families. Each row: the family name in its own typeface
   (load is automatic once in the theme). "+ Add font": a dialog with a text field where the
   user types a Google Fonts family name (e.g. "Playfair Display"); add
   `{ family, source: "google", weights: [400, 600, 700] }`. Show a preview line
   ("The quick brown fox") in that family inside the dialog, using a temporary
   `<link href="https://fonts.googleapis.com/css2?family=Name:wght@400;600;700&display=swap">`
   you add and remove. At most 6 fonts. Remove with "×".
3. **Text styles** — one row per style: its name rendered IN the style (font family, weight,
   capped at 20px size so it fits) and its size in `var(--text-3)`. Clicking a row expands
   it into editable fields: Font (dropdown of theme fonts), Weight (300–700), Size (px),
   Line height, Letter spacing, Case, Color (theme colors). Each change rewrites that style's
   CSS string with `parseStyle`/`serializeStyle` and saves with `editIndex`.

## Rules
- Tokens only in CSS. Rows 28–32px, same look as the other inspector sections.
- Every control labelled; keyboard reachable; Esc closes popovers/dialogs.

## Done when
- [ ] Changing the accent color recolors every slide using `var(--accent)` (try the sample deck).
- [ ] Adding a Google font and choosing it in a text style changes those slides.
- [ ] Typecheck passes. Summary of what works / doesn't.
