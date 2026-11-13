// The workbook on disk, as the MCP server reads and changes it. Writes are
// atomic (temp file, then rename), so the app watching the folder never sees
// half a file, and every change lands on the user's screen as it is saved.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type CellData,
  type CellStyle,
  type ChartSpec,
  type ChartType,
  type ConditionalRule,
  type Dropdown,
  DROPDOWN_TEMPLATES,
  type EvalValue,
  FormulaError,
  LIMITS,
  type LoadedWorkbook,
  type NumberFormatKind,
  type ParsedRange,
  type PersonValue,
  SHEET_ID_RE,
  type SheetData,
  type StructureOp,
  type WorkbookIndex,
  addGroup,
  checkCellInput,
  impliedFormat,
  checkIndex,
  colToLetter,
  emptySheet,
  evaluateAll,
  findDropdown,
  formatCellRef,
  formatCellValue,
  formatRangeRef,
  hexColor,
  indexText,
  letterToCol,
  lintFormula,
  loadWorkbook,
  newSheetId,
  parseCellRef,
  parseRangeRef,
  patchCells,
  removeGroup,
  resizeLines,
  restructure,
  sheetFile,
  sheetText,
  sortSheetByColumn,
  usedBounds,
} from "@opendeck/sheet";
import { COMMENTS_FILE, MAX_COMMENT, type Thread, isText, parseThreads, serializeThreads } from "@opendeck/shell/threads";

export const versionOf = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 12);

export class StoreError extends Error {}

/** A cell as a model writes it: a value, "=formula", null to clear, or a cell object. */
export type CellInput = string | number | boolean | null | Record<string, unknown>;

interface SheetAnchor {
  sheetId: string;
  range: string;
}
type SheetThread = Thread<SheetAnchor>;

const anchorOf = (raw: Record<string, unknown>): SheetAnchor | null => (isText(raw.sheetId, 80) && isText(raw.range, 40) ? { sheetId: raw.sheetId, range: raw.range } : null);

