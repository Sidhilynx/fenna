// A doc folder: doc.json (title, the tree of tabs, fonts, dropdowns) and one
// HTML file per tab in tabs/. Loading never throws: a broken or missing
// piece becomes a problem the editor shows, and the rest still loads.

import { type Dropdown, type FontChoice, DROPDOWN_TEMPLATES, FONT_CHOICES, FORMAT, LEGACY_FORMAT, LIMITS, OPTION_COLORS, OPTION_ID_RE, type OptionColor, TAB_ID_RE } from "./schema.ts";
import { type Diagnostic, type DocContext, type ElementNode, loadTab, parseTab, serializeTab } from "./tab.ts";

export interface TabRef {
  id: string;
  /** The tab's title, shown in the tab list and as the page's title; "" until named. */
  title: string;
  children: TabRef[];
}

export interface DocIndex {
  format: typeof FORMAT;
  title: string;
  tabs: TabRef[];
  fonts: { headings: FontChoice; text: FontChoice };
  /** The page uses the window's width instead of a reading column. */
  wide: boolean;
  /** Suggesting mode: every edit, by a person or an AI, is saved as a suggestion to accept or reject. */
  suggesting: boolean;
  dropdowns: Dropdown[];
}

export interface LoadedTab {
  id: string;
  /** Null when the file is missing or can't be read as a tab. */
  tab: ElementNode | null;
  diagnostics: Diagnostic[];
  /** The file's text ("" when missing). */
  source: string;
}

export interface LoadedDoc {
  index: DocIndex;
  /** Every tab with a file or an entry, by id. */
  tabs: Map<string, LoadedTab>;
  problems: string[];
}

export interface DocReader {
  read(rel: string): Promise<string | null>;
  list(dir: string): Promise<string[]>;
}

export const tabFile = (id: string) => `tabs/${id}.html`;
export const TAB_FILE_RE = /^tabs\/([A-Za-z][A-Za-z0-9_-]{0,63})\.html$/;

export function emptyIndex(title = "Untitled"): DocIndex {
  return { format: FORMAT, title, tabs: [], fonts: { headings: "serif", text: "sans" }, wide: false, suggesting: false, dropdowns: [] };
}

export function docContext(index: Pick<DocIndex, "dropdowns">): DocContext {
  return { dropdowns: new Map(index.dropdowns.map((d) => [d.id, { name: d.name, options: new Map(d.options.map((o) => [o.id, o.label])) }])) };
}

// ── Checking doc.json ──────────────────────────────────────────────────

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

function checkDropdown(v: unknown, errors: string[]): Dropdown | null {
  const d = v as Partial<Dropdown> | null;
  if (!d || !isStr(d.id, 40) || !OPTION_ID_RE.test(d.id) || !isStr(d.name, 60) || !d.name.trim() || !Array.isArray(d.options)) {
    errors.push(`a dropdown needs an id (lowercase letters, digits, -), a name and options`);
    return null;
  }
  const seen = new Set<string>();
  const options = [];
  for (const o of d.options.slice(0, LIMITS.dropdownOptions)) {
    const opt = o as { id?: unknown; label?: unknown; color?: unknown } | null;
    if (!opt || !isStr(opt.id, 40) || !OPTION_ID_RE.test(opt.id) || seen.has(opt.id) || !isStr(opt.label, 60) || !opt.label.trim()) {
      errors.push(`dropdown "${d.id}": each option needs a unique id (lowercase letters, digits, -) and a label`);
      continue;
    }
    seen.add(opt.id);
    const color = OPTION_COLORS.includes(opt.color as OptionColor) ? (opt.color as OptionColor) : "gray";
    options.push({ id: opt.id, label: opt.label.trim(), color });
  }
  if (!options.length) {
    errors.push(`dropdown "${d.id}" has no options`);
    return null;
  }
  return { id: d.id, name: d.name.trim(), options };
}

