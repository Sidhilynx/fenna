// The editor's state and every change to the board. A change goes through
// `commit`: the items change here at once, the step goes on the undo stack,
// and canvas.json is written. Writes wait for each other, so the file always
// ends as the last change made. A canvas.json that can't be read is never
// written over.

import { useSyncExternalStore } from "react";
import {
  boundsOf,
  byId,
  canvasText,
  DEFAULT_SIZES,
  frameAt,
  isBox,
  isConnector,
  itemBounds,
  LIMITS,
  metaText,
  newBoardFiles,
  newId,
  parseCanvas,
  parseHistory,
  parseMeta,
  SHAPE_DEFAULTS,
  textItemHeight,
  type BoardItem,
  type BoardMeta,
  type BoardSettings,
  type BoardVersion,
  type BoxItem,
  type InkColor,
  type ItemKind,
  type Problem,
  type Rect,
  type ShapeKind,
  type StickerId,
} from "@opendeck/board";
import { readPref, tabs as shellTabs, toast, userName, writePref } from "@opendeck/shell";
import { api, plainError, setAssetBase, type BoardFolderRef } from "./api.ts";
import { comments } from "./comments.ts";

export type Tool = "select" | "hand" | "text" | "frame" | "sticky" | "pen" | "arrow" | "shape" | "comment";
export type Panel = "chat" | "comments" | "history" | null;
export type Flyout = "pen" | "shapes" | "stickers" | null;

/** Screen = board × zoom + (x, y), in the canvas's own pixels. */
export interface View {
  x: number;
  y: number;
  zoom: number;
}

export interface Editing {
  id: string;
  /** A table cell: row, column. */
  cell?: [number, number];
  /** The item was just made: leaving it empty removes it, and the step that made it. */
  fresh?: boolean;
}

export interface Timer {
  /** Seconds the timer was set to. */
  duration: number;
  /** When it ends (ms since the epoch); null while paused or stopped. */
  endsAt: number | null;
  /** Seconds left while paused. */
  left: number;
  running: boolean;
}

interface Step {
  label: string;
  before: BoardItem[];
  after: BoardItem[];
}

export interface BoardState {
  ref: BoardFolderRef | null;
  loading: boolean;
  meta: BoardMeta | null;
  items: BoardItem[];
  byId: Map<string, BoardItem>;
  /** Entries canvas.json holds that this app can't read; written back untouched. */
  kept: unknown[];
  problems: Problem[];
  /** Why canvas.json can't be read at all; nothing is saved while set. */
  broken: string | null;
  selection: string[];
  editing: Editing | null;
  /** The floating bar's link field is open. */
  linking: boolean;
  tool: Tool;
  /** The pen button's last mode: draw, or draw an arrow. */
  penMode: "pen" | "arrow";
  penColor: InkColor;
  shapeKind: ShapeKind;
  flyout: Flyout;
  view: View;
  /** The canvas's size on screen; 0 until it has been measured. */
  viewport: { width: number; height: number };
  /** Fit the board once the canvas knows its size. */
  fitPending: boolean;
  /** An item is being moved, resized or drawn: the floating bar steps aside. */
  dragging: boolean;
  panel: Panel;
  undo: Step[];
  redo: Step[];
  history: BoardVersion[];
  timer: Timer;
  asking: boolean;
  askRequest: { text: string; n: number } | null;
  chatDraft: string;
  agent: { name: string } | null;
}

let state: BoardState = {
  ref: null,
  loading: true,
  meta: null,
  items: [],
  byId: new Map(),
  kept: [],
  problems: [],
  broken: null,
  selection: [],
  editing: null,
  linking: false,
  tool: "select",
  penMode: "pen",
  penColor: "orange",
  shapeKind: "rect",
  flyout: null,
  view: { x: 0, y: 0, zoom: 1 },
  viewport: { width: 0, height: 0 },
  fitPending: false,
  dragging: false,
  panel: readPref("board.chat", false) ? "chat" : null,
  undo: [],
  redo: [],
  history: [],
  timer: { duration: 300, endsAt: null, left: 300, running: false },
  asking: false,
  askRequest: null,
  chatDraft: "",
  agent: null,
};

