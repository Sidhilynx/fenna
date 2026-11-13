// Workbook folder model, validation, sheet/cell mutations, sort, fill, and loader.

import { canonicalZone, LOCALES, systemSettings } from "./format.ts";
import { type EvalValue, FormulaError, shiftFormula } from "./formula.ts";
import { type Axis, type IndexMap, remapFormula, remapRange, remapRef, shiftMap, swapMap } from "./refs.ts";
import {
  type CellData,
  type CellStyle,
  type ChartSpec,
  type ConditionalRule,
  type Dropdown,
  type GroupRange,
  FORMAT,
  LEGACY_FORMAT,
  formatCellRef,
  LIMITS,
  type MergeRange,
  OPTION_COLORS,
  type OptionColor,
  parseCellRef,
  parseRangeRef,
  type PersonValue,
  SHEET_ID_RE,
  type SheetData,
  type SheetRef,
  type WorkbookIndex,
} from "./schema.ts";

export interface LoadedSheet {
  id: string;
  sheet: SheetData | null;
  error: string | null;
  source: string;
}

export interface LoadedWorkbook {
  index: WorkbookIndex;
  sheets: Map<string, LoadedSheet>;
  problems: string[];
}

export interface WorkbookReader {
  read(rel: string): Promise<string | null>;
  list(dir: string): Promise<string[]>;
}

export const sheetFile = (id: string) => `sheets/${id}.json`;
export const SHEET_FILE_RE = /^sheets\/([A-Za-z][A-Za-z0-9_-]{0,63})\.json$/;

export function emptyIndex(title = "Untitled"): WorkbookIndex {
  const sys = systemSettings();
  return {
    format: FORMAT,
    title,
    locale: sys.locale,
    timeZone: sys.timeZone,
    sheets: [],
    dropdowns: [],
    people: [],
  };
}

export function emptySheet(id: string, title = "Sheet1"): SheetData {
  return {
    id,
    title,
    rows: LIMITS.defaultRows,
    cols: LIMITS.defaultCols,
    rowHeights: {},
    colWidths: {},
    frozenRows: 0,
    frozenCols: 0,
    showGridlines: true,
    cells: {},
    merges: [],
    rules: [],
    charts: [],
    filter: null,
    colGroups: [],
    rowGroups: [],
  };
}

export const indexText = (index: WorkbookIndex) => JSON.stringify(index, null, 2) + "\n";
export const sheetText = (sheet: SheetData) => JSON.stringify(sheet, null, 2) + "\n";

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

export function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function checkIndex(raw: unknown): { index: WorkbookIndex | null; errors: string[] } {
  const errors: string[] = [];
  const o = raw as Partial<WorkbookIndex> | null;
  if (!o || typeof o !== "object") return { index: null, errors: ["sheet.json must be an object"] };
  if (o.format !== undefined && o.format !== FORMAT && o.format !== LEGACY_FORMAT) errors.push(`format must be "${FORMAT}"`);
  if (!isStr(o.title, LIMITS.titleChars)) errors.push(`title must be text of at most ${LIMITS.titleChars} characters`);

  const sheets: SheetRef[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(o.sheets)) errors.push("sheets must be a list");
  else {
    for (const s of o.sheets.slice(0, LIMITS.sheets)) {
      const r = s as Partial<SheetRef> | null;
      if (!r || !isStr(r.id, 64) || !SHEET_ID_RE.test(r.id) || seen.has(r.id)) {
        errors.push("each sheet needs a unique valid id");
        continue;
      }
      seen.add(r.id);
      sheets.push({
        id: r.id,
        title: isStr(r.title, LIMITS.titleChars) && r.title.trim() ? r.title.trim() : r.id,
        ...(typeof r.color === "string" ? { color: r.color } : {}),
      });
    }
  }

  const dropdowns: Dropdown[] = [];
  if (Array.isArray(o.dropdowns)) {
    for (const d of o.dropdowns.slice(0, LIMITS.dropdowns)) {
      if (!d || typeof d.id !== "string" || typeof d.name !== "string" || !Array.isArray(d.options)) continue;
      dropdowns.push({
        id: d.id,
        name: d.name.trim() || d.id,
        options: d.options.slice(0, LIMITS.dropdownOptions).map((opt) => ({
          id: String(opt.id),
          label: String(opt.label),
          color: OPTION_COLORS.includes(opt.color as OptionColor) ? (opt.color as OptionColor) : "gray",
        })),
      });
    }
  }

  const people: PersonValue[] = Array.isArray(o.people)
    ? o.people
        .slice(0, LIMITS.people)
        .filter((p): p is PersonValue => !!p && typeof p.name === "string" && !!p.name.trim())
        .map((p) => ({ name: p.name.trim(), ...(typeof p.email === "string" ? { email: p.email.trim() } : {}) }))
    : [];

  if (errors.length) return { index: null, errors };
  return {
    index: {
      format: FORMAT,
      title: (o.title as string).trim() || "Untitled",
      locale: isStr(o.locale, 40) && LOCALES.some((l) => l.id === o.locale) ? o.locale : "en-US",
      timeZone: isStr(o.timeZone, 80) && validZone(o.timeZone) ? canonicalZone(o.timeZone) : "UTC",
      sheets,
      dropdowns,
      people,
    },
    errors,
  };
}

