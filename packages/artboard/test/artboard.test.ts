import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { getAt } from "@opendeck/format";
import {
  type ElementNode,
  BOARD_SIZES,
  ELEMENTS,
  LAYER_KINDS,
  PROPERTIES,
  artboardCss,
  artboardMarkup,
  checkIndex,
  designContext,
  duplicate,
  emptyIndex,
  fileFor,
  indexText,
  insertHtml,
  layerAddress,
  layerKind,
  layerLabel,
  layerTree,
  loadBoard,
  move,
  newArtboard,
  newDesignFiles,
  noteBounds,
  notesText,
  onStroke,
  pagesHtml,
  parseArtboard,
  parseNotes,
  placeBeside,
  remove,
  restack,
  serializeArtboard,
  setAttr,
  setContent,
  setDeclarations,
  setStyles,
  setTag,
  standaloneHtml,
  themeOf,
  unwrap,
  wrapIn,
} from "../src/index.ts";
import { readDesignFolder } from "../src/node.ts";

const sample = fileURLToPath(new URL("../../../examples/sample-design", import.meta.url));
const ctx = designContext(emptyIndex());
const root = (html: string): ElementNode => {
  const r = parseArtboard(html, ctx);
  if (!r.doc || !r.ok) throw new Error(r.diagnostics.map((d) => d.message).join("; "));
  return r.doc.root;
};
const CARD = '<div style="width:400px;height:300px;display:flex;flex-direction:column"><div style="display:flex"><p>One</p><p>Two <b>bold</b></p></div><h1 id="title">Title</h1><p>Body text</p></div>';
const codes = (html: string) => parseArtboard(html, ctx).diagnostics.map((d) => `${d.severity}:${d.code}`);

describe("the sample design", () => {
  const design = readDesignFolder(sample);

  it("loads with no problems", () => {
    expect(design.broken).toBeNull();
    expect(design.problems).toEqual([]);
    expect([...design.boards.keys()]).toEqual(["Card.html", "Landing.html"]);
    for (const b of design.boards.values()) expect(b.diagnostics, b.file).toEqual([]);
  });

  it("is in the serializer's own form, so opening and saving changes nothing", () => {
    for (const b of design.boards.values()) {
      expect(serializeArtboard(b.doc!, { ...themeOf(design.index), title: design.index.boards[b.file]!.title }), b.file).toBe(b.source);
    }
    expect(checkIndex(JSON.parse(indexText(design.index))).index).toEqual(design.index);
  });

  it("holds what the brief names: a card and a page, two pages, an accent, three text styles", () => {
    expect(design.index.pages.map((p) => p.name)).toEqual(["Page 1", "Mobile"]);
    expect(design.index.boards["Card.html"]).toMatchObject({ w: 880, h: 420, title: "Card" });
    expect(design.index.boards["Landing.html"]).toMatchObject({ w: 1280, expand: "fill" });
    expect(design.index.tweaks).toEqual({ "--accent": "#d97757" });
    expect(Object.keys(design.index.textStyles)).toEqual(["Heading 1", "Body", "Caption"]);
  });
});