const listeners = new Set<() => void>();
export const getState = () => state;
export function setState(patch: Partial<BoardState> | ((s: BoardState) => Partial<BoardState>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  for (const l of listeners) l();
}
export function useBoard<T>(select: (s: BoardState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}

const withItems = (items: BoardItem[]): Pick<BoardState, "items" | "byId"> => ({ items, byId: byId(items) });

// ── Loading ──────────────────────────────────────────────────────────────

/** canvas.json as last written or read here: a change event with the same text is our own. */
let lastCanvas: string | null = null;
let lastMeta: string | null = null;
let loadedRoot: string | null = null;

async function readHistory(): Promise<BoardVersion[]> {
  return parseHistory(await api().read("history.json").catch(() => null));
}

export async function reload() {
  const ref = state.ref;
  if (!ref) return;
  const [boardText, canvasSource] = await Promise.all([api().read("board.json"), api().read("canvas.json")]);
  if (state.ref?.root !== ref.root) return;
  const external = loadedRoot === ref.root && state.meta !== null && (canvasSource !== lastCanvas || boardText !== lastMeta);
  if (loadedRoot === ref.root && state.meta && canvasSource === lastCanvas && boardText === lastMeta) return;
  const { meta, problems: metaProblems } = parseMeta(boardText, ref.name);
  const c = parseCanvas(canvasSource);
  lastCanvas = canvasSource;
  lastMeta = boardText;
  loadedRoot = ref.root;
  const items = c.broken ? [] : c.items;
  const ids = new Set(items.map((it) => it.id));
  setState((s) => ({
    meta,
    ...withItems(items),
    kept: c.kept,
    problems: [...metaProblems.filter((p) => boardText !== null || p.where !== "board.json"), ...c.problems],
    broken: c.broken,
    selection: s.selection.filter((id) => ids.has(id)),
    editing: s.editing && ids.has(s.editing.id) ? s.editing : null,
    // Steps made before someone else changed the board would undo their work too.
    ...(external ? { undo: [], redo: [] } : {}),
  }));
  if (!state.history.length) {
    const hist = await readHistory();
    if (hist.length) setState({ history: hist });
    else if (!c.broken) void snapshot("Opened", { force: true });
  } else if (external && !c.broken) {
    void snapshot("Edited", { author: state.agent ? agentName(state.agent.name) : "Outside the app" });
  }
}

const agentName = (kind: string) => ({ claude: "Claude", codex: "Codex", antigravity: "Antigravity" })[kind] ?? kind;

export async function boot() {
  const ref = await api().current().catch(() => null);
  if (ref) await switchTo(ref);
  setState({ loading: false });
  api().onChanged((paths) => {
    if (paths.includes("canvas.json") || paths.includes("board.json")) void reload();
  });
}

async function switchTo(ref: BoardFolderRef | null) {
  if (!ref) return;
  setAssetBase(ref.asset);
  loadedRoot = null;
  lastCanvas = null;
  lastMeta = null;
  setState({ ref, meta: null, ...withItems([]), selection: [], editing: null, undo: [], redo: [], history: [], broken: null, problems: [], kept: [] });
  await reload();
  const saved = readView(ref.root);
  if (saved) setState({ view: saved });
  else if (state.viewport.width) fitBoard();
  else setState({ fitPending: true });
}

export async function chooseBoard() {
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
    toast(`Couldn’t open that board: ${plainError(e)}`);
  }
}

export function openRecentInTab(root: string) {
  api()
    .openInTab(root)
    .catch((e) => toast(`Couldn’t open that board: ${plainError(e)}`));
}

export async function createBoard(title: string, draft = "") {
  const files = newBoardFiles(title || "Untitled board");
  try {
    await switchTo(await api().create(parseMeta(files["board.json"]!, "").meta.title, files));
  } catch (e) {
    toast(plainError(e));
    return;
  }
  if (draft.trim() && state.meta) {
    writePref("board.chat", true);
    setState({ panel: "chat", chatDraft: draft.trim() });
  }
}

/** A copy of the board in a new folder, opened in a new tab. */
export async function duplicateBoard() {
  if (!state.meta) return;
  const title = `${state.meta.title} (copy)`.slice(0, LIMITS.titleChars);
  try {
    const made = await api().create(title, { "board.json": metaText({ ...state.meta, title }), "canvas.json": canvasText(state.items, state.kept) });
    if (made) await api().openInTab(made.root);
  } catch (e) {
    toast(`Couldn’t duplicate: ${plainError(e)}`);
  }
}

// ── Saving, undo, versions ───────────────────────────────────────────────

let saving: Promise<unknown> = Promise.resolve();

function save() {
  const text = canvasText(state.items, state.kept);
  if (text === lastCanvas) return;
  if (text.length > 64 * 1024 * 1024) {
    toast("This board is too big to save. Remove some items or images.");
    return;
  }
  lastCanvas = text;
  const run = saving.then(() => api().write("canvas.json", text));
  saving = run.catch(() => {});
  run.then(
    () => void snapshot("Edited"),
    (e) => {
      toast(`Couldn’t save: ${plainError(e)}`);
      lastCanvas = null;
      void reload();
    },
  );
}

function saveMeta(meta: BoardMeta) {
  const text = metaText(meta);
  lastMeta = text;
  setState({ meta });
  const run = saving.then(() => api().write("board.json", text));
  saving = run.catch(() => {});
  run.catch((e) => toast(`Couldn’t save: ${plainError(e)}`));
}

const UNDO_STEPS = 200;

/** Make a change: items now `next`, one undo step, saved. `before` is the board before a drag began. */
export function commit(label: string, next: BoardItem[], extra: Partial<BoardState> = {}, before: BoardItem[] = state.items) {
  if (state.broken) {
    toast("This board’s canvas.json can’t be read, so nothing is saved. Fix the file or restore a version.");
    setState({ ...withItems(before) });
    return;
  }
  if (next === before) {
    setState(extra);
    return;
  }
  const settled = settleFrames(next);
  setState((s) => ({ ...withItems(settled), undo: [...s.undo, { label, before, after: settled }].slice(-UNDO_STEPS), redo: [], ...extra }));
  save();
}

/** Show items mid-drag, without saving. */
export function preview(next: BoardItem[]) {
  setState(withItems(next));
}

function replay(back: boolean) {
  const from = back ? state.undo : state.redo;
  const step = from[from.length - 1];
  if (!step) return;
  const items = back ? step.before : step.after;
  const ids = new Set(items.map((it) => it.id));
  setState((s) => ({
    ...withItems(items),
    undo: back ? s.undo.slice(0, -1) : [...s.undo, step],
    redo: back ? [...s.redo, step] : s.redo.slice(0, -1),
    editing: null,
    selection: s.selection.filter((id) => ids.has(id)),
  }));
  save();
}
export const undo = () => replay(true);
export const redo = () => replay(false);

let lastSnapshotAt = 0;
const SNAPSHOT_EVERY = 180_000;
const HISTORY_MAX = 40;
const HISTORY_CHARS = 12_000_000;

async function snapshot(label: string, opts: { force?: boolean; author?: string } = {}) {
  const now = Date.now();
  if (!opts.force && now - lastSnapshotAt < SNAPSHOT_EVERY && state.history.length) return;
  if (!state.meta || state.broken) return;
  lastSnapshotAt = now;
  const author = opts.author ?? ((await userName().catch(() => "")) || "You");
  const v: BoardVersion = { id: crypto.randomUUID().slice(0, 10), at: now, author, label, title: state.meta.title, items: state.items };
  let next = [v, ...state.history].slice(0, HISTORY_MAX);
  let text = JSON.stringify(next);
  while (text.length > HISTORY_CHARS && next.length > 1) {
    next = next.slice(0, -1);
    text = JSON.stringify(next);
  }
  // A board too big for even one version keeps none; undo still works.
  if (text.length > HISTORY_CHARS) return;
  setState({ history: next });
  await api()
    .write("history.json", text)
    .catch(() => {});
}

export function restoreVersion(v: BoardVersion) {
  const ids = new Set(v.items.map((it) => it.id));
  commit("Restore a version", v.items, { selection: state.selection.filter((id) => ids.has(id)), editing: null });
  if (state.meta && v.title !== state.meta.title) saveMeta({ ...state.meta, title: v.title });
  void snapshot("Restored a version", { force: true });
  toast("Restored that version. Undo brings back what was there.");
}

// ── The board's own settings ─────────────────────────────────────────────

export function renameBoard(title: string) {
  const t = title.trim().slice(0, LIMITS.titleChars);
  if (!t || !state.meta || t === state.meta.title) return;
  saveMeta({ ...state.meta, title: t });
}

export function toggleSetting(key: keyof BoardSettings) {
  if (!state.meta) return;
  saveMeta({ ...state.meta, settings: { ...state.meta.settings, [key]: !state.meta.settings[key] } });
}

// ── Panels and the AI ────────────────────────────────────────────────────

export function setPanel(panel: Panel) {
  writePref("board.chat", panel === "chat");
  setState({ panel });
}
export const togglePanel = (panel: Exclude<Panel, null>) => setPanel(state.panel === panel ? null : panel);

export function setAgent(agent: { name: string } | null) {
  setState({ agent });
  shellTabs.activity({ working: !!agent });
}

// ── Selection ────────────────────────────────────────────────────────────

/** `ids` and everything grouped with them. */
export function withGroups(ids: readonly string[], items = state.items): string[] {
  const groups = new Set<string>();
  for (const id of ids) {
    const g = state.byId.get(id)?.group;
    if (g) groups.add(g);
  }
  if (!groups.size) return [...ids];
  const out = new Set(ids);
  for (const it of items) if (it.group && groups.has(it.group)) out.add(it.id);
  return [...out];
}

export function select(ids: readonly string[]) {
  setState({ selection: withGroups(ids), linking: false, ...(state.editing && !ids.includes(state.editing.id) ? { editing: null } : {}) });
}
export const clearSelection = () => setState({ selection: [], editing: null, linking: false });
export const selectAll = () => setState({ selection: state.items.map((it) => it.id), editing: null, linking: false });
export const selectedItems = (s = state) => s.selection.map((id) => s.byId.get(id)).filter((it): it is BoardItem => !!it);

// ── Item changes ─────────────────────────────────────────────────────────

/** Frames sit behind what they hold: a frame after one of its items moves back in front of it. */
function settleFrames(items: BoardItem[]): BoardItem[] {
  const firstChild = new Map<string, number>();
  items.forEach((it, i) => {
    if (it.frame && !firstChild.has(it.frame)) firstChild.set(it.frame, i);
  });
  if (!firstChild.size) return items;
  let out = items;
  for (const [frameId, childAt] of firstChild) {
    const at = out.findIndex((it) => it.id === frameId);
    if (at <= childAt || at < 0) continue;
    const frame = out[at]!;
    out = out.filter((_, i) => i !== at);
    out.splice(out.findIndex((it) => it.frame === frameId), 0, frame);
  }
  return out;
}

/** Put each moved item in the frame under it, or out of any. */
export function refile(items: BoardItem[], moved: ReadonlySet<string>): BoardItem[] {
  const all = byId(items);
  return items.map((it) => {
    if (!moved.has(it.id) || it.kind === "frame" || it.locked) return it;
    const b = itemBounds(it, all);
    if (!b) return it;
    const f = frameAt(b, items);
    const frame = f?.id;
    if (frame === it.frame) return it;
    const { frame: _, ...rest } = it;
    return (frame ? { ...rest, frame } : rest) as BoardItem;
  });
}

/** Change items by id. */
export function updateItems(label: string, ids: readonly string[], change: (it: BoardItem) => BoardItem) {
  const set = new Set(ids);
  let changed = false;
  const next = state.items.map((it) => {
    if (!set.has(it.id)) return it;
    const n = change(it);
    if (n !== it) changed = true;
    return n;
  });
  if (changed) commit(label, next);
}

/** Set fields on every selected item that has them; `undefined` removes a field. */
export function styleSelection(label: string, patch: Record<string, unknown>, kinds?: readonly ItemKind[]) {
  updateItems(label, state.selection, (it) => {
    if (it.locked || (kinds && !kinds.includes(it.kind))) return it;
    const n: Record<string, unknown> = { ...it };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete n[k];
      else n[k] = v;
    }
    if (n.kind === "text" && ("size" in patch || "bold" in patch || "list" in patch)) n.height = textItemHeight(n.text as string, n, n.width as number);
    return n as unknown as BoardItem;
  });
}

