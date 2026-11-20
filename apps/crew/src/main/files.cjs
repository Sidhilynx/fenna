// The bot's files as it works with them. read_file shows a file on the bot's
// disk (text, code, CSV, TSV, Excel and images, a page at a time); write_file
// and edit_file write text files in Files and Downloads and remember the lines
// they changed (recentEdits, for the Code window); import_sheet makes an .xlsx
// or .csv on the disk into a Fenna sheet in Documents; and export_file saves a
// Fenna sheet back to Files as .xlsx or .csv. Every path
// goes through disk.locate, so the disk's own checks apply: nothing outside
// the bot's folder, no links. Sheets are read and written with @opendeck/sheet,
// the same code the sheet app and its MCP server use.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const electron = require("electron");
const F = require("./format.cjs");
const { IMPORT_MAX, sizeText } = require("./disk.cjs");

const packaged = typeof electron === "object" && electron.app && electron.app.isPackaged;
const SHEET = packaged ? require(path.join(process.resourcesPath, "mcp", "crew-sheet.cjs")) : require("@opendeck/sheet");

const MB = 1024 ** 2;
const WRITE_MAX = 2 * MB;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const EDIT_WINDOW_MS = 15 * 60_000;
const EDIT_KEEP = 200;
const TEXT_LINES = 400;
const TABLE_ROWS = 200;
const TABLE_COLS = 40;
const LINE_MAX = 2000;
const CELL_MAX = 80;
const SHOW_MAX = 60_000;
const READ_MAX = 25 * MB;
const IMAGE_SIDE = 1568;
const IMAGE_BYTES = 3.5 * MB;
const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
const MCP_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const TEXT_EXT = ["txt", "md", "markdown", "json", "log", "js", "ts", "jsx", "tsx", "py", "html", "htm", "css", "xml", "svg", "yaml", "yml", "ini", "cfg", "conf", "toml", "sh", "bat", "ps1", "sql"];
const DOC_HOW = { doc: "doc_overview, then read_tab", sheet: "sheet_overview, then read_range", deck: "deck_overview, then read_slides" };
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

const ext = (name) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};
const stripExt = (name) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};
const lstatOrNull = (p) => {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return null;
    throw e;
  }
};
const cellText = (s) => String(s ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").trim().slice(0, CELL_MAX);
const pad = (n, w) => String(n).padStart(w, " ");
const newlines = (s) => s.split("\n").length - 1;
const lineCount = (s) => (s === "" ? 0 : s.split("\n").length - (s.endsWith("\n") ? 1 : 0));
const rangeText = (ranges) => ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");

/** Where `from` occurs in `text`, each occurrence after the one before it ends. */
function occurrences(text, from) {
  const hits = [];
  for (let i = text.indexOf(from); i !== -1; i = text.indexOf(from, i + from.length)) hits.push(i);
  return hits;
}

/** The 1-based line ranges that differ between two texts: the lines from the first difference to the last, from each end. */
function changedLines(before, after) {
  if (before === after) return [];
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const last = lineCount(after);
  const from = Math.min(head + 1, Math.max(1, last));
  return [[from, Math.max(from, Math.min(last, b.length - tail))]];
}

/** The text of a file's bytes as UTF-8 (a byte order mark dropped), or null when they are not UTF-8. */
function decodeText(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    return null;
  }
}

/** A file with no known type is shown as text only when it has no NUL bytes and is UTF-8. */
const looksText = (buf) => !buf.includes(0) && decodeText(buf) !== null;

/** The Fenna app whose document folder this is (its marker file is there), or null. */
function fennaApp(dir) {
  return F.FENNA_APPS.find((a) => lstatOrNull(path.join(dir, a.marker))?.isFile()) ?? null;
}

/** A name for an exported file: no characters Windows refuses, no leading or trailing dots, never a reserved name. */
function fileNameOf(title) {
  const s = String(title)
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  if (!s) return "sheet";
  return WINDOWS_RESERVED.test(s) ? `_${s}` : s;
}

