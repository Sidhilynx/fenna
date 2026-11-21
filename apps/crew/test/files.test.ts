import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyIndex, evaluateAll, exportXlsx, importXlsx, loadWorkbook, sheetFromCsv, type SheetData } from "@opendeck/sheet";

const require = createRequire(import.meta.url);
const { createStore } = require("../src/main/store.cjs");
const { createDisk } = require("../src/main/disk.cjs");
const { createFiles } = require("../src/main/files.cjs");
const { WORD_KINDS } = require("../src/main/attachments.cjs");
const zip = require("../src/main/ziplite.cjs");

const SLUG = "research";
const OUTSIDE_MSG = "That file is outside this bot's disk.";
const LINK_MSG = "A link can't be used on the bot's disk.";
// A 1x1 PNG.
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const starterFiles = (kind: string, title: string) => ({ [`${kind}.json`]: JSON.stringify({ title }), "tabs/tab-1.html": "<article></article>" });

let root: string;
let outside: string;
let store: { botDir(slug: string): string };
let disk: any;
let files: any;
let settingsFile: string;

const botDir = () => store.botDir(SLUG);

/** Writes a file at a disk path (Files/..., Documents/...), its folders made. */
function write(p: string, data: string | Buffer) {
  const full = disk.locate(SLUG, p).abs;
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, data);
}

const read = (p: string, extra: Record<string, unknown> = {}) => files.read(SLUG, { path: p, ...extra });

/** A workbook with a Budget sheet (a formula in B4) and a Team sheet, as bytes. */
function budgetXlsx(): Buffer {
  const budget = sheetFromCsv("sheet-1", "Budget", "Item,Amount\nRent,1200\nFood,300");
  budget.cells.A4 = { v: "Total" };
  budget.cells.B4 = { f: "=SUM(B2:B3)" };
  const team = sheetFromCsv("sheet-2", "Team", "Name,Role\nAda,Lead");
  const index = { ...emptyIndex("Budget"), sheets: [{ id: "sheet-1", title: "Budget" }, { id: "sheet-2", title: "Team" }] };
  const sheets: SheetData[] = [budget, team];
  return Buffer.from(exportXlsx(index, sheets, evaluateAll(new Map(sheets.map((s) => [s.id, s])), index.timeZone)));
}

