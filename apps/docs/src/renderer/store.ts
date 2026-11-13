// The editor's state and every action that changes a doc.
//
// One store, read with useDocs(selector). Components never write files
// themselves: they call an action here, which writes the result, updates the
// screen at once, and records an undo step. The file watcher's reload then
// confirms what we already show.
//
// While the user types, the page itself holds the newest text; the editor
// reads it back (page.ts) a moment after typing stops. Changes from outside
// (the AI, another program) wait until then, so the page never jumps under
// the user's caret, and a tab both changed at once is merged block by block.
//
// Undo is per file and safe against other writers, as in slides: a step is
// only undone if the file still holds what that step wrote.

import { useRef, useSyncExternalStore } from "react";
import {
  type DocIndex,
  type Dropdown,
  type ElementNode,
  type FontChoice,
  type LoadedDoc,
  type TabMove,
  type TabRef,
  DocEditError,
  addTab as addTabRef,
  checkIndex,
  docContext,
  dropdownFromTemplate,
  findTab,
  flattenTabs,
  indexText,
  mergeBlocks,
  loadDoc,
  moveTab as moveTabRef,
  newDocFiles,
  newTabId,
  loadTab,
  parseTab,
  removeTab,
  renameTab as renameTabRef,
  serializeNode,
  serializeTab,
  tabFile,
  TAB_FILE_RE,
} from "@opendeck/doc";
import { readPref, tabs as shellTabs, toast, writePref } from "@opendeck/shell";
import { type DocRef, api, plainError, setAssetBase } from "./api.ts";

export type Mode = "edit" | "suggest";

/** Where the caret was: a block and a text offset in it. */
export interface CaretPos {
  block: string;
  offset: number;
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
  tab: string | null;
  caret: CaretPos | null;
}

export interface DocsState {
  ref: DocRef | null;
  doc: LoadedDoc | null;
  loading: boolean;
  /** The tab on screen. */
  tab: string | null;
  sidebar: boolean;
  chat: boolean;
  /** The comments column (in the chat's place; one at a time). */
  comments: boolean;
  mode: Mode;
  undo: Step[];
  redo: Step[];
  /** Bumped when the page must be drawn again from the file (tab switch, undo, a change from outside). */
  paint: number;
  /** Where to put the caret after the next paint. */
  caret: CaretPos | null;
  /** Blocks just changed from outside, to show briefly. */
  flash: { tab: string; blocks: string[]; at: number } | null;
  /** Set while the assistant runs; the page then follows what it changes. */
  agent: { name: string } | null;
  /** Words written on Home for a new doc, waiting (unsent) in the chat's composer. */
  chatDraft: string;
  /** What the user has selected on the page, for the assistant. */
  selection: { blocks: string[]; text: string };
  /** The "Describe a change" box is open. */
  asking: boolean;
  /** The AI box on the page, at this block (from "@", the line's AI mark, or the empty page's hint). */
  inlineAsk: { block: string } | null;
}

const initialTab = /(?:^#|&)tab=([^&]+)/.exec(location.hash)?.[1];

let state: DocsState = {
  ref: null,
  doc: null,
  loading: true,
  tab: initialTab ? decodeURIComponent(initialTab) : null,
  sidebar: readPref("docs.sidebar", true),
  chat: readPref("docs.chat", false),
  comments: false,
  mode: "edit",
  undo: [],
  redo: [],
  paint: 0,
  caret: null,
  flash: null,
  agent: null,
  chatDraft: "",
  selection: { blocks: [], text: "" },
  asking: false,
  inlineAsk: null,
};
const listeners = new Set<() => void>();

export const getState = () => state;

export function setState(patch: Partial<DocsState> | ((s: DocsState) => Partial<DocsState>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of listeners) l();
}

/** Same value, or same items in the same order (so selectors may build arrays and small objects). */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]) || (typeof (a as Record<string, unknown>)[k] === "object" && JSON.stringify((a as Record<string, unknown>)[k]) === JSON.stringify((b as Record<string, unknown>)[k])));
}

export function useDocs<T>(select: (s: DocsState) => T): T {
  const last = useRef<{ value: T } | null>(null);
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => {
      const next = select(state);
      if (last.current && shallowEqual(last.current.value, next)) return last.current.value;
      last.current = { value: next };
      return next;
    },
  );
}

