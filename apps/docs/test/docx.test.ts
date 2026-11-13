import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { type DocIndex, emptyIndex, parseTab } from "@opendeck/doc";
import { docxFromDoc } from "../src/renderer/export/docx.ts";
import { crc32, zip } from "../src/renderer/export/zip.ts";

/** Read a stored zip back: name → text. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (v.getUint32(at, true) === 0x04034b50) {
    const method = v.getUint16(at + 8, true);
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const data = bytes.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    expect(v.getUint32(at + 14, true)).toBe(crc32(data));
    out.set(name, new TextDecoder().decode(method ? inflateRawSync(data) : data));
    at += 30 + nameLen + size;
  }
  return out;
}

describe("zip", () => {
  it("writes entries a reader gets back with matching checksums", () => {
    const files = unzip(zip([{ name: "a.txt", data: "hello" }, { name: "b/c.xml", data: "<x/>" }]));
    expect([...files]).toEqual([["a.txt", "hello"], ["b/c.xml", "<x/>"]]);
  });
});

describe("Word export", () => {
  const index: DocIndex = { ...emptyIndex("Plan & notes"), tabs: [{ id: "a", title: "First", children: [] }, { id: "b", title: "", children: [] }] };
  const tab = (id: string, body: string) => {
    const r = parseTab(`<article id="${id}">${body}</article>`);
    return { id, tab: r.tab, diagnostics: r.diagnostics, source: "" };
  };
  const doc = {
    index,
    tabs: new Map([
      ["a", tab("a", `<h1 id="h">Head</h1><p id="p">a <b>bold</b> <a href="https://x.y">link</a> <del data-sid="s1" data-by="you">old</del><ins data-sid="s1" data-by="you">new</ins></p><ol id="o" start="3"><li>three<ul><li>sub</li></ul></li></ol><ul id="c" data-checklist><li data-checked>done</li></ul>`)],
      ["b", tab("b", `<table id="t"><tr><th>H</th></tr><tr><td>1</td></tr></table><pre id="c2">x\ny</pre><figure id="f"><img src="assets/a.png" alt="A"></figure>`)],
    ]),
  };
  const files = unzip(docxFromDoc(doc, new Map([["assets/a.png", { bytes: new Uint8Array([1, 2, 3]), ext: "png", width: 200, height: 100 }]]), new Date("2026-11-12T00:00:00Z")));
  const body = files.get("word/document.xml")!;

  it("has every part Word needs", () => {
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/document.xml", "word/styles.xml", "word/numbering.xml", "word/_rels/document.xml.rels", "word/media/image1.png"]);
  });

  it("writes the title, tab titles and shifted headings", () => {
    expect(body).toContain(`<w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">Plan &amp; notes</w:t>`);
    expect(body).toMatch(/Heading1"\/><\/w:pPr><w:r><w:t xml:space="preserve">First/);
    expect(body).toMatch(/Heading2"\/><\/w:pPr><w:r><w:t xml:space="preserve">Head/);
  });

  it("turns suggestions into tracked changes and links into hyperlinks", () => {
    expect(body).toMatch(/<w:del w:id="\d+" w:author="You"[^>]*><w:r><w:delText xml:space="preserve">old<\/w:delText>/);
    expect(body).toMatch(/<w:ins w:id="\d+" w:author="You"[^>]*><w:r><w:t xml:space="preserve">new/);
    expect(body).toMatch(/<w:hyperlink r:id="rId\d+">/);
    expect(files.get("word/_rels/document.xml.rels")).toContain(`Target="https://x.y" TargetMode="External"`);
  });

  it("numbers lists from their start, checks checklists, and embeds images at their size", () => {
    expect(files.get("word/numbering.xml")).toContain(`<w:startOverride w:val="3"/>`);
    expect(body).toContain("☑ ");
    expect(body).toContain(`<wp:extent cx="1905000" cy="952500"/>`);
    expect(body).toContain("<w:tblHeader/>");
    expect(body.match(/w:val="Code"/g)).toHaveLength(2);
  });
});
