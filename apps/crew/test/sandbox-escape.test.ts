// The sandbox's escape tests. Each one tries a way out of a program's sealed
// window and proves it is closed, using the same fake Electron as sandbox.test.ts.
// What Electron itself enforces (renderer process rules, the network stack) is
// not run here; these tests prove what the code configures and what the page
// and the preload can see.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const sandbox = require("../src/main/sandbox.cjs");
const { createSandbox, createOutput, programPage, CSP, OUTPUT_MAX } = sandbox;

const SLUG = "research";
const OTHER = "someone-else";
const ROOTS: Record<string, string[]> = { Files: ["workspace"], Documents: ["library"], Downloads: ["workspace", "downloads"], Trash: ["trash"] };

/** A disk over a temp folder that knows one bot. Same contract as disk.cjs locate. */
function fakeDisk(base: string) {
  return {
    locate(slug: string, p: string) {
      if (slug !== SLUG) throw new Error(`There is no bot "${slug}".`);
      const segs = p.split("/");
      if (!ROOTS[segs[0]!]) throw new Error("That file is outside this bot's disk.");
      const rootAbs = path.join(base, ...ROOTS[segs[0]!]!);
      const abs = path.resolve(rootAbs, ...segs.slice(1));
      const rel = path.relative(rootAbs, abs);
      if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("That file is outside this bot's disk.");
      return { segs, root: segs[0], rest: segs.slice(1), base, abs, isRoot: abs === rootAbs };
    },
    free: () => 1e9,
  };
}

/** Fake Electron with the parts the sandbox touches, recording what it configures. */
function fakeElectron() {
  const windows: any[] = [];
  const sessions: any[] = [];
  const handlers = new Map<string, (event: any, msg: any) => any>();
  let nextId = 100;
  const ipcMain = {
    handle(channel: string, fn: any) {
      if (handlers.has(channel)) throw new Error("duplicate handler");
      handlers.set(channel, fn);
    },
    removeHandler(channel: string) {
      handlers.delete(channel);
    },
  };
  const session = {
    fromPartition(name: string, opts: object) {
      const s: any = {
        name,
        opts,
        cleared: 0,
        listeners: {} as Record<string, any>,
        webRequestListener: null as any,
        permissionRequest: null as any,
        permissionCheck: null as any,
        devicePermission: null as any,
        proxy: null as any,
        webRequest: {
          onBeforeRequest(fn: any) {
            s.webRequestListener = fn;
          },
        },
        setPermissionRequestHandler(fn: any) {
          s.permissionRequest = fn;
        },
        setPermissionCheckHandler(fn: any) {
          s.permissionCheck = fn;
        },
        setDevicePermissionHandler(fn: any) {
          s.devicePermission = fn;
        },
        on(ev: string, fn: any) {
          s.listeners[ev] = fn;
        },
        setProxy(opts: object) {
          s.proxy = opts;
          return Promise.resolve();
        },
        async clearStorageData() {
          s.cleared += 1;
        },
      };
      sessions.push(s);
      return s;
    },
  };
  class BrowserWindow {
    options: any;
    url: string | null = null;
    destroyed = false;
    wcHandlers: Record<string, (...a: any[]) => void> = {};
    openHandler: any = null;
    webContents: any;
    constructor(options: any) {
      this.options = options;
      const id = nextId++;
      this.webContents = {
        id,
        on: (ev: string, fn: any) => {
          this.wcHandlers[ev] = fn;
        },
        setWindowOpenHandler: (fn: any) => {
          this.openHandler = fn;
        },
      };
      windows.push(this);
    }
    loadURL(url: string) {
      this.url = url;
      return Promise.resolve();
    }
    on() {}
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return { BrowserWindow, session, ipcMain, windows, sessions, handlers };
}

function channelOf(win: any): string {
  const arg = win.options.webPreferences.additionalArguments.find((a: string) => a.startsWith("--fenna-channel="));
  return arg.slice("--fenna-channel=".length);
}
function pageCall(e: ReturnType<typeof fakeElectron>, win: any, msg: object, senderId = win.webContents.id) {
  const fn = e.handlers.get(channelOf(win));
  if (!fn) return { ok: false, error: "no handler" };
  return fn({ sender: { id: senderId } }, msg);
}

/** Runs the page's bootstrap and program in a bare context, with the given globals the browser would have. */
function runProgram(code: string, globals: Record<string, unknown> = {}) {
  const bridge: any = {
    args: [],
    cwd: "Files",
    readText: vi.fn(async () => "text"),
    writeText: vi.fn(async () => null),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => true),
    print: vi.fn(async () => null),
    exit: vi.fn(async () => null),
    done: vi.fn(async () => null),
  };
  const script = programPage(code).split("<script>")[1]!.split("</script>")[0]!;
  const context: any = { __fennaBridge: bridge, atob, TextDecoder, console: { log: () => {}, error: () => {} }, ...globals };
  vm.createContext(context);
  vm.runInContext(script, context);
  return { bridge };
}

