import { describe, expect, it } from "vitest";
import { type LoadedDeck, loadDeck } from "@opendeck/format";
import { SLIDE_FILE, keepUnchanged, remoteChange, withSlideFiles } from "../src/renderer/editor/reloads.ts";

const slide = (id: string, text: string) => `<section id="${id}" style="background: #ffffff"><h1>${text}</h1></section>\n`;

async function deckOf(files: Record<string, string>): Promise<LoadedDeck> {
  return loadDeck({
    read: async (p) => files[p] ?? null,
    list: async (d) => Object.keys(files).filter((p) => p.startsWith(d + "/")).map((p) => p.slice(d.length + 1)),
  });
}

const base = {
  "deck.json": JSON.stringify({ format: "fenna-slides/0", title: "T", slides: ["a", "b", "c"] }),
  "slides/a.html": slide("a", "A"),
  "slides/b.html": slide("b", "B"),
  "slides/c.html": slide("c", "C"),
};

describe("SLIDE_FILE", () => {
  it("matches slide files only", () => {
    expect(SLIDE_FILE.exec("slides/intro-2.html")?.[1]).toBe("intro-2");
    expect(SLIDE_FILE.test("deck.json")).toBe(false);
    expect(SLIDE_FILE.test("assets/a.png")).toBe(false);
    expect(SLIDE_FILE.test("slides/2bad.html")).toBe(false);
    expect(SLIDE_FILE.test("slides/a.html.123.tmp")).toBe(false);
  });
});

describe("withSlideFiles (reading only what changed)", () => {
  it("replaces a changed slide and keeps the others as they were", async () => {
    const deck = await deckOf(base);
    const next = withSlideFiles(deck, [{ id: "b", source: slide("b", "B2") }]);
    expect(next.slides.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(next.slides[0]).toBe(deck.slides[0]);
    expect(next.slides[2]).toBe(deck.slides[2]);
    expect(next.slides[1]!.source).toContain("B2");
    expect(next.slides[1]!.slide).not.toBeNull();
  });

  it("keeps the same object when the file is unchanged (our own write echoed back)", async () => {
    const deck = await deckOf(base);
    const next = withSlideFiles(deck, [{ id: "a", source: base["slides/a.html"] }]);
    expect(next.slides[0]).toBe(deck.slides[0]);
  });

  it("adds a slide the index doesn't list yet at the end, and drops a deleted one", async () => {
    const deck = await deckOf(base);
    const next = withSlideFiles(deck, [
      { id: "new", source: slide("new", "N") },
      { id: "c", source: null },
    ]);
    expect(next.slides.map((s) => s.id)).toEqual(["a", "b", "new"]);
    expect(next.problems).toEqual(['slide "c" is in deck.json but slides/c.html is missing']);
  });

  it("clears the missing-file problem once the file arrives", async () => {
    const deck = await deckOf({ ...base, "deck.json": JSON.stringify({ format: "fenna-slides/0", title: "T", slides: ["a", "b", "c", "d"] }) });
    expect(deck.problems).toHaveLength(1);
    const next = withSlideFiles(deck, [{ id: "d", source: slide("d", "D") }]);
    expect(next.problems).toEqual([]);
    expect(next.slides.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("flags a file whose section id doesn't match its name, as a full load does", async () => {
    const deck = await deckOf(base);
    const next = withSlideFiles(deck, [{ id: "b", source: slide("other", "B") }]);
    expect(next.slides[1]!.diagnostics.some((d) => d.code === "id-mismatch")).toBe(true);
  });

  it("keeps a broken file in place, with no tree", async () => {
    const deck = await deckOf(base);
    const next = withSlideFiles(deck, [{ id: "b", source: "<p>half a slide" }]);
    expect(next.slides[1]!.id).toBe("b");
    expect(next.slides[1]!.slide).toBeNull();
  });
});

describe("keepUnchanged", () => {
  it("reuses every slide whose file is the same", async () => {
    const prev = await deckOf(base);
    const next = await deckOf({ ...base, "slides/c.html": slide("c", "C2") });
    const kept = keepUnchanged(prev, next);
    expect(kept.slides[0]).toBe(prev.slides[0]);
    expect(kept.slides[1]).toBe(prev.slides[1]);
    expect(kept.slides[2]).toBe(next.slides[2]);
  });

  it("reuses nothing when the theme changed (the same file can parse differently)", async () => {
    const prev = await deckOf(base);
    const next = await deckOf({ ...base, "deck.json": JSON.stringify({ format: "fenna-slides/0", title: "T", slides: ["a", "b", "c"], theme: { colors: { ink: "#000000" } } }) });
    expect(keepUnchanged(prev, next).slides[0]).toBe(next.slides[0]);
  });

  it("returns the new deck as is with nothing to compare against", async () => {
    const next = await deckOf(base);
    expect(keepUnchanged(null, next)).toBe(next);
  });
});

describe("remoteChange (what the AI touched)", () => {
  it("is null when nothing changed", async () => {
    const d = await deckOf(base);
    expect(remoteChange(d, d, "a", 1)).toBeNull();
  });

  it("prefers the slide in view, and carries its earlier tree", async () => {
    const prev = await deckOf(base);
    const next = await deckOf({ ...base, "slides/a.html": slide("a", "A2"), "slides/c.html": slide("c", "C2") });
    const r = remoteChange(prev, next, "a", 7)!;
    expect(r.slideId).toBe("a");
    expect(r.at).toBe(7);
    expect(r.prev).toBe(prev.slides[0]!.slide);
  });

  it("otherwise picks the last changed slide in deck order", async () => {
    const prev = await deckOf(base);
    const next = await deckOf({ ...base, "slides/a.html": slide("a", "A2"), "slides/c.html": slide("c", "C2") });
    expect(remoteChange(prev, next, "b", 1)!.slideId).toBe("c");
  });

  it("marks a new slide with no earlier tree (it builds from empty)", async () => {
    const prev = await deckOf(base);
    const next = await deckOf({ ...base, "deck.json": JSON.stringify({ format: "fenna-slides/0", title: "T", slides: ["a", "n", "b", "c"] }), "slides/n.html": slide("n", "N") });
    const r = remoteChange(prev, next, "a", 1)!;
    expect(r.slideId).toBe("n");
    expect(r.prev).toBeNull();
  });

  it("ignores a slide that is broken now (there is nothing to show)", async () => {
    const prev = await deckOf(base);
    const next = await deckOf({ ...base, "slides/b.html": "<p>half" });
    expect(remoteChange(prev, next, "a", 1)).toBeNull();
  });

  it("ignores deletions", async () => {
    const prev = await deckOf(base);
    const next = await deckOf({ ...base, "deck.json": JSON.stringify({ format: "fenna-slides/0", title: "T", slides: ["a", "b"] }), "slides/c.html": undefined as unknown as string });
    expect(remoteChange(prev, next, "a", 1)).toBeNull();
  });
});
