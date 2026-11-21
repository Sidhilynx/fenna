# Fenna Crew (app)

A team of always-on bots that do real work on the person's own computer,
with the CLI they already pay for (Claude Code, Codex or Antigravity). The
brief is [docs/apps/crew.md](../../docs/apps/crew.md); the design target is
`example-screenshots-crew/mockup/Main.dc.html`.

Stage: build. The main process (this README) and the page in
`src/renderer/` are built; the page talks to the main process only
through the contract below.

```powershell
npm run build -w @opendeck/crew-app      # page + bundled MCP servers and format
npm run dev -w @opendeck/crew-app        # hot reload
$env:OPENDECK_CREW_ROOT = "D:\some\copy\of\examples\sample-crew"   # optional: another crew folder
```

`OPENDECK_SHOT`, `OPENDECK_SHOT_SIZE`, `OPENDECK_SHOT_DELAY` and
`OPENDECK_THEME` work as in the other apps (whole-page capture, then quit).
Always pass `--user-data-dir=<temp>` on review runs.

## Faces

bot.md has `avatar:` (one of `AVATARS`) and `color:` (one of `AVATAR_COLORS`), written after `job:` in every file. Values are read in any case. When one is missing, Crew takes it from the bot's name with `defaultAvatar(name)` (a stable hash, so the same name always gets the same face), with no warning; an unknown value is a warning with a "did you mean" and the name's default is used. A new bot made without them (`crew:create`, the `create_bot` tool) gets a design no other bot has while one is free, and the color the fewest bots have (`pickAvatar`). `BotSummary` and `Bot` carry `avatar` and `color`.

## Group chats and mentions

Teams are shown to people as group chats; the data stays `team`. A message to one goes to the lead, unless it @mentions bots: `@Research` or `@research` (any case; the whole bot name, which may hold spaces, longest name first; the folder name works too) sends it to that bot, and several mentions send it to each in order of first mention, one after another. `@all` or `@everyone` sends it to the lead, then every member. Only the lead and the members can be mentioned, and at most `LIMITS.teamMembers` runs start for one message. Each reply is added to the thread with `from` set to that bot's folder name (`avatar` and `color` come from the bot's summary). The lead may also be listed under `members:`; it is kept as the lead only.

## Main process

