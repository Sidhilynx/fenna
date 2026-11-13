import { describe, expect, it } from "vitest";
import {
  type CellData,
  checkCellInput,
  checkSheet,
  emptySheet,
  evaluateAll,
  FormulaError,
  formatCellValue,
  formatPattern,
  FUNCTIONS,
  addGroup,
  impliedFormat,
  removeGroup,
  lintFormula,
  newWorkbookFiles,
  parseDateText,
  parseUserInput,
  patchCells,
  remapFormula,
  resizeLines,
  restructure,
  type SheetData,
  serialOf,
  shiftMap,
  sortSheetByColumn,
} from "../src/index.ts";

const sheet = (id: string, title: string, cells: Record<string, CellData>): SheetData => patchCells(emptySheet(id, title), cells);
const run = (...sheets: SheetData[]) => evaluateAll(new Map(sheets.map((s) => [s.id, s])), "UTC");
const one = (f: string, cells: Record<string, CellData> = {}) => run(sheet("s", "S", { ...cells, Z99: { f } })).get("s")!.get("Z99");

describe("formula engine", () => {
  it("evaluates every listed function without #NAME?", () => {
    const sample: Record<string, string> = { ROW: "=ROW()", COLUMN: "=COLUMN()", PI: "=PI()", RAND: "=RAND()", TODAY: "=TODAY()", NOW: "=NOW()" };
    for (const fn of FUNCTIONS) {
      const v = one(sample[fn.name] ?? `=${fn.name}(1, 1, 1)`, { A1: { v: 1 } });
      expect(v instanceof FormulaError && v.code === "#NAME?", `${fn.name} is listed but unknown`).toBe(false);
    }
  });

  it("names an unknown function and suggests the near one", () => {
    const v = one("=SUMM(1,2)");
    expect(v).toBeInstanceOf(FormulaError);
    expect((v as FormulaError).message).toBe("Unknown function SUMM. Did you mean SUM?");
  });

  it("reads whole columns and rows, and ROW/COLUMN of a reference", () => {
    const cells = { B1: { v: "Amount" }, B2: { v: 10 }, B3: { v: 20 }, B40: { v: 5 }, A2: { v: 1 }, C2: { v: 2 } };
    expect(one("=SUM(B:B)", cells)).toBe(35);
    expect(one("=SUM(2:2)", cells)).toBe(13);
    expect(one("=COUNTA(B2:B)", cells)).toBe(3);
    expect(one("=ROW(B7)", cells)).toBe(7);
    expect(one("=COLUMN(C2)", cells)).toBe(3);
  });

  it("explains circular references", () => {
    const v = run(sheet("s", "S", { A1: { f: "=B1" }, B1: { f: "=A1+1" } })).get("s")!.get("A1") as FormulaError;
    expect(v.code).toBe("#REF!");
    expect(v.message).toContain("Circular reference");
  });

  it("handles conditional aggregates, ranks, lookups and text", () => {
    const cells: Record<string, CellData> = { A1: { v: "East" }, B1: { v: 10 }, A2: { v: "West" }, B2: { v: 30 }, A3: { v: "East" }, B3: { v: 50 } };
    expect(one('=AVERAGEIFS(B1:B3, A1:A3, "East")', cells)).toBe(30);
    expect(one('=MAXIFS(B1:B3, A1:A3, "East")', cells)).toBe(50);
    expect(one('=MINIFS(B1:B3, A1:A3, "<>East")', cells)).toBe(30);
    expect(one("=LARGE(B1:B3, 2)", cells)).toBe(30);
    expect(one("=RANK(50, B1:B3)", cells)).toBe(1);
    expect(one("=COUNTUNIQUE(A1:A3)", cells)).toBe(2);
    expect(one('=MATCH("West", A1:A3, 0)', cells)).toBe(2);
    expect(one("=MATCH(35, B1:B3)", cells)).toBe(2);
    expect(one('=SWITCH(A2, "East", 1, "West", 2, 0)', cells)).toBe(2);
    expect(one('=TEXT(1234.5, "#,##0.00")')).toBe("1,234.50");
    expect(one('=TEXT(0.125, "0.0%")')).toBe("12.5%");
    expect(one("=ROUND(STDEV(2, 4, 4, 4, 5, 5, 7, 9), 4)")).toBe(2.1381);
  });

  it("does date arithmetic on serial numbers", () => {
    const d = serialOf(2026, 3, 15);
    expect(one("=DATE(2026, 3, 15)")).toBe(d);
    expect(one('=DATEVALUE("2026-03-15")')).toBe(d);
    expect(one("=EOMONTH(DATE(2026, 1, 31), 1)")).toBe(serialOf(2026, 2, 28));
    expect(one("=EDATE(DATE(2026, 1, 31), 1)")).toBe(serialOf(2026, 2, 28));
    expect(one("=WEEKDAY(DATE(2026, 3, 15))")).toBe(1);
    expect(one('=DATEDIF(DATE(2024, 3, 15), DATE(2026, 3, 14), "Y")')).toBe(1);
    expect(one("=NETWORKDAYS(DATE(2026, 3, 9), DATE(2026, 3, 15))")).toBe(5);
    expect(one("=HOUR(TIME(14, 30, 0))")).toBe(14);
    expect(one("=A1+7", { A1: { v: d } })).toBe(d + 7);
  });

  it("formats patterns for numbers and dates", () => {
    const d = serialOf(2026, 3, 15, 14, 30);
    expect(formatPattern(d, "yyyy-mm-dd")).toBe("2026-03-15");
    expect(formatPattern(d, "mmm d, h:mm AM/PM")).toBe("Mar 15, 2:30 PM");
    expect(formatPattern(-5, "$#,##0;($#,##0)")).toBe("($5)");
    expect(formatPattern(1234567, "#,##0")).toBe("1,234,567");
  });
});

