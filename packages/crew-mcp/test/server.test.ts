import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { checkIndex, parseTab } from "@opendeck/doc";
import { connectLink, createBrowserServer, createCrewServer, createGatewayServer, type Link, type LinkResult } from "../src/index.ts";
import { connectServer, explainError } from "../src/client.ts";

const NOTES_SERVER = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "fixtures", "notes-server.mjs");

let dir: string;
let calls: { method: string; params: Record<string, unknown> }[];
let answer: (method: string, params: Record<string, unknown>) => LinkResult | Promise<LinkResult>;
const link: Link = {
  call: async (method, params) => {
    calls.push({ method, params });
    return answer(method, params);
  },
};

async function connect(which: "crew" | "browser" | "gateway") {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await (which === "crew" ? createCrewServer(link, { library: path.join(dir, "library") }) : which === "gateway" ? createGatewayServer(link) : createBrowserServer(link)).connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return client;
}

type Result = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as Result;
  const t = r.content.find((c) => c.type === "text");
  return { text: t && t.type === "text" ? t.text : "", isError: !!r.isError, content: r.content };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "crew-mcp-"));
  calls = [];
  answer = () => ({ text: "ok" });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("crew server", () => {
  it("offers the brief's tools, each described for the model with an example", async () => {
    const c = await connect("crew");
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["ask_human", "create_bot", "desktop", "export_file", "import_sheet", "message_bot", "new_document", "read_file", "remember", "request_approval", "search_files", "set_status", "terminal", "todo", "watch"]);
    for (const t of tools) expect(t.description, t.name).toMatch(/Example: \{/);
  });

  it("forwards watch and todo calls to the app, and refuses a kind it does not know", async () => {
    const c = await connect("crew");
    await call(c, "watch", { action: "add", kind: "notification", origin: "https://web.whatsapp.com", match: "Sam", note: "Reply to Sam if he asks something" });
    await call(c, "watch", { action: "add", kind: "timer", in: 30, every: 10, note: "Check the sheet" });
    await call(c, "todo", { action: "done", id: "a1b2c3" });
    expect(calls).toEqual([
      { method: "watch", params: { action: "add", kind: "notification", origin: "https://web.whatsapp.com", match: "Sam", note: "Reply to Sam if he asks something" } },
      { method: "watch", params: { action: "add", kind: "timer", in: 30, every: 10, note: "Check the sheet" } },
      { method: "todo", params: { action: "done", id: "a1b2c3" } },
    ]);
    const bad = await call(c, "watch", { action: "add", kind: "email", note: "x" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/kind/);
    expect(calls).toHaveLength(3);
  });

  it("passes each call to the app and returns its words", async () => {
    const c = await connect("crew");
    answer = (m) => ({ text: m === "ask" ? "The person chose: Work" : "Approved." });
    expect((await call(c, "ask_human", { question: "Which?", options: ["Work", "Personal"] })).text).toBe("The person chose: Work");
    await call(c, "request_approval", { action: "Send the reply" });
    await call(c, "set_status", { status: "Reading mail", mood: "work" });
    await call(c, "create_bot", { name: "Research", job: "Checks prices", ask_before: ["Buying"] });
    expect(calls.map((x) => x.method)).toEqual(["ask", "approval", "status", "create_bot"]);
    expect(calls[0]!.params).toEqual({ question: "Which?", options: ["Work", "Personal"], multi: false });
    expect(calls[1]!.params).toEqual({ action: "Send the reply", details: "" });
    expect(calls[3]!.params).toMatchObject({ schedule: "manual", cli: null, connectors: null, askBefore: ["Buying"] });
  });

  it("refuses unknown arguments and bad values, saying what it takes", async () => {
    const c = await connect("crew");
    const r = await call(c, "remember", { text: "x" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/remember has no argument "text"; it takes note/);
    const m = await call(c, "set_status", { status: "x", mood: "happy" });
    expect(m.isError).toBe(true);
    const o = await call(c, "ask_human", { question: "Pick", options: ["only one"] });
    expect(o.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it("returns the app's refusal as an error the model can read", async () => {
    const c = await connect("crew");
    answer = () => {
      throw new Error('There is no bot "reserch". Bots: research, inbox.');
    };
    const r = await call(c, "message_bot", { bot: "reserch", message: "hi" });
    expect(r).toMatchObject({ isError: true, text: 'There is no bot "reserch". Bots: research, inbox.' });
  });

  it("hands files to another bot as paths, and refuses more than the hand-off allows", async () => {
    const c = await connect("crew");
    await call(c, "message_bot", { bot: "inbox", message: "Sort these", files: ["Files/notes/a.txt", "Documents/q3-report"] });
    await call(c, "message_bot", { bot: "inbox", message: "Plain" });
    expect(calls.map((x) => x.params)).toEqual([
      { bot: "inbox", message: "Sort these", files: ["Files/notes/a.txt", "Documents/q3-report"] },
      { bot: "inbox", message: "Plain", files: [] },
    ]);
    const tooMany = await call(c, "message_bot", { bot: "inbox", message: "x", files: Array.from({ length: 21 }, (_, i) => `Files/f${i}.txt`) });
    expect(tooMany.isError).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("makes a doc with content in the library that the doc format reads cleanly", async () => {
    const c = await connect("crew");
    const r = await call(c, "new_document", { kind: "doc", title: "Example.com check", html: "<p>The page says hello.</p><p>No change.</p><p>Checked today.</p>" });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/at path "example-com-check" \(tab-1 with 3 blocks\)/);
    const root = path.join(dir, "library", "example-com-check");
    expect(checkIndex(JSON.parse(await readFile(path.join(root, "doc.json"), "utf8"))).errors).toEqual([]);
    const tab = parseTab(await readFile(path.join(root, "tabs", "tab-1.html"), "utf8"));
    expect(tab.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(calls).toEqual([{ method: "library_changed", params: { path: "example-com-check" } }]);
    const again = await call(c, "new_document", { kind: "doc", title: "Example.com check" });
    expect(again.text).toMatch(/path "example-com-check-2"/);
    await call(c, "new_document", { kind: "sheet", title: "Prices" });
    await call(c, "new_document", { kind: "deck", title: "Weekly" });
    expect((await readdir(path.join(dir, "library"))).sort()).toEqual(["example-com-check", "example-com-check-2", "prices", "weekly"]);
    const bad = await call(c, "new_document", { kind: "sheet", title: "X", html: "<p>x</p>" });
    expect(bad).toMatchObject({ isError: true, text: expect.stringMatching(/only for docs/) });
  });
});

describe("browser server", () => {
  it("offers the brief's browser tools and checks refs before asking the app", async () => {
    const c = await connect("browser");
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["back", "click", "close_tab", "fill_code", "logins", "notifications", "open", "press", "screenshot", "scroll", "sign_in", "snapshot", "switch_tab", "tabs", "type"]);
    for (const t of tools) expect(t.description, t.name).toMatch(/Example: \{/);
    const r = await call(c, "click", { ref: "12" });
    expect(r).toMatchObject({ isError: true, text: expect.stringMatching(/A ref looks like e12/) });
    await call(c, "type", { ref: "e3", text: "hi" });
    expect(calls).toEqual([{ method: "browser.type", params: { ref: "e3", text: "hi", submit: false } }]);
  });

  it("asks the app to sign in and fill codes by login name, never taking a password", async () => {
    const c = await connect("browser");
    const { tools } = await c.listTools();
    const signIn = tools.find((t) => t.name === "sign_in")!;
    expect(Object.keys(signIn.inputSchema.properties ?? {}).sort()).toEqual(["login", "password_ref", "submit", "username_ref"]);
    await call(c, "logins");
    await call(c, "sign_in", { login: "test-site", submit: true });
    await call(c, "fill_code", { login: "test-site" });
    expect(calls).toEqual([
      { method: "browser.logins", params: {} },
      { method: "browser.sign_in", params: { login: "test-site", submit: true, username_ref: null, password_ref: null } },
      { method: "browser.fill_code", params: { login: "test-site", ref: null, submit: false } },
    ]);
    const r = await call(c, "sign_in", { login: "test-site", password: "hunter2" });
    expect(r).toMatchObject({ isError: true, text: expect.stringContaining('sign_in has no argument "password"') });
  });

  it("returns screenshots as images and the person's control as a plain error", async () => {
    const c = await connect("browser");
    answer = (m) => {
      if (m === "browser.screenshot") return { text: "1280×800", image: { data: "aGk=", mimeType: "image/jpeg" } };
      throw new Error("The person has control of the browser. Wait, then call snapshot again.");
    };
    const shot = await call(c, "screenshot");
    expect(shot.content[0]).toEqual({ type: "image", data: "aGk=", mimeType: "image/jpeg" });
    const r = await call(c, "snapshot");
    expect(r).toMatchObject({ isError: true, text: "The person has control of the browser. Wait, then call snapshot again." });
  });
});

describe("link to the app", () => {
  it("sends the run's token with every call over a local socket and reads answers in any order", async () => {
    const pipe = process.platform === "win32" ? `\\\\.\\pipe\\crew-test-${process.pid}-${Date.now()}` : path.join(dir, "s.sock");
    const seen: unknown[] = [];
    const server = net.createServer((s) => {
      let buf = "";
      s.on("data", (d) => {
        buf += d;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const msg = JSON.parse(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
          seen.push(msg);
          const reply = msg.method === "fail" ? { id: msg.id, error: "No." } : { id: msg.id, result: { text: `got ${msg.method}` } };
          setTimeout(() => s.write(JSON.stringify(reply) + "\n"), msg.method === "slow" ? 50 : 0);
        }
      });
    });
    await new Promise<void>((r) => server.listen(pipe, r));
    const l = connectLink(pipe, "secret");
    const [slow, fast] = await Promise.all([l.call("slow", {}), l.call("fast", { a: 1 })]);
    expect([slow.text, fast.text]).toEqual(["got slow", "got fast"]);
    await expect(l.call("fail", {})).rejects.toThrow("No.");
    expect(seen[1]).toEqual({ id: 2, token: "secret", method: "fast", params: { a: 1 } });
    server.close();
    const gone = connectLink(pipe + "-missing", "t");
    await expect(gone.call("x", {})).rejects.toThrow(/Fenna Crew is not running/);
  });
});

describe("gateway server", () => {
  it("lists only what the app gives for this run, and passes calls and their content through", async () => {
    answer = (m, p) => {
      if (m === "gateway.list") return { text: "", data: { tools: [{ name: "notes__list_notes", description: "Lists every note.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }] } };
      if (m === "gateway.call" && p.name === "notes__list_notes") return { text: "", data: { content: [{ type: "text", text: "1. milk" }], isError: false } };
      throw new Error("Denied by the person. Don't do it, and don't try another way.");
    };
    const c = await connect("gateway");
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name)).toEqual(["notes__list_notes"]);
    expect(tools[0]!.annotations).toEqual({ readOnlyHint: true });
    expect(await call(c, "notes__list_notes")).toMatchObject({ text: "1. milk", isError: false });
    expect(calls.at(-1)).toEqual({ method: "gateway.call", params: { name: "notes__list_notes", arguments: {} } });
    const denied = await call(c, "notes__add_note", { text: "x" });
    expect(denied).toMatchObject({ isError: true, text: "Denied by the person. Don't do it, and don't try another way." });
    expect(calls.at(-1)!.params).toEqual({ name: "notes__add_note", arguments: { text: "x" } });
  });

  it("lists nothing when the app can't be reached", async () => {
    answer = () => {
      throw new Error("This run has ended, so its tools no longer work. Finish your reply.");
    };
    const c = await connect("gateway");
    expect((await c.listTools()).tools).toEqual([]);
  });
});

describe("connector client", () => {
  it("starts a stdio connector, lists its tools with their hints, calls one, and closes", async () => {
    const conn = await connectServer({ name: "notes", command: process.execPath, args: [NOTES_SERVER], env: { NOTES_TOKEN: "t", NOTES_DIR: dir } });
    const tools = await conn.listTools();
    expect(tools.map((t) => t.name)).toEqual(["list_notes", "add_note", "clear_notes"]);
    expect(tools[0]).toMatchObject({ title: "List notes", annotations: { readOnlyHint: true } });
    expect(tools[1]!.inputSchema).toMatchObject({ type: "object", properties: { text: { type: "string" } } });
    expect(await conn.callTool("add_note", { text: "milk" })).toEqual({ content: [{ type: "text", text: "Added. There are 1 notes." }], isError: false });
    expect(await readFile(path.join(dir, "notes.txt"), "utf8")).toBe("milk\n");
    await conn.close();
  }, 20_000);

  it("says what went wrong in words that say how to fix it", async () => {
    await expect(connectServer({ name: "notes", command: process.execPath, args: [NOTES_SERVER], env: { NOTES_DIR: dir } })).rejects.toThrow(/stopped before it answered\. It said: NOTES_TOKEN is not set/);
    await expect(connectServer({ name: "x", command: "fenna-no-such-program-here" })).rejects.toThrow(/isn't installed, or isn't on this computer's PATH/);
    expect(explainError({ message: "Error POSTing to endpoint (HTTP 401)", code: 401 }, { name: "x", url: "https://mcp.example.com/mcp" })).toMatch(/mcp\.example\.com says this needs signing in \(401\).*Authorization/);
    expect(explainError({ message: "HTTP 404", code: 404 }, { name: "x", url: "https://mcp.example.com/x" })).toMatch(/Nothing at that address speaks MCP/);
    expect(explainError(new TypeError("fetch failed"), { name: "x", url: "https://nowhere.example/mcp" })).toBe("Couldn't reach nowhere.example. Check the address and your connection.");
  }, 20_000);

  it("tells when a started connector stops on its own", async () => {
    const conn = await connectServer({ name: "notes", command: process.execPath, args: [NOTES_SERVER, "--crash-after=1"], env: { NOTES_TOKEN: "t", NOTES_DIR: dir } });
    const exited = new Promise<string>((r) => conn.onExit(r));
    await conn.callTool("list_notes", {});
    await expect(conn.callTool("list_notes", {})).rejects.toThrow();
    expect(await exited).toMatch(/^It stopped\./);
  }, 20_000);
});
