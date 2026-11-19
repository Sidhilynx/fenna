import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "../src/renderer/md.ts";

describe("parseInline", () => {
  it("reads bold, italic, code and links", () => {
    expect(parseInline('Made **"Example.com check"** for *you*, see `memory.md` and [the page](https://example.com).')).toEqual([
      { t: "text", v: "Made " },
      { t: "b", c: [{ t: "text", v: '"Example.com check"' }] },
      { t: "text", v: " for " },
      { t: "i", c: [{ t: "text", v: "you" }] },
      { t: "text", v: ", see " },
      { t: "code", v: "memory.md" },
      { t: "text", v: " and " },
      { t: "link", c: [{ t: "text", v: "the page" }], url: "https://example.com" },
      { t: "text", v: "." },
    ]);
  });

  it("leaves unmatched marks, snake_case and spaced stars as text", () => {
    expect(parseInline("2 * 3 = 6, file_name_here and **open")).toEqual([{ t: "text", v: "2 * 3 = 6, file_name_here and **open" }]);
  });

  it("honours escapes", () => {
    expect(parseInline("\\*not italic\\*")).toEqual([{ t: "text", v: "*not italic*" }]);
  });

  it("nests italic inside bold", () => {
    expect(parseInline("**a _b_ c**")).toEqual([{ t: "b", c: [{ t: "text", v: "a " }, { t: "i", c: [{ t: "text", v: "b" }] }, { t: "text", v: " c" }] }]);
  });
});

describe("parseMarkdown", () => {
  it("splits paragraphs on blank lines and keeps line breaks", () => {
    const blocks = parseMarkdown("one\ntwo\n\nthree");
    expect(blocks).toEqual([
      { t: "p", c: [{ t: "text", v: "one" }, { t: "br" }, { t: "text", v: "two" }] },
      { t: "p", c: [{ t: "text", v: "three" }] },
    ]);
  });

  it("reads headings, lists and code blocks", () => {
    const blocks = parseMarkdown("## Found\n- a\n- **b**\n\n3. x\n4. y\n```\nraw *text*\n```");
    expect(blocks).toEqual([
      { t: "h", c: [{ t: "text", v: "Found" }] },
      { t: "ul", items: [[{ t: "text", v: "a" }], [{ t: "b", c: [{ t: "text", v: "b" }] }]] },
      { t: "ol", start: 3, items: [[{ t: "text", v: "x" }], [{ t: "text", v: "y" }]] },
      { t: "pre", v: "raw *text*" },
    ]);
  });

  it("handles empty text, CRLF and an unclosed fence", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("a\r\nb")).toEqual([{ t: "p", c: [{ t: "text", v: "a" }, { t: "br" }, { t: "text", v: "b" }] }]);
    expect(parseMarkdown("```\nopen")).toEqual([{ t: "pre", v: "open" }]);
  });
});
