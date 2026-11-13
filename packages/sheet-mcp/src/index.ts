// The Fenna Sheets MCP server. Any MCP client (Claude Code, Codex, Antigravity,
// a local model's runner) gets the same tools; nothing here is tied to one
// provider. Lists in schemas and descriptions come from @opendeck/sheet.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BORDER_STYLES, CHART_TYPES, HIGHLIGHT_CONDITIONS, NUMBER_FORMAT_KINDS, OPTION_COLORS } from "@opendeck/sheet";
import { INSTRUCTIONS, formatGuide } from "./guide.ts";
import { type CellInput, type ChartInput, SheetStore, StoreError, type StructureInput } from "./store.ts";

export { SheetStore, StoreError, versionOf } from "./store.ts";
export { INSTRUCTIONS, formatGuide } from "./guide.ts";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

/** Run a tool body; StoreErrors come back as tool errors the model can act on. */
async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof StoreError) return { ...text(e.message), isError: true };
    throw e;
  }
}

const Sheet = z.string().min(1).max(200).describe('a sheet\'s id or its title, as workbook_overview lists them');
const Version = z.string().optional().describe("the version read_range gave; the change is refused if the sheet changed since");
const Cell = z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.string(), z.unknown())]);

const Style = z
  .record(z.string(), z.unknown())
  .describe(`style keys: bold, italic, underline, strike (true/false), fontSize (points), color and fill ("#rrggbb"), alignH (auto|left|center|right), alignV (top|middle|bottom), wrap (overflow|wrap), numFmt (${NUMBER_FORMAT_KINDS.join("|")}), customFmt (a pattern such as "#,##0.0%"), borders ({"bottom": {"style": ${BORDER_STYLES.map((b) => `"${b}"`).join("|")}, "color": "#rrggbb"}}). A key set to null is removed`);

function wrote(r: { title: string; version: string; changed: number; results: string[]; errors: string[]; unlike: string[]; added: string[] }) {
  const lines = [`Saved ${r.changed} cell${r.changed === 1 ? "" : "s"} on "${r.title}" (version ${r.version}).`];
  if (r.added.length) lines.push(`Added the ready-made dropdown${r.added.length > 1 ? "s" : ""} ${r.added.join(", ")} to the workbook.`);
  if (r.results.length) lines.push(`Formulas now show: ${r.results.join("; ")}.`);
  if (r.errors.length) lines.push(`These formulas show errors; fix them with write_cells:\n${r.errors.map((e) => `- ${e}`).join("\n")}`);
  if (r.unlike.length) lines.push(`Check:\n${r.unlike.map((e) => `- ${e}`).join("\n")}`);
  return lines.join("\n");
}

/**
 * registerTool, but each tool refuses argument names it doesn't take and says
 * which it does: a guessed name ("reply" for "text") must fail, not be dropped.
 */
function strictTools(server: McpServer): McpServer["registerTool"] {
  const register = server.registerTool.bind(server);
  return ((name: string, config: { inputSchema?: z.ZodRawShape }, cb: never) => {
    const shape = config.inputSchema;
    const takes = shape && Object.keys(shape).length ? `it takes ${Object.keys(shape).join(", ")}` : "it takes no arguments";
    const inputSchema =
      shape &&
      z.strictObject(shape, {
        error: (iss) => (iss.code === "unrecognized_keys" ? `${name} has no argument ${iss.keys.map((k) => `"${k}"`).join(", ")}; ${takes}` : undefined),
      });
    return register(name, { ...config, inputSchema } as never, cb);
  }) as McpServer["registerTool"];
}