export function addItems(label: string, add: BoardItem[], opts: { edit?: boolean } = {}) {
  if (!add.length) return;
  if (state.items.length + add.length > LIMITS.items) {
    toast(`A board holds at most ${LIMITS.items.toLocaleString()} items.`);
    return;
  }
  const first = add[0]!;
  commit(label, refile([...state.items, ...add], new Set(add.map((it) => it.id))), {
    selection: add.map((it) => it.id),
    editing: opts.edit ? { id: first.id, fresh: true } : null,
    linking: false,
  });
}

/** A new item of `kind` centred on `at` (board units). */
export function makeItem(kind: Exclude<ItemKind, "connector" | "drawing" | "image">, at: { x: number; y: number }, extra: Partial<BoxItem> = {}): BoardItem {
  const id = newId(kind, state.byId);
  const size = kind === "shape" ? SHAPE_DEFAULTS[(extra as { shape?: ShapeKind }).shape ?? state.shapeKind] : DEFAULT_SIZES[kind];
  const width = extra.width ?? size.width;
  const height = extra.height ?? size.height;
  const box = { id, x: Math.round(at.x - width / 2), y: Math.round(at.y - height / 2), width, height };
  switch (kind) {
    case "sticky":
      return { ...box, kind, text: "", color: "yellow", ...extra } as BoardItem;
    case "text":
      return { ...box, kind, text: "", ...extra, y: Math.round(at.y - 11), height: textItemHeight("", {}, width) } as BoardItem;
    case "shape":
      return { ...box, kind, shape: state.shapeKind, ...extra } as BoardItem;
    case "frame":
      return { ...box, kind, title: `Frame ${state.items.filter((it) => it.kind === "frame").length + 1}`, ...extra } as BoardItem;
    case "table":
      return { ...box, kind, cells: [["", "", ""], ["", "", ""]], ...extra } as BoardItem;
    case "sticker":
      return { ...box, kind, sticker: "star" as StickerId, ...extra } as BoardItem;
  }
}

