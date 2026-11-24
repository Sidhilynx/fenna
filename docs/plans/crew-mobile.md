# Crew on your phone

Written 2026-11-24 by Claude Opus (product and integration). Read AGENTS.md,
docs/process.md and docs/apps/crew.md first. The lead approved the new
dependencies, the core changes and the relay service on 2026-11-24.

## What it is

An Android app, **Fenna Crew** for the phone, that is a second window onto the
Crew running on the person's computer. From the phone the person talks to
their bots and group chats, answers questions and approvals, makes and edits
bots, watches a bot's browser and takes control of it. It works while the
computer is on and Crew is running; when it is not, the phone says so.

There is no account. The phone pairs with the computer once, by scanning a QR
code that Crew shows. Everything between them is encrypted on the computer
and on the phone; the relay in the middle passes sealed messages it cannot
read.

## What the person sees

1. **On the computer:** Settings → Phone → **Connect a phone**. A QR code and
   a short code under it, valid for 2 minutes. When the phone scans it the
   dialog says "Connected: <phone name>". Settings lists paired phones (name,
   last seen, online now) with **Remove**.
2. **On the phone, first time:** "Connect to your computer" → **Scan the code**
   (camera) or **Enter the code** (typed or pasted). Then the crew opens.
3. **On the phone, every day:** three tabs.
   - **Crew**: every bot (face, name, status line, a mark when it needs you)
     and the group chats. "+" makes a bot.
   - **Inbox**: everything waiting on the person (questions, approvals,
     offers to save a login), newest first, answered in place.
   - **Settings**: the computer (name, online, last seen), connectors,
     skills, logins, usage, defaults, disconnect.
4. **A bot**: its chat (history, live steps, question and approval cards,
   composer with @mentions in group chats), chat switcher, New chat, Run now,
   Stop, **Screen** (its browser), **Details** (everything the desktop's
   Details panel edits).
5. **Notifications:** a bot starts waiting on the person → the phone shows a
   notification with the bot's name and the question; tapping it opens that
   card.

## The bot's screen without video

The desktop shows a bot's browser as GPU frames at up to 60 a second. That
can't cross a phone network, and real video (WebRTC) needs TURN servers,
codecs and a lot of moving parts that fail on bad networks. The phone does
something simpler and steadier:

- **Pictures only when the page changes.** Crew captures the active tab when
  it paints and sends one JPEG. The next is sent only after the phone says it
  got the last one, and only the newest waits. A fast network gets up to 10
  pictures a second; a slow one gets fewer, never a growing delay. A still
  page sends nothing.
- **Pages lay out for the phone.** While the phone watches, the bot's tabs
  lay out at the phone's width (`crew:viewport`), so sites show their mobile
  layout, sharp at the phone's pixel ratio (capped at 2).
- **Take control by touch.** Tap = click, drag = scroll, long press = right
  click, the keyboard button opens the phone's keyboard and sends what is
  typed. The bot is paused exactly as on the desktop ("You are in control").
  A login the person types there is offered to the vault as on the desktop.
- **The bot's cursor** shows where it acts, from `crew:cursor`.

## Architecture

```
 phone (Capacitor, Android)            relay (Cloudflare)                computer (Crew)
 ───────────────────────────          ─────────────────────            ──────────────────────
 screens ── remote api (same     ⇄    one hub per computer:     ⇄      remote.cjs ── the same IPC
 Calls/Events/Sends types)            routes sealed messages,           handlers the desktop page
 crew-link: keys, seal, open          presence, FCM push                uses (an allowlist)
```

### Packages and folders

| Piece | Folder | Who |
|---|---|---|
| A. Link protocol: keys, pairing, sealing, framing | `packages/crew-link` | Opus |
| B. Relay hub (shared logic), Worker, Node server for dev and self-hosting | `services/relay` | Opus core, Haiku deploy script |
| C. Crew's side: identity, phones, connection, router, events, frames, push | `apps/crew/src/main/remote.cjs` (+ small hooks in `main.cjs`, `ipc.cjs`, `browser.cjs`) | Opus |
| D. Desktop UI: Settings → Phone (QR, list, remove) | `apps/crew/src/renderer/PhoneSection.tsx` | Haiku, Opus review |
| E. The phone app | `apps/crew-mobile` | Opus transport and shell, Haiku screens, Opus polish |
| F. Android toolchain | `D:\android` (not in the repo) | Haiku |

