import { describe, expect, it } from "vitest";
import { MIN_H, MIN_W, initialWindows, placementsKey, readPlacements, resizeRect, stackRank, windowsReducer, writePlacements, type Placement, type WindowAction, type WindowsState } from "../src/renderer/windows.ts";

const DESK = { width: 1000, height: 700 };
const run = (s: WindowsState, ...actions: WindowAction[]) => actions.reduce(windowsReducer, s);
const fresh = () => initialWindows({}, DESK);
const open = (app: string, extra: Partial<Extract<WindowAction, { type: "open" }>> = {}): WindowAction => ({
  type: "open",
  app,
  title: app,
  size: { w: 400, h: 300 },
  ...extra,
});
const byKey = (s: WindowsState, key: string) => s.windows.find((w) => w.key === key)!;

describe("opening windows", () => {
  it("opens a window in front, in taskbar order, with its default size", () => {
    const s = run(fresh(), open("files"), open("activity"));
    expect(s.windows.map((w) => w.app)).toEqual(["files", "activity"]);
    expect(s.focus).toBe(s.windows[1]!.id);
    expect(s.windows[0]).toMatchObject({ w: 400, h: 300, min: false, max: false });
  });

  it("focuses the window that is already open with the same key, instead of a second one", () => {
    const s = run(fresh(), open("files", { key: "files" }), open("activity"), open("files", { key: "files", title: "Files" }));
    expect(s.windows).toHaveLength(2);
    expect(s.focus).toBe(byKey(s, "files").id);
  });

  it("restores a minimized window when it is opened again", () => {
    const s0 = run(fresh(), open("files"), open("activity"));
    const files = s0.windows[0]!.id;
    const s = run(s0, { type: "minimize", id: files }, open("files"));
    expect(byKey(s, "files").min).toBe(false);
    expect(s.focus).toBe(files);
  });

  it("opens a second window for a different key of the same app", () => {
    const s = run(fresh(), open("editor", { key: "editor:a.md" }), open("editor", { key: "editor:b.md" }));
    expect(s.windows.map((w) => w.key)).toEqual(["editor:a.md", "editor:b.md"]);
  });

  it("opens new windows near the middle of the desktop, each 32px down and right of the last", () => {
    const s = run(fresh(), open("a"), open("b"), open("c"));
    expect(s.windows.map((w) => [w.x, w.y])).toEqual([
      [244, 77],
      [276, 109],
      [308, 141],
    ]);
  });

  it("opens maximized when the app says so, filling the desktop", () => {
    const s = run(fresh(), open("browser", { key: "browser", size: { w: 900, h: 600, max: true } }));
    expect(byKey(s, "browser")).toMatchObject({ x: 0, y: 0, w: DESK.width, h: DESK.height, max: true });
  });

  it("keeps a window inside the desktop when its default size is bigger than the desktop", () => {
    const s = run({ ...fresh(), desk: { width: 500, height: 300 } }, open("big", { size: { w: 900, h: 900 } }));
    expect(s.windows[0]).toMatchObject({ x: 0, y: 0, w: 500, h: 300 });
  });
});

describe("focus and stacking", () => {
  it("raises a window to the front when it is focused", () => {
    const s0 = run(fresh(), open("a"), open("b"));
    const a = s0.windows[0]!.id;
    const s = run(s0, { type: "focus", id: a });
    expect(s.focus).toBe(a);
    expect(stackRank(s.windows).get(a)).toBe(1);
  });

  it("does nothing when the focused window is focused again", () => {
    const s0 = run(fresh(), open("a"));
    expect(windowsReducer(s0, { type: "focus", id: s0.windows[0]!.id })).toBe(s0);
  });

  it("ignores focus on a minimized window and on an unknown id", () => {
    const s0 = run(fresh(), open("a"), open("b"));
    const a = s0.windows[0]!.id;
    const s1 = run(s0, { type: "minimize", id: a });
    expect(windowsReducer(s1, { type: "focus", id: a })).toBe(s1);
    expect(windowsReducer(s0, { type: "focus", id: "nope" })).toBe(s0);
  });
});

