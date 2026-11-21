# Crew: a Google account of its own for each bot

Written 2026-11-22 by Claude Opus (product and integration). Issue #87. Read
AGENTS.md, docs/process.md and docs/apps/crew.md first.

## Revision, 2026-11-22: the account lives in real Chrome

Tested with a real account the same day:

| Where | Google sign-in | Meet |
|---|---|---|
| Crew's built-in browser (Electron) | refused: "This browser or app may not be secure" | refused, even as a guest |
| Real Chrome, a profile of the bot's own, no automation | works | works |
| Real Chrome driven over `--remote-debugging-pipe` (Chrome says `navigator.webdriver: true`) | refused | |
| The same profile, signed in by hand first, then driven over the pipe | still signed in | "Ready to join?" as the account |

So Google's rule is: a password is typed only in a browser nothing is
driving. Crew keeps that rule and hides nothing:

1. **The person signs the bot in, by hand, once.** "Sign in" opens the
   bot's own Chrome profile (`<userData>/Crew/chrome/<slug>`, never the
   person's) as a plain Chrome window on Google's sign-in page, with no
   debugging at all. The person types the bot's Gmail and password (the
   vault's Copy helps) and closes the window. **Crew never types a Google
   password**, so the sign-in driver of section C is gone.
2. **Crew drives that profile openly** for checks and calls: Chrome started
   with `--remote-debugging-pipe` (a pipe only Crew holds, no network port),
   so the page says it is automated. Crew never patches `navigator.webdriver`
   or any other signal.
3. **Calls run there.** A bot with an account joins Meet in its Chrome
   profile, with the same page scripts (fake camera, microphone and screen,
   captions and chat listener). The window opens minimized; the person can
   show it.
4. Google Chrome must be installed. Without it the account section says so.

New pieces (these replace the Crew sign-in of section C and the browser
primitives of section E):

| Piece | Files | Who |
|---|---|---|
| F. CDP over a pipe | `apps/crew/src/main/cdp-pipe.cjs`, `apps/crew/test/cdp-pipe.test.ts` | Haiku |
| G. Finding Chrome | `apps/crew/src/main/chrome-find.cjs`, `apps/crew/test/chrome-find.test.ts` | Haiku |
| H. The bot's Chrome (launch, plain window, session, tabs) | `apps/crew/src/main/chrome.cjs` | Opus |
| I. Accounts: person-led sign-in, checks through H | `accounts.cjs`, its tests | Opus |
| J. UI: Chrome states and buttons | `Account.tsx` | Haiku |
| K. Calls in the bot's Chrome | `meetings.cjs`, `crew.cjs` | Opus |

### F. CDP over a pipe (`cdp-pipe.cjs`)

`createPipeConnection(out, inn)`: `out` is the writable stream Chrome reads
(child stdio 3), `inn` the readable it writes (stdio 4). Chrome's framing:
each message is one JSON object followed by a NUL byte (`\0`), both ways.

- `send(method, params = {}, sessionId = undefined)` → `Promise<result>`:
  writes `{ id, method, params, sessionId? }` + `\0` with a fresh integer
  id; resolves with the response's `result`; rejects with an `Error` whose
  message is `<method>: <error.message>` when the response has `error`.
- `on(fn)` → `off()`: `fn({ method, params, sessionId })` for every message
  without an `id` (events). Several listeners; a throwing one doesn't stop
  the others.
- `closed` → a promise that resolves once, when `inn` ends or errors or
  `close()` is called; every pending `send` then rejects with
  `Error("Chrome closed.")`, and later `send`s reject at once the same way.
- `close()`: stops reading and ends `out`; safe to call twice.
- Reads are buffered across chunks: a message may arrive split over several
  chunks, or several messages in one chunk, and UTF-8 characters may be
  split between chunks (decode with a `StringDecoder`).
- A line that isn't JSON is skipped, never throws.

Tests with `node:stream` `PassThrough` pairs: request/response matching by
id (out of order), session ids passed through, errors, events to several
listeners, split and merged chunks, a multi-byte character split across
chunks, junk skipped, close rejecting pending and later sends.

### G. Finding Chrome (`chrome-find.cjs`)

`findChrome({ platform = process.platform, env = process.env, exists = fs.existsSync })` → the path of Google Chrome's executable, or `null`. Candidates, in order:

