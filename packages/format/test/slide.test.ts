import { describe, expect, it } from "vitest";
import { checkIndex, loadDeck, parseSlide, resolvedStyle, serializeSlide, valueContext, type DeckReader } from "../src/index.ts";

const GOOD = `<section id="cover" data-transition="fade" style="background:#151515;color:#f3f1ec;font-family:Inter, Arial, sans-serif;padding:128px;display:flex;flex-direction:column;justify-content:space-between">
  <p data-style="eyebrow" style="font-size:24px;letter-spacing:4px;text-transform:uppercase">Open source</p>
  <div style="display:flex;flex-direction:column;gap:40px">
    <h1 style="font-size:120px;font-weight:400;line-height:1.05">Every tool,<br>every model.</h1>
    <p style="font-size:32px;width:960px">Slides that run on <b>your</b> machine &amp; your AI.</p>
  </div>
  <img src="assets/hero.jpg" alt="Desk" style="position:absolute;right:128px;top:128px;width:480px;height:360px;object-fit:cover">
  <aside>Say hello.</aside>
</section>`;

const codes = (html: string) => parseSlide(html).diagnostics.map((d) => d.code);

describe("parseSlide", () => {
  it("accepts a well-formed slide with no diagnostics", () => {
    const r = parseSlide(GOOD);
    expect(r.diagnostics).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.slide?.attrs.id).toBe("cover");
  });

  it("round-trips: serialize → parse → serialize is stable", () => {
    const once = serializeSlide(parseSlide(GOOD).slide!);
    const twice = serializeSlide(parseSlide(once).slide!);
    expect(twice).toBe(once);
    expect(once).toContain("&amp; your AI.");
    expect(once).toContain("<br>");
  });

  it("refuses files that aren't exactly one section", () => {
    expect(codes(`<div></div>`)).toContain("slide-root");
    expect(codes(`<section id="a" style="background:#fff"></section><section id="b"></section>`)).toContain("slide-root");
  });

  it("names unsupported CSS with the nearest supported change", () => {
    const r = parseSlide(`<section id="s" style="background:#fff"><p style="margin-top:20px;z-index:3;font-size:2em">x</p></section>`);
    const msgs = r.diagnostics.map((d) => d.message).join("\n");
    expect(msgs).toMatch(/margin is ignored/);
    expect(msgs).toMatch(/z-index is not supported: later children paint over/);
    expect(msgs).toMatch(/use px/);
    expect(r.ok).toBe(false);
  });

  it("reports line and column of the offending element", () => {
    const r = parseSlide(`<section id="s" style="background:#fff">\n  <p>ok</p>\n  <h4>no</h4>\n</section>`);
    const d = r.diagnostics.find((x) => x.code === "unknown-tag")!;
    expect(d.line).toBe(3);
    expect(d.col).toBe(3);
    expect(d.message).toMatch(/use h3/);
  });

  it("checks placement: block inside text, loose text, notes last", () => {
    expect(codes(`<section id="s" style="background:#fff"><h1>Hi <img src="assets/a.png" alt=""></h1></section>`)).toContain("misplaced");
    expect(codes(`<section id="s" style="background:#fff">hello</section>`)).toContain("loose-text");
    expect(codes(`<section id="s" style="background:#fff"><aside>n</aside><p>x</p></section>`)).toContain("notes-position");
    expect(codes(`<section id="s" style="background:#fff"><ul><p>x</p></ul></section>`)).toContain("misplaced");
  });

  it("blocks scripts, remote images and unsafe svg", () => {
    expect(codes(`<section id="s" style="background:#fff"><script>alert(1)</script></section>`)).toContain("unknown-tag");
    expect(codes(`<section id="s" style="background:#fff"><p onclick="x()">x</p></section>`)).toContain("script-attr");
    expect(codes(`<section id="s" style="background:#fff"><img src="https://x.com/a.png" alt=""></section>`)).toContain("bad-src");
    expect(codes(`<section id="s" style="background:#fff"><img src="data:image/png;base64,AAAA" alt=""></section>`)).toContain("bad-src");
    expect(codes(`<section id="s" style="background:#fff"><svg viewBox="0 0 10 10"><image href="http://x/y.png"/></svg></section>`)).toContain("svg-external");
    expect(codes(`<section id="s" style="background:#fff"><svg viewBox="0 0 10 10"><script>1</script></svg></section>`)).toContain("svg-script");
  });

  it("keeps svg markup verbatim, including case", () => {
    const html = `<section id="s" style="background:#fff"><svg viewBox="0 0 10 10" aria-label="dot"><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient><circle cx="5" cy="5" r="4" fill="url(#g)"/></svg></section>`;
    const r = parseSlide(html);
    expect(r.ok).toBe(true);
    const out = serializeSlide(r.slide!);
    expect(out).toContain("linearGradient");
    expect(out).toContain('viewBox="0 0 10 10"');
  });

  it("checks value ranges and grammar", () => {
    expect(codes(`<section id="s" style="background:#fff"><p style="font-weight:450">x</p></section>`)).toContain("bad-value");
    expect(codes(`<section id="s" style="background:#fff"><p style="color:red">x</p></section>`)).toContain("bad-value");
    expect(codes(`<section id="s" style="background:linear-gradient(90deg, #000, #fff)"><p style="transform:rotate(5deg) scale(1.1)">x</p></section>`)).toEqual([]);
    expect(codes(`<section id="s" style="background:#fff"><div style="border:2px #000">x</div></section>`)).toContain("bad-value");
    expect(codes(`<section id="s" style="background:#fff"><div style="display:grid;grid-template-columns:repeat(3, 1fr) 200px"></div></section>`)).toEqual([]);
  });

  it("warns (doesn't block) on readability and pinning slips", () => {
    const r = parseSlide(`<section id="s" style="background:#fff"><p style="font-size:14px;left:20px">tiny</p><img src="assets/a.png"></section>`);
    expect(r.ok).toBe(true);
    expect(r.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(["small-text", "offset-unpinned", "no-alt"]));
  });

  it("finds duplicate ids", () => {
    expect(codes(`<section id="s" style="background:#fff"><p id="a">1</p><p id="a">2</p></section>`)).toContain("duplicate-id");
  });
});

