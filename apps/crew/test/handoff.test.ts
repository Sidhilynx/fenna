import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createStore } = require("../src/main/store.cjs");
const { createDisk } = require("../src/main/disk.cjs");

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const KB = 1024;
const OUTSIDE_MSG = "That file is outside this bot's disk.";
const NAMES = { from: "Research", to: "Inbox" };

let root: string;
let store: ReturnType<typeof createStore>;
let disk: any;
let settingsFile: string;
let events: [string, object][];

const SENDER = "research";
const RECEIVER = "inbox";
const sendPath = (rel: string) => path.join(store.botDir(SENDER), "workspace", rel);
const receivePath = (rel: string) => path.join(store.botDir(RECEIVER), "workspace", rel);
const libPath = (slug: string, rel: string) => path.join(store.botDir(slug), "library", rel);

function write(file: string, text = "hello") {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const handOff = (paths: string[]) => disk.handOff(SENDER, RECEIVER, paths, NAMES);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crew-handoff-"));
  events = [];
  store = createStore(root);
  store.createBot({ name: "Research", job: "Reads the web" });
  store.createBot({ name: "Inbox", job: "Sorts email" });
  settingsFile = path.join(root, "disk-quotas.json");
  disk = createDisk({ store, broadcast: (channel: string, payload: object) => events.push([channel, payload]), settingsFile });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("handing files from one bot to another", () => {
  it("copies files and folders, leaves the originals, and lists where each copy went", () => {
    write(sendPath("notes/a.txt"), "A");
    write(sendPath("notes/deep/b.txt"), "B");
    write(sendPath("report.csv"), "x,y");
    const r = handOff(["Files/notes", "Files/report.csv"]);
    expect(r.files).toEqual([
      { name: "a.txt", size: 1, fromPath: "Files/notes/a.txt", toPath: "Files/From Research/notes/a.txt" },
      { name: "b.txt", size: 1, fromPath: "Files/notes/deep/b.txt", toPath: "Files/From Research/notes/deep/b.txt" },
      { name: "report.csv", size: 3, fromPath: "Files/report.csv", toPath: "Files/From Research/report.csv" },
    ]);
    expect(readFileSync(receivePath("From Research/notes/deep/b.txt"), "utf8")).toBe("B");
    expect(readFileSync(receivePath("From Research/report.csv"), "utf8")).toBe("x,y");
    expect(readFileSync(sendPath("report.csv"), "utf8")).toBe("x,y");
    expect(readFileSync(sendPath("notes/a.txt"), "utf8")).toBe("A");
    expect(events.map(([channel]) => channel)).toEqual(["crew:disk"]);
  });

  it("gives a clashing name a number, and never overwrites what the receiver has", () => {
    write(receivePath("From Research/report.csv"), "theirs");
    write(sendPath("report.csv"), "mine");
    write(sendPath("a/x.txt"), "one");
    write(sendPath("b/x.txt"), "two");
    const r = handOff(["Files/report.csv", "Files/a/x.txt", "Files/b/x.txt"]);
    expect(r.files.map((f: { toPath: string }) => f.toPath)).toEqual([
      "Files/From Research/report (2).csv",
      "Files/From Research/x.txt",
      "Files/From Research/x (2).txt",
    ]);
    expect(readFileSync(receivePath("From Research/report.csv"), "utf8")).toBe("theirs");
    expect(readFileSync(receivePath("From Research/report (2).csv"), "utf8")).toBe("mine");
    expect(readFileSync(receivePath("From Research/x (2).txt"), "utf8")).toBe("two");
  });

  it("copies a Fenna document into the receiver's Documents under a free slug", () => {
    write(libPath(SENDER, "q3-report/doc.json"), JSON.stringify({ title: "Q3 report" }));
    write(libPath(SENDER, "q3-report/tabs/tab-1.html"), "<article>Q3</article>");
    write(libPath(RECEIVER, "q3-report/doc.json"), JSON.stringify({ title: "Mine" }));
    const r = handOff(["Documents/q3-report"]);
    expect(r.files.map((f: { toPath: string }) => f.toPath)).toEqual(["Documents/q3-report-2/doc.json", "Documents/q3-report-2/tabs/tab-1.html"]);
    expect(readFileSync(libPath(RECEIVER, "q3-report-2/tabs/tab-1.html"), "utf8")).toBe("<article>Q3</article>");
    expect(readFileSync(libPath(RECEIVER, "q3-report/doc.json"), "utf8")).toBe(JSON.stringify({ title: "Mine" }));
    expect(existsSync(libPath(SENDER, "q3-report/doc.json"))).toBe(true);
    expect(existsSync(receivePath("From Research"))).toBe(false);
  });

  it("refuses a folder in Documents that is not a document", () => {
    write(libPath(SENDER, "scratch/notes.txt"), "not a doc");
    expect(() => handOff(["Documents/scratch"])).toThrow(/isn't a document. Documents hands over whole documents only/);
    expect(existsSync(libPath(RECEIVER, "scratch"))).toBe(false);
  });

  it("refuses all of it when the receiver's disk has no room, and leaves nothing behind", () => {
    disk.setQuota(RECEIVER, 1);
    write(receivePath("filler.bin"), "");
    truncateSync(receivePath("filler.bin"), GB - 64 * KB);
    write(sendPath("big-a.bin"), "");
    truncateSync(sendPath("big-a.bin"), 200 * KB);
    write(sendPath("big-b.bin"), "");
    truncateSync(sendPath("big-b.bin"), 200 * KB);
    expect(() => handOff(["Files/big-a.bin", "Files/big-b.bin"])).toThrow(/Inbox's disk has 64 KB free, and these files need 400 KB. Nothing was copied/);
    expect(existsSync(receivePath("From Research"))).toBe(false);
    expect(existsSync(sendPath("big-a.bin"))).toBe(true);
  });

  it("refuses more than 500 MB in one hand-off", () => {
    write(sendPath("film.mov"), "");
    truncateSync(sendPath("film.mov"), 501 * MB);
    expect(() => handOff(["Files/film.mov"])).toThrow(/at most 500 MB/);
    expect(existsSync(receivePath("From Research"))).toBe(false);
  });

  it("refuses a path that leads out of the sender's disk, and leaves nothing behind", () => {
    write(sendPath("ok.txt"), "ok");
    write(path.join(store.botDir(RECEIVER), "bot.md"), "x");
    for (const bad of ["Files/../../inbox/workspace/secret.txt", "../inbox/Files/x.txt", "/Files/ok.txt", "C:/Files/ok.txt", "Files\\ok.txt", "Files/./ok.txt", "Other/ok.txt"]) {
      expect(() => handOff([bad]), bad).toThrow(OUTSIDE_MSG);
    }
    expect(() => handOff(["Files/ok.txt", "Files/../../inbox/bot.md"])).toThrow(OUTSIDE_MSG);
    expect(existsSync(receivePath("From Research"))).toBe(false);
  });

  it("refuses the roots, Trash and links, and says what to do", () => {
    write(sendPath("real/a.txt"), "a");
    expect(() => handOff(["Files"])).toThrow(/can't be handed over/);
    expect(() => handOff(["Trash"])).toThrow(/can't be handed over/);
    write(path.join(store.botDir(SENDER), "trash", "old.txt"), "old");
    expect(() => handOff(["Trash/old.txt"])).toThrow(/Restore it first/);
    symlinkSync(path.join(store.botDir(SENDER), "workspace", "real"), sendPath("alias"), process.platform === "win32" ? "junction" : "dir");
    expect(() => handOff(["Files/alias"])).toThrow("A link can't be used on the bot's disk.");
    expect(existsSync(receivePath("From Research"))).toBe(false);
  });

  it("refuses more than 20 files, counting the files inside folders, and copies none", () => {
    for (let i = 0; i < 15; i++) write(sendPath(`batch/f${i}.txt`), "x");
    for (let i = 0; i < 6; i++) write(sendPath(`loose/g${i}.txt`), "y");
    expect(() => handOff(["Files/batch", "Files/loose"])).toThrow("These come to more than 20 files. A hand-off carries at most 20 files; send fewer.");
    expect(existsSync(receivePath("From Research"))).toBe(false);
    const ok = handOff(["Files/batch"]);
    expect(ok.files).toHaveLength(15);
  });

  it("copies a folder with its subfolders, and skips the names hidden on the disk", () => {
    write(sendPath("trip/day1/photo.jpg"), "p");
    write(sendPath("trip/day2/notes.md"), "n");
    write(sendPath("trip/.secret"), "hidden");
    mkdirSync(sendPath("trip/empty"), { recursive: true });
    const r = handOff(["Files/trip"]);
    expect(r.files.map((f: { toPath: string }) => f.toPath)).toEqual(["Files/From Research/trip/day1/photo.jpg", "Files/From Research/trip/day2/notes.md"]);
    expect(existsSync(receivePath("From Research/trip/empty"))).toBe(true);
    expect(existsSync(receivePath("From Research/trip/.secret"))).toBe(false);
  });

  it("copies a download the same way, into Files", () => {
    write(path.join(store.botDir(SENDER), "workspace", "downloads", "chart.png"), "png");
    const r = handOff(["Downloads/chart.png"]);
    expect(r.files).toEqual([{ name: "chart.png", size: 3, fromPath: "Downloads/chart.png", toPath: "Files/From Research/chart.png" }]);
  });

  it("refuses a sender's file that is not there any more, and an empty list", () => {
    expect(() => handOff(["Files/gone.txt"])).toThrow(/isn't there any more/);
    expect(() => handOff([])).toThrow("Pick at least one file or folder.");
  });

  it("refuses a receiver's Files folder name that is taken by a file", () => {
    write(receivePath("From Research"), "a file, not a folder");
    write(sendPath("a.txt"), "a");
    expect(() => handOff(["Files/a.txt"])).toThrow(/already a file called "From Research"/);
    expect(readFileSync(receivePath("From Research"), "utf8")).toBe("a file, not a folder");
  });
});
