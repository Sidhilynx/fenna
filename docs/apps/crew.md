# Fenna Crew

Stage: build
Reference: `example-screenshots-crew/` (the `mockup/*.dc.html` files are the
design target; the PNGs show how a similar product behaves, not how ours looks)
Code: `apps/crew`, `packages/crew` (bot folder format), `packages/crew-mcp`

## What it is for

A team of always-on bots that do real work on the user's own computer, using
the AI plan they already pay for (Claude Code, Codex or Antigravity, through
the shell's assistant host). Each bot has one job, its own browser that stays
signed in, its own files, a schedule, and a face that shows what it is doing.
The person watches any bot work, takes control to type a password, and
approves anything risky. In the first five minutes a person signs in a CLI,
creates a bot by describing a job, watches it open a site and do the first
run, and approves its first action.

## Screens (match `mockup/Main.dc.html`)

1. **Crew overview** (home): grid of every bot's live screen thumbnail with
   face, name, status line and Chat button; a "New bot" tile; a banner for
   anything waiting on the person (approval or question).
2. **Bot chat**: the conversation with one bot; tool steps as quiet lines;
   choice cards (`ask_human`) and approval cards inline; composer. Right panel
   with tabs **Details** (how it works, runs, brain, ask-me-before, connectors),
   **Library** (files it made) and **Computer** (live thumbnail, Open).
3. **Bot computer**: a small desktop that belongs to the bot.
   - **Home** (no app open): wallpaper, desktop icons (Browser, Fenna Docs,
     Sheets, Slides), and the Activity and Files windows.
   - **An app open** (the browser while it works): the app fills the desktop.
     Activity and Files are never shown over an open app.
   - Taskbar: the bot's face, Browser, Desktop, Activity; brain on the right.
   - Top bar: back to Crew, face, name, status, **Watching / Take control**,
     Chat, Stop. In control: blue border, banner "You are in control. <bot>
     is paused and does not see what you type.", Give back.
   - The bot's cursor (arrow plus a name tag) moves to where the bot clicks.
4. **Sidebar** on overview and chat: Crew overview, search, "+", Bots list
   (face, name, status, attention mark when it needs you), Teams list.
   Right-click a bot (or the menu key) for Open chat, Open computer and Delete bot.
5. **Sign-in**: no account. If no CLI is signed in, the shell's install and
   sign-in card is the first screen ("configure your CLI").
6. **First bot**: on first launch a lead bot named Fenna greets the person,
   asks with choice cards what they want help with, and offers to create the
   first bots. Creating a bot also works from "+" (name, job, how it works,
   schedule, brain, connectors, ask-me-before).

Each bot's face is pixel art (see Decisions): moods `idle`, `work` (eyes
move), `sleep` (closed eyes), `need` (wide eyes, plus the attention mark where
shown). Faces are the only exception to the no-decorative-icons rule.

## How it works

- **A bot is a folder** under `<userData>/Crew/bots/<slug>/`: `bot.md` (front
  matter: name, job, schedule, brain {cli, model, effort}, connectors,
  askBefore, wallpaper; body: how it works), `memory.md`, `library/` (files it
  makes, as Fenna docs, sheets and decks), `runs/<iso>.jsonl` (every event of
  every run), `state.json` (session ids, mood, status line). Teams are
  `<userData>/Crew/teams/<slug>/team.md` (lead, members) plus a thread file.
  `packages/crew` parses, validates and serializes these, with tests.
- **Runs** use the shell's assistant host (`packages/shell/main/agent.cjs`),
  without a chat window attached, with the bot's folder as working folder, its
  session resumed, and its MCP servers: crew, browser, the Fenna apps for its
  library, and Crew's gateway to the connectors it was granted.
- **Its own browser**: one persistent Electron session per bot
  (`persist:crew-<slug>`) so sign-ins stay. It renders offscreen; the page
  streams frames to the computer screen and thumbnails. The bot drives it
  through the Chrome DevTools Protocol (`webContents.debugger`), never by
  looking at our desktop. Take control forwards the person's mouse and keys
  to the page and pauses the bot's browser tools; nothing typed then reaches
  the model.
- **Schedules and always on**: a scheduler in the main process wakes bots
  (`weekdays 09:00`, `mondays 10:00`, `every 2h 08:00-18:00`, manual). Closing
  the window keeps Crew in the tray; "Open at login" is a setting. At most two
  runs at once; the rest queue.