- `win32`: `%ProgramFiles%\Google\Chrome\Application\chrome.exe`,
  `%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe`,
  `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe` (skip a variable
  that isn't set; use `path.win32.join`).
- `darwin`: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  then the same under `$HOME` (`~/Applications/...`).
- `linux`: `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`,
  `/opt/google/chrome/chrome`.
- `env.OPENDECK_CHROME`, when set and existing, wins over all of them (for
  tests and odd installs).

Only Google Chrome, not Chromium or Edge: Google's sign-in rules are about
Chrome. Tests with a fake `exists` for each platform, the override, unset
variables and nothing found.

The sections below are the first plan. Where they say Crew signs in from
the vault (rules 1 and 3, the sign-in steps of C, the `needs_you` state,
Google page functions other than `signInUrl` and `parseListAccounts`, and the
browser primitives of E), the revision above replaces them.

## What the person gets

A bot can have its own Google account. The person makes the account (Crew
never creates one), saves it in the vault like any login (the bot's Gmail
address, its password, and optionally its 2-factor setup key), and picks it
in the bot's Details under **Google account**. Crew signs the bot's browser
in to it, from the vault, without the model ever seeing the password or the
sign-in pages, and keeps the session healthy. The bot then joins Meet calls
as itself and can use Gmail, Calendar and Drive in its browser.

Why: Google Meet refuses a signed-out guest from Crew's browser before
anyone can admit it (tested 2026-11-22: the page says "You can't join this
video call" even with every Crew addition removed). A signed-in account
gets through.

## Rules

1. **Crew signs in, never the model.** The sign-in runs in Crew code over
   the DevTools protocol, like the Meet join. No secret is ever in a tool
   result, a run log, a notice, a broadcast or an error message.
2. **One account per bot, and only its own.** Crew never signs a bot in to
   another account, and never signs out an account it didn't sign in to on
   its own: if the browser is signed in as someone else, it says so and
   offers Sign out to the person.
3. **No lockouts.** At most one password submit and two code submits per
   sign-in. When Google refuses or asks for anything else (a phone prompt,
   a puzzle, "this browser may not be secure"), Crew stops, leaves the tab
   open and the state says the person is needed.
4. **States are true.** The state shown is what the last check saw, with
   when it was checked.

## States

`AccountView.state`, one of:

| state | meaning | shown as |
|---|---|---|
| `missing` | bot.md names a login that isn't in the vault on this computer | Not in the vault on this computer |
| `unknown` | not checked yet | Not checked yet |
| `signed_out` | no Google sign-in in the bot's browser | Signed out |
| `signing_in` | Crew is signing in now | Signing in |
| `signed_in` | signed in as this account | Signed in |
| `other_account` | signed in, but not as this account | Signed in as {signedInAs} instead |
| `needs_you` | the sign-in stopped where only the person can go on | {message} |

## Pieces

| Piece | Files (only these) | Who |
|---|---|---|
| A. Format: `account` in bot.md | `packages/crew/src/bot.ts`, `packages/crew/test/format.test.ts` (add tests), `packages/crew/README.md` (one line) | Haiku |
| B. Google page scripts | `apps/crew/src/main/google-scripts.cjs`, `apps/crew/test/google-scripts.test.ts` | Haiku |
| C. Accounts manager | `apps/crew/src/main/accounts.cjs`, `apps/crew/test/accounts.test.ts` | Haiku |
| D. UI: Account section, vault preset | `apps/crew/src/renderer/Account.tsx`, `apps/crew/src/renderer/Panel.tsx` (one Section), `apps/crew/src/renderer/Vault.tsx` (preset), `apps/crew/src/renderer/styles.css` (append only, if needed) | Haiku |
| E. Contract, browser primitives, wiring, prompt, `account` tool, Meet | `contract.ts`, `browser.cjs`, `crew.cjs`, `ipc.cjs`, `handlers.cjs`, `prompt.cjs`, `meetings.cjs`, `packages/crew-mcp` | Opus |

Builders change only their files. If a piece seems to need another file,
stop and say so in the summary.

## A. Format

bot.md front matter gets one optional field:

```yaml
account: scout-google      # the name of a vault login: the bot's own Google account
```

- `Bot.account: string | null`. Absent, `null` or `""` → `null`.
- Valid: a string that passes `isSlug` (the vault's login names are slugs)
  and is at most 40 characters. Anything else: an error diagnostic on its
  line, `account should be the name of a login in the vault, like
  "scout-google".`, and `account` is `null`.
- `serializeBot` writes `account: <name>` only when set (a bot.md without
  one stays byte-for-byte as it was), right after `logins` when present.
- `BotInput.account?: string | null`, defaulting to `null`.
- Tests: parse, absent, empty, invalid (number, list, "Not A Slug",
  41 characters), round trip, and that a bot.md without it serializes
  unchanged.

## B. Google page scripts (`google-scripts.cjs`)

CommonJS, no dependencies, same style as `meet-scripts.cjs`: every page
function is self-contained (sent as source text, defines its own helpers),
takes one JSON argument and returns JSON. Google hides class names: find
things by type, name, autocomplete, aria-label, role and visible text.
"Visible" means `getClientRects().length > 0`.

Exports:

- `SIGN_IN_ORIGIN = "https://accounts.google.com"`.
- `signInUrl(email)` → `https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmyaccount.google.com%2F&Email=<email, encoded>` (plain function, not a page function).
- `googleStage()` → `{ stage, error }`, the first that holds:
  1. `"signed_in"`: `location.hostname === "myaccount.google.com"`.
  2. `"blocked"`: page text contains `This browser or app may not be secure`, `Couldn't sign you in` or `Couldn’t sign you in` (curly apostrophe too).
  3. `"code"`: a visible input with `name="totpPin"`, or `autocomplete="one-time-code"`, or `id="totpPin"`.
  4. `"password"`: a visible `input[type="password"]`.
  5. `"email"`: a visible `input[type="email"]` or `input[name="identifier"]`.
  6. `"chooser"`: a visible element with `data-identifier` or `data-email`.
  7. `"challenge"`: `location.hostname === "accounts.google.com"` (anything else there: a phone prompt, a puzzle, "Verify it's you").
  8. `"unknown"`.
  `error`: the whitespace-collapsed text (at most 300 characters) of the first visible `[aria-live="assertive"]` or `[role="alert"]` with text, else `null`.
- `googleFocus({ field })`, field `"email" | "password" | "code"` → `{ found, focused, value }`: finds that stage's input (same rules as above), focuses it and selects its text (`select()`), so Crew can type over it with `Input.insertText`. `value` is `""` for `"password"` always (never return a password).
- `googleNext()` → `{ clicked }`: clicks the visible, enabled button (`button` or `[role="button"]`) whose text or aria-label is `Next` (case-insensitive, trimmed), else one of `#identifierNext button`, `#passwordNext button`, `#totpNext button`, `#identifierNext`, `#passwordNext`, `#totpNext`. Returns whether it clicked.
- `googlePick({ email })` → `{ picked }`: on the account chooser, clicks the visible element whose `data-identifier` or `data-email` equals `email` (case-insensitive) → `"account"`; else the visible button or link whose text is `Use another account` → `"other"`; else `null`.
- `parseListAccounts(text)` (plain function): parses the body of `https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard`. Strip a leading `)]}'` line if present, `JSON.parse`, expect `["gaia.l.a.r", [entry, ...]]`; for each entry (an array) the email is the first string in it that matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` and the name is `entry[2]` when it is a non-empty string. Returns `[{ email (lowercased), name }]`, skipping entries without an email; `[]` for anything that doesn't parse. Never throws.

Tests (`node:vm`, like `meet-scripts.test.ts`): each page function compiles
alone from `fn.toString()` and names nothing outside itself; a fake page
(document with `querySelectorAll`, `body.innerText`, `location`) for each
stage, for focus (password value is ""), for Next (by text, by id, skips
disabled), for pick; `parseListAccounts` with a real-shaped sample, the
`)]}'` prefix, junk, `null`, and an entry with no email.

