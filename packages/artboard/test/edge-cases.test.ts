import { describe, expect, it } from "vitest";
import { LIMITS, checkIndex, emptyIndex, loadDesign, parseArtboard, parseHistory, serializeArtboard, textStyleProblem, tweakProblem } from "../src/index.ts";

describe("edge cases", () => {
  it("reads an empty design: no artboards, one page", () => {
    const d = loadDesign((rel) => (rel === "design.json" ? JSON.stringify({ title: "Empty" }) : null));
    expect(d.broken).toBeNull();
    expect(d.index.order).toEqual([]);
    expect(d.index.pages).toEqual([{ id: "page-1", name: "Page 1" }]);
    expect(d.problems).toEqual([]);
  });

  it("marks a design whose design.json can't be read, so nothing is saved over it", () => {
    expect(loadDesign(() => null).broken).toBe("design.json is missing");
    expect(loadDesign((rel) => (rel === "design.json" ? "{ nope" : null)).broken).toMatch(/not valid JSON/);
  });

  it("lists an artboard whose file is missing or damaged, with the reason", () => {
    const index = { ...emptyIndex(), boards: { "A.html": { x: 0, y: 0, w: 100, h: 100, title: "A", page: "page-1" }, "B.html": { x: 0, y: 0, w: 100, h: 100, title: "B", page: "page-1" } }, order: ["A.html", "B.html"] };
    const d = loadDesign((rel) => (rel === "design.json" ? JSON.stringify(index) : rel === "artboards/B.html" ? "<div><iframe></iframe></div>" : null));
    expect(d.boards.get("A.html")!.broken).toBe("artboards/A.html is missing");
    expect(d.boards.get("B.html")!.doc).toBeNull();
    expect(d.problems.map((p) => p.where)).toEqual(["A.html:1", "B.html:1"]);
  });

  it("cuts a very long title and keeps text in any script", () => {
    const long = "T".repeat(500);
    expect(checkIndex({ title: long }).index.title).toHaveLength(LIMITS.titleChars);
    const doc = parseArtboard(`<title>${long}</title><div><p>日本語 · العربية · “quotes” &amp; &lt;tags&gt;</p></div>`).doc!;
    expect(doc.title).toHaveLength(LIMITS.titleChars);
    const text = serializeArtboard(doc);
    expect(text).toContain("<p>日本語 · العربية · “quotes” &amp; &lt;tags&gt;</p>");
    expect(serializeArtboard(parseArtboard(text).doc!)).toBe(text);
  });

  it("refuses more text than an artboard may hold", () => {
    const r = parseArtboard(`<div><p>${"word ".repeat(5000)}</p></div>`);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["too-much-text"]);
  });

  it("accepts tweaks that are colors or lengths, and text styles that are text properties", () => {
    expect(tweakProblem("#d97757")).toBeNull();
    expect(tweakProblem("24px")).toBeNull();
    expect(tweakProblem("url(x)")).toMatch(/color/);
    expect(textStyleProblem("font-size: 20px; line-height: 1.4;")).toBeNull();
    expect(textStyleProblem("padding: 4px;")).toBe("padding is not a text property");
    expect(textStyleProblem("font-size: huge;")).toMatch(/^font-size:/);
  });

  it("reads saved versions and drops entries it can't use", () => {
    const entry = { id: "v1", at: 1, author: "You", label: "Edited", index: emptyIndex("T"), files: { "A.html": "<div></div>" }, notes: "" };
    expect(parseHistory(JSON.stringify([entry, { id: "v2" }, null]))).toEqual([entry]);
    expect(parseHistory("nope")).toEqual([]);
    expect(parseHistory(null)).toEqual([]);
  });
});
