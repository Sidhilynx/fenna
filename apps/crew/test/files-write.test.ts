import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createStore } = require("../src/main/store.cjs");
const { createDisk } = require("../src/main/disk.cjs");
const { createFiles } = require("../src/main/files.cjs");

const SLUG = "coder";
const OUTSIDE_MSG = "That file is outside this bot's disk.";

let root: string;
let store: { botDir(slug: string): string };
let disk: any;
let files: any;
let clock: number;
let sent: [string, object][];

/** Writes a file at a disk path, its folders made, without going through the bot's tools. */
function write(p: string, data: string | Buffer) {
  const full = disk.locate(SLUG, p).abs;
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, data);
}

const onDisk = (p: string) => readFileSync(disk.locate(SLUG, p).abs);
const onDiskText = (p: string) => readFileSync(disk.locate(SLUG, p).abs, "utf8");

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crew-write-"));
  store = createStore(root);
  mkdirSync(store.botDir(SLUG), { recursive: true });
  writeFileSync(path.join(store.botDir(SLUG), "bot.md"), "# coder\n");
  disk = createDisk({ store, settingsFile: path.join(root, "disk-quotas.json") });
  clock = Date.parse("2026-11-20T10:00:00Z");
  sent = [];
  files = createFiles({ disk, now: () => new Date(clock), broadcast: (ch: string, p: object) => sent.push([ch, p]) });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("write_file", () => {
  it("creates a text file and its folders, and says how many lines it has", async () => {
    const r = await files.writeFile(SLUG, { path: "Files/Apps/todo/index.html", content: "<!doctype html>\n<h1>Todo</h1>\n" });
    expect(r.text).toBe("Wrote Files/Apps/todo/index.html (2 lines)");
    expect(onDiskText("Files/Apps/todo/index.html")).toBe("<!doctype html>\n<h1>Todo</h1>\n");
  });

  it("writes into Downloads as well", async () => {
    await files.writeFile(SLUG, { path: "Downloads/notes.txt", content: "one" });
    expect(onDiskText("Downloads/notes.txt")).toBe("one");
  });

  it("refuses Documents and Trash, and says to use the Fenna tools for documents", async () => {
    await expect(files.writeFile(SLUG, { path: "Documents/q3", content: "x" })).rejects.toThrow("Documents holds Fenna documents: change one with the fenna tools.");
    await expect(files.writeFile(SLUG, { path: "Trash/old.txt", content: "x" })).rejects.toThrow("Restore it first");
  });

  it("refuses a root, a folder, the hidden Downloads folder inside Files, and paths outside the disk", async () => {
    write("Files/notes/a.txt", "x");
    await expect(files.writeFile(SLUG, { path: "Files", content: "x" })).rejects.toThrow("is a folder, not a file");
    await expect(files.writeFile(SLUG, { path: "Files/notes", content: "x" })).rejects.toThrow("is a folder. Name a file in it");
    await expect(files.writeFile(SLUG, { path: "Files/downloads/a.txt", content: "x" })).rejects.toThrow("Files/downloads is Downloads");
    await expect(files.writeFile(SLUG, { path: "/etc/passwd", content: "x" })).rejects.toThrow(OUTSIDE_MSG);
    await expect(files.writeFile(SLUG, { path: "Files/../x.txt", content: "x" })).rejects.toThrow(OUTSIDE_MSG);
  });

  it("refuses a file in the way of a folder, and an existing file that is not text", async () => {
    write("Files/blocker", "x");
    await expect(files.writeFile(SLUG, { path: "Files/blocker/a.txt", content: "x" })).rejects.toThrow("a file is in the way");
    write("Files/photo.png", Buffer.from([0x89, 0x50, 0x00, 0xff, 0xfe]));
    await expect(files.writeFile(SLUG, { path: "Files/photo.png", content: "x" })).rejects.toThrow("isn't a text file");
  });

  it("refuses more than 2 MB, and a write that will not fit the bot's quota", async () => {
    await expect(files.writeFile(SLUG, { path: "Files/big.txt", content: "a".repeat(2 * 1024 * 1024 + 1) })).rejects.toThrow("write_file takes at most 2 MB");
    const tight = createFiles({ disk: { ...disk, free: () => 10 } });
    await expect(tight.writeFile(SLUG, { path: "Files/new.txt", content: "x".repeat(20) })).rejects.toThrow("That won't fit in the bot's disk.");
    write("Files/old.txt", "12345678");
    await expect(tight.writeFile(SLUG, { path: "Files/old.txt", content: "x".repeat(12) })).resolves.toEqual({ text: "Wrote Files/old.txt (1 lines)" });
    await expect(tight.writeFile(SLUG, { path: "Files/old.txt", content: "x".repeat(30) })).rejects.toThrow("That won't fit in the bot's disk.");
    expect(onDiskText("Files/old.txt")).toBe("x".repeat(12));
  });

  it("replaces a file whole and keeps its CRLF line endings", async () => {
    write("Files/crlf.txt", "one\r\ntwo\r\n");
    await files.writeFile(SLUG, { path: "Files/crlf.txt", content: "a\nb\nc" });
    expect(onDiskText("Files/crlf.txt")).toBe("a\r\nb\r\nc");
  });

  it("broadcasts the disk change and the edit, and marks every line of a new file", async () => {
    await files.writeFile(SLUG, { path: "Files/new.js", content: "1\n2\n3\n" });
    expect(sent).toEqual([
      ["crew:disk", { slug: SLUG }],
      ["crew:edits", { slug: SLUG }],
    ]);
    expect(files.recentEdits(SLUG)).toEqual([{ path: "Files/new.js", at: "2026-11-20T10:00:00.000Z", lines: [[1, 3]] }]);
  });
});

