import { describe, expect, it, vi } from "vitest";

// commands.ts imports the store and the preload API; neither is touched by shiftAddress.
vi.mock("../src/renderer/api.ts", () => ({ api: () => ({}), ASSET_BASE: "odasset://deck/" }));
vi.mock("../src/renderer/editor/store.ts", () => ({}));

const { shiftAddress } = await import("../src/renderer/editor/commands.ts");

describe("shiftAddress (addresses after an insert)", () => {
  it("moves later siblings and their descendants down by one", () => {
    expect(shiftAddress("3", "2")).toBe("4");
    expect(shiftAddress("2", "2")).toBe("3");
    expect(shiftAddress("3.1", "2")).toBe("4.1");
  });
  it("leaves earlier siblings, other branches and ancestors alone", () => {
    expect(shiftAddress("1", "2")).toBe("1");
    expect(shiftAddress("1.4", "2.0")).toBe("1.4");
    expect(shiftAddress("2", "2.0")).toBe("2");
  });
  it("works inside groups", () => {
    expect(shiftAddress("1.3", "1.1")).toBe("1.4");
    expect(shiftAddress("1.0", "1.1")).toBe("1.0");
  });
});