/** The board point at the middle of the screen. */
export function viewCenter(): { x: number; y: number } {
  const { view, viewport } = state;
  return { x: (viewport.width / 2 - view.x) / view.zoom, y: (viewport.height / 2 - view.y) / view.zoom };
}

/** Ends a text edit: an empty new text item goes away, with the step that made it. */
export function finishEditing(text?: string) {
  const ed = state.editing;
  if (!ed) return;
  const it = state.byId.get(ed.id);
  setState({ editing: null });
  if (!it || text === undefined) return;
  if (ed.cell && it.kind === "table") {
    const [r, c] = ed.cell;
    if (it.cells[r]?.[c] === text) return;
    const cells = it.cells.map((row, i) => (i === r ? row.map((v, j) => (j === c ? text : v)) : row));
    updateItems("Edit table", [it.id], () => ({ ...it, cells }));
    return;
  }
  if (it.kind === "text" && !text.trim()) {
    const top = state.undo[state.undo.length - 1];
    if (ed.fresh && top && top.after === state.items) {
      setState((s) => ({ ...withItems(top.before), undo: s.undo.slice(0, -1), selection: [] }));
      save();
    } else commit("Delete text", state.items.filter((x) => x.id !== it.id), { selection: [] });
    return;
  }
  const field = it.kind === "frame" ? "title" : it.kind === "connector" ? "label" : "text";
  const current = (it as unknown as Record<string, unknown>)[field] ?? "";
  if (current === text) return;
  updateItems(it.kind === "frame" ? "Rename frame" : "Edit text", [it.id], (x) => {
    if (x.kind === "connector") {
      const { label: _, ...rest } = x;
      return text.trim() ? { ...rest, label: text.trim().slice(0, 200) } : rest;
    }
    if (x.kind === "frame") return { ...x, title: text.trim().slice(0, LIMITS.titleChars) };
    if (x.kind === "text") return { ...x, text, height: textItemHeight(text, x, x.width) };
    return { ...x, text } as BoardItem;
  });
}

