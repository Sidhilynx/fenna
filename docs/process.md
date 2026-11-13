# How work moves in this repository

Every app here (slides, docs, sheets, and the ones after them) is built by
many different models. Most of them will never hear the product's mission
from a person. This file is the mission and the process, so they don't have
to. AGENTS.md has the code rules; this file has the order of work and who
does what.

## The mission, in one paragraph

We build open-source, local-first versions of AI-native office tools: slides,
docs, sheets, and more. Each one is its own free desktop app on one shared
shell (`packages/shell`). A file is a plain folder on the user's computer.
Any AI that speaks MCP can read and edit it as well as a person can, and the
person watches every change land. The reference for how each app should look
and behave is in `example-screenshots-<app>/`. "Done" means a person can't
tell where our app falls short of the reference, and an AI using it through
MCP gets the job done on the first try.

## Three stages

Every app, and every big feature in one, goes through these stages in order.
An app's current stage is written in its brief (`docs/apps/<app>.md`).

| Stage | Who | Goal | Leaves behind |
|---|---|---|---|
| 1. Build | Any model | A working MVP that covers the brief | Code, tests, screenshots, a build summary |
| 2. Verify | A Claude model | Find everything wrong compared with the reference | A review in `docs/reviews/` |
| 3. Finish | A Claude Opus model | Fix the review, final UI and UX polish, and production readiness | A clean review, the stage moved to `production` |

### 1. Build (any model)

- Read AGENTS.md, this file, and the app's brief before writing code.
- Look at every image in `example-screenshots-<app>/` before you start. Build
  to them, not to your idea of the product.
- Build the editor, the file format and its tests. Write a draft MCP server
  shaped like Claude's own tools for the app (when they are in the reference
  folder), mark it `draft` in its README, and run the brief's agent tasks
  with it. Claude finishes it (see "MCP is designed by Claude" below).
- Check your own work the way a verifier would, following `.agent/skills/`:
  capture every flow and compare it with the reference at both sizes and
  themes, try every edge case, check results on disk. Fix what you find;
  stage 3 is for final polish, not for finishing the build.
- Finish with a hand-over at the end of the brief (the `opendeck-build`
  skill lists what it holds): what works with its evidence, a self-review
  table of everything still wrong, agent task results, and anything you
  guessed.
- Never mark your own work verified or production.

### 2. Verify (a Claude model)

The verifier runs the app for real and compares it with the reference. Reading
the code is not enough. A review covers three things, and each one needs
evidence:

1. **Visual.** For each reference screenshot, capture the same state in our
   app (same size, same theme) and compare them side by side: layout,
   spacing, type, color, icons, empty states, the light and dark themes.
2. **User experience.** Do the flows the reference shows, with mouse and with
   keyboard only: create, open, edit, undo, delete, share, export. Try the
   edge cases in AGENTS.md rule 7. Note anything that is slow, confusing,
   missing, or that loses work.
3. **Agent experience.** Connect a model to the MCP server and give it real
   tasks from the brief ("write a two-page memo from these notes", "add a
   column that totals Q3"). Read the transcript. Every wrong tool choice,
   retry, misread result or unclear error is a finding against the server,
   not the model.

Write the review as `docs/reviews/<app>-<yyyy-mm-dd>.md` using the template
below. Fix nothing in this stage except trivial breakage that blocks review;
the point is a complete list.

### 3. Finish (a Claude Opus model)

- Work through the review from most severe down. Each finding ends as
  `fixed` (with how) or `won't fix` (with why).
- Do the final UI and UX polish against the reference.
- Redesign the MCP server if Verify found it wrong (see below).
- Run the whole Verify pass again on the result. Stage 3 ends only when a new
  review has no blocker or major findings.
- Move the brief's stage to `production`.

## MCP is designed by Claude

The MCP server is how other AIs use the app, so it is the product as much as
the editor is. It is designed and changed only by Claude models, in the
Verify and Finish stages. Builders may write a draft; it is not the final
interface.

A Claude model designing a server starts from how its own tools work, because
those are the tools models are trained to use well, and holds the server to
these rules:

- **Few tools, shaped like the work.** A model should need about as many
  calls as a person needs actions. Prefer `read`, `edit`, `create`, `search`,
  `render` over one tool per property.
- **Read before edit, and edits are exact.** Reading returns the document as
  the model would write it (the same format the files use), with stable ids
  or line numbers. Editing names what to change by those ids or by an exact
  match, the way a file Edit tool replaces an exact string. A stale or
  ambiguous edit fails with a message saying what to read again.
- **Results are small and true.** Return what changed and anything the model
  must know next (warnings, validation problems), not the whole document
  again.
- **Errors say how to fix them.** "Unknown property `colour`. Did you mean
  `color`? Allowed: …" not "invalid input".
- **Descriptions are written for the model.** Each tool description says
  when to use it, when not to, and gives one example. Schema lists come from
  the format package (AGENTS.md rule 1), never typed by hand.
- **The model can check its own work.** There is a way to see the result
  (render to an image or validate) without asking the user.
- **Proved with transcripts.** A server change is done when the agent tasks
  in the app's brief pass with at least two different models, and the
  transcripts are in the review.

## Reference screenshots

- Each app has `example-screenshots-<app>/` at the repo root (slides, docs,
  sheets, whiteboard, …). They are the target in every stage.
- They are git-ignored: they show other companies' products and must never
  be published. Don't copy their assets, names or text into the app.
- Our own captures for a review go to `%TEMP%` while working. Name the pairs
  in the review by reference filename.

## App briefs

`docs/apps/<app>.md` is the one page that tells a model what the app is for,
using `docs/apps/TEMPLATE.md`. A new app gets its brief before any code. If a
brief is missing or wrong, stop and say so; don't guess the mission.

## Review template

```markdown
# <app> review, <yyyy-mm-dd>

Reviewer: <model>  Stage: verify | finish  Commit: <sha>

## Summary
Two or three lines: how close to the reference, the biggest gaps.

## Findings
| # | Area | Severity | Finding | Evidence | Outcome |
|---|------|----------|---------|----------|---------|
| 1 | visual / ux / agent | blocker / major / minor | What is wrong, in one sentence | Reference file + our capture, or transcript line | open / fixed / won't fix |

## Agent tasks
Each task from the brief, the model used, pass or fail, and the transcript
(or a link to it).
```

Severity: **blocker** loses work, crashes, or makes the main flow
impossible; **major** is visibly wrong next to the reference or makes an AI
fail a task; **minor** is polish.

## Keeping a big project stable

- **One task, one branch, one summary.** Small changes that can be reviewed
  in one sitting. No drive-by edits outside the task.
- **Shared before copied.** If two apps need the same UI, it moves into
  `packages/shell`, done by the lead or a Claude model in stage 3. Builders
  never copy one app's component into another.
- **Core is owned.** `packages/*` and main processes change only with the
  lead's approval (AGENTS.md, "Who changes what").
- **Tests are the floor, screenshots are the bar.** `npm test` and typecheck
  must pass at every stage, but no stage is finished on tests alone.
- **Write down decisions.** When a stage-3 model decides something about the
  product (not just the code), it adds one line to the app's brief under
  "Decisions", so the next model doesn't undo it.
- **Say what you didn't do.** Every summary lists what was skipped or
  guessed. A summary that claims everything is done needs evidence for each
  claim.
