// The spreadsheet editor's state and every change to the workbook. A change
// is made to the parsed sheets, written back as files, and kept as one undo
// step (one step may touch several files: inserting a row rewrites formulas
// on other sheets that point at it).

import { useSyncExternalStore } from "react";
import {
  addGroup,
  type BorderStyle,
  type CellBorders,
  type CellData,
  type CellStyle,
  type ChartSpec,
  type ChartType,
  type ConditionalRule,
  type Dropdown,
  type EvalValue,
  type LoadedWorkbook,
  type PersonValue,
  type SheetData,
  type StructureOp,
  type WorkbookIndex,
  checkIndex,
  checkSheet,
  clearRange,
  colToLetter,
  DROPDOWN_TEMPLATES,
  emptySheet,
  evaluateAll,
  evaluateConditionalRules,
  exportXlsx,
  fillSelection,
  formatCellRef,
  formatCellValue,
  formatRangeRef,
  impliedFormat,
  importXlsx,
  indexText,
  LIMITS,
  loadWorkbook,
  newSheetId,
  newWorkbookFiles,
  nextSheetTitle,
  OPTION_COLORS,
  parseCellRef,
  parseRangeRef,
  parseUserInput,
  patchCells,
  patchCellStyle,
  remapRange,
  removeGroup,
  resizeLines,
  restructure,
  SHEET_FILE_RE,
  shiftFormula,
  shiftMap,
  sheetFile,
  sheetFromCsv,
  sheetText,
  sheetToCsv,
  sortSheetByColumn,
  swapMap,
  usedBounds,
} from "@opendeck/sheet";
import { readPref, tabs as shellTabs, toast, userName, writePref } from "@opendeck/shell";
import { api, plainError, type SheetFolderRef } from "./api.ts";
import { comments } from "./comments.ts";

export interface CellCoord {
  r: number;
  c: number;
}

export interface SelectionState {
  anchor: CellCoord;
  focus: CellCoord;
  mode: "cells" | "cols" | "rows";
}

export interface EditingState {
  r: number;
  c: number;
  value: string;
  source: "cell" | "formula";
  /** Opened by typing over the cell: arrow keys finish and move, as in any spreadsheet. F2 or a double-click edits in place. */
  fresh: boolean;
}

export type RightPanel = "chat" | "comments" | "rules" | "history" | null;
export type BorderPreset = "all" | "inner" | "horizontal" | "vertical" | "outer" | "left" | "top" | "right" | "bottom" | "clear";

/** The conditional formatting panel: its list, the "Create rule" choices, or one rule being edited. */
export type RulesView = { view: "list" } | { view: "create" } | { view: "edit"; id: string | null; kind: "highlight" | "colorScale" };

export interface HistorySnapshot {
  id: string;
  at: number;
  author: string;
  label: string;
  index: WorkbookIndex;
  sheets: Record<string, SheetData>;
}

export interface FileChange {
  rel: string;
  before: string | null;
  after: string | null;
  /** The sheet `after` was written from, when the change was made here: no need to read the text back. */
  sheet?: SheetData;
}

interface UndoStep {
  label: string;
  changes: FileChange[];
  sheetId: string | null;
}

export interface ClipboardData {
  cells: { dr: number; dc: number; cell: CellData }[];
  rows: number;
  cols: number;
  /** Where it was copied from, so formulas shift by the distance pasted. */
  from: { sheetId: string; r: number; c: number };
  cut: boolean;
  /** What was put on the system clipboard; when it holds something else, that is pasted instead. */
  text: string;
}

export type SheetDialog = null | "locale" | "timezone" | "customFormat" | "customSort" | "resizeCol" | "resizeRow" | "newDropdown" | "rename";

export interface SheetsState {
  ref: SheetFolderRef | null;
  workbook: LoadedWorkbook | null;
  loading: boolean;
  activeSheetId: string | null;
  selection: SelectionState;
  editing: EditingState | null;
  zoom: number;
  rightPanel: RightPanel;
  rules: RulesView;
  asking: boolean;
  /** A request to send from the Ask box as soon as it opens (from a menu's prompt). */
  askRequest: { text: string; n: number } | null;
  undo: UndoStep[];
  redo: UndoStep[];
  evaluated: Map<string, Map<string, EvalValue>>;
  condStyles: Map<string, Map<string, Partial<CellStyle>>>;
  history: HistorySnapshot[];
  clipboard: ClipboardData | null;
  borderColor: string;
  borderStyle: BorderStyle;
  /** The AI working on the workbook now, if any. */
  agent: { name: string } | null;
  chatDraft: string;
  dialog: SheetDialog;
  /** A column or row being resized by dragging: shown live, saved on release. */
  resizing: { kind: "col" | "row"; index: number; size: number } | null;
}

const initialTab = /(?:^#|&)tab=([^&]+)/.exec(location.hash)?.[1];

let state: SheetsState = {
  ref: null,
  workbook: null,
  loading: true,
  activeSheetId: initialTab ? decodeURIComponent(initialTab) : null,
  selection: { anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 }, mode: "cells" },
  editing: null,
  zoom: 1,
  rightPanel: readPref("sheets.chat", false) ? "chat" : null,
  rules: { view: "list" },
  asking: false,
  askRequest: null,
  undo: [],
  redo: [],
  evaluated: new Map(),
  condStyles: new Map(),
  history: [],
  clipboard: null,
  borderColor: "#737373",
  borderStyle: "thin",
  agent: null,
  chatDraft: "",
  dialog: null,
  resizing: null,
};

const listeners = new Set<() => void>();
export const getState = () => state;
export function setState(patch: Partial<SheetsState> | ((s: SheetsState) => Partial<SheetsState>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of listeners) l();
}
export function useSheets<T>(select: (s: SheetsState) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => select(state),
  );
}
export { toast };

// ── Derived helpers ──────────────────────────────────────────────────────────

export function currentSheet(s = state): SheetData | null {
  if (!s.workbook || !s.activeSheetId) return null;
  return s.workbook.sheets.get(s.activeSheetId)?.sheet ?? null;
}

export function selectionBounds(sel = state.selection) {
  return {
    r1: Math.min(sel.anchor.r, sel.focus.r),
    c1: Math.min(sel.anchor.c, sel.focus.c),
    r2: Math.max(sel.anchor.r, sel.focus.r),
    c2: Math.max(sel.anchor.c, sel.focus.c),
  };
}

/** The selection as cells: a whole column or row is cut to where the sheet has anything. */
export function selectionRect(sel = state.selection, sheet = currentSheet()) {
  const b = selectionBounds(sel);
  if (!sheet) return b;
  const used = usedBounds(sheet);
  if (sel.mode === "cols") return { r1: 0, c1: b.c1, r2: Math.max(used.maxRow, 0), c2: b.c2 };
  if (sel.mode === "rows") return { r1: b.r1, c1: 0, r2: b.r2, c2: Math.max(used.maxCol, 0) };
  return b;
}

/** The selection in A1 notation: "B2", "B2:D9", "C:E" for whole columns, "3:5" for whole rows. */
export function selectionRangeStr(sel = state.selection): string {
  const b = selectionBounds(sel);
  if (sel.mode === "cols") return `${colToLetter(b.c1)}:${colToLetter(b.c2)}`;
  if (sel.mode === "rows") return `${b.r1 + 1}:${b.r2 + 1}`;
  return formatRangeRef(b);
}