const NETWORK_NAMES = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "RTCPeerConnection", "webkitRTCPeerConnection", "Worker", "SharedWorker"];

let base: string;
let disk: ReturnType<typeof fakeDisk>;

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), "sandbox-escape-"));
  for (const dir of ["workspace/notes", "workspace/downloads", "library/doc-1", "trash"]) mkdirSync(path.join(base, dir), { recursive: true });
  writeFileSync(path.join(base, "workspace", "notes", "a.txt"), "hello");
  writeFileSync(path.join(base, "trash", "old.txt"), "gone");
  disk = fakeDisk(base);
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("network: what the window may load", () => {
  let e: ReturnType<typeof fakeElectron>;
  let sb: { run: (slug: string, opts?: object) => Promise<{ out: string; ok: boolean }>; stopAll: () => void };
  beforeEach(() => {
    e = fakeElectron();
    sb = createSandbox({ disk, BrowserWindow: e.BrowserWindow, session: e.session, ipcMain: e.ipcMain, preloadPath: "/preload.cjs" }) as any;
  });
  afterEach(() => sb.stopAll());

  const decide = (listener: any, url: string) => {
    let cancel: boolean | undefined;
    listener({ url }, (r: { cancel: boolean }) => (cancel = r.cancel));
    return cancel;
  };

  it.each([
    "https://example.com/x.js",
    "http://127.0.0.1:8080/",
    "ws://example.com/socket",
    "wss://example.com/socket",
    "ftp://example.com/file",
    "file:///C:/Windows/win.ini",
    "blob:null/3f2a",
    "custom-scheme://host/x",
  ])("cancels %s, which fetch, XHR, WebSocket, EventSource, beacons and loads would use", (url) => {
    void sb.run(SLUG, { code: "1", cwd: "Files" });
    expect(decide(e.sessions[0].webRequestListener, url)).toBe(true);
  });

  it("lets only data: and about:blank through the request hook", () => {
    void sb.run(SLUG, { code: "1", cwd: "Files" });
    const listener = e.sessions[0].webRequestListener;
    expect(decide(listener, "data:text/html;base64,PGI+")).toBe(false);
    expect(decide(listener, "about:blank")).toBe(false);
  });

  it("sends the page a policy that allows scripts inline and nothing else, so no element or API may load a URL", () => {
    const directives = Object.fromEntries(
      CSP.split(";")
        .map((d: string) => d.trim().split(/\s+/))
        .map(([name, ...values]: string[]) => [name, values]),
    );
    expect(Object.keys(directives).sort()).toEqual(["default-src", "script-src"]);
    expect(directives["default-src"]).toEqual(["'none'"]);
    // connect-src (fetch, XHR, WebSocket, EventSource, sendBeacon), img-src, frame-src, worker-src,
    // font-src, media-src and style-src all fall back to default-src 'none'; script-src is the only door
    expect(directives["script-src"]).toEqual(["'unsafe-inline'", "'unsafe-eval'"]);
  });

  it("routes every window's session through a proxy that goes nowhere, for connections the request hook does not see", () => {
    void sb.run(SLUG, { code: "1", cwd: "Files" });
    expect(e.sessions[0].proxy).toEqual({ mode: "fixed_servers", proxyRules: "127.0.0.1:9" });
  });

  it("refuses a download, so a program cannot write a file to the person's own Downloads folder", () => {
    void sb.run(SLUG, { code: "1", cwd: "Files" });
    const prevent = vi.fn();
    e.sessions[0].listeners["will-download"]({ preventDefault: prevent });
    expect(prevent).toHaveBeenCalled();
  });

});

