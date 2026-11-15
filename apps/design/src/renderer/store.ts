// The editor's state and every change to the design. A change goes through
// `apply`: the state changes here at once, the step goes on the undo stack,
// and the files that changed are written (one artboard file, design.json or
// notes.json). Writes wait for each other, so each file ends as the last
// change made. An artboard file that can't be read is shown with its
// problems and never written over; neither is a design.json that can't.

import { useSyncExternalStore } from "react";
import { getAt, type ValueContext } from "@opendeck/format";
import {
  BOARD_SIZES,
  EditError,
  LIMITS,
  checkIndex,
  designContext,
  duplicate,
  fileFor,
  holdsLayers,
  indexText,
  insertHtml,
  loadBoard,
  loadDesign,
  newArtboard,
  newDesignFiles,
  newId,
  newPageId,
  noteBounds,
  notesText,
  parseArtboard,
  parseHistory,
  parseNotes,
  placeBeside,
  removeMany,
  serializeArtboard,
  serializeBlock,
  sizeRoot,
  themeOf,
  tweakProblem,
  type DesignBoard,
  type DesignIndex,
  type ElementNode,
  type HistoryEntry,
  type LoadedBoard,
  type NoteItem,
  type Problem,
  type ShapeKind,
} from "@opendeck/artboard";
import { readPref, tabs as shellTabs, toast, userName, writePref } from "@opendeck/shell";
import { api, plainError, setAssetBase, type DesignFolderRef } from "./api.ts";

export type Tool = "select" | "hand" | "text" | "artboard" | "sticky" | "pen" | "shape" | "comment";
export type Panel = "chat" | "comments" | "history" | "properties" | null;
export type PanelTab = "properties" | "code" | "tweaks";
export type Flyout = "artboard" | "pen" | "shape" | null;

/** Artboards, layers of one artboard (never its root: that is the artboard), or notes on the canvas. */
export type Selection = { kind: "boards"; files: string[] } | { kind: "layers"; file: string; addresses: string[] } | { kind: "notes"; ids: string[] } | null;

/** What is being typed into: a layer's text, an artboard's name, or a sticky note. */
export type Editing = { kind: "layer"; file: string; address: string } | { kind: "name"; file: string } | { kind: "note"; id: string; fresh?: boolean } | null;

