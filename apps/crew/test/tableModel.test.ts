import { describe, expect, it } from "vitest";
import { evaluateAll, exportXlsx, newWorkbookFiles, sheetFromCsv, type CellData, type WorkbookIndex } from "@opendeck/sheet";
import {
  TABLE_BYTES_LIMIT,
  TABLE_COL_LIMIT,
  TABLE_ROW_LIMIT,
  cellText,
  columnLetters,
  isNumeric,
  limitNote,
  parseDelimited,
  readTables,
  tableFormatOf,
  tableFromCells,
  tableFromRows,
} from "../src/renderer/tableModel.ts";

const bytes = (s: string) => new TextEncoder().encode(s);
const rowsOf = (n: number, cols = 2) => Array.from({ length: n }, (_, r) => Array.from({ length: cols }, (_, c) => `${r}:${c}`));

describe("table formats", () => {
  it("reads csv, tsv, xlsx and xls by extension, in any case", () => {
    expect(tableFormatOf("Budget.CSV")).toBe("csv");
    expect(tableFormatOf("a.tsv")).toBe("tsv");
    expect(tableFormatOf("a.xlsx")).toBe("xlsx");
    expect(tableFormatOf("a.xls")).toBe("xls");
  });

  it("returns null for anything else", () => {
    for (const name of ["notes.txt", "a.xlsm", ".csv", "csv", "a.csv.bak"]) expect(tableFormatOf(name)).toBeNull();
  });

  it("the byte limit is 50 MB", () => {
    expect(TABLE_BYTES_LIMIT).toBe(50 * 1024 * 1024);
  });
});

