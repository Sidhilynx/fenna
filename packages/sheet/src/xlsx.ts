// Minimal zero-dependency Excel (.xlsx) reader and writer (OOXML + ZIP).

import { type EvalValue, FormulaError } from "./formula.ts";
import { formatCellRef, LIMITS, parseCellRef, parseRangeRef, type CellData, type SheetData, type WorkbookIndex } from "./schema.ts";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

function buildZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const files = entries.map((e) => ({ name: enc.encode(e.name), data: typeof e.data === "string" ? enc.encode(e.data) : e.data }));
  const time = 0;
  const date = (0 << 9) | (1 << 5) | 1;
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, f.name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), f.name, f.data);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, f.data.length, true);
    c.setUint32(24, f.data.length, true);
    c.setUint16(28, f.name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), f.name);
    offset += 30 + f.name.length + f.data.length;
  }

  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);

  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  void writer.write(copy);
  void writer.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(buf);
}

async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const files = new Map<string, Uint8Array>();

  // Locate End of Central Directory (signature 0x06054b50)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid .xlsx zip archive");

  const cdOffset = view.getUint32(eocd + 16, true);
  const cdCount = view.getUint16(eocd + 10, true);
  let ptr = cdOffset;

  for (let i = 0; i < cdCount && ptr + 46 <= bytes.length; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/") || localOffset + 30 > bytes.length) continue;
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const slice = bytes.subarray(dataStart, dataStart + compSize);
    if (method === 0) files.set(name, slice);
    else if (method === 8) files.set(name, await inflateRaw(slice));
  }
  return files;
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xmlUnesc = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function cellStyleIndex(cell: CellData | undefined): number {
  const s = cell?.s;
  if (!s) return 0;
  if (s.bold) return 1;
  if (s.italic) return 2;
  if (s.numFmt === "currency" || s.numFmt === "currency_rounded") return 3;
  if (s.numFmt === "percent") return 4;
  return 0;
}

function sheetXml(sheet: SheetData, values: Map<string, EvalValue>): string {
  const byRow = new Map<number, { col: number; ref: string; cell: CellData }[]>();
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const p = parseCellRef(ref);
    if (!p) continue;
    const list = byRow.get(p.row) ?? [];
    list.push({ col: p.col, ref, cell });
    byRow.set(p.row, list);
  }

  const rowsXml: string[] = [];
  const rowNums = [...byRow.keys()].sort((a, b) => a - b);
  for (const r of rowNums) {
    const items = byRow.get(r)!.sort((a, b) => a.col - b.col);
    const cellsXml: string[] = [];
    for (const { ref, cell } of items) {
      const styleIdx = cellStyleIndex(cell);
      const sAttr = styleIdx ? ` s="${styleIdx}"` : "";
      const fTag = cell.f ? `<f>${xmlEsc(cell.f.startsWith("=") ? cell.f.slice(1) : cell.f)}</f>` : "";
      const rawVal = values.get(ref) ?? cell.v ?? null;
      if (rawVal instanceof FormulaError) {
        cellsXml.push(`<c r="${ref}"${sAttr} t="e">${fTag}<v>${xmlEsc(rawVal.code)}</v></c>`);
      } else if (typeof rawVal === "number" && Number.isFinite(rawVal)) {
        cellsXml.push(`<c r="${ref}"${sAttr}>${fTag}<v>${rawVal}</v></c>`);
      } else if (typeof rawVal === "boolean") {
        cellsXml.push(`<c r="${ref}"${sAttr} t="b">${fTag}<v>${rawVal ? 1 : 0}</v></c>`);
      } else if (rawVal !== null && rawVal !== undefined && rawVal !== "") {
        cellsXml.push(`<c r="${ref}"${sAttr} t="inlineStr">${fTag}<is><t>${xmlEsc(String(rawVal))}</t></is></c>`);
      } else if (fTag) {
        cellsXml.push(`<c r="${ref}"${sAttr}>${fTag}</c>`);
      }
    }
    if (cellsXml.length) rowsXml.push(`<row r="${r + 1}">${cellsXml.join("")}</row>`);
  }

  const colEntries = Object.entries(sheet.colWidths)
    .map(([k, w]) => {
      const idx = Number(k) + 1;
      const charW = Math.max(4, Math.round((w / 7.5) * 100) / 100);
      return `<col min="${idx}" max="${idx}" width="${charW}" customWidth="1"/>`;
    })
    .join("");

  const mergesXml = sheet.merges.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${formatCellRef(m.r1, m.c1)}:${formatCellRef(m.r2, m.c2)}"/>`).join("")}</mergeCells>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0" showGridLines="${sheet.showGridlines ? 1 : 0}"/></sheetViews>
  ${colEntries ? `<cols>${colEntries}</cols>` : ""}
  <sheetData>${rowsXml.join("")}</sheetData>
  ${mergesXml}