/** Screen = canvas × zoom + (x, y), in the canvas's own pixels. */
export interface View {
  x: number;
  y: number;
  zoom: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Everything that is saved. Each part is replaced, never changed in place, so a snapshot is three references. */
export interface Snap {
  index: DesignIndex;
  boards: Map<string, LoadedBoard>;
  notes: NoteItem[];
}

interface Step {
  label: string;
  before: Snap;
  after: Snap;
}

export interface DesignState extends Snap {
  ref: DesignFolderRef | null;
  loading: boolean;
  /** A design is open and read. */
  ready: boolean;
  problems: Problem[];
  /** Why design.json can't be read; nothing is saved while set. */
  broken: string | null;
  page: string;
  selection: Selection;
  editing: Editing;
  tool: Tool;
  flyout: Flyout;
  /** The size the artboard tool places (a name in BOARD_SIZES). */
  boardSize: string;
  penWidth: number;
  penDashed: boolean;
  shapeKind: ShapeKind;
  view: View;
  /** The canvas's size on screen; 0 until it has been measured. */
  viewport: { width: number; height: number };
  /** Fit the page once the canvas knows its size. */
  fitPending: boolean;
  /** Something is being moved, resized or drawn: the floating bar steps aside. */
  dragging: boolean;
  /** Layout guides: outlines of the layer under the pointer and of what the selected container holds. */
  guides: boolean;
  /** How tall each artboard that grows with its content is drawn. */
  heights: Record<string, number>;
  panel: Panel;
  tab: PanelTab;
  /** The artboard shown alone, filling the window. */
  focus: string | null;
  focusMode: "fill" | "fit";
  undo: Step[];
  redo: Step[];
  history: HistoryEntry[];
  asking: boolean;
  askRequest: { text: string; n: number } | null;
  chatDraft: string;
  agent: { name: string } | null;
}

const EMPTY: Snap = { index: checkIndex({}).index, boards: new Map(), notes: [] };

let state: DesignState = {
  ...EMPTY,
  ref: null,
  loading: true,
  ready: false,
  problems: [],
  broken: null,
  page: "page-1",
  selection: null,
  editing: null,
  tool: "select",
  flyout: null,
  boardSize: BOARD_SIZES[0]!.name,
  penWidth: 4,
  penDashed: false,
  shapeKind: "rect",
  view: { x: 0, y: 0, zoom: 1 },
  viewport: { width: 0, height: 0 },
  fitPending: false,
  dragging: false,
  guides: readPref("design.guides", true),
  heights: {},
  panel: readPref("design.chat", false) ? "chat" : null,
  tab: "properties",
  focus: null,
  focusMode: "fit",
  undo: [],
  redo: [],
  history: [],
  asking: false,
  askRequest: null,
  chatDraft: "",
  agent: null,
};

const listeners = new Set<() => void>();
export const getState = () => state;
export function setState(patch: Partial<DesignState> | ((s: DesignState) => Partial<DesignState>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  for (const l of listeners) l();
}
export function useDesign<T>(select: (s: DesignState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}

export const snap = (s: Snap = state): Snap => ({ index: s.index, boards: s.boards, notes: s.notes });
export const context = (): ValueContext => designContext(state.index);

// ── Loading ──────────────────────────────────────────────────────────────

/** Each file as last read or written here: a change event with the same text is our own. */
const disk = new Map<string, string | null>();
let loadedRoot: string | null = null;
let saving: Promise<unknown> = Promise.resolve();

const agentName = (kind: string) => ({ claude: "Claude", codex: "Codex", antigravity: "Antigravity" })[kind] ?? kind;

export async function reload() {
  const ref = state.ref;
  if (!ref) return;
  // Our own writes land first, so what is read here is never an older text of ours.
  await saving;
  const indexSource = await api().read("design.json");
  if (state.ref?.root !== ref.root) return;
  let files: string[] = [];
  try {
    files = checkIndex(JSON.parse(indexSource ?? "{}")).index.order;
  } catch {
    files = [];
  }
  const rels = ["design.json", "notes.json", ...files.map((f) => `artboards/${f}`)];
  const texts = new Map<string, string | null>([["design.json", indexSource]]);
  await Promise.all(rels.slice(1).map(async (rel) => texts.set(rel, await api().read(rel).catch(() => null))));
  if (state.ref?.root !== ref.root) return;
  const first = loadedRoot !== ref.root;
  if (!first && rels.every((rel) => disk.get(rel) === texts.get(rel)) && [...disk.keys()].every((rel) => texts.has(rel) || disk.get(rel) === null)) return;
  const d = loadDesign((rel) => texts.get(rel) ?? null, ref.name);
  const notes = parseNotes(texts.get("notes.json") ?? null, d.index.pages[0]!.id);
  disk.clear();
  for (const [rel, text] of texts) disk.set(rel, text);
  loadedRoot = ref.root;
  setState((s) => ({
    ready: true,
    index: d.index,
    boards: d.boards,
    notes: notes.items,
    broken: d.broken,
    problems: [...d.problems, ...notes.problems.map((message) => ({ where: "notes.json", message }))],
    page: d.index.pages.some((p) => p.id === s.page) ? s.page : d.index.pages[0]!.id,
    selection: keepSelection(s.selection, d),
    editing: null,
    // Steps made before someone else changed the design would undo their work too.
    ...(first ? {} : { undo: [], redo: [] }),
  }));
  if (first) {
    const history = parseHistory(await api().read("history.json").catch(() => null));
    if (history.length) setState({ history });
    else if (!d.broken) void snapshot("Opened", { force: true });
  } else if (!d.broken) {
    void snapshot("Edited", { author: state.agent ? agentName(state.agent.name) : "Outside the app" });
  }
}

function keepSelection(sel: Selection, d: { index: DesignIndex; boards: Map<string, LoadedBoard> }): Selection {
  if (!sel || sel.kind === "notes") return sel;
  if (sel.kind === "boards") {
    const files = sel.files.filter((f) => f in d.index.boards);
    return files.length ? { kind: "boards", files } : null;
  }
  const root = d.boards.get(sel.file)?.doc?.root;
  const addresses = root ? sel.addresses.filter((a) => getAt(root, a)) : [];
  return addresses.length ? { ...sel, addresses } : sel.file in d.index.boards ? { kind: "boards", files: [sel.file] } : null;
}

export async function boot() {
  const ref = await api().current().catch(() => null);
  if (ref) await switchTo(ref);
  setState({ loading: false });
  api().onChanged((paths) => {
    if (paths.some((p) => p === "design.json" || p === "notes.json" || p.startsWith("artboards/"))) void reload();
  });
}

async function switchTo(ref: DesignFolderRef | null) {
  if (!ref) return;
  setAssetBase(ref.asset);
  loadedRoot = null;
  disk.clear();
  setState({ ...EMPTY, ref, ready: false, selection: null, editing: null, undo: [], redo: [], history: [], broken: null, problems: [], heights: {}, focus: null });
  await reload();
  const saved = readView(ref.root);
  if (saved) setState({ view: saved });
  else if (state.viewport.width) fitPage();
  else setState({ fitPending: true });
}

export async function chooseDesign() {
  try {
    await switchTo(await api().choose());
  } catch (e) {
    toast(`Couldn’t open that folder: ${plainError(e)}`);
  }
}

export async function openRecent(root: string) {
  try {
    await switchTo(await api().openPath(root));
  } catch (e) {
    toast(`Couldn’t open that design: ${plainError(e)}`);
  }
}

export function openRecentInTab(root: string) {
  api()
    .openInTab(root)
    .catch((e) => toast(`Couldn’t open that design: ${plainError(e)}`));
}

export async function createDesign(title: string, draft = "") {
  const files = newDesignFiles(title || "Untitled design");
  try {
    await switchTo(await api().create(checkIndex(JSON.parse(files["design.json"]!)).index.title, files));
  } catch (e) {
    toast(plainError(e));
    return;
  }
  if (draft.trim() && state.ready) {
    writePref("design.chat", true);
    setState({ panel: "chat", chatDraft: draft.trim() });
  }
}

/** The text of each artboard file as it would be saved now (a damaged one as it is on disk). */
function fileTexts(s: Snap): Record<string, string> {
  const theme = themeOf(s.index);
  const out: Record<string, string> = {};
  for (const file of s.index.order) {
    const b = s.boards.get(file);
    if (b) out[file] = b.doc ? serializeArtboard(b.doc, { ...theme, title: s.index.boards[file]!.title }) : b.source;
  }
  return out;
}

/** A copy of the design in a new folder, opened in a new tab. */
export async function duplicateDesign() {
  const title = `${state.index.title} (copy)`.slice(0, LIMITS.titleChars);
  const files: Record<string, string> = { "design.json": indexText({ ...state.index, title }), "notes.json": notesText(state.notes) };
  for (const [file, text] of Object.entries(fileTexts(state))) files[`artboards/${file}`] = text;
  try {
    const made = await api().create(title, files);
    if (made) await api().openInTab(made.root);
  } catch (e) {
    toast(`Couldn’t duplicate: ${plainError(e)}`);
  }
}

// ── Saving, undo, versions ───────────────────────────────────────────────

function put(rel: string, text: string | null) {
  if (disk.get(rel) === text) return;
  disk.set(rel, text);
  const run = saving.then(() => (text === null ? api().remove(rel) : api().write(rel, text)));
  saving = run.catch(() => {});
  run.catch((e) => {
    toast(`Couldn’t save: ${plainError(e)}`);
    disk.delete(rel);
    void reload();
  });
}

/** Write what differs between two states: artboard files first, then the index that names them, then files no longer named. */
function save(before: Snap, after: Snap) {
  const theme = themeOf(after.index);
  const themed = JSON.stringify(themeOf(before.index)) !== JSON.stringify(theme);
  for (const file of after.index.order) {
    const b = after.boards.get(file);
    if (!b?.doc) continue;
    const title = after.index.boards[file]!.title;
    if (themed || before.boards.get(file)?.doc !== b.doc || before.index.boards[file]?.title !== title) put(`artboards/${file}`, serializeArtboard(b.doc, { ...theme, title }));
  }
  put("design.json", indexText(after.index));
  put("notes.json", notesText(after.notes));
  for (const file of before.index.order) if (!(file in after.index.boards)) put(`artboards/${file}`, null);
  void saving.then(() => snapshot("Edited"));
}

const UNDO_STEPS = 200;

/** Make a change: the design is now `next` over what it was, one undo step, saved. `before` is the design before a drag began. */
export function apply(label: string, next: Partial<Snap>, extra: Partial<DesignState> = {}, before: Snap = snap()) {
  if (state.broken) {
    toast("This design’s design.json can’t be read, so nothing is saved. Fix the file or restore a version.");
    setState({ ...before });
    return;
  }
  const after: Snap = { ...snap(), ...next };
  if (after.index === before.index && after.boards === before.boards && after.notes === before.notes) {
    setState(extra);
    return;
  }
  setState((s) => ({ ...after, undo: [...s.undo, { label, before, after }].slice(-UNDO_STEPS), redo: [], ...extra }));
  save(before, after);
}

/** Show a change mid-drag, without saving. */
export function preview(next: Partial<Snap>) {
  setState(next);
}

function replay(back: boolean) {
  const from = back ? state.undo : state.redo;
  const step = from[from.length - 1];
  if (!step) return;
  const to = back ? step.before : step.after;
  setState((s) => ({
    ...to,
    undo: back ? s.undo.slice(0, -1) : [...s.undo, step],
    redo: back ? [...s.redo, step] : s.redo.slice(0, -1),
    editing: null,
    page: to.index.pages.some((p) => p.id === s.page) ? s.page : to.index.pages[0]!.id,
    selection: keepSelection(s.selection?.kind === "notes" ? null : s.selection, to),
  }));
  save(back ? step.after : step.before, to);
}
export const undo = () => replay(true);
export const redo = () => replay(false);

let lastSnapshotAt = 0;
const SNAPSHOT_EVERY = 180_000;
const HISTORY_MAX = 30;
const HISTORY_CHARS = 12_000_000;

async function snapshot(label: string, opts: { force?: boolean; author?: string } = {}) {
  const now = Date.now();
  if (!opts.force && now - lastSnapshotAt < SNAPSHOT_EVERY && state.history.length) return;
  if (!state.ready || state.broken) return;
  lastSnapshotAt = now;
  const author = opts.author ?? ((await userName().catch(() => "")) || "You");
  const v: HistoryEntry = { id: crypto.randomUUID().slice(0, 10), at: now, author, label, index: state.index, files: fileTexts(state), notes: notesText(state.notes) };
  let next = [v, ...state.history].slice(0, HISTORY_MAX);
  let text = JSON.stringify(next);
  while (text.length > HISTORY_CHARS && next.length > 1) {
    next = next.slice(0, -1);
    text = JSON.stringify(next);
  }
  // A design too big for even one version keeps none; undo still works.
  if (text.length > HISTORY_CHARS) return;
  setState({ history: next });
  await api()
    .write("history.json", text)
    .catch(() => {});
}

export function restoreVersion(v: HistoryEntry) {
  const boards = new Map(v.index.order.map((file) => [file, loadBoard(file, v.files[file] ?? null, v.index)]));
  apply("Restore a version", { index: v.index, boards, notes: parseNotes(v.notes, v.index.pages[0]!.id).items }, { selection: null, editing: null, page: v.index.pages.some((p) => p.id === state.page) ? state.page : v.index.pages[0]!.id });
  void snapshot("Restored a version", { force: true });
  toast("Restored that version. Undo brings back what was there.");
}

// ── The design's own settings ────────────────────────────────────────────

const withIndex = (patch: Partial<DesignIndex>): DesignIndex => ({ ...state.index, ...patch });

export function renameDesign(title: string) {
  const t = title.trim().slice(0, LIMITS.titleChars);
  if (t && t !== state.index.title) apply("Rename design", { index: withIndex({ title: t }) });
}

/** Set a tweak for the whole design; every artboard's file gets it. Refused if the value is not a color or a length. */
export function setTweak(name: string, value: string): boolean {
  const problem = tweakProblem(value.trim());
  if (problem) {
    toast(`${name}: ${problem}.`);
    return false;
  }
  if (state.index.tweaks[name] !== value.trim()) apply(`Change ${name}`, { index: withIndex({ tweaks: { ...state.index.tweaks, [name]: value.trim() } }) });
  return true;
}

/** Which artboards use `var(<name>)`. */
export function tweakUsers(name: string): string[] {
  return state.index.order.filter((file) => {
    const root = state.boards.get(file)?.doc?.root;
    return !!root && serializeBlock(root).includes(`var(${name})`);
  });
}

export function removeTweak(name: string) {
  const users = tweakUsers(name);
  if (users.length) {
    toast(`${name} is used by ${users.map((f) => state.index.boards[f]!.title).join(", ")}. Change those layers first.`);
    return;
  }
  const { [name]: _, ...tweaks } = state.index.tweaks;
  apply(`Remove ${name}`, { index: withIndex({ tweaks }) });
}

/** Rename a tweak everywhere it is used. */
export function renameTweak(from: string, to: string): boolean {
  if (from === to) return true;
  if (!/^--[a-z][a-z0-9-]{0,39}$/.test(to) || to in state.index.tweaks) {
    toast(to in state.index.tweaks ? `There is already a tweak called ${to.slice(2)}.` : "A tweak’s name uses lowercase letters, digits and dashes.");
    return false;
  }
  const tweaks = Object.fromEntries(Object.entries(state.index.tweaks).map(([k, v]) => [k === from ? to : k, v]));
  const index = withIndex({ tweaks });
  const boards = new Map(state.boards);
  for (const [file, b] of boards) {
    if (!b.doc) continue;
    const text = serializeBlock(b.doc.root);
    if (!text.includes(`var(${from})`)) continue;
    const doc = parseArtboard(text.split(`var(${from})`).join(`var(${to})`), designContext(index)).doc;
    if (doc) boards.set(file, { ...b, doc: { ...b.doc, root: doc.root } });
  }
  apply(`Rename ${from}`, { index, boards });
  return true;
}

// ── Panels and the AI ────────────────────────────────────────────────────

export function setPanel(panel: Panel) {
  writePref("design.chat", panel === "chat");
  setState({ panel });
}
export const togglePanel = (panel: Exclude<Panel, null>) => setPanel(state.panel === panel ? null : panel);

export function setAgent(agent: { name: string } | null) {
  setState({ agent });
  shellTabs.activity({ working: !!agent });
}

export function toggleGuides() {
  writePref("design.guides", !state.guides);
  setState({ guides: !state.guides });
}

// ── Selection ────────────────────────────────────────────────────────────

export const pageBoards = (s: Snap & { page: string } = state): string[] => s.index.order.filter((f) => s.index.boards[f]!.page === s.page);
export const pageNotes = (s: { notes: NoteItem[]; page: string } = state): NoteItem[] => s.notes.filter((n) => n.page === s.page);

export function select(selection: Selection) {
  setState({ selection, editing: null });
}
export const selectBoards = (files: string[]) => select(files.length ? { kind: "boards", files } : null);
/** Select layers of an artboard; its root ("") selects the artboard itself. */
export function selectLayers(file: string, addresses: string[]) {
  const list = addresses.filter((a) => a !== "");
  select(list.length ? { kind: "layers", file, addresses: list } : { kind: "boards", files: [file] });
}
export const clearSelection = () => select(null);
export const selectAll = () => selectBoards(pageBoards());

/** The one artboard the selection is on (itself, or the one holding the selected layers). */
export function selectedFile(s: DesignState = state): string | null {
  const sel = s.selection;
  if (sel?.kind === "layers") return sel.file;
  return sel?.kind === "boards" && sel.files.length === 1 ? sel.files[0]! : null;
}

/** The single element the properties panel is about: the selected layer, or the selected artboard's root. */
export function target(s: DesignState = state): { file: string; address: string; el: ElementNode; root: ElementNode } | null {
  const file = selectedFile(s);
  const root = file ? s.boards.get(file)?.doc?.root : null;
  if (!file || !root) return null;
  const sel = s.selection!;
  if (sel.kind === "layers" && sel.addresses.length !== 1) return null;
  const address = sel.kind === "layers" ? sel.addresses[0]! : "";
  const el = getAt(root, address) as ElementNode | null;
  return el ? { file, address, el, root } : null;
}

/** `target()`, followed as the selection and the artboards change. */
export function useTarget() {
  useDesign((s) => s.selection);
  useDesign((s) => s.boards);
  return target();
}

// ── Geometry ─────────────────────────────────────────────────────────────

/** An artboard's box on the canvas; one that grows with its content is as tall as it is drawn. */
export function boardRect(file: string, s: DesignState = state): Rect | null {
  const b = s.index.boards[file];
  return b ? { x: b.x, y: b.y, w: b.w, h: b.expand === "fill" ? Math.max(b.h, s.heights[file] ?? 0) : b.h } : null;
}

export function union(rects: (Rect | null)[]): Rect | null {
  let out: Rect | null = null;
  for (const r of rects) {
    if (!r) continue;
    if (!out) out = { ...r };
    else {
      const x = Math.min(out.x, r.x);
      const y = Math.min(out.y, r.y);
      out = { x, y, w: Math.max(out.x + out.w, r.x + r.w) - x, h: Math.max(out.y + out.h, r.y + r.h) - y };
    }
  }
  return out;
}

/** Everything on the page, as one box. */
export const pageRect = (): Rect | null => union([...pageBoards().map((f) => boardRect(f)), ...pageNotes().map(noteBounds)]);

/** The canvas point at the middle of the screen. */
export function viewCenter(): { x: number; y: number } {
  const { view, viewport } = state;
  return { x: (viewport.width / 2 - view.x) / view.zoom, y: (viewport.height / 2 - view.y) / view.zoom };
}

// ── Pages ────────────────────────────────────────────────────────────────

export function setPage(page: string) {
  if (page === state.page || !state.index.pages.some((p) => p.id === page)) return;
  setState({ page, selection: null, editing: null });
  fitPage();
}

export function addPage() {
  if (state.index.pages.length >= LIMITS.maxPages) {
    toast(`A design holds at most ${LIMITS.maxPages} pages.`);
    return;
  }
  const id = newPageId(state.index.pages);
  let n = state.index.pages.length + 1;
  while (state.index.pages.some((p) => p.name === `Page ${n}`)) n++;
  apply("Add page", { index: withIndex({ pages: [...state.index.pages, { id, name: `Page ${n}` }] }) }, { page: id, selection: null, editing: null });
  fitPage();
}

export function renamePage(id: string, name: string) {
  const t = name.trim().slice(0, LIMITS.titleChars);
  if (!t || state.index.pages.find((p) => p.id === id)?.name === t) return;
  apply("Rename page", { index: withIndex({ pages: state.index.pages.map((p) => (p.id === id ? { ...p, name: t } : p)) }) });
}

/** Delete a page with the artboards and notes on it. A design keeps at least one page. */
export function deletePage(id: string) {
  const pages = state.index.pages.filter((p) => p.id !== id);
  if (!pages.length || pages.length === state.index.pages.length) return;
  const gone = state.index.order.filter((f) => state.index.boards[f]!.page === id);
  const boards = new Map(state.boards);
  const placed = { ...state.index.boards };
  for (const f of gone) {
    boards.delete(f);
    delete placed[f];
  }
  apply("Delete page", { index: withIndex({ pages, boards: placed, order: state.index.order.filter((f) => !gone.includes(f)) }), boards, notes: state.notes.filter((n) => n.page !== id) }, { page: state.page === id ? pages[0]!.id : state.page, selection: null, editing: null });
  if (gone.length) toast(`Deleted the page and ${gone.length === 1 ? "its artboard" : `its ${gone.length} artboards`}. Undo brings them back.`);
  fitPage();
}

// ── Artboards ────────────────────────────────────────────────────────────

const entry = (file: string, doc: LoadedBoard["doc"]): LoadedBoard => ({ file, doc, source: "", diagnostics: [], broken: null });

/** A new artboard of a named size: at `at` (its top left), or beside the others on the page. */
export function addArtboard(sizeName = state.boardSize, at?: { x: number; y: number }) {
  if (state.index.order.length >= LIMITS.maxArtboards) {
    toast(`A design holds at most ${LIMITS.maxArtboards} artboards.`);
    return;
  }
  const size = BOARD_SIZES.find((b) => b.name === sizeName) ?? BOARD_SIZES[0]!;
  let n = state.index.order.length + 1;
  const titles = new Set(Object.values(state.index.boards).map((b) => b.title));
  while (titles.has(`Artboard ${n}`)) n++;
  const title = `Artboard ${n}`;
  const file = fileFor(title, state.index);
  const spot = at ? { x: Math.round(at.x), y: Math.round(at.y) } : placeBeside(state.index, state.page, size.width, size.height);
  const board: DesignBoard = { ...spot, w: size.width, h: size.height, title, page: state.page, ...(size.expand ? { expand: size.expand } : {}) };
  const doc = newArtboard({ ...size, title });
  const boards = new Map(state.boards).set(file, entry(file, { ...doc, root: sizeRoot(doc.root, size.width, size.height, size.expand === "fill") }));
  apply("Add artboard", { index: withIndex({ boards: { ...state.index.boards, [file]: board }, order: [...state.index.order, file] }), boards }, { selection: { kind: "boards", files: [file] }, editing: null, tool: "select", flyout: null });
  reveal({ ...spot, w: size.width, h: size.height });
}

export function renameArtboard(file: string, title: string) {
  const b = state.index.boards[file];
  const t = title.trim().slice(0, LIMITS.titleChars);
  setState({ editing: null });
  if (b && t && t !== b.title) apply("Rename artboard", { index: withIndex({ boards: { ...state.index.boards, [file]: { ...b, title: t } } }) });
}

/** Resize an artboard: its box on the canvas and its root element's width and height together. */
export function sizedBoard(s: Snap, file: string, box: Rect): Partial<Snap> {
  const b = s.index.boards[file];
  const loaded = s.boards.get(file);
  if (!b) return {};
  const next = { ...b, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) };
  const boards = loaded?.doc ? new Map(s.boards).set(file, { ...loaded, doc: { ...loaded.doc, root: sizeRoot(loaded.doc.root, next.w, next.h, b.expand === "fill") } }) : s.boards;
  return { index: { ...s.index, boards: { ...s.index.boards, [file]: next } }, boards };
}

export function movedBoards(s: Snap, files: readonly string[], dx: number, dy: number): Partial<Snap> {
  const boards = { ...s.index.boards };
  for (const f of files) if (boards[f]) boards[f] = { ...boards[f], x: Math.round(boards[f].x + dx), y: Math.round(boards[f].y + dy) };
  return { index: { ...s.index, boards } };
}

export function movedNotes(s: Snap, ids: readonly string[], dx: number, dy: number): Partial<Snap> {
  const set = new Set(ids);
  return { notes: s.notes.map((n) => (!set.has(n.id) ? n : n.kind === "sticky" ? { ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy) } : { ...n, points: n.points.map(([x, y]): [number, number] => [Math.round((x + dx) * 10) / 10, Math.round((y + dy) * 10) / 10]) })) };
}

/** Change one artboard's tree. `fn` gets its root and returns the new one (and may say what to select). An edit the format refuses is told to the user and changes nothing. */
export function editBoard(label: string, file: string, fn: (root: ElementNode, ctx: ValueContext) => ElementNode | { root: ElementNode; at: string }, extra: Partial<DesignState> = {}): string | null {
  const b = state.boards.get(file);
  if (!b?.doc) {
    toast("This artboard’s file has problems, so it can’t be edited here. Fix the file, or ask the AI to rewrite it.");
    return null;
  }
  try {
    const out = fn(b.doc.root, context());
    const root = "root" in out ? out.root : out;
    const at = "root" in out ? out.at : null;
    if (root === b.doc.root) return at ?? "";
    apply(label, { boards: new Map(state.boards).set(file, { ...b, doc: { ...b.doc, root }, diagnostics: [] }) }, { ...(at !== null ? { selection: { kind: "layers" as const, file, addresses: [at] } } : {}), ...extra });
    return at ?? "";
  } catch (e) {
    toast(e instanceof EditError ? `Not changed: ${e.message}.` : `Not changed: ${plainError(e)}`);
    return null;
  }
}

/** Change the element the panel is about (the selected layer, or the selected artboard's root). */
export function editTarget(label: string, fn: (root: ElementNode, address: string, ctx: ValueContext) => ElementNode) {
  const t = target();
  if (t) editBoard(label, t.file, (root, ctx) => fn(root, t.address, ctx));
}

export function deleteSelection() {
  const sel = state.selection;
  if (!sel) return;
  if (sel.kind === "layers") {
    editBoard(sel.addresses.length === 1 ? "Delete layer" : `Delete ${sel.addresses.length} layers`, sel.file, (root, ctx) => removeMany(root, sel.addresses, ctx), { selection: { kind: "boards", files: [sel.file] }, editing: null });
    return;
  }
  if (sel.kind === "notes") {
    const ids = new Set(sel.ids);
    apply(ids.size === 1 ? "Delete note" : `Delete ${ids.size} notes`, { notes: state.notes.filter((n) => !ids.has(n.id)) }, { selection: null, editing: null });
    return;
  }
  const boards = new Map(state.boards);
  const placed = { ...state.index.boards };
  for (const f of sel.files) {
    boards.delete(f);
    delete placed[f];
  }
  apply(sel.files.length === 1 ? "Delete artboard" : `Delete ${sel.files.length} artboards`, { index: withIndex({ boards: placed, order: state.index.order.filter((f) => !sel.files.includes(f)) }), boards }, { selection: null, editing: null });
}

/** Copies of artboards, each beside the one it was made from. Returns the new files. */
function copyBoards(files: readonly string[]): { next: Partial<Snap>; made: string[] } | null {
  if (state.index.order.length + files.length > LIMITS.maxArtboards) {
    toast(`A design holds at most ${LIMITS.maxArtboards} artboards.`);
    return null;
  }
  let index = state.index;
  const boards = new Map(state.boards);
  const made: string[] = [];
  for (const f of files) {
    const b = index.boards[f];
    const loaded = boards.get(f);
    if (!b || !loaded) continue;
    const title = `${b.title} copy`.slice(0, LIMITS.titleChars);
    const file = fileFor(title, index);
    const spot = placeBeside(index, state.page, b.w, b.h);
    index = { ...index, boards: { ...index.boards, [file]: { ...b, ...spot, title, page: state.page } }, order: [...index.order, file] };
    boards.set(file, { ...loaded, file });
    made.push(file);
  }
  return made.length ? { next: { index, boards }, made } : null;
}

export function duplicateSelection() {
  const sel = state.selection;
  if (!sel) return;
  if (sel.kind === "layers") {
    if (sel.addresses.length === 1) editBoard("Duplicate layer", sel.file, (root, ctx) => duplicate(root, sel.addresses[0]!, ctx));
    return;
  }
  if (sel.kind === "notes") {
    const copies = state.notes.filter((n) => sel.ids.includes(n.id)).map((n) => ({ ...movedNotes({ ...snap(), notes: [n] }, [n.id], 24, 24).notes![0]!, id: newId(n.kind === "sticky" ? "s" : "p") }));
    apply("Duplicate", { notes: [...state.notes, ...copies] }, { selection: { kind: "notes", ids: copies.map((c) => c.id) } });
    return;
  }
  const copy = copyBoards(sel.files);
  if (copy) apply("Duplicate", copy.next, { selection: { kind: "boards", files: copy.made } });
}

type Clip = { kind: "layers"; html: string[] } | { kind: "boards"; files: string[] } | null;
let clipboard: Clip = null;

export function copySelection() {
  const sel = state.selection;
  if (sel?.kind === "layers") {
    const root = state.boards.get(sel.file)?.doc?.root;
    const html = root ? sel.addresses.map((a) => getAt(root, a) as ElementNode | null).filter((el): el is ElementNode => !!el).map((el) => serializeBlock(el)) : [];
    clipboard = { kind: "layers", html };
    void navigator.clipboard.writeText(html.join("\n")).catch(() => {});
  } else if (sel?.kind === "boards") clipboard = { kind: "boards", files: sel.files };
}

export function cutSelection() {
  copySelection();
  deleteSelection();
}

export const canPaste = () => !!clipboard;

/** Paste layers into the selected container (or after the selected layer), or copies of artboards onto the page. */
export function paste() {
  if (!clipboard) return;
  if (clipboard.kind === "boards") {
    const copy = copyBoards(clipboard.files.filter((f) => f in state.index.boards));
    if (copy) apply("Paste", copy.next, { selection: { kind: "boards", files: copy.made } });
    return;
  }
  const t = target();
  if (!t) {
    toast("Select an artboard or a layer to paste into.");
    return;
  }
  const html = clipboard.html.join("");
  const into = holdsLayers(t.el) && t.el.tag === "div";
  editBoard("Paste", t.file, (root, ctx) => (into ? insertHtml(root, t.address, html, undefined, ctx) : insertHtml(root, t.address.includes(".") ? t.address.slice(0, t.address.lastIndexOf(".")) : "", html, Number(t.address.slice(t.address.lastIndexOf(".") + 1)) + 1, ctx)));
}

/** Moves the selected artboards or notes by (dx, dy). */
export function nudge(dx: number, dy: number) {
  const sel = state.selection;
  if (sel?.kind === "boards") apply("Move", movedBoards(snap(), sel.files, dx, dy));
  else if (sel?.kind === "notes") apply("Move", movedNotes(snap(), sel.ids, dx, dy));
}

/** Images become layers at the end of the selected container (or the selected artboard), copied into the design's assets. */
export async function insertImages(files: File[] | null) {
  const t = target();
  if (!t) {
    toast("Select an artboard to put the image on.");
    return;
  }
  let srcs: string[] = [];
  try {
    if (files) for (const f of files.filter((x) => x.type.startsWith("image/")).slice(0, 20)) srcs.push(await api().importAsset(f.name || "image.png", new Uint8Array(await f.arrayBuffer())));
    else srcs = await api().pickImages();
  } catch (e) {
    toast(`Couldn’t add that image: ${plainError(e)}`);
    return;
  }
  if (!srcs.length) return;
  const html = srcs.map((src) => `<img src="${src}" alt="" style="max-width:100%">`).join("");
  const parent = holdsLayers(t.el) && t.el.tag === "div" ? t.address : "";
  editBoard(srcs.length === 1 ? "Add image" : "Add images", t.file, (root, ctx) => insertHtml(root, parent, html, undefined, ctx));
}

// ── Notes ────────────────────────────────────────────────────────────────

export function addSticky(at: { x: number; y: number }) {
  if (state.notes.length >= LIMITS.notesItems) return;
  const note: NoteItem = { id: newId("s"), kind: "sticky", text: "", fill: "yellow", x: Math.round(at.x - 100), y: Math.round(at.y - 60), w: 200, h: 120, page: state.page };
  apply("Add sticky note", { notes: [...state.notes, note] }, { selection: { kind: "notes", ids: [note.id] }, editing: { kind: "note", id: note.id, fresh: true }, tool: "select", flyout: null });
}

export function addStroke(points: [number, number][]) {
  if (points.length < 2 || state.notes.length >= LIMITS.notesItems) return;
  const note: NoteItem = { id: newId("p"), kind: "stroke", points: points.slice(0, LIMITS.strokePoints), width: state.penWidth, ...(state.penDashed ? { dashed: true } : {}), page: state.page };
  apply("Draw", { notes: [...state.notes, note] });
}

export function updateNotes(label: string, ids: readonly string[], change: (n: NoteItem) => NoteItem) {
  const set = new Set(ids);
  apply(label, { notes: state.notes.map((n) => (set.has(n.id) ? change(n) : n)) });
}

/** Ends typing in a sticky: a new one left empty goes away, with the step that made it. */
export function finishNote(id: string, text: string, fresh?: boolean) {
  setState({ editing: null });
  const note = state.notes.find((n) => n.id === id);
  if (!note || note.kind !== "sticky") return;
  const top = state.undo[state.undo.length - 1];
  if (fresh && !text.trim() && top && top.after.notes === state.notes) {
    setState((s) => ({ ...top.before, undo: s.undo.slice(0, -1), selection: null }));
    save(top.after, top.before);
  } else if (note.text !== text) updateNotes("Edit note", [id], (n) => (n.kind === "sticky" ? { ...n, text: text.slice(0, 4000) } : n));
}

// ── The view ─────────────────────────────────────────────────────────────

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 4;
const STEPS = [0.05, 0.08, 0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];

let viewTimer = 0;
export function setView(view: View) {
  const next = { x: view.x, y: view.y, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom)) };
  setState({ view: next });
  const root = state.ref?.root;
  window.clearTimeout(viewTimer);
  if (root) viewTimer = window.setTimeout(() => writeView(root, next), 400);
}

