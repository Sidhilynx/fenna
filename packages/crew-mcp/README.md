# @opendeck/crew-mcp (draft)

**Draft.** Written in the build stage; a Claude model redesigns it in Verify
and Finish (docs/process.md).

Fenna Crew's MCP servers. The Crew app starts them for every run of a
bot; they do the work by asking the app over a local named pipe (Windows)
or unix socket, never a network port, with a secret token for that run.

```
fenna-crew-mcp --server=crew|browser|gateway      (stdio)
  OPENDECK_CREW_PIPE     where the app listens
  OPENDECK_CREW_TOKEN    this run's secret
  OPENDECK_CREW_LIBRARY  the bot's library folder (crew only)
```

It also holds `client.ts` (`@opendeck/crew-mcp/client`), the MCP client the
app's main process starts installed connectors with: stdio, streamable
HTTP, and the older SSE transport, with errors rewritten to say how to fix
them ("Couldn't start "npx": it isn't installed…", "… says this needs
signing in (401). Choose Sign in on the connector…"), and `oauth.ts`,
sign-in for web connectors (MCP authorization spec: protected resource and
authorization server metadata, dynamic client registration or a pasted
client id, authorization code with PKCE in the person's browser, a loopback
redirect on 127.0.0.1, refresh on 401, revocation on sign out). The app
gives it an encrypted store; nothing here logs a token.
`test/fixtures/oauth-server.mjs` is a local OAuth-protected MCP server for
tests and manual proofs (`node test/fixtures/oauth-server.mjs --port=8765 --ttl=30`).

## crew

| Tool | What it does |
| --- | --- |
| `ask_human` | A question with 2–8 options (or free text); waits for the person (15 min) |
| `request_approval` | Approve one action before doing it; denied or no answer means don't |
| `message_bot` | Give another bot a task and wait for its reply; `files` copies paths from your disk to it (at most 20 files, 500 MB); at most 6 hand-offs per message, no cycles |
| `create_bot` | A new bot (name, job, how, schedule, cli, connectors, ask_before), approved by the person first |
| `remember` | Append a dated line to memory.md |
| `set_status` | The status line and mood (idle, work, sleep, need) |
| `new_document` | A new Fenna doc, sheet or deck in the library; a doc can take its content as html at once |

## browser

`open` (`new_tab: true` for a new tab), `snapshot`, `click`, `type`,
`press`, `scroll`, `back`, `screenshot`, and the tabs: `tabs` (number,
title and address, `*` on the active one), `switch_tab` (returns the page
like snapshot), `close_tab` (the active one by default). Every tool acts on
the active tab; at most 8 tabs, and `open` with `new_tab` past that says to
close one. A click that opens a new window says it opened a new tab, now
active. The snapshot header says which tab is active when more are open. The page comes back as text with refs (`e12`); refs last as
long as the document. `type` refuses password, sign-in code and payment
fields and says to use `sign_in` / `fill_code` or ask the person. While the
person has control, every tool waits 15 seconds and then fails with "The
person has control of the browser. Wait, then call snapshot again."

Signing in with the person's logins (the vault; the bot never sees a
password):

| Tool | What it does |
| --- | --- |
| `logins` | The bot's granted logins for the active tab's origin: name, label, username, whether it has 2-factor codes, whether the person approves each sign-in. Nothing secret. With none for this page, it lists the origins its logins are for. |
| `sign_in` | `{login, submit?, username_ref?, password_ref?}`: Crew fills the login's username and password into the page itself (finding the fields unless refs are given) and with `submit` presses the form's button. Refused unless the page's origin is exactly one of the login's; an `ask` login waits for the approval card first. Takes no password argument. |
| `fill_code` | `{login, ref?, submit?}`: Crew fills the current TOTP code of a login with a 2-factor setup key, same origin rule. |

Results say what Crew filled and where the page went ("Crew filled the
username and password of "Test site" on http://127.0.0.1:8765 and pressed
"Sign in". The page changed to …"), never a secret. Snapshots show password
fields, code fields and anything Crew filled as `filled` or `empty`, never
their text; a screenshot is refused while a filled secret shows as text.

## gateway (draft)

Given to a run only when the bot is granted at least one connector
installed on this computer. It lists the bot's granted tools that are on
`allow` or `ask`, named `<connector>__<tool>` (at most 50 characters; longer
ones end in a short hash), with the connector's own description, input
schema and annotations. A tool on `ask` has one more line in its
description saying the person approves each call. Tools on `off` are not
listed at all.

Every call goes to the app, which checks the tool's level in bot.md at that
moment, waits on the person's approval card for `ask` (Approve once /
Always for this bot / Deny), runs the call on the connector the app keeps
running, and logs it in the run (`connector` event). A denied call comes
back as a tool error: "Denied by the person: add_note did not run. Don't do
it, and don't try another way…".

The Fenna apps (documents in the library) are a fourth server, `fenna`:
`packages/workspace-mcp` rooted in the bot's library.

## What each CLI supports

| | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- |
| Servers | `--mcp-config` + `--strict-mcp-config` | `-c mcp_servers.*` | its own home's `mcp_config.json`, one home per bot |
| crew, browser, fenna, gateway | allowed (`--allowedTools`) | approved | allowed (`mcp(<name>/*)`) |
| Connector tools | only through `gateway`; `ask` waits on the app's card | the same | the same |
| Long waits | `MCP_TOOL_TIMEOUT` | `tool_timeout_sec` | its own default |
| Everything else | no built-in tools | read-only sandbox, no shell, no web | shell, files and web denied |

The bot's ask-me-before list is enforced through `request_approval` in its
instructions, on every CLI. Connector levels are enforced by the app, not
by the CLI or the model.
