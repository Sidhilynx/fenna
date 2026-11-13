# Contributing to Fenna

Thank you for helping. Fenna is four desktop apps (Slides, Docs, Sheets,
Whiteboard) on one shared shell, each with an MCP server so any AI can work
in it. This page says how to send a change that can be merged.

## Before you start

- **Bugs:** open an issue with the app, its version (Home shows it when an
  update is out; otherwise the installer's name), your system, what you did,
  what happened and what you expected. A file that shows the problem helps
  most; remove anything private from it first.
- **Features and bigger changes:** open an issue first and wait for a yes.
  The product has a narrow, deliberate shape, and a large pull request that
  wasn't discussed may be declined however good it is.
- **Security problems:** don't open an issue; see [SECURITY.md](SECURITY.md).

## The agreement

Every contributor signs the [Contributor License Agreement](CLA.md) once.
When you open your first pull request, a bot asks you to sign by posting a
comment; it takes a minute. Fenna is offered under the AGPL and under a
commercial license, and the agreement is what lets your contribution be part
of both. You keep the copyright to your work.

## Making the change

1. Fork the repository and create a branch from `main`.
2. Read [AGENTS.md](AGENTS.md) (the code rules; it's written for people and
   AI models alike) and the brief for the app you're changing in
   [docs/apps/](docs/apps/).
3. Keep the change to one thing. No drive-by edits.
4. Check it:

   ```sh
   npm install
   npm test
   npm run typecheck
   npm run dev -w @opendeck/desktop     # or docs, sheets, whiteboard: try it for real
   ```

   On Windows, use PowerShell, from a path with a capital drive letter.

5. For any change to what people see, add screenshots before and after, at a
   normal and a small window size, in the light and dark themes.

## The rules a pull request is held to

These are in AGENTS.md in full. The ones most often missed:

- **The format is the source of truth.** Lists of elements, properties and
  shapes come from the format packages, never typed again in the UI.
- **One renderer.** Anything that shows a slide uses the shared renderer.
- **Edits go through the format.** Change the parsed tree and serialize it;
  never build file contents by joining strings.
- **Design tokens only.** Colors, sizes and fonts come from the CSS variables.
  Both themes must work. No gradients, emoji or decorative icons.
- **No new dependencies** without agreement in the issue first.
- **Every path:** empty files, very large ones, broken ones, long titles, a
  narrow window, the keyboard alone.
- **Nothing left behind:** no dead code, commented-out code, TODOs or
  `console.log`.

## MCP servers

The MCP servers are how AIs use Fenna, so they are designed as carefully as
the apps. Changes to a server's tools need an issue first, and come with
transcripts of at least two different models doing the app's agent tasks
(see the app's brief) with the change.

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
