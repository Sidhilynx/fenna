// Export: an artboard as a PNG or a PDF, drawn by a hidden window from the
// standalone page the editor builds (the same markup the canvas shows), and
// plain saves of bytes the page made itself (HTML).

const { BrowserWindow, dialog, ipcMain } = require("electron");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const KINDS = { png: "PNG image", pdf: "PDF document", html: "Web page" };
const MAX_HTML = 96 * 1024 * 1024;
/** Chromium draws no surface over about 16k pixels a side. */
const MAX_SIDE = 16000;

const safeName = (name) => (String(name || "design").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim() || "design").slice(0, 120);
const side = (v) => Math.max(16, Math.min(8000, Math.round(Number(v) || 0)));

async function askWhere(win, title, ext) {
  if (process.env.OPENDECK_EXPORT_DIR) return path.join(process.env.OPENDECK_EXPORT_DIR, `${safeName(title)}.${ext}`);
  const r = await dialog.showSaveDialog(win, { defaultPath: `${safeName(title)}.${ext}`, filters: [{ name: KINDS[ext], extensions: [ext] }] });
  return r.canceled || !r.filePath ? null : r.filePath;
}

async function askFolder(win, title) {
  if (process.env.OPENDECK_EXPORT_DIR) return path.join(process.env.OPENDECK_EXPORT_DIR, safeName(title));
  const r = await dialog.showOpenDialog(win, { title: "Choose a folder for the images", properties: ["openDirectory", "createDirectory"] });
  return r.canceled || !r.filePaths[0] ? null : path.join(r.filePaths[0], safeName(title));
}

/** Load `html` in a hidden window of w×h CSS px at `zoom`, run `use` on it, and close it. No scripts run there. */
async function withPage(html, w, h, zoom, use) {
  if (typeof html !== "string" || html.length > MAX_HTML) throw new Error("refused");
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "fenna-design-export-"));
  const file = path.join(dir, "page.html");
  await fsp.writeFile(file, html, "utf8");
  const win = new BrowserWindow({ show: false, width: Math.ceil(w * zoom), height: Math.ceil(h * zoom), useContentSize: true, webPreferences: { contextIsolation: true, sandbox: true, javascript: false, offscreen: true } });
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    await win.loadFile(file);
    win.webContents.setZoomFactor(zoom);
    await new Promise((r) => setTimeout(r, 350));
    return await use(win);
  } finally {
    win.destroy();
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// The window may be clamped to the screen, so the viewport and pixel ratio are set
// through the DevTools protocol instead: the capture is exactly w×h at `zoom`, with
// no scrollbars, whatever the screen's size or scale.
async function pngOf(html, width, height, scale) {
  const w = side(width);
  const h = side(height);
  const zoom = Math.max(0.1, Math.min(Number(scale) || 1, 4, MAX_SIDE / w, MAX_SIDE / h));
  return withPage(html, w, h, 1, async (win) => {
    const dbg = win.webContents.debugger;
    dbg.attach("1.3");
    try {
      await dbg.sendCommand("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: zoom, mobile: false });
      await dbg.sendCommand("Emulation.setScrollbarsHidden", { hidden: true });
      const { data } = await dbg.sendCommand("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: w, height: h, scale: 1 }, captureBeyondViewport: true });
      return Buffer.from(data, "base64");
    } finally {
      dbg.detach();
    }
  });
}

function register({ getWin, assertSender }) {
  ipcMain.handle("designExport:save", async (e, title, ext, bytes) => {
    assertSender(e);
    if (ext !== "html" || !(bytes instanceof Uint8Array) || bytes.length > MAX_HTML) throw new Error("refused");
    const file = await askWhere(getWin(), title, ext);
    if (!file) return null;
    await fsp.writeFile(file, bytes);
    return file;
  });

  ipcMain.handle("designExport:png", async (e, title, html, width, height, scale) => {
    assertSender(e);
    const file = await askWhere(getWin(), title, "png");
    if (!file) return null;
    await fsp.writeFile(file, await pngOf(html, width, height, scale));
    return file;
  });

  // Several artboards as PNGs in one new folder: [{ name, html, width, height }].
  ipcMain.handle("designExport:pngs", async (e, title, pages, scale) => {
    assertSender(e);
    if (!Array.isArray(pages) || !pages.length || pages.length > 40) throw new Error("refused");
    const dir = await askFolder(getWin(), title);
    if (!dir) return null;
    await fsp.mkdir(dir, { recursive: true });
    const taken = new Set();
    for (const p of pages) {
      let name = safeName(p.name);
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${safeName(p.name)} ${n}`;
      taken.add(name.toLowerCase());
      await fsp.writeFile(path.join(dir, `${name}.png`), await pngOf(p.html, p.width, p.height, scale));
    }
    return dir;
  });

  // The page sets each sheet's size itself (@page), so one document can hold artboards of different sizes.
  ipcMain.handle("designExport:pdf", async (e, title, html, width, height) => {
    assertSender(e);
    const file = await askWhere(getWin(), title, "pdf");
    if (!file) return null;
    const w = side(width);
    const h = side(height);
    const pdf = await withPage(html, w, h, 1, (win) => win.webContents.printToPDF({ pageSize: { width: w / 96, height: h / 96 }, margins: { marginType: "none" }, printBackground: true, preferCSSPageSize: true }));
    await fsp.writeFile(file, pdf);
    return file;
  });
}

module.exports = { register };
