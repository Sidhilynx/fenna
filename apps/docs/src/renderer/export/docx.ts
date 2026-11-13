// A doc as a Word file (.docx): the doc's title, then each tab (under its
// title when there are several), with headings, lists, checklists, quotes,
// code, tables, images and links in Word's own styles. Suggestions become
// Word's tracked changes, so they can be accepted or rejected in Word too.
// Pure: the page measures and converts the images and passes them in.

import { type DocIndex, type DocNode, type ElementNode, type LoadedTab, elementChildren, flattenTabs, tabLabel } from "@opendeck/doc";
import { zip } from "./zip.ts";

export interface DocxImage {
  bytes: Uint8Array;
  ext: "png" | "jpeg" | "gif";
  width: number;
  height: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Control characters Word refuses in XML.
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
/** The text column of an A4/Letter page with 1-inch margins, in EMU (6.27 in). */
const COLUMN_EMU = 5_733_000;
const EMU_PER_PX = 9525;

interface Marks {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  code?: boolean;
  link?: boolean;
  /** Word color, without "#". */
  color?: string;
  mark?: boolean;
}

/** The doc's text colors as Word draws them. */
const WORD_COLORS: Record<string, string> = { red: "D93A3A", yellow: "B8860B", green: "2E8B57", teal: "128A80", purple: "7B4CC2" };

class Writer {
  rels: string[] = [];
  media: { name: string; data: Uint8Array }[] = [];
  nums: string[] = [];
  private relN = 3;
  private changeN = 1;
  private imageN = 1;
  private numN = 3;

  private readonly images: Map<string, DocxImage>;
  private readonly date: string;

  constructor(images: Map<string, DocxImage>, date: string) {
    this.images = images;
    this.date = date;
  }

  rel(type: string, target: string, external = false): string {
    const id = `rId${this.relN++}`;
    this.rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ""}/>`);
    return id;
  }

  /** A fresh numbering instance, so each numbered list starts again from its own start. */
  newNum(abstract: 0 | 1, start = 1): number {
    const id = this.numN++;
    this.nums.push(`<w:num w:numId="${id}"><w:abstractNumId w:val="${abstract}"/>${abstract === 1 ? `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride>` : ""}</w:num>`);
    return id;
  }

  runs(nodes: DocNode[], m: Marks = {}): string {
    let out = "";
    for (const n of nodes) {
      if (n.type === "text") {
        out += this.run(n.text, m);
        continue;
      }
      switch (n.tag) {
        case "b":
        case "i":
        case "u":
        case "s":
          out += this.runs(n.children, { ...m, [n.tag]: true });
          break;
        case "code":
          out += this.runs(n.children, { ...m, code: true });
          break;
        case "mark":
          out += this.runs(n.children, { ...m, mark: true });
          break;
        case "br":
          out += "<w:r><w:br/></w:r>";
          break;
        case "a": {
          const href = n.attrs.href ?? "";
          if (/^(https?:|mailto:)/.test(href)) out += `<w:hyperlink r:id="${this.rel("hyperlink", href, true)}">${this.runs(n.children, { ...m, link: true })}</w:hyperlink>`;
          else out += this.runs(n.children, m);
          break;
        }
        case "ins":
          out += `<w:ins w:id="${this.changeN++}" w:author="${esc(n.attrs["data-by"] === "you" || !n.attrs["data-by"] ? "You" : n.attrs["data-by"])}" w:date="${this.date}">${this.runs(n.children, m)}</w:ins>`;
          break;
        case "del":
          out += `<w:del w:id="${this.changeN++}" w:author="${esc(n.attrs["data-by"] === "you" || !n.attrs["data-by"] ? "You" : n.attrs["data-by"])}" w:date="${this.date}">${this.runs(n.children, m).replace(/<w:t( xml:space="preserve")?>/g, '<w:delText xml:space="preserve">').replace(/<\/w:t>/g, "</w:delText>")}</w:del>`;
          break;
        default:
          // Colored text; dates and dropdown values are their text.
          out += this.runs(n.children, n.tag === "span" && n.attrs["data-text"] ? { ...m, color: WORD_COLORS[n.attrs["data-text"]] } : m);
      }
    }
    return out;
  }

  run(text: string, m: Marks): string {
    // Word wants run properties in schema order: style, fonts, bold, italic, strike, underline, shading.
    const props = [m.link ? '<w:rStyle w:val="Hyperlink"/>' : "", m.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : "", m.b ? "<w:b/>" : "", m.i ? "<w:i/>" : "", m.s ? "<w:strike/>" : "", m.color && !m.link ? `<w:color w:val="${m.color}"/>` : "", m.mark ? '<w:highlight w:val="yellow"/>' : "", m.u || m.link ? '<w:u w:val="single"/>' : "", m.code ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F1F0"/>' : ""].join("");
    return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(clean(text))}</w:t></w:r>`;
  }

