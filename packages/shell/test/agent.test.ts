import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
    argsFor(profile: Profile, kind: string, opts: { sessionId?: string | null; model?: string; effort?: string; root: string; images?: { path: string; name?: string }[]; permissionTool?: string; coding?: { dir: string } }): string[];
    promptFor(profile: Profile, text: string, context: unknown, first: boolean, images?: { path: string; name?: string }[]): string;
    inputFor(kind: string, prompt: string, images?: { path: string; name?: string; mimeType?: string; base64?: string }[]): string;
    saveImages(images: { name?: string; mimeType?: string; data: string }[]): { path: string; name: string; mimeType: string; base64: string }[];
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

  it("reports the tokens a turn used, when the CLI gives them (Claude Code's cost too)", () => {
    const ev: Record<string, unknown>[] = [];
    const c = _test.makeParser(app, "claude", (e) => ev.push(e));
    c.line({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } });
    c.line({ type: "result", subtype: "success", total_cost_usd: 0.42, usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 } });
    expect(ev.map((e) => e.type)).toEqual(["text", "tokens", "done"]);
    expect(ev[1]).toEqual({ type: "tokens", input: 1110, output: 50, costUsd: 0.42 });

    const bare: Record<string, unknown>[] = [];
    _test.makeParser(app, "claude", (e) => bare.push(e)).line({ type: "result", subtype: "success", usage: {} });
    expect(bare.map((e) => e.type)).toEqual(["done"]);

    const x: Record<string, unknown>[] = [];
    _test.makeParser(app, "codex", (e) => x.push(e)).line({ type: "turn.completed", usage: { input_tokens: 900, cached_input_tokens: 400, output_tokens: 30 } });
    expect(x).toEqual([{ type: "tokens", input: 900, output: 30, costUsd: null }, { type: "done", sessionId: null }]);
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

  it("formats image prompts and inputs across all 3 CLIs", () => {
    const testImages = [
      { path: "/tmp/images/ref1.png", name: "ref1.png", mimeType: "image/png", base64: "iVBORw0KGgoAAAANSUhEUg==" },
      { path: "/tmp/images/mockup.jpg", name: "mockup.jpg", mimeType: "image/jpeg", base64: "/9j/4AAQSkZJRg==" },
    ];

    // promptFor includes image paths and notes
    const prompt = _test.promptFor(app, "Make it look like this", null, false, testImages);
    expect(prompt).toContain("Attached reference image(s):");
    expect(prompt).toContain("- ref1.png: /tmp/images/ref1.png");
    expect(prompt).toContain("- mockup.jpg: /tmp/images/mockup.jpg");
    expect(prompt).toContain("User: Make it look like this");

    // Antigravity input: text only (its stream refuses image blocks); the prompt names the image files
    const agyInput = JSON.parse(_test.inputFor("antigravity", prompt, testImages).trim());
    expect(agyInput.event).toBe("user");
    expect(agyInput.message.role).toBe("user");
    expect(agyInput.message.content).toEqual([{ type: "text", text: prompt }]);

    // Claude Code input: stream-json with Anthropic multimodal image content blocks
    const claudeInput = JSON.parse(_test.inputFor("claude", prompt, testImages).trim());
    expect(claudeInput.type).toBe("user");
    expect(claudeInput.message.role).toBe("user");
    expect(claudeInput.message.content).toHaveLength(3);
    expect(claudeInput.message.content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgoAAAANSUhEUg==" },
    });
    expect(claudeInput.message.content[2]).toEqual({ type: "text", text: prompt });

    // Codex input: standard prompt on stdin
    const codexInput = _test.inputFor("codex", prompt, testImages);
    expect(codexInput).toBe(prompt);

    // Codex argsFor: adds -i <path> for each image and leaves view_image enabled
    const codexArgs = _test.argsFor(app, "codex", { root: "/tmp/doc", images: testImages });
    expect(codexArgs).toContain("-i");
    expect(codexArgs).toContain("/tmp/images/ref1.png");
    expect(codexArgs).toContain("/tmp/images/mockup.jpg");
    // view_image is NOT in the disabled flags
    const disabledIdxs: string[] = [];
    for (let i = 0; i < codexArgs.length; i++) {
      if (codexArgs[i] === "--disable") disabledIdxs.push(codexArgs[i + 1]!);
    }
    expect(disabledIdxs).not.toContain("view_image");

    // Antigravity argsFor: allows read_file for image directory in permissions
    const agyArgs = _test.argsFor(app, "antigravity", { root: "/tmp/doc", images: testImages });
    const settingsIdx = agyArgs.indexOf("--settings");
    expect(settingsIdx).toBeGreaterThanOrEqual(0);
    const settings = JSON.parse(agyArgs[settingsIdx + 1]!);
    expect(settings.permissions.allow.some((p: string) => p.startsWith("read_file(") && p.includes("images"))).toBe(true);
  });
});

