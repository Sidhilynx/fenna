// The window's tabs: one strip view along the top (strip/strip.html, which is
// also the title bar) and one page view per tab under it. A tab is Home (no
// document yet) or a document folder (a deck, a doc, a sheet: whatever the
// app opens); a folder is open in one tab at most. Each page is the same app
// page, told which folder is its own by the app's main process, so tabs never
// share state.
//
// The top of this file is pure logic, tested without Electron; the TabHost
// class below does the wiring.

const fs = require("node:fs");
const path = require("node:path");

const STRIP_H = 36;
const MAX_TABS = 40;
const MAX_RECENT = 20;
const TITLE_MAX = 120;
const LABEL_MAX = 80;
const MAX_OVERLAY = 400;
const SAVE_DEBOUNCE_MS = 400;
const THUMB_WIDTH = 480;
const THUMB_MIN_GAP_MS = 2000;
const HOME_TITLE = "New tab";

/** The page's own background in each theme (styles.css --bg); the strip sits a step darker. */
const BAR = { dark: "#0e0e0e", light: "#f6f6f5" };
const SYMBOL = { dark: "#a3a3a3", light: "#161616" };
const STRIP_SHADE = { dark: 0.3, light: 0.065 };

// ── pure logic ───────────────────────────────────────────────────────────

/** Strips control characters, trims, clips to `max`. */
function clip(value, max) {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

/** The strip's colour: the page colour, a step darker, so the active tab reads as the front of its page. */
function stripColor(hex, mode) {
  const k = 1 - (STRIP_SHADE[mode] ?? STRIP_SHADE.dark);
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return hex;
  const ch = (v) => Math.round(v * k).toString(16).padStart(2, "0");
  return "#" + ch((n >> 16) & 255) + ch((n >> 8) & 255) + ch(n & 255);
}

/** What the strip shows as a tab's title. */
function displayTitle(t) {
  if (!t || !t.root) return HOME_TITLE;
  return clip(t.title, TITLE_MAX) || path.basename(t.root) || "Deck";
}

/** idle, working (the assistant runs), or done (it finished while the tab was in the back). */
function deriveState(t) {
  if (t.working) return "working";
  if (t.done) return "done";
  return "idle";
}

/** Where a new tab goes: right after `afterIndex`, else at the end. */
function insertIndex(length, afterIndex) {
  return Number.isInteger(afterIndex) && afterIndex >= 0 ? Math.min(length, afterIndex + 1) : length;
}

/** The index that becomes active after the tab at `closedIndex` leaves `lengthAfter` tabs: the right neighbour, else the left. */
function indexAfterClose(closedIndex, lengthAfter) {
  if (lengthAfter <= 0) return -1;
  return Math.min(closedIndex, lengthAfter - 1);
}

/** Another tab (not `exceptId`) that has this deck open, or null. */
function findDeckTab(tabs, root, exceptId) {
  if (!root) return null;
  const want = path.resolve(root).toLowerCase();
  return tabs.find((t) => t.id !== exceptId && t.root && path.resolve(t.root).toLowerCase() === want) || null;
}

/**
 * tabs.json (text or parsed) as { tabs: [{ root }], activeIndex }: garbage gives
 * no tabs, a deck listed twice keeps its first tab, `exists` drops decks whose
 * folder is gone.
 */
function parseTabsFile(raw, { exists = () => true, maxTabs = MAX_TABS } = {}) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.tabs)) return { tabs: [], activeIndex: 0 };
  const wanted = Number.isInteger(data.activeIndex) ? data.activeIndex : 0;
  const out = [];
  let activeIndex = 0;
  data.tabs.slice(0, maxTabs * 2).forEach((e, i) => {
    if (out.length >= maxTabs || !e || typeof e !== "object") return;
    const root = typeof e.root === "string" && e.root.length < 1024 ? e.root : null;
    if (root && (!exists(root) || findDeckTab(out, root, null))) return;
    if (i === wanted) activeIndex = out.length;
    out.push({ root, title: clip(e.title, TITLE_MAX) });
  });
  return { tabs: out, activeIndex };
}

