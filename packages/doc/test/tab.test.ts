import { describe, expect, it } from "vitest";
import {
  type DocIndex,
  type ElementNode,
  acceptAll,
  acceptSuggestion,
  addTab,
  checkIndex,
  docContext,
  docMd,
  emptyIndex,
  flattenTabs,
  loadDoc,
  moveTab,
  newTabId,
  parseTab,
  rejectSuggestion,
  removeTab,
  renameTab,
  sanitizeBlocks,
  sanitizeInline,
  serializeNode,
  serializeTab,
  suggestionsOf,
  tabLabel,
  tabMarkup,
  tabMd,
  tabMoves,
} from "../src/index.ts";

const ctx = docContext({ dropdowns: [{ id: "status", name: "Status", options: [{ id: "done", label: "Done", color: "green" }] }] });
const ok = (html: string) => {
  const r = parseTab(html, ctx);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.tab!;
};
const html = (blocks: ElementNode[]) => blocks.map(serializeNode).join("");
const article = (body: string) => `<article id="t">${body}</article>`;

describe("parseTab (strict: files and the AI)", () => {
  it("reads every block kind and writes it back the same", () => {
    const src = article(
      [
        `<h1 id="a1">Plan</h1>`,
        `<p id="a2">Some <b>bold</b>, <i>italic</i>, <u>under</u>, <s>gone</s>, <code>x&lt;y</code> and <a href="https://example.com">a link</a>.<br>Next line</p>`,
        `<ul id="a3" data-checklist><li data-checked>Done</li><li>Open<ul><li>Child</li></ul></li></ul>`,
        `<ol id="a4" start="3"><li>Three</li></ol>`,
        `<blockquote id="a5">Said</blockquote>`,
        `<pre id="a6" data-lang="ts">let a = 1;\n  b();</pre>`,
        `<hr id="a7">`,
        `<table id="a8"><tr><th>H</th><th>I</th></tr><tr><td>1</td><td>2</td></tr></table>`,
        `<figure id="a9" data-width="60"><img src="assets/x.png" alt="An x"><figcaption>Cap</figcaption></figure>`,
        `<p id="b1">On <time datetime="2026-11-12">whenever</time> it is <span data-dropdown="status" data-value="done">old</span></p>`,
      ].join("\n"),
    );
    const tab = ok(src);
    expect(tab.children).toHaveLength(10);
    const out = serializeTab(tab);
    expect(out).toContain(`<time datetime="2026-11-12">Nov 12, 2026</time>`);
    expect(out).toContain(`<span data-dropdown="status" data-value="done">Done</span>`);
    expect(out).toContain(`<pre id="a6" data-lang="ts">let a = 1;\n  b();</pre>`);
    // Canonical form is stable.
    expect(serializeTab(ok(out))).toBe(out);
  });

  it("gives blocks without an id one, and a second use of an id a new one", () => {
    const tab = ok(article(`<p>one</p><p id="x1">two</p><p id="x1">three</p>`));
    const ids = tab.children.map((b) => (b as ElementNode).attrs.id);
    expect(ids[0]).toMatch(/^[a-z][a-z0-9]{5}$/);
    expect(ids[1]).toBe("x1");
    expect(ids[2]).not.toBe("x1");
    expect(new Set(ids).size).toBe(3);
  });

  it("refuses what isn't in the format, saying what to use", () => {
    const r = parseTab(article(`<div>hi</div><p style="color:red">x</p><h4 id="h">deep</h4><p><strong>s</strong></p>loose`), ctx);
    expect(r.ok).toBe(false);
    const msgs = r.diagnostics.map((d) => d.message).join("\n");
    expect(msgs).toMatch(/<div> is not a block: use <p>/);
    expect(msgs).toMatch(/no inline styles/);
    expect(msgs).toMatch(/<h4> is not a block: use <h3>/);
    expect(msgs).toMatch(/<strong> is not allowed in text: use <b>/);
    expect(msgs).toMatch(/text must be inside a block/);
    expect(r.diagnostics.every((d) => d.line >= 1 && d.col >= 1)).toBe(true);
  });

  it("refuses bad links, images, dates and unknown dropdowns", () => {
    const r = parseTab(article(`<p><a href="javascript:x">x</a> <time datetime="soon">x</time> <span data-dropdown="nope" data-value="a">x</span></p><figure><img src="https://x/y.png"></figure>`), ctx);
    const codes = r.diagnostics.map((d) => d.code);
    expect(codes).toEqual(expect.arrayContaining(["href", "date", "dropdown", "image"]));
  });

  it("needs exactly one article with an id", () => {
    expect(parseTab(`<p>x</p>`).ok).toBe(false);
    expect(parseTab(`<article id="a"></article><article id="b"></article>`).ok).toBe(false);
    expect(parseTab(`<article>x</article>`).ok).toBe(false);
    expect(parseTab(`<article id="a"></article>`).ok).toBe(true);
  });

  it("pads table rows to one width and keeps a table whole", () => {
    const tab = ok(article(`<table id="t1"><tr><th>a</th><th>b</th><th>c</th></tr><tr><td>1</td></tr></table>`));
    const rows = (tab.children[0] as ElementNode).children as ElementNode[];
    expect(rows.map((r) => r.children.length)).toEqual([3, 3]);
  });

  it("collapses whitespace, drops empty marks and merges neighbouring ones", () => {
    const tab = ok(article(`<p id="p">  a\n   b <b></b><b>c</b><b>d</b>  </p>`));
    expect(serializeNode(tab.children[0]!)).toBe(`<p id="p">a b <b>cd</b></p>`);
  });

  it("keeps a tab under its limits", () => {
    const many = Array.from({ length: 21 }, (_, i) => `<td>${i}</td>`).join("");
    expect(parseTab(article(`<table id="t"><tr>${many}</tr></table>`)).diagnostics.some((d) => d.code === "limit")).toBe(true);
  });
});