export { toast };

// ── The page's side ─────────────────────────────────────────────────────
// The page (editor/page.ts) registers how to read itself and where its caret is.

interface PageHooks {
  /** The blocks on the page now, if the user changed anything since the last read. */
  pending(): ElementNode[] | null;
  caret(): CaretPos | null;
  typing(): boolean;
}
let page: PageHooks | null = null;
export function attachPage(hooks: PageHooks | null) {
  page = hooks;
}

// ── Derived ─────────────────────────────────────────────────────────────

export function currentTab(s = state) {
  if (!s.doc || !s.tab) return null;
  return s.doc.tabs.get(s.tab) ?? null;
}

export function ctxOf(s = state) {
  return docContext(s.doc?.index ?? { dropdowns: [] });
}

/** The tab to show: the one asked for if it exists, else the first. */
function pickTab(doc: LoadedDoc, want: string | null): string | null {
  const flat = flattenTabs(doc.index.tabs);
  if (want && flat.some((f) => f.ref.id === want)) return want;
  return flat[0]?.ref.id ?? null;
}

// ── Loading ─────────────────────────────────────────────────────────────

async function readDoc(): Promise<LoadedDoc> {
  const a = api();
  return loadDoc({ read: (p) => a.read(p), list: (d) => a.list(d) });
}

let reloadWaiting: string[] | null = null;
let loadedRoot: string | null = null;

/** Changed blocks between two versions of a tab (new or different), by id. */
function changedBlocks(before: ElementNode | null, after: ElementNode | null): string[] {
  if (!after) return [];
  const old = new Map((before?.children ?? []).map((b) => [(b as ElementNode).attrs.id, serializeNode(b)] as const));
  return (after.children as ElementNode[]).filter((b) => old.get(b.attrs.id) !== serializeNode(b)).map((b) => b.attrs.id!);
}

/**
 * Read the doc again. With `paths` (what the watcher saw change), only those
 * tab files are read when the index didn't change. While the user is typing,
 * this waits until they pause.
 */
export async function reload(paths?: string[]) {
  if (page?.typing()) {
    reloadWaiting = [...(reloadWaiting ?? []), ...(paths ?? ["doc.json"])];
    return;
  }
  // Save what the user typed first, merged with what changed on disk.
  await flushTyping();
  const root = state.ref?.root ?? null;
  const tabIdsChanged = paths?.map((p) => TAB_FILE_RE.exec(p)?.[1] ?? null);
  const partial = state.doc && loadedRoot === root && tabIdsChanged?.length && tabIdsChanged.every((id) => id !== null);
  let next: LoadedDoc;
  if (partial && state.doc) {
    const tabs = new Map(state.doc.tabs);
    const ctx = ctxOf();
    for (const id of new Set(tabIdsChanged as string[])) {
      const source = await api().read(tabFile(id));
      const prev = tabs.get(id);
      if (source === null) {
        if (prev) tabs.set(id, { id, tab: null, diagnostics: [{ severity: "error", code: "missing", message: `tabs/${id}.html is missing`, line: 1, col: 1, path: "" }], source: "" });
        continue;
      }
      if (prev?.source === source) continue;
      const p = loadTab(id, source, ctx);
      tabs.set(id, { id, tab: p.tab, diagnostics: p.diagnostics, source });
    }
    next = { ...state.doc, tabs };
  } else next = await readDoc();
  const sameDoc = loadedRoot === root;
  loadedRoot = root;
  setState((s) => {
    const tab = pickTab(next, s.tab);
    const before = sameDoc && s.doc && tab ? (s.doc.tabs.get(tab)?.tab ?? null) : null;
    const after = tab ? (next.tabs.get(tab)?.tab ?? null) : null;
    const sameText = sameDoc && tab && s.doc?.tabs.get(tab)?.source === next.tabs.get(tab)?.source;
    const changed = sameDoc && tab && !sameText ? changedBlocks(before, after) : [];
    // While the assistant works, the page follows the tab it changes.
    let showTab = tab;
    if (sameDoc && s.agent && s.doc && !changed.length) {
      for (const [id, t] of next.tabs) if (s.doc.tabs.get(id)?.source !== t.source) showTab = id;
    }
    const switched = showTab !== s.tab;
    const repaint = switched || !sameText || !sameDoc;
    return {
      doc: next,
      mode: modeOf(next.index),
      tab: showTab,
      ...(repaint ? { paint: s.paint + 1, caret: switched ? null : page?.caret() ?? null } : {}),
      ...(changed.length && showTab ? { flash: { tab: showTab, blocks: changed, at: Date.now() } } : {}),
    };
  });
}