- **Approvals**: the bot asks before anything in its ask-me-before list, and
  connector tools on `ask` come to the same approval card (approve once,
  always for this bot, deny). Answers are recorded in the run log.
- **Teams**: a team has a lead. A person's message to a team goes to the lead,
  which hands work to members with `message_bot`. At most 6 hand-offs per
  message, so bots can't loop.
- **Connectors**: Fenna apps built in. Any other MCP server is installed once
  on the computer (Connectors page: search of the official MCP Registry
  (`registry.modelcontextprotocol.io`), a command, or a URL), with secrets
  encrypted by the system. A bot is granted installed connectors with a
  level per tool: allow, ask or off. Crew's `gateway` server is the only way
  a bot reaches them, on every CLI.

## MCP (draft, Claude finishes it)

`crew` server, given to every bot: `ask_human` (question, options, multi),
`request_approval` (action, details), `message_bot` (bot, message, files: copies up to 20 files and 500 MB from the sender's disk into the other bot's Files/From <sender>/ or its Documents; never moves them), `create_bot` (needs
approval), `remember` (append to memory.md), `set_status` (status line and
mood). `browser` server: `open`, `snapshot` (page as text with element refs),
`click`, `type`, `press`, `scroll`, `back`, `screenshot`, and tabs: `tabs`,
`switch_tab`, `close_tab`, `open` with `new_tab`, and the person's logins:
`logins`, `sign_in`, `fill_code` (Crew fills them; the bot never sees a
password). Results are small;
errors say how to fix them; while the person has control, browser tools fail
with "The person has control of the browser. Wait, then call snapshot again."

Calls, on the `crew` server (`apps/crew/src/main/meetings.cjs`): `meeting`
(action join (url, note, name), say (text), share (document), stop_sharing,
leave, status). Wakes use the triggers `meeting` and `meeting_end`.

Files, on the `crew` server (`apps/crew/src/main/files.cjs`):
- `read_file` (path, offset, limit, sheet): a file on the bot's disk; text and code a page at a time, CSV, TSV and Excel as tables (every sheet, or `sheet`), images as pictures (shrunk over 1568 px or 3.5 MB), PDFs and binaries named only.
- `import_sheet` (path, title): an .xlsx or .csv in Files or Downloads becomes a Fenna sheet in the bot's Documents, checked by the sheet package.
- `export_file` (document, format, to): a Fenna sheet from Documents saved to Files/Outbox as .xlsx (all sheets) or .csv (first sheet); never overwrites.

## What it must not do

- No account or login of our own. No API keys required.
- No full operating system or VM for a bot (later), no mobile, no cloud.
- No copying another product's names, art, text or mascot.
- Never type or read passwords for the person; never act on an approval-listed
  action without an approval.

## Agent tasks

1. "Create a bot called Research that checks example.com every Monday and
   writes what it found to a doc." The bot exists with that schedule; a run
   produces a Fenna doc in its library.
2. Run a bot whose job is to open a web page, read it, and write a three-line
   summary doc; it uses `snapshot` and finishes without a retry loop.
3. A bot told to "send" something asks through `request_approval` first and
   stops when denied.
4. A team with a lead hands one task to a member and reports back.

## Decisions

- Name Fenna Crew; mascot is an original fennec whose mood shows bot status.
  The lead approved the mascot as an exception to the no-icon rule. 2026-11-18
- Tier 1 runs on the person's computer with the CLIs they already use. A bot's
  "computer" is our own desktop surface around its own browser, never Windows
  or Chrome look-alikes. 2026-11-18
- An open app fills the bot's desktop; Activity and Files live only on its
  home desktop. 2026-11-18
- Core changes to `packages/shell` needed by Crew are approved by the lead for
  this build. 2026-11-18
- Connectors are installed once per machine; bots are granted connectors with
  per-tool levels allow/ask/off, enforced by Crew's gateway on every CLI.
  2026-11-18
- Skills (the open Agent Skills format, a folder with SKILL.md) are installed
  once per machine and shown in full before they are added; a bot is granted
  them by name, and before each run they are copied onto its disk at
  Files/Skills/<name>/, so every CLI reads them with read_file, and the prompt
  names only each one's description and path, never its body. 2026-11-21
