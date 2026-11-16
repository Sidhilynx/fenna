// Fenna Workspace: the unified main process uniting Slides, Docs, Sheets,
// Whiteboard, and Design in a single window.

const { app, BrowserWindow, dialog, ipcMain, protocol, net, Menu, nativeTheme } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  TabHost,
  STRIP_H,
  PRELOAD,
  registerAgent,
  registerShell,
  registerAssetScheme,
  prepareReview,
  applyReviewTheme,
  startReview,
} = require("@opendeck/shell/main");

const { createAllHosts, detectProductKind, starterFilesFor } = require("./hosts.cjs");

const DEV_URL = process.env.OPENDECK_DEV_URL || null;

/** @type {BrowserWindow | null} */
let win = null;
/** @type {TabHost | null} */
let tabs = null;

prepareReview(app);
registerAssetScheme(protocol, "odasset");
registerAssetScheme(protocol, "oddoc");
registerAssetScheme(protocol, "odsheet");
registerAssetScheme(protocol, "odboard");
registerAssetScheme(protocol, "oddesign");

const PRODUCTS = [
  { id: "deck", name: "Fenna Slides", kind: "deck", kindName: "Deck", marker: "deck.json", noun: "deck", nouns: "decks" },
  { id: "doc", name: "Fenna Docs", kind: "doc", kindName: "Doc", marker: "doc.json", noun: "doc", nouns: "docs" },
  { id: "sheet", name: "Fenna Sheets", kind: "sheet", kindName: "Sheet", marker: "sheet.json", noun: "sheet", nouns: "sheets" },
  { id: "board", name: "Fenna Whiteboard", kind: "board", kindName: "Whiteboard", marker: "board.json", noun: "whiteboard", nouns: "whiteboards" },
  { id: "design", name: "Fenna Design", kind: "design", kindName: "Design", marker: "design.json", noun: "design", nouns: "designs" },
];

let hosts = null;

function getHost(kind) {
  if (!hosts) hosts = createAllHosts(app.getPath("userData"));
  return hosts[kind] || hosts.deck;
}

function rootOfAny(sender) {
  if (!sender || !hosts) return null;
  return hosts.deck.rootOf(sender) || hosts.doc.rootOf(sender) || hosts.sheet.rootOf(sender) || hosts.board.rootOf(sender) || hosts.design.rootOf(sender) || null;
}

function assertSenderAny(e) {
  if (!hosts) return;
  try {
    hosts.deck.assertSender(e);
  } catch {
    try {
      hosts.doc.assertSender(e);
    } catch {
      try {
        hosts.sheet.assertSender(e);
      } catch {
        try {
          hosts.board.assertSender(e);
        } catch {
          hosts.design.assertSender(e);
        }
      }
    }
  }
}

function getEditorHtmlPath(kind) {
  const packaged = path.join(__dirname, "..", "..", "dist", "editors", kind, "index.html");
  if (fs.existsSync(packaged)) return packaged;
  const devFolder = {
    deck: "desktop",
    doc: "docs",
    sheet: "sheets",
    board: "whiteboard",
    design: "design",
  }[kind] || "desktop";
  return path.join(__dirname, "..", "..", "..", devFolder, "dist", "index.html");
}

function loadPageForTab(wc, tab) {
  if (!tab || !tab.root) {
    if (DEV_URL) return wc.loadURL(DEV_URL);
    return wc.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  }
  const kind = detectProductKind(tab.root) || "deck";
  return wc.loadFile(getEditorHtmlPath(kind));
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
    name: "Fenna Workspace",
    products: PRODUCTS,
    load: (wc, tab) => loadPageForTab(wc, tab),
    setRoot: (wc, root) => {
      if (!hosts) return;
      for (const h of Object.values(hosts)) {
        h.setRoot(wc, root);
      }
    },
    trust: (wc) => {
      if (!hosts) return () => {};
      const untrusts = Object.values(hosts).map((h) => h.trust(wc));
      return () => untrusts.forEach((u) => u());
    },
    themeMode,
  });

  tabs.start(initialRoot);
  startReview(app, win, tabs);

  win.on("closed", () => {
    win = null;
    tabs = null;
  });
}

