import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createStore } = require("../src/main/store.cjs");
const { createDisk } = require("../src/main/disk.cjs");
const { createTransfer, MAX_PATHS } = require("../src/main/transfer.cjs");

const SLUG = "research";
const starterFiles = (kind: string, title: string) => ({ [`${kind}.json`]: JSON.stringify({ title }), "tabs/tab-1.html": "<article></article>" });

let root: string;
let downloads: string;
let store: { botDir(slug: string): string };
let disk: any;
let started: { files: string[]; file: string; icon: unknown }[];
let dialogCalls: { defaultPath: string }[];
let saveTo: string | null;

const botDir = () => store.botDir(SLUG);
const wsPath = (rel: string) => path.join(botDir(), "workspace", rel);

function writeWs(rel: string, text = "hello") {
  mkdirSync(path.dirname(wsPath(rel)), { recursive: true });
  writeFileSync(wsPath(rel), text);
}

const sender = { startDrag: (item: { files: string[]; file: string; icon: unknown }) => started.push(item) };

function makeTransfer() {
  const electron = {
    nativeImage: { createFromPath: (file: string) => ({ icon: file }) },
    BrowserWindow: { fromWebContents: () => null },
    dialog: {
      showSaveDialog: async (options: { defaultPath: string }) => {
        dialogCalls.push(options);
        return saveTo === null ? { canceled: true, filePath: undefined } : { canceled: false, filePath: saveTo };
      },
    },
    app: { getPath: () => downloads },
  };
  return createTransfer({ disk, electron, iconFile: path.join(root, "icon.png") });
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crew-transfer-"));
  downloads = mkdtempSync(path.join(tmpdir(), "crew-transfer-save-"));
  store = createStore(root);
  mkdirSync(botDir(), { recursive: true });
  writeFileSync(path.join(botDir(), "bot.md"), "# research\n");
  disk = createDisk({ store, broadcast: () => {}, starterFiles, settingsFile: path.join(root, "disk-quotas.json") });
  started = [];
  dialogCalls = [];
  saveTo = null;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(downloads, { recursive: true, force: true });
});

describe("dragging files out of the bot's disk", () => {
  it("starts one native drag with the file, and every file when several are dragged", () => {
    writeWs("a.txt");
    writeWs("b.txt");
    const transfer = makeTransfer();
    transfer.dragOut(sender, SLUG, ["Files/a.txt"]);
    transfer.dragOut(sender, SLUG, ["Files/a.txt", "Files/b.txt"]);
    expect(started.map((s) => s.files)).toEqual([[wsPath("a.txt")], [wsPath("a.txt"), wsPath("b.txt")]]);
    expect(started[0]?.file).toBe(wsPath("a.txt"));
    expect(started[0]?.icon).toEqual({ icon: path.join(root, "icon.png") });
  });

  it("starts a drag of a file in Downloads", () => {
    mkdirSync(wsPath("downloads"), { recursive: true });
    writeFileSync(wsPath("downloads/report.pdf"), "pdf");
    makeTransfer().dragOut(sender, SLUG, ["Downloads/report.pdf"]);
    expect(started[0]?.files).toEqual([wsPath("downloads/report.pdf")]);
  });

  it("refuses the whole drag when any path is not a file the bot may give: nothing is dragged", () => {
    writeWs("a.txt");
    disk.newDoc(SLUG, "doc", "Q3 report");
    const transfer = makeTransfer();
    expect(() => transfer.dragOut(sender, SLUG, ["Files/a.txt", "Documents/q3-report"])).toThrow("A Fenna document can't be copied to this computer.");
    expect(() => transfer.dragOut(sender, SLUG, ["Files/a.txt", "Trash/old.txt"])).toThrow("Restore it from Trash first.");
    expect(() => transfer.dragOut(sender, SLUG, ["Files/a.txt", "Files"])).toThrow("Only files can be copied to this computer.");
    expect(() => transfer.dragOut(sender, SLUG, ["Files/a.txt", "../../secret.txt"])).toThrow();
    expect(() => transfer.dragOut(sender, SLUG, ["Files/a.txt", path.join(root, "secret.txt")])).toThrow();
    expect(started).toEqual([]);
  });

  it("refuses a drag with no files, too many, or paths that are not text", () => {
    const transfer = makeTransfer();
    expect(() => transfer.dragOut(sender, SLUG, [])).toThrow("Say which files, up to 200.");
    expect(() => transfer.dragOut(sender, SLUG, "Files/a.txt")).toThrow("Say which files");
    expect(() => transfer.dragOut(sender, SLUG, new Array(MAX_PATHS + 1).fill("Files/a.txt"))).toThrow("Say which files, up to 200.");
    expect(() => transfer.dragOut(sender, SLUG, [42])).toThrow("That isn't a file on the bot's disk.");
    expect(() => transfer.dragOut(sender, SLUG, ["Files/" + "x".repeat(4096)])).toThrow("That isn't a file on the bot's disk.");
    expect(started).toEqual([]);
  });

  it("refuses a bot that is not there", () => {
    writeWs("a.txt");
    expect(() => makeTransfer().dragOut(sender, "nobody", ["Files/a.txt"])).toThrow('There is no bot "nobody".');
  });
});

describe("save a copy to…", () => {
  it("opens the save dialog in the person's Downloads, then copies the file there", async () => {
    writeWs("notes/a.txt", "the notes");
    saveTo = path.join(downloads, "copy.txt");
    const to = await makeTransfer().saveCopy(sender, SLUG, "Files/notes/a.txt");
    expect(to).toBe(saveTo);
    expect(dialogCalls).toEqual([{ defaultPath: path.join(downloads, "a.txt") }]);
    expect(readFileSync(saveTo, "utf8")).toBe("the notes");
  });

  it("does nothing when the person cancels", async () => {
    writeWs("a.txt");
    saveTo = null;
    expect(await makeTransfer().saveCopy(sender, SLUG, "Files/a.txt")).toBeNull();
    expect(existsSync(path.join(downloads, "a.txt"))).toBe(false);
  });

  it("refuses a file the bot may not give before any dialog opens", async () => {
    disk.newDoc(SLUG, "doc", "Q3 report");
    const transfer = makeTransfer();
    await expect(transfer.saveCopy(sender, SLUG, "Documents/q3-report")).rejects.toThrow("A Fenna document can't be copied to this computer.");
    await expect(transfer.saveCopy(sender, SLUG, "Trash/old.txt")).rejects.toThrow("Restore it from Trash first.");
    await expect(transfer.saveCopy(sender, SLUG, "../secret.txt")).rejects.toThrow();
    expect(dialogCalls).toEqual([]);
  });

  it("refuses to save a file over itself", async () => {
    writeWs("a.txt", "keep");
    saveTo = wsPath("a.txt");
    await expect(makeTransfer().saveCopy(sender, SLUG, "Files/a.txt")).rejects.toThrow("That is the file itself.");
    expect(readFileSync(wsPath("a.txt"), "utf8")).toBe("keep");
  });
});