/** Ids to delete with `ids`: what their frames hold, and connectors left with an end on nothing. */
function deletion(ids: readonly string[]): Set<string> {
  const gone = new Set(ids.filter((id) => !state.byId.get(id)?.locked));
  for (const it of state.items) if (it.frame && gone.has(it.frame) && !it.locked) gone.add(it.id);
  for (const it of state.items) if (isConnector(it) && (("item" in it.from && gone.has(it.from.item)) || ("item" in it.to && gone.has(it.to.item)))) gone.add(it.id);
  return gone;
}

export function deleteSelection() {
  const gone = deletion(state.selection);
  if (!gone.size) return;
  commit(gone.size === 1 ? "Delete" : `Delete ${gone.size} items`, state.items.filter((it) => !gone.has(it.id)), { selection: [], editing: null });
}

/** Copies of `source` with new ids: frames bring what they hold; connectors between copies join the copies. */
function cloneItems(source: BoardItem[], dx: number, dy: number): BoardItem[] {
  const ids = new Map<string, string>();
  const taken = new Set(state.byId.keys());
  for (const it of source) {
    const id = newId(it.kind, taken);
    taken.add(id);
    ids.set(it.id, id);
  }
  const groups = new Map<string, string>();
  return source.map((it) => {
    const copy = structuredClone(it) as BoardItem & Record<string, unknown>;
    copy.id = ids.get(it.id)!;
    if (it.group) {
      if (!groups.has(it.group)) groups.set(it.group, `g-${Math.random().toString(36).slice(2, 8)}`);
      copy.group = groups.get(it.group);
    }
    if (it.frame) {
      if (ids.has(it.frame)) copy.frame = ids.get(it.frame);
      else delete copy.frame;
    }
    if (isBox(copy)) {
      copy.x += dx;
      copy.y += dy;
    } else if (isConnector(copy)) {
      for (const k of ["from", "to"] as const) {
        const e = copy[k];
        if ("item" in e) copy[k] = ids.has(e.item) ? { ...e, item: ids.get(e.item)! } : { x: 0, y: 0 };
        else copy[k] = { x: e.x + dx, y: e.y + dy };
      }
      // An end left on an item that wasn't copied stays where the original's end is.
      for (const k of ["from", "to"] as const) {
        const orig = it as typeof copy;
        const e = orig[k];
        if ("item" in e && !ids.has(e.item)) {
          const target = state.byId.get(e.item);
          const b = target && isBox(target) ? target : null;
          copy[k] = b ? { x: b.x + b.width / 2 + dx, y: b.y + b.height / 2 + dy } : { x: dx, y: dy };
        }
      }
    }
    return copy as BoardItem;
  });
}

