// The deck on disk, as the MCP tools see it.
//
// Every write is checked first and lands all-or-nothing (temp file, then
// rename), so the app's watcher and a person editing by hand never see half
// a file. Each slide has a version (a hash of its text); a write that names
// the version it read is refused if the file changed since, so the AI never
// silently overwrites an edit someone just made.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { COMMENTS_FILE, MAX_COMMENT, type Thread, parseThreads, serializeThreads } from "@opendeck/shell/threads";
import {
  type DeckIndex,
  type Diagnostic,
  type ElementNode,
  type LoadedDeck,
  type SlideAnchor,
  FORMAT,
  ID_RE,
  anchorOf,
  checkIndex,
  emptyIndex,
  findByWords,
  getAt,
  loadDeck,
  parseSlide,
  placeSlide,
  unplaceSlides,
  serializeSlide,
  slideAnchor,
  snippetOf,
  valueContext,
  wordsOf,
} from "@opendeck/format";

export const versionOf = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 12);

export type SlideThread = Thread<SlideAnchor>;

/** One change to a slide's HTML: replace an exact run of text, the way a file editor does. */
export interface TextEdit {
  find: string;
  with: string;
  /** Which match, when `find` appears more than once (1 is the first). */
  nth?: number;
}

export interface CommentInput {
  /** Reply to this thread; or leave it out and give slide (and quote) to start one. */
  thread?: string;
  slide?: string;
  /** Words of the element to comment on, as they read on the slide; none: the whole slide. */
  quote?: string;
  text?: string;
  resolve?: boolean;
}

const clip = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

/** Every place `find` starts in `text`. */
function occurrences(text: string, find: string): number[] {
  const at: number[] = [];
  for (let i = text.indexOf(find); i >= 0; i = text.indexOf(find, i + find.length)) at.push(i);
  return at;
}

export class StoreError extends Error {
  readonly diagnostics: Diagnostic[];

  constructor(message: string, diagnostics: Diagnostic[] = []) {
    super(message);
    this.diagnostics = diagnostics;
  }
}

export interface SlideSummary {
  n: number;
  id: string;
  title: string;
  hidden: boolean;
  errors: number;
  warnings: number;
}

export class DeckStore {
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

  async load(): Promise<LoadedDeck> {
    return loadDeck({
      read: (p) => this.readText(p),
      list: (d) => readdir(this.file(d)).catch(() => []),
    });
  }