/** The cells a style change applies to. A whole column or row covers the sheet's full height or width. */
export function selectedRefs(sel = state.selection, sheet = currentSheet(), maxCells = 50_000): string[] {
  if (!sheet) return [];
  const b = selectionBounds(sel);
  const r1 = sel.mode === "cols" ? 0 : b.r1;
  const r2 = sel.mode === "cols" ? sheet.rows - 1 : b.r2;
  const c1 = sel.mode === "rows" ? 0 : b.c1;
  const c2 = sel.mode === "rows" ? sheet.cols - 1 : b.c2;
  const refs: string[] = [];
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      refs.push(formatCellRef(r, c));
      if (refs.length >= maxCells) return refs;
    }
  }
  return refs;
}

export function activeCellRef(s = state): string {
  return formatCellRef(s.selection.anchor.r, s.selection.anchor.c);
}

function recompute(wb: LoadedWorkbook | null) {
  if (!wb) return { evaluated: new Map<string, Map<string, EvalValue>>(), condStyles: new Map<string, Map<string, Partial<CellStyle>>>() };
  const map = new Map<string, SheetData>();
  for (const [id, l] of wb.sheets) if (l.sheet) map.set(id, l.sheet);
  const evaluated = evaluateAll(map, wb.index.timeZone);
  const condStyles = new Map<string, Map<string, Partial<CellStyle>>>();
  for (const [id, sheet] of map) condStyles.set(id, evaluateConditionalRules(sheet, evaluated.get(id) ?? new Map(), map, wb.index.timeZone));
  return { evaluated, condStyles };
}

// ── Loading and version history ──────────────────────────────────────────────

let loadedRoot: string | null = null;
let lastSnapshotAt = 0;
/** Keep history.json to a size that loads instantly; the oldest versions go first. */
const HISTORY_BYTES = 12_000_000;
const HISTORY_MAX = 40;
const SNAPSHOT_EVERY = 180_000;

async function readHistory(): Promise<HistorySnapshot[]> {
  const raw = await api().read("history.json").catch(() => null);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((h) => h && typeof h.at === "number" && h.index && h.sheets) : [];
  } catch {
    return [];
  }
}

async function saveHistorySnapshot(label: string, wb: LoadedWorkbook, opts: { force?: boolean; author?: string } = {}) {
  const now = Date.now();
  if (!opts.force && now - lastSnapshotAt < SNAPSHOT_EVERY && state.history.length > 0) return;
  lastSnapshotAt = now;
  const author = opts.author ?? ((await userName().catch(() => "")) || "You");
  const sheets: Record<string, SheetData> = {};
  for (const [id, l] of wb.sheets) if (l.sheet) sheets[id] = l.sheet;
  const snap: HistorySnapshot = { id: crypto.randomUUID().slice(0, 10), at: now, author, label, index: wb.index, sheets };
  let next = [snap, ...state.history].slice(0, HISTORY_MAX);
  let text = JSON.stringify(next);
  while (text.length > HISTORY_BYTES && next.length > 1) {
    next = next.slice(0, -1);
    text = JSON.stringify(next);
  }
  // A workbook too big for even one version keeps no history; undo still works.
  if (text.length > HISTORY_BYTES) return;
  setState({ history: next });
  await api().write("history.json", text).catch(() => {});
}

export async function reload(paths?: string[]) {
  const root = state.ref?.root ?? null;
  const partialIds = paths?.map((p) => SHEET_FILE_RE.exec(p)?.[1] ?? null);
  const partial = state.workbook && loadedRoot === root && partialIds?.length && partialIds.every((id) => id !== null);
  let next: LoadedWorkbook;
  if (partial && state.workbook) {
    const sheets = new Map(state.workbook.sheets);
    let changed = false;
    for (const id of new Set(partialIds as string[])) {
      if (!state.workbook.index.sheets.some((s) => s.id === id)) continue;
      const source = await api().read(sheetFile(id));
      if (source === null || sheets.get(id)?.source === source) continue;
      changed = true;
      try {
        const c = checkSheet(JSON.parse(source), id);
        sheets.set(id, { id, sheet: c.sheet, error: c.error, source });
      } catch (e) {
        sheets.set(id, { id, sheet: null, error: (e as Error).message, source });
      }
    }
    if (!changed) return;
    next = { ...state.workbook, sheets };
  } else {
    next = await loadWorkbook({ read: (p) => api().read(p), list: (d) => api().list(d) });
  }
  const external = loadedRoot === root && !!state.workbook;
  loadedRoot = root;
  const { evaluated, condStyles } = recompute(next);
  setState((s) => {
    const active = s.activeSheetId && next.sheets.has(s.activeSheetId) ? s.activeSheetId : (next.index.sheets[0]?.id ?? null);
    return { workbook: next, activeSheetId: active, evaluated, condStyles };
  });
  if (!state.history.length) {
    const hist = await readHistory();
    if (hist.length) setState({ history: hist });
    else void saveHistorySnapshot("Opened", next, { force: true });
  } else if (external) {
    // A change from outside the window (the AI, another editor): a version by them.
    void saveHistorySnapshot("Edited", next, { author: state.agent?.name ? agentName(state.agent.name) : "Outside the app" });
  }
}

const agentName = (kind: string) => ({ claude: "Claude", codex: "Codex", antigravity: "Antigravity" })[kind] ?? kind;

export async function boot() {
  const ref = await api().current();
  setState({ ref });
  if (ref) await reload();
  setState({ loading: false });
  api().onChanged((paths) => {
    const relevant = paths.filter((p) => p !== "comments.json" && p !== "history.json" && !p.startsWith("assets/"));
    if (relevant.length) void reload(relevant);
  });
}

async function switchTo(ref: SheetFolderRef | null) {
  if (!ref) return;
  setState({ ref, activeSheetId: null, undo: [], redo: [], editing: null, history: [] });
  await reload();
}

export async function chooseSheet() {
  await switchTo(await api().choose());
}

export async function openRecent(root: string) {
  try {
    await switchTo(await api().openPath(root));
  } catch (e) {
    toast(`Couldn’t open that sheet: ${plainError(e)}`);
  }
}

export function openRecentInTab(root: string) {
  api()
    .openInTab(root)
    .catch((e) => toast(`Couldn’t open that sheet: ${plainError(e)}`));
}

export async function createWorkbook(title: string, draft = "") {
  const { index, sheets } = newWorkbookFiles(title.trim() || "Untitled");
  const files: Record<string, string> = { "sheet.json": indexText(index) };
  for (const [id, content] of Object.entries(sheets)) files[sheetFile(id)] = content;
  try {
    await switchTo(await api().create(index.title, files));
  } catch (e) {
    toast(plainError(e));
    return;
  }
  if (draft.trim() && state.workbook) {
    writePref("sheets.chat", true);
    setState({ rightPanel: "chat", chatDraft: draft.trim() });
  }
}

/** A new workbook folder with a copy of every sheet, opened in a new tab. */
export async function duplicateWorkbook() {
  const wb = state.workbook;
  if (!wb) return;
  const title = `${wb.index.title} (copy)`.slice(0, LIMITS.titleChars);
  const files: Record<string, string> = { "sheet.json": indexText({ ...wb.index, title }) };
  for (const [id, l] of wb.sheets) if (l.source) files[sheetFile(id)] = l.source;
  try {
    const made = await api().create(title, files);
    if (made) await api().openInTab(made.root);
  } catch (e) {
    toast(`Couldn’t duplicate: ${plainError(e)}`);
  }
}

