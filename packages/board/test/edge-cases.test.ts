import { describe, expect, it } from "vitest";
import { byId, canvasText, checkItems, itemSvg, LIMITS, parseCanvas, type BoardItem } from "../src/index.ts";

function bigBoard(frames: number, stickies: number): BoardItem[] {
  const items: BoardItem[] = [];
  for (let f = 0; f < frames; f++) items.push({ id: `f-${f}`, kind: "frame", x: (f % 20) * 1200, y: Math.floor(f / 20) * 900, width: 1100, height: 800, title: `Frame ${f}` });
  for (let i = 0; i < stickies; i++) {
    const f = i % frames;
    items.push({ id: `s-${i}`, kind: "sticky", x: (f % 20) * 1200 + 20 + (i % 4) * 220, y: Math.floor(f / 20) * 900 + 40, width: 200, height: 200, text: `Note ${i}`, color: "yellow", frame: `f-${f}` });
  }
  return items;
}

describe("edge cases", () => {
  it("an empty board", () => {
    const p = parseCanvas(canvasText([]));
    expect(p.items).toEqual([]);
    expect(p.broken).toBeNull();
  });

  it("very long titles and text without spaces still render inside their box", () => {
    const f: BoardItem = { id: "f", kind: "frame", x: 0, y: 0, width: 300, height: 200, title: "T".repeat(LIMITS.titleChars) };
    const s: BoardItem = { id: "s", kind: "sticky", x: 0, y: 0, width: 200, height: 200, text: "x".repeat(5000) };
    expect(checkItems([f, s]).problems).toEqual([]);
    const all = byId([f, s]);
    expect(itemSvg(f, { theme: "light", items: all })).toContain("…");
    expect(itemSvg(s, { theme: "light", items: all })).toContain("…");
  });

  it("a title over the limit is refused with the limit", () => {
    const r = checkItems([{ id: "f", kind: "frame", x: 0, y: 0, width: 300, height: 200, title: "T".repeat(LIMITS.titleChars + 1) }]);
    expect(r.problems[0]!.message).toContain(`the most is ${LIMITS.titleChars}`);
  });

  it("a board of 300 frames and 5,000 stickies reads, checks and writes quickly", () => {
    const items = bigBoard(300, 5000);
    const t0 = performance.now();
    const text = canvasText(items);
    const back = parseCanvas(text);
    const ms = performance.now() - t0;
    expect(back.items).toHaveLength(5300);
    expect(back.problems).toEqual([]);
    expect(text.length).toBeGreaterThan(500_000);
    expect(ms).toBeLessThan(1500);
  });

  it("refuses more items than a board holds instead of reading part of them", () => {
    const text = JSON.stringify({ items: Array.from({ length: LIMITS.items + 1 }, (_, i) => ({ id: `t${i}` })) });
    expect(parseCanvas(text).broken).toMatch(/the most a board holds/);
  });
});