describe("parseDelimited", () => {
  it("splits rows and fields", () => {
    expect(parseDelimited("a,b\n1,2\n", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty fields and a blank line in the middle", () => {
    expect(parseDelimited("a,,b\n\nc", ",")).toEqual([["a", "", "b"], [""], ["c"]]);
  });

  it("does not add an empty row for a final line break, and gives none for empty text", () => {
    expect(parseDelimited("x\n", ",")).toEqual([["x"]]);
    expect(parseDelimited("", ",")).toEqual([]);
  });

  it("reads quoted fields with the delimiter, quotes and line breaks in them", () => {
    expect(parseDelimited('"a,b","say ""hi""","line\nbreak"\n', ",")).toEqual([["a,b", 'say "hi"', "line\nbreak"]]);
  });

  it("takes CRLF and bare CR as row ends and ignores a byte order mark", () => {
    expect(parseDelimited("﻿a,b\r\n1,2\r3,4", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("treats a quote in the middle of a field as a letter", () => {
    expect(parseDelimited('5" tall,x', ",")).toEqual([['5" tall', "x"]]);
  });

  it("splits tab-separated text on tabs, so commas stay in the field", () => {
    expect(parseDelimited("name\tsum\nRent, March\t1,200\n", "\t")).toEqual([
      ["name", "sum"],
      ["Rent, March", "1,200"],
    ]);
  });
});

describe("tables from rows", () => {
  it("shows at most 1000 rows and says how many are not shown", () => {
    const t = tableFromRows("", rowsOf(TABLE_ROW_LIMIT + 4));
    expect(t.rows).toHaveLength(TABLE_ROW_LIMIT);
    expect(t.totalRows).toBe(TABLE_ROW_LIMIT + 4);
    expect(limitNote(t)).toBe("Showing the first 1,000 rows. 4 more are not shown.");
  });

  it("shows at most 100 columns and says how many are not shown", () => {
    const t = tableFromRows("", [rowsOf(1, 150)[0]!]);
    expect(t.shownCols).toBe(TABLE_COL_LIMIT);
    expect(t.rows[0]).toHaveLength(TABLE_COL_LIMIT);
    expect(t.totalCols).toBe(150);
    expect(limitNote(t)).toBe("Showing the first 100 columns. 50 more are not shown.");
  });

  it("pads short rows to the widest row", () => {
    const t = tableFromRows("", [["a"], ["b", "c"]]);
    expect(t.rows).toEqual([
      ["a", ""],
      ["b", "c"],
    ]);
    expect(limitNote(t)).toBeNull();
  });

  it("is empty for no rows", () => {
    const t = tableFromRows("", []);
    expect(t).toMatchObject({ rows: [], totalRows: 0, totalCols: 0, shownCols: 0 });
  });
});

describe("tables from workbook cells", () => {
  it("places values by cell name and sizes to the last filled cell", () => {
    const t = tableFromCells("Sheet1", {
      A1: { v: "item" },
      B2: { v: 12.5 },
      C3: { v: true },
      D1: { v: null },
      E5: { v: "" },
      A4: { f: "=B2*2" },
    });
    expect(t.totalRows).toBe(3);
    expect(t.totalCols).toBe(3);
    expect(t.rows[0]).toEqual(["item", "", ""]);
    expect(t.rows[1]).toEqual(["", "12.5", ""]);
    expect(t.rows[2]).toEqual(["", "", "TRUE"]);
  });

  it("has no rows for a sheet with no values", () => {
    expect(tableFromCells("Empty", { A1: { f: "=1+1" } })).toMatchObject({ rows: [], totalRows: 0 });
  });

  it("drops cells that are not on the grid and limits what it shows", () => {
    const cells: Record<string, CellData> = { A1500: { v: "far down" }, CW1: { v: "far across" }, ZZZ99999999: { v: "nowhere" } };
    const t = tableFromCells("Big", cells);
    expect(t.rows).toHaveLength(TABLE_ROW_LIMIT);
    expect(t.totalRows).toBe(1500);
    expect(t.shownCols).toBe(TABLE_COL_LIMIT);
    expect(t.totalCols).toBe(101);
    expect(cellText(undefined)).toBe("");
  });
});

describe("column letters and numbers", () => {
  it("letters the header A to Z, then AA", () => {
    expect(columnLetters(tableFromRows("", [rowsOf(1, 3)[0]!]))).toEqual(["A", "B", "C"]);
    const alphabet = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    expect(columnLetters(tableFromRows("", [new Array(28).fill("")]))).toEqual([...alphabet, "AA", "AB"]);
  });

  it("right-aligns only what reads as a number", () => {
    for (const s of ["0", "-12", "+3.5", ".5", "1e3", "2.5E-4", "10."]) expect(isNumeric(s)).toBe(true);
    for (const s of ["", "-", "1,000", "12a", "1.2.3", "TRUE", " 1", "$5"]) expect(isNumeric(s)).toBe(false);
  });
});

describe("reading a file", () => {
  it("reads a csv file as one table", async () => {
    const [t] = await readTables("people.csv", bytes("name,age\nAda,36\n"));
    expect(t!.rows).toEqual([
      ["name", "age"],
      ["Ada", "36"],
    ]);
  });

  it("reads a tsv file as one table", async () => {
    const [t] = await readTables("people.tsv", bytes("name\tage\nAda\t36\n"));
    expect(t!.rows[1]).toEqual(["Ada", "36"]);
  });

  it("gives an empty csv file no rows", async () => {
    const [t] = await readTables("empty.csv", bytes(""));
    expect(t).toMatchObject({ rows: [], totalRows: 0 });
  });

  it("refuses a csv file with a NUL byte", async () => {
    await expect(readTables("bin.csv", new Uint8Array([97, 0, 98]))).rejects.toThrow("Not a text file.");
  });

  it("says to save an xls file as xlsx or csv", async () => {
    await expect(readTables("old.xls", bytes("x"))).rejects.toThrow("Save it as .xlsx or .csv.");
  });

  it("reads every sheet of a workbook with its values, formulas included", async () => {
    const base = newWorkbookFiles("Budget").index;
    const index: WorkbookIndex = { ...base, sheets: [{ id: "sheet-1", title: "Budget" }, { id: "sheet-2", title: "Notes" }] };
    const budget = sheetFromCsv("sheet-1", "Budget", "item,amount,double\nRent,10,=B2*2\n");
    const notes = sheetFromCsv("sheet-2", "Notes", "todo\nPay rent\n");
    const values = evaluateAll(
      new Map([
        [budget.id, budget],
        [notes.id, notes],
      ]),
    );
    const xlsx = exportXlsx(index, [budget, notes], values);

    const tables = await readTables("budget.xlsx", xlsx);
    expect(tables.map((t) => t.title)).toEqual(["Budget", "Notes"]);
    expect(tables[0]!.rows[1]).toEqual(["Rent", "10", "20"]);
    expect(tables[1]!.rows).toEqual([["todo"], ["Pay rent"]]);
  });
});