// ── Panels, selection, editing ───────────────────────────────────────────────

export function setRightPanel(panel: RightPanel) {
  writePref("sheets.chat", panel === "chat");
  setState({ rightPanel: panel, ...(panel === "rules" ? {} : { rules: { view: "list" } }) });
}

export function togglePanel(panel: Exclude<RightPanel, null>) {
  setRightPanel(state.rightPanel === panel ? null : panel);
}

/** Ask the AI from anywhere: the Ask box opens and sends it, so the reply shows there. */
export function askFor(text: string) {
  setState((s) => ({ asking: true, askRequest: { text, n: (s.askRequest?.n ?? 0) + 1 } }));
}

export function openRules(view: RulesView) {
  setState({ rightPanel: "rules", rules: view });
}

export function setAgent(agent: { name: string } | null) {
  setState({ agent });
  shellTabs.activity({ working: !!agent });
}

export function setSelection(sel: SelectionState) {
  setState({ selection: sel });
}

export function selectCell(r: number, c: number, extend = false) {
  const sheet = currentSheet();
  const nr = Math.max(0, Math.min((sheet?.rows ?? 1000) - 1, r));
  const nc = Math.max(0, Math.min((sheet?.cols ?? 26) - 1, c));
  setState((s) => ({
    selection: extend ? { ...s.selection, focus: { r: nr, c: nc }, mode: s.selection.mode === "cells" ? "cells" : s.selection.mode } : { anchor: { r: nr, c: nc }, focus: { r: nr, c: nc }, mode: "cells" },
  }));
}

/** The text a cell edits as: its formula, or its value as typed (a date as a date, not its serial number). */
export function editText(cell: CellData | undefined): string {
  if (!cell) return "";
  if (cell.f) return cell.f;
  if (cell.v === undefined || cell.v === null) return "";
  if (cell.t === "dropdown") return dropdownOf(cell.dropdownId)?.options.find((o) => o.id === cell.v || o.label === cell.v)?.label ?? String(cell.v);
  if (typeof cell.v === "number" && state.workbook) {
    const fmt = cell.s?.numFmt ?? (cell.t === "date" ? "date_short" : "auto");
    if (/^(date|month|time|datetime)/.test(fmt)) return formatCellValue(cell.v, { s: { numFmt: fmt.startsWith("time") ? "time" : fmt === "datetime" ? "datetime" : "date" } }, state.workbook.index);
    if (fmt === "percent") return `${Number((cell.v * 100).toPrecision(12))}%`;
  }
  if (typeof cell.v === "boolean") return cell.v ? "TRUE" : "FALSE";
  return String(cell.v);
}

export function startEditing(r: number, c: number, source: "cell" | "formula", initial?: string) {
  const sheet = currentSheet();
  if (!sheet) return;
  const cell = sheet.cells[formatCellRef(r, c)];
  if (initial === undefined && (cell?.t === "checkbox" || cell?.t === "dropdown" || cell?.t === "person")) return;
  setState({ editing: { r, c, value: initial !== undefined ? initial : editText(cell), source, fresh: initial !== undefined && source === "cell" } });
}

export async function commitEditing(moveDir?: "down" | "right" | "up" | "left") {
  const ed = state.editing;
  if (!ed) return;
  setState({ editing: null });
  const before = editText(currentSheet()?.cells[formatCellRef(ed.r, ed.c)]);
  if (ed.value !== before) await setCellInput(ed.r, ed.c, ed.value);
  if (moveDir) {
    const dr = moveDir === "down" ? 1 : moveDir === "up" ? -1 : 0;
    const dc = moveDir === "right" ? 1 : moveDir === "left" ? -1 : 0;
    selectCell(ed.r + dr, ed.c + dc);
  }
}

export function cancelEditing() {
  setState({ editing: null });
}

// ── Writing files, undo and redo ─────────────────────────────────────────────

async function writeFiles(changes: FileChange[]) {
  const a = api();
  const ordered = [...changes.filter((c) => c.rel !== "sheet.json"), ...changes.filter((c) => c.rel === "sheet.json")];
  for (const c of ordered) {
    if (c.after === null) await a.remove(c.rel);
    else await a.write(c.rel, c.after);
  }
}

function applyLocally(changes: FileChange[]): LoadedWorkbook | null {
  const wb = state.workbook;
  if (!wb) return null;
  let index = wb.index;
  const idxChange = changes.find((c) => c.rel === "sheet.json");
  if (idxChange?.after) {
    const r = checkIndex(JSON.parse(idxChange.after));
    if (r.index) index = r.index;
  }
  const sheets = new Map(wb.sheets);
  for (const c of changes) {
    const m = SHEET_FILE_RE.exec(c.rel);
    if (!m) continue;
    if (c.after === null) sheets.delete(m[1]!);
    else {
      const p = c.sheet ? { sheet: c.sheet, error: null } : checkSheet(JSON.parse(c.after), m[1]!);
      sheets.set(m[1]!, { id: m[1]!, sheet: p.sheet, error: p.error, source: c.after });
    }
  }
  const next: LoadedWorkbook = { ...wb, index, sheets };
  const { evaluated, condStyles } = recompute(next);
  setState({ workbook: next, evaluated, condStyles });
  return next;
}

/** Undo keeps at most 200 steps, and fewer when they hold big sheets (each step keeps the text before and after). */
const UNDO_STEPS = 200;
const UNDO_CHARS = 200_000_000;
function trimUndo(steps: UndoStep[]): UndoStep[] {
  let out = steps.slice(-UNDO_STEPS);
  const size = (st: UndoStep) => st.changes.reduce((n, c) => n + (c.before?.length ?? 0) + (c.after?.length ?? 0), 0);
  let total = out.reduce((n, st) => n + size(st), 0);
  while (out.length > 1 && total > UNDO_CHARS) {
    total -= size(out[0]!);
    out = out.slice(1);
  }
  return out;
}

/** Saves wait for each other, so two quick edits reach the disk in the order they were made. */
let saving: Promise<unknown> = Promise.resolve();

/** `version` names a version to keep right away, whatever the time since the last one. */
async function commit(label: string, changes: FileChange[], after?: Partial<SheetsState>, version?: string) {
  const real = changes.filter((c) => c.before !== c.after);
  if (!real.length) return;
  const step: UndoStep = { label, changes: real.map(({ rel, before, after: a }) => ({ rel, before, after: a })), sheetId: state.activeSheetId };
  const nextWb = applyLocally(real);
  setState({ undo: trimUndo([...state.undo, step]), redo: [], ...after });
  const run = saving.then(() => writeFiles(real));
  saving = run.catch(() => {});
  try {
    await run;
    if (nextWb) void saveHistorySnapshot(version ?? label, nextWb, { force: !!version });
  } catch (e) {
    toast(`Couldn’t save: ${plainError(e)}`);
    await reload();
  }
}

async function replay(step: UndoStep, back: boolean) {
  for (const c of step.changes) {
    const now = await api().read(c.rel);
    if (now !== (back ? c.after : c.before)) {
      toast(`Can’t ${back ? "undo" : "redo"} “${step.label.toLowerCase()}”: it was changed since, by the AI or another editor.`);
      setState({ undo: [], redo: [] });
      return false;
    }
  }
  const changes = back ? step.changes.map((c) => ({ rel: c.rel, before: c.after, after: c.before })) : step.changes;
  applyLocally(changes);
  const run = saving.then(() => writeFiles(changes));
  saving = run.catch(() => {});
  await run;
  return true;
}

