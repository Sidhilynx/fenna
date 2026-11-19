import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { appendComment, commentPrompt, embedChannels } = require("../src/main/editors.cjs");

const thread = (id: string, texts: string[]) => ({ id, resolved: false, comments: texts.map((text, i) => ({ id: `${id}-${i}`, author: "you", text, at: i + 1 })) });

describe("appendComment", () => {
  const file = JSON.stringify({ version: 1, threads: [thread("t1", ["hello"]), thread("t2", ["other"])] }, null, 2);
  const reply = { id: "r1", author: "ai", text: "Done.", at: 99 };

  it("adds the comment to the end of its thread and leaves the rest alone", () => {
    const out = JSON.parse(appendComment(file, "t1", reply));
    expect(out.version).toBe(1);
    expect(out.threads[0].comments.map((c: { text: string }) => c.text)).toEqual(["hello", "Done."]);
    expect(out.threads[1]).toEqual(JSON.parse(file).threads[1]);
  });

  it("ends with a newline, as the editors write it", () => {
    expect(appendComment(file, "t1", reply)!.endsWith("}\n")).toBe(true);
  });

  it("keeps fields it does not know", () => {
    const withExtra = JSON.stringify({ version: 1, note: "kept", threads: [thread("t1", ["a"])] });
    expect(JSON.parse(appendComment(withExtra, "t1", reply)!).note).toBe("kept");
  });

  it("gives null when there is no file, no such thread, or the file is damaged", () => {
    expect(appendComment(null, "t1", reply)).toBeNull();
    expect(appendComment(file, "nope", reply)).toBeNull();
    expect(appendComment("{not json", "t1", reply)).toBeNull();
    expect(appendComment(JSON.stringify({ threads: "x" }), "t1", reply)).toBeNull();
  });
});

describe("commentPrompt", () => {
  it("says what the comment is on and asks for the reply in the thread", () => {
    const p = commentPrompt({ title: "Q3 plan", kind: "doc", item: "q3.doc" }, "Shorten this", "the first paragraph");
    expect(p.startsWith('Comment on "Q3 plan" (doc, Documents/q3.doc) on: "the first paragraph": Shorten this')).toBe(true);
    expect(p).toContain("Answer in your reply (it is posted back in the comment thread).");
  });

  it("leaves out the quote when there is none", () => {
    expect(commentPrompt({ title: "T", kind: "sheet", item: "t.sheet" }, "Hi", "")).toMatch(/^Comment on "T" \(sheet, Documents\/t\.sheet\): Hi/);
  });
});

describe("embed channels", () => {
  let root: string;
  let finish: (v: { outcome: string; text: string; message: string | null }) => void;
  let enqueue: ReturnType<typeof vi.fn>;
  let crew: object;
  let bound: Map<number, object>;
  const sender = { id: 7 };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  const readComments = () => JSON.parse(readFileSync(path.join(root, "comments.json"), "utf8"));

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "crew-embed-"));
    writeFileSync(path.join(root, "comments.json"), JSON.stringify({ version: 1, threads: [thread("t1", ["Tighten this"])] }));
    const done = new Promise<{ outcome: string; text: string; message: string | null }>((r) => (finish = r));
    enqueue = vi.fn(() => ({ runId: "run-1", queued: false, done }));
    crew = {
      store: { readBot: (slug: string) => (slug === "ada" ? { bot: { name: "Ada" } } : null) },
      runner: { enqueue },
    };
    bound = new Map([[7, { slug: "ada", item: "q3.doc", kind: "doc", root, title: "Q3 plan", undo: () => {} }]]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("gives the bot's name to the page that shows its document", () => {
    const ch = embedChannels({ crew, bound });
    expect(ch.host(sender)).toEqual({ bot: "Ada" });
  });

  it("falls back to a plain name when the bot has none", () => {
    bound.set(8, { slug: "gone", item: "q3.doc", kind: "doc", root, title: "Q3", undo: () => {} });
    expect(embedChannels({ crew, bound }).host({ id: 8 })).toEqual({ bot: "the bot" });
  });

  it("refuses a page that shows no document", () => {
    const ch = embedChannels({ crew, bound });
    expect(() => ch.host({ id: 99 })).toThrow("Not allowed from this page.");
    expect(() => ch.comment({ id: 99 }, { thread: "t1", text: "x" })).toThrow("Not allowed from this page.");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("sends the comment to the bot as a person's message, with the quote capped at 500", () => {
    const ch = embedChannels({ crew, bound });
    const quote = "q".repeat(600);
    const out = ch.comment(sender, { thread: "t1", text: "  Tighten this  ", quote });
    expect(out).toEqual({ runId: "run-1", queued: false });
    const arg = enqueue.mock.calls[0]![0];
    expect(arg.slug).toBe("ada");
    expect(arg.trigger).toBe("person");
    expect(arg.text).toContain('Comment on "Q3 plan" (doc, Documents/q3.doc) on: "' + "q".repeat(500) + '": Tighten this');
    expect(arg.text).not.toContain("q".repeat(501));
  });

  it("adds the bot's reply to the thread when the run ends", async () => {
    embedChannels({ crew, bound }).comment(sender, { thread: "t1", text: "Tighten this" });
    finish({ outcome: "done", text: "I tightened the first sentence.", message: null });
    await flush();
    const c = readComments().threads[0].comments;
    expect(c.at(-1)).toMatchObject({ author: "ai", text: "I tightened the first sentence." });
    expect(c.at(-1).error).toBeUndefined();
  });

  it("says why when the run fails, as an error comment", async () => {
    embedChannels({ crew, bound }).comment(sender, { thread: "t1", text: "Tighten this" });
    finish({ outcome: "error", text: "", message: "The CLI stopped with an error." });
    await flush();
    expect(readComments().threads[0].comments.at(-1)).toMatchObject({ author: "ai", text: "Couldn’t answer: The CLI stopped with an error.", error: true });
  });

  it("treats an empty reply as a failed answer", async () => {
    embedChannels({ crew, bound }).comment(sender, { thread: "t1", text: "Tighten this" });
    finish({ outcome: "done", text: "   ", message: null });
    await flush();
    expect(readComments().threads[0].comments.at(-1)).toMatchObject({ error: true, text: "Couldn’t answer: the bot stopped before it replied." });
  });

  it("refuses a comment with no thread, no text, or a bad thread id", () => {
    const ch = embedChannels({ crew, bound });
    expect(() => ch.comment(sender, { text: "x" })).toThrow("That comment isn't on this document.");
    expect(() => ch.comment(sender, { thread: "../t1", text: "x" })).toThrow("That comment isn't on this document.");
    expect(() => ch.comment(sender, { thread: "t1", text: "   " })).toThrow("The comment is empty.");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("lets a bot that is gone fail the call instead of the page", () => {
    bound.set(7, { slug: "gone", item: "q3.doc", kind: "doc", root, title: "Q3", undo: () => {} });
    enqueue.mockImplementation(() => {
      throw new Error('There is no bot "gone".');
    });
    expect(() => embedChannels({ crew, bound }).comment(sender, { thread: "t1", text: "x" })).toThrow('There is no bot "gone".');
  });

  it("drops the answer quietly when the document is gone", async () => {
    embedChannels({ crew, bound }).comment(sender, { thread: "t1", text: "Tighten this" });
    rmSync(root, { recursive: true, force: true });
    finish({ outcome: "done", text: "ok", message: null });
    await flush();
    expect(() => readComments()).toThrow();
  });
});
