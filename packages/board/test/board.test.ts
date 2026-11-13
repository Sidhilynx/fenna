import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  boardSvg,
  byId,
  canvasText,
  checkItem,
  checkItems,
  connectorPoints,
  frameAt,
  hitItem,
  ITEM_KINDS,
  itemAt,
  itemSvg,
  layoutText,
  newBoardFiles,
  newId,
  parseCanvas,
  parseHistory,
  parseMeta,
  SHAPE_KINDS,
  shapePath,
  STICKER_IDS,
  textWidth,
  wrapText,
  type BoardItem,
  type ConnectorItem,
} from "../src/index.ts";
import { readBoardFolder } from "../src/node.ts";

const sample = fileURLToPath(new URL("../../../examples/sample-board", import.meta.url));

describe("the sample board", () => {
  it("loads with no problems and uses every kind but image", () => {
    const b = readBoardFolder(sample);
    expect(b.broken).toBeNull();
    expect(b.problems).toEqual([]);
    expect(b.metaProblems).toEqual([]);
    expect(b.kept).toEqual([]);
    const kinds = new Set(b.items.map((it) => it.kind));
    for (const k of ITEM_KINDS) if (k !== "image") expect(kinds.has(k), k).toBe(true);
  });

  it("has loose stickies and an open comment on a sticky, for the agent tasks", () => {
    const b = readBoardFolder(sample);
    const loose = b.items.filter((it) => it.kind === "sticky" && !it.frame);
    expect(loose.length).toBeGreaterThanOrEqual(4);
    const threads = JSON.parse(readFileSync(path.join(sample, "comments.json"), "utf8")).threads;
    const open = threads.filter((t: { resolved: boolean }) => !t.resolved);
    expect(open).toHaveLength(1);
    expect(b.items.find((it) => it.id === open[0].item)?.kind).toBe("sticky");
  });
});

describe("checking items", () => {
  it("accepts a well-formed item of each kind", () => {
    const items: BoardItem[] = [
      { id: "a", kind: "sticky", x: 0, y: 0, width: 200, height: 200, text: "hi", color: "pink" },
      { id: "b", kind: "text", x: 0, y: 0, width: 200, height: 22, text: "hi", size: "large" },
      { id: "c", kind: "shape", shape: "diamond", x: 0, y: 0, width: 180, height: 140, text: "Valid?" },
      { id: "d", kind: "frame", x: 0, y: 0, width: 400, height: 300, title: "F" },
      { id: "e", kind: "connector", from: { item: "a" }, to: { x: 10, y: 20 }, endCap: "arrow" },
      { id: "f", kind: "drawing", x: 0, y: 0, width: 10, height: 10, points: [0, 0, 10, 10] },
      { id: "g", kind: "table", x: 0, y: 0, width: 200, height: 80, cells: [["A", "B"], ["1", "2"]] },
      { id: "h", kind: "sticker", x: 0, y: 0, width: 64, height: 64, sticker: "heart" },
      { id: "i", kind: "image", x: 0, y: 0, width: 64, height: 64, src: "assets/a.png" },
    ];
    expect(checkItems(items).problems).toEqual([]);
  });

  it("says what a misspelled field or value should be", () => {
    const p = checkItem({ id: "a", kind: "sticky", x: 0, y: 0, width: 200, height: 200, text: "", colour: "pink" }, "a");
    expect(p[0]!.message).toContain('did you mean "color"');
    const q = checkItem({ id: "a", kind: "shape", shape: "rectangle", x: 0, y: 0, width: 200, height: 100 }, "a");
    expect(q[0]!.message).toContain('did you mean "rect"');
    expect(q[0]!.message).toContain("Allowed:");
    const r = checkItem({ id: "a", kind: "sticky", x: 0, y: 0, width: 200, height: 200, text: "", color: "#ff0000" }, "a");
    expect(r[0]!.message).toContain("Allowed: yellow");
  });

  it("refuses a frame inside a frame and connector ends that point at nothing", () => {
    const res = checkItems([
      { id: "f1", kind: "frame", x: 0, y: 0, width: 100, height: 100, title: "" },
      { id: "f2", kind: "frame", x: 0, y: 0, width: 50, height: 50, title: "", frame: "f1" },
      { id: "c", kind: "connector", from: { item: "gone" }, to: { item: "f1" } },
    ]);
    expect(res.problems.some((p) => p.message.includes("can't sit inside another frame"))).toBe(true);
    expect(res.problems.some((p) => p.message.includes('"gone", which is not on the board'))).toBe(true);
  });

  it("keeps entries it can't read, so a save writes them back unchanged", () => {
    const bad = { id: "x", kind: "blob", what: 1 };
    const parsed = parseCanvas(JSON.stringify({ items: [{ id: "a", kind: "text", x: 0, y: 0, width: 10, height: 10, text: "" }, bad] }));
    expect(parsed.items.map((it) => it.id)).toEqual(["a"]);
    expect(parsed.kept).toEqual([bad]);
    expect(JSON.parse(canvasText(parsed.items, parsed.kept)).items[1]).toEqual(bad);
  });

  it("marks a damaged canvas.json as broken instead of reading it as empty", () => {
    expect(parseCanvas('{ "items": [ true, ').broken).toMatch(/not valid JSON/);
    expect(parseCanvas("[]").broken).toMatch(/no "items"/);
    expect(parseCanvas(null).broken).toBeNull();
  });
});

