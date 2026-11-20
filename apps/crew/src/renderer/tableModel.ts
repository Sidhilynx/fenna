// What the table viewer shows, with no React: the formats it reads (csv, tsv,
// xlsx; xls is refused), the parsed rows, and the limits. Values only: a
// workbook's cached results where the file has them, otherwise the cell text.

import { colToLetter, importXlsx, parseCellRef, type CellData } from "@opendeck/sheet";

export const TABLE_ROW_LIMIT = 1000;
export const TABLE_COL_LIMIT = 100;
/** Larger files are not read at all; the viewer says so. */
export const TABLE_BYTES_LIMIT = 50 * 1024 * 1024;

/** One sheet, or the whole of a csv or tsv file: its first rows and columns, and the totals behind them. */
export interface Table {
  title: string;
  /** At most TABLE_ROW_LIMIT rows, each exactly `shownCols` wide. */
  rows: string[][];
  shownCols: number;
  totalRows: number;
  totalCols: number;
}

export type TableFormat = "csv" | "tsv" | "xlsx" | "xls";

/** The table format of a file name, or null when the viewer does not read it. */
export function tableFormatOf(name: string): TableFormat | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return ext === "csv" || ext === "tsv" || ext === "xlsx" || ext === "xls" ? ext : null;
}

/**
 * Parses RFC 4180 style text with the given delimiter. Quotes wrap a field
 * (doubled quotes are one), a field may hold the delimiter or a line break,
 * CRLF and LF both end a row, a byte order mark is ignored, and a final line
 * break does not add an empty row.
 */
export function parseDelimited(text: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A table from parsed rows: the first TABLE_ROW_LIMIT rows and TABLE_COL_LIMIT columns, padded to one width. */
export function tableFromRows(title: string, rows: string[][]): Table {
  const totalCols = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const shownCols = Math.min(totalCols, TABLE_COL_LIMIT);
  const shown = rows.slice(0, TABLE_ROW_LIMIT).map((r) => {
    const out = r.slice(0, shownCols);
    while (out.length < shownCols) out.push("");
    return out;
  });
  return { title, rows: shown, shownCols, totalRows: rows.length, totalCols };
}

/** The text of one workbook cell: numbers as written, TRUE and FALSE for booleans, nothing for empty cells. */
export function cellText(v: CellData["v"]): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

/** A table from a workbook sheet's cells (keys like "B3"). Rows and columns run to the last non-empty cell. */
export function tableFromCells(title: string, cells: Record<string, CellData>): Table {
  let totalRows = 0;
  let totalCols = 0;
  const placed: { row: number; col: number; text: string }[] = [];
  for (const [ref, cell] of Object.entries(cells)) {
    const text = cellText(cell.v);
    if (text === "") continue;
    const at = parseCellRef(ref);
    if (!at) continue;
    totalRows = Math.max(totalRows, at.row + 1);
    totalCols = Math.max(totalCols, at.col + 1);
    placed.push({ row: at.row, col: at.col, text });
  }
  const shownCols = Math.min(totalCols, TABLE_COL_LIMIT);
  const shownRows = Math.min(totalRows, TABLE_ROW_LIMIT);
  const rows: string[][] = Array.from({ length: shownRows }, () => Array.from({ length: shownCols }, () => ""));
  for (const p of placed) {
    if (p.row < shownRows && p.col < shownCols) rows[p.row]![p.col] = p.text;
  }
  return { title, rows, shownCols, totalRows, totalCols };
}

/** Column letters for the header: A, B, ... Z, AA. */
export function columnLetters(table: Table): string[] {
  return Array.from({ length: table.shownCols }, (_, i) => colToLetter(i));
}

/** A number as a person writes it: optional sign, digits, optional fraction and exponent. Shown in monospace, right-aligned. */
export function isNumeric(text: string): boolean {
  return /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(text);
}

const count = (n: number) => n.toLocaleString("en-US");

/** What is not shown: rows and columns past the limits, or null when everything is shown. */
export function limitNote(table: Table): string | null {
  const notes: string[] = [];
  if (table.totalRows > table.rows.length) {
    notes.push(`Showing the first ${count(table.rows.length)} rows. ${count(table.totalRows - table.rows.length)} more are not shown.`);
  }
  if (table.totalCols > table.shownCols) {
    notes.push(`Showing the first ${count(table.shownCols)} columns. ${count(table.totalCols - table.shownCols)} more are not shown.`);
  }
  return notes.length ? notes.join(" ") : null;
}

/**
 * The tables in a file: one for a csv or tsv file, one per sheet for xlsx.
 * Throws with a message to show when the format is not read here.
 */
export async function readTables(name: string, bytes: Uint8Array): Promise<Table[]> {
  const format = tableFormatOf(name);
  if (format === "xlsx") {
    const book = await importXlsx(bytes, name.replace(/\.xlsx$/i, ""));
    return book.sheets.map((s) => tableFromCells(s.title, s.cells));
  }
  if (format === "csv" || format === "tsv") {
    const text = new TextDecoder("utf-8").decode(bytes);
    if (text.includes("\u0000")) throw new Error("Not a text file.");
    return [tableFromRows("", parseDelimited(text, format === "csv" ? "," : "\t"))];
  }
  throw new Error("Crew can't read .xls files yet. Save it as .xlsx or .csv.");
}
