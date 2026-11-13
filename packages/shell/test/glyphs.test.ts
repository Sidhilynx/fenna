import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { GLYPHS, strokeFor } from "../renderer/ui/glyphs.ts";

const strip = () => {
  const ctx: { STRIP_GLYPHS?: Record<string, unknown> } = {};
  runInNewContext(readFileSync(path.join(__dirname, "../main/strip/glyphs.js"), "utf8"), ctx);
  return ctx.STRIP_GLYPHS!;
};

describe("glyphs", () => {
  it("every glyph draws something, with path data only", () => {
    for (const [name, g] of Object.entries(GLYPHS) as [string, { s?: string; t?: string; f?: string }][]) {
      expect(g.s || g.f, name).toBeTruthy();
      for (const d of [g.s, g.t, g.f]) if (d) expect(d, name).toMatch(/^M[-0-9.,\s MmLlHhVvCcSsQqTtAaZz]+$/);
    }
  });

  it("strokes read about 1.4–1.65px on screen at every size", () => {
    for (const size of [10, 12, 14, 16, 18, 20, 24]) {
      const px = (strokeFor(size) * size) / 20;
      expect(px).toBeGreaterThanOrEqual(1.39);
      expect(px).toBeLessThanOrEqual(1.66);
    }
  });

  it("the window strip draws the same glyphs as the renderer", () => {
    const names: Record<string, keyof typeof GLYPHS> = { home: "home", deck: "deck", doc: "doc", sheet: "sheet", plus: "plus", chevron: "chevronDown", x: "close" };
    const s = strip();
    expect(Object.keys(s).sort()).toEqual(Object.keys(names).sort());
    for (const [k, n] of Object.entries(names)) expect(s[k], k).toEqual(GLYPHS[n]);
  });
});
