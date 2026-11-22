# @opendeck/crew

The Fenna Crew bot folder format. TypeScript that runs without a build
step; the Crew app's main process, its MCP servers and its page all read it.

```
<Crew>/bots/<slug>/bot.md         front matter (settings) + body (how it works)
<Crew>/bots/<slug>/memory.md      what the bot remembers
<Crew>/bots/<slug>/state.json     sessions, mood, status, last runs (the app writes it)
<Crew>/bots/<slug>/library/       Fenna documents it makes
<Crew>/bots/<slug>/runs/<iso>.jsonl   every event of one run (RunEvent)
<Crew>/teams/<slug>/team.md       name, lead, members + purpose
<Crew>/teams/<slug>/thread.jsonl  the team's conversation
```

| Module | |
| --- | --- |
| `schema.ts` | The lists: CLI kinds, moods, wallpapers, Fenna apps, keys, limits |
| `yaml.ts` | The small YAML subset front matter uses (maps, lists, strings), with line-numbered problems |
| `bot.ts` | `parseBot`, `serializeBot`, `checkBot`, `newBot` |
| `connector.ts` | Connectors installed on the computer (`checkConnector`, `parseConnectorFile`, `serializeConnectorFile`) and grants (`newGrant`, `levelOf`, `defaultLevel`, `gatewayToolName`) |
| `vault.ts` | Logins in the computer's vault (`checkVaultItem`, `parseVault`, `serializeVault`), origins (`checkOrigin`, `originOf`, `originMatches`: exact scheme, host and port), sign-in codes (`parseTotp` for setup keys and otpauth:// addresses, `totpCode`, `hotp`; RFC 6238 and 4226 with Web Crypto), `scrubSecrets`, `MASK` |
| `team.ts` | `parseTeam`, `serializeTeam`, `checkTeam` |
| `state.ts` | `parseState` (forgiving), `serializeState` |
| `schedule.ts` | `parseSchedule`, `formatSchedule`, `describeSchedule`, `nextRun` |
| `slug.ts` | `slugify`, `uniqueSlug`, `isSlug` |
| `runlog.ts` | `RunEvent`, run file names, `parseRunLog`, `parseThread` |

A bot's `connectors` are Fenna apps (`fenna-docs`, `fenna-sheets`,
`fenna-slides`) and grants of connectors installed on the computer
(`<userData>/Crew/connectors/<name>.json`, written by the app):

```yaml
connectors:
  - fenna-docs
  - name: calendar          # installed on this computer
    allow: [list_events]    # runs without asking
    ask: [create_event]     # waits for the person's approval each call
    off: [delete_event]     # hidden from the bot
    default: ask            # tools the connector adds later
```

A bot's `logins` grant logins from the computer's vault (the app keeps
them encrypted in `<userData>/Crew/vault.dat`; bot.md holds only names and
levels). A login not granted is invisible to the bot:

```yaml
logins:
  - name: example-mail      # a login's name, as the Vault page shows it
    level: ask              # allow: Crew fills it without asking; ask: the person approves each time
```

A bare `- example-mail` means `ask`. `logins` is written only when the bot
has some, so older bot.md files stay as they are.

`account: scout-google` names a vault login that is the bot's own Google
account (a slug, at most 40 characters). It is written only when set.

A connector written whole the older way (`name` with `command`, `args`,
`env`, or `url`) still parses: `parseBot` returns it in `legacy`, with a
grant of the same name in `bot.connectors`, for the app to install. It is
never written back.

Schedules: `manual`, `daily 08:00`, `weekdays 09:00, 13:00`, `mondays
10:00` (any day, plural), `every 2h 08:00-18:00`. Local wall clock, 24-hour.

Every problem says how to fix it ("Unknown setting "shedule". Did you mean
"schedule"? Settings: …"). Unknown keys are warnings and are ignored; bad
values are errors, and a bot with an error doesn't run.