export async function undo() {
  const step = state.undo[state.undo.length - 1];
  if (!step || !(await replay(step, true))) return;
  setState((s) => ({
    undo: s.undo.slice(0, -1),
    redo: [...s.redo, step],
    editing: null,
    activeSheetId: step.sheetId && s.workbook?.sheets.has(step.sheetId) ? step.sheetId : s.activeSheetId,
  }));
}

export async function redo() {
  const step = state.redo[state.redo.length - 1];
  if (!step || !(await replay(step, false))) return;
  setState((s) => ({
    redo: s.redo.slice(0, -1),
    undo: [...s.undo, step],
    editing: null,
    activeSheetId: step.sheetId && s.workbook?.sheets.has(step.sheetId) ? step.sheetId : s.activeSheetId,
  }));
}

// ── Sheet and workbook edits ─────────────────────────────────────────────────

async function editActiveSheet(label: string, fn: (sheet: SheetData) => SheetData) {
  const wb = state.workbook;
  const sid = state.activeSheetId;
  if (!wb || !sid) return;
  const loaded = wb.sheets.get(sid);
  if (!loaded?.sheet) return toast("This sheet’s file can’t be read, so it can’t be changed here.");
  const next = fn(loaded.sheet);
  await commit(label, [{ rel: sheetFile(sid), before: loaded.source, after: sheetText(next), sheet: next }]);
}

export async function editWorkbookIndex(label: string, fn: (index: WorkbookIndex) => WorkbookIndex, extra: FileChange[] = []) {
  const wb = state.workbook;
  if (!wb) return;
  const checked = checkIndex(fn(wb.index));
  if (!checked.index) return toast(checked.errors[0] ?? "That change would break the workbook.");
  await commit(label, [...extra, { rel: "sheet.json", before: indexText(wb.index), after: indexText(checked.index) }]);
}

export const renameWorkbook = (title: string) =>
  title.trim() ? editWorkbookIndex("Rename", (i) => ({ ...i, title: title.trim().slice(0, LIMITS.titleChars) })) : Promise.resolve();

export const setLocale = (locale: string) => editWorkbookIndex("Change locale", (i) => ({ ...i, locale }));
export const setTimeZone = (timeZone: string) => editWorkbookIndex("Change time zone", (i) => ({ ...i, timeZone }));

export function setActiveSheet(id: string) {
  if (id === state.activeSheetId) return;
  setState({ activeSheetId: id, editing: null, selection: { anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 }, mode: "cells" } });
}

export async function addSheet(title?: string) {
  const wb = state.workbook;
  if (!wb) return;
  if (wb.index.sheets.length >= LIMITS.sheets) return toast(`A workbook holds at most ${LIMITS.sheets} sheets.`);
  const sheetTitle = title?.trim() || nextSheetTitle(wb.index.sheets);
  const id = newSheetId(wb.index.sheets, sheetTitle);
  await editWorkbookIndex("Add sheet", (i) => ({ ...i, sheets: [...i.sheets, { id, title: sheetTitle }] }), [{ rel: sheetFile(id), before: null, after: sheetText(emptySheet(id, sheetTitle)) }]);
  setActiveSheet(id);
}

function copyTitle(base: string, taken: { title: string }[]) {
  for (let n = 1; ; n++) {
    const t = `${base} (copy${n > 1 ? ` ${n}` : ""})`.slice(0, LIMITS.titleChars);
    if (!taken.some((s) => s.title.toLowerCase() === t.toLowerCase())) return t;
  }
}

export async function duplicateSheet(id: string) {
  const wb = state.workbook;
  const src = wb?.sheets.get(id)?.sheet;
  if (!wb || !src) return;
  if (wb.index.sheets.length >= LIMITS.sheets) return toast(`A workbook holds at most ${LIMITS.sheets} sheets.`);
  const title = copyTitle(src.title, wb.index.sheets);
  const copyId = newSheetId(wb.index.sheets, title);
  const at = wb.index.sheets.findIndex((s) => s.id === id) + 1;
  await editWorkbookIndex(
    "Duplicate sheet",
    (i) => ({ ...i, sheets: [...i.sheets.slice(0, at), { id: copyId, title }, ...i.sheets.slice(at)] }),
    [{ rel: sheetFile(copyId), before: null, after: sheetText({ ...src, id: copyId, title }) }],
  );
  setActiveSheet(copyId);
}

export async function renameSheet(id: string, title: string) {
  const clean = title.trim().slice(0, LIMITS.titleChars);
  const wb = state.workbook;
  const loaded = wb?.sheets.get(id);
  if (!clean || !wb || !loaded?.sheet || clean === loaded.sheet.title) return;
  if (wb.index.sheets.some((s) => s.id !== id && s.title.toLowerCase() === clean.toLowerCase())) return toast(`There’s already a sheet called “${clean}”.`);
  await editWorkbookIndex("Rename sheet", (i) => ({ ...i, sheets: i.sheets.map((s) => (s.id === id ? { ...s, title: clean } : s)) }), [
    { rel: sheetFile(id), before: loaded.source, after: sheetText({ ...loaded.sheet, title: clean }) },
  ]);
}

export async function deleteSheet(id: string) {
  const wb = state.workbook;
  if (!wb) return;
  if (wb.index.sheets.length <= 1) return toast("A workbook keeps at least one sheet.");
  const loaded = wb.sheets.get(id);
  const at = wb.index.sheets.findIndex((s) => s.id === id);
  const nextList = wb.index.sheets.filter((s) => s.id !== id);
  await editWorkbookIndex("Delete sheet", (i) => ({ ...i, sheets: nextList }), [{ rel: sheetFile(id), before: loaded?.source ?? null, after: null }]);
  if (state.activeSheetId === id) setActiveSheet(nextList[Math.max(0, at - 1)]!.id);
}

export async function moveSheet(id: string, dir: -1 | 1) {
  await editWorkbookIndex("Move sheet", (i) => {
    const idx = i.sheets.findIndex((s) => s.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= i.sheets.length) return i;
    const sheets = [...i.sheets];
    [sheets[idx], sheets[to]] = [sheets[to]!, sheets[idx]!];
    return { ...i, sheets };
  });
}

// ── Cells ────────────────────────────────────────────────────────────────────

/** "=SUM(B2:B5" as typed: the closing brackets a spreadsheet adds for you. */
function closeBrackets(f: string): string {
  let depth = 0;
  let quoted = false;
  for (const ch of f) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "(") depth++;
    else if (!quoted && ch === ")") depth = Math.max(0, depth - 1);
  }
  return `${f}${quoted ? '"' : ""}${")".repeat(depth)}`;
}

/** A typed value into a cell, the way the cell's type takes it. */
function typedCell(prev: CellData | undefined, raw: string, locale: string, cells: SheetData["cells"]): CellData | null {
  const parsed = parseUserInput(raw, locale);
  if (prev?.t === "checkbox" && !parsed.f) return { ...prev, v: parsed.v === true || /^(true|yes|1|x)$/i.test(raw.trim()) };
  const next: CellData = { ...prev };
  delete next.v;
  delete next.f;
  if (parsed.f) next.f = closeBrackets(parsed.f);
  else if (parsed.v !== null && parsed.v !== undefined) next.v = parsed.v;
  const fmt = parsed.fmt ?? (next.f ? impliedFormat(next.f, cells) : undefined);
  if (fmt && !prev?.s?.numFmt && prev?.t !== "date") next.s = { ...prev?.s, numFmt: fmt };
  if (prev?.t === "dropdown" && typeof next.v === "string") {
    const dd = dropdownOf(prev.dropdownId);
    const opt = dd?.options.find((o) => o.label.toLowerCase() === String(next.v).trim().toLowerCase());
    if (opt) next.v = opt.label;
  }
  if (prev?.t === "person" && typeof next.v === "string") next.person = { name: next.v.trim() };
  return Object.keys(next).length ? next : null;
}