describe("the page's globals", () => {
  it.each(NETWORK_NAMES)("takes %s away from the program", async (name) => {
    const globals: Record<string, unknown> = { [name]: function () {} };
    const { bridge } = runProgram(`fenna.print(typeof ${name})`, globals);
    await vi.waitFor(() => expect(bridge.done).toHaveBeenCalled());
    expect(bridge.print).toHaveBeenCalledWith("undefined\n");
  });

  it("takes sendBeacon away from the program", async () => {
    const { bridge } = runProgram(`fenna.print(typeof navigator.sendBeacon)`, { navigator: Object.create({ sendBeacon: () => true }) });
    await vi.waitFor(() => expect(bridge.done).toHaveBeenCalled());
    expect(bridge.print).toHaveBeenCalledWith("undefined\n");
  });

  it("gives the program no Node or Electron names", async () => {
    const { bridge } = runProgram(`fenna.print([typeof require, typeof process, typeof module, typeof ipcRenderer, typeof electron, typeof Buffer].join(","))`);
    await vi.waitFor(() => expect(bridge.done).toHaveBeenCalled());
    expect(bridge.print).toHaveBeenCalledWith("undefined,undefined,undefined,undefined,undefined,undefined\n");
  });

  it("still runs the program's own code and the fenna API", async () => {
    const { bridge } = runProgram(`fenna.print("ok", 1 + 1)`);
    await vi.waitFor(() => expect(bridge.done).toHaveBeenCalled());
    expect(bridge.print).toHaveBeenCalledWith("ok 2\n");
    expect(bridge.done).toHaveBeenCalledWith(true, "");
  });
});

describe("the preload: the only door, and nothing else", () => {
  const preloadSrc = readFileSync(new URL("../src/main/sandbox-preload.cjs", import.meta.url), "utf8");

  /** Runs the preload as Electron would with its own argv, and records what it exposes and calls. */
  function loadPreload(channel: string, config: object, answer: object = { ok: true, value: null }) {
    const exposed: Record<string, any> = {};
    const invoked: Array<[string, any]> = [];
    const required: string[] = [];
    const electron = {
      contextBridge: {
        exposeInMainWorld(name: string, obj: unknown) {
          exposed[name] = obj;
        },
      },
      ipcRenderer: {
        invoke: async (ch: string, msg: any) => {
          invoked.push([ch, msg]);
          return answer;
        },
      },
    };
    const fakeRequire = (name: string) => {
      required.push(name);
      if (name !== "electron") throw new Error(`cannot require ${name}`);
      return electron;
    };
    const fakeProcess = {
      argv: ["electron", "preload.cjs", `--fenna-channel=${channel}`, `--fenna-config=${encodeURIComponent(JSON.stringify(config))}`],
    };
    const ctx = vm.createContext({ JSON, decodeURIComponent, Array, String });
    const wrapper = vm.runInContext(`(function (require, process) {\n${preloadSrc}\n})`, ctx);
    wrapper(fakeRequire, fakeProcess);
    return { exposed, invoked, required };
  }

  it("requires only electron, exposes one bridge and nothing else", () => {
    const { exposed, required } = loadPreload("sandbox:abc", { args: [], cwd: "Files" });
    expect(required).toEqual(["electron"]);
    expect(Object.keys(exposed)).toEqual(["__fennaBridge"]);
    expect(Object.keys(exposed.__fennaBridge).sort()).toEqual(["args", "cwd", "done", "exists", "exit", "list", "print", "readText", "writeText"]);
  });

  it("sends every call on the run's own channel and only as the documented op", async () => {
    const { exposed, invoked } = loadPreload("sandbox:abc", { args: [], cwd: "Files" });
    await exposed.__fennaBridge.readText("Files/a.txt");
    await exposed.__fennaBridge.done(true, "");
    expect(invoked).toEqual([
      ["sandbox:abc", { op: "readText", path: "Files/a.txt" }],
      ["sandbox:abc", { op: "done", ok: true, message: "" }],
    ]);
  });

  it("gives the bridge only plain values from the config, whatever the config holds", () => {
    const { exposed } = loadPreload("sandbox:abc", { args: ["one", 2], cwd: { evil: true } });
    expect(exposed.__fennaBridge.args).toEqual(["one", "2"]);
    expect(exposed.__fennaBridge.cwd).toBe("Files");
  });

  it("turns a refusal from the main process into an error with its message, and an empty answer into one too", async () => {
    const refused = loadPreload("sandbox:abc", {}, { ok: false, error: "A path can't use .. to leave the folder." }).exposed.__fennaBridge;
    await expect(refused.readText("../x")).rejects.toThrow("A path can't use .. to leave the folder.");
    const silent = loadPreload("sandbox:abc", {}, null as any).exposed.__fennaBridge;
    await expect(silent.exists("Files")).rejects.toThrow("The sandbox didn't answer.");
  });
});