- A bot's browser fills its desktop with real tabs; our own chrome. 2026-11-18
- The bot's browser stays offscreen and sends live frames as GPU textures (up
  to 60 a second), not an on-screen view: offscreen pages keep working when
  nobody watches, on-screen views stop. 2026-11-18
- A bot is heard only while its computer is open in a visible window; mute
  per tab and per bot; Stop pauses its media. 2026-11-18
- Web connectors sign in with OAuth (MCP authorization spec) in the person's
  default browser; tokens stay encrypted in the main process. 2026-11-18
- Logins live in a per-machine vault; bots are granted logins with allow/ask;
  Crew fills them into the page and the model never sees a password. 2026-11-18
- The fennec mascot is retired. Each bot has an original 16×16 pixel face:
  one of `AVATARS` (16 designs) in one of `AVATAR_COLORS` (10 muted colors),
  two tones per face, ink eyes that show the mood. Chosen in New bot (face
  button beside the name) and in Details; new bots get an unused design.
  Pixels live in `apps/crew/src/renderer/pixels.ts`. 2026-11-19
- Teams are shown to people as "group chats". A message goes to the lead
  ("answers by default"); `@Name` sends it to that bot, `@all` to everyone.
  2026-11-19
- Crew's palette: the primary action is ink (not a brand blue); one quiet
  steel accent means selected; red means
  failed or deletes. Defined in `styles.css` `:root`. 2026-11-19
- New bot is one form with a "More" disclosure, not a wizard; starting points
  fill the form and never create a bot by themselves. 2026-11-19
- The suggested connectors list only packages checked on npm to exist and not
  be deprecated; nothing is labelled "verified". 2026-11-19
- UI copy and tokens are checked by `scripts/check-ui.mjs` (docs/ui-rules.md);
  Crew stays at zero errors. 2026-11-19

- Crew is the one Fenna app people download. Fenna Workspace is retired as a
  separate product; its editors (Docs, Sheets, Slides) open as windows in a
  bot's computer, loaded in a webview with `#embed` (no built-in assistant, no
  Home, no export: the bot is the AI). The standalone editor apps stay in the
  repo as open source. 2026-11-19
- Inside its computer the person's current chat shows in a dock beside the
  desktop; there is no per-document chat. 2026-11-19
- A bot's desktop is real: every icon opens something. Shortcuts (built-in
  windows, Fenna apps, websites, documents) live in `desktop.json`; the person
  and the bot (crew `desktop` tool) add, rename, move and remove them.
  Wallpaper is picked on the desktop (right-click), not in Advanced. 2026-11-19
- When the person and the bot edit the same document, the last change wins;
  the editor says so while the bot runs and offers Stop. 2026-11-19
- Bots wait without looking: watches (site notifications from the bot's
  browser, an element's text, a page's text every N minutes, timers) wake the
  bot with a "watch" run; no screenshots or open runs to wait. Pages in the
  bot's browser see notifications as allowed and Crew catches them. At most 20
  watches and 12 wakes an hour per bot. Bots also keep a todo list. 2026-11-19
- Calls (Google Meet only for now; docs/plans/crew-meetings.md): a bot joins
  as a guest with one `meeting` call, and Crew does every step in the call
  over the DevTools protocol, never the model. It listens through Meet's own
  captions (no speech-to-text, no tokens), wakes the bot only when its name is
  said or typed, with only the lines since it last looked, and posts the
  wake's final reply to the meeting chat (`SKIP` says nothing). A resumed call
  session gets only the new lines, not the whole prompt. The camera, mic and
  screen are fake: a name card, silence, and a stage that shows one library
  document live. When the call ends, a bot with a note from the person wakes
  once more to finish the work from the transcript. 2026-11-21
- A bot can have a Google account of its own (docs/plans/crew-bot-accounts.md):
  the person makes it (Crew never creates accounts) and keeps it in the vault;
  bot.md names it with `account`. Crew signs the bot's browser in from the
  vault and checks the session at start, every 30 minutes, before a call and
  when the person gives control back; the model never sees the password or
  the sign-in pages. When Google asks for anything Crew can't give, the person
  takes control. Meet refuses signed-out guests from Crew's browser, so this
  is how a bot joins calls. Crew won't disguise its browser to pass Google's
  checks. 2026-11-22