export async function setCellInput(r: number, c: number, raw: string) {
  const ref = formatCellRef(r, c);
  const locale = state.workbook?.index.locale ?? "en-US";
  await editActiveSheet("Edit cell", (s) => patchCells(s, { [ref]: typedCell(s.cells[ref], raw, locale, s.cells) }));
}

export async function toggleCheckbox(r: number, c: number) {
  const ref = formatCellRef(r, c);
  await editActiveSheet("Toggle checkbox", (s) => patchCells(s, { [ref]: { ...s.cells[ref], t: "checkbox", v: !(s.cells[ref]?.v === true) } }));
}

/** The selected cells (or one cell) as checkboxes, dropdowns, people or dates; plain "auto" undoes it. */
export async function setCellType(patch: Partial<CellData>, at?: { r: number; c: number }) {
  const sheet = currentSheet();
  if (!sheet) return;
  const refs = at ? [formatCellRef(at.r, at.c)] : selectedRefs(state.selection, sheet, 5000);
  const label = patch.t === "checkbox" ? "Insert checkbox" : patch.t === "dropdown" ? "Insert dropdown" : patch.t === "person" ? "Insert person" : patch.t === "date" ? "Insert date" : "Edit cell";
  await editActiveSheet(label, (s) => {
    const updates: Record<string, CellData | null> = {};
    for (const ref of refs) {
      const cur = s.cells[ref] ?? {};
      const next: CellData = { ...cur, ...patch };
      if (patch.t && patch.t !== "dropdown") delete next.dropdownId;
      if (patch.t && patch.t !== "person") delete next.person;
      if (patch.t === "checkbox" && typeof next.v !== "boolean") next.v = false;
      if (patch.t && patch.t !== "checkbox" && typeof cur.v === "boolean" && patch.v === undefined) delete next.v;
      if (patch.t) delete next.f;
      updates[ref] = next;
    }
    return patchCells(s, updates);
  });
}

export function dropdownOf(id: string | undefined): Dropdown | null {
  if (!id) return null;
  return state.workbook?.index.dropdowns.find((d) => d.id === id) ?? DROPDOWN_TEMPLATES.find((d) => d.id === id) ?? null;
}

export async function styleSelection(patch: Partial<CellStyle>) {
  const sheet = currentSheet();
  if (!sheet) return;
  const refs = selectedRefs(state.selection, sheet);
  await editActiveSheet("Format cells", (s) => patchCellStyle(s, refs, patch));
}

export async function toggleStyleProp(prop: "bold" | "italic" | "underline" | "strike") {
  const sheet = currentSheet();
  if (!sheet) return;
  await styleSelection({ [prop]: !sheet.cells[activeCellRef()]?.s?.[prop] });
}

export async function applyBorders(preset: BorderPreset, color = state.borderColor, style = state.borderStyle) {
  const sheet = currentSheet();
  if (!sheet) return;
  const { r1, c1, r2, c2 } = selectionRect();
  const side = { style, color };
  await editActiveSheet("Borders", (s) => {
    const updates: Record<string, CellData | null> = {};
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const ref = formatCellRef(r, c);
        const cur = s.cells[ref] ?? {};
        const b: CellBorders = { ...(cur.s?.borders ?? {}) };
        if (preset === "clear") {
          const st = { ...cur.s };
          delete st.borders;
          const next = { ...cur };
          if (Object.keys(st).length) next.s = st;
          else delete next.s;
          updates[ref] = next;
          continue;
        }
        const inside = { top: r > r1, bottom: r < r2, left: c > c1, right: c < c2 };
        const edge = { top: r === r1, bottom: r === r2, left: c === c1, right: c === c2 };
        for (const k of ["top", "bottom", "left", "right"] as const) {
          const on =
            preset === "all" ||
            (preset === "inner" && inside[k]) ||
            (preset === "outer" && edge[k]) ||
            (preset === "horizontal" && (k === "top" || k === "bottom") && inside[k]) ||
            (preset === "vertical" && (k === "left" || k === "right") && inside[k]) ||
            (preset === k && edge[k]);
          if (on) b[k] = side;
        }
        updates[ref] = { ...cur, s: { ...cur.s, borders: b } };
      }
    }
    return patchCells(s, updates);
  });
}

export async function clearSelection(mode: "contents" | "formatting" | "both") {
  const sheet = currentSheet();
  if (!sheet) return;
  const range = formatRangeRef(selectionRect());
  await editActiveSheet(mode === "formatting" ? "Clear formatting" : "Clear", (s) => clearRange(s, range, mode));
}

export async function mergeSelection() {
  const b = selectionRect();
  if (b.r1 === b.r2 && b.c1 === b.c2) return toast("Select two or more cells to merge.");
  await editActiveSheet("Merge cells", (s) => ({ ...s, merges: [...s.merges.filter((m) => m.r2 < b.r1 || m.r1 > b.r2 || m.c2 < b.c1 || m.c1 > b.c2), b] }));
}

export async function unmergeSelection() {
  const b = selectionRect();
  await editActiveSheet("Unmerge cells", (s) => ({ ...s, merges: s.merges.filter((m) => m.r2 < b.r1 || m.r1 > b.r2 || m.c2 < b.c1 || m.c1 > b.c2) }));
}

/** Rows or columns inserted, deleted or moved: every formula, rule, chart and comment that points at them follows. */
async function restructureActive(label: string, op: StructureOp, after?: () => void) {
  const wb = state.workbook;
  const sid = state.activeSheetId;
  if (!wb || !sid) return;
  if (!wb.sheets.get(sid)?.sheet) return toast("This sheet’s file can’t be read, so it can’t be changed here.");
  const all = [...wb.sheets.values()].flatMap((l) => (l.sheet ? [l.sheet] : []));
  const changed = restructure(all, sid, op);
  await commit(
    label,
    changed.map((s) => ({ rel: sheetFile(s.id), before: wb.sheets.get(s.id)!.source, after: sheetText(s) })),
  );
  const map = op.kind === "move" ? swapMap(op.from, op.to) : shiftMap(op.at, op.kind === "insert" ? op.count : -op.count);
  comments.update((threads) =>
    threads.map((t) => {
      if (t.sheetId !== sid) return t;
      const range = remapRange(t.range, op.axis, map);
      return range ? (range === t.range ? t : { ...t, range }) : { ...t, resolved: true };
    }),
  );
  after?.();
}

export const insertRowsAt = (index: number, count = 1) => restructureActive(count > 1 ? `Insert ${count} rows` : "Insert row", { kind: "insert", axis: "row", at: index, count });
export const deleteRowsAt = (index: number, count = 1) =>
  restructureActive(count > 1 ? `Delete ${count} rows` : "Delete row", { kind: "delete", axis: "row", at: index, count }, () => selectCell(index, state.selection.anchor.c));
