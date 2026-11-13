// The editor's state and every action that changes a deck.
//
// One store, read with useEditor(selector). Components never write files
// themselves: they call an action here, which applies an edit operation from
// @opendeck/format, writes the result, updates the screen at once, and
// records an undo step. The file watcher's reload then confirms what we
// already show.
//
// Undo is per file and safe against other writers: undoing a step first
// checks that the file still holds what that step wrote. If the AI (or a
// person in another editor) changed it since, the step is not applied and the
// user is told, instead of their work or the AI's being silently overwritten.

import { readPref, tabs, toast, writePref } from "@opendeck/shell";
import { useSyncExternalStore } from "react";
import {
  type DeckIndex,
  type ElementNode,
  type LoadedDeck,
  type LoadedSlide,
  type ValueContext,
  EditError,
  checkIndex,
  layouts,
  loadDeck,
  moveSlides as moveInIndex,
  newDeckFiles,
  newSlideId,
  parseSlide,
  placeSlide,
  serializeSlide,
  setAttr,
  unplaceSlides,
  valueContext,
} from "@opendeck/format";
import { type DeckRef, api, setAssetBase } from "../api.ts";
import { SLIDE_FILE, keepUnchanged, remoteChange, withSlideFiles } from "./reloads.ts";

export type View = "edit" | "grid";

/** The latest change to a slide that came from outside the editor (the AI, another program). */
export interface RemoteChange {
  slideId: string;
  /** The slide before the change; null when the slide is new. */
  prev: ElementNode | null;
  at: number;
}

/** The assistant while it works: its name, shown on its cursor. */
export interface AgentPresence {
  name: string;
}

export interface FileChange {
  rel: string;
  /** null = the file didn't exist */
  before: string | null;
  /** null = the file is deleted */
  after: string | null;
}

interface Step {
  label: string;
  changes: FileChange[];
  slideId: string | null;
  selection: string[];
}

export interface EditorState {
  ref: DeckRef | null;
  deck: LoadedDeck | null;
  loading: boolean;
  current: number;
  /** Addresses of selected elements on the current slide. */
  selection: string[];
  /** Address of the text element being typed into, if any. */
  editing: string | null;
  view: View;
  /** "fit" or a scale where 1 = 100% (1920px wide). */
  zoom: "fit" | number;
  /** The scale "fit" means right now (set by the canvas from its size). */
  fitScale: number;
  inspector: boolean;
  /** The slide strip beside the stage (one-slide view). */
  thumbnails: boolean;
  /** Speaker notes under the slide. */
  notes: boolean;
  chat: boolean;
  presenting: boolean;
  /** Slides selected in the strip or grid (ids), for slide-level actions. */
  slideSelection: string[];
  undo: Step[];
  redo: Step[];
  remote: RemoteChange | null;
  /** Set while the assistant runs; the canvas then follows the slide it changes. */
  agent: AgentPresence | null;
  /** Words written on Home for a new deck, waiting in the assistant's composer (never sent by themselves). */
  chatDraft: string;
}

const initial: EditorState = {
  ref: null,
  deck: null,
  loading: true,
  current: Math.max(0, Number(/slide=(\d+)/.exec(location.hash)?.[1] ?? 1) - 1),
  selection: [],
  editing: null,
  view: "edit",
  zoom: "fit",
  fitScale: 0.5,
  // A narrow window gives the slide the room first; the Design panel is a click away.
  inspector: readPref("inspector", window.innerWidth >= 1280),
  thumbnails: readPref("thumbnails", true),
  notes: readPref("notes", true),
  chat: readPref("chat", false),
  presenting: false,
  slideSelection: [],
  undo: [],
  redo: [],
  remote: null,
  agent: null,
  chatDraft: "",
};

export { readPref, toast, writePref };

let state = initial;
const listeners = new Set<() => void>();

export function getState(): EditorState {
  return state;
}

