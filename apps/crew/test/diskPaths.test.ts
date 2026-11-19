import { describe, expect, it } from "vitest";
import {
  baseName,
  canDrop,
  countWords,
  crumbsFor,
  filterEntries,
  formatGb,
  formatSize,
  formatWhen,
  isUnder,
  joinPath,
  kindLabel,
  nameProblem,
  nextFolderName,
  parentOf,
  rootOf,
  selectRange,
  sortEntries,
  stepIndex,
} from "../src/renderer/diskPaths.ts";
import type { DiskEntry, FileKind } from "../src/shared/contract.ts";

function entry(path: string, kind: FileKind = "doc", size = 0, edited = "2026-11-01T10:00:00.000Z"): DiskEntry {
  const name = baseName(path);
  return { path, name, kind, size, edited };
}

describe("paths", () => {
  it("joins with a slash", () => {
    expect(joinPath("Files/notes", "a.txt")).toBe("Files/notes/a.txt");
  });

  it("takes the last segment as the name", () => {
    expect(baseName("Files/notes/a.txt")).toBe("a.txt");
    expect(baseName("Documents")).toBe("Documents");
  });

  it("finds the parent, and none for a top folder", () => {
    expect(parentOf("Files/notes/a.txt")).toBe("Files/notes");
    expect(parentOf("Files/notes")).toBe("Files");
    expect(parentOf("Files")).toBeNull();
  });

  it("finds the top folder", () => {
    expect(rootOf("Documents/q3/report")).toBe("Documents");
    expect(rootOf("Trash")).toBe("Trash");
  });

  it("tells whether a path is inside a folder", () => {
    expect(isUnder("Files/a/b", "Files/a")).toBe(true);
    expect(isUnder("Files/a", "Files/a")).toBe(true);
    expect(isUnder("Files/ab", "Files/a")).toBe(false);
  });

  it("builds clickable crumbs from the top folder down", () => {
    expect(crumbsFor("Files/notes/2026")).toEqual([
      { label: "Files", path: "Files" },
      { label: "notes", path: "Files/notes" },
      { label: "2026", path: "Files/notes/2026" },
    ]);
    expect(crumbsFor("Trash")).toEqual([{ label: "Trash", path: "Trash" }]);
  });
});

describe("canDrop", () => {
  it("does not drop a folder into itself or below it", () => {
    expect(canDrop(["Files/a"], "Files/a", "move")).toBe(false);
    expect(canDrop(["Files/a"], "Files/a/b", "copy")).toBe(false);
  });

  it("does not move into the folder things are already in", () => {
    expect(canDrop(["Files/x.txt"], "Files", "move")).toBe(false);
    expect(canDrop(["Files/x.txt"], "Files", "copy")).toBe(true);
  });

  it("allows a move to a sibling, and needs something to move", () => {
    expect(canDrop(["Files/a"], "Documents", "move")).toBe(true);
    expect(canDrop([], "Documents", "move")).toBe(false);
  });

  it("refuses when any dropped path would land inside itself", () => {
    expect(canDrop(["Files/x.txt", "Files/a"], "Files/a", "move")).toBe(false);
  });
});

describe("sortEntries", () => {
  const list = [
    entry("Files/zeta.txt", "text", 10, "2026-01-02T00:00:00Z"),
    entry("Files/alpha", "folder", 0, "2026-01-01T00:00:00Z"),
    entry("Files/item10.md", "text", 300, "2026-01-05T00:00:00Z"),
    entry("Files/item2.md", "code", 5, "2026-01-03T00:00:00Z"),
    entry("Files/beta", "folder", 0, "2026-01-04T00:00:00Z"),
  ];

  it("keeps folders first and sorts names with numbers in order", () => {
    const names = sortEntries(list, { key: "name", dir: 1 }).map((e) => e.name);
    expect(names).toEqual(["alpha", "beta", "item2.md", "item10.md", "zeta.txt"]);
  });

  it("reverses the order and keeps folders on top", () => {
    const names = sortEntries(list, { key: "name", dir: -1 }).map((e) => e.name);
    expect(names).toEqual(["beta", "alpha", "zeta.txt", "item10.md", "item2.md"]);
  });

  it("sorts by size among files", () => {
    const names = sortEntries(list, { key: "size", dir: 1 }).map((e) => e.name);
    expect(names).toEqual(["alpha", "beta", "item2.md", "zeta.txt", "item10.md"]);
  });

  it("sorts by modified time among files", () => {
    const names = sortEntries(list, { key: "edited", dir: -1 }).map((e) => e.name);
    expect(names).toEqual(["beta", "alpha", "item10.md", "item2.md", "zeta.txt"]);
  });

  it("sorts by kind label and then name", () => {
    const names = sortEntries(list, { key: "kind", dir: 1 }).map((e) => e.name);
    expect(names).toEqual(["alpha", "beta", "item2.md", "item10.md", "zeta.txt"]);
  });

  it("does not change the list it was given", () => {
    const before = list.map((e) => e.path);
    sortEntries(list, { key: "size", dir: -1 });
    expect(list.map((e) => e.path)).toEqual(before);
  });

  it("handles an empty folder", () => {
    expect(sortEntries([], { key: "name", dir: 1 })).toEqual([]);
  });
});