/** Width and height of an image from its header, or null. Reads PNG, GIF, BMP, JPEG and WebP without decoding. */
function imageSize(b, e) {
  if (e === "png") return b.length >= 24 && b.toString("ascii", 12, 16) === "IHDR" ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null;
  if (e === "gif") return b.length >= 10 && b.toString("ascii", 0, 3) === "GIF" ? { width: b.readUInt16LE(6), height: b.readUInt16LE(8) } : null;
  if (e === "bmp") return b.length >= 26 && b.toString("ascii", 0, 2) === "BM" ? { width: Math.abs(b.readInt32LE(18)), height: Math.abs(b.readInt32LE(22)) } : null;
  if (e === "jpg" || e === "jpeg") return jpegSize(b);
  if (e === "webp") return webpSize(b);
  return null;
}

function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xd9) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

function webpSize(b) {
  if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const b1 = b[21];
    const b2 = b[22];
    const b3 = b[23];
    const b4 = b[24];
    return { width: 1 + (((b2 & 0x3f) << 8) | b1), height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | (b2 >> 6)) };
  }
  if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  return null;
}

/** One page of a text file: numbered lines from `from` (1-based), `count` lines at most, within the output's size limit. */
function textPage(name, text, from, count) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length && lines.at(-1) === "") lines.pop();
  const total = lines.length;
  if (total === 0) return `${name} is empty.`;
  if (from > total) throw new Error(`${name} has ${total} lines, so line ${from} is past its end. Start at a line from 1 to ${total}.`);
  const stop = Math.min(total, from + (count ?? TEXT_LINES) - 1);
  const width = String(total).length;
  const rows = [];
  let used = 0;
  let last = from - 1;
  for (let i = from; i <= stop; i++) {
    const s = lines[i - 1];
    const row = `${pad(i, width)}  ${s.length > LINE_MAX ? `${s.slice(0, LINE_MAX)} …` : s}`;
    if (used + row.length > SHOW_MAX && rows.length) break;
    rows.push(row);
    used += row.length + 1;
    last = i;
  }
  const out = [`${name}: lines ${from}-${last} of ${total}.`, ...rows];
  if (last < total) out.push(`${total - last} more lines. Read them with offset: ${last + 1}.`);
  return out.join("\n");
}

/** A workbook's sheets as grids: their size, and the displayed value of each cell (formulas computed). */
function workbookGrids(workbook, title) {
  const index = SHEET.emptyIndex(title);
  const values = SHEET.evaluateAll(new Map(workbook.sheets.map((s) => [s.id, s])), index.timeZone);
  return workbook.sheets.map((s) => {
    const used = Object.keys(s.cells).length > 0;
    const b = SHEET.usedBounds(s);
    const vals = values.get(s.id) ?? new Map();
    return {
      title: s.title,
      rows: used ? b.maxRow + 1 : 0,
      cols: used ? b.maxCol + 1 : 0,
      cell: (r, c) => {
        const ref = SHEET.formatCellRef(r, c);
        return cellText(SHEET.formatCellValue(vals.get(ref) ?? null, s.cells[ref], index));
      },
    };
  });
}

/** A CSV or TSV file as one grid. Trailing empty lines are not rows. */
function csvGrid(title, rows) {
  while (rows.length && rows.at(-1).length === 1 && rows.at(-1)[0] === "") rows.pop();
  const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
  return [{ title, rows: rows.length, cols, cell: (r, c) => cellText(rows[r][c] ?? "") }];
}