function registerWorkspaceIpc() {
  ipcMain.handle("workspace:products", () => PRODUCTS);

  ipcMain.handle("workspace:recent", async (_e, filterProduct) => {
    if (!hosts) return [];
    const list = [];
    for (const [prodId, h] of Object.entries(hosts)) {
      if (filterProduct && filterProduct !== prodId) continue;
      const prodDef = PRODUCTS.find((p) => p.id === prodId);
      try {
        const recents = await h.recent();
        for (const r of recents) {
          list.push({
            root: r.root,
            name: r.name,
            title: r.title,
            edited: r.edited,
            product: prodId,
            productName: prodDef?.name || prodId,
            cover: r.cover || null,
          });
        }
      } catch {}
    }
    return list.sort((a, b) => b.edited - a.edited);
  });

  ipcMain.handle("workspace:open", async (e, rootPath) => {
    if (!tabs || !rootPath) return false;
    const tabId = tabs.open(rootPath);
    return !!tabId;
  });

  ipcMain.handle("workspace:openInTab", async (_e, rootPath) => {
    if (!tabs || !rootPath) return false;
    const tabId = tabs.open(rootPath, { background: false });
    return !!tabId;
  });

  ipcMain.handle("workspace:choose", async (_e, productKind) => {
    if (!win || !tabs) return null;
    const res = await dialog.showOpenDialog(win, {
      title: productKind ? `Open ${productKind} folder` : "Open document folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const chosen = res.filePaths[0];
    const kind = detectProductKind(chosen);
    if (!kind) {
      await dialog.showMessageBox(win, {
        type: "info",
        message: "Unrecognized document format",
        detail: "This folder does not contain a Fenna Slides, Docs, Sheets, Whiteboard, or Design document.",
      });
      return null;
    }
    const h = getHost(kind);
    await h.rememberRecent(chosen).catch(() => {});
    tabs.open(chosen);
    return chosen;
  });

  ipcMain.handle("workspace:create", async (e, kind, title, _draft) => {
    if (!win || !tabs) return null;
    const prod = PRODUCTS.find((p) => p.id === kind) || PRODUCTS[0];
    const res = await dialog.showSaveDialog(win, {
      title: `Create new ${prod.kindName}`,
      defaultPath: title ? `${title}.${prod.noun}` : `Untitled ${prod.kindName}`,
      properties: ["showOverwriteConfirmation", "createDirectory"],
    });
    if (res.canceled || !res.filePath) return null;
    const targetDir = res.filePath;
    await fsp.mkdir(targetDir, { recursive: true });

    const files = starterFilesFor(kind, title || path.basename(targetDir));
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(targetDir, rel);
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, content, "utf8");
    }

    const h = getHost(kind);
    await h.rememberRecent(targetDir).catch(() => {});
    tabs.open(targetDir);
    return targetDir;
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  applyReviewTheme(nativeTheme);
  nativeTheme.on("updated", () => tabs?.applyTheme());

  hosts = createAllHosts(app.getPath("userData"));
  for (const h of Object.values(hosts)) {
    h.register({ getWin: () => win, getTabs: () => tabs, ipcMain, dialog, app, protocol, net });
  }

  registerShell({ assertSender: assertSenderAny, releases: "Sidhilynx/fenna" });
  registerAgent({ getRoot: rootOfAny, assertSender: assertSenderAny, profile: require("./assistant.cjs") });

  const loadExport = (name) => {
    const local = path.join(__dirname, "exports", `${name}.cjs`);
    if (fs.existsSync(local)) return require(local);
    const folder = {
      deckExport: "desktop",
      docExport: "docs",
      sheetExport: "sheets",
      boardExport: "whiteboard",
      designExport: "design",
    }[name] || name;
    return require(`../../../${folder}/src/main/export.cjs`);
  };

  // Register app-specific export handlers
  try {
    loadExport("deckExport").register({
      getWin: () => win,
      getDeckRoot: hosts.deck.rootOf,
      setRoot: hosts.deck.setRoot,
      preload: PRELOAD,
      load: (w, hash) => w.loadFile(getEditorHtmlPath("deck"), hash ? { hash } : undefined),
      assertSender: hosts.deck.assertSender,
      trust: hosts.deck.trust,
    });
  } catch {}

  try {
    loadExport("docExport").register({
      getWin: () => win,
      getRoot: hosts.doc.rootOf,
      setRoot: hosts.doc.setRoot,
      preload: PRELOAD,
      load: (w, hash) => w.loadFile(getEditorHtmlPath("doc"), hash ? { hash } : undefined),
      assertSender: hosts.doc.assertSender,
      trust: hosts.doc.trust,
    });
  } catch {}

  try {
    loadExport("sheetExport").register({
      getWin: () => win,
      assertSender: hosts.sheet.assertSender,
    });
  } catch {}

  try {
    loadExport("boardExport").register({
      getWin: () => win,
      assertSender: hosts.board.assertSender,
    });
  } catch {}

  try {
    loadExport("designExport").register({
      getWin: () => win,
      getRoot: hosts.design.rootOf,
      setRoot: hosts.design.setRoot,
      preload: PRELOAD,
      load: (w, hash) => w.loadFile(getEditorHtmlPath("design"), hash ? { hash } : undefined),
      assertSender: hosts.design.assertSender,
      trust: hosts.design.trust,
    });
  } catch {}

  registerWorkspaceIpc();

  const argFile = process.argv.find((a) => a.startsWith("--file="))?.slice(7);
  const initial = argFile || process.env.OPENDECK_WORKSPACE || null;
  const initialRoot = initial && fs.existsSync(initial) ? path.resolve(initial) : null;
  if (initialRoot) {
    const k = detectProductKind(initialRoot);
    if (k) await getHost(k).rememberRecent(initialRoot).catch(() => {});
  }
  createWindow(initialRoot);
});

app.on("window-all-closed", () => {
  if (hosts) {
    for (const h of Object.values(hosts)) h.closeAll();
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow(null);
});