describe("typing into a cell", () => {
  it("reads dates in the locale's order, times, money, and keeps text with an apostrophe", () => {
    expect(parseUserInput("3/15/2026", "en-US")).toEqual({ v: serialOf(2026, 3, 15), fmt: "date" });
    expect(parseUserInput("15/3/2026", "en-GB")).toEqual({ v: serialOf(2026, 3, 15), fmt: "date" });
    expect(parseUserInput("2026-03-15")).toEqual({ v: serialOf(2026, 3, 15), fmt: "date" });
    expect(parseUserInput("Mar 15, 2026")).toEqual({ v: serialOf(2026, 3, 15), fmt: "date_short" });
    expect(parseUserInput("2:30 PM")).toEqual({ v: 14.5 / 24, fmt: "time" });
    expect(parseUserInput("$1,234.50")).toEqual({ v: 1234.5, fmt: "currency" });
    expect(parseUserInput("-$40")).toEqual({ v: -40, fmt: "currency_rounded" });
    expect(parseUserInput("1,200")).toEqual({ v: 1200, fmt: "number_rounded" });
    expect(parseUserInput("'0042")).toEqual({ v: "0042" });
    expect(parseUserInput("13/45/2026", "en-US")).toEqual({ v: "13/45/2026" });
    expect(parseDateText("Feb 30, 2026")).toBeNull();
  });

  it("shows times without shifting them by the sheet's time zone", () => {
    const { index } = newWorkbookFiles("T");
    const kolkata = { ...index, locale: "en-US", timeZone: "Asia/Kolkata" };
    expect(formatCellValue(14.5 / 24, { s: { numFmt: "time" } }, kolkata)).toBe("2:30 PM");
    expect(formatCellValue(serialOf(2026, 3, 15), { t: "date" }, kolkata)).toBe("Mar 15, 2026");
  });
});

