# Crew: apps and projects on a bot's computer

A bot's computer is our own small OS. This spec sets its rules for software
the bot (or the person) makes inside it: **apps** (tier 1), **projects**
(tier 2) and, later, **containers and mounted folders** (tier 3). It is the
contract the builders work to; `docs/apps/crew.md` "Decisions" records the
product choices.

## The rule above all

Software made inside a bot's computer reaches only what its manifest names
and the person allowed. The person's real computer is reachable only through
things the person does: a folder they mount (tier 3), a file they drag out,
or an approval card.

## Tier 1: apps

### What an app is

A folder `Files/Apps/<name>/` on the bot's disk (`workspace/Apps/<name>/`)
with an `app.json` and web files. `<name>` is a slug: `[a-z][a-z0-9-]{0,31}`.

```json
{
  "name": "invoice-tracker",
  "title": "Invoice tracker",
  "icon": "sheet",
  "entry": "index.html",
  "description": "Lists unpaid invoices from the Invoices sheet.",
  "permissions": {
    "documents": "read",
    "network": ["https://api.frankfurter.app"],
    "bot": true
  },
  "tools": [
    {
      "name": "overdue",
      "description": "Invoices more than 30 days unpaid, as rows.",
      "input": { "type": "object", "properties": { "days": { "type": "number" } } }
    }
  ]
}
```

- `icon`: one of the pixel icon names Crew already has (PixelIcon / FileIcon
  names); unknown names fall back to a generic app icon.
- `permissions.documents`: `none` (default), `read`, or `write`: the bot's
  Documents (Fenna docs and sheets).
- `permissions.network`: exact origins (`https://host[:port]`), at most 10.
  Empty by default: no network at all.
- `permissions.bot`: the app may send the bot a message (`crew.bot.tell`),
  which wakes the bot with a run whose trigger is `app`. Default false.
- The app's own folder is always readable and writable by the app.
- `tools`: at most 20; names `[a-z][a-z0-9_]{0,39}`; `input` is a JSON
  Schema object (type object, properties of string, number, boolean, array,
  object). Validated by `packages/crew` with fix-it errors.

The manifest format, its validation and its errors live in `packages/crew`
(`app.ts`), with tests, like every other bot file.

### Grants

The person approves an app's permissions the first time it opens (an install
card listing exactly what the manifest asks for: Allow, Not now). The grant
is stored in the bot's folder (`apps.json`: per app, the permissions granted
and the manifest hash they were granted for). When a manifest changes its
permissions, the app runs with the old grant until the person approves the
new one; an app with no grant runs with no documents, no network and no bot.
The person changes or revokes grants in the bot's Details, under Apps.

### How an app runs

- Served from a custom scheme `crewapp://<slug>/<name>/<path>` that reads
  only that app's folder (disk.cjs path checks; no `..`, links or absolute
  paths).
- Each app runs in its own in-memory session (`crewapp-<slug>-<name>`), with
  no Node, no permissions (camera, notifications, ...), and a web request
  filter that refuses every origin not in the granted `network` list. CSP:
  `default-src 'self' crewapp:; script-src 'self' 'unsafe-inline'; connect-src`
  limited to the granted origins.
- A preload gives the page one global, `crew`:
  - `crew.files.read(path)`, `crew.files.write(path, text|bytes)`,
    `crew.files.list(dir)`: paths inside the app's own folder.
  - `crew.docs.list()`, `crew.docs.read(path)` (a sheet as rows of values, a
    doc as plain text) when documents is read or write; `crew.docs.writeCells(path, sheet, cells)` when write.
  - `crew.bot.tell(text)` when bot is granted (rate limited: 6 an hour).
  - `crew.tools.define(name, async (input) => result)`.
  - `crew.app`: `{ name, title, bot }`.
  Every call is checked in the main process against the grant.
- The person's window shows the app in a `<webview>` (partition above).
  The bot's own use of an app (testing it, calling its tools) runs in a
  hidden window in the main process with the same partition and preload, so
  it works when nobody watches.

### What the bot can do

- Write the app's files with the crew tools `write_file` and `edit_file`
  (exact string replace, like a code editor's find and replace).
- The crew tool `app`: `list`; `open` (validates the manifest, starts the
  app hidden, returns manifest problems, page errors and console errors, and
  a snapshot of the page as text with element refs; shows the window on the
  bot's computer); `snapshot`, `click`, `type`, `press` on refs (same page
  scripts as the bot's browser); `close`. A bot tests its own app this way.
- An app's tools appear to the bot as gateway tools `app__<name>__<tool>`
  while the app is granted. A call runs the defined function in the app's
  hidden window and returns its JSON result (10 s limit, 64 KB result).
  This is how a bot gives itself new abilities: tools it wrote, run sealed.

### What the person sees

- Each app is an icon on the bot's desktop (DesktopItem kind `userapp`);
  opening it shows the install card first time, then the app in a window.
- A **Code** window: the app or project folder as a tree, the selected file
  with line numbers, and changes the bot made in the last few minutes marked;
  it follows the bot's edits live.
- Activity lists app events: made, changed, opened by the bot, tool calls,
  messages to the bot.

## Tier 2: projects

### What a project is

A folder `Files/Projects/<name>/`. A bot works in it with `write_file`,
`edit_file`, `read_file`, `search_files` and the crew tool `command`.

### Running commands

- Off by default. The person turns on "Projects" for a bot in its Details
  (bot.md `projects: on`).
- `command` {project, command, background?} runs one command line in the
  project folder. Allowed programs: `node`, `npm`, `npx`. Anything else is
  refused with the list of what is allowed.
- Runs use the **person's installed Node** (Electron's built-in Node can't
  enforce permissions). No Node installed: the tool says so and how to get it.
- Every process starts under Node's permission model with **long paths**
  (`fs.realpathSync.native`; 8.3 short names don't match):
  `--permission --allow-fs-read=<project> --allow-fs-read=<node and npm install folders>
  --allow-fs-write=<project>`. Proven on Node 24: reading outside and
  starting child processes are refused; **network is not** limited by Node.
  npm runs with `--ignore-scripts` and its cache inside the project
  (`.npm-cache`).
- The first command in a project shows an approval card ("Research wants to
  run commands in Projects/site. They can read and write only that folder
  but can reach the internet."): Approve once, Always for this project, Deny.
- Output: stdout and stderr captured, the last 64 KB kept per process,
  written to the run log as a `command` event with exit code and time.
  Foreground commands stop after 5 minutes; background ones run until
  stopped, the bot's run ends with `keep: false`, or the app quits. At most 3
  processes per bot.
- A background process that listens on `localhost:<port>` (seen in its
  output) is opened as a tab in the bot's own browser, where the person
  watches and the bot tests it with its browser tools.

### What the person sees

- A **Processes** window: each process with command, project, running time,
  port, last lines of output, Stop.
- The **Console** window: the live output of the bot's commands, one stream
  per process.
- The Code window works for projects too.

## Tier 3 (later, not in this build)

Containers (Docker) per project for any language, folders from the person's
computer mounted into a project, git push and deploy behind approvals, and
"Install on my computer" for an app.
