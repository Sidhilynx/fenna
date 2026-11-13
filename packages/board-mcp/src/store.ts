// The board on disk, as the MCP tools see it. Every call reads the files
// fresh (the person may have changed them), checks the whole request before
// writing anything, and writes atomically (temp file, then rename), so the
// app watching the folder never sees half a file.

import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  boundsOf,
  byId,
  canvasText,
  checkItem,
  closest,
  DEFAULT_SIZES,
  frameChildren,
  isBox,
  isConnector,
  itemBounds,
  KIND_FIELDS,
  layoutText,
  LIMITS,
  metaText,
  newId,
  parseCanvas,
  parseMeta,
  rectContains,
  rectsOverlap,
  SHAPE_DEFAULTS,
  textBox,
  textItemHeight,
  type BoardItem,
  type BoardMeta,
  type BoxItem,
  type ConnectorItem,
  type FrameItem,
  type ItemKind,
  type Problem,
  type Rect,
  type ShapeKind,
} from "@opendeck/board";

export class StoreError extends Error {}

export const versionOf = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 12);

type Raw = Record<string, unknown>;

interface Loaded {
  meta: BoardMeta;
  items: BoardItem[];
  kept: unknown[];
  source: string;
  version: string;
}

const GAP = 24;
const PAD = 40;
const FRAME_GAP = 80;