describe("minimize, restore and close", () => {
  it("hands focus to the front-most visible window when the focused one is minimized", () => {
    const s0 = run(fresh(), open("a"), open("b"), open("c"));
    const [a, b, c] = s0.windows.map((w) => w.id);
    const s1 = run(s0, { type: "focus", id: b! });
    expect(s1.focus).toBe(b);
    const s2 = run(s1, { type: "minimize", id: b! });
    expect(s2.focus).toBe(c);
    const s3 = run(s2, { type: "minimize", id: c! });
    expect(s3.focus).toBe(a);
  });

  it("restores a minimized window to the front", () => {
    const s0 = run(fresh(), open("a"), open("b"));
    const a = s0.windows[0]!.id;
    const s = run(s0, { type: "minimize", id: a }, { type: "restore", id: a });
    expect(s.windows[0]).toMatchObject({ min: false });
    expect(s.focus).toBe(a);
  });

  it("removes a closed window and its saved bounds, and moves focus on", () => {
    const s0 = run(fresh(), open("browser", { key: "browser", size: { w: 400, h: 300, max: true } }), open("files"));
    const [browser, files] = s0.windows.map((w) => w.id);
    const s = run(s0, { type: "close", id: files! });
    expect(s.windows.map((w) => w.id)).toEqual([browser]);
    expect(s.focus).toBe(browser);
    expect(s.saved[browser!]).toBeDefined();
    expect(windowsReducer(s, { type: "close", id: files! })).toBe(s);
  });

  it("leaves focus empty when the last window closes", () => {
    const s = run(fresh(), open("a"), { type: "close", id: "w1" });
    expect(s.windows).toEqual([]);
    expect(s.focus).toBeNull();
  });
});

describe("moving and resizing", () => {
  it("moves a window and keeps its title bar reachable at both edges", () => {
    const s0 = run(fresh(), open("a"));
    const id = s0.windows[0]!.id;
    const w = s0.windows[0]!.w;
    expect(run(s0, { type: "move", id, x: 300, y: 200 }).windows[0]).toMatchObject({ x: 300, y: 200 });
    expect(run(s0, { type: "move", id, x: -5000, y: 0 }).windows[0]!.x).toBe(96 - w);
    expect(run(s0, { type: "move", id, x: 5000, y: 0 }).windows[0]!.x).toBe(DESK.width - 96);
    expect(run(s0, { type: "move", id, x: 0, y: -50 }).windows[0]!.y).toBe(0);
    expect(run(s0, { type: "move", id, x: 0, y: 5000 }).windows[0]!.y).toBe(DESK.height - 40);
  });

  it("does not move a maximized or minimized window", () => {
    const s0 = run(fresh(), open("browser", { key: "browser", size: { w: 400, h: 300, max: true } }));
    const id = s0.windows[0]!.id;
    expect(windowsReducer(s0, { type: "move", id, x: 50, y: 50 })).toBe(s0);
    const s1 = run(s0, { type: "unmaximize", id }, { type: "minimize", id });
    expect(windowsReducer(s1, { type: "move", id, x: 50, y: 50 })).toBe(s1);
  });

  it("resizes but never below the minimum, and keeps the window inside the desktop", () => {
    const s0 = run(fresh(), open("a", { size: { w: 400, h: 300 } }));
    const id = s0.windows[0]!.id;
    const small = run(s0, { type: "resize", id, rect: { x: 0, y: 0, w: 10, h: 10 } }).windows[0]!;
    expect(small).toMatchObject({ w: MIN_W, h: MIN_H });
    const huge = run(s0, { type: "resize", id, rect: { x: 900, y: 600, w: 900, h: 900 } }).windows[0]!;
    expect(huge.x + huge.w).toBeLessThanOrEqual(DESK.width);
    expect(huge.y + huge.h).toBeLessThanOrEqual(DESK.height);
  });

  it("resizes from the left edge with the right edge fixed, and stops at the minimum width", () => {
    const start = { x: 200, y: 100, w: 400, h: 300 };
    expect(resizeRect(start, "w", -100, 0, DESK)).toEqual({ x: 100, y: 100, w: 500, h: 300 });
    expect(resizeRect(start, "w", 300, 0, DESK)).toEqual({ x: 200 + 400 - MIN_W, y: 100, w: MIN_W, h: 300 });
  });

  it("resizes a corner from the top-left and never leaves the desktop", () => {
    const start = { x: 200, y: 100, w: 400, h: 300 };
    expect(resizeRect(start, "nw", -500, -500, DESK)).toEqual({ x: 0, y: 0, w: 600, h: 400 });
    expect(resizeRect(start, "se", 5000, 5000, DESK)).toEqual({ x: 200, y: 100, w: DESK.width - 200, h: DESK.height - 100 });
    expect(resizeRect(start, "s", 0, -1000, DESK).h).toBe(MIN_H);
  });

  it("does not resize a maximized window", () => {
    const s0 = run(fresh(), open("browser", { key: "browser", size: { w: 400, h: 300, max: true } }));
    const id = s0.windows[0]!.id;
    expect(windowsReducer(s0, { type: "resize", id, rect: { x: 0, y: 0, w: 500, h: 400 } })).toBe(s0);
  });
});

