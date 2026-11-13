// Import & export IPC handlers for CSV and Excel (.xlsx).

const { dialog, ipcMain } = require("electron");
const fsp = require("node:fs/promises");
const path = require("node:path");

const KINDS = { xlsx: "Excel workbook", csv: "CSV table" };

function safeName(name) {
  return (String(name || "sheet").replace(/[\\/:*?"<>|]+/g, " ").trim() || "sheet").slice(0, 120);
}

function register({ getWin, assertSender }) {
  ipcMain.handle("sheetExport:save", async (e, title, ext, bytes) => {
    assertSender(e);
    if (!["xlsx", "csv"].includes(ext) || !(bytes instanceof Uint8Array)) throw new Error("refused");
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

  ipcMain.handle("sheetImport:pick", async (e, kind) => {
    assertSender(e);
    const exts = kind === "xlsx" ? ["xlsx"] : ["csv", "tsv", "txt"];
    const name = kind === "xlsx" ? "Excel workbook" : "CSV file";
    const r = await dialog.showOpenDialog(getWin(), {
      title: `Import ${name}`,
      properties: ["openFile"],
      filters: [{ name, extensions: exts }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    const data = await fsp.readFile(file);
    return { name: path.basename(file, path.extname(file)), bytes: new Uint8Array(data) };
  });
}

module.exports = { register };

