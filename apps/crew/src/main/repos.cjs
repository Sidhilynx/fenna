// A bot's repositories: its own git clones in Files/Repos/<name>. The person
// links a folder on their computer or a URL (the bot asks, the person
// approves) and Crew clones it there, so the bot's work never touches the
// person's checkout and two bots never share a working copy.
//
// While a bot has a repo, its runs are coding runs: its brain's own tools
// (shell, read, edit) work inside Files/Repos, within the limits in
// codingFor() and checkTool(). Git credentials are off for the brain, so a
// bot commits on its own but only push(), after the person approves, sends
// work anywhere: to a new branch in the folder it came from, or to that
// folder's own remote. Never a force push, and never to the branch the
// source has checked out or its default branch.

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const BRANCH_RE = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9._/-]{1,120}(?<![./])$/;
const GIT_MS = 10 * 60_000;
const OUT_MAX = 16 * 1024;
const PROTECTED = new Set(["main", "master", "trunk", "develop", "release"]);
const SOURCE = "source";
const ORIGIN = "origin";
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead"]);
const WRITE_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const FREE_TOOLS = new Set(["TodoWrite", "ExitPlanMode"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const NO_TOOLS = { WebFetch: "Use your own browser to read web pages.", WebSearch: "Use your own browser to search.", Task: "Do the work yourself, or hand it to another bot with message_bot.", Agent: "Do the work yourself, or hand it to another bot with message_bot." };
// What a shell command may not do: send work anywhere, or change where git sends it.
const GIT_BLOCKED = /\bgit(?:\.exe)?\b[^\n]*?\s(push|remote|credential|send-email|daemon)\b|\bgit(?:\.exe)?\b[^\n]*?\sconfig\b[^\n]*?\b(credential|url\.|remote\.|core\.hooksPath|core\.sshCommand|include)/i;
const GH_BLOCKED = /\bgh(?:\.exe)?\s+(pr\s+(create|merge)|release|repo\s+(create|delete|edit)|api|auth|secret)/i;
// The brain's git reads only the bot's own settings file (gitConfigText): no system or person's
// settings, so no credential helper, and commits carry the bot's name. Prompts are off.
const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_CONFIG_NOSYSTEM: "1" };

/** The bot's git settings: its name on commits, and no credential helper. */
function gitConfigText(name, slug) {
  const safe = String(name || slug).replace(/["\\\r\n[\]]/g, "").trim().slice(0, 60) || slug;
  return ["[user]", `\tname = ${safe} (Fenna Crew)`, `\temail = ${slug}@bots.fenna.invalid`, "[credential]", "\thelper =", "[core]", "\tautocrlf = false", ""].join("\n");
}

/** A repo's name on the bot's disk: letters, digits, dashes, dots, underscores. */
function repoName(v) {
  const name = typeof v === "string" ? v.trim() : "";
  if (!NAME_RE.test(name) || name.endsWith(".") || name.endsWith(".git")) throw new Error(`Name the repo with letters, digits, dashes, dots or underscores, like "site". It lives in Files/Repos/<name>.`);
  return name;
}

/** The name a source suggests: the folder's or the URL's last part, without .git. */
function nameFrom(source) {
  const last = String(source).replace(/[\\/]+$/, "").split(/[\\/:]/).pop() || "";
  const clean = last.replace(/\.git$/i, "").replace(/[^A-Za-z0-9_.-]/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 64);
  return clean || "repo";
}

/** A URL Crew clones: https, ssh or git@host:path. Never file:, ext:: or a local path in disguise. */
function cloneUrl(v) {
  const url = typeof v === "string" ? v.trim() : "";
  if (/^https:\/\/[^\s]+$/i.test(url) || /^ssh:\/\/[^\s]+$/i.test(url) || /^git@[A-Za-z0-9.-]+:[^\s]+$/.test(url)) return url;
  throw new Error("Give an https or ssh address, like https://github.com/owner/repo. For a folder on this computer, use link.");
}

function branchName(v) {
  const b = typeof v === "string" ? v.trim() : "";
  if (!BRANCH_RE.test(b) || b.endsWith(".lock")) throw new Error(`"${b.slice(0, 60)}" isn't a branch name git takes. Use letters, digits, dashes, dots and slashes, like fenna/fix-login.`);
  return b;
}

/** Whether `p` is `dir` or inside it (both absolute). */
function inside(dir, p) {
  const rel = path.relative(dir, p);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** Whether `p` is inside a .git folder (git's own data: hooks, config). */
const inGitData = (dir, p) => path.relative(dir, p).split(/[\\/]/).includes(".git");

/**
 * The decision for one of the brain's own tool calls in a coding run (Claude
 * Code asks this through approve_tool). `ask` means the person decides.
 * @returns {{ allow: true } | { deny: string } | { ask: { action: string, details: string, key: string } }}
 */
function checkTool(dir, tool, input) {
  const name = String(tool || "");
  const args = input && typeof input === "object" ? input : {};
  if (NO_TOOLS[name]) return { deny: NO_TOOLS[name] };
  if (FREE_TOOLS.has(name)) return { allow: true };
  const target = [args.file_path, args.notebook_path, args.path].find((v) => typeof v === "string" && v);
  const abs = target ? path.resolve(dir, target) : dir;
  if (READ_TOOLS.has(name) || WRITE_TOOLS.has(name)) {
    if (!inside(dir, abs)) return { deny: `${target} is outside your repos. You work in Files/Repos (${dir}); use read_file for the rest of your disk.` };
    if (WRITE_TOOLS.has(name) && inGitData(dir, abs)) return { deny: "Git's own folder (.git) can't be changed. Use git commands for commits and branches." };
    return { allow: true };
  }
  if (SHELL_TOOLS.has(name)) {
    const cmd = typeof args.command === "string" ? args.command.trim() : "";
    if (!cmd) return { deny: "Say the command to run." };
    if (GIT_BLOCKED.test(cmd)) return { deny: "Pushing, remotes, credentials and hooks go through Crew: commit here, then call repo {action: \"push\"} and the person approves it." };
    if (GH_BLOCKED.test(cmd)) return { deny: "Pull requests, releases and GitHub settings go through the GitHub connector or repo push, with the person's approval." };
    const program = programOf(cmd);
    return { ask: { action: `Run ${program} in Files/Repos`, details: `The command: ${cmd.slice(0, 600)}\n\nIt runs as you on this computer, in ${dir}. Always lets ${program} run in your bot's repos without asking.`, key: program } };
  }
  return { ask: { action: `Use ${name}`, details: JSON.stringify(args).slice(0, 600), key: name } };
}

/** The program a shell command starts with, lowercased and without its folder or .exe: "npm", "flutter", "python". */
function programOf(cmd) {
  const first = String(cmd).trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "").split(/\s+/)[0] || "";
  return path.basename(first.replace(/^["'&]+|["']+$/g, "")).replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase() || "command";
}

/**
 * @param {object} o
 * @param {ReturnType<import("./disk.cjs").createDisk>} o.disk
 * @param {ReturnType<import("./store.cjs").createStore>} o.store
 * @param {(ctx: object, a: { action: string, details: string, source: string, tool: string|null }) => Promise<{ allowed: boolean, always: boolean, by: string }>} o.approve
 * @param {(channel: string, payload: unknown) => void} [o.broadcast]
 * @param {(args: string[], opts: { cwd?: string, env?: object }) => Promise<{ code: number, out: string }>} [o.git]  runs git (tests put a fake here)
 */
function createRepos({ disk, store, approve, broadcast = () => {}, git = runGit }) {
  const rootOf = (slug) => disk.locate(slug, "Files/Repos").abs;
  const dirOf = (slug, name) => path.join(rootOf(slug), repoName(name));
  const settingsFile = (slug) => path.join(store.botDir(slug), "repos.json");

  /** The bot's repo settings: programs allowed always, the unsandboxed-shell grant, and where each repo came from. */
  function settings(slug) {
    let v = {};
    try {
      v = JSON.parse(fs.readFileSync(settingsFile(slug), "utf8")) || {};
    } catch {
      v = {};
    }
    const repos = {};
    for (const [n, r] of Object.entries(v.repos && typeof v.repos === "object" ? v.repos : {})) {
      if (!NAME_RE.test(n) || !r || typeof r !== "object") continue;
      repos[n] = { source: typeof r.source === "string" ? r.source : null, origin: typeof r.origin === "string" ? r.origin : null };
    }
    return { programs: Array.isArray(v.programs) ? v.programs.filter((x) => typeof x === "string") : [], shell: v.shell === true, repos };
  }

  function setRepo(slug, name, where) {
    const s = settings(slug);
    if (where) s.repos[name] = where;
    else delete s.repos[name];
    saveSettings(slug, s);
  }

  function saveSettings(slug, s) {
    const file = settingsFile(slug);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`);
    fs.renameSync(tmp, file);
  }

  /** The bot's repos: each folder in Files/Repos that is a git repository. */
  function names(slug) {
    let root;
    try {
      root = rootOf(slug);
    } catch {
      return [];
    }
    if (!fs.existsSync(root)) return [];
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && NAME_RE.test(d.name) && fs.existsSync(path.join(root, d.name, ".git")))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  async function g(dir, args, what) {
    const r = await git(args, { cwd: dir });
    if (r.code !== 0) throw new Error(`${what} failed: ${tail(r.out) || `git exited with ${r.code}`}`);
    return r.out.trim();
  }

  const quiet = async (dir, args) => {
    const r = await git(args, { cwd: dir });
    return r.code === 0 ? r.out.trim() : "";
  };

  function existing(slug, name) {
    const dir = dirOf(slug, name);
    if (!fs.existsSync(path.join(dir, ".git"))) {
      const have = names(slug);
      throw new Error(`There is no repo "${name}". Your repos: ${have.join(", ") || "none yet"}. The person links one, or you ask with repo {action: "link"} or {action: "clone"}.`);
    }
    return dir;
  }

  function freshTarget(slug, name) {
    const dir = dirOf(slug, name);
    if (fs.existsSync(dir)) throw new Error(`Files/Repos/${name} already exists. Pick another name with name: "...".`);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    return dir;
  }

  async function ask(ctx, action, details) {
    const r = await approve(ctx, { action, details, source: "repo", tool: null });
    if (r.allowed) return r;
    if (r.by === "timeout") throw new Error("The person didn't answer in time, so nothing was done. Say in your reply that it waits for their approval.");
    if (r.by === "stopped") throw new Error("The run was stopped before the person answered.");
    throw new Error("Denied by the person. Don't try again or another way; say in your reply that it was not approved.");
  }

  /**
   * The clone keeps no remote URL: the bot's own git has nowhere to push. Crew
   * keeps where it came from and fetches into refs/remotes/<source|origin>/.
   */
  async function detach(dir, remote) {
    await quiet(dir, ["config", "--unset-all", `remote.${remote}.url`]);
    await quiet(dir, ["config", "--unset-all", `remote.${remote}.pushurl`]);
  }

  /** Fetch a source's branches into refs/remotes/<remote>/ with the person's git. */
  async function fetchFrom(dir, remote, url) {
    await g(dir, ["fetch", "--no-tags", "--prune", url, `+refs/heads/*:refs/remotes/${remote}/*`], `Fetching from ${url}`);
  }

  /** Link a git folder on the person's computer: Crew clones it into Files/Repos/<name> and remembers the folder (and its origin) as where it came from. */
  async function link(ctx, p) {
    const src = typeof p.path === "string" ? p.path.trim() : "";
    if (!src || !path.isAbsolute(src)) throw new Error("Give the folder's full path on this computer, like D:\\code\\my-app or /home/me/my-app.");
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new Error(`There is no folder at ${src}. Ask the person for the right path.`);
    const top = await quiet(src, ["rev-parse", "--show-toplevel"]);
    if (!top) throw new Error(`${src} isn't a git repository. Ask the person to run git init there, or to give the repository's folder.`);
    const name = repoName(p.name ?? nameFrom(top));
    const dir = freshTarget(ctx.slug, name);
    const upstream = await quiet(top, ["remote", "get-url", ORIGIN]);
    await ask(ctx, `Work on a copy of ${top}`, `Crew copies the repository into the bot's Files/Repos/${name}. The bot works and commits only in its copy; your folder isn't changed. Sending its branches back to your folder${upstream ? ` or to ${upstream}` : ""} asks you each time.`);
    await g(path.dirname(dir), ["clone", "--origin", SOURCE, "--no-hardlinks", top, dir], "Copying the repository");
    await detach(dir, SOURCE);
    setRepo(ctx.slug, name, { source: top, origin: upstream || null });
    broadcast("crew:disk", { slug: ctx.slug });
    return { text: `Linked ${top} as Files/Repos/${name}.\n${await summary(dir)}\nWork there with your own tools; commit, then repo {action: "push", name: "${name}", branch: "..."} sends a branch back after the person approves.` };
  }

  /** Clone a URL into Files/Repos/<name>, with the URL as origin. Crew runs the clone with the person's git, so private repos they can read work. */
  async function clone(ctx, p) {
    const url = cloneUrl(p.url);
    const name = repoName(p.name ?? nameFrom(url));
    const dir = freshTarget(ctx.slug, name);
    await ask(ctx, `Clone ${url}`, `Crew clones it into the bot's Files/Repos/${name} with your git sign-in. The bot works and commits only there; pushing asks you each time.`);
    await g(path.dirname(dir), ["clone", "--", url, dir], "Cloning");
    await detach(dir, ORIGIN);
    setRepo(ctx.slug, name, { source: null, origin: url });
    broadcast("crew:disk", { slug: ctx.slug });
    return { text: `Cloned ${url} as Files/Repos/${name}.\n${await summary(dir)}` };
  }

  async function summary(dir) {
    const branch = (await quiet(dir, ["rev-parse", "--abbrev-ref", "HEAD"])) || "(no commits yet)";
    const changed = (await quiet(dir, ["status", "--porcelain"])).split("\n").filter(Boolean);
    const last = await quiet(dir, ["log", "-1", "--format=%h %s"]);
    return `Branch ${branch}${last ? `, last commit ${last}` : ""}. ${changed.length ? `${changed.length} changed file(s) not committed.` : "Nothing uncommitted."}`;
  }

  /** Where a push or sync goes (source by default, origin when asked or when there is no source), its URL, and the branches it must not overwrite. */
  async function target(slug, name, dir, to) {
    const where = settings(slug).repos[name] || { source: null, origin: null };
    const remote = to === ORIGIN || (to === undefined && !where.source) ? ORIGIN : SOURCE;
    const url = remote === ORIGIN ? where.origin : where.source;
    if (!url) throw new Error(remote === ORIGIN ? "This repo has no origin to push to. Push to the source folder with to: \"source\"." : "This repo has no source folder. Push to origin with to: \"origin\".");
    let checkedOut = "";
    if (remote === SOURCE && fs.existsSync(url)) checkedOut = await quiet(url, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const symref = await quiet(dir, ["ls-remote", "--symref", url, "HEAD"]);
    const m = /^ref:\s+refs\/heads\/(\S+)\s+HEAD/m.exec(symref);
    return { remote, url, checkedOut, defaultBranch: m ? m[1] : "" };
  }

  /** Bring the source's (or origin's) branches into refs/remotes/<remote>/, so the bot can merge or rebase on them. */
  async function sync(ctx, p) {
    const name = repoName(p.name);
    const dir = existing(ctx.slug, name);
    const t = await target(ctx.slug, name, dir, p.to);
    await fetchFrom(dir, t.remote, t.url);
    const branches = (await quiet(dir, ["for-each-ref", "--format=%(refname:short)", `refs/remotes/${t.remote}/`])).split("\n").filter(Boolean);
    return { text: `Fetched ${branches.length} branch(es) from ${t.url} into ${t.remote}/: ${branches.slice(0, 30).join(", ") || "none"}${t.defaultBranch ? `. Its main branch is ${t.remote}/${t.defaultBranch}.` : "."}` };
  }

  /** Send one of the bot's branches to the source folder or its origin, as a new or fast-forwarded branch there. Asks every time. */
  async function push(ctx, p) {
    const name = repoName(p.name);
    const dir = existing(ctx.slug, name);
    const branch = branchName(p.branch ?? (await g(dir, ["rev-parse", "--abbrev-ref", "HEAD"], "Reading the branch")));
    const local = await quiet(dir, ["rev-parse", "--verify", `refs/heads/${branch}`]);
    if (!local) throw new Error(`There is no branch ${branch} in Files/Repos/${name}. Commit on a branch first, like git switch -c fenna/fix-login.`);
    const t = await target(ctx.slug, name, dir, p.to);
    if (PROTECTED.has(branch) || branch === t.defaultBranch || branch === t.checkedOut) {
      throw new Error(`Crew doesn't push to ${branch}: it is ${branch === t.checkedOut ? "the branch the person has checked out" : "a main branch"}. Make a branch of your own, like fenna/${branch === "main" ? "my-change" : branch}, and push that.`);
    }
    const base = t.defaultBranch && (await quiet(dir, ["rev-parse", "--verify", `refs/remotes/${t.remote}/${t.defaultBranch}`])) ? `${t.remote}/${t.defaultBranch}` : "";
    const commits = await quiet(dir, ["log", "--format=%h %s", "-20", base ? `${base}..${branch}` : branch]);
    await ask(ctx, `Push ${branch} to ${t.remote === ORIGIN ? t.url : `your folder ${t.url}`}`, `${commits ? `Commits:\n${commits}` : "No new commits."}\n\nIt makes or updates the branch ${branch} there. It never force-pushes.`);
    // Crew's push, not the brain's: the person's git and credentials.
    await g(dir, ["push", "--no-verify", t.url, `refs/heads/${branch}:refs/heads/${branch}`], "Pushing");
    await quiet(dir, ["update-ref", `refs/remotes/${t.remote}/${branch}`, local]);
    return { text: `Pushed ${branch} to ${t.remote} (${t.url}).${t.remote === ORIGIN ? " Open a pull request with the GitHub connector if you have it, or ask the person to." : ""}` };
  }

  /** The bot's repos with their branch and state. */
  async function list(slug) {
    const all = names(slug);
    if (!all.length) return { text: "No repos yet. Ask the person which folder or URL to work on, then repo {action: \"link\", path} or {action: \"clone\", url}." };
    const lines = [];
    for (const n of all) lines.push(`Files/Repos/${n}: ${await summary(dirOf(slug, n))}`);
    return { text: lines.join("\n") };
  }

  async function status(slug, p) {
    const name = repoName(p.name);
    const dir = existing(slug, name);
    const where = settings(slug).repos[name] || { source: null, origin: null };
    const st = await quiet(dir, ["status", "--short", "--branch"]);
    const sends = [where.source ? `source: ${where.source}` : "", where.origin ? `origin: ${where.origin}` : ""].filter(Boolean);
    return { text: `Files/Repos/${name}\n${st || "(empty)"}\n\nPush and sync go to (through repo, after approval):\n${sends.join("\n") || "nowhere: this repo has no source or origin"}` };
  }

  /** Take a repo off the bot's disk (to Trash). Its pushed branches stay where they went. */
  async function remove(ctx, p) {
    const name = repoName(p.name);
    existing(ctx.slug, name);
    const st = await quiet(dirOf(ctx.slug, name), ["status", "--porcelain"]);
    if (st && p.force !== true) throw new Error(`Files/Repos/${name} has uncommitted changes. Commit them, or call remove with force: true to throw them away too.`);
    disk.op(ctx.slug, { op: "trash", paths: [`Files/Repos/${name}`] });
    setRepo(ctx.slug, name, null);
    return { text: `Moved Files/Repos/${name} to Trash.` };
  }

  /**
   * The coding limits for a run, or null when its own tools stay off: no repo,
   * or a brain whose sandbox can't keep commands in the folder on this system
   * (Antigravity on Windows) until the person allows an unsandboxed shell.
   */
  function codingFor(slug, cli = "") {
    if (!names(slug).length) return null;
    if (!sandboxed(cli) && !settings(slug).shell) return null;
    const file = path.join(store.botDir(slug), "gitconfig");
    const r = store.readBot(slug);
    const text = gitConfigText(r && r.bot ? r.bot.name : slug, slug);
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text);
    return { dir: rootOf(slug), env: { ...GIT_ENV, GIT_CONFIG_GLOBAL: file } };
  }

  /** Let the bot's own shell run without a sandbox (only for brains that can't sandbox here). Asks the person; kept until they take it back. */
  async function allowShell(ctx) {
    if (settings(ctx.slug).shell) return { text: "Your own shell is already allowed in Files/Repos." };
    await ask(ctx, "Let the bot run its own commands in its repos without a sandbox", "On this computer, this bot's AI can't keep its commands inside Files/Repos. Its commands run as you, with your access to your files and network. Allow it only for repos you trust. It applies from the next message.");
    const s = settings(ctx.slug);
    saveSettings(ctx.slug, { ...s, shell: true });
    return { text: "Allowed. From the next message, your own shell works in Files/Repos." };
  }

  return {
    names,
    codingFor,
    /** The repo tool. */
    async handle(ctx, p) {
      const action = String(p.action ?? "");
      if (action === "list") return list(ctx.slug);
      if (action === "status") return status(ctx.slug, p);
      if (action === "link") return link(ctx, p);
      if (action === "clone") return clone(ctx, p);
      if (action === "push") return push(ctx, p);
      if (action === "sync") return sync(ctx, p);
      if (action === "allow_shell") return allowShell(ctx);
      if (action === "remove") return remove(ctx, p);
      throw new Error(`Use the action list, status, link, clone, sync, push, remove or allow_shell, not "${action.slice(0, 20)}".`);
    },

    /** One of the brain's own tool calls (Claude Code's approve_tool): allowed, refused with why, or the person's decision. */
    async checkTool(ctx, p) {
      const coding = codingFor(ctx.slug);
      if (!coding) return { behavior: "deny", message: "You have no repo, so your own tools are off. Use Crew's tools." };
      const d = checkTool(coding.dir, p.tool_name, p.input);
      if (d.allow) return { behavior: "allow", updatedInput: p.input ?? {} };
      if (d.deny) return { behavior: "deny", message: d.deny };
      if (settings(ctx.slug).programs.includes(d.ask.key)) return { behavior: "allow", updatedInput: p.input ?? {} };
      const r = await approve(ctx, { action: d.ask.action, details: d.ask.details, source: "repo", tool: d.ask.key });
      if (!r.allowed) return { behavior: "deny", message: r.by === "person" ? "Denied by the person. Don't try it another way." : "Not approved in time. Say it waits for the person." };
      if (r.always) {
        const s = settings(ctx.slug);
        saveSettings(ctx.slug, { ...s, programs: [...new Set([...s.programs, d.ask.key])] });
      }
      return { behavior: "allow", updatedInput: p.input ?? {} };
    },
  };
}

const tail = (s) => String(s || "").trim().slice(-600);

/**
 * Whether a brain's own sandbox keeps its commands in the folder here. Claude
 * Code asks Crew about each command (approve_tool); Codex uses its elevated
 * sandbox on Windows; Antigravity's sandbox doesn't hold on Windows (tested:
 * its git push reached a folder outside).
 */
function sandboxed(cli, platform = process.platform) {
  return !(cli === "antigravity" && platform === "win32");
}

/** Runs the person's git, with no prompts, and returns its exit code and output. */
function runGit(args, { cwd, env = {} } = {}) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = childProcess.spawn("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env }, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ code: -1, out: `Git isn't installed on this computer (${e.message}). The person can install it from git-scm.com.` });
      return;
    }
    const add = (b) => {
      out += b.toString("utf8");
      if (out.length > OUT_MAX * 4) out = out.slice(-OUT_MAX * 4);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => child.kill(), GIT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out: e.code === "ENOENT" ? "Git isn't installed on this computer. The person can install it from git-scm.com." : e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out: out.slice(-OUT_MAX) });
    });
  });
}

module.exports = { createRepos, checkTool, programOf, repoName, nameFrom, cloneUrl, branchName, gitConfigText, sandboxed, GIT_ENV };
