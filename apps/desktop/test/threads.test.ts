import { describe, expect, it } from "vitest";
import { parseSlide, valueContext } from "@opendeck/format";
import { anchorOf, parseComments, serializeComments, type Thread } from "../src/renderer/editor/threads.ts";

const ctx = valueContext({ format: "fenna-slides/0", title: "t", slides: [], sections: [], theme: { colors: {}, fonts: [], textStyles: {} } });
const slide = (body: string) => {
  const r = parseSlide(`<section id="s">${body}</section>`, ctx);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.slide;
};

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: "t1",
  slide: "s",
  addr: "1",
  snippet: "Second",
  resolved: false,
  comments: [{ id: "c1", author: "you", text: "make it shorter", at: 1 }],
  ...over,
});

describe("comments.json", () => {
  it("round-trips threads", () => {
    const t = [thread({ session: { kind: "claude", id: "abc-1" } })];
    expect(parseComments(serializeComments(t))).toEqual(t);
  });
  it("treats a missing, empty or damaged file as no threads", () => {
    expect(parseComments(null)).toEqual([]);
    expect(parseComments("")).toEqual([]);
    expect(parseComments("{not json")).toEqual([]);
    expect(parseComments('{"threads": 3}')).toEqual([]);
  });
  it("drops malformed threads and comments, keeps the rest", () => {
    const text = JSON.stringify({
      threads: [
        thread(),
        { ...thread({ id: "bad-addr" }), addr: "1..2" },
        { ...thread({ id: "no-comments" }), comments: [] },
        { ...thread({ id: "mixed" }), comments: [{ id: "x", author: "robot", text: "?", at: 1 }, { id: "y", author: "ai", text: "ok", at: 2 }] },
        null,
      ],
    });
    const got = parseComments(text);
    expect(got.map((t) => t.id)).toEqual(["t1", "mixed"]);
    expect(got[1]!.comments.map((c) => c.id)).toEqual(["y"]);
  });
});

describe("anchorOf (which element a thread points at now)", () => {
  it("keeps its address while the element there has the same text", () => {
    expect(anchorOf(slide("<p>First</p><p>Second</p>"), thread())).toBe("1");
  });
  it("follows the element when others are inserted before it", () => {
    expect(anchorOf(slide("<p>New</p><p>First</p><p>Second</p>"), thread())).toBe("2");
  });
  it("finds it inside a group, preferring the depth it had", () => {
    expect(anchorOf(slide("<div><p>Second</p></div>"), thread({ addr: "0.0" }))).toBe("0.0");
    expect(anchorOf(slide("<p>x</p><div><p>Second</p></div>"), thread({ addr: "0" }))).toBe("1");
  });
  it("stays put when the element's own text was edited", () => {
    expect(anchorOf(slide("<p>First</p><p>Shorter</p>"), thread())).toBe("1");
  });
  it("falls back to the slide when the element is gone", () => {
    expect(anchorOf(slide("<p>Only</p>"), thread({ addr: "4" }))).toBe("");
  });
  it("a thread on the slide stays on the slide", () => {
    expect(anchorOf(slide("<p>Second</p>"), thread({ addr: "", snippet: "" }))).toBe("");
  });
});