| File | What it does |
| --- | --- |
| `main.cjs` | Window, tray (closing hides; Quit is in the tray; Open at login), single instance, `--hidden` at login |
| `team-chat.cjs` | A message to a group chat: who gets it (@mentions, `@all`, else the lead), one after another, and where each reply goes in the thread |
| `crew.cjs` | Puts the services together; creates the lead bot "Fenna" on first launch |
| `store.cjs` | The crew on disk, `<userData>/Crew/bots/<slug>/…` and `teams/<slug>/…`; atomic writes |
| `runner.cjs` | Runs: one per bot, at most 2 at once (hand-offs from a running bot don't count), a queue, run logs, sessions resumed, a lost session retried fresh once, 30-minute limit |
| `prompt.cjs` | What a bot is told each run (job, how, rules, ask-before list, memory, library, the crew, team, why it woke) |
| `handlers.cjs` | What the crew MCP server asks for: questions, approvals, hand-offs (max 6 per message, no cycles; files copied for a hand-off, all or nothing), create_bot (approved first), memory, status; browser and gateway requests passed on |
| `waits.cjs` | Questions and approvals waiting on the person; 15-minute timeout; cancelled when a run stops |
| `link.cjs` | The local named pipe / unix socket the MCP servers reach the app on; a secret token per run |
| `servers.cjs` | Each run's MCP servers: `crew`, `browser`, `fenna` (workspace-mcp in the bot's library), and `gateway` when the bot is granted installed connectors. Every server is trusted; connectors are never handed to the CLI |
| `connectors.cjs` | Connectors installed on this computer, `<userData>/Crew/connectors/<name>.json`, secret values encrypted with Electron `safeStorage` (async API); a web connector's sign-in in `<name>.auth`, encrypted whole; moves connectors written whole in an older bot.md here (a grant stays in bot.md) |
| `skills.cjs` | Skills installed on this computer, `<userData>/Crew/skills/<name>/`: reads a folder, file or https address into a preview, adds it on commit, copies granted ones onto a bot's disk before each run (`Files/Skills`), and the grants (who has which skill) |
| `connections.cjs` | Each connector's program (or web session): started on first use, shared by every bot, restarted if it stops while in use, stopped after 10 idle minutes |
| `gateway.cjs` | What the `gateway` server asks: the running bot's tools on allow or ask (never off), and every call, asking the person first for ask and logging it |
| `vault.cjs` | The vault of the person's logins, `<userData>/Crew/vault.dat`: the whole file encrypted with `safeStorage` (async), each password and 2-factor setup key sealed again inside; secrets opened only to fill, copy or reveal |
| `logins.cjs` | The browser tools `logins`, `sign_in`, `fill_code`: only granted logins, only on their exact origins, the approval card for `ask`, a `login` run event for every use; blanks filled secrets out of everything the bot's browser returns |
| `client.cjs` | The MCP client connectors are started with (`packages/crew-mcp`, `client.ts`) |
| `browser.cjs`, `page-scripts.cjs` | Each bot's offscreen browser, `persist:crew-<slug>`: up to 8 tabs (pages that open a window open a tab), driven over CDP on the active tab; pages lay out at the person's view size while they watch; live frames as GPU textures at up to 60 a second, thumbnails as JPEGs; take control (and, while in control, catching a password form the person sends, to offer saving it); filling vault logins in one in-page step that checks the origin; sound only while its computer is open; downloads save to the bot's `workspace/downloads/` without a dialog (500 MB cap, unique names), and the next successful browser call says which finished |
| `scheduler.cjs` | Wakes bots on their schedules (checks every 30 s; a run missed by under a day runs once on start) |
| `views.cjs` | Overview, bot detail and history in the contract's shapes; mood and status line |
| `runstats.cjs` | The Usage page's numbers from every bot's run logs: runs, time, tokens and API value per assistant and per bot, day and week buckets, limit hits. Reads only `start`, `end` and `tokens` lines, cached per file |
| `registry.cjs` | MCP Registry search, each result turned into a connector to fill in and install when it can be |
| `labels.cjs` | Tool calls in plain words for step lines |
| `ipc.cjs` | The page's calls, each argument checked |

## IPC contract

Types: [`src/shared/contract.ts`](src/shared/contract.ts) (import it; it is
the source of truth). Typed helpers: [`src/shared/api.ts`](src/shared/api.ts)
(`invoke`, `on`, `send`, `errorText`). The page uses the shell's preload
(`window.shell`), so the shell's UI kit and its CLI install and sign-in card
(`agent:catalog`, `agent:install`, `agent:signIn`, `agent:signInCode`,
`agent:signInCancel`, `agent:signOut`, `agent:setAccountMode`,
`agent:openUrl`, events on `agent:setup`) work here too. `shell:theme` and
`shell:userName` are there as well.

