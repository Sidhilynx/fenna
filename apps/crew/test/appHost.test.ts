import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createAppHost, parseKey, MAX_PER_BOT, IDLE_MS, CALL_MS, RESULT_MAX } = require("../src/main/appHost.cjs");

/** A hidden window in the test: its page is a fake that answers the page scripts the way a page would. */
const windows: FakeWindow[] = [];
let cdp: { method: string; params: Record<string, unknown> }[] = [];
let worlds = 0;
let loadFails: { code: number; desc: string } | null = null;

const SNAP = { title: "Notes board", url: "crewapp://ada/notes-board/index.html", text: 'heading "Notes board"\nbutton "Add note" [e1]', dropped: 0, above: 0, scrollY: 0, height: 100, view: 700 };

class FakeContents extends EventEmitter {
  opened = false;
  attached = false;
  debugger = {
    isAttached: () => this.attached,
    attach: () => {
      this.attached = true;
    },
    sendCommand: async (method: string, params: Record<string, unknown> = {}) => fakeCdp(method, params),
  };
  setWindowOpenHandler() {}
}

class FakeWindow {
  destroyed = false;
  webContents = new FakeContents();
  url = "";
  constructor(public opts: Record<string, any>) {
    windows.push(this);
  }
  async loadURL(url: string) {
    this.url = url;
    if (loadFails) {
      this.webContents.emit("did-fail-load", {}, loadFails.code, loadFails.desc, url, true);
      throw new Error(loadFails.desc);
    }
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
  }
}

function fakeCdp(method: string, params: Record<string, unknown>): unknown {
  cdp.push({ method, params });
  if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "F" } } };
  if (method === "Page.createIsolatedWorld") return { executionContextId: ++worlds };
  if (method === "Runtime.evaluate") {
    const expr = String(params.expression);
    const arg = JSON.parse(expr.slice(expr.lastIndexOf(")(") + 2, -1));
    if (expr.startsWith("(function pageSnapshot")) return { result: { value: SNAP } };
    if (expr.startsWith("(function pageTarget")) {
      if (arg === "e9") return { result: { value: { error: "stale" } } };
      if (arg === "e2") return { result: { value: { x: 40, y: 50, tag: "input", name: "Note", field: true, password: false, payment: false, select: false, disabled: false, covered: null } } };
      return { result: { value: { x: 10, y: 20, tag: "button", name: "Add note", field: false, password: false, payment: false, select: false, disabled: false, covered: null } } };
    }
    return { result: { value: {} } };
  }
  return {};
}

const app = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  title: name === "notes-board" ? "Notes board" : `Title ${name}`,
  icon: "sheet",
  entry: "index.html",
  description: "",
  permissions: { documents: "none", network: [], bot: false },
  tools: [{ name: "add_note", description: "Adds a note.", input: { type: "object" } }],
  ...extra,
});

const MANIFESTS: Record<string, { app: Record<string, unknown> | null; problems: string[] }> = {};
let grants: Record<string, object | null> = {};
let calls: { wc: unknown; name: string; input: unknown; opts: unknown }[] = [];
let callAnswer: (name: string, input: unknown) => unknown = () => ({ ok: true });

function fakeApps() {
  return {
    list: (slug: string) =>
      Object.keys(MANIFESTS)
        .filter((k) => k.startsWith(`${slug}/`))
        .map((k) => {
          const name = k.slice(slug.length + 1);
          const grant = grants[k] ?? null;
          return { name, title: MANIFESTS[k]!.app!.title, icon: "sheet", description: "", entry: "index.html", problems: MANIFESTS[k]!.problems, grant, pending: false, tools: (MANIFESTS[k]!.app!.tools as object[]) ?? [], updatedAt: "" };
        }),
    manifest: (slug: string, name: string) => MANIFESTS[`${slug}/${name}`] ?? { app: null, problems: [] },
    session: () => ({ fake: true }),
    preloadPath: "/app/app-preload.cjs",
    callTool: async (wc: unknown, name: string, input: unknown, opts: unknown) => {
      calls.push({ wc, name, input, opts });
      return callAnswer(name, input);
    },
    toolsOf: () => ["add_note"],
    grantOf: (slug: string, name: string) => grants[`${slug}/${name}`] ?? null,
  };
}