- A bot's computer is a small OS of its own: movable, resizable windows and a
  taskbar; one disk (Files, Documents, Downloads, Trash) that Crew resolves
  inside the bot's folder and nowhere else (no "..", absolute paths or links);
  a file manager, viewers, a Clock, a notification centre, a terminal over a
  shell written in JS (never a system shell) whose `run` executes scripts in a
  sealed hidden window (own in-memory session, no network, no Node, time
  limit), and a replay of each run. Crew's chrome stays monochrome; icons
  inside the bot's computer are colour pixel art. 2026-11-19
- Comments in a bot's document go to that bot; its reply lands in the
  thread. 2026-11-19
- All five Fenna apps are a bot's built-in tools; each has a `use` line in
  FENNA_APPS that the prompt gives the bot to pick the right one. 2026-11-19
- Crew draws its own chrome in pixel style: chat cards, bubbles, the
  composer, thumbnails and the reminder picker use the notched 2px pixel
  frame, never the system's date popup; motion (loading bar, the faces on
  the first screens, the thinking dots, the typing caret) moves in whole
  pixels with CSS steps and stops under reduced motion. 2026-11-20
- A bot has many chats (replaces "one chat per bot"). The person talks in
  their current chat and starts a new one from the chat header; runs nobody
  typed (schedule, watches, hand-offs, group chats) go to the bot's one
  "Runs" chat. Each chat keeps its own CLI conversations in state.json. A
  chat shows how full its context is when the CLI says (Claude Code); at
  80% Crew asks the bot for a summary and the chat continues in a fresh
  conversation from it (also "Compact this chat"). 2026-11-20
- Every surface is pixel: radius tokens are 0, boxes use the notched 2px
  frame from `pixel.css`, menus and dialogs have a hard drop shadow.
  Question and approval cards are neutral; the pixel attention mark is the
  only "needs you" sign. Per-area skins live in `src/renderer/px/`.
  2026-11-20
- Crew's pixels live: a sparse layer of flickering, jittering blocks behind
  the main surfaces and on the bot's desktop (`PixelField.tsx`), and one
  page-wide layer that walks and tears pixels along the edges of every framed
  component (`PixelEdges.tsx`). Closing the browser window closes the bot's
  browser unless it is running; Take control needs an open browser.
  Windows and the taskbar use the desktop's colour icons. 2026-11-20
