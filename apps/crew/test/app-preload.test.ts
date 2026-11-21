import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// The preload is self-contained (a sandboxed preload can require only electron),
// so the test runs it as a script with a fake electron and reads what it exposes.
const SRC = readFileSync(path.resolve(__dirname, "../src/main/app-preload.cjs"), "utf8");

type Info = { name: string; title: string; bot: boolean; documents: "none" | "read" | "write"; network: string[] } | null;

function load(info: Info) {
  const exposed: Record<string, unknown> = {};
  const invokes: Array<{ channel: string; args: unknown[] }> = [];
  const listeners: Record<string, (e: unknown, msg: any) => unknown> = {};
  const sent: Array<{ channel: string; msg: unknown }> = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (key: string, value: unknown) => (exposed[key] = value) },
    ipcRenderer: {
      sendSync: vi.fn(() => info),
      invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
        invokes.push({ channel, args });
        return "ok";
      }),
      on: (channel: string, fn: (e: unknown, msg: any) => unknown) => (listeners[channel] = fn),
      send: (channel: string, msg: unknown) => sent.push({ channel, msg }),
    },
  };
  const fakeRequire = (name: string) => {
    if (name === "electron") return electron;
    throw new Error(`the preload may not require ${name}`);
  };
  new Function("require", "module", SRC)(fakeRequire, { exports: {} });
  return { crew: exposed.crew as any, invokes, listeners, sent };
}

const READ_ONLY: Info = { name: "notes-board", title: "Notes", bot: false, documents: "none", network: [] };

describe("what the page sees of crew", () => {
  it("exposes nothing to a page that is not an app", () => {
    expect(load(null).crew).toBeUndefined();
  });

  it("names the app", () => {
    expect(load(READ_ONLY).crew.app).toEqual({ name: "notes-board", title: "Notes", bot: false });
  });

  it("has no docs and no bot unless granted", () => {
    const { crew } = load(READ_ONLY);
    expect(crew.docs).toBeUndefined();
    expect(crew.bot).toBeUndefined();
  });

  it("has docs to read with read, and docs to change with write", () => {
    const read = load({ ...READ_ONLY, documents: "read" }).crew;
    expect(Object.keys(read.docs).sort()).toEqual(["list", "read"]);
    expect(read.docs.writeCells).toBeUndefined();
    const write = load({ ...READ_ONLY, documents: "write" }).crew;
    expect(typeof write.docs.writeCells).toBe("function");
  });

  it("has bot.tell only when the bot is granted", () => {
    expect(typeof load({ ...READ_ONLY, bot: true }).crew.bot.tell).toBe("function");
  });

  it("always has files and tools", () => {
    const { crew } = load(READ_ONLY);
    expect(Object.keys(crew.files).sort()).toEqual(["list", "read", "write"]);
    expect(Object.keys(crew.tools)).toEqual(["define"]);
  });
});

describe("calls go to main with the operation's name", () => {
  it("reads, writes, lists and changes files by path", async () => {
    const { crew, invokes } = load(READ_ONLY);
    await crew.files.read("notes.json");
    await crew.files.write("notes.json", "[]");
    await crew.files.write("a.bin", new Uint8Array([1]));
    await crew.files.list();
    await crew.files.list("pages");
    expect(invokes.map((i) => [i.channel, i.args])).toEqual([
      ["crewapp:call", ["files.read", { path: "notes.json" }]],
      ["crewapp:call", ["files.write", { path: "notes.json", text: "[]" }]],
      ["crewapp:call", ["files.write", { path: "a.bin", bytes: new Uint8Array([1]) }]],
      ["crewapp:call", ["files.list", { path: "" }]],
      ["crewapp:call", ["files.list", { path: "pages" }]],
    ]);
  });

  it("sends bot messages and cell changes with their arguments", async () => {
    const { crew, invokes } = load({ ...READ_ONLY, documents: "write", bot: true });
    await crew.bot.tell("Ready");
    await crew.docs.writeCells("Documents/q3", "Sheet1", { A1: 2, B1: "=A1*2" });
    expect(invokes.slice(0, 2).map((i) => i.args)).toEqual([
      ["bot.tell", { text: "Ready" }],
      ["docs.writeCells", { path: "Documents/q3", sheet: "Sheet1", cells: { A1: 2, B1: "=A1*2" } }],
    ]);
  });
});

describe("crew.fetch", () => {
  it("is there only with a network grant, and sends the request to main", async () => {
    expect(load(READ_ONLY).crew.fetch).toBeUndefined();
    const { crew, invokes } = load({ ...READ_ONLY, network: ["https://api.example.com"] });
    await crew.fetch("https://api.example.com/q", { method: "POST", headers: { a: "b" }, body: "{}" });
    expect(invokes[0].args).toEqual(["net.fetch", { url: "https://api.example.com/q", method: "POST", headers: { a: "b" }, body: "{}" }]);
  });
});

describe("tools the page defines", () => {
  it("asks main first, then keeps the function to run when main calls", async () => {
    const { crew, invokes, listeners, sent } = load(READ_ONLY);
    const fn = vi.fn(async (input: { text: string }) => ({ echoed: input.text }));
    await crew.tools.define("add_note", fn);
    expect(invokes.at(-1)).toEqual({ channel: "crewapp:call", args: ["tools.define", { name: "add_note" }] });
    await listeners["crewapp:callTool"](null, { id: "1", name: "add_note", input: { text: "hi" } });
    expect(fn).toHaveBeenCalledWith({ text: "hi" });
    expect(sent.at(-1)).toEqual({ channel: "crewapp:toolResult", msg: { id: "1", ok: true, text: '{"echoed":"hi"}' } });
  });

  it("refuses a definition that is not a function", () => {
    const { crew } = load(READ_ONLY);
    expect(() => crew.tools.define("add_note", "nope")).toThrow(/Give the tool's code as a function/);
  });

  it("answers a result that is undefined with null, and an error with its message", async () => {
    const { crew, listeners, sent } = load(READ_ONLY);
    await crew.tools.define("quiet", async () => undefined);
    await crew.tools.define("broken", async () => {
      throw new Error("No notes yet.");
    });
    await listeners["crewapp:callTool"](null, { id: "a", name: "quiet", input: {} });
    await listeners["crewapp:callTool"](null, { id: "b", name: "broken", input: {} });
    expect(sent.map((s) => s.msg)).toEqual([
      { id: "a", ok: true, text: "null" },
      { id: "b", ok: false, error: "No notes yet." },
    ]);
  });

  it("answers a tool the page has not defined with an error", async () => {
    const { listeners, sent } = load(READ_ONLY);
    await listeners["crewapp:callTool"](null, { id: "c", name: "ghost", input: {} });
    expect(sent.at(-1)?.msg).toEqual({ id: "c", ok: false, error: "The app hasn't defined the tool ghost." });
  });

  it("answers a result that cannot be made into JSON with an error", async () => {
    const { crew, listeners, sent } = load(READ_ONLY);
    await crew.tools.define("big", async () => ({ n: BigInt(1) }));
    await listeners["crewapp:callTool"](null, { id: "d", name: "big", input: {} });
    expect(sent.at(-1)?.msg).toMatchObject({ id: "d", ok: false });
  });
});