describe("the window's own rules", () => {
  let e: ReturnType<typeof fakeElectron>;
  let sb: { run: (slug: string, opts?: object) => Promise<{ out: string; ok: boolean }>; stopAll: () => void };
  beforeEach(() => {
    e = fakeElectron();
    sb = createSandbox({ disk, BrowserWindow: e.BrowserWindow, session: e.session, ipcMain: e.ipcMain, preloadPath: "/preload.cjs" }) as any;
  });
  afterEach(() => sb.stopAll());

  it("denies every permission by request, check and device, whatever it asks for", () => {
    void sb.run(SLUG, { code: "1", cwd: "Files" });
    const s = e.sessions[0];
    for (const perm of ["media", "geolocation", "notifications", "midi", "clipboard-read", "display-capture"]) {
      let granted: boolean | undefined;
      s.permissionRequest(null, perm, (v: boolean) => (granted = v));
      expect(granted).toBe(false);
      expect(s.permissionCheck(null, perm)).toBe(false);
    }
    expect(s.devicePermission({ deviceType: "usb" })).toBe(false);
  });

  it("refuses new windows and any navigation of the program's window", () => {
    void sb.run(SLUG, { code: "1", cwd: "Files" });
    const [win] = e.windows;
    expect(win.openHandler({ url: "https://example.com" })).toEqual({ action: "deny" });
    const prevent = vi.fn();
    win.wcHandlers["will-navigate"]({ preventDefault: prevent }, "data:text/html,hi");
    expect(prevent).toHaveBeenCalled();
  });

  it("opens each program in its own in-memory session, cleared when it ends", async () => {
    const first = sb.run(SLUG, { code: "fenna.print(1)", cwd: "Files" });
    const second = sb.run(SLUG, { code: "fenna.print(2)", cwd: "Files" });
    expect(e.sessions[0].name).not.toBe(e.sessions[1].name);
    for (const s of e.sessions) {
      expect(s.name.startsWith("sandbox-")).toBe(true);
      expect(s.name.startsWith("persist:")).toBe(false);
      expect(s.opts).toEqual({ cache: false });
    }
    pageCall(e, e.windows[0], { op: "done", ok: true, message: "" });
    pageCall(e, e.windows[1], { op: "done", ok: true, message: "" });
    await Promise.all([first, second]);
    expect(e.sessions.map((s: any) => s.cleared)).toEqual([1, 1]);
  });

  it("refuses to run a program on another bot's disk, however the path is written", async () => {
    for (const file of ["../../" + OTHER + "/x.js", "/x.js", "Files/../../someone-else/x.js"]) {
      const r = await sb.run(OTHER, { file, cwd: "Files" });
      expect(r.ok).toBe(false);
    }
    expect(e.windows).toHaveLength(0);
  });

  it("refuses calls from a window that is not this run's", async () => {
    const p = sb.run(SLUG, { code: "1", cwd: "Files" });
    const [win] = e.windows;
    const forged = pageCall(e, win, { op: "readText", path: "Files/notes/a.txt" }, 999);
    expect(forged).toEqual({ ok: false, error: expect.stringMatching(/isn't from this program/) });
    pageCall(e, win, { op: "done", ok: true, message: "" });
    await p;
  });

  it("refuses an unknown call, and a call that tries to read a folder the disk does not grant", async () => {
    const p = sb.run(SLUG, { code: "1", cwd: "Files" });
    const [win] = e.windows;
    expect(pageCall(e, win, { op: "eval", code: "process.exit()" }).ok).toBe(false);
    expect(pageCall(e, win, { op: "readText", path: "Trash/old.txt" }).error).toMatch(/Trash/);
    expect(pageCall(e, win, { op: "list", path: "C:/" }).error).toMatch(/absolute/);
    pageCall(e, win, { op: "done", ok: true, message: "" });
    await p;
  });
});

describe("time, memory and output", () => {
  let e: ReturnType<typeof fakeElectron>;
  let sb: { run: (slug: string, opts?: object) => Promise<{ out: string; ok: boolean }>; stopAll: () => void };
  beforeEach(() => {
    e = fakeElectron();
    sb = createSandbox({ disk, BrowserWindow: e.BrowserWindow, session: e.session, ipcMain: e.ipcMain, preloadPath: "/preload.cjs" }) as any;
  });
  afterEach(() => sb.stopAll());

  it("kills a program at its time limit: the window goes, its calls stop, and the slot is free again", async () => {
    vi.useFakeTimers();
    const p = sb.run(SLUG, { code: "for (;;) {}", cwd: "Files", timeoutMs: 1000 });
    const [win] = e.windows;
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual({ out: "Stopped after 1 s.\n", ok: false });
    expect(win.destroyed).toBe(true);
    expect(pageCall(e, win, { op: "print", text: "after the stop" })).toEqual({ ok: false, error: "no handler" });
    // no timer is left behind to end a run that has already ended
    expect(vi.getTimerCount()).toBe(0);
    // the bot's slot is released: two more runs can start
    const again = [sb.run(SLUG, { code: "1", cwd: "Files" }), sb.run(SLUG, { code: "1", cwd: "Files" })];
    expect(e.windows).toHaveLength(3);
    sb.stopAll();
    await Promise.all(again);
  });

  it("stops a program that prints without end once it passes the output cap, and keeps what fits", async () => {
    const p = sb.run(SLUG, { code: "1", cwd: "Files" });
    const [win] = e.windows;
    expect(pageCall(e, win, { op: "print", text: "x".repeat(OUTPUT_MAX * 4) })).toEqual({ ok: true, value: null });
    const r = await p;
    expect(r.ok).toBe(false);
    expect(Buffer.byteLength(r.out)).toBeLessThanOrEqual(OUTPUT_MAX);
    expect(r.out).toContain("Output stopped at 256 KB.");
    expect(win.destroyed).toBe(true);
    expect(pageCall(e, win, { op: "print", text: "more" })).toEqual({ ok: false, error: "no handler" });
  });

  it("does not stop a program that prints within the cap", async () => {
    const p = sb.run(SLUG, { code: "1", cwd: "Files" });
    const [win] = e.windows;
    for (let i = 0; i < 100; i += 1) pageCall(e, win, { op: "print", text: "line\n" });
    pageCall(e, win, { op: "done", ok: true, message: "" });
    expect(await p).toEqual({ out: "line\n".repeat(100), ok: true });
  });

  it("reports the cut once the cap is passed, and never leaves a broken character behind", () => {
    const out = createOutput(10);
    out.add("aaaaaaaaé"); // 8 + 2 bytes: exactly the cap
    expect(out.cut).toBe(false);
    out.add("x");
    expect(out.cut).toBe(true);
    expect(out.text).not.toContain("\uFFFD");
  });

  it("reports the program's exit as not ok, however it ended", async () => {
    const p = sb.run(SLUG, { code: "1", cwd: "Files" });
    const [win] = e.windows;
    win.wcHandlers["render-process-gone"]({}, { reason: "oom" });
    expect(await p).toEqual({ out: "The program stopped unexpectedly.\n", ok: false });
  });
});

describe("what the window's output looks like to the person", () => {
  it("shows a program's output as text in the terminal, never as markup", () => {
    const src = readFileSync(new URL("../src/renderer/Terminal.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/dangerouslySetInnerHTML/);
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(src).not.toMatch(/href=\{e\.|src=\{e\.|href=\{.*\.out|src=\{.*\.out/);
    // the program's text is rendered as the children of the output and the command, which React escapes
    expect(src).toContain("{e.out}");
    expect(src).toContain("{e.line}");
  });

  it("keeps the terminal's history and completion as plain text, with markup and escape codes left as they are", async () => {
    const { historyLines, completeLast } = await import("../src/renderer/termModel.ts");
    const hostile = `<img src=x onerror=alert(1)>\u001b[31m`;
    const lines = historyLines([{ id: "1", at: "1", who: "person", cwd: "Files", line: hostile, out: "", ok: true }] as any);
    expect(lines).toEqual([hostile]);
    const done = completeLast("cat <b", [{ name: "<b>x", isDir: false }]);
    expect(done.line).toBe("cat <b>x ");
  });
});