/** Typing paused: anything that waited for it runs now. */
export function typingPaused() {
  const waiting = reloadWaiting;
  reloadWaiting = null;
  if (waiting) void reload(waiting);
  else void flushTyping();
}

/** The assistant started (or, with null, finished) working; the tab in the window's strip shows it too. */
export function setAgent(agent: { name: string } | null) {
  setState({ agent });
  shellTabs.activity({ working: !!agent });
}

export async function boot() {
  const ref = await api().current();
  if (ref) setAssetBase(ref.asset);
  setState({ ref });
  if (ref) await reload();
  setState({ loading: false });
  // comments.json is the comments store's; it never changes the text.
  api().onChanged((paths) => {
    const docPaths = paths.filter((p) => p !== "comments.json" && !p.startsWith("assets/"));
    if (docPaths.length) void reload(docPaths);
  });
}

async function switchTo(ref: DocRef | null) {
  if (!ref) return;
  setAssetBase(ref.asset);
  setState({ ref, tab: null, undo: [], redo: [], mode: "edit" });
  await reload();
}

export async function chooseDoc() {
  await switchTo(await api().choose());
}

export async function openRecent(root: string) {
  try {
    await switchTo(await api().openPath(root));
  } catch (e) {
    toast(`Couldn’t open that doc: ${plainError(e)}`);
  }
}

export function openRecentInTab(root: string) {
  api()
    .openInTab(root)
    .catch((e) => toast(`Couldn’t open that doc: ${plainError(e)}`));
}

/** Create a doc in a folder the user picks. A `draft` (words written on Home) waits in the chat's composer; nothing is sent. */
export async function createDoc(title: string, draft = "") {
  const { index, tabs } = newDocFiles(title.trim() || "Untitled doc");
  const files: Record<string, string> = { "doc.json": indexText(index) };
  for (const [id, html] of Object.entries(tabs)) files[tabFile(id)] = html;
  try {
    await switchTo(await api().create(index.title, files));
  } catch (e) {
    toast(plainError(e));
    return;
  }
  if (draft.trim() && state.doc) {
    writePref("docs.chat", true);
    setState({ chat: true, chatDraft: draft.trim() });
  }
}

// ── Panels and modes ────────────────────────────────────────────────────

/** Show or hide a panel. The chat and the comments share the right-hand column, so opening one closes the other. */
export function togglePanel(panel: "sidebar" | "chat" | "comments", on?: boolean) {
  const v = on ?? !state[panel];
  if (panel !== "comments") writePref(`docs.${panel}`, v);
  const patch: Partial<DocsState> = { [panel]: v };
  if (v && panel === "chat") patch.comments = false;
  if (v && panel === "comments") patch.chat = false;
  setState(patch);
}

const modeOf = (index: DocIndex): Mode => (index.suggesting ? "suggest" : "edit");

/** doc.json's text with Suggesting mode set as given; other text (not a doc.json we wrote) as it is. */
function withSuggesting(text: string | null, suggesting: boolean): string | null {
  if (text === null) return text;
  try {
    const r = checkIndex({ ...JSON.parse(text), suggesting });
    return r.index ? indexText(r.index) : text;
  } catch {
    return text;
  }
}

/**
 * Editing or Suggesting, kept in doc.json so every editor and every AI on
 * the doc works the same way. Switching is not an edit, so it is not an undo
 * step; the doc.json snapshots that undo and redo keep take the new mode
 * too, so undoing an older change neither flips the mode back nor finds the
 * file changed.
 */