describe("sanitizeBlocks (lenient: the editor's page and pastes)", () => {
  it("folds browser markup into the format", () => {
    const blocks = sanitizeBlocks(`<div>first</div><div><strong>bold</strong> <em>it</em> <span style="color:red">plain</span></div><h5>deep</h5>loose text<p>ok<br></p>`);
    expect(html(blocks).replace(/ id="[^"]+"/g, "")).toBe(`<p>first</p><p><b>bold</b> <i>it</i> plain</p><h3>deep</h3><p>loose text</p><p>ok</p>`);
  });

  it("reads back what the editor's markup shows (chips, images, empty blocks)", () => {
    const tab = ok(article(`<p id="p1"><span data-dropdown="status" data-value="done">Done</span> <time datetime="2026-01-02">x</time></p><figure id="f1"><img src="assets/a.png" alt=""></figure><p id="p2"></p>`));
    const markup = tabMarkup(tab, { assetBase: "odasset://abc/", dropdowns: [{ id: "status", name: "Status", options: [{ id: "done", label: "Done", color: "green" }] }], editable: true });
    expect(markup).toContain(`src="odasset://abc/assets/a.png" data-src="assets/a.png"`);
    expect(markup).toContain(`<p id="p2"><br></p>`);
    const back = sanitizeBlocks(markup, ctx);
    expect(html(back)).toBe(html(tab.children as ElementNode[]));
  });

  it("splits ids the browser copied when a paragraph was split", () => {
    const blocks = sanitizeBlocks(`<p id="a1">one</p><p id="a1">two</p>`);
    expect(blocks[0]!.attrs.id).toBe("a1");
    expect(blocks[1]!.attrs.id).not.toBe("a1");
  });

  it("never reuses an id that is taken elsewhere", () => {
    const blocks = sanitizeBlocks(`<p>x</p>`, ctx, new Set(["a1"]));
    expect(blocks[0]!.attrs.id).not.toBe("a1");
  });

  it("puts list items and nested lists where they belong", () => {
    const blocks = sanitizeBlocks(`<ul><li>a</li><ul><li>b</li></ul><li><p>c</p></li></ul>`);
    expect(html(blocks).replace(/ id="[^"]+"/g, "")).toBe(`<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>`);
  });

  it("keeps marked suggestions, treats pasted ins/del as plain marks", () => {
    const blocks = sanitizeBlocks(`<p><ins data-sid="s1" data-by="you">new</ins> <ins>pasted</ins></p>`);
    expect(html(blocks).replace(/ id="[^"]+"/g, "")).toBe(`<p><ins data-sid="s1" data-by="you">new</ins> <u>pasted</u></p>`);
  });

  it("pasted inline content keeps marks and turns blocks into line breaks", () => {
    expect(sanitizeInline(`<p>a <b>b</b></p><p>c</p>`).map(serializeNode).join("")).toBe(`a <b>b</b><br>c`);
  });

  it("drops scripts and handlers", () => {
    const blocks = sanitizeBlocks(`<p onclick="x()">hi<script>alert(1)</script></p><img src="x" onerror="y()">`);
    expect(html(blocks)).not.toMatch(/script|onclick|onerror|alert/);
  });
});

describe("suggestions", () => {
  const tab = ok(article(`<p id="p">Keep <del data-sid="s1" data-by="you" data-at="5">old</del><ins data-sid="s1" data-by="you" data-at="5">new</ins> and <ins data-sid="s2">more</ins></p>`));
  it("lists each suggestion once", () => {
    expect(suggestionsOf(tab)).toEqual([
      { sid: "s1", block: "p", inserted: "new", deleted: "old", by: "you", at: 5 },
      { sid: "s2", block: "p", inserted: "more", deleted: "", by: "you", at: 0 },
    ]);
  });
  it("accepts and rejects one at a time", () => {
    expect(serializeNode(acceptSuggestion(tab, "s1").children[0]!)).toBe(`<p id="p">Keep new and <ins data-sid="s2">more</ins></p>`);
    expect(serializeNode(rejectSuggestion(tab, "s2").children[0]!)).toBe(`<p id="p">Keep <del data-sid="s1" data-by="you" data-at="5">old</del><ins data-sid="s1" data-by="you" data-at="5">new</ins> and</p>`);
    expect(serializeNode(acceptAll(tab).children[0]!)).toBe(`<p id="p">Keep new and more</p>`);
  });
});

describe("the tab tree", () => {
  const t = (id: string, children: { id: string; title: string; children: never[] }[] = []) => ({ id, title: "", children });
  const tree = [t("a"), t("b", [t("b1")]), t("c")];

  it("labels unnamed tabs by place", () => {
    expect(tabLabel(tree, "c")).toBe("Tab 4");
    expect(tabLabel(renameTab(tree, "c", "  Notes  "), "c")).toBe("Notes");
  });

  it("adds after a sibling and under a parent", () => {
    expect(flattenTabs(addTab(tree, t("n"), { after: "a" })).map((f) => f.ref.id)).toEqual(["a", "n", "b", "b1", "c"]);
    expect(flattenTabs(addTab(tree, t("n"), { parent: "b" })).map((f) => `${f.ref.id}:${f.depth}`)).toEqual(["a:0", "b:0", "b1:1", "n:1", "c:0"]);
  });

  it("removes a tab with everything under it", () => {
    const r = removeTab(tree, "b");
    expect(r.removed).toEqual(["b", "b1"]);
    expect(flattenTabs(r.tabs).map((f) => f.ref.id)).toEqual(["a", "c"]);
  });

  it("moves up, down, into the tab before, and out", () => {
    expect(tabMoves(tree, "a")).toMatchObject({ up: false, down: true, into: false, out: false });
    expect(tabMoves(tree, "c")).toMatchObject({ up: true, down: false, into: true, out: false, intoTitle: "Tab 2" });
    const into = moveTab(tree, "c", "into");
    expect(flattenTabs(into).map((f) => `${f.ref.id}:${f.depth}`)).toEqual(["a:0", "b:0", "b1:1", "c:1"]);
    const out = moveTab(into, "b1", "out");
    expect(flattenTabs(out).map((f) => `${f.ref.id}:${f.depth}`)).toEqual(["a:0", "b:0", "c:1", "b1:0"]);
    expect(flattenTabs(moveTab(tree, "c", "up")).map((f) => f.ref.id)).toEqual(["a", "c", "b", "b1"]);
  });

  it("won't nest deeper than three", () => {
    const deep = [t("a", [{ id: "b", title: "", children: [t("c") as never] }]), t("d")];
    expect(() => addTab(deep, t("x"), { parent: "c" })).toThrow();
  });

  it("makes ids from titles, unique", () => {
    expect(newTabId(tree, "Q3 Plan!")).toBe("q3-plan");
    expect(newTabId(tree, "a")).toBe("a-2");
    expect(newTabId(tree, "123")).toBe("tab");
  });
});

describe("doc.json", () => {
  it("fills defaults and refuses what's broken", () => {
    const r = checkIndex({ title: "T", tabs: [{ id: "a", title: "A" }] });
    expect(r.index).toMatchObject({ format: "fenna-docs/0", fonts: { headings: "serif", text: "sans" }, wide: false, dropdowns: [] });
    expect(checkIndex({ title: "T", tabs: [{ id: "1bad" }] }).index).toBeNull();
    expect(checkIndex({ title: "T", tabs: [{ id: "a" }, { id: "a" }] }).errors[0]).toMatch(/twice/);
    expect(checkIndex({ title: "T", tabs: [], dropdowns: [{ id: "s", name: "S", options: [] }] }).index).toBeNull();
  });

  it("loads a folder, adding tab files the index forgot and reporting missing ones", async () => {
    const index: DocIndex = { ...emptyIndex("Doc"), tabs: [{ id: "a", title: "A", children: [] }, { id: "gone", title: "", children: [] }] };
    const files: Record<string, string> = { "doc.json": JSON.stringify(index), "tabs/a.html": article(`<p id="p">hi</p>`).replace('id="t"', 'id="a"'), "tabs/extra.html": `<article id="extra"></article>` };
    const doc = await loadDoc({ read: async (p) => files[p] ?? null, list: async () => ["a.html", "extra.html", "notes.txt"] });
    expect(flattenTabs(doc.index.tabs).map((f) => f.ref.id)).toEqual(["a", "gone", "extra"]);
    expect(doc.tabs.get("gone")?.tab).toBeNull();
    expect(doc.tabs.get("a")?.tab?.children).toHaveLength(1);
  });

  it("loads without doc.json, and says so", async () => {
    const doc = await loadDoc({ read: async () => null, list: async () => [] });
    expect(doc.problems[0]).toMatch(/missing/);
  });
});

describe("markdown", () => {
  it("writes each block kind", () => {
    const tab = ok(article(`<h2 id="h">Title</h2><p id="p">a <b>b</b> <a href="https://x.y">c</a> 1*2</p><ul id="u" data-checklist><li data-checked>done</li><li>todo<ol><li>sub</li></ol></li></ul><table id="t"><tr><th>a</th><th>b|c</th></tr><tr><td>1</td><td></td></tr></table><pre id="c">x</pre>`));
    expect(tabMd(tab)).toBe(["## Title", "a **b** [c](https://x.y) 1\\*2", "- [x] done\n- [ ] todo\n  1. sub", "| a | b\\|c |\n| --- | --- |\n| 1 |   |", "```\nx\n```"].join("\n\n"));
  });

  it("puts each tab under its title when there are several", () => {
    const tab = (id: string, body: string) => ({ id, tab: ok(`<article id="${id}">${body}</article>`), diagnostics: [], source: "" });
    const index: DocIndex = { ...emptyIndex("Doc"), tabs: [{ id: "a", title: "First", children: [] }, { id: "b", title: "", children: [] }] };
    const md = docMd({ index, tabs: new Map([["a", tab("a", `<h1 id="x">Head</h1>`)], ["b", tab("b", `<p id="y">Body</p>`)]]) });
    expect(md).toBe("# Doc\n\n## First\n\n### Head\n\n## Tab 2\n\nBody\n");
  });
});

describe("text color and highlight", () => {
  it("keeps colored text and highlights, with marks inside them", () => {
    const tab = ok(article(`<p id="p"><span data-text="red">red <b>bold</b></span> and <mark>marked</mark></p>`));
    expect(serializeNode(tab.children[0]!)).toBe(`<p id="p"><span data-text="red">red <b>bold</b></span> and <mark>marked</mark></p>`);
  });
  it("refuses a color that isn't one of the doc's", () => {
    expect(parseTab(article(`<p id="p"><span data-text="pink">x</span></p>`)).diagnostics.map((d) => d.code)).toContain("color");
  });
  it("merges neighbouring spans of one color and unwraps a color inside a color", () => {
    const blocks = sanitizeBlocks(`<p><span data-text="teal">a</span><span data-text="teal">b<span data-text="red">c</span></span></p>`);
    expect(html(blocks).replace(/ id="[^"]+"/g, "")).toBe(`<p><span data-text="teal">abc</span></p>`);
  });
  it("keeps a dropdown chip inside colored text", () => {
    const blocks = sanitizeBlocks(`<p><span data-text="green"><span data-dropdown="status" data-value="done">x</span></span></p>`, ctx);
    expect(html(blocks).replace(/ id="[^"]+"/g, "")).toBe(`<p><span data-text="green"><span data-dropdown="status" data-value="done">Done</span></span></p>`);
  });
});