describe("parsing", () => {
  it("reads a whole page or just the root element", () => {
    const page = parseArtboard(`<!doctype html><html><head><title>Hi</title><style>:root { --accent: #112233; }</style></head><body><div style="color:var(--accent)"><p>x</p></div></body></html>`);
    expect(page.ok).toBe(true);
    expect(page.doc).toMatchObject({ title: "Hi", vars: { "--accent": "#112233" } });
    expect(parseArtboard("<div><p>x</p></div>").ok).toBe(true);
  });

  it("writes one canonical form and reads it back unchanged", () => {
    const doc = parseArtboard(CARD, ctx).doc!;
    const text = serializeArtboard(doc, { tweaks: { "--accent": "#d97757" }, title: "Card" });
    const again = parseArtboard(text, ctx);
    expect(again.diagnostics).toEqual([]);
    expect(serializeArtboard(again.doc!, { title: "Card" })).toBe(text);
    expect(text).toContain("<title>Card</title>");
    expect(text).toContain("--accent: #d97757;");
    expect(text).toContain("<p>Two <b>bold</b></p>");
  });

  it("refuses what an artboard may not hold, saying how to fix it", () => {
    expect(codes("")).toEqual(["error:empty-file"]);
    expect(codes("<div></div><div></div>")).toEqual(["error:artboard-root"]);
    expect(codes("<p>loose</p>text")).toContain("error:loose-text");
    expect(codes("<div>loose</div>")).toEqual(["error:loose-text"]);
    expect(codes('<div onclick="x()"><script>1</script></div>')).toEqual(["error:script-attr", "error:unknown-tag"]);
    expect(codes('<div><img src="https://example.com/a.png"></div>')).toEqual(["error:bad-src"]);
    expect(codes('<div><p><a href="javascript:alert(1)">x</a></p></div>')).toEqual(["error:bad-href"]);
    expect(codes('<div><a href="Pricing.html">x</a><a href="https://example.com">y</a></div>')).toEqual([]);
    expect(codes('<div><x-shape kind="star"></x-shape></div>')).toEqual(["error:bad-shape-kind"]);
    expect(codes('<div><ul><p>x</p></ul></div>')).toEqual(["error:misplaced"]);
    expect(codes('<div><svg viewBox="0 0 1 1"><script>1</script></svg></div>')).toEqual(["error:svg-script"]);
    expect(codes('<div class="card" title="x"></div>')).toEqual(["warning:class-dropped", "warning:attr-dropped"]);
    expect(codes("<html><head><style>.card { color: red }</style></head><body><div></div></body></html>")).toEqual(["warning:style-dropped"]);
    const section = parseArtboard("<div><section></section></div>").diagnostics[0]!;
    expect(section.message).toContain("use a <div>");
  });

  it("checks every style value and suggests the property that was meant", () => {
    const bad = parseArtboard('<div style="colour:#fff"><p style="color:red">a</p><p style="font-size:900px">b</p><p style="color:var(--nope)">c</p></div>', ctx).diagnostics;
    expect(bad.map((d) => d.code)).toEqual(["unknown-property", "bad-value", "bad-value", "bad-value"]);
    expect(bad[0]!.message).toContain("Did you mean color?");
    expect(bad[3]!.message).toContain("the design has no tweak --nope");
    expect(parseArtboard('<div><img src="assets/a.png" style="font-size:12px"></div>').diagnostics[0]!.code).toBe("property-misplaced");
  });

  it("names the line of each problem", () => {
    const d = parseArtboard("<div>\n  <p>ok</p>\n  <video></video>\n</div>").diagnostics[0]!;
    expect(d).toMatchObject({ code: "unknown-tag", line: 3, col: 3, path: "div > video:1" });
  });

  it("holds the limits: 300 elements, 16 containers deep, 100×24 tables", () => {
    const many = `<div>${"<p>x</p>".repeat(300)}</div>`;
    expect(codes(many)).toEqual(["error:too-many-elements"]);
    expect(codes(`<div>${"<p>x</p>".repeat(299)}</div>`)).toEqual([]);
    expect(codes(`${"<div>".repeat(17)}${"</div>".repeat(17)}`)).toEqual(["error:too-deep"]);
    expect(codes(`${"<div>".repeat(16)}${"</div>".repeat(16)}`)).toEqual([]);
    expect(codes(`<div><table><tr>${"<td>x</td>".repeat(25)}</tr></table></div>`)).toContain("error:table-too-big");
    expect(codes("<div><table><tbody><tr><td>x</td></tr></tbody></table></div>")).toEqual([]);
  });
});

describe("the schema", () => {
  it("gives every property a group, a check and elements that exist", () => {
    for (const [name, spec] of Object.entries(PROPERTIES)) {
      expect(spec.on.length, name).toBeGreaterThan(0);
      for (const tag of spec.on) expect(ELEMENTS[tag], `${name} on ${tag}`).toBeDefined();
      for (const option of spec.options ?? []) expect(spec.check(option, ctx), `${name}: ${option}`).toBeNull();
    }
  });

  it("names a layer by what it is", () => {
    const kind = (html: string) => layerKind(root(`<div>${html}</div>`).children[0] as ElementNode);
    expect(kind('<div style="display:flex;flex-direction:column"></div>')).toBe("Column");
    expect(kind('<div style="display:flex"></div>')).toBe("Row");
    expect(kind('<div style="display:grid"></div>')).toBe("Grid");
    expect(kind("<div></div>")).toBe("Box");
    expect(kind("<h3>x</h3>")).toBe("Heading");
    expect(kind('<a href="A.html">x</a>')).toBe("Link");
    expect(kind('<x-shape kind="rect"></x-shape>')).toBe("Shape");
    for (const k of ["Column", "Row", "Grid", "Box", "Heading", "Text", "Image", "Shape", "Link", "Button", "List", "Item", "Table", "Rule", "Input"]) expect(LAYER_KINDS).toContain(k);
    expect(BOARD_SIZES.map((s) => `${s.name} ${s.width}×${s.height}`)).toEqual(["Artboard 800×600", "Phone 390×844", "Social 1080×1080", "Page 1280×800"]);
  });
});

