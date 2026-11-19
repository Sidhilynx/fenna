import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createStore } = require("../src/main/store.cjs");
const { createDisk } = require("../src/main/disk.cjs");
const { createShell, tokenize, parse, resolvePath, sheetCsv, capOutput, HISTORY_MAX, OUTPUT_MAX } = require("../src/main/shell.cjs");
const zip = require("../src/main/ziplite.cjs");

const SLUG = "research";
const OUTSIDE_MSG = "That file is outside this bot's disk.";
const starterFiles = () => ({});

let root: string;
let outside: string;
let store: { botDir(slug: string): string };
let disk: any;
let settingsFile: string;
let events: [string, any][];
let shell: any;

const botDir = () => store.botDir(SLUG);
const wsPath = (rel: string) => path.join(botDir(), "workspace", rel);
const libPath = (rel: string) => path.join(botDir(), "library", rel);

function put(abs: string, data: string | Buffer) {
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
}

function makeShell(extra: Record<string, unknown> = {}) {
  shell = createShell({ disk, store, broadcast: (channel: string, payload: any) => events.push([channel, payload]), ...extra });
}

/** Runs a line in the bot's terminal; returns the entry. */
const run = (line: string, cwd: string | null = null) => shell.exec(SLUG, line, cwd, "person");
/** The output of a line. */
const out = async (line: string, cwd: string | null = null) => (await run(line, cwd)).out as string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crew-shell-"));
  outside = mkdtempSync(path.join(tmpdir(), "crew-shell-outside-"));
  writeFileSync(path.join(outside, "secret.txt"), "do not read\n");
  events = [];
  store = createStore(root);
  settingsFile = path.join(root, "disk-quotas.json");
  mkdirSync(botDir(), { recursive: true });
  writeFileSync(path.join(botDir(), "bot.md"), "# research\n");
  disk = createDisk({ store, broadcast: (channel: string, payload: object) => events.push([channel, payload]), starterFiles, settingsFile });
  makeShell();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("parsing", () => {
  it("splits words, keeps quoted spaces and unescapes", () => {
    const words = (line: string) => tokenize(line).map((t: { text: string }) => t.text);
    expect(words(`echo "a b" 'c  d' e\\ f`)).toEqual(["echo", "a b", "c  d", "e f"]);
    expect(words(`echo "say \\"hi\\""`)).toEqual(["echo", 'say "hi"']);
    expect(words(`echo ""`)).toEqual(["echo", ""]);
  });

  it("keeps a Windows-style path as typed (it is then refused as outside)", () => {
    expect(tokenize("ls Files\\x").map((t: { text: string }) => t.text)).toEqual(["ls", "Files\\x"]);
  });

  it("builds pipelines, && and ; items and redirects", () => {
    const items = parse("a | b && c ; d > f.txt");
    expect(items.map((i: { and: boolean }) => i.and)).toEqual([false, true, false]);
    expect(items[0].pipe.map((c: { words: string[] }) => c.words[0])).toEqual(["a", "b"]);
    expect(items[2].pipe[0].redir).toEqual({ append: false, target: "f.txt" });
  });

  it("refuses syntax it does not run, with what to fix", () => {
    expect(() => parse("; ls")).toThrow(/missing command before ;/);
    expect(() => parse("ls &&")).toThrow(/missing command after &&/);
    expect(() => parse("ls |")).toThrow(/missing command after \|/);
    expect(() => parse('echo "open')).toThrow(/unclosed double quote/);
    expect(() => parse("echo >")).toThrow(/needs a file name/);
    expect(() => parse("echo a > x > y")).toThrow(/one > per command/);
    expect(() => parse("a & b")).toThrow(/use &&/);
  });

  it("runs && only when the one before worked, and ; always", async () => {
    expect(await out("cat nope.txt && echo second")).toMatch(/^cat: nope\.txt: no such file/);
    expect(await out("cat nope.txt ; echo second")).toBe("cat: nope.txt: no such file\nsecond\n");
    expect((await run("echo ok && echo ok2")).ok).toBe(true);
    expect((await run("cat nope.txt && echo never")).out).not.toContain("never");
  });

  it("pipes text from one built-in to the next", async () => {
    expect((await out("echo one two three | wc -w")).trim()).toBe("3");
  });

  it("writes with > and appends with >>, into Files only", async () => {
    await run("echo hello > Files/a.txt");
    await run("echo more >> Files/a.txt");
    expect(readFileSync(wsPath("a.txt"), "utf8")).toBe("hello\nmore\n");
    const e = await run("echo x > Documents/x.txt");
    expect(e.ok).toBe(false);
    expect(e.out).toContain("Files and Downloads");
  });

  it("says a command is missing, with the list to look at", async () => {
    const e = await run("nope --flag");
    expect(e.ok).toBe(false);
    expect(e.out).toBe("sh: nope: command not found. Type help for the list.\n");
  });

  it("prints --help for every command", async () => {
    expect(await out("grep --help")).toMatch(/^grep \[-i\] \[-n\] \[-r\] pattern/);
    expect(await out("help zip")).toMatch(/^zip archive\.zip item\.\.\./);
    expect((await out("help")).split("\n").length).toBeGreaterThan(25);
  });

  it("keeps the folder across lines, and an empty line does nothing", async () => {
    mkdirSync(wsPath("notes"), { recursive: true });
    expect((await run("cd Files/notes")).cwd).toBe("Files/notes");
    expect(await out("pwd")).toBe("Files/notes\n");
    const blank = await run("   ");
    expect(blank.ok).toBe(true);
    expect(shell.history(SLUG).length).toBe(2);
  });
});

