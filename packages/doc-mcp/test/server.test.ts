import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, versionOf } from "../src/index.ts";

const sample = fileURLToPath(new URL("../../../examples/sample-doc", import.meta.url));
let dir: string;
let client: Client;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "opendoc-mcp-"));
  await cp(sample, dir, { recursive: true });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(dir).connect(a);
  client = new Client({ name: "test", version: "0" });
  await client.connect(b);
});

afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: r.content[0]!.text, isError: !!r.isError };
}
const tab = (id: string) => readFile(path.join(dir, "tabs", `${id}.html`), "utf8");

describe("Fenna Docs MCP server", () => {
  it("lists its tools and sends instructions", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["check_tab", "comment", "delete_tab", "doc_overview", "edit_blocks", "format_guide", "read_comments", "read_tab", "update_doc", "write_tab"]);
    expect(client.getInstructions()).toMatch(/edit_blocks/);
  });

  it("gives an overview with each tab's outline", async () => {
    const o = JSON.parse((await call("doc_overview")).text);
    expect(o.title).toBe("Fenna Docs launch plan");
    expect(o.tabs.map((t: { id: string; depth: number }) => `${t.id}:${t.depth}`)).toEqual(["overview:0", "plan:0", "risks:1", "notes:0"]);
    expect(o.tabs[0].outline[0]).toEqual({ id: "why", level: 1, text: "Why a local doc editor" });
    expect(o.tabs.every((t: { problems: string[] }) => t.problems.length === 0)).toBe(true);
  });

  it("the guide names every block", async () => {
    const g = (await call("format_guide")).text;
    for (const tag of ["h1", "p", "ul", "ol", "blockquote", "pre", "hr", "table", "figure"]) expect(g).toContain(`<${tag}>`);
  });

  it("replaces, inserts and deletes blocks, leaving the rest byte for byte", async () => {
    const before = await tab("overview");
    const r = await call("edit_blocks", {
      tab: "overview",
      edits: [
        { op: "replace", block: "why-1", html: "<p>Shorter.</p>" },
        { op: "insert_after", block: "why", html: "<p>New first line.</p><p>And a second.</p>" },
        { op: "delete", block: "quote" },
      ],
    });
    expect(r.isError).toBe(false);
    const after = await tab("overview");
    expect(after).toContain(`<p id="why-1">Shorter.</p>`);
    expect(after).not.toContain(`id="quote"`);
    const kept = before.split("\n").filter((l) => !/id="(why-1|quote)"/.test(l));
    for (const line of kept) expect(after).toContain(line);
    expect(after.indexOf("New first line")).toBeGreaterThan(after.indexOf(`id="why"`));
  });

  it("refuses all edits when one is bad", async () => {
    const before = await tab("overview");
    const r = await call("edit_blocks", { tab: "overview", edits: [{ op: "replace", block: "intro", html: "<p>ok</p>" }, { op: "replace", block: "nope", html: "<p>x</p>" }] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/no block "nope"/);
    expect(await tab("overview")).toBe(before);
    const bad = await call("edit_blocks", { tab: "overview", edits: [{ op: "append", html: `<div style="x">hi</div>` }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/edit 1/);
  });

  it("changes quoted words in place, keeping the block's id and every other line", async () => {
    const before = await tab("overview");
    const r = await call("edit_blocks", { tab: "overview", edits: [{ op: "replace_text", find: "<b>one HTML file per tab</b>", with: "<b>one HTML file for each tab</b>" }] });
    expect(r.isError).toBe(false);
    const after = await tab("overview");
    expect(after).toContain('<p id="why-1">Most writing tools');
    expect(after).toContain("<b>one HTML file for each tab</b>");
    for (const line of before.split("\n").filter((l) => !l.includes('id="why-1"'))) expect(after).toContain(line);
  });

  it("refuses a quote that is missing or ambiguous, saying how to fix it", async () => {
    const before = await tab("overview");
    const missing = await call("edit_blocks", { tab: "overview", edits: [{ op: "replace_text", find: "one html file", with: "x" }] });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/not in tab "overview".*exactly as read_tab shows it/);
    const many = await call("edit_blocks", { tab: "overview", edits: [{ op: "replace_text", find: "Fenna Docs", with: "Fenna" }] });
    expect(many.isError).toBe(true);
    expect(many.text).toMatch(/appears \d+ times.*nth/);
    expect(await tab("overview")).toBe(before);
    const second = await call("edit_blocks", { tab: "overview", edits: [{ op: "replace_text", find: "Fenna Docs", with: "Fenna", nth: 2 }] });
    expect(second.isError).toBe(false);
    const broken = await call("edit_blocks", { tab: "overview", edits: [{ op: "replace_text", find: "</b>", with: "" }] });
    expect(broken.isError).toBe(true);
  });

  it("saves edits as the AI's suggestions while the doc is in Suggesting mode", async () => {
    const index = JSON.parse(await readFile(path.join(dir, "doc.json"), "utf8"));
    await writeFile(path.join(dir, "doc.json"), JSON.stringify({ ...index, suggesting: true }));
    expect(JSON.parse((await call("doc_overview")).text).suggesting).toBe(true);
    const r = await call("edit_blocks", { tab: "overview", edits: [{ op: "replace_text", find: "while you watch", with: "as you watch" }, { op: "delete", block: "quote" }] });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/Suggesting mode/);
    const after = await tab("overview");
    expect(after).toMatch(/<del data-sid="s[0-9a-f]{8}" data-by="ai" data-at="\d+">while<\/del><ins [^>]*data-by="ai"[^>]*>as<\/ins> you watch/);
    expect(after).toMatch(/<blockquote id="quote"><del [^>]*>The doc should outlive/);
    const updated = await call("update_doc", { title: "Renamed" });
    expect(JSON.parse(updated.text).saved).toBe(true);
    expect(JSON.parse(await readFile(path.join(dir, "doc.json"), "utf8")).suggesting).toBe(true);
  });

  it("starts, lists, replies to and resolves comment threads", async () => {
    const bad = await call("comment", { tab: "overview", block: "intro", quote: "not these words", text: "?" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/exactly as they read/);
    const started = await call("comment", { tab: "overview", block: "intro", quote: "your own computer", text: "Which platforms?" });
    expect(started.isError).toBe(false);
    const t = JSON.parse((await call("read_comments", { tab: "overview" })).text).find((x: { block: string }) => x.block === "intro");
    expect(t).toMatchObject({ tab: "overview", block: "intro", quote: "your own computer", resolved: false });
    expect(t.comments[0]).toMatchObject({ by: "assistant", text: "Which platforms?" });
    await call("comment", { thread: t.thread, text: "Windows, macOS and Linux.", resolve: true });
    expect(JSON.parse((await call("read_comments")).text).some((x: { thread: string }) => x.thread === t.thread)).toBe(false);
    const mine = JSON.parse((await call("read_comments", { include_resolved: true })).text).find((x: { thread: string }) => x.thread === t.thread);
    expect(mine.comments).toHaveLength(2);
    expect(mine.resolved).toBe(true);
    expect((await call("comment", { thread: "nope", text: "x" })).text).toMatch(/read_comments lists them/);
    expect((await call("comment", { text: "x" })).text).toMatch(/give tab and block/);
  });

  it("refuses to overwrite a tab someone changed since it was read", async () => {
    const { version } = JSON.parse((await call("read_tab", { id: "notes" })).text);
    await writeFile(path.join(dir, "tabs", "notes.html"), `<article id="notes">\n<p id="x">user typed</p>\n</article>\n`);
    const r = await call("edit_blocks", { tab: "notes", edits: [{ op: "append", html: "<p>ai</p>" }], expected_version: version });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/changed since you read it/);
    const now = JSON.parse((await call("read_tab", { id: "notes" })).text);
    expect(now.version).toBe(versionOf(await tab("notes")));
  });

  it("creates a tab under a parent, and deletes a tab with its children", async () => {
    const r = await call("write_tab", { id: "faq", title: "FAQ", parent: "plan", html: `<article id="faq"><h1>Questions</h1><p>Answers.</p></article>` });
    expect(r.isError).toBe(false);
    const o = JSON.parse((await call("doc_overview")).text);
    expect(o.tabs.find((t: { id: string }) => t.id === "faq")).toMatchObject({ parent: "plan", depth: 1, title: "FAQ" });
    expect(await tab("faq")).toMatch(/^<article id="faq">\n<h1 id="[a-z][a-z0-9]{5}">Questions<\/h1>/);
    await call("delete_tab", { id: "plan" });
    const o2 = JSON.parse((await call("doc_overview")).text);
    expect(o2.tabs.map((t: { id: string }) => t.id)).toEqual(["overview", "notes"]);
    expect(await tab("risks").catch(() => null)).toBeNull();
  });

  it("refuses a bad tab with line-numbered problems and writes nothing", async () => {
    const r = await call("write_tab", { id: "bad", html: `<article id="bad">\n<p style="color:red">x</p>\n<h5>no</h5>\n</article>` });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/line 2:1 .*no inline styles/);
    expect(r.text).toMatch(/line 3:1 .*<h5>/);
    expect(await tab("bad").catch(() => null)).toBeNull();
  });

  it("won't remove a dropdown option a tab uses", async () => {
    const r = await call("update_doc", { dropdowns: [{ id: "status", name: "Status", options: [{ id: "done", label: "Done", color: "green" }] }] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/would break tabs/);
    const ok = await call("update_doc", { title: "Renamed", fonts: { headings: "sans" }, wide: true });
    expect(JSON.parse(ok.text)).toMatchObject({ title: "Renamed", fonts: { headings: "sans", text: "sans" }, wide: true });
  });

  it("reorders tabs only with every tab listed once", async () => {
    const bad = await call("update_doc", { tabs: [{ id: "overview", title: "Overview" }] });
    expect(bad.isError).toBe(true);
    const ok = await call("update_doc", { tabs: [{ id: "notes", title: "Notes" }, { id: "overview", title: "Overview" }, { id: "plan", title: "Plan" }, { id: "risks", title: "Risks" }] });
    expect(ok.isError).toBe(false);
    const o = JSON.parse((await call("doc_overview")).text);
    expect(o.tabs.map((t: { id: string; depth: number }) => `${t.id}:${t.depth}`)).toEqual(["notes:0", "overview:0", "plan:0", "risks:0"]);
  });

  it("runs as a real stdio process under plain node (how AI clients launch it)", async () => {
    const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const transport = new StdioClientTransport({ command: process.execPath, args: ["--experimental-strip-types", "--no-warnings", cli, `--doc=${dir}`] });
    const c = new Client({ name: "stdio-test", version: "0" });
    await c.connect(transport);
    const r = (await c.callTool({ name: "doc_overview", arguments: {} })) as { content: { text: string }[] };
    expect(JSON.parse(r.content[0]!.text).tabs).toHaveLength(4);
    await c.close();
  }, 20_000);
});
