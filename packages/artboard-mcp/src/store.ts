// The design on disk, as the MCP tools see it.
//
// Every write is checked first and lands all-or-nothing (temp file, then
// rename), so the app's watcher and a person editing by hand never see half
// a file. Each artboard has a version (a hash of its file); a write that
// names the version it read is refused if the file changed since, so the AI
// never silently overwrites an edit someone just made. A file that can't be
// read as an artboard is only ever replaced by a whole, valid one.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { COMMENTS_FILE, MAX_COMMENT, type Thread, parseThreads, serializeThreads } from "@opendeck/shell/threads";
import { anchorOf, findByWords, getAt, px, snippetOf, wordsOf } from "@opendeck/format";
import {
  type ArtboardDoc,
  type DesignAnchor,
  type DesignBoard,
  type DesignIndex,
  type DesignPage,
  type Diagnostic,
  type ElementNode,
  FILE_RE,
  LIMITS,
  TWEAK_RE,
  checkIndex,
  designAnchor,
  designContext,
  emptyIndex,
  indexText,
  layerLabel,
  newPageId,
  parseArtboard,
  parseNotes,
  placeBeside,
  serializeArtboard,
  serializeBlock,
  sizeRoot,
  styleOf,
  textStyleProblem,
  themeOf,
  tweakProblem,
} from "@opendeck/artboard";

export const versionOf = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 12);

export type DesignThread = Thread<DesignAnchor>;

/** One change to an artboard's HTML: replace an exact run of text, the way a file editor does. */
export interface TextEdit {
  find: string;
  with: string;
  /** Which match, when `find` appears more than once (1 is the first). */
  nth?: number;
}

export interface Placement {
  title?: string;
  /** A page's id or its name. */
  page?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  expand?: "fit" | "fill";
  /** The artboard file this one comes after in the order, or "start". */
  after?: string;
  expectedVersion?: string;
}

export interface CommentInput {
  thread?: string;
  file?: string;
  /** Words of the layer to comment on, as they read on the artboard; none: the whole artboard. */
  quote?: string;
  text?: string;
  resolve?: boolean;
}

export interface DesignPatch {
  title?: string;
  /** The full list of pages, in order; one without an id is new. */
  pages?: { id?: string; name: string }[];
  /** Tweaks to set (null removes one); the others stay. */
  tweaks?: Record<string, string | null>;
  /** Text styles to set (null removes one); the others stay. */
  textStyles?: Record<string, string | null>;
}

const clip = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

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

export class DesignStore {
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

  /** design.json as stored, or a fresh one named after the folder when there is none yet. */
  async index(): Promise<DesignIndex> {
    const text = await this.readText("design.json");
    if (text === null) return emptyIndex(path.basename(this.root));
    try {
      return checkIndex(JSON.parse(text), path.basename(this.root)).index;
    } catch (e) {
      throw new StoreError(`design.json is not valid JSON (${(e as Error).message}). It was left as it is; ask the user to fix or restore it`);
    }
  }

  private saveIndex(index: DesignIndex) {
    return this.writeText("design.json", indexText(index));
  }

