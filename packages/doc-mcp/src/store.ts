// The doc on disk, as the MCP tools see it.
//
// Every write is checked first and lands all-or-nothing (temp file, then
// rename), so the app's watcher and a person editing by hand never see half
// a file. Each tab has a version (a hash of its text); a write that names
// the version it read is refused if the file changed since, so the AI never
// silently overwrites an edit the user just made.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { COMMENTS_FILE, MAX_COMMENT, type Thread, parseThreads, serializeThreads } from "@opendeck/shell/threads";
import {
  type DocAnchor,
  type Diagnostic,
  type DocIndex,
  type ElementNode,
  type FontChoice,
  type TabRef,
  FORMAT,
  MAX_QUOTE,
  docAnchor,
  TAB_ID_RE,
  addTab,
  checkIndex,
  docContext,
  emptyIndex,
  findTab,
  flattenTabs,
  indexText,
  loadDoc,
  parseTab,
  removeTab,
  renameTab,
  sameTabs,
  serializeTab,
  suggestTab,
  suggestionsOf,
  tabFile,
  tabLabel,
  textOf,
} from "@opendeck/doc";

export const versionOf = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 12);

export class StoreError extends Error {
  readonly diagnostics: Diagnostic[];

  constructor(message: string, diagnostics: Diagnostic[] = []) {
    super(message);
    this.diagnostics = diagnostics;
  }
}

export type BlockEdit =
  | { op: "replace"; block: string; html: string }
  | { op: "insert_after"; block: string; html: string }
  | { op: "insert_before"; block: string; html: string }
  | { op: "append"; html: string }
  | { op: "delete"; block: string }
  | { op: "replace_text"; find: string; with: string; block?: string; nth?: number };

/** One block as the tab file writes it (its line in read_tab's html). */
function blockHtml(tabId: string, b: ElementNode): string {
  const lines = serializeTab({ type: "element", tag: "article", attrs: { id: tabId }, children: [b] }).trimEnd().split("\n");
  return lines.slice(1, -1).join("\n");
}

/** Every place `find` occurs: which block, and where in its html. */
function occurrences(tabId: string, blocks: ElementNode[], find: string, only?: string) {
  const hits: { i: number; at: number }[] = [];
  blocks.forEach((b, i) => {
    if (only && b.attrs.id !== only) return;
    const html = blockHtml(tabId, b);
    for (let k = html.indexOf(find); k >= 0; k = html.indexOf(find, k + 1)) hits.push({ i, at: k });
  });
  return hits;
}

const VOID = new Set(["br", "img", "hr"]);

/** Whether every tag opened in an html fragment closes in it, in order (so a quote can't cut a mark in half). */
function balanced(html: string): boolean {
  const open: string[] = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g)) {
    const tag = m[2]!.toLowerCase();
    if (VOID.has(tag) || m[3]) continue;
    if (!m[1]) open.push(tag);
    else if (open.pop() !== tag) return false;
  }
  return open.length === 0;
}

/** Who an AI edit in Suggesting mode is from, and a fresh id for each suggestion. */
const suggester = () => ({ by: "ai", at: Date.now(), sid: () => `s${randomUUID().slice(0, 8)}` });

export type DocThread = Thread<DocAnchor>;

export interface CommentInput {
  /** Reply to this thread; or leave it out and give tab and block to start one. */
  thread?: string;
  tab?: string;
  block?: string;
  quote?: string;
  text?: string;
  resolve?: boolean;
}

const clip = (t: string, max: number) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

