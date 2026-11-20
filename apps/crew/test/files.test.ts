import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyIndex, evaluateAll, exportXlsx, importXlsx, loadWorkbook, sheetFromCsv, type SheetData } from "@opendeck/sheet";

const require = createRequire(import.meta.url);
const { createStore } = require("../src/main/store.cjs");
const { createDisk } = require("../src/main/disk.cjs");
const { createFiles } = require("../src/main/files.cjs");

const SLUG = "research";
const OUTSIDE_MSG = "That file is outside this bot's disk.";
const LINK_MSG = "A link can't be used on the bot's disk.";
// A 1x1 PNG.
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const starterFiles = (kind: string, title: string) => ({ [`${kind}.json`]: JSON.stringify({ title }), "tabs/tab-1.html": "<article></article>" });

let root: string;
let outside: string;
let store: { botDir(slug: string): string };
let disk: any;
let files: any;
let settingsFile: string;

const botDir = () => store.botDir(SLUG);

/** Writes a file at a disk path (Files/..., Documents/...), its folders made. */
function write(p: string, data: string | Buffer) {
  const full = disk.locate(SLUG, p).abs;
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, data);
}

const read = (p: string, extra: Record<string, unknown> = {}) => files.read(SLUG, { path: p, ...extra });

/** A workbook with a Budget sheet (a formula in B4) and a Team sheet, as bytes. */
function budgetXlsx(): Buffer {
  const budget = sheetFromCsv("sheet-1", "Budget", "Item,Amount\nRent,1200\nFood,300");
  budget.cells.A4 = { v: "Total" };
  budget.cells.B4 = { f: "=SUM(B2:B3)" };
  const team = sheetFromCsv("sheet-2", "Team", "Name,Role\nAda,Lead");
  const index = { ...emptyIndex("Budget"), sheets: [{ id: "sheet-1", title: "Budget" }, { id: "sheet-2", title: "Team" }] };
  const sheets: SheetData[] = [budget, team];
  return Buffer.from(exportXlsx(index, sheets, evaluateAll(new Map(sheets.map((s) => [s.id, s])), index.timeZone)));
}

/** Loads a Fenna sheet folder with the sheet package, as the app's own check does. */
async function loadFolder(dir: string) {
  return loadWorkbook({
    read: async (rel: string) => {
      const f = path.join(dir, rel);
      return existsSync(f) ? readFileSync(f, "utf8") : null;
    },
    list: async (rel: string) => (existsSync(path.join(dir, rel)) ? readdirSync(path.join(dir, rel)) : []),
  });
}

const libraryDir = () => path.join(botDir(), "library");

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crew-files-"));
  outside = mkdtempSync(path.join(tmpdir(), "crew-files-outside-"));
  store = createStore(root);
  mkdirSync(botDir(), { recursive: true });
  writeFileSync(path.join(botDir(), "bot.md"), "# research\n");
  settingsFile = path.join(root, "disk-quotas.json");
  disk = createDisk({ store, starterFiles, settingsFile });
  files = createFiles({ disk });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("read_file: paths", () => {
  it("refuses anything outside the bot's disk", async () => {
    for (const p of ["/etc/passwd", "\\x", "Files/../../x", "C:/x", "Files/a/../../../b", "Nope/x.txt"]) {
      await expect(read(p)).rejects.toThrow(OUTSIDE_MSG);
    }
  });

  it("refuses Trash, which is restored before it can be read", async () => {
    write("Trash/old.txt", "old");
    await expect(read("Trash/old.txt")).rejects.toThrow("Restore it first");
  });

  it("refuses a file reached through a link", async () => {
    mkdirSync(path.join(outside, "dir"));
    writeFileSync(path.join(outside, "dir", "secret.txt"), "nope");
    mkdirSync(path.join(botDir(), "workspace"), { recursive: true });
    symlinkSync(path.join(outside, "dir"), path.join(botDir(), "workspace", "link"), "junction");
    await expect(read("Files/link/secret.txt")).rejects.toThrow(LINK_MSG);
  });

  it("says what to do for a missing file and for a folder", async () => {
    write("Files/notes/a.txt", "hi");
    await expect(read("Files/missing.txt")).rejects.toThrow("There is no file at Files/missing.txt");
    await expect(read("Files/notes")).rejects.toThrow("is a folder");
  });

  it("sends a Fenna document to the fenna tools", async () => {
    write("Documents/q3-report/doc.json", JSON.stringify({ title: "Q3" }));
    await expect(read("Documents/q3-report/doc.json")).rejects.toThrow('use path "q3-report" with doc_overview, then read_tab');
  });

  it("refuses a Documents entry that is not a document", async () => {
    write("Documents/loose.txt", "x");
    await expect(read("Documents/loose.txt")).rejects.toThrow("Documents holds Fenna documents only");
  });
});