/** The selection with what its frames hold, in board order. */
function selectionWithContents(): BoardItem[] {
  const ids = new Set(state.selection);
  for (const it of state.items) if (it.frame && ids.has(it.frame)) ids.add(it.id);
  return state.items.filter((it) => ids.has(it.id));
}

export function duplicateSelection() {
  const src = selectionWithContents();
  if (!src.length) return;
  const copies = cloneItems(src, 24, 24);
  const roots = new Set(state.selection.map((id) => copies[src.findIndex((s) => s.id === id)]?.id).filter(Boolean) as string[]);
  commit("Duplicate", [...state.items, ...copies], { selection: [...roots] });
}

const CLIP = "openboard/items:";
let clipboard: BoardItem[] = [];

export function copySelection() {
  clipboard = selectionWithContents();
  if (clipboard.length) void navigator.clipboard.writeText(CLIP + JSON.stringify(clipboard)).catch(() => {});
}

export function cutSelection() {
  copySelection();
  deleteSelection();
}

export const canPaste = () => clipboard.length > 0;

/** Paste items (from this board or another), text, or an image, around the middle of the screen. */
export async function pasteFrom(data: { text?: string; files?: File[] } | null) {
  if (data?.files?.length) {
    await insertImages(data.files);
    return;
  }
  const text = data?.text ?? "";
  let items: BoardItem[] = clipboard;
  if (text.startsWith(CLIP)) {
    try {
      const parsed = JSON.parse(text.slice(CLIP.length));
      if (Array.isArray(parsed)) items = parsed as BoardItem[];
    } catch {
      items = clipboard;
    }
  } else if (text.trim()) {
    const at = viewCenter();
    const t = makeItem("text", at, { text: text.slice(0, LIMITS.textChars), width: 320 } as Partial<BoxItem>);
    addItems("Paste", [{ ...t, height: textItemHeight(text, {}, 320) } as BoardItem]);
    return;
  }
  if (!items.length) return;
  const b = boundsOf(items, byId([...state.items, ...items]));
  const c = viewCenter();
  const dx = b ? Math.round(c.x - (b.x + b.width / 2)) : 24;
  const dy = b ? Math.round(c.y - (b.y + b.height / 2)) : 24;
  const copies = cloneItems(items, dx, dy);
  const roots = copies.filter((it) => !it.frame || !copies.some((x) => x.id === it.frame)).map((it) => it.id);
  commit("Paste", refile([...state.items, ...copies], new Set(roots)), { selection: roots });
}

export async function pasteFromClipboard() {
  const text = await navigator.clipboard.readText().catch(() => "");
  await pasteFrom({ text });
}

/** Images become items in the middle of the screen, copied into the board's assets. */
export async function insertImages(files: File[] | null, at?: { x: number; y: number }) {
  let srcs: string[] = [];
  try {
    if (files) {
      for (const f of files.filter((x) => x.type.startsWith("image/")).slice(0, 20)) srcs.push(await api().importAsset(f.name || "image.png", new Uint8Array(await f.arrayBuffer())));
    } else srcs = await api().pickImages();
  } catch (e) {
    toast(`Couldn’t add that image: ${plainError(e)}`);
    return;
  }
  if (!srcs.length) return;
  const center = at ?? viewCenter();
  const made: BoardItem[] = [];
  for (const [i, src] of srcs.entries()) {
    const size = await imageSize(src);
    const scale = Math.min(1, 480 / Math.max(size.width, size.height));
    const width = Math.max(LIMITS.minSize, Math.round(size.width * scale));
    const height = Math.max(LIMITS.minSize, Math.round(size.height * scale));
    made.push({ id: newId("image", new Set([...state.byId.keys(), ...made.map((m) => m.id)])), kind: "image", src, x: Math.round(center.x - width / 2 + i * 32), y: Math.round(center.y - height / 2 + i * 32), width, height });
  }
  addItems(made.length === 1 ? "Add image" : "Add images", made);
}