</worksheet>`;
}

export function exportXlsx(index: WorkbookIndex, sheets: SheetData[], evaluated: Map<string, Map<string, EvalValue>>): Uint8Array {
  const entries: ZipEntry[] = [];
  const sheetOverrides = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  entries.push({
    name: "[Content_Types].xml",
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetOverrides}
</Types>`,
  });
  entries.push({
    name: "_rels/.rels",
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  });
  entries.push({
    name: "xl/workbook.xml",
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.title || `Sheet${i + 1}`)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`,
  });
  entries.push({
    name: "xl/_rels/workbook.xml.rels",
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  });
  entries.push({
    name: "xl/styles.xml",
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><name val="Calibri"/></font>
    <font><i/><sz val="10"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
  <numFmts count="1"><numFmt numFmtId="164" formatCode="$#,##0.00"/></numFmts>
</styleSheet>`,
  });

  for (let i = 0; i < sheets.length; i++) {
    const s = sheets[i]!;
    entries.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: sheetXml(s, evaluated.get(s.id) ?? new Map()),
    });
  }
  return buildZip(entries);
}

function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? xmlUnesc(m[1]!) : null;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    let text = "";
    const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(m[1]!))) text += xmlUnesc(tm[1]!);
    out.push(text);
  }
  return out;
}

export async function importXlsx(bytes: Uint8Array, defaultName = "Imported"): Promise<{ title: string; sheets: SheetData[] }> {
  const files = await unzip(bytes);
  const dec = new TextDecoder();

  const sstBytes = files.get("xl/sharedStrings.xml");
  const sst = sstBytes ? parseSharedStrings(dec.decode(sstBytes)) : [];

  const wbXml = files.get("xl/workbook.xml") ? dec.decode(files.get("xl/workbook.xml")!) : "";
  const relsXml = files.get("xl/_rels/workbook.xml.rels") ? dec.decode(files.get("xl/_rels/workbook.xml.rels")!) : "";

  const relMap = new Map<string, string>();
  const relRe = /<Relationship\b([^>]*)\/>/g;
  let rm: RegExpExecArray | null;
  while ((rm = relRe.exec(relsXml))) {
    const id = attrOf(rm[1]!, "Id");
    const target = attrOf(rm[1]!, "Target");
    if (id && target) relMap.set(id, target.startsWith("/") ? target.slice(1) : target.startsWith("xl/") ? target : `xl/${target}`);
  }

  const sheetEntries: { id: string; title: string; path: string }[] = [];
  const sheetRe = /<sheet\b([^>]*)\/>/g;
  let sm: RegExpExecArray | null;
  let idx = 1;
  while ((sm = sheetRe.exec(wbXml))) {
    const title = attrOf(sm[1]!, "name") ?? `Sheet${idx}`;
    const rid = attrOf(sm[1]!, "r:id");
    const target = (rid && relMap.get(rid)) || `xl/worksheets/sheet${idx}.xml`;
    sheetEntries.push({ id: `sheet-${idx}`, title, path: target });
    idx++;
  }
  if (!sheetEntries.length) {
    for (const k of [...files.keys()].sort()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(k)) {
        sheetEntries.push({ id: `sheet-${sheetEntries.length + 1}`, title: `Sheet${sheetEntries.length + 1}`, path: k });
      }
    }
  }

  const sheets: SheetData[] = [];
  for (const entry of sheetEntries) {
    const raw = files.get(entry.path);
    if (!raw) continue;
    const xml = dec.decode(raw);
    const cells: Record<string, CellData> = {};
    let maxRow = 0;
    let maxCol = 0;

    const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cRe.exec(xml))) {
      const attrs = cm[1]!;
      const body = cm[2] ?? "";
      const ref = attrOf(attrs, "r");
      if (!ref) continue;
      const p = parseCellRef(ref);
      if (!p) continue;
      maxRow = Math.max(maxRow, p.row);
      maxCol = Math.max(maxCol, p.col);
      const t = attrOf(attrs, "t");
      const fMatch = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(body);
      const vMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
      const isMatch = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body);

      const cell: CellData = {};
      if (fMatch) cell.f = `=${xmlUnesc(fMatch[1]!)}`;
      if (t === "s" && vMatch) {
        cell.v = sst[Number(vMatch[1]!)] ?? "";
      } else if (t === "inlineStr" && isMatch) {
        cell.v = xmlUnesc(isMatch[1]!);
      } else if (t === "b" && vMatch) {
        cell.v = vMatch[1]!.trim() === "1";
      } else if (t === "str" && vMatch) {
        cell.v = xmlUnesc(vMatch[1]!);
      } else if (vMatch) {
        const n = Number(vMatch[1]!);
        cell.v = Number.isFinite(n) ? n : xmlUnesc(vMatch[1]!);
      }
      if (cell.v !== undefined || cell.f !== undefined) cells[formatCellRef(p.row, p.col)] = cell;
    }

    const merges: SheetData["merges"] = [];
    const mRe = /<mergeCell\b([^>]*)\/>/g;
    let mm: RegExpExecArray | null;
    while ((mm = mRe.exec(xml))) {
      const ref = attrOf(mm[1]!, "ref");
      const parsed = ref ? parseRangeRef(ref) : null;
      if (parsed) merges.push(parsed);
    }

    sheets.push({
      id: entry.id,
      title: entry.title,
      rows: Math.max(LIMITS.defaultRows, maxRow + 20),
      cols: Math.max(LIMITS.defaultCols, maxCol + 4),
      rowHeights: {},
      colWidths: {},
      frozenRows: 0,
      frozenCols: 0,
      showGridlines: true,
      cells,
      merges,
      rules: [],
      charts: [],
      filter: null,
      colGroups: [],
      rowGroups: [],
    });
  }

  return { title: defaultName, sheets };
}

