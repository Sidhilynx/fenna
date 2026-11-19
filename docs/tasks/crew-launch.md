# Crew: launch plan (Product Hunt, 2026-11-21)

For builders (any model) taking one task at a time. Read AGENTS.md,
docs/process.md, docs/apps/crew.md and **docs/ui-rules.md** first. Each task
names its files and its acceptance list; do only that task, then hand over
with captures (1440×900 and 1000×700, dark and light) and
`node scripts/check-ui.mjs apps/crew` output.

Written 2026-11-19 by Claude Opus after a full read of Crew and of Rakazo
(github.com/elie222/rakazo, Apache-2.0), the closest open-source product.

## Where Crew stands

The engine is strong and further along than the UI: per-bot offscreen
browser with tabs at 60 fps, take control, a vault that keeps passwords
away from the model (proved by a byte search of 10k files), connectors with
per-tool allow/ask/off and OAuth, schedules, teams with hand-off limits,
122 tests in Crew alone. The UI is what reads as generated: Title Case
headings with "&", fake personas, a 4-step wizard, a "Live Execution
Terminal" in a Tailwind slate palette, every block a bordered card, the same
fox for every bot, actions offered twice, and dead settings.

Already fixed on 2026-11-19 (don't redo): starter templates created nothing
(schedules the grammar rejects, wrong app ids; now tested in
`apps/crew/test/templates.test.ts`); Enter and the step tabs skipped the
name and job check; the lead bot was hard-coded to Claude Code, so first
launch failed on a Codex- or Antigravity-only computer (now moves to the
first signed-in CLI); workspace paths like `../workspace2/x` escaped the
folder (now refused, tested); the panel saved a stale width; "Concurrency"
was ignored (now read at start, 1–4).

## P0: before launch

### 1. Prove it on Claude Code and Codex (person + any model)
Most Product Hunt visitors run Claude Code. Every live proof so far is
Antigravity. Install and sign in Claude Code and Codex, then run the brief's
four agent tasks on each from the real UI (`scripts/agy-try.mjs` style is not
enough; use the app). Record pass/fail and transcript paths in the brief.
Acceptance: all 4 tasks pass on Claude Code; tasks 1–3 pass on Codex; any
failure is a filed finding with its transcript.

### 2. Installer smoke test (person)
`npm run dist -w @opendeck/crew-app`; install on a clean Windows user
account and, if possible, a Mac. First launch with no CLI: the sign-in card
shows; sign in; Fenna greets; create a bot from a starting point; run now;
close the window (tray keeps it); reopen from tray; quit from tray.
Acceptance: every step works with nothing from the repo on the machine.

### 3. Copy pass (`apps/crew/src/renderer/*.tsx`)
Fix every `copy` error from `check-ui.mjs` (41 today) and every `case` warning
in Crew (70), following ui-rules §4. Specific renames:
- "Chrome Browser" → "Browser"; "Chrome Automation Engine" tooltip → delete.
- "Terminal / Logs", "Live Execution Terminal — X", "Terminal & Live Activity"
  → "Activity". "Bot session initialized… stream connected." → delete.
- "Files & Workspace", "Workspace & Files Explorer" → "Files".
- "Open in Windows File Explorer" / "Open in Explorer" → "Show in folder".
- "Teams & Collaboration" → "Teams"; "Team Roster:" → delete the label.
- Panel sections → "How it works", "Schedule", "Brain", "Ask me before",
  "Connectors", "Logins", "Wallpaper", "Memory". "N tools active" counts
  connectors: say "N connectors".
- Settings → "General", "Appearance", "CLIs", "Runs", "Data".
- "No AI is signed in / Configure CLIs" → "Sign in to Claude Code, Codex or
  Antigravity to start your bots." with a "Sign in" button.
- "Press Win + H" → use the platform's real dictation hint or remove the mic.
- "Created by <bot>." on a file the person made → "Edited by you".
Acceptance: `check-ui.mjs apps/crew` has 0 `copy` errors and 0 `case` warnings.

### 4. Tokens pass (`styles.css`, `Fox.tsx`)
Fix every `color` (36) and `font-size` (10) error. Terminal palette goes
(task 6 removes the terminal look). `--shadow-lg` is used and never defined:
use `--shadow`. Delete the dead CSS listed below. Pills (`.roster-chip`,
`.step-pill`, `.sender-role-pill`, `.lead-tag`, `.template-tag`,
`.verified-badge`, `.term-active-tag`) become plain text or go.
Dead CSS: `.desk-windows .win-body .act-line .act-time .act-text .act-wait
.file-row .file-kind .file-when .files-body .dark-win.activity
.dark-win.files .fx-look .head-status .head-dot .btab-audio .btab-bot
.btab-spin .as-setup`. Classes used but never defined: `.done-line
.fx-pulse .ws-folder-label .ws-viewing-name .desk-label .desk-surface
.templates-view .builder-view .builder-form .settings-ctrl .sender-name
.team-msg .team-chat`: define them or drop them from the TSX.
Acceptance: 0 errors from `check-ui.mjs apps/crew`; spacing warnings in
touched rules fixed; both themes captured.

### 5. Settings that do nothing (`Settings.tsx`, `main.cjs`, `crew.cjs`)
Notifications, font scale, "minimize to tray", "Clear cache" and default
CLI/model/effort are shown but not used. Wire or remove each:
- **Notifications: wire it.** When a bot waits on the person (ask, approval,
  login offer) and the window is hidden or unfocused, show a system
  notification "Research needs you: Approve sending the email?"; clicking it
  opens that bot's chat on the card. This is what makes "always on" usable.
- Default CLI/model/effort: wire into the New bot form's starting values.
- Font scale, minimize to tray, Clear cache: remove.
- Concurrency: says "takes effect after restart", or apply it live.
Acceptance: every control on Settings changes behavior; tests for the
notification trigger (hidden window + new wait → one notification).

### 6. Bot computer (`Computer.tsx`)
- Rename and restyle the terminal window as **Activity**: the run's step
  lines in the app's normal type and colors, newest at the bottom, "Respond
  in chat" when it waits. No monospace slate panel.
- Fenna Docs/Sheets/Slides icons open the newest library file of that kind
  (the brief says so; the code opens Files).
- Taskbar: the bot's brain (CLI and model) on the right, as in the mockup.
- Wallpaper: one entry point (desktop right-click and Details). Remove it
  from the desk bar and the desktop hint.
- Fix the Rules of Hooks break: `useState` after the early return (around
  line 708–729); move hooks above it.
Acceptance: captures of home, browser open, Activity open, take control;
no React warnings in the console.

### 7. Error boundary (`App.tsx`)
One boundary around the routed screen: "Something went wrong on this screen.
Back to Crew" with the error text in a details line. A crash in one bot's
chat must not blank the app.

### 8. Connectors claims (`Connectors.tsx`)
The curated list marks 12 servers "Verified · Official MCP Server" with no
check. Remove the badge and tooltip, or check each `npx` package exists and
is published by the named owner and say only that. Remove any that don't
exist.

## P1: launch week, if time allows

### 9. Overview (`Overview.tsx`, `Sidebar.tsx`, `App.tsx` header)
- Remove the header gear (Settings is in the sidebar) and the "New bot"
  primary button (the tile stays; "+" in the sidebar stays).
- A bot that is asleep and has no frame shows **what it did last**, not a
  gray "Screen off" box: last run time, its one-line result, the newest
  library file. Live thumbnails only for bots that have a screen.
- Sidebar section titles "Bots" and "Teams" share one style and indent.
- Summary line: "2 asleep" → "Next: Inbox, Fri 09:00".
Acceptance: side-by-side with `mockup/Main.dc.html`; empty, one, 50 bots.

### 10. New bot: one form (`Dialogs.tsx`, `templates.ts`)
Replace the 4-step wizard with one form: name, job (one line), schedule (the
examples menu), brain; "More" opens how it works, Fenna apps, ask me before,
wallpaper. Starting points become a short plain list above the form ("Check
a page every Monday and write what changed"), no category tags, no glyph
tiles; picking one fills the form, nothing is created until "Create bot".
Keep `templates.test.ts` passing.

### 11. Details panel (`Panel.tsx`)
Sections, not eight bordered collapsible cards (ui-rules §5). Add **Runs**
(the brief asks for it): last 20 runs, time, trigger, result, duration;
click opens it in chat.

### 12. One face per bot (`Fox.tsx`, decision needed from the lead)
Every bot has the same fox, so the sidebar can't be scanned. Recommended:
flatten the fox (no gradients, no blush, no sparkles; two or three token
colors) and tint its fur from the bot's wallpaper token, so each bot is
recognizable and the mood still shows. Record the decision in the brief.

### 13. Keyboard
Ctrl+1–9 opens bots 1–9; Ctrl+N new bot; Ctrl+/ shows a shortcuts list
(Rakazo has the same pattern: `apps/web/src/pages/shell/shell-shortcuts.ts`).

## P2: after launch

### 14. Engine hardening (lead or Claude; core files)
- `packages/shell/main/agent.cjs` ~1025: cap a stdout line (e.g. 8 MB, like
  the pipe) and fail the run with a clear message past it.
- `friendly()` maps any "not found" to "isn't installed", hiding the
  lost-session retry (seen once with Antigravity). Match the binary error only.
- Spawn failure can call `fail` twice (`error` then `close`); guard it.
- `gateway.cjs` scrubs secrets only from logs; scrub connector results the
  model sees too.
- Model errors: retry 2 s, 8 s, 20 s on rate limits and dropped streams, and
  retry an empty reply once more (Rakazo: `pi-runtime-fallback.ts`).
### 15. Ideas from Rakazo worth taking (Apache-2.0: keep their notice if code is copied)
- A message sent while a bot runs **steers** that run instead of queuing
  (`docs/run-execution.md`).
- Approval card expiry with a reason, and "Auto" approvals judged by a
  model that falls back to asking (`approvals/auto-review.ts`). Only after
  the plain flow is loved.
- Run timing in Runs: time to first response, total.
- Import a bot from OpenClaw or Hermes (`agent-import/*`).
- A checks folder like their `scripts/checks/*`: our `check-ui.mjs` is the
  first; add it to CI.

## How we compare (for the launch copy)

| | Fenna Crew | Rakazo |
|---|---|---|
| Install | One desktop app download | Docker Compose + Postgres server (desktop app on Apple silicon only) |
| Runs on | The person's Claude Code, Codex or Antigravity plan | API keys, or ChatGPT sign-in; Claude Code only from a source checkout |
| Bot's computer | Its own browser on your machine, watch and take control | Linux sandbox (Docker, E2B, Daytona, …) |
| Passwords | Vault; Crew fills, the model never sees them | Vault credentials |
| Connectors | Any MCP server, per-tool allow/ask/off | MCP + Composio/Pipedream catalogs |
| Channels | The app only | Web, mobile, Slack, Teams, Telegram, WhatsApp, email, voice |
| Data | Plain folders on your disk | Postgres |

Our line: **"Always-on bots that run on the AI plan you already pay for. One
download, no server, no API keys. Your files stay on your computer."**
Don't claim channels, mobile, voice or sandboxes; we don't have them.
