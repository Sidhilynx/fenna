# Fenna Workspace

Stage: build
Code: `apps/workspace`

## What it is for

Fenna Workspace is the unified desktop app uniting all five Fenna products (Slides, Docs, Sheets, Whiteboard, and Design) in a single window. A person can have any product open in any tab, jump between a slide deck, a financial model, a project document, an architecture whiteboard, and an artboard design in the same window, and manage all their documents from one shared Home. The five separate apps remain available standalone.

## What it must do

- **Multi-product tabs**: Any tab can open any Fenna document format (`deck.json`, `doc.json`, `sheet.json`, `board.json`, `design.json`) or the Workspace Home. The tab strip reflects each document's native icon (`deck`, `doc`, `sheet`, `board`, `design`, `home`), title, and agent activity state.
- **Unified Workspace Home**: What a new tab shows.
  - A clean sidebar with:
    - **Home** (All recent documents across all 5 products)
    - **Fenna Slides** (recent decks, new deck action)
    - **Fenna Docs** (recent documents, new doc action)
    - **Fenna Sheets** (recent workbooks, new sheet action)
    - **Fenna Whiteboard** (recent whiteboards, new board action)
    - **Fenna Design** (recent artboards, new design action)
  - Quick Search (`/`) across all recent files of all types.
  - Quick New (`N`) to start a new document in the active sidebar category.
  - MCP setup guide showing how any AI connects to all five servers.
- **Independent apps preserved**: Builds and tests for `@opendeck/desktop`, `@opendeck/docs`, `@opendeck/sheets`, `@opendeck/whiteboard`, and `@opendeck/design` remain completely untouched and runnable.
- **Process & View Isolation**: Each tab is powered by its own `WebContentsView`, running the respective editor's bundle without CSS or store collisions.

## What it must not do

- Merge all five editors into one giant monolithic React component bundle (which causes CSS, shortcut, and state collisions). Tab views must be isolated views.
- Require an account, network login, or cloud sync.
- Break or alter the standalone apps' startup or packaging.

## Agent tasks

1. Connect Antigravity or Claude to the workspace environment and open a Slides deck in tab 1 and a Sheets workbook in tab 2.
2. From an agent session, create a new document in Docs and read an existing Whiteboard in another tab.

## Build summary

Written by stage-1 builder:
- **`apps/workspace`**: Complete unified bundled application created, built with Vite and packaged with Electron.
- **`packages/shell`**: Added `board` and `design` strip glyphs, updated `TabHost` to recognize multi-product registries and detect product kind from marker files (`deck.json`, `doc.json`, `sheet.json`, `board.json`, `design.json`).
- **Unified Workspace Home**: Sidebar with Home + all 5 products (**Fenna Slides**, **Fenna Docs**, **Fenna Sheets**, **Fenna Whiteboard**, **Fenna Design**), with counts, quick-add buttons, filterable recent list across all products, universal prompt composer, and MCP guide dialog.
- **Multi-product tabs**: Any tab can open any of the 5 document formats or Workspace Home. Each tab renders the native product icon in the strip, and runs the isolated production editor.
- **Standalone apps preserved**: `@opendeck/desktop`, `@opendeck/docs`, `@opendeck/sheets`, `@opendeck/whiteboard`, and `@opendeck/design` remain completely independent and working.
- **Verification**: `npx vitest run` passes (39 test files, 390 tests); `tsc` passes clean for all packages and apps; screenshots captured and verified at 1440×900 and 1000×700 in both dark and light modes, as well as with each of the sample documents loaded.

