import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createToolLabel } = require("../src/main/labels.cjs");
const { _test } = require("@opendeck/shell/main/agent.cjs") as {
  _test: { makeParser(profile: object, kind: string, emit: (e: Record<string, unknown>) => void): { line(msg: unknown): void } };
};

const label = createToolLabel();

describe("a coding run's own steps, in the chat", () => {
  it("names Claude Code's own tools by what they did", () => {
    expect(label("Bash", { command: "npm test" }, "", "ada")).toBe("Ran npm test");
    expect(label("Edit", { file_path: "D:\\bots\\ada\\Repos\\shop\\src\\cart.ts" }, "", "ada")).toBe("Edited cart.ts");
    expect(label("Read", { file_path: "/home/me/Repos/shop/README.md" }, "", "ada")).toBe("Read README.md");
    expect(label("Grep", { pattern: "total" }, "", "ada")).toBe("Searched the code for total");
    expect(label("TodoWrite", {}, "", "ada")).toBe("Updated its to-do list");
  });

  it("names Antigravity's and Codex's own tools", () => {
    expect(label("run_command", { CommandLine: "flutter test" }, "", "ada")).toBe("Ran flutter test");
    expect(label("replace_file_content", { TargetFile: "C:/r/lib/main.dart" }, "", "ada")).toBe("Edited main.dart");
    expect(label("command_execution", { command: "cargo test" }, "", "ada")).toBe("Ran cargo test");
    expect(label("file_change", { changes: [{ path: "a/b.go", kind: "update" }] }, "", "ada")).toBe("Edited b.go");
    expect(label("file_change", { changes: [{ path: "a" }, { path: "b" }] }, "", "ada")).toBe("Edited 2 files");
  });

  it("falls back to the tool's own name, never 'undefined'", () => {
    expect(label("SomethingNew", {}, "", "ada")).toBe("SomethingNew");
    expect(label("something_new", {}, undefined, "ada")).toBe("something new");
  });

  it("names the repo, github, app_windows and team tools", () => {
    expect(label("repo", { action: "push", branch: "fenna/fix" }, "crew", "ada")).toBe("Asked to push fenna/fix");
    expect(label("repo", { action: "link", path: "D:\\code\\shop" }, "crew", "ada")).toBe("Asked to work on D:\\code\\shop");
    expect(label("github", { action: "pr_create", title: "Fix the cart" }, "crew", "ada")).toBe("Asked to open a pull request: Fix the cart");
    expect(label("github", { action: "issue", number: 12 }, "crew", "ada")).toBe("Read issue #12");
    expect(label("app_windows", { action: "capture", window: "w2" }, "crew", "ada")).toBe("Looked at w2");
    expect(label("app_windows", { action: "list" }, "crew", "ada")).toBe("Looked at the open app windows");
    expect(label("team", { action: "assign", bot: "builder-2", role: "builder" }, "crew", "ada")).toBe("Asked to make builder-2 the builder");
  });
});

describe("Codex's own shell and edits", () => {
  const profile = { id: "crew", note: "", toolLabel: (tool: string, p: Record<string, unknown>, server: string) => label(tool, p, server, "ada") };

  it("shows a command running, then done or failed by its exit code", () => {
    const ev: Record<string, unknown>[] = [];
    const p = _test.makeParser(profile, "codex", (e) => ev.push(e));
    p.line({ type: "item.started", item: { id: "c1", type: "command_execution", command: "npm test", status: "in_progress" } });
    p.line({ type: "item.completed", item: { id: "c1", type: "command_execution", command: "npm test", exit_code: 0, status: "completed", aggregated_output: "PASS" } });
    p.line({ type: "item.completed", item: { id: "c2", type: "command_execution", command: "npm run lint", exit_code: 1, status: "failed" } });
    const tools = ev.filter((e) => e.type === "tool");
    expect(tools.map((t) => [t.id, t.label, t.status])).toEqual([
      ["c1", "Ran npm test", "running"],
      ["c1", "Ran npm test", "done"],
      ["c2", "Ran npm run lint", "failed"],
    ]);
  });

  it("shows a file change", () => {
    const ev: Record<string, unknown>[] = [];
    const p = _test.makeParser(profile, "codex", (e) => ev.push(e));
    p.line({ type: "item.completed", item: { id: "f1", type: "file_change", changes: [{ path: "src/add.js", kind: "update" }], status: "completed" } });
    expect(ev.find((e) => e.type === "tool")).toMatchObject({ id: "f1", label: "Edited add.js", status: "done" });
  });
});

describe("a command's label leaves out the folder change", () => {
  it("shows the program, not the path", () => {
    expect(label("Bash", { command: 'cd "C:/Users/me/AppData/Roaming/Fenna Crew/Crew/bots/builder/workspace/Repos/calc" && node test.js' }, "", "ada")).toBe("Ran node test.js");
    expect(label("Bash", { command: "cd calc; npm test" }, "", "ada")).toBe("Ran npm test");
    expect(label("Bash", { command: "npm test" }, "", "ada")).toBe("Ran npm test");
  });
});