describe("read_file: text", () => {
  it("shows the first 400 lines numbered, and says how to read on", async () => {
    write("Files/long.txt", Array.from({ length: 1000 }, (_, i) => `l${i + 1}`).join("\n"));
    const r = await read("Files/long.txt");
    expect(r.text).toMatch(/^long\.txt: lines 1-400 of 1000\./);
    expect(r.text).toContain("400  l400");
    expect(r.text).not.toContain("l401");
    expect(r.text).toContain("600 more lines. Read them with offset: 401.");
  });

  it("pages with offset and limit", async () => {
    write("Files/long.txt", Array.from({ length: 1000 }, (_, i) => `l${i + 1}`).join("\n"));
    const r = await read("Files/long.txt", { offset: 401, limit: 100 });
    expect(r.text).toContain("lines 401-500 of 1000");
    expect(r.text).toContain("401  l401");
    expect(r.text).toContain("500  l500");
    expect(r.text).toContain("500 more lines. Read them with offset: 501.");
  });

  it("says so when the offset is past the end, and for an empty file", async () => {
    write("Files/short.txt", "one\ntwo\n");
    await expect(read("Files/short.txt", { offset: 9 })).rejects.toThrow("has 2 lines, so line 9 is past its end");
    write("Files/empty.md", "");
    expect((await read("Files/empty.md")).text).toBe("empty.md is empty.");
  });

  it("shows a code or unknown text file, and says what a binary file is", async () => {
    write("Files/tool.py", "print('hi')\n");
    expect((await read("Files/tool.py")).text).toContain("1  print('hi')");
    write("Files/data.bin", Buffer.from([0, 1, 2, 3]));
    expect((await read("Files/data.bin")).text).toMatch(/data\.bin is a binary file \(BIN, 1 KB\)/);
  });

  it("says text from PDFs is not supported and where to open them", async () => {
    write("Files/offer.pdf", "%PDF-1.4");
    const r = await read("Files/offer.pdf");
    expect(r.text).toContain("Text from PDFs isn't supported yet");
    expect(r.text).toContain("PDF viewer");
  });
});

describe("read_file: tables", () => {
  it("shows a CSV as a table with its size and row numbers", async () => {
    write("Files/people.csv", 'name,amount\nAda,3\nLin,"5, five"\n');
    const r = await read("Files/people.csv");
    expect(r.text).toContain('Sheet "people": 3 rows, 2 columns (A1:B3).');
    expect(r.text).toContain("1 | name | amount");
    expect(r.text).toContain("2 | Ada | 3");
    expect(r.text).toContain("3 | Lin | 5, five");
    expect(r.text).toContain("Rows 1-3 shown.");
  });

  it("pages CSV rows with offset and limit", async () => {
    write("Files/people.csv", "name,amount\nAda,3\nLin,5\n");
    const r = await read("Files/people.csv", { offset: 2, limit: 1 });
    expect(r.text).toContain("2 | Ada | 3");
    expect(r.text).not.toContain("3 | Lin | 5");
    expect(r.text).toContain("1 more rows. Read them with offset: 3.");
  });

  it("shows a TSV file as a table", async () => {
    write("Files/scores.tsv", "team\tpoints\nred\t7\n");
    expect((await read("Files/scores.tsv")).text).toContain("2 | red | 7");
  });

  it("shows every sheet of an .xlsx with computed values, and one sheet when asked", async () => {
    write("Files/budget.xlsx", budgetXlsx());
    const r = await read("Files/budget.xlsx");
    expect(r.text).toContain("budget.xlsx: 2 sheets");
    expect(r.text).toContain('Sheet "Budget": 4 rows, 2 columns (A1:B4).');
    expect(r.text).toContain("2 | Rent | 1200");
    expect(r.text).toContain("4 | Total | 1500");
    expect(r.text).toContain('Sheet "Team": 2 rows, 2 columns');

    const one = await read("Files/budget.xlsx", { sheet: "team" });
    expect(one.text).not.toContain('Sheet "Budget"');
    expect(one.text).toContain("2 | Ada | Lead");
    expect((await read("Files/budget.xlsx", { sheet: 1 })).text).toContain('Sheet "Budget"');
    await expect(read("Files/budget.xlsx", { sheet: 3 })).rejects.toThrow('There is no sheet 3 in budget.xlsx. Its sheets are: 1 "Budget", 2 "Team".');
  });

  it("says what to do with a broken .xlsx and with an old .xls", async () => {
    write("Files/broken.xlsx", "not a workbook");
    await expect(read("Files/broken.xlsx")).rejects.toThrow("isn't a readable .xlsx workbook");
    write("Files/old.xls", "x");
    await expect(read("Files/old.xls")).rejects.toThrow("Ask the person to save it as .xlsx");
  });
});

