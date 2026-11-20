# UI rules

## Site

Every letter on the site is a liability. A word stays only if the page is
worse without it.

For every model and person who changes a Fenna app's UI. AGENTS.md says
"quiet, precise, monochrome"; this page says exactly what that means, so two
builders who never met make the same screen. `scripts/check-ui.mjs` checks the
mechanical half:

```powershell
node scripts/check-ui.mjs apps/crew          # errors; exit 1 if any
node scripts/check-ui.mjs apps/crew --warn   # also spacing, Title Case, shadows, motion
```

A UI change is not done while it adds an error. Warnings in lines you touched
are yours to fix too.

## Why these rules exist

Generated UIs look generated for the same few reasons: every block is a card
with a border and a shadow, every heading is Title Case with an "&", every
label explains itself, there are pills and badges everywhere, colors come from
Tailwind's default palette, and the same action is offered in three places.
Each rule below removes one of those tells. When a rule and your taste
disagree, the rule wins; when the rule is silent, choose the plainer option.

## 1. Color

- Colors come from tokens only: `packages/shell/renderer/base.css` (shared)
  and the app's `styles.css` `:root` block (its own few). A new color is a new
  token, defined for **both** themes, in the `:root` and `[data-theme]` blocks.
- No hex, `rgb()`, `hsl()` in a rule or a component. No Tailwind palette
  values (`#f97316`, `#38bdf8`, `#64748b` and their friends) anywhere.
- One accent, `--sel`, and it means "selected" or "the main action here".
  In Crew, "waiting on the person" is the pixel attention mark in the
  text color, never a color of its own. `--danger` means "this failed or
  deletes". Nothing else is colored.
- The content is the only colorful thing: the slide, the doc, the bot's live
  screen. The chrome around it is grays.
- No gradients. No glows. No colored shadows.

## 2. Type

- Sizes: `--fs-xs` 11, `--fs-sm` 12, `--fs-md` 13 (body), `--fs-lg` 15, plus
  the app's few named tokens (Crew: `--fs-chat`, `--fs-name`, `--fs-title`).
  No other size. No `font-size` in `style={{}}`.
- Weights: 400 body, 500 labels and names, 600 headings. Never 700+.
- One heading per screen at most. Section titles are `--fs-sm`, weight 500,
  `--muted` color, sentence case, and no border underneath.
- Numbers that change (counts, times) use `font-variant-numeric: tabular-nums`.

## 3. Space and shape

- Spacing scale in px: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64. Nothing
  between. Inside a control 6–8; between related rows 8–12; between sections 24–32.
- Radii: `--r-sm` controls, `--r-md` panels and cards, `--r-lg` dialogs.
  Full rounds only for faces, status dots and the bot cursor. **No pills.**
  Crew sets every radius to 0 and draws pixel frames instead (section 8).
- Separate with space first, then a 1px `--line` hairline. A border around a
  group is a last resort; a border **and** a background **and** a shadow on
  the same block is never right.
- Shadows only on things that float above the page: menus, popovers, dialogs,
  the bot's cursor tag. Use `--shadow` (Crew: the hard pixel drop, section 9).
- Align to one left edge per column. If two things look almost aligned, they
  are misaligned.

## 4. Copy

Every word on screen is UI. Cut it if the screen works without it.

- **Sentence case** everywhere: "New bot", "Ask me before", "Run now". Proper
  nouns keep their capitals (Fenna, Claude Code, Codex, Antigravity, MCP).
- **No "&" in labels.** "Tools & Connectors" means you have not decided what
  the section is. Pick the one true word: "Connectors".
- **Name things by what the person sees, not how it is built.** "Activity",
  not "Live Execution Terminal". "Run", not "execute" or "deploy". "Sign in",
  not "Configure CLIs". "Show in folder", not "Open in Windows File Explorer".
- **Never name another company's product** for our own thing: no "Chrome",
  "Explorer", "Finder", "Win + H". The bot's browser is "Browser".
- **No marketing words**: unleash, supercharge, seamless, powerful, effortless,
  magic, elevate, empower, robust, intuitive, comprehensive, recipes, launch.
- **No exclamation marks, no emoji, no ✓ or → glyphs in text.** Use a `Glyph`.
- **Buttons are verbs** saying what happens: "Create bot", "Approve", "Deny",
  "Give back". Never "OK", "Submit", "Proceed".
- **Empty states say what's true and the one next step**, in one line:
  "No files yet." No "Get started by…" paragraph, and no illustration except
  Crew's one small pixel picture (section 8).
- **Errors say what to do**: "Write the schedule like `weekdays 09:00`." not
  "Invalid schedule".
