import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const t = require("../main/tabs.cjs");

describe("window tabs: pure logic", () => {
  it("one deck, one tab: finds the other tab with the same folder, whatever the spelling", () => {
    const root = path.resolve("decks", "Q3");
    const tabs = [{ id: "a", root: null }, { id: "b", root }];
    expect(t.findDeckTab(tabs, root.toUpperCase(), "x")?.id).toBe("b");
    expect(t.findDeckTab(tabs, root, "b")).toBeNull();
    expect(t.findDeckTab(tabs, null, "x")).toBeNull();
  });

  it("reads tabs.json defensively: garbage, gone folders and repeats are dropped", () => {
    expect(t.parseTabsFile("not json")).toEqual({ tabs: [], activeIndex: 0 });
    expect(t.parseTabsFile({ tabs: "x" })).toEqual({ tabs: [], activeIndex: 0 });
    const a = path.resolve("a");
    const b = path.resolve("b");
    const r = t.parseTabsFile(JSON.stringify({ tabs: [{ root: a, title: "A" }, { root: b }, { root: a }, { root: null }, 7], activeIndex: 3 }), { exists: (p: string) => p !== b });
    expect(r.tabs).toEqual([{ root: a, title: "A" }, { root: null, title: "" }]);
    expect(r.activeIndex).toBe(1);
  });

  it("titles: Home is New tab; a deck its title, else its folder name", () => {
    expect(t.displayTitle({ root: null, title: "x" })).toBe("New tab");
    expect(t.displayTitle({ root: path.resolve("Q3 review"), title: "" })).toBe("Q3 review");
    expect(t.displayTitle({ root: path.resolve("q"), title: "  Pitch\u0007 " })).toBe("Pitch");
  });

  it("states: working beats done", () => {
    expect(t.deriveState({ working: true, done: true })).toBe("working");
    expect(t.deriveState({ working: false, done: true })).toBe("done");
    expect(t.deriveState({})).toBe("idle");
  });

  it("where tabs go, and which becomes active after a close", () => {
    expect(t.insertIndex(3, 0)).toBe(1);
    expect(t.insertIndex(3, -1)).toBe(3);
    expect(t.indexAfterClose(2, 2)).toBe(1);
    expect(t.indexAfterClose(0, 2)).toBe(0);
    expect(t.indexAfterClose(0, 0)).toBe(-1);
  });

  it("layout: the strip on top (taller while its card shows), the page under it", () => {
    expect(t.layoutBounds(1000, 700)).toEqual({ strip: { x: 0, y: 0, width: 1000, height: 36 }, page: { x: 0, y: 36, width: 1000, height: 664 } });
    expect(t.layoutBounds(1000, 700, 9999).strip.height).toBe(36 + 400);
  });

  it("the strip is a step darker than the page", () => {
    expect(t.stripColor("#0e0e0e", "dark")).toBe("#0a0a0a");
    expect(t.stripColor("#f6f6f5", "light")).toBe("#e6e6e5");
  });

  it("shortcuts: Ctrl on Windows, Cmd on macOS; Ctrl+Tab cycles everywhere", () => {
    const k = (key: string, mods: Record<string, boolean> = {}) => ({ type: "keyDown", key, ...mods });
    expect(t.shortcutAction(k("t", { control: true }), "win32")).toEqual({ type: "new" });
    expect(t.shortcutAction(k("T", { control: true, shift: true }), "win32")).toEqual({ type: "reopen" });
    expect(t.shortcutAction(k("w", { meta: true }), "darwin")).toEqual({ type: "close" });
    expect(t.shortcutAction(k("w", { control: true }), "darwin")).toBeNull();
    expect(t.shortcutAction(k("Tab", { control: true, shift: true }), "darwin")).toEqual({ type: "prev" });
    expect(t.shortcutAction(k("3", { control: true }), "win32")).toEqual({ type: "index", index: 2 });
    expect(t.shortcutAction(k("9", { control: true }), "win32")).toEqual({ type: "last" });
    expect(t.shortcutAction(k("t", { control: true, alt: true }), "win32")).toBeNull();
    expect(t.shortcutAction({ type: "keyUp", key: "t", control: true }, "win32")).toBeNull();
  });
});