describe("editing the tree", () => {
  const tree = root(CARD);

  it("never changes the tree it was given", () => {
    const before = JSON.stringify(tree);
    setStyles(tree, "1", { color: "#ff0000" }, ctx);
    remove(tree, "0.1", ctx);
    wrapIn(tree, ["1", "2"], "row", ctx);
    expect(JSON.stringify(tree)).toBe(before);
  });

  it("sets and removes styles, refusing a value the format would refuse", () => {
    const next = setStyles(tree, "1", { color: "var(--accent)", "font-size": " 40px " }, ctx);
    expect(getAt(next, "1")!.style).toEqual([{ name: "color", value: "var(--accent)" }, { name: "font-size", value: "40px" }]);
    expect(getAt(setStyles(next, "1", { color: null }, ctx), "1")!.style).toEqual([{ name: "font-size", value: "40px" }]);
    expect(() => setStyles(tree, "1", { color: "red" }, ctx)).toThrow(/hex color/);
    expect(() => setStyles(tree, "1", { "object-fit": "cover" }, ctx)).toThrow(/does not apply/);
    expect(() => setStyles(tree, "9", { color: "#000" }, ctx)).toThrow(/no longer there/);
  });

  it("replaces an element's declarations from CSS text (the Code tab)", () => {
    const next = setDeclarations(tree, "", "width: 880px;\nheight: 420px;\nbackground: #f4f1ea;", ctx);
    expect(next.style.map((d) => d.name)).toEqual(["width", "height", "background"]);
    expect(() => setDeclarations(tree, "", "widht: 10px", ctx)).toThrow(/did you mean width/);
    expect(() => setDeclarations(tree, "", "width: wide", ctx)).toThrow(/width/);
  });

  it("sets attributes the element takes", () => {
    expect(getAt(setAttr(tree, "1", "data-style", "Heading 1", ctx), "1")!.attrs["data-style"]).toBe("Heading 1");
    expect(() => setAttr(tree, "1", "href", "A.html", ctx)).toThrow(/takes no href/);
  });

  it("replaces text, keeping inline formatting and refusing blocks inside text", () => {
    const next = setContent(tree, "2", 'New <b>words</b> and <a href="https://example.com">a link</a>', ctx);
    expect(artboardMarkup({ title: "", vars: {}, root: next }).html).toContain('<p>New <b>words</b> and <a href="https://example.com">a link</a></p>');
    expect(() => setContent(tree, "2", '<img src="assets/a.png">', ctx)).toThrow(/cannot go inside/);
  });

  it("inserts, duplicates, moves and removes layers", () => {
    const added = insertHtml(tree, "", "<p>Last</p>", undefined, ctx);
    expect(added.at).toBe("3");
    const copy = duplicate(tree, "1", ctx);
    expect(copy.at).toBe("2");
    expect(getAt(copy.root, "2")!.attrs.id).toBeUndefined();
    const moved = move(tree, "0.0", "", 3, ctx);
    expect(moved.at).toBe("3");
    expect(layerTree(moved.root).map((r) => r.text)).toEqual(["Two bold Title Body text One", "Two bold", "Two bold", "Title", "Body text", "One"]);
    expect(restack(tree, "2", "back", ctx).at).toBe("0");
    expect(restack(tree, "0", "forward", ctx).at).toBe("1");
    expect(() => remove(tree, "", ctx)).toThrow(/root/);
    expect(() => move(tree, "0", "0.1", 0, ctx)).toThrow(/inside itself/);
  });

  it("wraps siblings in a container and unwraps it again", () => {
    const wrapped = wrapIn(tree, ["2", "1"], "column", ctx);
    expect(wrapped.at).toBe("1");
    expect(layerKind(getAt(wrapped.root, "1") as ElementNode)).toBe("Column");
    expect(layerTree(wrapped.root).map((r) => `${r.depth}${r.kind}`)).toEqual(["0Column", "1Row", "2Text", "2Text", "1Column", "2Heading", "2Text"]);
    expect(JSON.stringify(unwrap(wrapped.root, "1", ctx).children.map((c) => (c as ElementNode).tag))).toBe('["div","h1","p"]');
    expect(() => wrapIn(tree, ["0.0", "1"], "row", ctx)).toThrow(/side by side/);
    expect(() => unwrap(tree, "1", ctx)).toThrow(/container/);
  });

  it("turns a paragraph into a heading or a list and back", () => {
    const list = setTag(setContent(tree, "2", "One<br>Two", ctx), "2", "ul", ctx);
    expect(artboardMarkup({ title: "", vars: {}, root: list }).html).toContain("<ul><li>One</li><li>Two</li></ul>");
    expect(artboardMarkup({ title: "", vars: {}, root: setTag(list, "2", "p", ctx) }).html).toContain("<p>One<br>Two</p>");
    expect(getAt(setTag(tree, "2", "h2", ctx), "2")!.tag).toBe("h2");
  });

  it("lists layers the way the panel shows them", () => {
    const rows = layerTree(tree);
    expect(rows.map((r) => `${r.address}|${r.kind}|${r.hasChildren}`)).toEqual(["|Column|true", "0|Row|true", "0.0|Text|false", "0.1|Text|false", "1|Heading|false", "2|Text|false"]);
    expect(layerTree(tree, new Set(["0"])).map((r) => r.address)).toEqual(["", "0", "1", "2"]);
    expect(layerLabel(getAt(tree, "1") as ElementNode)).toBe("Heading “Title”");
    expect(layerAddress(tree, "0.1.0")).toBe("0.1");
    expect(layerAddress(tree, "1")).toBe("1");
  });
});