export function setState(patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useEditor<T>(select: (s: EditorState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

// ── Derived ─────────────────────────────────────────────────────────────

export function currentSlide(s = state): LoadedSlide | null {
  if (!s.deck || !s.deck.slides.length) return null;
  return s.deck.slides[Math.min(s.current, s.deck.slides.length - 1)] ?? null;
}

export function ctxOf(s = state): ValueContext {
  return s.deck ? valueContext(s.deck.index) : { colorTokens: new Set(), families: new Set() };
}

// ── Loading ─────────────────────────────────────────────────────────────

async function readDeck(): Promise<LoadedDeck> {
  const a = api();
  return loadDeck({ read: (p) => a.read(p), list: (d) => a.list(d) });
}

// While the user is typing, a reload would re-render the slide under their
// caret; it waits until typing ends.
let reloadWaiting = false;
/** The folder the deck in the store was read from (a change is "remote" only within one deck). */
let loadedRoot: string | null = null;

export function endEditing() {
  setState({ editing: null });
  if (reloadWaiting) {
    reloadWaiting = false;
    void reload();
  }
}

/**
 * Read the deck again. With `paths` (what the watcher saw change), only those
 * slide files are read when nothing else changed; anything else reads it all.
 */
export async function reload(paths?: string[]) {
  if (state.editing !== null) {
    reloadWaiting = true;
    return;
  }
  const root = state.ref?.root ?? null;
  const slideFiles = paths?.map((p) => SLIDE_FILE.exec(p)?.[1] ?? null);
  const partial = state.deck && loadedRoot === root && slideFiles?.length && slideFiles.every((id) => id !== null);
  const files = partial ? await Promise.all(slideFiles!.map(async (id) => ({ id: id!, source: await api().read(`slides/${id}.html`) }))) : null;
  const full = files ? null : await readDeck();
  const sameDeck = loadedRoot === root;
  loadedRoot = root;
  setState((s) => {
    const read = files ? (s.deck ? withSlideFiles(s.deck, files) : null) : full;
    if (!read) return {};
    const deck = keepUnchanged(sameDeck ? s.deck : null, read);
    const inView = currentSlide(s)?.id;
    const remote = sameDeck && s.deck ? remoteChange(s.deck, deck, inView, Date.now()) : null;
    // While the assistant works, the canvas follows the slide it changed (never away from the user's typing).
    const follow = remote && s.agent && s.editing === null && s.view === "edit" && !s.presenting ? remote.slideId : null;
    const keepId = follow ?? inView;
    const byId = keepId ? deck.slides.findIndex((x) => x.id === keepId) : -1;
    const current = byId >= 0 ? byId : Math.min(s.current, Math.max(0, deck.slides.length - 1));
    const slide = deck.slides[current]?.slide;
    const moved = deck.slides[current]?.id !== inView;
    // Drop selections that no longer point at anything (or at the slide left behind).
    const selection = slide && !moved ? s.selection.filter((a) => addressExists(slide, a)) : [];
    return {
      deck,
      current,
      selection,
      editing: s.editing && slide && !moved && addressExists(slide, s.editing) ? s.editing : null,
      ...(remote ? { remote } : {}),
    };
  });
}

/** The assistant started (or, with null, finished) working; the tab in the window's strip shows it too. */
export function setAgent(agent: AgentPresence | null) {
  setState({ agent });
  tabs.activity({ working: !!agent });
}

function addressExists(slide: ElementNode, addr: string): boolean {
  let cur: ElementNode = slide;
  if (addr === "") return true;
  for (const p of addr.split(".")) {
    const next = cur.children.filter((c): c is ElementNode => c.type === "element")[Number(p)];
    if (!next) return false;
    cur = next;
  }
  return true;
}

export async function boot() {
  const ref = await api().current();
  if (ref) setAssetBase(ref.asset);
  setState({ ref });
  if (ref) await reload();
  setState({ loading: false });
  // comments.json is the comments store's; it never changes a slide.
  api().onChanged((paths) => {
    const deckPaths = paths.filter((p) => p !== "comments.json");
    if (deckPaths.length) void reload(deckPaths);
  });
}

async function switchTo(ref: DeckRef | null) {
  if (!ref) return;
  setAssetBase(ref.asset);
  setState({ ref, current: 0, selection: [], editing: null, undo: [], redo: [], slideSelection: [], view: "edit" });
  await reload();
}

export async function chooseDeck() {
  await switchTo(await api().choose());
}

export async function openRecent(root: string) {
  try {
    await switchTo(await api().openPath(root));
  } catch (e) {
    toast(`Couldn’t open that deck: ${(e as Error).message}`);
  }
}

/** Open a deck from the recent list in a tab of its own. */
export function openRecentInTab(root: string) {
  api()
    .openInTab(root)
    .catch((e) => toast(`Couldn’t open that deck: ${(e as Error).message}`));
}

/**
 * Create a deck from a starter theme in a folder the user picks. A `draft`
 * (words written on Home) waits in the assistant's composer; nothing is sent.
 */
export async function createDeck(title: string, starterKey: string, draft = "") {
  const { index, slides } = newDeckFiles(title.trim() || "Untitled deck", starterKey);
  const files: Record<string, string> = { "deck.json": JSON.stringify(index, null, 2) + "\n" };
  for (const [id, html] of Object.entries(slides)) files[`slides/${id}.html`] = html;
  try {
    await switchTo(await api().create(index.title, files));
  } catch (e) {
    toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    return;
  }
  if (draft.trim() && state.deck) {
    writePref("chat", true);
    setState({ chat: true, chatDraft: draft.trim() });
  }
}

// ── Navigation and selection ────────────────────────────────────────────

export function goTo(index: number) {
  const count = state.deck?.slides.length ?? 0;
  const current = Math.max(0, Math.min(count - 1, index));
  if (current === state.current && !state.selection.length) return;
  setState({ current, selection: [], editing: null, slideSelection: [] });
}

export function select(addrs: string[]) {
  setState({ selection: addrs, editing: state.editing && addrs.includes(state.editing) ? state.editing : null });
}

export function setView(view: View) {
  setState({ view, selection: [], editing: null });
}

export function togglePanel(panel: "inspector" | "chat" | "thumbnails" | "notes", on?: boolean) {
  const v = on ?? !state[panel];
  writePref(panel, v);
  setState({ [panel]: v } as Partial<EditorState>);
}

// ── Writing ─────────────────────────────────────────────────────────────

async function writeFiles(changes: FileChange[]) {
  const a = api();
  // Slides first, the index last: a reader never sees an index pointing at a missing file.
  const ordered = [...changes.filter((c) => c.rel !== "deck.json"), ...changes.filter((c) => c.rel === "deck.json")];
  for (const c of ordered) {
    if (c.after === null) await a.remove(c.rel);
    else await a.write(c.rel, c.after);
  }
}

/** Show the result of a change right away (the watcher confirms it shortly after). */
function applyLocally(changes: FileChange[]) {
  const deck = state.deck;
  if (!deck) return;
  let index = deck.index;
  const indexChange = changes.find((c) => c.rel === "deck.json");
  if (indexChange?.after) {
    const r = checkIndex(JSON.parse(indexChange.after));
    if (r.index) index = r.index;
  }
  const ctx = valueContext(index);
  const sources = new Map(deck.slides.map((s) => [s.id, s.source] as const));
  for (const c of changes) {
    const m = /^slides\/(.+)\.html$/.exec(c.rel);
    if (!m) continue;
    if (c.after === null) sources.delete(m[1]!);
    else sources.set(m[1]!, c.after);
  }
  const ids = [...index.slides.filter((id) => sources.has(id)), ...[...sources.keys()].filter((id) => !index.slides.includes(id)).sort()];
  const slides = ids.map((id) => {
    const source = sources.get(id)!;
    const prev = deck.slides.find((s) => s.id === id);
    if (prev && prev.source === source && indexChange === undefined) return prev;
    const r = parseSlide(source, ctx);
    return { id, slide: r.slide, diagnostics: r.diagnostics, source };
  });
  const problems = indexChange?.after ? deck.problems.filter((p) => !p.startsWith("deck.json")) : deck.problems;
  setState({ deck: { index, slides, problems } });
}

async function commit(label: string, changes: FileChange[], after?: Partial<EditorState>) {
  const real = changes.filter((c) => c.before !== c.after);
  if (!real.length) return;
  const step: Step = { label, changes: real, slideId: currentSlide()?.id ?? null, selection: state.selection };
  applyLocally(real);
  setState({ undo: [...state.undo.slice(-199), step], redo: [], ...after });
  try {
    await writeFiles(real);
  } catch (e) {
    toast(`Couldn’t save: ${(e as Error).message}`);
    await reload();
  }
}

function indexText(index: DeckIndex) {
  return JSON.stringify(index, null, 2) + "\n";
}

/** The index as we'd write it now; null when the deck has no deck.json yet. */
function currentIndexText(): string | null {
  const d = state.deck;
  if (!d || d.problems.some((p) => p.startsWith("deck.json is missing"))) return null;
  return indexText(d.index);
}

/**
 * Change the current slide's tree. `fn` gets the slide and the deck's value
 * context and returns the new slide (an edit operation, usually). Errors from
 * the operation become a short message, and nothing is written.
 */
export async function editSlide(label: string, fn: (slide: ElementNode, ctx: ValueContext) => ElementNode, after?: Partial<EditorState>): Promise<boolean> {
  const cur = currentSlide();
  if (!cur?.slide) return false;
  let next: ElementNode;
  try {
    next = fn(cur.slide, ctxOf());
  } catch (e) {
    if (e instanceof EditError) {
      toast(e.message);
      return false;
    }
    throw e;
  }
  await commit(label, [{ rel: `slides/${cur.id}.html`, before: cur.source, after: serializeSlide(next) }], after);
  return true;
}

/** Same as editSlide, but returns a value computed alongside (e.g. the address of an inserted element). */
export async function editSlideWith<T>(label: string, fn: (slide: ElementNode, ctx: ValueContext) => { slide: ElementNode; value: T }, after?: (v: T) => Partial<EditorState>): Promise<T | null> {
  const cur = currentSlide();
  if (!cur?.slide) return null;
  let r: { slide: ElementNode; value: T };
  try {
    r = fn(cur.slide, ctxOf());
  } catch (e) {
    if (e instanceof EditError) {
      toast(e.message);
      return null;
    }
    throw e;
  }
  await commit(label, [{ rel: `slides/${cur.id}.html`, before: cur.source, after: serializeSlide(r.slide) }], after?.(r.value));
  return r.value;
}

/** Change deck settings (title, sections, theme). */
export async function editIndex(label: string, fn: (index: DeckIndex) => DeckIndex) {
  const deck = state.deck;
  if (!deck) return;
  const next = fn(deck.index);
  const r = checkIndex(next);
  if (!r.index) return toast(r.errors[0] ?? "Not saved");
  // A theme change may not break a slide that works now (e.g. removing a color it uses).
  const before = valueContext(deck.index);
  const after = valueContext(r.index);
  for (const s of deck.slides) {
    if (!parseSlide(s.source, before).ok) continue;
    const err = parseSlide(s.source, after).diagnostics.find((d) => d.severity === "error");
    if (err) return toast(`Not changed: slide ${deck.slides.indexOf(s) + 1} would break (${err.message})`);
  }
  await commit(label, [{ rel: "deck.json", before: currentIndexText(), after: indexText(r.index) }]);
}

// ── Slide-level actions ─────────────────────────────────────────────────

function slideById(id: string) {
  return state.deck?.slides.find((s) => s.id === id) ?? null;
}

/** Add a slide from a layout after the slide at `afterIndex` (default: the current one). */
export async function addSlide(layoutKey = "title-body", afterIndex = state.current) {
  const deck = state.deck;
  if (!deck) return;
  const layout = layouts(deck.index.theme).find((l) => l.key === layoutKey) ?? layouts(deck.index.theme)[0]!;
  const id = newSlideId(deck.index, layout.key === "blank" ? "slide" : layout.label);
  const at = deck.slides.length ? afterIndex + 1 : 0;
  const order = deck.slides.map((s) => s.id);
  const index = placeSlide({ ...deck.index, slides: order }, id, at);
  const html = serializeSlide(parseSlide(layout.html(id), valueContext(index)).slide!);
  await commit(`Add slide`, [
    { rel: `slides/${id}.html`, before: null, after: html },
    { rel: "deck.json", before: currentIndexText(), after: indexText(index) },
  ]);
  setState({ current: at, selection: [], editing: null, slideSelection: [] });
}

export async function duplicateSlides(ids: string[]) {
  const deck = state.deck;
  if (!deck || !ids.length) return;
  let index: DeckIndex = { ...deck.index, slides: deck.slides.map((s) => s.id) };
  const changes: FileChange[] = [];
  let lastAt = 0;
  for (const id of ids) {
    const src = slideById(id);
    if (!src?.slide) continue;
    const copyId = newSlideId(index, id.replace(/-\d+$/, ""));
    const copy = setAttr(src.slide, "", "id", copyId, valueContext(index));
    lastAt = index.slides.indexOf(id) + 1;
    index = placeSlide(index, copyId, lastAt);
    changes.push({ rel: `slides/${copyId}.html`, before: null, after: serializeSlide(copy) });
  }
  changes.push({ rel: "deck.json", before: currentIndexText(), after: indexText(index) });
  await commit(ids.length === 1 ? "Duplicate slide" : "Duplicate slides", changes);
  setState({ current: lastAt, selection: [], slideSelection: [] });
}

export async function deleteSlides(ids: string[]) {
  const deck = state.deck;
  if (!deck || !ids.length) return;
  const index = unplaceSlides({ ...deck.index, slides: deck.slides.map((s) => s.id) }, ids);
  const changes: FileChange[] = ids.map((id) => ({ rel: `slides/${id}.html`, before: slideById(id)?.source ?? null, after: null }));
  changes.push({ rel: "deck.json", before: currentIndexText(), after: indexText(index) });
  const firstIdx = Math.min(...ids.map((id) => deck.slides.findIndex((s) => s.id === id)));
  await commit(ids.length === 1 ? "Delete slide" : `Delete ${ids.length} slides`, changes);
  setState({ current: Math.max(0, Math.min(firstIdx, index.slides.length - 1)), selection: [], editing: null, slideSelection: [] });
}

export async function moveSlides(ids: string[], to: number) {
  const deck = state.deck;
  if (!deck || !ids.length) return;
  const keepId = currentSlide()?.id;
  const index = moveInIndex({ ...deck.index, slides: deck.slides.map((s) => s.id) }, ids, to);
  await commit(ids.length === 1 ? "Move slide" : "Move slides", [{ rel: "deck.json", before: currentIndexText(), after: indexText(index) }]);
  if (keepId) setState({ current: Math.max(0, index.slides.indexOf(keepId)) });
}

export async function toggleSkip(ids: string[]) {
  const changes: FileChange[] = [];
  const allHidden = ids.every((id) => slideById(id)?.slide?.attrs.hidden !== undefined);
  for (const id of ids) {
    const s = slideById(id);
    if (!s?.slide) continue;
    const next = setAttr(s.slide, "", "hidden", allHidden ? null : "", ctxOf());
    changes.push({ rel: `slides/${id}.html`, before: s.source, after: serializeSlide(next) });
  }
  await commit(allHidden ? "Show slide" : "Skip slide", changes);
}

// ── Undo / redo ─────────────────────────────────────────────────────────

async function diskText(rel: string): Promise<string | null> {
  return api().read(rel);
}

async function replay(step: Step, direction: "undo" | "redo"): Promise<boolean> {
  // Every file must still be as this step left it (or, for redo, as undo left it).
  for (const c of step.changes) {
    const expected = direction === "undo" ? c.after : c.before;
    const now = await diskText(c.rel);
    if (now !== expected) {
      toast(`Can’t ${direction} “${step.label}”: the slide was changed since (by the AI or another editor).`);
      return false;
    }
  }
  const changes = step.changes.map((c) => (direction === "undo" ? { rel: c.rel, before: c.after, after: c.before } : c));
  applyLocally(changes);
  await writeFiles(changes);
  return true;
}

export async function undo() {
  const step = state.undo[state.undo.length - 1];
  if (!step) return;
  if (!(await replay(step, "undo"))) {
    setState({ undo: [], redo: [] });
    return;
  }
  const idx = step.slideId ? (state.deck?.slides.findIndex((s) => s.id === step.slideId) ?? -1) : -1;
  setState({ undo: state.undo.slice(0, -1), redo: [...state.redo, step], selection: step.selection, editing: null, ...(idx >= 0 ? { current: idx } : {}) });
}

export async function redo() {
  const step = state.redo[state.redo.length - 1];
  if (!step) return;
  if (!(await replay(step, "redo"))) {
    setState({ undo: [], redo: [] });
    return;
  }
  const idx = step.slideId ? (state.deck?.slides.findIndex((s) => s.id === step.slideId) ?? -1) : -1;
  setState({ redo: state.redo.slice(0, -1), undo: [...state.undo, step], editing: null, ...(idx >= 0 ? { current: idx } : {}) });
}