  /** `name` as an artboard's file name ("Card" and "card.html" both find Card.html). */
  private fileName(name: string, index: DesignIndex, mustExist: boolean): string {
    const wanted = name.trim().replace(/^artboards\//, "");
    const withExt = /\.html$/i.test(wanted) ? wanted : `${wanted}.html`;
    const found = Object.keys(index.boards).find((f) => f === withExt) ?? Object.keys(index.boards).find((f) => f.toLowerCase() === withExt.toLowerCase());
    if (found) return found;
    if (mustExist) throw new StoreError(`there is no artboard "${name}". The artboards are: ${index.order.join(", ") || "(none yet)"}`);
    if (!FILE_RE.test(withExt)) throw new StoreError(`"${name}" can't be a file name: use letters, digits, - and _, like "Pricing.html"`);
    return withExt;
  }

  private page(wanted: string, index: DesignIndex): DesignPage {
    const page = index.pages.find((p) => p.id === wanted) ?? index.pages.find((p) => p.name.toLowerCase() === wanted.trim().toLowerCase());
    if (!page) throw new StoreError(`there is no page "${wanted}". The pages are: ${index.pages.map((p) => `${p.id} ("${p.name}")`).join(", ")}. update_design adds one`);
    return page;
  }

  private async threads(): Promise<DesignThread[]> {
    return parseThreads(await this.readText(COMMENTS_FILE), designAnchor);
  }

  async overview() {
    const index = await this.index();
    const open: Record<string, number> = {};
    for (const t of await this.threads()) if (!t.resolved && t.file in index.boards) open[t.file] = (open[t.file] ?? 0) + 1;
    const ctx = designContext(index);
    const artboards = [];
    for (const file of index.order) {
      const b = index.boards[file]!;
      const text = await this.readText(`artboards/${file}`);
      const ds = text === null ? null : parseArtboard(text, ctx).diagnostics;
      artboards.push({
        file,
        title: b.title,
        page: b.page,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        ...(b.expand ? { expand: b.expand } : {}),
        comments: open[file] ?? 0,
        ...(ds === null ? { missing: true } : { errors: ds.filter((d) => d.severity === "error").length, warnings: ds.filter((d) => d.severity === "warning").length }),
      });
    }
    const notes = parseNotes(await this.readText("notes.json"), index.pages[0]!.id).items;
    return { title: index.title, pages: index.pages, artboards, tweaks: index.tweaks, textStyles: index.textStyles, fonts: index.fonts, stickyNotes: notes.filter((n) => n.kind === "sticky").map((n) => ({ page: n.page, text: clip(n.text, 200) })) };
  }

  /**
   * The text of an artboard as the tools show and edit it: its root element,
   * indented as the file has it. A file that can't be read is shown whole.
   */
  private editable(text: string, index: DesignIndex): { html: string; doc: ArtboardDoc | null; diagnostics: Diagnostic[] } {
    const r = parseArtboard(text, designContext(index));
    return r.ok && r.doc ? { html: serializeBlock(r.doc.root), doc: r.doc, diagnostics: r.diagnostics } : { html: text.trimEnd(), doc: null, diagnostics: r.diagnostics };
  }

  async readArtboard(name: string) {
    const index = await this.index();
    const file = this.fileName(name, index, true);
    const text = await this.readText(`artboards/${file}`);
    if (text === null) throw new StoreError(`artboards/${file} is missing from the folder; write_artboard makes it again`);
    return { file, board: index.boards[file]!, version: versionOf(text), ...this.editable(text, index) };
  }

  /** Check artboard HTML without saving it. */
  async check(html: string) {
    return parseArtboard(html, designContext(await this.index()));
  }

  /**
   * Save one artboard whole. A new file is placed on a page beside the others
   * (or where `x`, `y` say); its size is `w`×`h`, or the root's own width and
   * height. The file is written in the format's one form, with the design's
   * tweaks and text styles in its head.
   */
  async writeArtboard(name: string, html: string, opts: Placement = {}) {
    const index = await this.index();
    const file = this.fileName(name, index, false);
    const had = index.boards[file];
    if (!had && index.order.length >= LIMITS.maxArtboards) throw new StoreError(`a design holds at most ${LIMITS.maxArtboards} artboards; delete one first`);
    const r = parseArtboard(html, designContext(index));
    const errors = r.diagnostics.filter((d) => d.severity === "error");
    if (!r.doc || errors.length) throw new StoreError(`"${file}" was not saved: ${plural(errors.length, "problem")}. Fix ${errors.length === 1 ? "it" : "them"} and write again`, errors);

    const current = await this.readText(`artboards/${file}`);
    if (opts.expectedVersion && current === null) throw new StoreError(`"${file}" was deleted since you read it`);
    if (opts.expectedVersion && current !== null && versionOf(current) !== opts.expectedVersion)
      throw new StoreError(`"${file}" changed since you read it (someone edited it). Read it again with read_artboards and redo your change on the new version`);

    const side = (given: number | undefined, prop: "width" | "height", was: number | undefined, dflt: number) => {
      const own = px(styleOf(r.doc!.root, prop) ?? "");
      const v = given ?? (own !== null && own > 0 ? own : (was ?? dflt));
      return Math.min(LIMITS.maxSize, Math.max(LIMITS.minSize, Math.round(v)));
    };
    const expand = opts.expand ?? had?.expand;
    const w = side(opts.w, "width", had?.w, 800);
    const h = side(opts.h, "height", had?.h, 600);
    const root = sizeRoot(r.doc.root, w, h, expand === "fill");
    const page = opts.page !== undefined ? this.page(opts.page, index).id : (had?.page ?? index.pages[0]!.id);
    const spot = opts.x !== undefined && opts.y !== undefined ? { x: Math.round(opts.x), y: Math.round(opts.y) } : had && page === had.page ? { x: opts.x ?? had.x, y: opts.y ?? had.y } : placeBeside(index, page, w, h);
    const title = (opts.title ?? had?.title ?? (r.doc.title || file.replace(/\.html$/i, ""))).trim().slice(0, LIMITS.titleChars) || file.replace(/\.html$/i, "");
    const board: DesignBoard = { x: Math.round(spot.x), y: Math.round(spot.y), w, h, title, page, ...(expand ? { expand } : {}) };

    const text = serializeArtboard({ ...r.doc, root }, { ...themeOf(index), title });
    await this.writeText(`artboards/${file}`, text);
    let order = index.order;
    if (!had) {
      const after = opts.after === "start" ? -1 : opts.after ? index.order.indexOf(this.fileName(opts.after, index, true)) : index.order.length - 1;
      order = [...index.order.slice(0, after + 1), file, ...index.order.slice(after + 1)];
    }
    if (!had || JSON.stringify(had) !== JSON.stringify(board)) await this.saveIndex({ ...index, boards: { ...index.boards, [file]: board }, order });
    return { file, board, version: versionOf(text), created: current === null, warnings: r.diagnostics.filter((d) => d.severity === "warning") };
  }

  /**
   * Change part of an artboard: each edit replaces one exact run of its HTML,
   * as read_artboards shows it, in order. All land together, checked as one
   * write, or none do.
   */
  async editArtboard(name: string, edits: TextEdit[], expectedVersion?: string) {
    const index = await this.index();
    const file = this.fileName(name, index, true);
    const current = await this.readText(`artboards/${file}`);
    if (current === null) throw new StoreError(`artboards/${file} is missing from the folder; write_artboard makes it again`);
    if (expectedVersion && versionOf(current) !== expectedVersion)
      throw new StoreError(`"${file}" changed since you read it (someone edited it). Read it again with read_artboards and redo your change on the new version`);
    let text = this.editable(current, index).html;
    edits.forEach((e, i) => {
      const which = edits.length > 1 ? `edit ${i + 1}: ` : "";
      const at = occurrences(text, e.find);
      if (!e.find || !at.length)
        throw new StoreError(`${which}"${clip(e.find, 80)}" is not in "${file}"${i ? " (after the edits before it)" : ""}. Copy it exactly from read_artboards: tags, attributes, quotes and spaces as they are there. Nothing was saved`);
      if (e.nth === undefined && at.length > 1) throw new StoreError(`${which}"${clip(e.find, 80)}" appears ${at.length} times in "${file}". Quote more around it so it is unique, or pass nth (1 to ${at.length}). Nothing was saved`);
      const pos = at[(e.nth ?? 1) - 1];
      if (pos === undefined) throw new StoreError(`${which}nth is ${e.nth}, but "${clip(e.find, 80)}" appears ${plural(at.length, "time")}. Nothing was saved`);
      text = text.slice(0, pos) + e.with + text.slice(pos + e.find.length);
    });
    return this.writeArtboard(file, text, { expectedVersion: versionOf(current) });
  }

  async deleteArtboards(names: string[]) {
    const index = await this.index();
    const files = [...new Set(names.map((n) => this.fileName(n, index, true)))];
    const boards = { ...index.boards };
    for (const f of files) delete boards[f];
    await this.saveIndex({ ...index, boards, order: index.order.filter((f) => !files.includes(f)) });
    for (const f of files) await rm(this.file(`artboards/${f}`), { force: true });
    return files;
  }

  /** Move, resize, retitle or re-page artboards, and (optionally) set the order. */
  async arrange(moves: { file: string; x?: number; y?: number; w?: number; h?: number; page?: string; title?: string }[], order?: string[]) {
    const index = await this.index();
    const boards = { ...index.boards };
    const resized: string[] = [];
    for (const m of moves) {
      const file = this.fileName(m.file, index, true);
      const b = boards[file]!;
      const size = (v: number | undefined, was: number) => (v === undefined ? was : Math.min(LIMITS.maxSize, Math.max(LIMITS.minSize, Math.round(v))));
      const next: DesignBoard = { ...b, x: Math.round(m.x ?? b.x), y: Math.round(m.y ?? b.y), w: size(m.w, b.w), h: size(m.h, b.h), page: m.page !== undefined ? this.page(m.page, index).id : b.page, title: m.title?.trim().slice(0, LIMITS.titleChars) || b.title };
      if (next.w !== b.w || next.h !== b.h || next.title !== b.title) resized.push(file);
      boards[file] = next;
    }
    let nextOrder = index.order;
    if (order) {
      nextOrder = order.map((f) => this.fileName(f, index, true));
      if ([...nextOrder].sort().join("\n") !== [...index.order].sort().join("\n")) throw new StoreError(`order must list every artboard exactly once: ${index.order.join(", ")}`);
    }
    const next = { ...index, boards, order: nextOrder };
    for (const file of resized) {
      const text = await this.readText(`artboards/${file}`);
      const doc = text === null ? null : this.editable(text, index).doc;
      if (!doc) throw new StoreError(`"${file}" has problems, so it can't be resized or renamed; fix it with write_artboard first`);
      const b = boards[file]!;
      await this.writeText(`artboards/${file}`, serializeArtboard({ ...doc, root: sizeRoot(doc.root, b.w, b.h, b.expand === "fill") }, { ...themeOf(next), title: b.title }));
    }
    await this.saveIndex(next);
    return next;
  }

  /** Comment threads, in artboard order: on one artboard or all, open ones unless resolved are asked for too. */
  async readComments(name?: string, includeResolved = false) {
    const index = await this.index();
    const only = name === undefined ? null : this.fileName(name, index, true);
    const roots = new Map<string, ElementNode | null>();
    const out = [];
    for (const t of (await this.threads()).filter((t) => t.file in index.boards && (only === null || t.file === only) && (includeResolved || !t.resolved)).sort((a, b) => index.order.indexOf(a.file) - index.order.indexOf(b.file))) {
      if (!roots.has(t.file)) {
        const text = await this.readText(`artboards/${t.file}`);
        roots.set(t.file, text === null ? null : (this.editable(text, index).doc?.root ?? null));
      }
      const root = roots.get(t.file) ?? null;
      const addr = root && (t.addr || t.snippet) ? anchorOf(root, t) : "";
      const el = root && addr ? (getAt(root, addr) as ElementNode | null) : null;
      out.push({
        thread: t.id,
        file: t.file,
        artboard: index.boards[t.file]!.title,
        on: el ? { layer: layerLabel(el), html: clip(serializeBlock(el), 400) } : t.snippet ? `a layer that is gone now (it read "${clip(t.snippet, 80)}")` : "the whole artboard",
        resolved: t.resolved,
        comments: t.comments.map((c) => ({ by: c.author === "you" ? "user" : "assistant", text: c.text, at: new Date(c.at).toISOString() })),
      });
    }
    return out;
  }

  /** Reply to a thread (and resolve it, if asked), or start one on an artboard or a layer of it. */
  async comment(input: CommentInput) {
    const text = (input.text ?? "").trim();
    if (!text && !(input.thread && input.resolve)) throw new StoreError("text is empty: write the comment, or pass resolve: true with a thread to only resolve it");
    if (text.length > MAX_COMMENT) throw new StoreError(`the comment is ${text.length} characters; the most is ${MAX_COMMENT}`);
    const threads = await this.threads();
    const said = text ? [{ id: randomUUID().slice(0, 12), author: "ai" as const, text, at: Date.now() }] : [];
    let thread: DesignThread;
    if (input.thread) {
      const found = threads.find((t) => t.id === input.thread);
      if (!found) throw new StoreError(`there is no thread "${input.thread}" (read_comments lists them)`);
      thread = { ...found, resolved: input.resolve ? true : found.resolved, comments: [...found.comments, ...said] };
      threads.splice(threads.indexOf(found), 1, thread);
    } else {
      if (!input.file) throw new StoreError("to start a thread give file (and quote, to point at one layer on it); to reply give thread");
      const read = await this.readArtboard(input.file);
      if (!read.doc) throw new StoreError(`"${read.file}" has problems, so a comment can't be placed on it; fix it with write_artboard first`);
      let addr = "";
      if (input.quote?.trim()) {
        const hits = findByWords(read.doc.root, input.quote);
        if (!hits.length) throw new StoreError(`no layer on "${read.file}" reads "${clip(input.quote, 80)}". Quote words as they read on the artboard (plain text, no tags), or leave quote out to comment on the whole artboard`);
        if (hits.length > 1) throw new StoreError(`"${clip(input.quote, 80)}" is in ${hits.length} layers on "${read.file}": ${hits.map((a) => `"${clip(wordsOf(getAt(read.doc!.root, a)!), 50)}"`).join(", ")}. Quote more of the one you mean`);
        addr = hits[0]!;
      }
      const el = addr ? getAt(read.doc.root, addr) : null;
      thread = { id: randomUUID().slice(0, 12), file: read.file, addr, snippet: el ? snippetOf(el) : "", resolved: !!input.resolve, comments: said };
      threads.push(thread);
    }
    await this.writeText(COMMENTS_FILE, serializeThreads(threads));
    return { thread: thread.id, comments: thread.comments.length, resolved: thread.resolved };
  }

  /**
   * Change the design's title, pages, tweaks or text styles. Refused whole if
   * an artboard would stop being valid (it uses a tweak being removed) or a
   * page holding artboards would go. Tweaks and text styles are written into
   * every artboard's head, so each file still looks right on its own.
   */
  async updateDesign(patch: DesignPatch) {
    const index = await this.index();
    const next: DesignIndex = { ...index, tweaks: { ...index.tweaks }, textStyles: { ...index.textStyles } };
    if (patch.title !== undefined) next.title = patch.title.trim().slice(0, LIMITS.titleChars) || index.title;
    if (patch.pages) {
      if (!patch.pages.length || patch.pages.length > LIMITS.maxPages) throw new StoreError(`a design has 1 to ${LIMITS.maxPages} pages`);
      const pages: DesignPage[] = [];
      for (const p of patch.pages) {
        const known = p.id !== undefined ? index.pages.find((x) => x.id === p.id) : undefined;
        if (p.id !== undefined && !known) throw new StoreError(`there is no page with id "${p.id}"; leave id out to add a new page`);
        pages.push({ id: known?.id ?? newPageId([...index.pages, ...pages.filter((x) => !index.pages.some((y) => y.id === x.id))]), name: p.name.trim().slice(0, LIMITS.titleChars) || known?.name || `Page ${pages.length + 1}` });
      }
      const gone = index.pages.filter((p) => !pages.some((x) => x.id === p.id));
      const stranded = index.order.filter((f) => gone.some((p) => p.id === index.boards[f]!.page));
      if (stranded.length) throw new StoreError(`not saved: page "${gone[0]!.name}" still holds ${stranded.join(", ")}. Move them with arrange_artboards (page) or delete them first`);
      next.pages = pages;
    }
    for (const [key, value] of Object.entries(patch.tweaks ?? {})) {
      const name = key.startsWith("--") ? key : `--${key}`;
      if (value === null || value.trim() === "") delete next.tweaks[name];
      else if (!TWEAK_RE.test(name)) throw new StoreError(`"${key}" can't be a tweak's name: use lowercase letters, digits and -, like --accent`);
      else if (tweakProblem(value.trim())) throw new StoreError(`${name}: "${value}" was refused: ${tweakProblem(value.trim())}`);
      else next.tweaks[name] = value.trim();
    }
    for (const [key, value] of Object.entries(patch.textStyles ?? {})) {
      const name = key.trim();
      if (value === null || value.trim() === "") delete next.textStyles[name];
      else if (!name || name.length > 40 || /["\\\]]/.test(name)) throw new StoreError(`"${key}" can't be a text style's name (40 characters at most, no quotes or brackets)`);
      else if (textStyleProblem(value)) throw new StoreError(`text style "${name}" was refused: ${textStyleProblem(value)}. A text style holds text properties only (font-size, font-weight, line-height, letter-spacing, color, …)`);
      else next.textStyles[name] = value.trim();
    }

    const themed = JSON.stringify([index.tweaks, index.textStyles]) !== JSON.stringify([next.tweaks, next.textStyles]);
    const rewrites: [string, string][] = [];
    const using: Record<string, string[]> = {};
    if (themed) {
      const broken: string[] = [];
      for (const file of index.order) {
        const text = await this.readText(`artboards/${file}`);
        if (text === null) continue;
        const before = parseArtboard(text, designContext(index));
        if (!before.ok || !before.doc) continue;
        const body = serializeBlock(before.doc.root);
        const after = parseArtboard(body, designContext(next));
        const err = after.diagnostics.find((d) => d.severity === "error");
        if (err) broken.push(`${file}: ${err.message}`);
        else rewrites.push([file, serializeArtboard({ ...before.doc, vars: {} }, { ...themeOf(next), title: index.boards[file]!.title })]);
        for (const name of Object.keys(patch.tweaks ?? {})) {
          const full = name.startsWith("--") ? name : `--${name}`;
          if (body.includes(`var(${full})`)) (using[full] ??= []).push(file);
        }
      }
      if (broken.length) throw new StoreError(`not saved: this change would break ${plural(broken.length, "artboard")}: ${broken.join("; ")}. Change those artboards first`);
    }
    for (const [file, text] of rewrites) await this.writeText(`artboards/${file}`, text);
    await this.saveIndex(next);
    return { index: next, using };
  }
}
