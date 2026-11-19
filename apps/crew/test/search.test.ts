import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createStore } = require("../src/main/store.cjs");
const { createDisk } = require("../src/main/disk.cjs");
const { createSearch } = require("../src/main/search.cjs");

const SLUG = "research";
const starterFiles = (kind: string, title: string) => ({ [`${kind}.json`]: JSON.stringify({ title }), "tabs/tab-1.html": "<article></article>" });

let root: string;
let outside: string;
let store: { botDir(slug: string): string };
let disk: any;
let search: any;

const botDir = () => store.botDir(SLUG);
const wsPath = (rel: string) => path.join(botDir(), "workspace", rel);
const libPath = (rel: string) => path.join(botDir(), "library", rel);

/** Writes a file with its parents made, and sets its modified time. */
function put(abs: string, text: string, when = Date.now()) {
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
  const t = new Date(when);
  utimesSync(abs, t, t);
}

const names = (hits: { entry: { name: string } }[]) => hits.map((h) => h.entry.name);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crew-search-"));
  outside = mkdtempSync(path.join(tmpdir(), "crew-search-outside-"));
  store = createStore(root);
  mkdirSync(botDir(), { recursive: true });
  writeFileSync(path.join(botDir(), "bot.md"), "# research\n");
  const settingsFile = path.join(root, "disk-quotas.json");
  disk = createDisk({ store, starterFiles, settingsFile });
  search = createSearch({ disk }).search;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("name matches", () => {
  it("finds files whose name has every word of the query, in any case", () => {
    put(wsPath("notes/Quarterly Budget.txt"), "nothing here");
    put(wsPath("notes/other.txt"), "nothing here");
    const hits = search(SLUG, "BUDGET quarterly");
    expect(names(hits)).toEqual(["Quarterly Budget.txt"]);
    expect(hits[0].entry).toMatchObject({ path: "Files/notes/Quarterly Budget.txt", name: "Quarterly Budget.txt", kind: "text" });
    expect(hits[0].snippet).toBeUndefined();
  });

  it("returns nothing when one word is missing from the name and the text", () => {
    put(wsPath("notes/budget.txt"), "quarterly numbers");
    expect(search(SLUG, "budget missing")).toEqual([]);
  });

  it("returns nothing for an empty query", () => {
    put(wsPath("a.txt"), "text");
    expect(search(SLUG, "   ")).toEqual([]);
  });
});

describe("content matches", () => {
  it("returns a snippet of about 120 characters around the match, with ellipses where cut", () => {
    const before = "lorem ipsum dolor sit amet ".repeat(10);
    const after = " and then more filler text follows here ".repeat(10);
    put(wsPath("notes/log.txt"), `${before}invoice 4417 was paid${after}`);
    const [hit] = search(SLUG, "invoice 4417");
    expect(hit.entry.path).toBe("Files/notes/log.txt");
    expect(hit.snippet).toContain("invoice 4417 was paid");
    expect(hit.snippet.startsWith("…")).toBe(true);
    expect(hit.snippet.endsWith("…")).toBe(true);
    expect(hit.snippet.length).toBeLessThanOrEqual(124);
  });

  it("finds words across the whole text, not only the start", () => {
    put(wsPath("a.md"), "alpha\nbeta\n\ngamma delta");
    expect(names(search(SLUG, "gamma alpha"))).toEqual(["a.md"]);
  });

  it("does not search files that are not text, or text over 2 MB", () => {
    put(wsPath("photo.png"), "needle");
    put(wsPath("big.txt"), `${"x".repeat(2 * 1024 * 1024 + 10)} needle`);
    expect(search(SLUG, "needle")).toEqual([]);
  });

  it("searches the text of Fenna documents: doc tabs, sheet cells, deck slides, board and design text", () => {
    mkdirSync(libPath("q3-report/tabs"), { recursive: true });
    writeFileSync(libPath("q3-report/doc.json"), JSON.stringify({ title: "Q3 report" }));
    writeFileSync(libPath("q3-report/tabs/tab-1.html"), "<h1>Renewal</h1><script>hidden()</script><p>Renewal &amp; pricing</p>");
    mkdirSync(libPath("budget/sheets"), { recursive: true });
    writeFileSync(libPath("budget/sheet.json"), JSON.stringify({ title: "Budget" }));
    writeFileSync(libPath("budget/sheets/s1.json"), JSON.stringify({ cells: { A1: { v: "Plumber" }, B1: { v: 420 } } }));
    mkdirSync(libPath("pitch/slides"), { recursive: true });
    writeFileSync(libPath("pitch/deck.json"), JSON.stringify({ title: "Pitch" }));
    writeFileSync(libPath("pitch/slides/s1.html"), "<section><p>Fast local search</p></section>");
    mkdirSync(libPath("map"), { recursive: true });
    writeFileSync(libPath("map/board.json"), JSON.stringify({ title: "Map" }));
    writeFileSync(libPath("map/canvas.json"), JSON.stringify({ items: [{ id: "s", kind: "sticky", text: "Call the bank" }] }));
    mkdirSync(libPath("poster/artboards"), { recursive: true });
    writeFileSync(libPath("poster/design.json"), JSON.stringify({ title: "Poster" }));
    writeFileSync(libPath("poster/artboards/Card.html"), "<div>Spring sale</div>");

    const entry = (q: string) => search(SLUG, q)[0]?.entry;
    expect(entry("pricing")).toMatchObject({ path: "Documents/q3-report", kind: "doc", title: "Q3 report" });
    expect(search(SLUG, "hidden")).toEqual([]);
    expect(search(SLUG, "renewal")[0].snippet).toContain("Renewal");
    expect(entry("plumber")).toMatchObject({ path: "Documents/budget", kind: "sheet" });
    expect(entry("local search")).toMatchObject({ path: "Documents/pitch", kind: "deck" });
    expect(entry("bank")).toMatchObject({ path: "Documents/map", kind: "board" });
    expect(entry("spring sale")).toMatchObject({ path: "Documents/poster", kind: "design" });
  });

  it("finds a document by its title", () => {
    mkdirSync(libPath("q3-report/tabs"), { recursive: true });
    writeFileSync(libPath("q3-report/doc.json"), JSON.stringify({ title: "Quarterly review" }));
    expect(names(search(SLUG, "quarterly review"))).toEqual(["q3-report"]);
  });
});