/** Groups from a file, keeping only well-formed ones that don't overlap. */
function cleanGroups(raw: unknown): GroupRange[] {
  if (!Array.isArray(raw)) return [];
  let out: GroupRange[] = [];
  for (const g of raw as Partial<GroupRange>[]) {
    if (!g || !Number.isInteger(g.start) || !Number.isInteger(g.end) || g.start! < 0 || g.end! < g.start!) continue;
    out = addGroup(out, g.start!, g.end!, g.collapsed === true);
  }
  return out;
}

/**
 * Groups after grouping columns or rows start..end. Groups are one level deep:
 * a new group joins any group it overlaps into one.
 */
export function addGroup(groups: readonly GroupRange[], start: number, end: number, collapsed = false): GroupRange[] {
  let a = Math.min(start, end);
  let b = Math.max(start, end);
  const keep: GroupRange[] = [];
  for (const g of groups) {
    if (g.end < a || g.start > b) keep.push(g);
    else {
      a = Math.min(a, g.start);
      b = Math.max(b, g.end);
    }
  }
  return [...keep, { start: a, end: b, ...(collapsed ? { collapsed } : {}) }].sort((x, y) => x.start - y.start);
}

/** Groups after taking columns or rows start..end out of them; a group they cut through splits in two. */
export function removeGroup(groups: readonly GroupRange[], start: number, end: number): GroupRange[] {
  const out: GroupRange[] = [];
  for (const g of groups) {
    if (g.end < start || g.start > end) {
      out.push(g);
      continue;
    }
    if (g.start < start) out.push({ ...g, end: start - 1 });
    if (g.end > end) out.push({ ...g, start: end + 1 });
  }
  return out;
}

export function checkSheet(raw: unknown, fallbackId = "sheet-1"): { sheet: SheetData | null; error: string | null } {
  const o = raw as Partial<SheetData> | null;
  if (!o || typeof o !== "object") return { sheet: null, error: "Sheet file must be a JSON object" };
  const id = typeof o.id === "string" && SHEET_ID_RE.test(o.id) ? o.id : fallbackId;
  const cells: Record<string, CellData> = {};
  if (o.cells && typeof o.cells === "object") {
    for (const [k, v] of Object.entries(o.cells)) {
      const parsed = parseCellRef(k);
      if (!parsed || !v || typeof v !== "object") continue;
      cells[formatCellRef(parsed.row, parsed.col)] = v;
    }
  }
  return {
    sheet: {
      id,
      title: typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, LIMITS.titleChars) : "Sheet1",
      rows: typeof o.rows === "number" && o.rows >= 1 ? Math.min(LIMITS.maxRows, Math.trunc(o.rows)) : LIMITS.defaultRows,
      cols: typeof o.cols === "number" && o.cols >= 1 ? Math.min(LIMITS.maxCols, Math.trunc(o.cols)) : LIMITS.defaultCols,
      rowHeights: o.rowHeights && typeof o.rowHeights === "object" ? o.rowHeights : {},
      colWidths: o.colWidths && typeof o.colWidths === "object" ? o.colWidths : {},
      frozenRows: typeof o.frozenRows === "number" && o.frozenRows >= 0 ? Math.trunc(o.frozenRows) : 0,
      frozenCols: typeof o.frozenCols === "number" && o.frozenCols >= 0 ? Math.trunc(o.frozenCols) : 0,
      showGridlines: o.showGridlines !== false,
      ...(typeof o.color === "string" ? { color: o.color } : {}),
      cells,
      merges: Array.isArray(o.merges) ? o.merges : [],
      rules: Array.isArray(o.rules) ? o.rules.slice(0, LIMITS.rulesPerSheet) : [],
      charts: Array.isArray(o.charts) ? o.charts.slice(0, LIMITS.chartsPerSheet) : [],
      filter: o.filter && typeof o.filter === "object" ? o.filter : null,
      colGroups: cleanGroups(o.colGroups),
      rowGroups: cleanGroups(o.rowGroups),
    },
    error: null,
  };
}