export function createServer(root: string): McpServer {
  const store = new SheetStore(root);
  const server = new McpServer({ name: "fenna-sheets", version: "0.9.0" }, { instructions: INSTRUCTIONS });
  const tool = strictTools(server);

  tool(
    "workbook_overview",
    {
      title: "Workbook overview",
      description:
        "Start here. The workbook's title, locale and time zone; every sheet with its id, title, used range, first row (usually the headers), frozen panes, rule and chart counts; the dropdowns and people cells can use; how many comments are open.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => guard(async () => json(await store.overview())),
  );

  tool(
    "format_guide",
    {
      title: "Sheet format guide",
      description: "Everything a cell can hold (values, formulas, types, styles, number formats), every function the formula engine knows, and rules for building sheets that work. Read it once before your first write.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => text(formatGuide()),
  );

  tool(
    "read_range",
    {
      title: "Read cells",
      description:
        "Read a sheet: a table of what each cell shows, then `cells` exactly as the file keeps them (v value, f formula, s style, t type), `computed` values of formulas, `errors` with their reason, and the sheet's setup (frozen panes, merges, rules, charts, filter). Leave range out to read the used part of the sheet. Pass the returned version to your next write. Large sheets come back in parts; `more` says which range to read next. Example: {sheet: \"Revenue\", range: \"A1:G20\"}",
      inputSchema: { sheet: Sheet, range: z.string().max(40).optional().describe('A1 notation: "B2:D9", a column "C" or "C:E", rows "3:5"') },
      annotations: { readOnlyHint: true },
    },
    ({ sheet, range }) => guard(async () => json(await store.readRange(sheet, range))),
  );

  tool(
    "find",
    {
      title: "Find cells",
      description: "Find cells whose shown value contains some text (any case), on one sheet or all; with formulas: true, formulas are searched too. Use it to locate a row or label in a large sheet instead of reading it all. Example: {query: \"Marketplace\"}",
      inputSchema: { query: z.string().min(1).max(200), sheet: Sheet.optional(), formulas: z.boolean().optional(), limit: z.number().int().min(1).max(500).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ query, sheet, formulas, limit }) => guard(async () => json(await store.find(query, { sheet, formulas, limit }))),
  );

  tool(
    "write_cells",
    {
      title: "Write cells",
      description:
        'Set values and formulas. Two ways, usable together:\n' +
        '- cells: {"B2": 42500, "A7": "Total", "B7": "=SUM(B2:B6)", "C3": null}\n' +
        '- rows: a block from a top-left cell, one list per row: {at: "A1", values: [["Region", "Q1"], ["East", 1200]]}\n' +
        'A cell is a number, true/false, text, "=formula", null (empties the cell, style too), or an object {v | f, t, s, dropdownId, person, note}. Text is read the way typing it would be: "2026-03-15" becomes a date, "$1,200" money, "12%" a percentage. Writing a value keeps the cell\'s style; s merges into the style it has. ' +
        "Every cell is checked first; if any is wrong nothing is saved and you get the fixes. The reply gives what each formula now shows and any errors. To style many cells at once use format_cells; to clear a range, clear_cells.",
      inputSchema: {
        sheet: Sheet,
        cells: z.record(z.string(), Cell).optional(),
        rows: z.object({ at: z.string().describe('the top-left cell, like "A1"'), values: z.array(z.array(Cell)) }).optional(),
        expected_version: Version,
      },
    },
    ({ sheet, cells, rows, expected_version }) => guard(async () => text(wrote(await store.writeCells(sheet, { cells: cells as Record<string, CellInput>, rows: rows as { at: string; values: CellInput[][] } }, expected_version)))),
  );

  tool(
    "format_cells",
    {
      title: "Format cells",
      description:
        'Style every cell in one or more ranges, or set their type. style merges into each cell\'s style (null removes a key; style: null removes all). type makes cells checkboxes, dropdowns (with dropdownId), people or dates; "auto" makes them plain again. Example: {sheet: "Revenue", ranges: ["A1:G1"], style: {"bold": true, "fill": "#1a5394", "color": "#ffffff"}} or {ranges: ["B2:E7"], style: {"numFmt": "currency_rounded"}}',
      inputSchema: {
        sheet: Sheet,
        ranges: z.array(z.string().max(40)).min(1).max(50),
        style: Style.nullable().optional(),
        type: z.enum(["auto", "checkbox", "dropdown", "person", "date"]).optional(),
        dropdownId: z.string().optional(),
        expected_version: Version,
      },
    },
    ({ sheet, ranges, style, type, dropdownId, expected_version }) =>
      guard(async () => {
        const r = await store.formatCells(sheet, ranges, { style, type, dropdownId }, expected_version);
        return text(`Formatted ${r.cells} cell${r.cells === 1 ? "" : "s"} (${r.ranges.join(", ")}) on "${r.title}" (version ${r.version}).`);
      }),
  );

  tool(
    "clear_cells",
    {
      title: "Clear cells",
      description: 'Empty a range: what "contents" keeps the formatting, "formatting" keeps the values, "all" removes both. Example: {sheet: "Revenue", range: "A20:G40", what: "contents"}',
      inputSchema: { sheet: Sheet, range: z.string().max(40), what: z.enum(["contents", "formatting", "all"]).default("contents"), expected_version: Version },
      annotations: { destructiveHint: true },
    },
    ({ sheet, range, what, expected_version }) =>
      guard(async () => {
        const r = await store.clear(sheet, range, what, expected_version);
        return text(`Cleared ${what} of ${r.cleared} cell${r.cleared === 1 ? "" : "s"} in ${r.range} on "${r.title}" (version ${r.version}).`);
      }),
  );

  tool(
    "edit_structure",
    {
      title: "Edit rows, columns and layout",
      description:
        "Change a sheet's shape; ops run in order. Rows are numbered from 1 and columns are letters, as on screen. Formulas, rules, charts and filters on every sheet follow the cells they point at (a reference to a deleted cell becomes #REF!).\n" +
        'Ops: {op:"insert_rows", before:5, count?}, {op:"insert_columns", before:"C", count?}, {op:"delete_rows", rows:"5:7"}, {op:"delete_columns", columns:"C:D"}, {op:"move_column", column:"C", direction:"left"|"right"}, {op:"freeze", rows?, columns?}, {op:"merge"|"unmerge", range}, {op:"sort", by:"C", descending?, range?, has_header? (default true)}, {op:"resize", columns?:"A:C" | rows?:"1:3", size: pixels}, {op:"gridlines", show}, {op:"filter", range: "A1:F40" | null, show?: {"G": ["Done"]}}, {op:"group"|"ungroup", columns?:"C:E" | rows?:"3:5", collapsed? (group only: hides them until someone opens the group)}.\n' +
        'Example: {sheet: "Tasks", ops: [{op: "insert_rows", before: 2}, {op: "freeze", rows: 1}]}',
      inputSchema: {
        sheet: Sheet,
        ops: z
          .array(
            z.discriminatedUnion("op", [
              z.object({ op: z.literal("insert_rows"), before: z.number().int().min(1), count: z.number().int().min(1).max(5000).optional() }),
              z.object({ op: z.literal("insert_columns"), before: z.string().max(3), count: z.number().int().min(1).max(100).optional() }),
              z.object({ op: z.literal("delete_rows"), rows: z.string().max(15) }),
              z.object({ op: z.literal("delete_columns"), columns: z.string().max(9) }),
              z.object({ op: z.literal("move_column"), column: z.string().max(3), direction: z.enum(["left", "right"]) }),
              z.object({ op: z.literal("freeze"), rows: z.number().int().min(0).max(100).optional(), columns: z.number().int().min(0).max(50).optional() }),
              z.object({ op: z.literal("merge"), range: z.string().max(40) }),
              z.object({ op: z.literal("unmerge"), range: z.string().max(40) }),
              z.object({ op: z.literal("sort"), by: z.string().max(3), descending: z.boolean().optional(), range: z.string().max(40).optional(), has_header: z.boolean().optional() }),
              z.object({ op: z.literal("resize"), columns: z.string().max(9).optional(), rows: z.string().max(15).optional(), size: z.number().min(1).max(2000) }),
              z.object({ op: z.literal("gridlines"), show: z.boolean() }),
              z.object({ op: z.literal("filter"), range: z.string().max(40).nullable(), show: z.record(z.string(), z.array(z.string())).optional() }),
              z.object({ op: z.literal("group"), columns: z.string().max(9).optional(), rows: z.string().max(15).optional(), collapsed: z.boolean().optional() }),
              z.object({ op: z.literal("ungroup"), columns: z.string().max(9).optional(), rows: z.string().max(15).optional() }),
            ]),
          )
          .min(1)
          .max(30),
        expected_version: Version,
      },
    },
    ({ sheet, ops, expected_version }) =>
      guard(async () => {
        const r = await store.editStructure(sheet, ops as StructureInput[], expected_version);
        return text(
          `On "${r.title}": ${r.done.join("; ")} (version ${r.version}).` +
            (r.formulasUpdatedOn ? ` Formulas pointing here were updated on: ${r.formulasUpdatedOn.join(", ")}.` : "") +
            (r.notGrown ? `\n${r.note}\n${r.notGrown.map((n) => `- ${n}`).join("\n")}` : ""),
        );
      }),
  );

  const HighlightRule = z.object({
    kind: z.literal("highlight"),
    range: z.string().max(40),
    condition: z.enum(HIGHLIGHT_CONDITIONS),
    values: z.array(z.string()).max(2).describe('one value; two for "between"; none for empty/not_empty; for "formula", a formula where THIS is the cell being checked, like "=THIS>AVERAGE($F$2:$F$40)"'),
    style: z.object({ fill: z.string().optional(), color: z.string().optional(), bold: z.boolean().optional(), italic: z.boolean().optional() }),
  });
  const ScaleRule = z.object({ kind: z.literal("colorScale"), range: z.string().max(40), minColor: z.string(), midColor: z.string().optional(), maxColor: z.string() });

  tool(
    "manage_rules",
    {
      title: "Conditional formatting",
      description:
        'Add, change or delete a sheet\'s conditional formatting rules; ids are made for you. A highlight rule styles cells that meet a condition; a color scale shades numbers from minColor to maxColor. read_range lists the rules and their ids. Example: {sheet: "Revenue", add: [{kind: "highlight", range: "F2:F6", condition: "lt", values: ["0"], style: {"fill": "#8c2626", "color": "#ffffff"}}]}',
      inputSchema: {
        sheet: Sheet,
        add: z.array(z.discriminatedUnion("kind", [HighlightRule, ScaleRule])).max(20).optional(),
        update: z.array(z.discriminatedUnion("kind", [HighlightRule.extend({ id: z.string() }), ScaleRule.extend({ id: z.string() })])).max(20).optional(),
        delete: z.array(z.string()).max(50).optional(),
      },
    },
    ({ sheet, add, update, delete: del }) => guard(async () => json(await store.manageRules(sheet, { add: add as never, update: update as never, delete: del }))),
  );

  const Chart = z.object({
    type: z.enum(CHART_TYPES),
    title: z.string().max(200),
    range: z.string().max(40).describe("the data: category labels in the first column, one series per further column, series names in the first row"),
    at: z.string().max(8).optional().describe('the cell the chart\'s top-left corner sits on, like "I2"; default: two columns right of the data'),
    width: z.number().optional().describe("pixels, default 480"),
    height: z.number().optional().describe("pixels, default 300"),
    header_row: z.boolean().optional().describe("whether the first row holds series names (default true)"),
  });

  tool(
    "manage_charts",
    {
      title: "Charts",
      description: `Add, change or delete charts on a sheet (types: ${CHART_TYPES.join(", ")}). A chart reads its range live, so it follows later edits. Example: {sheet: "Revenue", add: [{type: "bar", title: "Revenue by month", range: "A1:D5", at: "I2"}]}`,
      inputSchema: { sheet: Sheet, add: z.array(Chart).max(10).optional(), update: z.array(Chart.partial().extend({ id: z.string() })).max(10).optional(), delete: z.array(z.string()).max(50).optional() },
    },
    ({ sheet, add, update, delete: del }) => guard(async () => json(await store.manageCharts(sheet, { add: add as ChartInput[], update: update as never, delete: del }))),
  );

  tool(
    "add_sheet",
    {
      title: "Add a sheet",
      description: "Add a sheet tab, empty or as a copy of another; it goes after `after`, or at the end. Example: {title: \"Q4\", copy_of: \"Q3\"}",
      inputSchema: { title: z.string().min(1).max(200), after: Sheet.optional(), copy_of: Sheet.optional() },
    },
    ({ title, after, copy_of }) =>
      guard(async () => {
        const r = await store.addSheet(title, { after, copyOf: copy_of });
        return text(`Added sheet "${r.title}" (id ${r.id}) as tab ${r.position}.`);
      }),
  );

  tool(
    "delete_sheet",
    {
      title: "Delete a sheet",
      description: "Delete a sheet and everything on it. A workbook keeps at least one sheet. Only when the user asked for it.",
      inputSchema: { sheet: Sheet },
      annotations: { destructiveHint: true },
    },
    ({ sheet }) =>
      guard(async () => {
        const r = await store.deleteSheet(sheet);
        return text(`Deleted sheet "${r.title}".${r.brokenFormulasOn.length ? ` Formulas on ${r.brokenFormulasOn.join(", ")} pointed at it and now show #REF!; fix them with write_cells.` : ""}`);
      }),
  );

  tool(
    "update_workbook",
    {
      title: "Workbook settings",
      description:
        `Change the workbook's title, locale (how numbers, money and dates show), time_zone (for TODAY and NOW, like "Asia/Kolkata"), the dropdowns cells can use (the full list; option colors: ${OPTION_COLORS.join(", ")}), the people, or the sheets' titles and order (list every sheet once). Example: {dropdowns: [{id: "stage", name: "Stage", options: [{id: "lead", label: "Lead", color: "gray"}, {id: "won", label: "Won", color: "green"}]}]}`,
      inputSchema: {
        title: z.string().min(1).max(200).optional(),
        locale: z.string().max(20).optional(),
        time_zone: z.string().max(80).optional(),
        dropdowns: z.array(z.object({ id: z.string().max(60), name: z.string().max(80), options: z.array(z.object({ id: z.string().max(60), label: z.string().max(80), color: z.enum(OPTION_COLORS) })).max(50) })).max(100).optional(),
        people: z.array(z.object({ name: z.string().max(120), email: z.string().max(200).optional() })).max(200).optional(),
        sheets: z.array(z.object({ id: z.string(), title: z.string().max(200) })).optional(),
      },
      annotations: { idempotentHint: true },
    },
    (args) => guard(async () => json(await store.updateWorkbook(args))),
  );

  tool(
    "read_comments",
    {
      title: "Read comments",
      description:
        "The comment threads people left on cells: each thread's id, sheet, range, what the cell shows, and its comments in order (by user or assistant). Open threads only, unless include_resolved. Use it when asked to act on comments or review notes; then make the changes and answer with comment.",
      inputSchema: { sheet: Sheet.optional(), include_resolved: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ sheet, include_resolved }) => guard(async () => json(await store.readComments(sheet, include_resolved))),
  );

  tool(
    "comment",
    {
      title: "Comment",
      description:
        'Reply to a thread, or start one on a cell or range, the way a reviewer would. Reply: {thread, text}. Start: {sheet, range, text}. resolve: true closes the thread; only resolve a person\'s thread when they asked you to. Questions and notes go here; changes go in the cells. Example: {sheet: "Revenue", range: "F5", text: "72% growth looks high; is August right?"}',
      inputSchema: {
        thread: z.string().min(1).max(80).optional(),
        sheet: Sheet.optional(),
        range: z.string().max(40).optional(),
        text: z.string().max(4000).optional(),
        resolve: z.boolean().optional(),
      },
    },
    (input) =>
      guard(async () => {
        const r = await store.comment(input);
        return text(`${input.thread ? "Replied in" : "Started"} thread ${r.thread} (${r.comments} comment${r.comments === 1 ? "" : "s"}${r.resolved ? ", resolved" : ""}).`);
      }),
  );

  return server;
}