function checkTabs(v: unknown, depth: number, seen: Set<string>, errors: string[]): TabRef[] {
  if (!Array.isArray(v)) {
    errors.push("tabs must be a list");
    return [];
  }
  const out: TabRef[] = [];
  for (const t of v) {
    const r = t as Partial<TabRef> | null;
    if (!r || !isStr(r.id, 64) || !TAB_ID_RE.test(r.id)) {
      errors.push(`a tab needs an id: a letter, then letters, digits, - or _`);
      continue;
    }
    if (seen.has(r.id)) {
      errors.push(`tab "${r.id}" is listed twice`);
      continue;
    }
    seen.add(r.id);
    const title = isStr(r.title, LIMITS.titleChars) ? r.title : "";
    let children: TabRef[] = [];
    if (r.children !== undefined) {
      if (depth >= LIMITS.tabDepth) errors.push(`tabs nest at most ${LIMITS.tabDepth} deep ("${r.id}")`);
      else children = checkTabs(r.children, depth + 1, seen, errors);
    }
    out.push({ id: r.id, title, children });
  }
  return out;
}

/** doc.json as stored, checked. With errors, `index` is null. */
export function checkIndex(raw: unknown): { index: DocIndex | null; errors: string[] } {
  const errors: string[] = [];
  const o = raw as Partial<DocIndex> | null;
  if (!o || typeof o !== "object") return { index: null, errors: ["doc.json must be an object"] };
  if (o.format !== undefined && o.format !== FORMAT && o.format !== LEGACY_FORMAT) errors.push(`format must be "${FORMAT}"`);
  if (!isStr(o.title, LIMITS.titleChars)) errors.push(`title must be text of at most ${LIMITS.titleChars} characters`);
  const seen = new Set<string>();
  const tabs = checkTabs(o.tabs ?? [], 1, seen, errors);
  if (seen.size > LIMITS.tabs) errors.push(`a doc has at most ${LIMITS.tabs} tabs`);
  const f = (o.fonts ?? {}) as Partial<DocIndex["fonts"]>;
  const fonts = { headings: FONT_CHOICES.includes(f.headings as FontChoice) ? (f.headings as FontChoice) : "serif", text: FONT_CHOICES.includes(f.text as FontChoice) ? (f.text as FontChoice) : "sans" };
  const dropdowns: Dropdown[] = [];
  if (o.dropdowns !== undefined && !Array.isArray(o.dropdowns)) errors.push("dropdowns must be a list");
  for (const d of (Array.isArray(o.dropdowns) ? o.dropdowns : []).slice(0, LIMITS.dropdowns)) {
    const c = checkDropdown(d, errors);
    if (c && dropdowns.some((x) => x.id === c.id)) errors.push(`dropdown "${c.id}" is listed twice`);
    else if (c) dropdowns.push(c);
  }
  if (errors.length) return { index: null, errors };
  return { index: { format: FORMAT, title: (o.title as string).trim() || "Untitled", tabs, fonts, wide: o.wide === true, suggesting: o.suggesting === true, dropdowns }, errors };
}

export const indexText = (index: DocIndex) => JSON.stringify(index, null, 2) + "\n";

// ── The tab tree ───────────────────────────────────────────────────────

export interface FlatTab {
  ref: TabRef;
  depth: number;
  parent: string | null;
}

/** Every tab in reading order, with its depth (0 = top level). */
export function flattenTabs(tabs: TabRef[], depth = 0, parent: string | null = null, out: FlatTab[] = []): FlatTab[] {
  for (const t of tabs) {
    out.push({ ref: t, depth, parent });
    flattenTabs(t.children, depth + 1, t.id, out);
  }
  return out;
}

export const tabIds = (tabs: TabRef[]) => flattenTabs(tabs).map((f) => f.ref.id);

export function findTab(tabs: TabRef[], id: string): TabRef | null {
  return flattenTabs(tabs).find((f) => f.ref.id === id)?.ref ?? null;
}