describe("maximize", () => {
  it("fills the desktop, and unmaximize goes back to where the window was", () => {
    const s0 = run(fresh(), open("a"), open("b"));
    const a = s0.windows[0]!.id;
    const s0a = run(s0, { type: "move", id: a, x: 120, y: 80 });
    const before = s0a.windows[0]!;
    const s1 = run(s0a, { type: "maximize", id: a });
    expect(s1.windows[0]).toMatchObject({ x: 0, y: 0, w: DESK.width, h: DESK.height, max: true });
    expect(s1.focus).toBe(a);
    const s2 = run(s1, { type: "unmaximize", id: a });
    expect(s2.windows[0]).toMatchObject({ x: before.x, y: before.y, w: before.w, h: before.h, max: false });
    expect(s2.saved[a]).toBeUndefined();
  });

  it("is a no-op when already maximized or not maximized", () => {
    const s0 = run(fresh(), open("a"));
    const a = s0.windows[0]!.id;
    expect(windowsReducer(s0, { type: "unmaximize", id: a })).toBe(s0);
    const s1 = run(s0, { type: "maximize", id: a });
    expect(windowsReducer(s1, { type: "maximize", id: a })).toBe(s1);
  });

  it("follows the desktop when it changes size", () => {
    const s0 = run(fresh(), open("browser", { key: "browser", size: { w: 400, h: 300, max: true } }));
    const s1 = run(s0, { type: "desk", size: { width: 800, height: 500 } });
    expect(s1.windows[0]).toMatchObject({ w: 800, h: 500, max: true });
  });
});

describe("desktop size, titles and taskbar order", () => {
  it("keeps every window inside a smaller desktop", () => {
    const s0 = run(fresh(), open("a", { size: { w: 600, h: 500 } }));
    const s1 = run(s0, { type: "move", id: s0.windows[0]!.id, x: 500, y: 400 }, { type: "desk", size: { width: 700, height: 500 } });
    const w = s1.windows[0]!;
    expect(w.x + w.w).toBeLessThanOrEqual(700);
    expect(w.y + w.h).toBeLessThanOrEqual(500);
  });

  it("ignores a desktop of the same size", () => {
    const s0 = fresh();
    expect(windowsReducer(s0, { type: "desk", size: { ...DESK } })).toBe(s0);
  });

  it("reorders the taskbar, clamping the target index", () => {
    const s0 = run(fresh(), open("a"), open("b"), open("c"));
    const [a, b, c] = s0.windows.map((w) => w.id);
    expect(run(s0, { type: "reorder", id: c!, to: 0 }).windows.map((w) => w.id)).toEqual([c, a, b]);
    expect(run(s0, { type: "reorder", id: a!, to: 99 }).windows.map((w) => w.id)).toEqual([b, c, a]);
    expect(windowsReducer(s0, { type: "reorder", id: b!, to: 1 })).toBe(s0);
  });

  it("retitles a window", () => {
    const s0 = run(fresh(), open("editor", { key: "editor:a.md", title: "Old" }));
    const id = s0.windows[0]!.id;
    expect(run(s0, { type: "retitle", id, title: "New" }).windows[0]!.title).toBe("New");
    expect(windowsReducer(s0, { type: "retitle", id, title: "Old" })).toBe(s0);
  });
});

