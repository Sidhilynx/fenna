import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PROPERTIES } from "@opendeck/artboard";
import { readDesignFolder } from "@opendeck/artboard/node";
import { createServer, formatGuide } from "../src/index.ts";

const sample = fileURLToPath(new URL("../../../examples/sample-design", import.meta.url));
let dir: string;
let client: Client;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fenna-design-mcp-"));
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
const onDisk = (rel: string) => readFile(path.join(dir, rel), "utf8");
const version = async (file: string) => /version ([0-9a-f]{12})/.exec((await call("read_artboards", { files: [file] })).text)![1]!;
const POST = '<div style="width:1080px;height:1080px;padding:96px;background:#f4f1ea"><h1 data-style="Heading 1" style="margin:0;color:var(--accent)">Open studio</h1></div>';

describe("the tools", () => {
  it("are few, each described for the model with an example where it takes arguments", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["design_overview", "format_guide", "read_artboards", "edit_artboard", "write_artboard", "check_artboard", "delete_artboards", "arrange_artboards", "read_comments", "comment", "update_design"]);
    for (const t of tools) expect(t.description!.length, t.name).toBeGreaterThan(60);
    for (const name of ["read_artboards", "edit_artboard", "write_artboard", "arrange_artboards", "comment", "update_design"]) expect(tools.find((t) => t.name === name)!.description, name).toContain("Example:");
  });

  it("generates the guide from the schema: every property is in it", () => {
    const guide = formatGuide();
    for (const name of Object.keys(PROPERTIES)) expect(guide, name).toContain(`  ${name}`);
    expect(guide).toContain("flex-direction: row | column | row-reverse | column-reverse");
    expect(guide).toContain("Social 1080×1080");
  });
});