/** "Tab 3": what an unnamed tab is called, by its place in reading order. */
export function tabLabel(tabs: TabRef[], id: string): string {
  const flat = flattenTabs(tabs);
  const i = flat.findIndex((f) => f.ref.id === id);
  const t = flat[i]?.ref;
  return t?.title.trim() || `Tab ${i + 1}`;
}

/** A copy of the tree with `fn` applied to the list holding `id` (the top level, or a tab's children). */
function mapSiblings(tabs: TabRef[], id: string, fn: (list: TabRef[], at: number) => TabRef[]): TabRef[] {
  const at = tabs.findIndex((t) => t.id === id);
  if (at >= 0) return fn(tabs, at);
  return tabs.map((t) => ({ ...t, children: mapSiblings(t.children, id, fn) }));
}

const depthOf = (tabs: TabRef[], id: string) => flattenTabs(tabs).find((f) => f.ref.id === id)?.depth ?? -1;
const heightOf = (t: TabRef): number => (t.children.length ? 1 + Math.max(...t.children.map(heightOf)) : 1);

/** A new tab id from a title, unique in the doc. */
export function newTabId(tabs: TabRef[], title = "tab"): string {
  const taken = new Set(tabIds(tabs));
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "").slice(0, 40) || "tab";
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Add a tab: at the end, after a sibling, or as the last child of a parent. */
export function addTab(tabs: TabRef[], tab: TabRef, where: { after?: string; parent?: string } = {}): TabRef[] {
  if (where.parent) {
    if (depthOf(tabs, where.parent) + 1 >= LIMITS.tabDepth) throw new DocEditError(`tabs nest at most ${LIMITS.tabDepth} deep`);
    const add = (list: TabRef[]): TabRef[] => list.map((t) => (t.id === where.parent ? { ...t, children: [...t.children, tab] } : { ...t, children: add(t.children) }));
    return add(tabs);
  }
  if (where.after && findTab(tabs, where.after)) return mapSiblings(tabs, where.after, (list, at) => [...list.slice(0, at + 1), tab, ...list.slice(at + 1)]);
  return [...tabs, tab];
}

/** Remove a tab and everything under it; returns the new tree and every id removed. */
export function removeTab(tabs: TabRef[], id: string): { tabs: TabRef[]; removed: string[] } {
  const t = findTab(tabs, id);
  if (!t) return { tabs, removed: [] };
  const removed = tabIds([t]);
  const drop = (list: TabRef[]): TabRef[] => list.filter((x) => x.id !== id).map((x) => ({ ...x, children: drop(x.children) }));
  return { tabs: drop(tabs), removed };
}

export function renameTab(tabs: TabRef[], id: string, title: string): TabRef[] {
  const name = title.replace(/\s+/g, " ").trim().slice(0, LIMITS.titleChars);
  const map = (list: TabRef[]): TabRef[] => list.map((t) => (t.id === id ? { ...t, title: name } : { ...t, children: map(t.children) }));
  return map(tabs);
}

export type TabMove = "up" | "down" | "into" | "out";

/** Which moves make sense for a tab now (for menus: the rest are shown disabled). */
export function tabMoves(tabs: TabRef[], id: string): Record<TabMove, boolean> & { intoTitle: string | null } {
  const flat = flattenTabs(tabs);
  const me = flat.find((f) => f.ref.id === id);
  if (!me) return { up: false, down: false, into: false, out: false, intoTitle: null };
  const siblings = me.parent ? findTab(tabs, me.parent)!.children : tabs;
  const at = siblings.findIndex((t) => t.id === id);
  const prev = siblings[at - 1] ?? null;
  const canInto = !!prev && me.depth + heightOf(me.ref) < LIMITS.tabDepth;
  return { up: at > 0, down: at < siblings.length - 1, into: canInto, out: me.parent !== null, intoTitle: prev && canInto ? tabLabel(tabs, prev.id) : null };
}

