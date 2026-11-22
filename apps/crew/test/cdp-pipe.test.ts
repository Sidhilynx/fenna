import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createPipeConnection } = require("../src/main/cdp-pipe.cjs");

/**
 * A fake Chrome. `out` is what the connection writes (Chrome reads it) and
 * `inn` is what Chrome writes (the connection reads it). `sent` yields the
 * commands the connection wrote, in order; `reply` writes one message back.
 */
function fakeChrome() {
  const out = new PassThrough();
  const inn = new PassThrough();
  out.setEncoding("utf8");
  const frames: any[] = [];
  const waiting: Array<(msg: any) => void> = [];
  let raw = "";
  out.on("data", (chunk: string) => {
    raw += chunk;
    let end: number;
    while ((end = raw.indexOf("\0")) !== -1) {
      frames.push(JSON.parse(raw.slice(0, end)));
      raw = raw.slice(end + 1);
    }
    while (waiting.length && frames.length) waiting.shift()!(frames.shift());
  });
  const sent = () => (frames.length ? Promise.resolve(frames.shift()) : new Promise<any>((resolve) => waiting.push(resolve)));
  const reply = (msg: object) => inn.write(JSON.stringify(msg) + "\0");
  return { out, inn, sent, reply };
}

describe("CDP over a pipe: requests and replies", () => {
  it("sends a command with a fresh id and resolves with the reply's result", async () => {
    const chrome = fakeChrome();
    const conn = createPipeConnection(chrome.out, chrome.inn);
    const result = conn.send("Target.getTargets");
    const command = await chrome.sent();
    expect(command).toEqual({ id: 1, method: "Target.getTargets", params: {} });
    chrome.reply({ id: 1, result: { targetInfos: [] } });
    await expect(result).resolves.toEqual({ targetInfos: [] });
    conn.close();
  });

  it("matches replies to their sends by id when they come back out of order", async () => {
    const chrome = fakeChrome();
    const conn = createPipeConnection(chrome.out, chrome.inn);
    const first = conn.send("Page.navigate", { url: "a" });
    const second = conn.send("Page.navigate", { url: "b" });
    const a = await chrome.sent();
    const b = await chrome.sent();
    expect(a.id).not.toBe(b.id);
    chrome.reply({ id: b.id, result: { frameId: "B" } });
    chrome.reply({ id: a.id, result: { frameId: "A" } });
    await expect(second).resolves.toEqual({ frameId: "B" });
    await expect(first).resolves.toEqual({ frameId: "A" });
    conn.close();
  });

  it("passes the session id on the command, and leaves it out when there is none", async () => {
    const chrome = fakeChrome();
    const conn = createPipeConnection(chrome.out, chrome.inn);
    const inSession = conn.send("Runtime.evaluate", { expression: "1" }, "session-7");
    const command = await chrome.sent();
    expect(command).toEqual({ id: 1, method: "Runtime.evaluate", params: { expression: "1" }, sessionId: "session-7" });
    chrome.reply({ id: 1, result: {} });
    await inSession;
    const plain = conn.send("Browser.getVersion");
    const bare = await chrome.sent();
    expect(bare).not.toHaveProperty("sessionId");
    expect(bare.params).toEqual({});
    chrome.reply({ id: bare.id, result: {} });
    await plain;
    conn.close();
  });

  it("rejects with the method and the error message when a reply has an error", async () => {
    const chrome = fakeChrome();
    const conn = createPipeConnection(chrome.out, chrome.inn);
    const result = conn.send("Page.navigate", { url: "x" });
    const command = await chrome.sent();
    chrome.reply({ id: command.id, error: { code: -32000, message: "Cannot navigate to invalid URL" } });
    await expect(result).rejects.toThrow("Page.navigate: Cannot navigate to invalid URL");
    conn.close();
  });
});