export class DocStore {
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
    const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, full);
  }

  load() {
    return loadDoc({ read: (p) => this.readText(p), list: (d) => readdir(this.file(d)).catch(() => []) });
  }

  /** The index as stored, or a fresh one named after the folder when there is none yet. */
  async index(): Promise<DocIndex> {
    const text = await this.readText("doc.json");
    if (text === null) return emptyIndex(path.basename(this.root));
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new StoreError(`doc.json is not valid JSON (${(e as Error).message}); fix it with update_doc`);
    }
    const r = checkIndex(raw);
    if (!r.index) throw new StoreError(`doc.json has problems: ${r.errors.join("; ")}`);
    return r.index;
  }

  async saveIndex(index: DocIndex) {
    const r = checkIndex(index);
    if (!r.index) throw new StoreError(`the doc settings were refused: ${r.errors.join("; ")}`);
    await this.writeText("doc.json", indexText(r.index));
  }

  /** Everything the AI needs to find its way: settings, and each tab with its outline. */
  async overview() {
    const doc = await this.load();
    const tabs = flattenTabs(doc.index.tabs).map((f) => {
      const t = doc.tabs.get(f.ref.id);
      const blocks = t?.tab ? (t.tab.children as ElementNode[]) : [];
      return {
        id: f.ref.id,
        title: tabLabel(doc.index.tabs, f.ref.id),
        depth: f.depth,
        parent: f.parent,
        blocks: blocks.length,
        words: blocks.reduce((n, b) => n + (textOf(b).match(/\S+/g)?.length ?? 0), 0),
        outline: blocks.filter((b) => /^h[1-3]$/.test(b.tag)).map((b) => ({ id: b.attrs.id, level: Number(b.tag[1]), text: clip(textOf(b), 80) })),
        openSuggestions: t?.tab ? suggestionsOf(t.tab).length : 0,
        problems: t?.diagnostics.filter((d) => d.severity === "error").map((d) => d.message) ?? [],
      };
    });
    const { tabs: _tree, ...settings } = doc.index;
    return { ...settings, tabs, problems: doc.problems };
  }

  async readTab(id: string) {
    if (!TAB_ID_RE.test(id)) throw new StoreError(`"${id}" is not a tab id`);
    const text = await this.readText(tabFile(id));
    if (text === null) throw new StoreError(`there is no tab "${id}"`);
    const index = await this.index().catch(() => emptyIndex());
    const r = parseTab(text, docContext(index));
    return { id, title: findTab(index.tabs, id) ? tabLabel(index.tabs, id) : "", version: versionOf(text), html: text, problems: r.diagnostics };
  }

  async check(html: string) {
    const index = await this.index().catch(() => emptyIndex());
    return parseTab(html, docContext(index));
  }

  private async current(id: string, expectedVersion?: string): Promise<string | null> {
    const current = await this.readText(tabFile(id));
    if (expectedVersion && current !== null && versionOf(current) !== expectedVersion)
      throw new StoreError(`tab "${id}" changed since you read it (the user edited it). Read it again and redo your change on the new version.`);
    if (expectedVersion && current === null) throw new StoreError(`tab "${id}" was deleted since you read it`);
    return current;
  }

  /** Create or replace a whole tab. New tabs go after `after`, or under `parent`, or at the end. */
  async writeTab(id: string, html: string, opts: { title?: string; after?: string; parent?: string; expectedVersion?: string } = {}) {
    if (!TAB_ID_RE.test(id)) throw new StoreError(`"${id}" is not a valid tab id (a letter, then letters, digits, - and _)`);
    const index = await this.index();
    const r = parseTab(html, docContext(index));
    if (r.tab && r.tab.attrs.id !== id) r.diagnostics.unshift({ severity: "error", code: "id-mismatch", message: `the <article> id must be "${id}"`, line: 1, col: 1, path: "article" });
    const errors = r.diagnostics.filter((d) => d.severity === "error");
    if (!r.tab || errors.length) throw new StoreError(`tab "${id}" was not saved: ${errors.length} problem${errors.length === 1 ? "" : "s"}`, errors);
    const current = await this.current(id, opts.expectedVersion);
    // In Suggesting mode the new text is saved as suggestions over the old (all of it, for a new tab).
    const old = current === null ? { ...r.tab, children: [] } : parseTab(current, docContext(index)).tab;
    const saved = index.suggesting && old ? suggestTab(old, r.tab, suggester()) : r.tab;
    const text = serializeTab(saved);
    await this.writeText(tabFile(id), text);
    let next = index;
    if (!findTab(index.tabs, id)) {
      try {
        next = { ...index, tabs: addTab(index.tabs, { id, title: opts.title ?? "", children: [] }, { after: opts.after, parent: opts.parent }) };
      } catch (e) {
        throw new StoreError((e as Error).message);
      }
    } else if (opts.title !== undefined) next = { ...index, tabs: renameTab(index.tabs, id, opts.title) };
    if (next !== index) await this.saveIndex(next);
    return { id, version: versionOf(text), created: current === null, suggested: index.suggesting, blocks: r.tab.children.map((b) => (b as ElementNode).attrs.id), warnings: r.diagnostics.filter((d) => d.severity === "warning") };
  }

  /** Change some blocks of a tab, leaving the rest exactly as they are. All edits land together or none do. */
  async editBlocks(id: string, edits: BlockEdit[], expectedVersion?: string) {
    const index = await this.index();
    const ctx = docContext(index);
    const current = await this.current(id, expectedVersion);
    if (current === null) throw new StoreError(`there is no tab "${id}" (create it with write_tab)`);
    const base = parseTab(current, ctx);
    if (!base.tab) throw new StoreError(`tab "${id}" can't be read; rewrite it whole with write_tab`, base.diagnostics);
    let blocks = [...(base.tab.children as ElementNode[])];
    const taken = new Set(blocks.map((b) => b.attrs.id!));
    const added: string[] = [];
    const parse = (html: string, n: number): ElementNode[] => {
      // Blocks are checked as a tab of their own; ids already in the tab are kept off new blocks unless replacing.
      const r = parseTab(`<article id="${id}">\n${html}\n</article>`, ctx);
      const errors = r.diagnostics.filter((d) => d.severity === "error").map((d) => ({ ...d, line: Math.max(1, d.line - 1), path: `edit ${n + 1}: ${d.path}` }));
      if (!r.tab || errors.length) throw new StoreError(`edit ${n + 1} was refused; nothing was saved`, errors);
      if (!r.tab.children.length) throw new StoreError(`edit ${n + 1} has no blocks; to remove a block use op "delete"`);
      return r.tab.children as ElementNode[];
    };
    const at = (block: string, n: number) => {
      const i = blocks.findIndex((b) => b.attrs.id === block);
      if (i < 0) throw new StoreError(`edit ${n + 1}: there is no block "${block}" in tab "${id}" (read_tab shows the ids); nothing was saved`);
      return i;
    };
    const fresh = (list: ElementNode[], keep: string | null) =>
      list.map((b) => {
        let bid = b.attrs.id!;
        if (bid !== keep && taken.has(bid)) {
          let k = 2;
          while (taken.has(`${bid}-${k}`)) k++;
          bid = `${bid}-${k}`;
        }
        taken.add(bid);
        added.push(bid);
        return { ...b, attrs: { ...b.attrs, id: bid } };
      });
    edits.forEach((e, n) => {
      if (e.op === "delete") {
        blocks.splice(at(e.block, n), 1);
        return;
      }
      if (e.op === "replace_text") {
        if (e.block) at(e.block, n);
        if (!balanced(e.find) || !balanced(e.with))
          throw new StoreError(`edit ${n + 1}: find and with must each be whole: every tag opened in them closes in them (quote "<b>one HTML file</b>", not "one HTML file</b>"); nothing was saved`);
        const where = e.block ? `block "${e.block}"` : `tab "${id}"`;
        const hits = occurrences(id, blocks, e.find, e.block);
        if (!hits.length)
          throw new StoreError(
            `edit ${n + 1}: "${clip(e.find, 80)}" is not in ${where}; nothing was saved. Quote the html exactly as read_tab shows it, inside one block (tags such as <b> included), or read the tab again: it may have changed.`,
          );
        if (hits.length > 1 && !e.nth) {
          const ids = [...new Set(hits.map((h) => blocks[h.i]!.attrs.id))].join(", ");
          throw new StoreError(`edit ${n + 1}: "${clip(e.find, 80)}" appears ${hits.length} times (blocks ${ids}); nothing was saved. Quote more of the words around it, name the block, or pass nth (1 is the first).`);
        }
        const hit = hits[(e.nth ?? 1) - 1];
        if (!hit) throw new StoreError(`edit ${n + 1}: nth is ${e.nth} but "${clip(e.find, 80)}" appears only ${hits.length} time${hits.length === 1 ? "" : "s"} in ${where}; nothing was saved`);
        const old = blocks[hit.i]!;
        const html = blockHtml(id, old);
        const list = parse(html.slice(0, hit.at) + e.with + html.slice(hit.at + e.find.length), n);
        // The block keeps its id, so comments on it stay put.
        const keep = old.attrs.id!;
        taken.delete(keep);
        blocks.splice(hit.i, 1, ...fresh([{ ...list[0]!, attrs: { ...list[0]!.attrs, id: keep } }, ...list.slice(1)], keep));
        return;
      }
      const list = parse(e.html, n);
      if (e.op === "append") blocks = [...blocks, ...fresh(list, null)];
      else if (e.op === "replace") {
        const i = at(e.block, n);
        // The first new block keeps the replaced block's id, so comments on it stay put.
        const first = list[0]!;
        taken.delete(e.block);
        const kept = fresh([{ ...first, attrs: { ...first.attrs, id: e.block } }, ...list.slice(1)], e.block);
        blocks.splice(i, 1, ...kept);
      } else {
        const i = at(e.block, n);
        blocks.splice(e.op === "insert_after" ? i + 1 : i, 0, ...fresh(list, null));
      }
    });
    const edited = { ...base.tab, children: blocks };
    const tab = index.suggesting ? suggestTab(base.tab, edited, suggester()) : edited;
    const text = serializeTab(tab);
    const check = parseTab(text, ctx);
    const errors = check.diagnostics.filter((d) => d.severity === "error");
    if (errors.length) throw new StoreError(`the edited tab would have problems; nothing was saved`, errors);
    await this.writeText(tabFile(id), text);
    return { id, version: versionOf(text), changed: added, blocks: tab.children.length, suggested: index.suggesting };
  }

  async deleteTab(id: string) {
    const index = await this.index();
    if (!findTab(index.tabs, id)) throw new StoreError(`there is no tab "${id}"`);
    const r = removeTab(index.tabs, id);
    if (!r.tabs.length) throw new StoreError("a doc keeps at least one tab");
    await this.saveIndex({ ...index, tabs: r.tabs });
    for (const t of r.removed) await rm(this.file(tabFile(t)), { force: true });
    return r.removed;
  }

  private async threads(): Promise<DocThread[]> {
    return parseThreads(await this.readText(COMMENTS_FILE), docAnchor);
  }

  /** Comment threads, oldest first: on one tab or all, open ones unless resolved are asked for too. */
  async readComments(tab?: string, includeResolved = false) {
    const index = await this.index();
    if (tab && !findTab(index.tabs, tab)) throw new StoreError(`there is no tab "${tab}" (doc_overview lists them)`);
    return (await this.threads())
      .filter((t) => (!tab || t.tab === tab) && (includeResolved || !t.resolved))
      .map((t) => ({
        thread: t.id,
        tab: t.tab,
        block: t.block,
        quote: t.quote,
        resolved: t.resolved,
        comments: t.comments.map((c) => ({ by: c.author === "you" ? "user" : "assistant", text: c.text, at: new Date(c.at).toISOString() })),
      }));
  }

  /** Reply to a thread (and resolve it, if asked), or start one on a block and the words in it. */
  async comment(input: CommentInput) {
    const text = (input.text ?? "").trim();
    if (!text && !(input.thread && input.resolve)) throw new StoreError("text is empty: write the comment, or pass resolve: true with a thread to only resolve it");
    if (text.length > MAX_COMMENT) throw new StoreError(`the comment is ${text.length} characters; the most is ${MAX_COMMENT}`);
    const threads = await this.threads();
    const now = Date.now();
    const said = text ? [{ id: randomUUID().slice(0, 12), author: "ai" as const, text, at: now }] : [];
    let thread: DocThread;
    if (input.thread) {
      const found = threads.find((t) => t.id === input.thread);
      if (!found) throw new StoreError(`there is no thread "${input.thread}" (read_comments lists them)`);
      thread = { ...found, resolved: input.resolve ? true : found.resolved, comments: [...found.comments, ...said] };
      threads.splice(threads.indexOf(found), 1, thread);
    } else {
      if (!input.tab || !input.block) throw new StoreError("to start a thread give tab and block (read_tab shows block ids); to reply give thread");
      if (!TAB_ID_RE.test(input.tab)) throw new StoreError(`"${input.tab}" is not a tab id`);
      const source = await this.readText(tabFile(input.tab));
      if (source === null) throw new StoreError(`there is no tab "${input.tab}" (doc_overview lists them)`);
      const { tab } = parseTab(source, docContext(await this.index()));
      const block = (tab?.children as ElementNode[] | undefined)?.find((b) => b.attrs.id === input.block);
      if (!block) throw new StoreError(`there is no block "${input.block}" in tab "${input.tab}" (read_tab shows the ids)`);
      const quote = (input.quote ?? "").trim();
      if (quote.length > MAX_QUOTE) throw new StoreError(`quote is ${quote.length} characters; the most is ${MAX_QUOTE}. Quote a few words, not the passage`);
      if (quote && !textOf(block).includes(quote)) throw new StoreError(`quote "${clip(quote, 80)}" is not in block "${input.block}". Quote the words exactly as they read (plain text, no tags), or leave quote out to comment on the whole block`);
      thread = { id: randomUUID().slice(0, 12), tab: input.tab, block: input.block, quote, resolved: !!input.resolve, comments: said };
      threads.push(thread);
    }
    await this.writeText(COMMENTS_FILE, serializeThreads(threads));
    return { thread: thread.id, comments: thread.comments.length, resolved: thread.resolved };
  }

  /** Change the doc's settings; `tabs` sets titles and order (every tab listed once, nested as wanted). */
  async updateDoc(patch: { title?: string; fonts?: { headings?: FontChoice; text?: FontChoice }; wide?: boolean; dropdowns?: DocIndex["dropdowns"]; tabs?: TabRef[] }) {
    const index = await this.index();
    if (patch.tabs && !sameTabs(patch.tabs, index.tabs)) throw new StoreError("tabs must list every tab exactly once (doc_overview gives the ids); to add a tab use write_tab, to remove one delete_tab");
    const next: DocIndex = {
      ...index,
      format: FORMAT,
      title: patch.title ?? index.title,
      fonts: { ...index.fonts, ...patch.fonts },
      wide: patch.wide ?? index.wide,
      dropdowns: patch.dropdowns ?? index.dropdowns,
      tabs: patch.tabs ?? index.tabs,
    };
    const r = checkIndex(next);
    if (!r.index) throw new StoreError(`not saved: ${r.errors.join("; ")}`);
    // A dropdown change may not break a tab that uses it.
    if (patch.dropdowns) {
      const ctx = docContext(r.index);
      const broken: string[] = [];
      for (const f of flattenTabs(r.index.tabs)) {
        const text = await this.readText(tabFile(f.ref.id));
        if (text === null) continue;
        const after = parseTab(text, ctx);
        if (parseTab(text, docContext(index)).ok && !after.ok) broken.push(`${f.ref.id}: ${after.diagnostics.find((d) => d.severity === "error")?.message}`);
      }
      if (broken.length) throw new StoreError(`not saved: this would break tabs — ${broken.join("; ")}`);
    }
    await this.saveIndex(r.index);
    return r.index;
  }
}