export async function setMode(mode: Mode) {
  const doc = state.doc;
  if (!doc || modeOf(doc.index) === mode) return;
  await flushTyping();
  const suggesting = mode === "suggest";
  const change: FileChange = { rel: "doc.json", before: currentIndexText(), after: indexText({ ...doc.index, suggesting }) };
  const patch = (step: Step): Step => ({ ...step, changes: step.changes.map((c) => (c.rel === "doc.json" ? { ...c, before: withSuggesting(c.before, suggesting), after: withSuggesting(c.after, suggesting) } : c)) });
  setState((s) => ({ undo: s.undo.map(patch), redo: s.redo.map(patch) }));
  applyLocally([change]);
  try {
    await writeFiles([change]);
  } catch (e) {
    toast(`Couldn’t switch to ${suggesting ? "Suggesting" : "Editing"}: ${plainError(e)}`);
    await reload();
  }
}

export async function goToTab(id: string) {
  if (id === state.tab) return;
  await flushTyping();
  setState((s) => ({ tab: id, paint: s.paint + 1, caret: null, selection: { blocks: [], text: "" }, inlineAsk: null }));
}

// ── Writing ─────────────────────────────────────────────────────────────

async function writeFiles(changes: FileChange[]) {
  const a = api();
  // Tabs first, the index last: a reader never sees an index pointing at a missing file.
  const ordered = [...changes.filter((c) => c.rel !== "doc.json"), ...changes.filter((c) => c.rel === "doc.json")];
  for (const c of ordered) {
    if (c.after === null) await a.remove(c.rel);
    else await a.write(c.rel, c.after);
  }
}

/** Show the result of a change right away (the watcher confirms it shortly after). */
function applyLocally(changes: FileChange[]) {
  const doc = state.doc;
  if (!doc) return;
  let index = doc.index;
  const indexChange = changes.find((c) => c.rel === "doc.json");
  if (indexChange?.after) {
    const r = checkIndex(JSON.parse(indexChange.after));
    if (r.index) index = r.index;
  }
  const ctx = docContext(index);
  const tabs = new Map(doc.tabs);
  for (const c of changes) {
    const m = TAB_FILE_RE.exec(c.rel);
    if (!m) continue;
    if (c.after === null) tabs.delete(m[1]!);
    else {
      const p = parseTab(c.after, ctx);
      tabs.set(m[1]!, { id: m[1]!, tab: p.tab, diagnostics: p.diagnostics, source: c.after });
    }
  }
  const problems = indexChange?.after ? doc.problems.filter((p) => !p.startsWith("doc.json")) : doc.problems;
  setState({ doc: { index, tabs, problems }, mode: modeOf(index) });
}

let lastTypingAt = 0;

async function commit(label: string, changes: FileChange[], after?: Partial<DocsState>, caret: CaretPos | null = page?.caret() ?? null) {
  const real = changes.filter((c) => c.before !== c.after);
  if (!real.length) return;
  const step: Step = { label, changes: real, tab: state.tab, caret };
  applyLocally(real);
  // Typing in one burst is one undo step.
  const last = state.undo[state.undo.length - 1];
  const merge = label === "Typing" && last?.label === "Typing" && last.tab === step.tab && real.length === 1 && last.changes.length === 1 && last.changes[0]!.rel === real[0]!.rel && last.changes[0]!.after === real[0]!.before && Date.now() - lastTypingAt < 1500;
  lastTypingAt = Date.now();
  const undo = merge ? [...state.undo.slice(0, -1), { ...last, changes: [{ ...last.changes[0]!, after: real[0]!.after }] }] : [...state.undo.slice(-199), step];
  setState({ undo, redo: [], ...after });
  try {
    await writeFiles(real);
  } catch (e) {
    toast(`Couldn’t save: ${plainError(e)}`);
    await reload();
  }
}

/** The index as we'd write it now; null when the doc has no doc.json yet. */
function currentIndexText(): string | null {
  const d = state.doc;
  if (!d || d.problems.some((p) => p.startsWith("doc.json is missing"))) return null;
  return indexText(d.index);
}

/**
 * Save what the user typed. If the file changed on disk since the page was
 * drawn (the AI wrote while the user typed), the two are merged block by
 * block and the page is drawn again with the result.
 */
