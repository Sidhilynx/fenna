// Exports. PDF is rendered by Chromium itself from a hidden window that shows
// the whole doc (the same renderer as the editor), so it looks like the
// page. The page builds Word, Markdown and HTML itself and hands the bytes
// here to save.

const { BrowserWindow, dialog, ipcMain } = require("electron");
const fsp = require("node:fs/promises");
const path = require("node:path");

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", avif: "image/avif" };
const KINDS = { docx: "Word document", md: "Markdown", html: "Web page", pdf: "PDF" };

function safeName(name) {
  return (String(name || "doc").replace(/[\\/:*?"<>|]+/g, " ").trim() || "doc").slice(0, 120);
}

async function askWhere(win, title, ext) {
  // Scripted review runs save without asking.
  if (process.env.OPENDECK_EXPORT_DIR) return path.join(process.env.OPENDECK_EXPORT_DIR, `${safeName(title)}.${ext}`);
  const r = await dialog.showSaveDialog(win, { defaultPath: `${safeName(title)}.${ext}`, filters: [{ name: KINDS[ext], extensions: [ext] }] });
  return r.canceled || !r.filePath ? null : r.filePath;
}

function register({ getWin, getRoot, setRoot, preload, load, assertSender, trust }) {
  /** A hidden window showing the whole doc of `root`; resolves once fonts and images are in. */
  function printWindow(root) {
    return new Promise((resolve, reject) => {
      if (!root) return reject(new Error("no doc open"));
      const w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { preload, contextIsolation: true, sandbox: true } });
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
      const timer = setTimeout(() => done(new Error("The doc took too long to render")), 60_000);
      ipcMain.on("print:ready", onReady);
      load(w, "print");
    });
  }

  ipcMain.handle("export:pdf", async (e, title) => {
    assertSender(e);
    const file = await askWhere(getWin(), title, "pdf");
    if (!file) return null;
    const { w, close } = await printWindow(getRoot(e.sender));
    try {
      await fsp.writeFile(file, await w.webContents.printToPDF({ pageSize: "A4", margins: { marginType: "default" }, printBackground: true, preferCSSPageSize: true }));
    } finally {
      close();
    }
    return file;
  });

  // Word, Markdown and HTML: the page made the bytes; ask where, and write them.
  ipcMain.handle("export:save", async (e, title, ext, bytes) => {
    assertSender(e);
    if (!["docx", "md", "html"].includes(ext) || !(bytes instanceof Uint8Array)) throw new Error("refused");
    const file = await askWhere(getWin(), title, ext);
    if (!file) return null;
    await fsp.writeFile(file, bytes);
    return file;
  });

  // An image as bytes with its type, for exports that must stand alone.
  ipcMain.handle("export:asset", async (e, rel) => {
    assertSender(e);
    const root = getRoot(e.sender);
    if (!root || typeof rel !== "string" || !/^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(rel)) return null;
    const full = path.resolve(root, rel);
    if (!full.startsWith(path.resolve(root) + path.sep)) return null;
    const mime = MIME[path.extname(full).slice(1).toLowerCase()];
    if (!mime) return null;
    const data = await fsp.readFile(full).catch(() => null);
    return data ? { mime, bytes: new Uint8Array(data) } : null;
  });
}

module.exports = { register };