const sent: { channel: string; payload: unknown }[] = [];
const broadcast = (channel: string, payload: unknown) => sent.push({ channel, payload });

beforeEach(() => {
  vi.useFakeTimers();
  windows.length = 0;
  cdp = [];
  worlds = 0;
  loadFails = null;
  sent.length = 0;
  calls = [];
  callAnswer = () => ({ ok: true });
  grants = { "ada/notes-board": { documents: "none", network: [], bot: false } };
  for (const k of Object.keys(MANIFESTS)) delete MANIFESTS[k];
  MANIFESTS["ada/notes-board"] = { app: app("notes-board"), problems: [] };
});
afterEach(() => {
  vi.useRealTimers();
});

const make = () => createAppHost({ apps: fakeApps(), broadcast, BrowserWindow: FakeWindow });

/** Runs an action whose last step waits 150 ms on the fake clock, and returns its answer. */
async function settled<T>(p: Promise<T>): Promise<T> {
  const done = p.catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(1000);
  const out = await done;
  if (out instanceof Error) throw out;
  return out as T;
}

describe("opening an app", () => {
  it("starts it hidden, in its own session and sealed preload, at its entry page", async () => {
    const host = make();
    await host.open("ada", "notes-board");
    const w = windows[0]!;
    expect(w.url).toBe("crewapp://ada/notes-board/index.html");
    expect(w.opts.show).toBe(false);
    expect(w.opts.webPreferences).toMatchObject({ session: { fake: true }, preload: "/app/app-preload.cjs", sandbox: true, contextIsolation: true, nodeIntegration: false });
    expect(sent).toEqual([{ channel: "crew:appOpened", payload: { slug: "ada", name: "notes-board" } }]);
  });

  it("returns the manifest problems, the page's console warnings and errors, and a snapshot", async () => {
    MANIFESTS["ada/notes-board"] = { app: app("notes-board"), problems: ["tools[0].name is not a name"] };
    const host = make();
    const opening = host.open("ada", "notes-board");
    const w = windows[0]!;
    w.webContents.emit("console-message", { level: "info", message: "fine", lineNumber: 1, sourceId: "crewapp://ada/notes-board/app.js" });
    w.webContents.emit("console-message", { level: "warning", message: "slow", lineNumber: 2, sourceId: "crewapp://ada/notes-board/app.js" });
    w.webContents.emit("console-message", { level: "error", message: "Uncaught TypeError: x is undefined", lineNumber: 7, sourceId: "crewapp://ada/notes-board/app.js" });
    const r = await opening;
    expect(r.problems).toEqual(["tools[0].name is not a name"]);
    expect(r.errors).toEqual(["warning: slow (app.js:2)", "error: Uncaught TypeError: x is undefined (app.js:7)"]);
    expect(r.snapshot).toContain('button "Add note" [e1]');
    expect(r.granted).toBe(true);
  });

  it("reads the older console-message signature too (level as a number)", async () => {
    const host = make();
    const opening = host.open("ada", "notes-board");
    windows[0]!.webContents.emit("console-message", {}, 3, "boom", 4, "crewapp://ada/notes-board/index.html");
    const r = await opening;
    expect(r.errors).toEqual(["error: boom (index.html:4)"]);
  });

  it("collects a failed load and a crashed page as errors", async () => {
    loadFails = { code: -6, desc: "ERR_FILE_NOT_FOUND" };
    const host = make();
    const r = await host.open("ada", "notes-board");
    expect(r.errors[0]).toMatch(/did not load: ERR_FILE_NOT_FOUND/);
    windows[0]!.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    await expect(host.snapshot("ada", "notes-board")).rejects.toThrow(/page crashed \(crashed\)/);
  });

  it("opens an app with no grant, and says so", async () => {
    grants = {};
    const r = await make().handle({ slug: "ada" }, { action: "open", name: "notes-board" });
    expect(r.text).toMatch(/Its permissions are not allowed yet, so it runs with no documents, no network and no bot/);
    expect(r.text).toMatch(/install card/);
  });

  it("names the apps that exist when the name is not one", async () => {
    await expect(make().open("ada", "notes")).rejects.toThrow('No app named "notes". Apps: notes-board. Make one with write_file at Files/Apps/notes/app.json.');
  });

  it("refuses a name that is not an app name, before looking for it", async () => {
    await expect(make().open("ada", "Notes Board")).rejects.toThrow(/lowercase letters, digits and dashes/);
  });

  it("keeps at most three apps open per bot, and not for another bot", async () => {
    for (const n of ["one", "two", "three", "four"]) MANIFESTS[`ada/${n}`] = { app: app(n), problems: [] };
    MANIFESTS["bob/one"] = { app: app("one"), problems: [] };
    const host = make();
    for (const n of ["one", "two", "three"]) await host.open("ada", n);
    await expect(host.open("ada", "four")).rejects.toThrow(`${MAX_PER_BOT} apps are already open for this bot: one, two, three.`);
    await host.open("bob", "one");
    expect(windows.filter((w) => !w.destroyed)).toHaveLength(4);
  });
});

