---
name: opendeck-build
description: The whole workflow for building a new app (or a big feature) in this repository as the stage-1 builder, from reading the brief to handing over a checked build. Use it at the start of every build task here, and come back to its checklist before you say you are done.
---

# Building an app in this repository

You are the builder (stage 1 in `docs/process.md`). A Claude model will verify
and finish your work. Your job is to leave it as little as possible: a build
that matches the reference, works on every path, is tested, and comes with
evidence. "It compiles" is not done. "I looked at it and it matches" is done.

Read first, every time: `AGENTS.md`, `docs/process.md`, the app's brief in
`docs/apps/<app>.md`. Then the skills below as each step needs them.

| Step | Skill |
|------|-------|
| Understand the product | `reference-study` |
| See your work as a person sees it | `ui-verify` |
| Break it on purpose | `edge-cases` |
| Let an AI use it | `mcp-and-agent-check` |
| Run commands without fighting Windows | `windows-env` |
| Avoid what went wrong last time | `known-mistakes` |

## The loop

Work in slices, one flow at a time (for example: "place and edit a sticky
note"). For each slice:

1. **Reference.** Open the reference images for this flow (from your
   catalogue, `docs/apps/<app>-reference.md`). Write down what must be on
   screen: every control, label, menu item, shortcut and state.
2. **Format first.** If the flow stores something new, add it to the format
   package (`packages/<format>`) with its schema list, its validator and a
   test, before any UI. The UI and the MCP server read lists from the schema
   (AGENTS.md rule 1).
3. **Build** the UI for the flow in `apps/<app>/src/renderer`.
4. **Test.** Unit tests for the format logic: happy path, empty, huge,
   broken input, undo. Run `npx vitest run packages/<format>` (see
   `windows-env`).
5. **Typecheck** every tsconfig you touched.
6. **Build and capture** (`ui-verify`): the same state as the reference, at
   1440x900 and 1000x700, dark and light. **Open every image** and compare
   it with the reference side by side. Fix what differs, then capture again.
7. **Check on disk.** After a scripted edit, read the saved file and confirm
   it holds exactly what you expect (`shot.mjs` prints where the copy is).
8. **Edge cases** for this flow (`edge-cases`).
9. **Log it** in your build notes (see "Hand-over" below): what you checked,
   with the capture file names.

Never batch all the UI and then check it at the end. Each slice ends with
screenshots that you have looked at.

## Order of work for a new app

1. Catalogue the references (`reference-study`). Write
   `docs/apps/<app>-reference.md` before any code.
2. The format package: schema, reader with clear problems (a broken file is
   shown, never silently replaced), writer, validator, tests. A sample in
   `examples/sample-<thing>/` that loads with zero problems and exercises
   every element kind.
3. The app shell: copy the structure of `apps/sheets` (main process,
   preload, Vite config, `package.json` scripts, the review harness wiring)
   and change names. Do not change `packages/shell`; if you need something
   there, write it in your hand-over under "Core changes needed".
4. Flows, one slice at a time, in the order of the brief.
5. The draft MCP server (`mcp-and-agent-check`), then the brief's agent
   tasks run with two models.
6. A full pass: every reference image against a capture, every edge case,
   tests, typecheck, build.
7. The hand-over.

## Hand-over (what you leave for Claude)

Write it at the end of the app's brief under "Build summary", and keep a
working copy as you go. It must contain:

- **What works**, flow by flow, each with the reference file names and your
  capture file names that match them.
- **Self-review table**, in the same form as `docs/process.md`'s review
  template: everything you know is wrong or missing, with severity. An
  honest list is worth more than a short one. Claude will find what you hid.
- **Agent tasks**: each task, model, pass or fail, call count, failed calls
  (from `node scripts/agy-trace.mjs`), and what you checked on disk.
- **Edge cases**: each one and what happened.
- **Guesses**: anything you decided without a reference.
- **Core changes needed**: anything in `packages/shell` or another app you
  could not change.
- **Commands run**: the last `npx vitest run` and typecheck output lines.

## Done means

- [ ] Every reference image is in the catalogue and has a matching capture
      (or a line in the self-review saying why not).
- [ ] 1440x900 and 1000x700, dark and light, looked at, for every flow.
- [ ] Every edge case in `edge-cases` tried, results written down.
- [ ] Every agent task run with two models on copies; results checked on
      disk; traces read.
- [ ] `npx vitest run` passes; typecheck passes for every touched tsconfig;
      the app builds.
- [ ] No dead code, TODO, console.log, raw hex in components, hard-coded
      lists, new dependencies (AGENTS.md).
- [ ] `known-mistakes` checklist gone through item by item.
- [ ] The hand-over is written. The brief's stage stays `build`: you never
      mark your own work verified or production.