describe("coding runs", () => {
  const dir = path.join(os.tmpdir(), "bot", "workspace", "Repos");
  const disabled = (a: string[]) => a.flatMap((x, i) => (x === "--disable" ? [a[i + 1]] : []));

  it("gives Claude Code its own tools in a coding run, each asked through the permission tool", () => {
    const plain = _test.argsFor(app, "claude", { root: "/tmp/doc" });
    expect(plain[plain.indexOf("--tools") + 1]).toBe("");
    const coding = _test.argsFor(app, "claude", { root: "/tmp/doc", coding: { dir }, permissionTool: "mcp__crew__approve_tool" });
    expect(coding[coding.indexOf("--tools") + 1]).toBe("default");
    expect(coding[coding.indexOf("--permission-prompt-tool") + 1]).toBe("mcp__crew__approve_tool");
    expect(coding[coding.indexOf("--allowedTools") + 1]).toBe("mcp__notes");
  });

  it("turns Codex's shell on in its workspace-write sandbox, rooted in the repos folder", () => {
    const plain = _test.argsFor(app, "codex", { root: "/tmp/doc" });
    expect(disabled(plain)).toEqual(expect.arrayContaining(["shell_tool", "unified_exec"]));
    expect(plain).toContain("sandbox_mode=read-only");
    const coding = _test.argsFor(app, "codex", { root: "/tmp/doc", coding: { dir } });
    expect(disabled(coding)).not.toContain("shell_tool");
    expect(disabled(coding)).not.toContain("unified_exec");
    expect(coding).toContain("sandbox_mode=workspace-write");
    expect(coding).not.toContain("sandbox_mode=read-only");
    expect(coding[coding.indexOf("-C") + 1]).toBe(dir);
    expect(coding).toContain("approval_policy=never");
  });

  it("lets Antigravity run commands and write only in the repos folder, sandboxed", () => {
    const settingsOf = (a: string[]) => JSON.parse(a[a.indexOf("--settings") + 1]!);
    const plain = settingsOf(_test.argsFor(app, "antigravity", { root: "/tmp/doc" }));
    expect(plain.permissions.deny).toEqual(expect.arrayContaining(["command(*)", "write_file(*)", "unsandboxed(*)"]));
    const args = _test.argsFor(app, "antigravity", { root: "/tmp/doc", coding: { dir } });
    const s = settingsOf(args);
    const fwd = dir.split(path.sep).join("/");
    expect(s.permissions.allow).toEqual(expect.arrayContaining(["command(*)", `write_file(${fwd}/**)`, `read_file(${fwd}/**)`]));
    expect(s.permissions.deny).not.toContain("command(*)");
    expect(s.permissions.deny).not.toContain("write_file(*)");
    expect(s.permissions.deny).toContain("unsandboxed(*)");
    expect(args).toContain("--sandbox");
  });
});
