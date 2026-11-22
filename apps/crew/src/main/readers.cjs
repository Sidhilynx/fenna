// The text of the office files people hand a bot, for read_file: PDF (with
// pdf.js), Word (.docx), PowerPoint (.pptx) and OpenDocument text and slides
// (.odt, .odp). Each comes back as plain lines that files.cjs pages like any
// text file. A PowerPoint file also says its slide size, theme fonts and
// theme colors, so a bot can match its look. A PDF page can also be drawn as
// an image, by pdf.js in a hidden window with no access to anything else.

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const electron = require("electron");
const zip = require("./ziplite.cjs");

const packaged = typeof electron === "object" && electron.app && electron.app.isPackaged;
/** pdf.js: its legacy build (it runs in Node and in the window), and the data it reads fonts with. */
const PDFJS = packaged ? path.join(process.resourcesPath, "mcp", "pdfjs") : path.resolve(path.dirname(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")), "..", "..");
const PDFJS_LIB = path.join(PDFJS, "legacy", "build", "pdf.mjs");
const PDFJS_WORKER = path.join(PDFJS, "legacy", "build", "pdf.worker.mjs");
const dataDir = (name) => `${path.join(PDFJS, name).replace(/\\/g, "/")}/`;

const MB = 1024 ** 2;
/** The largest part of an office file read as XML; a bigger one is a file made to be too big. */
const PART_MAX = 64 * MB;
const RENDER_TIMEOUT_MS = 30_000;
const EMU_PER_INCH = 914_400;
const THEME_COLORS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink"];
const SKIPPED_PLACEHOLDERS = ["sldNum", "dt", "ftr", "sldImg", "hdr"];
const RATIOS = [["16:9", 16 / 9], ["16:10", 16 / 10], ["4:3", 4 / 3], ["1:1", 1]];

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
/** XML text with its entities turned back into characters. */
const xmlText = (s) =>
  s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== "#") return ENTITIES[e] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? xmlText(m[1]) : null;
};
/** Markup Office repeats for old readers (an AlternateContent fallback), which would show its text twice. */
const dropFallbacks = (xml) => xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, "");
const cleanLines = (lines) => lines.map((l) => l.replace(/[ \t]+$/g, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();

/** An office file's parts by name, read only when asked for, each within PART_MAX. */
function openPackage(buf, what) {
  let entries;
  try {
    ({ entries } = zip.readZip(buf));
  } catch (err) {
    throw new Error(`It isn't a readable ${what} file (${err.message}) Save it again from the app that made it.`);
  }
  const byName = new Map(entries.filter((e) => !e.dir).map((e) => [e.segs.join("/"), e]));
  return {
    names: [...byName.keys()],
    text(name) {
      const e = byName.get(name);
      if (!e) return null;
      if (e.size > PART_MAX) throw new Error(`Its part ${name} is over ${PART_MAX / MB} MB, too big to read.`);
      return zip.inflateEntry(buf, e).toString("utf8");
    },
  };
}

/** A part's relationships: id to the part name it points at, with its type. */
function relationships(pkg, partName) {
  const dir = path.posix.dirname(partName);
  const xml = pkg.text(`${dir}/_rels/${path.posix.basename(partName)}.rels`);
  const out = new Map();
  if (!xml) return out;
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (!id || !target || attr(m[0], "TargetMode") === "External") continue;
    const name = target.startsWith("/") ? target.slice(1) : path.posix.normalize(`${dir}/${target}`);
    out.set(id, { name, type: attr(m[0], "Type") ?? "" });
  }
  return out;
}

/** A table row as one line: | a | b |. */
const rowLine = (cells) => `| ${cells.map((c) => c.replace(/\s*\n\s*/g, " / ").replace(/\|/g, "/")).join(" | ")} |`;

/**
 * The text of a Word document (.docx): one line per paragraph, headings as
 * "#", list items as "-", tables as | rows |. Text boxes are kept; deleted
 * tracked changes and field codes are not.
 */
function docxText(buf) {
  const pkg = openPackage(buf, "Word");
  const xml = pkg.text("word/document.xml");
  if (xml === null) throw new Error("It has no document part (word/document.xml), so it isn't a Word document. Save it again as .docx.");
  const lines = [];
  const paras = [];
  let table = 0;
  let row = null;
  let cell = null;
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<(\/?)w:(p|tab|br|cr|pStyle|numPr|tc|tr|tbl)(?=[\s/>])([^>]*)>/g;
  for (const m of dropFallbacks(xml).matchAll(re)) {
    const para = paras.at(-1);
    if (m[1] !== undefined) {
      if (para) para.text += xmlText(m[1]);
      continue;
    }
    const [, , close, tag, rest] = m;
    const empty = rest.endsWith("/");
    if (tag === "p") {
      if (!close && !empty) paras.push({ text: "", prefix: "" });
      else if (close && para) {
        paras.pop();
        const text = para.text.trim();
        if (cell) {
          if (text) cell.push(text);
        } else if (text) {
          if (para.prefix.startsWith("#") && lines.length) lines.push("");
          lines.push(para.prefix + text);
        }
      }
    } else if (tag === "tab" && para && attr(rest, "w:val") === null) para.text += "\t";
    else if ((tag === "br" || tag === "cr") && para) para.text += "\n";
    else if (tag === "pStyle" && para) {
      const style = attr(rest, "w:val") ?? "";
      const level = /^heading\s*([1-6])$/i.exec(style);
      if (level) para.prefix = `${"#".repeat(Number(level[1]))} `;
      else if (/^title$/i.test(style)) para.prefix = "# ";
      else if (/^list/i.test(style) && !para.prefix) para.prefix = "- ";
    } else if (tag === "numPr" && para && !para.prefix) para.prefix = "- ";
    else if (tag === "tbl") {
      table += close ? -1 : empty ? 0 : 1;
      if (!close && table === 1 && lines.length) lines.push("");
      if (close && table === 0) lines.push("");
    } else if (tag === "tr" && table === 1) {
      if (!close) row = [];
      else if (row) {
        lines.push(rowLine(row));
        row = null;
      }
    } else if (tag === "tc" && table === 1) {
      if (!close) cell = [];
      else if (cell && row) {
        row.push(cell.join("\n"));
        cell = null;
      }
    }
  }
  return cleanLines(lines);
}

/** The text of one PowerPoint slide or notes part: placeholders' kinds kept, titles as "#", levels indented, tables as rows. */
function slideLines(xml, { notes = false } = {}) {
  const lines = [];
  let ph = null;
  let inShape = false;
  let table = 0;
  let row = null;
  let cell = null;
  let para = null;
  let pictures = 0;
  const re = /<a:t>([^<]*)<\/a:t>|<(\/?)(p:sp|p:ph|a:p|a:pPr|a:br|a:tbl|a:tr|a:tc|p:pic)(?=[\s/>])([^>]*)>/g;
  for (const m of dropFallbacks(xml).matchAll(re)) {
    if (m[1] !== undefined) {
      if (para) para.text += xmlText(m[1]);
      continue;
    }
    const [, , close, tag, rest] = m;
    const empty = rest.endsWith("/");
    if (tag === "p:sp") {
      inShape = !close;
      ph = null;
    } else if (tag === "p:ph" && inShape) ph = attr(rest, "type") ?? "body";
    else if (tag === "p:pic" && !close) pictures++;
    else if (tag === "a:p") {
      if (!close && !empty) para = { text: "", level: 0 };
      else if (close && para) {
        const text = para.text.trim();
        if (text && !SKIPPED_PLACEHOLDERS.includes(ph) && !(notes && ph !== "body")) {
          if (cell) cell.push(text);
          else lines.push(ph === "title" || ph === "ctrTitle" ? `# ${text}` : `${"  ".repeat(para.level)}${text}`);
        }
        para = null;
      }
    } else if (tag === "a:pPr" && para) para.level = Math.min(8, Number(attr(rest, "lvl") ?? 0) || 0);
    else if (tag === "a:br" && para) para.text += "\n";
    else if (tag === "a:tbl") table += close ? -1 : empty ? 0 : 1;
    else if (tag === "a:tr" && table === 1) {
      if (!close) row = [];
      else if (row) {
        lines.push(rowLine(row));
        row = null;
      }
    } else if (tag === "a:tc" && table === 1) {
      if (!close && !empty) cell = [];
      else if (close && cell && row) {
        row.push(cell.join("\n"));
        cell = null;
      } else if (empty && row) row.push("");
    }
  }
  return { lines, pictures };
}

/** "16:9 (13.33 × 7.5 in)" for a slide size in EMU, the nearest common ratio named when it is close. */
function slideSize(cx, cy) {
  const inches = (v) => Number((v / EMU_PER_INCH).toFixed(2));
  const near = RATIOS.find(([, r]) => Math.abs(cx / cy - r) < 0.01);
  return `${near ? `${near[0]} ` : ""}(${inches(cx)} × ${inches(cy)} in)`;
}

/** A theme's name, heading and body fonts, and its named colors, as one line each. */
function themeLines(xml) {
  if (!xml) return [];
  const out = [];
  const name = /<a:theme\b[^>]*>/.exec(xml);
  const font = (kind) => {
    const m = new RegExp(`<a:${kind}>[\\s\\S]*?<a:latin\\b([^>]*)>`).exec(xml);
    return m ? attr(m[1], "typeface") : null;
  };
  const major = font("majorFont");
  const minor = font("minorFont");
  const title = name ? attr(name[0], "name") : null;
  if (major || minor) out.push(`Theme${title ? ` "${title}"` : ""} fonts: ${major ?? "?"} (headings), ${minor ?? "?"} (body).`);
  const colors = [];
  for (const key of THEME_COLORS) {
    const m = new RegExp(`<a:${key}>\\s*<a:(srgbClr|sysClr)\\b([^>]*)>`).exec(xml);
    if (!m) continue;
    const hex = m[1] === "srgbClr" ? attr(m[2], "val") : attr(m[2], "lastClr");
    if (hex && /^[0-9a-f]{6}$/i.test(hex)) colors.push(`${key} #${hex.toUpperCase()}`);
  }
  if (colors.length) out.push(`Theme colors: ${colors.join(", ")}.`);
  return out;
}

/** A slide's own solid background color, when it sets one. */
function slideBackground(xml) {
  const m = /<p:bg>[\s\S]*?<a:srgbClr\b([^>]*)>/.exec(xml);
  const hex = m ? attr(m[1], "val") : null;
  return hex && /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

/** The slides of a presentation in show order: from its slide list, else by the numbers in their names. */
function slideParts(pkg) {
  const pres = pkg.text("ppt/presentation.xml");
  if (pres) {
    const rels = relationships(pkg, "ppt/presentation.xml");
    const order = [...pres.matchAll(/<p:sldId\b[^>]*>/g)].map((m) => rels.get(attr(m[0], "r:id") ?? "")?.name).filter((n) => n && pkg.names.includes(n));
    if (order.length) return order;
  }
  const num = (n) => Number(/(\d+)\.xml$/.exec(n)?.[1] ?? 0);
  return pkg.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
}

/**
 * The text of a PowerPoint deck (.pptx): its size and theme, then each slide
 * under "--- Slide n ---" with its title as "#", its text, its tables, how many
 * pictures it has, its own background color, and its speaker notes.
 */
function pptxText(buf) {
  const pkg = openPackage(buf, "PowerPoint");
  const slides = slideParts(pkg);
  const pres = pkg.text("ppt/presentation.xml");
  if (pres === null && !slides.length) throw new Error("It has no slides part (ppt/presentation.xml), so it isn't a PowerPoint deck. Save it again as .pptx.");
  const head = [`${slides.length} ${slides.length === 1 ? "slide" : "slides"}`];
  const size = pres ? /<p:sldSz\b([^>]*)>/.exec(pres) : null;
  const cx = size ? Number(attr(size[1], "cx")) : 0;
  const cy = size ? Number(attr(size[1], "cy")) : 0;
  if (cx > 0 && cy > 0) head.push(slideSize(cx, cy));
  const themeName = pkg.names.filter((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n)).sort()[0];
  const lines = [`PowerPoint deck: ${head.join(", ")}.`, ...themeLines(themeName ? pkg.text(themeName) : null)];
  slides.forEach((part, i) => {
    const xml = pkg.text(part) ?? "";
    const { lines: body, pictures } = slideLines(xml);
    const notesPart = [...relationships(pkg, part).values()].find((r) => r.type.endsWith("/notesSlide"))?.name;
    const notes = notesPart ? slideLines(pkg.text(notesPart) ?? "", { notes: true }).lines : [];
    const bg = slideBackground(xml);
    lines.push("", `--- Slide ${i + 1} ---`);
    if (bg) lines.push(`Background: ${bg}.`);
    lines.push(...(body.length ? body : ["(no text)"]));
    if (pictures) lines.push(`[${pictures} ${pictures === 1 ? "picture" : "pictures"}]`);
    if (notes.length) lines.push(`Notes: ${notes.map((n) => n.trim()).join(" ")}`);
  });
  return cleanLines(lines);
}

/** The text of an OpenDocument paragraph's inner markup: spaces, tabs and line breaks kept, other tags dropped. */
const odfInline = (s) =>
  xmlText(
    s
      .replace(/<text:s\b([^>]*)\/>/g, (_m, a) => " ".repeat(Math.min(100, Number(attr(a, "text:c") ?? 1) || 1)))
      .replace(/<text:tab\s*\/>/g, "\t")
      .replace(/<text:line-break\s*\/>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  ).trim();

/** The text of an OpenDocument text file (.odt) or presentation (.odp): headings as "#", each slide under "--- Slide n ---". */
function odfText(buf, kind) {
  const pkg = openPackage(buf, kind === "odp" ? "OpenDocument presentation" : "OpenDocument text");
  const xml = pkg.text("content.xml");
  if (xml === null) throw new Error("It has no content part (content.xml). Save it again from the app that made it.");
  const block = (body) => {
    const out = [];
    for (const m of body.matchAll(/<text:(h|p)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/text:\1>)/g)) {
      const text = odfInline(m[3] ?? "");
      if (!text) continue;
      if (m[1] === "h") {
        const level = Math.min(6, Number(attr(m[2], "text:outline-level") ?? 1) || 1);
        if (out.length) out.push("");
        out.push(`${"#".repeat(level)} ${text}`);
      } else out.push(text);
    }
    return out;
  };
  if (kind !== "odp") return cleanLines(block(xml));
  const pages = [...xml.matchAll(/<draw:page(?=[\s>])[^>]*>([\s\S]*?)<\/draw:page>/g)];
  const lines = [`Presentation: ${pages.length} ${pages.length === 1 ? "slide" : "slides"}.`];
  pages.forEach((m, i) => {
    const [content, notes = ""] = m[1].split(/<presentation:notes\b/);
    const body = [];
    for (const f of content.matchAll(/<draw:(frame|custom-shape)\b([^>]*)>([\s\S]*?)<\/draw:\1>/g)) {
      const title = /title/i.test(attr(f[2], "presentation:class") ?? "");
      body.push(...block(f[3]).map((l) => (title && l ? `# ${l}` : l)));
    }
    const said = block(notes);
    lines.push("", `--- Slide ${i + 1} ---`, ...(body.length ? body : ["(no text)"]));
    if (said.length) lines.push(`Notes: ${said.join(" ")}`);
  });
  return cleanLines(lines);
}

let pdfjsLoad = null;
/** pdf.js, loaded once, for Node. */
function pdfjs() {
  pdfjsLoad ??= import(pathToFileURL(PDFJS_LIB).href);
  return pdfjsLoad;
}

/** An error for a PDF pdf.js could not open, saying what to do. */
function pdfError(err) {
  if (err && err.name === "PasswordException") return new Error("It is locked with a password. Ask the person for a copy without one.");
  return new Error(`It isn't a readable PDF (${err && err.message ? err.message : err}). Ask the person to save or print it to PDF again.`);
}

/**
 * The text of a PDF, a page at a time: { pages, text, title, author }.
 * pages is the page count; text has each page under "--- Page n ---".
 */
async function pdfText(buf) {
  const lib = await pdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice(),
    verbosity: 0,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    cMapUrl: dataDir("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: dataDir("standard_fonts"),
  });
  try {
    const doc = await task.promise.catch((err) => {
      throw pdfError(err);
    });
    const info = await doc.getMetadata().then((m) => m.info ?? {}, () => ({}));
    const lines = [];
    let withText = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let s = "";
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        s += item.str;
        if (item.hasEOL) s += "\n";
      }
      page.cleanup();
      const text = s.replace(/[ \t]+\n/g, "\n").trim();
      if (text) withText++;
      lines.push("", `--- Page ${n} ---`, text || "(no text on this page)");
    }
    const clean = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
    return { pages: doc.numPages, withText, text: cleanLines(lines), title: clean(info.Title), author: clean(info.Author) };
  } finally {
    await task.destroy();
  }
}

