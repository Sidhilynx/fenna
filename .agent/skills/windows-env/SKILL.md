---
name: windows-env
description: How to run npm, tests, typecheck, builds, Electron and scripts on this Windows machine without the usual failures (wrong path case, Git Bash quirks, Electron starting as Node, escaping that eats backslashes). Use before running any command here.
---

# Running commands here

## Where and how

- Use **PowerShell**, from `D:\sidhilynx\open-source-tools` (capital `D:`).
  npm compares paths case-sensitively; `d:\` breaks workspace links.
- In PowerShell 5.1 there is no `&&`. Use `;`, or `if ($?) { ... }`.
- **Never run `npm install`** or add dependencies (AGENTS.md rule 5). If you
  need a package, name it in the hand-over.
- Vitest from Git Bash reports "no tests". Run it from PowerShell.

| What | Command |
|------|---------|
| All tests | `npx vitest run` |
| One package | `npx vitest run packages/board` |
| Typecheck | `npx tsc -p apps/whiteboard/tsconfig.json --noEmit` (and each `packages/*` tsconfig you touched) |
| Build an app | `npm run build -w @opendeck/whiteboard` |
| Capture | `node scripts/shot.mjs ...` (`ui-verify`) |
| Agent run | `node scripts/agy-try.mjs ...`, then `node scripts/agy-trace.mjs` |

Read the last lines of every test and typecheck run. "Tests 266 passed" and
an empty typecheck output are the only passes.

## Electron

- If Electron prints "Node.js v24" and a stack trace, `ELECTRON_RUN_AS_NODE`
  is set: `Remove-Item Env:ELECTRON_RUN_AS_NODE`. (`shot.mjs` does this.)
- Never launch the app on the user's real profile for tests; `shot.mjs`
  uses a fresh `--user-data-dir`.

## Writing files

- Edit source with your file-editing tool, not with shell one-liners.
  Scripts passed through PowerShell or Bash lose backslashes and quotes, and
  regexes like `/\d+/` silently become `/d+/`. If you must generate a file
  from a script, write the script to a `.mjs` file first and run it.
- No Python on this machine. Use Node (`.mjs` files) for helper scripts, and
  keep them in `%TEMP%`, not the repo.
- PowerShell's `Set-Content` writes a BOM and CRLF. Use `-Encoding utf8` with
  `Out-File`, or write files with Node.
- After any generated edit, open the changed lines and check them.

## Time

Agent runs take 1 to 5 minutes; give them a 10-minute timeout. Electron
captures take about 15 seconds each; `--all` takes about a minute.