/** Move a tab among its siblings, into the sibling before it (as its last child), or out one level. */
export function moveTab(tabs: TabRef[], id: string, move: TabMove): TabRef[] {
  const ok = tabMoves(tabs, id);
  if (!ok[move]) return tabs;
  const me = findTab(tabs, id)!;
  if (move === "up" || move === "down")
    return mapSiblings(tabs, id, (list, at) => {
      const to = move === "up" ? at - 1 : at + 1;
      const next = [...list];
      [next[at], next[to]] = [next[to]!, next[at]!];
      return next;
    });
  if (move === "into")
    return mapSiblings(tabs, id, (list, at) => {
      const prev = list[at - 1]!;
      return [...list.slice(0, at - 1), { ...prev, children: [...prev.children, me] }, ...list.slice(at + 1)];
    });
  // Out: after the parent, among the parent's siblings.
  const parent = flattenTabs(tabs).find((f) => f.ref.id === id)!.parent!;
  const without = removeTab(tabs, id).tabs;
  return addTab(without, me, { after: parent });
}

/** Replace the tab list in a new order, checking it lists the same tabs. */
export function sameTabs(a: TabRef[], b: TabRef[]): boolean {
  return [...tabIds(a)].sort().join() === [...tabIds(b)].sort().join();
}

export class DocEditError extends Error {}

// ── Loading ────────────────────────────────────────────────────────────

/** Read a whole doc folder. Tab files the index doesn't list are added at the end, so nothing is lost. */
export async function loadDoc(r: DocReader): Promise<LoadedDoc> {
  const problems: string[] = [];
  const text = await r.read("doc.json");
  let index = emptyIndex();
  if (text === null) problems.push("doc.json is missing; the tabs are shown in name order");
  else {
    let raw: unknown = null;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      problems.push(`doc.json is not valid JSON (${(e as Error).message})`);
    }
    if (raw !== null) {
      const c = checkIndex(raw);
      if (c.index) index = c.index;
      else problems.push(`doc.json has problems: ${c.errors.join("; ")}`);
    }
  }
  const files = (await r.list("tabs")).map((f) => /^([A-Za-z][A-Za-z0-9_-]{0,63})\.html$/.exec(f)?.[1]).filter((id): id is string => !!id);
  const listed = new Set(tabIds(index.tabs));
  const extra = files.filter((id) => !listed.has(id)).sort();
  if (extra.length) index = { ...index, tabs: [...index.tabs, ...extra.map((id) => ({ id, title: "", children: [] }))] };
  const ctx = docContext(index);
  const tabs = new Map<string, LoadedTab>();
  await Promise.all(
    tabIds(index.tabs).map(async (id) => {
      const source = await r.read(tabFile(id));
      if (source === null) {
        tabs.set(id, { id, tab: null, diagnostics: [{ severity: "error", code: "missing", message: `tabs/${id}.html is missing`, line: 1, col: 1, path: "" }], source: "" });
        return;
      }
      const p = loadTab(id, source, ctx);
      tabs.set(id, { id, tab: p.tab, diagnostics: p.diagnostics, source });
    }),
  );
  return { index, tabs, problems };
}

/** The files of a new doc: one empty tab. */
export function newDocFiles(title: string): { index: DocIndex; tabs: Record<string, string> } {
  const index = { ...emptyIndex(title.trim() || "Untitled"), tabs: [{ id: "tab-1", title: "", children: [] }] };
  return { index, tabs: { "tab-1": serializeTab({ type: "element", tag: "article", attrs: { id: "tab-1" }, children: [] }) } };
}

/** A dropdown template, with an id unique in the doc. */
export function dropdownFromTemplate(index: DocIndex, key: string): Dropdown | null {
  const t = DROPDOWN_TEMPLATES.find((d) => d.id === key);
  if (!t) return null;
  let id = t.id;
  for (let i = 2; index.dropdowns.some((d) => d.id === id); i++) id = `${t.id}-${i}`;
  return { ...t, id, options: t.options.map((o) => ({ ...o })) };
}