/** Runs in the hidden window: pdf.js from its source, one page drawn on a canvas, as a PNG (or a JPEG when the PNG is over maxBytes). */
async function drawPageInWindow(libSource, workerSource, base64, pageNo, maxSide, maxBytes) {
  const blobUrl = (s) => URL.createObjectURL(new Blob([s], { type: "text/javascript" }));
  const lib = await import(blobUrl(libSource));
  lib.GlobalWorkerOptions.workerSrc = blobUrl(workerSource);
  const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  let doc;
  try {
    doc = await lib.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  } catch (err) {
    return { error: err && err.name === "PasswordException" ? "password" : String((err && err.message) || err) };
  }
  if (pageNo > doc.numPages) return { pages: doc.numPages };
  const page = await doc.getPage(pageNo);
  const one = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(4, maxSide / Math.max(one.width, one.height)) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  let url = canvas.toDataURL("image/png");
  let mimeType = "image/png";
  if (url.length * 0.75 > maxBytes) {
    url = canvas.toDataURL("image/jpeg", 0.85);
    mimeType = "image/jpeg";
  }
  return { pages: doc.numPages, width: canvas.width, height: canvas.height, mimeType, data: url.slice(url.indexOf(",") + 1) };
}

let sources = null;
let renderSession = null;

/** A session for drawing pages: nothing but the page itself and the blobs it makes can load, and it asks for no permission. */
function pdfSession() {
  if (renderSession) return renderSession;
  renderSession = electron.session.fromPartition("crew-pdf-pages");
  renderSession.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !/^(about|blob|data):/.test(details.url) }));
  renderSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  renderSession.setPermissionCheckHandler(() => false);
  return renderSession;
}

