import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { byId, itemBounds, rectContains, rectsOverlap, type BoardItem, type BoxItem, type FrameItem } from "@opendeck/board";
import { createServer, layoutProblems } from "../src/index.ts";

const sample = fileURLToPath(new URL("../../../examples/sample-board", import.meta.url));
let dir: string;
let client: Client;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fenna-whiteboard-mcp-"));
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
const canvas = async (): Promise<BoardItem[]> => JSON.parse(await readFile(path.join(dir, "canvas.json"), "utf8")).items;
const find = (items: BoardItem[], id: string) => items.find((it) => it.id === id)!;

describe("Fenna Whiteboard MCP server", () => {
  it("offers few tools, each described for the model", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeLessThanOrEqual(10);
    for (const t of tools) expect(t.description!.length, t.name).toBeGreaterThan(60);
  });

  it("reads the board as the file keeps it, with a version, frames and open comments", async () => {
    const r = JSON.parse((await call("read_board")).text);
    expect(r.title).toBe("Product Roadmap");
    expect(r.version).toMatch(/^[0-9a-f]{12}$/);
    expect(r.frames[0]).toMatchObject({ id: "f-themes", title: "Q4 themes", holds: 2 });
    expect(find(r.items, "s-mcp")).toMatchObject({ kind: "sticky", frame: "f-themes" });
    expect(r.openComments).toBe(1);
    expect(r.problems).toEqual([]);
  });

  it("refuses an argument it doesn't take, naming the ones it does", async () => {
    const r = await call("edit_items", { updates: [{ id: "s-mcp", text: "x" }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("it takes items, version");
    const m = await call("arrange", { arrange: [{ id: "f-themes" }] });
    expect(m.text).toContain("arrange needs layout");
  });

  it("adds frames with stickies placed inside them, frames sized to fit, nothing overlapping", async () => {
    const r = await call("add_items", {
      items: [
        { id: "f-went", kind: "frame", title: "Went well", color: "green" },
        { id: "f-improve", kind: "frame", title: "To improve", color: "pink" },
        ...["Fast release", "High test coverage", "Good pairing"].map((text) => ({ kind: "sticky", text, color: "green", frame: "f-went" })),
        ...["Flaky CI", "Long reviews"].map((text) => ({ kind: "sticky", text, color: "pink", frame: "f-improve" })),
      ],
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain("Added 7 items");
    const items = await canvas();
    const all = byId(items);
    for (const fid of ["f-went", "f-improve"]) {
      const f = find(items, fid) as FrameItem;
      const kids = items.filter((it) => it.frame === fid);
      for (const k of kids) expect(rectContains(f, itemBounds(k, all)!), k.id).toBe(true);
    }
    const went = find(items, "f-went") as FrameItem;
    const improve = find(items, "f-improve") as FrameItem;
    expect(rectsOverlap(went, improve)).toBe(false);
    // Beside what was there, not on top of it.
    for (const old of ["f-themes", "s-toolbar", "tb-sprints"]) expect(rectsOverlap(went, itemBounds(find(items, old), all)!), old).toBe(false);
    expect(layoutProblems(items, null)).toEqual([]);
    // Frames come before what they hold.
    expect(items.findIndex((it) => it.id === "f-went")).toBeLessThan(items.findIndex((it) => it.frame === "f-went"));
  });

  it("adds nothing when one item is wrong, and says how to fix each problem", async () => {
    const before = await readFile(path.join(dir, "canvas.json"), "utf8");
    const r = await call("add_items", {
      items: [
        { kind: "sticky", text: "ok" },
        { kind: "sticky", text: "bad", colour: "red" },
        { kind: "shape", shape: "rectangle", text: "x" },
        { kind: "frame", text: "Actions" },
      ],
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Nothing was saved");
    expect(r.text).toContain('did you mean "color"');
    expect(r.text).toContain('did you mean "rect"');
    expect(r.text).toContain('did you mean "title"');
    expect(await readFile(path.join(dir, "canvas.json"), "utf8")).toBe(before);
  });

  it("connects items added in the same call, and lays a flowchart out without overlaps", async () => {
    const add = await call("add_items", {
      items: [
        { id: "start", kind: "shape", shape: "pill", text: "Start" },
        { id: "email", kind: "shape", shape: "rect", text: "Enter email" },
        { id: "valid", kind: "shape", shape: "diamond", text: "Valid?" },
        { id: "create", kind: "shape", shape: "rect", text: "Create account" },
        { id: "end", kind: "shape", shape: "pill", text: "End" },
        { kind: "connector", from: { item: "start" }, to: { item: "email" } },
        { kind: "connector", from: { item: "email" }, to: { item: "valid" } },
        { kind: "connector", from: { item: "valid" }, to: { item: "create" }, label: "yes" },
        { kind: "connector", from: { item: "create" }, to: { item: "end" } },
        { kind: "connector", from: { item: "valid" }, to: { item: "email" }, label: "no" },
      ],
    });
    expect(add.isError, add.text).toBe(false);
    const r = await call("arrange", { ids: ["start", "email", "valid", "create", "end"], layout: "flow" });
    expect(r.isError, r.text).toBe(false);
    const items = await canvas();
    const ys = ["start", "email", "valid", "create", "end"].map((id) => (find(items, id) as BoxItem).y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
    expect(layoutProblems(items, new Set(["start", "email", "valid", "create", "end"]))).toEqual([]);
  });

  it("edits only what it is given; a moved frame takes what it holds along", async () => {
    const r = await call("edit_items", { items: [{ id: "f-themes", x: 200 }, { id: "s-mcp", text: "Expand the MCP tools\nReal-time sync too" }] });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain("Moved what f-themes holds (2 items)");
    const items = await canvas();
    expect((find(items, "s-fast") as BoxItem).x).toBe(230);
    expect(find(items, "s-mcp")).toMatchObject({ text: "Expand the MCP tools\nReal-time sync too", color: "green", author: "Priya" });
  });

  it("puts an item into a frame's next free spot when it is given a frame and no position", async () => {
    await call("add_items", { items: [{ id: "f-room", kind: "frame", title: "Room", x: 1600, y: 100, width: 560, height: 300 }] });
    const r = await call("edit_items", { items: [{ id: "s-shortcuts", frame: "f-room" }, { id: "s-toolbar", frame: "f-room" }] });
    expect(r.isError, r.text).toBe(false);
    const items = await canvas();
    const f = find(items, "f-room") as FrameItem;
    expect(f.width).toBe(560);
    expect(rectContains(f, itemBounds(find(items, "s-toolbar"), byId(items))!)).toBe(true);
    expect(rectContains(f, itemBounds(find(items, "s-shortcuts"), byId(items))!)).toBe(true);
    expect(layoutProblems(items, new Set(["s-shortcuts", "s-toolbar"]))).toEqual([]);
  });

  it("grows a full frame toward the side with room, and reports what it now covers", async () => {
    const r = await call("edit_items", { items: [{ id: "s-shortcuts", frame: "f-themes" }] });
    expect(r.isError, r.text).toBe(false);
    const items = await canvas();
    const f = find(items, "f-themes") as FrameItem;
    expect(f.width).toBeGreaterThan(560);
    expect(f.height).toBe(280);
    expect(rectContains(f, itemBounds(find(items, "s-shortcuts"), byId(items))!)).toBe(true);
    expect(r.text).toContain("Check:");
  });

  it("reports frames that overlap or cover items they don't hold", async () => {
    const r = await call("add_items", { items: [{ id: "f-a", kind: "frame", title: "A", x: 700, y: 140, width: 510, height: 260 }, { id: "f-b", kind: "frame", title: "B", x: 700, y: 370, width: 510, height: 260 }] });
    expect(r.text).toContain("frames f-a and f-b overlap");
    expect(r.text).toContain("frame f-a covers s-shortcuts");
  });

  it("arranges loose stickies into a new frame without touching their words", async () => {
    const add = await call("add_items", { items: [{ id: "f-ui", kind: "frame", title: "Interface" }] });
    expect(add.isError, add.text).toBe(false);
    const before = await canvas();
    const r = await call("arrange", { frame: "f-ui", ids: ["s-shortcuts", "s-toolbar"], layout: "grid" });
    expect(r.isError, r.text).toBe(false);
    const items = await canvas();
    for (const id of ["s-shortcuts", "s-toolbar"]) {
      expect(find(items, id).frame).toBe("f-ui");
      expect((find(items, id) as { text: string }).text).toBe((find(before, id) as { text: string }).text);
    }
    expect(layoutProblems(items, null)).toEqual([]);
  });

  it("refuses a change made against an old version", async () => {
    const { version } = JSON.parse((await call("read_board")).text);
    await call("edit_items", { items: [{ id: "s-fast", color: "pink" }] });
    const r = await call("edit_items", { items: [{ id: "s-fast", color: "blue" }], version });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Call read_board again");
  });

  it("deletes a frame but keeps what it held, and deletes connectors left hanging", async () => {
    const r = await call("delete_items", { ids: ["f-themes", "sh-folder"] });
    expect(r.isError, r.text).toBe(false);
    const items = await canvas();
    expect(find(items, "s-fast").frame).toBeUndefined();
    expect(items.some((it) => it.id === "c-io" || it.id === "c-mcp")).toBe(false);
    expect(r.text).toContain("Also deleted connector c-io");
  });

  it("answers an open comment in its thread, saved where the app reads it", async () => {
    const c = JSON.parse((await call("read_comments")).text);
    expect(c.threads[0]).toMatchObject({ thread: "t-sticky-change", on: { id: "s-mcp", kind: "sticky" } });
    const r = await call("comment", { thread: "t-sticky-change", text: "Added real-time sync to the note.", resolve: true });
    expect(r.isError, r.text).toBe(false);
    const file = JSON.parse(await readFile(path.join(dir, "comments.json"), "utf8"));
    expect(file.threads[0].resolved).toBe(true);
    expect(file.threads[0].comments[1]).toMatchObject({ author: "ai", text: "Added real-time sync to the note." });
  });

  it("leaves a damaged canvas.json alone and says so", async () => {
    await writeFile(path.join(dir, "canvas.json"), '{ "items": [ ');
    const r = await call("add_items", { items: [{ kind: "sticky", text: "x" }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("can't be read");
    expect(await readFile(path.join(dir, "canvas.json"), "utf8")).toBe('{ "items": [ ');
  });

  it("runs over stdio from the command line", async () => {
    const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const transport = new StdioClientTransport({ command: process.execPath, args: ["--experimental-strip-types", cli, `--board=${dir}`], stderr: "pipe" });
    const c = new Client({ name: "stdio-test", version: "0" });
    await c.connect(transport);
    const r = (await c.callTool({ name: "read_board", arguments: {} })) as { content: { text: string }[] };
    expect(JSON.parse(r.content[0]!.text).title).toBe("Product Roadmap");
    await c.close();
  }, 20_000);
});