export const insertColsAt = (index: number, count = 1) => restructureActive(count > 1 ? `Insert ${count} columns` : "Insert column", { kind: "insert", axis: "col", at: index, count });
export const deleteColsAt = (index: number, count = 1) =>
  restructureActive(count > 1 ? `Delete ${count} columns` : "Delete column", { kind: "delete", axis: "col", at: index, count }, () => selectCell(state.selection.anchor.r, index));

export async function moveColumn(col: number, dir: -1 | 1) {
  const sheet = currentSheet();
  const to = col + dir;
  if (!sheet || to < 0 || to >= sheet.cols) return;
  const mode = state.selection.mode;
  await restructureActive("Move column", { kind: "move", axis: "col", from: col, to }, () =>
    setSelection(mode === "cols" ? { anchor: { r: 0, c: to }, focus: { r: sheet.rows - 1, c: to }, mode } : { anchor: { r: state.selection.anchor.r, c: to }, focus: { r: state.selection.anchor.r, c: to }, mode: "cells" }),
  );
}

export function previewResize(kind: "col" | "row", index: number, size: number) {
  setState({ resizing: { kind, index, size } });
}

/** Save a resize; when the column or row is one of several selected, they all take the size. */
export async function resizeTo(kind: "col" | "row", index: number, size: number) {
  setState({ resizing: null });
  const sel = state.selection;
  const b = selectionBounds(sel);
  const many = kind === "col" ? sel.mode === "cols" && index >= b.c1 && index <= b.c2 : sel.mode === "rows" && index >= b.r1 && index <= b.r2;
  const from = many ? (kind === "col" ? b.c1 : b.r1) : index;
  const to = many ? (kind === "col" ? b.c2 : b.r2) : index;
  const word = kind === "col" ? "column" : "row";
  await editActiveSheet(from === to ? `Resize ${word}` : `Resize ${word}s`, (s) => resizeLines(s, kind, from, to, size));
}

export async function freezeAt(rows: number, cols: number) {
  await editActiveSheet(rows || cols ? "Freeze" : "Unfreeze", (s) => ({ ...s, frozenRows: Math.max(0, rows), frozenCols: Math.max(0, cols) }));
}

/** Group the selected columns (or rows), so they can be collapsed out of view and opened again. */
export async function groupSelection(axis: "col" | "row") {
  const b = selectionBounds();
  const [a, z] = axis === "col" ? [b.c1, b.c2] : [b.r1, b.r2];
  const key = axis === "col" ? "colGroups" : "rowGroups";
  const word = axis === "col" ? "column" : "row";
  await editActiveSheet(a === z ? `Group ${word}` : `Group ${word}s`, (s) => ({ ...s, [key]: addGroup(s[key], a, z) }));
}

export async function ungroupSelection(axis: "col" | "row") {
  const b = selectionBounds();
  const [a, z] = axis === "col" ? [b.c1, b.c2] : [b.r1, b.r2];
  const key = axis === "col" ? "colGroups" : "rowGroups";
  await editActiveSheet(axis === "col" ? "Ungroup columns" : "Ungroup rows", (s) => ({ ...s, [key]: removeGroup(s[key], a, z) }));
}

/** Collapse the group that starts at `start`, or open it again. */
export async function toggleGroup(axis: "col" | "row", start: number) {
  const key = axis === "col" ? "colGroups" : "rowGroups";
  const g = currentSheet()?.[key].find((x) => x.start === start);
  if (!g) return;
  await editActiveSheet(g.collapsed ? "Expand group" : "Collapse group", (s) => ({ ...s, [key]: s[key].map((x) => (x.start === start ? { ...x, collapsed: !x.collapsed || undefined } : x)) }));
}

export async function toggleGridlines() {
  await editActiveSheet("Gridlines", (s) => ({ ...s, showGridlines: !s.showGridlines }));
}

export async function sortActiveSheet(col: number, ascending: boolean, range?: string, hasHeader = true) {
  const sheet = currentSheet();
  if (!sheet) return;
  const values = state.evaluated.get(sheet.id);
  await editActiveSheet("Sort", (s) => sortSheetByColumn(s, col, ascending, range, hasHeader, (ref) => values?.get(ref)));
}

/** The table around the selection: the block of filled cells it sits in, from its header row down. */
export function tableAround(sheet: SheetData, sel = state.selection): string | null {
  const b = selectionBounds(sel);
  if (sel.mode === "cells" && (b.r2 > b.r1 || b.c2 > b.c1)) return formatRangeRef(b);
  if (!Object.keys(sheet.cells).length) return null;
  const filled = (r: number, c: number) => {
    const cell = sheet.cells[formatCellRef(r, c)];
    return !!cell && (cell.f !== undefined || (cell.v !== undefined && cell.v !== null && cell.v !== ""));
  };
  let { r1, c1, r2, c2 } = { r1: b.r1, c1: b.c1, r2: b.r1, c2: b.c1 };
  if (!filled(r1, c1)) {
    const used = usedBounds(sheet);
    return used.maxRow > 0 ? formatRangeRef({ r1: 0, c1: 0, r2: used.maxRow, c2: used.maxCol }) : null;
  }
  for (let grew = true; grew; ) {
    grew = false;
    const rowHas = (r: number) => r >= 0 && Array.from({ length: c2 - c1 + 1 }, (_, i) => c1 + i).some((c) => filled(r, c));
    const colHas = (c: number) => c >= 0 && Array.from({ length: r2 - r1 + 1 }, (_, i) => r1 + i).some((r) => filled(r, c));
    if (rowHas(r1 - 1)) (r1--, (grew = true));
    if (r2 + 1 < sheet.rows && rowHas(r2 + 1)) (r2++, (grew = true));
    if (colHas(c1 - 1)) (c1--, (grew = true));
    if (c2 + 1 < sheet.cols && colHas(c2 + 1)) (c2++, (grew = true));
  }
  return r2 > r1 ? formatRangeRef({ r1, c1, r2, c2 }) : null;
}

export async function toggleFilter() {
  const sheet = currentSheet();
  if (!sheet) return;
  if (sheet.filter) return editActiveSheet("Remove filter", (s) => ({ ...s, filter: null }));
  const range = tableAround(sheet);
  if (!range) return toast("No table here to filter.");
  await editActiveSheet("Create filter", (s) => ({ ...s, filter: { range, columnFilters: {} } }));
}

export async function setColumnFilter(col: number, allowedValues: string[] | null) {
  await editActiveSheet("Filter", (s) => {
    if (!s.filter) return s;
    const columnFilters = { ...s.filter.columnFilters };
    if (allowedValues === null) delete columnFilters[String(col)];
    else columnFilters[String(col)] = allowedValues;
    return { ...s, filter: { ...s.filter, columnFilters } };
  });
}

export async function addRowsToBottom(count: number) {
  const sheet = currentSheet();
  if (!sheet) return;
  const n = Math.max(1, Math.min(LIMITS.maxRows - sheet.rows, count));
  if (n <= 0 || sheet.rows >= LIMITS.maxRows) return toast(`A sheet has at most ${LIMITS.maxRows.toLocaleString()} rows.`);
  await editActiveSheet(n === 1 ? "Add row" : `Add ${n} rows`, (s) => ({ ...s, rows: s.rows + n }));
}

