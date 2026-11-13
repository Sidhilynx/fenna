import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { serialOf } from "@opendeck/sheet";
import { createServer } from "../src/index.ts";

const sample = fileURLToPath(new URL("../../../examples/sample-sheet", import.meta.url));
let dir: string;
let client: Client;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fenna-sheets-mcp-"));
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
const sheetFile = async (id: string) => JSON.parse(await readFile(path.join(dir, `sheets/${id}.json`), "utf8"));

describe("Fenna Sheets MCP server", () => {
  it("offers few tools, each described for the model", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeLessThanOrEqual(15);
    for (const t of tools) expect(t.description!.length, t.name).toBeGreaterThan(60);
  });

  it("gives an overview a model can start from", async () => {
    const ov = JSON.parse((await call("workbook_overview")).text);
    expect(ov.title).toBe("Q3 Revenue & Launch Tracker");
    expect(ov.sheets.map((s: { id: string }) => s.id)).toEqual(["overview", "tasks"]);
    expect(ov.sheets[0].firstRow[0]).toBe("Channel");
    expect(ov.sheets[0].usedRange).toMatch(/^A1:G\d+$/);
  });

  it("reads a range as a table, the cells as stored, and computed values", async () => {
    const r = JSON.parse((await call("read_range", { sheet: "Revenue", range: "A1:F6" })).text);
    expect(r.sheet).toBe("overview");
    expect(r.table.split("\n")[0]).toBe("|  | A | B | C | D | E | F |");
    expect(r.table).toContain("| 6 | Total |");
    expect(r.cells.E6.f).toMatch(/^=SUM/);
    expect(typeof r.computed.E6).toBe("number");
    expect(r.setup.frozen).toEqual({ rows: 1, columns: 0 });
  });

  it("writes shorthand cells and rows, keeps styles, and reports what formulas show", async () => {
    const before = await sheetFile("overview");
    const r = await call("write_cells", {
      sheet: "overview",
      cells: { B2: 50000, H1: "Due", H2: "2026-03-15" },
      rows: { at: "A10", values: [["Check", "=B2*2"]] },
    });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("B10 = 100000");
    const after = await sheetFile("overview");
    expect(after.cells.B2.v).toBe(50000);
    expect(after.cells.B2.s).toEqual(before.cells.B2.s);
    expect(after.cells.H2).toEqual({ v: serialOf(2026, 3, 15), s: { numFmt: "date" } });
  });

  it("refuses a bad write whole, saying how to fix each cell", async () => {
    const before = await readFile(path.join(dir, "sheets/overview.json"), "utf8");
    const r = await call("write_cells", { sheet: "overview", cells: { A20: "ok", B20: "=SUMM(B2:B5)", C20: { v: 1, colour: "#fff" }, D20: { v: 1, s: { numFmt: "currancy" } } } });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("B20: Unknown function SUMM. Did you mean SUM?");
    expect(r.text).toContain("C20: Unknown cell key `colour`");
    expect(r.text).toContain('Did you mean "currency"?');
    expect(await readFile(path.join(dir, "sheets/overview.json"), "utf8")).toBe(before);
  });

  it("refuses a stale version and names the sheet when it is unknown", async () => {
    expect((await call("write_cells", { sheet: "overview", cells: { A20: 1 }, expected_version: "stale" })).text).toContain("changed since you read it");
    const r = await call("read_range", { sheet: "Revnue" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('overview ("Revenue")');
  });

  it("reports formula errors with their reason", async () => {
    const r = await call("write_cells", { sheet: "overview", cells: { H3: "=B2/0" } });
    expect(r.text).toContain("H3 =B2/0 → #DIV/0! Division by zero");
  });

  it("inserts a row and every formula follows, on this sheet and others", async () => {
    await call("write_cells", { sheet: "tasks", cells: { Z1: "=Revenue!E6" } });
    const before = JSON.parse((await call("read_range", { sheet: "tasks", range: "Z1" })).text).computed.Z1;
    const r = await call("edit_structure", { sheet: "Revenue", ops: [{ op: "insert_rows", before: 3, count: 2 }] });
    expect(r.text).toContain("inserted 2 row(s) before row 3");
    expect(r.text).toContain("Launch Tasks");
    const tasks = await sheetFile("tasks");
    expect(tasks.cells.Z1.f).toBe("=Revenue!E8");
    expect(JSON.parse((await call("read_range", { sheet: "tasks", range: "Z1" })).text).computed.Z1).toBe(before);
  });

  it("points out a plain value written under a column of typed cells", async () => {
    const r = await call("write_cells", { sheet: "tasks", cells: { F5: "2026-12-02", B5: "Beta" } });
    expect(r.text).toContain('F5 is a plain value under F4, a date cell. If it belongs to that column, write it as {"t": "date", "v": …}.');
    expect(r.text).not.toContain("B5 is a plain value");
  });

  it("refuses argument names a tool doesn't take, instead of dropping them", async () => {
    const r = await call("comment", { thread: "t-growth", reply: "Checked.", resolve: true });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('comment has no argument "reply"; it takes thread, sheet, range, text, resolve');
    const saved = JSON.parse(await readFile(path.join(dir, "comments.json"), "utf8"));
    expect(saved.threads[0].resolved).toBe(false);
  });

  it("says which ranges end just above inserted rows and did not grow", async () => {
    const r = (await call("edit_structure", { sheet: "Revenue", ops: [{ op: "insert_rows", before: 6 }] })).text;
    for (const line of ["- B7 =SUM(B2:B5)", "- chart chart-revenue A1:D5", "- rule rule-growth F2:F5"]) expect(r).toContain(line);
    expect(r).toContain("did not grow");
    const inside = (await call("edit_structure", { sheet: "Revenue", ops: [{ op: "insert_rows", before: 3 }] })).text;
    expect(inside).not.toContain("did not grow");
  });

  it("groups and ungroups columns and rows, and a formula total takes the money format", async () => {
    const g = await call("edit_structure", { sheet: "Revenue", ops: [{ op: "group", columns: "B:D", collapsed: true }, { op: "group", rows: "2:3" }, { op: "ungroup", rows: "3" }] });
    expect(g.text).toContain("grouped columns B–D (collapsed)");
    const saved = await sheetFile("overview");
    expect(saved.colGroups).toEqual([{ start: 1, end: 3, collapsed: true }]);
    expect(saved.rowGroups).toEqual([{ start: 1, end: 1 }]);
    expect(JSON.parse((await call("read_range", { sheet: "Revenue", range: "A1:B2" })).text).setup.columnGroups).toEqual(["B:D (collapsed)"]);
    const bad = await call("edit_structure", { sheet: "Revenue", ops: [{ op: "group" }] });
    expect(bad.text).toContain('group needs columns ("C:E") or rows ("3:5")');
    await call("write_cells", { sheet: "Revenue", cells: { B9: "=SUM(B2:B5)" } });
    expect((await sheetFile("overview")).cells.B9.s.numFmt).toBe("currency_rounded");
  });

  it("formats ranges, sets types, and adds the ready-made dropdown when used", async () => {
    const r = await call("format_cells", { sheet: "tasks", ranges: ["J2:J4"], type: "dropdown", dropdownId: "priority" });
    expect(r.isError).toBe(false);
    const f = await call("format_cells", { sheet: "tasks", ranges: ["A1:C1"], style: { bold: true, fill: "#1A5394" } });
    expect(f.text).toContain("Formatted 3 cells");
    expect((await sheetFile("tasks")).cells.B1.s.fill).toBe("#1a5394");
  });

  it("adds rules and charts with generated ids", async () => {
    const rules = JSON.parse((await call("manage_rules", { sheet: "overview", add: [{ kind: "highlight", range: "F2:F5", condition: "lt", values: ["0"], style: { fill: "#8c2626" } }] })).text);
    expect(rules.added[0]).toMatch(/^rule-/);
    expect((await sheetFile("overview")).rules.at(-1).style.fill).toBe("#8c2626");
    const upper = await call("manage_rules", { sheet: "overview", add: [{ kind: "highlight", range: "F2:F5", condition: "lt", values: ["0"], style: { fill: "#FC0", color: "red" } }] });
    expect(upper.isError).toBe(true);
    expect(upper.text).toContain('style.color must be a hex color like "#c5221f"');
    const charts = JSON.parse((await call("manage_charts", { sheet: "overview", add: [{ type: "line", title: "Trend", range: "A1:D5", at: "I2" }] })).text);
    expect(charts.added[0]).toMatch(/^chart-/);
    const saved = await sheetFile("overview");
    expect(saved.charts.at(-1).x).toBeGreaterThan(0);
  });

  it("adds, renames and deletes sheets, warning about formulas that break", async () => {
    expect((await call("add_sheet", { title: "Q4", copy_of: "Revenue" })).text).toContain('Added sheet "Q4"');
    await call("write_cells", { sheet: "tasks", cells: { Z2: "=Q4!A1" } });
    const del = await call("delete_sheet", { sheet: "Q4" });
    expect(del.text).toContain("Launch Tasks");
  });

  it("reads and writes comment threads the app shows", async () => {
    const start = await call("comment", { sheet: "Revenue", range: "F5", text: "Is this growth right?" });
    expect(start.text).toContain("Started thread");
    const threads = JSON.parse((await call("read_comments")).text);
    const t = threads.find((x: { range: string }) => x.range === "F5");
    expect(t.cellShows).toMatch(/%$/);
    await call("comment", { thread: t.thread, text: "Checked: August was revised.", resolve: true });
    const saved = JSON.parse(await readFile(path.join(dir, "comments.json"), "utf8"));
    expect(saved.threads.find((x: { id: string }) => x.id === t.thread).resolved).toBe(true);
  });

  it("runs as a real stdio process under plain node", async () => {
    const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const transport = new StdioClientTransport({ command: process.execPath, args: ["--experimental-strip-types", cli, `--sheet=${dir}`], stderr: "pipe" });
    const c = new Client({ name: "stdio-test", version: "0" });
    await c.connect(transport);
    const r = (await c.callTool({ name: "workbook_overview", arguments: {} })) as { content: { text: string }[] };
    expect(JSON.parse(r.content[0]!.text).sheets).toHaveLength(2);
    await c.close();
  }, 20_000);
});