describe("ranking and limits", () => {
  it("puts name matches before content matches, and newer first within each group", () => {
    const day = 86_400_000;
    const now = Date.now();
    put(wsPath("content-new.txt"), "apple here", now);
    put(wsPath("apple-old.txt"), "x", now - 10 * day);
    put(wsPath("apple-new.txt"), "x", now - day);
    put(wsPath("content-old.txt"), "apple there", now - 20 * day);
    expect(names(search(SLUG, "apple"))).toEqual(["apple-new.txt", "apple-old.txt", "content-new.txt", "content-old.txt"]);
  });

  it("returns at most limit hits, and at most 200", () => {
    for (let i = 0; i < 12; i++) put(wsPath(`note-${i}.txt`), "x");
    expect(search(SLUG, "note", { limit: 5 })).toHaveLength(5);
    expect(search(SLUG, "note", { limit: 1000 })).toHaveLength(12);
  });

  it("searches only under the folder given", () => {
    put(wsPath("notes/plan.txt"), "x");
    put(wsPath("archive/plan.txt"), "x");
    expect(search(SLUG, "plan", { under: "Files/notes" }).map((h: any) => h.entry.path)).toEqual(["Files/notes/plan.txt"]);
  });

  it("says what is wrong with a folder it cannot search", () => {
    expect(() => search(SLUG, "plan", { under: "Files/missing" })).toThrow("isn't there");
  });
});

describe("what is not searched", () => {
  it("never searches Trash", () => {
    put(path.join(botDir(), "trash", "vault-note.txt"), "vault secret");
    expect(search(SLUG, "vault")).toEqual([]);
    expect(search(SLUG, "vault", { under: "Trash" })).toEqual([]);
  });

  it("skips dotfiles", () => {
    put(wsPath(".hidden.txt"), "hidden-word");
    expect(search(SLUG, "hidden")).toEqual([]);
  });

  it("does not follow a link out of the bot's disk", () => {
    put(path.join(outside, "classified.txt"), "classified words");
    try {
      symlinkSync(outside, wsPath("link"), process.platform === "win32" ? "junction" : "dir");
    } catch {
      return;
    }
    expect(search(SLUG, "classified")).toEqual([]);
    expect(search(SLUG, "link")).toEqual([]);
  });

  it("stops at the entry limit and returns what it found so far", () => {
    for (let i = 0; i < 30; i++) put(wsPath(`file-${i}.txt`), "x");
    const small = createSearch({ disk, maxEntries: 10 }).search;
    const hits = small(SLUG, "file");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(10);
  });

  it("stops when the time budget is spent", () => {
    for (let i = 0; i < 30; i++) put(wsPath(`file-${i}.txt`), "x");
    let t = 0;
    const timed = createSearch({ disk, now: () => (t += 1000), budgetMs: 2500 }).search;
    const hits = timed(SLUG, "file");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(30);
  });
});