describe("paths", () => {
  it("resolves against the folder, ~ and roots, and refuses what leaves the disk", () => {
    expect(resolvePath("Files/notes", "a.txt")).toBe("Files/notes/a.txt");
    expect(resolvePath("Files/notes", "../b")).toBe("Files/b");
    expect(resolvePath("Files/notes", "Documents/q3")).toBe("Documents/q3");
    expect(resolvePath("Files", "~/x")).toBe("Files/x");
    expect(() => resolvePath("Files", "../x")).toThrow(OUTSIDE_MSG);
    expect(() => resolvePath("Files/a", "../../../x")).toThrow(OUTSIDE_MSG);
    expect(() => resolvePath("Files", "/etc/passwd")).toThrow(OUTSIDE_MSG);
    expect(() => resolvePath("Files", "C:/Windows")).toThrow(OUTSIDE_MSG);
    expect(() => resolvePath("Files", "\\\\server\\share")).toThrow(OUTSIDE_MSG);
  });

  const leaves = ["../../secret.txt", "Files/../../secret.txt", "/etc/passwd", "C:/Windows/win.ini", "Files\\x", "Files/a:b", "Files/.."];
  const bad = [...leaves, "Nope/x"];

  it.each(leaves)("says %s is outside the disk", async (p) => {
    expect((await run(`cat '${p}'`)).out).toContain(OUTSIDE_MSG);
    expect((await run(`cd '${p}'`)).out).toContain(OUTSIDE_MSG);
  });

  it("says a real folder outside the disk is outside, by its full path", async () => {
    const abs = `${outside.replace(/\\/g, "/")}/secret.txt`;
    expect((await run(`cat '${abs}'`)).out).toContain(OUTSIDE_MSG);
    expect((await run(`cat '${abs}'`)).out).not.toContain("do not read");
  });

  it.each(bad)("refuses %s for every command that takes a path", async (p) => {
    const q = `'${p}'`;
    const lines = [`cat ${q}`, `ls ${q}`, `head ${q}`, `wc ${q}`, `cp ${q} Files/x`, `mv ${q} Files/x`, `rm ${q}`, `du ${q}`, `stat ${q}`, `csv ${q}`, `touch ${q}`, `mkdir ${q}`, `cd ${q}`, `zip Files/z.zip ${q}`, `echo x > ${q}`, `grep x ${q}`, `find ${q}`];
    for (const line of lines) {
      const e = await run(line);
      expect(e.ok, line).toBe(false);
      expect(e.out.includes("do not read"), line).toBe(false);
    }
  });

  it("does not read a file through a link inside the disk", async () => {
    const { symlinkSync } = require("node:fs");
    try {
      symlinkSync(path.join(outside, "secret.txt"), wsPath("link.txt"));
    } catch {
      return; // no symlink rights on this machine
    }
    const e = await run("cat Files/link.txt");
    expect(e.ok).toBe(false);
    expect(e.out).not.toContain("do not read");
  });
});