describe("references follow their cells", () => {
  const a = { id: "a", title: "Data" };
  const b = { id: "b", title: "Summary sheet" };

  it("rewrites references on insert and delete, on this sheet and others", () => {
    expect(remapFormula("=SUM(A1:A10)+A12", a, a, "row", shiftMap(4, 2))).toBe("=SUM(A1:A12)+A14");
    expect(remapFormula("=SUM(A1:A10)+$A$12", a, a, "row", shiftMap(2, -3))).toBe("=SUM(A1:A7)+$A$9");
    expect(remapFormula("=A4", a, a, "row", shiftMap(2, -3))).toBe("=#REF!");
    expect(remapFormula("=Data!C3+'Summary sheet'!C3+C3", b, a, "col", shiftMap(1, 1))).toBe("=Data!D3+'Summary sheet'!C3+C3");
    expect(remapFormula('=COUNTIF(B:B, "B2")+LOG10(100)', a, a, "col", shiftMap(0, 1))).toBe('=COUNTIF(C:C, "B2")+LOG10(100)');
    expect(remapFormula("=SUM(3:5)", a, a, "row", shiftMap(0, 1))).toBe("=SUM(4:6)");
  });

  it("inserts a row: cells, sizes, merges, rules, charts and other sheets follow", () => {
    const data: SheetData = {
      ...sheet("a", "Data", { A1: { v: "Item" }, A2: { v: 5 }, A3: { v: 7 }, A4: { f: "=SUM(A2:A3)" } }),
      rowHeights: { 2: 40 },
      merges: [{ r1: 2, c1: 0, r2: 2, c2: 1 }],
      rules: [{ id: "r", kind: "highlight", range: "A2:A3", condition: "gt", values: ["6"], style: { bold: true } }],
      charts: [{ id: "c", type: "bar", title: "T", range: "A1:A3", x: 0, y: 0, w: 100, h: 100 }],
      frozenRows: 1,
    };
    const summary = sheet("b", "Summary sheet", { A1: { f: "=Data!A4*2" } });
    const out = restructure([data, summary], "a", { kind: "insert", axis: "row", at: 2, count: 1 });
    const na = out.find((s) => s.id === "a")!;
    const nb = out.find((s) => s.id === "b")!;
    expect(na.cells.A5).toEqual({ f: "=SUM(A2:A4)" });
    expect(na.cells.A3).toBeUndefined();
    expect(na.rowHeights).toEqual({ 3: 40 });
    expect(na.merges).toEqual([{ r1: 3, c1: 0, r2: 3, c2: 1 }]);
    expect(na.rules[0]!.range).toBe("A2:A4");
    expect(na.charts[0]!.range).toBe("A1:A4");
    expect(na.frozenRows).toBe(1);
    expect(nb.cells.A1).toEqual({ f: "=Data!A5*2" });
    expect(run(na, nb).get("b")!.get("A1")).toBe(24);
  });

  it("deletes a column a rule and a formula point at", () => {
    const s: SheetData = { ...sheet("a", "Data", { A1: { v: 1 }, B1: { v: 2 }, C1: { f: "=A1+B1" } }), rules: [{ id: "r", kind: "colorScale", range: "B1:B5", minColor: "#000000", maxColor: "#ffffff" }] };
    const [next] = restructure([s], "a", { kind: "delete", axis: "col", at: 1, count: 1 });
    expect(next!.cells.B1).toEqual({ f: "=A1+#REF!" });
    expect(next!.rules).toEqual([]);
    expect(String(run(next!).get("a")!.get("B1"))).toBe("#REF!");
  });

  it("moves a column and keeps ranges over both columns whole", () => {
    const s = sheet("a", "Data", { A1: { v: 1 }, B1: { v: 2 }, D1: { f: "=SUM(A1:C1)+A1" } });
    const [next] = restructure([s], "a", { kind: "move", axis: "col", from: 0, to: 1 });
    expect(next!.cells.B1).toEqual({ v: 1 });
    expect(next!.cells.D1).toEqual({ f: "=SUM(A1:C1)+B1" });
  });

  it("sorts by computed values and moves formulas with their row", () => {
    const s = sheet("a", "Data", { A1: { v: "Name" }, B1: { v: "Total" }, A2: { v: "x" }, B2: { f: "=C2*2" }, C2: { v: 9 }, A3: { v: "y" }, B3: { f: "=C3*2" }, C3: { v: 1 } });
    const vals = run(s).get("a")!;
    const sorted = sortSheetByColumn(s, 1, true, "A1:C3", true, (ref) => vals.get(ref));
    expect(sorted.cells.A2!.v).toBe("y");
    expect(sorted.cells.B2!.f).toBe("=C2*2");
    expect(run(sorted).get("a")!.get("B2")).toBe(2);
  });
});

describe("checking cells written from outside", () => {
  const ctx = { dropdowns: [], sheets: [{ id: "a", title: "Data" }], locale: "en-US" };

  it("explains unknown keys, formats, functions and sheets", () => {
    expect(checkCellInput({ v: 1, colour: "#fff" }, ctx).problems[0]).toContain("Unknown cell key `colour`");
    expect(checkCellInput({ v: 1, s: { numFmt: "currancy" } }, ctx).problems[0]).toContain('Did you mean "currency"?');
    expect(checkCellInput("=SUMM(A1:A3)", ctx).problems).toEqual(["Unknown function SUMM. Did you mean SUM?"]);
    expect(checkCellInput("=Dta!A1", ctx).problems[0]).toContain("Did you mean 'Data'?");
    expect(checkCellInput({ v: 1, s: { fill: "red" } }, ctx).problems[0]).toContain("hex color");
  });

  it("puts values in the form files keep", () => {
    expect(checkCellInput("2026-03-15", ctx)).toEqual({ cell: { v: serialOf(2026, 3, 15) }, problems: [], fmt: "date" });
    expect(checkCellInput({ t: "dropdown", dropdownId: "status", v: "done" }, ctx).cell).toEqual({ t: "dropdown", dropdownId: "status", v: "Done" });
    expect(checkCellInput({ t: "checkbox" }, ctx).cell).toEqual({ t: "checkbox", v: false });
    expect(checkCellInput({ v: "x", s: { fill: "#ABC" } }, ctx).cell).toEqual({ v: "x", s: { fill: "#aabbcc" } });
    expect(lintFormula('=IF(A1>1, "(", ")"', ctx.sheets)).toEqual(["A ( is never closed"]);
  });
});

