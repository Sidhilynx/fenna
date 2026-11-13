import { describe, expect, it } from "vitest";
import {
  EditError,
  addTableColumn,
  addTableRow,
  duplicate,
  getAt,
  group,
  insertHtml,
  move,
  notesOf,
  parseSlide,
  remove,
  removeMany,
  removeTableColumn,
  restack,
  serializeSlide,
  setAttr,
  setContent,
  setHeaderRow,
  setNotes,
  setStyle,
  setStyles,
  textOf,
  ungroup,
} from "../src/index.ts";

const base = parseSlide(
  `<section id="s" style="background:#fff;padding:128px">
  <h2 id="t">Title</h2>
  <div style="display:flex;flex-direction:row;gap:24px"><p>A</p><p>B</p><p>C</p></div>
  <img src="assets/a.png" alt="" style="position:absolute;left:100px;top:200px;width:300px;height:200px">
  <table><tr><th>H1</th><th>H2</th></tr><tr><td>1</td><td>2</td></tr></table>
  <aside>Notes here</aside>
</section>`,
).slide!;

const tags = (s: typeof base, addr = "") => getAt(s, addr)!.children.filter((c) => c.type === "element").map((c) => (c.type === "element" ? c.tag + (c.attrs.id ? "#" + c.attrs.id : "") : ""));
const flat = (s: typeof base) => serializeSlide(s).replace(/>\s+</g, "><");
const txt = (s: typeof base, addr: string) => textOf(getAt(s, addr)!);

describe("edit operations", () => {
  it("never mutates the input", () => {
    const before = serializeSlide(base);
    setStyle(base, "0", "color", "#ff0000");
    remove(base, "1");
    expect(serializeSlide(base)).toBe(before);
  });

  it("sets and removes styles, checking values and placement", () => {
    const s = setStyles(base, "0", { color: "#ff0000", "font-size": "72px" });
    expect(getAt(s, "0")!.style).toEqual([{ name: "color", value: "#ff0000" }, { name: "font-size", value: "72px" }]);
    expect(getAt(setStyle(s, "0", "color", null), "0")!.style).toEqual([{ name: "font-size", value: "72px" }]);
    expect(() => setStyle(base, "0", "font-size", "2em")).toThrow(EditError);
    expect(() => setStyle(base, "0", "object-fit", "cover")).toThrow(/does not apply/);
    expect(() => setStyle(base, "0", "zindex", "1")).toThrow(/not a supported/);
  });

  it("sets attributes the element takes, only", () => {
    expect(getAt(setAttr(base, "0", "data-style", "title"), "0")!.attrs["data-style"]).toBe("title");
    expect(() => setAttr(base, "0", "src", "x")).toThrow(EditError);
    expect(getAt(setAttr(base, "", "hidden", ""), "")!.attrs.hidden).toBe("");
  });

  it("replaces text content from an inline fragment, refusing blocks", () => {
    const s = setContent(base, "0", "New <b>bold</b> title");
    expect(serializeSlide(s)).toContain('<h2 id="t">New <b>bold</b> title</h2>');
    expect(() => setContent(base, "0", "<div>x</div>")).toThrow(EditError);
    expect(() => setContent(base, "1", "x")).toThrow(/must be wrapped/);
    expect(() => setContent(base, "2", "x")).toThrow(/doesn.t hold content/);
    expect(textOf(getAt(setContent(base, "1", "<p>Only</p>"), "1")!)).toBe("Only");
  });

  it("inserts before the speaker notes by default", () => {
    const { slide, at } = insertHtml(base, "", `<p style="font-size:32px">New</p>`);
    expect(at).toBe("4");
    expect(tags(slide)).toEqual(["h2#t", "div", "img", "table", "p", "aside"]);
  });

  it("removes one or many, ignoring children of removed parents", () => {
    expect(tags(remove(base, "2"))).toEqual(["h2#t", "div", "table", "aside"]);
    const s = removeMany(base, ["1.0", "1", "0"]);
    expect(tags(s)).toEqual(["img", "table", "aside"]);
  });

  it("duplicates with fresh ids and a visible offset for pinned elements", () => {
    const d1 = duplicate(base, "0");
    expect(tags(d1.slide)).toEqual(["h2#t", "h2#t-2", "div", "img", "table", "aside"]);
    expect(d1.at).toBe("1");
    const d2 = duplicate(base, "2");
    const copy = getAt(d2.slide, "3")!;
    expect(copy.style.find((x) => x.name === "left")!.value).toBe("124px");
  });

  it("moves within and across containers, fixing shifted addresses", () => {
    const m1 = move(base, "1.0", "1", 3);
    expect(txt(m1.slide, "1")).toBe("BCA");
    expect(m1.at).toBe("1.2");
    const m2 = move(base, "0", "1", 1); // heading into the row, after A
    expect(tags(m2.slide, "0")).toEqual(["p", "h2#t", "p", "p"]);
    expect(m2.at).toBe("0.1");
    expect(() => move(base, "1", "1.0", 0)).toThrow(/inside itself/);
  });

  it("restacks within the parent, keeping notes last", () => {
    expect(tags(restack(base, "0", "front").slide)).toEqual(["div", "img", "table", "h2#t", "aside"]);
    expect(tags(restack(base, "3", "back").slide)).toEqual(["table", "h2#t", "div", "img", "aside"]);
    expect(tags(restack(base, "1", "forward").slide)).toEqual(["h2#t", "img", "div", "table", "aside"]);
    expect(tags(restack(base, "1", "backward").slide)).toEqual(["div", "h2#t", "img", "table", "aside"]);
  });

  it("groups siblings and ungroups", () => {
    const g = group(base, ["1.2", "1.0"]);
    expect(g.at).toBe("1.0");
    expect(tags(g.slide, "1")).toEqual(["div", "p"]);
    expect(txt(g.slide, "1.0")).toBe("AC");
    const u = ungroup(g.slide, "1.0");
    expect(txt(u, "1")).toBe("ACB");
    expect(() => group(base, ["0", "1.0"])).toThrow(/side by side/);
  });

  it("reads and writes speaker notes", () => {
    expect(notesOf(base)).toBe("Notes here");
    const s = setNotes(base, "Line one\nLine two");
    expect(notesOf(s)).toBe("Line one\nLine two");
    expect(tags(setNotes(base, "  "))).toEqual(["h2#t", "div", "img", "table"]);
  });

  it("edits tables: rows, columns, header", () => {
    let s = addTableRow(base, "3", 1);
    expect(getAt(s, "3")!.children.filter((c) => c.type === "element")).toHaveLength(3);
    s = addTableColumn(s, "3", 0);
    expect(flat(s)).toContain("<tr><th>H1</th><th></th><th>H2</th></tr>");
    s = removeTableColumn(s, "3", 1);
    expect(flat(s)).toContain("<tr><th>H1</th><th>H2</th></tr>");
    s = setHeaderRow(s, "3", false);
    expect(flat(s)).toContain("<tr><td>H1</td><td>H2</td></tr>");
  });
});

