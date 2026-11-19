// Fenna Crew: the main process. One window over the crew; closing it keeps
// Crew running in the tray so bots wake on their schedules. Quit from the
// tray. "Open at login" starts it hidden in the tray.

const { app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, ipcMain, nativeImage, nativeTheme, net, protocol, safeStorage, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { PRELOAD, registerAssistantSetup, registerShell, applyReviewTheme } = require("@opendeck/shell/main");
const { createCrew } = require("./crew.cjs");
const { registerIpc } = require("./ipc.cjs");
const client = require("./client.cjs");
const { DEFAULTS, checkSettingsPatch, readStored } = require("./settings.cjs");
const { createNotifier } = require("./notify.cjs");
const { createSandbox } = require("./sandbox.cjs");
const { registerNoticesIpc } = require("./notices.cjs");
const { createEditors, editorSchemes } = require("./editors.cjs");
const F = require("./format.cjs");

/**
 * Connector secrets, sign-ins and the vault of logins, encrypted with the system's secure storage
 * (Windows DPAPI, macOS Keychain, a Linux keyring). Linux without a keyring
 * falls back to a fixed key, which is not secure, so it counts as
 * unavailable. The Sync pair is only for moving connectors out of an older
 * bot.md, which happens while bot.md is read and can't wait.
 */
const insecureLinux = () => process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text";
const secrets = {
  available: async () => (await safeStorage.isAsyncEncryptionAvailable()) && !insecureLinux(),
  encrypt: async (text) => (await safeStorage.encryptStringAsync(text)).toString("base64"),
  decrypt: async (data) => (await safeStorage.decryptStringAsync(Buffer.from(data, "base64"))).result,
  availableSync: () => safeStorage.isEncryptionAvailable() && !insecureLinux(),
  encryptSync: (text) => safeStorage.encryptString(text).toString("base64"),
};

const DEV_URL = process.env.OPENDECK_DEV_URL || null;
/** The header's height, which the window buttons (minimize, maximize, close) match; styles.css --head-h. */
const HEAD_H = 32;
const HIDDEN_ARG = "--hidden";
const ICON = path.join(__dirname, "..", "..", "build", "icon.png");
const TRAY_1X = path.join(__dirname, "..", "..", "build", "tray@16.png");
const TRAY_2X = path.join(__dirname, "..", "..", "build", "tray.png");

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
let quitting = false;
/** @type {ReturnType<typeof createCrew> | null} */
let crew = null;
/** @type {ReturnType<typeof createEditors> | null} */
let editors = null;
/** Runs the bots' scripts (`run` in their terminal), each in a sealed hidden window. */
let sandbox = null;

// Electron takes the privileged schemes in one call: the editors' asset schemes and the bots' disks (crewfile).
const PRIVILEGED = { standard: true, secure: true, supportFetchAPI: true, stream: true };
protocol.registerSchemesAsPrivileged([...editorSchemes(), "crewfile"].map((scheme) => ({ scheme, privileges: PRIVILEGED })));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  if (process.env.OPENDECK_SHOT) app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
  app.whenReady().then(start);
}

let stored = {};
function loadSettings() {
  try {
    const p = path.join(app.getPath("userData"), "settings.json");
    if (fs.existsSync(p)) stored = readStored(JSON.parse(fs.readFileSync(p, "utf8")));
  } catch (_) {
    stored = {};
  }
}
function saveSettings() {
  try {
    fs.writeFileSync(path.join(app.getPath("userData"), "settings.json"), JSON.stringify(stored, null, 2), "utf8");
  } catch (_) {}
}

const settings = {
  get() {
    loadSettings();
    const login = process.platform === "linux" ? { openAtLogin: false } : app.getLoginItemSettings({ args: [HIDDEN_ARG] });
    return {
      ...DEFAULTS,
      openAtLogin: !!login.openAtLogin,
      ...stored,
      storagePath: app.getPath("userData"),
      vaultEncrypted: safeStorage.isEncryptionAvailable(),
    };
  },
  set(patch) {
    const checked = checkSettingsPatch(patch);
    if ("openAtLogin" in checked) {
      if (process.platform === "linux") throw new Error("Open at login isn't available on Linux yet; add Fenna Crew to your desktop's startup apps.");
      app.setLoginItemSettings({ openAtLogin: checked.openAtLogin, openAsHidden: true, args: [HIDDEN_ARG] });
      delete checked.openAtLogin;
    }
    loadSettings();
    Object.assign(stored, checked);
    saveSettings();
    return settings.get();
  },
};

const attended = () => !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused();

/** A notification was clicked: show the window and send the page to that bot's chat. */
function openBot(slug) {
  showWindow();
  broadcast("crew:open", { slug });
}

const notifier = createNotifier({ Notification, enabled: () => settings.get().notifications !== false, attended, open: openBot });

const themeMode = () => (nativeTheme.shouldUseDarkColors ? "dark" : "light");

/** The shell's own channels (theme, updates) also answer the editors shown in a bot's computer. */
function assertShellSender(e) {
  if (editors && editors.isEditor(e.sender)) return;
  assertSender(e);
}

function assertSender(e) {
  if (!win || win.isDestroyed() || e.sender !== win.webContents) throw new Error("Not allowed from this page.");
  const url = e.senderFrame && e.senderFrame.url;
  const ours = DEV_URL ? url && url.startsWith(DEV_URL) : url && url.startsWith("file:");
  if (!ours) throw new Error("Not allowed from this page.");
}

