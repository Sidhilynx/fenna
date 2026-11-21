import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createStore } = require("../src/main/store.cjs");
const { createWatches, watchLine } = require("../src/main/watches.cjs");
const { buildPrompt } = require("../src/main/prompt.cjs");

const HOUR = 3_600_000;
const MIN = 60_000;
const SITE = "https://web.whatsapp.com";

type Watches = ReturnType<typeof createWatches>;

let root: string;
let store: ReturnType<typeof createStore>;
let slug: string;
let w: Watches;
let enqueued: { slug: string; trigger: string; text: string }[];
let busy: Set<string>;
let broadcasts: { channel: string; payload: unknown }[];
let browsers: Record<string, ReturnType<typeof vi.fn>>;

const runner = {
  enqueue: (o: { slug: string; trigger: string; text: string }) => {
    enqueued.push(o);
    return { runId: `run-${enqueued.length}`, queued: false, done: Promise.resolve(null) };
  },
  running: (s: string) => (busy.has(s) ? { runId: "busy" } : null),
  isQueued: () => false,
};

function start(instance: Watches = w) {
  instance.start();
  return instance;
}

/** Lets pending promise callbacks run; setImmediate is not faked. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-11-19T09:00:00Z"));
  root = mkdtempSync(path.join(tmpdir(), "crew-watches-"));
  store = createStore(root);
  slug = store.createBot({ name: "Watcher", job: "Waits for things", how: "", schedule: "manual", cli: "claude" });
  enqueued = [];
  busy = new Set();
  broadcasts = [];
  browsers = {
    watchElement: vi.fn(async () => ({ origin: "https://shop.example", url: "https://shop.example/item", selector: "#price", text: "$10" })),
    armElement: vi.fn(async () => undefined),
    unwatchElement: vi.fn(async () => undefined),
    pageText: vi.fn(async () => ""),
    notifications: vi.fn(() => []),
  };
  w = createWatches({ store, runner, browsers, broadcast: (channel, payload) => broadcasts.push({ channel, payload }) });
});

afterEach(() => {
  w.stop();
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

const notify = (origin: string, title: string, body = "") => w.onNotification(slug, { origin, title, body, at: new Date().toISOString() });

describe("watch validation", () => {
  it("refuses a site with a path, a non-web address and a page check under 5 minutes, saying how to fix it", async () => {
    await expect(w.add(slug, { kind: "notification", origin: `${SITE}/send`, note: "x" })).rejects.toThrow(`Give the site without a path, like ${SITE}`);
    await expect(w.add(slug, { kind: "notification", origin: "ftp://files.example", note: "x" })).rejects.toThrow("must be an http or https site");
    await expect(w.add(slug, { kind: "page", url: "example.com", every: 5, note: "x" })).rejects.toThrow("is not a web address");
    await expect(w.add(slug, { kind: "page", url: "https://example.com", every: 4, note: "x" })).rejects.toThrow("5 or more");
    expect(store.readWatches(slug)).toEqual([]);
  });

  it("refuses a timer that has passed, both at and in, a repeat under 1 minute, and a note out of range", async () => {
    await expect(w.add(slug, { kind: "timer", at: "2026-11-19T08:00:00Z", note: "x" })).rejects.toThrow("has passed");
    await expect(w.add(slug, { kind: "timer", at: "2026-11-19T10:00:00Z", in: 5, note: "x" })).rejects.toThrow("not both and not neither");
    await expect(w.add(slug, { kind: "timer", in: 0, note: "x" })).rejects.toThrow("above 0");
    await expect(w.add(slug, { kind: "timer", in: 5, every: 0, note: "x" })).rejects.toThrow("1 or more");
    await expect(w.add(slug, { kind: "timer", in: 5, note: "  " })).rejects.toThrow("in note");
    await expect(w.add(slug, { kind: "timer", in: 5, note: "x".repeat(301) })).rejects.toThrow("300");
  });

  it("takes an element by its ref only, and an unknown kind is named", async () => {
    await expect(w.add(slug, { kind: "element", selector: "#price", note: "x" })).rejects.toThrow("by ref");
    await expect(w.add(slug, { kind: "element", note: "x" })).rejects.toThrow('like "e12"');
    await expect(w.add(slug, { kind: "email", note: "x" })).rejects.toThrow("one of notification, element, page, timer");
    expect(browsers.watchElement).not.toHaveBeenCalled();
  });

  it("turns in minutes into a time, and holds at most 20 watches", async () => {
    const t = await w.add(slug, { kind: "timer", in: 30, note: "Call back" });
    expect(t.at).toBe("2026-11-19T09:30:00.000Z");
    for (let i = 1; i < 20; i++) await w.add(slug, { kind: "timer", in: 60 + i, note: `Later ${i}` });
    await expect(w.add(slug, { kind: "timer", in: 90, note: "One too many" })).rejects.toThrow("can hold 20 watches");
    expect(w.list(slug)).toHaveLength(20);
  });

  it("gives every watch a short id that list shows as one line", async () => {
    const t = await w.add(slug, { kind: "notification", origin: SITE, match: "Sam", note: "Reply to Sam if he asks something" });
    expect(t.id).toMatch(/^[0-9a-f]{6}$/);
    expect(watchLine(t)).toBe(`${t.id}  notification  Reply to Sam if he asks something — ${SITE} containing "Sam"`);
  });
});

describe("notification watches", () => {
  it("fires for its site, with its words in any case, and leaves other sites and other words alone", async () => {
    await w.add(slug, { kind: "notification", origin: SITE, match: "Sam", note: "Reply to Sam if he asks something" });
    notify("https://mail.example", "Sam", "hi");
    notify(SITE, "Priya", "Lunch?");
    notify(SITE, "SAM", "Are you free?");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(enqueued).toEqual([{ slug, trigger: "watch", text: "Reply to Sam if he asks something — SAM: Are you free?" }]);
    expect(store.readWatches(slug)[0]).toMatchObject({ count: 1, fired: "2026-11-19T09:00:00.000Z" });
    expect(broadcasts.at(-1)).toEqual({ channel: "crew:watches", payload: { slug } });
  });

  it("fires for every notification from its site when it has no words", async () => {
    await w.add(slug, { kind: "notification", origin: SITE, note: "Look at every message" });
    notify(SITE, "Priya");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(enqueued[0]!.text).toBe("Look at every message — Priya");
  });
});

describe("waking the bot", () => {
  it("bundles what happens within 10 seconds into one wake", async () => {
    await w.add(slug, { kind: "notification", origin: SITE, note: "Messages" });
    notify(SITE, "Priya", "One");
    await vi.advanceTimersByTimeAsync(4_000);
    notify(SITE, "Sam", "Two");
    await vi.advanceTimersByTimeAsync(5_999);
    expect(enqueued).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(enqueued).toEqual([{ slug, trigger: "watch", text: "Messages — Priya: One\nMessages — Sam: Two" }]);
  });

  it("holds events while the bot runs, and wakes it when its run ends", async () => {
    await w.add(slug, { kind: "notification", origin: SITE, note: "Messages" });
    busy.add(slug);
    notify(SITE, "Priya", "One");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(enqueued).toEqual([]);
    busy.delete(slug);
    w.runEnded();
    await vi.advanceTimersByTimeAsync(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.text).toBe("Messages — Priya: One");
  });

  it("wakes a bot at most 12 times an hour, then wakes it with the held events when the hour allows", async () => {
    await w.add(slug, { kind: "notification", origin: SITE, note: "Messages" });
    const t0 = Date.now();
    for (let i = 0; i < 13; i++) {
      notify(SITE, `Msg ${i}`);
      await vi.advanceTimersByTimeAsync(11_000);
    }
    expect(enqueued).toHaveLength(12);
    // The first wake was at t0 + 10 s, so the 13th may go at that time plus an hour.
    const freeAt = t0 + 10_000 + HOUR;
    await vi.advanceTimersByTimeAsync(freeAt - Date.now() - 1);
    expect(enqueued).toHaveLength(12);
    await vi.advanceTimersByTimeAsync(1);
    expect(enqueued).toHaveLength(13);
    expect(enqueued[12]!.text).toBe("Messages — Msg 12");
  });
});

describe("title counts", () => {
  const title = (text: string, origin = SITE) => w.onTitleCount(slug, { origin, title: text, count: 1 });

  it("fires a notification watch for its site when the title gains a count, with the title in the words", async () => {
    await w.add(slug, { kind: "notification", origin: SITE, note: "Reply to whoever wrote" });
    title("(1) WhatsApp");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(enqueued).toEqual([{ slug, trigger: "watch", text: 'Reply to whoever wrote — New activity: the tab\'s title is now "(1) WhatsApp".' }]);
    expect(store.readWatches(slug)[0]).toMatchObject({ count: 1, fired: "2026-11-19T09:00:00.000Z" });
  });

  it("fires only when the title has the watch's words, and ignores other origins", async () => {
    await w.add(slug, { kind: "notification", origin: SITE, match: "Sam", note: "Reply to Sam" });
    title("(1) Priya - WhatsApp");
    title("(1) Sam - WhatsApp", "https://mail.example");
    expect(enqueued).toEqual([]);
    title("(2) Sam - WhatsApp");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.text).toContain("Reply to Sam — New activity");
  });

  it("does not fire the same watch again within 10 seconds of its last fire, and fires again after", async () => {
    await w.add(slug, { kind: "notification", origin: SITE, note: "Messages" });
    notify(SITE, "Priya", "Hi");
    await vi.advanceTimersByTimeAsync(4_000);
    title("(1) WhatsApp");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.text).toBe("Messages — Priya: Hi");
    expect(store.readWatches(slug)[0]).toMatchObject({ count: 1 });
    title("(2) WhatsApp");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(enqueued).toHaveLength(2);
    expect(enqueued[1]!.text).toContain("New activity");
  });
});

describe("page watches", () => {
  it("stores the first text it reads without firing, then fires with the changed lines", async () => {
    browsers.pageText!.mockResolvedValue("Price\nTeam plan $10\nFree plan");
    await w.add(slug, { kind: "page", url: "https://site.example/pricing", every: 5, note: "Tell me when prices change" });
    expect(store.readWatches(slug)[0]).toMatchObject({ last: "Price\nTeam plan $10\nFree plan" });
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(enqueued).toEqual([]);

    browsers.pageText!.mockResolvedValue("Price\nTeam plan $12\nFree plan");
    await vi.advanceTimersByTimeAsync(5 * MIN + 10_000);
    expect(enqueued).toEqual([{ slug, trigger: "watch", text: "Tell me when prices change — changed: - Team plan $10 / + Team plan $12" }]);
    expect(store.readWatches(slug)[0]).toMatchObject({ count: 1, last: "Price\nTeam plan $12\nFree plan" });
  });

  it("lists at most 20 changed lines, the last one saying how many more", async () => {
    await w.add(slug, { kind: "page", url: "https://site.example/news", every: 5, note: "New items" });
    browsers.pageText!.mockResolvedValue(Array.from({ length: 30 }, (_, i) => `item ${i + 1}`).join("\n"));
    await vi.advanceTimersByTimeAsync(5 * MIN + 10_000);
    const what = enqueued[0]!.text.replace("New items — changed: ", "").split(" / ");
    expect(what).toHaveLength(20);
    expect(what[0]).toBe("+ item 1");
    expect(what.at(-1)).toBe("… and 11 more lines");
  });

  it("keeps watching when a check fails, and tries again at the next interval", async () => {
    browsers.pageText!.mockResolvedValueOnce("A");
    await w.add(slug, { kind: "page", url: "https://site.example/down", every: 5, note: "Watch" });
    browsers.pageText!.mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(5 * MIN);
    browsers.pageText!.mockResolvedValue("B");
    await vi.advanceTimersByTimeAsync(5 * MIN + 10_000);
    expect(enqueued[0]!.text).toBe("Watch — changed: - A / + B");
  });

  it("refuses to add a page it cannot read, and says what to check", async () => {
    browsers.pageText!.mockRejectedValue(new Error("not found"));
    await expect(w.add(slug, { kind: "page", url: "https://site.example/gone", every: 5, note: "x" })).rejects.toThrow("Could not read https://site.example/gone: not found");
    expect(store.readWatches(slug)).toEqual([]);
  });
});

describe("timer watches", () => {
  it("fires once and is removed after it fires", async () => {
    await w.add(slug, { kind: "timer", in: 30, note: "Call the vet back" });
    await vi.advanceTimersByTimeAsync(30 * MIN + 10_000);
    expect(enqueued).toEqual([{ slug, trigger: "watch", text: "Call the vet back — It is time." }]);
    expect(store.readWatches(slug)).toEqual([]);
  });

  it("repeats every N minutes and stays until removed", async () => {
    const t = await w.add(slug, { kind: "timer", in: 10, every: 10, note: "Check the sheet" });
    await vi.advanceTimersByTimeAsync(10 * MIN + 10_000);
    expect(enqueued).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(enqueued).toHaveLength(2);
    expect(enqueued[1]!.text).toBe("Check the sheet — It is time (every 10 minutes).");
    expect(store.readWatches(slug)).toEqual([expect.objectContaining({ id: t.id, count: 2 })]);
  });

  it("goes off at once after a restart when its time passed while Crew was closed", async () => {
    await w.add(slug, { kind: "timer", in: 30, note: "Call the vet back" });
    w.stop();
    vi.setSystemTime(new Date("2026-11-19T10:00:00Z"));
    w = createWatches({ store, runner, browsers, broadcast: () => {} });
    start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(enqueued).toEqual([{ slug, trigger: "watch", text: "Call the vet back — It is time." }]);
    expect(store.readWatches(slug)).toEqual([]);
  });
});

describe("element watches", () => {
  it("finds the element from the ref, and fires with the old and new text", async () => {
    const t = await w.add(slug, { kind: "element", ref: "e12", note: "Tell me when the price changes" });
    expect(browsers.watchElement).toHaveBeenCalledWith(slug, { id: t.id, ref: "e12" });
    expect(store.readWatches(slug)[0]).toMatchObject({ origin: "https://shop.example", url: "https://shop.example/item", selector: "#price", last: "$10" });

    w.onElementChange(slug, t.id, "$10");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(enqueued).toEqual([]);

    w.onElementChange(slug, t.id, "$12");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(enqueued).toEqual([{ slug, trigger: "watch", text: 'Tell me when the price changes — changed from "$10" to "$12"' }]);
    expect(store.readWatches(slug)[0]).toMatchObject({ last: "$12", count: 1 });
  });

  it("re-arms every element watch when Crew starts, and unwatches on remove or forget", async () => {
    const t = await w.add(slug, { kind: "element", ref: "e12", note: "Price" });
    w.stop();
    w = createWatches({ store, runner, browsers, broadcast: () => {} });
    start();
    await flush();
    expect(browsers.armElement).toHaveBeenCalledWith(slug, { id: t.id, origin: "https://shop.example", url: "https://shop.example/item", selector: "#price" });

    await w.remove(slug, t.id);
    expect(browsers.unwatchElement).toHaveBeenCalledWith(slug, t.id);
    expect(store.readWatches(slug)).toEqual([]);

    const again = await w.add(slug, { kind: "element", ref: "e12", note: "Price" });
    w.forget(slug);
    await flush();
    expect(browsers.unwatchElement).toHaveBeenLastCalledWith(slug, again.id);
  });

  it("removes a watch by id, and says which ids there are when the id is wrong", async () => {
    await w.add(slug, { kind: "timer", in: 30, note: "One" });
    await expect(w.remove(slug, "nope")).rejects.toThrow(/No watch with id nope\. Watches: [0-9a-f]{6}\./);
  });
});

describe("to-do list", () => {
  it("adds, lists, marks done and undone, and removes, by id", () => {
    const [item] = w.addTodo(slug, "Call the vet");
    expect(item).toMatchObject({ text: "Call the vet", done: false });
    expect(w.setTodo(slug, item.id, { done: true })[0]).toMatchObject({ done: true });
    expect(w.setTodo(slug, item.id, { done: false })[0]).toMatchObject({ done: false });
    expect(() => w.setTodo(slug, item.id, {})).toThrow("Say what to change");
    expect(() => w.setTodo(slug, "zzzzzz", { done: true })).toThrow("No to-do with id zzzzzz");
    expect(w.setTodo(slug, item.id, { remove: true })).toEqual([]);
  });

  it("holds 100 items, and refuses empty or 200-plus character text", () => {
    expect(() => w.addTodo(slug, "   ")).toThrow("in 1 to 200 characters");
    expect(() => w.addTodo(slug, "x".repeat(201))).toThrow("the most is 200");
    for (let i = 0; i < 100; i++) w.addTodo(slug, `Item ${i}`);
    expect(() => w.addTodo(slug, "One more")).toThrow("holds 100 items");
    expect(w.todos(slug)).toHaveLength(100);
  });
});

describe("prompt", () => {
  it("tells a woken bot what fired, and lists its open to-dos and watches", async () => {
    const t = await w.add(slug, { kind: "timer", in: 30, note: "Call back" });
    w.addTodo(slug, "Call the vet");
    w.addTodo(slug, "Old thing");
    w.setTodo(slug, w.todos(slug)[1]!.id, { done: true });
    const p = buildPrompt({
      slug,
      bot: store.readBot(slug)!.bot,
      memory: "",
      library: [],
      watches: w.list(slug),
      todos: w.todos(slug),
      others: [],
      team: null,
      trigger: "watch",
      text: "Call back — It is time.",
      from: null,
      now: new Date(2026, 10, 19, 9, 0),
    });
    expect(p).toMatch(/A watch you set fired, so Crew woke you/);
    expect(p).toMatch(/<watch>\nCall back — It is time\.\n<\/watch>/);
    expect(p).toMatch(new RegExp(`- ${t.id}  timer  Call back — 2026-11-19T09:30:00\\.000Z`));
    expect(p).toMatch(/Your open to-dos \(todo\):\n- [0-9a-f]{6}  Call the vet/);
    expect(p).not.toMatch(/Old thing/);
    expect(p).toMatch(/add a watch with the watch tool and end your turn; Crew wakes you when it fires/);
  });

  it("shows at most 20 open to-dos", () => {
    const todos = Array.from({ length: 25 }, (_, i) => ({ id: `t${i}`, text: `Task ${i}`, done: false }));
    const p = buildPrompt({ slug, bot: store.readBot(slug)!.bot, memory: "", library: [], todos, others: [], team: null, trigger: "person", text: "hi", from: null, now: new Date() });
    expect(p).toMatch(/- … and 6 more/);
    expect(p.split("\n").filter((l) => /^- t\d+  Task/.test(l))).toHaveLength(19);
  });
});

describe("notification watches keep their site open", () => {
  it("opens the site in a background tab when set, on start, and after the browser closes, and says whether it is listening", async () => {
    browsers.keepSite = vi.fn(async () => ({ opened: true }));
    let open = false;
    browsers.hasSite = vi.fn(() => open);
    const x = await w.add(slug, { kind: "notification", origin: "https://web.whatsapp.com", note: "Tell me what Amma says" });
    await flush();
    expect(browsers.keepSite).toHaveBeenCalledWith(slug, "https://web.whatsapp.com");
    expect(w.list(slug).find((y) => y.id === x.id)).toMatchObject({ listening: false });
    open = true;
    expect(w.list(slug).find((y) => y.id === x.id)).toMatchObject({ listening: true });
    w.rearm(slug);
    w.start();
    await flush();
    expect(browsers.keepSite).toHaveBeenCalledTimes(3);
  });

  it("leaves timer and page watches without a listening state", async () => {
    browsers.hasSite = vi.fn(() => false);
    await w.add(slug, { kind: "timer", in: 10, note: "Stretch" });
    expect(w.list(slug)[0]).not.toHaveProperty("listening");
  });
});