- **Status lines are facts with times**: "Asleep until Mon 10:00", "Wrote
  Weekly check, 2 min ago". Not "Ready to deploy", not "Active".
- **Don't invent sample personas or categories.** No "Market Analyst
  (Finance)" chips. Starting points are plain jobs a person would type.

## 5. Components

- **One place per action.** If Settings is in the sidebar, there is no gear in
  the header. If "New bot" is a tile, it is not also a primary button above
  the tile. Search for the action's label before you add it somewhere new.
- **No cards around settings.** A settings panel is sections: a muted title,
  the controls, 24px of space. Not eight collapsible bordered cards.
- **Collapse only what most people never open.** Default open; one "More"
  disclosure at the end for advanced fields.
- **No wizards for fewer than ten fields.** One form, the required fields
  first, the rest under "More".
- **Badges** are a count or a dot, never a word. A word belongs in the status
  line. Amber dot = waiting on the person. That is the only badge color.
- **Icons** label controls that have no room for words (toolbar, taskbar),
  always with a tooltip and `aria-label`. No icon next to a word that already
  says it (no gear before "Settings" in a menu). No decorative icons. The
  fennec in Crew is the one approved exception (docs/apps/crew.md).
- **Lists over grids** when items have no picture. A grid tile needs a real
  image (a live screen, a page preview); a gray box saying "Screen off" is not
  one.
- **Dialogs**: title in sentence case, body, actions bottom right, primary
  last. Escape closes; Enter does the primary action only when it is safe.

## 6. States

Design these on purpose, for every screen you touch, and capture them:
empty, one item, 300 items, a very long name (40 characters, no spaces),
loading longer than a second, a failed load, waiting on the person, narrow
window (1000×700), both themes, keyboard only (visible focus ring on every
control, logical tab order, Escape backs out).

## 7. Motion

120–200 ms, ease-out, opacity and transform only. Nothing moves on its own
except things that are live (the bot's cursor, a spinner while waiting, the
fennec's eyes while it works). Nothing moves under `prefers-reduced-motion`.

## 8. Crew's pixel style

Crew draws its own chrome as pixel art (docs/apps/crew.md, Decisions). The
rules above still hold; these replace the ones they name.

- **Shape.** `--r-sm`, `--r-md` and `--r-lg` are 0; no literal radii. A box
  that needs an edge gets the notched 2px pixel frame from
  `apps/crew/src/renderer/pixel.css` (`box-shadow: var(--px-edge)`, colour in
  `--px-c`), with a 2px margin so it is never clipped. A frame plus a fill is
  allowed; that is one pixel box, not a card with a border and a shadow.
- **Shadow.** Things that float (menus, dialogs, popovers, toasts) get the
  hard drop `6px 6px 0 0 var(--px-drop)`: no blur, no colour.
- **Buttons** have the frame, a lit top row and a shaded bottom row; pressed
  sinks one pixel.
- **Settings** rows are separated by 2px rules, not boxed. Toggles are the
  square pixel switch (`.px-switch`).
- **Empty states** may show one small pixel picture (48px, drawn from the
  pixel icon set, framed) above their one line. Never more than one, never
  a paragraph.
- **Dashed edges** (the "New bot" tile) are 2px squares, drawn with an SVG
  stroke, never `border-style: dashed` and never a gradient.
- **Icons** in the chrome are the 12×12 pixel set (`pixelIcons.ts`); faces
  are 16×16 sprites. Model and CLI logos are the one exception: they show as
  the vendor's mark wherever a brain is named, with its name in the tooltip.
- **Cards that wait on the person** (questions, approvals) are neutral
  panels with a pixel header; the attention mark is the only "needs you" sign.
- **Motion** moves in whole pixels with `steps()`. Allowed loops: the
  loading bar, the faces hopping on the first screens, the thinking dots,
  the typing caret, a working face's eyes, the living pixel layer behind
  surfaces (`PixelField.tsx`), the living edges of framed components
  (`PixelEdges.tsx`: stray pixels jitter and tear at their sides and corners)
  and a short tear on hover. All stop under `prefers-reduced-motion` and
  while the window is hidden.
- New pixel styles for an area go in `src/renderer/px/<area>.css`, built from
  the primitives in `pixel.css`; no area restyles buttons, fields, menus or
  dialogs on its own.

## 9. Before you hand over

1. `node scripts/check-ui.mjs apps/<app>` shows no new errors.
2. Captures at 1440×900 and 1000×700, dark and light, of every screen you
   touched, looked at.
3. Read every string you added out loud. If it sounds like a product launch
   video, rewrite it.
4. Squint at the capture. If the first thing you see is chrome (borders,
   badges, buttons) rather than the content, remove chrome until it isn't.
