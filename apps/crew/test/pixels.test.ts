import { AVATARS, MOODS } from "@opendeck/crew";
import { describe, expect, it } from "vitest";
import { GRID, SPRITES, eyeRects, spriteRects } from "../src/renderer/pixels.ts";

describe("pixel faces", () => {
  it("has a sprite for every avatar and no extra", () => {
    expect(Object.keys(SPRITES).sort()).toEqual([...AVATARS].sort());
  });

  for (const id of AVATARS) {
    const sprite = SPRITES[id];
    describe(id, () => {
      it("is 16 rows of 16 allowed characters", () => {
        expect(sprite.rows).toHaveLength(GRID);
        for (const row of sprite.rows) {
          expect(row).toHaveLength(GRID);
          expect(row).toMatch(/^[.bsk]+$/);
        }
      });

      it("keeps both eyes on body pixels, with room to look aside", () => {
        const { y, xs } = sprite.eyes;
        expect(xs[1]).toBeGreaterThan(xs[0] + 1);
        for (const x of xs) {
          for (const dy of [0, 1]) {
            for (const dx of [0, 1]) expect(sprite.rows[y + dy][x + dx], `${id} eye ${x},${y}`).toBe("b");
            for (const dx of [-1]) expect(sprite.rows[y + dy][x + dx] ?? ".", `${id} room ${x + dx},${y}`).not.toBe(".");
          }
        }
      });

      it("uses body and shade", () => {
        const all = sprite.rows.join("");
        expect(all).toContain("b");
        expect(all).toContain("s");
      });

      it("joins into rectangles that redraw the same pixels", () => {
        const grid = sprite.rows.map(() => Array<string>(GRID).fill("."));
        for (const r of spriteRects(sprite)) {
          for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid[y][x] = r.tone;
        }
        expect(grid.map((r) => r.join(""))).toEqual([...sprite.rows]);
      });

      it("has eyes for every mood", () => {
        for (const mood of MOODS) expect(eyeRects(sprite, mood)).toHaveLength(2);
      });
    });
  }

  it("has no two identical sprites", () => {
    const seen = new Set(AVATARS.map((id) => SPRITES[id].rows.join("/")));
    expect(seen.size).toBe(AVATARS.length);
  });
});
