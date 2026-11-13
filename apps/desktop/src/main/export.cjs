// Exports. PDF and PNG are rendered by Chromium itself from a hidden window
// that shows every slide at full size (the same renderer as the editor), so
// they look exactly like the slides. The page builds HTML and PPTX itself and
// hands the bytes here to save.

const { BrowserWindow, dialog, ipcMain } = require("electron");
const fsp = require("node:fs/promises");
const path = require("node:path");

const PAGE_IN = { width: 20, height: 11.25 }; // 1920×1080 CSS px at 96 dpi
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", avif: "image/avif", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };

function safeName(name) {
  return (String(name || "deck").replace(/[\\/:*?"<>|]+/g, " ").trim() || "deck").slice(0, 120);
}

async function askWhere(win, title, ext, label) {
  // Scripted review runs save without asking.
  if (process.env.OPENDECK_EXPORT_DIR) return path.join(process.env.OPENDECK_EXPORT_DIR, `${safeName(title)}.${ext}`);
  const r = await dialog.showSaveDialog(win, { defaultPath: `${safeName(title)}.${ext}`, filters: [{ name: label, extensions: [ext] }] });
  return r.canceled || !r.filePath ? null : r.filePath;
}

function register({ getWin, getDeckRoot, setRoot, preload, load, assertSender, trust }) {
  /** A hidden window showing the slides of `root` at full size; resolves once fonts and images are in. */
  function printWindow(root, only) {
    return new Promise((resolve, reject) => {
      if (!root) return reject(new Error("no deck open"));
      // Offscreen rendering lays out at a device scale of 1 whatever the display's
      // scaling, so the page is exactly 1920×1080 CSS px and so is the capture.
      const w = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, webPreferences: { preload, contextIsolation: true, sandbox: true, offscreen: true } });
      const untrust = trust(w.webContents);
      setRoot(w.webContents, root);
      const done = (err) => {
        clearTimeout(timer);
        ipcMain.removeListener("print:ready", onReady);
        if (err) {
          untrust();
          w.destroy();
          reject(err);
        } else resolve({ w, close: () => (untrust(), w.destroy()) });
      };
      const onReady = (e) => e.sender === w.webContents && done(null);
      const timer = setTimeout(() => done(new Error("The slides took too long to render")), 60_000);
      ipcMain.on("print:ready", onReady);
      load(w, only === undefined ? "print" : `print&only=${only}`);
    });
  }

  ipcMain.handle("export:pdf", async (e, title) => {
    assertSender(e);
    const file = await askWhere(getWin(), title, "pdf", "PDF");
    if (!file) return null;
    const { w, close } = await printWindow(getDeckRoot(e.sender));
    try {
      await fsp.writeFile(file, await w.webContents.printToPDF({ pageSize: PAGE_IN, margins: { marginType: "none" }, printBackground: true, preferCSSPageSize: true }));
    } finally {
      close();
    }
    return file;
  });

  ipcMain.handle("export:png", async (e, title, index) => {
    assertSender(e);
    const n = Number(index);
    if (!Number.isInteger(n) || n < 0) throw new Error("refused");
    const file = await askWhere(getWin(), `${title} - slide ${n + 1}`, "png", "PNG image");
    if (!file) return null;
    const { w, close } = await printWindow(getDeckRoot(e.sender), n);
    try {
      // A window can't be larger than the screen (1536×864 logical px on a 1080p display at
      // 125%), so zoom the page until the 1920×1080 slide fills what we got, then capture it all.
      const [cw, ch] = w.getContentSize();
      const zoom = Math.min(cw / 1920, ch / 1080);
      w.webContents.setZoomFactor(zoom);
      await new Promise((r) => setTimeout(r, 300));
      const img = await w.webContents.capturePage({ x: 0, y: 0, width: Math.floor(1920 * zoom), height: Math.floor(1080 * zoom) });
      await fsp.writeFile(file, img.resize({ width: 1920, height: 1080, quality: "best" }).toPNG());
    } finally {
      close();
    }
    return file;
  });

  // HTML and PPTX: the page made the bytes; ask where, and write them.
  ipcMain.handle("export:save", async (e, title, ext, bytes) => {
    assertSender(e);
    if (!["html", "pptx"].includes(ext) || !(bytes instanceof Uint8Array)) throw new Error("refused");
    const file = await askWhere(getWin(), title, ext, ext === "html" ? "Web page" : "PowerPoint");
    if (!file) return null;
    await fsp.writeFile(file, bytes);
    return file;
  });

  // An asset as a data: URI, for exports that must stand alone.
  ipcMain.handle("export:assetData", async (e, rel) => {
    assertSender(e);
    const root = getDeckRoot(e.sender);
    if (!root || typeof rel !== "string" || !/^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(rel)) return null;
    const full = path.resolve(root, rel);
    if (!full.startsWith(path.resolve(root) + path.sep)) return null;
    const mime = MIME[path.extname(full).slice(1).toLowerCase()];
    if (!mime) return null;
    const data = await fsp.readFile(full).catch(() => null);
    return data ? `data:${mime};base64,${data.toString("base64")}` : null;
  });
}

module.exports = { register };