/** What an item says, in a line. */
export function gist(it: BoardItem, max = 80): string {
  const t = it.kind === "frame" ? it.title : it.kind === "connector" ? (it.label ?? "") : it.kind === "table" ? it.cells[0]!.join(" | ") : it.kind === "sticker" ? it.sticker : "text" in it ? (it.text ?? "") : "";
  const line = t.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const label = (it: BoardItem) => `${it.id} (${it.kind}${gist(it, 40) ? ` "${gist(it, 40)}"` : ""})`;

export class BoardStore {
  readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private file(rel: string) {
    return path.join(this.root, rel);
  }

  private async readText(rel: string): Promise<string | null> {
    return readFile(this.file(rel), "utf8").catch(() => null);
  }

  private async writeText(rel: string, text: string) {
    const full = this.file(rel);
    const tmp = `${full}.${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, full);
  }

  async load(): Promise<Loaded> {
    const metaText_ = await this.readText("board.json");
    const source = await this.readText("canvas.json");
    if (metaText_ === null && source === null) throw new StoreError(`${this.root} is not a board folder: it has no board.json or canvas.json.`);
    const { meta } = parseMeta(metaText_, path.basename(this.root));
    const c = parseCanvas(source);
    if (c.broken) throw new StoreError(`canvas.json can't be read (${c.broken}). Nothing was changed. Ask the user to fix the file or restore a version in the app.`);
    return { meta, items: c.items, kept: c.kept, source: source ?? "", version: versionOf(source ?? "") };
  }

  private checkVersion(loaded: Loaded, version?: string) {
    if (version && version !== loaded.version) throw new StoreError(`The board changed since you read it (your version ${version}, now ${loaded.version}): the person or another tool edited it. Call read_board again, then retry with the new version.`);
  }

  private async save(loaded: Loaded, items: BoardItem[]): Promise<string> {
    const text = canvasText(items, loaded.kept);
    if (text.length > 64 * 1024 * 1024) throw new StoreError("The board would be over 64 MB; nothing was saved. Remove items instead of adding more.");
    await this.writeText("canvas.json", text);
    return versionOf(text);
  }

  // ── Reading ────────────────────────────────────────────────────────────

  async read(opts: { frame?: string; ids?: string[]; area?: Rect; limit?: number }) {
    const b = await this.load();
    const all = byId(b.items);
    let list = b.items;
    if (opts.frame) {
      const f = all.get(opts.frame);
      if (!f || f.kind !== "frame") throw new StoreError(`No frame "${opts.frame}". Frames: ${this.frameList(b.items) || "none"}.`);
      list = b.items.filter((it) => it.id === f.id || it.frame === f.id);
    }
    if (opts.ids?.length) {
      const missing = opts.ids.filter((id) => !all.has(id));
      if (missing.length) throw new StoreError(`No item ${missing.map((m) => `"${m}"`).join(", ")} on the board.${hint(missing[0]!, [...all.keys()])}`);
      const want = new Set(opts.ids);
      list = list.filter((it) => want.has(it.id));
    }
    if (opts.area) {
      const area = opts.area;
      list = list.filter((it) => {
        const r = itemBounds(it, all);
        return r && rectsOverlap(r, area);
      });
    }
    const limit = Math.min(opts.limit ?? 300, 1000);
    const shown = list.slice(0, limit);
    const comments = await this.threads();
    const frames = b.items.filter((it): it is FrameItem => it.kind === "frame");
    const kids = frameChildren(b.items);
    const bounds = boundsOf(b.items, all);
    return {
      title: b.meta.title,
      version: b.version,
      count: b.items.length,
      bounds: bounds && roundRect(bounds),
      frames: frames.map((f) => ({ id: f.id, title: f.title, x: f.x, y: f.y, width: f.width, height: f.height, holds: kids.get(f.id)?.length ?? 0 })),
      items: shown,
      ...(list.length > shown.length ? { more: `Showing ${shown.length} of ${list.length} items. Narrow with frame, ids or area to see the rest.` } : {}),
      openComments: comments.filter((t) => !t.resolved).length,
      problems: layoutProblems(b.items, null).slice(0, 20),
      ...(b.kept.length ? { unreadable: `${b.kept.length} entries in canvas.json don't match the format; they are kept as they are and not shown.` } : {}),
    };
  }

  private frameList(items: BoardItem[]) {
    return items
      .filter((it) => it.kind === "frame")
      .map((f) => `${f.id} "${(f as FrameItem).title}"`)
      .join(", ");
  }

  // ── Adding ─────────────────────────────────────────────────────────────

  async add(input: Raw[], version?: string) {
    const b = await this.load();
    this.checkVersion(b, version);
    if (!input.length) throw new StoreError("items is empty; give at least one item.");
    if (b.items.length + input.length > LIMITS.items) throw new StoreError(`A board holds at most ${LIMITS.items} items; it has ${b.items.length}.`);
    const taken = new Set(b.items.map((it) => it.id));
    const problems: Problem[] = [];
    const fresh: Raw[] = [];
    const placed = new Set<string>();
    // 1. Ids, kinds and defaults.
    input.forEach((raw, i) => {
      const where = `items[${i}]`;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        problems.push({ where, message: "Each item must be an object with a kind." });
        return;
      }
      const it: Raw = { ...raw };
      if (it.id !== undefined) {
        if (typeof it.id !== "string" || taken.has(it.id)) problems.push({ where: `${where}.id`, message: typeof it.id === "string" ? `"${it.id}" is already on the board; leave id out for a new one, or pick another.` : "id must be text." });
      } else if (typeof it.kind === "string" && (KIND_FIELDS as Record<string, unknown>)[it.kind]) it.id = newId(it.kind as ItemKind, taken);
      if (typeof it.id === "string") taken.add(it.id);
      if (it.kind !== "connector") {
        if (typeof it.x === "number" && typeof it.y === "number") placed.add(String(it.id));
        else if (it.x !== undefined || it.y !== undefined) problems.push({ where, message: "Give both x and y, or neither (to have it placed for you)." });
      }
      applyDefaults(it);
      fresh.push(it);
    });
    if (problems.length) throw new StoreError(refusal(problems));
    for (const [i, it] of fresh.entries()) problems.push(...checkItem(withPlaceholder(it), typeof it.id === "string" ? it.id : `items[${i}]`));
    const added = fresh as unknown as BoardItem[];
    const all = byId([...b.items, ...added]);
    problems.push(...refProblems(added, all));
    if (problems.length) throw new StoreError(refusal(problems));

    // 2. Place what has no position: children in their frames, then new frames and loose items beside the board.
    let items = [...b.items, ...added.map((it) => (isBox(it) && !placed.has(it.id) ? ({ ...it, x: 0, y: 0 } as BoardItem) : it))];
    const unplacedFrames = new Set(added.filter((it) => it.kind === "frame" && !placed.has(it.id)).map((it) => it.id));
    const autoSize = new Set(added.filter((it) => it.kind === "frame" && (fresh.find((f) => f.id === it.id) as Raw).__autosize).map((it) => it.id));
    const waiting = new Set(added.filter((it) => isBox(it) && !placed.has(it.id) && it.frame).map((it) => it.id));
    for (const it of added) {
      if (!isBox(it) || placed.has(it.id) || !it.frame) continue;
      items = placeInFrame(items, it.id, it.frame, autoSize.has(it.frame), waiting);
    }
    for (const fid of autoSize) items = fitFrame(items, fid, true);
    for (const fid of new Set(added.filter((it) => it.frame && !autoSize.has(it.frame)).map((it) => it.frame!))) items = fitFrame(items, fid, false);
    const loose = added.filter((it) => isBox(it) && !placed.has(it.id) && !it.frame && it.kind !== "frame").map((it) => it.id);
    items = placeBeside(items, b.items, [...unplacedFrames], loose);
    items = items.map((it) => {
      const f = fresh.find((x) => x.id === it.id);
      if (f && "__autosize" in f) {
        const { __autosize: _, ...rest } = it as unknown as Raw;
        return rest as unknown as BoardItem;
      }
      return it;
    });
    items = settleFrames(items);
    const newIds = new Set(added.map((it) => it.id));
    const v = await this.save(b, items);
    const after = byId(items);
    const lines = added.map((it) => {
      const now = after.get(it.id)!;
      const r = itemBounds(now, after);
      const pos = r && isBox(now) ? ` at ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}` : "";
      return `- ${label(now)}${now.frame ? ` in ${now.frame}` : ""}${pos}`;
    });
    const grown = [...new Set(added.filter((it) => it.frame && !newIds.has(it.frame)).map((it) => it.frame!))].map((fid) => {
      const f = after.get(fid) as FrameItem;
      return `Frame ${fid} is now ${f.width}×${f.height} to hold them.`;
    });
    return { version: v, text: [`Added ${added.length} item${added.length === 1 ? "" : "s"} (version ${v}):`, ...lines, ...grown, ...problemLines(items, newIds)].join("\n") };
  }

  // ── Editing ────────────────────────────────────────────────────────────

  async edit(edits: Raw[], version?: string) {
    const b = await this.load();
    this.checkVersion(b, version);
    if (!edits.length) throw new StoreError("items is empty; give at least one {id, …fields to change}.");
    const all = byId(b.items);
    const problems: Problem[] = [];
    const next = new Map<string, BoardItem>();
    const moved = new Map<string, { dx: number; dy: number }>();
    const refiled: string[] = [];
    const seen = new Set<string>();
    edits.forEach((e, i) => {
      const where = `items[${i}]`;
      const id = e?.id;
      if (typeof id !== "string" || !all.has(id)) {
        problems.push({ where, message: typeof id === "string" ? `No item "${id}" on the board.${hint(id, [...all.keys()])}` : 'Each item needs the id of the item to change: {"id": "s-1", "text": "…"}.' });
        return;
      }
      if (seen.has(id)) {
        problems.push({ where, message: `${id} is edited twice; put all its changes in one edit.` });
        return;
      }
      seen.add(id);
      const cur = all.get(id)!;
      if ("kind" in e && e.kind !== cur.kind) {
        problems.push({ where: `${id}.kind`, message: `An item can't change kind (${cur.kind} → ${String(e.kind)}); delete it and add a new one.` });
        return;
      }
      const n: Raw = { ...(cur as unknown as Raw) };
      for (const [k, v] of Object.entries(e)) {
        if (k === "id") continue;
        if (v === null) delete n[k];
        else n[k] = v;
      }
      // Text items size to their text.
      if (n.kind === "text" && ("text" in e || "size" in e || "width" in e || "bold" in e || "list" in e) && !("height" in e)) n.height = textItemHeight(String(n.text ?? ""), n, Number(n.width));
      if (isBox(cur) && ("x" in e || "y" in e)) moved.set(id, { dx: Number(n.x) - cur.x, dy: Number(n.y) - cur.y });
      if ("frame" in e && e.frame && !("x" in e) && !("y" in e)) refiled.push(id);
      problems.push(...checkItem(n, id));
      next.set(id, n as unknown as BoardItem);
    });
    if (problems.length) throw new StoreError(refusal(problems));
    let items = b.items.map((it) => next.get(it.id) ?? it);
    problems.push(...refProblems([...next.values()], byId(items)));
    if (problems.length) throw new StoreError(refusal(problems));
    // A frame moved takes what it holds along.
    const notes: string[] = [];
    for (const [id, { dx, dy }] of moved) {
      const it = byId(items).get(id);
      if (it?.kind !== "frame" || (!dx && !dy)) continue;
      const kids = items.filter((x) => x.frame === id && !moved.has(x.id));
      items = items.map((x) => (x.frame === id && !moved.has(x.id) ? shift(x, dx, dy) : x));
      if (kids.length) notes.push(`Moved what ${id} holds (${kids.length} item${kids.length === 1 ? "" : "s"}) with it.`);
    }
    // Put into a frame without a position: placed in its next free spot.
    const waiting = new Set(refiled);
    for (const id of refiled) {
      const fid = (byId(items).get(id) as BoxItem).frame!;
      items = placeInFrame(items, id, fid, false, waiting);
    }
    for (const fid of new Set(refiled.map((id) => (byId(items).get(id) as BoxItem).frame!))) items = fitFrame(items, fid, false);
    items = settleFrames(items);
    const v = await this.save(b, items);
    const after = byId(items);
    const lines = [...next.keys()].map((id) => `- ${label(after.get(id)!)}: ${Object.keys(edits.find((e) => e.id === id)!).filter((k) => k !== "id").join(", ")}${refiled.includes(id) ? ` (placed at ${(after.get(id) as BoxItem).x},${(after.get(id) as BoxItem).y})` : ""}`);
    return { version: v, text: [`Changed ${next.size} item${next.size === 1 ? "" : "s"} (version ${v}):`, ...lines, ...notes, ...problemLines(items, new Set(next.keys()))].join("\n") };
  }

  // ── Deleting ───────────────────────────────────────────────────────────

  async remove(ids: string[], withContents: boolean, version?: string) {
    const b = await this.load();
    this.checkVersion(b, version);
    const all = byId(b.items);
    const missing = ids.filter((id) => !all.has(id));
    if (missing.length) throw new StoreError(`No item ${missing.map((m) => `"${m}"`).join(", ")} on the board; nothing was deleted.${hint(missing[0]!, [...all.keys()])}`);
    const gone = new Set(ids);
    if (withContents) for (const it of b.items) if (it.frame && gone.has(it.frame)) gone.add(it.id);
    const released = b.items.filter((it) => it.frame && gone.has(it.frame) && !gone.has(it.id)).map((it) => it.id);
    const lines: string[] = [];
    for (const it of b.items) {
      if (isConnector(it) && !gone.has(it.id) && (("item" in it.from && gone.has(it.from.item)) || ("item" in it.to && gone.has(it.to.item)))) {
        gone.add(it.id);
        lines.push(`Also deleted connector ${it.id}: one of its ends was deleted.`);
      }
    }
    const items = b.items
      .filter((it) => !gone.has(it.id))
      .map((it) => {
        if (!it.frame || !gone.has(it.frame)) return it;
        const { frame: _, ...rest } = it;
        return rest as BoardItem;
      });
    const v = await this.save(b, items);
    if (released.length) lines.push(`${released.length} item${released.length === 1 ? "" : "s"} the deleted frame held stay on the board, outside any frame (pass with_contents: true to delete them too).`);
    return { version: v, text: [`Deleted ${gone.size} item${gone.size === 1 ? "" : "s"} (version ${v}): ${[...gone].join(", ")}.`, ...lines].join("\n") };
  }

  // ── Arranging ──────────────────────────────────────────────────────────

  async arrange(opts: { ids?: string[]; frame?: string; layout: "grid" | "row" | "column" | "flow"; columns?: number; gap?: number; direction?: "down" | "right"; x?: number; y?: number }, version?: string) {
    const b = await this.load();
    this.checkVersion(b, version);
    const all = byId(b.items);
    let frame: FrameItem | null = null;
    if (opts.frame) {
      const f = all.get(opts.frame);
      if (!f || f.kind !== "frame") throw new StoreError(`No frame "${opts.frame}". Frames: ${this.frameList(b.items) || "none"}. Add one with add_items first.`);
      frame = f;
    }
    let ids = opts.ids ?? (frame ? b.items.filter((it) => it.frame === frame!.id).map((it) => it.id) : []);
    if (!ids.length) throw new StoreError("Nothing to arrange: give ids, or a frame that holds items.");
    const missing = ids.filter((id) => !all.has(id));
    if (missing.length) throw new StoreError(`No item ${missing.map((m) => `"${m}"`).join(", ")} on the board; nothing was moved.${hint(missing[0]!, [...all.keys()])}`);
    const notBox = ids.filter((id) => !isBox(all.get(id)!));
    ids = ids.filter((id) => isBox(all.get(id)!));
    if (frame && ids.includes(frame.id)) throw new StoreError(`${frame.id} is the frame itself; list what goes in it.`);
    if (ids.some((id) => all.get(id)!.kind === "frame") && frame) throw new StoreError("A frame can't go inside another frame.");
    const boxes = ids.map((id) => all.get(id) as BoxItem);
    const gap = Math.max(0, Math.min(400, opts.gap ?? (opts.layout === "flow" ? 64 : GAP)));
    const origin = opts.x !== undefined && opts.y !== undefined ? { x: opts.x, y: opts.y } : frame ? { x: frame.x + PAD, y: frame.y + PAD } : { x: Math.min(...boxes.map((x) => x.x)), y: Math.min(...boxes.map((x) => x.y)) };
    const pos = opts.layout === "flow" ? flowLayout(boxes, b.items, origin, gap, opts.direction ?? "down") : gridLayout(boxes, origin, gap, opts.layout === "row" ? boxes.length : opts.layout === "column" ? 1 : (opts.columns ?? defaultColumns(boxes.length, frame)));
    const idSet = new Set(ids);
    let items = b.items.map((it) => {
      const p = pos.get(it.id);
      if (!p || !isBox(it)) return it;
      const moved = { ...it, x: Math.round(p.x), y: Math.round(p.y) } as BoardItem;
      if (frame) return { ...moved, frame: frame.id } as BoardItem;
      return moved;
    });
    // Frames moved by a layout take what they hold along.
    for (const it of boxes) {
      if (it.kind !== "frame") continue;
      const p = pos.get(it.id)!;
      const dx = Math.round(p.x) - it.x;
      const dy = Math.round(p.y) - it.y;
      if (dx || dy) items = items.map((x) => (x.frame === it.id && !idSet.has(x.id) ? shift(x, dx, dy) : x));
    }
    if (frame) items = fitFrame(items, frame.id, true);
    items = settleFrames(items);
    const v = await this.save(b, items);
    const after = byId(items);
    const lines = [`Arranged ${ids.length} item${ids.length === 1 ? "" : "s"} as a ${opts.layout}${frame ? ` in ${frame.id}` : ""} (version ${v}).`];
    if (frame) {
      const f = after.get(frame.id) as FrameItem;
      lines.push(`Frame ${f.id} "${f.title}" is now at ${f.x},${f.y}, ${f.width}×${f.height}.`);
    }
    if (notBox.length) lines.push(`Connectors follow their items and aren't arranged: ${notBox.join(", ")}.`);
    lines.push(...problemLines(items, new Set(ids)));
    return { version: v, text: lines.join("\n") };
  }

  // ── The board itself ───────────────────────────────────────────────────

  async rename(title: string) {
    const t = title.trim();
    if (!t) throw new StoreError("title is empty.");
    if (t.length > LIMITS.titleChars) throw new StoreError(`title is ${t.length} characters; the most is ${LIMITS.titleChars}.`);
    const { meta } = parseMeta(await this.readText("board.json"), path.basename(this.root));
    await this.writeText("board.json", metaText({ ...meta, title: t }));
    return `Renamed the board to "${t}".`;
  }

  // ── Comments ───────────────────────────────────────────────────────────

  private async threads(): Promise<Thread[]> {
    const text = await this.readText("comments.json");
    if (!text) return [];
    try {
      const data = JSON.parse(text) as { threads?: unknown };
      return Array.isArray(data.threads) ? (data.threads.filter((t) => t && typeof t === "object" && Array.isArray((t as Thread).comments)) as Thread[]) : [];
    } catch {
      throw new StoreError("comments.json can't be read; nothing was changed. Ask the user to check the file.");
    }
  }

  async readComments(includeResolved: boolean) {
    const b = await this.load();
    const all = byId(b.items);
    const threads = (await this.threads()).filter((t) => includeResolved || !t.resolved);
    return {
      threads: threads.map((t) => {
        const it = t.item ? all.get(t.item) : undefined;
        return {
          thread: t.id,
          resolved: t.resolved,
          on: it ? { id: it.id, kind: it.kind, text: gist(it, 200) } : t.item ? { id: t.item, deleted: true } : { x: t.x, y: t.y },
          comments: t.comments.map((c) => ({ by: c.author === "ai" ? "assistant" : "user", text: c.text, at: new Date(c.at).toISOString() })),
        };
      }),
    };
  }

  async comment(input: { thread?: string; item?: string; text?: string; resolve?: boolean }) {
    const threads = await this.threads();
    const text = input.text?.trim() ?? "";
    if (text.length > 4000) throw new StoreError("text is over 4000 characters.");
    const now = Date.now();
    const comment = { id: randomUUID().slice(0, 10), author: "ai" as const, text, at: now };
    let target: Thread;
    if (input.thread) {
      const t = threads.find((x) => x.id === input.thread);
      if (!t) throw new StoreError(`No thread "${input.thread}". Threads: ${threads.map((x) => x.id).join(", ") || "none"} (read_comments lists them).`);
      if (!text && !input.resolve) throw new StoreError("Give text to reply, or resolve: true to close the thread.");
      if (text) t.comments.push(comment);
      if (input.resolve) t.resolved = true;
      target = t;
    } else {
      if (!text) throw new StoreError("Give the comment's text.");
      if (!input.item) throw new StoreError('To start a thread, give the item it is on: {"item": "s-1", "text": "…"}. To answer one, give thread.');
      const b = await this.load();
      const it = b.items.find((x) => x.id === input.item);
      if (!it) throw new StoreError(`No item "${input.item}" on the board.${hint(input.item, b.items.map((x) => x.id))}`);
      const r = itemBounds(it, byId(b.items));
      target = { id: `t-${randomUUID().slice(0, 8)}`, item: it.id, ...(r ? { x: Math.round(r.x + r.width), y: Math.round(r.y) } : {}), resolved: !!input.resolve, comments: [comment] };
      threads.push(target);
    }
    await this.writeText("comments.json", `${JSON.stringify({ version: 1, threads }, null, 2)}\n`);
    return target;
  }
}