describe("rendering", () => {
  const doc = parseArtboard('<div><img src="assets/a.png" alt="A"><x-shape kind="ellipse"></x-shape><p data-style="Body">Hi &amp; <b>bye</b></p></div>', ctx).doc!;

  it("tags every element with its address when asked", () => {
    const { html } = artboardMarkup(doc, { annotate: true, asset: (s) => `x://${s}` });
    expect(html).toBe('<div data-od=""><img data-od="0" src="x://assets/a.png" alt="A" draggable="false"><x-shape data-od="1" kind="ellipse"></x-shape><p data-od="2" data-style="Body">Hi &amp; <b data-od="2.0">bye</b></p></div>');
  });

  it("gives the design's variables and text styles, scoped for a page or a shadow root", () => {
    const css = artboardCss(doc, { tweaks: { "--accent": "#123456" }, textStyles: { Body: "font-size: 24px;" } }, ":host");
    expect(css).toContain(":host {\n  all: initial;\n  display: block;\n  --accent: #123456;\n}");
    expect(css).toContain('[data-style="Body"] { font-size: 24px; }');
    expect(css).toContain('x-shape[kind="ellipse"]');
    expect(css).not.toContain('x-shape[kind="diamond"]');
    expect(artboardCss(doc)).toContain("body { margin: 0;");
  });

  it("makes a page that needs no other file, and one document of several pages", () => {
    const one = standaloneHtml(doc, { title: "A <b>", assets: new Map([["assets/a.png", "data:image/png;base64,AA"]]) });
    expect(one).toContain("<title>A &lt;b&gt;</title>");
    expect(one).toContain('src="data:image/png;base64,AA"');
    expect(standaloneHtml(doc, { assets: new Map() })).not.toContain("src=");
    const two = pagesHtml([{ doc, width: 800, height: 600 }, { doc: newArtboard({ width: 390, height: 844 }), width: 390, height: 844 }]);
    expect(two).toContain("@page p1 { size: 390px 844px; margin: 0; }");
    expect(two.match(/class="page-/g)).toHaveLength(2);
  });
});

describe("design.json", () => {
  it("keeps what it can read and reports the rest", () => {
    const { index, problems } = checkIndex({
      format: "fenna-design/9",
      title: "  T  ",
      pages: [{ id: "a", name: "A" }, { id: "a", name: "B" }, "x"],
      boards: { "One.html": { x: 1.4, y: "2", w: 5, h: 99999, page: "gone" }, "../evil.html": {}, "Two.html": null },
      order: ["Two.html", "Two.html", "Nope.html"],
      tweaks: { accent: "#fff", "--Bad Name": "#000", "--size": "banana" },
      textStyles: { Body: "font-size: 20px;", Loud: "background: #f00;", 'Q"': "font-size: 1px;" },
    });
    expect(index.title).toBe("T");
    expect(index.pages).toEqual([{ id: "a", name: "A" }, { id: "page-2", name: "B" }]);
    expect(index.boards["One.html"]).toEqual({ x: 1, y: 0, w: 16, h: 8000, title: "One", page: "a" });
    expect(index.order).toEqual(["Two.html", "One.html"]);
    expect(index.tweaks).toEqual({ "--accent": "#fff" });
    expect(index.textStyles).toEqual({ Body: "font-size: 20px;" });
    expect(problems.map((p) => p.message).join("\n")).toMatch(/fenna-design\/9[\s\S]*evil[\s\S]*Bad Name[\s\S]*--size[\s\S]*Loud[\s\S]*Q"/);
    expect(checkIndex([]).problems[0]!.message).toContain("JSON object");
  });

  it("stops at 40 artboards and says so", () => {
    const boards = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`A${i}.html`, {}]));
    const { index, problems } = checkIndex({ boards });
    expect(Object.keys(index.boards)).toHaveLength(40);
    expect(problems[0]!.message).toContain("at most 40");
  });

  it("starts a new design empty, with the accent and the three text styles", () => {
    const files = newDesignFiles("  My design ");
    const index = checkIndex(JSON.parse(files["design.json"]!)).index;
    expect(index).toMatchObject({ title: "My design", order: [], tweaks: { "--accent": "#d97757" } });
    expect(Object.keys(files)).toEqual(["design.json", "notes.json"]);
  });

  it("names and places a new artboard clear of the others", () => {
    const index = emptyIndex();
    expect(placeBeside(index, "page-1", 800, 600)).toEqual({ x: 80, y: 80 });
    index.boards["Card.html"] = { x: 80, y: 80, w: 880, h: 420, title: "Card", page: "page-1" };
    index.boards["Tall.html"] = { x: 1040, y: 300, w: 400, h: 900, title: "Tall", page: "page-1" };
    expect(placeBeside(index, "page-1", 800, 600)).toEqual({ x: 1520, y: 80 });
    expect(placeBeside(index, "page-2", 800, 600)).toEqual({ x: 80, y: 80 });
    expect(fileFor("Card", index)).toBe("Card-2.html");
    expect(fileFor("Settings · Dark", index)).toBe("Settings-Dark.html");
    expect(fileFor("•", index)).toBe("Artboard.html");
  });

  it("shows a damaged artboard with its problems instead of dropping it", () => {
    const index = emptyIndex();
    const broken = loadBoard("Bad.html", "<div><script>x</script></div>", index);
    expect(broken.doc).toBeNull();
    expect(broken.source).toBe("<div><script>x</script></div>");
    expect(broken.broken).toMatch(/^line 1: <script> is not part/);
    expect(loadBoard("Gone.html", null, index).broken).toBe("artboards/Gone.html is missing");
  });
});