describe("edit_file", () => {
  it("replaces one exact match and reports the changed line", async () => {
    write("Files/app/index.html", "<html>\n<h1>Todo</h1>\n<p>Hi</p>\n");
    const r = await files.editFile(SLUG, { path: "Files/app/index.html", old_string: "<h1>Todo</h1>", new_string: "<h1>My todos</h1>" });
    expect(r.text).toBe("Edited Files/app/index.html: 1 match replaced. Changed lines 2.");
    expect(onDiskText("Files/app/index.html")).toBe("<html>\n<h1>My todos</h1>\n<p>Hi</p>\n");
  });

  it("says where a multi-line change lands, and which line a deletion leaves", async () => {
    write("Files/a.txt", "one\ntwo\nthree\nfour\n");
    const grew = await files.editFile(SLUG, { path: "Files/a.txt", old_string: "two\n", new_string: "2a\n2b\n2c\n" });
    expect(grew.text).toContain("Changed lines 2-4.");
    const cut = await files.editFile(SLUG, { path: "Files/a.txt", old_string: "2a\n2b\n2c\n", new_string: "" });
    expect(cut.text).toContain("Changed lines 2.");
    expect(onDiskText("Files/a.txt")).toBe("one\nthree\nfour\n");
  });

  it("says the text is not found, and how to find it again", async () => {
    write("Files/a.txt", "hello\n");
    await expect(files.editFile(SLUG, { path: "Files/a.txt", old_string: "bye", new_string: "x" })).rejects.toThrow(
      "old_string not found in Files/a.txt. Read the file again with read_file and copy the text exactly.",
    );
  });

  it("refuses an ambiguous match with the count, and changes all of them with replace_all", async () => {
    write("Files/a.txt", "x = 1\nx = 1\nx = 1\n");
    await expect(files.editFile(SLUG, { path: "Files/a.txt", old_string: "x = 1", new_string: "x = 2" })).rejects.toThrow(
      "old_string occurs 3 times in Files/a.txt. Add the lines around it to old_string so it occurs once, or set replace_all: true to change all 3.",
    );
    const all = await files.editFile(SLUG, { path: "Files/a.txt", old_string: "x = 1", new_string: "x = 2", replace_all: true });
    expect(all.text).toBe("Edited Files/a.txt: 3 matches replaced. Changed lines 1, 2, 3.");
    expect(onDiskText("Files/a.txt")).toBe("x = 2\nx = 2\nx = 2\n");
  });

  it("keeps CRLF line endings and a byte order mark", async () => {
    write("Files/win.txt", "﻿one\r\ntwo\r\n");
    await files.editFile(SLUG, { path: "Files/win.txt", old_string: "one\ntwo", new_string: "one\nTWO\nthree" });
    expect(onDisk("Files/win.txt")).toEqual(Buffer.from("﻿one\r\nTWO\r\nthree\r\n"));
  });

  it("matches old_string across lines in a CRLF file", async () => {
    write("Files/win.txt", "a\r\nb\r\n");
    await files.editFile(SLUG, { path: "Files/win.txt", old_string: "a\nb", new_string: "a\nc" });
    expect(onDiskText("Files/win.txt")).toBe("a\r\nc\r\n");
  });

  it("refuses an empty old_string, a no-op, a missing new_string, a binary file and a missing file", async () => {
    write("Files/a.txt", "hello\n");
    write("Files/b.bin", Buffer.from([0, 1, 2]));
    await expect(files.editFile(SLUG, { path: "Files/a.txt", old_string: "", new_string: "x" })).rejects.toThrow("Say the exact text to change");
    await expect(files.editFile(SLUG, { path: "Files/a.txt", old_string: "hello", new_string: "hello" })).rejects.toThrow("nothing would change");
    await expect(files.editFile(SLUG, { path: "Files/a.txt", old_string: "hello" })).rejects.toThrow("Say the new text in new_string");
    await expect(files.editFile(SLUG, { path: "Files/b.bin", old_string: "\u0000", new_string: "x" })).rejects.toThrow("isn't a text file");
    await expect(files.editFile(SLUG, { path: "Files/none.txt", old_string: "a", new_string: "b" })).rejects.toThrow("There is no file at Files/none.txt");
  });

  it("refuses a file in Documents", async () => {
    await expect(files.editFile(SLUG, { path: "Documents/q3", old_string: "a", new_string: "b" })).rejects.toThrow("Documents holds Fenna documents");
  });

  it("refuses a result over 2 MB and one that will not fit the bot's quota", async () => {
    write("Files/a.txt", "hello\n");
    await expect(files.editFile(SLUG, { path: "Files/a.txt", old_string: "hello", new_string: "x".repeat(2 * 1024 * 1024) })).rejects.toThrow("write_file takes at most 2 MB");
    const tight = createFiles({ disk: { ...disk, free: () => 3 } });
    await expect(tight.editFile(SLUG, { path: "Files/a.txt", old_string: "hello", new_string: "hello world" })).rejects.toThrow("That won't fit in the bot's disk.");
    expect(onDiskText("Files/a.txt")).toBe("hello\n");
  });
});

