import { describe, expect, it } from "vitest";
import { checkIndex, emptyIndex, FORMAT, LEGACY_FORMAT } from "../src/index.ts";

describe("the doc marker from before the Fenna name", () => {
  it("is still read, and comes back as the current marker", () => {
    const r = checkIndex({ ...emptyIndex("Old"), format: LEGACY_FORMAT });
    expect(r.errors).toEqual([]);
    expect(r.index?.format).toBe(FORMAT);
  });

  it("is the only other marker accepted", () => {
    expect(checkIndex({ ...emptyIndex("Odd"), format: "other/0" }).index).toBeNull();
  });
});
