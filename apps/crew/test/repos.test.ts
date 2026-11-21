import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests run real git, which is slow when the whole suite runs at once.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const require = createRequire(import.meta.url);
const { createDisk } = require("../src/main/disk.cjs");
const { createStore } = require("../src/main/store.cjs");
const { createRepos, checkTool, programOf, repoName, nameFrom, cloneUrl, branchName, gitConfigText, sandboxed } = require("../src/main/repos.cjs");

const SLUG = "research";
const CTX = { slug: SLUG, runId: "r1" };
const UPSTREAM = "https://example.com/owner/repo.git";
const YES = { allowed: true, always: false, by: "person" };
const DENY = { allowed: false, always: false, by: "person" };

let root: string;
let approve: ReturnType<typeof vi.fn>;
let disk: ReturnType<typeof createDisk>;
let repos: ReturnType<typeof createRepos>;

/** Runs git in a folder with a test identity, and returns its trimmed output. Throws when git fails. */
function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@e", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A git repository with one commit on main, holding README.md. */
function makeRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  gitIn(dir, "init", "-b", "main");
  gitIn(dir, "config", "core.autocrlf", "false");
  writeFileSync(path.join(dir, "README.md"), "# hello\n");
  gitIn(dir, "add", "README.md");
  gitIn(dir, "commit", "-m", "first");
  return dir;
}

/** A source folder on the person's computer, outside the bot's disk. */
function sourceRepo(name = "my-app"): string {
  return makeRepo(path.join(root, name));
}

/** A bare repository on this computer, standing in for a remote. */
function bareRepo(name: string): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  gitIn(dir, "init", "--bare", "-b", "main");
  return dir;
}

const reposRoot = () => disk.locate(SLUG, "Files/Repos").abs;
const copyOf = (name = "my-app") => path.join(reposRoot(), name);
const reposFile = () => path.join(root, "bots", SLUG, "repos.json");
const readRepos = () => JSON.parse(readFileSync(reposFile(), "utf8"));

