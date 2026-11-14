// Fenna Design desktop: the main process.

const { app, BrowserWindow, ipcMain, protocol, net, Menu, nativeTheme } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  TabHost,
  STRIP_H,
  PRELOAD,
  registerAgent,
  registerShell,
  createFolderHost,
  registerAssetScheme,
  prepareReview,
  applyReviewTheme,
  startReview,
} = require("@opendeck/shell/main");

const DEV_URL = process.env.OPENDECK_DEV_URL || null;
const MAX_COVER = 500 * 1024;
const ARTBOARD_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.html$/;

/** @type {BrowserWindow | null} */
let win = null;
/** @type {TabHost | null} */
let tabs = null;

prepareReview(app);
registerAssetScheme(protocol, "oddesign");

/** What Home shows of a design: its title, when it last changed, and its first artboard for the cover. */
async function describeDesign(root) {
  const text = await fsp.readFile(path.join(root, "design.json"), "utf8").catch(() => null);
  if (text === null) return null;
  let meta = null;
  try {
    meta = JSON.parse(text);
  } catch {
    /* a design.json that can't be read: titled after the folder, no cover */
  }
  const order = meta && Array.isArray(meta.order) ? meta.order.filter((f) => typeof f === "string" && ARTBOARD_RE.test(f)) : [];
  const stamps = await Promise.all(["design.json", ...order.map((f) => `artboards/${f}`)].map((rel) => fsp.stat(path.join(root, rel)).then((s) => s.mtimeMs, () => 0)));
  let cover = null;
  const first = order[0];
  if (first) {
    const full = path.join(root, "artboards", first);
    const size = await fsp.stat(full).then((s) => s.size, () => Infinity);
    if (size <= MAX_COVER) cover = { file: first, html: await fsp.readFile(full, "utf8").catch(() => null) };
    if (cover && cover.html === null) cover = null;
  }
  const title = meta && typeof meta.title === "string" && meta.title.trim() ? meta.title.trim().slice(0, 200) : path.basename(root);
  return { title, edited: Math.max(...stamps), index: meta, cover };
}

const folders = createFolderHost({
  prefix: "design",
  scheme: "oddesign",
  files: /^(design\.json|notes\.json|comments\.json|history\.json|artboards\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.html|assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120})$/,
  dirs: /^(artboards|assets)$/,
  removable: (rel) => /^artboards\//.test(rel),
  newFolders: ["artboards", "assets"],
  words: { open: "Open a design folder", create: "Create a design", untitled: "Untitled design" },
  describe: describeDesign,
  userDataDir: app.getPath("userData"),
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
    load: (wc) => loadPage(wc, process.env.OPENDECK_DESIGN_TAB ? `tab=${encodeURIComponent(process.env.OPENDECK_DESIGN_TAB)}` : ""),
    setRoot: folders.setRoot,
    trust: folders.trust,
    themeMode,
    product: { name: "Fenna Design", kind: "design", kindName: "Design", marker: "design.json" },
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
  require("./export.cjs").register({ getWin: () => win, assertSender: folders.assertSender, getDesignRoot: folders.rootOf, trust: folders.trust, setRoot: folders.setRoot, preload: PRELOAD });
  const argDesign = process.argv.find((a) => a.startsWith("--design="))?.slice(9);
  const initial = argDesign || process.env.OPENDECK_DESIGN || null;
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