describe("driving an app", () => {
  it("snapshots, clicks by ref through CDP, and types into a field", async () => {
    const host = make();
    await host.open("ada", "notes-board");
    cdp = [];
    expect(await host.snapshot("ada", "notes-board")).toContain("Notes board");
    expect(await settled(host.click("ada", "notes-board", "e1"))).toMatch(/^Clicked button “Add note”\./);
    expect(cdp.filter((c) => c.method === "Input.dispatchMouseEvent").map((c) => c.params.type)).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
    expect(await settled(host.type("ada", "notes-board", "e2", "milk", true))).toMatch(/and pressed Enter/);
    expect(cdp.some((c) => c.method === "Input.insertText" && c.params.text === "milk")).toBe(true);
  });

  it("says how to fix a stale ref, and refuses an action on an app that is not open", async () => {
    const host = make();
    await expect(host.click("ada", "notes-board", "e1")).rejects.toThrow('notes-board is not open. Call app with action open first.');
    await host.open("ada", "notes-board");
    await expect(host.click("ada", "notes-board", "e9")).rejects.toThrow(/Ref e9 is not on the page any more/);
  });

  it("uses the one open app when no name is given, and says which when there are two", async () => {
    MANIFESTS["ada/two"] = { app: app("two"), problems: [] };
    const host = make();
    await host.handle({ slug: "ada" }, { action: "open", name: "notes-board" });
    expect(await host.handle({ slug: "ada" }, { action: "snapshot" })).toMatchObject({ text: expect.stringContaining("Notes board") });
    await host.handle({ slug: "ada" }, { action: "open", name: "two" });
    await expect(host.handle({ slug: "ada" }, { action: "snapshot" })).rejects.toThrow("Say which app: name. Open: notes-board, two.");
  });

  it("refuses a key it does not know, and names the keys it does", () => {
    expect(parseKey("Control+A")).toMatchObject({ key: "a", modifiers: 2 });
    expect(parseKey("Hyper+A").error).toMatch(/"Hyper" is not a modifier/);
    expect(parseKey("Banana").error).toMatch(/"Banana" is not a key press knows. Keys: Enter, Tab/);
  });

  it("refuses to type into a password field, and into a button", async () => {
    const host = make();
    await host.open("ada", "notes-board");
    await expect(host.type("ada", "notes-board", "e1", "x")).rejects.toThrow(/not a field you can type in/);
  });

  it("closes an app's window and forgets it", async () => {
    const host = make();
    await host.open("ada", "notes-board");
    expect(await host.handle({ slug: "ada" }, { action: "close", name: "notes-board" })).toEqual({ text: "Closed notes-board." });
    expect(windows[0]!.destroyed).toBe(true);
    await expect(host.snapshot("ada", "notes-board")).rejects.toThrow(/not open/);
  });
});