## C. Accounts manager (`accounts.cjs`)

```js
createAccounts({ store, vault, browsers, notify, broadcast, onChange, now, setTimer, clearTimer, sleep })
```

- `store.readBot(slug)` → `{ bot }` with `bot.account` (string or null) and `bot.name`; `store.slugs()` → slugs.
- `vault.get(name)` → item `{ name, label, username, origins }` or null; `vault.secrets(name)` → `Promise<{ password, totp }>` (`totp` null when none); `vault.code(name)` → `Promise<{ code, secondsLeft }>`.
- `browsers.googleSession(slug)` → `Promise<{ signedIn: boolean, accounts: { email, name }[] }>`.
- `browsers.openTask(slug, { url })` → `Promise<tab>`, a new tab in the bot's browser, made active; `tab.evaluate(fn, arg)` runs a `google-scripts` page function in an isolated world and returns its JSON; `tab.cdp(method, params)`; `tab.alive()`; `tab.close()`; `tab.waitForControl()` resolves when the person isn't in control.
- `browsers.signOutGoogle(slug)` → `Promise<void>`.
- `notify(slug, title, body)`: a notice for the person (Crew wires it).
- `broadcast("crew:account", { slug, account: AccountView | null })` on every change of a bot's view; `onChange()` too.
- `now`, `setTimer`, `clearTimer`, `sleep` are injected (default `new Date()`, `setTimeout`, `clearTimeout`, a promise of `setTimeout`) so tests use fake time.

