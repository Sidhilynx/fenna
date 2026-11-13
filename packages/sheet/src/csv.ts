// RFC 4180 CSV parser and serializer for sheets.

import { parseUserInput, formatCellValue } from "./format.ts";
import { type EvalValue } from "./formula.ts";
import { formatCellRef, LIMITS, type SheetData, type WorkbookIndex } from "./schema.ts";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\n") {
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

function escapeCsvField(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function serializeCsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeCsvField).join(",")).join("\r\n") + (rows.length ? "\r\n" : "");
}

/** A sheet from CSV text: values read the way typing them would be in `locale`, the first row bold and frozen. */
export function sheetFromCsv(id: string, title: string, csvText: string, locale = "en-US"): SheetData {
  const parsed = parseCsv(csvText);
  const cells: SheetData["cells"] = {};
  let maxCol = 0;
  const maxRow = Math.min(parsed.length, LIMITS.maxRows);
  for (let r = 0; r < maxRow; r++) {
    const row = parsed[r]!;
    maxCol = Math.max(maxCol, Math.min(row.length, LIMITS.maxCols));
    for (let c = 0; c < Math.min(row.length, LIMITS.maxCols); c++) {
      const raw = row[c]!;
      if (raw === "") continue;
      const { fmt, ...val } = parseUserInput(raw, locale);
      const s = { ...(r === 0 ? { bold: true } : {}), ...(fmt ? { numFmt: fmt } : {}) };
      cells[formatCellRef(r, c)] = { ...val, ...(Object.keys(s).length ? { s } : {}) };
    }
  }
  return {
    id,
    title,
    rows: Math.max(LIMITS.defaultRows, maxRow + 20),
    cols: Math.max(LIMITS.defaultCols, maxCol + 4),
    rowHeights: {},
    colWidths: {},
    frozenRows: maxRow > 1 ? 1 : 0,
    frozenCols: 0,
    showGridlines: true,
    cells,
    merges: [],
    rules: [],
    charts: [],
    filter: null,
    colGroups: [],
    rowGroups: [],
  };
}

export function sheetToCsv(sheet: SheetData, values: Map<string, EvalValue>, index: Pick<WorkbookIndex, "locale" | "timeZone">): string {
  let maxR = -1;
  let maxC = -1;
  for (const key of Object.keys(sheet.cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(key);
    if (!m) continue;
    let col = 0;
    for (let i = 0; i < m[1]!.length; i++) col = col * 26 + (m[1]!.charCodeAt(i) - 64);
    col -= 1;
    const row = Number(m[2]!) - 1;
    if (row > maxR) maxR = row;
    if (col > maxC) maxC = col;
  }
  if (maxR < 0 || maxC < 0) return "";
  const rows: string[][] = [];
  for (let r = 0; r <= maxR; r++) {
    const line: string[] = [];
    for (let c = 0; c <= maxC; c++) {
      const ref = formatCellRef(r, c);
      const cell = sheet.cells[ref];
      const val = values.get(ref) ?? cell?.v ?? null;
      line.push(formatCellValue(val, cell, index));
    }
    rows.push(line);
  }
  return serializeCsv(rows);
}

