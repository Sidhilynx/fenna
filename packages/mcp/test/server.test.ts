import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index.ts";

const sample = fileURLToPath(new URL("../../../examples/sample-deck", import.meta.url));
let dir: string;
let client: Client;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fenna-slides-mcp-"));
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

const slide = (id: string, body = `<h2 style="font-size:72px">Hello</h2>`) => `<section id="${id}" style="background:var(--paper);padding:128px">${body}</section>`;

describe("Fenna Slides MCP server", () => {
  it("lists its tools and sends instructions", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["arrange_slides", "check_slide", "comment", "deck_overview", "delete_slides", "edit_slide", "format_guide", "read_comments", "read_slides", "update_deck", "write_slide", "write_slides"]);
    expect(client.getInstructions()).toMatch(/deck_overview/);
  });

  it("gives an overview with titles", async () => {
    const o = JSON.parse((await call("deck_overview")).text);
    expect(o.title).toBe("Fenna — Sample Deck");
    expect(o.slides[0]).toMatchObject({ n: 1, id: "cover", title: "Every AI tool, for every model.", errors: 0 });
    expect(o.theme.colors.accent).toBe("#ff6b35");
  });

  it("refuses a bad slide with line-numbered problems and writes nothing", async () => {
    const r = await call("write_slide", { id: "bad", html: `<section id="bad" style="background:#fff">\n<p style="margin:10px;z-index:2">x</p>\n<h5>no</h5></section>` });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/line 2:1 .*z-index is not supported/);
    expect(r.text).toMatch(/line 3:1 .*<h5>/);
    expect(await readFile(path.join(dir, "slides/bad.html"), "utf8").catch(() => null)).toBeNull();
  });

  it("creates a slide after a given one, in canonical form", async () => {
    const r = await call("write_slide", { id: "new-one", html: slide("new-one"), after: "cover" });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/Created slide "new-one"/);
    const deck = JSON.parse(await readFile(path.join(dir, "deck.json"), "utf8"));
    expect(deck.slides.slice(0, 3)).toEqual(["cover", "new-one", "problem"]);
    expect(await readFile(path.join(dir, "slides/new-one.html"), "utf8")).toBe(
      `<section id="new-one" style="background:var(--paper);padding:128px">\n  <h2 style="font-size:72px">Hello</h2>\n</section>\n`,
    );
  });

  it("writes several slides in one call, in order, saving the valid ones", async () => {
    const r = await call("write_slides", { slides: [{ id: "a1", html: slide("a1"), after: "cover" }, { id: "a2", html: `<section id="a2" style="background:#fff"><h5>x</h5></section>` }, { id: "a3", html: slide("a3") }] });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/Created "a1"/);
    expect(r.text).toMatch(/NOT saved "a2"[^]*<h5>/);
    const deck = JSON.parse(await readFile(path.join(dir, "deck.json"), "utf8"));
    expect(deck.slides.slice(0, 4)).toEqual(["cover", "a1", "a3", "problem"]);
  });

  it("refuses to overwrite a slide someone changed since it was read", async () => {
    const version = (await call("read_slides", { ids: ["statement"] })).text.match(/version (\w+)/)![1];
    await writeFile(path.join(dir, "slides/statement.html"), slide("statement", "<p>edited by hand</p>"));
    const r = await call("write_slide", { id: "statement", html: slide("statement"), expected_version: version });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/changed since you read it/);
  });

  it("rejects an id mismatch and an unknown theme color", async () => {
    expect((await call("write_slide", { id: "a", html: slide("b") })).text).toMatch(/id must be "a"/);
    expect((await call("write_slide", { id: "a", html: `<section id="a" style="background:var(--nope)"></section>` })).text).toMatch(/no color --nope/);
  });

  it("deletes slides and moves their sections", async () => {
    await call("delete_slides", { ids: ["how"] });
    const deck = JSON.parse(await readFile(path.join(dir, "deck.json"), "utf8"));
    expect(deck.slides).not.toContain("how");
    expect(deck.sections.map((s: { start: string }) => s.start)).toEqual(["cover", "roadmap"]);
  });

  it("reorders only with a full permutation", async () => {
    expect((await call("arrange_slides", { order: ["cover"] })).isError).toBe(true);
    const order = ["business", "cover", "problem", "statement", "how", "roadmap"];
    expect((await call("arrange_slides", { order })).isError).toBe(false);
    expect(JSON.parse(await readFile(path.join(dir, "deck.json"), "utf8")).slides).toEqual(order);
  });

  it("won't remove a theme color slides still use", async () => {
    const r = await call("update_deck", { theme: { colors: { ink: "#000000" } } });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/would break slides/);
    const ok = await call("update_deck", { title: "Renamed" });
    expect(JSON.parse(ok.text).title).toBe("Renamed");
  });

  it("runs as a real stdio process under plain node (how AI clients launch it)", async () => {
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const env = { ...process.env } as Record<string, string>;
    delete env.ELECTRON_RUN_AS_NODE;
    const transport = new StdioClientTransport({ command: process.execPath, args: [cli, `--deck=${dir}`], env, stderr: "pipe" });
    const c = new Client({ name: "stdio-test", version: "0" });
    await c.connect(transport);
    const r = (await c.callTool({ name: "deck_overview", arguments: {} })) as { content: { text: string }[] };
    expect(JSON.parse(r.content[0]!.text).slides).toHaveLength(6);
    await c.close();
  }, 20_000);

  it("reads slides as the text on disk, ready to quote", async () => {
    const r = await call("read_slides", { ids: ["roadmap", "statement"] });
    const onDisk = await readFile(path.join(dir, "slides/roadmap.html"), "utf8");
    expect(r.text).toContain(`=== slide "roadmap" (version `);
    expect(r.text).toContain(onDisk.trimEnd());
    expect(r.text).toContain(`=== slide "statement"`);
    expect((await call("read_slides", { ids: ["nope"] })).text).toMatch(/no slide "nope"/);
  });

  describe("edit_slide", () => {
    it("replaces exact text and keeps the rest of the slide byte for byte", async () => {
      // A save writes the canonical form; start from one, as any slide the app or an AI saved is.
      await call("edit_slide", { id: "roadmap", edits: [{ find: "First", with: "First" }] });
      const before = await readFile(path.join(dir, "slides/roadmap.html"), "utf8");
      const r = await call("edit_slide", { id: "roadmap", edits: [{ find: "<b>Sheets</b>", with: "<b>Notes</b>" }, { find: "Spreadsheets with formulas", with: "Notes that link to slides" }] });
      expect(r.isError).toBe(false);
      expect(r.text).toMatch(/Saved slide "roadmap"/);
      const after = await readFile(path.join(dir, "slides/roadmap.html"), "utf8");
      expect(after).toBe(before.replace("<b>Sheets</b>", "<b>Notes</b>").replace("Spreadsheets with formulas", "Notes that link to slides"));
    });

    it("refuses a missing or ambiguous find, saving nothing, and says how to fix it", async () => {
      const before = await readFile(path.join(dir, "slides/roadmap.html"), "utf8");
      const missing = await call("edit_slide", { id: "roadmap", edits: [{ find: "First", with: "1st" }, { find: "Not on the slide", with: "x" }] });
      expect(missing.isError).toBe(true);
      expect(missing.text).toMatch(/edit 2: "Not on the slide" is not in slide "roadmap".*Copy it exactly from read_slides/);
      const twice = await call("edit_slide", { id: "roadmap", edits: [{ find: "<td>", with: "<td>!" }] });
      expect(twice.isError).toBe(true);
      expect(twice.text).toMatch(/appears 16 times.*pass nth \(1 to 16\)/);
      expect(await readFile(path.join(dir, "slides/roadmap.html"), "utf8")).toBe(before);
    });

    it("picks the nth match", async () => {
      expect((await call("edit_slide", { id: "roadmap", edits: [{ find: "background:var(--card)", with: "background:var(--line)", nth: 2 }] })).isError).toBe(false);
      const after = await readFile(path.join(dir, "slides/roadmap.html"), "utf8");
      expect(after.match(/background:var\(--card\)/g)).toHaveLength(1);
      expect(after.indexOf("var(--line)")).toBeGreaterThan(after.indexOf("var(--card)"));
    });

    it("checks the result like any write", async () => {
      const r = await call("edit_slide", { id: "roadmap", edits: [{ find: "font-size:32px", with: "font-size:32px;z-index:3" }] });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/z-index is not supported/);
    });

    it("refuses when the slide changed since it was read", async () => {
      const version = (await call("read_slides", { ids: ["roadmap"] })).text.match(/version (\w+)/)![1];
      await call("edit_slide", { id: "roadmap", edits: [{ find: "First", with: "1st" }] });
      const r = await call("edit_slide", { id: "roadmap", edits: [{ find: "Second", with: "2nd" }], expected_version: version });
      expect(r.text).toMatch(/changed since you read it/);
    });
  });

  describe("comments", () => {
    it("the sample deck's threads anchor on the words they were left on", async () => {
      const threads = JSON.parse((await call("read_comments")).text);
      expect(threads.map((t: { thread: string; on: { words: string } }) => [t.thread, t.on.words])).toEqual([
        ["cover-name", "[Product name] · Open source"],
        ["shorter-card", "Each lab ships its own slides, docs and canvases."],
        ["notes-row", "Sheets"],
      ]);
      expect(threads[0].comments.map((c: { by: string }) => c.by)).toEqual(["user", "assistant"]);
    });

    it("starts a thread on the element a quote names, and the app finds it", async () => {
      await rm(path.join(dir, "comments.json"), { force: true });
      const r = await call("comment", { slide: "roadmap", quote: "spreadsheets with  formulas", text: "Is this still planned?" });
      expect(r.text).toMatch(/Started thread/);
      const file = JSON.parse(await readFile(path.join(dir, "comments.json"), "utf8"));
      expect(file.threads[0]).toMatchObject({ slide: "roadmap", snippet: "Spreadsheets with formulas", resolved: false });
      expect(file.threads[0].comments[0]).toMatchObject({ author: "ai", text: "Is this still planned?" });
      const threads = JSON.parse((await call("read_comments")).text);
      expect(threads[0]).toMatchObject({ slide: "roadmap", n: 5, on: { element: "td", words: "Spreadsheets with formulas" } });
      const o = JSON.parse((await call("deck_overview")).text);
      expect(o.slides.find((s: { id: string }) => s.id === "roadmap").comments).toBe(1);
    });

    it("comments on the whole slide without a quote, and refuses quotes that miss or match twice", async () => {
      await rm(path.join(dir, "comments.json"), { force: true });
      expect((await call("comment", { slide: "cover", text: "Love this" })).isError).toBe(false);
      expect(JSON.parse((await call("read_comments", { slide: "cover" })).text)[0].on).toBe("the whole slide");
      const miss = await call("comment", { slide: "cover", quote: "not there", text: "x" });
      expect(miss.text).toMatch(/no element on slide "cover" reads "not there"/);
      const many = await call("comment", { slide: "roadmap", quote: "canvas", text: "x" });
      expect(many.text).toMatch(/is in 3 elements on slide "roadmap".*Quote more/);
    });

    it("replies to a person's thread and resolves only when asked", async () => {
      const thread = { id: "t1", slide: "roadmap", addr: "1.4.1", snippet: "Sheets", resolved: false, comments: [{ id: "c1", author: "you", text: "Rename to Notes", at: 1 }] };
      await writeFile(path.join(dir, "comments.json"), JSON.stringify({ version: 1, threads: [thread] }));
      const [read] = JSON.parse((await call("read_comments")).text);
      expect(read).toMatchObject({ thread: "t1", on: { element: "td", words: "Sheets" }, comments: [{ by: "user", text: "Rename to Notes" }] });
      await call("comment", { thread: "t1", text: "Renamed." });
      let file = JSON.parse(await readFile(path.join(dir, "comments.json"), "utf8"));
      expect(file.threads[0].resolved).toBe(false);
      expect(file.threads[0].comments.map((c: { text: string }) => c.text)).toEqual(["Rename to Notes", "Renamed."]);
      await call("comment", { thread: "t1", resolve: true });
      file = JSON.parse(await readFile(path.join(dir, "comments.json"), "utf8"));
      expect(file.threads[0].resolved).toBe(true);
      expect(JSON.parse((await call("read_comments")).text)).toEqual([]);
      expect(JSON.parse((await call("read_comments", { include_resolved: true })).text)).toHaveLength(1);
      expect((await call("comment", { thread: "nope", text: "x" })).text).toMatch(/no thread "nope"/);
      expect((await call("comment", { thread: "t1" })).text).toMatch(/text is empty/);
    });
  });

  it("the guide documents every property", async () => {
    const g = (await call("format_guide")).text;
    for (const p of ["grid-template-columns", "backdrop-filter", "object-fit", "letter-spacing"]) expect(g).toContain(p);
  });
});
