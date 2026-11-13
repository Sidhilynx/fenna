// Fenna Slides desktop: the main process.
//
// The shell does the work every app shares: the window's tabs (TabHost), the
// open folders with their narrow file API and watcher (createFolderHost),
// the assistant, and the review aids. What is Fenna Slides' own: which files a
// deck has, how a recent deck is described on Home, and the exports.

const { app, BrowserWindow, dialog, ipcMain, protocol, net, Menu, nativeTheme } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { TabHost, STRIP_H, PRELOAD, registerAgent, registerShell, createFolderHost, registerAssetScheme, prepareReview, applyReviewTheme, startReview } = require("@opendeck/shell/main");

const DEV_URL = process.env.OPENDECK_DEV_URL || null;
const SLIDE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_COVER = 400 * 1024;

/** @type {BrowserWindow | null} */
let win = null;
/** @type {TabHost | null} */
let tabs = null;

prepareReview(app);
registerAssetScheme(protocol, "odasset");

/** A recent deck as Home lists it: title, when it last changed, and its first slide for the picture. */
async function describeDeck(root) {
  const text = await fsp.readFile(path.join(root, "deck.json"), "utf8").catch(() => null);
  const slidesDir = path.join(root, "slides");
  if (text === null && !fs.existsSync(slidesDir)) return null;
  let index = null;
  try {
    index = text ? JSON.parse(text) : null;
  } catch {
    /* a broken deck.json: listed by folder name, without a picture */
  }
  const times = await Promise.all([path.join(root, "deck.json"), slidesDir].map((p) => fsp.stat(p).then((s) => s.mtimeMs, () => 0)));
  const first = index && Array.isArray(index.slides) && typeof index.slides[0] === "string" && SLIDE_ID.test(index.slides[0]) ? index.slides[0] : null;
  const coverFile = first ? path.join(slidesDir, `${first}.html`) : null;
  const size = coverFile ? await fsp.stat(coverFile).then((s) => s.size, () => Infinity) : Infinity;
  const cover = size <= MAX_COVER ? await fsp.readFile(coverFile, "utf8").catch(() => null) : null;
  const title = index && typeof index.title === "string" && index.title.trim() ? index.title.trim().slice(0, 200) : path.basename(root);
  return { title, edited: Math.max(...times), index, cover };
}

const folders = createFolderHost({
  prefix: "deck",
  scheme: "odasset",
  files: /^(deck\.json|comments\.json|slides\/[A-Za-z][A-Za-z0-9_-]{0,63}\.html|assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120})$/,
  dirs: /^(slides|assets)$/,
  removable: (rel) => rel.startsWith("slides/"),
  newFolders: ["slides", "assets"],
  words: { open: "Open a deck folder", create: "Create a deck", untitled: "Untitled deck" },
  describe: describeDeck,
  userDataDir: app.getPath("userData"),
});

/** Load our page into a webContents, with an optional #hash. */
function loadPage(wc, hash) {
  if (DEV_URL) return wc.loadURL(hash ? `${DEV_URL}#${hash}` : DEV_URL);
  return wc.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"), hash ? { hash } : undefined);
}

const themeMode = () => (nativeTheme.shouldUseDarkColors ? "dark" : "light");

function createWindow(initialRoot) {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
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
    load: (wc) => loadPage(wc, process.env.OPENDECK_SLIDE ? `slide=${encodeURIComponent(process.env.OPENDECK_SLIDE)}` : ""),
    setRoot: folders.setRoot,
    trust: folders.trust,
    themeMode,
    product: { name: "Fenna Slides", kind: "deck", kindName: "Deck", marker: "deck.json" },
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
  folders.register({ getWin: () => win, getTabs: () => tabs, ipcMain, dialog, app, protocol, net });
  registerShell({ assertSender: folders.assertSender, releases: "Sidhilynx/fenna" });
  registerAgent({ getRoot: folders.rootOf, assertSender: folders.assertSender, profile: require("./assistant.cjs") });
  require("./export.cjs").register({ getWin: () => win, getDeckRoot: folders.rootOf, setRoot: folders.setRoot, preload: PRELOAD, load: (w, hash) => loadPage(w.webContents, hash), assertSender: folders.assertSender, trust: folders.trust });
  const argDeck = process.argv.find((a) => a.startsWith("--deck="))?.slice(7);
  const initial = argDeck || process.env.OPENDECK_DECK || null;
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
