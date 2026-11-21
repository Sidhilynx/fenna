import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAppManifest } from "../../../packages/crew/src/index.ts";

const require = createRequire(import.meta.url);
const { createDisk } = require("../src/main/disk.cjs");
const apps = require("../src/main/apps.cjs");
const { createApps, parseAppUrl, appCsp, requestAllowed, clampGrant, createLimiter, partitionOf, TOOL_RESULT_MAX } = apps;

const SLUG = "research";
const NAME = "notes-board";
const ORIGIN = "https://api.example.com";

const MANIFEST = {
  name: NAME,
  title: "Notes",
  icon: "doc",
  entry: "index.html",
  description: "Short notes.",
  permissions: { documents: "none", network: [ORIGIN], bot: true },
  tools: [{ name: "add_note", description: "Adds a note.", input: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }],
};

type Fake = Record<string, any>;

/** A fake Electron session: records the handlers the apps module installs. */
function fakeSession() {
  const made = new Map<string, Fake>();
  return {
    made,
    fromPartition(part: string) {
      if (!made.has(part)) {
        const ses: Fake = {
          partition: part,
          handlers: {} as Record<string, (req: Request) => Response>,
          protocol: { handle: (scheme: string, fn: (req: Request) => Response) => (ses.handlers[scheme] = fn) },
          webRequest: { onBeforeRequest: (fn: (d: { url: string }, cb: (r: { cancel: boolean }) => void) => void) => (ses.filter = fn) },
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
          setDevicePermissionHandler: vi.fn(),
          on: (ev: string, fn: (e: { preventDefault: () => void }) => void) => (ses.downloads = fn),
        };
        made.set(part, ses);
      }
      return made.get(part);
    },
  };
}

/** A fake IPC: handle() and on() store the handlers, invoke()/emit() run them as a sender would. */
function fakeIpc() {
  const handlers = new Map<string, (e: Fake, ...a: unknown[]) => unknown>();
  const listeners = new Map<string, (e: Fake, ...a: unknown[]) => void>();
  return {
    handle: (ch: string, fn: (e: Fake, ...a: unknown[]) => unknown) => handlers.set(ch, fn),
    on: (ch: string, fn: (e: Fake, ...a: unknown[]) => void) => listeners.set(ch, fn),
    invoke: (ch: string, sender: Fake, ...args: unknown[]) => handlers.get(ch)!({ sender }, ...args),
    /** Runs a listener as if the sender sent it; returns the event, so a sync reply (returnValue) can be read. */
    emit: (ch: string, sender: Fake, ...args: unknown[]) => {
      const e: Fake = { sender };
      listeners.get(ch)!(e, ...args);
      return e;
    },
  };
}

/** A fake page: a webContents with an id, a session and the send/once/on it's used with. */
function fakeWc(id: number, session: unknown): Fake {
  const listeners: Record<string, Array<(...a: any[]) => void>> = {};
  return {
    id,
    session,
    sent: [] as Array<{ channel: string; payload: unknown }>,
    send(channel: string, payload: unknown) {
      this.sent.push({ channel, payload });
    },
    isDestroyed: () => false,
    once(ev: string, fn: (...a: any[]) => void) {
      (listeners[ev] ??= []).push(fn);
    },
    on(ev: string, fn: (...a: any[]) => void) {
      (listeners[ev] ??= []).push(fn);
    },
    emit(ev: string, ...a: unknown[]) {
      for (const fn of listeners[ev] ?? []) fn(...a);
    },
    setWindowOpenHandler: vi.fn(),
  };
}

let root: string;
let botsDir: string;
let broadcast: ReturnType<typeof vi.fn>;
let runner: { enqueue: ReturnType<typeof vi.fn> };
let clock: { t: number };
let electronSession: ReturnType<typeof fakeSession>;
let ipc: ReturnType<typeof fakeIpc>;
let svc: ReturnType<typeof createApps>;
let disk: ReturnType<typeof createDisk>;

const hasBot = (slug: string) => existsSync(path.join(botsDir, slug, "bot.md"));
const store = {
  botDir: (slug: string) => path.join(botsDir, slug),
  readBot: (slug: string) => (hasBot(slug) ? { slug, bot: {} } : null),
  slugs: () => readdirSync(botsDir).filter(hasBot).sort(),
};