export async function loadWorkbook(r: WorkbookReader): Promise<LoadedWorkbook> {
  const problems: string[] = [];
  const text = await r.read("sheet.json");
  let index = emptyIndex();
  if (text === null) {
    problems.push("sheet.json is missing; sheets are listed in file order");
  } else {
    try {
      const raw = JSON.parse(text);
      const c = checkIndex(raw);
      if (c.index) index = c.index;
      else problems.push(`sheet.json has problems: ${c.errors.join("; ")}`);
    } catch (e) {
      problems.push(`sheet.json is not valid JSON (${(e as Error).message})`);
    }
  }

  const files = (await r.list("sheets"))
    .map((f) => /^([A-Za-z][A-Za-z0-9_-]{0,63})\.json$/.exec(f)?.[1])
    .filter((id): id is string => !!id);
  const listed = new Set(index.sheets.map((s) => s.id));
  const extra = files.filter((id) => !listed.has(id)).sort();
  if (extra.length) {
    index = { ...index, sheets: [...index.sheets, ...extra.map((id) => ({ id, title: id }))] };
  }

  const sheets = new Map<string, LoadedSheet>();
  await Promise.all(
    index.sheets.map(async (ref) => {
      const source = await r.read(sheetFile(ref.id));
      if (source === null) {
        sheets.set(ref.id, { id: ref.id, sheet: null, error: `sheets/${ref.id}.json is missing`, source: "" });
        return;
      }
      try {
        const c = checkSheet(JSON.parse(source), ref.id);
        sheets.set(ref.id, { id: ref.id, sheet: c.sheet, error: c.error, source });
      } catch (e) {
        sheets.set(ref.id, { id: ref.id, sheet: null, error: (e as Error).message, source });
      }
    }),
  );
  return { index, sheets, problems };
}

export function newWorkbookFiles(title = "Untitled"): { index: WorkbookIndex; sheets: Record<string, string> } {
  const index: WorkbookIndex = {
    ...emptyIndex(title.trim() || "Untitled"),
    sheets: [{ id: "sheet-1", title: "Sheet1" }],
  };
  return {
    index,
    sheets: { "sheet-1": sheetText(emptySheet("sheet-1", "Sheet1")) },
  };
}

export function newSheetId(sheets: SheetRef[], base = "sheet"): string {
  const taken = new Set(sheets.map((s) => s.id));
  const clean = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "") || "sheet";
  if (!taken.has(clean)) return clean;
  for (let i = 2; ; i++) if (!taken.has(`${clean}-${i}`)) return `${clean}-${i}`;
}

export function nextSheetTitle(sheets: SheetRef[]): string {
  const taken = new Set(sheets.map((s) => s.title.toLowerCase()));
  for (let i = 1; ; i++) {
    const t = `Sheet${i}`;
    if (!taken.has(t.toLowerCase())) return t;
  }
}

function isEmptyCell(c: CellData | undefined): boolean {
  if (!c) return true;
  if (c.v !== undefined && c.v !== null && c.v !== "") return false;
  if (c.f !== undefined && c.f !== "") return false;
  if (c.t && c.t !== "auto") return false;
  if (c.note) return false;
  if (c.s && Object.keys(c.s).length > 0) return false;
  return true;
}