export async function flushTyping() {
  const blocks = page?.pending();
  const cur = currentTab();
  if (!blocks || !cur || !state.tab) return;
  const id = state.tab;
  const mine = { type: "element" as const, tag: "article", attrs: { id }, children: blocks };
  const text = serializeTab(mine);
  if (text === cur.source) return;
  const disk = await api().read(tabFile(id));
  if (disk !== null && disk !== cur.source && cur.tab) {

    const theirs = parseTab(disk, ctxOf());
    if (theirs.tab) {
      const merged = serializeTab({ ...mine, children: mergeBlocks(cur.tab.children as ElementNode[], blocks, theirs.tab.children as ElementNode[]) });
      await commit("Typing", [{ rel: tabFile(id), before: disk, after: merged }], { paint: state.paint + 1, caret: page?.caret() ?? null });
      return;
    }
  }
  await commit("Typing", [{ rel: tabFile(id), before: cur.source, after: text }]);
}

/**
 * Change the current tab's blocks: `fn` gets them (as the page shows them
 * now) and returns the new list. The page is drawn again unless `repaint` is
 * false (the page already shows the change).
 */
export async function editTab(label: string, fn: (blocks: ElementNode[]) => ElementNode[], opts: { repaint?: boolean; caret?: CaretPos | null } = {}) {
  await flushTyping();
  const cur = currentTab();
  if (!cur?.tab || !state.tab) return;
  let next: ElementNode[];
  try {
    next = fn(cur.tab.children as ElementNode[]);
  } catch (e) {
    if (e instanceof DocEditError) return toast(e.message);
    throw e;
  }
  const text = serializeTab({ ...cur.tab, children: next });
  const caret = opts.caret === undefined ? (page?.caret() ?? null) : opts.caret;
  await commit(label, [{ rel: tabFile(state.tab), before: cur.source, after: text }], opts.repaint === false ? undefined : { paint: state.paint + 1, caret });
}

/** Change the doc's settings (doc.json). */
export async function editIndex(label: string, fn: (index: DocIndex) => DocIndex, extra: FileChange[] = []) {
  const doc = state.doc;
  if (!doc) return;
  let next: DocIndex;
  try {
    next = fn(doc.index);
  } catch (e) {
    if (e instanceof DocEditError) return toast(e.message);
    throw e;
  }
  const r = checkIndex(next);
  if (!r.index) return toast(r.errors[0] ?? "Not saved");
  await commit(label, [...extra, { rel: "doc.json", before: currentIndexText(), after: indexText(r.index) }]);
}

// ── Tabs ────────────────────────────────────────────────────────────────

const emptyTab = (id: string) => serializeTab({ type: "element", tag: "article", attrs: { id }, children: [] });

/** A new tab after `after` (default: the current one), or under `parent`; shown at once. */
export async function addTab(where: { after?: string | null; parent?: string } = {}) {
  const doc = state.doc;
  if (!doc) return;
  await flushTyping();
  const id = newTabId(doc.index.tabs, "tab");
  const after = where.parent ? undefined : (where.after ?? state.tab ?? undefined);
  await editIndex("Add tab", (index) => ({ ...index, tabs: addTabRef(index.tabs, { id, title: "", children: [] }, { after: findTab(index.tabs, after ?? "") ? after : undefined, parent: where.parent }) }), [{ rel: tabFile(id), before: null, after: emptyTab(id) }]);
  if (state.doc?.tabs.has(id)) setState((s) => ({ tab: id, paint: s.paint + 1, caret: null }));
  return id;
}

export async function renameTab(id: string, title: string) {
  const t = state.doc ? findTab(state.doc.index.tabs, id) : null;
  if (!t || t.title === title.replace(/\s+/g, " ").trim()) return;
  await editIndex("Rename tab", (index) => ({ ...index, tabs: renameTabRef(index.tabs, id, title) }));
}

export async function duplicateTab(id: string) {
  const doc = state.doc;
  const src = doc?.tabs.get(id);
  const ref = doc ? findTab(doc.index.tabs, id) : null;
  if (!doc || !src?.tab || !ref) return;
  await flushTyping();
  const copyId = newTabId(doc.index.tabs, id.replace(/-\d+$/, ""));
  const text = serializeTab({ ...src.tab, attrs: { id: copyId } });
  const copy: TabRef = { id: copyId, title: ref.title ? `${ref.title} (copy)` : "", children: [] };
  await editIndex("Duplicate tab", (index) => ({ ...index, tabs: addTabRef(index.tabs, copy, { after: id }) }), [{ rel: tabFile(copyId), before: null, after: text }]);
  setState((s) => ({ tab: copyId, paint: s.paint + 1, caret: null }));
}