`AccountView`: `{ slug, login, email, state, signedInAs, message, checkedAt }`
(`email` is the vault login's username lowercased, `""` when missing;
`signedInAs` the first email the browser is signed in as when
`other_account`, else null; `message` a short sentence for `needs_you`,
else `""`; `checkedAt` ISO or null).

Methods:

- `view(slug)` → `AccountView | null` from memory (null when the bot has no account). Sync. A bot with an account and no check yet is `unknown` (or `missing`).
- `list()` → views of every bot with an account.
- `check(slug)` → `Promise<AccountView | null>`: no account → null; login not in vault → `missing`; else `googleSession`: not signed in → `signed_out`; signed in and one of `accounts` has this email (case-insensitive) → `signed_in`; signed in otherwise → `other_account` with `signedInAs` = the first account's email, or `null` when the list is empty (the session can't be read). A check while `signing_in` doesn't change the state. A failing `googleSession` keeps the old state and sets `checkedAt`.
- `signIn(slug)` → `Promise<{ state, text }>`, one at a time per bot (a second call while one runs returns the same promise). `text` is a sentence for the bot or the person. Steps:
  1. `check`. `signed_in` → done, text "Signed in as <email>.". `other_account` → refuse, text "The browser is signed in as <x>, not <email>. Ask the person to sign it out in your Details, then try again." No account / missing → text says so.
  2. Secrets from the vault; no password → `needs_you`, "The vault has no password for <label>. Add it, or take control and sign in."
  3. State `signing_in`, broadcast. `tab = await browsers.openTask(slug, { url: signInUrl(email) })`.
  4. Up to 90 s, every 1 s: `await tab.waitForControl()`, then `googleStage`:
     - `email`: `googleFocus({field:"email"})`; if its `value` isn't the email, `tab.cdp("Input.insertText", { text: email })`; `googleNext()`.
     - `chooser`: `googlePick({ email })`.
     - `password`: if already submitted once → stop with `needs_you`, "Google didn't take the password saved for <label>. Fix it in the vault, or take control and sign in." (include Google's `error` text when there is one). Else focus, `Input.insertText` the password, `googleNext()`.
     - `code`: no TOTP → `needs_you`, "Google asks for a sign-in code and <label> has no 2-factor setup key. Take control and enter it, or add the key in the vault."; two codes already submitted → `needs_you`. Else `vault.code`; if `secondsLeft < 3` sleep until the next code; focus, insert, Next.
     - `signed_in` → leave the loop.
     - `blocked` → `needs_you`, "Google won't sign in from this browser right now. Take control and sign in yourself."
     - `challenge` or `unknown` for 15 s in a row → `needs_you`, "Google wants something only you can give (a phone prompt or a puzzle). Take control of <bot>'s browser and finish signing in."
     - After each action, wait 1.5 s before looking again.
  5. Signed in: close the tab, `check`, text "Signed in as <email>." (if the check doesn't say `signed_in`, state as checked and text "Google's sign-in finished but the browser isn't signed in. Try again.").
  6. `needs_you`: leave the tab open (the person finishes there), set the state and message, `notify(slug, "Google sign-in needs you", message)`.
  7. Out of time: `needs_you` with the challenge message.
  Any thrown error: state from a fresh `check`, text "Couldn't sign in: <message>." (the message never holds a secret: build it yourself, don't pass through page text that could echo one).
- `signOut(slug)` → `browsers.signOutGoogle(slug)`, then `check`.
- `controlReturned(slug)` → `check(slug)` when the bot has an account (the person may have just signed in).
- `ensure(slug)` → `Promise<AccountView | null>`: no account → null; `check`; `signed_out` → `signIn`; returns the view.
- `promptLine(slug)` → `""` without an account, else one line: `Your own Google account is <email> (<state words>). Your browser stays signed in to it, so Gmail, Calendar, Drive and Meet open as you. Never sign in to any other Google account, and never type its password: if Google asks you to sign in, call account with {action: "sign_in"}.`
- `start()` → after 20 s, check every bot with an account (one at a time); then again every 30 min. `stop()` clears the timers.

Tests with fakes (fake browsers, vault, store; `tab.evaluate` dispatches on
`fn.name`; injected `sleep`/timers resolve instantly or with vitest fake
timers): each `check` outcome; the happy path (email → password → code →
signed in) types the email, password and code with `Input.insertText` and
closes the tab; the chooser; wrong password stops after one submit; no TOTP;
blocked; a challenge that lasts 15 s; the 90 s limit; one sign-in at a time;
`other_account` refuses; `signOut`; `ensure` signs in only when signed out;
no secret appears in any view, broadcast, notice or returned text (search
all of them for the password and the code).

## D. UI

- `Account.tsx` exports `AccountSection({ bot, account, save })`: `bot` the
  `BotSummary`, `account` the bot.md value (`string | null`), `save(next:
  string | null)`. It loads `invoke("crew:accounts")` and listens to
  `on("crew:account", …)` for this bot's view; actions call
  `invoke("crew:account", slug, "check" | "sign_in" | "sign_out")`.
- No account: hint "A Google account of its own lets {bot.name} join Meet
  calls and use Gmail, Calendar and Drive as itself." and a `MenuButton`
  "Choose an account" listing vault logins whose origins include
  `https://accounts.google.com` (label, username aside), a separator, and
  "Add one in the vault" (goes to the vault page). With no such logins,
  only the hint and a button "Add one in the vault".
- With an account: one row like the login grants (`grant login-grant`
  classes): the email as the name, the state line (table above) as the
  sub line, `checkedAt` as a title tooltip, then the buttons for the state:
  `signed_out` Sign in; `signed_in` Check, Sign out; `other_account` Sign
  out; `needs_you` Open computer (opens the bot's computer view the way the
  rest of the app does), Check; `signing_in` none (state line only);
  `unknown` Check; `missing` none. And a close icon button "Stop using
  {email} for {bot.name}" that calls `save(null)`. Buttons are `btn small`.
- `Panel.tsx`: in `Advanced`, a `<Section title="Google account">` right
  before "Logins", rendering `AccountSection` with `cfg.account ?? null`
  and `save={(next) => void save({ account: next })}`.
- `Vault.tsx`: next to the vault's add button, "Add a Google account" opens
  the same add form with label "Google account", origins
  `["https://accounts.google.com"]`, and the username field's placeholder
  "name@gmail.com". Nothing else changes.
- Design tokens only, both themes, keyboard paths, no new font sizes;
  `node scripts/check-ui.mjs apps/crew` adds no errors.

## E. Wiring (Opus)

- contract: `AccountView`, `AccountState`; invoke `crew:accounts` → `AccountView[]`, `crew:account` `[slug, action: "check"|"sign_in"|"sign_out"]` → `AccountView | null`; event `crew:account` `{ slug, account }`; `Bot.account`.
- browser: `googleSession`, `openTask`, `signOutGoogle`; tells accounts when the person gives control back.
- crew: create accounts with notify → notices (kind `account`); start at launch; ipc channels; the bot's config save accepts `account`.
- prompt: `accounts.promptLine(slug)` among the rules when set.
- crew-mcp: tool `account` `{action: "status" | "sign_in"}`.
- meetings: `join` calls `accounts.ensure` first when the bot has an account; when it has none and Meet refuses the browser on load, the result says to give it a Google account.