/** A small real PDF: one page per string (an empty string is a page with no text), Helvetica, with a title and author when given. */
function makePdf(pages: string[], info?: { title: string; author: string }): Buffer {
  const objs: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((t, i) => {
    const stream = t ? `BT /F1 24 Tf 72 700 Td (${t}) Tj ET` : "";
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  const infoAt = objs.length;
  if (info) objs[infoAt] = `<< /Title (${info.title}) /Author (${info.author}) >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R${info ? ` /Info ${infoAt} 0 R` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A zip of the given parts, as an office file is one. */
const zipOf = (parts: Record<string, string>): Buffer => zip.createZip(Object.entries(parts).map(([name, s]) => ({ name, data: Buffer.from(s) })));

/** A Word document with a title, a deleted change, a heading, two list items (one with tab stops), a table and a text box with its fallback copy. */
function docx(): Buffer {
  const t = (s: string) => `<w:r><w:t>${s}</w:t></w:r>`;
  const p = (s: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${t(s)}</w:p>`;
  const tc = (...ps: string[]) => `<w:tc>${ps.map((s) => p(s)).join("")}</w:tc>`;
  const box = (s: string) => `<w:txbxContent>${p(s)}</w:txbxContent>`;
  const body = [
    p("FlowGuard", '<w:pStyle w:val="Title"/>'),
    `<w:p><w:r><w:t xml:space="preserve">Stops bad payments </w:t></w:r>${t("&amp; fraud.")}<w:del><w:r><w:delText>old words</w:delText></w:r></w:del></w:p>`,
    "<w:p/>",
    p("Plan", '<w:pStyle w:val="Heading2"/>'),
    p("Ship the beta", '<w:numPr><w:ilvl w:val="0"/></w:numPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs>'),
    p("Tell users", '<w:pStyle w:val="ListParagraph"/>'),
    `<w:tbl><w:tr>${tc("Quarter")}${tc("Goal")}</w:tr><w:tr>${tc("Q1")}${tc("Beta", "100 users")}</w:tr></w:tbl>`,
    `<w:p><w:r><mc:AlternateContent><mc:Choice><w:drawing>${box("Inside a box")}</w:drawing></mc:Choice><mc:Fallback><w:pict>${box("Inside a box")}</w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`,
  ].join("");
  return zipOf({ "[Content_Types].xml": "<Types/>", "word/document.xml": `<w:document><w:body>${body}</w:body></w:document>` });
}

/** A PowerPoint deck of two slides whose show order is the reverse of their file names, with a theme, a background, a picture, notes and a table. */
function pptx(): Buffer {
  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const sp = (ph: string, ...paras: string[]) => `<p:sp><p:nvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:txBody>${paras.join("")}</p:txBody></p:sp>`;
  const para = (s: string, lvl = 0) => `<a:p>${lvl ? `<a:pPr lvl="${lvl}"/>` : ""}<a:r><a:t>${s}</a:t></a:r></a:p>`;
  const tc = (s: string) => `<a:tc><a:txBody>${para(s)}</a:txBody></a:tc>`;
  return zipOf({
    "ppt/presentation.xml": '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
    "ppt/_rels/presentation.xml.rels": `<Relationships>${rel("rId2", "slide", "slides/slide1.xml")}${rel("rId3", "slide", "slides/slide2.xml")}${rel("rId9", "theme", "theme/theme1.xml")}</Relationships>`,
    "ppt/theme/theme1.xml":
      '<a:theme name="Night"><a:themeElements><a:clrScheme name="Night"><a:dk1><a:srgbClr val="0B0F19"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="22d3ee"/></a:accent1></a:clrScheme><a:fontScheme name="Night"><a:majorFont><a:latin typeface="Sora"/></a:majorFont><a:minorFont><a:latin typeface="Inter"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>',
    "ppt/slides/slide2.xml": `<p:sld><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="0B0F19"/></a:solidFill></p:bgPr></p:bg><p:spTree>${sp('<p:ph type="ctrTitle"/>', para("FlowGuard"))}${sp('<p:ph type="subTitle" idx="1"/>', para("Payments that check themselves"))}${sp('<p:ph type="sldNum"/>', "<a:p><a:fld><a:t>1</a:t></a:fld></a:p>")}<p:pic><p:nvPicPr/></p:pic></p:spTree></p:cSld></p:sld>`,
    "ppt/slides/_rels/slide2.xml.rels": `<Relationships>${rel("rId1", "notesSlide", "../notesSlides/notesSlide1.xml")}</Relationships>`,
    "ppt/notesSlides/notesSlide1.xml": `<p:notes><p:cSld><p:spTree>${sp('<p:ph type="sldImg"/>')}${sp('<p:ph type="body" idx="1"/>', para("Open with the fraud number."))}</p:spTree></p:cSld></p:notes>`,
    "ppt/slides/slide1.xml": `<p:sld><p:cSld><p:spTree>${sp('<p:ph type="title"/>', para("Why now"))}${sp('<p:ph idx="1"/>', para("Fraud is up"), para("Mostly card-not-present", 1))}<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr h="1">${tc("Year")}${tc("Loss")}</a:tr><a:tr h="1">${tc("2025")}${tc("$10B")}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
  });
}

/** An OpenDocument file whose body is the given markup. */
const odf = (body: string): Buffer => zipOf({ mimetype: "application/vnd.oasis.opendocument", "content.xml": `<office:document-content><office:body>${body}</office:body></office:document-content>` });

/** Loads a Fenna sheet folder with the sheet package, as the app's own check does. */
async function loadFolder(dir: string) {
  return loadWorkbook({
    read: async (rel: string) => {
      const f = path.join(dir, rel);
      return existsSync(f) ? readFileSync(f, "utf8") : null;
    },
    list: async (rel: string) => (existsSync(path.join(dir, rel)) ? readdirSync(path.join(dir, rel)) : []),
  });
}

const libraryDir = () => path.join(botDir(), "library");

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crew-files-"));
  outside = mkdtempSync(path.join(tmpdir(), "crew-files-outside-"));
  store = createStore(root);
  mkdirSync(botDir(), { recursive: true });
  writeFileSync(path.join(botDir(), "bot.md"), "# research\n");
  settingsFile = path.join(root, "disk-quotas.json");
  disk = createDisk({ store, starterFiles, settingsFile });
  files = createFiles({ disk });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("read_file: paths", () => {
  it("refuses anything outside the bot's disk", async () => {
    for (const p of ["/etc/passwd", "\\x", "Files/../../x", "C:/x", "Files/a/../../../b", "Nope/x.txt"]) {
      await expect(read(p)).rejects.toThrow(OUTSIDE_MSG);
    }
  });

  it("refuses Trash, which is restored before it can be read", async () => {
    write("Trash/old.txt", "old");
    await expect(read("Trash/old.txt")).rejects.toThrow("Restore it first");
  });

  it("refuses a file reached through a link", async () => {
    mkdirSync(path.join(outside, "dir"));
    writeFileSync(path.join(outside, "dir", "secret.txt"), "nope");
    mkdirSync(path.join(botDir(), "workspace"), { recursive: true });
    symlinkSync(path.join(outside, "dir"), path.join(botDir(), "workspace", "link"), "junction");
    await expect(read("Files/link/secret.txt")).rejects.toThrow(LINK_MSG);
  });

  it("says what to do for a missing file and for a folder", async () => {
    write("Files/notes/a.txt", "hi");
    await expect(read("Files/missing.txt")).rejects.toThrow("There is no file at Files/missing.txt");
    await expect(read("Files/notes")).rejects.toThrow("is a folder");
  });

  it("sends a Fenna document to the fenna tools", async () => {
    write("Documents/q3-report/doc.json", JSON.stringify({ title: "Q3" }));
    await expect(read("Documents/q3-report/doc.json")).rejects.toThrow('use path "q3-report" with doc_overview, then read_tab');
  });

  it("refuses a Documents entry that is not a document", async () => {
    write("Documents/loose.txt", "x");
    await expect(read("Documents/loose.txt")).rejects.toThrow("Documents holds Fenna documents only");
  });
});

describe("read_file: text", () => {
  it("shows the first 400 lines numbered, and says how to read on", async () => {
    write("Files/long.txt", Array.from({ length: 1000 }, (_, i) => `l${i + 1}`).join("\n"));
    const r = await read("Files/long.txt");
    expect(r.text).toMatch(/^long\.txt: lines 1-400 of 1000\./);
    expect(r.text).toContain("400  l400");
    expect(r.text).not.toContain("l401");
    expect(r.text).toContain("600 more lines. Read them with offset: 401.");
  });

  it("pages with offset and limit", async () => {
    write("Files/long.txt", Array.from({ length: 1000 }, (_, i) => `l${i + 1}`).join("\n"));
    const r = await read("Files/long.txt", { offset: 401, limit: 100 });
    expect(r.text).toContain("lines 401-500 of 1000");
    expect(r.text).toContain("401  l401");
    expect(r.text).toContain("500  l500");
    expect(r.text).toContain("500 more lines. Read them with offset: 501.");
  });

  it("says so when the offset is past the end, and for an empty file", async () => {
    write("Files/short.txt", "one\ntwo\n");
    await expect(read("Files/short.txt", { offset: 9 })).rejects.toThrow("has 2 lines, so line 9 is past its end");
    write("Files/empty.md", "");
    expect((await read("Files/empty.md")).text).toBe("empty.md is empty.");
  });

  it("shows a code or unknown text file, and says what a binary file is", async () => {
    write("Files/tool.py", "print('hi')\n");
    expect((await read("Files/tool.py")).text).toContain("1  print('hi')");
    write("Files/data.bin", Buffer.from([0, 1, 2, 3]));
    expect((await read("Files/data.bin")).text).toMatch(/data\.bin is a binary file \(BIN, 1 KB\)/);
  });

});

describe("read_file: PDF", () => {
  it("reads each page's text under its number, with the title and how to see a page", async () => {
    write("Files/Inbox/cryptlog.pdf", makePdf(["Cryptlog (pitch)", "Market size", ""], { title: "Cryptlog deck", author: "Ada" }));
    const r = await read("Files/Inbox/cryptlog.pdf");
    expect(r.text).toContain('PDF: 3 pages, "Cryptlog deck" by Ada. To see a page\'s layout, colors and pictures, read it with page: n.');
    expect(r.text).toMatch(/--- Page 1 ---\n\s*\d+  Cryptlog \(pitch\)/);
    expect(r.text).toContain("Market size");
    expect(r.text).toMatch(/--- Page 3 ---\n\s*\d+  \(no text on this page\)/);
    expect(r.image).toBeUndefined();
  });

  it("pages a long PDF's text with offset and limit", async () => {
    write("Files/long.pdf", makePdf(Array.from({ length: 30 }, (_, i) => `Body of page ${i + 1}`)));
    const first = await read("Files/long.pdf", { limit: 10 });
    expect(first.text).toMatch(/long\.pdf: lines 1-10 of \d+\./);
    expect(first.text).toMatch(/more lines\. Read them with offset: 11\./);
    expect((await read("Files/long.pdf", { offset: 11, limit: 200 })).text).toContain("Body of page 30");
  });

  it("says a PDF with no text is likely scanned, and to look at its pages", async () => {
    write("Files/scan.pdf", makePdf(["", ""]));
    expect((await read("Files/scan.pdf")).text).toBe("scan.pdf is a PDF of 2 pages with no text in it (it is likely scanned). See each page as an image with page: 1 to 2.");
  });

  it("says what to do with a broken PDF, and keeps page for PDFs", async () => {
    write("Files/broken.pdf", "%PDF-1.4 not really");
    await expect(read("Files/broken.pdf")).rejects.toThrow(/broken\.pdf: It isn't a readable PDF .* Ask the person to save or print it to PDF again\./);
    write("Files/notes.txt", "hi\n");
    await expect(read("Files/notes.txt", { page: 1 })).rejects.toThrow("page shows one page of a PDF as an image, and notes.txt isn't a PDF. Read it without page.");
  });

  it("shows a page as an image the model sees, and says when the page is past the end", async () => {
    const calls: { page: number; size: number; maxSide: number }[] = [];
    const pages = createFiles({
      disk,
      pdfPageImage: async (buf: Buffer, page: number, o: { maxSide: number; maxBytes: number }) => {
        calls.push({ page, size: buf.length, maxSide: o.maxSide });
        return page > 2 ? { pages: 2 } : { pages: 2, width: 1210, height: 1568, mimeType: "image/png", data: TINY_PNG.toString("base64") };
      },
    });
    const pdf = makePdf(["One", "Two"]);
    write("Files/deck.pdf", pdf);
    const r = await pages.read(SLUG, { path: "Files/deck.pdf", page: 2 });
    expect(r.text).toBe("deck.pdf, page 2 of 2: shown at 1210 × 1568 px. Read the file without page for its text.");
    expect(r.image).toEqual({ data: TINY_PNG.toString("base64"), mimeType: "image/png" });
    expect(calls).toEqual([{ page: 2, size: pdf.length, maxSide: 1568 }]);
    await expect(pages.read(SLUG, { path: "Files/deck.pdf", page: 3 })).rejects.toThrow("deck.pdf has 2 pages, so page 3 is past its end. Use a page from 1 to 2.");
  });
});

describe("read_file: Word, PowerPoint and OpenDocument", () => {
  it("reads a .docx: headings, lists, tables and text boxes, without deleted text", async () => {
    write("Files/Inbox/brief.docx", docx());
    const r = await read("Files/Inbox/brief.docx");
    expect(r.text).toContain("brief.docx: lines 1-");
    const body = r.text.split("\n").slice(1).map((l: string) => l.replace(/^\s*\d+ {2}/, "")).join("\n");
    expect(body).toBe(["# FlowGuard", "Stops bad payments & fraud.", "", "## Plan", "- Ship the beta", "- Tell users", "", "| Quarter | Goal |", "| Q1 | Beta / 100 users |", "", "Inside a box"].join("\n"));
    expect(r.text).not.toContain("old words");
  });

  it("reads a .pptx in show order: size, theme, titles, levels, tables, pictures, background and notes", async () => {
    write("Files/Inbox/flowguard.pptx", pptx());
    const r = await read("Files/Inbox/flowguard.pptx");
    const body = r.text.split("\n").slice(1).map((l: string) => l.replace(/^\s*\d+ {2}/, "")).join("\n");
    expect(body).toBe(
      [
        "PowerPoint deck: 2 slides, 16:9 (13.33 × 7.5 in).",
        'Theme "Night" fonts: Sora (headings), Inter (body).',
        "Theme colors: dk1 #0B0F19, lt1 #FFFFFF, accent1 #22D3EE.",
        "",
        "--- Slide 1 ---",
        "Background: #0B0F19.",
        "# FlowGuard",
        "Payments that check themselves",
        "[1 picture]",
        "Notes: Open with the fraud number.",
        "",
        "--- Slide 2 ---",
        "# Why now",
        "Fraud is up",
        "  Mostly card-not-present",
        "| Year | Loss |",
        "| 2025 | $10B |",
      ].join("\n"),
    );
  });

  it("reads .odt and .odp files", async () => {
    write("Files/memo.odt", odf("<office:text><text:h text:outline-level=\"2\">Plan</text:h><text:p>Ship<text:s text:c=\"2\"/>it<text:tab/>now</text:p></office:text>"));
    expect((await read("Files/memo.odt")).text).toMatch(/1 {2}## Plan\n\s*2 {2}Ship {2}it\tnow/);
    write(
      "Files/talk.odp",
      odf(
        '<office:presentation><draw:page draw:name="p1"><draw:frame presentation:class="title"><draw:text-box><text:p>Hello</text:p></draw:text-box></draw:frame><draw:frame><draw:text-box><text:p>World</text:p></draw:text-box></draw:frame><presentation:notes><draw:frame><draw:text-box><text:p>Say hi</text:p></draw:text-box></draw:frame></presentation:notes></draw:page></office:presentation>',
      ),
    );
    const odp = (await read("Files/talk.odp")).text;
    expect(odp).toContain("Presentation: 1 slide.");
    expect(odp).toMatch(/--- Slide 1 ---\n\s*\d+ {2}# Hello\n\s*\d+ {2}World\n\s*\d+ {2}Notes: Say hi/);
  });

  it("says what to do with a broken office file", async () => {
    write("Files/broken.docx", "not a zip");
    await expect(read("Files/broken.docx")).rejects.toThrow(/broken\.docx can't be read as a Word document\. It isn't a readable Word file .* Save it again from the app that made it\./);
    write("Files/empty.pptx", zipOf({ "ppt/presentation.xml": "<p:presentation/>" }));
    expect((await read("Files/empty.pptx")).text).toContain("PowerPoint deck: 0 slides.");
  });

  it("refuses page for a deck, which has no page images", async () => {
    write("Files/flowguard.pptx", pptx());
    await expect(read("Files/flowguard.pptx", { page: 1 })).rejects.toThrow("flowguard.pptx isn't a PDF");
  });
});

describe("read_file: every document a person can attach", () => {
  // A new kind added to the attachment list is checked here, so a bot never meets a document it can only give up on.
  const kinds = { ...WORD_KINDS, pdf: ["pdf"] } as Record<string, string[]>;
  const samples: Record<string, () => Buffer> = {
    xlsx: budgetXlsx,
    xlsm: budgetXlsx,
    csv: () => Buffer.from("a,b\n1,2\n"),
    tsv: () => Buffer.from("a\tb\n1\t2\n"),
    docx: docx,
    pptx: pptx,
    odt: () => odf("<office:text><text:p>Hi</text:p></office:text>"),
    odp: () => odf('<office:presentation><draw:page><draw:frame><draw:text-box><text:p>Hi</text:p></draw:text-box></draw:frame></draw:page></office:presentation>'),
    rtf: () => Buffer.from("{\\rtf1\\ansi Hello}"),
    pdf: () => makePdf(["Hello"]),
  };
  for (const [word, exts] of Object.entries(kinds)) {
    for (const e of exts) {
      it(`reads a .${e} (${word}), or names the copy to ask the person for`, async () => {
        const make = samples[e];
        write(`Files/Inbox/file.${e}`, make ? make() : Buffer.from([0, 1, 2]));
        const r = read(`Files/Inbox/file.${e}`);
        if (make) {
          const { text } = await r;
          expect(text).not.toMatch(/binary file|can't be read|isn't supported/);
        } else {
          await expect(r).rejects.toThrow(/can't be read here\. Ask the person to save it as \S+/);
        }
      });
    }
  }
});

describe("read_file: tables", () => {
  it("shows a CSV as a table with its size and row numbers", async () => {
    write("Files/people.csv", 'name,amount\nAda,3\nLin,"5, five"\n');
    const r = await read("Files/people.csv");
    expect(r.text).toContain('Sheet "people": 3 rows, 2 columns (A1:B3).');
    expect(r.text).toContain("1 | name | amount");
    expect(r.text).toContain("2 | Ada | 3");
    expect(r.text).toContain("3 | Lin | 5, five");
    expect(r.text).toContain("Rows 1-3 shown.");
  });

  it("pages CSV rows with offset and limit", async () => {
    write("Files/people.csv", "name,amount\nAda,3\nLin,5\n");
    const r = await read("Files/people.csv", { offset: 2, limit: 1 });
    expect(r.text).toContain("2 | Ada | 3");
    expect(r.text).not.toContain("3 | Lin | 5");
    expect(r.text).toContain("1 more rows. Read them with offset: 3.");
  });

  it("shows a TSV file as a table", async () => {
    write("Files/scores.tsv", "team\tpoints\nred\t7\n");
    expect((await read("Files/scores.tsv")).text).toContain("2 | red | 7");
  });

  it("shows every sheet of an .xlsx with computed values, and one sheet when asked", async () => {
    write("Files/budget.xlsx", budgetXlsx());
    const r = await read("Files/budget.xlsx");
    expect(r.text).toContain("budget.xlsx: 2 sheets");
    expect(r.text).toContain('Sheet "Budget": 4 rows, 2 columns (A1:B4).');
    expect(r.text).toContain("2 | Rent | 1200");
    expect(r.text).toContain("4 | Total | 1500");
    expect(r.text).toContain('Sheet "Team": 2 rows, 2 columns');

    const one = await read("Files/budget.xlsx", { sheet: "team" });
    expect(one.text).not.toContain('Sheet "Budget"');
    expect(one.text).toContain("2 | Ada | Lead");
    expect((await read("Files/budget.xlsx", { sheet: 1 })).text).toContain('Sheet "Budget"');
    await expect(read("Files/budget.xlsx", { sheet: 3 })).rejects.toThrow('There is no sheet 3 in budget.xlsx. Its sheets are: 1 "Budget", 2 "Team".');
  });

  it("says what to do with a broken .xlsx and with an old .xls", async () => {
    write("Files/broken.xlsx", "not a workbook");
    await expect(read("Files/broken.xlsx")).rejects.toThrow("isn't a readable .xlsx workbook");
    write("Files/old.xls", "x");
    await expect(read("Files/old.xls")).rejects.toThrow("Ask the person to save it as .xlsx");
  });
});

describe("read_file: images", () => {
  it("returns a PNG as an image the model sees, with its name, size and bytes", async () => {
    write("Files/tiny.png", TINY_PNG);
    const r = await read("Files/tiny.png");
    expect(r.text).toMatch(/^tiny\.png: 1 × 1 px, \d+ (bytes|KB)\.$/);
    expect(r.image).toEqual({ data: TINY_PNG.toString("base64"), mimeType: "image/png" });
  });

  it("scales an image whose longest side is over 1568 px, with the image's own encoder", async () => {
    // A PNG header that says 3000 x 2000; the scaling is checked, not the picture.
    const header = Buffer.concat([
      Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
      Buffer.from([0, 0, 0x0b, 0xb8, 0, 0, 0x07, 0xd0]),
      Buffer.alloc(16),
    ]);
    write("Files/big.png", header);
    const resized: { width: number; height: number }[] = [];
    const picture = (width: number, height: number) => ({
      isEmpty: () => false,
      resize: (o: { width: number; height: number }) => {
        resized.push(o);
        return picture(o.width, o.height);
      },
      toPNG: () => Buffer.alloc(1000),
      toJPEG: () => Buffer.alloc(10),
    });
    const scaled = createFiles({ disk, nativeImage: () => ({ createFromBuffer: () => picture(3000, 2000) }) });
    const r = await scaled.read(SLUG, { path: "Files/big.png" });
    expect(r.text).toContain("big.png: 3000 × 2000 px");
    expect(r.text).toContain("Shown at 1568 × 1045 px");
    expect(resized).toEqual([{ width: 1568, height: 1045, quality: "best" }]);
    expect(r.image.mimeType).toBe("image/png");
  });
});

describe("import_sheet", () => {
  it("makes a Fenna sheet folder that the sheet package checks with zero problems", async () => {
    write("Files/budget.xlsx", budgetXlsx());
    const r = await files.importSheet(SLUG, { path: "Files/budget.xlsx", title: "Budget Q3" });
    expect(r.text).toContain('Created the sheet "Budget Q3" at path "budget-q3" with 2 sheets: "Budget", "Team".');
    expect(r.text).toContain('sheet_overview {path: "budget-q3"}');

    const folder = path.join(libraryDir(), "budget-q3");
    const wb = await loadFolder(folder);
    expect(wb.problems).toEqual([]);
    for (const s of wb.sheets.values()) expect(s.error).toBeNull();
    expect(wb.index.title).toBe("Budget Q3");
    const budget = wb.sheets.get("sheet-1")!.sheet!;
    expect(budget.cells.A2?.v).toBe("Rent");
    expect(budget.cells.B2?.v).toBe(1200);
    expect(budget.cells.B4?.f).toBe("=SUM(B2:B3)");
    expect(readdirSync(libraryDir()).some((n) => n.startsWith("."))).toBe(false);
  });

  it("imports a CSV under its file name, and a folder name never clashes", async () => {
    write("Files/people.csv", "name,amount\nAda,3\n");
    expect((await files.importSheet(SLUG, { path: "Files/people.csv" })).text).toContain('at path "people"');
    expect((await files.importSheet(SLUG, { path: "Files/people.csv" })).text).toContain('at path "people-2"');
    const wb = await loadFolder(path.join(libraryDir(), "people"));
    expect(wb.problems).toEqual([]);
    expect(wb.sheets.get("sheet-1")!.sheet!.cells.A1?.v).toBe("name");
  });

  it("refuses other files, other places and titles that are too long", async () => {
    write("Files/notes.txt", "x");
    write("Files/a.csv", "x");
    await expect(files.importSheet(SLUG, { path: "Files/notes.txt" })).rejects.toThrow("import_sheet takes an .xlsx or .csv file");
    write("Documents/x/sheet.json", "{}");
    await expect(files.importSheet(SLUG, { path: "Documents/x/sheet.json" })).rejects.toThrow("Import a spreadsheet from Files or Downloads");
    await expect(files.importSheet(SLUG, { path: "Files/a.csv", title: "x".repeat(201) })).rejects.toThrow("The title is 201 characters");
  });

  it("refuses a file that will not fit in the bot's disk", async () => {
    write("Files/a.csv", "name\nAda\n");
    const tight = createFiles({ disk: { ...disk, free: () => 10 } });
    await expect(tight.importSheet(SLUG, { path: "Files/a.csv" })).rejects.toThrow("That won't fit in the bot's disk.");
  });
});

describe("export_file", () => {
  async function importBudget() {
    write("Files/budget.xlsx", budgetXlsx());
    await files.importSheet(SLUG, { path: "Files/budget.xlsx", title: "Budget Q3" });
  }

  it("saves a sheet as .xlsx in Files/Outbox, and the file reads back to the same values", async () => {
    await importBudget();
    const r = await files.exportFile(SLUG, { document: "Documents/budget-q3", format: "xlsx" });
    expect(r.text).toMatch(/^Exported "Budget Q3" to Files\/Outbox\/Budget Q3\.xlsx \(.+\): 2 sheets\.$/);
    const back = await importXlsx(new Uint8Array(readFileSync(disk.locate(SLUG, "Files/Outbox/Budget Q3.xlsx").abs)));
    expect(back.sheets.map((s) => s.title)).toEqual(["Budget", "Team"]);
    expect(back.sheets[0]!.cells.A2?.v).toBe("Rent");
    expect(back.sheets[0]!.cells.B2?.v).toBe(1200);
    expect(back.sheets[0]!.cells.B4?.f).toBe("=SUM(B2:B3)");
  });

  it("saves the first sheet as .csv, and a second export takes a new name", async () => {
    await importBudget();
    const first = await files.exportFile(SLUG, { document: "Documents/budget-q3", format: "csv" });
    expect(first.text).toContain('the first sheet, "Budget"');
    expect(readFileSync(disk.locate(SLUG, "Files/Outbox/Budget Q3.csv").abs, "utf8")).toBe("Item,Amount\r\nRent,1200\r\nFood,300\r\nTotal,1500\r\n");
    const second = await files.exportFile(SLUG, { document: "Documents/budget-q3", format: "csv" });
    expect(second.text).toContain("to Files/Outbox/Budget Q3 (2).csv");
    expect(existsSync(disk.locate(SLUG, "Files/Outbox/Budget Q3 (2).csv").abs)).toBe(true);
  });

  it("saves to a path the person names in Files, and refuses to overwrite it", async () => {
    await importBudget();
    const r = await files.exportFile(SLUG, { document: "Documents/budget-q3", format: "xlsx", to: "Files/reports/q3" });
    expect(r.text).toContain("to Files/reports/q3.xlsx");
    await expect(files.exportFile(SLUG, { document: "Documents/budget-q3", format: "xlsx", to: "Files/reports/q3.xlsx" })).rejects.toThrow("There is already a file at Files/reports/q3.xlsx");
    await expect(files.exportFile(SLUG, { document: "Documents/budget-q3", format: "xlsx", to: "Downloads/q3.xlsx" })).rejects.toThrow("Export into Files");
  });

  it("refuses documents that are not sheets, bad formats and a full disk", async () => {
    write("Documents/notes/doc.json", JSON.stringify({ title: "Notes" }));
    await expect(files.exportFile(SLUG, { document: "Documents/notes", format: "xlsx" })).rejects.toThrow("isn't a Fenna sheet");
    await expect(files.exportFile(SLUG, { document: "Documents/missing", format: "xlsx" })).rejects.toThrow('There is no document "missing"');
    await importBudget();
    await expect(files.exportFile(SLUG, { document: "Documents/budget-q3", format: "pdf" })).rejects.toThrow('Use format "xlsx" or "csv"');
    const tight = createFiles({ disk: { ...disk, free: () => 10 } });
    await expect(tight.exportFile(SLUG, { document: "Documents/budget-q3", format: "xlsx" })).rejects.toThrow("That won't fit in the bot's disk.");
  });

  it("round trips: a CSV becomes a sheet and goes back out as the same CSV", async () => {
    write("Files/people.csv", "name,amount\nAda,3\nLin,5\n");
    await files.importSheet(SLUG, { path: "Files/people.csv" });
    await files.exportFile(SLUG, { document: "Documents/people", format: "csv" });
    expect(readFileSync(disk.locate(SLUG, "Files/Outbox/people.csv").abs, "utf8")).toBe("name,amount\r\nAda,3\r\nLin,5\r\n");
  });
});
