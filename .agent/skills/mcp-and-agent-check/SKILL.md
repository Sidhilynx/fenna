---
name: mcp-and-agent-check
description: How to write the draft MCP server for a new app so Claude only has to finish it, and how to prove it with the brief's agent tasks run through Antigravity on copies of the sample, reading traces and checking results on disk. Use once the format and main flows work.
---

# The draft MCP server and the agent check

The MCP server is how other AIs use the app. Claude designs the final one
(docs/process.md, "MCP is designed by Claude"); you write a **draft** close
enough that finishing it is small. Mark it `draft` in its package's README.

## Shape it like Claude's own tools

If `example-screenshots-<app>/claude-tools/` exists, read it first
(`reference-study`). Model the draft on those tools: a similar small number
of tools, similar argument names, results of similar size. Where we must
differ (local folders, our format), say why in the README.

Rules (the full list is in docs/process.md):

- **Few tools, shaped like the work**: overview, read, edit/write, create,
  find, comment. Not one tool per property.
- **Read before edit.** Reading returns elements with stable ids, in the
  form the files use. Edits name elements by id. A stale edit (the file
  changed since it was read) fails and says what to read again, using a
  version string from the read.
- **Strict arguments.** Wrap tool registration so every tool refuses
  argument names it doesn't take and lists the ones it does. Copy
  `strictTools` from `packages/sheet-mcp/src/index.ts`. Models guess
  (`reply` for `text`, `sheet_id` for `sheet`); a silently dropped argument
  loses work.
- **All or nothing.** Validate the whole request first; if anything is
  wrong, save nothing and list every problem with how to fix it ("Unknown
  shape `rectangle`. Did you mean `rect`? Allowed: …").
- **Lists from the schema.** Allowed kinds and values in descriptions and
  zod enums come from the format package, never typed by hand.
- **Small, true results**: what changed, new ids, and anything to check
  next (warnings, things that did not happen as the model might expect).
- **The model can check its work**: a read or render it can call after
  editing.
- **Descriptions for the model**: when to use the tool, when not to, one
  example.
- **Format guide tool**: everything an element can hold, generated from the
  schema.

Write server tests the way `packages/sheet-mcp/test/server.test.ts` does
(an in-memory client against a temp copy of the sample), including refused
arguments and all-or-nothing failures.

Build the MCP bundle with the app (copy `apps/sheets/scripts/build-mcp.mjs`).
The app's chat uses it, so check that the chat column's assistant can call
the tools too.

## The agent check

The brief lists agent tasks. Run each with **two models**, each on its own
**fresh copy** of the sample, **one at a time** (runs in parallel interfere):

```powershell
Copy-Item -Recurse examples\sample-board $env:TEMP\agent\t1-flash
node scripts/agy-try.mjs --board $env:TEMP\agent\t1-flash --model gemini-3.8-flash-medium "<task text from the brief>"
node scripts/agy-trace.mjs
```

Models: `gemini-3.8-flash-medium` and `claude-sonnet-4-6` (if one is not
available, use `gemini-3.8-flash-high` and say so).

Never point agy-try at `examples/` itself, and never use the Gemini CLI for
this; always `scripts/agy-try.mjs`.

For each run:

1. **Trace**: `node scripts/agy-trace.mjs` lists every call, and every
   failed call with its error. Each failed call is a finding against the
   **server**, not the model: unclear description, missing alias in the
   error message, an argument shape models get wrong. Fix the server so the
   error tells the model exactly what to do, and rerun.
2. **Disk**: open the copy's files and check the result yourself. The
   model's own summary is not evidence; it has claimed replies it never
   saved.
3. **Look**: open the copy in the app (`shot.mjs --file <copy>`) and check
   that it looks right (no overlaps, right styles, nothing off-screen).

Record each run in the hand-over: task, model, pass or fail, call count,
failed calls and why, what you checked on disk, the capture file name.
