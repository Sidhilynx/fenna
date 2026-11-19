import { describe, expect, it } from "vitest";
import { isFixed, layoutDesktop, moveIcon, newShortcutId, websiteShortcutUrl } from "../src/renderer/Desktop.tsx";
import type { DesktopShortcut } from "../src/shared/contract.ts";

const icon = (id: string, pos?: { col: number; row: number }): DesktopShortcut => ({ id, kind: "app", app: "files", label: id, ...(pos ? { pos } : {}) });
const cellsOf = (items: DesktopShortcut[], cols: number, rows: number) => Object.fromEntries([...layoutDesktop(items, cols, rows)].map(([id, c]) => [id, [c.col, c.row]]));

describe("layoutDesktop", () => {
  it("fills the first free cells column by column when no icon has a saved cell", () => {
    expect(cellsOf([icon("a"), icon("b"), icon("c")], 2, 2)).toEqual({ a: [0, 0], b: [0, 1], c: [1, 0] });
  });

  it("keeps a saved cell and fills around it", () => {
    expect(cellsOf([icon("a"), icon("b", { col: 0, row: 0 }), icon("c")], 2, 2)).toEqual({ a: [0, 1], b: [0, 0], c: [1, 0] });
  });

  it("gives a cell to the first icon that asks for it, and moves the second to a free one", () => {
    expect(cellsOf([icon("a", { col: 1, row: 1 }), icon("b", { col: 1, row: 1 })], 3, 3)).toEqual({ a: [1, 1], b: [0, 0] });
  });

  it("ignores a saved cell that is off the visible grid", () => {
    expect(cellsOf([icon("a", { col: 5, row: 0 }), icon("b", { col: 0, row: 9 })], 2, 2)).toEqual({ a: [0, 0], b: [0, 1] });
  });

  it("puts extra icons in further columns when the grid is full", () => {
    expect(cellsOf([icon("a"), icon("b"), icon("c")], 1, 2)).toEqual({ a: [0, 0], b: [0, 1], c: [1, 0] });
  });
});

describe("moveIcon", () => {
  const items = [icon("a"), icon("b"), icon("c")];
  const layout = layoutDesktop(items, 3, 3);

  it("moves an icon to a free cell and saves every icon's cell", () => {
    const next = moveIcon(items, layout, "a", { col: 2, row: 2 });
    expect(next.map((i) => [i.id, i.pos])).toEqual([
      ["a", { col: 2, row: 2 }],
      ["b", { col: 0, row: 1 }],
      ["c", { col: 0, row: 2 }],
    ]);
  });

  it("swaps two icons when the target cell is taken", () => {
    const next = moveIcon(items, layout, "a", { col: 0, row: 1 });
    expect(next.find((i) => i.id === "a")!.pos).toEqual({ col: 0, row: 1 });
    expect(next.find((i) => i.id === "b")!.pos).toEqual({ col: 0, row: 0 });
  });

  it("does not change the list it was given", () => {
    moveIcon(items, layout, "a", { col: 2, row: 2 });
    expect(items[0]!.pos).toBeUndefined();
  });
});

describe("websiteShortcutUrl", () => {
  it("adds https when there is no scheme", () => {
    expect(websiteShortcutUrl("example.com")).toEqual({ url: "https://example.com/" });
    expect(websiteShortcutUrl("  example.com/docs  ")).toEqual({ url: "https://example.com/docs" });
  });

  it("keeps an explicit http or https scheme", () => {
    expect(websiteShortcutUrl("http://example.com")).toEqual({ url: "http://example.com/" });
    expect(websiteShortcutUrl("https://example.com/a?b=1")).toEqual({ url: "https://example.com/a?b=1" });
  });

  it("accepts localhost with a port", () => {
    expect(websiteShortcutUrl("localhost:3000")).toEqual({ url: "https://localhost:3000/" });
  });

  it("refuses other schemes with a short message", () => {
    expect(websiteShortcutUrl("javascript://alert(1)")).toEqual({ error: "Only web addresses (http or https) can go on the desktop." });
    expect(websiteShortcutUrl("file:///C:/secret.txt")).toEqual({ error: "Only web addresses (http or https) can go on the desktop." });
    expect(websiteShortcutUrl("ftp://example.com")).toHaveProperty("error");
  });

  it("refuses empty input and text with spaces", () => {
    expect(websiteShortcutUrl("   ")).toHaveProperty("error");
    expect(websiteShortcutUrl("example com")).toHaveProperty("error");
  });

  it("refuses a scheme with no host", () => {
    expect(websiteShortcutUrl("https://")).toHaveProperty("error");
  });
});

describe("newShortcutId", () => {
  it("makes s- and six lowercase letters or digits", () => {
    expect(newShortcutId([])).toMatch(/^s-[a-z0-9]{6}$/);
  });

  it("avoids ids already taken", () => {
    const calls = [0, 0, 0, 0, 0, 0];
    let i = 0;
    const taken = ["s-aaaaaa"];
    const id = newShortcutId(taken, () => (i < calls.length ? calls[i++] : 0.5));
    expect(id).not.toBe("s-aaaaaa");
    expect(id).toMatch(/^s-[a-z0-9]{6}$/);
  });
});

describe("isFixed", () => {
  it("keeps the browser on the desktop and nothing else", () => {
    expect(isFixed({ id: "x", kind: "app", app: "browser", label: "Browser" })).toBe(true);
    expect(isFixed({ id: "y", kind: "app", app: "files", label: "Files" })).toBe(false);
    expect(isFixed({ id: "z", kind: "web", url: "https://example.com/", label: "Example" })).toBe(false);
  });
});
