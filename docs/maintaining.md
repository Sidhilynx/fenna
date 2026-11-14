# Maintaining Fenna

For the people who run the repository: how the GitHub side works, the
everyday routine, and how a release goes out. Contributors want
[CONTRIBUTING.md](../CONTRIBUTING.md) instead.

## How the pieces fit

| Piece | What it is | Where |
|---|---|---|
| Organization | The `Sidhilynx` account that owns the repository. People are members; admins can change settings. | github.com/Sidhilynx |
| Repository | The code and its history. Public: anyone can read and fork it; only maintainers can change `main`. | github.com/Sidhilynx/fenna |
| `main` | The branch that is always releasable. Nobody force-pushes it or deletes it (a ruleset blocks both). | |
| Branch | A copy of `main` where one change is made, e.g. `fix/sheets-paste`. | |
| Pull request (PR) | A request to merge a branch into `main`. Shows the diff, runs the checks, holds the discussion. | Pull requests tab |
| Fork | An outsider's copy of the repository. Contributors push to their fork and open a PR from it. | |
| Actions | Robots that run on GitHub's computers when something happens. | Actions tab, `.github/workflows/` |
| Issue | A bug report, an idea or a question. Labels sort them; milestones say when. | Issues tab |
| Release | A version with its installers attached. People download from here, and the apps check here for updates. | Releases |

The robots in `.github/workflows/`:

- **CI** (`ci.yml`) runs `npm test` and the typecheck on every pull request
  and every push to `main`. A red cross on a PR means it is not ready.
- **Release** (`release.yml`) runs when a tag like `v0.9.1` is pushed. It
  builds every app on Windows, macOS and Linux and puts every installer
  on a **draft** release. Nothing is public until a maintainer publishes it.
- **CLA** (`cla.yml`) asks each new contributor to sign [CLA.md](../CLA.md)
  by posting one comment, and records it on the `cla-signatures` branch.
  Maintainers and bots are skipped. Don't merge a PR from someone whose CLA
  check is red: their code can't go into the commercial license otherwise.

## The routine for your own changes

```sh
git switch main
git pull                          # get what was merged since
git switch -c fix/what-it-fixes   # one branch per change
# ... change, then:
npm test
npm run typecheck
git add -A
git commit -m "Sheets: paste keeps number formats"
git push -u origin fix/what-it-fixes
gh pr create --fill               # opens the pull request
```

Wait for CI to pass, then **Squash and merge** on the PR page (or
`gh pr merge --squash --delete-branch`). Squashing turns the branch into one
clean commit on `main`.

Commits show the email in the repository's git settings. It is set to the
GitHub "noreply" address, so your private email is never published. Keep
**Settings → Emails → Block command line pushes that expose my email** on in
your GitHub account; it stops a push that would leak it.

## A contributor's pull request

1. Is there an issue that agreed to the change? Big unasked changes can be
   declined politely; point to CONTRIBUTING.md.
2. Is the CLA check green? If not, the bot has already told them what to do.
3. Is CI green?
4. Read the change. Check it against [AGENTS.md](../AGENTS.md). For anything
   people see, ask for screenshots in both themes.
5. Try it: `gh pr checkout <number>`, then run the app.
6. Ask for changes in a review comment, or approve and squash-merge.

Be quick to answer, even just "thanks, I'll look this week". A contributor
who hears nothing doesn't come back.

## Issues

- New issues get a **triage** label. Look at them every few days: add the
  app label (`slides`, `docs`, `sheets`, `whiteboard`), `bug` or
  `idea`, and remove `triage`.
- `good first issue` marks small, clear tasks for newcomers.
- Put what you will do in a milestone (`0.9.1`, `0.10`). The milestone page
  is the short-term plan; [ROADMAP.md](../ROADMAP.md) is the long-term one.
- Close what you won't do, with one kind sentence saying why.
- Thumbs-up reactions on issues are the cheapest demand signal there is.
  Sort issues by them before planning a release.

## Releasing a version

1. On `main`, with CI green, set the version everywhere (the four apps and
   the four MCP servers):

   ```sh
   node scripts/release-version.mjs --set 0.9.1
   git commit -am "Version 0.9.1"
   git push
   ```

2. Tag it and push the tag. This starts the Release robot (about 30
   minutes):

   ```sh
   git tag v0.9.1
   git push origin v0.9.1
   ```

3. Open **Releases**. The draft has every installer (4 apps × Windows,
   macOS Apple silicon, macOS Intel, Linux AppImage, Linux deb) and notes
   written from the merged pull requests. Install one or two and open a file.
   Edit the notes: a few lines on what changed, in plain words.
4. Press **Publish release**. Within a day, every installed app shows
   "Version 0.9.1 is out" on Home.

If the robot fails, open the failed run in **Actions**, fix the problem on a
branch, merge it, delete the tag (`git tag -d v0.9.1` and
`git push origin :refs/tags/v0.9.1`) and tag again.

Version numbers: the last number for fixes (`0.9.1`), the middle one for new
features (`0.10.0`), the first one at 1.0, when Fenna is something you'd
recommend to anyone without warning them first.

## Measuring demand

```sh
node scripts/downloads.mjs
```

prints downloads per app and per system, from GitHub's own counts. Watch it
alongside stars, issues opened by people you don't know, and the thumbs-up
on ideas.

## Legal, in short

- **License:** the code is AGPL-3.0. Anyone may use and change it, but a
  changed version offered to others, including as a web service, must be
  shared under the AGPL too. Companies that don't want that buy a
  commercial license from Sidhilynx; the CLA is what lets Sidhilynx sell one
  that includes contributors' code.
- **CLA:** adapted from the Apache Software Foundation's, which most
  company-backed open-source projects use. Contributors keep their
  copyright and give Sidhilynx a license. Never change the meaning of a
  signed version; publish a new version number instead.
- **Name:** "Fenna" is a trademark by use, not registered.
  [TRADEMARKS.md](../TRADEMARKS.md) says how others may use it. Register it
  once the product earns money.
- **Have a lawyer look** at the CLA and the commercial license before you
  sign the first commercial deal. Until then the standard texts are a
  reasonable footing.