/** Bounds of the strip and the page views for a window content size (the strip grows for its hover card). */
function layoutBounds(width, height, overlay = 0) {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const extra = Math.max(0, Math.min(MAX_OVERLAY, Math.floor(overlay) || 0));
  return {
    strip: { x: 0, y: 0, width: w, height: STRIP_H + extra },
    page: { x: 0, y: STRIP_H, width: w, height: Math.max(0, h - STRIP_H) },
  };
}

/** The tab shortcut in a before-input-event, or null. Cmd on macOS, Ctrl elsewhere; cycling uses Ctrl everywhere. */
function shortcutAction(input, platform) {
  if (!input || input.type !== "keyDown" || input.alt) return null;
  const mac = platform === "darwin";
  const mod = mac ? input.meta : input.control;
  const key = String(input.key || "");
  const lower = key.toLowerCase();
  if (input.control && !input.meta) {
    if (key === "Tab") return { type: input.shift ? "prev" : "next" };
    if (key === "PageDown" && !input.shift) return { type: "next" };
    if (key === "PageUp" && !input.shift) return { type: "prev" };
  }
  if (!mod) return null;
  if (lower === "t") return { type: input.shift ? "reopen" : "new" };
  if (lower === "w" && !input.shift) return { type: "close" };
  if (mac && input.shift && (key === "]" || key === "}")) return { type: "next" };
  if (mac && input.shift && (key === "[" || key === "{")) return { type: "prev" };
  if (!input.shift && /^[1-9]$/.test(key)) return key === "9" ? { type: "last" } : { type: "index", index: Number(key) - 1 };
  return null;
}

// ── the host ─────────────────────────────────────────────────────────────

class TabHost {
  /**
   * @param {object} o
   * @param {Electron.BrowserWindow} o.window
   * @param {string} o.preload             the page preload
   * @param {string} o.userDataDir
   * @param {(wc: Electron.WebContents) => void} o.load        load the editor page into a view
   * @param {(wc: Electron.WebContents, root: string|null) => void} o.setRoot   give a page its deck
   * @param {(wc: Electron.WebContents) => () => void} o.trust allow a page the file API
   * @param {() => "dark"|"light"} o.themeMode
   * @param {{ name: string, kind: string, kindName: string, marker: string }} o.product
   *        the app ("Fenna Slides", shown in the title bar), what its documents are ("deck", "Deck") and the file that marks one ("deck.json")
   */
  constructor(o) {
    this.o = o;
    this.window = o.window;
    this.tabs = [];
    this.activeId = null;
    this.recent = [];
    this.byWc = new Map();
    this.seq = 0;
    this.overlay = 0;
    this.stripView = null;
    this.stripReady = false;
    this.pushTimer = null;
    this.saveTimer = null;
    this.lastThumbAt = 0;
    this.disposed = false;
    this.ipc = [];
  }

