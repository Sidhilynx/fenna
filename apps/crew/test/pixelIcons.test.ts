import { describe, expect, it } from "vitest";
import { PIXEL_ICONS, type PixelIconName } from "../src/renderer/pixelIcons.ts";

const NAMES: PixelIconName[] = [
  "overview", "bots", "group", "plus", "search", "settings", "connectors", "skills", "vault", "site", "browser",
  "files", "activity", "doc", "sheet", "slides", "board", "design", "library", "share", "download", "export", "duplicate",
  "check", "maximize", "restore", "close", "chevron-down", "chevron-right", "sun", "moon", "lock", "trash", "run", "stop",
  "more", "panel", "collapse", "expand", "bell", "eye", "clock", "send", "question", "shield",
  "usage", "attention", "back", "keyboard", "reload",
];

describe("pixel icons", () => {
  it("has exactly the named set", () => {
    expect(Object.keys(PIXEL_ICONS).sort()).toEqual([...NAMES].sort());
  });

  for (const name of NAMES) {
    describe(name, () => {
      const rows = PIXEL_ICONS[name];

      it("is a 12 by 12 grid of '.' and 'x'", () => {
        expect(rows).toHaveLength(12);
        for (const row of rows) {
          expect(row).toHaveLength(12);
          expect(row).toMatch(/^[.x]+$/);
        }
      });

      it("is not empty", () => {
        expect(rows.join("")).toContain("x");
      });

      it("keeps a 1px empty padding on every side", () => {
        expect(rows[0]).toBe("............");
        expect(rows[11]).toBe("............");
        for (const row of rows) {
          expect(row[0]).toBe(".");
          expect(row[11]).toBe(".");
        }
      });
    });
  }

  it("has no two identical icons", () => {
    const seen = new Map<string, PixelIconName>();
    for (const name of NAMES) {
      const key = PIXEL_ICONS[name].join("\n");
      expect(seen.has(key), `${name} repeats ${seen.get(key)}`).toBe(false);
      seen.set(key, name);
    }
  });
});