interface Thread {
  id: string;
  item?: string;
  x?: number;
  y?: number;
  resolved: boolean;
  comments: { id: string; author: "you" | "ai"; text: string; at: number }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function hint(id: string, ids: string[]): string {
  const near = closest(id, ids);
  return near ? ` Did you mean "${near}"?` : " read_board lists the ids.";
}

function refusal(problems: Problem[]): string {
  const lines = problems.slice(0, 25).map((p) => `- ${p.where}: ${p.message}`);
  if (problems.length > 25) lines.push(`- and ${problems.length - 25} more`);
  return `Nothing was saved. Fix these and send the whole request again:\n${lines.join("\n")}`;
}

const roundRect = (r: Rect) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });

/** Fills what a model may leave out: sizes, and placeholders so a missing position doesn't fail the check. */
function applyDefaults(it: Raw) {
  const kind = it.kind;
  if (kind === "connector" || typeof kind !== "string") return;
  if (kind === "shape") {
    const d = SHAPE_DEFAULTS[(it.shape as ShapeKind) ?? "rect"] ?? SHAPE_DEFAULTS.rect;
    it.width ??= d.width;
    it.height ??= d.height;
  } else if (kind === "frame") {
    if (it.width === undefined && it.height === undefined) it.__autosize = true;
    it.width ??= DEFAULT_SIZES.frame.width;
    it.height ??= DEFAULT_SIZES.frame.height;
  } else if (kind in DEFAULT_SIZES) {
    const d = DEFAULT_SIZES[kind as keyof typeof DEFAULT_SIZES];
    it.width ??= d.width;
    it.height ??= d.height;
  }
  if (kind === "sticky") it.text ??= "";
  if (kind === "frame") it.title ??= "";
  if (kind === "text") {
    it.text ??= "";
    if (typeof it.width === "number") it.height = textItemHeight(String(it.text), it, it.width);
  }
  if (kind === "drawing" && Array.isArray(it.points) && it.width === DEFAULT_SIZES.drawing.width) {
    const p = it.points as number[];
    it.width = Math.max(1, ...p.filter((_, i) => i % 2 === 0));
    it.height = Math.max(1, ...p.filter((_, i) => i % 2 === 1));
  }
}

