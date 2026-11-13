import { describe, expect, it } from "vitest";
import { acceptAll, parseTab, rejectAll, serializeTab, suggestTab, suggestionsOf } from "../src/index.ts";

const tab = (body: string) => {
  const r = parseTab(`<article id="t">\n${body}\n</article>`);
  if (!r.tab) throw new Error(JSON.stringify(r.diagnostics));
  return r.tab;
};
let n = 0;
const by = { by: "ai", at: 1, sid: () => `s${++n}` };
const html = (t: ReturnType<typeof tab>) => serializeTab(t);

/** The suggestion turns `a` into `b` when accepted and back into `a` when rejected, and the result is a valid tab. */
function roundTrip(a: string, b: string) {
  const before = tab(a);
  const after = tab(b);
  const s = suggestTab(before, after, by);
  const text = html(s);
  expect(parseTab(text).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(html(acceptAll(s))).toBe(html(after));
  expect(html(rejectAll(s))).toBe(html(before));
  return { s, text };
}

describe("an edit saved as suggestions", () => {
  it("marks only the words that changed", () => {
    const { text, s } = roundTrip(`<p id="a">The launch ships in May with three parts.</p>`, `<p id="a">The launch ships in June with three parts.</p>`);
    expect(text).toContain(`ships in <del data-sid="`);
    expect(text).toMatch(/>May<\/del><ins [^>]*>June<\/ins> with three parts/);
    expect(suggestionsOf(s)).toHaveLength(1);
  });

  it("marks an added sentence as only an insertion, and a punctuation change at the word it touches", () => {
    const added = roundTrip(`<p id="a">Folders for images.</p>`, `<p id="a">Folders for images. They open anywhere.</p>`).text;
    expect(added).toMatch(/for images\.<ins [^>]*> They open anywhere\.<\/ins><\/p>/);
    expect(added).not.toContain("<del");
    const punct = roundTrip(`<p id="a">Runs on your computer. Files stay put.</p>`, `<p id="a">Runs on your computer, where files stay put.</p>`).text;
    expect(punct).toMatch(/your computer<del [^>]*>\. Files<\/del><ins [^>]*>, where files<\/ins> stay put/);
  });

  it("keeps a new block as an insertion and a removed one, in place, as a deletion", () => {
    const { s } = roundTrip(`<p id="a">One.</p>\n<p id="b">Two.</p>\n<p id="c">Three.</p>`, `<p id="a">One.</p>\n<p id="n">New.</p>\n<p id="c">Three.</p>`);
    expect(s.children.map((b) => (b as { attrs: Record<string, string> }).attrs.id)).toEqual(["a", "n", "b", "c"]);
    expect(suggestionsOf(s).map((x) => [x.inserted, x.deleted])).toEqual([
      ["New.", ""],
      ["", "Two."],
    ]);
  });

  it("handles edits at the start and the end of a tab", () => {
    roundTrip(`<p id="a">First.</p>\n<p id="b">Last.</p>`, `<p id="z">Before all.</p>\n<p id="a">First.</p>`);
  });

  it("changes list items one by one", () => {
    roundTrip(`<ul id="l"><li>Alpha</li><li>Beta</li><li>Gamma</li></ul>`, `<ul id="l"><li>Alpha</li><li>Beta two</li><li>Delta</li><li>Gamma</li></ul>`);
    roundTrip(`<ul id="l"><li>Alpha<ul><li>Inner</li></ul></li></ul>`, `<ul id="l"><li>Alpha<ul><li>Inner changed</li><li>More</li></ul></li></ul>`);
  });

  it("changes table cells and rows", () => {
    roundTrip(`<table id="t1"><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>`, `<table id="t1"><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>20</td></tr><tr><td>3</td><td>4</td></tr></table>`);
  });

  it("changes inside formatting, and formatting itself", () => {
    roundTrip(`<p id="a">Keep <b>one HTML file per tab</b> as is.</p>`, `<p id="a">Keep <b>one HTML file for each tab</b> as is.</p>`);
    roundTrip(`<p id="a">Plain words here.</p>`, `<p id="a">Plain <b>words</b> here.</p>`);
  });

  it("leaves a tab with no changes as it was", () => {
    const a = tab(`<p id="a">Same.</p>`);
    expect(html(suggestTab(a, tab(`<p id="a">Same.</p>`), by))).toBe(html(a));
  });

  it("removes a whole list or table only when its deletion is accepted", () => {
    const { s } = roundTrip(`<p id="a">Hi.</p>\n<ul id="l"><li>x</li><li>y</li></ul>`, `<p id="a">Hi.</p>`);
    expect(html(acceptAll(s))).not.toContain("<ul");
  });
});
