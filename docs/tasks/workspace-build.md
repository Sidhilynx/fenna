# Task: build Fenna Workspace (stage 1)

Read first: `AGENTS.md`, `docs/process.md`, `docs/apps/workspace.md`, and `.agent/skills/opendeck-build/SKILL.md`.

You are the stage-1 builder. Your job is to create `apps/workspace`, configure multi-product tab handling in the shell, build the Workspace Home with its per-product sidebar, and wire the multi-target tab router.

## Order of work

1. **Shell extensions (`packages/shell`)**:
   - Add `board` and `design` glyphs to `packages/shell/main/strip/glyphs.js` and `packages/shell/renderer/ui/glyphs.ts`.
   - Update `packages/shell/test/glyphs.test.ts` to ensure glyph sync passes `npm test`.
   - In `packages/shell/main/tabs.cjs`, add multi-product detection (`products` array alongside single `product`).
2. **`apps/workspace` app package**:
   - Create `apps/workspace/package.json` (`@opendeck/workspace`, `productName: "Fenna Workspace"`).
   - Create `apps/workspace/tsconfig.json` and `apps/workspace/vite.config.ts`.
3. **Workspace Main Process (`apps/workspace/src/main/main.cjs`)**:
   - Register asset schemes: `odasset`, `oddoc`, `odsheet`, `odboard`, `odart`.
   - Initialize folder hosts and export IPC handlers for each format.
   - Configure `TabHost` with all 5 product descriptors:
     - `deck` (`deck.json`), `doc` (`doc.json`), `sheet` (`sheet.json`), `board` (`board.json`), `design` (`design.json` / `artboard.json`).
   - Implement multi-target view loading: load Workspace Home for `root: null`, or the specific app's `dist/index.html` (or DEV_URL) when opening a document.
4. **Workspace Home UI (`apps/workspace/src/renderer/`)**:
   - Build `App.tsx` with Fenna design tokens (`packages/shell/renderer/base.css`).
   - Sidebar with:
     - `Home` (merged timeline of all recent files across all products)
     - `Fenna Slides` (recent decks, new deck button)
     - `Fenna Docs` (recent docs, new doc button)
     - `Fenna Sheets` (recent workbooks, new sheet button)
     - `Fenna Whiteboard` (recent boards, new board button)
     - `Fenna Design` (recent designs, new design button)
   - Search filter (`/`), new document shortcut (`N`), and MCP guide dialog.
5. **Testing & Verification**:
   - Run `npm test` across all packages.
   - Run `npm run typecheck`.
   - Capture real window screenshots at 1440×900 and 1000×700 in both dark and light themes using `scripts/shot.mjs`.