/** Where each design was last looked at, on this computer. */
function readView(root: string): View | null {
  try {
    const v = JSON.parse(localStorage.getItem(`od.design.view.${root}`) ?? "null") as (View & { page?: string }) | null;
    if (v?.page && state.index.pages.some((p) => p.id === v.page)) setState({ page: v.page });
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) && v.zoom >= ZOOM_MIN && v.zoom <= ZOOM_MAX ? { x: v.x, y: v.y, zoom: v.zoom } : null;
  } catch {
    return null;
  }
}
function writeView(root: string, v: View) {
  try {
    localStorage.setItem(`od.design.view.${root}`, JSON.stringify({ ...v, page: state.page }));
  } catch {
    /* a convenience */
  }
}

/** Zoom to `zoom`, keeping the screen point `at` (default: the middle) still. */
export function zoomTo(zoom: number, at?: { x: number; y: number }) {
  const { view, viewport } = state;
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  const p = at ?? { x: viewport.width / 2, y: viewport.height / 2 };
  setView({ zoom: z, x: p.x - ((p.x - view.x) / view.zoom) * z, y: p.y - ((p.y - view.y) / view.zoom) * z });
}
export const zoomIn = () => zoomTo(STEPS.find((s) => s > state.view.zoom + 0.001) ?? ZOOM_MAX);
export const zoomOut = () => zoomTo([...STEPS].reverse().find((s) => s < state.view.zoom - 0.001) ?? ZOOM_MIN);