export async function addColToRight(count = 1) {
  const sheet = currentSheet();
  if (!sheet) return;
  if (sheet.cols >= LIMITS.maxCols) return toast(`A sheet has at most ${LIMITS.maxCols} columns.`);
  const n = Math.min(count, LIMITS.maxCols - sheet.cols);
  await editActiveSheet(n === 1 ? "Add column" : `Add ${n} columns`, (s) => ({ ...s, cols: s.cols + n }));
}

export async function fillRangeTo(dstRange: string) {
  const srcRange = formatRangeRef(selectionBounds());
  await editActiveSheet("Fill", (s) => fillSelection(s, srcRange, dstRange));
}

// ── Conditional formatting and charts ────────────────────────────────────────

export async function addRule(rule: ConditionalRule) {
  await editActiveSheet("Add rule", (s) => ({ ...s, rules: [...s.rules, rule] }));
}

export async function updateRule(rule: ConditionalRule) {
  await editActiveSheet("Change rule", (s) => ({ ...s, rules: s.rules.map((r) => (r.id === rule.id ? rule : r)) }));
}

export async function deleteRule(id: string) {
  await editActiveSheet("Delete rule", (s) => ({ ...s, rules: s.rules.filter((r) => r.id !== id) }));
}

/** Whether the selection holds anything a chart could draw. */
export function selectionHasData(sheet = currentSheet()): boolean {
  if (!sheet) return false;
  const b = selectionRect();
  if (b.r1 === b.r2 && b.c1 === b.c2) return false;
  for (let r = b.r1; r <= b.r2; r++)
    for (let c = b.c1; c <= b.c2; c++) {
      const cell = sheet.cells[formatCellRef(r, c)];
      if (cell && (cell.f || (cell.v !== undefined && cell.v !== null && cell.v !== ""))) return true;
    }
  return false;
}

export async function addChartFromSelection(type: ChartType) {
  const sheet = currentSheet();
  if (!sheet) return;
  if (!selectionHasData(sheet)) return toast("Select cells with data to chart first.");
  const b = selectionRect();
  let x = 0;
  for (let c = 0; c <= b.c2 + 1; c++) x += sheet.colWidths[c] ?? LIMITS.defaultColWidth;
  let y = 0;
  for (let r = 0; r < b.r1; r++) y += sheet.rowHeights[r] ?? LIMITS.defaultRowHeight;
  const chart: ChartSpec = {
    id: `chart-${crypto.randomUUID().slice(0, 6)}`,
    type,
    title: "",
    range: formatRangeRef(b),
    x: x + 16 + sheet.charts.length * 24,
    y: y + sheet.charts.length * 24,
    w: 480,
    h: 300,
    headerRow: true,
  };
  await editActiveSheet("Add chart", (s) => ({ ...s, charts: [...s.charts, chart] }));
}

export async function updateChart(chart: ChartSpec) {
  await editActiveSheet("Change chart", (s) => ({ ...s, charts: s.charts.map((c) => (c.id === chart.id ? chart : c)) }));
}

export async function deleteChart(id: string) {
  await editActiveSheet("Delete chart", (s) => ({ ...s, charts: s.charts.filter((c) => c.id !== id) }));
}

// ── Dropdowns and people ─────────────────────────────────────────────────────

export async function ensureTemplateDropdown(templateId: string): Promise<Dropdown | null> {
  const wb = state.workbook;
  if (!wb) return null;
  const existing = wb.index.dropdowns.find((d) => d.id === templateId);
  if (existing) return existing;
  const tpl = DROPDOWN_TEMPLATES.find((d) => d.id === templateId);
  if (!tpl) return null;
  await editWorkbookIndex("Add dropdown", (i) => ({ ...i, dropdowns: [...i.dropdowns, tpl] }));
  return tpl;
}

export async function createDropdownDef(name: string, optionLabels: string[]): Promise<Dropdown | null> {
  const wb = state.workbook;
  if (!wb) return null;
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const base = slug(name) || "dropdown";
  let id = base;
  for (let i = 2; wb.index.dropdowns.some((d) => d.id === id) || DROPDOWN_TEMPLATES.some((d) => d.id === id); i++) id = `${base}-${i}`;
  const seen = new Set<string>();
  const dd: Dropdown = {
    id,
    name: name.trim(),
    options: optionLabels
      .map((l) => l.trim())
      .filter((l) => l && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()))
      .slice(0, LIMITS.dropdownOptions)
      .map((label, idx) => ({ id: slug(label) || `option-${idx + 1}`, label, color: OPTION_COLORS[idx % OPTION_COLORS.length]! })),
  };
  if (!dd.options.length) return null;
  await editWorkbookIndex("Add dropdown", (i) => ({ ...i, dropdowns: [...i.dropdowns, dd] }));
  return dd;
}

export async function addPersonDef(person: PersonValue) {
  const wb = state.workbook;
  if (!wb || wb.index.people.some((p) => p.name.toLowerCase() === person.name.toLowerCase())) return;
  await editWorkbookIndex("Add person", (i) => ({ ...i, people: [...i.people, person] }));
}

// ── Clipboard ────────────────────────────────────────────────────────────────

export function copySelection(cut = false) {
  const sheet = currentSheet();
  const wb = state.workbook;
  if (!sheet || !wb) return;
  const b = selectionRect();
  const cells: ClipboardData["cells"] = [];
  const lines: string[] = [];
  const values = state.evaluated.get(sheet.id) ?? new Map();
  for (let r = b.r1; r <= b.r2; r++) {
    const row: string[] = [];
    for (let c = b.c1; c <= b.c2; c++) {
      const ref = formatCellRef(r, c);
      const cell = sheet.cells[ref];
      if (cell) cells.push({ dr: r - b.r1, dc: c - b.c1, cell });
      row.push(formatCellValue(values.get(ref) ?? cell?.v ?? null, cell, wb.index).replace(/[\t\n]/g, " "));
    }
    lines.push(row.join("\t"));
  }
  const text = lines.join("\n");
  void navigator.clipboard?.writeText(text).catch(() => {});
  setState({ clipboard: { cells, rows: b.r2 - b.r1 + 1, cols: b.c2 - b.c1 + 1, from: { sheetId: sheet.id, r: b.r1, c: b.c1 }, cut, text } });
  toast(cut ? "Cut. Paste where it should go." : `Copied ${b.r2 - b.r1 + 1 === 1 && b.c2 - b.c1 + 1 === 1 ? "1 cell" : `${(b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1)} cells`}.`);
}