/** The item as checked: a missing position counts as placed (it will be). */
function withPlaceholder(it: Raw): Raw {
  const { __autosize: _, ...rest } = it;
  if (rest.kind === "connector") return rest;
  return { ...rest, x: typeof rest.x === "number" ? rest.x : 0, y: typeof rest.y === "number" ? rest.y : 0 };
}

/** Frames, groups and connector ends that point at something wrong. */
function refProblems(changed: BoardItem[], all: Map<string, BoardItem>): Problem[] {
  const out: Problem[] = [];
  for (const it of changed) {
    if (it.frame !== undefined) {
      const f = all.get(it.frame);
      if (!f) out.push({ where: `${it.id}.frame`, message: `No frame "${it.frame}".${hint(it.frame, [...all.values()].filter((x) => x.kind === "frame").map((x) => x.id))}` });
      else if (f.kind !== "frame") out.push({ where: `${it.id}.frame`, message: `"${it.frame}" is a ${f.kind}, not a frame.` });
      if (it.kind === "frame") out.push({ where: `${it.id}.frame`, message: "A frame can't go inside another frame." });
    }
    if (isConnector(it)) {
      for (const [k, e] of [["from", it.from], ["to", it.to]] as const) {
        if (!("item" in e)) continue;
        const t = all.get(e.item);
        if (!t) out.push({ where: `${it.id}.${k}`, message: `No item "${e.item}" to connect to.${hint(e.item, [...all.keys()])}` });
        else if (t.kind === "connector") out.push({ where: `${it.id}.${k}`, message: `"${e.item}" is a connector; connect items, not connectors.` });
      }
      if ("item" in it.from && "item" in it.to && it.from.item === it.to.item) out.push({ where: it.id, message: "Both ends are on the same item." });
    }
  }
  return out;
}