export async function deleteTab(id: string) {
  const doc = state.doc;
  if (!doc) return;
  const r = removeTab(doc.index.tabs, id);
  if (!r.tabs.length) return toast("A doc keeps at least one tab.");
  await flushTyping();
  const files = r.removed.map((t) => ({ rel: tabFile(t), before: doc.tabs.get(t)?.source || null, after: null }));
  const flat = flattenTabs(doc.index.tabs).map((f) => f.ref.id);
  const at = flat.indexOf(id);
  const nextTab = flat.find((t, i) => i > at && !r.removed.includes(t)) ?? flat.filter((t) => !r.removed.includes(t)).pop() ?? null;
  await editIndex(r.removed.length > 1 ? "Delete tabs" : "Delete tab", (index) => ({ ...index, tabs: removeTab(index.tabs, id).tabs }), files);
  if (r.removed.includes(state.tab ?? "")) setState((s) => ({ tab: nextTab, paint: s.paint + 1, caret: null }));
}

export async function moveTab(id: string, move: TabMove) {
  await editIndex("Move tab", (index) => ({ ...index, tabs: moveTabRef(index.tabs, id, move) }));
}

// ── Doc settings ────────────────────────────────────────────────────────

export const renameDoc = (title: string) => (title.trim() ? editIndex("Rename doc", (i) => ({ ...i, title: title.trim().slice(0, 200) })) : Promise.resolve());
export const setFont = (which: "headings" | "text", font: FontChoice) => editIndex("Change font", (i) => ({ ...i, fonts: { ...i.fonts, [which]: font } }));
export const setWide = (wide: boolean) => editIndex(wide ? "Make page wide" : "Make page narrow", (i) => ({ ...i, wide }));

/** Add a dropdown from a template, or a new one; returns it as added. */
export async function addDropdown(from: { template: string } | { name: string; options: Dropdown["options"] }): Promise<Dropdown | null> {
  const doc = state.doc;
  if (!doc) return null;
  let dd: Dropdown | null;
  if ("template" in from) dd = dropdownFromTemplate(doc.index, from.template);
  else {
    const base = from.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "dropdown";
    let id = base;
    for (let i = 2; doc.index.dropdowns.some((d) => d.id === id); i++) id = `${base}-${i}`;
    dd = { id, name: from.name.trim().slice(0, 60) || "Dropdown", options: from.options };
  }
  if (!dd) return null;
  const made = dd;
  await editIndex("Add dropdown", (i) => ({ ...i, dropdowns: [...i.dropdowns, made] }));
  return made;
}

// ── Undo / redo ─────────────────────────────────────────────────────────

async function replay(step: Step, direction: "undo" | "redo"): Promise<boolean> {
  // Every file must still be as this step left it (or, for redo, as undo left it).
  for (const c of step.changes) {
    const expected = direction === "undo" ? c.after : c.before;
    const now = await api().read(c.rel);
    if (now !== expected) {
      toast(`Can’t ${direction} “${step.label.toLowerCase()}”: the doc was changed since (by the AI or another editor).`);
      return false;
    }
  }
  const changes = step.changes.map((c) => (direction === "undo" ? { rel: c.rel, before: c.after, after: c.before } : c));
  applyLocally(changes);
  await writeFiles(changes);
  return true;
}

export async function undo() {
  await flushTyping();
  const step = state.undo[state.undo.length - 1];
  if (!step) return;
  if (!(await replay(step, "undo"))) return setState({ undo: [], redo: [] });
  const doc = state.doc;
  const tab = step.tab && doc?.tabs.has(step.tab) ? step.tab : doc ? pickTab(doc, state.tab) : null;
  setState((s) => ({ undo: s.undo.slice(0, -1), redo: [...s.redo, step], tab, paint: s.paint + 1, caret: step.caret }));
}

export async function redo() {
  await flushTyping();
  const step = state.redo[state.redo.length - 1];
  if (!step) return;
  if (!(await replay(step, "redo"))) return setState({ undo: [], redo: [] });
  const doc = state.doc;
  const tab = step.tab && doc?.tabs.has(step.tab) ? step.tab : doc ? pickTab(doc, state.tab) : null;
  setState((s) => ({ redo: s.redo.slice(0, -1), undo: [...s.undo, step], tab, paint: s.paint + 1, caret: step.caret }));
}