Errors reject with a sentence to show as it is (`errorText(e)` strips
Electron's prefix).

### Calls (`invoke`)

| Channel | Args | Result | Notes |
| --- | --- | --- | --- |
| `crew:overview` | | `Overview` | Everything for the sidebar, the crew grid and the banner. Also pushed on `crew:changed`. |
| `crew:bot` | slug | `BotDetail` | Settings, memory, library, last 20 runs. `bot` is null when bot.md can't be read (see `summary.diagnostics`). |
| `crew:history` | slug, `{ before?, limit? }` | `HistoryPage` | Chat transcript: runs oldest first, each with its events. Page back with `before: runs[0].file`. |
| `crew:create` | `NewBotInput` | `{ slug }` | name, job, how, avatar, color, schedule, cli, model, effort, connectors, askBefore, wallpaper. Without avatar or color Crew picks a design no other bot has and the least used color. Rejects with what to fix (an unknown avatar or color lists the valid ones). |
| `crew:update` | slug, `Partial<Bot>` | `BotDetail` | Same checks as bot.md. `brain` merges. |
| `crew:delete` | slug | `true` | Stops it, closes its browser, moves its folder to the system trash. |
| `crew:forget` | slug | `true` | Starts a fresh conversation next run (sessions cleared). |
| `crew:send` | slug, text | `{ runId, queued }` | A message from the person. |
| `crew:run` | slug | `{ runId, queued }` | "Run now": as if its schedule woke it. |
| `crew:greet` | | `{ runId } \| null` | First launch only: Fenna greets and asks with choice cards. Null once any bot has run. |
| `crew:stop` | slug | boolean | Stops the run and drops its queued ones. |
| `crew:answer` | waitId, `string[]` | boolean | Answer an `ask` (chosen options, or typed text as one item). Empty list = dismissed. |
| `crew:decide` | waitId, allowed, always? | boolean | Answer an `approval`. `always` only counts for `source: "connector"` (sets that tool to `allow` in the bot's grant) and `source: "login"` (sets that login to `allow` for the bot). |
| `crew:teamCreate` | `Team` | `{ slug }` | |
| `crew:teamUpdate` | slug, `Partial<Team>` | `TeamSummary` | |
| `crew:teamDelete` | slug | `true` | |
| `crew:teamSend` | slug, text | `{ runId, queued }` | A message in a group chat (a team). See "Group chats and mentions". `runId` is the first run. |
| `crew:teamThread` | slug | `ThreadMessage[]` | `from` is "person" or a bot slug; `to` on hand-offs. |
| `crew:registrySearch` | query | `RegistryEntry[]` | `connector` is a `ConnectorInput` to fill in (the values it needs listed empty, secret when the registry says so) and pass to `crew:connectorSave`; `note` says what is still needed. |
| `crew:runStats` | range (`7d`, `30d`, `12w`) | `RunStats` | The Usage page: totals per assistant and per bot, runs per day and week, limit hits with the reset time when the CLI stated one. Tokens and API value are `null` where a CLI doesn't report them. |
| `crew:connectors` | | `ConnectorView[]` | Connectors installed on this computer: status, tools as last seen, the bots granted it. Secret values are never sent (`value: ""`; `set` says whether one is saved). Also pushed on `crew:connectors`. |
| `crew:connectorSave` | `ConnectorInput`, `{ replace?, force? }` | `ConnectorSaveResult` | Add one (or change `replace`; a name can't change). Crew starts it and lists its tools first; if that fails nothing is saved (`connector: null`, `error` says how to fix it) unless `force`. A secret is sent once in plain text and stored encrypted; `keep: true` keeps the saved one. Bad input rejects. |
| `crew:connectorTest` | name | `ConnectorView` | Start it again (apart from the bots' copy), list its tools, keep the outcome. |
| `crew:connectorSignIn` | name, `{ clientId? }` | `ConnectorSignInResult` | Sign in to a web connector: the person's default browser opens the server's sign-in page; resolves when they finish, cancel, or after 5 minutes. `needsClientId`: the server doesn't let apps register; ask for a client ID and call again with it. Tokens never reach the page. |
| `crew:connectorSignInCancel` | name | boolean | Stop waiting for that sign-in. |
| `crew:connectorSignOut` | name | `ConnectorView` | Forget the sign-in (the server is asked to revoke it); bots can't use it until someone signs in again. |
| `crew:connectorRemove` | name | `{ bots }` | Stops it, takes its grant away from every bot (their names come back) and deletes it with its secrets. |
| `crew:skills` | | `SkillView[]` | Skills installed on this computer, each with the bots that have it. Also pushed on `crew:skills`. |
| `crew:skill` | name | `SkillDetail` | One installed skill: its instructions (SKILL.md after the front matter) and its files. |
| `crew:skillFolder` | | `SkillPreview \| null` | Asks for a folder, then reads it into a preview. Null when the person cancels. Nothing is added yet. |
| `crew:skillFile` | | `SkillPreview \| null` | The same for a `.md` or `.zip` file. |
| `crew:skillUrl` | url | `SkillPreview` | The same for an https address: a raw SKILL.md or a GitHub folder. Rejects with what to fix. |
| `crew:skillAdd` | id | `SkillView` | Adds the previewed skill (replacing one of its name). Rejects when the preview has expired. |
| `crew:skillRemove` | name | `{ bots }` | Deletes the skill and takes it from every bot that had it (their names come back). |
| `crew:vault` | | `VaultItemView[]` | The logins in this computer's vault, each with the bots granted it and their level. Never a secret: `password` is `MASK` or "", `hasTotp` says whether it has a setup key. Rejects with why when the vault can't be opened (saved by another user or computer). Also pushed on `crew:vault`. |
| `crew:vaultSave` | `VaultItemInput`, `{ replace? }` | `VaultItemView` | Add a login (its name comes from the label) or change one (`replace`: its name, which never changes). `origins` must be origins (https; http only on localhost/127.0.0.1/[::1]); the page turns a pasted page address into its origin first. `password` and `totp` (a setup key or otpauth:// address) are sent once in plain text and stored encrypted; `keepPassword` / `keepTotp` keep the saved ones; `totp: ""` removes it. Bad input rejects with what to fix. |
| `crew:vaultRemove` | name | `{ bots }` | Takes it from every bot granted it (their names come back) and deletes it with its secrets. |
| `crew:vaultReveal` | name | `{ password }` | The password, for the person who clicked Reveal (the page hides it again after 20 s). Never sent to a run. |
| `crew:vaultCopy` | name, `"username" \| "password" \| "code"` | `{ copied, clearsIn, secondsLeft }` | Copies in the main process; a password or code is cleared from the clipboard after 30 s if it is still there. `code` is the current TOTP code (`secondsLeft` it lasts). |
| `crew:saveOffer` | offerId, save, `{ username? }` | `{ item }` | Answer an `Overview.offers` entry (Save / Not now). Save adds the login (or updates the password of the login with the same origin and username) and grants it to that bot on `ask`; `username` corrects what the form had. |
| `crew:reveal` | slug, libraryPath? | `true` | Shows the bot folder, or a library document, in the file manager. |
| `crew:watch` | slug, `"live" \| "thumb" \| "off"` | `BrowserState` | Subscribe to a bot's screen. `live` opens its browser: frames of the active tab, up to 60 a second, drawn as GPU textures onto `<canvas data-live="<slug>">` by the shell's preload (a `liveframe` event with `data-view-width/height` follows each), or `crew:frame` JPEGs (30 a second) when the GPU gives no texture. `thumb` only watches an open one (1 fps, 320 wide JPEG). Always send `off` when the view goes. |
| `crew:control` | slug, on | `BrowserState` | Take control / give back. While on, the bot's browser tools wait 15 s, then fail with "The person has control of the browser. Wait, then call snapshot again." |
| `crew:navigate` | slug, url | `BrowserState` | The person's address bar (active tab), only in control. |
| `crew:browserGo` | slug, `"back" \| "forward" \| "reload" \| "stop"` | `BrowserState` | The toolbar, active tab, only in control. |
| `crew:tab` | slug, `"new" \| "switch" \| "close"`, id? | `BrowserState` | The tab strip, only in control. At most 8 tabs (rejects with why); closing the last leaves one empty tab. |
| `crew:mute` | slug, tab id or null, muted | `BrowserState` | Mute one tab, or the whole bot (null). Works while only watching. |
| `crew:settings` | | `Settings` | `openAtLogin`, `notifications`, `maxConcurrent`, `defaultCli`, `defaultModel`, `defaultEffort`, plus read-only `storagePath` and `vaultEncrypted`. |
| `crew:setSettings` | `Partial<Settings>` | `Settings` | Only `openAtLogin` and `notifications` (booleans), `maxConcurrent` (whole number 1 to 4, read when Crew starts), `defaultCli` (one of the CLI kinds) and `defaultModel` / `defaultEffort` (text, at most 100). Any other key rejects with the list of settings. `openAtLogin` is not on Linux (rejects with why). |
| `crew:clis` | fresh? | `CliStatus[]` | Installed, signed in, models and efforts for the brain picker. |

### Events (`on`)

| Channel | Payload | When |
| --- | --- | --- |
| `crew:changed` | `Overview` | Anything in the overview changed (runs start and end, waits, offers to save a login, status, bots, teams). Coalesced (80 ms). |
| `crew:event` | `LiveEvent` | Every run event as it is logged (`RunEvent`, below), plus `delta` (streamed text, Antigravity only; not logged). |
| `crew:frame` | `FrameEvent` | A JPEG of a watched bot's page (`Uint8Array`; make a Blob URL). |
| `crew:cursor` | `CursorEvent` | Where the bot is about to act (page pixels of `BrowserState.view`, in `tab`), with a short target. In live mode the bot waits 220 ms after this so the cursor can be seen moving. |
| `crew:browser` | `{ slug, state }` | Tabs (url, title, loading, icon, sound), the active tab, control, history, view size or mute changed. |
| `crew:connectors` | `ConnectorView[]` | A connector was added, changed, removed, started, stopped or failed. Coalesced (80 ms). |
| `crew:vault` | `VaultItemView[]` | A login was added, changed, removed or used. Coalesced (80 ms). |
| `crew:open` | `{ slug }` | The person clicked a system notification (a bot is waiting on them): the page opens that bot's chat. Sent when Notifications is on, a bot starts waiting and the window is hidden, minimized or not focused. |

### Sends (`send`)

| Channel | Args | Notes |
| --- | --- | --- |
| `crew:input` | slug, `ControlInput` | The person's mouse and keys while in control, in page pixels of `BrowserState.view`, to the active tab. Keys: send `keyDown`, then `char` for printable keys, then `keyUp`. Wheel deltas as the DOM gives them. Ignored when not in control. |
| `crew:viewport` | slug, `{ width, height, scale }` | The size of the area the person sees the page in (CSS pixels) and the screen's pixel ratio. While they watch live, every tab lays out at that size (send it once it settles; 150 ms works); 2 s after the last live watcher leaves, pages go back to 1280×800. New tabs paint at that pixel ratio. |
| `crew:present` | slug, open | The page has the bot's computer open (true) or left it (false). A bot is heard only while its computer is open in a visible window and nothing is muted. |

### Run events (`RunEvent`, from `@opendeck/crew`)

One run is one turn. Its events, in order, are also its log file
`runs/<iso>.jsonl`:

- `start` { runId, trigger: person \| schedule \| bot \| welcome \| watch, text, from, team, cli, model }
- `text` { text } — the bot's reply (the last one is its answer)
- `tool` { id, server, tool, label, status: running \| done \| failed } — a step line; same id updates the same line
- `ask` { askId, question, options, multi } → `answer` { askId, answer, by: person \| timeout \| stopped }
- `approval` { approvalId, action, details, source: bot \| connector \| login \| cli (older logs only), tool: "<connector>/<tool>" for a connector, the login's name for a login } → `decision` { approvalId, allowed, always, by }
- `status` { status, mood } — set_status
- `handoff` { to, text } → `handback` { from, text }
- `connector` { bot, connector, tool, level: allow \| ask, outcome: done \| failed \| denied \| timeout \| stopped, ms, message } — every gateway call; never argument or secret values
- `login` { bot, login, label, origin, action: sign_in \| fill_code, level: allow \| ask \| null, outcome: done \| refused \| failed \| denied \| timeout \| stopped, message } — every use of a vault login; never a password or code
- `end` { outcome: done \| error \| stopped, message }

`askId` / `approvalId` are the ids `crew:answer` / `crew:decide` take, and
the `id` of the matching `Overview.waiting` entry.

### Mood and status line

`BotSummary.mood`: `need` (something waits on the person) > `work` (running
or queued) > `sleep` (next scheduled run over an hour away) > `idle`.
`statusLine` is ready to show: "Needs you: …", the bot's status or current
step, "Waiting for a free slot", "Asleep until Fri 17:00", or its last status.
`needs` is the amber badge count.

## Data on disk

`<userData>/Crew` (or `OPENDECK_CREW_ROOT`); the format is
`packages/crew` (see its README). A sample: `examples/sample-crew`.

Connectors belong to the computer, not to a crew folder: always
`<userData>/Crew/connectors/<name>.json`, even with `OPENDECK_CREW_ROOT`.
A bot's bot.md holds only grants (connector name, tools under allow, ask
and off, and a default for tools added later).

The vault is the computer's too: `<userData>/Crew/vault.dat`. A bot's
bot.md names the logins it may use (`logins`, each `allow` or `ask`) and
nothing else of them.

Skills belong to the computer too: `<userData>/Crew/skills/<name>/`, a folder
with `SKILL.md` (front matter `name` and `description`, then the instructions)
and any files beside it. A bot's bot.md lists the skills it has (`skills`, by
name). Before each run Crew copies the granted, installed ones into the bot's
workspace at `Skills/<name>/`, which is `Files/Skills/<name>/` on its disk:
`read_file` reads them there, and the prompt names each with its description
and the path of its SKILL.md. Crew replaces that folder on every run, so
anything a bot writes into `Files/Skills` is lost. Limits: SKILL.md 100 KB, a
skill 5 MB and 200 files, no links, no path outside its folder.

## Skills

1. **Added once.** From a folder, a `.md` or `.zip` file, or an https address
   (a raw SKILL.md, or a GitHub folder `…/tree/<branch>/<path>` read through the
   GitHub contents API). Nothing is added unseen: the page shows the name, the
   description, the full SKILL.md and the other files, with "A skill is
   instructions a bot will follow", and Add skill commits what was read. A
   preview expires after ten minutes.
2. **Granted per bot.** The bot's Details, Skills section: a check per
   installed skill. A name that is granted but no longer installed stays listed
   and does nothing until it is unchecked.
3. **Removed.** Remove takes the skill away from every bot that had it (their
   names come back) and deletes its folder.

`skills.cjs` holds the store (reading sources, the limits, the sync onto a bot's
disk and the grants); `packages/crew/src/skill.ts` holds the name rule and the
SKILL.md parser.

## Connectors and the gateway

1. **Installed once.** Added from the Connectors page by registry search,
   command or address. Crew starts it and lists its tools before saving.
   Environment values and headers marked secret are encrypted with
   `safeStorage` (Windows DPAPI, macOS Keychain, a Linux keyring; Linux
   without a keyring refuses secret values) and are decrypted only to start
   the connector. They never go into a bot folder, a log or the page;
   connector error text has them blanked out.
2. **Granted per bot.** On grant, read-only tools (`readOnlyHint` and not
   `destructiveHint`) are `allow`, everything else `ask`, tools added later
   `ask`.
3. **Enforced by the gateway.** The CLI gets one more trusted server,
   `gateway`. It lists only the bot's `allow` and `ask` tools, named
   `<connector>__<tool>`; `off` tools are never listed and never reach the
   connector. Each call is checked against bot.md at the time of the call;
   `ask` waits on the approval card (Approve once / Always for this bot /
   Deny). The same holds on Claude Code, Codex and Antigravity because no
   CLI ever sees the connector itself.

## The bot's browser

- **Tabs.** Up to 8 per bot, all in its persistent session. A page that
  opens a window (`target=_blank`, `window.open`) gets a new tab, made
  active, with its opener kept; at 8 it opens in the current tab instead.
  The bot's tools act on the active tab; `tabs`, `switch_tab`, `close_tab`
  and `open` with `new_tab` manage them. The person's tab strip, toolbar
  and address bar work only in control (Ctrl+T, Ctrl+W, Ctrl+L too).
- **Size.** While the person watches live, pages lay out at the size of the
  area they see (`crew:viewport`), so the page fills it with no bands; at
  other times 1280×800. Cursor events and the person's input are in the
  page pixels of `BrowserState.view`.
- **Frames.** Tabs render offscreen: they keep running (requestAnimationFrame,
  lazy loading, screenshots) when nobody watches, which a detached
  on-screen view does not. Live frames go to the page as GPU shared
  textures, up to 60 a second, with little work in the main process;
  without a GPU texture they fall back to JPEGs. A frame skipped while the
  last one was still being sent asks for a fresh paint, so a page that
  paints once is never left blank.
- **Sound.** Heard only while the bot's computer is open in a visible window
  (not in the tray or minimized), and never from a tab or a bot the person
  muted. Stop pauses every video and sound in the bot's tabs; closing a tab
  ends its sound.

## The vault: the person's logins

The lead's rule: a bot uses the person's logins but never sees a password.

1. **Kept once per computer.** `<userData>/Crew/vault.dat`, even with
   `OPENDECK_CREW_ROOT`: the whole file encrypted with `safeStorage` (async
   API; Linux without a keyring refuses), and each password and 2-factor
   setup key sealed again inside it, so what the main process keeps in
   memory holds no secret in plain text. A file another user or computer
   saved is left as it is, and the Vault page says so. The page gets masked
   values only; Reveal (an explicit click) and Copy (done in the main
   process, cleared after 30 s) are the only ways a secret leaves.
2. **Granted per bot.** bot.md `logins`: names with `allow` (Crew fills it
   without asking) or `ask` (the approval card each time: Approve once /
   Always for this bot / Deny). A login not granted is invisible: `sign_in`
   with its name is refused with the same words as a name that doesn't
   exist.
3. **Filled by Crew.** `logins` lists the granted logins whose origins match
   the active tab (label, username, has 2-factor), never a secret. `sign_in`
   and `fill_code` check the page's origin against the login's exactly
   (scheme, host and port; look-alike hosts, other ports and http on an
   https login get nothing), ask when the grant says so, check the origin
   again, and then fill in one step inside the page that refuses if the page
   is on another origin by then. One approval covers that sign-in's code step
   for 5 minutes in the same run; a denial holds for the rest of the run.
4. **Kept from the model.** Results say what was filled, never what.
   Snapshots show password and code fields, and anything Crew filled, as
   `filled` or `empty`; a screenshot is refused while a filled secret shows
   as text (a "show password" switch); everything the bot's browser returns
   has the secrets it was filled with blanked out. Run events (`login`) and
   approval cards carry the login's label, the origin and the outcome.
5. **Saved from take control.** While the person has control, a capture
   script runs in its own world on every page; when they send a form with
   a password, the origin, username and password go to the main process (a
   CDP binding the page's own scripts can't reach) and the page shows
   "Save this login to the vault for <bot>?" (`Overview.offers`). Save adds
   it, or updates the login with the same origin and username, and grants it
   to that bot on `ask`. Unanswered offers are forgotten after 10 minutes.

## Sign-in for web connectors (OAuth)

Following the MCP authorization spec (`packages/crew-mcp`, `oauth.ts`, on
the SDK's `auth()`): when a web connector answers 401 and publishes OAuth
metadata, adding it saves it as "Sign in needed". Sign in discovers the
protected resource and authorization server metadata, registers Crew as a
client when the server offers dynamic registration (otherwise the person
pastes a client ID), and runs the authorization code flow with PKCE (S256)
in the person's default browser; a one-time loopback server on
`127.0.0.1` with a random port catches the code. Tokens and the registered
client are kept in `<name>.auth`, encrypted with `safeStorage`; the `.json`
holds only `oauth: { clientId, signedIn, account }`. A connection refreshes
an expired token on its own; when it can't, the connector is signed out
and says so. Sign out deletes the file and asks the server to revoke the
tokens. Tokens never reach the page, a log or a bot folder.
