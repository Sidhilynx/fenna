<img src="docs/media/icons/crew.png" width="64" alt="Fenna Crew">

# Fenna Crew

**A crew of always-on bots that do real work on your own computer, with the AI plan you already pay for.**

![Fenna Crew: the overview with two bots and a group chat](docs/media/crew.png)

Give a bot a job and a schedule. It wakes on time, or when you message it,
and works on its own computer: a real browser, its own files, and Fenna's
slides, docs, sheets, whiteboard and design editors. You watch it work and
can take control at any moment.

- **Its own computer.** Each bot has a desktop with a browser (up to 8 tabs,
  sign-ins kept), a file library and the Fenna editors as windows.
- **Many chats per bot.** Start a new chat, compact a long one, see how full
  the context is; scheduled runs keep their own Runs chat.
- **Group chats.** Put bots in a team and @mention who should answer.
- **Connectors and a vault.** Give a bot MCP connectors and saved logins;
  it never sees a password, the app fills it.
- **Use the AI you already pay for.** Bots run Claude Code, Codex or
  Antigravity on your own plan, on this computer.
- **No account. Your files stay yours.** A crew is a plain folder on your
  computer; nothing is uploaded.

## The editors your bots work in

Crew opens these as windows in each bot's computer. Each one is also its own
free app, and any AI can work in it through MCP as easily as you can:

| | App | For |
|---|---|---|
| <img src="docs/media/icons/slides.png" width="40" alt=""> | **Fenna Slides** | Decks and presentations, with present mode and PowerPoint, PDF and web export |
| <img src="docs/media/icons/docs.png" width="40" alt=""> | **Fenna Docs** | Memos, plans and notes, with tabs, comments and suggested edits, and Word and Markdown export |
| <img src="docs/media/icons/sheets.png" width="40" alt=""> | **Fenna Sheets** | Spreadsheets with formulas, charts and conditional formatting, and Excel and CSV import and export |
| <img src="docs/media/icons/whiteboard.png" width="40" alt=""> | **Fenna Whiteboard** | Brainstorms, flowcharts and retros on an infinite canvas |
| <img src="docs/media/icons/design.png" width="40" alt=""> | **Fenna Design** | A canvas of artboards for screens, landing pages, posters and social posts, exported to PNG, SVG and PDF |

![Edits arriving through the Fenna Docs MCP server: a word turns bold, a list gains an item, a new section appears](docs/media/docs-demo.gif)

*Edits made through the MCP server land in the open doc as they happen.*

| | |
|---|---|
| ![Fenna Slides](docs/media/slides.png) **Slides** | ![Fenna Docs](docs/media/docs.png) **Docs** |
| ![Fenna Sheets](docs/media/sheets.png) **Sheets** | ![Fenna Whiteboard](docs/media/whiteboard.png) **Whiteboard** |
| ![Fenna Design](docs/media/design.png) **Design** | |

