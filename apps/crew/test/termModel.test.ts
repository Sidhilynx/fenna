import { describe, expect, it } from "vitest";
import type { TermEntry } from "../src/shared/contract.ts";
import { atBottom, completeLast, completeName, folderFor, historyLines, historyStep, historyValue, lastWord, mergeEntries, shortCwd } from "../src/renderer/termModel.ts";

const entry = (id: string, at: string, who: "person" | "bot", line: string, cwd = "Files", ok = true): TermEntry => ({ id, at, who, cwd, line, out: "", ok });

describe("history", () => {
  const h = ["ls", "cd notes", "cat a.txt"];

  it("walks up to the oldest command and stops there", () => {
    let pos = h.length;
    pos = historyStep(h, pos, "up");
    expect(historyValue(h, pos, "draft")).toBe("cat a.txt");
    pos = historyStep(h, pos, "up");
    pos = historyStep(h, pos, "up");
    expect(historyValue(h, pos, "draft")).toBe("ls");
    pos = historyStep(h, pos, "up");
    expect(pos).toBe(0);
  });

  it("walks down and returns the draft at the end", () => {
    let pos = 0;
    pos = historyStep(h, pos, "down");
    pos = historyStep(h, pos, "down");
    pos = historyStep(h, pos, "down");
    expect(pos).toBe(h.length);
    expect(historyValue(h, pos, "half typed")).toBe("half typed");
    expect(historyStep(h, pos, "down")).toBe(h.length);
  });

  it("copes with an empty history and a position past its end", () => {
    expect(historyStep([], 0, "up")).toBe(0);
    expect(historyStep([], 0, "down")).toBe(0);
    expect(historyValue([], 0, "x")).toBe("x");
    expect(historyStep(h, 99, "up")).toBe(2);
  });

  it("keeps only the person's commands, oldest first, without immediate repeats", () => {
    const list = [
      entry("1", "2026-01-01T10:00:00Z", "person", "ls"),
      entry("2", "2026-01-01T10:01:00Z", "bot", "zip Files/out"),
      entry("3", "2026-01-01T10:02:00Z", "person", "ls"),
      entry("4", "2026-01-01T10:03:00Z", "person", "ls"),
      entry("5", "2026-01-01T10:04:00Z", "person", "  "),
      entry("6", "2026-01-01T10:05:00Z", "person", "cat a"),
    ];
    expect(historyLines(list)).toEqual(["ls", "cat a"]);
  });
});

describe("mergeEntries", () => {
  it("sorts by time and replaces an entry with the same id", () => {
    const a = entry("a", "2026-01-01T10:00:00Z", "person", "ls");
    const b = entry("b", "2026-01-01T09:00:00Z", "bot", "help");
    const merged = mergeEntries([a], [b, { ...a, out: "file a.txt" }]);
    expect(merged.map((e) => e.id)).toEqual(["b", "a"]);
    expect(merged[1]!.out).toBe("file a.txt");
  });
});

describe("lastWord", () => {
  it("splits off the word being typed", () => {
    expect(lastWord("cat notes/a")).toEqual({ head: "cat ", word: "notes/a" });
    expect(lastWord("ls")).toEqual({ head: "", word: "ls" });
    expect(lastWord("ls ")).toEqual({ head: "ls ", word: "" });
  });
});

describe("folderFor", () => {
  it("lists the prompt's folder when the word has no folder part", () => {
    expect(folderFor("Files/work", "rep")).toEqual({ dir: "Files/work", partial: "rep" });
  });

  it("goes into the folder typed before the last slash", () => {
    expect(folderFor("Files/work", "notes/a")).toEqual({ dir: "Files/work/notes", partial: "a" });
    expect(folderFor("Files/work", "notes/")).toEqual({ dir: "Files/work/notes", partial: "" });
  });

  it("goes up with .. and starts from the top with a leading slash", () => {
    expect(folderFor("Files/work/q3", "../dr")).toEqual({ dir: "Files/work", partial: "dr" });
    expect(folderFor("Files/work", "./x")).toEqual({ dir: "Files/work", partial: "x" });
    expect(folderFor("Files/work", "/Documents/r")).toEqual({ dir: "Documents", partial: "r" });
  });

  it("does not climb above the top", () => {
    expect(folderFor("Files", "../../x")).toEqual({ dir: "", partial: "x" });
  });
});

describe("completeName", () => {
  const names = [
    { name: "report.txt", isDir: false },
    { name: "Reports", isDir: true },
    { name: "notes.md", isDir: false },
  ];

  it("finishes a single match: a folder gets a slash, a file a space", () => {
    expect(completeName("note", names)).toEqual({ text: "notes.md ", matches: ["notes.md"] });
    expect(completeName("report.", names)).toEqual({ text: "report.txt ", matches: ["report.txt"] });
    expect(completeName("Rep", [{ name: "Reports", isDir: true }])).toEqual({ text: "Reports/", matches: ["Reports/"] });
  });

  it("completes the shared start of several matches and lists them", () => {
    const got = completeName("re", names);
    expect(got.text).toBe("report");
    expect(got.matches).toEqual(["report.txt", "Reports/"]);
    const more = [
      { name: "quarter-1.csv", isDir: false },
      { name: "quarter-2.csv", isDir: false },
    ];
    expect(completeName("q", more)).toEqual({ text: "quarter-", matches: ["quarter-1.csv", "quarter-2.csv"] });
  });

  it("ignores case and keeps the typed text when nothing matches", () => {
    expect(completeName("NOTE", names).text).toBe("notes.md ");
    expect(completeName("zz", names)).toEqual({ text: "zz", matches: [] });
  });

  it("returns the name for an empty partial with one entry, and keeps it when several share no start", () => {
    expect(completeName("", [{ name: "a", isDir: false }])).toEqual({ text: "a ", matches: ["a"] });
    expect(completeName("", names).text).toBe("");
  });
});

describe("completeLast", () => {
  it("completes only the last word and keeps the folder part", () => {
    const names = [{ name: "a.txt", isDir: false }];
    expect(completeLast("cat notes/a", names)).toEqual({ line: "cat notes/a.txt ", matches: ["a.txt"] });
    expect(completeLast("cd Fi", [{ name: "Files", isDir: true }])).toEqual({ line: "cd Files/", matches: ["Files/"] });
  });
});

describe("shortCwd", () => {
  it("shows short folders whole and the top as a slash", () => {
    expect(shortCwd("Files")).toBe("Files");
    expect(shortCwd("Files/work/q3")).toBe("Files/work/q3");
    expect(shortCwd("")).toBe("/");
  });

  it("elides the middle of a deep folder", () => {
    expect(shortCwd("Files/a/b/c/d")).toBe("Files/…/c/d");
    expect(shortCwd("Documents/x/y/z", 1)).toBe("Documents/…/z");
  });
});

describe("atBottom", () => {
  it("is true within the slack of the end", () => {
    expect(atBottom(500, 1000, 500)).toBe(true);
    expect(atBottom(492, 1000, 500)).toBe(true);
    expect(atBottom(300, 1000, 500)).toBe(false);
  });
});