describe("commands", () => {
  beforeEach(() => {
    put(wsPath("notes/a.txt"), "alpha\nbeta\ngamma\n");
    put(wsPath("notes/deep/b.md"), "Budget: 42\nbudget again\n");
    put(wsPath("top.txt"), "one\ntwo\nthree\nfour\n");
  });

  it("ls lists folders first with a slash, and -l shows size and time", async () => {
    expect(await out("ls Files/notes")).toBe("deep/\na.txt\n");
    const long = await out("ls -l Files/notes");
    expect(long).toMatch(/dir.*deep\//);
    expect(long).toMatch(/file.*a\.txt/);
    expect(await out("ls Files/top.txt")).toMatch(/top\.txt/);
    expect((await run("ls Files/none")).ok).toBe(false);
  });

  it("tree draws the folders, and -L limits the depth", async () => {
    const t = await out("tree Files/notes");
    expect(t).toContain("|-- deep/");
    expect(t).toContain("`-- a.txt");
    expect(await out("tree -L 1 Files/notes")).not.toContain("b.md");
  });

  it("cat, head and tail read files and what is piped", async () => {
    expect(await out("cat Files/notes/a.txt")).toBe("alpha\nbeta\ngamma\n");
    expect(await out("head -n 2 Files/top.txt")).toBe("one\ntwo\n");
    expect(await out("head -1 Files/top.txt")).toBe("one\n");
    expect(await out("tail -n 2 Files/top.txt")).toBe("three\nfour\n");
    expect(await out("cat Files/top.txt | tail -n 1")).toBe("four\n");
    expect(await out("cat Files/notes")).toMatch(/is a folder/);
  });

  it("wc counts lines, words and bytes", async () => {
    expect(await out("wc -l Files/top.txt")).toMatch(/^\s+4 Files\/top\.txt\n$/);
    expect(await out("wc -w Files/notes/a.txt")).toMatch(/^\s+3 Files\/notes\/a\.txt\n$/);
    expect(await out("wc -c Files/notes/a.txt")).toMatch(/17 Files\/notes\/a\.txt/);
  });

  it("sort and uniq, with -n, -r and -c", async () => {
    expect(await out("echo 10 | sort -n")).toBe("10\n");
    expect(await out("cat Files/top.txt | sort -r")).toBe("two\nthree\none\nfour\n");
    expect(await out("echo a | uniq -c")).toBe("      1 a\n");
    expect(await out("echo a ; echo a ; echo b | uniq")).toBe("a\na\nb\n");
  });

  it("grep finds lines, with -i, -n and -r, and says so when nothing matches", async () => {
    expect(await out("grep alpha Files/notes/a.txt")).toBe("alpha\n");
    expect(await out("grep -i BUDGET -r -n Files/notes")).toBe("Files/notes/deep/b.md:1:Budget: 42\nFiles/notes/deep/b.md:2:budget again\n");
    const none = await run("grep zzz Files/notes/a.txt");
    expect(none.ok).toBe(false);
    expect(none.out).toBe("");
    expect((await run("grep budget Files/notes")).out).toContain("is a folder (add -r)");
  });

  it("find matches by name and kind", async () => {
    expect(await out("find Files/notes -name *.md")).toBe("Files/notes/deep/b.md\n");
    expect(await out("find Files/notes -type d")).toBe("Files/notes\nFiles/notes/deep\n");
    expect(await out("find Files/notes -type f -name a*")).toBe("Files/notes/a.txt\n");
  });

  it("du and df report sizes", async () => {
    expect(await out("du Files/notes")).toMatch(/^\d+\tFiles\/notes\n$/);
    expect(await out("du -h Files/notes")).toMatch(/KB\tFiles\/notes/);
    expect(await out("df")).toMatch(/used of 5\.00 GB; .* free/);
  });

  it("stat says what an item is", async () => {
    const s = await out("stat Files/notes");
    expect(s).toContain("type: folder (2 items)");
    expect(await out("stat Files/top.txt")).toContain("type: file");
  });

  it("mkdir, touch, mv and cp make and move things, and cp -r copies folders", async () => {
    await run("mkdir -p Files/a/b/c");
    expect(existsSync(wsPath("a/b/c"))).toBe(true);
    expect((await run("mkdir Files/a/b")).ok).toBe(false);
    await run("touch Files/a/b/c/x.txt");
    expect(existsSync(wsPath("a/b/c/x.txt"))).toBe(true);
    await run("mv Files/a/b/c/x.txt Files/moved.txt");
    expect(existsSync(wsPath("moved.txt"))).toBe(true);
    await run("mv Files/moved.txt Files/renamed.txt");
    expect(existsSync(wsPath("renamed.txt"))).toBe(true);
    expect(existsSync(wsPath("moved.txt"))).toBe(false);
    await run("cp Files/renamed.txt Files/copy-of.txt");
    expect(existsSync(wsPath("copy-of.txt"))).toBe(true);
    expect(existsSync(wsPath("renamed.txt"))).toBe(true);
    expect((await run("cp Files/notes Files/notes2")).out).toContain("add -r");
    await run("cp -r Files/notes Files/notes2");
    expect(readFileSync(wsPath("notes2/deep/b.md"), "utf8")).toContain("Budget");
    expect((await run("touch Documents/x")).ok).toBe(false);
  });

  it("rm moves things to Trash, and restore brings them back", async () => {
    const e = await run("rm Files/top.txt");
    expect(e.ok).toBe(true);
    expect(e.out).toContain("moved to Trash");
    expect(existsSync(wsPath("top.txt"))).toBe(false);
    const trash = disk.list(SLUG, "Trash").entries.map((x: { name: string }) => x.name);
    expect(trash).toContain("top.txt");
    expect((await run("rm Files/notes")).out).toContain("add -r");
    await run("rm -r Files/notes");
    expect(disk.list(SLUG, "Trash").entries.map((x: { name: string }) => x.name)).toContain("notes");
    await run("restore Trash/notes");
    expect(existsSync(wsPath("notes/a.txt"))).toBe(true);
  });

  it("open says where the item is, and clear prints nothing", async () => {
    expect(await out("open Files/top.txt")).toContain("in the bot's computer");
    expect((await run("open Files/none")).ok).toBe(false);
    expect(await out("clear")).toBe("");
  });

  it("history lists what ran, oldest first", async () => {
    await run("echo one");
    await run("echo two");
    expect(await out("history")).toMatch(/1  echo one\n.*2  echo two/s);
  });

  it("refuses a file name that Windows keeps", async () => {
    const e = await run("touch Files/CON");
    expect(e.ok).toBe(false);
  });
});

describe("output and history", () => {
  it("cuts output at 64 KB with a note", async () => {
    put(wsPath("big.txt"), "x".repeat(100 * 1024));
    const text = await out("cat Files/big.txt");
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(OUTPUT_MAX + 64);
    expect(text).toContain("(output cut at 64 KB)");
    expect(capOutput("short")).toBe("short");
  });

  it("keeps the last 500 entries, and writes them to terminal.json", async () => {
    for (let i = 1; i <= HISTORY_MAX + 10; i++) await run(`echo ${i}`);
    const h = shell.history(SLUG);
    expect(h.length).toBe(HISTORY_MAX);
    expect(h[0].line).toBe("echo 11");
    expect(h.at(-1).line).toBe(`echo ${HISTORY_MAX + 10}`);
    shell.flush();
    const saved = JSON.parse(readFileSync(path.join(botDir(), "terminal.json"), "utf8"));
    expect(saved.entries.length).toBe(HISTORY_MAX);
    const reopened = createShell({ disk, store });
    expect(reopened.history(SLUG).length).toBe(HISTORY_MAX);
  });

  it("records who ran it, the folder after cd, and tells the windows", async () => {
    const e = await shell.exec(SLUG, "cd Files", "Documents", "bot");
    expect(e.who).toBe("bot");
    expect(e.cwd).toBe("Files");
    const ev = events.find(([c]) => c === "crew:term");
    expect(ev?.[1].slug).toBe(SLUG);
    expect(ev?.[1].entry.id).toBe(e.id);
  });

  it("starts in the folder the last line ended in", async () => {
    await run("cd Downloads");
    expect((await run("pwd")).cwd).toBe("Downloads");
  });

  it("refuses a folder it was given that is gone", async () => {
    const e = await run("pwd", "Files/none");
    expect(e.ok).toBe(false);
    expect(e.out).toContain("no such folder");
  });
});

describe("csv", () => {
  it("quotes fields as RFC 4180 does", () => {
    const csv = sheetCsv({
      cells: {
        A1: { v: "Item" },
        B1: { v: "Note" },
        A2: { v: "Tea, green" },
        B2: { v: 'say "hi"' },
        A3: { v: "two\nlines" },
        B3: { v: 3.5 },
        C3: { v: true },
      },
    });
    expect(csv).toBe('Item,Note,\r\n"Tea, green","say ""hi""",\r\n"two\nlines",3.5,TRUE\r\n');
    expect(sheetCsv({ cells: {} })).toBe("");
  });

  it("converts a Fenna sheet document, prints it, and saves it with -o", async () => {
    put(libPath("budget/sheet.json"), JSON.stringify({ title: "Budget", sheets: [{ id: "sheet-1", title: "Sheet1" }] }));
    put(libPath("budget/sheets/sheet-1.json"), JSON.stringify({ id: "sheet-1", cells: { A1: { v: "Item" }, B1: { v: "Cost" }, A2: { v: "Tea" }, B2: { v: 4 }, B3: { f: "=SUM(B2)" } } }));
    // B3 holds only a formula, which has no stored value, so it is left out.
    expect(await out("csv Documents/budget")).toBe("Item,Cost\r\nTea,4\r\n");
    const saved = await out("csv Documents/budget -o budget.csv", "Files");
    expect(saved).toMatch(/^Files\/budget\.csv \(/);
    expect(readFileSync(wsPath("budget.csv"), "utf8")).toBe("Item,Cost\r\nTea,4\r\n");
    expect((await run("csv Documents/budget -o budget.csv")).ok).toBe(false);
    expect((await run("csv Documents/budget -o budget.txt")).out).toContain(".csv file name");
  });

  it("reads a sheet .json file, and refuses what is not a sheet", async () => {
    put(wsPath("s.json"), JSON.stringify({ cells: { A1: { v: "x" } } }));
    expect(await out("csv Files/s.json")).toBe("x\r\n");
    put(wsPath("nope.json"), "{}");
    expect((await run("csv Files/nope.json")).out).toContain("isn't a sheet");
    expect((await run("csv Files/top.txt")).out).toContain("give a sheet document");
  });
});

describe("img", () => {
  const fakeImage = (w: number, h: number, buf: Buffer): any => ({
    isEmpty: () => buf.length === 0,
    getSize: () => ({ width: w, height: h }),
    resize: ({ width, height }: { width: number; height: number }) => fakeImage(width, height, Buffer.from(`PNG ${width}x${height}`)),
    toPNG: () => Buffer.from(`PNG ${w}x${h}`),
    toJPEG: (q: number) => Buffer.from(`JPG ${w}x${h} q${q}`),
  });
  const nativeImage = { createFromBuffer: (buf: Buffer) => fakeImage(40, 20, buf) };

  beforeEach(() => {
    makeShell({ nativeImage });
    put(wsPath("photo.png"), Buffer.from("PNG 40x20 source"));
    put(wsPath("note.txt"), "not a picture");
  });

  it("resizes keeping the shape when only a width is given", async () => {
    const o = await out("img Files/photo.png --width 20");
    expect(o).toBe("Files/photo-resized.png (20 x 10 pixels)\n");
    expect(readFileSync(wsPath("photo-resized.png"), "utf8")).toBe("PNG 20x10");
  });

  it("converts with --to into a named file, and refuses to overwrite it", async () => {
    expect(await out("img Files/photo.png --to jpg -o Files/out.jpg")).toBe("Files/out.jpg (40 x 20 pixels)\n");
    expect(readFileSync(wsPath("out.jpg"), "utf8")).toBe("JPG 40x20 q90");
    expect((await run("img Files/photo.png --to jpg -o Files/out.jpg")).ok).toBe(false);
  });

  it("names a free file when the default name is taken", async () => {
    await out("img Files/photo.png --width 20");
    expect(await out("img Files/photo.png --width 20")).toBe("Files/photo-resized (2).png (20 x 10 pixels)\n");
  });

  it("says what is wrong with the request", async () => {
    expect((await run("img Files/photo.png")).out).toContain("say what to change");
    expect((await run("img Files/note.txt --width 5")).out).toContain("isn't an image");
    expect((await run("img Files/photo.png --to gif")).out).toContain("png or jpg");
    expect((await run("img Files/photo.png --width 0")).out).toContain("whole number from 1");
  });

  it("says images aren't available when there is no image module", async () => {
    makeShell({});
    const e = await run("img Files/photo.png --width 5");
    expect(e.ok).toBe(false);
  });
});

describe("zip and unzip", () => {
  beforeEach(() => {
    put(wsPath("notes/a.txt"), "hello hello hello hello\n");
    put(wsPath("notes/sub/b.txt"), "second file\n");
  });

  it("zips a folder and unzips it again, the same", async () => {
    expect(await out("zip Files/notes.zip Files/notes")).toMatch(/^zipped 2 files into Files\/notes\.zip \(/);
    expect((await run("zip Files/notes.zip Files/notes")).ok).toBe(false);
    expect(await out("unzip Files/notes.zip -d Files/again")).toBe("unzipped 2 files into Files/again\n");
    expect(readFileSync(wsPath("again/notes/a.txt"), "utf8")).toBe("hello hello hello hello\n");
    expect(readFileSync(wsPath("again/notes/sub/b.txt"), "utf8")).toBe("second file\n");
  });

  it("refuses an archive whose names leave the folder, and writes nothing", async () => {
    put(wsPath("slip.zip"), zip.createZip([{ name: "../evil.txt", data: Buffer.from("x") }]));
    const e = await run("unzip Files/slip.zip -d Files/slipout");
    expect(e.ok).toBe(false);
    expect(e.out).toContain("unsafe name");
    expect(existsSync(wsPath("slipout"))).toBe(false);
    expect(existsSync(path.join(botDir(), "evil.txt"))).toBe(false);
    expect(existsSync(path.join(root, "evil.txt"))).toBe(false);
  });

  it("refuses an absolute or drive-letter name", async () => {
    for (const name of ["/etc/evil.txt", "C:/evil.txt"]) {
      put(wsPath("abs.zip"), zip.createZip([{ name, data: Buffer.from("x") }]));
      expect((await run("unzip Files/abs.zip -d Files/absout")).out).toContain("unsafe name");
    }
  });

  it("refuses a header that declares more than 2 GB, before reading any data", async () => {
    const buf = zip.createZip([{ name: "a.txt", data: Buffer.from("small") }]);
    buf.writeUInt32LE(3 * 1024 ** 3, buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
    put(wsPath("bomb.zip"), buf);
    const e = await run("unzip Files/bomb.zip -d Files/bombout");
    expect(e.ok).toBe(false);
    expect(e.out).toContain("2 GB unzip limit");
    expect(existsSync(wsPath("bombout"))).toBe(false);
  });

  it("refuses a header that declares more than the free space on the disk", async () => {
    writeFileSync(settingsFile, JSON.stringify({ [SLUG]: 1 }));
    const buf = zip.createZip([{ name: "a.txt", data: Buffer.from("small") }]);
    buf.writeUInt32LE(1.5 * 1024 ** 3, buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
    put(wsPath("big.zip"), buf);
    const e = await run("unzip Files/big.zip -d Files/bigout");
    expect(e.out).toContain("free on the bot's disk");
  });

  it("stops an entry that inflates past its declared size", async () => {
    put(wsPath("zeros.zip"), zip.createZip([{ name: "zeros.bin", data: Buffer.alloc(1024 * 1024) }]));
    const buf = readFileSync(wsPath("zeros.zip"));
    buf.writeUInt32LE(10, buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
    writeFileSync(wsPath("zeros.zip"), buf);
    const e = await run("unzip Files/zeros.zip -d Files/zerosout");
    expect(e.ok).toBe(false);
    expect(e.out).toContain("unpacks to more than its header says");
  });

  it("refuses an archive with more entries than the cap, from the header", async () => {
    const buf = zip.createZip([{ name: "a.txt", data: Buffer.from("x") }]);
    buf.writeUInt16LE(10_001, buf.length - 22 + 10);
    put(wsPath("many.zip"), buf);
    expect((await run("unzip Files/many.zip -d Files/manyout")).out).toContain("at most 10000");
  });

  it("unzips into a folder named after the archive by default", async () => {
    await run("zip Files/pack.zip Files/notes");
    expect(await out("unzip Files/pack.zip")).toBe("unzipped 2 files into Files/pack\n");
    expect(readFileSync(wsPath("pack/notes/sub/b.txt"), "utf8")).toBe("second file\n");
  });
});

describe("run", () => {
  it("says scripts aren't available with no sandbox", async () => {
    const e = await run("run Files/x.js");
    expect(e.ok).toBe(false);
    expect(e.out).toBe("Scripts aren't available.\n");
  });

  it("runs a script from the disk through the sandbox, with its arguments", async () => {
    const calls: any[] = [];
    makeShell({
      sandbox: {
        run: async (slug: string, o: any) => {
          calls.push({ slug, ...o });
          return { out: "ran\n", ok: true };
        },
      },
    });
    put(wsPath("job.js"), "console.log('hi')");
    const e = await run("run Files/job.js one two");
    expect(e.ok).toBe(true);
    expect(e.out).toBe("ran\n");
    expect(calls[0].slug).toBe(SLUG);
    expect(calls[0].code).toBe("console.log('hi')");
    expect(calls[0].args).toEqual(["one", "two"]);
    expect(calls[0].file).toBeUndefined();
    expect((await run("run Files/job.txt")).out).toContain("only .js");
  });
});