function broadcast(channel, payload) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow({ show }) {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: "Fenna Crew",
    icon: ICON,
    backgroundColor: themeMode() === "dark" ? "#0e0e0e" : "#f7f7f6",
    titleBarStyle: "hidden",
    titleBarOverlay: process.platform === "darwin" ? undefined : { color: themeMode() === "dark" ? "#0a0a0a" : "#f7f7f6", symbolColor: "#a3a3a3", height: HEAD_H },
    trafficLightPosition: { x: 14, y: 11 },
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: true },
  });
  if (editors) editors.guard(win, PRELOAD);
  if (process.env.OPENDECK_SHOT_SIZE) {
    const [w, h] = process.env.OPENDECK_SHOT_SIZE.split("x").map(Number);
    if (w && h) win.setContentSize(w, h);
  }
  win.once("ready-to-show", () => {
    if (show) win.show();
  });
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  // A bot plays sound only while its computer is in a window the person can see.
  const seen = () => crew && crew.browsers.setHostVisible(win.isVisible() && !win.isMinimized());
  for (const ev of ["show", "hide", "minimize", "restore"]) win.on(ev, seen);
  const sender = win.webContents.id;
  win.webContents.on("destroyed", () => crew && crew.browsers.dropWatcher(sender));
  win.webContents.on("did-start-navigation", (_e, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace && crew) crew.browsers.dropWatcher(sender);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  if (process.env.OPENDECK_SHOT) captureAndQuit();
}

/** Review aid: the window as the person sees it, then quit (OPENDECK_SHOT, OPENDECK_SHOT_DELAY). */
function captureAndQuit() {
  const delay = Number(process.env.OPENDECK_SHOT_DELAY) || 3500;
  win.show();
  setTimeout(async () => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(process.env.OPENDECK_SHOT, img.toPNG());
    quit();
  }, delay);
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow({ show: true });
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function quit() {
  quitting = true;
  app.quit();
}

function createTray() {
  const image = nativeImage.createFromPath(TRAY_1X);
  image.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(TRAY_2X) });
  tray = new Tray(image);
  tray.setToolTip("Fenna Crew");
  const menu = () =>
    Menu.buildFromTemplate([
      { label: "Open Fenna Crew", click: showWindow },
      {
        label: "Open at login",
        type: "checkbox",
        checked: settings.get().openAtLogin,
        visible: process.platform !== "linux",
        click: (item) => {
          settings.set({ openAtLogin: item.checked });
          crew && crew.onChange();
        },
      },
      { type: "separator" },
      { label: "Quit Fenna Crew", click: quit },
    ]);
  tray.setContextMenu(menu());
  tray.on("click", showWindow);
  tray.on("right-click", () => tray.setContextMenu(menu()));
}

async function start() {
  Menu.setApplicationMenu(null);
  applyReviewTheme(nativeTheme);
  const repo = path.resolve(__dirname, "..", "..", "..", "..");
  crew = createCrew({
    root: process.env.OPENDECK_CREW_ROOT || path.join(app.getPath("userData"), "Crew"),
    userData: app.getPath("userData"),
    packaged: app.isPackaged,
    resources: process.resourcesPath,
    repo,
    broadcast,
    liveTarget: () => (win && !win.isDestroyed() && !win.webContents.isDestroyed() ? win.webContents.mainFrame : null),
    secrets,
    client,
    openExternal: (url) => (/^https?:\/\//i.test(url) ? shell.openExternal(url) : Promise.reject(new Error("The sign-in page isn't a web address."))),
    trash: (dir) => shell.trashItem(dir),
    settings: () => settings.get(),
    onNeeds: (waiting, offers) => notifier.check(waiting, offers),
    clipboard: { writeText: (t) => clipboard.writeText(t), readText: () => clipboard.readText() },
    sandbox: { run: (slug, o) => (sandbox ? sandbox.run(slug, o) : Promise.resolve({ out: "Scripts aren't available yet.", ok: false })) },
  });
  sandbox = createSandbox({ disk: crew.disk, BrowserWindow, session, ipcMain, preloadPath: path.join(__dirname, "sandbox-preload.cjs") });
  registerNoticesIpc({ ipcMain, assertSender, store: crew.store, watches: crew.watches, notices: crew.notices });
  editors = createEditors({ getWin: () => win, libraryDir: (slug) => path.join(crew.store.botDir(slug), "library"), userData: app.getPath("userData"), crew });
  editors.register({ ipcMain, dialog, app, protocol, net, preload: PRELOAD });
  ipcMain.handle("crew:editor", (e, slug, item, webContentsId) => {
    assertSender(e);
    if (!F.isSlug(slug) || !crew.store.readBot(slug)) throw new Error("That bot isn't there any more.");
    return editors.open(e.sender, slug, item, Number(webContentsId));
  });
  crew.disk.handleScheme(protocol);
  registerShell({ assertSender: assertShellSender, releases: "Sidhilynx/fenna" });
  registerAssistantSetup({ assertSender });
  registerIpc({
    ipcMain,
    assertSender,
    crew,
    disk: crew.disk,
    shell: crew.shell,
    search: crew.search,
    settings,
    reveal: async (target) => {
      if (fs.existsSync(target)) shell.showItemInFolder(target);
      else throw new Error("That file isn't there any more.");
    },
  });
  await crew.start();
  createTray();
  createWindow({ show: !process.argv.includes(HIDDEN_ARG) });
  nativeTheme.on("updated", () => {
    if (win && !win.isDestroyed() && process.platform !== "darwin") win.setTitleBarOverlay({ color: themeMode() === "dark" ? "#0a0a0a" : "#f7f7f6", symbolColor: "#a3a3a3", height: HEAD_H });
  });
}

app.on("before-quit", () => {
  quitting = true;
  if (sandbox) sandbox.stopAll();
  if (crew) crew.stop();
});

app.on("window-all-closed", () => {
  // Crew lives in the tray: closing the window doesn't quit.
});

app.on("activate", showWindow);