import { checkIndex, layouts, moveSlides, newSlideId, placeSlide, setSection, unplaceSlides } from "../src/index.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sampleIndex = checkIndex(JSON.parse(readFileSync(fileURLToPath(new URL("../../../examples/sample-deck/deck.json", import.meta.url)), "utf8"))).index!;

describe("deck edits", () => {
  it("places, removes and moves slides, keeping sections on real slides", () => {
    expect(placeSlide(sampleIndex, "x", 1).slides.slice(0, 3)).toEqual(["cover", "x", "problem"]);
    const u = unplaceSlides(sampleIndex, ["how", "roadmap"]);
    expect(u.sections.map((s) => s.start)).toEqual(["cover", "business"]);
    const all = unplaceSlides(sampleIndex, ["roadmap", "business"]);
    expect(all.sections.map((s) => s.start)).toEqual(["cover", "how"]);
    expect(moveSlides(sampleIndex, ["business", "cover"], 1).slides).toEqual(["problem", "cover", "business", "statement", "how", "roadmap"]);
  });

  it("makes unique slide ids from titles", () => {
    expect(newSlideId(sampleIndex, "The Cover!")).toBe("the-cover");
    expect(newSlideId(sampleIndex, "cover")).toBe("cover-2");
    expect(newSlideId(sampleIndex, "123")).toBe("slide");
  });

  it("sets, renames and removes sections in slide order", () => {
    let s = setSection(sampleIndex, "statement", "Promise");
    expect(s.sections.map((x) => x.start)).toEqual(["cover", "statement", "how", "roadmap"]);
    s = setSection(s, "statement", "");
    expect(s.sections.map((x) => x.start)).toEqual(["cover", "how", "roadmap"]);
  });

  it("every layout is a valid slide, with and without a themed deck", () => {
    const bare = checkIndex({ format: "fenna-slides/0", title: "t", slides: [] }).index!;
    for (const theme of [sampleIndex.theme, bare.theme]) {
      const ctx = { colorTokens: new Set(Object.keys(theme.colors)), families: new Set(theme.fonts.map((f) => f.family)) };
      for (const l of layouts(theme)) {
        const r = parseSlide(l.html("new"), ctx);
        expect({ layout: l.key, errors: r.diagnostics.filter((d) => d.severity === "error") }).toEqual({ layout: l.key, errors: [] });
      }
    }
  });
});

import { STARTERS, newDeckFiles, valueContext } from "../src/index.ts";

describe("starters", () => {
  it("every starter makes a valid deck whose cover and layouts check clean", () => {
    for (const s of STARTERS) {
      const { index, slides } = newDeckFiles("My <deck>", s.key);
      const r = checkIndex(index);
      expect({ starter: s.key, errors: r.errors }).toEqual({ starter: s.key, errors: [] });
      const ctx = valueContext(r.index!);
      const cover = parseSlide(slides.cover!, ctx);
      expect({ starter: s.key, errors: cover.diagnostics.filter((d) => d.severity === "error") }).toEqual({ starter: s.key, errors: [] });
      expect(slides.cover).toContain("My &lt;deck&gt;");
      for (const l of layouts(r.index!.theme)) expect(parseSlide(l.html("x"), ctx).ok).toBe(true);
    }
  });
});