export function patchCells(sheet: SheetData, updates: Record<string, CellData | null>): SheetData {
  const cells = { ...sheet.cells };
  let rows = sheet.rows;
  let cols = sheet.cols;
  for (const [rawRef, data] of Object.entries(updates)) {
    const parsed = parseCellRef(rawRef);
    if (!parsed) continue;
    const ref = formatCellRef(parsed.row, parsed.col);
    if (data === null || isEmptyCell(data)) {
      delete cells[ref];
    } else {
      cells[ref] = data;
      if (parsed.row + 1 > rows) rows = Math.min(LIMITS.maxRows, parsed.row + 10);
      if (parsed.col + 1 > cols) cols = Math.min(LIMITS.maxCols, parsed.col + 4);
    }
  }
  return { ...sheet, rows, cols, cells };
}

export function patchCellStyle(sheet: SheetData, refs: string[], patch: Partial<CellStyle>): SheetData {
  const updates: Record<string, CellData | null> = {};
  for (const ref of refs) {
    const cur = sheet.cells[ref] ?? {};
    const nextStyle: CellStyle = { ...cur.s, ...patch };
    for (const [k, v] of Object.entries(nextStyle)) {
      if (v === undefined || v === false) delete (nextStyle as Record<string, unknown>)[k];
    }
    if (Object.keys(nextStyle).length === 0) {
      const rest = { ...cur };
      delete rest.s;
      updates[ref] = isEmptyCell(rest) ? null : rest;
    } else {
      updates[ref] = { ...cur, s: nextStyle };
    }
  }
  return patchCells(sheet, updates);
}

export function clearRange(sheet: SheetData, range: string, mode: "contents" | "formatting" | "both"): SheetData {
  const r = parseRangeRef(range);
  if (!r) return sheet;
  const updates: Record<string, CellData | null> = {};
  for (let row = r.r1; row <= r.r2; row++) {
    for (let col = r.c1; col <= r.c2; col++) {
      const ref = formatCellRef(row, col);
      const cur = sheet.cells[ref];
      if (!cur) continue;
      if (mode === "both") updates[ref] = null;
      else if (mode === "contents") {
        const next: CellData = cur.s ? { s: cur.s } : {};
        updates[ref] = isEmptyCell(next) ? null : next;
      } else {
        const next: CellData = { ...cur };
        delete next.s;
        updates[ref] = isEmptyCell(next) ? null : next;
      }
    }
  }
  return patchCells(sheet, updates);
}

export type StructureOp =
  | { kind: "insert"; axis: Axis; at: number; count: number }
  | { kind: "delete"; axis: Axis; at: number; count: number }
  | { kind: "move"; axis: Axis; from: number; to: number };

function opMap(op: StructureOp): IndexMap {
  if (op.kind === "insert") return shiftMap(op.at, op.count);
  if (op.kind === "delete") return shiftMap(op.at, -op.count);
  return swapMap(op.from, op.to);
}

function remapKeys(sizes: Record<number, number>, map: IndexMap): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(sizes)) {
    const n = map(Number(k));
    if (n !== null) out[n] = v;
  }
  return out;
}

function remapSpan(a: number, b: number, map: IndexMap): [number, number] | null {
  const r = remapRef(`${a + 1}:${b + 1}`, "row", map);
  if (!r) return null;
  const [x, y] = r.split(":").map((s) => Number(s.replace(/\$/g, "")) - 1);
  return [x!, y!];
}

/** How many of the first `n` indexes survive, plus any inserted among them. */
/**
 * A chart's pixel position after rows or columns change: it keeps its place
 * in the column (or row) it starts in, the way a chart anchored to a cell
 * moves with it. A chart whose cell is deleted moves to where the cells were.
 */
function remapPosition(pos: number, before: Record<number, number>, after: Record<number, number>, size: number, count: number, map: IndexMap, op: StructureOp): number {
  let at = 0;
  let i = 0;
  while (i < count && at + (before[i] ?? size) <= pos) at += before[i++] ?? size;
  let to = map(i);
  let rem = pos - at;
  if (to === null) {
    to = op.kind === "delete" ? op.at : i;
    rem = 0;
  }
  let x = 0;
  for (let j = 0; j < to; j++) x += after[j] ?? size;
  return Math.round(x + rem);
}