  /** The index as stored, or a fresh one named after the folder when there is none yet. */
  async index(): Promise<DeckIndex> {
    const text = await this.readText("deck.json");
    if (text === null) return emptyIndex(path.basename(this.root));
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new StoreError(`deck.json is not valid JSON (${(e as Error).message}); fix it with update_deck`);
    }
    const r = checkIndex(raw);
    if (!r.index) throw new StoreError(`deck.json has problems: ${r.errors.join("; ")}`);
    return r.index;
  }

  async saveIndex(index: DeckIndex) {
    const r = checkIndex(index);
    if (!r.index) throw new StoreError(`the deck settings were refused: ${r.errors.join("; ")}`);
    await this.writeText("deck.json", JSON.stringify(r.index, null, 2) + "\n");
  }

  async summaries(): Promise<{ deck: LoadedDeck; slides: SlideSummary[] }> {
    const deck = await this.load();
    const slides = deck.slides.map((s, i) => ({
      n: i + 1,
      id: s.id,
      title: s.slide ? titleOf(s.slide) : "",
      hidden: s.slide?.attrs.hidden !== undefined,
      errors: s.diagnostics.filter((d) => d.severity === "error").length,
      warnings: s.diagnostics.filter((d) => d.severity === "warning").length,
    }));
    return { deck, slides };
  }

  async readSlide(id: string) {
    if (!ID_RE.test(id)) throw new StoreError(`"${id}" is not a slide id`);
    const text = await this.readText(`slides/${id}.html`);
    if (text === null) throw new StoreError(`there is no slide "${id}"`);
    const index = await this.index().catch(() => emptyIndex());
    const r = parseSlide(text, valueContext(index));
    return { id, version: versionOf(text), html: text, diagnostics: r.diagnostics };
  }

  /** Check a slide without saving it. */
  async check(html: string) {
    const index = await this.index().catch(() => emptyIndex());
    return parseSlide(html, valueContext(index));
  }

  /**
   * Save one slide. New ids are added to the deck after `after` (a slide id,
   * "start", or the end by default). Returns the saved version and any warnings.
   */
  async writeSlide(id: string, html: string, opts: { after?: string; expectedVersion?: string } = {}) {
    if (!ID_RE.test(id)) throw new StoreError(`"${id}" is not a valid slide id (letters first, then letters, digits, - and _)`);
    const index = await this.index();
    const r = parseSlide(html, valueContext(index));
    if (r.slide && r.slide.attrs.id !== id)
      r.diagnostics.unshift({ severity: "error", code: "id-mismatch", message: `the <section> id must be "${id}"`, line: r.slide.line, col: r.slide.col, path: "section" });
    const errors = r.diagnostics.filter((d) => d.severity === "error");
    if (!r.slide || errors.length) throw new StoreError(`slide "${id}" was not saved: ${errors.length} problem${errors.length === 1 ? "" : "s"}`, errors);

    const current = await this.readText(`slides/${id}.html`);
    if (opts.expectedVersion && current !== null && versionOf(current) !== opts.expectedVersion)
      throw new StoreError(`slide "${id}" changed since you read it (someone edited it). Read it again and redo your change on the new version.`);
    if (opts.expectedVersion && current === null) throw new StoreError(`slide "${id}" was deleted since you read it`);

    const text = serializeSlide(r.slide);
    await this.writeText(`slides/${id}.html`, text);

    if (!index.slides.includes(id)) {
      const at = opts.after === "start" ? 0 : opts.after && index.slides.includes(opts.after) ? index.slides.indexOf(opts.after) + 1 : index.slides.length;
      await this.saveIndex(placeSlide(index, id, at));
    }
    return { id, version: versionOf(text), created: current === null, warnings: r.diagnostics.filter((d) => d.severity === "warning") };
  }

  /**
   * Change part of a slide: each edit replaces one exact run of its HTML, as
   * read_slides shows it, in order. All land together, checked as one write,
   * or none do.
   */
  async editSlide(id: string, edits: TextEdit[], expectedVersion?: string) {
    if (!ID_RE.test(id)) throw new StoreError(`"${id}" is not a slide id (deck_overview lists them)`);
    const current = await this.readText(`slides/${id}.html`);
    if (current === null) throw new StoreError(`there is no slide "${id}" (deck_overview lists them; write_slide adds one)`);
    if (expectedVersion && versionOf(current) !== expectedVersion)
      throw new StoreError(`slide "${id}" changed since you read it (someone edited it). Read it again and redo your change on the new version.`);
    let text = current;
    edits.forEach((e, i) => {
      const which = edits.length > 1 ? `edit ${i + 1}: ` : "";
      const at = occurrences(text, e.find);
      if (!e.find || !at.length)
        throw new StoreError(`${which}"${clip(e.find, 80)}" is not in slide "${id}"${i ? " (after the edits before it)" : ""}. Copy it exactly from read_slides: tags, attributes, quotes and spaces as they are there. Nothing was saved.`);
      if (e.nth === undefined && at.length > 1)
        throw new StoreError(`${which}"${clip(e.find, 80)}" appears ${at.length} times in slide "${id}". Quote more around it so it is unique, or pass nth (1 to ${at.length}). Nothing was saved.`);
      const pos = at[(e.nth ?? 1) - 1];
      if (pos === undefined) throw new StoreError(`${which}nth is ${e.nth}, but "${clip(e.find, 80)}" appears ${at.length} time${at.length === 1 ? "" : "s"}. Nothing was saved.`);
      text = text.slice(0, pos) + e.with + text.slice(pos + e.find.length);
    });
    return this.writeSlide(id, text, { expectedVersion: versionOf(current) });
  }

  private async parsedSlide(id: string): Promise<ElementNode> {
    const r = await this.readSlide(id);
    const slide = (await this.check(r.html)).slide;
    if (!slide) throw new StoreError(`slide "${id}" can't be read as a slide; fix it with write_slide first`);
    return slide;
  }

  private async threads(): Promise<SlideThread[]> {
    return parseThreads(await this.readText(COMMENTS_FILE), slideAnchor);
  }

  /** Open threads on slides that still exist, by slide. */
  async openComments(): Promise<Record<string, number>> {
    const index = await this.index().catch(() => emptyIndex());
    const out: Record<string, number> = {};
    for (const t of await this.threads()) if (!t.resolved && index.slides.includes(t.slide)) out[t.slide] = (out[t.slide] ?? 0) + 1;
    return out;
  }

  /** Comment threads, in deck order: on one slide or all, open ones unless resolved are asked for too. */
  async readComments(slide?: string, includeResolved = false) {
    if (slide !== undefined && !ID_RE.test(slide)) throw new StoreError(`"${slide}" is not a slide id (deck_overview lists them)`);
    const deck = await this.load();
    const order = new Map(deck.slides.map((s, i) => [s.id, { n: i + 1, slide: s.slide }]));
    if (slide !== undefined && !order.has(slide)) throw new StoreError(`there is no slide "${slide}" (deck_overview lists them)`);
    return (await this.threads())
      .filter((t) => order.has(t.slide) && (slide === undefined || t.slide === slide) && (includeResolved || !t.resolved))
      .sort((a, b) => order.get(a.slide)!.n - order.get(b.slide)!.n)
      .map((t) => {
        const s = order.get(t.slide)!;
        const addr = s.slide ? anchorOf(s.slide, t) : "";
        const el = s.slide && addr ? getAt(s.slide, addr) : null;
        return {
          thread: t.id,
          slide: t.slide,
          n: s.n,
          on: el ? { element: el.tag, words: clip(wordsOf(el), 200) } : "the whole slide",
          resolved: t.resolved,
          comments: t.comments.map((c) => ({ by: c.author === "you" ? "user" : "assistant", text: c.text, at: new Date(c.at).toISOString() })),
        };
      });
  }

  /** Reply to a thread (and resolve it, if asked), or start one on a slide or an element on it. */
  async comment(input: CommentInput) {
    const text = (input.text ?? "").trim();
    if (!text && !(input.thread && input.resolve)) throw new StoreError("text is empty: write the comment, or pass resolve: true with a thread to only resolve it");
    if (text.length > MAX_COMMENT) throw new StoreError(`the comment is ${text.length} characters; the most is ${MAX_COMMENT}`);
    const threads = await this.threads();
    const said = text ? [{ id: randomUUID().slice(0, 12), author: "ai" as const, text, at: Date.now() }] : [];
    let thread: SlideThread;
    if (input.thread) {
      const found = threads.find((t) => t.id === input.thread);
      if (!found) throw new StoreError(`there is no thread "${input.thread}" (read_comments lists them)`);
      thread = { ...found, resolved: input.resolve ? true : found.resolved, comments: [...found.comments, ...said] };
      threads.splice(threads.indexOf(found), 1, thread);
    } else {
      if (!input.slide) throw new StoreError("to start a thread give slide (and quote, to point at one element on it); to reply give thread");
      const slide = await this.parsedSlide(input.slide);
      let addr = "";
      if (input.quote?.trim()) {
        const hits = findByWords(slide, input.quote);
        if (!hits.length)
          throw new StoreError(`no element on slide "${input.slide}" reads "${clip(input.quote, 80)}". Quote words as they read on the slide (plain text, no tags), or leave quote out to comment on the whole slide`);
        if (hits.length > 1)
          throw new StoreError(`"${clip(input.quote, 80)}" is in ${hits.length} elements on slide "${input.slide}": ${hits.map((a) => `"${clip(wordsOf(getAt(slide, a)!), 50)}"`).join(", ")}. Quote more of the one you mean`);
        addr = hits[0]!;
      }
      const el = addr ? getAt(slide, addr) : null;
      thread = { id: randomUUID().slice(0, 12), slide: input.slide, addr, snippet: el ? snippetOf(el) : "", resolved: !!input.resolve, comments: said };
      threads.push(thread);
    }
    await this.writeText(COMMENTS_FILE, serializeThreads(threads));
    return { thread: thread.id, comments: thread.comments.length, resolved: thread.resolved };
  }

  async deleteSlides(ids: string[]) {
    const index = await this.index();
    for (const id of ids) if (!ID_RE.test(id)) throw new StoreError(`"${id}" is not a slide id`);
    const missing = ids.filter((id) => !index.slides.includes(id));
    if (missing.length) throw new StoreError(`no such slide: ${missing.join(", ")}`);
    await this.saveIndex(unplaceSlides(index, ids));
    for (const id of ids) await rm(this.file(`slides/${id}.html`), { force: true });
  }

  async arrange(order: string[]) {
    const index = await this.index();
    const a = [...order].sort().join();
    const b = [...index.slides].sort().join();
    if (a !== b) throw new StoreError("the new order must list every slide exactly once (call deck_overview for the ids)");
    index.slides = order;
    await this.saveIndex(index);
  }

  /** Change deck settings; refused if any slide would stop being valid (e.g. a theme color it uses is removed). */
  async updateDeck(patch: Partial<Pick<DeckIndex, "title" | "sections">> & { theme?: Partial<DeckIndex["theme"]> }) {
    const index = await this.index();
    const next: DeckIndex = {
      ...index,
      format: FORMAT,
      title: patch.title ?? index.title,
      sections: patch.sections ?? index.sections,
      theme: { ...index.theme, ...patch.theme },
    };
    const r = checkIndex(next);
    if (!r.index) throw new StoreError(`not saved: ${r.errors.join("; ")}`);
    const ctx = valueContext(r.index);
    const broken: string[] = [];
    for (const id of r.index.slides) {
      const text = await this.readText(`slides/${id}.html`);
      if (text === null) continue;
      const before = parseSlide(text, valueContext(index)).ok;
      const after = parseSlide(text, ctx);
      if (before && !after.ok) broken.push(`${id}: ${after.diagnostics.find((d) => d.severity === "error")?.message}`);
    }
    if (broken.length) throw new StoreError(`not saved: this change would break slides — ${broken.join("; ")}`);
    await this.saveIndex(r.index);
    return r.index;
  }
}

export function titleOf(slide: ElementNode): string {
  const find = (n: ElementNode): ElementNode | null => {
    for (const c of n.children) {
      if (c.type !== "element") continue;
      if (["h1", "h2", "h3"].includes(c.tag)) return c;
      const deeper = find(c);
      if (deeper) return deeper;
    }
    return null;
  };
  return clip(wordsOf(find(slide) ?? slide), 80);
}
