import { describe, expect, it } from "vitest";
import {
  colToLetter,
  emptySheet,
  evaluateAll,
  evaluateConditionalRules,
  exportXlsx,
  formatCellRef,
  formatCellValue,
  importXlsx,
  letterToCol,
  newWorkbookFiles,
  parseCsv,
  parseUserInput,
  patchCells,
  sheetFromCsv,
  sheetToCsv,
  shiftFormula,
  sortSheetByColumn,
  type SheetData,
  type WorkbookIndex,
} from "../src/index.ts";

describe("@opendeck/sheet", () => {
  it("converts column letters and cell references accurately", () => {
    expect(colToLetter(0)).toBe("A");
    expect(colToLetter(25)).toBe("Z");
    expect(colToLetter(26)).toBe("AA");
    expect(letterToCol("AA")).toBe(26);
    expect(formatCellRef(0, 0)).toBe("A1");
    expect(formatCellRef(9, 27, true, true)).toBe("$AB$10");
  });

  it("evaluates formulas, ranges, cross-sheet refs, and detects cycles", () => {
    const s1 = patchCells(emptySheet("sheet-1", "Summary"), {
      A1: { v: 10 },
      A2: { v: 20 },
      A3: { v: 30 },
      A4: { f: "=SUM(A1:A3)" },
      B1: { f: "=AVERAGE(A1:A3)" },
      B2: { f: '=IF(A4>50, "High", "Low")' },
      C1: { f: "=Sheets2!A1 * 2" },
      D1: { f: "=D2 + 1" },
      D2: { f: "=D1 + 1" },
    });
    const s2 = patchCells(emptySheet("sheet-2", "Sheets2"), {
      A1: { v: 25 },
    });
    const sheets = new Map<string, SheetData>([
      ["sheet-1", s1],
      ["sheet-2", s2],
    ]);
    const res = evaluateAll(sheets, "UTC");
    const m1 = res.get("sheet-1")!;
    expect(m1.get("A4")).toBe(60);
    expect(m1.get("B1")).toBe(20);
    expect(m1.get("B2")).toBe("High");
    expect(m1.get("C1")).toBe(50);
    expect(String(m1.get("D1"))).toBe("#REF!");
  });

  it("shifts relative references in formulas while preserving $ locks", () => {
    expect(shiftFormula("=SUM(A1:$B$2) + C$1", 2, 1)).toBe("=SUM(B3:$B$2) + D$1");
  });

  it("formats numbers, currencies, percentages, and parses user input", () => {
    const index = { ...newWorkbookFiles("Test").index, locale: "en-US" };
    expect(parseUserInput("42.5%")).toEqual({ v: 0.425, fmt: "percent" });
    expect(parseUserInput("=SUM(A1:A5)")).toEqual({ f: "=SUM(A1:A5)" });
    expect(formatCellValue(1234.5, { s: { numFmt: "currency" } }, index)).toBe("$1,234.50");
    expect(formatCellValue(-1234.5, { s: { numFmt: "number_parens" } }, index)).toBe("(1,234.50)");
    expect(formatCellValue(0.125, { s: { numFmt: "percent" } }, index)).toBe("12.50%");
  });

  it("evaluates conditional highlight and color-scale rules", () => {
    const s = patchCells(
      {
        ...emptySheet("sheet-1", "Sheet1"),
        rules: [
          { id: "r1", kind: "highlight", range: "A1:A3", condition: "gt", values: ["15"], style: { fill: "#17381b", bold: true } },
          { id: "r2", kind: "colorScale", range: "B1:B3", minColor: "#ff0000", maxColor: "#00ff00" },
        ],
      },
      {
        A1: { v: 10 },
        A2: { v: 20 },
        B1: { v: 0 },
        B2: { v: 50 },
        B3: { v: 100 },
      },
    );
    const sheets = new Map([[s.id, s]]);
    const vals = evaluateAll(sheets).get(s.id)!;
    const cond = evaluateConditionalRules(s, vals, sheets, "UTC");
    expect(cond.get("A1")).toBeUndefined();
    expect(cond.get("A2")).toEqual({ fill: "#17381b", bold: true });
    expect(cond.get("B1")?.fill).toBe("#ff0000");
    expect(cond.get("B3")?.fill).toBe("#00ff00");
  });

  it("round-trips CSV and XLSX files cleanly", async () => {
    const csv = "Name,Amount,Done\r\nAlpha,100,TRUE\r\nBeta,250,FALSE\r\n";
    expect(parseCsv(csv)).toHaveLength(3);
    const s = sheetFromCsv("sheet-1", "Budget", csv);
    const index: WorkbookIndex = { ...newWorkbookFiles("Budget").index, sheets: [{ id: "sheet-1", title: "Budget" }] };
    const vals = evaluateAll(new Map([[s.id, s]]));
    expect(sheetToCsv(s, vals.get(s.id)!, index)).toContain("Alpha,100,TRUE");

    const xlsxBytes = exportXlsx(index, [s], vals);
    const imported = await importXlsx(xlsxBytes, "Budget");
    expect(imported.sheets).toHaveLength(1);
    expect(imported.sheets[0]!.cells["A2"]?.v).toBe("Alpha");
    expect(imported.sheets[0]!.cells["B2"]?.v).toBe(100);
  });

  it("sorts sheet rows by column preserving header", () => {
    const s = patchCells(emptySheet("sheet-1", "S"), {
      A1: { v: "Item" },
      B1: { v: "Score" },
      A2: { v: "Zeta" },
      B2: { v: 10 },
      A3: { v: "Alpha" },
      B3: { v: 30 },
    });
    const sorted = sortSheetByColumn(s, 0, true, "A1:B3", true);
    expect(sorted.cells["A2"]?.v).toBe("Alpha");
    expect(sorted.cells["B2"]?.v).toBe(30);
    expect(sorted.cells["A3"]?.v).toBe("Zeta");
  });
});