describe("the record of the bot's edits (for the Code window)", () => {
  it("lists the changed lines per file, newest first, with the time of the latest change", async () => {
    await files.writeFile(SLUG, { path: "Files/app/a.js", content: "1\n2\n3\n" });
    clock += 60_000;
    await files.editFile(SLUG, { path: "Files/app/a.js", old_string: "2", new_string: "two" });
    await files.writeFile(SLUG, { path: "Downloads/b.txt", content: "b" });
    expect(files.recentEdits(SLUG)).toEqual([
      { path: "Downloads/b.txt", at: "2026-11-20T10:01:00.000Z", lines: [[1, 1]] },
      { path: "Files/app/a.js", at: "2026-11-20T10:01:00.000Z", lines: [[1, 3], [2, 2]] },
    ]);
  });

  it("tells the windows about each edit", async () => {
    await files.writeFile(SLUG, { path: "Files/a.txt", content: "x" });
    await files.editFile(SLUG, { path: "Files/a.txt", old_string: "x", new_string: "y" });
    expect(sent.filter(([ch]) => ch === "crew:edits")).toEqual([
      ["crew:edits", { slug: SLUG }],
      ["crew:edits", { slug: SLUG }],
    ]);
    expect(sent.some(([ch]) => ch === "crew:disk")).toBe(true);
  });

  it("forgets an edit after 15 minutes", async () => {
    await files.writeFile(SLUG, { path: "Files/old.txt", content: "x" });
    clock += 15 * 60_000 - 1;
    expect(files.recentEdits(SLUG)).toHaveLength(1);
    clock += 1;
    expect(files.recentEdits(SLUG)).toEqual([]);
  });

  it("keeps only the last 200 edits", async () => {
    for (let i = 0; i < 205; i++) await files.writeFile(SLUG, { path: `Files/n${i}.txt`, content: "x" });
    const kept = files.recentEdits(SLUG);
    expect(kept).toHaveLength(200);
    expect(kept[0].path).toBe("Files/n204.txt");
    expect(kept.at(-1).path).toBe("Files/n5.txt");
  }, 30_000);

  it("records nothing for a write that changes no line", async () => {
    await files.writeFile(SLUG, { path: "Files/same.txt", content: "a\nb\n" });
    clock += 1000;
    await files.writeFile(SLUG, { path: "Files/same.txt", content: "a\nb\n" });
    expect(files.recentEdits(SLUG)).toEqual([{ path: "Files/same.txt", at: "2026-11-20T10:00:00.000Z", lines: [[1, 2]] }]);
  });

  it("keeps each bot's edits apart", async () => {
    await files.writeFile(SLUG, { path: "Files/a.txt", content: "x" });
    expect(files.recentEdits("other-bot")).toEqual([]);
  });
});