function writeApp(manifest: unknown, files: Record<string, string> = { "index.html": "<!doctype html><p>hi</p>" }, name = NAME) {
  const dir = path.join(botsDir, SLUG, "workspace", "Apps", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "app.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

/** The requests crew.fetch sent, and what the fake web answers: a redirect from /moved, an error page for /missing. */
let fetched: Array<{ url: string; init: any }> = [];
async function fakeFetch(url: string, init: any) {
  fetched.push({ url, init });
  const u = new URL(url);
  if (u.pathname === "/moved") return new Response(null, { status: 302, headers: { location: String(init.headers.to ?? "/data") } });
  if (u.pathname === "/missing") return new Response("gone", { status: 404 });
  return new Response(JSON.stringify({ price: 125.53 }), { status: 200, headers: { "content-type": "application/json" } });
}

function setup() {
  mkdirSync(path.join(botsDir, SLUG), { recursive: true });
  writeFileSync(path.join(botsDir, SLUG, "bot.md"), "---\nname: Research\n---\n");
  broadcast = vi.fn();
  runner = { enqueue: vi.fn() };
  clock = { t: Date.parse("2026-11-20T10:00:00Z") };
  electronSession = fakeSession();
  ipc = fakeIpc();
  disk = createDisk({ store, broadcast: () => {}, starterFiles: () => ({}), settingsFile: path.join(root, "quotas.json") });
  fetched = [];
  svc = createApps({ disk, store, broadcast, runner, session: electronSession, ipcMain: ipc, now: () => clock.t, fetch: fakeFetch });
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crew-apps-test-"));
  botsDir = path.join(root, "bots");
  mkdirSync(botsDir, { recursive: true });
  setup();
});

afterEach(() => {
  svc.stop();
  rmSync(root, { recursive: true, force: true });
});

/** The session of an app and its network filter, as the app's page sees them. */
function appSession(slug = SLUG, name = NAME) {
  const ses = svc.session(slug, name);
  return { ses, allow: (url: string) => {
    let cancelled: boolean | undefined;
    ses.filter({ url }, (r: { cancel: boolean }) => (cancelled = r.cancel));
    return !cancelled;
  } };
}

describe("parseAppUrl: crewapp:// addresses", () => {
  it("reads the slug, the app name and the path", () => {
    expect(parseAppUrl("crewapp://research/notes-board/index.html")).toEqual({ slug: "research", name: "notes-board", rel: "index.html" });
    expect(parseAppUrl("crewapp://research/notes-board/pages/home.html")).toEqual({ slug: "research", name: "notes-board", rel: "pages/home.html" });
  });

  it("reads the entry for the app address with or without a trailing slash", () => {
    expect(parseAppUrl("crewapp://research/notes-board")).toEqual({ slug: "research", name: "notes-board", rel: "" });
    expect(parseAppUrl("crewapp://research/notes-board/")).toEqual({ slug: "research", name: "notes-board", rel: "" });
  });

  it.each([
    "https://research/notes-board/index.html",
    "crewfile://research/Files/a.txt",
    "crewapp://research/",
    "crewapp://research//index.html",
    "crewapp://research/notes-board//x.js",
    "crewapp://research/notes-board/..%2Fbot.md",
    "crewapp://research/notes-board/a%5Cb.js",
    "crewapp://research/notes-board/%E0%A4%A",
    "not a url",
  ])("refuses %s", (text) => {
    expect(parseAppUrl(text)).toBeNull();
  });

  it("reads an encoded dot-dot as the URL resolves it, so it can't reach another folder", () => {
    expect(parseAppUrl("crewapp://research/notes-board/%2e%2e/bot.md")).toEqual({ slug: "research", name: "bot.md", rel: "" });
  });
});

describe("appCsp and requestAllowed: what an app may load", () => {
  it("limits connections to the granted origins, and everything else to its own files", () => {
    const csp = appCsp([ORIGIN, "http://localhost:8080"]);
    expect(csp).toContain("default-src 'self' crewapp:");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain(`connect-src 'self' crewapp: ${ORIGIN} http://localhost:8080`);
    expect(csp).toContain("object-src 'none'");
  });

  it("has no extra origins when none are granted", () => {
    expect(appCsp([])).toContain("connect-src 'self' crewapp:;");
  });

  it.each([
    ["crewapp://research/notes-board/index.html", true],
    ["data:text/plain,hi", true],
    ["blob:https://x/1", true],
    [`${ORIGIN}/v1/rates`, true],
    ["http://api.example.com/v1", false],
    ["https://evil.example.com/", false],
    ["https://api.example.com.evil.net/", false],
    ["wss://api.example.com/socket", false],
    ["file:///C:/Users/x/secret.txt", false],
    ["ftp://api.example.com/x", false],
  ])("%s allowed=%s", (url, ok) => {
    expect(requestAllowed(url, [ORIGIN])).toBe(ok);
  });
});

describe("createLimiter", () => {
  it("allows the first n events in a window, then refuses until the window passes", () => {
    let t = 0;
    const lim = createLimiter({ max: 2, windowMs: 1000, now: () => t });
    expect(lim.take("a")).toBe(true);
    expect(lim.take("a")).toBe(true);
    expect(lim.take("a")).toBe(false);
    expect(lim.take("b")).toBe(true);
    t = 999;
    expect(lim.take("a")).toBe(false);
    t = 1000;
    expect(lim.take("a")).toBe(true);
  });
});

describe("clampGrant: what an app runs with", () => {
  const asked = { documents: "read", network: [ORIGIN, "https://b.example.com"], bot: true };
  const app = { permissions: asked } as any;

  it("is nothing without a grant or a manifest", () => {
    expect(clampGrant(null, app)).toEqual({ documents: "none", network: [], bot: false });
    expect(clampGrant({ documents: "write", network: [ORIGIN], bot: true }, null)).toEqual({ documents: "none", network: [], bot: false });
  });

  it("keeps the granted origins that the manifest still asks for, and no others", () => {
    expect(clampGrant({ documents: "read", network: [ORIGIN, "https://old.example.com"], bot: true }, app).network).toEqual([ORIGIN]);
  });

  it("never goes above what the manifest asks now", () => {
    expect(clampGrant({ documents: "write", network: [], bot: true }, app).documents).toBe("read");
    expect(clampGrant({ documents: "read", network: [], bot: true }, { permissions: { ...asked, bot: false } } as any).bot).toBe(false);
  });
});

describe("list and manifest: an app's folder", () => {
  it("is empty when there is no Apps folder", () => {
    expect(svc.list(SLUG)).toEqual([]);
  });

  it("lists an app with its title, icon, tools and no problems", () => {
    writeApp(MANIFEST);
    const [info] = svc.list(SLUG);
    expect(info).toMatchObject({ name: NAME, title: "Notes", icon: "doc", entry: "index.html", problems: [], grant: null, pending: true });
    expect(info.tools.map((t: { name: string }) => t.name)).toEqual(["add_note"]);
  });

  it("is not pending when the app asks for nothing", () => {
    writeApp({ name: NAME, title: "Notes" });
    expect(svc.list(SLUG)[0].pending).toBe(false);
  });

  it("names the problems of app.json and keeps the app out of use", () => {
    writeApp({ name: NAME, title: "Notes", permissions: { documents: "readwrite" } });
    const [info] = svc.list(SLUG);
    expect(info.problems).toEqual(['permissions.documents is "readwrite". Use none, read or write.']);
    expect(svc.manifest(SLUG, NAME).app).toBeNull();
  });

  it("says when app.json is missing", () => {
    mkdirSync(path.join(botsDir, SLUG, "workspace", "Apps", NAME), { recursive: true });
    expect(svc.list(SLUG)[0].problems[0]).toMatch(/^There is no app\.json in Files\/Apps\/notes-board/);
  });

  it("says when the name in app.json is not the folder's name", () => {
    writeApp({ ...MANIFEST, name: "other-board" });
    expect(svc.manifest(SLUG, NAME).problems[0]).toBe('app.json names the app "other-board", but its folder is "notes-board". Rename one of them so they match.');
  });

  it("says when the entry file is not in the folder", () => {
    writeApp({ ...MANIFEST, entry: "start.html" });
    expect(svc.manifest(SLUG, NAME).problems).toEqual(["start.html isn't in the app's folder. Write that file, or change entry in app.json."]);
  });

  it("does not list folders whose names are not app names", () => {
    writeApp(MANIFEST, {}, "Bad Name");
    writeApp(MANIFEST, {}, NAME);
    expect(svc.list(SLUG).map((i: { name: string }) => i.name)).toEqual([NAME]);
  });
});

describe("grants", () => {
  it("allows an app what its manifest asks, and stores that in the bot's apps.json", () => {
    writeApp(MANIFEST);
    const list = svc.setGrant(SLUG, NAME, MANIFEST.permissions);
    expect(list[0]).toMatchObject({ grant: MANIFEST.permissions, pending: false });
    expect(svc.grantOf(SLUG, NAME)).toEqual(MANIFEST.permissions);
    const saved = JSON.parse(readFileSync(path.join(botsDir, SLUG, "apps.json"), "utf8"));
    expect(saved[NAME].grant).toEqual(MANIFEST.permissions);
    expect(saved[NAME].hash).toMatch(/^[0-9a-f]{16}$/);
    expect(broadcast).toHaveBeenCalledWith("crew:apps", { slug: SLUG });
  });

  it("refuses a grant that does not cover the whole ask, and says what is asked", () => {
    writeApp(MANIFEST);
    expect(() => svc.setGrant(SLUG, NAME, { documents: "none", network: [], bot: true })).toThrow(/must allow what the app asks for/);
    expect(() => svc.setGrant(SLUG, NAME, { documents: "none", network: [ORIGIN], bot: false })).toThrow(/must allow/);
    expect(svc.grantOf(SLUG, NAME)).toBeNull();
  });

  it("refuses a grant with the wrong shape", () => {
    writeApp(MANIFEST);
    expect(() => svc.setGrant(SLUG, NAME, { documents: "admin", network: [], bot: true })).toThrow(/A grant is documents/);
  });

  it("refuses to allow an app that has problems", () => {
    writeApp({ ...MANIFEST, entry: "missing.html" });
    expect(() => svc.setGrant(SLUG, NAME, MANIFEST.permissions)).toThrow(/can't be allowed yet/);
  });

  it("revokes with null", () => {
    writeApp(MANIFEST);
    svc.setGrant(SLUG, NAME, MANIFEST.permissions);
    const list = svc.setGrant(SLUG, NAME, null);
    expect(list[0].grant).toBeNull();
    expect(list[0].pending).toBe(true);
    expect(svc.grantOf(SLUG, NAME)).toBeNull();
  });

  it("refuses a bot that is not there", () => {
    expect(() => svc.setGrant("nobody", NAME, null)).toThrow(/There is no bot "nobody"/);
  });

  it("keeps the old grant when the manifest asks for more, until the person allows it", () => {
    writeApp(MANIFEST);
    svc.setGrant(SLUG, NAME, MANIFEST.permissions);
    writeApp({ ...MANIFEST, permissions: { ...MANIFEST.permissions, network: [ORIGIN, "https://new.example.com"] } });
    clock.t += 5000;
    expect(svc.list(SLUG)[0].pending).toBe(true);
    const { allow } = appSession();
    expect(allow(`${ORIGIN}/x`)).toBe(true);
    expect(allow("https://new.example.com/x")).toBe(false);
  });

  it("uses only what the manifest asks now, when it asks for less", () => {
    writeApp(MANIFEST);
    svc.setGrant(SLUG, NAME, MANIFEST.permissions);
    writeApp({ ...MANIFEST, permissions: { ...MANIFEST.permissions, network: [], bot: false } });
    clock.t += 5000;
    expect(appSession().allow(`${ORIGIN}/x`)).toBe(false);
  });
});

describe("the app's session", () => {
  it("is in memory, one per app, under the app's partition", () => {
    writeApp(MANIFEST);
    expect(partitionOf(SLUG, NAME)).toBe("crewapp-research-notes-board");
    const a = svc.session(SLUG, NAME);
    expect(a.partition).toBe("crewapp-research-notes-board");
    expect(svc.session(SLUG, NAME)).toBe(a);
    expect(svc.session(SLUG, "other-board")).not.toBe(a);
  });

  it("gives no permissions and keeps no downloads", () => {
    const { ses } = appSession();
    const deny = ses.setPermissionRequestHandler.mock.calls[0][0];
    const cb = vi.fn();
    deny({}, "media", cb);
    expect(cb).toHaveBeenCalledWith(false);
    expect(ses.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
    const prevent = vi.fn();
    ses.downloads({ preventDefault: prevent });
    expect(prevent).toHaveBeenCalled();
  });

  it("refuses network requests that are not granted, and lets the app's own files through", () => {
    writeApp(MANIFEST);
    svc.setGrant(SLUG, NAME, MANIFEST.permissions);
    const { allow } = appSession();
    expect(allow("crewapp://research/notes-board/index.html")).toBe(true);
    expect(allow(`${ORIGIN}/rates`)).toBe(true);
    expect(allow("https://tracker.example.net/")).toBe(false);
    expect(allow("http://api.example.com/")).toBe(false);
    expect(allow("ws://api.example.com/")).toBe(false);
  });

  it("refuses everything without a grant", () => {
    writeApp(MANIFEST);
    expect(appSession().allow(`${ORIGIN}/rates`)).toBe(false);
  });

  it("serves the app's files with the app's content security policy", async () => {
    writeApp(MANIFEST, { "index.html": "<p>hi</p>", "app.js": "console.log(1)", "style.css": "p{}" });
    svc.setGrant(SLUG, NAME, MANIFEST.permissions);
    const serve = appSession().ses.handlers.crewapp;
    const page = serve(new Request("crewapp://research/notes-board/"));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("content-security-policy")).toContain(`connect-src 'self' crewapp: ${ORIGIN}`);
    expect(await page.text()).toBe("<p>hi</p>");
    expect(serve(new Request("crewapp://research/notes-board/app.js")).headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(serve(new Request("crewapp://research/notes-board/style.css")).headers.get("content-type")).toBe("text/css; charset=utf-8");
  });

  it("serves nothing from another app, or from outside the folder", () => {
    writeApp(MANIFEST, { "index.html": "<p>hi</p>" });
    const serve = appSession().ses.handlers.crewapp;
    expect(serve(new Request("crewapp://research/other-board/index.html")).status).toBe(403);
    expect(serve(new Request("crewapp://other/notes-board/index.html")).status).toBe(403);
    expect(serve(new Request("crewapp://research/notes-board/%2e%2e/bot.md")).status).toBe(403);
    expect(serve(new Request("crewapp://research/notes-board/..%2fbot.md")).status).toBe(403);
    expect(serve(new Request("crewapp://research/notes-board/..%2Fapp.json")).status).toBe(403);
    expect(serve(new Request("crewapp://research/notes-board/missing.js")).status).toBe(404);
    expect(serve(new Request("crewapp://research/notes-board/")).status).toBe(200);
  });
});

describe("calls from the page", () => {
  let wc: Fake;
  let other: Fake;

  beforeEach(() => {
    writeApp(MANIFEST);
    wc = fakeWc(10, appSession().ses);
    other = fakeWc(11, fakeSession().fromPartition("not-an-app"));
  });

  const call = (op: string, args: Record<string, unknown> = {}, sender = wc) => ipc.invoke("crewapp:call", sender, op, args);

  it("refuses calls from a page that is not an app", () => {
    expect(() => ipc.invoke("crewapp:call", other, "files.list", {})).toThrow(/This page isn't an app/);
  });

  it("ignores any app name the page sends, and works on the app that owns the session", async () => {
    await call("files.write", { path: "notes.json", text: "[]", slug: "someone-else", name: "other" });
    expect(readFileSync(path.join(botsDir, SLUG, "workspace", "Apps", NAME, "notes.json"), "utf8")).toBe("[]");
  });

  it("writes and reads a file in the app's folder, and lists it", async () => {
    // files.list sorts its names; the root holds app.json, the data folder and index.html.
    await call("files.write", { path: "data/notes.json", text: "[1]" });
    expect(await call("files.read", { path: "data/notes.json" })).toBe("[1]");
    expect(await call("files.list", { path: "data" })).toEqual([{ name: "notes.json", kind: "file" }]);
    expect(await call("files.list", {})).toEqual(
      [{ name: "app.json", kind: "file" }, { name: "data", kind: "folder" }, { name: "index.html", kind: "file" }],
    );
  });

  it("writes bytes", async () => {
    await call("files.write", { path: "a.bin", bytes: new Uint8Array([1, 2, 3]) });
    expect(readFileSync(path.join(botsDir, SLUG, "workspace", "Apps", NAME, "a.bin"))).toEqual(Buffer.from([1, 2, 3]));
  });

  it("refuses paths outside the app's folder", async () => {
    await expect(call("files.write", { path: "../../bot.md", text: "x" })).rejects.toThrow();
    await expect(call("files.write", { path: "/etc/x", text: "x" })).rejects.toThrow();
    await expect(call("files.read", { path: "../app.json" })).rejects.toThrow();
    await expect(call("files.write", { path: "", text: "x" })).rejects.toThrow(/Name a file/);
  });

  it("refuses to write a file over a folder", async () => {
    await call("files.write", { path: "data/a.txt", text: "x" });
    await expect(call("files.write", { path: "data", text: "y" })).rejects.toThrow(/is a folder/);
  });

  it("refuses a write with no text or bytes, and one that is too big", async () => {
    await expect(call("files.write", { path: "a.txt" })).rejects.toThrow(/Give the file's text/);
    await expect(call("files.write", { path: "a.txt", text: "x".repeat(10 * 1024 * 1024 + 1) })).rejects.toThrow(/at most 10\.0 MB/);
  });

  it("fetches a granted origin from main, and follows redirects on it", async () => {
    svc.setGrant(SLUG, NAME, MANIFEST.permissions);
    const r = await call("net.fetch", { url: `${ORIGIN}/moved`, headers: { to: "/data" } });
    expect(r).toMatchObject({ url: `${ORIGIN}/data`, status: 200, ok: true, text: '{"price":125.53}' });
    expect(r.headers["content-type"]).toBe("application/json");
    expect(fetched.map((f) => f.url)).toEqual([`${ORIGIN}/moved`, `${ORIGIN}/data`]);
    expect(fetched[0].init.headers["user-agent"]).toBe("Mozilla/5.0");
    expect(await call("net.fetch", { url: `${ORIGIN}/missing` })).toMatchObject({ status: 404, ok: false, text: "gone" });
  });

  it("refuses an origin the app wasn't granted, before and after a redirect", async () => {
    await expect(call("net.fetch", { url: `${ORIGIN}/data` })).rejects.toThrow(/may not reach .*Allowed now: none yet/);
    svc.setGrant(SLUG, NAME, MANIFEST.permissions);
    await expect(call("net.fetch", { url: "https://evil.example.com/x" })).rejects.toThrow(/may not reach https:\/\/evil\.example\.com/);
    await expect(call("net.fetch", { url: `${ORIGIN}/moved`, headers: { to: "https://evil.example.com/x" } })).rejects.toThrow(/may not reach/);
    expect(fetched.map((f) => f.url)).toEqual([`${ORIGIN}/moved`]);
    await expect(call("net.fetch", { url: "file:///etc/passwd" })).rejects.toThrow(/may not reach/);
    await expect(call("net.fetch", { url: `${ORIGIN}/data`, method: "TRACE" })).rejects.toThrow(/method must be one of/);
    await expect(call("net.fetch", { url: `${ORIGIN}/data`, method: "POST", body: { a: 1 } })).rejects.toThrow(/JSON\.stringify/);
  });

  it("refuses to read a missing file with a fix", async () => {
    await expect(call("files.read", { path: "nope.txt" })).rejects.toThrow(/There is no file at nope\.txt/);
  });

  it("refuses Documents without a grant, and says how to allow it", async () => {
    await expect(call("docs.list")).rejects.toThrow(/can't read Documents/);
    await expect(call("docs.read", { path: "Documents/q3" })).rejects.toThrow(/can't read Documents/);
  });

  it("refuses bot messages without the bot grant", async () => {
    await expect(call("bot.tell", { text: "hi" })).rejects.toThrow(/can't message the bot/);
    expect(runner.enqueue).not.toHaveBeenCalled();
  });

  it("sends the bot a run of trigger app with the app's title, once granted, six times an hour", async () => {
    svc.setGrant(SLUG, NAME, MANIFEST.permissions);
    for (let i = 0; i < 6; i++) await call("bot.tell", { text: `note ${i}` });
    expect(runner.enqueue).toHaveBeenLastCalledWith({ slug: SLUG, trigger: "app", text: "Notes: note 5" });
    await expect(call("bot.tell", { text: "one too many" })).rejects.toThrow(/6 messages this hour/);
    clock.t += 60 * 60 * 1000;
    await expect(call("bot.tell", { text: "after the hour" })).resolves.toBeNull();
    expect(runner.enqueue).toHaveBeenCalledTimes(7);
  });

  it("refuses an empty or long message to the bot", async () => {
    svc.setGrant(SLUG, NAME, MANIFEST.permissions);
    await expect(call("bot.tell", { text: "   " })).rejects.toThrow(/Say what the bot should know/);
    await expect(call("bot.tell", { text: "x".repeat(2001) })).rejects.toThrow(/The most is 2000/);
  });

  it("defines only the tools the manifest names", async () => {
    await expect(call("tools.define", { name: "delete_all" })).rejects.toThrow(/doesn't define a tool "delete_all"/);
    await call("tools.define", { name: "add_note" });
    expect(svc.toolsOf(wc)).toEqual(["add_note"]);
  });

  it("refuses an unknown call by its name", async () => {
    await expect(call("files.delete")).rejects.toThrow(/There is no call called "files\.delete"/);
  });

  it("answers the page's preload with the app's name, title, bot and documents, and null for a page that is not an app", () => {
    expect(ipc.emit("crewapp:info", wc).returnValue).toEqual({ name: NAME, title: "Notes", bot: false, documents: "none", network: [] });
    expect(ipc.emit("crewapp:info", other).returnValue).toBeNull();
  });
});

describe("Documents: a sheet read and changed, a doc read as text", () => {
  const SHEET = require("@opendeck/sheet");
  const DOC = require("@opendeck/doc");
  let wc: Fake;

  /** A Fenna sheet in the bot's library: sheet.json and sheets/sheet-1.json, with these cells. */
  function makeSheet(folder: string, cells: Record<string, unknown>) {
    const dir = path.join(botsDir, SLUG, "library", folder);
    const { index } = SHEET.newWorkbookFiles("Budget");
    mkdirSync(path.join(dir, "sheets"), { recursive: true });
    writeFileSync(path.join(dir, "sheet.json"), SHEET.indexText(index));
    writeFileSync(path.join(dir, SHEET.sheetFile("sheet-1")), SHEET.sheetText(SHEET.patchCells(SHEET.emptySheet("sheet-1", "Sheet1"), cells)));
  }

  beforeEach(() => {
    writeApp({ ...MANIFEST, permissions: { documents: "write", network: [], bot: false } });
    svc.setGrant(SLUG, NAME, { documents: "write", network: [], bot: false });
    wc = fakeWc(40, appSession().ses);
  });

  const call = (op: string, args: Record<string, unknown> = {}) => ipc.invoke("crewapp:call", wc, op, args);

  it("lists the bot's documents with their kinds and titles", async () => {
    makeSheet("budget", { A1: { v: "Item" } });
    expect(await call("docs.list")).toEqual([{ path: "Documents/budget", name: "budget", kind: "sheet", title: "Budget" }]);
  });

  it("reads a sheet as rows of computed values", async () => {
    makeSheet("budget", { A1: { v: "Item" }, B2: { v: 2 }, B3: { f: "=B2*3" } });
    expect(await call("docs.read", { path: "Documents/budget" })).toEqual({
      kind: "sheet",
      title: "Budget",
      sheets: [{ title: "Sheet1", rows: [["Item", null], [null, 2], [null, 6]] }],
    });
  });

  it("changes cells of a sheet, and the change is read back with formulas computed", async () => {
    makeSheet("budget", { A1: { v: "Item" }, B2: { v: 2 }, B3: { f: "=B2*3" } });
    await call("docs.writeCells", { path: "Documents/budget", sheet: "Sheet1", cells: { A2: "Rent", B4: "=SUM(B2:B3)" } });
    const sheet = (await call("docs.read", { path: "Documents/budget" })).sheets[0];
    expect(sheet.rows[1]).toEqual(["Rent", 2]);
    expect(sheet.rows[3]).toEqual([null, 8]);
  });

  it("refuses cells that are not cells, and values that are not values", async () => {
    makeSheet("budget", {});
    await expect(call("docs.writeCells", { path: "Documents/budget", sheet: "Sheet1", cells: { Z: 1 } })).rejects.toThrow(/"Z" is not a cell/);
    await expect(call("docs.writeCells", { path: "Documents/budget", sheet: "Sheet1", cells: { A1: { x: 1 } } })).rejects.toThrow(/must be text, a number/);
    await expect(call("docs.writeCells", { path: "Documents/budget", sheet: "Nope", cells: { A1: 1 } })).rejects.toThrow(/There is no sheet "Nope"/);
  });

  it("reads a doc as plain text, with its title", async () => {
    const dir = path.join(botsDir, SLUG, "library", "plan");
    mkdirSync(path.join(dir, "tabs"), { recursive: true });
    const { index } = DOC.newDocFiles("Plan");
    writeFileSync(path.join(dir, "doc.json"), DOC.indexText(index));
    writeFileSync(path.join(dir, DOC.tabFile("tab-1")), '<article id="tab-1">\n<p>Hello from the plan</p>\n</article>\n');
    const doc = await call("docs.read", { path: "Documents/plan" });
    expect(doc).toEqual({ kind: "doc", title: "Plan", text: "Hello from the plan" });
  });

  it("refuses a folder in Documents that is not a Fenna document", async () => {
    mkdirSync(path.join(botsDir, SLUG, "library", "scraps"), { recursive: true });
    await expect(call("docs.read", { path: "Documents/scraps" })).rejects.toThrow(/isn't a Fenna document/);
    await expect(call("docs.read", { path: "Files/x" })).rejects.toThrow(/Say a document in Documents/);
    await expect(call("docs.read", { path: "Documents/missing" })).rejects.toThrow(/There is no document "Documents\/missing"/);
  });
});

describe("callTool: the bot runs a tool the page defined", () => {
  let wc: Fake;

  beforeEach(() => {
    writeApp(MANIFEST);
    wc = fakeWc(20, appSession().ses);
  });

  it("refuses a tool the page has not defined, and names the ones it has", async () => {
    await expect(svc.callTool(wc, "add_note", {})).rejects.toThrow(/has no tool "add_note" running. Its tools: none yet/);
  });

  it("sends the input to the page and resolves with its JSON result", async () => {
    ipc.invoke("crewapp:call", wc, "tools.define", { name: "add_note" });
    const p = svc.callTool(wc, "add_note", { text: "hi" });
    const sent = wc.sent.at(-1);
    expect(sent.channel).toBe("crewapp:callTool");
    expect(sent.payload).toMatchObject({ name: "add_note", input: { text: "hi" } });
    ipc.emit("crewapp:toolResult", wc, { id: sent.payload.id, ok: true, text: '{"count":3}' });
    await expect(p).resolves.toEqual({ count: 3 });
  });

  it("rejects when the page reports an error", async () => {
    ipc.invoke("crewapp:call", wc, "tools.define", { name: "add_note" });
    const p = svc.callTool(wc, "add_note", {});
    ipc.emit("crewapp:toolResult", wc, { id: wc.sent.at(-1).payload.id, ok: false, error: "Give the note's text." });
    await expect(p).rejects.toThrow("Give the note's text.");
  });

  it("ignores an answer from another page", async () => {
    ipc.invoke("crewapp:call", wc, "tools.define", { name: "add_note" });
    const p = svc.callTool(wc, "add_note", {}, { timeoutMs: 50 });
    const other = fakeWc(21, wc.session);
    ipc.emit("crewapp:toolResult", other, { id: wc.sent.at(-1).payload.id, ok: true, text: "1" });
    await expect(p).rejects.toThrow(/didn't answer within 0 s/);
  });

  it("times out after the limit", async () => {
    ipc.invoke("crewapp:call", wc, "tools.define", { name: "add_note" });
    vi.useFakeTimers();
    try {
      const p = svc.callTool(wc, "add_note", {});
      vi.advanceTimersByTime(apps.TOOL_TIMEOUT_MS);
      await expect(p).rejects.toThrow("didn't answer within 10 s");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a result over 64 KB", async () => {
    ipc.invoke("crewapp:call", wc, "tools.define", { name: "add_note" });
    const p = svc.callTool(wc, "add_note", {});
    ipc.emit("crewapp:toolResult", wc, { id: wc.sent.at(-1).payload.id, ok: true, text: `"${"x".repeat(TOOL_RESULT_MAX)}"` });
    await expect(p).rejects.toThrow(/over 64 KB/);
  });

  it("refuses an input over 64 KB before it is sent", async () => {
    ipc.invoke("crewapp:call", wc, "tools.define", { name: "add_note" });
    await expect(svc.callTool(wc, "add_note", { text: "x".repeat(TOOL_RESULT_MAX) })).rejects.toThrow(/over 64 KB/);
    expect(wc.sent).toEqual([]);
  });
});

describe("guard: an app's webviews", () => {
  it("lets an app's webview in only with its own partition and its own page, with the app's preload", () => {
    writeApp(MANIFEST);
    const handlers: Record<string, (...a: any[]) => void> = {};
    const win = { webContents: { on: (ev: string, fn: (...a: any[]) => void) => (handlers[ev] = fn) } };
    svc.guard(win);
    const prefs: Fake = { preloadURL: "x", preload: "", sandbox: false, nodeIntegration: true };
    const ok = { partition: partitionOf(SLUG, NAME), src: "crewapp://research/notes-board/" };
    const e = { preventDefault: vi.fn() };
    handlers["will-attach-webview"](e, prefs, ok);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(prefs).toMatchObject({ preload: svc.preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
    expect(prefs.preloadURL).toBeUndefined();

    const bad = { preventDefault: vi.fn() };
    handlers["will-attach-webview"](bad, {}, { partition: partitionOf(SLUG, NAME), src: "crewapp://research/other-board/" });
    expect(bad.preventDefault).toHaveBeenCalled();

    const wrongPart = { preventDefault: vi.fn() };
    handlers["will-attach-webview"](wrongPart, {}, { partition: partitionOf(SLUG, "other-board"), src: "crewapp://research/notes-board/" });
    expect(wrongPart.preventDefault).toHaveBeenCalled();

    const editor = { preventDefault: vi.fn() };
    handlers["will-attach-webview"](editor, {}, { partition: "persist:editor", src: "https://example.com" });
    expect(editor.preventDefault).not.toHaveBeenCalled();
  });

  it("denies windows and navigation away from the app", () => {
    writeApp(MANIFEST);
    const handlers: Record<string, (...a: any[]) => void> = {};
    const win = { webContents: { on: (ev: string, fn: (...a: any[]) => void) => (handlers[ev] = fn) } };
    svc.guard(win);
    const wc = fakeWc(30, appSession().ses);
    handlers["did-attach-webview"]({}, wc);
    expect(wc.setWindowOpenHandler).toHaveBeenCalled();
    expect(wc.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: "deny" });
    const inside = { preventDefault: vi.fn() };
    wc.emit("will-navigate", inside, "crewapp://research/notes-board/other.html");
    expect(inside.preventDefault).not.toHaveBeenCalled();
    const outside = { preventDefault: vi.fn() };
    wc.emit("will-navigate", outside, "https://example.com/");
    expect(outside.preventDefault).toHaveBeenCalled();
  });
});

describe("which webviews and sessions are an app's", () => {
  it("knows an app's partition and session, and nothing else", () => {
    writeApp(MANIFEST);
    expect(svc.ownsPartition("crewapp-research-notes-board")).toBe(true);
    expect(svc.ownsPartition("persist:editor")).toBe(false);
    expect(svc.ownsSession(appSession().ses)).toBe(true);
    expect(svc.ownsSession({})).toBe(false);
  });
});

describe("the sample notes board shipped in examples/", () => {
  it("has a manifest that passes every rule, with its one tool", () => {
    const dir = path.resolve(__dirname, "../../../examples/sample-crew/bots/research/workspace/Apps/notes-board");
    const { app, problems } = parseAppManifest(readFileSync(path.join(dir, "app.json"), "utf8"));
    expect(problems).toEqual([]);
    expect(app?.name).toBe("notes-board");
    expect(app?.tools.map((t) => t.name)).toEqual(["add_note"]);
    expect(existsSync(path.join(dir, app!.entry))).toBe(true);
  });
});