const shift = (it: BoardItem, dx: number, dy: number): BoardItem => {
  if (isBox(it)) return { ...it, x: it.x + dx, y: it.y + dy };
  const mv = (e: ConnectorItem["from"]) => ("item" in e ? e : { x: e.x + dx, y: e.y + dy });
  return { ...it, from: mv(it.from), to: mv(it.to) };
};

/** Frames sit behind what they hold. */
function settleFrames(items: BoardItem[]): BoardItem[] {
  let out = items;
  for (const f of items.filter((it) => it.kind === "frame")) {
    const at = out.findIndex((it) => it.id === f.id);
    const first = out.findIndex((it) => it.frame === f.id);
    if (first < 0 || at < first) continue;
    out = out.filter((_, i) => i !== at);
    out.splice(first, 0, f);
  }
  return out;
}

function defaultColumns(n: number, frame: FrameItem | null): number {
  if (frame && frame.width > 0) return Math.max(1, Math.min(n, Math.floor((frame.width - PAD * 2 + GAP) / (200 + GAP)) || 1));
  return Math.max(1, Math.min(n, n <= 3 ? n : n <= 8 ? Math.ceil(n / 2) : Math.ceil(Math.sqrt(n * 1.6))));
}

/** Items in reading order, in rows of `cols`, each row as tall as its tallest item. */
function gridLayout(boxes: BoxItem[], origin: { x: number; y: number }, gap: number, cols: number): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const colW = Math.max(...boxes.map((b) => b.width));
  let y = origin.y;
  for (let i = 0; i < boxes.length; i += cols) {
    const row = boxes.slice(i, i + cols);
    row.forEach((b, j) => pos.set(b.id, { x: origin.x + j * (cols === boxes.length ? 0 : colW + gap) + (cols === boxes.length ? row.slice(0, j).reduce((s, x) => s + x.width + gap, 0) : 0), y }));
    y += Math.max(...row.map((b) => b.height)) + gap;
  }
  return pos;
}

