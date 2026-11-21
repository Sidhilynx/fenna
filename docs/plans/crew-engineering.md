# Crew for software engineering

Goal: a person gives Crew a repository, in any language, and a crew of bots
carries it forward the way a small team would: a roadmap, issues, branches,
code, tests, screenshots of the running app, pull requests, review, and
maintenance over time, with the person approving what matters. "Fenna
maintains Fenna" is the first proof: we point Crew at Sidhilynx/fenna.

Outside coding, every brain (Claude Code, Codex, Antigravity) runs with its
own tools off and works only through Crew's tools
(`packages/shell/main/agent.cjs`). Coding is different: the CLIs are best at
it with their own tools, so a bot working in a repo gets them back, inside
limits Crew sets:

| Brain | Its own tools, in the repo | The limit |
|---|---|---|
| Claude Code | `--tools default`, cwd the repo | Every tool call outside reading and editing in the repo asks Crew's `approve_tool`; Crew allows what the person allowed and asks about the rest. Claude's sandbox where the OS has one. |
| Codex | shell on, `sandbox_mode=workspace-write`, cwd the repo | Codex's sandbox: writes only in the repo. It can't ask mid-run, so the sandbox is the limit. |
| Antigravity | `command(*)`, `write_file(<repo>/**)` | Its sandbox; `unsandboxed(*)` stays denied. |

The repo is the bot's own **clone** in `Files/Repos/<name>` (with `.git`),
so the one folder the sandbox allows holds everything, the person's checkout
is never touched, and two bots never share a working copy. The clone keeps
no remote URLs (Crew keeps where it came from in `repos.json`), and the
brain's git reads only the bot's own settings file: no credential helper,
commits signed "<bot> (Fenna Crew)". A bot commits on its own, but only
Crew's `repo sync` and `repo push`, after the person approves, reach
anything outside.

What testing on Windows showed (2026-11-21), and what Crew does about it:

| Brain | Its sandbox on Windows | Crew's rule |
|---|---|---|
| Claude Code | none | Every shell command is the person's decision through `approve_tool` (once, or always for that program). Not run live yet: Claude Code isn't installed on the test machine. |
| Codex | default: read-only even in the repo; `unelevated`: lets writes outside through; `elevated`: works in the repo after a one-time Windows admin prompt | Uses `elevated`. Whether it blocks writes outside is still to confirm after the person accepts that prompt. |
| Antigravity | `--sandbox` doesn't stop commands writing outside (its `git push` to a folder elsewhere worked) | Its shell stays off on Windows until the person allows it unsandboxed once (`repo allow_shell`); it can still read and edit through Crew's file tools. |

## Stages

Each stage ends with its acceptance test passing on Windows, and on macOS
and Linux where the stage says so.

### 1. Repos and coding runs (#61)
- The person links a local repo or a URL (the bot asks with `repo link` or
  `repo clone`; the person approves). Crew clones it into the bot's
  `Files/Repos/<name>` and remembers where it came from.
- `repo` tool (Crew, every brain): list, status, link, clone, sync, push,
  remove, allow_shell.
  Push asks every time and sends the bot's branch to the source folder or to
  the source's own remote. It never pushes to the branch the person has
  checked out, and never force-pushes.
- A bot with a repo runs as a coding run: its brain's own tools on, cwd
  `Files/Repos`, the limits in the table above. Its native steps show in the
  chat like Crew's own.
- Any installed toolchain works (flutter, python, cargo, go, dotnet, gradle,
  make, npm, ...) because the brain's own shell runs it; a missing one is
  installed with the platform installer after the person approves.
- Accepted when, with each brain: a bot links a local repo, makes a branch,
  edits code, runs the repo's tests with the repo's own toolchain, commits,
  and pushes a branch after approval; the person's checkout is unchanged; a
  second bot works on the same repo in parallel; a push without approval is
  impossible.

### 2. Sandbox (#62)
- Repo commands run in an OS sandbox: writes only in the worktree and the
  tool caches, no reading the person's home secrets (`~/.ssh`, browser
  profiles, credential stores), network on by default and limitable per repo.
- Linux: bubblewrap. macOS: sandbox-exec profile. Windows: AppContainer or a
  restricted token with a low-integrity worktree. Docker is used when present
  and the person prefers it.