describe("deck index and theme", () => {
  const index = {
    format: "fenna-slides/0",
    title: "Q3",
    slides: ["cover", "plan"],
    sections: [{ title: "Intro", start: "cover" }],
    theme: {
      colors: { ink: "#151515", accent: "#ff6b35" },
      fonts: [{ family: "Inter", source: "google" }],
      textStyles: { eyebrow: "font-size:24px;font-weight:600;color:var(--accent);text-transform:uppercase" },
    },
  };

  it("accepts a valid index and resolves theme colors in slides", () => {
    const r = checkIndex(index);
    expect(r.errors).toEqual([]);
    const ctx = valueContext(r.index!);
    expect(parseSlide(`<section id="s" style="background:var(--ink)"><p style="color:var(--accent)">x</p></section>`, ctx).ok).toBe(true);
    const bad = parseSlide(`<section id="s" style="background:var(--paper)"></section>`, ctx);
    expect(bad.diagnostics[0]!.message).toMatch(/no color --paper/);
  });

  it("rejects bad indexes with every reason", () => {
    const r = checkIndex({ ...index, slides: ["cover", "cover", "9bad"], theme: { colors: { Accent: "red" } } });
    expect(r.index).toBeNull();
    expect(r.errors.join("\n")).toMatch(/listed twice/);
    expect(r.errors.join("\n")).toMatch(/9bad/);
    expect(r.errors.join("\n")).toMatch(/Accent/);
  });

  it("text styles: element styles win over the named style", () => {
    const theme = checkIndex(index).index!.theme;
    const el = parseSlide(`<section id="s" style="background:#fff"><p data-style="eyebrow" style="font-size:28px">x</p></section>`).slide!.children[0]!;
    if (el.type !== "element") throw new Error();
    const decls = resolvedStyle(el, theme);
    expect(decls.find((d) => d.name === "font-size")?.value).toBe("28px");
    expect(decls.find((d) => d.name === "color")?.value).toBe("var(--accent)");
  });

  it("text styles may not carry layout", () => {
    const r = checkIndex({ ...index, theme: { ...index.theme, textStyles: { bad: "position:absolute;font-size:20px" } } });
    expect(r.errors.join()).toMatch(/position can't be part of a text style/);
  });

  it("loads a deck folder: index order, unlisted files last, missing files reported, id mismatch", async () => {
    const files: Record<string, string> = {
      "deck.json": JSON.stringify(index),
      "slides/cover.html": `<section id="cover" style="background:var(--ink)"></section>`,
      "slides/extra.html": `<section id="wrong" style="background:#fff"></section>`,
    };
    const reader: DeckReader = {
      read: async (p) => files[p] ?? null,
      list: async (dir) => Object.keys(files).filter((f) => f.startsWith(dir + "/")).map((f) => f.slice(dir.length + 1)),
    };
    const deck = await loadDeck(reader);
    expect(deck.slides.map((s) => s.id)).toEqual(["cover", "extra"]);
    expect(deck.problems.join()).toMatch(/slides\/plan.html is missing/);
    expect(deck.slides[1]!.diagnostics.map((d) => d.code)).toContain("id-mismatch");
  });
});