/** At most this many cells come back from one read; more is offered as a next range. */
const READ_CELLS = 1500;
/** At most this many cells change in one write. */
const WRITE_CELLS = 20_000;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function showValue(v: EvalValue | undefined): string {
  if (v instanceof FormulaError) return `${v.code} ${v.message}`.trim();
  if (v === undefined || v === null) return "(empty)";
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** A range a model wrote ("b2:d9", "C", "C:E", "3", "3:5"), bounded by the sheet. */
function boundedRange(text: string, sheet: SheetData): ParsedRange | null {
  const t = text.trim().toUpperCase().replace(/\s+/g, "");
  const exact = parseRangeRef(t);
  if (exact) return exact;
  const used = usedBounds(sheet);
  const lastRow = Math.max(used.maxRow, 0);
  const cols = /^(\$?[A-Z]{1,3})(?::(\$?[A-Z]{1,3}))?$/.exec(t);
  if (cols) {
    const a = letterToCol(cols[1]!.replace("$", ""));
    const b = letterToCol((cols[2] ?? cols[1]!).replace("$", ""));
    if (a < 0 || b < 0) return null;
    return { r1: 0, c1: Math.min(a, b), r2: lastRow, c2: Math.max(a, b) };
  }
  const rows = /^\$?(\d{1,6})(?::\$?(\d{1,6}))?$/.exec(t);
  if (rows) {
    const a = Number(rows[1]) - 1;
    const b = Number(rows[2] ?? rows[1]) - 1;
    if (a < 0 || b < 0) return null;
    return { r1: Math.min(a, b), c1: 0, r2: Math.max(a, b), c2: Math.max(used.maxCol, 0) };
  }
  return null;
}

const rangeHint = 'Use A1 notation: "B2", "B2:D9", a column "C" or "C:E", or rows "3:5"';

export class SheetStore {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private file(rel: string) {
    const full = path.resolve(this.root, rel);
    if (!full.startsWith(this.root + path.sep)) throw new StoreError(`refused path ${rel}`);
    return full;
  }

  async readText(rel: string): Promise<string | null> {
    return readFile(this.file(rel), "utf8").catch(() => null);
  }

  private async writeText(rel: string, text: string) {
    const full = this.file(rel);
    await mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, full);
  }

  load(): Promise<LoadedWorkbook> {
    return loadWorkbook({ read: (p) => this.readText(p), list: (d) => readdir(this.file(d)).catch(() => []) });
  }

  private static sheetsOf(wb: LoadedWorkbook): Map<string, SheetData> {
    const out = new Map<string, SheetData>();
    for (const [id, l] of wb.sheets) if (l.sheet) out.set(id, l.sheet);
    return out;
  }

  /** A sheet named by its id or its title, any case. */
  private locate(wb: LoadedWorkbook, name: string) {
    const low = name.trim().toLowerCase();
    const ref = wb.index.sheets.find((s) => s.id.toLowerCase() === low) ?? wb.index.sheets.find((s) => s.title.trim().toLowerCase() === low);
    const list = wb.index.sheets.map((s) => `${s.id} ("${s.title}")`).join(", ");
    if (!ref) throw new StoreError(`There is no sheet "${name}". Sheets: ${list}`);
    const loaded = wb.sheets.get(ref.id);
    if (!loaded?.sheet) throw new StoreError(`Sheet "${ref.title}" could not be read (${loaded?.error ?? "its file is missing"}). Fix or delete it first`);
    return { ref, sheet: loaded.sheet, version: versionOf(loaded.source) };
  }

  private async sheetAt(name: string, expected?: string) {
    const wb = await this.load();
    const found = this.locate(wb, name);
    if (expected && expected !== found.version)
      throw new StoreError(`"${found.ref.title}" changed since you read it (the user or another edit). read_range it again, then redo your change with the new version`);
    return { wb, ...found };
  }

  private async saveSheets(sheets: SheetData[]) {
    for (const s of sheets) await this.writeText(sheetFile(s.id), sheetText(s));
  }

  // ── Reading ──────────────────────────────────────────────────────────────

  async overview() {
    const wb = await this.load();
    const open = (await this.threads()).filter((t) => !t.resolved).length;
    const values = evaluateAll(SheetStore.sheetsOf(wb), wb.index.timeZone);
    return {
      title: wb.index.title,
      locale: wb.index.locale,
      timeZone: wb.index.timeZone,
      sheets: wb.index.sheets.map((ref) => {
        const loaded = wb.sheets.get(ref.id);
        const s = loaded?.sheet;
        if (!s) return { id: ref.id, title: ref.title, problem: loaded?.error ?? "file missing" };
        const empty = Object.keys(s.cells).length === 0;
        const b = usedBounds(s);
        const header: string[] = [];
        for (let c = 0; c <= Math.min(b.maxCol, 25) && !empty; c++) {
          const ref1 = formatCellRef(0, c);
          header.push(formatCellValue(values.get(s.id)?.get(ref1) ?? s.cells[ref1]?.v ?? null, s.cells[ref1], wb.index));
        }
        return {
          id: s.id,
          title: s.title,
          usedRange: empty ? "empty" : `A1:${formatCellRef(b.maxRow, b.maxCol)}`,
          ...(empty ? {} : { firstRow: header }),
          ...(s.frozenRows || s.frozenCols ? { frozen: { rows: s.frozenRows, columns: s.frozenCols } } : {}),
          ...(s.rules.length ? { rules: s.rules.length } : {}),
          ...(s.charts.length ? { charts: s.charts.length } : {}),
          ...(s.filter ? { filter: s.filter.range } : {}),
        };
      }),
      dropdowns: wb.index.dropdowns.map((d) => ({ id: d.id, name: d.name, options: d.options.map((o) => o.label) })),
      people: wb.index.people,
      openComments: open,
      ...(wb.problems.length ? { problems: wb.problems } : {}),
    };
  }

  async readRange(name: string, range?: string) {
    const wb = await this.load();
    const { ref, sheet, version } = this.locate(wb, name);
    const values = evaluateAll(SheetStore.sheetsOf(wb), wb.index.timeZone).get(sheet.id) ?? new Map<string, EvalValue>();
    const used = usedBounds(sheet);
    const empty = Object.keys(sheet.cells).length === 0;
    let r: ParsedRange;
    if (range) {
      const b = boundedRange(range, sheet);
      if (!b) throw new StoreError(`"${range}" is not a range. ${rangeHint}`);
      r = b;
    } else r = { r1: 0, c1: 0, r2: used.maxRow, c2: used.maxCol };
    const width = r.c2 - r.c1 + 1;
    const fit = Math.max(1, Math.floor(READ_CELLS / width));
    const lastShown = Math.min(r.r2, r.r1 + fit - 1);
    const cells: Record<string, CellData> = {};
    const computed: Record<string, string | number | boolean | null> = {};
    const errors: Record<string, string> = {};
    const lines: string[] = [];
    const head = ["", ...Array.from({ length: width }, (_, i) => colToLetter(r.c1 + i))];
    lines.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`);
    for (let row = r.r1; row <= lastShown && !empty; row++) {
      const shown: string[] = [String(row + 1)];
      for (let c = r.c1; c <= r.c2; c++) {
        const a1 = formatCellRef(row, c);
        const cell = sheet.cells[a1];
        const v = values.get(a1) ?? cell?.v ?? null;
        if (cell) cells[a1] = cell;
        if (cell?.f) {
          if (v instanceof FormulaError) errors[a1] = showValue(v);
          else computed[a1] = v ?? null;
        }
        shown.push(mdCell(cell ? formatCellValue(v, cell, wb.index) : ""));
      }
      lines.push(`| ${shown.join(" | ")} |`);
    }
    const setup = {
      ...(sheet.frozenRows || sheet.frozenCols ? { frozen: { rows: sheet.frozenRows, columns: sheet.frozenCols } } : {}),
      ...(sheet.merges.length ? { merges: sheet.merges.map((m) => formatRangeRef(m)) } : {}),
      ...(sheet.rules.length ? { rules: sheet.rules } : {}),
      ...(sheet.charts.length ? { charts: sheet.charts.map((c) => ({ id: c.id, type: c.type, title: c.title, range: c.range })) } : {}),
      ...(sheet.filter ? { filter: sheet.filter.range } : {}),
      ...(sheet.colGroups.length ? { columnGroups: sheet.colGroups.map((g) => `${colToLetter(g.start)}:${colToLetter(g.end)}${g.collapsed ? " (collapsed)" : ""}`) } : {}),
      ...(sheet.rowGroups.length ? { rowGroups: sheet.rowGroups.map((g) => `${g.start + 1}:${g.end + 1}${g.collapsed ? " (collapsed)" : ""}`) } : {}),
      ...(Object.keys(sheet.colWidths).length ? { columnWidths: Object.fromEntries(Object.entries(sheet.colWidths).map(([k, w]) => [colToLetter(Number(k)), w])) } : {}),
    };
    return {
      sheet: ref.id,
      title: ref.title,
      version,
      range: empty && !range ? "empty" : formatRangeRef({ ...r, r2: lastShown }),
      usedRange: empty ? "empty" : `A1:${formatCellRef(used.maxRow, used.maxCol)}`,
      table: empty && !range ? "(the sheet is empty)" : lines.join("\n"),
      cells,
      ...(Object.keys(computed).length ? { computed } : {}),
      ...(Object.keys(errors).length ? { errors } : {}),
      ...(Object.keys(setup).length ? { setup } : {}),
      ...(lastShown < r.r2 ? { more: `Rows ${lastShown + 2}–${r.r2 + 1} are not shown. Read them with range "${formatRangeRef({ r1: lastShown + 1, c1: r.c1, r2: r.r2, c2: r.c2 })}"` } : {}),
    };
  }

  async find(query: string, opts: { sheet?: string; formulas?: boolean; limit?: number }) {
    const wb = await this.load();
    const q = query.trim().toLowerCase();
    if (!q) throw new StoreError("query is empty");
    const values = evaluateAll(SheetStore.sheetsOf(wb), wb.index.timeZone);
    const targets = opts.sheet ? [this.locate(wb, opts.sheet).ref] : wb.index.sheets;
    const hits: { sheet: string; cell: string; shows: string; formula?: string }[] = [];
    const limit = Math.min(500, opts.limit ?? 100);
    for (const t of targets) {
      const s = wb.sheets.get(t.id)?.sheet;
      if (!s) continue;
      const refs = Object.keys(s.cells).sort((a, b) => {
        const pa = parseCellRef(a)!;
        const pb = parseCellRef(b)!;
        return pa.row - pb.row || pa.col - pb.col;
      });
      for (const a1 of refs) {
        const cell = s.cells[a1]!;
        const shows = formatCellValue(values.get(s.id)?.get(a1) ?? cell.v ?? null, cell, wb.index);
        if (shows.toLowerCase().includes(q) || (opts.formulas && cell.f?.toLowerCase().includes(q))) {
          hits.push({ sheet: t.id, cell: a1, shows, ...(cell.f ? { formula: cell.f } : {}) });
          if (hits.length >= limit) return { matches: hits, more: true };
        }
      }
    }
    return { matches: hits };
  }

  // ── Writing cells ────────────────────────────────────────────────────────

  /** Merge an input into the cell that is there: values replace values, style keys merge, null removes. */
  private merge(cur: CellData | undefined, input: CellInput, checked: CellData, fmt?: NumberFormatKind): CellData | null {
    if (input === null) return null;
    const base: CellData = { ...cur };
    if (typeof input !== "object") {
      delete base.v;
      delete base.f;
      const next: CellData = { ...base, ...checked };
      if (fmt && !next.s?.numFmt) next.s = { ...next.s, numFmt: fmt };
      return next;
    }
    const o = input as Record<string, unknown>;
    const next: CellData = { ...base };
    if ("v" in o || "f" in o) {
      delete next.v;
      delete next.f;
      if (checked.v !== undefined) next.v = checked.v;
      if (checked.f !== undefined) next.f = checked.f;
    }
    for (const k of ["t", "dropdownId", "person", "note"] as const) {
      if (!(k in o)) continue;
      if (o[k] === null) delete next[k];
      else if (checked[k] !== undefined) (next as Record<string, unknown>)[k] = checked[k];
    }
    if (checked.t === "person" || checked.t === "dropdown" || checked.t === "checkbox") next.v = checked.v;
    if (checked.t && checked.t !== "dropdown") delete next.dropdownId;
    if (checked.t && checked.t !== "person") delete next.person;
    if ("s" in o) {
      if (o.s === null) delete next.s;
      else {
        const s: CellStyle = { ...cur?.s, ...checked.s };
        for (const [k, v] of Object.entries(o.s as Record<string, unknown>)) if (v === null) delete (s as Record<string, unknown>)[k];
        if (Object.keys(s).length) next.s = s;
        else delete next.s;
      }
    }
    if (fmt && ("v" in o || "f" in o) && !next.s?.numFmt) next.s = { ...next.s, numFmt: fmt };
    return next;
  }

  /** Dropdowns the cells use that come from the ready-made set and aren't in the workbook yet. */
  private templatesUsed(index: WorkbookIndex, cells: (CellData | null)[]): Dropdown[] {
    const add: Dropdown[] = [];
    for (const c of cells) {
      if (c?.t !== "dropdown" || !c.dropdownId || index.dropdowns.some((d) => d.id === c.dropdownId) || add.some((d) => d.id === c.dropdownId)) continue;
      const tpl = DROPDOWN_TEMPLATES.find((d) => d.id === c.dropdownId);
      if (tpl) add.push(tpl);
    }
    return add;
  }

  async writeCells(name: string, input: { cells?: Record<string, CellInput>; rows?: { at: string; values: CellInput[][] } }, expected?: string) {
    const { wb, ref, sheet } = await this.sheetAt(name, expected);
    const entries: [string, CellInput][] = [];
    const problems: string[] = [];
    for (const [k, v] of Object.entries(input.cells ?? {})) {
      const p = parseCellRef(k);
      if (!p) problems.push(`"${k}" is not a cell. Name cells like "B2"; to write a block of cells use rows`);
      else entries.push([formatCellRef(p.row, p.col), v]);
    }
    if (input.rows) {
      const at = parseCellRef(input.rows.at);
      if (!at) problems.push(`rows.at "${input.rows.at}" is not a cell; it is the top-left cell, like "A1"`);
      else
        input.rows.values.forEach((row, dr) => {
          if (!Array.isArray(row)) {
            problems.push(`rows.values[${dr}] must be a list of cells`);
            return;
          }
          row.forEach((v, dc) => {
            if (v !== undefined) entries.push([formatCellRef(at.row + dr, at.col + dc), v]);
          });
        });
    }
    if (!entries.length && !problems.length) throw new StoreError("Nothing to write: give cells ({\"B2\": 5}) or rows ({at: \"A1\", values: [[…]]})");
    if (entries.length > WRITE_CELLS) throw new StoreError(`That is ${entries.length} cells; write at most ${WRITE_CELLS} at a time`);
    const ctx = { dropdowns: wb.index.dropdowns, sheets: wb.index.sheets, locale: wb.index.locale };
    const updates: Record<string, CellData | null> = {};
    for (const [a1, v] of entries) {
      const p = parseCellRef(a1)!;
      if (p.row >= LIMITS.maxRows || p.col >= LIMITS.maxCols) {
        problems.push(`${a1}: a sheet has at most ${LIMITS.maxRows} rows and ${LIMITS.maxCols} columns`);
        continue;
      }
      const c = checkCellInput(v, ctx);
      for (const pr of c.problems) problems.push(`${a1}: ${pr}`);
      if (c.cell || v === null) updates[a1] = this.merge(sheet.cells[a1], v, c.cell ?? {}, c.fmt ?? (c.cell?.f ? impliedFormat(c.cell.f, sheet.cells) : undefined));
    }
    if (problems.length) throw new StoreError(`Nothing was saved. Fix these and write again:\n${problems.slice(0, 40).map((p) => `- ${p}`).join("\n")}${problems.length > 40 ? `\n- …and ${problems.length - 40} more` : ""}`);
    const next = patchCells(sheet, updates);
    const extra = this.templatesUsed(wb.index, Object.values(updates));
    if (extra.length) await this.writeText("sheet.json", indexText({ ...wb.index, dropdowns: [...wb.index.dropdowns, ...extra] }));
    await this.saveSheets([next]);
    return this.report(ref.id, Object.keys(updates), extra);
  }

  /** What a write did, with the computed value of every formula written and any error it shows. */
  private async report(sheetId: string, refs: string[], added: Dropdown[] = []) {
    const wb = await this.load();
    const loaded = wb.sheets.get(sheetId)!;
    const sheet = loaded.sheet!;
    const values = evaluateAll(SheetStore.sheetsOf(wb), wb.index.timeZone).get(sheetId) ?? new Map();
    const results: string[] = [];
    const errors: string[] = [];
    const unlike: string[] = [];
    for (const a1 of refs) {
      const cell = sheet.cells[a1];
      // A plain value under a column of chips, checkboxes or dates is usually meant to be one too.
      const p = parseCellRef(a1);
      const above = p && p.row > 1 ? sheet.cells[formatCellRef(p.row - 1, p.col)] : undefined;
      if (cell && !cell.t && !cell.f && above?.t && unlike.length < 10) unlike.push(`${a1} is a plain value under ${formatCellRef(p!.row - 1, p!.col)}, a ${above.t} cell${above.dropdownId ? ` (dropdownId "${above.dropdownId}")` : ""}. If it belongs to that column, write it as {"t": "${above.t}"${above.dropdownId ? `, "dropdownId": "${above.dropdownId}"` : ""}, "v": …}.`);
      if (!cell?.f) continue;
      const v = values.get(a1);
      if (v instanceof FormulaError) errors.push(`${a1} ${cell.f} → ${showValue(v)}`);
      else if (results.length < 25) results.push(`${a1} = ${formatCellValue(v ?? null, cell, wb.index) || "(empty)"}`);
    }
    return {
      version: versionOf(loaded.source),
      title: sheet.title,
      changed: refs.length,
      results,
      errors,
      unlike,
      added: added.map((d) => d.id),
    };
  }

  async formatCells(name: string, ranges: string[], change: { style?: Record<string, unknown> | null; type?: string | null; dropdownId?: string }, expected?: string) {
    const { wb, ref, sheet } = await this.sheetAt(name, expected);
    const ctx = { dropdowns: wb.index.dropdowns, sheets: wb.index.sheets, locale: wb.index.locale };
    const problems: string[] = [];
    const cellInput: Record<string, unknown> = {};
    if (change.style !== undefined) cellInput.s = change.style;
    if (change.type !== undefined) cellInput.t = change.type ?? "auto";
    if (change.dropdownId !== undefined) cellInput.dropdownId = change.dropdownId;
    const checked = checkCellInput(cellInput, ctx);
    problems.push(...checked.problems.filter((p) => !p.startsWith("A dropdown cell needs") || !change.dropdownId));
    if (change.type === "dropdown" && !findDropdown(change.dropdownId ?? "", wb.index.dropdowns)) problems.push(`type "dropdown" needs dropdownId, one of: ${[...wb.index.dropdowns.map((d) => d.id), ...DROPDOWN_TEMPLATES.map((d) => d.id)].join(", ")}`);
    const parsed = ranges.map((r) => ({ text: r, r: boundedRange(r, sheet) }));
    for (const p of parsed) if (!p.r) problems.push(`"${p.text}" is not a range. ${rangeHint}`);
    const count = parsed.reduce((n, p) => n + (p.r ? (p.r.r2 - p.r.r1 + 1) * (p.r.c2 - p.r.c1 + 1) : 0), 0);
    if (count > WRITE_CELLS) problems.push(`That is ${count} cells; format at most ${WRITE_CELLS} at a time`);
    if (problems.length) throw new StoreError(`Nothing was changed. Fix these and try again:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    const updates: Record<string, CellData | null> = {};
    for (const { r } of parsed) {
      for (let row = r!.r1; row <= r!.r2; row++)
        for (let c = r!.c1; c <= r!.c2; c++) {
          const a1 = formatCellRef(row, c);
          const cur = updates[a1] ?? sheet.cells[a1];
          let next: CellData = { ...cur };
          if (change.style === null) delete next.s;
          else if (change.style) {
            const s: CellStyle = { ...next.s, ...checked.cell?.s };
            for (const [k, v] of Object.entries(change.style)) if (v === null) delete (s as Record<string, unknown>)[k];
            if (Object.keys(s).length) next.s = s;
            else delete next.s;
          }
          if (change.type !== undefined) {
            if (!change.type || change.type === "auto") {
              delete next.t;
              delete next.dropdownId;
              delete next.person;
            } else {
              const typed = checkCellInput({ t: change.type, v: next.v ?? null, ...(change.dropdownId ? { dropdownId: change.dropdownId } : {}), ...(next.person ? { person: next.person } : {}) }, ctx);
              if (typed.cell) next = { ...next, ...typed.cell };
              else continue;
              if (change.type === "dropdown" && typed.problems.length) next.v = "";
            }
          }
          updates[a1] = next;
        }
    }
    const nextSheet = patchCells(sheet, updates);
    const extra = this.templatesUsed(wb.index, Object.values(updates));
    if (extra.length) await this.writeText("sheet.json", indexText({ ...wb.index, dropdowns: [...wb.index.dropdowns, ...extra] }));
    await this.saveSheets([nextSheet]);
    return { version: versionOf(sheetText(nextSheet)), title: ref.title, ranges: parsed.map((p) => formatRangeRef(p.r!)), cells: count };
  }

  async clear(name: string, range: string, what: "contents" | "formatting" | "all", expected?: string) {
    const { ref, sheet } = await this.sheetAt(name, expected);
    const r = boundedRange(range, sheet);
    if (!r) throw new StoreError(`"${range}" is not a range. ${rangeHint}`);
    const updates: Record<string, CellData | null> = {};
    let n = 0;
    for (const [a1, cell] of Object.entries(sheet.cells)) {
      const p = parseCellRef(a1)!;
      if (p.row < r.r1 || p.row > r.r2 || p.col < r.c1 || p.col > r.c2) continue;
      n++;
      if (what === "all") updates[a1] = null;
      else if (what === "contents") updates[a1] = cell.s ? { s: cell.s } : null;
      else {
        const rest = { ...cell };
        delete rest.s;
        updates[a1] = rest;
      }
    }
    const next = patchCells(sheet, updates);
    await this.saveSheets([next]);
    return { version: versionOf(sheetText(next)), title: ref.title, range: formatRangeRef(r), cleared: n };
  }

  // ── Structure ────────────────────────────────────────────────────────────

  async editStructure(name: string, ops: StructureInput[], expected?: string) {
    const { wb, ref } = await this.sheetAt(name, expected);
    const all = SheetStore.sheetsOf(wb);
    const done: string[] = [];
    const notGrown: string[] = [];
    const touched = new Set<string>();
    const values = () => evaluateAll(all, wb.index.timeZone).get(ref.id) ?? new Map();
    const set = (s: SheetData) => {
      all.set(s.id, s);
      touched.add(s.id);
    };
    const col = (text: string, field: string) => {
      const c = letterToCol(text.trim().replace(/\$/g, ""));
      if (c < 0 || c >= LIMITS.maxCols) throw new StoreError(`${field} "${text}" is not a column; name columns by letter, like "C"`);
      return c;
    };
    const span = (text: string, kind: "rows" | "columns") => {
      const parts = text.trim().replace(/\$/g, "").split(":");
      const toIdx = (p: string) => (kind === "rows" ? Number(p) - 1 : letterToCol(p));
      const a = toIdx(parts[0]!);
      const b = toIdx(parts[1] ?? parts[0]!);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) throw new StoreError(`"${text}" is not ${kind === "rows" ? 'rows, like "5" or "5:7"' : 'columns, like "C" or "C:E"'}`);
      return [Math.min(a, b), Math.max(a, b)] as const;
    };
    for (const op of ops) {
      const s = all.get(ref.id)!;
      const apply = (structure: StructureOp) => {
        for (const changed of restructure([...all.values()], ref.id, structure)) set(changed);
      };
      switch (op.op) {
        case "insert_rows": {
          if (op.before < 1) throw new StoreError("insert_rows.before is a row number, 1 or more");
          apply({ kind: "insert", axis: "row", at: op.before - 1, count: op.count ?? 1 });
          done.push(`inserted ${op.count ?? 1} row(s) before row ${op.before}`);
          notGrown.push(...rangesEndingAt(all.get(ref.id)!, "row", op.before - 2));
          break;
        }
        case "insert_columns": {
          const c = col(op.before, "insert_columns.before");
          apply({ kind: "insert", axis: "col", at: c, count: op.count ?? 1 });
          done.push(`inserted ${op.count ?? 1} column(s) before ${colToLetter(c)}`);
          notGrown.push(...rangesEndingAt(all.get(ref.id)!, "col", c - 1));
          break;
        }
        case "delete_rows": {
          const [a, b] = span(op.rows, "rows");
          apply({ kind: "delete", axis: "row", at: a, count: b - a + 1 });
          done.push(`deleted rows ${a + 1}–${b + 1}`);
          break;
        }
        case "delete_columns": {
          const [a, b] = span(op.columns, "columns");
          apply({ kind: "delete", axis: "col", at: a, count: b - a + 1 });
          done.push(`deleted columns ${colToLetter(a)}–${colToLetter(b)}`);
          break;
        }
        case "move_column": {
          const c = col(op.column, "move_column.column");
          const to = op.direction === "left" ? c - 1 : c + 1;
          if (to < 0 || to >= s.cols) throw new StoreError(`Column ${colToLetter(c)} can't move ${op.direction}`);
          apply({ kind: "move", axis: "col", from: c, to });
          done.push(`moved column ${colToLetter(c)} ${op.direction}`);
          break;
        }
        case "freeze":
          set({ ...s, frozenRows: Math.max(0, op.rows ?? s.frozenRows), frozenCols: Math.max(0, op.columns ?? s.frozenCols) });
          done.push(`froze ${op.rows ?? s.frozenRows} row(s) and ${op.columns ?? s.frozenCols} column(s)`);
          break;
        case "merge":
        case "unmerge": {
          const r = boundedRange(op.range, s);
          if (!r) throw new StoreError(`"${op.range}" is not a range. ${rangeHint}`);
          const others = s.merges.filter((m) => m.r2 < r.r1 || m.r1 > r.r2 || m.c2 < r.c1 || m.c1 > r.c2);
          if (op.op === "merge") {
            if (r.r1 === r.r2 && r.c1 === r.c2) throw new StoreError("Merging needs two or more cells");
            set({ ...s, merges: [...others, r] });
          } else set({ ...s, merges: others });
          done.push(`${op.op}d ${formatRangeRef(r)}`);
          break;
        }
        case "sort": {
          const by = col(op.by, "sort.by");
          const r = op.range ? boundedRange(op.range, s) : null;
          if (op.range && !r) throw new StoreError(`"${op.range}" is not a range. ${rangeHint}`);
          set(sortSheetByColumn(s, by, !op.descending, r ? formatRangeRef(r) : undefined, op.has_header ?? true, (a1) => values().get(a1)));
          done.push(`sorted ${r ? formatRangeRef(r) : "the sheet"} by ${colToLetter(by)} ${op.descending ? "Z→A" : "A→Z"}${(op.has_header ?? true) ? ", keeping the first row" : ""}`);
          break;
        }
        case "resize": {
          if (op.columns) {
            const [a, b] = span(op.columns, "columns");
            const next = resizeLines(s, "col", a, b, op.size);
            set(next);
            done.push(`set columns ${colToLetter(a)}–${colToLetter(b)} to ${next.colWidths[a]}px`);
          } else if (op.rows) {
            const [a, b] = span(op.rows, "rows");
            const next = resizeLines(s, "row", a, b, op.size);
            set(next);
            done.push(`set rows ${a + 1}–${b + 1} to ${next.rowHeights[a]}px`);
          } else throw new StoreError("resize needs columns (\"A:C\") or rows (\"1:3\"), and size in pixels");
          break;
        }
        case "gridlines":
          set({ ...s, showGridlines: op.show });
          done.push(op.show ? "showed gridlines" : "hid gridlines");
          break;
        case "group":
        case "ungroup": {
          if (!op.columns === !op.rows) throw new StoreError(`${op.op} needs columns ("C:E") or rows ("3:5"), one of them`);
          const kind = op.columns ? "columns" : "rows";
          const [a, b] = span((op.columns ?? op.rows)!, kind);
          const key = kind === "columns" ? "colGroups" : "rowGroups";
          const name = kind === "columns" ? `columns ${colToLetter(a)}–${colToLetter(b)}` : `rows ${a + 1}–${b + 1}`;
          if (op.op === "group") {
            set({ ...s, [key]: addGroup(s[key], a, b, op.collapsed === true) });
            done.push(`grouped ${name}${op.collapsed ? " (collapsed)" : ""}`);
          } else {
            set({ ...s, [key]: removeGroup(s[key], a, b) });
            done.push(`ungrouped ${name}`);
          }
          break;
        }
        case "filter": {
          if (!op.range) {
            set({ ...s, filter: null });
            done.push("removed the filter");
            break;
          }
          const r = boundedRange(op.range, s);
          if (!r || r.r2 <= r.r1) throw new StoreError(`filter.range "${op.range}" must cover a header row and at least one row of data, like "A1:F40"`);
          const columnFilters: Record<string, string[]> = {};
          for (const [k, list] of Object.entries(op.show ?? {})) columnFilters[String(col(k, "filter.show key"))] = list;
          set({ ...s, filter: { range: formatRangeRef(r), columnFilters } });
          done.push(`filtered ${formatRangeRef(r)}${Object.keys(columnFilters).length ? ` showing only chosen values in ${Object.keys(op.show ?? {}).join(", ")}` : ""}`);
          break;
        }
      }
    }
    await this.saveSheets([...touched].map((id) => all.get(id)!));
    const others = [...touched].filter((id) => id !== ref.id).map((id) => all.get(id)!.title);
    return {
      version: versionOf(sheetText(all.get(ref.id)!)),
      title: ref.title,
      done,
      ...(others.length ? { formulasUpdatedOn: others } : {}),
      ...(notGrown.length
        ? {
            notGrown: notGrown.slice(0, 30),
            note: "These ranges end just before the new rows or columns, so they did not grow to take them in (as in any spreadsheet). If the new cells belong to them, extend them with write_cells, manage_charts or manage_rules.",
          }
        : {}),
    };
  }

  // ── Rules and charts ─────────────────────────────────────────────────────

  async manageRules(name: string, input: { add?: Omit<ConditionalRule, "id">[]; update?: ConditionalRule[]; delete?: string[] }) {
    const { wb, ref, sheet } = await this.sheetAt(name);
    let rules = [...sheet.rules];
    const problems: string[] = [];
    const check = (rule: Partial<ConditionalRule>, where: string) => {
      if (!rule.range || !parseRangeRef(rule.range)) problems.push(`${where}: range "${rule.range ?? ""}" must be a range like "F2:F40"`);
      if (rule.kind === "highlight" && rule.condition === "formula") problems.push(...lintFormula(rule.values?.[0]?.startsWith("=") ? rule.values[0] : `=${rule.values?.[0] ?? ""}`, wb.index.sheets).map((p) => `${where}: ${p}`));
    };
    /** Colors as files keep them; anything else is a problem to report. */
    const colors = <R extends Partial<ConditionalRule>>(rule: R, where: string): R => {
      const hex = (v: unknown, field: string) => {
        const c = hexColor(v);
        if (!c) problems.push(`${where}: ${field} must be a hex color like "#c5221f"`);
        return c ?? "";
      };
      if (rule.kind === "highlight") {
        const st = { ...rule.style };
        if (st.fill !== undefined) st.fill = hex(st.fill, "style.fill");
        if (st.color !== undefined) st.color = hex(st.color, "style.color");
        return { ...rule, style: st };
      }
      if (rule.kind === "colorScale") {
        return { ...rule, minColor: hex(rule.minColor, "minColor"), maxColor: hex(rule.maxColor, "maxColor"), ...(rule.midColor !== undefined ? { midColor: hex(rule.midColor, "midColor") } : {}) };
      }
      return rule;
    };
    for (const id of input.delete ?? []) {
      if (!rules.some((r) => r.id === id)) problems.push(`delete: there is no rule "${id}". Rules: ${rules.map((r) => r.id).join(", ") || "none"}`);
      rules = rules.filter((r) => r.id !== id);
    }
    for (const u of input.update ?? []) {
      const i = rules.findIndex((r) => r.id === u.id);
      if (i < 0) problems.push(`update: there is no rule "${u.id}"`);
      else {
        check(u, `update ${u.id}`);
        rules[i] = { ...colors(u, `update ${u.id}`), range: u.range.toUpperCase() };
      }
    }
    const added: string[] = [];
    (input.add ?? []).forEach((a, i) => {
      check(a, `add[${i}]`);
      const id = `rule-${randomUUID().slice(0, 6)}`;
      added.push(id);
      rules.push({ ...colors(a, `add[${i}]`), id, range: a.range.toUpperCase() } as ConditionalRule);
    });
    if (rules.length > LIMITS.rulesPerSheet) problems.push(`A sheet holds at most ${LIMITS.rulesPerSheet} rules`);
    if (problems.length) throw new StoreError(`Nothing was changed:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    const next = { ...sheet, rules };
    await this.saveSheets([next]);
    return { version: versionOf(sheetText(next)), title: ref.title, added, rules: rules.map((r) => ({ id: r.id, kind: r.kind, range: r.range })) };
  }

  /** Where a chart sits: from the cell it should start at, in the sheet's pixels. */
  private chartAt(sheet: SheetData, at: string) {
    const p = parseCellRef(at);
    if (!p) throw new StoreError(`at "${at}" must be a cell, like "H2"`);
    let x = 0;
    for (let c = 0; c < p.col; c++) x += sheet.colWidths[c] ?? LIMITS.defaultColWidth;
    let y = 0;
    for (let r = 0; r < p.row; r++) y += sheet.rowHeights[r] ?? LIMITS.defaultRowHeight;
    return { x, y };
  }

  async manageCharts(name: string, input: { add?: ChartInput[]; update?: (Partial<ChartInput> & { id: string })[]; delete?: string[] }) {
    const { ref, sheet } = await this.sheetAt(name);
    let charts = [...sheet.charts];
    const problems: string[] = [];
    for (const id of input.delete ?? []) {
      if (!charts.some((c) => c.id === id)) problems.push(`delete: there is no chart "${id}". Charts: ${charts.map((c) => c.id).join(", ") || "none"}`);
      charts = charts.filter((c) => c.id !== id);
    }
    const build = (c: Partial<ChartInput>, base: ChartSpec | null, where: string): ChartSpec | null => {
      const range = c.range ?? base?.range;
      if (!range || !parseRangeRef(range)) {
        problems.push(`${where}: range must be the data, like "A1:D7" (labels in the first column, a series per column, names in the first row)`);
        return null;
      }
      const pos = c.at ? this.chartAt(sheet, c.at) : base ? { x: base.x, y: base.y } : this.chartAt(sheet, formatCellRef(0, parseRangeRef(range)!.c2 + 2));
      return {
        id: base?.id ?? `chart-${randomUUID().slice(0, 6)}`,
        type: (c.type ?? base?.type ?? "bar") as ChartType,
        title: c.title ?? base?.title ?? "",
        range: range.toUpperCase(),
        x: pos.x,
        y: pos.y,
        w: Math.max(200, Math.min(1600, c.width ?? base?.w ?? 480)),
        h: Math.max(160, Math.min(1000, c.height ?? base?.h ?? 300)),
        headerRow: c.header_row ?? base?.headerRow ?? true,
      };
    };
    for (const u of input.update ?? []) {
      const i = charts.findIndex((c) => c.id === u.id);
      if (i < 0) problems.push(`update: there is no chart "${u.id}"`);
      else {
        const next = build(u, charts[i]!, `update ${u.id}`);
        if (next) charts[i] = next;
      }
    }
    const added: string[] = [];
    (input.add ?? []).forEach((a, i) => {
      const next = build(a, null, `add[${i}]`);
      if (next) {
        charts.push(next);
        added.push(next.id);
      }
    });
    if (charts.length > LIMITS.chartsPerSheet) problems.push(`A sheet holds at most ${LIMITS.chartsPerSheet} charts`);
    if (problems.length) throw new StoreError(`Nothing was changed:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    const next = { ...sheet, charts };
    await this.saveSheets([next]);
    return { version: versionOf(sheetText(next)), title: ref.title, added, charts: charts.map((c) => ({ id: c.id, type: c.type, title: c.title, range: c.range })) };
  }

  // ── Sheets and the workbook ──────────────────────────────────────────────

  async addSheet(title: string, opts: { after?: string; copyOf?: string }) {
    const wb = await this.load();
    const clean = title.trim().slice(0, LIMITS.titleChars);
    if (!clean) throw new StoreError("title is empty");
    if (wb.index.sheets.some((s) => s.title.toLowerCase() === clean.toLowerCase())) throw new StoreError(`There is already a sheet called "${clean}"`);
    if (wb.index.sheets.length >= LIMITS.sheets) throw new StoreError(`A workbook holds at most ${LIMITS.sheets} sheets`);
    const id = newSheetId(wb.index.sheets, clean);
    if (!SHEET_ID_RE.test(id)) throw new StoreError("Could not make an id from that title");
    const src = opts.copyOf ? this.locate(wb, opts.copyOf).sheet : null;
    const sheet: SheetData = src ? { ...structuredClone(src), id, title: clean } : emptySheet(id, clean);
    const list = [...wb.index.sheets];
    const at = opts.after ? list.findIndex((s) => s.id === this.locate(wb, opts.after!).ref.id) + 1 : list.length;
    list.splice(at, 0, { id, title: clean });
    await this.writeText(sheetFile(id), sheetText(sheet));
    await this.writeText("sheet.json", indexText({ ...wb.index, sheets: list }));
    return { id, title: clean, position: at + 1 };
  }

  async deleteSheet(name: string) {
    const wb = await this.load();
    const { ref } = this.locate(wb, name);
    if (wb.index.sheets.length <= 1) throw new StoreError("A workbook keeps at least one sheet");
    const pointing = [...SheetStore.sheetsOf(wb).values()].filter((s) => s.id !== ref.id && Object.values(s.cells).some((c) => c.f && new RegExp(`(^|[^A-Za-z0-9_.])('${ref.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'|${ref.id})!`, "i").test(c.f)));
    await this.writeText("sheet.json", indexText({ ...wb.index, sheets: wb.index.sheets.filter((s) => s.id !== ref.id) }));
    await rm(this.file(sheetFile(ref.id)), { force: true });
    return { deleted: ref.id, title: ref.title, brokenFormulasOn: pointing.map((s) => s.title) };
  }

  async updateWorkbook(patch: { title?: string; locale?: string; time_zone?: string; dropdowns?: Dropdown[]; people?: PersonValue[]; sheets?: { id: string; title: string }[] }) {
    const wb = await this.load();
    const problems: string[] = [];
    if (patch.sheets) {
      const ids = patch.sheets.map((s) => s.id).sort().join();
      if (ids !== wb.index.sheets.map((s) => s.id).sort().join()) problems.push(`sheets must list every sheet id exactly once, in the new order: ${wb.index.sheets.map((s) => s.id).join(", ")}. To add or remove one use add_sheet or delete_sheet`);
      const titles = patch.sheets.map((s) => s.title.trim().toLowerCase());
      if (new Set(titles).size !== titles.length || titles.some((t) => !t)) problems.push("each sheet needs a title, and titles must differ");
    }
    if (patch.dropdowns) {
      for (const d of patch.dropdowns) if (!d.options.length) problems.push(`dropdown ${d.id} needs at least one option`);
      const used = new Set<string>();
      for (const s of SheetStore.sheetsOf(wb).values()) for (const c of Object.values(s.cells)) if (c.t === "dropdown" && c.dropdownId) used.add(c.dropdownId);
      for (const id of used) if (!patch.dropdowns.some((d) => d.id === id)) problems.push(`dropdown ${id} is used by cells; keep it in the list`);
    }
    const next = checkIndex({
      ...wb.index,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
      ...(patch.time_zone !== undefined ? { timeZone: patch.time_zone } : {}),
      ...(patch.dropdowns ? { dropdowns: patch.dropdowns } : {}),
      ...(patch.people ? { people: patch.people } : {}),
      ...(patch.sheets ? { sheets: patch.sheets.map((s) => ({ id: s.id, title: s.title.trim() })) } : {}),
    });
    if (!next.index) problems.push(...next.errors);
    else {
      if (patch.locale !== undefined && next.index.locale !== patch.locale) problems.push(`locale "${patch.locale}" is not one this app knows; format_guide lists them`);
      if (patch.time_zone !== undefined && next.index.timeZone !== patch.time_zone) problems.push(`time_zone "${patch.time_zone}" is not a time zone; use a name like "America/New_York"`);
    }
    if (problems.length) throw new StoreError(`Nothing was changed:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    await this.writeText("sheet.json", indexText(next.index!));
    if (patch.sheets) {
      for (const s of patch.sheets) {
        const loaded = wb.sheets.get(s.id)?.sheet;
        if (loaded && loaded.title !== s.title.trim()) await this.writeText(sheetFile(s.id), sheetText({ ...loaded, title: s.title.trim() }));
      }
    }
    const i = next.index!;
    return { title: i.title, locale: i.locale, timeZone: i.timeZone, sheets: i.sheets, dropdowns: i.dropdowns.map((d) => d.id), people: i.people.length };
  }

  // ── Comments ─────────────────────────────────────────────────────────────

  private async threads(): Promise<SheetThread[]> {
    return parseThreads(await this.readText(COMMENTS_FILE), anchorOf);
  }

  async readComments(sheet?: string, includeResolved = false) {
    const wb = await this.load();
    const only = sheet ? this.locate(wb, sheet).ref.id : null;
    const values = evaluateAll(SheetStore.sheetsOf(wb), wb.index.timeZone);
    return (await this.threads())
      .filter((t) => (!only || t.sheetId === only) && (includeResolved || !t.resolved))
      .map((t) => {
        const s = wb.sheets.get(t.sheetId)?.sheet;
        const first = parseRangeRef(t.range);
        const a1 = first ? formatCellRef(first.r1, first.c1) : t.range;
        const shows = s ? formatCellValue(values.get(s.id)?.get(a1) ?? s.cells[a1]?.v ?? null, s.cells[a1], wb.index) : "";
        return {
          thread: t.id,
          sheet: t.sheetId,
          range: t.range,
          ...(shows ? { cellShows: clip(shows, 120) } : {}),
          resolved: t.resolved,
          comments: t.comments.map((c) => ({ by: c.author === "you" ? "user" : "assistant", text: c.text, at: new Date(c.at).toISOString() })),
        };
      });
  }

  async comment(input: { thread?: string; sheet?: string; range?: string; text?: string; resolve?: boolean }) {
    const text = (input.text ?? "").trim();
    if (!text && !(input.thread && input.resolve)) throw new StoreError("text is empty: write the comment, or pass resolve: true with a thread to only resolve it");
    if (text.length > MAX_COMMENT) throw new StoreError(`The comment is ${text.length} characters; the most is ${MAX_COMMENT}`);
    const threads = await this.threads();
    const said = text ? [{ id: randomUUID().slice(0, 12), author: "ai" as const, text, at: Date.now() }] : [];
    let thread: SheetThread;
    if (input.thread) {
      const found = threads.find((t) => t.id === input.thread);
      if (!found) throw new StoreError(`There is no thread "${input.thread}" (read_comments lists them)`);
      thread = { ...found, resolved: input.resolve ? true : found.resolved, comments: [...found.comments, ...said] };
      threads.splice(threads.indexOf(found), 1, thread);
    } else {
      if (!input.sheet || !input.range) throw new StoreError("To start a thread give sheet and range (a cell like \"F4\" or a range); to reply give thread");
      const wb = await this.load();
      const { ref } = this.locate(wb, input.sheet);
      const r = parseRangeRef(input.range);
      if (!r) throw new StoreError(`range "${input.range}" must be a cell like "F4" or a range like "B2:D9"`);
      thread = { id: randomUUID().slice(0, 12), sheetId: ref.id, range: formatRangeRef(r), resolved: !!input.resolve, comments: said };
      threads.push(thread);
    }
    await this.writeText(COMMENTS_FILE, serializeThreads(threads));
    return { thread: thread.id, comments: thread.comments.length, resolved: thread.resolved };
  }
}

export interface ChartInput {
  type: ChartType;
  title: string;
  range: string;
  at?: string;
  width?: number;
  height?: number;
  header_row?: boolean;
}

/** Formulas, charts, rules and the filter on a sheet whose ranges end at row or column `edge` (0-based). */
function rangesEndingAt(sheet: SheetData, axis: "row" | "col", edge: number): string[] {
  if (edge < 0) return [];
  const ends = (range: string) => {
    const r = parseRangeRef(range.replace(/\$/g, ""));
    return !!r && (axis === "row" ? r.r2 === edge && r.r1 < edge : r.c2 === edge && r.c1 < edge);
  };
  const out: string[] = [];
  for (const [a1, cell] of Object.entries(sheet.cells)) {
    if (!cell.f) continue;
    const body = cell.f.replace(/"[^"]*"/g, '""');
    for (const m of body.matchAll(/(^|[^A-Za-z0-9_!.'])(\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}\$?\d+)/g)) {
      if (ends(m[2]!)) {
        out.push(`${a1} ${cell.f}`);
        break;
      }
    }
  }
  for (const c of sheet.charts) if (ends(c.range)) out.push(`chart ${c.id} ${c.range}`);
  for (const r of sheet.rules) if (ends(r.range)) out.push(`rule ${r.id} ${r.range}`);
  if (sheet.filter && ends(sheet.filter.range)) out.push(`filter ${sheet.filter.range}`);
  return out;
}

export type StructureInput =
  | { op: "insert_rows"; before: number; count?: number }
  | { op: "insert_columns"; before: string; count?: number }
  | { op: "delete_rows"; rows: string }
  | { op: "delete_columns"; columns: string }
  | { op: "move_column"; column: string; direction: "left" | "right" }
  | { op: "freeze"; rows?: number; columns?: number }
  | { op: "merge"; range: string }
  | { op: "unmerge"; range: string }
  | { op: "sort"; by: string; descending?: boolean; range?: string; has_header?: boolean }
  | { op: "resize"; columns?: string; rows?: string; size: number }
  | { op: "gridlines"; show: boolean }
  | { op: "filter"; range: string | null; show?: Record<string, string[]> }
  | { op: "group"; columns?: string; rows?: string; collapsed?: boolean }
  | { op: "ungroup"; columns?: string; rows?: string };
