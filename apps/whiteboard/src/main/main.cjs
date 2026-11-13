// Fenna Whiteboard desktop: the main process.

const { app, BrowserWindow, ipcMain, protocol, net, Menu, nativeTheme } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { TabHost, STRIP_H, PRELOAD, registerAgent, registerShell, createFolderHost, registerAssetScheme, prepareReview, applyReviewTheme, startReview } = require("@opendeck/shell/main");

const DEV_URL = process.env.OPENDECK_DEV_URL || null;
const MAX_COVER = 500 * 1024;

/** @type {BrowserWindow | null} */
let win = null;
/** @type {TabHost | null} */
let tabs = null;

prepareReview(app);
registerAssetScheme(protocol, "odboard");

async function describeBoard(root) {
  const boardText = await fsp.readFile(path.join(root, "board.json"), "utf8").catch(() => null);
  const canvasFile = path.join(root, "canvas.json");
  if (boardText === null && !fs.existsSync(canvasFile)) return null;
  let meta = null;
  try {
    meta = boardText ? JSON.parse(boardText) : null;
  } catch {
    /* broken board.json: titled after the folder */
  }
  const times = await Promise.all([path.join(root, "board.json"), canvasFile].map((p) => fsp.stat(p).then((s) => s.mtimeMs, () => 0)));
  // The cover is the board itself, drawn small; a very big board shows none.
  let cover = null;
  const size = await fsp.stat(canvasFile).then((s) => s.size, () => Infinity);
  if (size <= MAX_COVER) {
    try {
      cover = JSON.parse(await fsp.readFile(canvasFile, "utf8"));
    } catch {
      cover = null;
    }
  }
  const title = meta && typeof meta.title === "string" && meta.title.trim() ? meta.title.trim().slice(0, 200) : path.basename(root);
  return { title, edited: Math.max(...times), index: meta, cover };
}

const folders = createFolderHost({
  prefix: "board",
  scheme: "odboard",
  files: /^(board\.json|canvas\.json|comments\.json|history\.json|assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120})$/,
  dirs: /^(assets)$/,
  removable: () => false,
  newFolders: ["assets"],
  words: { open: "Open a board folder", create: "Create a board", untitled: "Untitled board" },
  describe: describeBoard,
  userDataDir: app.getPath("userData"),
  // A board of thousands of items, and its history, is several megabytes of JSON.
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
    backgroundColor: themeMode() === "dark" ? "#0e0e0e" : "#f7f7f6",
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
    load: (wc) => loadPage(wc, process.env.OPENDECK_BOARD_TAB ? `tab=${encodeURIComponent(process.env.OPENDECK_BOARD_TAB)}` : ""),
    setRoot: folders.setRoot,
    trust: folders.trust,
    themeMode,
    product: { name: "Fenna Whiteboard", kind: "board", kindName: "Whiteboard", marker: "board.json" },
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
  const argBoard = process.argv.find((a) => a.startsWith("--board="))?.slice(8);
  const initial = argBoard || process.env.OPENDECK_BOARD || null;
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