  // ── lifecycle ──
  start(initialRoot) {
    const { WebContentsView } = require("electron");
    const win = this.window;
    this.stripView = new WebContentsView({
      webPreferences: { preload: path.join(__dirname, "strip", "stripPreload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
    });
    this.stripView.setBackgroundColor("#00000000");
    win.contentView.addChildView(this.stripView);
    const swc = this.stripView.webContents;
    swc.setWindowOpenHandler(() => ({ action: "deny" }));
    swc.on("will-navigate", (e) => e.preventDefault());
    swc.on("before-input-event", (event, input) => this.onShortcut(event, input));
    void swc.loadFile(path.join(__dirname, "strip", "strip.html")).catch(() => {});

    this.registerIpc();
    this.layout();
    this.applyTheme();
    for (const name of ["resize", "maximize", "unmaximize", "restore", "enter-full-screen", "leave-full-screen", "focus", "blur"]) {
      win.on(name, () => {
        this.layout();
        this.emit();
      });
    }
    win.on("closed", () => this.dispose());
    this.restore(initialRoot);
  }

  dispose() {
    if (this.disposed) return;
    this.saveNow();
    this.disposed = true;
    clearTimeout(this.pushTimer);
    clearTimeout(this.saveTimer);
    const { ipcMain } = require("electron");
    for (const [kind, channel, fn] of this.ipc) {
      if (kind === "on") ipcMain.removeListener(channel, fn);
      else ipcMain.removeHandler(channel);
    }
    this.ipc = [];
  }

  // ── lookups ──
  active() {
    return this.tabs.find((t) => t.id === this.activeId) || null;
  }
  activeContents() {
    const t = this.active();
    return t && t.wc && !t.wc.isDestroyed() ? t.wc : null;
  }
  stripContents() {
    return this.stripView && !this.stripView.webContents.isDestroyed() ? this.stripView.webContents : null;
  }
  byId(id) {
    return this.tabs.find((t) => t.id === id) || null;
  }
  byContents(wc) {
    return wc ? this.byWc.get(wc.id) || null : null;
  }
  /** Every live page that has `root` open. */
  pagesWithRoot(root) {
    const want = path.resolve(root).toLowerCase();
    return this.tabs.filter((t) => t.root && t.wc && !t.wc.isDestroyed() && path.resolve(t.root).toLowerCase() === want).map((t) => t.wc);
  }

  // ── layout + theme ──
  layout() {
    if (this.disposed || this.window.isDestroyed()) return;
    const [w, h] = this.window.getContentSize();
    const b = layoutBounds(w, h, this.overlay);
    this.stripView.setBounds(b.strip);
    for (const t of this.tabs) if (t.view) t.view.setBounds(b.page);
  }

  applyTheme() {
    if (this.disposed || this.window.isDestroyed()) return;
    const mode = this.o.themeMode();
    const bar = BAR[mode];
    try {
      this.window.setBackgroundColor(bar);
      if (process.platform !== "darwin") this.window.setTitleBarOverlay({ color: stripColor(bar, mode), symbolColor: SYMBOL[mode], height: STRIP_H });
    } catch {
      /* a window without an overlay */
    }
    this.emit();
  }

  focusActive() {
    const wc = this.activeContents();
    if (wc && !this.window.isDestroyed() && this.window.isFocused()) wc.focus();
  }

  // ── opening ──
  /** Opens a tab on `root` (null: Home), or shows the tab that has it. Returns the tab's id. */
  open(root, { background = false, index, title } = {}) {
    const existing = findDeckTab(this.tabs, root, null);
    if (existing) {
      if (!background) this.activate(existing.id);
      return existing.id;
    }
    const tab = this.newTab(root, title);
    const afterIdx = this.tabs.findIndex((t) => t.id === this.activeId);
    const at = Number.isInteger(index) ? Math.max(0, Math.min(this.tabs.length, index)) : insertIndex(this.tabs.length, afterIdx);
    this.tabs.splice(at, 0, tab);
    this.attach(tab, !background);
    if (!background) this.activate(tab.id);
    this.emit();
    this.scheduleSave();
    return tab.id;
  }

  newTab(root, title) {
    this.seq += 1;
    return { id: `t${this.seq}${Math.random().toString(36).slice(2, 6)}`, root: root || null, title: clip(title, TITLE_MAX), view: null, wc: null, untrust: null, loading: true, working: false, done: false, label: null, thumb: null };
  }

  attach(tab, visible) {
    const { WebContentsView } = require("electron");
    const view = new WebContentsView({ webPreferences: { preload: this.o.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true } });
    view.setBackgroundColor(BAR[this.o.themeMode()]);
    tab.view = view;
    tab.wc = view.webContents;
    this.byWc.set(tab.wc.id, tab);
    tab.untrust = this.o.trust(tab.wc);
    this.o.setRoot(tab.wc, tab.root);
    this.wire(tab);
    this.window.contentView.addChildView(view, 0);
    const [w, h] = this.window.getContentSize();
    view.setBounds(layoutBounds(w, h, this.overlay).page);
    view.setVisible(!!visible);
    this.o.load(tab.wc);
  }

  wire(tab) {
    const wc = tab.wc;
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) require("electron").shell.openExternal(url);
      return { action: "deny" };
    });
    wc.on("will-navigate", (ev, url) => {
      if (process.env.OPENDECK_DEV_URL && url.startsWith(process.env.OPENDECK_DEV_URL)) return;
      ev.preventDefault();
      if (/^https?:\/\//.test(url)) require("electron").shell.openExternal(url);
    });
    wc.on("did-start-loading", () => {
      tab.loading = true;
      this.emit();
    });
    wc.on("did-stop-loading", () => {
      tab.loading = false;
      this.emit();
    });
    wc.on("before-input-event", (event, input) => this.onShortcut(event, input));
    wc.on("render-process-gone", (_e, details) => {
      if (details && details.reason !== "clean-exit" && !wc.isDestroyed()) wc.reload();
    });
  }

