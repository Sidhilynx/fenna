import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const sandbox = require("../src/main/sandbox.cjs");
const { createSandbox, createRun, createOutput, planRun, resolveDiskPath, programPage, OUTPUT_MAX, PROGRAM_MAX, TRANSFER_MAX, PER_BOT, TOTAL, CSP } = sandbox;

const SLUG = "research";
const MB = 1024 * 1024;
const OUTSIDE = "That file is outside this bot's disk.";
const ROOTS: Record<string, string[]> = {
  Files: ["workspace"],
  Documents: ["library"],
  Downloads: ["workspace", "downloads"],
  Trash: ["trash"],
};

/** A disk over a temp folder: the same contract as disk.cjs locate, without its store. */
function fakeDisk(base: string) {
  const state = { free: 1e9 };
  return {
    state,
    locate(slug: string, p: string) {
      if (slug !== SLUG) throw new Error(`There is no bot "${slug}".`);
      const segs = p.split("/");
      const root = segs[0];
      if (!ROOTS[root]) throw new Error(OUTSIDE);
      const rootAbs = path.join(base, ...ROOTS[root]);
      const abs = path.resolve(rootAbs, ...segs.slice(1));
      const rel = path.relative(rootAbs, abs);
      if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(OUTSIDE);
      return { segs, root, rest: segs.slice(1), base, abs, isRoot: abs === rootAbs };
    },
    free: () => state.free,
  };
}

/** Fake Electron: sessions, windows and ipcMain that record what the sandbox does. */
function fakeElectron() {
  const windows: any[] = [];
  const sessions: any[] = [];
  const handlers = new Map<string, (event: any, msg: any) => any>();
  let nextId = 100;
  const ipcMain = {
    handle(channel: string, fn: (event: any, msg: any) => any) {
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
        webRequestListener: null as any,
        permissionRequest: null as any,
        permissionCheck: null as any,
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
    handlers: Record<string, (...a: any[]) => void> = {};
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
    on(ev: string, fn: any) {
      this.handlers[ev] = fn;
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return { BrowserWindow, session, ipcMain, windows, sessions, handlers };
}

/** The page's side of a run: calls the channel as the window's own webContents. */
function channelOf(win: any): string {
  const arg = win.options.webPreferences.additionalArguments.find((a: string) => a.startsWith("--fenna-channel="));
  return arg.slice("--fenna-channel=".length);
}
function pageCall(e: ReturnType<typeof fakeElectron>, win: any, msg: object, senderId = win.webContents.id) {
  const fn = e.handlers.get(channelOf(win));
  if (!fn) return { ok: false, error: "no handler" };
  return fn({ sender: { id: senderId } }, msg);
}
/** The HTML a run loaded, decoded. */
function pageOf(win: any): string {
  const b64 = win.url.split("base64,")[1];
  return Buffer.from(b64, "base64").toString("utf8");
}

let base: string;
let disk: ReturnType<typeof fakeDisk>;

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), "sandbox-test-"));
  for (const dir of ["workspace/notes", "workspace/downloads", "library/doc-1", "trash"]) mkdirSync(path.join(base, dir), { recursive: true });
  writeFileSync(path.join(base, "workspace", "notes", "a.txt"), "hello");
  writeFileSync(path.join(base, "workspace", ".hidden"), "x");
  writeFileSync(path.join(base, "trash", "old.txt"), "gone");
  writeFileSync(path.join(base, "library", "doc-1", "doc.json"), "{}");
  disk = fakeDisk(base);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("disk paths", () => {
  it("resolves relative paths against the working folder and root-prefixed paths as they are", () => {
    const cwd = ["Files", "notes"];
    expect(resolveDiskPath("a.txt", cwd)).toBe("Files/notes/a.txt");
    expect(resolveDiskPath("./sub/b.txt", cwd)).toBe("Files/notes/sub/b.txt");
    expect(resolveDiskPath("Documents/doc-1/doc.json", cwd)).toBe("Documents/doc-1/doc.json");
    expect(resolveDiskPath(".", cwd)).toBe("Files/notes");
  });

  it.each([
    ["../x.txt", "parent"],
    ["Files/../../x.txt", "parent"],
    ["a/../../b", "parent"],
    ["/etc/passwd", "absolute"],
    ["\\\\server\\share", "absolute"],
    ["C:/Windows/x", "absolute"],
    ["Files\\x", "absolute"],
    ["", "path"],
    ["   ", "path"],
  ])("refuses %s", (input) => {
    expect(() => resolveDiskPath(input, ["Files"])).toThrow();
  });

  it("refuses a working folder that is not under a root", () => {
    expect(() => planRun(disk, SLUG, { code: "1", cwd: "notes" })).toThrow(/working folder/);
    expect(() => planRun(disk, SLUG, { code: "1", cwd: "../Files" })).toThrow(/\.\./);
  });
});