/** Room the pills at the top and the dock at the bottom take from the canvas. */
const TOP = 64;
const BOTTOM = 76;

/** Show `area` with a margin, at no more than 100%. */
export function fit(area: Rect | null) {
  const { viewport } = state;
  if (!area) {
    setView({ x: viewport.width / 2, y: viewport.height / 2, zoom: 1 });
    return;
  }
  const pad = 56;
  const roomH = Math.max(80, viewport.height - TOP - BOTTOM - pad);
  const zoom = Math.min(1, Math.max(ZOOM_MIN, Math.min((viewport.width - pad * 2) / Math.max(1, area.w), roomH / Math.max(1, area.h + 28))));
  setView({ zoom, x: viewport.width / 2 - (area.x + area.w / 2) * zoom, y: TOP + 28 + (roomH - (area.h + 28) * zoom) / 2 - area.y * zoom });
}
export const fitPage = () => fit(pageRect());

/** The box of whatever is selected. */
export function selectionRect(): Rect | null {
  const sel = state.selection;
  if (!sel) return null;
  if (sel.kind === "notes") return union(state.notes.filter((n) => sel.ids.includes(n.id)).map(noteBounds));
  return union((sel.kind === "boards" ? sel.files : [sel.file]).map((f) => boardRect(f)));
}
export const fitSelection = () => {
  const r = selectionRect();
  if (r) fit(r);
};

