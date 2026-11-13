import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

type Profile = { id: string; note: string; mcpServer(root: string): { command: string; args: string[]; env: Record<string, string> }; toolLabel(tool: string, params: Record<string, unknown>): string | null };
type Emit = (e: Record<string, unknown>) => void;

const { _test } = require("../main/agent.cjs") as {
  _test: {
    makeParser(profile: Profile, kind: string, emit: Emit): { line(msg: unknown): void; state: { finished: boolean } };
    describeTool(profile: Profile, name: string, params: unknown): string;
    friendly(kind: string, raw: string): { message: string; fix: string | null };
    urlsIn(text: string): string[];
  };
};

/** An app as the shell sees it: one MCP server and words for one of its tools. */
const app: Profile = {
  id: "notes",
  note: "",
  mcpServer: () => ({ command: "node", args: ["server.js"], env: {} }),
  toolLabel: (tool, p) => (tool === "write_page" ? `Wrote “${String(p.id ?? "")}”` : null),
};

/** Real Antigravity 1.5.0 stream-json output (paths scrubbed): reads its tool docs, calls deck_overview, replies. */
const agyLines = readFileSync(new URL("./fixtures/agy-stream.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.startsWith("{"))
  .map((l) => JSON.parse(l));

describe("assistant host: event parsing", () => {
  it("turns Antigravity's stream into session, tool steps, text and done", () => {
    const events: Record<string, unknown>[] = [];
    const p = _test.makeParser({ ...app, id: "fenna-slides" }, "antigravity", (e) => events.push(e));
    for (const l of agyLines) p.line(l);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("session");
    expect(types).toContain("text");
    expect(types[types.length - 1]).toBe("done");
    // Its own reads of our tool descriptions are plumbing, not shown; an unlabelled tool reads as its name.
    const tools = events.filter((e) => e.type === "tool");
    expect(tools.every((t) => t.label === "deck overview")).toBe(true);
    expect(tools.map((t) => t.status)).toEqual(["running", "done"]);
    expect(p.state.finished).toBe(true);
  });

  it("names tools with the app's words, unwrapping Antigravity's wrapper and the app's prefix", () => {
    expect(_test.describeTool(app, "call_mcp_tool", { ServerName: "notes", ToolName: "write_page", Arguments: { id: "intro" } })).toBe("Wrote “intro”");
    expect(_test.describeTool(app, "mcp__notes__write_page", { id: "a" })).toBe("Wrote “a”");
    expect(_test.describeTool(app, "call_mcp_tool", { ToolName: "write_page", Arguments: '{"id":"x"}' })).toBe("Wrote “x”");
    expect(_test.describeTool(app, "mcp__notes__list_pages", {})).toBe("list pages");
  });

  it("parses Claude Code and Codex streams", () => {
    const ev: Record<string, unknown>[] = [];
    const c = _test.makeParser(app, "claude", (e) => ev.push(e));
    c.line({ type: "system", subtype: "init", session_id: "s1" });
    c.line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "mcp__notes__write_page", input: { id: "p" } }] } });
    c.line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1" }] } });
    c.line({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } });
    c.line({ type: "result", subtype: "success", session_id: "s1" });
    expect(ev.map((e) => e.type)).toEqual(["session", "tool", "tool", "text", "done"]);
    expect(ev[1]!.label).toBe("Wrote “p”");

    const x: Record<string, unknown>[] = [];
    const k = _test.makeParser(app, "codex", (e) => x.push(e));
    k.line({ type: "thread.started", thread_id: "th" });
    k.line({ type: "item.started", item: { id: "i1", type: "mcp_tool_call", tool: "write_page", arguments: { id: "a" } } });
    k.line({ type: "item.completed", item: { id: "i1", type: "mcp_tool_call", tool: "write_page", arguments: { id: "a" } } });
    k.line({ type: "item.completed", item: { type: "agent_message", text: "Saved." } });
    k.line({ type: "turn.completed", usage: {} });
    expect(x.map((e) => e.type)).toEqual(["session", "tool", "tool", "text", "done"]);
  });

  it("explains common failures in plain words, with what would fix them", () => {
    expect(_test.friendly("claude", "Error: 401 Unauthorized")).toEqual({ message: "Claude Code needs you to sign in again.", fix: "signin" });
    expect(_test.friendly("codex", "rate limit exceeded (429)").message).toMatch(/usage limit/);
    expect(_test.friendly("antigravity", "spawn agy ENOENT").fix).toBe("install");
    expect(_test.friendly("codex", "x".repeat(400)).message.length).toBe(301);
  });

  it("finds the sign-in link in what a CLI prints", () => {
    expect(_test.urlsIn("Open https://claude.ai/oauth/authorize?code=1). Then paste the code")).toEqual(["https://claude.ai/oauth/authorize?code=1"]);
    expect(_test.urlsIn("no links here")).toEqual([]);
  });
});
