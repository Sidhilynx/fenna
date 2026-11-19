import { describe, expect, it } from "vitest";
import { FENNA_APPS } from "@opendeck/crew";
import { KIND_NOUN, kindNewestFirst, newDocTitle } from "../src/renderer/AppLauncher.tsx";
import type { LibraryItem } from "../src/shared/contract.ts";

const item = (path: string, kind: LibraryItem["kind"], edited: string): LibraryItem => ({ path, kind, title: path, edited });

describe("kindNewestFirst", () => {
  it("keeps only the kind asked for, newest edit first", () => {
    const library = [
      item("a", "doc", "2026-11-01T10:00:00.000Z"),
      item("b", "sheet", "2026-11-18T10:00:00.000Z"),
      item("c", "doc", "2026-11-18T09:00:00.000Z"),
      item("d", "doc", "2026-11-05T10:00:00.000Z"),
    ];
    expect(kindNewestFirst(library, "doc").map((f) => f.path)).toEqual(["c", "d", "a"]);
  });

  it("returns an empty list when the bot has none of that kind", () => {
    expect(kindNewestFirst([item("a", "doc", "2026-11-01T10:00:00.000Z")], "deck")).toEqual([]);
  });

  it("does not reorder the library it was given", () => {
    const library = [item("a", "doc", "2026-11-01T10:00:00.000Z"), item("b", "doc", "2026-11-02T10:00:00.000Z")];
    kindNewestFirst(library, "doc");
    expect(library.map((f) => f.path)).toEqual(["a", "b"]);
  });

  it("puts a document with an unreadable time last instead of failing", () => {
    const library = [item("bad", "doc", "not a time"), item("ok", "doc", "2026-11-01T10:00:00.000Z")];
    expect(kindNewestFirst(library, "doc").map((f) => f.path)).toEqual(["ok", "bad"]);
  });
});

describe("newDocTitle", () => {
  it("trims what the person typed", () => {
    expect(newDocTitle("  Q3 plan  ", "doc")).toBe("Q3 plan");
  });

  it("falls back to Untitled and the kind's noun when the title is empty or only spaces", () => {
    expect(newDocTitle("", "sheet")).toBe("Untitled sheet");
    expect(newDocTitle("   ", "board")).toBe("Untitled whiteboard");
  });
});

describe("KIND_NOUN", () => {
  it("names every Fenna app's kind", () => {
    for (const app of FENNA_APPS) expect(KIND_NOUN[app.kind]).toBeTruthy();
  });
});