describe("read_file: images", () => {
  it("returns a PNG as an image the model sees, with its name, size and bytes", async () => {
    write("Files/tiny.png", TINY_PNG);
    const r = await read("Files/tiny.png");
    expect(r.text).toMatch(/^tiny\.png: 1 × 1 px, \d+ (bytes|KB)\.$/);
    expect(r.image).toEqual({ data: TINY_PNG.toString("base64"), mimeType: "image/png" });
  });

  it("scales an image whose longest side is over 1568 px, with the image's own encoder", async () => {
    // A PNG header that says 3000 x 2000; the scaling is checked, not the picture.
    const header = Buffer.concat([
      Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
      Buffer.from([0, 0, 0x0b, 0xb8, 0, 0, 0x07, 0xd0]),
      Buffer.alloc(16),
    ]);
    write("Files/big.png", header);
    const resized: { width: number; height: number }[] = [];
    const picture = (width: number, height: number) => ({
      isEmpty: () => false,
      resize: (o: { width: number; height: number }) => {
        resized.push(o);
        return picture(o.width, o.height);
      },
      toPNG: () => Buffer.alloc(1000),
      toJPEG: () => Buffer.alloc(10),
    });
    const scaled = createFiles({ disk, nativeImage: () => ({ createFromBuffer: () => picture(3000, 2000) }) });
    const r = await scaled.read(SLUG, { path: "Files/big.png" });
    expect(r.text).toContain("big.png: 3000 × 2000 px");
    expect(r.text).toContain("Shown at 1568 × 1045 px");
    expect(resized).toEqual([{ width: 1568, height: 1045, quality: "best" }]);
    expect(r.image.mimeType).toBe("image/png");
  });
});

describe("import_sheet", () => {
  it("makes a Fenna sheet folder that the sheet package checks with zero problems", async () => {
    write("Files/budget.xlsx", budgetXlsx());
    const r = await files.importSheet(SLUG, { path: "Files/budget.xlsx", title: "Budget Q3" });
    expect(r.text).toContain('Created the sheet "Budget Q3" at path "budget-q3" with 2 sheets: "Budget", "Team".');
    expect(r.text).toContain('sheet_overview {path: "budget-q3"}');

    const folder = path.join(libraryDir(), "budget-q3");
    const wb = await loadFolder(folder);
    expect(wb.problems).toEqual([]);
    for (const s of wb.sheets.values()) expect(s.error).toBeNull();
    expect(wb.index.title).toBe("Budget Q3");
    const budget = wb.sheets.get("sheet-1")!.sheet!;
    expect(budget.cells.A2?.v).toBe("Rent");
    expect(budget.cells.B2?.v).toBe(1200);
    expect(budget.cells.B4?.f).toBe("=SUM(B2:B3)");
    expect(readdirSync(libraryDir()).some((n) => n.startsWith("."))).toBe(false);
  });

  it("imports a CSV under its file name, and a folder name never clashes", async () => {
    write("Files/people.csv", "name,amount\nAda,3\n");
    expect((await files.importSheet(SLUG, { path: "Files/people.csv" })).text).toContain('at path "people"');
    expect((await files.importSheet(SLUG, { path: "Files/people.csv" })).text).toContain('at path "people-2"');
    const wb = await loadFolder(path.join(libraryDir(), "people"));
    expect(wb.problems).toEqual([]);
    expect(wb.sheets.get("sheet-1")!.sheet!.cells.A1?.v).toBe("name");
  });

  it("refuses other files, other places and titles that are too long", async () => {
    write("Files/notes.txt", "x");
    write("Files/a.csv", "x");
    await expect(files.importSheet(SLUG, { path: "Files/notes.txt" })).rejects.toThrow("import_sheet takes an .xlsx or .csv file");
    write("Documents/x/sheet.json", "{}");
    await expect(files.importSheet(SLUG, { path: "Documents/x/sheet.json" })).rejects.toThrow("Import a spreadsheet from Files or Downloads");
    await expect(files.importSheet(SLUG, { path: "Files/a.csv", title: "x".repeat(201) })).rejects.toThrow("The title is 201 characters");
  });

  it("refuses a file that will not fit in the bot's disk", async () => {
    write("Files/a.csv", "name\nAda\n");
    const tight = createFiles({ disk: { ...disk, free: () => 10 } });
    await expect(tight.importSheet(SLUG, { path: "Files/a.csv" })).rejects.toThrow("That won't fit in the bot's disk.");
  });
});

