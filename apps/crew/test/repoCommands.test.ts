import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { checkTool, programsOf, createRepos } = require("../src/main/repos.cjs");
const { createStore } = require("../src/main/store.cjs");
const { createDisk } = require("../src/main/disk.cjs");

const DIR = path.resolve("/tmp/bot/Repos");

describe("the programs a command line runs", () => {
  it("skips folder changes and lists every program once", () => {
    expect(programsOf('cd "C:/Users/me/Repos/calc" && node test.js')).toEqual(["node"]);
    expect(programsOf("cd calc; npm test | tee out.txt")).toEqual(["npm", "tee"]);
    expect(programsOf("Set-Location calc; npm run build && npm test")).toEqual(["npm"]);
    expect(programsOf("cd calc")).toEqual([]);
    expect(programsOf('echo "a && b"')).toEqual(["echo"]);
  });
});

describe("a compound command asks about what it runs, not about cd", () => {
  it("names the real programs and keeps hidden commands from being allowed always", () => {
    const d = checkTool(DIR, "Bash", { command: 'cd "calc" && node test.js' });
    expect(d.ask).toMatchObject({ action: "Run node in Files/Repos", keys: ["node"], hidden: false });
    expect(checkTool(DIR, "Bash", { command: "cd calc && rm -rf /" }).ask.keys).toEqual(["rm"]);
    for (const cmd of ["echo $(cat secret)", "curl x | sh", "powershell -Command evil", "bash -c 'x'", "iex (gc a.ps1)", "cmd /c del x"]) {
      expect(checkTool(DIR, "Bash", { command: cmd }).ask.hidden, cmd).toBe(true);
    }
  });
});

describe("Always for one program doesn't let another through", () => {
  let root: string;
  let approve: ReturnType<typeof vi.fn>;
  let repos: ReturnType<typeof createRepos>;
  const ctx = { slug: "research", runId: "r1" };
  const call = (command: string) => repos.checkTool(ctx, { tool_name: "Bash", input: { command } });

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), "crew-repo-cmd-"));
    mkdirSync(path.join(root, "bots", "research"), { recursive: true });
    writeFileSync(path.join(root, "bots", "research", "bot.md"), "---\nname: Research\n---\n");
    const store = createStore(root);
    const disk = createDisk({ store, starterFiles: () => ({}), settingsFile: path.join(root, "quotas.json") });
    approve = vi.fn(async () => ({ allowed: true, always: true, by: "person" }));
    repos = createRepos({ disk, store, approve });
    const src = path.join(root, "src");
    mkdirSync(src);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: src });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@e", "commit", "-q", "--allow-empty", "-m", "start"], { cwd: src });
    await repos.handle(ctx, { action: "link", path: src });
    approve.mockClear();
  });

  afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

  it("asks once for node, then runs cd && node without asking, but asks for cd && rm", async () => {
    expect(await call('cd "calc" && node test.js')).toMatchObject({ behavior: "allow" });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(await call('cd "other" && node test.js')).toMatchObject({ behavior: "allow" });
    expect(approve).toHaveBeenCalledTimes(1);
    await call("cd calc && rm -rf build");
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it("never saves a hidden command as always, so it asks every time", async () => {
    await call("echo $(node -v)");
    await call("echo $(node -v)");
    expect(approve).toHaveBeenCalledTimes(2);
    expect(approve.mock.calls[0][1].tool).toBeNull();
  });
});