/**
 * Lays items out along their connectors: each in the layer after the item
 * that points at it (loops back are ignored), layers top to bottom (or left
 * to right), each layer centred.
 */
function flowLayout(boxes: BoxItem[], all: BoardItem[], origin: { x: number; y: number }, gap: number, direction: "down" | "right"): Map<string, { x: number; y: number }> {
  const ids = new Set(boxes.map((b) => b.id));
  const out = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const id of ids) {
    out.set(id, []);
    incoming.set(id, 0);
  }
  for (const c of all) {
    if (!isConnector(c) || !("item" in c.from) || !("item" in c.to)) continue;
    if (ids.has(c.from.item) && ids.has(c.to.item) && c.from.item !== c.to.item) out.get(c.from.item)!.push(c.to.item);
  }
  // Drop edges that close a loop, found by a depth-first walk in the given order.
  const state = new Map<string, 0 | 1 | 2>();
  const keep = new Map<string, string[]>([...ids].map((id) => [id, []]));
  const walk = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id)!) {
      if (state.get(to) === 1) continue;
      keep.get(id)!.push(to);
      if (!state.get(to)) walk(to);
    }
    state.set(id, 2);
  };
  for (const b of boxes) if (!state.get(b.id)) walk(b.id);
  for (const [, tos] of keep) for (const to of tos) incoming.set(to, incoming.get(to)! + 1);
  const layer = new Map<string, number>();
  const queue = boxes.filter((b) => incoming.get(b.id) === 0).map((b) => b.id);
  for (const id of queue) layer.set(id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const to of keep.get(id)!) {
      layer.set(to, Math.max(layer.get(to) ?? 0, layer.get(id)! + 1));
      incoming.set(to, incoming.get(to)! - 1);
      if (incoming.get(to) === 0) queue.push(to);
    }
  }
  const layers: BoxItem[][] = [];
  for (const b of boxes) (layers[layer.get(b.id) ?? 0] ??= []).push(b);
  const across = (b: BoxItem) => (direction === "down" ? b.width : b.height);
  const along = (b: BoxItem) => (direction === "down" ? b.height : b.width);
  const widest = Math.max(...layers.map((l) => l.reduce((s, b) => s + across(b), 0) + gap * (l.length - 1)));
  const pos = new Map<string, { x: number; y: number }>();
  let at = 0;
  for (const l of layers) {
    if (!l) continue;
    const size = l.reduce((s, b) => s + across(b), 0) + gap * (l.length - 1);
    let c = (widest - size) / 2;
    const deep = Math.max(...l.map(along));
    for (const b of l) {
      const off = (deep - along(b)) / 2;
      pos.set(b.id, direction === "down" ? { x: origin.x + c, y: origin.y + at + off } : { x: origin.x + at + off, y: origin.y + c });
      c += across(b) + gap;
    }
    at += deep + gap * 1.25;
  }
  return pos;
}

