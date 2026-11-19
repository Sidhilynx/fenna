import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotices, registerNoticesIpc, NOTICE_MAX } from "../src/main/notices.cjs";

let root: string;
const slugDir = (slug: string) => path.join(root, slug);

function makeBot(slug: string) {
  fs.mkdirSync(slugDir(slug), { recursive: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "notices-"));
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

function make(opts: { broadcast?: (c: string, p: unknown) => void } = {}) {
  return createNotices({
    botDir: slugDir,
    broadcast: opts.broadcast,
    now: () => new Date("2026-11-19T10:00:00Z"),
  });
}

describe("notices", () => {
  it("keeps newest first, counts unread, and names the kind when the title is empty", () => {
    makeBot("ada");
    const n = make();
    n.add("ada", { kind: "download", title: "  " });
    n.add("ada", { kind: "site", title: "Sam", body: "hi", origin: "https://web.example" });
    const s = n.state("ada");
    expect(s.items.map((x) => x.title)).toEqual(["Sam", "Download"]);
    expect(s.unread).toBe(2);
    expect(s.items[0]!.origin).toBe("https://web.example");
  });

  it("rejects an unknown kind and lists the kinds", () => {
    makeBot("ada");
    expect(() => make().add("ada", { kind: "email" as never, title: "x" })).toThrow(/site, download, run, watch, reminder/);
  });

  it("holds at most 100 notices, with unread never above what it holds", () => {
    makeBot("ada");
    const n = make();
    for (let i = 0; i < NOTICE_MAX + 5; i++) n.add("ada", { kind: "run", title: `run ${i}` });
    const s = n.state("ada");
    expect(s.items).toHaveLength(NOTICE_MAX);
    expect(s.items[0]!.title).toBe(`run ${NOTICE_MAX + 4}`);
    expect(s.unread).toBe(NOTICE_MAX);
  });

  it("marks read and clears, and reports only real changes", () => {
    makeBot("ada");
    const sent: unknown[] = [];
    const n = make({ broadcast: (c, p) => sent.push([c, p]) });
    n.add("ada", { kind: "watch", title: "x" });
    expect(n.markRead("ada").unread).toBe(0);
    const before = sent.length;
    n.markRead("ada");
    expect(sent.length).toBe(before);
    expect(n.clear("ada")).toEqual({ items: [], unread: 0 });
    expect(sent[0]).toEqual(["crew:notices", { slug: "ada" }]);
  });

  it("writes notices.json once, a moment after a burst of changes", () => {
    makeBot("ada");
    const n = make();
    n.add("ada", { kind: "run", title: "a" });
    n.add("ada", { kind: "run", title: "b" });
    const file = path.join(slugDir("ada"), "notices.json");
    expect(fs.existsSync(file)).toBe(false);
    vi.advanceTimersByTime(300);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(saved.items.map((x: { title: string }) => x.title)).toEqual(["b", "a"]);
    expect(saved.unread).toBe(2);
  });

  it("reads back what was saved, and treats a broken file as empty", () => {
    makeBot("ada");
    const first = make();
    first.add("ada", { kind: "site", title: "kept" });
    first.flush();
    expect(make().state("ada").items[0]!.title).toBe("kept");
    fs.writeFileSync(path.join(slugDir("ada"), "notices.json"), "{not json");
    expect(make().state("ada")).toEqual({ items: [], unread: 0 });
  });

  it("does not recreate a bot folder that is gone", () => {
    const n = make();
    n.add("ghost", { kind: "run", title: "x" });
    vi.advanceTimersByTime(300);
    expect(fs.existsSync(slugDir("ghost"))).toBe(false);
  });
});

describe("notices IPC", () => {
  function setup() {
    makeBot("ada");
    const handlers = new Map<string, (...a: unknown[]) => unknown>();
    const ipcMain = { handle: (c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn) };
    const notices = make();
    const reminders: unknown[] = [];
    const watches = {
      add: async (slug: string, input: unknown) => {
        reminders.push([slug, input]);
        return { id: "w1", ...(input as object) };
      },
    };
    const store = { readBot: (slug: string) => (slug === "ada" ? { slug } : null) };
    registerNoticesIpc({ ipcMain, assertSender: () => {}, store: store as never, watches: watches as never, notices });
    const call = (c: string, ...a: unknown[]) => handlers.get(c)!({}, ...a);
    return { call, notices, reminders };
  }

  it("answers the notice calls for a known bot and refuses an unknown one", () => {
    const { call, notices } = setup();
    notices.add("ada", { kind: "run", title: "done" });
    expect((call("crew:notices", "ada") as { unread: number }).unread).toBe(1);
    expect((call("crew:readNotices", "ada") as { unread: number }).unread).toBe(0);
    expect((call("crew:clearNotices", "ada") as { items: unknown[] }).items).toHaveLength(0);
    expect(() => call("crew:notices", "nobody")).toThrow(/not a bot/);
    expect(() => call("crew:notices", "../etc")).toThrow(/not a bot/);
  });

  it("turns a reminder into a timer watch whose note is the person's words", async () => {
    const { call, reminders } = setup();
    await call("crew:addReminder", "ada", { at: "2026-11-20T09:00:00Z", note: "  Call Sam  " });
    expect(reminders).toEqual([["ada", { kind: "timer", at: "2026-11-20T09:00:00.000Z", note: "Call Sam" }]]);
  });

  it("refuses a reminder with no note, no time, or a bad time", () => {
    const { call } = setup();
    expect(() => call("crew:addReminder", "ada", { at: "2026-11-20T09:00:00Z", note: " " })).toThrow(/Write what to remind/);
    expect(() => call("crew:addReminder", "ada", { at: "tomorrow", note: "x" })).toThrow(/Pick a time/);
    expect(() => call("crew:addReminder", "ada", null)).toThrow(/Send the reminder/);
  });
});