  para(content: string, props = ""): string {
    return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${content}</w:p>`;
  }

  list(list: ElementNode, level: number, num: number): string {
    const check = list.attrs["data-checklist"] !== undefined;
    let out = "";
    for (const li of elementChildren(list)) {
      const text = li.children.filter((c) => !(c.type === "element" && (c.tag === "ul" || c.tag === "ol")));
      const box = check ? this.run(li.attrs["data-checked"] !== undefined ? "☑ " : "☐ ", {}) : "";
      const props = check ? `<w:pStyle w:val="ListParagraph"/><w:ind w:left="${360 + level * 360}" w:hanging="0"/>` : `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${num}"/></w:numPr>`;
      out += this.para(box + this.runs(text), props);
      for (const sub of elementChildren(li).filter((c) => c.tag === "ul" || c.tag === "ol")) out += this.list(sub, Math.min(8, level + 1), sub.tag === "ol" ? this.newNum(1, Number(sub.attrs.start ?? 1)) : num);
    }
    return out;
  }

  table(t: ElementNode): string {
    const rows = elementChildren(t);
    const cols = Math.max(1, ...rows.map((r) => elementChildren(r).length));
    const w = Math.floor(9000 / cols);
    const grid = `<w:tblGrid>${`<w:gridCol w:w="${w}"/>`.repeat(cols)}</w:tblGrid>`;
    const body = rows
      .map((r) => {
        const cells = elementChildren(r);
        const head = cells.every((c) => c.tag === "th");
        return `<w:tr>${head ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells.map((c) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${c.tag === "th" ? '<w:shd w:val="clear" w:color="auto" w:fill="F3F3F2"/>' : ""}</w:tcPr>${this.para(this.runs(c.children, { b: c.tag === "th" }))}</w:tc>`).join("")}</w:tr>`;
      })
      .join("");
    return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${grid}${body}</w:tbl>${this.para("")}`;
  }

  figure(f: ElementNode): string {
    const img = elementChildren(f).find((c) => c.tag === "img");
    const cap = elementChildren(f).find((c) => c.tag === "figcaption");
    const data = img ? this.images.get(img.attrs.src ?? "") : undefined;
    let out = "";
    if (data && img) {
      const n = this.imageN++;
      const name = `image${n}.${data.ext === "jpeg" ? "jpg" : data.ext}`;
      this.media.push({ name, data: data.bytes });
      const id = this.rel("image", `media/${name}`);
      const pct = Number(f.attrs["data-width"] ?? 100) / 100;
      const cx = Math.round(Math.min(COLUMN_EMU * pct, data.width * EMU_PER_PX));
      const cy = Math.round((cx * data.height) / Math.max(1, data.width));
      const alt = esc(clean(img.attrs.alt ?? ""));
      out += this.para(
        `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}" descr="${alt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`,
        '<w:jc w:val="center"/>',
      );
    } else if (img) out += this.para(this.run(`[Image: ${img.attrs.alt || img.attrs.src}]`, { i: true }));
    if (cap) out += this.para(this.runs(cap.children), '<w:pStyle w:val="Caption"/><w:jc w:val="center"/>');
    return out;
  }

  block(b: ElementNode, shift: number): string {
    switch (b.tag) {
      case "h1":
      case "h2":
      case "h3":
        return this.para(this.runs(b.children), `<w:pStyle w:val="Heading${Math.min(5, Number(b.tag[1]) + shift)}"/>`);
      case "p":
        return this.para(this.runs(b.children));
      case "blockquote":
        return this.para(this.runs(b.children), '<w:pStyle w:val="Quote"/>');
      case "pre": {
        const text = b.children.map((c) => (c.type === "text" ? c.text : "")).join("");
        return text.split("\n").map((line) => this.para(this.run(line, {}), '<w:pStyle w:val="Code"/>')).join("");
      }
      case "hr":
        return this.para("", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr>');
      case "ul":
        return this.list(b, 0, b.attrs["data-checklist"] !== undefined ? 0 : this.newNum(0));
      case "ol":
        return this.list(b, 0, this.newNum(1, Number(b.attrs.start ?? 1)));
      case "table":
        return this.table(b);
      case "figure":
        return this.figure(b);
      default:
        return "";
    }
  }
}

