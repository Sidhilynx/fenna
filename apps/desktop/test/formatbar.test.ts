import { describe, expect, it, vi } from "vitest";
import { getAt, parseSlide, serializeSlide } from "@opendeck/format";

vi.mock("../src/renderer/api.ts", () => ({ api: () => ({}), ASSET_BASE: "odasset://deck/" }));
vi.mock("../src/renderer/editor/store.ts", () => ({ editSlide: vi.fn(), useEditor: vi.fn() }));
vi.mock("../src/renderer/editor/comments.ts", () => ({ newComment: vi.fn() }));

const { convertTag, shouldShowFormatBar } = await import("../src/renderer/editor/FormatBar.tsx");

const CTX = { colorTokens: new Set<string>(), families: new Set<string>() };

function slideFrom(body: string) {
  const r = parseSlide(`<section id="s1" style="background:#fff">${body}</section>`, CTX);
  if (!r.slide) throw new Error("invalid fixture");
  return r.slide;
}

describe("FormatBar helpers", () => {
  it("detects text elements that show the format bar", () => {
    const s = slideFrom(`<h2>Title</h2><p>Body</p><ul><li>One</li></ul><x-shape kind="rect"></x-shape>`);
    expect(shouldShowFormatBar(getAt(s, "0"))).toBe(true);
    expect(shouldShowFormatBar(getAt(s, "1"))).toBe(true);
    expect(shouldShowFormatBar(getAt(s, "2"))).toBe(true);
    expect(shouldShowFormatBar(getAt(s, "3"))).toBe(false);
    expect(shouldShowFormatBar(null)).toBe(false);
  });

  it("converts between heading and paragraph while keeping styles and content", () => {
    const s = slideFrom(`<h2 data-fit="1" style="font-size:48px;color:#111">Four tools, <b>one</b> engine</h2>`);
    const next = convertTag(s, "0", getAt(s, "0")!, "p", CTX);
    const el = getAt(next, "0")!;
    expect(el.tag).toBe("p");
    expect(el.attrs["data-fit"]).toBe("1");
    expect(serializeSlide(next)).toContain(`<p data-fit="1" style="font-size:48px;color:#111">Four tools, <b>one</b> engine</p>`);
  });

  it("converts text with line breaks into a list and drops invalid attrs like data-fit", () => {
    const s = slideFrom(`<p data-fit="1" style="font-size:28px">First<br>Second</p>`);
    const asList = convertTag(s, "0", getAt(s, "0")!, "ul", CTX);
    const listEl = getAt(asList, "0")!;
    expect(listEl.tag).toBe("ul");
    expect(listEl.attrs["data-fit"]).toBeUndefined();
    const listHtml = serializeSlide(asList);
    expect(listHtml).toContain("<li>First</li>");
    expect(listHtml).toContain("<li>Second</li>");

    const backToPara = convertTag(asList, "0", listEl, "p", CTX);
    expect(getAt(backToPara, "0")!.tag).toBe("p");
    expect(serializeSlide(backToPara)).toContain(`<p style="font-size:28px">First<br>Second</p>`);
  });

  it("switches between bullet and numbered lists", () => {
    const s = slideFrom(`<ul><li>Alpha</li><li>Beta</li></ul>`);
    const ordered = convertTag(s, "0", getAt(s, "0")!, "ol", CTX);
    expect(getAt(ordered, "0")!.tag).toBe("ol");
    const html = serializeSlide(ordered);
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>Alpha</li>");
    expect(html).toContain("<li>Beta</li>");
  });
});
