import { createRequire } from "node:module";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { rateLimiter, pushCapped, clipText, NOTIFY_PER_MINUTE, NOTICES_KEPT, NOTIFY_TEXT_CAP } = require("../src/main/browser.cjs");
const { NOTIFY_SOURCE, pageWatchTarget, pageWatchArm, pageWatchStop } = require("../src/main/page-scripts.cjs");

describe("rate limiter", () => {
  it("lets through the first N in a window, drops the rest, and recovers when the window passes", () => {
    let now = 0;
    const take = rateLimiter(NOTIFY_PER_MINUTE, 60_000, () => now);
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (take()) allowed++;
    expect(allowed).toBe(30);
    now = 59_999;
    expect(take()).toBe(false);
    now = 60_000;
    expect(take()).toBe(true);
  });
});

describe("capped lists", () => {
  it("puts the newest first and keeps only the last 50", () => {
    let list: number[] = [];
    for (let i = 1; i <= 120; i++) list = pushCapped(list, i, NOTICES_KEPT);
    expect(list).toHaveLength(NOTICES_KEPT);
    expect(list[0]).toBe(120);
    expect(list[NOTICES_KEPT - 1]).toBe(71);
  });

  it("does not change the list it was given", () => {
    const before = [1, 2];
    const after = pushCapped(before, 3, 10);
    expect(before).toEqual([1, 2]);
    expect(after).toEqual([3, 1, 2]);
  });

  it("clips text and treats what is not text as empty", () => {
    expect(clipText("x".repeat(500), NOTIFY_TEXT_CAP)).toHaveLength(NOTIFY_TEXT_CAP);
    expect(clipText(42, NOTIFY_TEXT_CAP)).toBe("");
    expect(clipText(undefined, NOTIFY_TEXT_CAP)).toBe("");
  });
});

/** Runs the notification page script in a bare context that stands in for a page. */
function pageWith(report: (s: string) => void, permissions?: { query: (d: { name: string }) => Promise<unknown> }) {
  const ctx: Record<string, unknown> = {
    EventTarget,
    navigator: { permissions },
    ServiceWorkerRegistration: function ServiceWorkerRegistration() {},
    __fennaCrewNotify: report,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(NOTIFY_SOURCE, ctx);
  return ctx as { Notification: any; ServiceWorkerRegistration: any; navigator: any };
}

describe("notification page script", () => {
  it("reports new Notification calls as JSON and shows nothing", () => {
    const reports: string[] = [];
    const page = pageWith((s) => reports.push(s));
    expect(page.Notification.permission).toBe("granted");
    const n = new page.Notification("New message", { body: "Hi there" });
    expect(n.title).toBe("New message");
    expect(typeof n.close).toBe("function");
    expect(typeof n.addEventListener).toBe("function");
    expect(JSON.parse(reports[0]!)).toEqual({ title: "New message", body: "Hi there" });
  });

  it("resolves permission requests as granted", async () => {
    const page = pageWith(() => {});
    await expect(page.Notification.requestPermission()).resolves.toBe("granted");
  });

  it("answers the notifications permission query as granted and leaves other queries alone", async () => {
    const query = vi.fn(async () => ({ state: "prompt" }));
    const page = pageWith(() => {}, { query });
    await expect(page.navigator.permissions.query({ name: "notifications" })).resolves.toMatchObject({ name: "notifications", state: "granted" });
    await expect(page.navigator.permissions.query({ name: "camera" })).resolves.toEqual({ state: "prompt" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("reports service worker notifications instead of showing them", async () => {
    const reports: string[] = [];
    const page = pageWith((s) => reports.push(s));
    await page.ServiceWorkerRegistration.prototype.showNotification.call({}, "Ship it", { body: "Done" });
    expect(JSON.parse(reports.at(-1)!)).toEqual({ title: "Ship it", body: "Done" });
  });
});

/** A minimal element for the watch functions: an id, text, and a parent. */
function fakeElement(id: string, text: string) {
  return { id, tagName: "DIV", innerText: text, isConnected: true, parentElement: null as unknown };
}

describe("element watch page functions", () => {
  it("finds an element with a unique id by its id", () => {
    const el = fakeElement("chat", "hello");
    const ctx: Record<string, unknown> = {
      __fennaCrew: { byRef: new Map([["e1", new WeakRef(el)]]) },
      document: { querySelectorAll: () => [el], querySelector: () => el },
      CSS: { escape: (s: string) => s },
      location: { origin: "https://example.test", href: "https://example.test/chat" },
    };
    vm.createContext(ctx);
    const target = vm.runInContext(`(${pageWatchTarget.toString()})`, ctx)("e1");
    expect(target).toEqual({ selector: "#chat", origin: "https://example.test", url: "https://example.test/chat", text: "hello" });
    expect(vm.runInContext(`(${pageWatchTarget.toString()})`, ctx)("e9")).toEqual({ error: "stale" });
  });

  it("reports only changed text, after the page is quiet, and stops when told", async () => {
    vi.useFakeTimers();
    try {
      let el = fakeElement("chat", "one");
      const observers: { cb: () => void; disconnected: boolean }[] = [];
      const sent: string[] = [];
      const ctx: Record<string, unknown> = {
        document: { querySelector: () => el },
        MutationObserver: class {
          cb: () => void;
          disconnected = false;
          constructor(cb: () => void) {
            this.cb = cb;
            observers.push(this);
          }
          observe() {}
          disconnect() {
            this.disconnected = true;
          }
        },
        __fennaCrewWatch: (s: string) => sent.push(s),
        setTimeout,
        clearTimeout,
      };
      vm.createContext(ctx);
      const arm = vm.runInContext(`(${pageWatchArm.toString()})`, ctx);
      const stop = vm.runInContext(`(${pageWatchStop.toString()})`, ctx);
      expect(arm({ id: "w1", selector: "#chat", debounce: 1500, cap: 4000 })).toEqual({ text: "one" });

      el.innerText = "two";
      observers[0]!.cb();
      observers[0]!.cb();
      vi.advanceTimersByTime(1000);
      expect(sent).toHaveLength(0);
      vi.advanceTimersByTime(600);
      expect(sent.map((s) => JSON.parse(s))).toEqual([{ id: "w1", text: "two" }]);

      observers[0]!.cb();
      vi.advanceTimersByTime(1500);
      expect(sent).toHaveLength(1);

      expect(stop("w1")).toBe(true);
      expect(observers[0]!.disconnected).toBe(true);
      expect(stop("w1")).toBe(false);
      el = null as unknown as typeof el;
      expect(arm({ id: "w3", selector: "#gone", debounce: 1500, cap: 4000 })).toEqual({ error: "missing" });
    } finally {
      vi.useRealTimers();
    }
  });
});