describe("closing by itself", () => {
  it("closes an app after ten minutes unused, and keeps it while it is used", async () => {
    const host = make();
    await host.open("ada", "notes-board");
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1000);
    await host.snapshot("ada", "notes-board");
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1000);
    expect(windows[0]!.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(windows[0]!.destroyed).toBe(true);
  });

  it("closes all of a bot's apps when the bot is deleted, and no other bot's", async () => {
    MANIFESTS["bob/notes-board"] = { app: app("notes-board"), problems: [] };
    const host = make();
    await host.open("ada", "notes-board");
    await host.open("bob", "notes-board");
    host.closeBot("ada");
    expect(windows[0]!.destroyed).toBe(true);
    expect(windows[1]!.destroyed).toBe(false);
  });
});

describe("the bot calling an app's tool", () => {
  it("opens the app if needed, and returns the result as JSON text", async () => {
    callAnswer = (name, input) => ({ name, input, rows: [1, 2] });
    const text = await make().callTool("ada", "notes-board", "add_note", { text: "milk" });
    expect(JSON.parse(text)).toEqual({ name: "add_note", input: { text: "milk" }, rows: [1, 2] });
    expect(windows).toHaveLength(1);
    expect(calls[0]!.opts).toEqual({ timeoutMs: CALL_MS });
  });

  it("names the tools the app has when the tool is not one of them", async () => {
    await expect(make().callTool("ada", "notes-board", "remove_all", {})).rejects.toThrow('notes-board has no tool "remove_all". Its tools: add_note.');
  });

  it("gives up after 10 seconds with a message the bot can act on", async () => {
    const host = make();
    await host.open("ada", "notes-board");
    callAnswer = () => new Promise(() => {});
    const p = host.callTool("ada", "notes-board", "add_note", {});
    const assertion = expect(p).rejects.toThrow(/did not answer within 10 seconds/);
    await vi.advanceTimersByTimeAsync(CALL_MS);
    await assertion;
  });

  it("returns an error the app's tool threw, and refuses a result over 64 KB", async () => {
    const host = make();
    callAnswer = () => {
      throw new Error("no such note");
    };
    await expect(host.callTool("ada", "notes-board", "add_note", {})).rejects.toThrow('notes-board\'s tool "add_note" failed: no such note');
    callAnswer = () => ({ big: "x".repeat(RESULT_MAX + 10) });
    await expect(host.callTool("ada", "notes-board", "add_note", {})).rejects.toThrow(/returned 65 KB; the limit is 64 KB/);
  });
});

describe("the app tool's text", () => {
  it("lists each app with its state, tools and problems", async () => {
    MANIFESTS["ada/tracker"] = { app: app("tracker"), problems: ["entry index.html is missing"] };
    grants = { "ada/notes-board": { documents: "none", network: [], bot: false } };
    const r = await make().handle({ slug: "ada" }, { action: "list" });
    expect(r.text).toBe(
      [
        "2 apps:",
        "- notes-board (Notes board): granted. Tools: add_note.",
        "- tracker (Title tracker): waiting for the person to allow its permissions (install card). Tools: add_note.",
        "  Problem: entry index.html is missing",
      ].join("\n"),
    );
  });

  it("says there are no apps yet, and how to make one", async () => {
    delete MANIFESTS["ada/notes-board"];
    const r = await make().handle({ slug: "ada" }, { action: "list" });
    expect(r.text).toMatch(/^No apps yet. Make one with write_file at Files\/Apps\/<name>\/app.json/);
  });

  it("opens with problems, errors and the snapshot in one short text", async () => {
    const r = await make().handle({ slug: "ada" }, { action: "open", name: "notes-board" });
    expect(r.text).toBe(`Opened Notes board (notes-board).\nProblems: none.\nErrors: none.\n\nPage: Notes board\n\nheading "Notes board"\nbutton "Add note" [e1]`);
  });

  it("refuses an action it does not know, and a click without a ref", async () => {
    const host = make();
    await expect(host.handle({ slug: "ada" }, { action: "fly" })).rejects.toThrow('Use the action list, open, snapshot, click, type, press or close, not "fly".');
    await host.handle({ slug: "ada" }, { action: "open", name: "notes-board" });
    await expect(host.handle({ slug: "ada" }, { action: "click" })).rejects.toThrow("click needs ref, like e12.");
    await expect(host.handle({ slug: "ada" }, { action: "press" })).rejects.toThrow("press needs key");
  });
});