/**
 * Set columns (or rows) `from`..`to` to one width (or height), within the
 * limits people can drag to; charts after them move so they stay over the
 * same cells.
 */
export function resizeLines(sheet: SheetData, axis: Axis, from: number, to: number, size: number): SheetData {
  const px = axis === "col" ? Math.max(30, Math.min(800, Math.round(size))) : Math.max(18, Math.min(400, Math.round(size)));
  const before = axis === "col" ? sheet.colWidths : sheet.rowHeights;
  const after = { ...before };
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) after[i] = px;
  const dflt = axis === "col" ? LIMITS.defaultColWidth : LIMITS.defaultRowHeight;
  const lines = axis === "col" ? sheet.cols : sheet.rows;
  const same: IndexMap = (i) => i;
  const keep: StructureOp = { kind: "move", axis, from: 0, to: 0 };
  const charts = sheet.charts.map((c) =>
    axis === "col" ? { ...c, x: remapPosition(c.x, before, after, dflt, lines, same, keep) } : { ...c, y: remapPosition(c.y, before, after, dflt, lines, same, keep) },
  );
  return axis === "col" ? { ...sheet, colWidths: after, charts } : { ...sheet, rowHeights: after, charts };
}

function remapCount(n: number, op: StructureOp): number {
  if (n <= 0) return n;
  if (op.kind === "insert") return op.at < n ? n + op.count : n;
  if (op.kind === "delete") return n - Math.max(0, Math.min(n, op.at + op.count) - op.at);
  return n;
}

/**
 * Insert, delete or move rows or columns on one sheet. Returns every sheet
 * that changed: the target, and any other sheet with a formula pointing at it.
 */
export function restructure(sheets: SheetData[], targetId: string, op: StructureOp): SheetData[] {
  const target = sheets.find((s) => s.id === targetId);
  if (!target) return [];
  const map = opMap(op);
  const { axis } = op;
  const changed: SheetData[] = [];
  for (const sheet of sheets) {
    const isTarget = sheet.id === targetId;
    let touched = isTarget;
    const cells: Record<string, CellData> = {};
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      let next = cell;
      if (cell.f) {
        const f = remapFormula(cell.f, sheet, target, axis, map);
        if (f !== cell.f) {
          next = { ...cell, f };
          touched = true;
        }
      }
      if (!isTarget) {
        cells[ref] = next;
        continue;
      }
      const p = parseCellRef(ref);
      if (!p) continue;
      const moved = map(axis === "row" ? p.row : p.col);
      if (moved === null) continue;
      cells[axis === "row" ? formatCellRef(moved, p.col) : formatCellRef(p.row, moved)] = next;
    }
    if (!touched) continue;
    if (!isTarget) {
      changed.push({ ...sheet, cells });
      continue;
    }
    const rangeOf = (range: string) => remapRange(range, axis, map);
    const merges: MergeRange[] = [];
    for (const m of sheet.merges) {
      const span = axis === "row" ? remapSpan(m.r1, m.r2, map) : remapSpan(m.c1, m.c2, map);
      if (!span) continue;
      const next = axis === "row" ? { ...m, r1: span[0], r2: span[1] } : { ...m, c1: span[0], c2: span[1] };
      if (next.r1 !== next.r2 || next.c1 !== next.c2) merges.push(next);
    }
    const rules: ConditionalRule[] = [];
    for (const rule of sheet.rules) {
      const range = rangeOf(rule.range);
      if (!range) continue;
      if (rule.kind === "highlight" && rule.condition === "formula" && rule.values[0]) {
        const f = rule.values[0].startsWith("=") ? rule.values[0] : `=${rule.values[0]}`;
        rules.push({ ...rule, range, values: [remapFormula(f, sheet, target, axis, map), ...rule.values.slice(1)] });
      } else rules.push({ ...rule, range });
    }
    const sizesBefore = axis === "row" ? sheet.rowHeights : sheet.colWidths;
    const sizesAfter = remapKeys(sizesBefore, map);
    const size = axis === "row" ? LIMITS.defaultRowHeight : LIMITS.defaultColWidth;
    const lines = axis === "row" ? sheet.rows : sheet.cols;
    const charts: ChartSpec[] = [];
    for (const chart of sheet.charts) {
      const range = rangeOf(chart.range);
      if (!range) continue;
      const moved = op.kind === "move" ? null : remapPosition(axis === "row" ? chart.y : chart.x, sizesBefore, sizesAfter, size, lines, map, op);
      charts.push(moved === null ? { ...chart, range } : axis === "row" ? { ...chart, range, y: moved } : { ...chart, range, x: moved });
    }
    let filter = sheet.filter;
    if (filter) {
      const range = rangeOf(filter.range);
      if (!range) filter = null;
      else {
        const columnFilters: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(filter.columnFilters)) {
          const c = axis === "col" ? map(Number(k)) : Number(k);
          if (c !== null) columnFilters[String(c)] = v;
        }
        filter = { range, columnFilters };
      }
    }
    const groups = (list: GroupRange[]) =>
      list.flatMap((g) => {
        const span = remapSpan(g.start, g.end, map);
        return span ? [{ ...g, start: span[0], end: span[1] }] : [];
      });
    const grow = op.kind === "insert" ? op.count : op.kind === "delete" ? -op.count : 0;
    changed.push({
      ...sheet,
      cells,
      rows: axis === "row" ? Math.max(1, Math.min(LIMITS.maxRows, sheet.rows + grow)) : sheet.rows,
      cols: axis === "col" ? Math.max(1, Math.min(LIMITS.maxCols, sheet.cols + grow)) : sheet.cols,
      rowHeights: axis === "row" ? sizesAfter : sheet.rowHeights,
      colWidths: axis === "col" ? sizesAfter : sheet.colWidths,
      frozenRows: axis === "row" ? remapCount(sheet.frozenRows, op) : sheet.frozenRows,
      frozenCols: axis === "col" ? remapCount(sheet.frozenCols, op) : sheet.frozenCols,
      merges,
      rules,
      charts,
      filter,
      rowGroups: axis === "row" ? groups(sheet.rowGroups) : sheet.rowGroups,
      colGroups: axis === "col" ? groups(sheet.colGroups) : sheet.colGroups,
    });
  }
  return changed;
}

