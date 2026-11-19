import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

type Ev = Record<string, unknown> & { type: string };
type Server = { command?: string; args?: string[]; env?: Record<string, string>; url?: string; timeoutSec?: number; optional?: boolean };
type Profile = { id: string; servers?: string[]; note: string; mcpServer(root: string): { command: string; args: string[]; env: Record<string, string> }; toolLabel(tool: string, params: Record<string, unknown>, server?: string): string | null };

const agent = require("../main/agent.cjs") as {
  startRun(o: {
    kind: string;
    prompt: string;
    cwd: string;
    servers: Record<string, Server>;
    trusted?: string[];
    permissionTool?: string;
    home?: string;
    sessionId?: string | null;
    model?: string;
    effort?: string;
    env?: Record<string, string>;
    toolLabel?: (tool: string, params: Record<string, unknown>, server: string) => string | null;
    onEvent(e: Ev): void;
  }): { runId: string; stop(): void };
  _test: {
    argsFor(profile: Profile, kind: string, opts: Record<string, unknown>): string[];
    describeTool(profile: Profile, name: string, params: unknown, server?: string): string;
    makeParser(profile: Profile, kind: string, emit: (e: Ev) => void, opts?: { raw?: boolean }): { line(msg: unknown): void };
    useBinary(fn: ((kind: string) => string[] | null) | null): void;
  };
};
const { startRun, _test } = agent;

const fake = fileURLToPath(new URL("./fixtures/fake-claude.cjs", import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "shell-run-"));
afterAll(() => {
  _test.useBinary(null);
  rmSync(work, { recursive: true, force: true });
});

const app: Profile = { id: "notes", note: "", mcpServer: () => ({ command: "node", args: ["server.js"], env: { A: "1" } }), toolLabel: () => null };
const servers: Record<string, Server> = {
  crew: { command: "node", args: ["crew.js", "--server=crew"], env: { TOKEN: "t" }, timeoutSec: 900 },
  browser: { command: "node", args: ["crew.js", "--server=browser"], env: { TOKEN: "t" } },
  tracker: { url: "https://mcp.example.com/mcp", optional: true },
};

function run(prompt: string, extra: Partial<Parameters<typeof startRun>[0]> = {}): Promise<{ events: Ev[]; handle: { runId: string; stop(): void } }> {
  return new Promise((resolve) => {
    const events: Ev[] = [];
    const handle = startRun({
      kind: "claude",
      prompt,
      cwd: work,
      servers: { crew: servers.crew!, browser: servers.browser! },
      trusted: ["crew", "browser"],
      permissionTool: "mcp__crew__approve_tool",
      toolLabel: (tool, _p, server) => (server === "browser" ? `Browser: ${tool}` : null),
      onEvent: (e) => {
        events.push(e);
        if (e.type === "done" || e.type === "error" || e.type === "stopped") resolve({ events, handle });
        if (e.type === "session" && prompt.includes("hang")) setTimeout(() => handle.stop(), 200);
      },
      ...extra,
    });
  });
}

