---
name: ui-verify
description: How to build the app, capture the real window in the same state as a reference image (at two sizes and both themes), drive it with scripted clicks and keys, and compare captures with the reference. Use after every UI change, before saying anything works.
---

# Seeing your work

Code you have not looked at in the running app is unchecked code. Every UI
change ends with captures you have opened and compared.

## Build

```powershell
npm run build -w @opendeck/<app>     # e.g. @opendeck/whiteboard
```

Rebuild before every capture session. The app runs the built `dist/`, not
your source.

## Capture

`scripts/shot.mjs` runs the real app on a **copy** of a sample, with a
**fresh profile**, so it never touches `examples/` or the user's own tabs.

```powershell
# one screenshot
node scripts/shot.mjs --app whiteboard --file examples/sample-board --out $env:TEMP\wb\main.png
# all four: 1440x900 and 1000x700, dark and light
node scripts/shot.mjs --app whiteboard --file examples/sample-board --all --out $env:TEMP\wb\main.png
# Home (no file open)
node scripts/shot.mjs --app whiteboard --home --out $env:TEMP\wb\home.png
# a scripted session; shots land in the --out folder
node scripts/shot.mjs --app whiteboard --file examples/sample-board --script steps.json --out $env:TEMP\wb\
```

It prints the path of the copy it worked on. After a script that edits,
**read that copy's files** to confirm what was saved.

Captures go to `%TEMP%`, never into the repo.

## Scripts

Steps (full list in `packages/shell/main/review.cjs`):

```json
[
  {"wait": 9000},
  {"click": [640, 400]},
  {"drag": [300, 300, 500, 420]},
  {"key": "Delete"},
  {"key": "z", "mods": ["control"]},
  {"js": "$btn(\"More\")"},
  {"wait": 400},
  {"shot": "more-menu.png"},
  {"js": "$qa(\".menu-item\").map(x => x.textContent.trim())"}
]
```

- Start with `{"wait": 9000}`: the app needs time to load.
- `click`, `drag` and `dbl` take **window** coordinates (the tab strip is at
  the top). Real mouse input works for canvases. Prefer it over synthetic
  events.
- `{"js": ...}` runs in the page with helpers: `$q`, `$qa`, `$fire`, `$btn`,
  `$mi`, `$focus` (documented at the top of `scripts/shot.mjs`). The result
  is printed as `eval: ...`; use it to read state (selection, item count,
  text of a menu).
- Put a `{"wait": 300}` between a step that changes state and a step that
  reads the DOM. A `js` step that changes state and reads the result in the
  same step sees the old DOM.
- `type` sends characters only (no keydown). For keys an app handles in
  `keydown` (Enter, Escape, arrows, shortcuts), use one `{"key": ...}` step
  per key.
- A synthetic `mousedown` does not move keyboard focus; call
  `$focus(".your-canvas")` before key steps.
- Two synthetic events fired in one `js` step happen before React
  re-renders. A shift-click that depends on the first click's state needs
  its own step.

## Compare

For each reference image in the flow:

1. Capture the same state, same theme as the reference (most references
   are dark), at 1440x900.
2. Open both images. Compare in this order:
   - **Presence**: every control, label and menu item in the reference is
     in ours, in the same order, with the same shortcut text.
   - **Layout**: position, alignment, spacing, sizes relative to each other.
   - **Type**: weights, sizes, truncation with ellipsis (never cut mid
     letter).
   - **Color and state**: selected, hover, disabled, checked, focus ring.
   - **Icons**: same meaning; ours come from `packages/shell/renderer/ui/glyphs.ts`.
3. Write every difference down, fix it, capture again. Repeat until there
   are none, or the difference is deliberate (write why).
4. Then capture 1000x700 and the light theme for the same state, and check
   nothing overlaps, clips or disappears.

Look for these every time, since they are easy to miss:

- text clipped without an ellipsis;
- overlays (menus, toolbars, panels) covering what they shouldn't, or
  being covered;
- a translucent surface showing content scrolling under it;
- controls off-screen at 1000x700;
- light theme colors that only work in dark (and the reverse);
- focus rings missing on keyboard focus.

## Record

In your build notes, for each flow: reference images, capture file names,
"matches" or the remaining differences.
