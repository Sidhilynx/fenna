import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createStore } = require("../src/main/store.cjs");
const { createDisk, freeOnDrive, DISK_QUOTAS_GB, IMPORT_MAX } = require("../src/main/disk.cjs");

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const SLUG = "research";
const LINK_MSG = "A link can't be used on the bot's disk.";
const OUTSIDE_MSG = "That file is outside this bot's disk.";

const starterFiles = (kind: string, title: string) => ({
  [`${kind}.json`]: JSON.stringify({ title }),
  "tabs/tab-1.html": "<article></article>",
});

let root: string;
let outside: string;
let events: [string, object][];
let store: { botDir(slug: string): string };
let disk: any;
let settingsFile: string;

const botDir = () => store.botDir(SLUG);
const wsPath = (rel: string) => path.join(botDir(), "workspace", rel);
const libPath = (rel: string) => path.join(botDir(), "library", rel);

function writeWs(rel: string, text = "hello world") {
  mkdirSync(path.dirname(wsPath(rel)), { recursive: true });
  writeFileSync(wsPath(rel), text);
}

function names(dir: string) {
  return disk.list(SLUG, dir).entries.map((e: { name: string }) => e.name);
}

function makeDisk() {
  disk = createDisk({ store, broadcast: (channel: string, payload: object) => events.push([channel, payload]), starterFiles, settingsFile });
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crew-disk-"));
  outside = mkdtempSync(path.join(tmpdir(), "crew-disk-outside-"));
  events = [];
  store = createStore(root);
  settingsFile = path.join(root, "disk-quotas.json");
  mkdirSync(botDir(), { recursive: true });
  writeFileSync(path.join(botDir(), "bot.md"), "# research\n");
  makeDisk();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("disk paths", () => {
  const bad = [
    "../x",
    "Files/../../x",
    "Files/..",
    "Files/.",
    "/etc/passwd",
    "\\\\server\\share\\x",
    "C:/Windows",
    "Files\\x",
    "Files/a:b",
    "Nope/x",
    "Files//x",
    "Files/",
    "Files/.index.json",
    "Trash/.index.json",
    `Files/${"a".repeat(256)}`,
    "Files/CON",
    "Files/name.",
    "Files/name ",
    "Files/a\u0000b",
  ];

  it.each(bad)("refuses %j in every call that takes a path", (p) => {
    expect(() => disk.list(SLUG, p)).toThrow();
    expect(() => disk.op(SLUG, { op: "mkdir", path: p })).toThrow();
    expect(() => disk.op(SLUG, { op: "trash", paths: [p] })).toThrow();
    expect(() => disk.url(SLUG, p)).toThrow();
  });

  it("says outside for escapes, drive letters, backslashes and roots that are not roots", () => {
    expect(() => disk.list(SLUG, "../x")).toThrow(OUTSIDE_MSG);
    expect(() => disk.list(SLUG, "/etc/passwd")).toThrow(OUTSIDE_MSG);
    expect(() => disk.list(SLUG, "C:/Windows")).toThrow(OUTSIDE_MSG);
    expect(() => disk.list(SLUG, "Files\\x")).toThrow(OUTSIDE_MSG);
    expect(() => disk.list(SLUG, "Nope/x")).toThrow(OUTSIDE_MSG);
  });

  it("never creates or touches anything outside the bot's folder", () => {
    writeFileSync(path.join(root, "secret.txt"), "keep me");
    expect(() => disk.op(SLUG, { op: "mkdir", path: "Files/../../made" })).toThrow();
    expect(() => disk.op(SLUG, { op: "trash", paths: ["Files/../../secret.txt"] })).toThrow();
    expect(() => disk.op(SLUG, { op: "rename", path: "Files/../../secret.txt", name: "x" })).toThrow();
    expect(existsSync(path.join(root, "made"))).toBe(false);
    expect(readFileSync(path.join(root, "secret.txt"), "utf8")).toBe("keep me");
  });

  it("refuses a bot that is not there, and a bad folder name", () => {
    expect(() => disk.list("nobody", "")).toThrow('There is no bot "nobody".');
    expect(() => disk.list("Bad Slug", "")).toThrow();
  });
});

describe("links", () => {
  let link: string;

  beforeEach(() => {
    writeFileSync(path.join(outside, "secret.txt"), "secret");
    link = wsPath("link");
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  });

  it("refuses to list, make, move, trash or read through a junction or link", () => {
    expect(() => disk.list(SLUG, "Files/link")).toThrow(LINK_MSG);
    expect(() => disk.op(SLUG, { op: "mkdir", path: "Files/link/new" })).toThrow(LINK_MSG);
    expect(() => disk.url(SLUG, "Files/link/secret.txt")).toThrow(LINK_MSG);
    expect(() => disk.op(SLUG, { op: "trash", paths: ["Files/link"] })).toThrow(LINK_MSG);
    expect(() => disk.op(SLUG, { op: "import", to: "Files/link", files: [{ name: "a.txt", bytes: new TextEncoder().encode("x").buffer }] })).toThrow(LINK_MSG);
    expect(existsSync(path.join(outside, "new"))).toBe(false);
    expect(readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("secret");
  });

  it("does not list links in a folder, and does not copy a folder that holds one", () => {
    writeWs("plain/a.txt");
    symlinkSync(outside, path.join(wsPath("plain"), "out"), process.platform === "win32" ? "junction" : "dir");
    expect(names("Files/plain")).toEqual(["a.txt"]);
    expect(() => disk.op(SLUG, { op: "copy", paths: ["Files/plain"], to: "Downloads" })).toThrow(LINK_MSG);
    expect(existsSync(wsPath("downloads/plain"))).toBe(false);
  });
});

describe("roots", () => {
  it("lists the four roots at the top", () => {
    const { entries } = disk.list(SLUG, "");
    expect(entries.map((e: { path: string }) => e.path)).toEqual(["Files", "Documents", "Downloads", "Trash"]);
    expect(entries.every((e: { kind: string }) => e.kind === "folder")).toBe(true);
  });

  it("refuses to rename, move, copy or trash a root, and to use Files/downloads as a folder of its own", () => {
    expect(() => disk.op(SLUG, { op: "rename", path: "Files", name: "x" })).toThrow("can't be renamed");
    expect(() => disk.op(SLUG, { op: "rename", path: "Documents", name: "x" })).toThrow("can't be renamed");
    expect(() => disk.op(SLUG, { op: "move", paths: ["Downloads"], to: "Files" })).toThrow("can't be moved or copied");
    expect(() => disk.op(SLUG, { op: "copy", paths: ["Files"], to: "Downloads" })).toThrow("can't be moved or copied");
    expect(() => disk.op(SLUG, { op: "trash", paths: ["Trash"] })).toThrow("can't be thrown away");
    expect(() => disk.op(SLUG, { op: "trash", paths: ["Files/downloads"] })).toThrow("can't be thrown away");
    expect(() => disk.op(SLUG, { op: "rename", path: "Files/downloads", name: "dl" })).toThrow("can't be renamed");
    expect(() => disk.op(SLUG, { op: "mkdir", path: "Files/downloads" })).toThrow("already there");
    expect(existsSync(wsPath("downloads"))).toBe(true);
  });

  it("moves things into Trash only through trash, and out of it only through restore", () => {
    writeWs("a.txt");
    writeWs("b.txt");
    expect(() => disk.op(SLUG, { op: "move", paths: ["Files/a.txt"], to: "Trash" })).toThrow("Use Trash");
    expect(() => disk.op(SLUG, { op: "copy", paths: ["Files/a.txt"], to: "Trash" })).toThrow("Use Trash");
    disk.op(SLUG, { op: "trash", paths: ["Files/b.txt"] });
    expect(() => disk.op(SLUG, { op: "move", paths: ["Trash/b.txt"], to: "Files" })).toThrow("Restore it first");
    expect(() => disk.op(SLUG, { op: "rename", path: "Trash/b.txt", name: "c.txt" })).toThrow("Restore it to rename it");
  });

  it("refuses to trash an item that is already in Trash", () => {
    writeWs("a.txt");
    disk.op(SLUG, { op: "trash", paths: ["Files/a.txt"] });
    expect(() => disk.op(SLUG, { op: "trash", paths: ["Trash/a.txt"] })).toThrow("already in Trash");
  });
});

describe("Documents", () => {
  it("keeps documents in Documents: they can be renamed (to a slug), trashed and restored, not moved out or into", async () => {
    const { path: name } = disk.newDoc(SLUG, "doc", "Q3 report");
    expect(name).toBe("q3-report");
    writeWs("notes.txt");
    mkdirSync(wsPath("plain"));
    writeWs("plain/x.txt");

    expect(() => disk.op(SLUG, { op: "move", paths: ["Documents/q3-report"], to: "Files" })).toThrow("stays in Documents");
    expect(() => disk.op(SLUG, { op: "copy", paths: ["Files/notes.txt"], to: "Documents" })).toThrow("Documents holds documents only");
    expect(() => disk.op(SLUG, { op: "move", paths: ["Files/notes.txt"], to: "Documents" })).toThrow("Documents holds documents only");
    expect(() => disk.op(SLUG, { op: "copy", paths: ["Files/plain"], to: "Documents" })).toThrow("Documents holds documents only");
    expect(() => disk.op(SLUG, { op: "mkdir", path: "Documents/extra" })).toThrow("Documents holds documents only");
    expect(() => disk.op(SLUG, { op: "import", to: "Documents", files: [{ name: "a.txt", bytes: new TextEncoder().encode("x").buffer }] })).toThrow("Documents holds documents only");
    expect(() => disk.op(SLUG, { op: "rename", path: "Documents/q3-report", name: "Q3 Report!" })).toThrow("lowercase letters");
    expect(() => disk.list(SLUG, "Documents/q3-report")).toThrow("A document is one entry");
    expect(existsSync(libPath("plain"))).toBe(false);
  });

  it("lists only folders that hold a Fenna document, with kind and title", () => {
    disk.newDoc(SLUG, "sheet", "Budget");
    mkdirSync(libPath("stray"));
    const docs = disk.list(SLUG, "Documents").entries;
    expect(docs).toEqual([expect.objectContaining({ path: "Documents/budget", name: "budget", kind: "sheet", title: "Budget" })]);
  });

  it("renames a document to a slug and copies it out to Files", () => {
    disk.newDoc(SLUG, "doc", "Q3 report");
    const after = disk.op(SLUG, { op: "rename", path: "Documents/q3-report", name: "q3-final" });
    expect(after.entries.map((e: { name: string }) => e.name)).toEqual(["q3-final"]);
    disk.op(SLUG, { op: "copy", paths: ["Documents/q3-final"], to: "Files" });
    expect(existsSync(wsPath("q3-final/doc.json"))).toBe(true);
    expect(existsSync(libPath("q3-final/doc.json"))).toBe(true);
  });

  it("trashes a document and restores it, with a slug when its name is taken", () => {
    disk.newDoc(SLUG, "doc", "Q3 final");
    disk.op(SLUG, { op: "trash", paths: ["Documents/q3-final"] });
    expect(names("Documents")).toEqual([]);
    const trashed = disk.list(SLUG, "Trash").entries;
    expect(trashed).toEqual([expect.objectContaining({ path: "Trash/q3-final", kind: "doc", from: "Documents/q3-final", title: "Q3 final" })]);

    disk.newDoc(SLUG, "doc", "Q3 final");
    disk.op(SLUG, { op: "restore", paths: ["Trash/q3-final"] });
    expect(names("Documents")).toEqual(["q3-final", "q3-final-2"]);
    expect(names("Trash")).toEqual([]);
  });

  it("restores anything that is not a document from a Documents record into Files", () => {
    mkdirSync(path.join(botDir(), "trash"), { recursive: true });
    mkdirSync(path.join(botDir(), "trash", "plain"));
    writeFileSync(path.join(botDir(), "trash", ".index.json"), JSON.stringify([{ name: "plain", from: "Documents/plain", at: "2026-01-01T00:00:00.000Z" }]));
    disk.op(SLUG, { op: "restore", paths: ["Trash/plain"] });
    expect(existsSync(wsPath("plain"))).toBe(true);
    expect(names("Documents")).toEqual([]);
  });
});

describe("listing", () => {
  it("sorts folders first, then names in natural order ignoring case, and kinds files by extension", () => {
    for (const f of ["b.txt", "A.md", "10.png", "2.png", "video.MP4", "x.zip", "y.unknown", "code.ts", "doc.pdf", "song.flac", "sheet.csv", ".hidden"]) writeWs(f, "x");
    for (const d of ["zeta", "alpha", "folder"]) mkdirSync(wsPath(d));

    const entries = disk.list(SLUG, "Files").entries as { name: string; kind: string }[];
    expect(entries.map((e) => e.name)).toEqual(["alpha", "folder", "zeta", "2.png", "10.png", "A.md", "b.txt", "code.ts", "doc.pdf", "sheet.csv", "song.flac", "video.MP4", "x.zip", "y.unknown"]);
    const kinds = Object.fromEntries(entries.map((e) => [e.name, e.kind]));
    expect(kinds).toMatchObject({
      alpha: "folder",
      "2.png": "image",
      "A.md": "text",
      "code.ts": "code",
      "doc.pdf": "pdf",
      "song.flac": "audio",
      "video.MP4": "video",
      "x.zip": "archive",
      "y.unknown": "other",
    });
  });

  it("shows sizes and times, and the bot's disk use and size", () => {
    writeWs("a.txt", "12345");
    const listing = disk.list(SLUG, "Files");
    expect(listing.entries[0]).toMatchObject({ path: "Files/a.txt", size: 5 });
    expect(Date.parse(listing.entries[0].edited)).not.toBeNaN();
    expect(listing.used).toBeGreaterThanOrEqual(5);
    expect(listing.quota).toBe(5 * GB);
  });

  it("refuses a file as a folder and a missing folder", () => {
    writeWs("a.txt");
    expect(() => disk.list(SLUG, "Files/a.txt")).toThrow("That isn't a folder.");
    expect(() => disk.list(SLUG, "Files/missing")).toThrow("That folder isn't there.");
  });
});

describe("mkdir and rename", () => {
  it("makes a folder and says where it is", () => {
    const after = disk.op(SLUG, { op: "mkdir", path: "Files/notes" });
    expect(after.entries.map((e: { name: string }) => e.name)).toEqual(["notes"]);
    expect(existsSync(wsPath("notes"))).toBe(true);
    expect(events).toContainEqual(["crew:disk", { slug: SLUG }]);
  });

  it("refuses a name that is already there, and a folder whose parent is not there", () => {
    writeWs("a.txt");
    expect(() => disk.op(SLUG, { op: "mkdir", path: "Files/a.txt" })).toThrow("already a file called");
    expect(() => disk.op(SLUG, { op: "mkdir", path: "Files/missing/new" })).toThrow("That folder isn't there.");
  });

  it("renames without overwriting, and allows a change of case", () => {
    writeWs("a.txt", "one");
    writeWs("b.txt", "two");
    expect(() => disk.op(SLUG, { op: "rename", path: "Files/a.txt", name: "b.txt" })).toThrow("already a file called");
    expect(readFileSync(wsPath("b.txt"), "utf8")).toBe("two");
    disk.op(SLUG, { op: "rename", path: "Files/a.txt", name: "A.txt" });
    expect(names("Files")).toContain("A.txt");
  });

  it("refuses names with a slash, a backslash, a colon or a dot", () => {
    writeWs("a.txt");
    for (const name of ["x/y", "x\\y", "x:y", ".", "..", "  ", ".hidden", "CON", "trail."]) {
      expect(() => disk.op(SLUG, { op: "rename", path: "Files/a.txt", name })).toThrow();
    }
    expect(existsSync(wsPath("a.txt"))).toBe(true);
  });
});

describe("move and copy", () => {
  it("names a copy that clashes with (2)", () => {
    writeWs("a.txt", "one");
    disk.op(SLUG, { op: "mkdir", path: "Files/sub" });
    disk.op(SLUG, { op: "copy", paths: ["Files/a.txt"], to: "Files/sub" });
    disk.op(SLUG, { op: "copy", paths: ["Files/a.txt"], to: "Files/sub" });
    expect(names("Files/sub")).toEqual(["a (2).txt", "a.txt"]);
    expect(readFileSync(wsPath("sub/a (2).txt"), "utf8")).toBe("one");
  });

  it("names a moved file that clashes, and leaves the source gone", () => {
    writeWs("a.txt", "one");
    disk.op(SLUG, { op: "mkdir", path: "Files/sub" });
    writeWs("sub/a.txt", "two");
    disk.op(SLUG, { op: "move", paths: ["Files/a.txt"], to: "Files/sub" });
    expect(existsSync(wsPath("a.txt"))).toBe(false);
    expect(readFileSync(wsPath("sub/a (2).txt"), "utf8")).toBe("one");
    expect(readFileSync(wsPath("sub/a.txt"), "utf8")).toBe("two");
  });

  it("does nothing when a file is moved into the folder it is already in", () => {
    writeWs("sub/a.txt", "x");
    const after = disk.op(SLUG, { op: "move", paths: ["Files/sub/a.txt"], to: "Files/sub" });
    expect(after.entries.map((e: { name: string }) => e.name)).toEqual(["a.txt"]);
    expect(existsSync(wsPath("sub/a.txt"))).toBe(true);
  });

  it("refuses a folder moved or copied into itself", () => {
    mkdirSync(wsPath("sub/inner"), { recursive: true });
    expect(() => disk.op(SLUG, { op: "move", paths: ["Files/sub"], to: "Files/sub/inner" })).toThrow("inside itself");
    expect(() => disk.op(SLUG, { op: "copy", paths: ["Files/sub"], to: "Files/sub" })).toThrow("inside itself");
    expect(existsSync(wsPath("sub/inner"))).toBe(true);
  });

  it("copies a folder recursively, naming it when the name is taken", () => {
    writeWs("sub/deep/a.txt", "deep");
    disk.op(SLUG, { op: "mkdir", path: "Files/other" });
    disk.op(SLUG, { op: "copy", paths: ["Files/sub"], to: "Files/other" });
    disk.op(SLUG, { op: "copy", paths: ["Files/sub"], to: "Files/other" });
    expect(readFileSync(wsPath("other/sub/deep/a.txt"), "utf8")).toBe("deep");
    expect(readFileSync(wsPath("other/sub (2)/deep/a.txt"), "utf8")).toBe("deep");
    expect(existsSync(wsPath("sub/deep/a.txt"))).toBe(true);
  });

  it("validates every item before it moves any", () => {
    writeWs("a.txt");
    expect(() => disk.op(SLUG, { op: "move", paths: ["Files/a.txt", "Files/missing.txt"], to: "Files/x" })).toThrow();
    expect(existsSync(wsPath("a.txt"))).toBe(true);
  });

  it("refuses a destination that is not a folder, and an empty list", () => {
    writeWs("a.txt");
    writeWs("b.txt");
    expect(() => disk.op(SLUG, { op: "move", paths: ["Files/b.txt"], to: "Files/a.txt" })).toThrow("That isn't a folder.");
    expect(() => disk.op(SLUG, { op: "move", paths: [], to: "Files" })).toThrow("Pick at least one");
  });
});

describe("trash and restore", () => {
  it("trashes into Trash with where it came from, and restores it", () => {
    writeWs("a.txt", "one");
    const after = disk.op(SLUG, { op: "trash", paths: ["Files/a.txt"] });
    expect(after.entries.map((e: { name: string }) => e.name)).not.toContain("a.txt");
    expect(disk.list(SLUG, "Trash").entries).toEqual([expect.objectContaining({ path: "Trash/a.txt", name: "a.txt", from: "Files/a.txt" })]);

    disk.op(SLUG, { op: "restore", paths: ["Trash/a.txt"] });
    expect(readFileSync(wsPath("a.txt"), "utf8")).toBe("one");
    expect(names("Trash")).toEqual([]);
  });

  it("gives clashing trash items unique names and restores each with (2) when its place is taken", () => {
    writeWs("a.txt", "first");
    disk.op(SLUG, { op: "trash", paths: ["Files/a.txt"] });
    writeWs("a.txt", "second");
    disk.op(SLUG, { op: "trash", paths: ["Files/a.txt"] });
    const trashed = disk.list(SLUG, "Trash").entries as { path: string; name: string }[];
    expect(trashed.map((e) => e.path).sort()).toEqual(["Trash/a (2).txt", "Trash/a.txt"]);
    expect(trashed.every((e) => e.name === "a.txt")).toBe(true);

    writeWs("a.txt", "new");
    disk.op(SLUG, { op: "restore", paths: ["Trash/a.txt"] });
    expect(readFileSync(wsPath("a (2).txt"), "utf8")).toBe("first");
    disk.op(SLUG, { op: "restore", paths: ["Trash/a (2).txt"] });
    expect(readFileSync(wsPath("a (3).txt"), "utf8")).toBe("second");
    expect(readFileSync(wsPath("a.txt"), "utf8")).toBe("new");
    expect(names("Trash")).toEqual([]);
  });

  it("recreates the folder an item came from when it is gone", () => {
    writeWs("notes/a.txt", "kept");
    disk.op(SLUG, { op: "trash", paths: ["Files/notes/a.txt"] });
    rmSync(wsPath("notes"), { recursive: true, force: true });
    disk.op(SLUG, { op: "restore", paths: ["Trash/a.txt"] });
    expect(readFileSync(wsPath("notes/a.txt"), "utf8")).toBe("kept");
  });

  it("restores into Files when the folder it came from is now a file", () => {
    writeWs("gone/a.txt", "x");
    disk.op(SLUG, { op: "trash", paths: ["Files/gone/a.txt"] });
    rmSync(wsPath("gone"), { recursive: true, force: true });
    writeWs("gone", "now a file");
    disk.op(SLUG, { op: "restore", paths: ["Trash/a.txt"] });
    expect(readFileSync(wsPath("a.txt"), "utf8")).toBe("x");
  });

  it("refuses a restore of anything that is not in Trash", () => {
    writeWs("a.txt");
    expect(() => disk.op(SLUG, { op: "restore", paths: ["Files/a.txt"] })).toThrow("Pick items in Trash");
    expect(() => disk.op(SLUG, { op: "restore", paths: ["Trash/nothing.txt"] })).toThrow("isn't in Trash");
  });

  it("empties Trash for good", () => {
    writeWs("a.txt");
    writeWs("dir/b.txt");
    disk.op(SLUG, { op: "trash", paths: ["Files/a.txt", "Files/dir"] });
    expect(names("Trash").length).toBe(2);
    const after = disk.op(SLUG, { op: "emptyTrash" });
    expect(after.entries).toEqual([]);
    expect(existsSync(path.join(botDir(), "trash", "a.txt"))).toBe(false);
    expect(existsSync(path.join(botDir(), "trash", ".index.json"))).toBe(true);
  });
});

describe("import and quota", () => {
  const bytes = (text: string) => new TextEncoder().encode(text).buffer;

  it("sanitises imported names and writes them", () => {
    const after = disk.op(SLUG, {
      op: "import",
      to: "Files",
      files: [
        { name: "..\\evil:name?.txt", bytes: bytes("one") },
        { name: "CON", bytes: bytes("two") },
        { name: ".bashrc", bytes: bytes("three") },
      ],
    });
    expect(readFileSync(wsPath("evil_name_.txt"), "utf8")).toBe("one");
    expect(readFileSync(wsPath("_CON"), "utf8")).toBe("two");
    expect(readFileSync(wsPath("bashrc"), "utf8")).toBe("three");
    expect(after.entries.map((e: { name: string }) => e.name)).toEqual(["_CON", "bashrc", "evil_name_.txt"]);
  });

  it("names an import that clashes", () => {
    writeWs("a.txt", "old");
    disk.op(SLUG, { op: "import", to: "Files", files: [{ name: "a.txt", bytes: bytes("new") }] });
    expect(readFileSync(wsPath("a (2).txt"), "utf8")).toBe("new");
  });

  it("refuses an import over 200 MB", () => {
    expect(() => disk.op(SLUG, { op: "import", to: "Files", files: [{ name: "big.bin", bytes: new ArrayBuffer(IMPORT_MAX + 1) }] })).toThrow("larger than 200 MB");
    expect(existsSync(wsPath("big.bin"))).toBe(false);
  });

  it("refuses an import, and a copy, that will not fit in the quota", () => {
    writeWs("filler.bin", "x");
    truncateSync(wsPath("filler.bin"), 5 * GB - MB);
    writeWs("small.txt", "small");
    expect(() => disk.op(SLUG, { op: "import", to: "Files", files: [{ name: "big.bin", bytes: new ArrayBuffer(2 * MB) }] })).toThrow("won't fit in the bot's disk");
    expect(existsSync(wsPath("big.bin"))).toBe(false);
    expect(() => disk.op(SLUG, { op: "copy", paths: ["Files/filler.bin"], to: "Downloads" })).toThrow("won't fit");
    expect(existsSync(wsPath("downloads/filler.bin"))).toBe(false);
    disk.op(SLUG, { op: "import", to: "Files", files: [{ name: "fits.txt", bytes: bytes("fits") }] });
    expect(readFileSync(wsPath("fits.txt"), "utf8")).toBe("fits");
  });

  it("defaults to 5 GB and keeps a size the person picked, only from the offered sizes", () => {
    expect(disk.quota(SLUG)).toBe(5 * GB);
    expect(() => disk.setQuota(SLUG, 3)).toThrow("A bot's disk is 1, 2, 5, 10, 20, 50 GB.");
    expect(() => disk.setQuota(SLUG, 30)).toThrow("A bot's disk is 1, 2, 5, 10, 20, 50 GB.");
    expect(() => disk.setQuota(SLUG, "10")).toThrow("A bot's disk is");
    const listing = disk.setQuota(SLUG, 10);
    expect(listing.quota).toBe(10 * GB);
    expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toEqual({ [SLUG]: 10 });
    makeDisk();
    expect(disk.quota(SLUG)).toBe(10 * GB);
    expect(disk.free(SLUG)).toBeGreaterThan(9 * GB);
  });

  it("offers 50 GB as a disk size", () => {
    expect(DISK_QUOTAS_GB).toContain(50);
    expect(disk.setQuota(SLUG, 50).quota).toBe(50 * GB);
    expect(disk.quota(SLUG)).toBe(50 * GB);
  });

  it("refuses a smaller disk than what is already on it", () => {
    writeWs("filler.bin", "x");
    truncateSync(wsPath("filler.bin"), 2 * GB);
    expect(() => disk.setQuota(SLUG, 1)).toThrow("Empty some space first");
    expect(disk.quota(SLUG)).toBe(5 * GB);
  });
});

describe("files that leave the bot's disk", () => {
  it("gives the file in Files or Downloads, by its folder", () => {
    writeWs("notes/a.txt", "a");
    mkdirSync(wsPath("downloads"), { recursive: true });
    writeFileSync(wsPath("downloads/b.pdf"), "b");
    expect(disk.exportable(SLUG, "Files/notes/a.txt")).toEqual({ abs: wsPath("notes/a.txt"), name: "a.txt" });
    expect(disk.exportable(SLUG, "Downloads/b.pdf")).toEqual({ abs: wsPath("downloads/b.pdf"), name: "b.pdf" });
  });

  it("refuses Fenna documents, Trash, folders, the roots, and anything outside the bot", () => {
    const made = disk.newDoc(SLUG, "doc", "Q3 report");
    expect(() => disk.exportable(SLUG, `Documents/${made.path}`)).toThrow("A Fenna document can't be copied to this computer.");
    expect(() => disk.exportable(SLUG, `Documents/${made.path}/doc.json`)).toThrow("A Fenna document can't be copied to this computer.");
    expect(() => disk.exportable(SLUG, "Trash/old.txt")).toThrow("Restore it from Trash first.");
    writeWs("notes/a.txt", "a");
    expect(() => disk.exportable(SLUG, "Files/notes")).toThrow("Only files can be copied to this computer.");
    expect(() => disk.exportable(SLUG, "Files")).toThrow("Only files can be copied to this computer.");
    expect(() => disk.exportable(SLUG, "Files/missing.txt")).toThrow("That file isn't there any more.");
    expect(() => disk.exportable(SLUG, "../../etc/passwd")).toThrow();
    expect(() => disk.exportable(SLUG, path.join(outside, "x.txt"))).toThrow();
  });

  it("refuses a link on the way to the file", () => {
    writeWs("real/a.txt", "a");
    symlinkSync(wsPath("real"), wsPath("alias"), "junction");
    expect(() => disk.exportable(SLUG, "Files/alias/a.txt")).toThrow(LINK_MSG);
  });
});

describe("free space on the drive", () => {
  it("reads the free bytes of a folder's drive, and says zero for a folder it can't read", () => {
    expect(freeOnDrive(root)).toBeGreaterThan(0);
    expect(freeOnDrive(path.join(root, "no", "such", "folder"))).toBe(0);
  });
});

describe("new documents", () => {
  it("makes a folder named from the title, with the starter files", () => {
    expect(disk.newDoc(SLUG, "doc", "Q3 report")).toEqual({ path: "q3-report" });
    expect(readFileSync(libPath("q3-report/doc.json"), "utf8")).toContain("Q3 report");
    expect(existsSync(libPath("q3-report/tabs/tab-1.html"))).toBe(true);
  });

  it("names a second one with the same title with -2, and gives an empty title a name", () => {
    expect(disk.newDoc(SLUG, "doc", "Q3 report").path).toBe("q3-report");
    expect(disk.newDoc(SLUG, "doc", "Q3 report").path).toBe("q3-report-2");
    expect(disk.newDoc(SLUG, "sheet", "").path).toBe("untitled-sheet");
    expect(disk.newDoc(SLUG, "deck", "日本").path).toBe("untitled-deck");
  });

  it("refuses a kind that is not a Fenna document, and a long title", () => {
    expect(() => disk.newDoc(SLUG, "video", "x")).toThrow("A document is one of");
    expect(() => disk.newDoc(SLUG, "doc", "x".repeat(201))).toThrow("the most is 200");
    expect(existsSync(libPath("x"))).toBe(false);
  });

  it("removes what it made when a starter file cannot be written", () => {
    const broken = createDisk({ store, starterFiles: () => ({ "../../escape.txt": "x" }), settingsFile });
    expect(() => broken.newDoc(SLUG, "doc", "Broken")).toThrow(OUTSIDE_MSG);
    expect(existsSync(libPath("broken"))).toBe(false);
    expect(existsSync(path.join(botDir(), "escape.txt"))).toBe(false);
  });
});

describe("addresses and the crewfile scheme", () => {
  type Handler = (request: Request) => Promise<Response>;
  let handler: Handler;
  const protocol = {
    registered: null as unknown,
    registerSchemesAsPrivileged(list: unknown) {
      this.registered = list;
    },
    handle(scheme: string, fn: Handler) {
      if (scheme === "crewfile") handler = fn;
    },
  };

  beforeEach(() => {
    writeWs("a b.txt", "hello world");
    disk.handleScheme(protocol);
  });

  it("builds an address per segment, for files only", () => {
    expect(disk.url(SLUG, "Files/a b.txt")).toBe("crewfile://research/Files/a%20b.txt");
    expect(() => disk.url(SLUG, "Files")).toThrow("Only files have an address");
  });

  it("registers the scheme as privileged", () => {
    disk.registerScheme(protocol);
    expect(protocol.registered).toEqual([{ scheme: "crewfile", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
  });

  it("serves a file, with its type and the sandbox rule", async () => {
    const res = await handler(new Request(disk.url(SLUG, "Files/a b.txt")));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(await res.text()).toBe("hello world");
  });

  it("answers byte ranges, so video and audio can seek", async () => {
    const url = disk.url(SLUG, "Files/a b.txt");
    const mid = await handler(new Request(url, { headers: { range: "bytes=6-10" } }));
    expect(mid.status).toBe(206);
    expect(mid.headers.get("content-range")).toBe("bytes 6-10/11");
    expect(await mid.text()).toBe("world");

    const open = await handler(new Request(url, { headers: { range: "bytes=6-" } }));
    expect(await open.text()).toBe("world");
    const last = await handler(new Request(url, { headers: { range: "bytes=-5" } }));
    expect(await last.text()).toBe("world");
    const past = await handler(new Request(url, { headers: { range: "bytes=50-" } }));
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */11");
    const junk = await handler(new Request(url, { headers: { range: "bytes=abc" } }));
    expect(junk.status).toBe(416);
  });

  it("answers nothing for a folder, a missing file, a bad address or a link", async () => {
    expect((await handler(new Request("crewfile://research/Files"))).status).toBe(404);
    expect((await handler(new Request("crewfile://research/Files/missing.txt"))).status).toBe(404);
    expect((await handler(new Request("crewfile://research/Files/%E0%A4%A"))).status).toBe(404);
    expect((await handler(new Request("crewfile://Bad%20Slug/Files/a.txt"))).status).toBe(404);
    expect((await handler(new Request("crewfile://research/Files/../../escape.txt"))).status).toBe(404);
    expect((await handler(new Request("crewfile://research/Files/a%2F..%2F..%2Fescape.txt"))).status).toBe(404);
    writeFileSync(path.join(outside, "secret.txt"), "secret");
    symlinkSync(outside, wsPath("link"), process.platform === "win32" ? "junction" : "dir");
    const linked = await handler(new Request("crewfile://research/Files/link/secret.txt"));
    expect(linked.status).toBe(404);
    expect(await linked.text()).toBe(LINK_MSG);
  });
});

describe("events and the bot's disk", () => {
  it("tells the windows about every operation, and returns the folder it affected", () => {
    writeWs("a.txt");
    const after = disk.op(SLUG, { op: "rename", path: "Files/a.txt", name: "b.txt" });
    expect(after.entries.map((e: { name: string }) => e.name)).toEqual(["b.txt"]);
    expect(events).toEqual([["crew:disk", { slug: SLUG }]]);
  });

  it("refuses an unknown operation and a missing one, in plain words", () => {
    expect(() => disk.op(SLUG, { op: "format" })).toThrow('There is no "format" operation.');
    expect(() => disk.op(SLUG, null)).toThrow("Say what to do");
  });

  it("counts the workspace, library and trash, not the links", () => {
    const before = disk.used(SLUG);
    writeWs("a.txt", "12345");
    disk.newDoc(SLUG, "doc", "Count me");
    disk.op(SLUG, { op: "mkdir", path: "Files/x" });
    expect(disk.used(SLUG)).toBeGreaterThan(before + 5);
  });
});