/** One sheet as a table: its size, the column letters, then rows from `from` (at most `want`) that fit in `budget` characters. */
function gridTable(g, from, want, budget, many) {
  const head = `Sheet "${g.title}": ${g.rows} rows, ${g.cols} columns${g.rows && g.cols ? ` (A1:${SHEET.formatCellRef(g.rows - 1, g.cols - 1)})` : ""}.`;
  if (!g.rows || !g.cols) return `${head} It is empty.`;
  if (from > g.rows) return `${head} There is no row ${from}; the rows run from 1 to ${g.rows}.`;
  const cols = Math.min(g.cols, TABLE_COLS);
  const width = String(g.rows).length;
  const letters = Array.from({ length: cols }, (_, c) => SHEET.colToLetter(c));
  const lines = [`${" ".repeat(width)} | ${letters.join(" | ")}`];
  let used = lines[0].length;
  let last = from - 1;
  const stop = Math.min(g.rows, from + want - 1);
  for (let r = from - 1; r < stop; r++) {
    const cells = [];
    for (let c = 0; c < cols; c++) cells.push(g.cell(r, c));
    const row = `${pad(r + 1, width)} | ${cells.join(" | ")}`;
    if (used + row.length > budget && (lines.length > 1 || budget <= 0)) break;
    lines.push(row);
    used += row.length + 1;
    last = r + 1;
  }
  const out = [head];
  if (last >= from) out.push(`Rows ${from}-${last} shown.`);
  else out.push(`Not shown here, to keep the answer short. Read it alone with sheet: "${g.title}" and offset: ${from}.`);
  out.push(...lines);
  if (last >= from && last < g.rows) out.push(`${g.rows - last} more rows. Read them with offset: ${last + 1}${many ? ` and sheet: "${g.title}"` : ""}.`);
  if (g.cols > TABLE_COLS) out.push(`Columns after ${SHEET.colToLetter(TABLE_COLS - 1)} aren't shown; the sheet has ${g.cols} columns.`);
  return out.join("\n");
}

/** The tables of a workbook or a CSV file: every sheet, or the one `sheet` names (its title, or its number from 1). */
function tableText(name, grids, { from, count, sheet }) {
  let picked = grids;
  if (sheet !== undefined && sheet !== null) {
    const i = typeof sheet === "number" ? sheet - 1 : grids.findIndex((g) => g.title.toLowerCase() === String(sheet).trim().toLowerCase());
    if (i < 0 || i >= grids.length) {
      throw new Error(`There is no sheet ${JSON.stringify(sheet)} in ${name}. Its sheets are: ${grids.map((g, n) => `${n + 1} "${g.title}"`).join(", ")}.`);
    }
    picked = [grids[i]];
  }
  let budget = SHOW_MAX;
  const blocks = picked.map((g) => {
    const block = gridTable(g, from, count ?? TABLE_ROWS, budget, picked.length > 1);
    budget -= block.length;
    return block;
  });
  const top = grids.length === 1 ? `${name}: one sheet.` : `${name}: ${grids.length} sheets, ${grids.map((g) => `"${g.title}"`).join(", ")}.`;
  return [top, ...blocks].join("\n\n");
}

/** A reader of a Fenna sheet folder for the sheet package. Only plain files are read; links are never followed. */
function folderReader(dir) {
  return {
    read: async (rel) => {
      const full = path.join(dir, rel);
      const st = await fsp.lstat(full).catch(() => null);
      return st && st.isFile() ? fsp.readFile(full, "utf8") : null;
    },
    list: (rel) => fsp.readdir(path.join(dir, rel)).catch(() => []),
  };
}

/** A Fenna sheet folder loaded with the sheet package, and every problem it has, as words. */
async function loadSheetFolder(dir) {
  const wb = await SHEET.loadWorkbook(folderReader(dir));
  const problems = [...wb.problems, ...[...wb.sheets.values()].filter((s) => s.error).map((s) => `sheets/${s.id}.json: ${s.error}`)];
  return { wb, problems };
}

/**
 * @param {object} o
 * @param {ReturnType<import("./disk.cjs").createDisk>} o.disk  the bots' disks; every path goes through its locate
 * @param {(channel: string, payload: object) => void} [o.broadcast]  tells the windows the disk changed
 * @param {() => { createFromBuffer(b: Buffer): any } | undefined} [o.nativeImage]  Electron's nativeImage, used to shrink images
 * @param {() => Date} [o.now]
 */