export async function pasteSelection(valuesOnly = false) {
  const sheet = currentSheet();
  if (!sheet) return;
  const { r: startR, c: startC } = { r: selectionBounds().r1, c: selectionBounds().c1 };
  const systemText = await navigator.clipboard?.readText().catch(() => null);
  const clip = state.clipboard;
  // Our own copy, unless something else has been copied since.
  if (clip && (systemText === null || systemText === undefined || systemText === clip.text)) {
    const values = state.evaluated.get(clip.from.sheetId) ?? new Map();
    const sel = selectionBounds();
    const tileR = (sel.r2 - sel.r1 + 1) % clip.rows === 0 ? (sel.r2 - sel.r1 + 1) / clip.rows : 1;
    const tileC = (sel.c2 - sel.c1 + 1) % clip.cols === 0 ? (sel.c2 - sel.c1 + 1) / clip.cols : 1;
    await editActiveSheet(valuesOnly ? "Paste values" : clip.cut ? "Move cells" : "Paste", (s) => {
      let next = s;
      if (clip.cut && clip.from.sheetId === s.id) next = clearRange(next, formatRangeRef({ r1: clip.from.r, c1: clip.from.c, r2: clip.from.r + clip.rows - 1, c2: clip.from.c + clip.cols - 1 }), "both");
      const updates: Record<string, CellData | null> = {};
      for (let tr = 0; tr < tileR; tr++)
        for (let tc = 0; tc < tileC; tc++) {
          for (let dr = 0; dr < clip.rows; dr++)
            for (let dc = 0; dc < clip.cols; dc++) updates[formatCellRef(startR + tr * clip.rows + dr, startC + tc * clip.cols + dc)] = null;
          for (const item of clip.cells) {
            const r = startR + tr * clip.rows + item.dr;
            const c = startC + tc * clip.cols + item.dc;
            if (r >= LIMITS.maxRows || c >= LIMITS.maxCols) continue;
            const ref = formatCellRef(r, c);
            if (valuesOnly) {
              const v = values.get(formatCellRef(clip.from.r + item.dr, clip.from.c + item.dc)) ?? item.cell.v ?? null;
              updates[ref] = v === null || typeof v === "object" ? null : { v, ...(item.cell.s?.numFmt ? { s: { numFmt: item.cell.s.numFmt } } : {}) };
            } else if (item.cell.f && !clip.cut) updates[ref] = { ...item.cell, f: shiftFormula(item.cell.f, r - (clip.from.r + item.dr), c - (clip.from.c + item.dc)) };
            else updates[ref] = item.cell;
          }
        }
      return patchCells(next, updates);
    });
    if (clip.cut) setState({ clipboard: null });
    return;
  }
  if (!systemText) return;
  const rows = systemText.replace(/\r?\n$/, "").split(/\r?\n/).map((line) => line.split("\t"));
  const locale = state.workbook?.index.locale ?? "en-US";
  await editActiveSheet("Paste", (s) => {
    const updates: Record<string, CellData | null> = {};
    rows.forEach((cols, dr) =>
      cols.forEach((raw, dc) => {
        const r = startR + dr;
        const c = startC + dc;
        if (r < LIMITS.maxRows && c < LIMITS.maxCols) updates[formatCellRef(r, c)] = typedCell(s.cells[formatCellRef(r, c)], raw, locale, s.cells);
      }),
    );
    return patchCells(s, updates);
  });
}

// ── Version history, import and export ───────────────────────────────────────

export async function restoreVersion(snap: HistorySnapshot) {
  const wb = state.workbook;
  if (!wb) return;
  const changes: FileChange[] = [];
  for (const ref of wb.index.sheets) if (!snap.sheets[ref.id]) changes.push({ rel: sheetFile(ref.id), before: wb.sheets.get(ref.id)?.source ?? null, after: null });
  for (const [id, s] of Object.entries(snap.sheets)) changes.push({ rel: sheetFile(id), before: wb.sheets.get(id)?.source ?? null, after: sheetText(s) });
  changes.push({ rel: "sheet.json", before: indexText(wb.index), after: indexText(snap.index) });
  await commit("Restore version", changes, undefined, "Restored a version");
  toast("Restored that version. Undo brings back what was there.");
}

export async function importCsvFile() {
  const picked = await api().exports.pickImport("csv");
  const wb = state.workbook;
  if (!picked || !wb) return;
  const text = new TextDecoder().decode(picked.bytes);
  const title = uniqueTitle(picked.name || nextSheetTitle(wb.index.sheets), wb.index.sheets);
  const id = newSheetId(wb.index.sheets, title);
  const sheet = sheetFromCsv(id, title, text, wb.index.locale);
  if (!Object.keys(sheet.cells).length) return toast("That file has no rows.");
  await editWorkbookIndex("Import CSV", (i) => ({ ...i, sheets: [...i.sheets, { id, title }] }), [{ rel: sheetFile(id), before: null, after: sheetText(sheet) }]);
  setActiveSheet(id);
  toast(`Imported “${title}”.`);
}

function uniqueTitle(base: string, taken: { title: string }[]) {
  const clean = base.trim().slice(0, LIMITS.titleChars) || "Sheet";
  if (!taken.some((s) => s.title.toLowerCase() === clean.toLowerCase())) return clean;
  for (let n = 2; ; n++) {
    const t = `${clean} ${n}`;
    if (!taken.some((s) => s.title.toLowerCase() === t.toLowerCase())) return t;
  }
}

export async function importXlsxFile() {
  const picked = await api().exports.pickImport("xlsx");
  const wb = state.workbook;
  if (!picked || !wb) return;
  try {
    const parsed = await importXlsx(picked.bytes, picked.name);
    if (!parsed.sheets.length) return toast("No sheets in that Excel file.");
    const refs = [...wb.index.sheets];
    const extra: FileChange[] = [];
    let first = "";
    for (const s of parsed.sheets.slice(0, LIMITS.sheets - refs.length)) {
      const title = uniqueTitle(s.title, refs);
      const id = newSheetId(refs, title);
      first ||= id;
      refs.push({ id, title });
      extra.push({ rel: sheetFile(id), before: null, after: sheetText({ ...s, id, title }) });
    }
    if (!extra.length) return toast(`A workbook holds at most ${LIMITS.sheets} sheets.`);
    await editWorkbookIndex("Import Excel", (i) => ({ ...i, sheets: refs }), extra);
    if (first) setActiveSheet(first);
    toast(`Imported ${extra.length} sheet${extra.length === 1 ? "" : "s"}.`);
  } catch (e) {
    toast(`Couldn’t read that Excel file: ${(e as Error).message}`);
  }
}

export async function exportCsvFile() {
  const wb = state.workbook;
  const sheet = currentSheet();
  if (!wb || !sheet) return;
  const csv = sheetToCsv(sheet, state.evaluated.get(sheet.id) ?? new Map(), wb.index);
  const saved = await api().exports.save(wb.index.sheets.length > 1 ? `${wb.index.title} - ${sheet.title}` : wb.index.title, "csv", new TextEncoder().encode(csv));
  if (saved) toast(`Saved ${saved.split(/[\\/]/).pop()}`);
}

export async function exportXlsxFile() {
  const wb = state.workbook;
  if (!wb) return;
  const list = wb.index.sheets.map((r) => wb.sheets.get(r.id)?.sheet).filter((s): s is SheetData => !!s);
  const saved = await api().exports.save(wb.index.title, "xlsx", exportXlsx(wb.index, list, state.evaluated));
  if (saved) toast(`Saved ${saved.split(/[\\/]/).pop()}`);
}

/** Sum, average and count of the selection, for the bar at the bottom. */
export function selectionStats() {
  const sheet = currentSheet();
  if (!sheet) return null;
  const values = state.evaluated.get(sheet.id) ?? new Map();
  const b = selectionRect();
  if (b.r1 === b.r2 && b.c1 === b.c2) return null;
  const nums: number[] = [];
  let count = 0;
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const p = parseCellRef(ref);
    if (!p || p.row < b.r1 || p.row > b.r2 || p.col < b.c1 || p.col > b.c2) continue;
    const v = values.get(ref) ?? cell.v ?? null;
    if (v === null || v === "") continue;
    count++;
    if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
  }
  if (!count) return null;
  if (!nums.length) return { count };
  const sum = nums.reduce((a, n) => a + n, 0);
  return { count, sum, avg: sum / nums.length };
}

export { colToLetter, parseRangeRef };