describe("formats a new formula takes", () => {
  const cells: Record<string, CellData> = {
    A2: { v: "Direct" },
    B2: { v: 42500, s: { numFmt: "currency_rounded" } },
    B3: { v: 28400, s: { numFmt: "currency_rounded" } },
    C2: { v: 0.2, s: { numFmt: "percent" } },
  };
  it("keeps the unit of what it adds up", () => {
    expect(impliedFormat("=SUM(B2:B3)", cells)).toBe("currency_rounded");
    expect(impliedFormat("=B2-B3", cells)).toBe("currency_rounded");
    expect(impliedFormat('=SUMIF(A2:A3, "Direct", B2:B3)', cells)).toBe("currency_rounded");
    expect(impliedFormat("=MAX(C2, 0)", cells)).toBe("percent");
  });
  it("leaves counts, ratios and text alone", () => {
    expect(impliedFormat("=COUNT(B2:B3)", cells)).toBeUndefined();
    expect(impliedFormat("=B2/B3", cells)).toBeUndefined();
    expect(impliedFormat('=SUM(Other!B2:B3)', cells)).toBeUndefined();
    expect(impliedFormat('=SUM("B2")', cells)).toBeUndefined();
  });
});

describe("groups", () => {
  it("joins overlapping groups and splits one an ungroup cuts through", () => {
    const g = addGroup(addGroup([], 2, 4), 4, 6);
    expect(g).toEqual([{ start: 2, end: 6 }]);
    expect(addGroup(g, 8, 9)).toEqual([{ start: 2, end: 6 }, { start: 8, end: 9 }]);
    expect(removeGroup(g, 4, 4)).toEqual([{ start: 2, end: 3 }, { start: 5, end: 6 }]);
    expect(removeGroup(g, 0, 10)).toEqual([]);
  });
  it("drops broken groups from a file", () => {
    const { sheet } = checkSheet({ id: "s", colGroups: [{ start: 3, end: 1 }, { start: "a" }, { start: 1, end: 2, collapsed: true }, null], rowGroups: "x" });
    expect(sheet!.colGroups).toEqual([{ start: 1, end: 2, collapsed: true }]);
    expect(sheet!.rowGroups).toEqual([]);
  });
});

describe("charts move with the cells they sit on", () => {
  const withChart = (): SheetData => ({
    ...emptySheet("a"),
    colWidths: { 0: 150 },
    charts: [{ id: "c", type: "bar", title: "T", range: "A1:B3", x: 300, y: 60, w: 400, h: 200 }],
  });
  // Column A is 150 wide and B is 104, so x=300 is 46px into column C.
  it("shifts right when columns are inserted before it and stays when after", () => {
    expect(restructure([withChart()], "a", { kind: "insert", axis: "col", at: 1, count: 2 })[0]!.charts[0]!.x).toBe(300 + 2 * 104);
    expect(restructure([withChart()], "a", { kind: "insert", axis: "col", at: 3, count: 1 })[0]!.charts[0]!.x).toBe(300);
  });
  it("shifts back when columns before it are deleted, and to the gap when its own column goes", () => {
    expect(restructure([withChart()], "a", { kind: "delete", axis: "col", at: 0, count: 1 })[0]!.charts[0]!.x).toBe(150);
    expect(restructure([withChart()], "a", { kind: "delete", axis: "col", at: 2, count: 1 })[0]!.charts[0]!.x).toBe(254);
  });
  it("moves down with inserted rows", () => {
    expect(restructure([withChart()], "a", { kind: "insert", axis: "row", at: 0, count: 1 })[0]!.charts[0]!.y).toBe(60 + 26);
  });
});

describe("resizing", () => {
  it("moves charts after the resized columns, clamps the size, and leaves charts before them", () => {
    const s: SheetData = { ...emptySheet("a"), charts: [{ id: "c", type: "bar", title: "T", range: "A1:B3", x: 250, y: 0, w: 100, h: 100 }, { id: "d", type: "bar", title: "T", range: "A1:B3", x: 10, y: 0, w: 100, h: 100 }] };
    const next = resizeLines(s, "col", 1, 1, 5000);
    expect(next.colWidths[1]).toBe(800);
    expect(next.charts[0]!.x).toBe(250 + 800 - 104);
    expect(next.charts[1]!.x).toBe(10);
  });
});