/**
 * Puts `id` in the first free spot inside frame `fid`, rows left to right;
 * items in `waiting` aren't placed yet and take no room. A full frame grows
 * by a row below or a column at the right, whichever covers fewer other items.
 */
function placeInFrame(items: BoardItem[], id: string, fid: string, growing: boolean, waiting: Set<string>): BoardItem[] {
  const all = byId(items);
  const f = all.get(fid) as FrameItem;
  const it = all.get(id) as BoxItem;
  const siblings = items.filter((x) => x.frame === fid && x.id !== id && isBox(x) && !waiting.has(x.id)) as BoxItem[];
  const cols = growing ? 3 : Math.max(1, Math.floor((f.width - PAD * 2 + GAP) / (it.width + GAP)));
  const rows = growing ? 200 : Math.max(1, Math.floor((f.height - PAD * 2 + GAP) / (it.height + GAP)));
  const spot = (col: number, row: number) => ({ x: f.x + PAD + col * (it.width + GAP), y: f.y + PAD + row * (it.height + GAP), width: it.width, height: it.height });
  const free = (r: Rect) => !siblings.some((s) => rectsOverlap(r, s, GAP / 2 - 1));
  const put = (r: Rect) => {
    waiting.delete(id);
    return items.map((x) => (x.id === id ? ({ ...x, x: r.x, y: r.y } as BoardItem) : x));
  };
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) if (free(spot(col, row))) return put(spot(col, row));
  if (growing) return items;
  // Full: next to what it holds, below it or to its right.
  const right = { x: Math.max(...siblings.map((s) => s.x + s.width)) + GAP, y: f.y + PAD, width: it.width, height: it.height };
  const below = { x: f.x + PAD, y: Math.max(...siblings.map((s) => s.y + s.height)) + GAP, width: it.width, height: it.height };
  const others = items.filter((x) => x.id !== fid && x.id !== id && x.frame !== fid && isBox(x) && x.kind !== "drawing") as BoxItem[];
  const cost = (r: Rect) => {
    const grown = { x: f.x, y: f.y, width: Math.max(f.width, r.x + r.width + PAD - f.x), height: Math.max(f.height, r.y + r.height + PAD - f.y) };
    return others.filter((o) => rectsOverlap(grown, itemBounds(o, all) ?? o)).length;
  };
  return put(cost(right) < cost(below) ? right : below);
}