function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 320, height: img.naturalHeight || 240 });
    img.onerror = () => resolve({ width: 320, height: 240 });
    img.src = `${state.ref?.asset ?? ""}${src}`;
  });
}

// ── Arranging ────────────────────────────────────────────────────────────

/** Selected items and what their frames hold, as an id set. */
function moving(): Set<string> {
  return new Set(selectionWithContents().map((it) => it.id));
}

export function canReorder(front: boolean): boolean {
  const ids = moving();
  if (!ids.size) return false;
  const idx = state.items.map((it, i) => (ids.has(it.id) ? i : -1)).filter((i) => i >= 0);
  if (front) return idx[idx.length - 1]! - idx[0]! + 1 !== idx.length || idx[idx.length - 1] !== state.items.length - 1;
  return idx[0] !== 0 || idx[idx.length - 1]! + 1 !== idx.length;
}

export function reorder(front: boolean) {
  const ids = moving();
  if (!ids.size || !canReorder(front)) return;
  const picked = state.items.filter((it) => ids.has(it.id));
  const rest = state.items.filter((it) => !ids.has(it.id));
  commit(front ? "Bring to front" : "Send to back", front ? [...rest, ...picked] : [...picked, ...rest]);
}

export function toggleLock() {
  const sel = selectedItems();
  if (!sel.length) return;
  const lock = !sel.every((it) => it.locked);
  updateItems(lock ? "Lock" : "Unlock", state.selection, (it) => {
    if (lock) return { ...it, locked: true };
    const { locked: _, ...rest } = it;
    return rest as BoardItem;
  });
}

export const canGroup = () => state.selection.length > 1 && !selectedItems().every((it, _, a) => it.group && it.group === a[0]!.group);
export const canUngroup = () => selectedItems().some((it) => it.group);

export function group() {
  if (!canGroup()) return;
  const g = `g-${Math.random().toString(36).slice(2, 8)}`;
  updateItems("Group", state.selection, (it) => ({ ...it, group: g }));
}

export function ungroup() {
  if (!canUngroup()) return;
  updateItems("Ungroup", state.selection, (it) => {
    const { group: _, ...rest } = it;
    return rest as BoardItem;
  });
}

const tidyable = () => selectedItems().filter((it): it is BoxItem => isBox(it) && !it.locked && it.kind !== "frame");
export const canTidy = () => tidyable().length > 1;

/** Lays the selection out in a grid, reading order kept, from its top-left corner. */
export function tidyUp() {
  const list = tidyable();
  if (list.length < 2) return;
  const rows: BoxItem[][] = [];
  for (const it of [...list].sort((a, b) => a.y - b.y)) {
    const row = rows.find((r) => Math.abs(r[0]!.y - it.y) < Math.min(r[0]!.height, it.height) / 2);
    if (row) row.push(it);
    else rows.push([it]);
  }
  const ordered = rows.flatMap((r) => r.sort((a, b) => a.x - b.x));
  const cols = Math.max(1, Math.min(ordered.length, Math.round(Math.sqrt(ordered.length * 1.6))));
  const gap = 24;
  const cw = Math.max(...ordered.map((it) => it.width));
  const rh = Math.max(...ordered.map((it) => it.height));
  const x0 = Math.min(...ordered.map((it) => it.x));
  const y0 = Math.min(...ordered.map((it) => it.y));
  const pos = new Map(ordered.map((it, i) => [it.id, { x: x0 + (i % cols) * (cw + gap), y: y0 + Math.floor(i / cols) * (rh + gap) }]));
  const moved = state.items.map((it) => {
    const p = pos.get(it.id);
    return p && isBox(it) ? ({ ...it, ...p } as BoardItem) : it;
  });
  commit("Tidy up", refile(moved, new Set(pos.keys())));
}

/** Moves the selection by (dx, dy), with what its frames hold. */
export function nudge(dx: number, dy: number) {
  const ids = moving();
  const next = state.items.map((it) => (ids.has(it.id) && !it.locked ? moveItem(it, dx, dy) : it));
  commit("Move", refile(next, new Set(state.selection)));
}

/** An item moved by (dx, dy); a connector's free ends move, its attached ends stay on their items. */
export function moveItem(it: BoardItem, dx: number, dy: number): BoardItem {
  if (isBox(it)) return { ...it, x: Math.round(it.x + dx), y: Math.round(it.y + dy) };
  const mv = (e: typeof it.from) => ("item" in e ? e : { x: Math.round(e.x + dx), y: Math.round(e.y + dy) });
  return { ...it, from: mv(it.from), to: mv(it.to) };
}