describe("reading", () => {
  it("gives the overview: pages, artboards with place and size, comments, tweaks", async () => {
    const o = JSON.parse((await call("design_overview")).text);
    expect(o.title).toBe("Design demo");
    expect(o.pages).toEqual([{ id: "page-1", name: "Page 1" }, { id: "page-mobile", name: "Mobile" }]);
    expect(o.artboards).toEqual([
      { file: "Card.html", title: "Card", page: "page-1", x: 80, y: 80, w: 880, h: 420, comments: 1, errors: 0, warnings: 0 },
      { file: "Landing.html", title: "Landing", page: "page-1", x: 1040, y: 80, w: 1280, h: 920, expand: "fill", comments: 0, errors: 0, warnings: 0 },
    ]);
    expect(o.tweaks).toEqual({ "--accent": "#d97757" });
    expect(o.stickyNotes).toHaveLength(1);
  });

  it("reads an artboard as its root element, without the generated head", async () => {
    const r = await call("read_artboards", { files: ["card"] });
    expect(r.text).toMatch(/^=== "Card.html" · Card · 880×420 \(version [0-9a-f]{12}\) ===\n<div style="width:880px;height:420px;/);
    expect(r.text).not.toContain("<style>");
    expect(r.text.trimEnd().endsWith("</div>")).toBe(true);
  });

  it("names the artboards there are when one is not found", async () => {
    const r = await call("read_artboards", { files: ["Nope.html"] });
    expect(r.isError).toBe(true);
    expect(r.text).toBe('there is no artboard "Nope.html". The artboards are: Card.html, Landing.html');
  });
});

describe("edit_artboard", () => {
  it("replaces exact text and leaves the rest of the file as it was", async () => {
    const before = await onDisk("artboards/Card.html");
    const r = await call("edit_artboard", { file: "Card.html", edits: [{ find: "Hello from a canvas", with: "Hello, world" }], expected_version: await version("Card.html") });
    expect(r.text).toMatch(/^Saved "Card.html" \(version [0-9a-f]{12}, 880×420\)\.$/);
    expect(await onDisk("artboards/Card.html")).toBe(before.replace("Hello from a canvas", "Hello, world"));
    expect(await onDisk("artboards/Landing.html")).toBe(await readFile(path.join(sample, "artboards/Landing.html"), "utf8"));
  });

  it("refuses a find that is missing or not unique, saying what to do, and saves nothing", async () => {
    const before = await onDisk("artboards/Card.html");
    const missing = await call("edit_artboard", { file: "Card.html", edits: [{ find: "Hello from a canvas", with: "x" }, { find: "not there", with: "y" }] });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('edit 2: "not there" is not in "Card.html" (after the edits before it)');
    const twice = await call("edit_artboard", { file: "Card.html", edits: [{ find: "margin:0", with: "margin:4px" }] });
    expect(twice.text).toMatch(/appears 4 times in "Card.html"\. Quote more around it so it is unique, or pass nth \(1 to 4\)/);
    expect(await onDisk("artboards/Card.html")).toBe(before);
    expect((await call("edit_artboard", { file: "Card.html", edits: [{ find: "margin:0", with: "margin:4px", nth: 2 }] })).isError).toBe(false);
  });

  it("refuses an edit that breaks the format, with the line and the fix", async () => {
    const before = await onDisk("artboards/Card.html");
    const r = await call("edit_artboard", { file: "Card.html", edits: [{ find: "color:#403e38", with: "colour:red" }] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/"Card.html" was not saved: 1 problem\. Fix it and write again\n- line 8:\d+ \(div > div:2 > p:1\) colour is not a property of the design format\. Did you mean color\?/);
    expect(await onDisk("artboards/Card.html")).toBe(before);
  });

  it("refuses a stale version", async () => {
    const v = await version("Card.html");
    await call("edit_artboard", { file: "Card.html", edits: [{ find: "Card 01", with: "Card 02" }] });
    const r = await call("edit_artboard", { file: "Card.html", edits: [{ find: "Card 02", with: "Card 03" }], expected_version: v });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("changed since you read it");
  });

  it("follows a size change made in the HTML", async () => {
    await call("edit_artboard", { file: "Card.html", edits: [{ find: "width:880px;height:420px", with: "width:900px;height:500px" }] });
    expect(readDesignFolder(dir).index.boards["Card.html"]).toMatchObject({ w: 900, h: 500, x: 80, y: 80 });
  });
});

describe("write_artboard", () => {
  it("creates an artboard beside the others, sized from its root, with the design's tweaks in its head", async () => {
    const r = await call("write_artboard", { file: "Post.html", title: "Social post", html: POST });
    expect(r.text).toMatch(/^Created "Post.html" \(version [0-9a-f]{12}\): "Social post", 1080×1080 at 2400,80 on page page-1\.$/);
    const d = readDesignFolder(dir);
    expect(d.problems).toEqual([]);
    expect(d.index.order).toEqual(["Card.html", "Landing.html", "Post.html"]);
    const file = await onDisk("artboards/Post.html");
    expect(file).toContain("<title>Social post</title>");
    expect(file).toContain("--accent: #d97757;");
  });

  it("places by page name, position and order when asked", async () => {
    const r = await call("write_artboard", { file: "Settings", html: '<div style="width:390px;height:844px"></div>', page: "mobile", after: "start", x: 0, y: 0 });
    expect(r.text).toContain('"Settings", 390×844 at 0,0 on page page-mobile');
    expect(readDesignFolder(dir).index.order[0]).toBe("Settings.html");
    const bad = await call("write_artboard", { file: "X.html", html: POST, page: "Tablet" });
    expect(bad.text).toContain('there is no page "Tablet". The pages are: page-1 ("Page 1"), page-mobile ("Mobile")');
    expect(existsSync(path.join(dir, "artboards/X.html"))).toBe(false);
  });

  it("makes a page grow with its content when expand is fill", async () => {
    await call("write_artboard", { file: "Docs.html", html: '<div style="width:1280px;height:800px"></div>', expand: "fill" });
    expect(await onDisk("artboards/Docs.html")).toContain('<div style="width:1280px;min-height:800px"></div>');
    expect(readDesignFolder(dir).index.boards["Docs.html"]).toMatchObject({ w: 1280, h: 800, expand: "fill" });
  });

  it("replaces a whole artboard, keeping its place and title", async () => {
    await call("write_artboard", { file: "Card.html", html: '<div style="width:880px;height:420px;background:#000000"></div>' });
    expect(readDesignFolder(dir).index.boards["Card.html"]).toEqual({ x: 80, y: 80, w: 880, h: 420, title: "Card", page: "page-1" });
  });

  it("refuses invalid HTML and bad file names without writing anything", async () => {
    const r = await call("write_artboard", { file: "Bad.html", html: "<div><script>alert(1)</script><p>ok</p></div>" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("<script> is not part of the design format (artboards hold no scripts");
    expect(existsSync(path.join(dir, "artboards/Bad.html"))).toBe(false);
    expect((await call("write_artboard", { file: "../evil", html: POST })).text).toContain("can't be a file name");
    expect((await call("check_artboard", { html: POST })).text).toBe("No problems.");
    expect((await call("check_artboard", { html: "<div>loose</div>" })).text).toContain("must be wrapped in <p>");
  });

  it("repairs a damaged file only by a whole valid write, and shows it whole until then", async () => {
    await writeFile(path.join(dir, "artboards/Card.html"), "<div><iframe></iframe></div>");
    const read = await call("read_artboards", { files: ["Card.html"] });
    expect(read.text).toContain("<div><iframe></iframe></div>\nProblems:\n- line 1:6 (div > iframe:1) <iframe> is not part of the design format");
    const o = JSON.parse((await call("design_overview")).text);
    expect(o.artboards[0]).toMatchObject({ file: "Card.html", errors: 1 });
    expect((await call("edit_artboard", { file: "Card.html", edits: [{ find: "<iframe></iframe>", with: "<p>Fixed</p>" }] })).isError).toBe(false);
    expect(readDesignFolder(dir).problems).toEqual([]);
  });
});

describe("arranging and deleting", () => {
  it("moves, resizes and renames without touching content, and resizes the root with the artboard", async () => {
    const r = await call("arrange_artboards", { artboards: [{ file: "Card.html", x: 0, w: 900, title: "Card" }], order: ["Landing.html", "Card.html"] });
    expect(r.text).toContain("Card.html: 900×420 at 0,80 on page-1");
    const d = readDesignFolder(dir);
    expect(d.index.order).toEqual(["Landing.html", "Card.html"]);
    expect(d.boards.get("Card.html")!.source).toContain('<title>Card</title>');
    expect(d.boards.get("Card.html")!.source).toContain("width:900px;height:420px");
    expect((await call("arrange_artboards", { order: ["Card.html"] })).text).toContain("order must list every artboard exactly once");
    expect((await call("arrange_artboards", {})).isError).toBe(true);
  });

  it("deletes artboards and their files", async () => {
    expect((await call("delete_artboards", { files: ["Landing.html"] })).text).toBe("Deleted Landing.html.");
    expect(existsSync(path.join(dir, "artboards/Landing.html"))).toBe(false);
    expect(readDesignFolder(dir).index.order).toEqual(["Card.html"]);
  });
});

describe("comments", () => {
  it("shows the open thread with the layer it is on, and takes a reply", async () => {
    const threads = JSON.parse((await call("read_comments")).text);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ thread: "t-card-copy", file: "Card.html", artboard: "Card", resolved: false });
    expect(threads[0].on.layer).toBe("Text “This is one artboard. Edit the text, or…”");
    expect(threads[0].on.html).toContain("<p style=");
    expect(threads[0].comments).toEqual([{ by: "user", text: "Too long for a card. Shorten this to one short sentence.", at: expect.any(String) }]);
    const reply = await call("comment", { thread: "t-card-copy", text: "Shortened it." });
    expect(reply.text).toBe("Replied in thread t-card-copy (2 comments).");
    expect(JSON.parse(await onDisk("comments.json")).threads[0].comments[1]).toMatchObject({ author: "ai", text: "Shortened it." });
  });

  it("keeps a thread on its layer after the text it quotes is rewritten around it", async () => {
    await call("edit_artboard", { file: "Card.html", edits: [{ find: "<h1 ", with: '<p style="margin:0">New line</p>\n    <h1 ' }] });
    expect(JSON.parse((await call("read_comments", { file: "Card.html" })).text)[0].on.layer).toContain("This is one artboard");
  });

  it("starts a thread on a layer by its words, or on the whole artboard", async () => {
    expect((await call("comment", { file: "Card.html", quote: "Hello from", text: "Is this the final headline?" })).text).toMatch(/^Started thread [\w-]+ \(1 comment\)\.$/);
    expect((await call("comment", { file: "Card.html", quote: "nothing like this", text: "x" })).text).toContain('no layer on "Card.html" reads');
    expect((await call("comment", { file: "Landing.html", text: "Looks good." })).isError).toBe(false);
    const all = JSON.parse((await call("read_comments")).text);
    expect(all.map((t: { on: unknown }) => (typeof t.on === "string" ? t.on : "layer"))).toEqual(["layer", "layer", "the whole artboard"]);
    expect((await call("comment", { text: "x" })).text).toContain("to start a thread give file");
  });
});

describe("update_design", () => {
  it("changes a tweak in design.json and in every artboard's head, and says who uses it", async () => {
    const r = JSON.parse((await call("update_design", { tweaks: { "--accent": "#2563eb" } })).text);
    expect(r.tweaks).toEqual({ "--accent": "#2563eb" });
    expect(r.notes).toEqual(["--accent is used by Card.html, Landing.html"]);
    for (const f of ["Card.html", "Landing.html"]) expect(await onDisk(`artboards/${f}`)).toContain("--accent: #2563eb;");
    expect(readDesignFolder(dir).problems).toEqual([]);
  });

  it("adds a tweak, keeps the others, and notes that nothing uses it yet", async () => {
    const r = JSON.parse((await call("update_design", { tweaks: { ink: "#111111" } })).text);
    expect(r.tweaks).toEqual({ "--accent": "#d97757", "--ink": "#111111" });
    expect(r.notes).toEqual(["no artboard uses var(--ink) yet: edit the layers that should follow it"]);
  });

  it("refuses removing a tweak an artboard uses, a bad value, and a page that still holds artboards", async () => {
    const before = await onDisk("design.json");
    expect((await call("update_design", { tweaks: { "--accent": null } })).text).toMatch(/not saved: this change would break 2 artboards: Card.html: .*the design has no tweak --accent/);
    expect((await call("update_design", { tweaks: { "--accent": "orange" } })).text).toContain("a tweak is a color");
    expect((await call("update_design", { pages: [{ id: "page-mobile", name: "Mobile" }] })).text).toContain('page "Page 1" still holds Card.html, Landing.html');
    expect((await call("update_design", { textStyles: { Body: "padding: 4px;" } })).text).toContain("padding is not a text property");
    expect(await onDisk("design.json")).toBe(before);
  });

  it("renames the design, adds a page and a text style", async () => {
    const r = JSON.parse((await call("update_design", { title: "Launch kit", pages: [{ id: "page-1", name: "Web" }, { id: "page-mobile", name: "Mobile" }, { name: "Social" }], textStyles: { Label: "font-size: 13px; font-weight: 600;" } })).text);
    expect(r.title).toBe("Launch kit");
    expect(r.pages).toEqual([{ id: "page-1", name: "Web" }, { id: "page-mobile", name: "Mobile" }, { id: "page-3", name: "Social" }]);
    expect(await onDisk("artboards/Card.html")).toContain('[data-style="Label"] { font-size: 13px; font-weight: 600; }');
  });
});

describe("a folder with no design yet", () => {
  it("starts empty and takes a first artboard", async () => {
    await rm(path.join(dir, "design.json"));
    await rm(path.join(dir, "artboards"), { recursive: true });
    expect(JSON.parse((await call("design_overview")).text).artboards).toEqual([]);
    expect((await call("write_artboard", { file: "First.html", html: POST })).text).toContain("1080×1080 at 80,80 on page page-1");
    expect(readDesignFolder(dir).problems).toEqual([]);
  });
});