/**
 * One page of a PDF drawn as an image, its longest side at most maxSide:
 * { pages, width, height, mimeType, data } (data in base64), or { pages } when
 * there is no such page. Drawn in a hidden window, so it needs Electron.
 */
async function pdfPageImage(buf, pageNo, { maxSide, maxBytes }) {
  if (!electron || typeof electron !== "object" || !electron.BrowserWindow) throw new Error("Pages can be shown as images only in the Crew app.");
  sources ??= { lib: fs.readFileSync(PDFJS_LIB, "utf8"), worker: fs.readFileSync(PDFJS_WORKER, "utf8") };
  const win = new electron.BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: { session: pdfSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  let timer;
  try {
    await win.loadURL("about:blank");
    const args = [sources.lib, sources.worker, buf.toString("base64"), pageNo, maxSide, maxBytes].map((a) => JSON.stringify(a)).join(",");
    const run = win.webContents.executeJavaScript(`(${drawPageInWindow.toString()})(${args})`);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Drawing page ${pageNo} took over ${RENDER_TIMEOUT_MS / 1000} s.`)), RENDER_TIMEOUT_MS);
    });
    const r = await Promise.race([run, timeout]);
    if (r.error === "password") throw new Error("It is locked with a password. Ask the person for a copy without one.");
    if (r.error) throw new Error(`It isn't a readable PDF (${r.error}). Ask the person to save or print it to PDF again.`);
    return r;
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { docxText, pptxText, odfText, pdfText, pdfPageImage };