- No account, still. Crew sends an anonymous daily count (opt-out: a
  Settings switch and `FENNA_NO_USAGE=1`; no notice on Home since
  2026-11-21, when each ping's id became new and unkept) and feedback
  only when the person presses Send. Fields are exactly those in
  PRIVACY.md#usage-counts; the receiver is `services/usage`. A day Crew is
  open counts as active even with no events. 2026-11-20
- A bot's computer runs software it makes, under rules in
  `docs/spec/crew-apps.md`. Apps (`Files/Apps/<name>/`, an `app.json` plus web
  files) run sealed: own in-memory session, no Node, network only to origins
  the person granted, a `crew` API checked against the grant. An app can
  define tools the bot then calls (`app__<name>__<tool>`): a bot gives itself
  new abilities that run sealed. Projects (`Files/Projects/<name>/`) run
  `node`, `npm` and `npx` with the person's Node under Node's permission
  model (project folder only, no child processes; network open, said on the
  approval card), off until the person turns Projects on for the bot.
  Containers and mounted folders from the person's computer come later.
  2026-11-20
- Crew ships with a Builder bot next to Fenna (every new crew, and older
  crews once): it builds apps, tools and small websites on its computer,
  tests them, keeps them working and uses them. It is the one bot with
  Projects on by default; its first command in a project still asks the
  person. Deleting it is final. 2026-11-20
- No amber: "waiting on the person" is a pixel attention mark (a framed
  "!") in the text color, on faces, banners, the desk status and app icons.
  The `--warn` token is gone. 2026-11-21
- An empty chat opens with a hello that is never saved: a bot that ships
  with Crew or came from a template says what it does in its own words; a
  bot the person wrote (or whose job they changed) just says "Hi."
  2026-11-21
- The back button on a bot's computer is named for the bot and goes to its
  chat, not to Home. 2026-11-21
- Memory comes in from other AI tools only as reviewed data: a prompt to paste
  into another assistant, a file, or a memory file on this computer (ticked,
  read on request, never uploaded); the person approves each fact, and the bot
  reads memory.md as information, not instructions. 2026-11-21
## Build summary

(Written by the builders.)

### Core (main process, format, MCP, shell), 2026-11-18

Built: `packages/crew` (format, schedule grammar, tests), `packages/crew-mcp`
(draft crew + browser servers), `apps/crew` main process, `startRun` in
the shell. The IPC contract for the UI is in `apps/crew/README.md` and
`apps/crew/src/shared/contract.ts`. `src/renderer/` is only a wiring check;
the UI is not built yet.

Agent tasks, run in the real app through its IPC (CDP driver, temp user
data, copy of `examples/sample-crew`):

| Task | CLI | Result |
| --- | --- | --- |
| 1 Create "Watcher" (example.com, Mondays) | Claude Code | pass: create_bot approval card, folder `watcher`, `mondays 10:00`; its first run made `library/example-com-check` |
| 2 Read a page, write a 3-line doc | Claude Code | pass: open → new_document (3 blocks) → remember → set_status, no retries, ~15 s |
| 3 "Send" asks approval, stops when denied | Antigravity | pass: drafted, request_approval, denied, not sent |
| 4 Team lead hands a task to a member | Claude Code lead, Antigravity member | pass: message_bot, reply returned, thread written |

Not run: Codex (not signed in for the app's own Codex home on this machine).
Browser proved with the real browser MCP server over the real pipe: open,
snapshot, click (page changed), back, type + submit, password refused,
scroll, press, screenshot, frames (live 1280×800 and thumbnails), take
control (bot tools fail after 15 s with the brief's message; the person's
clicks and keys reached the page), give back (snapshot shows what the
person typed).

### UI (apps/crew/src/renderer), 2026-11-18

Built: the real page, replacing the wiring check. Overview (sidebar, live
thumbnails, banner, New bot tile), bot chat (messages, step lines, `ask_human`
single and multi cards, bot and CLI approval cards with Always allow, composer
with Stop), panel with Details (editable: how it works, schedule, brain
CLI/model/effort, ask-me-before, connectors by Fenna app, command, URL and
registry search, memory, run now, start fresh, delete), Library and Computer;
the bot computer (home with icons, Activity and Files; browser filling the
desktop; bot cursor with name tag; take control forwarding mouse, wheel and
keys; blue border, banner, Give back, Ctrl+Alt+G); New bot, New team and team
thread; the shell's CLI card as first screen and "Configure CLIs"; Fenna's
greeting on first launch. The fennec is `Fox.tsx` (four moods, eyes move in
`work`, nothing animates under reduced motion). No change to main or contract.

Evidence (scratch captures, not in the repo): the real Electron app on a copy
of `examples/sample-crew` at 1440x900 and 1000x700, dark and light: overview,
chat Details/Library/Computer, computer home, browser open, take control.
UI states needing a live CLI (waiting cards, 50 bots, no bots, long names, a
failed run, first-launch sign-in, New bot, connector search, team) were
captured with the built page in Chrome against a stand-in for the preload.
One real run from the UI with Antigravity (the only signed-in CLI here): sent
from the composer, live frames, cursor with name tag, step lines, Stop
enabled; take control then address bar navigation reached the page and Give
back (Ctrl+Alt+G) resumed. `tsc` and `npm test` (457) pass; build works.

Differs from the mockup, on purpose or for lack of data:
- Fenna Docs/Sheets/Slides icons open the newest library file in the file
  manager; there is no in-desktop docs window (the contract has no frames for it).
- A bot whose browser never opened shows its bare desktop, not a drawn page.
- The app uses the shell's tokens, so the dark theme is the shell's `data-theme`
  dark (#141414) and primary buttons are the shell's blue, not the mockup's white.
- Wallpapers and the bot's browser chrome are fixed per-screen tokens in both themes.

Guesses: `Ctrl+Alt+G` as the keyboard exit from take control; choices answer on
click for single, and need "Send choices" for multi; schedule is edited as the
grammar line with an examples menu; "Always allow" only on CLI approvals.

Core changes needed: the shell does not export `useAgents`, `AgentSetup`,
`AgentLogo`, `accountEntries`, `statusWord`; `Cli.tsx` and `App.tsx` import them by
relative path. Please export them from `packages/shell/renderer/index.ts`.

Not done: Codex sign-in run; keyboard paste into the bot page while in control
(the page has no system clipboard); a paged "earlier messages" check beyond 6 runs.

### Finish pass, 2026-11-18

Shell now exports `useAgents`, `Agents`, `AgentLogo`, `AgentSetup`, `accountEntries`, `statusWord`; the renderer imports them from `@opendeck/shell`. A bot's computer opens on the browser while its browser has a page and the bot runs (or acts), until the person minimizes it; the empty-browser message now fills the content area.
Real run from the UI (Research on Antigravity, "Open https://example.com ... three-line summary doc"): live example.com thumbnail on the overview, live page with cursor and name tag in the computer view, then chat steps and the doc in Library. Captures in `%TEMP%\crewrun` (not in the repo). The real browser's page target shows up beside the app's in CDP; drivers must skip it.

### Connectors: installed per machine, granted per bot, 2026-11-18

Built: connectors live in `<userData>/Crew/connectors/<name>.json`
(`packages/crew` `connector.ts`; `apps/crew/src/main/connectors.cjs`), with
environment values and headers marked secret encrypted by Electron
`safeStorage` (DPAPI here) and never written to a bot folder, a log or the
page. bot.md holds grants only (`allow`, `ask`, `off` lists and `default`);
older bot.md files with a whole command or url connector are moved to the
machine on load (values kept as secrets, a grant left in place; a file
that can't be moved is left as it is and can't be changed from the app
until fixed). The app keeps one running copy of each connector
(`connections.cjs`: started on first use, shared, restarted when it stops
while in use, stopped when idle). The new `gateway` server
(`packages/crew-mcp`) lists the run's allow and ask tools as
`<connector>__<tool>` and runs every call through the app
(`gateway.cjs`), which asks on the existing approval card for ask (Approve
once / Always for this bot / Deny) and logs a `connector` run event. The
CLI permission-prompt path (`approve_tool`, `state.allowedTools`) and the
per-CLI connector entries in `servers.cjs` are gone. UI: a Connectors page
in the sidebar (list with status and tool count, add by registry search,
command or address with masked secret fields, test, edit keeping secrets,
remove naming the bots that lose it) and, in a bot's Details, Fenna app
toggles and a grant editor with a three-way level per tool, "Set all", a
filter past 8 tools and "Tools it adds later".

Proof in the real app (temp `--user-data-dir`, `OPENDECK_CREW_ROOT` on a
copy of `examples/sample-crew`, the stdio test server
`packages/crew-mcp/test/fixtures/notes-server.mjs` added from the UI with
its token as a secret, granted to Research with `list_notes` allow,
`add_note` ask, `clear_notes` off):

| Run | CLI, model | Result |
| --- | --- | --- |
| list, add, clear | Antigravity, Gemini 3.8 Flash (High) | `list_notes` ran with no card (`allow`, `done`); `add_note` showed the card and wrote nothing until approved; the bot said there is no tool to clear notes and named only `notes__list_notes` and `notes__add_note` |
| add "Sell the car" | Antigravity, Gemini 3.8 Flash (High) | denied on the card: one approval, outcome `denied`, no retry, file unchanged, reply "was not approved" |
| add "Call mom", list, delete | Antigravity, Claude Sonnet 4.6 | approved once: written; list ran without asking; no delete tool visible |
| first try, default model | Antigravity, default | listed without asking, then wandered off (tried an unrelated file, denied) and ended without trying add_note |

Antigravity's own tool-doc folder for the gateway held only the two
granted tools. The token appears nowhere in the profile, the crew folder or
the app log. Also checked live: registry search, a registry server that
answers 404, a server that exits ("It said: NOTES_TOKEN is not set…") added
anyway, a 63-tool connector with a 32-character name, editing with the
secret kept, removing (grants taken out of Research and Inbox), the
migrated `tracker`, an uninstalled `calendar` grant, the empty state.
Captures (not in the repo): `%TEMP%\claude\…\scratchpad\proof\shots`,
1440×900 dark and light, plus 1000×700.

Not done: Claude Code and Codex runs (neither is installed on this
machine; their paths are unchanged apart from getting `gateway`, which is
trusted like the other servers). OAuth sign-in for URL connectors (a token
header works). Electron 45 marks the synchronous `safeStorage` calls as
deprecated; moving to the async ones means making migration on read
asynchronous. "Always for this bot" was proven in tests, not live.

### Browser tabs, smoothness, sound and connector sign-in, 2026-11-18

Built: the bot's browser fills its desktop above the taskbar with our own
chrome (tab strip with icon, title, sound toggle, close, new tab; back,
forward, reload/stop, address bar with loading; minimize to the desktop;
the taskbar's browser icon shows it is open, with a mute for the bot). Pages
lay out at the size of the area the person sees, sharp at the screen's
pixel ratio, and go back to 1280×800 when nobody watches. Up to 8 real tabs
per bot; `target=_blank` and `window.open` open tabs. The browser server
gained `tabs`, `switch_tab`, `close_tab` and `open` `new_tab`. Live frames
are GPU shared textures drawn by the shell's preload (an approved shell
change), up to 60 a second; JPEGs only as a fallback. Sound only while the
bot's computer is open and visible; Stop pauses media. Web connectors sign
in with OAuth (`packages/crew-mcp/src/oauth.ts`, on the SDK's `auth()`), with
tokens in an encrypted `<name>.auth`; connector secrets moved to the async
`safeStorage` API.

Smoothness, measured on a YouTube video (Big Buck Bunny) at 1440×900:
before, 12 frames a second reached the person (the tab's rAF ran at 12);
after, the tab's rAF runs at 60, the person gets every frame the video
paints (30 to 40 a second for a 30 fps stream, no dropped video frames),
and a 60 fps animation reaches them at 60. Chosen over an on-screen view:
a prototype showed a detached or hidden on-screen view stops rAF and can't
be captured or screenshotted, so bots would break while nobody watches;
offscreen pages keep rAF at 60 when not painting.

Proofs in the real app (built, temp `--user-data-dir`, copy of
`examples/sample-crew`): Wikipedia and example.com fill the area at
1440×900 and 1000×700, dark and light (page reports 1406×659 and 966×459 in
areas of 1404×658 and 964×458); a `target=_blank` link opened tab 3 and made
it active; new tab button, switch by clicking, close; take control typed in
the address bar and in a page field; give back. Antigravity (default model)
got "open example.com and wikipedia.org in two tabs and tell me both
titles": `tabs`, `open`, `open new_tab`, `tabs`, answer with both titles,
no retries, twice; then `screenshot` of the active tab worked. YouTube: heard
in the view, not heard after going to the overview (video kept playing
muted), heard again on return, tab mute and bot mute both silence it, Stop
paused it. OAuth: added the local fixture from the Connectors page, signed
in in the default browser (registration, PKCE S256, "Signed in as
person@example.test", 1 tool), the token expired and Test refreshed it, sign
out revoked 2 tokens and deleted `notesweb.auth`; no token in the page's
data or in plain text on disk. Tests: browser helpers, tab labels, and
`packages/crew-mcp/test/oauth.test.ts` (discovery, PKCE refused with a wrong
verifier, refresh, sign out, cancel, pasted client id).

Not done or limits: a tab's pixel ratio is fixed when it opens (moving the
window to a screen with another ratio sharpens only new tabs); the shared
texture path is experimental in Electron 45 (JPEG fallback when it gives
none); OAuth proven against the local fixture only, not a public server;
a bot using a signed-in connector through the gateway uses the same
connection path Test proved, but no bot run used one; migrating a
connector out of an older bot.md still uses the sync `safeStorage` calls
(it happens while bot.md is read).

### Vault: the person's logins, filled by Crew, 2026-11-18

Built: a per-machine vault (`packages/crew` `vault.ts`;
`apps/crew/src/main/vault.cjs`) in `<userData>/Crew/vault.dat`, the whole
file encrypted with async `safeStorage` and each password and 2-factor
setup key sealed again inside. bot.md `logins` grants vault items by name
with `allow` or `ask` (validated with fix-it errors; written only when a bot
has some, so the examples are unchanged). The browser server gained
`logins` (granted items whose origins match the active tab: label, username,
has 2FA), `sign_in` (Crew finds or takes the field refs, fills in one
in-page step that refuses on any other origin, optionally submits) and
`fill_code` (current TOTP, RFC 6238). `logins.cjs` checks the grant and the
exact origin, shows the approval card for `ask` (Approve once / Always for
this bot / Deny; one approval covers that sign-in's code step for 5
minutes; a denial holds for the run), logs a `login` run event for every use
and blanks filled secrets out of everything the bot's browser returns.
Snapshots show password, code and Crew-filled fields as `filled`/`empty`;
screenshots are refused while a filled secret shows as text. While the
person has control, a capture script in its own world reports a sent
password form over a CDP binding; the bot's computer shows "Save this login
to the vault for <bot>?" (Save adds it, or updates the login with the same
site and username, and grants it on `ask`). UI: a Vault page beside
Connectors (list with label, sites, username, 2-factor, used by; add, edit,
remove naming the bots; Reveal on click, hidden again after 20 s; Copy in the
main process, cleared after 30 s; find past 8 logins), a Logins section in a
bot's Details (Give a login, Allow/Ask, take away), the login approval card,
the save card, and an Overview banner for waiting offers. Fixture:
`apps/crew/test/fixtures/login-site.mjs` (login, then a TOTP step, then a
signed-in page on 127.0.0.1:8765, and a copy on :8766).

Proof in the real app (built, temp `--user-data-dir`, `OPENDECK_CREW_ROOT`
on a copy of `examples/sample-crew`, Research on Antigravity, default model;
the login added from the Vault page with a setup key pasted as an otpauth://
address, granted from Research's Details):

| Run | Result |
| --- | --- |
| "Sign in to the test site and tell me the page title after login" (ask) | `tabs`, `logins` (none for the empty tab, so it learned the origin), `open`, `logins`, `sign_in` → approval card "Sign in to 127.0.0.1:8765 as alice" → Approve once → filled and submitted → `fill_code` (no second card) → "Welcome alice – Test Site Dashboard". The site logged password ok, code ok. |
| Sign in on http://127.0.0.1:8766 (other origin) | refused before any card: "Crew won't fill "Test site" here: this page is on http://127.0.0.1:8766 …"; the copy site never received a sign-in; the bot said why |
| Sign out, sign in again; Deny | one card, denied, no retry and no second card; the site got nothing; the bot said it was not approved |
| Level switched to Allow from Details, sign in again | no card; filled, code filled, signed in |
| Fill without submitting, then screenshot | the screenshot showed the password masked by the page; the bot said so |
| Take control of Inbox, type a username and password, press Sign in | the save card; Save added a new login and granted it to Inbox on ask; a second time with alice offered "Updates the saved password of this login" and granted Test site to Inbox |

Search for the secrets (the password, the take-control password and the
setup key; plain, UTF-16 and base64 at every alignment) over the crew copy
(bot folders, every `runs/*.jsonl`), the whole temp user data (vault.dat,
Antigravity's per-bot homes with their transcripts, conversation databases
and logs, the page's Local Storage, Session Storage, IndexedDB and caches),
the app log, `~/.gemini`, `%APPDATA%/Antigravity` and recent files in
`%TEMP%`: 10,757 files, 1.2 GB, no hit, before and after the app quit. A
control file with each encoding was found. The page's own data
(`crew:vault`, `crew:overview`, the DOM before Reveal, localStorage) held no
secret; the DOM held the password only between Reveal and Hide. The model's
transcript shows `password "Password" empty` / `textbox "Code" empty` in
snapshots and "Crew filled the username and password of "Test site" on …"
as the result. Tests: origin matching (look-alikes, ports, schemes,
userinfo, trailing dots, punycode), RFC 6238 vectors for SHA1, SHA256 and
SHA512 and RFC 4226's HOTP values, setup keys and otpauth://, item checks,
the vault file (encrypted whole, secrets sealed inside, a file it can't open
left alone), masking of the page's view, grants in bot.md, and the logins
flow (allow, ask, deny held for the run, Always for this bot written to
bot.md, timeout, origin refused before and during the fill, nothing secret
in run logs or the bot folder, scrubbing of browser results). Captures (not
in the repo): `%TEMP%\claude\…\scratchpad\vp\shots`, 1440×900 dark and light.

Not done or limits: only Antigravity was run (Claude Code and Codex aren't
installed here; their path is the same browser server). Fields are found in
the top document only, not in a cross-origin iframe; a sign-in form in an
iframe needs take control. Sites that split a code over six one-digit
boxes need take control. The capture offers on any password form the person
sends, including a sign-in the site then rejects. A shell issue seen once:
the first resumed Antigravity run failed in 23 ms with "Antigravity isn't
installed on this computer" and worked when sent again (the shell's
friendly() maps any "not found" to that message, which also hides the
runner's lost-session retry).