describe("filterEntries", () => {
  const list = [entry("Files/Budget.xlsx", "sheet"), entry("Files/notes.txt", "text"), entry("Files/budget-old.txt", "text")];

  it("matches the name, ignoring case and surrounding spaces", () => {
    expect(filterEntries(list, "  BUDGET ").map((e) => e.name)).toEqual(["Budget.xlsx", "budget-old.txt"]);
  });

  it("keeps everything for an empty query", () => {
    expect(filterEntries(list, "   ")).toHaveLength(3);
  });

  it("returns nothing when no name matches", () => {
    expect(filterEntries(list, "zzz")).toEqual([]);
  });
});

describe("selectRange and stepIndex", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("selects from anchor to target, both included, either direction", () => {
    expect(selectRange(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(selectRange(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(selectRange(order, "c", "c")).toEqual(["c"]);
  });

  it("falls back to the target when the anchor is not shown", () => {
    expect(selectRange(order, "zz", "c")).toEqual(["c"]);
  });

  it("steps and stays inside the list", () => {
    expect(stepIndex(5, 0, -1)).toBe(0);
    expect(stepIndex(5, 4, 1)).toBe(4);
    expect(stepIndex(5, 1, 3)).toBe(4);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});

describe("sizes, names and labels", () => {
  it("formats bytes in binary units", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(340 * 1024 * 1024)).toBe("340 MB");
    expect(formatSize(1.2 * 1024 * 1024 * 1024)).toBe("1.2 GB");
    expect(formatSize(5 * 1024 * 1024 * 1024)).toBe("5 GB");
  });

  it("treats bad sizes as empty", () => {
    expect(formatSize(-4)).toBe("0 B");
    expect(formatSize(Number.NaN)).toBe("0 B");
  });

  it("formats a quota in GB", () => {
    expect(formatGb(10)).toBe("10 GB");
  });

  it("shows nothing for a time that does not parse", () => {
    expect(formatWhen("not a date")).toBe("");
    expect(formatWhen("2026-11-19T12:00:00Z")).not.toBe("");
  });

  it("labels each kind in sentence case", () => {
    expect(kindLabel("deck")).toBe("Slides");
    expect(kindLabel("pdf")).toBe("PDF");
    expect(kindLabel("other")).toBe("File");
  });

  it("says why a name can't be used", () => {
    expect(nameProblem("  ")).toMatch(/name/);
    expect(nameProblem(".")).not.toBeNull();
    expect(nameProblem("..")).not.toBeNull();
    expect(nameProblem("a/b")).toMatch(/\//);
    expect(nameProblem("a\\b")).not.toBeNull();
    expect(nameProblem("x".repeat(201))).not.toBeNull();
    expect(nameProblem("Q3 report.docx")).toBeNull();
    expect(nameProblem("x".repeat(200))).toBeNull();
  });

  it("numbers a new folder past the names taken, case-blind", () => {
    expect(nextFolderName([])).toBe("New folder");
    expect(nextFolderName(["new folder"])).toBe("New folder 2");
    expect(nextFolderName(["New folder", "New Folder 2", "notes"])).toBe("New folder 3");
  });

  it("counts items and what is selected", () => {
    expect(countWords(0, 0)).toBe("0 items");
    expect(countWords(1, 0)).toBe("1 item");
    expect(countWords(3, 1)).toBe("3 items, 1 selected");
  });
});