/** Links a new source folder as the bot's repo, and clears the approval calls that linking made. */
async function linkSource(name = "my-app"): Promise<string> {
  const dir = sourceRepo(name);
  await repos.handle(CTX, { action: "link", path: dir, name });
  approve.mockClear();
  return dir;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crew-repos-test-"));
  mkdirSync(path.join(root, "bots", SLUG), { recursive: true });
  writeFileSync(path.join(root, "bots", SLUG, "bot.md"), "---\nname: Research\n---\n");
  const store = createStore(root);
  disk = createDisk({ store, starterFiles: () => ({}), settingsFile: path.join(root, "quotas.json") });
  approve = vi.fn().mockResolvedValue(YES);
  repos = createRepos({ disk, store, approve });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("repo tool: list and codingFor with no repos", () => {
  it("says there are no repos yet, and the bot has no coding limits", async () => {
    const r = await repos.handle(CTX, { action: "list" });
    expect(r.text).toContain("No repos yet");
    expect(repos.codingFor(SLUG)).toBeNull();
    expect(repos.codingFor(SLUG, "antigravity")).toBeNull();
    expect(approve).not.toHaveBeenCalled();
  });
});

describe("repo tool: link", () => {
  it("copies the folder into Files/Repos, remembers the folder, and leaves the clone with no remote URL", async () => {
    const dir = sourceRepo();
    const top = gitIn(dir, "rev-parse", "--show-toplevel");
    const headBefore = gitIn(dir, "rev-parse", "--abbrev-ref", "HEAD");

    const r = await repos.handle(CTX, { action: "link", path: dir });

    expect(approve).toHaveBeenCalledTimes(1);
    expect(r.text).toContain("Linked");
    const copy = copyOf();
    expect(existsSync(path.join(copy, ".git"))).toBe(true);
    expect(() => gitIn(copy, "config", "--get", "remote.source.url")).toThrow();
    expect(gitIn(copy, "remote", "-v")).not.toContain(top);
    expect(readRepos().repos["my-app"]).toEqual({ source: top, origin: null });
    expect(repos.names(SLUG)).toEqual(["my-app"]);

    expect(gitIn(dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe(headBefore);
    expect(gitIn(dir, "status", "--porcelain")).toBe("");
    expect(readFileSync(path.join(dir, "README.md"), "utf8")).toBe("# hello\n");
  });

  it("remembers the source's origin URL, without adding it to the clone", async () => {
    const dir = sourceRepo();
    gitIn(dir, "remote", "add", "origin", UPSTREAM);

    await repos.handle(CTX, { action: "link", path: dir });

    expect(readRepos().repos["my-app"].origin).toBe(UPSTREAM);
    expect(() => gitIn(copyOf(), "remote", "get-url", "origin")).toThrow();
  });

  it("a clone has no remote to push to, so a bare git push fails", async () => {
    await linkSource();
    expect(() => gitIn(copyOf(), "push")).toThrow();
  });

  it("reports where the repo came from in status", async () => {
    const dir = await linkSource();
    const top = gitIn(dir, "rev-parse", "--show-toplevel");
    const r = await repos.handle(CTX, { action: "status", name: "my-app" });
    expect(r.text).toContain(`source: ${top}`);
  });

  it("refuses a clone address that is not https, ssh or git@ before asking", async () => {
    await expect(repos.handle(CTX, { action: "clone", url: "file:///x" })).rejects.toThrow("https or ssh address");
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses a relative path", async () => {
    await expect(repos.handle(CTX, { action: "link", path: "my-app" })).rejects.toThrow("full path");
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses a folder that does not exist", async () => {
    await expect(repos.handle(CTX, { action: "link", path: path.join(root, "nope") })).rejects.toThrow("There is no folder at");
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses a folder that is not a git repository", async () => {
    const plain = path.join(root, "plain");
    mkdirSync(plain);
    await expect(repos.handle(CTX, { action: "link", path: plain })).rejects.toThrow("isn't a git repository");
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses a name that is already taken, without asking", async () => {
    await linkSource("taken");
    const other = sourceRepo("other");
    await expect(repos.handle(CTX, { action: "link", path: other, name: "taken" })).rejects.toThrow("already exists");
    expect(approve).not.toHaveBeenCalled();
  });

  it("creates nothing in Files/Repos when the person denies it", async () => {
    approve.mockResolvedValueOnce(DENY);
    const dir = sourceRepo();
    await expect(repos.handle(CTX, { action: "link", path: dir })).rejects.toThrow("Denied");
    expect(existsSync(copyOf())).toBe(false);
    expect(repos.names(SLUG)).toEqual([]);
    const entries = existsSync(reposRoot()) ? readdirSync(reposRoot()) : [];
    expect(entries).toEqual([]);
  });

  it("says the person didn't answer in time, and creates nothing", async () => {
    approve.mockResolvedValueOnce({ allowed: false, always: false, by: "timeout" });
    const dir = sourceRepo();
    await expect(repos.handle(CTX, { action: "link", path: dir })).rejects.toThrow("didn't answer in time");
    expect(existsSync(copyOf())).toBe(false);
  });
});

describe("repo tool: push to the source folder", () => {
  it("creates the branch in the source and leaves its checkout and files alone", async () => {
    const dir = await linkSource();
    const copy = copyOf();
    gitIn(copy, "switch", "-c", "fenna/x");
    writeFileSync(path.join(copy, "notes.txt"), "hi\n");
    gitIn(copy, "add", "notes.txt");
    gitIn(copy, "commit", "-m", "add notes");

    const r = await repos.handle(CTX, { action: "push", name: "my-app", branch: "fenna/x" });

    expect(approve).toHaveBeenCalledTimes(1);
    expect(r.text).toContain("Pushed fenna/x");
    expect(gitIn(dir, "rev-parse", "--verify", "refs/heads/fenna/x")).toBe(gitIn(copy, "rev-parse", "HEAD"));
    expect(gitIn(dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(readFileSync(path.join(dir, "README.md"), "utf8")).toBe("# hello\n");
    expect(existsSync(path.join(dir, "notes.txt"))).toBe(false);
    expect(gitIn(dir, "status", "--porcelain")).toBe("");
  });
});

describe("repo tool: push to origin", () => {
  it("pushes the branch to the stored origin, a bare repository", async () => {
    const bare = bareRepo("upstream.git");
    const dir = sourceRepo();
    gitIn(dir, "remote", "add", "origin", bare);
    await repos.handle(CTX, { action: "link", path: dir, name: "my-app" });
    approve.mockClear();
    const copy = copyOf();
    gitIn(copy, "switch", "-c", "fenna/o");
    writeFileSync(path.join(copy, "o.txt"), "origin\n");
    gitIn(copy, "add", "o.txt");
    gitIn(copy, "commit", "-m", "to origin");

    const r = await repos.handle(CTX, { action: "push", name: "my-app", branch: "fenna/o", to: "origin" });

    expect(approve).toHaveBeenCalledTimes(1);
    expect(r.text).toContain("Pushed fenna/o to origin");
    expect(gitIn(bare, "rev-parse", "--verify", "refs/heads/fenna/o")).toBe(gitIn(copy, "rev-parse", "HEAD"));
  });
});

describe("repo tool: push refusals", () => {
  it("refuses to push main", async () => {
    await linkSource();
    await expect(repos.handle(CTX, { action: "push", name: "my-app", branch: "main" })).rejects.toThrow("doesn't push to main");
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses to push master", async () => {
    await linkSource();
    gitIn(copyOf(), "branch", "master");
    await expect(repos.handle(CTX, { action: "push", name: "my-app", branch: "master" })).rejects.toThrow("doesn't push to master");
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses the branch the source has checked out", async () => {
    const dir = await linkSource();
    gitIn(dir, "switch", "-c", "feature/live");
    gitIn(copyOf(), "branch", "feature/live");
    await expect(repos.handle(CTX, { action: "push", name: "my-app", branch: "feature/live" })).rejects.toThrow("the branch the person has checked out");
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses a branch that does not exist in the repo", async () => {
    await linkSource();
    await expect(repos.handle(CTX, { action: "push", name: "my-app", branch: "nope/x" })).rejects.toThrow("There is no branch nope/x");
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses to push to origin when the repo has none", async () => {
    await linkSource();
    gitIn(copyOf(), "branch", "fenna/x");
    await expect(repos.handle(CTX, { action: "push", name: "my-app", branch: "fenna/x", to: "origin" })).rejects.toThrow("no origin to push to");
    expect(approve).not.toHaveBeenCalled();
  });

  it("leaves the source without the branch when the person denies the push", async () => {
    const dir = await linkSource();
    gitIn(copyOf(), "branch", "fenna/y");
    approve.mockResolvedValueOnce(DENY);
    await expect(repos.handle(CTX, { action: "push", name: "my-app", branch: "fenna/y" })).rejects.toThrow("Denied");
    expect(gitIn(dir, "branch", "--list", "fenna/y")).toBe("");
  });
});

describe("repo tool: sync", () => {
  it("fetches the source's new branch into refs/remotes/source in the clone", async () => {
    const dir = await linkSource();
    gitIn(dir, "switch", "-c", "fenna/s");
    writeFileSync(path.join(dir, "s.txt"), "new\n");
    gitIn(dir, "add", "s.txt");
    gitIn(dir, "commit", "-m", "new branch");
    const tip = gitIn(dir, "rev-parse", "HEAD");
    gitIn(dir, "switch", "main");

    const r = await repos.handle(CTX, { action: "sync", name: "my-app" });

    expect(r.text).toContain("source/fenna/s");
    expect(gitIn(copyOf(), "rev-parse", "--verify", "refs/remotes/source/fenna/s")).toBe(tip);
  });
});

describe("repo tool: remove", () => {
  it("refuses uncommitted changes unless force is set, and keeps the folder", async () => {
    await linkSource();
    const copy = copyOf();
    writeFileSync(path.join(copy, "dirty.txt"), "unsaved\n");

    await expect(repos.handle(CTX, { action: "remove", name: "my-app" })).rejects.toThrow("uncommitted changes");
    expect(existsSync(copy)).toBe(true);
    expect(repos.names(SLUG)).toEqual(["my-app"]);
  });

  it("with force, moves the folder to Trash and drops its entry in repos.json", async () => {
    await linkSource();
    const copy = copyOf();
    writeFileSync(path.join(copy, "dirty.txt"), "unsaved\n");

    const r = await repos.handle(CTX, { action: "remove", name: "my-app", force: true });

    expect(r.text).toContain("Trash");
    expect(existsSync(copy)).toBe(false);
    expect(repos.names(SLUG)).toEqual([]);
    expect(readdirSync(path.join(root, "bots", SLUG, "trash"))).toContain("my-app");
    expect(readRepos().repos["my-app"]).toBeUndefined();
  });
});

describe("codingFor and the sandbox", () => {
  it("gives the bot's folder and its own git settings, with no credential helper", async () => {
    await linkSource();
    const coding = repos.codingFor(SLUG);
    expect(coding).not.toBeNull();
    expect(coding.dir).toBe(reposRoot());
    expect(coding.env.GIT_CONFIG_NOSYSTEM).toBe("1");
    const config = readFileSync(coding.env.GIT_CONFIG_GLOBAL, "utf8");
    expect(config).toContain("helper =");
    expect(config).toContain("(Fenna Crew)");
  });

  it.skipIf(process.platform !== "win32")("keeps Antigravity's own tools off on Windows until a shell is allowed", async () => {
    await linkSource();
    expect(repos.codingFor(SLUG, "antigravity")).toBeNull();
    approve.mockResolvedValueOnce(YES);
    await repos.handle(CTX, { action: "allow_shell" });
    expect(repos.codingFor(SLUG, "antigravity")).not.toBeNull();
  });

  it("is sandboxed everywhere except Antigravity on Windows", () => {
    expect(sandboxed("antigravity", "win32")).toBe(false);
    expect(sandboxed("antigravity", "linux")).toBe(true);
    expect(sandboxed("antigravity", "darwin")).toBe(true);
    expect(sandboxed("claude", "win32")).toBe(true);
    expect(sandboxed("", "win32")).toBe(true);
  });
});

describe("repo tool: allow_shell", () => {
  it.skipIf(process.platform !== "win32")("stays off when the person denies it", async () => {
    await linkSource();
    approve.mockResolvedValueOnce(DENY);
    await expect(repos.handle(CTX, { action: "allow_shell" })).rejects.toThrow("Denied");
    expect(readRepos().shell).not.toBe(true);
    expect(repos.codingFor(SLUG, "antigravity")).toBeNull();
  });

  it("is kept once approved, and a second call says it is already allowed without asking", async () => {
    await linkSource();
    approve.mockResolvedValueOnce(YES);

    const first = await repos.handle(CTX, { action: "allow_shell" });
    expect(first.text).toContain("Allowed");
    expect(readRepos().shell).toBe(true);
    expect(approve).toHaveBeenCalledTimes(1);

    const second = await repos.handle(CTX, { action: "allow_shell" });
    expect(second.text).toContain("already allowed");
    expect(approve).toHaveBeenCalledTimes(1);
  });
});

describe("checkTool: the brain's own tools", () => {
  const dir = path.resolve(tmpdir(), "crew-repos-checktool");

  it("allows reads and writes inside the repo, including folders whose names start with two dots", () => {
    expect(checkTool(dir, "Read", { file_path: path.join(dir, "src", "a.ts") })).toEqual({ allow: true });
    expect(checkTool(dir, "Write", { file_path: path.join(dir, "new.txt") })).toEqual({ allow: true });
    expect(checkTool(dir, "Read", { file_path: path.join(dir, "..cache", "x.txt") })).toEqual({ allow: true });
  });

  it("refuses reads outside the repo, and writes into .git", () => {
    expect(checkTool(dir, "Read", { file_path: path.join(dir, "..", "x") })).toHaveProperty("deny");
    expect(checkTool(dir, "Read", { file_path: path.join(homedir(), ".ssh", "id_rsa") })).toHaveProperty("deny");
    const edit = checkTool(dir, "Edit", { file_path: path.join(dir, ".git", "config") });
    expect(edit).toHaveProperty("deny");
    expect(edit.deny).toContain(".git");
  });

  it("refuses the web and agent tools", () => {
    expect(checkTool(dir, "WebFetch", { url: "https://example.com" })).toHaveProperty("deny");
    expect(checkTool(dir, "WebSearch", { query: "x" })).toHaveProperty("deny");
    expect(checkTool(dir, "Task", {})).toHaveProperty("deny");
  });

  it("asks for shell programs, keyed by the program", () => {
    const npm = checkTool(dir, "Bash", { command: "npm test" });
    expect(npm).toHaveProperty("ask");
    expect(npm.ask.key).toBe("npm");
    expect(npm.ask.action).toBe("Run npm in Files/Repos");

    const flutter = checkTool(dir, "Bash", { command: "C:\\tools\\flutter.bat test" });
    expect(flutter).toHaveProperty("ask");
    expect(flutter.ask.key).toBe("flutter");

    expect(checkTool(dir, "Bash", { command: "   " })).toHaveProperty("deny");
  });

  it("refuses git remotes, pushes and credentials, and GitHub writes", () => {
    for (const command of ["git push origin x", "git remote add a b", "git config credential.helper store", "gh pr merge 3"]) {
      expect(checkTool(dir, "Bash", { command }), command).toHaveProperty("deny");
    }
  });

  it("allows the free tools and asks about any unknown tool", () => {
    expect(checkTool(dir, "TodoWrite", { todos: [] })).toEqual({ allow: true });
    const unknown = checkTool(dir, "Frobnicate", { a: 1 });
    expect(unknown).toHaveProperty("ask");
    expect(unknown.ask.key).toBe("Frobnicate");
  });
});

describe("repos.checkTool: the person's decision", () => {
  it("asks once for a shell program, and does not ask again after 'always'", async () => {
    await linkSource();
    approve.mockResolvedValueOnce({ allowed: true, always: true, by: "person" });

    const first = await repos.checkTool(CTX, { tool_name: "Bash", input: { command: "npm test" } });
    expect(first).toEqual({ behavior: "allow", updatedInput: { command: "npm test" } });
    expect(approve).toHaveBeenCalledTimes(1);

    const second = await repos.checkTool(CTX, { tool_name: "Bash", input: { command: "npm test" } });
    expect(second).toEqual({ behavior: "allow", updatedInput: { command: "npm test" } });
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("denies every tool call when the bot has no repo", async () => {
    const r = await repos.checkTool(CTX, { tool_name: "Bash", input: { command: "npm test" } });
    expect(r.behavior).toBe("deny");
    expect(approve).not.toHaveBeenCalled();
  });
});

describe("pure helpers", () => {
  it("programOf reads the program name from a command", () => {
    expect(programOf("npm test")).toBe("npm");
    expect(programOf("  NPM.exe run build  ")).toBe("npm");
    expect(programOf("FOO=1 python3 x.py")).toBe("python3");
    expect(programOf("C:\\tools\\Flutter.bat test")).toBe("flutter");
    expect(programOf("")).toBe("command");
  });

  it("repoName takes a plain name and trims it", () => {
    expect(repoName("site")).toBe("site");
    expect(repoName("  my-app_2.0 ")).toBe("my-app_2.0");
    expect(repoName("A")).toBe("A");
  });

  it.each(["", "..", "a/b", "name.git", "trailing.", "-lead", "x".repeat(65), 123])("repoName refuses %j", (v) => {
    expect(() => repoName(v)).toThrow("letters, digits, dashes, dots or underscores");
  });

  it("nameFrom takes the last part of a folder or URL, without .git", () => {
    expect(nameFrom("D:\\code\\my-app")).toBe("my-app");
    expect(nameFrom("/home/me/my-app/")).toBe("my-app");
    expect(nameFrom("https://github.com/owner/repo.git")).toBe("repo");
    expect(nameFrom("git@github.com:owner/repo.git")).toBe("repo");
    expect(nameFrom("C:\\code\\.hidden")).toBe("hidden");
  });

  it("nameFrom falls back to repo when nothing is left", () => {
    expect(nameFrom("///")).toBe("repo");
  });

  it("cloneUrl accepts https, ssh and git@ addresses", () => {
    expect(cloneUrl("https://github.com/owner/repo")).toBe("https://github.com/owner/repo");
    expect(cloneUrl("ssh://git@github.com/owner/repo.git")).toBe("ssh://git@github.com/owner/repo.git");
    expect(cloneUrl("git@github.com:owner/repo.git")).toBe("git@github.com:owner/repo.git");
  });

  it.each(["file:///x", "ext::sh -c x", "C:\\x", "http://example.com/x", "https://x y", ""])("cloneUrl refuses %j", (v) => {
    expect(() => cloneUrl(v)).toThrow("https or ssh address");
  });

  it("branchName accepts ordinary branch names and trims them", () => {
    expect(branchName("fenna/fix-login")).toBe("fenna/fix-login");
    expect(branchName("main")).toBe("main");
    expect(branchName("  fenna/x  ")).toBe("fenna/x");
  });

  it.each(["-x", "a..b", "a.lock", "a@{b", "a//b", "x/.", "a b", ""])("branchName refuses %j", (v) => {
    expect(() => branchName(v)).toThrow("isn't a branch name git takes");
  });

  it("gitConfigText names the bot on commits and sets no credential helper", () => {
    const text = gitConfigText("Bot", "research");
    expect(text).toContain("name = Bot (Fenna Crew)");
    expect(text).toContain("email = research@bots.fenna.invalid");
    expect(text).toContain("helper =");
  });

  it("gitConfigText strips characters that would break the config file", () => {
    expect(gitConfigText('A"[x]\\', "s")).toContain("name = Ax (Fenna Crew)");
  });
});