/** Grows a frame to hold what it holds with a margin (or, for a new auto-sized frame, fits it exactly). */
function fitFrame(items: BoardItem[], fid: string, exact: boolean): BoardItem[] {
  const all = byId(items);
  const f = all.get(fid) as FrameItem | undefined;
  if (!f) return items;
  const kids = items.filter((x) => x.frame === fid);
  const b = boundsOf(kids, all);
  if (!b) return items;
  const x1 = exact ? b.x - PAD : Math.min(f.x, b.x - PAD);
  const y1 = exact ? b.y - PAD : Math.min(f.y, b.y - PAD);
  const x2 = exact ? b.x + b.width + PAD : Math.max(f.x + f.width, b.x + b.width + PAD);
  const y2 = exact ? b.y + b.height + PAD : Math.max(f.y + f.height, b.y + b.height + PAD);
  return items.map((x) => (x.id === fid ? ({ ...x, x: Math.round(x1), y: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) } as BoardItem) : x));
}

/** New frames (with what they hold) side by side to the right of what was on the board, then loose new items in rows. */
function placeBeside(items: BoardItem[], before: BoardItem[], frames: string[], loose: string[]): BoardItem[] {
  if (!frames.length && !loose.length) return items;
  const old = boundsOf(before, byId(before));
  let x = old ? Math.round(old.x + old.width + 160) : 0;
  const top = old ? Math.round(old.y) : 0;
  let out = items;
  for (const fid of frames) {
    const f = byId(out).get(fid) as FrameItem;
    const dx = x - f.x;
    const dy = top - f.y;
    out = out.map((it) => (it.id === fid || it.frame === fid ? shift(it, dx, dy) : it));
    x += f.width + FRAME_GAP;
  }
  if (loose.length) {
    const boxes = loose.map((id) => byId(out).get(id) as BoxItem);
    const pos = gridLayout(boxes, { x, y: top }, GAP, defaultColumns(boxes.length, null));
    out = out.map((it) => {
      const p = pos.get(it.id);
      return p ? ({ ...it, x: Math.round(p.x), y: Math.round(p.y) } as BoardItem) : it;
    });
  }
  return out;
}

/**
 * What looks wrong on the board: items overlapping, text that doesn't fit,
 * items outside the frame they belong to, connectors with an end on nothing.
 * Only problems touching `touched` (null: all).
 */
export function layoutProblems(items: BoardItem[], touched: Set<string> | null): string[] {
  const all = byId(items);
  const out: string[] = [];
  const mine = (id: string) => !touched || touched.has(id);
  const solid = items.filter((it): it is BoxItem => isBox(it) && it.kind !== "frame" && it.kind !== "drawing" && it.kind !== "sticker");
  for (let i = 0; i < solid.length && out.length < 12; i++) {
    const a = solid[i]!;
    const ra = itemBounds(a, all)!;
    for (let j = i + 1; j < solid.length && out.length < 12; j++) {
      const b = solid[j]!;
      if (!mine(a.id) && !mine(b.id)) continue;
      const rb = itemBounds(b, all)!;
      const w = Math.min(ra.x + ra.width, rb.x + rb.width) - Math.max(ra.x, rb.x);
      const h = Math.min(ra.y + ra.height, rb.y + rb.height) - Math.max(ra.y, rb.y);
      if (w > 4 && h > 4) out.push(`${a.id} and ${b.id} overlap (${Math.round(w)}×${Math.round(h)}); move one.`);
    }
  }
  // Frames that overlap each other, or cover items they don't hold.
  const frames = items.filter((it): it is FrameItem => it.kind === "frame");
  for (const [i, f] of frames.entries()) {
    for (const g of frames.slice(i + 1)) if ((mine(f.id) || mine(g.id)) && rectsOverlap(f, g) && out.length < 16) out.push(`frames ${f.id} and ${g.id} overlap; move one so they sit apart.`);
    for (const it of solid) {
      if (it.frame === f.id || (!mine(f.id) && !mine(it.id)) || out.length >= 16) continue;
      const r = itemBounds(it, all)!;
      if (rectsOverlap(f, r, -4)) out.push(`frame ${f.id} covers ${it.id}, which isn't in it; move one, or put ${it.id} in the frame.`);
    }
  }
  for (const it of items) {
    if (!mine(it.id)) continue;
    if ((it.kind === "sticky" || it.kind === "shape") && it.text) {
      const box = textBox(it, "dark");
      const t = layoutText(it.text, { width: box.width, height: box.height, size: it.size, bold: it.bold, list: it.list });
      if (t.lines.length > t.fits) out.push(`${it.id}'s text doesn't fit (${t.lines.length} lines, room for ${t.fits}); make it bigger, use a smaller size, or say less.`);
    }
    if (it.frame && isBox(it)) {
      const f = all.get(it.frame);
      const r = itemBounds(it, all);
      if (f?.kind === "frame" && r && !rectContains({ x: f.x - 1, y: f.y - 1, width: f.width + 2, height: f.height + 2 }, r)) out.push(`${it.id} belongs to frame ${f.id} but is outside it; move it in, or remove its frame.`);
    }
    if (isConnector(it) && !itemBounds(it, all)) out.push(`Connector ${it.id} has an end on an item that is gone; delete it or reattach it.`);
  }
  return out;
}

function problemLines(items: BoardItem[], touched: Set<string>): string[] {
  const p = layoutProblems(items, touched);
  return p.length ? ["Check:", ...p.map((x) => `- ${x}`)] : [];
}