/** What a cell shows, for sorting: its computed value when it has a formula. */
export type ValueOf = (ref: string) => EvalValue | undefined;

function sortKey(v: EvalValue | undefined): { rank: number; n: number; s: string } {
  if (v === undefined || v === null || v === "") return { rank: 3, n: 0, s: "" };
  if (v instanceof FormulaError) return { rank: 2, n: 0, s: v.code };
  if (typeof v === "number") return { rank: 0, n: v, s: "" };
  if (typeof v === "boolean") return { rank: 1, n: v ? 1 : 0, s: "" };
  return { rank: 1, n: 0, s: v };
}

/**
 * Sort the rows of a range (or of the used part of the sheet) by one column.
 * Empty cells go last either way. Formulas in moved rows follow their row,
 * as when the row is copied there.
 */
export function sortSheetByColumn(sheet: SheetData, col: number, ascending: boolean, rangeStr?: string, hasHeader = true, valueOf?: ValueOf): SheetData {
  let r1 = 0;
  let r2 = -1;
  let c1 = 0;
  let c2 = sheet.cols - 1;
  const parsed = rangeStr ? parseRangeRef(rangeStr) : null;
  if (parsed) {
    r1 = parsed.r1;
    r2 = parsed.r2;
    c1 = parsed.c1;
    c2 = parsed.c2;
  } else {
    for (const ref of Object.keys(sheet.cells)) {
      const p = parseCellRef(ref);
      if (p) r2 = Math.max(r2, p.row);
    }
  }
  const startRow = hasHeader ? r1 + 1 : r1;
  if (r2 <= startRow) return sheet;
  const value = (r: number) => {
    const ref = formatCellRef(r, col);
    return valueOf?.(ref) ?? sheet.cells[ref]?.v ?? null;
  };
  const order: number[] = [];
  for (let r = startRow; r <= r2; r++) order.push(r);
  order.sort((ra, rb) => {
    const a = sortKey(value(ra));
    const b = sortKey(value(rb));
    if (a.rank === 3 || b.rank === 3) return a.rank === b.rank ? ra - rb : a.rank === 3 ? 1 : -1;
    let cmp = a.rank - b.rank;
    if (!cmp) cmp = a.rank === 0 ? a.n - b.n : a.s.localeCompare(b.s, undefined, { numeric: true, sensitivity: "base" });
    if (!cmp) return ra - rb;
    return ascending ? cmp : -cmp;
  });
  const cells = { ...sheet.cells };
  for (let r = startRow; r <= r2; r++) for (let c = c1; c <= c2; c++) delete cells[formatCellRef(r, c)];
  order.forEach((src, i) => {
    const dst = startRow + i;
    for (let c = c1; c <= c2; c++) {
      const cell = sheet.cells[formatCellRef(src, c)];
      if (cell) cells[formatCellRef(dst, c)] = cell.f ? { ...cell, f: shiftFormula(cell.f, dst - src, 0) } : cell;
    }
  });
  const rowHeights = { ...sheet.rowHeights };
  for (let r = startRow; r <= r2; r++) delete rowHeights[r];
  order.forEach((src, i) => {
    const h = sheet.rowHeights[src];
    if (h !== undefined) rowHeights[startRow + i] = h;
  });
  return { ...sheet, cells, rowHeights };
}