/** Brings a box into view, without zooming unless it doesn't fit. */
export function reveal(r: Rect) {
  const { view, viewport } = state;
  if (!viewport.width) return;
  const sx = r.x * view.zoom + view.x;
  const sy = r.y * view.zoom + view.y;
  if (sx >= 24 && sy >= TOP + 24 && sx + r.w * view.zoom <= viewport.width - 24 && sy + r.h * view.zoom <= viewport.height - BOTTOM) return;
  if (r.w * view.zoom > viewport.width - 112 || r.h * view.zoom > viewport.height - TOP - BOTTOM - 56) fit(r);
  else setView({ ...view, x: viewport.width / 2 - (r.x + r.w / 2) * view.zoom, y: (viewport.height + TOP - BOTTOM) / 2 - (r.y + r.h / 2) * view.zoom });
}

// ── Tools ────────────────────────────────────────────────────────────────

const FLYOUT: Partial<Record<Tool, Exclude<Flyout, null>>> = { artboard: "artboard", pen: "pen", shape: "shape" };

/** Choose a tool; the artboard, pencil and shape tools show their choices above the dock. */
export function setTool(tool: Tool) {
  setState((s) => ({ tool, flyout: FLYOUT[tool] ?? null, ...(tool !== "select" ? { editing: null } : {}), ...(tool === "pen" && s.selection?.kind !== "notes" ? { selection: null } : {}) }));
}

/** Show an artboard alone (the play view), or go back to the canvas. */
export function setFocus(file: string | null) {
  setState({ focus: file && file in state.index.boards && state.boards.get(file)?.doc ? file : null, editing: null, flyout: null });
}
