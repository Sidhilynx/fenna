# Crew terminal sandbox audit, 2026-11-24

Reviewer: Claude Haiku 5.5  Stage: security audit (issue #23)  Commit: the commit that adds this file

## Scope

The sandbox that runs a bot's terminal programs:

- `apps/crew/src/main/sandbox.cjs` (run policy, page, window, session)
- `apps/crew/src/main/sandbox-preload.cjs` (the only bridge a program gets)
- `apps/crew/src/renderer/Terminal.tsx` and `apps/crew/src/renderer/termModel.ts` (how output is shown)
- Tests: `apps/crew/test/sandbox.test.ts` (existing), `apps/crew/test/sandbox-escape.test.ts` (new)

Out of scope: the OS-level sandbox (`os-sandbox.cjs`), the bot's disk policy (`disk.cjs`), and Electron's own renderer and network stack, which the tests do not run.

## Method

- Read the code and the existing sandbox tests, then listed each route out of the window.
- Wrote tests against what the code configures: the window's web preferences, the session per run, the request hook, the permission handlers, the navigation and window-open handlers, the time limit and kill path, the output cap, the preload in an isolated VM, and the page bootstrap run in a bare VM context.
- Where a route is only closed by Electron or Chromium itself, the verdict says so and the test does not claim more.

## Verdicts

| # | Question | Verdict | Proof |
|---|----------|---------|-------|
| 1 | Network: fetch, XHR, WebSocket, EventSource, sendBeacon, img, link, iframe, CSS, window.open, location, service workers | **Safe.** The page policy is `default-src 'none'` with only inline script allowed, and every request not `data:` or `about:blank` is cancelled. Fetch, XHR, WebSocket, EventSource and sendBeacon are also removed from the program's globals. New windows and navigation are denied. Service workers need a secure origin, which an opaque `data:` page is not (reasoned, not run). | `sandbox.test.ts` (request hook, window open, navigation); `sandbox-escape.test.ts` (request hook for ws, wss, ftp, file, blob and custom schemes; policy directives; globals removed; sendBeacon removed) |
| 1a | Network: DNS prefetch and preconnect (browser-level, not seen by the request hook) | **Hardened in this change.** The window's session routes through a proxy at `127.0.0.1:9`, which nothing listens on. Not run in a real Electron window; the test proves the setting only. | `sandbox-escape.test.ts` (proxy setting) |
| 1b | Network: WebRTC peer connections | **Hardened in this change:** each sandbox window's WebRTC IP handling policy is `disable_non_proxied_udp`, so peer connections (including from a frame) may only use the proxy, which goes nowhere; the page loads only after the proxy is set. Not yet verified in a real Electron window. | `sandbox.cjs` |
| 2 | File system outside the bot's disk, Node, Electron APIs, contextBridge, another bot or session | **Safe**, with one gap closed. Paths are checked against the bot's disk; the program has no `require`, `process` or `Buffer`; the preload requires only `electron` and exposes one bridge with the documented methods; calls are checked by sender; each run has its own in-memory session. **Hardened:** a download would have been saved to the person's own Downloads folder, outside the bot's disk. Downloads are now refused. | `sandbox-escape.test.ts` (download refused; preload requires only electron and exposes only `__fennaBridge` with nine methods; the run's channel only; no Node names in the page; another bot's disk refused; calls from another window refused) |
| 3 | Time limit, freeze, slow the app (busy loops, huge output, memory, timers after kill) | **Hardened.** The time limit destroys the window and clears its timer; later calls are refused; the bot's slot is released. **Hardened:** output past the 256 KB cap used to let the program keep running, so a print loop kept sending IPC to the app. Now the run is stopped at the cap, and a single print is cut before it is measured. Busy loops run in the program's own renderer and are ended by the window's destruction. Residual: a program can make many 10 MB reads or writes within the disk policy; that is bounded by the disk's free space and the per-call limit, and is not rate-limited. | `sandbox.test.ts` (time limit); `sandbox-escape.test.ts` (kill, slot freed, no timer left, output cap stops the run, output under the cap runs on, cut counts bytes) |
| 4 | Output shown in the UI without escaping (ANSI, HTML, links) | **Safe.** Program output and the command are rendered as React text children; there is no `innerHTML`, `dangerouslySetInnerHTML` or link built from output. Escape codes are shown as raw characters, which is cosmetic and not changed here. | `sandbox-escape.test.ts` (source checks on `Terminal.tsx`; `termModel` keeps markup and escape codes as plain text) |

Permissions: every permission request, check and device check is denied, including for names the sandbox does not list. This is tested in `sandbox-escape.test.ts`.

Sessions: each run has its own partition (`sandbox-<random>`, never `persist:`), with no cache, cleared when the run ends.

## Open finding

WebRTC: peer connections are not covered by the CSP or the request hook. They are now limited to the proxy (see 1b). A test in a real Electron window that a peer connection can't reach a remote STUN or TURN server is still to do.

## Not verified here

- Behavior inside a real Electron window: the renderer sandbox, the network stack, the proxy setting's effect on DNS prefetch, and that service workers are refused. These are reasoned from Electron and Chromium behavior and need a run in the app.
- Stuck slot: if `clearStorageData` never resolves, a bot's slot stays taken. Not tested; Electron resolves it in practice.
- ANSI escape codes are shown as raw characters in the terminal. Cosmetic only.

## Tests

- `apps/crew/test/sandbox-escape.test.ts` (new, 40 tests)
- `apps/crew/test/sandbox.test.ts` (fake session gains `on` and `setProxy` for the new calls; no assertions changed)

## Checks

- `npx vitest run apps/crew`: 68 files, 1908 tests, all pass.
- `npx tsc -p apps/crew/tsconfig.json`: exit 0.
