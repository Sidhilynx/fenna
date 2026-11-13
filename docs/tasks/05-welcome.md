# Task 05 — Welcome screen: new deck, starters, recent decks

Read `AGENTS.md` first.

## What it is

What the app shows when no deck is open (today: a plain "Open a deck" message in
`App.tsx`). It becomes the place to start: create a new deck from a starter theme,
reopen a recent one, or open a folder.

## Files you may create or change

- `apps/desktop/src/renderer/panels/Welcome.tsx` (new)
- `apps/desktop/src/renderer/panels/welcome.css` (new; import it from Welcome.tsx)
- `apps/desktop/src/renderer/App.tsx` — ONLY replace the `<main className="empty">…Open a deck…</main>`
  block (the `!ref || !deck` branch) with `<Welcome />`. Change nothing else in App.tsx.

## APIs (read the files)

- `../editor/store.ts`: `createDeck(title, starterKey)` (asks where to save, writes the files, opens it),
  `openRecent(root)`, `chooseDeck()` (open a folder).
- `../api.ts`: `api().recent()` → `[{ root, name, title }]` newest first.
- `@opendeck/format`: `STARTERS` (`{key, label, description, theme, darkCover}`), `newDeckFiles(title, key)`
  → `{ index, slides: { cover: html } }`, `parseSlide(html, valueContext(index))`.
- `../SlideView.tsx`: `FitSlide` (preview a slide at the container's width) and `useSlideStyles(theme)`.
  NOTE: `useSlideStyles` loads ONE theme's fonts; for the starter previews, call it for the selected
  starter only (previews of other starters may fall back to system fonts until selected — acceptable).

## Layout (centred, max-width 880px, generous whitespace)

1. A short heading: "Start a deck" (`20px`, weight 500), one line under it in `var(--text-2)`:
   "Decks are folders of plain files on this computer. Any AI you use can work on them."
2. **New deck**: a title field ("Untitled deck" placeholder), then the starters as 4 cards in a row
   (2 per row under 720px): each card shows the starter's cover slide preview
   (`newDeckFiles(title || "Your title", key)` → parse → `FitSlide`), its label and description.
   Clicking a card selects it (2px `var(--sel)` outline); "Create deck" (primary button) calls
   `createDeck(title, selectedKey)`. Enter in the title field also creates.
3. **Recent**: a list (from `api().recent()`, loaded on mount) of title + folder path (path in
   `var(--text-3)`, ellipsized from the left), each row a button calling `openRecent(root)`.
   Hidden when empty.
4. A secondary button "Open a folder…" → `chooseDeck()`.

## Rules
- Tokens only. Keyboard: Tab order title → starters (arrow keys move between cards) → Create → recent rows → Open.
- The whole screen scrolls if the window is short; nothing overlaps at 960×600.

## Done when
- [ ] Shows when no deck is open; creating a deck from each starter works; recent decks reopen.
- [ ] Typecheck passes. Summary.