## A. The link protocol (`packages/crew-link`)

TypeScript with no dependencies; Web Crypto only (`globalThis.crypto.subtle`,
in Node 22+, Electron and Android WebView). P-256 everywhere (every WebView
has it; X25519 is too new).

- **Device identity.** Each device makes two key pairs once: ECDSA P-256
  (signs in to the relay) and ECDH P-256 (agrees keys). Its **device id** is
  the first 22 characters of base64url(SHA-256(ECDSA public key, SPKI)). The
  computer's device id is also its **hub id**.
- **Pairing code** (the QR, and the text under it):
  `fenna1.` + base64url(JSON `{ r: relayUrl, h: hubId, k: computer ECDH public
  key (raw, base64url), s: 16 random bytes (base64url), n: computer name }`).
  Valid 2 minutes, once.
- **Pairing.** The phone signs in to the hub, then sends `{ k: "pair", ecdh:
  phone ECDH public key, box }` where `box` is sealed with
  HKDF-SHA256(ECDH(phone, computer), salt = s, info = "fenna-pair-v1") and
  holds `{ name, sign: phone ECDSA public key, platform }`. Opening it proves
  the phone read the code; the computer checks that the phone's device id
  matches `sign`, saves the phone, forgets `s` and answers `paired`.
- **The pair key.** For every later message: AES-GCM-256 with key
  HKDF-SHA256(ECDH(phone, computer), salt = "fenna-crew-link-v1", info =
  hubId + phoneId). Nonce: 12 random bytes. Additional data: `from + ">" +
  to`, so a message can't be replayed in the other direction or to another
  phone. Wire form: `1.<nonce b64url>.<ciphertext b64url>`.
- **Push key.** HKDF of the same secret with info "fenna-push-v1" +
  hubId + phoneId, exported raw to the phone's native side (it decrypts the
  notification without the web page).
- **Freshness.** Every sealed message holds `ts` (ms). The computer drops
  calls older than 5 minutes and any call id it has already answered (it
  sends the first answer again).
- **Binary.** `ArrayBuffer` and `Uint8Array` values travel as `{ "$b":
  base64 }` and come back as the same type (`encodeValue` / `decodeValue`).

Tests: key round trips, wrong key, tampered byte, swapped direction, another
phone's message, expired pairing code, reused pairing code, binary values.

## B. The relay (`services/relay`)

One hub per computer: a Durable Object named by the hub id (Worker), or one
object in a Map (Node). The logic lives once in `hub.js`, which knows nothing
about the platform; `worker.js` and `server.mjs` adapt sockets to it.

Connection: `GET /v1/hub/<hubId>?id=<deviceId>&role=computer|phone`
(WebSocket). The hub sends `{ t: "challenge", n }`; the device answers `{ t:
"auth", pub, sig }` (ECDSA public key SPKI base64url; signature over
`fenna-relay-v1:<hubId>:<deviceId>:<n>`). The hub checks the id is the hash of
`pub`, the signature, and that a computer's id is the hub id. Then `{ t:
"ready", computer: online? }`.

| From | Message | The hub |
|---|---|---|
| computer | `{ t: "allow", phones: [ids], pairing: bool }` | Only these phones (and any phone while pairing is open, for 2 minutes at most) may connect; a phone removed from the list is disconnected |
| either | `{ t: "send", to, d }` | Delivers `{ t: "msg", from, d }`, or answers `{ t: "undelivered", to }` |
| computer | `{ t: "push", token, d }` | Sends an FCM data message `{ h: hubId, d }`; answers `{ t: "pushed", ok, error }` |
| hub | `{ t: "presence", id, online }` | To phones when the computer comes and goes; to the computer when a phone does |
| either | `"ping"` | `"pong"` (auto-response, so a hibernating hub isn't woken) |

Limits: 1 MB a message, 300 messages a minute a socket, 8 phones a hub, 30
pushes a minute a hub, a second computer connection replaces the first. The
relay stores nothing and logs no message contents. FCM needs a service
account in the Worker's secrets (`FCM_SERVICE_ACCOUNT`); without one, `push`
answers `{ ok: false, error: "push is not set up" }`.

Deployed at `wss://relay.sidhilynx.com` with `services/relay/deploy.mjs`, the
same way as `services/usage`. `FENNA_RELAY_URL` points Crew at another relay
(the Node server for development or self-hosting).

