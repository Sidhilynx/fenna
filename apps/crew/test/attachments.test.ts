import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunEvent } from "@opendeck/crew";

const require = createRequire(import.meta.url);
const { createStore } = require("../src/main/store.cjs");
const { createDisk, IMPORT_MAX, INBOX } = require("../src/main/disk.cjs");
const { createWaits } = require("../src/main/waits.cjs");
const { createRunner } = require("../src/main/runner.cjs");
const { buildPrompt } = require("../src/main/prompt.cjs");
const { MAX_FILES, INLINE_MAX_BYTES, checkAttachments, forRun, kindWord, messageWith } = require("../src/main/attachments.cjs");

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const SLUG = "research";

const bytesOf = (text: string): ArrayBuffer => {
  const b = Buffer.from(text, "utf8");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const sized = (n: number): ArrayBuffer => new ArrayBuffer(n);

let root: string;
let store: ReturnType<typeof createStore>;
let disk: any;
let settingsFile: string;

const botDir = () => store.botDir(SLUG);
const inboxDir = () => path.join(botDir(), "workspace", "Inbox");

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crew-attach-"));
  settingsFile = path.join(root, "disk-quotas.json");
  store = createStore(root);
  expect(store.createBot({ name: "Research", job: "Checks example.com" })).toBe(SLUG);
  disk =createDisk({ store, broadcast: () => {}, starterFiles: () => ({}), settingsFile });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("checkAttachments", () => {
  it("takes no files as an empty list", () => {
    expect(checkAttachments(undefined)).toEqual([]);
    expect(checkAttachments(null)).toEqual([]);
  });

  it("allows up to 10 files and refuses the 11th with how to fix it", () => {
    const ten = Array.from({ length: MAX_FILES }, (_, i) => ({ name: `f${i}.txt`, bytes: bytesOf("x") }));
    expect(checkAttachments(ten)).toHaveLength(10);
    const eleven = [...ten, { name: "extra.txt", bytes: bytesOf("x") }];
    expect(() => checkAttachments(eleven)).toThrow("You can attach at most 10 files to a message. Take off 1 and send again.");
  });

  it("refuses a list that is not a list, and a file that is not a name and its bytes", () => {
    expect(() => checkAttachments("q3.xlsx")).toThrow("should be a list");
    expect(() => checkAttachments([{ name: "a.txt", bytes: "not bytes" }])).toThrow("a name and its bytes");
    expect(() => checkAttachments([{ name: "  ", bytes: bytesOf("x") }])).toThrow("a name and its bytes");
  });
});

describe("kindWord", () => {
  it("names what a file is in a word for the message", () => {
    expect(kindWord("q3.xlsx")).toBe("spreadsheet");
    expect(kindWord("data.CSV")).toBe("spreadsheet");
    expect(kindWord("memo.docx")).toBe("document");
    expect(kindWord("deck.pptx")).toBe("slides");
    expect(kindWord("chart.PNG")).toBe("image");
    expect(kindWord("paper.pdf")).toBe("pdf");
    expect(kindWord("notes.txt")).toBe("text");
    expect(kindWord("blob.weird")).toBe("file");
  });
});

describe("messageWith", () => {
  const list = [{ path: "Files/Inbox/q3.xlsx", name: "q3.xlsx", kind: "spreadsheet", size: 18 * 1024 }];

  it("leaves the words as they are with no files", () => {
    expect(messageWith("Check this", [])).toBe("Check this");
    expect(messageWith("Check this", undefined)).toBe("Check this");
  });

  it("lists each file after the words, as its disk path, kind and size", () => {
    const two = [...list, { path: "Files/Inbox/a (2).png", name: "a.png", kind: "image", size: 2 * MB }];
    expect(messageWith("Add a total", two)).toBe(
      "Add a total\n\nFiles the person attached, saved on your disk:\nAttached: Files/Inbox/q3.xlsx (spreadsheet, 18 KB)\nAttached: Files/Inbox/a (2).png (image, 2.0 MB)",
    );
  });

  it("is the block alone when the person sent files without words", () => {
    expect(messageWith("   ", list)).toBe("Files the person attached, saved on your disk:\nAttached: Files/Inbox/q3.xlsx (spreadsheet, 18 KB)");
  });
});

describe("forRun", () => {
  const saved = (name: string, size: number, dir = "/bots/research/workspace/Inbox") => ({ path: `Files/Inbox/${name}`, name, size, abs: path.join(dir, name) });

  it("gives the run the list without bytes, and inlines the images that are small", () => {
    const files = [{ name: "q3.xlsx", bytes: bytesOf("sheet") }, { name: "shot.png", bytes: bytesOf("pixels") }];
    const out = forRun([saved("q3.xlsx", 5), saved("shot.png", 6)], files);
    expect(out.list).toEqual([
      { path: "Files/Inbox/q3.xlsx", name: "q3.xlsx", kind: "spreadsheet", size: 5 },
      { path: "Files/Inbox/shot.png", name: "shot.png", kind: "image", size: 6 },
    ]);
    expect(out.images).toEqual([{ name: "shot.png", mimeType: "image/png", path: path.join("/bots/research/workspace/Inbox", "shot.png"), base64: Buffer.from("pixels").toString("base64") }]);
  });

  it("inlines at most five images, and skips any image over 5 MB while still listing it", () => {
    const names = Array.from({ length: 6 }, (_, i) => `p${i}.jpg`);
    const files = names.map((name) => ({ name, bytes: bytesOf("x") }));
    const six = forRun(names.map((n) => saved(n, 1)), files);
    expect(six.images.map((i: { name: string }) => i.name)).toEqual(names.slice(0, 5));

    const big = forRun([saved("huge.png", INLINE_MAX_BYTES + 1), saved("ok.webp", 10)], [{ name: "huge.png", bytes: sized(1) }, { name: "ok.webp", bytes: bytesOf("x") }]);
    expect(big.list.map((a: { name: string }) => a.name)).toEqual(["huge.png", "ok.webp"]);
    expect(big.images.map((i: { name: string }) => i.name)).toEqual(["ok.webp"]);
  });

  it("does not inline a file that is not a picture", () => {
    const out = forRun([saved("paper.pdf", 4)], [{ name: "paper.pdf", bytes: bytesOf("%PDF") }]);
    expect(out.images).toEqual([]);
    expect(out.list[0]!.kind).toBe("pdf");
  });
});

describe("disk.inbox", () => {
  it("makes Files/Inbox and saves each file there, with its disk path, name, size and absolute path", () => {
    const saved = disk.inbox(SLUG, [{ name: "q3.xlsx", bytes: bytesOf("sheet") }, { name: "photo.jpg", bytes: bytesOf("jpeg") }]);
    expect(INBOX).toBe("Files/Inbox");
    expect(saved).toEqual([
      { path: "Files/Inbox/q3.xlsx", name: "q3.xlsx", size: 5, abs: path.join(inboxDir(), "q3.xlsx") },
      { path: "Files/Inbox/photo.jpg", name: "photo.jpg", size: 4, abs: path.join(inboxDir(), "photo.jpg") },
    ]);
    expect(readFileSync(path.join(inboxDir(), "q3.xlsx"), "utf8")).toBe("sheet");
  });

  it("gives a clashing name a number, and keeps the first file", () => {
    disk.inbox(SLUG, [{ name: "q3.xlsx", bytes: bytesOf("first") }]);
    const second = disk.inbox(SLUG, [{ name: "q3.xlsx", bytes: bytesOf("second") }]);
    const third = disk.inbox(SLUG, [{ name: "q3.xlsx", bytes: bytesOf("third") }]);
    expect(second[0].path).toBe("Files/Inbox/q3 (2).xlsx");
    expect(third[0].path).toBe("Files/Inbox/q3 (3).xlsx");
    expect(readFileSync(path.join(inboxDir(), "q3.xlsx"), "utf8")).toBe("first");
    expect(readFileSync(path.join(inboxDir(), "q3 (3).xlsx"), "utf8")).toBe("third");
  });

  it("cleans a name so it stays in the Inbox", () => {
    const [saved] = disk.inbox(SLUG, [{ name: "../sub/we?ird:name.txt", bytes: bytesOf("x") }]);
    expect(saved.name).toBe("we_ird_name.txt");
    expect(existsSync(path.join(inboxDir(), "we_ird_name.txt"))).toBe(true);
  });

  it("refuses a file over 200 MB and saves nothing from that send", () => {
    expect(() => disk.inbox(SLUG, [{ name: "small.txt", bytes: bytesOf("x") }, { name: "big.bin", bytes: sized(IMPORT_MAX + 1) }])).toThrow("big.bin is larger than 200 MB.");
    expect(existsSync(path.join(inboxDir(), "small.txt"))).toBe(false);
    expect(readdirSync(inboxDir())).toEqual([]);
  });

  it("refuses a send that does not fit in the bot's disk, and says how much is free", () => {
    const filler = path.join(botDir(), "workspace", "filler.bin");
    mkdirSync(path.join(botDir(), "workspace"), { recursive: true });
    writeFileSync(filler, "");
    truncateSync(filler, 5 * GB - MB);
    expect(() => disk.inbox(SLUG, [{ name: "two.bin", bytes: sized(2 * MB) }])).toThrow("That won't fit in the bot's disk.");
    expect(existsSync(path.join(inboxDir(), "two.bin"))).toBe(false);
  });
});

describe("runner with attachments", () => {
  type Call = { prompt: string; images: { name: string; mimeType: string; path: string; base64: string }[]; stop(): void; onEvent(e: object): void };
  let calls: Call[];
  let runner: ReturnType<typeof createRunner>;
  let clock: Date;

  beforeEach(() => {
    calls = [];
    clock = new Date(2026, 10, 20, 9, 30);
    const waits = createWaits({ timeoutMs: 1500 });
    const link = { issue: () => "token", revoke: () => {} };
    runner = createRunner({
      store,
      startRun: (o: Call) => {
        calls.push(o);
        return { runId: "cli", stop: () => {} };
      },
      serversFor: () => ({ servers: { crew: { command: "node" } }, trusted: ["crew"] }),
      link,
      waits,
      onChange: () => {},
      emitLive: () => {},
      now: () => clock,
    });
  });

  afterEach(() => runner.stopAll());

  it("names the attached files in the message the bot gets, passes its images, and logs the list in the run", () => {
    const files = [{ name: "q3.xlsx", bytes: bytesOf("sheet") }, { name: "chart.png", bytes: bytesOf("png") }];
    const saved = disk.inbox(SLUG, files);
    const sent = forRun(saved, files);
    runner.enqueue({ slug: SLUG, trigger: "person", text: "Total the quarter", attachments: sent.list, images: sent.images });

    const call = calls[0]!;
    expect(call.prompt).toContain("Total the quarter\n\nFiles the person attached, saved on your disk:\nAttached: Files/Inbox/q3.xlsx (spreadsheet, 1 KB)\nAttached: Files/Inbox/chart.png (image, 1 KB)");
    expect(call.images).toEqual([{ name: "chart.png", mimeType: "image/png", path: path.join(inboxDir(), "chart.png"), base64: Buffer.from("png").toString("base64") }]);

    const file = store.runFiles(SLUG)[0];
    const start = store.readRun(SLUG, file).find((e: RunEvent) => e.type === "start") as Extract<RunEvent, { type: "start" }>;
    expect(start.text).toBe("Total the quarter");
    expect(start.attachments).toEqual([
      { path: "Files/Inbox/q3.xlsx", name: "q3.xlsx", kind: "spreadsheet", size: 5 },
      { path: "Files/Inbox/chart.png", name: "chart.png", kind: "image", size: 3 },
    ]);
  });

  it("sends files with no words, and titles the chat with the first file's name", () => {
    const files = [{ name: "notes.txt", bytes: bytesOf("hi") }];
    const sent = forRun(disk.inbox(SLUG, files), files);
    const r = runner.enqueue({ slug: SLUG, trigger: "person", text: "", attachments: sent.list, images: sent.images, chat: null });
    expect(r.queued).toBe(false);
    expect(calls[0]!.prompt).toContain("Files the person attached, saved on your disk:\nAttached: Files/Inbox/notes.txt (text, 1 KB)");
    const chat = store.readState(SLUG).chats.find((c: { id: string }) => c.id === store.readState(SLUG).current);
    expect(chat.title).toBe("notes.txt");
  });

  it("leaves a message with no files as it was, with no attachment in the log", () => {
    runner.enqueue({ slug: SLUG, trigger: "person", text: "Just words" });
    expect(calls[0]!.prompt).toContain("Just words");
    expect(calls[0]!.prompt).not.toContain("Files the person attached");
    expect(calls[0]!.images).toEqual([]);
    const start = store.readRun(SLUG, store.runFiles(SLUG)[0]).find((e: RunEvent) => e.type === "start") as Record<string, unknown>;
    expect("attachments" in start).toBe(false);
  });
});

describe("buildPrompt", () => {
  it("tells the bot that attached files arrive in Files/Inbox and are listed in the message", () => {
    const slug = store.createBot({ name: "Helper", job: "Helps" });
    const bot = store.readBot(slug).bot;
    const text = buildPrompt({ slug, bot, memory: "", library: [], others: [], team: null, trigger: "person", text: "hi", now: new Date(2026, 10, 20, 9, 30), installed: () => true });
    expect(text).toContain("Files the person attaches to a message are saved in Files/Inbox/ on your disk");
    expect(text).toContain('"Attached: <path> (kind, size)"');
  });
});