// ── The view ─────────────────────────────────────────────────────────────

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 4;
const STEPS = [0.05, 0.08, 0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];

let viewTimer = 0;
export function setView(view: View) {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom));
  const next = { x: view.x, y: view.y, zoom };
  setState({ view: next });
  const root = state.ref?.root;
  window.clearTimeout(viewTimer);
  if (root) viewTimer = window.setTimeout(() => writeView(root, next), 400);
}

/** Where each board was last looked at, on this computer. */
function readView(root: string): View | null {
  try {
    const v = JSON.parse(localStorage.getItem(`od.board.view.${root}`) ?? "null") as View | null;
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) && v.zoom >= ZOOM_MIN && v.zoom <= ZOOM_MAX ? v : null;
  } catch {
    return null;
  }
}
function writeView(root: string, v: View) {
  try {
    localStorage.setItem(`od.board.view.${root}`, JSON.stringify(v));
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

/** Show `area` (default: everything) with a margin, at no more than 100%. */
export function fitBoard(area?: Rect | null) {
  const b = area ?? boundsOf(state.items, state.byId);
  const { viewport } = state;
  if (!b) {
    setView({ x: viewport.width / 2, y: viewport.height / 2, zoom: 1 });
    return;
  }
  const pad = 80;
  const zoom = Math.min(1, Math.max(ZOOM_MIN, Math.min((viewport.width - pad * 2) / Math.max(1, b.width), (viewport.height - pad * 2 - 60) / Math.max(1, b.height))));
  setView({ zoom, x: viewport.width / 2 - (b.x + b.width / 2) * zoom, y: (viewport.height - 60) / 2 - (b.y + b.height / 2) * zoom });
}

/** Brings an item into view, without zooming unless it doesn't fit. */
export function reveal(id: string) {
  const it = state.byId.get(id);
  const b = it && itemBounds(it, state.byId);
  if (!b) return;
  const { view, viewport } = state;
  const sx = b.x * view.zoom + view.x;
  const sy = b.y * view.zoom + view.y;
  if (sx >= 40 && sy >= 40 && sx + b.width * view.zoom <= viewport.width - 40 && sy + b.height * view.zoom <= viewport.height - 100) return;
  if (b.width * view.zoom > viewport.width - 80 || b.height * view.zoom > viewport.height - 160) fitBoard(b);
  else setView({ ...view, x: viewport.width / 2 - (b.x + b.width / 2) * view.zoom, y: (viewport.height - 60) / 2 - (b.y + b.height / 2) * view.zoom });
}

// ── Tools ────────────────────────────────────────────────────────────────

export function setTool(tool: Tool) {
  setState({ tool, flyout: null, ...(tool === "pen" || tool === "arrow" ? { penMode: tool } : {}), ...(tool !== "select" ? { editing: null, linking: false } : {}) });
}

export function toggleFlyout(f: Exclude<Flyout, null>) {
  setState((s) => ({ flyout: s.flyout === f ? null : f }));
}

// ── Comments ─────────────────────────────────────────────────────────────

/** Start a comment on the selection (or the middle of the screen). */
export function commentOnSelection() {
  const it = selectedItems()[0];
  const b = it && itemBounds(it, state.byId);
  const c = viewCenter();
  comments.draft(it && b ? { item: it.id, x: Math.round(b.x + b.width), y: Math.round(b.y) } : { x: Math.round(c.x), y: Math.round(c.y) });
  setState({ panel: "comments", tool: "select" });
}

// ── Timer ────────────────────────────────────────────────────────────────

export function startTimer(seconds: number) {
  setState({ timer: { duration: seconds, endsAt: Date.now() + seconds * 1000, left: seconds, running: true } });
}
export function pauseTimer() {
  const t = state.timer;
  if (!t.running || t.endsAt === null) return;
  setState({ timer: { ...t, endsAt: null, left: Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)) } });
}
export function resumeTimer() {
  const t = state.timer;
  if (!t.running || t.endsAt !== null) return;
  setState({ timer: { ...t, endsAt: Date.now() + t.left * 1000 } });
}
export function addTime(seconds: number) {
  const t = state.timer;
  if (!t.running) return;
  setState({ timer: t.endsAt !== null ? { ...t, endsAt: t.endsAt + seconds * 1000 } : { ...t, left: t.left + seconds } });
}
export function stopTimer() {
  setState({ timer: { ...state.timer, endsAt: null, left: state.timer.duration, running: false } });
}