## C. Crew's side (`remote.cjs`)

- **Identity and phones** in `<userData>/Crew/phones.json`: the computer's
  keys (private keys sealed with `safeStorage`), each phone (id, name,
  platform, ECDH and ECDSA public keys, push token, paired, last seen).
  Without secure storage, phone access is off and Settings says why.
- **Connection** to the relay only while at least one phone is paired or
  pairing is open. Reconnects with backoff (1 s doubling to 30 s, with
  jitter), pings every 25 s, a dead socket noticed in 60 s.
- **The router.** `registerIpc` registers each handler on a router as well as
  on `ipcMain`. A phone's `call` runs the same function with a remote event
  (sender id per phone session). Only the channels in `PHONE_CALLS` run;
  everything that opens a dialog on the computer, reveals or copies a secret,
  reads the person's own files, runs commands as the person, or lowers a bot's
  limits stays on the computer, and the error says "Do this on your
  computer." Results and errors go back as `{ k: "result", id, ok, value |
  error }`; the same call id twice gets the first answer again.
- **Events.** `broadcast` also hands the events in `PHONE_EVENTS` to the
  phones as `{ k: "ev", seq, ch, p }`. Each computer start is an `epoch`; the
  last 1000 events stay in memory. A phone says `hello { epoch, seq }` when it
  connects: the computer replays what it missed (only the newest
  `crew:changed`, and the newest `crew:browser` per bot), or answers `resync`
  when the epoch changed or the gap is gone, and the phone reloads what it
  shows. `crew:changed` goes to phones at most 4 times a second (the newest
  wins).
- **Frames.** A phone watching a bot is a watcher with mode `remote` in
  `browser.cjs`. Frames are captured on paint at most 10 a second, scaled to
  the phone's view and pixel ratio, JPEG quality 70, one in flight per phone,
  only the newest waiting, sent as `{ k: "frame", n, ... }`; the phone acks
  `n`. No ack in 3 s frees the slot. Leaving the screen, losing the
  connection or 30 s with no ack drops the watcher.
- **Push.** When something new starts waiting, each phone that isn't
  connected with the app in front gets one push: the bot's name and the
  question (as the desktop notification says it), sealed with the push key.
  A phone that has no push token gets nothing; the Inbox shows it next time.
- **Remove a phone:** it is told `revoked`, taken off the hub's allow list
  and forgotten.

## D. Desktop: Settings → Phone

A section in Settings, in the page's own components and tokens:
- Off state: "Use your crew from your phone. Your computer must be on and
  Crew running." **Connect a phone**.
- The dialog: the QR code (black on white in both themes, quiet zone 4
  modules), the code as text with Copy, "Expires in 1:52", and the state:
  "Waiting for your phone…" → "Connected: Pixel 8". Esc or Close cancels.
- The list: name, "Online now" or "Last seen 14:02", Remove (asks first).
- Errors in words: relay unreachable, secure storage missing.

QR from `qrcode-generator` (approved; no dependencies of its own).

## E. The phone app (`apps/crew-mobile`)

Capacitor 8, Android only for now, React 19 + Vite, the same contract types
(`apps/crew/src/shared/contract.ts`) and the pure modules the desktop page
already has (faces `pixels.ts`, markdown `md.ts`, mentions). Plugins (approved):
`@capacitor/core`, `@capacitor/android`, `@capacitor/app`,
`@capacitor/preferences` (keys and the push key, in Android's private
storage), `@capacitor/push-notifications`, `@capacitor/haptics`,
`@capacitor/keyboard`, `@capacitor/status-bar`, `@capacitor/splash-screen`,
`@capacitor/barcode-scanner`.

### Reliability rules

1. **One state for the connection**, shown in one place (a bar under the
   header): Connecting, Online, Computer asleep (since …), Reconnecting,
   Not paired. Never a spinner that never ends; a call made offline fails at
   once with "Your computer isn't reachable."
2. **Every call has an id and a timeout** (20 s; 60 s for create and connector
   saves). A reconnect re-sends calls still waiting, with the same id.
3. **Messages are never sent twice and never lost silently:** the composer
   keeps the text until the computer says it got it; a failure leaves it there
   with Retry.
4. **The screen keeps working offline:** the last overview and each open chat
   stay on screen, marked as not current.
5. **Approvals are answered once:** the card shows the answer the computer
   took, even if the desktop answered first ("Approved on your computer").

### Look and feel

Crew's own: the tokens of `apps/crew/src/renderer/styles.css` (dark and
light, following the phone), the pixel faces, the pixel attention mark, ink
primary buttons, steel for selected, red for failures and deletes. Touch
targets at least 44 px; 16 px side gutter; motion 120 to 200 ms in whole
pixels, none under reduced motion; haptics on approve, deny and send. Lists
are virtualised past 100 rows. Copy is short and exactly true, as on the
desktop (docs/ui-rules.md).

### Screens

| Screen | What it does | Calls |
|---|---|---|
| Pair | Scan or enter the code; errors (expired, wrong code, relay down) | link pairing |
| Crew | Bots (face, name, status line, need mark), group chats, "+" | `crew:overview`, `crew:changed` |
| Inbox | Questions, approvals, login offers; answer in place | `crew:answer`, `crew:decide`, `crew:saveOffer` |
| Chat | History (paged), live steps, cards, composer, chat switcher, New chat, Run now, Stop | `crew:history`, `crew:event`, `crew:send`, `crew:newChat`, `crew:openChat`, `crew:run`, `crew:stop` |
| Group chat | Thread, @mentions | `crew:teamThread`, `crew:teamSend` |
| Details | Job, how it works, schedule, brain, ask-before, face, connectors, skills, logins, memory, library, watches and todos, runs, delete | `crew:bot`, `crew:update`, `crew:delete`, `crew:watches`, … |
| New bot | One form, as the desktop's | `crew:create`, `crew:clis` |
| Screen | The bot's browser: tabs, address, picture, watch or take control | `crew:watch` (remote), `crew:control`, `crew:navigate`, `crew:browserGo`, `crew:tab`, input |
| Settings | Computer, connectors, skills, logins, usage, defaults, disconnect | `crew:connectors`, `crew:skills`, `crew:vault`, `crew:runStats`, `crew:settings` |

### Notifications

FCM data messages only (Google sees a sealed blob). A small native
`FirebaseMessagingService` in the Android project opens the blob with the
push key kept in Preferences and shows the notification; tapping it opens the
app on that card. Needs the project's `google-services.json` from Firebase,
which the lead adds (it is not in the repo); without it the app works and
says notifications are off.

## What stays on the computer

Revealing or copying a password, the file and folder pickers, saving a chat
to a file, the terminal, the code editor and the bot's desktop windows,
reading the person's own memory files, unsandboxed shells, repository
policies and app grants. Each answers "Do this on your computer" if called.

## As built, 2026-11-24

Where the build differs from the plan above, and why:

- **Notifications use a plugin of our own** (`CrewPushPlugin.java`,
  `CrewMessagingService.java`), not `@capacitor/push-notifications`: that
  plugin brings its own Firebase service, which would take the messages
  before ours could open them. Ours also says when the build has no
  Firebase, instead of failing.
- **`@capacitor/network`** was added, so the link reconnects the moment the
  network comes back.
- **Android 8 (API 26) is the oldest supported**: the barcode scanner needs it.
- **The phone client lives in `crew-link`** (`phone.ts`, `relay.ts`), so the
  tests run the same code the app does.
- **Events say which event came before them for that phone** (`a`), because
  some events skip a phone (the cursor of a bot it isn't watching) and a
  replay skips events a newer one replaced. A gap is `a` greater than what
  the phone last saw.
- **Enter in a bot's browser** now sends its character too (`browser.cjs`):
  without it, Enter didn't submit forms, on the phone or the desktop.
- **Pairing codes allow `ws://` only to this computer and the Android
  emulator's host**; everything else is `wss://`.

## Proof

- `npm test`: protocol, hub, router, replay, frames, push, chaos (dropped,
  delayed, duplicated and reordered messages; computer restart; relay
  restart; phone reconnect mid-call).
- An end-to-end run: the Node relay, a real Crew (temp user data) and the
  phone app in a phone-sized window: pair, message a bot, answer an
  approval, take control, lose the network, come back.
- The debug APK built with Gradle; on an emulator when this machine runs one.
- Screens at 360×780 and 412×915, dark and light, looked at.