describe("remembered placements", () => {
  it("opens a window where it was last left, by key, even after it was closed", () => {
    const s0 = run(fresh(), open("files", { key: "files" }), { type: "move", id: "w1", x: 300, y: 150 }, { type: "resize", id: "w1", rect: { x: 300, y: 150, w: 500, h: 400 } });
    expect(s0.placements.files).toEqual({ x: 300, y: 150, w: 500, h: 400, max: false });
    const s1 = run(s0, { type: "close", id: "w1" }, open("files", { key: "files" }));
    expect(s1.windows[0]).toMatchObject({ x: 300, y: 150, w: 500, h: 400, max: false });
  });

  it("opens a window maximized when it was last maximized, and restores its normal place", () => {
    const s0 = run(fresh(), open("browser", { key: "browser", size: { w: 400, h: 300 } }), { type: "move", id: "w1", x: 100, y: 100 }, { type: "maximize", id: "w1" });
    expect(s0.placements.browser).toMatchObject({ x: 100, y: 100, w: 400, h: 300, max: true });
    const s1 = run(s0, { type: "close", id: "w1" }, open("browser", { key: "browser", size: { w: 400, h: 300 } }));
    expect(s1.windows[0]).toMatchObject({ max: true, w: DESK.width });
    const s2 = run(s1, { type: "unmaximize", id: s1.windows[0]!.id });
    expect(s2.windows[0]).toMatchObject({ x: 100, y: 100, w: 400, h: 300 });
  });

  it("fits a remembered place into a smaller desktop", () => {
    const placed: Placement = { x: 800, y: 600, w: 500, h: 400, max: false };
    const s = run(initialWindows({ files: placed }, { width: 600, height: 400 }), open("files", { key: "files" }));
    expect(s.windows[0]!.x + s.windows[0]!.w).toBeLessThanOrEqual(600);
    expect(s.windows[0]!.y + s.windows[0]!.h).toBeLessThanOrEqual(400);
  });
});

describe("saving placements per bot", () => {
  function fakeStore(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  }

  it("writes under fenna:windows:<slug> and reads the same placements back", () => {
    const store = fakeStore();
    const placed: Record<string, Placement> = { files: { x: 10, y: 20, w: 400, h: 300, max: false } };
    writePlacements("inbox", placed, store);
    expect(store.data.has("fenna:windows:inbox")).toBe(true);
    expect(placementsKey("inbox")).toBe("fenna:windows:inbox");
    expect(readPlacements("inbox", store)).toEqual(placed);
    expect(readPlacements("other", store)).toEqual({});
  });

  it("drops entries that are not placements and reads nothing from broken text", () => {
    const store = fakeStore({
      "fenna:windows:inbox": JSON.stringify({ good: { x: 1, y: 2, w: 3, h: 4, max: true }, bad: { x: "1" }, nope: 5 }),
    });
    expect(readPlacements("inbox", store)).toEqual({ good: { x: 1, y: 2, w: 3, h: 4, max: true } });
    expect(readPlacements("inbox", fakeStore({ "fenna:windows:inbox": "{ not json" }))).toEqual({});
    expect(readPlacements("inbox", fakeStore({ "fenna:windows:inbox": "[1,2]" }))).toEqual({});
  });

  it("does not throw when the browser refuses storage", () => {
    const refusing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(readPlacements("inbox", refusing)).toEqual({});
    expect(() => writePlacements("inbox", {}, refusing)).not.toThrow();
    expect(() => readPlacements("inbox", null)).not.toThrow();
  });
});
