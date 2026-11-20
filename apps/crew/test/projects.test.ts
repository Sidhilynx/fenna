import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createProjects, splitWords, parseCommand, projectName, MAX_RUNNING } = require("../src/main/projects.cjs");

const SLUG = "site-bot";
const NODE = process.execPath;
const ok = { allowed: true, always: false, by: "person" };

/** A child process stand-in: output is pushed by the test, exit is the test's call. */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    setImmediate(() => child.emit("close", null));
  });
  child.finish = (code) => {
    child.stdout.end();
    child.stderr.end();
    setImmediate(() => child.emit("close", code));
  };
  return child;
}

describe("command parsing", () => {
  it("splits words and keeps quoted groups together", () => {
    expect(splitWords('npm install "my pkg" \'x y\'')).toEqual(["npm", "install", "my pkg", "x y"]);
    expect(splitWords("node C:\\Work\\server.js")).toEqual(["node", "C:\\Work\\server.js"]);
    expect(splitWords('node "open')).toBeNull();
  });

  it("allows node, npm and npx and nothing else", () => {
    expect(parseCommand("npm init -y")).toEqual({ program: "npm", args: ["init", "-y"] });
    expect(parseCommand("npx create-thing")).toEqual({ program: "npx", args: ["create-thing"] });
    expect(parseCommand("node server.js")).toEqual({ program: "node", args: ["server.js"] });
    expect(() => parseCommand("curl https://example.com")).toThrow('Allowed: node, npm, npx.');
    expect(() => parseCommand("cmd /c dir")).toThrow('Allowed: node, npm, npx.');
    expect(() => parseCommand("")).toThrow();
  });

  it("refuses shell operators and substitutions", () => {
    for (const bad of ["npm init | more", "npm install a && node b", "node a.js; rm x", "node a.js > out", "node a.js < in", "node `x`", "node $(whoami)"]) {
      expect(() => parseCommand(bad), bad).toThrow(/can't use/);
    }
  });

  it("refuses node flags before the file, which could grant permissions", () => {
    expect(() => parseCommand("node --allow-fs-read=/ server.js")).toThrow(/Flags can't come before the file/);
    expect(() => parseCommand("node")).toThrow(/write node, then the file/);
  });

  it("names projects simply and refuses paths", () => {
    expect(projectName("site")).toBe("site");
    expect(projectName("my-app.v2")).toBe("my-app.v2");
    for (const bad of ["..", "a/b", "a\\b", "CON", "", ".hidden", "x."]) expect(() => projectName(bad), bad).toThrow();
  });
});

describe("createProjects", () => {
  let root: string;
  let botDir: string;
  let spawned: { exe: string; argv: string[]; opts: any; child: ReturnType<typeof fakeChild> }[];
  let runs: any[];
  let broadcasts: [string, any][];
  let browserCalls: any[];
  let approve: ReturnType<typeof vi.fn>;
  let bot: { name: string; projects: "on" | "off" };

  function make(overrides: Record<string, unknown> = {}) {
    const store = {
      readBot: (slug: string) => (slug === SLUG ? { bot } : null),
      botDir: () => botDir,
    };
    const disk = {
      locate: (slug: string, p: string) => ({ abs: path.join(root, "bot", ...p.split("/").slice(1)) }),
    };
    const runner = { record: (runId: string, ev: any) => runs.push({ runId, ev }) };
    const browsers = {
      act: vi.fn(async (slug: string, method: string, params: any) => {
        browserCalls.push({ slug, method, params });
        return { text: "" };
      }),
    };
    const broadcast = (ch: string, p: any) => broadcasts.push([ch, p]);
    const spawn = vi.fn((exe: string, argv: string[], opts: any) => {
      const child = fakeChild();
      spawned.push({ exe, argv, opts, child });
      return child;
    });
    return createProjects({ disk, store, runner, approve, browsers, broadcast, nodePath: NODE, spawn, versionOf: () => "24.1.0", ...overrides });
  }

  const ctx = (runId = "run-1") => ({ slug: SLUG, runId, team: null, chain: null });

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "projects-test-"));
    botDir = path.join(root, "bot");
    mkdirSync(botDir, { recursive: true });
    spawned = [];
    runs = [];
    broadcasts = [];
    browserCalls = [];
    bot = { name: "Site", projects: "on" };
    approve = vi.fn(async () => ok);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses everything while projects are off, with the words to fix it", async () => {
    bot.projects = "off";
    const p = make();
    await expect(p.command(ctx(), { project: "site", command: "npm init -y" })).rejects.toThrow("Projects are off for Site. Ask the person to turn them on in Details.");
    expect(approve).not.toHaveBeenCalled();
    expect(spawned).toHaveLength(0);
  });

  it("asks for a Node that is 22 or newer, with the nodejs.org hint", async () => {
    const p = make({ versionOf: () => "18.20.0" });
    await expect(p.command(ctx(), { project: "site", command: "npm init -y" })).rejects.toThrow("Projects need Node.js 22 or newer on this computer: nodejs.org");
    const q = make({ nodePath: path.join(root, "nope", "node.exe") });
    await expect(q.command(ctx(), { project: "site", command: "npm init -y" })).rejects.toThrow("Projects need Node.js 22 or newer");
  });

  it("builds node argv with long paths, no shell, and a minimal environment", async () => {
    const p = make();
    const run = p.command(ctx(), { project: "site", command: "node server.js", background: true });
    await run;
    const s = spawned[0];
    const dir = realpathSync.native(path.join(root, "bot", "Projects", "site"));
    expect(s.exe).toBe(realpathSync.native(NODE));
    expect(s.argv.slice(0, 4)).toEqual(["--permission", `--allow-fs-read=${dir}`, `--allow-fs-read=${realpathSync.native(path.dirname(NODE))}`, `--allow-fs-write=${dir}`]);
    expect(s.argv.slice(4)).toEqual(["server.js"]);
    expect(s.opts.cwd).toBe(dir);
    expect(s.opts.shell).toBe(false);
    expect(Object.keys(s.opts.env).sort()).toEqual(["HOME", "PATH", "TEMP", "TMP", "TMPDIR", "USERPROFILE"].concat(process.env.SystemRoot ? ["SystemRoot"] : []).sort());
    expect(s.opts.env.TEMP).toBe(path.join(dir, ".tmp"));
    expect(s.opts.env.HOME).toBe(dir);
    expect(s.opts.env.PATH).toBe(realpathSync.native(path.dirname(NODE)));
    expect(s.opts.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(s.argv.join(" ")).not.toMatch(/ARSHAD~1|~\d/);
    expect(existsSync(path.join(dir, ".tmp"))).toBe(true);
  });

  it("builds npm argv through the npm entry, with its cache inside the project and fixed flags", async () => {
    const p = make();
    // npm-cli.js sits beside node's install in node_modules; use a fake layout next to a fake node.
    const fakeInstall = path.join(root, "nodejs");
    mkdirSync(path.join(fakeInstall, "node_modules", "npm", "bin"), { recursive: true });
    writeFileSync(path.join(fakeInstall, "node_modules", "npm", "bin", "npm-cli.js"), "");
    writeFileSync(path.join(fakeInstall, "node.exe"), "");
    const q = make({ nodePath: path.join(fakeInstall, "node.exe") });
    void p;
    q.command(ctx("run-npm"), { project: "site", command: "npm install express" });
    await new Promise((r) => setImmediate(r));
    const s = spawned[0];
    const dir = realpathSync.native(path.join(root, "bot", "Projects", "site"));
    const entry = realpathSync.native(path.join(fakeInstall, "node_modules", "npm", "bin", "npm-cli.js"));
    expect(s.argv).toContain(`--allow-fs-read=${realpathSync.native(path.join(fakeInstall, "node_modules", "npm"))}`);
    expect(s.argv).toContain(`--allow-fs-read=${path.join(dir, ".npm-cache")}`);
    expect(s.argv).toContain(`--allow-fs-write=${path.join(dir, ".npm-cache")}`);
    const at = s.argv.indexOf(entry);
    expect(at).toBeGreaterThan(0);
    expect(s.argv.slice(at + 1)).toEqual(["install", "express", "--cache", path.join(dir, ".npm-cache"), "--ignore-scripts", "--no-audit", "--no-fund"]);
    expect(existsSync(path.join(dir, ".npm-cache"))).toBe(true);
    s.child.finish(0);
  });

  it("refuses npm when its entry is not beside node", async () => {
    const lone = path.join(root, "lone");
    mkdirSync(lone, { recursive: true });
    writeFileSync(path.join(lone, "node.exe"), "");
    const p = make({ nodePath: path.join(lone, "node.exe") });
    await expect(p.command(ctx(), { project: "site", command: "npm init -y" })).rejects.toThrow("npm isn't next to Node.js");
  });

  it("builds npx argv through npx-cli.js with the package root readable", async () => {
    const fakeInstall = path.join(root, "nodejs2");
    mkdirSync(path.join(fakeInstall, "node_modules", "npm", "bin"), { recursive: true });
    writeFileSync(path.join(fakeInstall, "node_modules", "npm", "bin", "npx-cli.js"), "");
    writeFileSync(path.join(fakeInstall, "node.exe"), "");
    const p = make({ nodePath: path.join(fakeInstall, "node.exe") });
    const started = p.command(ctx("run-npx"), { project: "site", command: "npx cowsay hi" });
    await new Promise((r) => setImmediate(r));
    const s = spawned[0];
    const entry = realpathSync.native(path.join(fakeInstall, "node_modules", "npm", "bin", "npx-cli.js"));
    const at = s.argv.indexOf(entry);
    expect(at).toBeGreaterThan(0);
    expect(s.argv.slice(at + 1)).toEqual(["cowsay", "hi"]);
    expect(s.argv.some((a) => a.startsWith("--cache"))).toBe(false);
    s.child.finish(0);
    await started;
  });

  it("asks once for a project, and the words of the card are exact", async () => {
    const p = make();
    const first = p.command(ctx("run-a"), { project: "site", command: "node server.js", background: true });
    await first;
    expect(approve).toHaveBeenCalledTimes(1);
    const [c, a] = approve.mock.calls[0];
    expect(c.runId).toBe("run-a");
    expect(a.action).toBe("Run commands in Projects/site");
    expect(a.details).toBe("Site wants to run node, npm and npx in Projects/site. They can read and write only that folder and can't start other programs, but they can reach the internet.");
    expect(a.source).toBe("project");
    await p.command(ctx("run-a"), { project: "site", command: "node server.js", background: true });
    expect(approve).toHaveBeenCalledTimes(1);
    await p.command(ctx("run-b"), { project: "site", command: "node server.js", background: true });
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it("Always persists in the bot folder's projects.json and stops asking", async () => {
    approve.mockResolvedValueOnce({ allowed: true, always: true, by: "person" });
    const p = make();
    await p.command(ctx(), { project: "site", command: "node server.js", background: true });
    expect(JSON.parse(readFileSync(path.join(botDir, "projects.json"), "utf8"))).toEqual({ approved: ["site"] });
    await make().command(ctx("run-z"), { project: "site", command: "node server.js", background: true });
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("Deny refuses the project for the rest of the run only", async () => {
    approve.mockResolvedValueOnce({ allowed: false, always: false, by: "person" });
    const p = make();
    await expect(p.command(ctx("run-d"), { project: "site", command: "node server.js", background: true })).rejects.toThrow("Denied by the person");
    await expect(p.command(ctx("run-d"), { project: "site", command: "node server.js", background: true })).rejects.toThrow("said no");
    expect(approve).toHaveBeenCalledTimes(1);
    p.endRun("run-d");
    approve.mockResolvedValueOnce(ok);
    await p.command(ctx("run-d"), { project: "site", command: "node server.js", background: true });
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it("a timed-out or stopped answer runs nothing and says so", async () => {
    approve.mockResolvedValueOnce({ allowed: false, always: false, by: "timeout" });
    const p = make();
    await expect(p.command(ctx(), { project: "site", command: "node a.js", background: true })).rejects.toThrow("didn't answer in time");
    approve.mockResolvedValueOnce({ allowed: false, always: false, by: "stopped" });
    await expect(p.command(ctx("r2"), { project: "site", command: "node a.js", background: true })).rejects.toThrow("stopped before the person answered");
    expect(spawned).toHaveLength(0);
  });

  it("foreground returns the exit code, time and output, logs a command event", async () => {
    const p = make();
    const run = p.command(ctx(), { project: "site", command: "node a.js" });
    await new Promise((r) => setImmediate(r));
    spawned[0].child.stdout.write("hello\n");
    spawned[0].child.finish(0);
    const r = await run;
    expect(r.text).toMatch(/^Exit code 0 after \d+\.\d s\.\nhello\n$/);
    const ev = runs.find((x) => x.ev.type === "command").ev;
    expect(ev).toMatchObject({ type: "command", project: "site", command: "node a.js", exitCode: 0, background: false });
  });

  it("foreground shows only the last 16 KB and says how much was cut", async () => {
    const p = make();
    const run = p.command(ctx(), { project: "site", command: "node a.js" });
    await new Promise((r) => setImmediate(r));
    const big = "x".repeat(40 * 1024) + "END";
    spawned[0].child.stdout.write(big);
    spawned[0].child.finish(1);
    const r = await run;
    expect(r.text).toContain("Exit code 1");
    expect(r.text).toMatch(/Output: 40 KB\. The first 24 KB were cut; this is the last 16 KB\./);
    expect(r.text.endsWith("END\n") || r.text.endsWith("END")).toBe(true);
    expect(r.text.length).toBeLessThan(17 * 1024 + 200);
  });

  it("keeps the last 64 KB per process in its tail and info", async () => {
    const p = make();
    await p.command(ctx(), { project: "site", command: "node srv.js", background: true });
    const child = spawned[0].child;
    child.stdout.write("a".repeat(100 * 1024));
    await new Promise((r) => setTimeout(r, 150));
    const info = p.list(SLUG)[0];
    expect(info.tail.length).toBeLessThanOrEqual(2048);
    const out = p.processes(ctx(), { action: "output", id: info.id });
    expect(out.text).toMatch(/The first \d+ KB were cut/);
  });

  it("finds a localhost port in background output, opens it once in the bot's browser, and reports it", async () => {
    const p = make();
    await p.command(ctx(), { project: "site", command: "node server.js", background: true });
    const child = spawned[0].child;
    child.stdout.write("Server up at http://local");
    child.stdout.write("host:3000/ now\n");
    await new Promise((r) => setTimeout(r, 20));
    child.stdout.write("again localhost:3000\n");
    await new Promise((r) => setTimeout(r, 20));
    expect(browserCalls).toEqual([{ slug: SLUG, method: "open", params: { url: "http://localhost:3000", new_tab: true } }]);
    const info = p.list(SLUG)[0];
    expect(info.port).toBe(3000);
    expect(broadcasts.some(([ch, pl]) => ch === "crew:process" && pl.info.port === 3000)).toBe(true);
  });

  it("finds listening on <port> and 127.0.0.1 addresses, and ignores bad ports", async () => {
    const p = make();
    await p.command(ctx(), { project: "site", command: "node server.js", background: true });
    spawned[0].child.stdout.write("listening on port 8080\n");
    await new Promise((r) => setTimeout(r, 20));
    expect(p.list(SLUG)[0].port).toBe(8080);
    const q = make();
    await q.command(ctx("q"), { project: "site", command: "node server.js", background: true });
    spawned[1].child.stdout.write("127.0.0.1:99999 and listening on 99999\n");
    await new Promise((r) => setTimeout(r, 20));
    expect(q.list(SLUG)[0].port).toBeNull();
  });

  it("allows three running per bot and says which to stop", async () => {
    const p = make();
    for (let i = 0; i < MAX_RUNNING; i++) await p.command(ctx(), { project: "site", command: "node srv.js", background: true });
    await expect(p.command(ctx(), { project: "site", command: "node srv.js", background: true })).rejects.toThrow("3 processes are running");
    const first = p.list(SLUG)[0].id;
    p.stop(SLUG, first);
    spawned[0].child.finish(0);
    await new Promise((r) => setTimeout(r, 10));
    await p.command(ctx(), { project: "site", command: "node srv.js", background: true });
    expect(spawned).toHaveLength(4);
  });

  it("stop, stopAll and killAll kill the bot's running processes", async () => {
    const p = make();
    await p.command(ctx(), { project: "site", command: "node a.js", background: true });
    await p.command(ctx(), { project: "site", command: "node b.js", background: true });
    p.stopAll(SLUG);
    expect(spawned[0].child.kill).toHaveBeenCalled();
    expect(spawned[1].child.kill).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 10));
    expect(p.list(SLUG).map((i) => i.status)).toEqual(["stopped", "stopped"]);
    await p.command(ctx("r3"), { project: "site", command: "node c.js", background: true });
    p.killAll();
    expect(spawned[2].child.kill).toHaveBeenCalled();
  });

  it("an unknown process id names the ones there are", async () => {
    const p = make();
    expect(() => p.processes(ctx(), { action: "stop", id: "nope" })).toThrow('There is no process "nope". Processes: none.');
  });

  it("a process that fails to start is reported, not thrown later", async () => {
    const p = make({ spawn: () => {
      const child = fakeChild();
      setImmediate(() => child.emit("error", new Error("EPERM")));
      return child;
    } });
    const r = await p.command(ctx(), { project: "site", command: "node a.js" });
    expect(r.text).toContain("It did not start: EPERM");
  });
});