describe("files", () => {
  it("writes and reads a new board", () => {
    const files = newBoardFiles("  Retro  ");
    expect(parseMeta(files["board.json"]!, "x").meta.title).toBe("Retro");
    expect(parseCanvas(files["canvas.json"]!).items).toEqual([]);
  });

  it("titles a board with a missing board.json after its folder", () => {
    const m = parseMeta(null, "my-board");
    expect(m.meta.title).toBe("my-board");
    expect(m.meta.settings).toEqual({ shortcuts: true, chime: true });
  });

  it("drops damaged history entries", () => {
    expect(parseHistory('[{"id":"a","at":1,"author":"You","title":"T","label":"x","items":[]},{"id":3}]')).toHaveLength(1);
    expect(parseHistory("nope")).toEqual([]);
  });

  it("gives new ids that are not taken", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 500; i++) taken.add(newId("sticky", taken));
    expect(taken.size).toBe(500);
  });
});

describe("text layout", () => {
  it("wraps at spaces, keeps newlines, and breaks words longer than a line", () => {
    expect(wrapText("one two three", 60, 16)).toEqual(["one two", "three"]);
    expect(wrapText("a\n\nb", 200, 16)).toEqual(["a", "", "b"]);
    const long = wrapText("x".repeat(80), 100, 16);
    expect(long.length).toBeGreaterThan(5);
    for (const l of long) expect(textWidth(l, 16)).toBeLessThanOrEqual(100);
  });

  it("says how many lines fit a box", () => {
    const b = layoutText("one two three four five six seven eight nine ten", { width: 60, height: 50 });
    expect(b.lines.length).toBeGreaterThan(b.fits);
    expect(b.fits).toBe(2);
  });
});

describe("geometry", () => {
  const a: BoardItem = { id: "a", kind: "shape", shape: "rect", x: 0, y: 0, width: 100, height: 60 };
  const b: BoardItem = { id: "b", kind: "shape", shape: "rect", x: 300, y: 200, width: 100, height: 60 };
  const c: ConnectorItem = { id: "c", kind: "connector", from: { item: "a" }, to: { item: "b" } };

  it("routes an elbow from the side facing the other end", () => {
    const pts = connectorPoints(c, byId([a, b, c]))!;
    expect(pts[0]).toEqual({ x: 100, y: 30 });
    expect(pts[pts.length - 1]).toEqual({ x: 300, y: 230 });
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.x === pts[i - 1]!.x || pts[i]!.y === pts[i - 1]!.y).toBe(true);
  });

  it("follows an item when it moves", () => {
    const moved = { ...b, x: 300, y: -300 };
    const pts = connectorPoints(c, byId([a, moved, c]))!;
    expect(pts[pts.length - 1]).toEqual({ x: 300, y: -270 });
  });

  it("hits lines near their route and items under the pointer, frames last", () => {
    const all = byId([a, b, c]);
    expect(hitItem({ x: 200, y: 31 }, c, all)).toBe(true);
    const f: BoardItem = { id: "f", kind: "frame", x: -50, y: -50, width: 500, height: 400, title: "F" };
    const items = [f, a, b, c];
    expect(itemAt({ x: 50, y: 30 }, items, byId(items))?.id).toBe("a");
    expect(itemAt({ x: 40, y: 300 }, items, byId(items))?.id).toBe("f");
    expect(frameAt(a, items)?.id).toBe("f");
  });

  it("hits a rotated item in its own frame", () => {
    const r: BoardItem = { id: "r", kind: "sticky", x: 0, y: 0, width: 200, height: 20, text: "", rotation: 90 };
    expect(hitItem({ x: 100, y: 90 }, r, byId([r]))).toBe(true);
    expect(hitItem({ x: 5, y: 10 }, r, byId([r]))).toBe(false);
  });
});

describe("rendering", () => {
  const ctx = (items: BoardItem[]) => ({ theme: "dark" as const, items: byId(items) });

  it("draws every shape kind and sticker", () => {
    for (const k of SHAPE_KINDS) expect(shapePath(k, 0, 0, 100, 80).body).toMatch(/^M/);
    for (const s of STICKER_IDS) {
      const it: BoardItem = { id: "s", kind: "sticker", x: 0, y: 0, width: 64, height: 64, sticker: s };
      expect(itemSvg(it, ctx([it]))).toContain("<path");
    }
  });

  it("escapes text and cuts what doesn't fit a sticky with an ellipsis", () => {
    const s: BoardItem = { id: "s", kind: "sticky", x: 0, y: 0, width: 200, height: 200, text: `<b>&${" word".repeat(200)}` };
    const svg = itemSvg(s, ctx([s]));
    expect(svg).toContain("&lt;b&gt;&amp;");
    expect(svg).toContain("…");
    expect(svg.match(/<tspan/g)!.length).toBeLessThan(12);
  });

  it("leaves out the text of the item being edited", () => {
    const s: BoardItem = { id: "s", kind: "sticky", x: 0, y: 0, width: 200, height: 200, text: "hello" };
    expect(itemSvg(s, { ...ctx([s]), editing: "s" })).not.toContain("hello");
  });

  it("draws the sample as one SVG in both themes", () => {
    const b = readBoardFolder(sample);
    for (const theme of ["dark", "light"] as const) {
      const svg = boardSvg(b.items, { theme, items: byId(b.items) }, { x: 0, y: 0, width: 1500, height: 900 });
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.match(/data-id=/g)!.length).toBe(b.items.length);
    }
  });
});

describe("shape colors", () => {
  it("points a fill color given as color at fill", () => {
    const p = checkItem({ id: "a", kind: "shape", shape: "rect", x: 0, y: 0, width: 100, height: 60, color: "yellow" }, "a");
    expect(p[0]!.message).toContain('use fill: "yellow"');
  });
});