const LIST_LEVELS = (fmt: "bullet" | "decimal") =>
  Array.from({ length: 9 }, (_, i) => {
    const bullets = ["•", "◦", "▪"];
    const decimals = ["%1.", "%2.", "%3.", "%4.", "%5.", "%6.", "%7.", "%8.", "%9."];
    const text = fmt === "bullet" ? bullets[i % 3]! : decimals[i]!.replace(/%\d/, `%${i + 1}`);
    const numFmt = fmt === "bullet" ? "bullet" : ["decimal", "lowerLetter", "lowerRoman"][i % 3]!;
    return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${numFmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 360}" w:hanging="360"/></w:pPr></w:lvl>`;
  }).join("");

function stylesXml(fonts: DocIndex["fonts"]): string {
  const face = (f: "serif" | "sans") => (f === "serif" ? "Georgia" : "Calibri");
  const head = face(fonts.headings);
  const text = face(fonts.text);
  const heading = (n: number, size: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${n === 1 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:rFonts w:ascii="${head}" w:hAnsi="${head}"/><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${text}" w:hAnsi="${text}" w:cs="${text}"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:rFonts w:ascii="${head}" w:hAnsi="${head}"/><w:sz w:val="52"/></w:rPr></w:style>
${heading(1, 36)}${heading(2, 30)}${heading(3, 26)}${heading(4, 24)}${heading(5, 22)}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr><w:ind w:left="240"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F5F5F4"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:color w:val="595959"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1F4FD1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/></w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;
}

/** The whole doc as a .docx file's bytes. */
export function docxFromDoc(doc: { index: DocIndex; tabs: Map<string, LoadedTab> }, images: Map<string, DocxImage>, now = new Date()): Uint8Array {
  const w = new Writer(images, now.toISOString().replace(/\.\d+Z$/, "Z"));
  const flat = flattenTabs(doc.index.tabs);
  const many = flat.length > 1;
  let body = w.para(w.run(doc.index.title, {}), '<w:pStyle w:val="Title"/>');
  for (const f of flat) {
    const t = doc.tabs.get(f.ref.id)?.tab;
    if (!t) continue;
    if (many) body += w.para(w.run(tabLabel(doc.index.tabs, f.ref.id), {}), `<w:pStyle w:val="Heading${Math.min(5, 1 + f.depth)}"/>`);
    const shift = many ? 1 + f.depth : 0;
    for (const b of elementChildren(t)) body += w.block(b, shift);
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${LIST_LEVELS("bullet")}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${LIST_LEVELS("decimal")}</w:abstractNum>${w.nums.join("")}</w:numbering>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${w.rels.join("")}</Relationships>`;
  const exts = new Set(w.media.map((m) => m.name.split(".").pop()!));
  const mime: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif" };
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...exts].map((e) => `<Default Extension="${e}" ContentType="${mime[e]}"/>`).join("")}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(clean(doc.index.title))}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`;
  return zip([
    { name: "[Content_Types].xml", data: types },
    { name: "_rels/.rels", data: root },
    { name: "docProps/core.xml", data: core },
    { name: "word/document.xml", data: document },
    { name: "word/styles.xml", data: stylesXml(doc.index.fonts) },
    { name: "word/numbering.xml", data: numbering },
    { name: "word/_rels/document.xml.rels", data: rels },
    ...w.media.map((m) => ({ name: `word/media/${m.name}`, data: m.data })),
  ]);
}