describe("export_file", () => {
  async function importBudget() {
    write("Files/budget.xlsx", budgetXlsx());
    await files.importSheet(SLUG, { path: "Files/budget.xlsx", title: "Budget Q3" });
  }

  it("saves a sheet as .xlsx in Files/Outbox, and the file reads back to the same values", async () => {
    await importBudget();
    const r = await files.exportFile(SLUG, { document: "Documents/budget-q3", format: "xlsx" });
    expect(r.text).toMatch(/^Exported "Budget Q3" to Files\/Outbox\/Budget Q3\.xlsx \(.+\): 2 sheets\.$/);
    const back = await importXlsx(new Uint8Array(readFileSync(disk.locate(SLUG, "Files/Outbox/Budget Q3.xlsx").abs)));
    expect(back.sheets.map((s) => s.title)).toEqual(["Budget", "Team"]);
    expect(back.sheets[0]!.cells.A2?.v).toBe("Rent");
    expect(back.sheets[0]!.cells.B2?.v).toBe(1200);
    expect(back.sheets[0]!.cells.B4?.f).toBe("=SUM(B2:B3)");
  });

  it("saves the first sheet as .csv, and a second export takes a new name", async () => {
    await importBudget();
    const first = await files.exportFile(SLUG, { document: "Documents/budget-q3", format: "csv" });
    expect(first.text).toContain('the first sheet, "Budget"');
    expect(readFileSync(disk.locate(SLUG, "Files/Outbox/Budget Q3.csv").abs, "utf8")).toBe("Item,Amount\r\nRent,1200\r\nFood,300\r\nTotal,1500\r\n");
    const second = await files.exportFile(SLUG, { document: "Documents/budget-q3", format: "csv" });
    expect(second.text).toContain("to Files/Outbox/Budget Q3 (2).csv");
    expect(existsSync(disk.locate(SLUG, "Files/Outbox/Budget Q3 (2).csv").abs)).toBe(true);
  });

  it("saves to a path the person names in Files, and refuses to overwrite it", async () => {
    await importBudget();
    const r = await files.exportFile(SLUG, { document: "Documents/budget-q3", format: "xlsx", to: "Files/reports/q3" });
    expect(r.text).toContain("to Files/reports/q3.xlsx");
    await expect(files.exportFile(SLUG, { document: "Documents/budget-q3", format: "xlsx", to: "Files/reports/q3.xlsx" })).rejects.toThrow("There is already a file at Files/reports/q3.xlsx");
    await expect(files.exportFile(SLUG, { document: "Documents/budget-q3", format: "xlsx", to: "Downloads/q3.xlsx" })).rejects.toThrow("Export into Files");
  });

  it("refuses documents that are not sheets, bad formats and a full disk", async () => {
    write("Documents/notes/doc.json", JSON.stringify({ title: "Notes" }));
    await expect(files.exportFile(SLUG, { document: "Documents/notes", format: "xlsx" })).rejects.toThrow("isn't a Fenna sheet");
    await expect(files.exportFile(SLUG, { document: "Documents/missing", format: "xlsx" })).rejects.toThrow('There is no document "missing"');
    await importBudget();
    await expect(files.exportFile(SLUG, { document: "Documents/budget-q3", format: "pdf" })).rejects.toThrow('Use format "xlsx" or "csv"');
    const tight = createFiles({ disk: { ...disk, free: () => 10 } });
    await expect(tight.exportFile(SLUG, { document: "Documents/budget-q3", format: "xlsx" })).rejects.toThrow("That won't fit in the bot's disk.");
  });

  it("round trips: a CSV becomes a sheet and goes back out as the same CSV", async () => {
    write("Files/people.csv", "name,amount\nAda,3\nLin,5\n");
    await files.importSheet(SLUG, { path: "Files/people.csv" });
    await files.exportFile(SLUG, { document: "Documents/people", format: "csv" });
    expect(readFileSync(disk.locate(SLUG, "Files/Outbox/people.csv").abs, "utf8")).toBe("name,amount\r\nAda,3\r\nLin,5\r\n");
  });
});
