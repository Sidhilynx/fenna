import { describe, expect, it } from "vitest";
import { FORMAT, LEGACY_FORMAT, parseMeta } from "../src/index.ts";

describe("the board marker from before the Fenna name", () => {
  it("is still read, and comes back as the current marker", () => {
    const r = parseMeta(JSON.stringify({ format: LEGACY_FORMAT, title: "Old" }), "x");
    expect(r.problems).toEqual([]);
    expect(r.meta.format).toBe(FORMAT);
  });

  it("is the only other marker accepted", () => {
    expect(parseMeta(JSON.stringify({ format: "other/0", title: "Odd" }), "x").problems).toHaveLength(1);
  });
});
