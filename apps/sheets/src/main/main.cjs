// Fenna Sheets desktop: the main process.

const { app, BrowserWindow, ipcMain, protocol, net, Menu, nativeTheme } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { TabHost, STRIP_H, PRELOAD, registerAgent, registerShell, createFolderHost, registerAssetScheme, prepareReview, applyReviewTheme, startReview } = require("@opendeck/shell/main");

const DEV_URL = process.env.OPENDECK_DEV_URL || null;
const SHEET_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_COVER = 250 * 1024;

/** @type {BrowserWindow | null} */
let win = null;
/** @type {TabHost | null} */
let tabs = null;

prepareReview(app);
registerAssetScheme(protocol, "odsheet");

async function describeSheet(root) {
  const text = await fsp.readFile(path.join(root, "sheet.json"), "utf8").catch(() => null);
  const sheetsDir = path.join(root, "sheets");
  if (text === null && !fs.existsSync(sheetsDir)) return null;
  let index = null;
  try {
    index = text ? JSON.parse(text) : null;
  } catch {
    /* broken sheet.json */
  }
  const times = await Promise.all([path.join(root, "sheet.json"), sheetsDir].map((p) => fsp.stat(p).then((s) => s.mtimeMs, () => 0)));
  const first = index && Array.isArray(index.sheets) ? index.sheets[0] : null;
  let cover = null;
  if (first && typeof first.id === "string" && SHEET_ID.test(first.id)) {
    const file = path.join(sheetsDir, `${first.id}.json`);
    const size = await fsp.stat(file).then((s) => s.size, () => Infinity);
    if (size <= MAX_COVER) {
      try {
        cover = JSON.parse(await fsp.readFile(file, "utf8"));
      } catch {
        cover = null;
      }
    }
  }
  const title = index && typeof index.title === "string" && index.title.trim() ? index.title.trim().slice(0, 200) : path.basename(root);
  return { title, edited: Math.max(...times), index, cover };
}

const folders = createFolderHost({
  prefix: "sheet",
  scheme: "odsheet",
  files: /^(sheet\.json|comments\.json|history\.json|sheets\/[A-Za-z][A-Za-z0-9_-]{0,63}\.json|assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120})$/,
  dirs: /^(sheets|assets)$/,
  removable: (rel) => rel.startsWith("sheets/"),
  newFolders: ["sheets", "assets"],
  words: { open: "Open a sheet folder", create: "Create a sheet", untitled: "Untitled" },
  describe: describeSheet,
  userDataDir: app.getPath("userData"),
  // A sheet of 100,000 rows is several megabytes of JSON.
  maxWrite: 64 * 1024 * 1024,
});

function loadPage(wc, hash) {
  if (DEV_URL) return wc.loadURL(hash ? `${DEV_URL}#${hash}` : DEV_URL);
  return wc.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"), hash ? { hash } : undefined);
}

const themeMode = () => (nativeTheme.shouldUseDarkColors ? "dark" : "light");

function createWindow(initialRoot) {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: themeMode() === "dark" ? "#0e0e0e" : "#f6f6f5",
    titleBarStyle: "hidden",
    titleBarOverlay: process.platform === "darwin" ? undefined : { color: "#0a0a0a", symbolColor: "#a3a3a3", height: STRIP_H },
    trafficLightPosition: { x: 14, y: 11 },
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once("ready-to-show", () => win?.show());
  void win.loadURL("about:blank");
  tabs = new TabHost({
    window: win,
    preload: PRELOAD,
    userDataDir: app.getPath("userData"),
    load: (wc) => loadPage(wc, process.env.OPENDECK_SHEET_TAB ? `tab=${encodeURIComponent(process.env.OPENDECK_SHEET_TAB)}` : ""),
    setRoot: folders.setRoot,
    trust: folders.trust,
    themeMode,
    product: { name: "Fenna Sheets", kind: "sheet", kindName: "Sheet", marker: "sheet.json" },
  });
  tabs.start(initialRoot);
  startReview(app, win, tabs);
  win.on("closed", () => {
    win = null;
    tabs = null;
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  applyReviewTheme(nativeTheme);
  nativeTheme.on("updated", () => tabs?.applyTheme());
  folders.register({ getWin: () => win, getTabs: () => tabs, ipcMain, dialog: require("electron").dialog, app, protocol, net });
  registerShell({ assertSender: folders.assertSender, releases: "Sidhilynx/fenna" });
  registerAgent({ getRoot: folders.rootOf, assertSender: folders.assertSender, profile: require("./assistant.cjs") });
  require("./export.cjs").register({ getWin: () => win, assertSender: folders.assertSender });
  const argSheet = process.argv.find((a) => a.startsWith("--sheet="))?.slice(8);
  const initial = argSheet || process.env.OPENDECK_SHEET || null;
  const initialRoot = initial && fs.existsSync(initial) ? path.resolve(initial) : null;
  if (initialRoot) await folders.rememberRecent(initialRoot).catch(() => {});
  createWindow(initialRoot);
});

app.on("window-all-closed", () => {
  folders.closeAll();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow(null);
});

