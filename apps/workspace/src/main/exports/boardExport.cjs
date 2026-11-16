// Export IPC handlers for PNG and SVG.

const { dialog, ipcMain } = require("electron");
const fsp = require("node:fs/promises");
const path = require("node:path");

const KINDS = { png: "PNG image", svg: "SVG vector image" };

function safeName(name) {
  return (String(name || "board").replace(/[\\/:*?"<>|]+/g, " ").trim() || "board").slice(0, 120);
}

function register({ getWin, assertSender }) {
  ipcMain.handle("boardExport:save", async (e, title, ext, bytes) => {
    assertSender(e);
    if (!["png", "svg"].includes(ext) || !(bytes instanceof Uint8Array)) throw new Error("refused");
    if (process.env.OPENDECK_EXPORT_DIR) {
      const file = path.join(process.env.OPENDECK_EXPORT_DIR, `${safeName(title)}.${ext}`);
      await fsp.writeFile(file, bytes);
      return file;
    }
    const r = await dialog.showSaveDialog(getWin(), {
      defaultPath: `${safeName(title)}.${ext}`,
      filters: [{ name: KINDS[ext], extensions: [ext] }],
    });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, bytes);
    return r.filePath;
  });
}

module.exports = { register };

