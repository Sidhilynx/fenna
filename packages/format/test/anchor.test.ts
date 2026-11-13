import { describe, expect, it } from "vitest";
import { findByWords, getAt, parseSlide, wordsOf } from "../src/index.ts";

const slide = (body: string) => {
  const r = parseSlide(`<section id="s">${body}</section>`);
  if (!r.slide) throw new Error(JSON.stringify(r.diagnostics));
  return r.slide;
};

describe("wordsOf", () => {
  it("keeps blocks, items and cells apart, and inline marks together", () => {
    const s = slide(`<div><p>Today</p><h3>Each <b>lab</b>ships</h3></div><ul><li>One</li><li>Two</li></ul><table><tr><td>A</td><td>B</td></tr></table><aside>notes</aside>`);
    expect(wordsOf(getAt(s, "0")!)).toBe("Today Each labships");
    expect(wordsOf(getAt(s, "1")!)).toBe("One Two");
    expect(wordsOf(getAt(s, "2")!)).toBe("A B");
    expect(wordsOf(s)).toBe("Today Each labships One Two A B");
  });
});

describe("findByWords", () => {
  const s = slide(`<div><h3>Q3 revenue</h3><p>Up from Q2</p></div><p>Q3 revenue grew</p>`);
  it("finds the innermost element, ignoring case and spacing", () => {
    expect(findByWords(s, "up  FROM q2")).toEqual(["0.1"]);
  });
  it("returns every innermost match, and none for missing words", () => {
    expect(findByWords(s, "Q3 revenue")).toEqual(["0.0", "1"]);
    expect(findByWords(s, "nowhere")).toEqual([]);
    expect(findByWords(s, "  ")).toEqual([]);
  });
});