function createFiles({ disk, broadcast = () => {}, nativeImage = () => electron.nativeImage, now = () => new Date() }) {
  /** slug → the bot's recent edits, { path, ms, seq, lines }, oldest first. */
  const edits = new Map();
  let seq = 0;

  function assertRoom(slug, bytes) {
    const free = disk.free(slug, true);
    if (bytes > free) throw new Error(`That won't fit in the bot's disk. It needs ${sizeText(bytes)}, and ${sizeText(free)} is free.`);
  }

  /** Room for a file that goes from `before` bytes to `after`: the old copy's bytes are freed first. */
  function assertWrite(slug, before, after) {
    if (after > WRITE_MAX) throw new Error(`That file would be ${sizeText(after)}. write_file takes at most 2 MB per file; split it into several files.`);
    const free = disk.free(slug, true);
    const more = after - before;
    if (more > free) throw new Error(`That won't fit in the bot's disk. It needs ${sizeText(more)} more, and ${sizeText(free)} is free.`);
  }

  function recentWithin(slug) {
    const at = now().getTime();
    const kept = (edits.get(slug) || []).filter((e) => at - e.ms < EDIT_WINDOW_MS);
    edits.set(slug, kept);
    return kept;
  }

  /** Remembers the lines an edit changed, so the Code window can mark them for 15 minutes. */
  function noteEdit(slug, rel, lines) {
    if (!lines.length) return;
    const kept = recentWithin(slug);
    kept.push({ path: rel, ms: now().getTime(), seq: ++seq, lines });
    edits.set(slug, kept.slice(-EDIT_KEEP));
    broadcast("crew:edits", { slug });
  }

  /** The bot's recent edits by file, newest first: the latest time, and the changed line ranges of every edit in the window. */
  function recentEdits(slug) {
    const byPath = new Map();
    for (const e of recentWithin(slug)) {
      const r = byPath.get(e.path) || { path: e.path, ms: 0, seq: 0, lines: [] };
      r.ms = Math.max(r.ms, e.ms);
      r.seq = Math.max(r.seq, e.seq);
      r.lines.push(...e.lines);
      byPath.set(e.path, r);
    }
    return [...byPath.values()]
      .sort((a, b) => b.seq - a.seq)
      .map((r) => ({ path: r.path, at: new Date(r.ms).toISOString(), lines: r.lines.sort((a, b) => a[0] - b[0]) }));
  }

  /** The stats of a file at a disk location. Throws with what to do for a folder or a missing file. */
  function statFile(loc, p) {
    const st = lstatOrNull(loc.abs);
    if (!st) throw new Error(`There is no file at ${p}. Find it with search_files, or list its folder with terminal (ls).`);
    if (st.isDirectory()) throw new Error(`${p} is a folder. Name a file in it, or list it with terminal: ls ${p}.`);
    if (!st.isFile()) throw new Error(`${p} isn't a file.`);
    return st;
  }

  /** The error for a path in Documents: a Fenna document is read with the fenna tools. */
  function documentError(slug, loc, p) {
    const name = loc.rest[0];
    if (!name) return new Error("Documents holds Fenna documents, not files. Read a file from Files or Downloads; search_files finds documents.");
    const dir = disk.locate(slug, `Documents/${name}`).abs;
    const app = lstatOrNull(dir)?.isDirectory() ? fennaApp(dir) : null;
    if (!app) return new Error(`Documents holds Fenna documents only, and ${p} isn't one. Read files from Files or Downloads.`);
    const how = DOC_HOW[app.kind] ?? "the fenna tools";
    return new Error(`${name} is a Fenna ${app.kind}. Read it with the fenna tools, not read_file: use path "${name}" with ${how}.`);
  }

  /** The image as MCP shows it: as it is when it fits the limits, else scaled down and re-encoded. */
  function imageResult(name, buf, e, size) {
    const mime = IMAGE_TYPES[e];
    const described = `${name}: ${size.width} × ${size.height} px, ${sizeText(buf.length)}.`;
    if (Math.max(size.width, size.height) <= IMAGE_SIDE && buf.length <= IMAGE_BYTES && MCP_IMAGE_TYPES.includes(mime)) {
      return { text: described, image: { data: buf.toString("base64"), mimeType: mime } };
    }
    const small = shrink(name, buf, e, size);
    return {
      text: `${described} Shown at ${small.width} × ${small.height} px, ${sizeText(small.bytes.length)}.`,
      image: { data: small.bytes.toString("base64"), mimeType: small.mimeType },
    };
  }

  /** The image scaled so its longest side is at most IMAGE_SIDE, re-encoded until it is at most IMAGE_BYTES. */
  function shrink(name, buf, e, size) {
    const img = nativeImage()?.createFromBuffer(buf);
    if (!img || img.isEmpty()) throw new Error(`${name} is too big to show as it is, and it can't be shrunk here. Ask the person for a smaller PNG or JPEG copy.`);
    const jpeg = e === "jpg" || e === "jpeg";
    let scale = Math.min(1, IMAGE_SIDE / Math.max(size.width, size.height));
    for (let attempt = 0; attempt < 5; attempt++) {
      const width = Math.max(1, Math.round(size.width * scale));
      const height = Math.max(1, Math.round(size.height * scale));
      const pic = width === size.width && height === size.height ? img : img.resize({ width, height, quality: "best" });
      const bytes = jpeg ? pic.toJPEG(attempt === 0 ? 85 : 70) : pic.toPNG();
      if (bytes.length <= IMAGE_BYTES) return { width, height, bytes, mimeType: jpeg ? "image/jpeg" : "image/png" };
      scale *= 0.75;
    }
    throw new Error(`${name} is still too big after shrinking. Ask the person for a smaller copy.`);
  }

  /** read_file: a file on the bot's disk, as text, a table or an image. */
  async function read(slug, p) {
    const loc = disk.locate(slug, p.path);
    if (loc.root === "Trash") throw new Error("That file is in Trash. Restore it first, then read it from Files or Downloads.");
    if (loc.root === "Documents") throw documentError(slug, loc, p.path);
    if (loc.isRoot) throw new Error(`${p.path} is a folder. List it with terminal: ls ${p.path}.`);
    const st = statFile(loc, p.path);
    const name = loc.segs.at(-1);
    const e = ext(name);
    if (e === "pdf") return { text: `${name} is a PDF. Text from PDFs isn't supported yet. Ask the person to open it in Files, where the PDF viewer shows it.` };
    if (e === "xls") throw new Error(`${name} is an old .xls workbook, which can't be read here. Ask the person to save it as .xlsx, then read that.`);
    if (st.size > READ_MAX) {
      const how = e === "xlsx" || e === "csv" || e === "tsv" ? "Make it a Fenna sheet with import_sheet, then page it with the sheet tools." : "Look at part of it with terminal (head or grep).";
      throw new Error(`${name} is ${sizeText(st.size)}, too big to read at once. ${how}`);
    }
    const bytes = fs.readFileSync(loc.abs);
    const paging = { from: p.offset ?? 1, count: p.limit, sheet: p.sheet };
    if (e === "xlsx") {
      const wb = await SHEET.importXlsx(new Uint8Array(bytes), stripExt(name)).catch((err) => {
        throw new Error(`${name} isn't a readable .xlsx workbook (${err.message}). Save it again from the spreadsheet app, or read it as .csv.`);
      });
      if (!wb.sheets.length) return { text: `${name} has no sheets.` };
      return { text: tableText(name, workbookGrids(wb, stripExt(name)), paging) };
    }
    if (e === "csv" || e === "tsv") {
      const text = decodeText(bytes) ?? bytes.toString("latin1");
      const rows = e === "tsv" ? text.replace(/\r\n/g, "\n").split("\n").map((l) => l.split("\t")) : SHEET.parseCsv(text);
      return { text: tableText(name, csvGrid(stripExt(name), rows), paging) };
    }
    if (IMAGE_TYPES[e]) {
      const size = imageSize(bytes, e);
      if (!size || !size.width || !size.height) throw new Error(`${name} isn't a ${e.toUpperCase()} image that can be read. Ask the person for a PNG or JPEG copy.`);
      return imageResult(name, bytes, e, size);
    }
    if (TEXT_EXT.includes(e) || looksText(bytes)) {
      return { text: textPage(name, decodeText(bytes) ?? bytes.toString("utf8"), paging.from, p.limit) };
    }
    return { text: `${name} is a binary file (${e ? e.toUpperCase() : "no extension"}, ${sizeText(st.size)}). read_file shows text, CSV, Excel and image files only.` };
  }

  /** import_sheet: an .xlsx or .csv on the bot's disk becomes a Fenna sheet in Documents. */
  async function importSheet(slug, p) {
    const loc = disk.locate(slug, p.path);
    if (loc.root !== "Files" && loc.root !== "Downloads") throw new Error("Import a spreadsheet from Files or Downloads. Documents and Trash can't be imported.");
    const st = statFile(loc, p.path);
    const name = loc.segs.at(-1);
    const e = ext(name);
    if (e !== "xlsx" && e !== "csv") throw new Error(`import_sheet takes an .xlsx or .csv file, and ${name} isn't one. Pass its path, like Files/budget.xlsx.`);
    if (st.size > IMPORT_MAX) throw new Error(`${name} is ${sizeText(st.size)}; the most that can be imported is ${sizeText(IMPORT_MAX)}.`);
    const title = typeof p.title === "string" && p.title.trim() ? p.title.trim() : stripExt(name);
    if (title.length > 200) throw new Error(`The title is ${title.length} characters; the most is 200.`);
    const bytes = fs.readFileSync(loc.abs);
    let sheets;
    if (e === "xlsx") {
      const wb = await SHEET.importXlsx(new Uint8Array(bytes), title).catch((err) => {
        throw new Error(`${name} isn't a readable .xlsx workbook (${err.message}). Save it again from the spreadsheet app, or import it as .csv.`);
      });
      if (!wb.sheets.length) throw new Error(`${name} has no sheets to import.`);
      sheets = wb.sheets;
    } else {
      const csv = decodeText(bytes) ?? bytes.toString("latin1");
      sheets = [SHEET.sheetFromCsv("sheet-1", "Sheet1", csv, SHEET.emptyIndex(title).locale)];
    }
    const index = { ...SHEET.emptyIndex(title), sheets: sheets.map((s) => ({ id: s.id, title: s.title })) };
    const files = { "sheet.json": SHEET.indexText(index) };
    for (const s of sheets) files[SHEET.sheetFile(s.id)] = SHEET.sheetText(s);
    assertRoom(slug, Object.values(files).reduce((n, t) => n + Buffer.byteLength(t), 0));

    const docs = disk.locate(slug, "Documents");
    await fsp.mkdir(docs.abs, { recursive: true });
    const folder = F.uniqueSlug(title, await fsp.readdir(docs.abs));
    const tmp = path.join(docs.abs, `.${folder}.${process.pid}.tmp`);
    await fsp.rm(tmp, { recursive: true, force: true });
    try {
      for (const [rel, text] of Object.entries(files)) {
        await fsp.mkdir(path.dirname(path.join(tmp, rel)), { recursive: true });
        await fsp.writeFile(path.join(tmp, rel), text);
      }
      const { problems } = await loadSheetFolder(tmp);
      if (problems.length) throw new Error(`The sheet couldn't be made cleanly: ${problems[0]}. Try again with a simpler file.`);
      await fsp.rename(tmp, path.join(docs.abs, folder));
    } catch (err) {
      await fsp.rm(tmp, { recursive: true, force: true });
      throw err;
    }
    broadcast("crew:disk", { slug });
    const names = sheets.map((s) => `"${s.title}"`).join(", ");
    return {
      text: `Created the sheet "${title}" at path "${folder}" with ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}: ${names}. Read it with sheet_overview {path: "${folder}"}, then read_range. Change it with write_cells {path: "${folder}", …}.`,
    };
  }

  /** export_file: a Fenna sheet from Documents, saved to Files as .xlsx (every sheet) or .csv (the first sheet). */
  async function exportFile(slug, p) {
    const format = p.format;
    if (format !== "xlsx" && format !== "csv") throw new Error('Use format "xlsx" or "csv", like {document: "Documents/q3-budget", format: "xlsx"}.');
    const name = typeof p.document === "string" ? p.document.trim().replace(/^Documents\//, "").replace(/\/+$/, "") : "";
    if (!name) throw new Error("Say which sheet, like Documents/q3-budget.");
    const loc = disk.locate(slug, `Documents/${name}`);
    if (loc.rest.length !== 1) throw new Error("Name one sheet in Documents, like Documents/q3-budget.");
    if (!lstatOrNull(loc.abs)?.isDirectory()) throw new Error(`There is no document "${name}" in Documents. Find sheets with search_files.`);
    if (fennaApp(loc.abs)?.kind !== "sheet") throw new Error(`${name} isn't a Fenna sheet. Export works on sheets; search_files finds them.`);
    const { wb, problems } = await loadSheetFolder(loc.abs);
    if (problems.length) throw new Error(`${name} has a problem, so nothing was exported: ${problems[0]}. Fix it with the sheet tools, then export again.`);
    const sheets = wb.index.sheets.map((r) => wb.sheets.get(r.id).sheet);
    if (!sheets.length) throw new Error(`${name} has no sheets to export.`);
    const title = wb.index.title || name;
    const values = SHEET.evaluateAll(new Map(sheets.map((s) => [s.id, s])), wb.index.timeZone);
    let bytes;
    let what;
    if (format === "xlsx") {
      bytes = Buffer.from(SHEET.exportXlsx(wb.index, sheets, values));
      what = `${sheets.length} sheet${sheets.length === 1 ? "" : "s"}`;
    } else {
      const first = sheets[0];
      bytes = Buffer.from(SHEET.sheetToCsv(first, values.get(first.id) ?? new Map(), wb.index), "utf8");
      what = `the first sheet, "${first.title}"; a CSV holds one sheet, so use xlsx for all ${sheets.length}`;
    }

    const safe = fileNameOf(title);
    const explicit = typeof p.to === "string" && p.to.trim() !== "";
    let target = explicit ? p.to.trim() : `Files/Outbox/${safe}.${format}`;
    if (!target.startsWith("Files/")) throw new Error(`Export into Files, like Files/Outbox/${safe}.${format}.`);
    if (!target.toLowerCase().endsWith(`.${format}`)) target = `${target}.${format}`;
    if (explicit) {
      if (lstatOrNull(disk.locate(slug, target).abs)) throw new Error(`There is already a file at ${target}. Give another name in to, like Files/Outbox/${safe} 2.${format}.`);
    } else {
      const base = target.slice(0, -(format.length + 1));
      for (let n = 2; lstatOrNull(disk.locate(slug, target).abs); n++) target = `${base} (${n}).${format}`;
    }
    const out = disk.locate(slug, target);
    assertRoom(slug, bytes.length);
    fs.mkdirSync(path.dirname(out.abs), { recursive: true });
    fs.writeFileSync(out.abs, bytes, { flag: "wx" });
    broadcast("crew:disk", { slug });
    return { text: `Exported "${title}" to ${target} (${sizeText(bytes.length)}): ${what}.` };
  }

  /** The disk location a write goes to: Files or Downloads, a file (not a folder), with what to use instead otherwise. */
  function writeTarget(slug, p) {
    const loc = disk.locate(slug, p);
    if (loc.root === "Documents") throw new Error(`write_file writes only in Files or Downloads, and ${p} is in Documents. Documents holds Fenna documents: change one with the fenna tools.`);
    if (loc.root === "Trash") throw new Error(`${p} is in Trash. Restore it first, then write to it in Files or Downloads.`);
    if (loc.isRoot) throw new Error(`${p} is a folder, not a file. Name a file in it, like ${loc.root}/notes/a.txt.`);
    if (loc.root === "Files" && loc.segs[1] === "downloads") throw new Error(`Files/downloads is Downloads. Write there as Downloads/…`);
    if (lstatOrNull(loc.abs)?.isDirectory()) throw new Error(`${p} is a folder. Name a file in it, like ${p}/a.txt.`);
    return loc;
  }

  /** write_file: creates a text file (and its folders) or replaces one whole. Keeps CRLF line endings of a file it replaces. */
  async function writeFile(slug, p) {
    const loc = writeTarget(slug, p.path);
    if (typeof p.content !== "string") throw new Error("Say what goes in the file, in content.");
    const name = loc.segs.at(-1);
    const prior = lstatOrNull(loc.abs)?.isFile() ? fs.readFileSync(loc.abs) : null;
    if (prior && !looksText(prior)) throw new Error(`${name} isn't a text file, and write_file only replaces text files. Write it under a new name.`);
    const before = prior ? decodeText(prior) : "";
    const next = p.content.replace(/\r\n/g, "\n");
    const out = prior && before.includes("\r\n") ? next.replace(/\n/g, "\r\n") : p.content;
    const bytes = Buffer.byteLength(out);
    assertWrite(slug, prior ? prior.length : 0, bytes);
    try {
      fs.mkdirSync(path.dirname(loc.abs), { recursive: true });
    } catch (e) {
      if (e.code === "ENOTDIR" || e.code === "EEXIST") throw new Error(`${p.path} can't be written: a file is in the way of its folder. Pick another path.`);
      throw e;
    }
    fs.writeFileSync(loc.abs, out);
    broadcast("crew:disk", { slug });
    noteEdit(slug, loc.segs.join("/"), changedLines(prior ? before.replace(/\r\n/g, "\n") : "", next));
    return { text: `Wrote ${p.path} (${lineCount(next)} lines)` };
  }

  /** edit_file: replaces the exact text old_string with new_string, once (or every match with replace_all). Keeps CRLF line endings. */
  async function editFile(slug, p) {
    const loc = writeTarget(slug, p.path);
    const st = statFile(loc, p.path);
    const name = loc.segs.at(-1);
    if (st.size > WRITE_MAX) throw new Error(`${name} is ${sizeText(st.size)}. edit_file works on files up to 2 MB.`);
    const raw = fs.readFileSync(loc.abs);
    const old = looksText(raw) ? decodeText(raw) : null;
    if (old === null) throw new Error(`${name} isn't a text file, so edit_file can't change it.`);
    if (typeof p.new_string !== "string") throw new Error("Say the new text in new_string. Leave it empty to delete old_string.");
    const from = typeof p.old_string === "string" ? p.old_string.replace(/\r\n/g, "\n") : "";
    const to = p.new_string.replace(/\r\n/g, "\n");
    if (!from) throw new Error("Say the exact text to change in old_string. Copy it from read_file, line breaks and spaces included.");
    if (from === to) throw new Error("old_string and new_string are the same, so nothing would change.");
    const text = old.replace(/\r\n/g, "\n");
    const hits = occurrences(text, from);
    if (!hits.length) throw new Error(`old_string not found in ${p.path}. Read the file again with read_file and copy the text exactly.`);
    if (hits.length > 1 && p.replace_all !== true) {
      throw new Error(`old_string occurs ${hits.length} times in ${p.path}. Add the lines around it to old_string so it occurs once, or set replace_all: true to change all ${hits.length}.`);
    }
    const picked = p.replace_all === true ? hits : hits.slice(0, 1);
    // Built in order, so each changed range is already a line number in the new text.
    let out = "";
    let last = 0;
    let line = 1;
    const lines = [];
    const nl = newlines(to);
    for (const at of picked) {
      const between = text.slice(last, at);
      out += between;
      line += newlines(between);
      lines.push([line, line + Math.max(0, nl - (to.endsWith("\n") ? 1 : 0))]);
      out += to;
      line += nl;
      last = at + from.length;
    }
    out += text.slice(last);
    const lineEnds = old.includes("\r\n") ? out.replace(/\n/g, "\r\n") : out;
    const result = raw.subarray(0, 3).equals(BOM) ? `﻿${lineEnds}` : lineEnds;
    const bytes = Buffer.byteLength(result);
    assertWrite(slug, st.size, bytes);
    fs.writeFileSync(loc.abs, result);
    broadcast("crew:disk", { slug });
    noteEdit(slug, loc.segs.join("/"), lines);
    return { text: `Edited ${p.path}: ${picked.length} ${picked.length === 1 ? "match" : "matches"} replaced. Changed lines ${rangeText(lines)}.` };
  }

  return { read, importSheet, exportFile, writeFile, editFile, recentEdits };
}

module.exports = { createFiles };