> Fenna is new (version 0.9). Expect rough edges, and please
> [tell us about them](https://github.com/Sidhilynx/fenna/issues).
> Coming next: Fenna Data, Brand, Meeting and Motion, built side by
> side. See the [roadmap](ROADMAP.md).

## Download

Get **Fenna Crew**, and the editors as their own apps if you want them, from the [latest release](https://github.com/Sidhilynx/fenna/releases/latest):

| | Windows | macOS (Apple silicon / Intel) | Linux |
|---|---|---|---|
| Crew | `Fenna-Crew-…-setup.exe` | `Fenna-Crew-…-arm64.dmg` / `-x64.dmg` | `.AppImage` or `.deb` |
| Slides | `Fenna-Slides-…-setup.exe` | `Fenna-Slides-…-arm64.dmg` / `-x64.dmg` | `.AppImage` or `.deb` |
| Docs | `Fenna-Docs-…-setup.exe` | `Fenna-Docs-…-arm64.dmg` / `-x64.dmg` | `.AppImage` or `.deb` |
| Sheets | `Fenna-Sheets-…-setup.exe` | `Fenna-Sheets-…-arm64.dmg` / `-x64.dmg` | `.AppImage` or `.deb` |
| Whiteboard | `Fenna-Whiteboard-…-setup.exe` | `Fenna-Whiteboard-…-arm64.dmg` / `-x64.dmg` | `.AppImage` or `.deb` |
| Design | `Fenna-Design-…-setup.exe` | `Fenna-Design-…-arm64.dmg` / `-x64.dmg` | `.AppImage` or `.deb` |

The apps aren't code-signed yet, so your system will ask before the first start:

- **Windows:** "Windows protected your PC" → **More info** → **Run anyway**.
- **macOS:** open the app once, then **System Settings → Privacy & Security →
  Open Anyway**.
- **Linux AppImage:** make it executable (`chmod +x Fenna-*.AppImage`), then run it.

When a new version is out, Home shows it with a download link. Nothing
installs by itself.

## Use it with any AI

Each app comes with an MCP server. The chat inside the app uses it already;
any other MCP client can use it on a file directly. From a clone of this
repository (Node 22.18 or later, which runs TypeScript directly):

```sh
npm install
node packages/workspace-mcp/src/cli.ts --workspace examples     # fenna-workspace-mcp (all five kinds of file)
node packages/mcp/src/cli.ts          --deck   examples/sample-deck     # fenna-slides
node packages/doc-mcp/src/cli.ts      --doc    examples/sample-doc      # fenna-docs
node packages/sheet-mcp/src/cli.ts    --sheet  examples/sample-sheet    # fenna-sheets
node packages/board-mcp/src/cli.ts    --board  examples/sample-board    # fenna-whiteboard
node packages/artboard-mcp/src/cli.ts --design examples/sample-design   # fenna-design
```

For example, in Claude Code:

```sh
claude mcp add fenna-docs -- node /path/to/fenna/packages/doc-mcp/src/cli.ts --doc /path/to/my-doc
```

| Server | Tools |
|---|---|
| `fenna-workspace-mcp` | `workspace_overview`, `workspace_guide`, `deck_overview`, `read_slides`, `write_slide`, `edit_slide`, `doc_overview`, `read_tab`, `write_tab`, `edit_blocks`, `sheet_overview`, `read_range`, `write_cells`, `board_overview`, `read_board`, `add_board_items`, `design_overview`, `read_artboard`, `write_artboard` |
| `fenna-slides` | `deck_overview`, `format_guide`, `read_slides`, `edit_slide`, `write_slide`, `write_slides`, `check_slide`, `delete_slides`, `arrange_slides`, `update_deck`, `read_comments`, `comment` |
| `fenna-docs` | `doc_overview`, `format_guide`, `read_tab`, `edit_blocks`, `write_tab`, `check_tab`, `delete_tab`, `update_doc`, `read_comments`, `comment` |
| `fenna-sheets` | `workbook_overview`, `format_guide`, `read_range`, `find`, `write_cells`, `format_cells`, `clear_cells`, `edit_structure`, `manage_rules`, `manage_charts`, `add_sheet`, `delete_sheet`, `update_workbook`, `read_comments`, `comment` |
| `fenna-whiteboard` | `read_board`, `add_items`, `edit_items`, `delete_items`, `arrange`, `rename_board`, `format_guide`, `read_comments`, `comment` |
| `fenna-design` | `design_overview`, `format_guide`, `read_artboards`, `edit_artboard`, `write_artboard`, `check_artboard`, `delete_artboards`, `arrange_artboards`, `update_design`, `read_comments`, `comment` |

Every edit is checked against the file format and saved whole or not at all.
Files carry versions, so an AI never overwrites a change you made after it
last read.

## How a file works

| App | Folder |
|---|---|
| Slides | `deck.json` (title, slide order, sections, theme) and one small HTML file per slide in `slides/` |
| Docs | `doc.json` (title, tabs, fonts) and one HTML file per tab |
| Sheets | `sheet.json` (title, locale, sheet list) and one JSON file per sheet |
| Whiteboard | `board.json` and `canvas.json` (every item and connector) |
| Design | `design.json` (pages, artboard positions, tweaks, text styles) and one standalone HTML file per artboard in `artboards/` |
| Crew | `bots/<name>/bot.md` (job, schedule, AI), `state.json` (chats), one JSON-lines log per run in `runs/`, and the bot's documents in `library/` |

Images and fonts sit in `assets/`. The formats are strict, documented
subsets that people and models can both read and write by hand.

## Build from source

```sh
npm install
npm test
npm run typecheck
npm run build -w @opendeck/crew-app       # Fenna Crew (builds the five editors it opens, too)
npm start -w @opendeck/crew-app            # run Fenna Crew
npm run dev -w @opendeck/desktop           # one editor with hot reload (also docs, sheets, whiteboard, design)
npm run dist -w @opendeck/crew-app         # installers in apps/crew/release/
```

On Windows, use PowerShell and a path with a capital drive letter
(`D:\...`). The code's internal package names (`@opendeck/*`) are from
before the Fenna name.

## Repository

```
packages/shell        what every app shares: tabs, Home, the AI chat, UI kit
packages/format       slides: format          packages/mcp        slides: MCP server
packages/render       slides: one renderer for editor, thumbnails, present and export
packages/doc          docs: format            packages/doc-mcp    docs: MCP server
packages/sheet        sheets: format          packages/sheet-mcp  sheets: MCP server
packages/board        whiteboard: format      packages/board-mcp  whiteboard: MCP server
packages/artboard     design: format          packages/artboard-mcp  design: MCP server
packages/crew         crew: bot folder format  packages/crew-mcp   crew: MCP servers for bots
packages/workspace-mcp  one MCP server for all five kinds of file
apps/crew             Fenna Crew
apps/workspace        Fenna Workspace, retired; Crew reuses its folder hosts
apps/desktop          Fenna Slides            apps/docs           Fenna Docs
apps/sheets           Fenna Sheets            apps/whiteboard     Fenna Whiteboard
apps/design           Fenna Design
examples/             a sample of each kind of file
```

## Contributing

Bug reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md)
first: it has the code rules, and every contributor signs the
[Contributor License Agreement](CLA.md) once.

- Where it's going: [ROADMAP.md](ROADMAP.md)
- Security problems: [SECURITY.md](SECURITY.md)
- What the apps send over the network: [PRIVACY.md](PRIVACY.md)
- Using the Fenna name: [TRADEMARKS.md](TRADEMARKS.md)

## License

[AGPL-3.0](LICENSE). A commercial license is available for companies that
want to ship Fenna inside a closed product or service; open an issue to ask.

Fenna is made by [Sidhilynx](https://github.com/Sidhilynx).
