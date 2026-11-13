# Working in this repository

This file is for every model and person that changes code here, whichever
company made the model. Read it whole, then read
[docs/process.md](docs/process.md) and your app's brief in `docs/apps/`,
before your first change.

## What this is

Fenna, by Sidhilynx: a family of open-source, AI-native office apps (Fenna
Slides, Docs, Sheets and Whiteboard, more to come) that run on the user's own
computer. Each ships as its own app on one shared shell. Any AI that speaks
MCP can drive them; the user's files never leave their machine unless they
share them. There is no account and no login in these apps. The code's
package names (`@opendeck/*`) and environment variables (`OPENDECK_*`) are
from before the name and stay as they are.

```
packages/shell      the shared outside of every app: window tabs, Home, chat     (core)
                    with the user's own AI, UI kit and tokens (see its README)
packages/format     slides: parser, validator, serializer, deck index            (core)
packages/render     slides: slide → browser markup, one renderer for every surface (core)
packages/mcp        slides: the MCP server any AI uses to read and edit a deck   (core)
packages/doc, doc-mcp       docs: format and MCP server                          (core)
packages/sheet, sheet-mcp   sheets: format and MCP server                        (core)
apps/desktop        slides app: main process (src/main), React editor (src/renderer)
apps/docs, apps/sheets      the docs and sheets apps, same layout
examples/           sample files; every one must load with zero diagnostics
example-screenshots-<app>/  the reference each app is built to (git-ignored)
scripts/            dev tools (agy-try.mjs drives a deck, doc or sheet with Antigravity)
docs/process.md     the stages of work and who does what
docs/apps/          one brief per app: mission, flows, agent tasks, stage
docs/reviews/       Verify and Finish reviews
docs/tasks/         task specs for builders
```

## Who changes what

Work moves in three stages; [docs/process.md](docs/process.md) has the full
rules.

1. **Build:** any model builds the MVP from the brief and the reference
   screenshots.
2. **Verify:** a Claude model runs the app and compares it with the
   reference for visuals, user experience and agent experience, and writes a
   review.
3. **Finish:** a Claude Opus model fixes the review, does the final UI and
   UX polish, and makes it production-ready.

- **Core packages** (`packages/*`) and main processes are owned by the lead.
  Builders do not change them. If a task seems to need a core change, stop
  and say exactly what you need in your summary; don't work around it.
- **MCP servers** are designed and changed only by Claude models, in Verify
  and Finish. A builder may write a draft server to try the app; it is marked
  `draft` and will be redesigned.
- **Builders** work on the task they were given, and only on files the task
  names or creates. A builder of a **new app** creates that app's own
  folders, as its brief names them (`apps/<app>`, `packages/<format>`,
  `packages/<format>-mcp`, `examples/sample-<thing>`). It never changes
  existing packages, other apps or `packages/shell`.
- **Builders check their own work** before hand-over: they build, test,
  capture the running app and run the agent tasks, following the skills in
  `.agent/skills/` (start with `.agent/skills/opendeck-build/SKILL.md`).
- **No model marks its own work verified or production.**

## Rules that are never broken

1. **The schema is the source of truth.** Element and property lists come
   from `@opendeck/format` (`ELEMENTS`, `PROPERTIES`, `SHAPE_KINDS`, ...).
   Never hard-code a list of CSS properties, shapes or tags in the UI.
2. **One renderer.** Anything that shows a slide uses `SlideView` /
   `slideMarkup`. Never render slide HTML another way.
3. **Edits go through the format.** Change a slide by changing its parsed
   tree and writing `serializeSlide(tree)` with `api().write(...)`. Never
   build slide HTML with string concatenation.
4. **Design tokens only.** Colors, sizes, radii, fonts in the UI come from
   the CSS variables in `packages/shell/renderer/base.css` (shared) and
   `src/renderer/styles.css` (the app's own few). No raw hex values, no
   new font sizes, in components. Both the dark and light themes must work.
5. **No new dependencies** without the lead's approval. Name the package and
   why in your summary instead.
6. **TypeScript must run without a build step.** `erasableSyntaxOnly` is on:
   no enums, namespaces or constructor parameter properties.
7. **Every path, not just the happy one.** Empty deck, one slide, 300
   slides, a broken slide file, very long titles, a narrow window, keyboard
   only. Handle each on purpose.
8. **Leave nothing behind.** No dead code, no commented-out code, no TODOs,
   no console.log.

## Look and feel

Quiet, precise, monochrome. The slide is the only colorful thing on screen.
No gradients, glows, emoji, pills, or decorative icons in the UI. One accent
(`--sel`) and it means "selected". Text in the UI is short and exactly true.
Every control has a keyboard path and a visible focus ring. Motion is fast
(120–200 ms), and none plays under `prefers-reduced-motion`.

## Commands (Windows: use PowerShell, not Git Bash, for npm and tests)

```powershell
npm test                                   # all tests (vitest)
npx tsc -p apps/desktop/tsconfig.json      # typecheck the editor (also each packages/* tsconfig)
npm run build -w @opendeck/desktop         # build the editor page
npm run dev -w @opendeck/desktop           # run the app with hot reload on the sample deck
```

Run npm from `D:\sidhilynx\open-source-tools` (capital `D:`) in PowerShell. npm
compares paths case-sensitively; workspace links created from a `d:\` path
break `npm install` and `npm ls` ("Cannot read properties of null"). Builders
run tests, typecheck, builds and the scripts in `scripts/`, but never
`npm install` or anything that changes dependencies. Captures and agent
runs: `scripts/shot.mjs`, `scripts/agy-try.mjs`, `scripts/agy-trace.mjs`
(see `.agent/skills/ui-verify` and `.agent/skills/mcp-and-agent-check`).

If Electron starts as plain Node ("Node.js v24" and a stack trace), the
shell has `ELECTRON_RUN_AS_NODE=1` set; remove it for that command.

### Screenshots (required for every UI change)

Build, then capture the real app at several sizes and look at every image
before you call the task done:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:OPENDECK_DECK = "d:\sidhilynx\open-source-tools\examples\sample-deck"
$env:OPENDECK_SLIDE = "4"                      # optional: open on slide 4
$env:OPENDECK_SHOT_SIZE = "1000x700"           # optional, default 1440x900
$env:OPENDECK_THEME = "light"                  # optional: light or dark, default follows the system
$env:OPENDECK_SHOT = "$env:TEMP\shot.png"
Start-Process -FilePath node_modules\electron\dist\electron.exe -ArgumentList "apps\desktop" -Wait
```

## Definition of done

- The task's acceptance list is met, item by item.
- The result matches the app's reference screenshots for the flows the task
  touches (Verify and Finish compare them side by side; see
  [docs/process.md](docs/process.md)).
- Tests cover the behavior and its edge cases; `npm test` passes.
- Typecheck passes for every tsconfig you touched.
- Screenshots at 1440×900 and 1000×700, dark and light, looked at.
- A short summary: what changed, what you could not do and why, what you
  guessed, and any core change you need.