  /** A page opened a deck in its own tab (or went back to Home with null). */
  setRoot(wc, root, title) {
    const tab = this.byContents(wc);
    if (!tab) return;
    tab.root = root || null;
    tab.title = clip(title, TITLE_MAX);
    this.emit();
    this.scheduleSave();
    this.updateWindowTitle();
  }

  // ── activate, page reports ──
  activate(id) {
    const next = this.byId(id);
    if (!next) return;
    const prev = this.active();
    if (prev && prev !== next && prev.view) prev.view.setVisible(false);
    this.activeId = next.id;
    next.done = false;
    if (next.view) next.view.setVisible(true);
    else this.attach(next, true);
    this.updateWindowTitle();
    this.emit();
    this.scheduleSave();
  }

  onMeta(tab, meta) {
    const title = clip(meta && meta.title, TITLE_MAX);
    if (title && title !== tab.title) {
      tab.title = title;
      this.emit();
      this.scheduleSave();
      this.updateWindowTitle();
    }
  }

  onActivity(tab, activity) {
    const working = !!(activity && activity.working);
    const label = clip(activity && activity.label, LABEL_MAX) || null;
    if (tab.working && !working && tab.id !== this.activeId) tab.done = true;
    tab.working = working;
    tab.label = label;
    this.emit();
  }

  async captureActive() {
    const tab = this.active();
    const now = Date.now();
    if (!tab || !tab.wc || tab.wc.isDestroyed() || tab.loading || now - this.lastThumbAt < THUMB_MIN_GAP_MS) return;
    this.lastThumbAt = now;
    try {
      const img = await tab.wc.capturePage();
      if (!img.isEmpty()) tab.thumb = `data:image/jpeg;base64,${img.resize({ width: THUMB_WIDTH, quality: "good" }).toJPEG(70).toString("base64")}`;
    } catch {
      /* keep the older thumbnail */
    }
  }

  updateWindowTitle() {
    if (this.disposed || this.window.isDestroyed()) return;
    const t = this.active();
    this.window.setTitle(`${t ? displayTitle(t) : HOME_TITLE} — ${this.o.product.name}`);
  }

  // ── closing, moving ──
  close(id) {
    const tab = this.byId(id);
    if (!tab) return;
    // The window always keeps a tab: closing the only one leaves a Home tab (a lone Home stays as it is).
    if (this.tabs.length === 1) {
      if (!tab.root) return;
      this.open(null);
    }
    this.remove(tab);
  }

  remove(tab) {
    const idx = this.tabs.indexOf(tab);
    if (idx < 0) return;
    if (tab.root) {
      this.recent = [{ root: tab.root, title: tab.title, index: idx }, ...this.recent.filter((r) => r.root !== tab.root)].slice(0, MAX_RECENT);
    }
    this.tabs.splice(idx, 1);
    const wasActive = tab.id === this.activeId;
    if (tab.wc) {
      this.byWc.delete(tab.wc.id);
      this.o.setRoot(tab.wc, null);
      tab.untrust();
    }
    if (tab.view) {
      try {
        this.window.contentView.removeChildView(tab.view);
      } catch {
        /* already gone */
      }
      try {
        if (!tab.wc.isDestroyed()) tab.wc.close();
      } catch {
        /* already gone */
      }
    }
    if (wasActive) {
      this.activeId = null;
      this.activate(this.tabs[indexAfterClose(idx, this.tabs.length)].id);
    } else {
      this.emit();
      this.scheduleSave();
    }
  }

