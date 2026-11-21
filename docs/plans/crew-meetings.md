# Crew: a bot that joins a Google Meet call

Written 2026-11-21 by Claude Opus. Issues: see "Tasks" below. Read AGENTS.md,
docs/process.md and docs/apps/crew.md first.

## What the person gets

The person tells a bot "join this call: https://meet.google.com/abc-defg-hij".
The bot joins as a guest named "<bot> (Fenna)", says in the meeting chat what
it is and how to ask it something, and starts keeping a transcript in its
Files (`Files/Meetings/<date> <time> <code>.md`). When someone says the bot's
name, out loud or in the chat, the bot wakes, reads what was said since it
last woke, and answers in the meeting chat. It can make a Fenna doc, sheet or
deck during the call and **share its screen** to show it, live, while it
writes. It leaves when asked, when the call ends, or when it is alone.

Google Meet only, for now.

## Design rules

1. **The model never drives the call by hand.** Joining, turning captions on,
   opening the chat, sending a message, presenting and leaving are done by
   Crew code over the DevTools protocol, in one `meeting` tool call each. No
   snapshots, no clicks by ref, no screenshots for any meeting step.
2. **Listening costs no tokens.** Meet's own live captions (with speaker
   names) are read from the page by an observer and written to the
   transcript by Crew. The model is only woken when it is addressed.
3. **A wake is small.** It carries only the lines since the last wake (at
   most 60 lines / 6000 characters, older ones named by the transcript path).
   Meeting wakes run in a chat of their own, so the session they resume
   holds the meeting and nothing else.
4. **The final reply is the chat message.** On a meeting wake, the model's
   final text is posted to the meeting chat by Crew (plain text, at most 3
   messages of 500 characters). Reply `SKIP` to say nothing. No tool call is
   needed to talk.
5. **The screen share is pushed, never looked at.** Crew renders the shared
   document in a hidden editor window and pushes its frames (only when they
   change, at most 4 a second) into a canvas stream that the Meet page
   presents. The model checks its document through the fenna tools as text.