describe("the program's file access", () => {
  function run(cwd = "Files") {
    return createRun({ disk, slug: SLUG, cwd, args: [] });
  }

  it("reads text from Files, Documents and Downloads, relative to the working folder", () => {
    const r = run("Files/notes");
    expect(r.dispatch({ op: "readText", path: "a.txt" })).toBe("hello");
    expect(run().dispatch({ op: "readText", path: "Files/notes/a.txt" })).toBe("hello");
    expect(run().dispatch({ op: "readText", path: "Documents/doc-1/doc.json" })).toBe("{}");
  });

  it("refuses to read Trash, through list and exists too", () => {
    const r = run();
    expect(() => r.dispatch({ op: "readText", path: "Trash/old.txt" })).toThrow(/Trash/);
    expect(() => r.dispatch({ op: "list", path: "Trash" })).toThrow(/Trash/);
    expect(() => r.dispatch({ op: "exists", path: "Trash/old.txt" })).toThrow(/Trash/);
  });

  it("refuses paths that leave the disk", () => {
    const r = run("Files/notes");
    expect(() => r.dispatch({ op: "readText", path: "../../secret.txt" })).toThrow(/\.\./);
    expect(() => r.dispatch({ op: "readText", path: "/etc/passwd" })).toThrow(/absolute/);
    expect(() => r.dispatch({ op: "list", path: "Files/../.." })).toThrow(/\.\./);
  });

  it("writes text under Files and Downloads, creating folders on the way", () => {
    const r = run();
    expect(r.dispatch({ op: "writeText", path: "Files/new/deep/out.txt", text: "hi" })).toBeNull();
    expect(readFileSync(path.join(base, "workspace", "new", "deep", "out.txt"), "utf8")).toBe("hi");
    r.dispatch({ op: "writeText", path: "Downloads/save.txt", text: "dl" });
    expect(readFileSync(path.join(base, "workspace", "downloads", "save.txt"), "utf8")).toBe("dl");
  });

  it("refuses writes to Documents, Trash and the roots themselves", () => {
    const r = run();
    expect(() => r.dispatch({ op: "writeText", path: "Documents/doc-1/doc.json", text: "{}" })).toThrow(/Files\/ or Downloads\//);
    expect(() => r.dispatch({ op: "writeText", path: "Trash/x.txt", text: "x" })).toThrow(/Files\/ or Downloads\//);
    expect(() => r.dispatch({ op: "writeText", path: "Files", text: "x" })).toThrow(/Files\/ or Downloads\//);
    expect(() => r.dispatch({ op: "writeText", path: "Downloads", text: "x" })).toThrow(/Files\/ or Downloads\//);
    expect(existsSync(path.join(base, "library", "doc-1", "doc.json"))).toBe(true);
    expect(readFileSync(path.join(base, "library", "doc-1", "doc.json"), "utf8")).toBe("{}");
  });

  it("refuses a write over the 10 MB a call may carry", () => {
    const big = "a".repeat(TRANSFER_MAX + 1);
    expect(() => run().dispatch({ op: "writeText", path: "Files/big.txt", text: big })).toThrow(/10 MB/);
    expect(existsSync(path.join(base, "workspace", "big.txt"))).toBe(false);
  });

  it("refuses a write that does not fit the bot's free space, and counts what an overwrite frees", () => {
    const r = run();
    disk.state.free = 3;
    expect(() => r.dispatch({ op: "writeText", path: "Files/x.txt", text: "1234" })).toThrow(/isn't room/);
    // a.txt holds 5 bytes; overwriting it with 7 bytes needs 2 more than the 0 bytes free
    disk.state.free = 0;
    expect(() => r.dispatch({ op: "writeText", path: "Files/notes/a.txt", text: "1234567" })).toThrow(/isn't room/);
    expect(r.dispatch({ op: "writeText", path: "Files/notes/a.txt", text: "12345" })).toBeNull();
  });

  it("refuses to write over a folder", () => {
    expect(() => run().dispatch({ op: "writeText", path: "Files/notes", text: "x" })).toThrow(/folder/);
  });

  it("lists a folder with folders and files, sorted, without hidden names", () => {
    const entries = run().dispatch({ op: "list", path: "Files" });
    expect(entries).toEqual([{ name: "downloads", kind: "folder" }, { name: "notes", kind: "folder" }]);
    expect(run().dispatch({ op: "list", path: "Files/notes" })).toEqual([{ name: "a.txt", kind: "file" }]);
    expect(run("Files/notes").dispatch({ op: "list", path: undefined })).toEqual([{ name: "a.txt", kind: "file" }]);
    expect(() => run().dispatch({ op: "list", path: "Files/notes/a.txt" })).toThrow(/not a folder/);
    expect(() => run().dispatch({ op: "list", path: "Files/missing" })).toThrow(/no folder/);
  });

  it("answers exists and reports a missing file as an error on read", () => {
    const r = run();
    expect(r.dispatch({ op: "exists", path: "Files/notes/a.txt" })).toBe(true);
    expect(r.dispatch({ op: "exists", path: "Files/notes/none.txt" })).toBe(false);
    expect(() => r.dispatch({ op: "readText", path: "Files/notes/none.txt" })).toThrow(/no file/);
  });

  it("keeps the disk's real path out of file system errors", () => {
    // a file where a folder should be makes mkdir fail with a code
    writeFileSync(path.join(base, "workspace", "blocker"), "x");
    expect(() => run().dispatch({ op: "writeText", path: "Files/blocker/x.txt", text: "x" })).toThrow(/^The disk couldn't do that/);
  });
});

describe("output", () => {
  it("keeps output to the cap and says once that it stopped", () => {
    const out = createOutput();
    const line = "x".repeat(1000) + "\n";
    for (let i = 0; i < 400; i += 1) out.add(line);
    expect(Buffer.byteLength(out.text)).toBeLessThanOrEqual(OUTPUT_MAX);
    expect(out.text.match(/Output stopped at 256 KB/g)).toHaveLength(1);
    const before = out.text.length;
    out.add("more\n");
    expect(out.text.length).toBe(before);
  });

  it("cuts multi-byte text without leaving a broken character", () => {
    const out = createOutput(10);
    out.add("aaaaaaaaaé");
    expect(out.text.startsWith("aaaaaaaaa")).toBe(true);
    expect(out.text).not.toContain("\uFFFD");
  });

  it("prints through the API and ends with the exit code", async () => {
    const finished: any[] = [];
    const r = createRun({ disk, slug: SLUG, cwd: "Files", args: [], onFinish: (x: any) => finished.push(x) });
    r.dispatch({ op: "print", text: "hi\n" });
    r.dispatch({ op: "exit", code: 3 });
    expect(finished).toEqual([{ out: "hi\nExited with code 3.\n", ok: false }]);
  });
});

describe("after a run ends", () => {
  it("refuses every call once the program has exited", () => {
    const finished: any[] = [];
    const r = createRun({ disk, slug: SLUG, cwd: "Files", args: [], onFinish: (x: any) => finished.push(x) });
    r.dispatch({ op: "print", text: "a" });
    r.dispatch({ op: "exit", code: 0 });
    expect(finished).toHaveLength(1);
    expect(finished[0]).toEqual({ out: "a", ok: true });
    expect(() => r.dispatch({ op: "print", text: "late" })).toThrow(/already finished/);
    expect(() => r.dispatch({ op: "readText", path: "Files/notes/a.txt" })).toThrow(/already finished/);
    expect(() => r.dispatch({ op: "writeText", path: "Files/x", text: "x" })).toThrow(/already finished/);
    expect(finished).toHaveLength(1);
  });

  it("finishes only once", () => {
    const finished: any[] = [];
    const r = createRun({ disk, slug: SLUG, cwd: "Files", args: [], onFinish: (x: any) => finished.push(x) });
    expect(r.finish(false, "Stopped.")).toBe(true);
    expect(r.finish(true, "")).toBe(false);
    expect(finished).toEqual([{ out: "Stopped.\n", ok: false }]);
  });

  it("refuses unknown calls and says what the call was", () => {
    const r = createRun({ disk, slug: SLUG, cwd: "Files", args: [] });
    expect(() => r.dispatch({ op: "shell", cmd: "rm" })).toThrow(/no call called "shell"/);
    expect(() => r.dispatch(null)).toThrow(/no call called/);
  });
});

describe("planning a run", () => {
  it("reads the program from a disk file, relative to the working folder", () => {
    writeFileSync(path.join(base, "workspace", "notes", "prog.js"), "fenna.print(1)");
    const plan = planRun(disk, SLUG, { file: "prog.js", cwd: "Files/notes" });
    expect(plan.code).toBe("fenna.print(1)");
    expect(plan.cwd).toBe("Files/notes");
    expect(plan.timeoutMs).toBe(20_000);
  });

  it("refuses a program from Trash, a missing program, and a program over 1 MB", () => {
    expect(() => planRun(disk, SLUG, { file: "Trash/old.txt", cwd: "Files" })).toThrow(/Trash/);
    expect(() => planRun(disk, SLUG, { file: "missing.js", cwd: "Files" })).toThrow(/no program file/);
    writeFileSync(path.join(base, "workspace", "big.js"), "a".repeat(PROGRAM_MAX + 1));
    expect(() => planRun(disk, SLUG, { file: "big.js", cwd: "Files" })).toThrow(/1 MB/);
    expect(() => planRun(disk, SLUG, { code: "a".repeat(PROGRAM_MAX + 1) })).toThrow(/1 MB/);
  });

  it("refuses both a file and code, and neither", () => {
    expect(() => planRun(disk, SLUG, { file: "a.js", code: "1" })).toThrow(/not both/);
    expect(() => planRun(disk, SLUG, {})).toThrow(/Give a program file or code/);
  });

  it("checks the arguments", () => {
    expect(() => planRun(disk, SLUG, { code: "1", args: "x" as any })).toThrow(/list of text/);
    expect(() => planRun(disk, SLUG, { code: "1", args: [1 as any] })).toThrow(/must be text/);
    expect(() => planRun(disk, SLUG, { code: "1", args: Array(65).fill("a") })).toThrow(/at most 64/);
    expect(() => planRun(disk, SLUG, { code: "1", args: ["a".repeat(1001)] })).toThrow(/1000 characters/);
    expect(() => planRun(disk, SLUG, { code: "1", args: Array(5).fill("a".repeat(900)) })).toThrow(/4096/);
    expect(planRun(disk, SLUG, { code: "1", args: ["a", "b b"] }).args).toEqual(["a", "b b"]);
  });

  it("uses the default time for a missing or bad time", () => {
    expect(planRun(disk, SLUG, { code: "1", timeoutMs: -5 }).timeoutMs).toBe(20_000);
    expect(planRun(disk, SLUG, { code: "1", timeoutMs: 5000 }).timeoutMs).toBe(5000);
  });
});

describe("the sandbox window", () => {
  let e: ReturnType<typeof fakeElectron>;
  let sb: { run: (slug: string, opts?: object) => Promise<{ out: string; ok: boolean }>; stopAll: () => void };

  beforeEach(() => {
    e = fakeElectron();
    sb = createSandbox({ disk, BrowserWindow: e.BrowserWindow, session: e.session, ipcMain: e.ipcMain, preloadPath: "/preload.cjs" }) as any;
  });
  afterEach(() => {
    sb.stopAll();
  });

  it("opens a hidden window in its own in-memory session with the locked-down preferences", () => {
    void sb.run(SLUG, { code: "fenna.print('x')", cwd: "Files" });
    const [win] = e.windows;
    const s = e.sessions[0];
    expect(win.options.show).toBe(false);
    const wp = win.options.webPreferences;
    expect(wp).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: "/preload.cjs",
      devTools: false,
      images: false,
      webgl: false,
      spellcheck: false,
    });
    expect(wp.session).toBe(s);
    expect(s.name.startsWith("sandbox-")).toBe(true);
    expect(s.name.startsWith("persist:")).toBe(false);
    expect(s.opts).toEqual({ cache: false });
  });

  it("loads the program page under the strict CSP, with the code base64 inside", () => {
    void sb.run(SLUG, { code: "fenna.print('x')", cwd: "Files" });
    const [win] = e.windows;
    expect(win.url.startsWith("data:text/html;charset=utf-8;base64,")).toBe(true);
    const page = pageOf(win);
    expect(page).toContain(`content="${CSP}"`);
    expect(CSP).toBe("default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'");
    expect(page.match(/<\/script>/g)).toHaveLength(1);
    expect(page).toContain(Buffer.from("fenna.print('x')").toString("base64"));
  });

  it("blocks every request except data: and about:blank", () => {
    void sb.run(SLUG, { code: "1", cwd: "Files" });
    const s = e.sessions[0];
    const decide = (url: string) => {
      let cancel: boolean | undefined;
      s.webRequestListener({ url }, (r: { cancel: boolean }) => (cancel = r.cancel));
      return cancel;
    };
    expect(decide("https://example.com/x.js")).toBe(true);
    expect(decide("http://127.0.0.1:8080/")).toBe(true);
    expect(decide("file:///C:/Windows/win.ini")).toBe(true);
    expect(decide("data:text/plain,hi")).toBe(false);
    expect(decide("about:blank")).toBe(false);
  });

  it("denies every permission and every new window, and stops navigation", () => {
    void sb.run(SLUG, { code: "1", cwd: "Files" });
    const [win] = e.windows;
    const s = e.sessions[0];
    let granted: boolean | undefined;
    s.permissionRequest(null, "media", (v: boolean) => (granted = v));
    expect(granted).toBe(false);
    expect(s.permissionCheck(null, "geolocation")).toBe(false);
    expect(win.openHandler()).toEqual({ action: "deny" });
    const prevent = vi.fn();
    win.wcHandlers["will-navigate"]({ preventDefault: prevent });
    expect(prevent).toHaveBeenCalled();
  });

  it("passes the arguments and the working folder to the preload, encoded", () => {
    void sb.run(SLUG, { code: "1", cwd: "Files/notes", args: ["one", "two words"] });
    const [win] = e.windows;
    const arg = win.options.webPreferences.additionalArguments.find((a: string) => a.startsWith("--fenna-config="));
    expect(JSON.parse(decodeURIComponent(arg.slice("--fenna-config=".length)))).toEqual({ args: ["one", "two words"], cwd: "Files/notes" });
  });

  it("resolves with the output when the page reports done, and cleans up", async () => {
    const p = sb.run(SLUG, { code: "fenna.print('hi')", cwd: "Files" });
    const [win] = e.windows;
    expect(pageCall(e, win, { op: "print", text: "hi\n" })).toEqual({ ok: true, value: null });
    expect(pageCall(e, win, { op: "done", ok: true, message: "" })).toEqual({ ok: true, value: null });
    expect(await p).toEqual({ out: "hi\n", ok: true });
    expect(e.handlers.has(channelOf(win))).toBe(false);
    expect(win.destroyed).toBe(true);
    expect(e.sessions[0].cleared).toBe(1);
  });

  it("reports an error from the program as not ok, with its message and line", async () => {
    const p = sb.run(SLUG, { code: "fenna.print('a')\nnull.x", cwd: "Files" });
    const [win] = e.windows;
    pageCall(e, win, { op: "print", text: "a\n" });
    pageCall(e, win, { op: "done", ok: false, message: "Line 2: TypeError: Cannot read properties of null" });
    expect(await p).toEqual({ out: "a\nLine 2: TypeError: Cannot read properties of null\n", ok: false });
  });

  it("refuses calls from another sender and leaves the run going", async () => {
    const p = sb.run(SLUG, { code: "1", cwd: "Files" });
    const [win] = e.windows;
    const r = pageCall(e, win, { op: "print", text: "forged" }, win.webContents.id + 1);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/isn't from this program/);
    expect(pageCall(e, win, { op: "done", ok: true, message: "" }).ok).toBe(true);
    expect(await p).toEqual({ out: "", ok: true });
  });

  it("returns refusals to the page as errors, not throws", () => {
    void sb.run(SLUG, { code: "1", cwd: "Files" });
    const [win] = e.windows;
    const r = pageCall(e, win, { op: "readText", path: "../../etc/passwd" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/\.\./);
  });

  it("stops a run that is still going at its time limit, and refuses calls after it", async () => {
    vi.useFakeTimers();
    const p = sb.run(SLUG, { code: "await new Promise(() => {})", cwd: "Files" });
    const [win] = e.windows;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await p).toEqual({ out: "Stopped after 20 s.\n", ok: false });
    expect(win.destroyed).toBe(true);
    // the handler is gone once the run ends, so the page's call has nowhere to land
    expect(pageCall(e, win, { op: "print", text: "late" })).toEqual({ ok: false, error: "no handler" });
    expect(e.handlers.size).toBe(0);
  });

  it("uses the time the caller gives", async () => {
    vi.useFakeTimers();
    const p = sb.run(SLUG, { code: "1", cwd: "Files", timeoutMs: 1500 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toEqual({ out: "Stopped after 1.5 s.\n", ok: false });
  });

  it("ends a run when its page crashes", async () => {
    const p = sb.run(SLUG, { code: "1", cwd: "Files" });
    const [win] = e.windows;
    win.wcHandlers["render-process-gone"]({}, { reason: "crashed" });
    expect(await p).toEqual({ out: "The program stopped unexpectedly.\n", ok: false });
  });

  it("refuses a second program for one bot while two run, and a fifth in the crew", async () => {
    const first = [sb.run(SLUG, { code: "1", cwd: "Files" }), sb.run(SLUG, { code: "1", cwd: "Files" })];
    const third = await sb.run(SLUG, { code: "1", cwd: "Files" });
    expect(third.ok).toBe(false);
    expect(third.out).toBe(`This bot is already running ${PER_BOT} programs. Wait for one to finish.`);
    const other = [sb.run("other", { code: "1" }), sb.run("other", { code: "1" })];
    const fifth = await sb.run("third", { code: "1" });
    expect(fifth.out).toBe(`The crew is already running ${TOTAL} programs. Wait for one to finish.`);
    expect(fifth.ok).toBe(false);
    // the page of the first run is done, so a new run can start
    const [win] = e.windows;
    pageCall(e, win, { op: "done", ok: true, message: "" });
    await first[0];
    const again = sb.run(SLUG, { code: "1", cwd: "Files" });
    expect(e.windows).toHaveLength(5);
    sb.stopAll();
    await Promise.all([...first, ...other, again]);
  });

  it("stops every running program when asked", async () => {
    const pending = [sb.run(SLUG, { code: "1", cwd: "Files" }), sb.run(SLUG, { code: "1", cwd: "Files" })];
    sb.stopAll();
    expect(await Promise.all(pending)).toEqual([
      { out: "Stopped by the crew.\n", ok: false },
      { out: "Stopped by the crew.\n", ok: false },
    ]);
  });

  it("turns a refused plan into an output line and starts nothing", async () => {
    const r = await sb.run(SLUG, { code: "1", cwd: "../x" });
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/\.\./);
    expect(e.windows).toHaveLength(0);
  });

  it("runs a program from a disk file", () => {
    writeFileSync(path.join(base, "workspace", "notes", "prog.js"), "fenna.print('from disk')");
    void sb.run(SLUG, { file: "prog.js", cwd: "Files/notes" });
    expect(pageOf(e.windows[0])).toContain(Buffer.from("fenna.print('from disk')").toString("base64"));
  });
});

describe("the page's program API", () => {
  /** Runs the page's bootstrap in a bare context with a fake bridge, the way the page would. */
  function runPage(code: string, bridgeOverrides: Record<string, unknown> = {}) {
    const bridge: any = {
      args: ["one"],
      cwd: "Files/notes",
      readText: vi.fn(async () => "text"),
      writeText: vi.fn(async () => null),
      list: vi.fn(async () => []),
      exists: vi.fn(async () => true),
      print: vi.fn(async () => null),
      exit: vi.fn(async () => null),
      done: vi.fn(async () => null),
      ...bridgeOverrides,
    };
    const html = programPage(code);
    const script = html.split("<script>")[1].split("</script>")[0];
    const context: any = {
      __fennaBridge: bridge,
      atob,
      TextDecoder,
      console: { log: () => {}, error: () => {} },
    };
    vm.createContext(context);
    vm.runInContext(script, context);
    return { bridge };
  }

  it("gives the program fenna with args and cwd, and prints what it is given", async () => {
    const { bridge } = runPage(`fenna.print("a", 1, { b: 2 }); console.log("c"); console.error("d");`);
    await vi.waitFor(() => expect(bridge.done).toHaveBeenCalled());
    expect(bridge.print.mock.calls.map((c: any[]) => c[0])).toEqual(['a 1 {"b":2}\n', "c\n", "d\n"]);
    expect(bridge.done).toHaveBeenCalledWith(true, "");
  });

  it("passes the args and the working folder through", async () => {
    const { bridge } = runPage(`fenna.print(fenna.args.join(","), fenna.cwd, await fenna.list())`);
    await vi.waitFor(() => expect(bridge.done).toHaveBeenCalled());
    expect(bridge.print).toHaveBeenCalledWith('one Files/notes []\n');
    expect(bridge.list).not.toHaveBeenCalledWith(undefined);
  });

  it("defaults list to the working folder", async () => {
    const { bridge } = runPage(`await fenna.list()`);
    await vi.waitFor(() => expect(bridge.done).toHaveBeenCalled());
    expect(bridge.list).toHaveBeenCalledWith("Files/notes");
  });

  it("reports an uncaught error with the line it happened on", async () => {
    const { bridge } = runPage("const a = 1;\nconst b = a + 1;\nnull.x;");
    await vi.waitFor(() => expect(bridge.done).toHaveBeenCalled());
    const [ok, message] = bridge.done.mock.calls[0];
    expect(ok).toBe(false);
    expect(message).toMatch(/^Line 3: TypeError:/);
  });

  it("reports a syntax error as not ok", async () => {
    const { bridge } = runPage("const = ;");
    await vi.waitFor(() => expect(bridge.done).toHaveBeenCalled());
    expect(bridge.done.mock.calls[0][0]).toBe(false);
    expect(bridge.done.mock.calls[0][1]).toMatch(/SyntaxError/);
  });

  it("passes writes and reads through the bridge", async () => {
    const { bridge } = runPage(`await fenna.writeText("Files/a.txt", 42); fenna.print(await fenna.readText("Files/a.txt"))`);
    await vi.waitFor(() => expect(bridge.done).toHaveBeenCalled());
    expect(bridge.writeText).toHaveBeenCalledWith("Files/a.txt", "42");
    expect(bridge.print).toHaveBeenCalledWith("text\n");
  });

  it("reports a refusal from the bridge as a line of the error", async () => {
    const { bridge } = runPage(`await fenna.readText("../x")`, {
      readText: vi.fn(async () => {
        throw new Error("A path can't use .. to leave the folder.");
      }),
    });
    await vi.waitFor(() => expect(bridge.done).toHaveBeenCalled());
    expect(bridge.done.mock.calls[0][1]).toMatch(/Error: A path can't use \.\./);
  });
});
