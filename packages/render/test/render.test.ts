import { describe, expect, it } from "vitest";
import { checkIndex, parseSlide } from "@opendeck/format";
import { elementAt, fontFaceCss, googleFontsUrl, slideMarkup } from "../src/index.ts";

const theme = checkIndex({
  format: "fenna-slides/0",
  title: "T",
  slides: ["s"],
  theme: {
    colors: { accent: "#ff6b35" },
    fonts: [{ family: "Instrument Serif", source: "google" }, { family: "Inter", source: "google", weights: [600, 400] }, { family: "Brand", source: "assets/brand.woff2" }],
    textStyles: { eyebrow: "font-size:24px;color:var(--accent)" },
  },
}).index!.theme;

const slide = parseSlide(
  `<section id="s" style="background:#111"><p data-style="eyebrow" style="font-size:28px">A &lt; B</p><div><img src="assets/a.png" alt="x"><h2 id="t">Title</h2></div></section>`,
).slide!;

describe("slideMarkup", () => {
  it("resolves text styles, theme vars, assets and addresses", () => {
    const html = slideMarkup(slide, theme, { assetBase: "od://d/", annotate: true });
    expect(html.startsWith('<section class="od-slide"')).toBe(true);
    expect(html).toContain("--accent:#ff6b35;background:#111");
    expect(html).toContain('data-od="0" style="font-size:28px;color:var(--accent)"');
    expect(html).toContain("A &lt; B");
    expect(html).toContain('src="od://d/assets/a.png"');
    expect(html).toContain('id="t" data-od="1.1"');
    expect(html).not.toContain("data-style");
  });

  it("finds elements by address", () => {
    expect(elementAt(slide, "1.1")?.attrs.id).toBe("t");
    expect(elementAt(slide, "")?.tag).toBe("section");
    expect(elementAt(slide, "5")).toBeNull();
  });

  it("builds font links", () => {
    expect(googleFontsUrl(theme)).toBe("https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Inter:wght@400;600&display=swap");
    expect(fontFaceCss(theme, "od://d/")).toContain('src:url("od://d/assets/brand.woff2")');
  });
});