  closeOthers(id) {
    for (const t of [...this.tabs]) if (t.id !== id) this.close(t.id);
  }
  closeToRight(id) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    for (const t of this.tabs.slice(idx + 1)) this.close(t.id);
  }
  reopen(entry) {
    const e = entry || this.recent[0];
    if (!e) return;
    this.recent = this.recent.filter((r) => r !== e);
    if (fs.existsSync(e.root)) this.open(e.root, { index: e.index, title: e.title });
  }
  move(id, toIndex) {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(this.tabs.length - 1, Math.trunc(Number(toIndex)) || 0));
    if (to === from) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, tab);
    this.emit();
    this.scheduleSave();
  }
  step(delta) {
    if (this.tabs.length < 2) return;
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    const n = this.tabs.length;
    this.activate(this.tabs[(i + delta + n) % n].id);
  }

  onShortcut(event, input) {
    const a = shortcutAction(input, process.platform);
    if (!a) return;
    event.preventDefault();
    if (a.type === "new") this.open(null);
    else if (a.type === "reopen") this.reopen();
    else if (a.type === "next") this.step(1);
    else if (a.type === "prev") this.step(-1);
    else if (a.type === "last") this.activate(this.tabs[this.tabs.length - 1].id);
    else if (a.type === "index" && this.tabs[a.index]) this.activate(this.tabs[a.index].id);
    else if (a.type === "close" && this.activeId) this.close(this.activeId);
    this.focusActive();
  }

  // ── strip state ──
  stripState() {
    const win = this.window;
    const alive = !win.isDestroyed();
    const mode = this.o.themeMode();
    return {
      platform: process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux",
      theme: { mode, bar: BAR[mode], strip: stripColor(BAR[mode], mode) },
      focused: alive ? win.isFocused() : false,
      fullscreen: alive ? win.isFullScreen() : false,
      activeId: this.activeId || "",
      tabs: this.tabs.map((t) => ({ id: t.id, title: displayTitle(t), kind: t.root ? this.o.product.kind : "home", kindName: t.root ? this.o.product.kindName : HOME_TITLE, loading: t.loading, state: deriveState(t), label: t.label, path: t.root || "" })),
    };
  }

  /** Coalesced to one push per frame. */
  emit() {
    if (this.disposed || this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.pushNow();
    }, 16);
  }
  pushNow() {
    const wc = this.stripContents();
    if (!this.disposed && this.stripReady && wc) wc.send("strip:state", this.stripState());
  }

  // ── persistence ──
  file() {
    return path.join(this.o.userDataDir, "tabs.json");
  }
  scheduleSave() {
    if (this.disposed) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), SAVE_DEBOUNCE_MS);
  }
  saveNow() {
    if (this.disposed) return;
    try {
      const data = { tabs: this.tabs.map((t) => ({ root: t.root, title: t.title })), activeIndex: Math.max(0, this.tabs.findIndex((t) => t.id === this.activeId)) };
      const tmp = `${this.file()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, this.file());
    } catch {
      /* a read-only profile: tabs just aren't remembered */
    }
  }
  /** The tabs from last time; a deck asked for at launch opens (or shows) on top of them. */
  restore(initialRoot) {
    let raw = null;
    try {
      raw = fs.readFileSync(this.file(), "utf8");
    } catch {
      /* first run */
    }
    const parsed = parseTabsFile(raw, { exists: (p) => fs.existsSync(p) });
    for (const e of parsed.tabs) {
      const tab = this.newTab(e.root, e.title);
      this.tabs.push(tab);
    }
    const first = this.tabs[parsed.activeIndex];
    if (initialRoot) this.open(initialRoot);
    else if (first) {
      this.attach(first, true);
      this.activate(first.id);
    } else this.open(null);
    // The rest load behind the active one.
    for (const t of this.tabs) if (!t.view) this.attach(t, false);
  }

  // ── IPC ──
  registerIpc() {
    const { ipcMain } = require("electron");
    const on = (channel, fn) => {
      const g = (...args) => {
        try {
          fn(...args);
        } catch (err) {
          console.error(`[tabs] ${channel} failed:`, err);
        }
      };
      ipcMain.on(channel, g);
      this.ipc.push(["on", channel, g]);
    };
    const fromStrip = (fn) => (event, ...args) => {
      if (event.sender === this.stripContents()) fn(...args);
    };
    const str = (v) => (typeof v === "string" ? v : "");
    const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

    on("tabs:meta", (event, meta) => {
      const tab = this.byContents(event.sender);
      if (tab) this.onMeta(tab, meta);
    });
    on("tabs:activity", (event, activity) => {
      const tab = this.byContents(event.sender);
      if (tab) this.onActivity(tab, activity);
    });
    on("tabs:open", (event, root) => {
      if (this.byContents(event.sender) && typeof root === "string") this.open(root);
    });

    on("strip:ready", fromStrip(() => ((this.stripReady = true), this.pushNow())));
    on("strip:activate", fromStrip((id) => this.activate(str(id))));
    on("strip:focus-page", fromStrip(() => this.focusActive()));
    on("strip:prefetch", fromStrip(() => void this.captureActive()));
    on("strip:close", fromStrip((id) => this.close(str(id))));
    on("strip:new", fromStrip(() => this.open(null)));
    on("strip:move", fromStrip((id, to) => this.move(str(id), num(to))));
    on("strip:menu", fromStrip((id, x, y) => this.showTabMenu(str(id), num(x), num(y))));
    on("strip:list-menu", fromStrip((x, y) => this.showListMenu(num(x), num(y))));
    on("strip:home", fromStrip(() => {
      const home = this.tabs.find((t) => !t.root);
      if (home) this.activate(home.id);
      else this.open(null);
    }));
    on("strip:overlay", fromStrip((px) => {
      this.overlay = Math.max(0, Math.min(MAX_OVERLAY, num(px)));
      this.layout();
    }));
    on("strip:dblclick", fromStrip(() => (this.window.isMaximized() ? this.window.unmaximize() : this.window.maximize())));
    ipcMain.handle("strip:preview", (event, id) => {
      if (event.sender !== this.stripContents()) return { thumb: null };
      const t = this.byId(str(id));
      return { thumb: t && t.thumb ? t.thumb : null };
    });
    this.ipc.push(["handle", "strip:preview", null]);
  }

  // ── native menus ──
  showTabMenu(id, x, y) {
    const tab = this.byId(id);
    if (!tab) return;
    const { Menu, shell } = require("electron");
    const idx = this.tabs.indexOf(tab);
    Menu.buildFromTemplate([
      { label: "New tab to the right", click: () => this.open(null, { index: idx + 1 }) },
      { label: "Reload", click: () => tab.wc && !tab.wc.isDestroyed() && tab.wc.reload() },
      ...(tab.root ? [{ label: "Show in folder", click: () => shell.showItemInFolder(path.join(tab.root, this.o.product.marker)) }] : []),
      { type: "separator" },
      { label: "Close", click: () => this.close(tab.id) },
      { label: "Close other tabs", enabled: this.tabs.length > 1, click: () => this.closeOthers(tab.id) },
      { label: "Close tabs to the right", enabled: idx < this.tabs.length - 1, click: () => this.closeToRight(tab.id) },
      { type: "separator" },
      { label: "Reopen closed tab", enabled: this.recent.length > 0, click: () => this.reopen() },
    ]).popup({ window: this.window, x, y });
  }

  showListMenu(x, y) {
    const { Menu } = require("electron");
    const recent = this.recent.slice(0, 10).map((r) => ({ label: clip(r.title, 60) || path.basename(r.root), click: () => this.reopen(r) }));
    Menu.buildFromTemplate([
      ...this.tabs.map((t) => ({ label: clip(displayTitle(t), 60), type: "checkbox", checked: t.id === this.activeId, click: () => this.activate(t.id) })),
      { type: "separator" },
      { label: "Recently closed", enabled: recent.length > 0, submenu: recent.length ? recent : [{ label: "None", enabled: false }] },
    ]).popup({ window: this.window, x, y });
  }
}

module.exports = { TabHost, STRIP_H, clip, stripColor, displayTitle, deriveState, insertIndex, indexAfterClose, findDeckTab, parseTabsFile, layoutBounds, shortcutAction };