6. **Fake devices, real page.** In the Meet tab, `getUserMedia` returns a
   silent microphone and a camera card (the bot's name), and
   `getDisplayMedia` returns the stage canvas. No real camera, microphone or
   screen of the person's is ever opened.
7. **Consent is automatic.** On admission Crew posts, in the meeting chat:
   "<bot> is an AI assistant for <host>'s Fenna Crew. It keeps a transcript
   from the captions. Say "<bot>" to ask it something."

## Pieces

| Piece | File | Who |
|---|---|---|
| A. Meet page scripts | `apps/crew/src/main/meet-scripts.cjs` | Haiku |
| B. Fake Meet + harness | `apps/crew/test/fixtures/fake-meet/`, `scripts/meet-mock.mjs` | Haiku |
| C. Meeting engine (pure logic) | `apps/crew/src/main/meeting-engine.cjs`, `apps/crew/test/meeting-engine.test.ts` | Haiku |
| D. Meeting tab in the bot's browser | `apps/crew/src/main/browser.cjs` (`openMeeting`) | Opus |
| E. Stage (screen share frames) | `apps/crew/src/main/stage.cjs` | Opus |
| F. Meetings manager, `meeting` tool, wake trigger, auto-reply | `apps/crew/src/main/meetings.cjs`, `crew.cjs`, `handlers.cjs`, `runner.cjs`, `prompt.cjs`, `packages/crew-mcp/src/index.ts` | Opus |
| G. In-meeting strip in the bot chat (Leave) | renderer | Opus |

## Contract between A and B (the Meet page)

Real Meet hides its class names, so every script finds things by role, aria
label and visible text only, through these constants in `meet-scripts.cjs`
(exported as `MEET_LABELS`; the fake page must use the same labels):

| What | Found by |
|---|---|
| Name input (guest, before joining) | `input[aria-label="Your name"]`, else an input whose placeholder matches `/your name/i` |
| Join buttons | a button whose text is `Join now` or `Ask to join` |
| Mic / camera toggles | button aria-label starting `Turn off microphone` / `Turn off camera` (on) or `Turn on …` (off) |
| Waiting room | page text contains `Asking to be let in` or `Please wait until a meeting host brings you into the call` |
| In the call | a button with aria-label `Leave call` |
| Denied | page text contains `You can't join this video call`, `denied your request` or `You've been removed` |
| Ended | page text contains `You left the meeting`, `The call has ended` or `You've left the call`, and no `Leave call` button |
| Captions toggle | button aria-label starting `Turn on captions` / `Turn off captions` |
| Captions region | `[role="region"][aria-label*="Captions" i]`; each direct child block holds the speaker's name (first text) and what they said (the rest of its text) |
| Chat toggle | button aria-label starting `Chat with everyone` |
| Chat input | `textarea[aria-label^="Send a message"]` |
| Chat messages | elements with `data-message-id`; the sender is the `data-sender-name` of the closest ancestor that has one; a sender of `You` is the bot itself |
| Present | button aria-label starting `Share screen` or `Present now` |
| Stop presenting | button aria-label starting `Stop presenting` |
| People count | button aria-label matching `/^People\b.*?(\d+)/`, else null |

Buttons are `button` or `[role="button"]`, matched case-insensitively.

## A. Meet page scripts (`meet-scripts.cjs`)

CommonJS, no dependencies, the same style as `page-scripts.cjs`: every page
function is self-contained (sent as source text), takes one JSON argument and
returns JSON. Exports:

- `MEET_LABELS`: the table above, as regexes and selectors.
- `meetMediaSource({ hosts, name })` → string. A **main-world** script for
  `Page.addScriptToEvaluateOnNewDocument`. It does nothing unless
  `location.origin` is in `hosts`. Otherwise it replaces
  `navigator.mediaDevices.getUserMedia` (audio: a silent track from an
  AudioContext oscillator through a zero gain into a
  MediaStreamDestination; video: a 640×360 canvas `captureStream(5)` that
  draws `name` centred, white on #202124), `enumerateDevices` (one
  `audioinput` "Fenna microphone", one `videoinput` "Fenna camera", one
  `audiooutput` "Fenna speaker", stable deviceIds), `getDisplayMedia` (the
  stage: a 1280×720 canvas `captureStream(4)`; the returned track's `stop()`
  and an `ended` event must work), and `navigator.permissions.query` for
  `camera` and `microphone` (state `granted`). It defines one
  non-enumerable global `__fennaStage` with `draw(dataUrl)` (draws a JPEG
  data URL letterboxed onto the stage canvas, resolves when drawn),
  `clear()`, and `active()` (true while a display stream is live).
- `meetState()` → `{ state: "prejoin"|"waiting"|"incall"|"denied"|"ended"|"unknown", captions: boolean, chatOpen: boolean, presenting: boolean, people: number|null }`.
- `meetPrejoin({ name })` → fills the name input if there is one (native
  value setter, then `input` and `change` events), turns the microphone off
  if it is on, then clicks `Join now`, else `Ask to join`. Returns
  `{ clicked: "join"|"ask"|null, filled: boolean }`.
- `meetCaptionsOn()` → `{ on: boolean }`; clicks the toggle only when off.
- `meetChatFocus()` → opens the chat panel if it is closed, focuses the
  input, returns `{ ok: boolean }`. Crew then types with `Input.insertText`
  and presses Enter (real input events, not a value setter).
- `meetPresent()` / `meetStopPresenting()` → `{ clicked: boolean }`.
- `meetLeave()` → `{ clicked: boolean }`.
- `meetListenSource({ binding })` → string. An **isolated-world** script
  (run with `Page.addScriptToEvaluateOnNewDocument` and `worldName`) that
  watches the captions region and the chat messages with a
  MutationObserver (re-finding the region when Meet replaces it) and calls
  `window[binding](JSON.stringify(event))`:
  - `{ kind: "caption", block: <number>, speaker, text }` when a caption
    block's text changes; `block` is a stable number per element (WeakMap);
    at most one report per block per 300 ms, and always the latest text.
  - `{ kind: "chat", id, sender, text }` once per new `data-message-id`;
    messages already on the page when the observer starts are skipped.
  - Text is whitespace-collapsed, at most 2000 characters.

Tests: `apps/crew/test/meet-scripts.test.ts` checks with `node:vm` that each
function is self-contained (compiles from `fn.toString()` alone) and that
the two sources compile; behavior is proven in Electron by B.

## B. Fake Meet and the harness

`apps/crew/test/fixtures/fake-meet/index.html` (one self-contained file, no
network): a page that behaves like Meet through the labels above.

- Query `?guest=1&admit=<ms>&deny=1&script=<name>`: shows the pre-join
  screen with the name input and `Ask to join` (or `Join now` without
  `guest`), then the waiting text, then after `admit` ms the call view
  (or the denied text with `deny`).
- Call view: `Leave call`, `Turn on captions`, `Chat with everyone`,
  `Share screen`, a `People (3)` button. Captions appear only after the
  toggle is on.
- `script=standup`: a timed scenario. Captions from "Sam" and "Priya" grow
  word by word into blocks (rewriting the last word once, as Meet does),
  including "Scout, can you write up the action items as a doc and share
  your screen?" and a chat message from Priya "Scout what's our deadline?".
- Chat: `textarea[aria-label="Send a message"]`; Enter posts a message with
  sender `You`. The page keeps every message the bot sent in
  `window.__fakeMeet.sent` (array of strings).
- Share: clicking `Share screen` calls `navigator.mediaDevices.getDisplayMedia`,
  plays the stream in a `<video>`, counts frames with
  `requestVideoFrameCallback` in `window.__fakeMeet.frames`, and shows
  `Stop presenting`.
- `window.__fakeMeet.events`: an ordered log of what happened (joined,
  captions-on, chat-sent, presenting, stopped, left).
- Leaving shows `You left the meeting`.

`scripts/meet-mock.mjs`: starts a local http server on 127.0.0.1 (random
port) for the fixture, launches Electron with a tiny main script that opens
an **offscreen** BrowserWindow, adds `meetMediaSource` (main world) and
`meetListenSource` (isolated world + `Runtime.addBinding`) through
`webContents.debugger`, loads the fixture with `?guest=1&admit=1500&script=standup`,
then runs: prejoin → wait for `incall` → captions on → collect events for
the scenario → chat focus + `Input.insertText` + Enter → present → draw 5
frames through `__fennaStage.draw` → stop presenting → leave. It prints one
JSON report (states seen, caption events, chat events, `sent`, frame count)
and exits 0 only when every step held. Run with:
`node scripts/meet-mock.mjs` (it removes `ELECTRON_RUN_AS_NODE` for the
child and uses a `--user-data-dir` under the OS temp folder).

## C. Meeting engine (`meeting-engine.cjs`)

Pure logic, no Electron, timers injected. `createMeetingEngine(o)`:

- `o`: `{ botName, aliases = [], now, setTimer, clearTimer, onLine(line), onWake(text), busy() }`.
- `caption({ block, speaker, text })`: a block is final when it has not
  changed for 1500 ms, or when a newer block starts. A final block becomes
  one transcript line, `[hh:mm:ss] Speaker: text` (local time from `now`),
  passed to `onLine`. A block finalizes once; empty text is dropped.
- `chat({ sender, text })`: `sender` `You` is ignored; otherwise a line
  `[hh:mm:ss] Speaker (chat): text`.
- Addressed: a line whose text contains the bot name or an alias as a word,
  case-insensitively, also with one letter wrong for names of 5 or more
  letters (captions misspell), and also with a leading `@`.
- Wake: 700 ms after an addressed line, `onWake(text)` with every line since
  the last wake (at most 60 lines / 6000 characters; when cut, a first line
  `(N earlier lines are in the transcript.)`). If `busy()` is true, it waits;
  `runEnded()` fires a waiting wake. At most 60 wakes an hour; over that the
  wake waits for the hour.
- `replyText(finalText)` (exported function): `null` for empty or `SKIP`
  (any case, with or without punctuation); otherwise markdown stripped
  (`**`, `__`, backticks, heading marks, `[text](url)` → `text (url)`,
  list bullets → `- `), and split on sentence or line ends into at most 3
  messages of at most 500 characters (the rest cut with `…`).
- `stop()`: clears every timer; later calls do nothing.

Tests with vitest fake timers cover each rule above and its edges.

## Agent experience

One tool on the `crew` server, `meeting`, shaped like `apps`:

- `{action: "join", url, name?}` → "Asked to join. Crew lets you know when you are in." or "Joined …". Only `https://meet.google.com/<code>` links.
- `{action: "share", document}` → presents a library document (live).
- `{action: "stop_sharing"}`, `{action: "leave"}`, `{action: "status"}`.
- `{action: "say", text}` → posts to the meeting chat (for runs that are
  not meeting wakes, like a person asking from Crew's chat).

Wake trigger `meeting`: the prompt says it is in a call, gives the lines,
the transcript path, that the final reply goes to the chat (short, plain,
`SKIP` for nothing), and that `meeting share` shows a document.

## Acceptance

1. `npm test` and `npm run typecheck` pass; `check-ui` adds no errors.
2. `node scripts/meet-mock.mjs` passes.
3. Full mock in Crew: a bot, told in its chat to join the fake Meet, joins
   with one `meeting` call, posts the consent message, writes the
   transcript, wakes on its name, answers in the chat, makes a doc and
   shares it (frames reach the fake page), and leaves. No `screenshot` or
   `snapshot` call in the run logs.
4. The person's real call on Google Meet (done by the person at the end).