describe("notes.json", () => {
  it("round-trips stickies and strokes, one a line", () => {
    const text = notesText([
      { id: "s", kind: "sticky", text: "Hi", fill: "blue", x: 1, y: 2, w: 200, h: 120, page: "page-1" },
      { id: "p", kind: "stroke", points: [[0, 0], [10, 0]], width: 4, dashed: true, page: "page-1" },
    ]);
    expect(text.split("\n")).toHaveLength(7);
    expect(parseNotes(text)).toEqual({ items: [expect.objectContaining({ id: "s", fill: "blue" }), expect.objectContaining({ id: "p", dashed: true })], problems: [] });
  });

  it("leaves out what makes no sense and says how much", () => {
    const r = parseNotes(JSON.stringify({ items: [{ id: "a", kind: "sticky", x: 0, y: 0 }, { id: "a", kind: "sticky", x: 0, y: 0 }, { id: "b", kind: "stroke", points: [[0, 0]] }, 7] }));
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ fill: "yellow", w: 200, h: 200 });
    expect(r.problems).toEqual(["3 entries in notes.json can't be read and are not shown"]);
    expect(parseNotes("{").problems[0]).toContain("not valid JSON");
    expect(parseNotes(null)).toEqual({ items: [], problems: [] });
  });

  it("measures a stroke and finds a point on it", () => {
    const stroke = { id: "p", kind: "stroke" as const, points: [[0, 0], [100, 0], [100, 50]] as [number, number][], width: 4, page: "page-1" };
    expect(noteBounds(stroke)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(onStroke(stroke, 50, 5, 4)).toBe(true);
    expect(onStroke(stroke, 50, 20, 4)).toBe(false);
  });
});