describe("CDP over a pipe: events", () => {
  it("passes events, with their session id, to every listener", async () => {
    const chrome = fakeChrome();
    const conn = createPipeConnection(chrome.out, chrome.inn);
    const heard: any[] = [];
    conn.on((e: any) => heard.push(["a", e]));
    conn.on((e: any) => heard.push(["b", e]));
    chrome.reply({ method: "Runtime.consoleAPICalled", params: { type: "log" }, sessionId: "s1" });
    await new Promise((r) => setTimeout(r, 20));
    expect(heard).toEqual([
      ["a", { method: "Runtime.consoleAPICalled", params: { type: "log" }, sessionId: "s1" }],
      ["b", { method: "Runtime.consoleAPICalled", params: { type: "log" }, sessionId: "s1" }],
    ]);
    conn.close();
  });

  it("keeps the other listeners going when one throws", async () => {
    const chrome = fakeChrome();
    const conn = createPipeConnection(chrome.out, chrome.inn);
    const heard: string[] = [];
    conn.on(() => {
      throw new Error("boom");
    });
    conn.on((e: any) => heard.push(e.method));
    chrome.reply({ method: "Page.loadEventFired", params: {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(heard).toEqual(["Page.loadEventFired"]);
    conn.close();
  });

  it("stops calling a listener after its off() runs", async () => {
    const chrome = fakeChrome();
    const conn = createPipeConnection(chrome.out, chrome.inn);
    const heard: string[] = [];
    const off = conn.on((e: any) => heard.push(e.method));
    chrome.reply({ method: "one", params: {} });
    await new Promise((r) => setTimeout(r, 20));
    off();
    chrome.reply({ method: "two", params: {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(heard).toEqual(["one"]);
    conn.close();
  });
});

describe("CDP over a pipe: framing", () => {
  it("reads a message that arrives split over several chunks", async () => {
    const chrome = fakeChrome();
    const conn = createPipeConnection(chrome.out, chrome.inn);
    const result = conn.send("Browser.getVersion");
    const command = await chrome.sent();
    const bytes = Buffer.from(JSON.stringify({ id: command.id, result: { product: "Chrome/200" } }) + "\0");
    chrome.inn.write(bytes.subarray(0, 10));
    chrome.inn.write(bytes.subarray(10));
    await expect(result).resolves.toEqual({ product: "Chrome/200" });
    conn.close();
  });

  it("reads two messages that arrive in one chunk", async () => {
    const chrome = fakeChrome();
    const conn = createPipeConnection(chrome.out, chrome.inn);
    const one = conn.send("A.one");
    const two = conn.send("A.two");
    const a = await chrome.sent();
    const b = await chrome.sent();
    chrome.inn.write(JSON.stringify({ id: a.id, result: "first" }) + "\0" + JSON.stringify({ id: b.id, result: "second" }) + "\0");
    await expect(one).resolves.toBe("first");
    await expect(two).resolves.toBe("second");
    conn.close();
  });

  it("joins a multi-byte character that is split across two chunks", async () => {
    const chrome = fakeChrome();
    const conn = createPipeConnection(chrome.out, chrome.inn);
    const result = conn.send("Runtime.evaluate");
    const command = await chrome.sent();
    const bytes = Buffer.from(JSON.stringify({ id: command.id, result: { value: "café 😀 done" } }) + "\0");
    // Cut inside the four-byte emoji, so neither chunk decodes alone.
    const cut = bytes.indexOf(Buffer.from("😀")) + 2;
    chrome.inn.write(bytes.subarray(0, cut));
    chrome.inn.write(bytes.subarray(cut));
    await expect(result).resolves.toEqual({ value: "café 😀 done" });
    conn.close();
  });

  it("skips a frame that is not JSON and keeps going", async () => {
    const chrome = fakeChrome();
    const conn = createPipeConnection(chrome.out, chrome.inn);
    const result = conn.send("Page.enable");
    const command = await chrome.sent();
    chrome.inn.write("this is not json\0\0" + JSON.stringify({ id: command.id, result: { ok: true } }) + "\0");
    await expect(result).resolves.toEqual({ ok: true });
    conn.close();
  });
});

describe("CDP over a pipe: closing", () => {
  it("rejects pending sends and later sends when close() is called", async () => {
    const chrome = fakeChrome();
    const conn = createPipeConnection(chrome.out, chrome.inn);
    const pending = conn.send("Page.navigate", { url: "x" });
    conn.close();
    await expect(pending).rejects.toThrow("Chrome closed.");
    await expect(conn.send("Page.reload")).rejects.toThrow("Chrome closed.");
    await expect(conn.closed).resolves.toBeUndefined();
  });

  it("can be closed twice", async () => {
    const chrome = fakeChrome();
    const conn = createPipeConnection(chrome.out, chrome.inn);
    conn.close();
    expect(() => conn.close()).not.toThrow();
    await expect(conn.closed).resolves.toBeUndefined();
  });

  it("resolves closed and rejects pending sends when the input stream ends", async () => {
    const chrome = fakeChrome();
    const conn = createPipeConnection(chrome.out, chrome.inn);
    const pending = conn.send("Target.attachToTarget");
    chrome.inn.end();
    await expect(conn.closed).resolves.toBeUndefined();
    await expect(pending).rejects.toThrow("Chrome closed.");
    await expect(conn.send("Target.detachFromTarget")).rejects.toThrow("Chrome closed.");
  });
});