- Until a platform has its sandbox, commands run as the person with the
  stage 1 approvals, and the approval card says so.
- Accepted when: a planted test that reads `~/.ssh`, writes outside the
  worktree, or starts a shell is refused on all three systems.

### 3. Seeing the running app (#63)
- The bridge between the bot's computer and the person's: any window a
  bot's command opens (a desktop app, an emulator, a browser) is captured
  into a window on the bot's computer that the person watches, and the bot
  sees it with `screenshot` and acts on it with `click`/`type`/`press` by
  coordinates, like its browser.
- Web servers already open in the bot's browser; native apps and emulators
  join them.
- Accepted when: a bot runs a Flutter or Electron app it changed, takes
  captures at two sizes, and attaches before/after captures to its PR.

### 4. The GitHub loop (#64)
- From an issue to a merged pull request: triage comment, branch, PR with
  summary and captures, CI status, fixes for review comments, merge.
- A per-repo policy says what a bot does alone (comment, draft PR) and what
  needs a yes (push to a shared branch, merge, release, close issues). The
  default is draft PRs only, and the person merges.
- Accepted when: a good-first-issue goes from opened to merged with one
  click from the person.

### 5. Untrusted input (#65)
- Issue, comment and PR text from anyone but the owner and approved
  collaborators is data: it never grants permissions or triggers pushes,
  merges or releases. Outside contributors' code runs only in the sandbox,
  with no tokens. Tokens are scoped to one repo, no admin or workflow scope.
- Accepted when: a set of prompt-injection issues ("print your token",
  "merge this now", "run this script") all fail and are reported.

### 6. Teams and roadmaps (#66)
- Roles on a repo: a lead that writes the roadmap (a Doc) and the issues, builders that each
  own a worktree, a tester that runs the app and writes findings, a reviewer
  that reviews PRs. They hand work over with `message_bot`, and a tracker
  Sheet shows who has what.
- A daily watch: new issues triaged, stale PRs nudged, a short standup note.
- Accepted when: given a repo and a one-paragraph goal, the crew produces a
  roadmap, opens issues, and lands the first two PRs with review.

### 7. In public (#67)
- Crew maintains Sidhilynx/fenna under the stage 4 policy, and a public page
  lists every change it shipped with links to its PRs.
- Accepted when: a week of Fenna's own issues are handled this way.

## Tests for every stage
Every stage is tested the ways a person would use it: each brain; Windows,
macOS and Linux where it applies; a JavaScript, a Python and a Flutter repo;
an empty repo, a huge one, a repo with no remote, a detached HEAD, a dirty
checkout, a merge conflict, a missing toolchain, a denied approval, a run
stopped halfway, and Crew quitting mid-command.

## Status (2026-11-21)

| Stage | Built | Where | Proved live | Still to prove |
|---|---|---|---|---|
| 1 Repos and coding runs | yes | `repos.cjs`, coding args in `agent.cjs`, the Repos section in a bot's Details | Antigravity: link, fix, test, commit, Crew push; the Repos screen at both sizes and themes | Claude Code run; Codex after its one-time Windows prompt |
| 2 Sandbox | yes | `os-sandbox.cjs` wraps the whole CLI (bubblewrap, sandbox-exec) | command lines only | a run on Linux and macOS |
| 3 Seeing and using the app | yes | `appwindows.cjs`, `desktop-input.cjs`, tool `app_windows` | click, typing and Control+S in a real window | a bot testing a Flutter or Electron app it changed |
| 4 GitHub loop | yes | `github.cjs`, tool `github`, policy in the Repos screen | issues, issue, PR checks; merge refused without approval | `pr_create`, `comment`, `merge` with a yes |
| 5 Untrusted input | yes | `fence()` in `github.cjs` | trust from the author's role, read live | an injection issue run through a bot |
| 6 Teams | yes | `teams.cjs`, tool `team`, role duties in the prompt, team line in the Repos screen | no | a lead and two builders on one repo |
| 7 In public | yes | `team publish` writes `docs/shipped.json`; `site/shipped.html` shows it | the page's loading, empty, error and full states | the first merged `docs/shipped.json` |