export function fillSelection(sheet: SheetData, srcRange: string, dstRange: string): SheetData {
  const src = parseRangeRef(srcRange);
  const dst = parseRangeRef(dstRange);
  if (!src || !dst) return sheet;
  const srcRows = src.r2 - src.r1 + 1;
  const srcCols = src.c2 - src.c1 + 1;
  const updates: Record<string, CellData | null> = {};

  for (let r = dst.r1; r <= dst.r2; r++) {
    for (let c = dst.c1; c <= dst.c2; c++) {
      if (r >= src.r1 && r <= src.r2 && c >= src.c1 && c <= src.c2) continue;
      const sr = src.r1 + (((r - src.r1) % srcRows) + srcRows) % srcRows;
      const sc = src.c1 + (((c - src.c1) % srcCols) + srcCols) % srcCols;
      const base = sheet.cells[formatCellRef(sr, sc)];
      if (!base) continue;
      const dr = r - sr;
      const dc = c - sc;
      if (base.f) {
        updates[formatCellRef(r, c)] = { ...base, f: shiftFormula(base.f, dr, dc) };
      } else if (typeof base.v === "number") {
        // Check if source has a linear step along the fill axis
        let step = 0;
        if (srcRows > 1 && c >= src.c1 && c <= src.c2 && dr !== 0) {
          const prev = sheet.cells[formatCellRef(src.r1, sc)]?.v;
          const next = sheet.cells[formatCellRef(src.r1 + 1, sc)]?.v;
          if (typeof prev === "number" && typeof next === "number") step = next - prev;
          updates[formatCellRef(r, c)] = { ...base, v: base.v + step * (r - sr) };
        } else if (srcCols > 1 && r >= src.r1 && r <= src.r2 && dc !== 0) {
          const prev = sheet.cells[formatCellRef(sr, src.c1)]?.v;
          const next = sheet.cells[formatCellRef(sr, src.c1 + 1)]?.v;
          if (typeof prev === "number" && typeof next === "number") step = next - prev;
          updates[formatCellRef(r, c)] = { ...base, v: base.v + step * (c - sc) };
        } else {
          updates[formatCellRef(r, c)] = { ...base };
        }
      } else {
        updates[formatCellRef(r, c)] = { ...base };
      }
    }
  }
  return patchCells(sheet, updates);
}

export function usedBounds(sheet: SheetData): { maxRow: number; maxCol: number } {
  let maxRow = 0;
  let maxCol = 0;
  for (const ref of Object.keys(sheet.cells)) {
    const p = parseCellRef(ref);
    if (!p) continue;
    if (p.row > maxRow) maxRow = p.row;
    if (p.col > maxCol) maxCol = p.col;
  }
  return { maxRow, maxCol };
}