describe("assistant host: a run with no window", () => {
  it("keeps the chat's command line exactly as it was when given one app server", () => {
    const claude = _test.argsFor(app, "claude", { root: "/doc" });
    const cfg = claude[claude.indexOf("--mcp-config") + 1]!;
    expect(path.basename(cfg)).toBe("notes-mcp.json");
    expect(JSON.parse(readFileSync(cfg, "utf8"))).toEqual({ mcpServers: { notes: { type: "stdio", command: "node", args: ["server.js"], env: { A: "1" } } } });
    expect(claude.slice(claude.indexOf("--strict-mcp-config"))).toEqual(["--strict-mcp-config", "--allowedTools", "mcp__notes", "--permission-mode", "default"]);
    const codex = _test.argsFor(app, "codex", { root: "/doc" });
    const tail = codex.slice(codex.indexOf('mcp_servers.notes.command="node"') - 1);
    expect(tail).toEqual(["-c", 'mcp_servers.notes.command="node"', "-c", 'mcp_servers.notes.args=["server.js"]', "-c", 'mcp_servers.notes.env.A="1"', "-c", "mcp_servers.notes.default_tools_approval_mode=approve", "-c", "mcp_servers.notes.required=true", "-"]);
    expect(codex[0]).toBe("exec");
  });

  it("gives Claude Code several servers, trusts only some, and routes the rest to a permission tool", () => {
    const a = _test.argsFor(app, "claude", { servers, trusted: ["crew", "browser"], permissionTool: "mcp__crew__approve_tool", sessionId: "s-1", model: "sonnet" });
    const cfg = a[a.indexOf("--mcp-config") + 1]!;
    expect(path.basename(cfg)).toMatch(/^run-[0-9a-f-]{36}-mcp\.json$/);
    expect(JSON.parse(readFileSync(cfg, "utf8")).mcpServers).toEqual({
      crew: { type: "stdio", command: "node", args: ["crew.js", "--server=crew"], env: { TOKEN: "t" } },
      browser: { type: "stdio", command: "node", args: ["crew.js", "--server=browser"], env: { TOKEN: "t" } },
      tracker: { type: "http", url: "https://mcp.example.com/mcp" },
    });
    rmSync(cfg);
    expect(a).toContain("--strict-mcp-config");
    expect(a[a.indexOf("--allowedTools") + 1]).toBe("mcp__crew,mcp__browser");
    expect(a[a.indexOf("--permission-prompt-tool") + 1]).toBe("mcp__crew__approve_tool");
    expect(a.slice(-4)).toEqual(["--model", "sonnet", "--resume", "s-1"]);
  });

  it("gives Codex and Antigravity every server, with timeouts and optional ones", () => {
    const c = _test.argsFor(app, "codex", { servers });
    expect(c).toContain("mcp_servers.crew.tool_timeout_sec=900");
    expect(c).toContain('mcp_servers.tracker.url="https://mcp.example.com/mcp"');
    expect(c).toContain("mcp_servers.crew.required=true");
    expect(c).not.toContain("mcp_servers.tracker.required=true");
    expect(c.filter((x) => x.endsWith("default_tools_approval_mode=approve"))).toHaveLength(3);
    const home = path.join(work, "agy");
    const g = _test.argsFor(app, "antigravity", { servers, home });
    const settings = JSON.parse(g[g.indexOf("--settings") + 1]!);
    expect(settings.permissions.allow.filter((p: string) => p.startsWith("mcp("))).toEqual(["mcp(crew/*)", "mcp(browser/*)", "mcp(tracker/*)"]);
    const cfg = JSON.parse(readFileSync(path.join(home, ".gemini", "config", "mcp_config.json"), "utf8"));
    expect(cfg.mcpServers.tracker).toEqual({ serverUrl: "https://mcp.example.com/mcp" });
    expect(cfg.mcpServers.browser.args).toEqual(["crew.js", "--server=browser"]);
  });

  it("names the server and tool of each call across servers", () => {
    const p: Profile = { ...app, id: "crew", servers: ["crew", "browser"], toolLabel: (t, _p, s) => (s === "browser" && t === "click" ? "Clicked" : null) };
    expect(_test.describeTool(p, "mcp__browser__click", {})).toBe("Clicked");
    expect(_test.describeTool(p, "call_mcp_tool", { ServerName: "browser", ToolName: "click", Arguments: "{}" })).toBe("Clicked");
    expect(_test.describeTool(p, "click", {}, "browser")).toBe("Clicked");
    expect(_test.describeTool(p, "mcp__crew__set_status", {})).toBe("set status");
    const ev: Ev[] = [];
    const parser = _test.makeParser(p, "codex", (e) => ev.push(e), { raw: true });
    parser.line({ type: "item.started", item: { id: "i", type: "mcp_tool_call", server: "browser", tool: "click", arguments: {} } });
    expect(ev[0]).toMatchObject({ server: "browser", tool: "click", label: "Clicked" });
    const plain: Ev[] = [];
    _test.makeParser(p, "codex", (e) => plain.push(e)).line({ type: "item.started", item: { id: "i", type: "mcp_tool_call", tool: "click", arguments: {} } });
    expect(plain[0]).not.toHaveProperty("server");
  });

  it("runs a CLI in the given folder with the given servers and streams its events", async () => {
    _test.useBinary(() => [process.execPath, fake]);
    const { events } = await run("hello", { sessionId: "prev-1", env: { FAKE_EXTRA: "yes" } });
    expect(events.map((e) => e.type)).toEqual(["session", "tool", "tool", "tool", "tool", "text", "done"]);
    expect(new Set(events.map((e) => e.runId)).size).toBe(1);
    expect(events[1]).toMatchObject({ server: "crew", tool: "look", label: "look", status: "running" });
    expect(events[3]).toMatchObject({ server: "browser", tool: "look", label: "Browser: look" });
    const said = JSON.parse(String(events[5]!.text));
    expect(realpathSync(said.cwd)).toBe(realpathSync(work));
    expect(said).toMatchObject({ servers: ["crew", "browser"], prompt: "mcp__crew__approve_tool", extra: "yes", resume: "prev-1" });
    // The run's own MCP config is removed when the CLI exits.
    await new Promise((r) => setTimeout(r, 500));
    const left = readdirSync(path.dirname(path.join(tmpdir(), "opendeck-test", "assistant", "claude", "x"))).filter((f) => f.startsWith("run-"));
    expect(left).toEqual([]);
  });

  it("reports a failing CLI as an error and a stopped one as stopped", async () => {
    _test.useBinary(() => [process.execPath, fake]);
    const failed = await run("please fail");
    expect(failed.events.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("something broke") });
    const stopped = await run("hang");
    expect(stopped.events.at(-1)!.type).toBe("stopped");
  });

  it("says when the CLI isn't installed, and refuses bad options before starting", async () => {
    _test.useBinary(() => null);
    const { events } = await run("hello");
    expect(events).toEqual([expect.objectContaining({ type: "error", fix: "install" })]);
    _test.useBinary(() => [process.execPath, fake]);
    const base = { kind: "claude", prompt: "x", cwd: work, servers: { crew: servers.crew! }, onEvent: () => {} };
    expect(() => startRun({ ...base, kind: "gpt" })).toThrow(/Unknown assistant "gpt"/);
    expect(() => startRun({ ...base, servers: {} })).toThrow(/at least one MCP server/);
    expect(() => startRun({ ...base, servers: { "Bad Name": servers.crew! } })).toThrow(/lowercase/);
    expect(() => startRun({ ...base, model: "a b" })).toThrow(/model or effort/);
    expect(() => startRun({ ...base, sessionId: "../x" })).toThrow(/session id/);
    expect(() => startRun({ ...base, cwd: path.join(work, "missing") })).toThrow(/doesn't exist/);
    expect(existsSync(work)).toBe(true);
  });
});
