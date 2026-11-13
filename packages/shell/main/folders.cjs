// The open document folders, shared by every app on the shell.
//
// Each tab is a page with at most one document folder open (a deck, a doc),
// and each page gets a deliberately narrow file API: read, list and write
// paths INSIDE its own folder that the app's patterns allow, nothing else.
// Every open folder is watched so that edits from anywhere (the user's
// editor, git, the AI through the app's MCP server) reach the pages showing
// it within ~100 ms, and its assets are served on <scheme>://<token>/.
//
// The app names its channels' prefix ("deck" → deck:read, deck:changed …),
// which files a page may touch, and how a recent folder is described on Home.

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MAX_WRITE = 2 * 1024 * 1024;
const MAX_ASSET = 50 * 1024 * 1024;
const RECENT_MAX = 12;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|avif)$/i;
const ASSET_RE = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

const keyOf = (root) => path.resolve(root).toLowerCase();
const tokenOf = (root) => crypto.createHash("sha1").update(keyOf(root)).digest("hex").slice(0, 16);

/** Call before the app is ready: the asset scheme must be privileged to load in pages. */
function registerAssetScheme(protocol, scheme) {
  protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
}

/**
 * @param {object} o
 * @param {string} o.prefix          channel prefix: "deck" gives deck:read, deck:changed …
 * @param {string} o.scheme          the asset scheme, registered with registerAssetScheme
 * @param {RegExp} o.files           paths (relative, "/"-separated) a page may read and write; assets/ is always readable, written only by import
 * @param {RegExp} o.dirs            folders a page may list
 * @param {(rel: string) => boolean} o.removable  files a page may delete
 * @param {string[]} o.newFolders    subfolders a new document starts with
 * @param {{ open: string, create: string, untitled: string }} o.words   dialog titles and the default new name
 * @param {(root: string) => Promise<{ title: string } & Record<string, unknown> | null>} o.describe
 *        a recent folder as Home lists it (null: it isn't one of the app's documents any more)
 * @param {string} o.userDataDir
 * @param {number} [o.maxWrite]      the largest file a page may write, in characters (default 2 MB)
 */
function createFolderHost(o) {
  const maxWrite = o.maxWrite ?? MAX_WRITE;
  /** webContents id → the folder that page has open. */
  const roots = new Map();
  /** asset token → folder, for asset requests. */
  const assetRoots = new Map();
  /** folder (lower-cased) → its watcher and how many pages use it. */
  const watchers = new Map();
  /** Pages allowed to use the file API: the tabs and the app's own hidden windows. */
  const trusted = new Set();

  const rootOf = (sender) => (sender ? roots.get(sender.id) || null : null);
  const refOf = (root) => ({ root, name: path.basename(root), asset: `${o.scheme}://${tokenOf(root)}/` });

  /** Pages showing this folder. */
  function pagesWith(root) {
    const { webContents } = require("electron");
    const key = keyOf(root);
    const out = [];
    for (const [id, r] of roots) {
      if (keyOf(r) !== key) continue;
      const wc = webContents.fromId(id);
      if (wc && !wc.isDestroyed()) out.push(wc);
    }
    return out;
  }

  function watch(root) {
    const key = keyOf(root);
    const w = watchers.get(key);
    if (w) {
      w.count += 1;
      return;
    }
    const pending = new Set();
    let timer = null;
    let watcher = null;
    try {
      watcher = fs.watch(root, { recursive: true }, (_type, file) => {
        if (!file) return;
        const rel = String(file).split(path.sep).join("/");
        if (!o.files.test(rel)) return;
        pending.add(rel);
        clearTimeout(timer);
        timer = setTimeout(() => {
          const changed = [...pending];
          pending.clear();
          for (const wc of pagesWith(root)) wc.send(`${o.prefix}:changed`, changed);
        }, 60);
      });
    } catch (e) {
      console.error("watch failed", e);
    }
    watchers.set(key, { watcher, count: 1 });
  }

  function unwatch(root) {
    const key = keyOf(root);
    const w = watchers.get(key);
    if (!w) return;
    w.count -= 1;
    if (w.count > 0) return;
    w.watcher?.close();
    watchers.delete(key);
  }

  /** Give a page its folder (or none). */
  function setRoot(wc, root) {
    const prev = roots.get(wc.id);
    if (prev && root && keyOf(prev) === keyOf(root)) return;
    if (prev) unwatch(prev);
    if (root) {
      const full = path.resolve(root);
      roots.set(wc.id, full);
      assetRoots.set(tokenOf(full), full);
      watch(full);
    } else roots.delete(wc.id);
  }

  function resolveIn(root, rel) {
    if (!root || typeof rel !== "string" || !(o.files.test(rel) || ASSET_RE.test(rel))) return null;
    const full = path.resolve(root, rel);
    return full.startsWith(path.resolve(root) + path.sep) ? full : null;
  }

  function trust(wc) {
    trusted.add(wc);
    const id = wc.id;
    wc.once("destroyed", () => {
      trusted.delete(wc);
      const r = roots.get(id);
      if (r) {
        roots.delete(id);
        unwatch(r);
      }
    });
    return () => trusted.delete(wc);
  }

  function assertSender(event) {
    if (!trusted.has(event.sender)) throw new Error("not allowed");
  }

  // ── Recent folders ──
  const recentFile = () => path.join(o.userDataDir, "recent.json");
  async function readRecent() {
    try {
      const list = JSON.parse(await fsp.readFile(recentFile(), "utf8"));
      return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
    } catch {
      return [];
    }
  }
  async function rememberRecent(dir) {
    const list = [dir, ...(await readRecent()).filter((p) => keyOf(p) !== keyOf(dir))].slice(0, RECENT_MAX);
    await fsp.writeFile(recentFile(), JSON.stringify(list));
  }
  const isRecent = async (dir) => typeof dir === "string" && (await readRecent()).some((p) => keyOf(p) === keyOf(dir));

  /** Images come into the folder as copies in assets/, under a safe unique name. */
  async function storeAsset(root, name, bytes) {
    if (!root) throw new Error("nothing is open");
    const ext = (path.extname(name).toLowerCase().match(IMAGE_EXT) || [".png"])[0];
    const stem = path.basename(name, path.extname(name)).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 60) || "image";
    const dir = path.join(root, "assets");
    await fsp.mkdir(dir, { recursive: true });
    let file = `${stem}${ext}`;
    for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = `${stem}-${i}${ext}`;
    await fsp.writeFile(path.join(dir, file), bytes);
    return `assets/${file}`;
  }

  /**
   * The page-facing API, and the asset scheme's handler.
   * @param {{ getWin: () => Electron.BrowserWindow|null, getTabs: () => any, ipcMain: Electron.IpcMain, dialog: Electron.Dialog, app: Electron.App, protocol: Electron.Protocol, net: Electron.Net }} e
   */
  function register({ getWin, getTabs, ipcMain, dialog, app, protocol, net }) {
    const p = o.prefix;

    /** Open `dir` in the page that asked; if another tab has it open, show that tab instead (and return null). */
    async function openFolder(sender, dir) {
      const stat = await fsp.stat(dir).catch(() => null);
      if (!stat?.isDirectory()) throw new Error(`${dir} is not a folder`);
      const root = path.resolve(dir);
      const tabs = getTabs();
      const other = tabs?.tabs.find((t) => t.root && keyOf(t.root) === keyOf(root) && t.wc !== sender);
      await rememberRecent(root).catch(() => {});
      app.addRecentDocument?.(root);
      if (other) {
        tabs.activate(other.id);
        return null;
      }
      setRoot(sender, root);
      const info = await o.describe(root).catch(() => null);
      tabs?.setRoot(sender, root, info?.title ?? path.basename(root));
      return refOf(root);
    }

    ipcMain.handle(`${p}:current`, (e) => {
      assertSender(e);
      const root = rootOf(e.sender);
      return root ? refOf(root) : null;
    });
    ipcMain.handle(`${p}:choose`, async (e) => {
      assertSender(e);
      const r = await dialog.showOpenDialog(getWin(), { title: o.words.open, properties: ["openDirectory", "createDirectory"] });
      if (r.canceled || !r.filePaths[0]) return null;
      return openFolder(e.sender, r.filePaths[0]);
    });
    ipcMain.handle(`${p}:recent`, async (e) => {
      assertSender(e);
      const out = [];
      for (const dir of await readRecent()) {
        const d = await o.describe(dir).catch(() => null);
        if (d) out.push({ root: dir, name: path.basename(dir), ...d });
      }
      return out;
    });
    // Only folders the user opened before (from the recent list): the page can't open arbitrary paths.
    ipcMain.handle(`${p}:openPath`, async (e, dir) => {
      assertSender(e);
      if (!(await isRecent(dir))) throw new Error("refused");
      return openFolder(e.sender, dir);
    });
    ipcMain.handle(`${p}:openInTab`, async (e, dir) => {
      assertSender(e);
      if (!(await isRecent(dir))) throw new Error("refused");
      getTabs()?.open(path.resolve(dir));
      return true;
    });
    // A new document: the user picks where and what to call it; the page supplies the starter files.
    ipcMain.handle(`${p}:create`, async (e, title, files) => {
      assertSender(e);
      if (typeof title !== "string" || !files || typeof files !== "object") throw new Error("refused");
      const name = title.replace(/[\\/:*?"<>|]+/g, " ").trim() || o.words.untitled;
      const r = await dialog.showSaveDialog(getWin(), { title: o.words.create, buttonLabel: "Create", defaultPath: path.join(app.getPath("documents"), name), properties: ["createDirectory", "showOverwriteConfirmation"] });
      if (r.canceled || !r.filePath) return null;
      const dir = r.filePath;
      const existing = await fsp.readdir(dir).catch(() => null);
      if (existing && existing.length) throw new Error("That folder isn’t empty. Pick a new name.");
      for (const sub of o.newFolders) await fsp.mkdir(path.join(dir, sub), { recursive: true });
      for (const [rel, text] of Object.entries(files)) {
        if (!o.files.test(rel) || typeof text !== "string" || text.length > maxWrite) throw new Error("refused");
        await fsp.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
        await fsp.writeFile(path.join(dir, rel), text, "utf8");
      }
      return openFolder(e.sender, dir);
    });
    ipcMain.handle(`${p}:read`, async (e, rel) => {
      assertSender(e);
      const full = resolveIn(rootOf(e.sender), rel);
      if (!full) return null;
      return fsp.readFile(full, "utf8").catch(() => null);
    });
    ipcMain.handle(`${p}:list`, async (e, dir) => {
      assertSender(e);
      const root = rootOf(e.sender);
      if (!root || typeof dir !== "string" || !o.dirs.test(dir)) return [];
      return fsp.readdir(path.join(root, dir)).catch(() => []);
    });
    ipcMain.handle(`${p}:write`, async (e, rel, text) => {
      assertSender(e);
      const full = resolveIn(rootOf(e.sender), rel);
      if (!full || !o.files.test(rel) || typeof text !== "string" || text.length > maxWrite || rel.startsWith("assets/")) throw new Error("refused");
      await fsp.mkdir(path.dirname(full), { recursive: true });
      // Write-then-rename so a reader (the watcher, the MCP server) never sees half a file.
      const tmp = `${full}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, text, "utf8");
      await fsp.rename(tmp, full);
      return true;
    });
    ipcMain.handle(`${p}:remove`, async (e, rel) => {
      assertSender(e);
      const full = resolveIn(rootOf(e.sender), rel);
      if (!full || !o.files.test(rel) || !o.removable(rel)) throw new Error("refused");
      await fsp.rm(full, { force: true });
      return true;
    });
    ipcMain.handle(`${p}:pickImages`, async (e) => {
      assertSender(e);
      const root = rootOf(e.sender);
      const r = await dialog.showOpenDialog(getWin(), { title: "Insert image", properties: ["openFile", "multiSelections"], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"] }] });
      if (r.canceled) return [];
      const out = [];
      for (const f of r.filePaths) {
        const st = await fsp.stat(f);
        if (st.size > MAX_ASSET || !IMAGE_EXT.test(f)) continue;
        out.push(await storeAsset(root, path.basename(f), await fsp.readFile(f)));
      }
      return out;
    });
    ipcMain.handle(`${p}:importAsset`, async (e, name, bytes) => {
      assertSender(e);
      if (typeof name !== "string" || !(bytes instanceof Uint8Array) || bytes.length > MAX_ASSET) throw new Error("refused");
      return storeAsset(rootOf(e.sender), name, Buffer.from(bytes));
    });

    protocol.handle(o.scheme, (req) => {
      const url = new URL(req.url);
      const root = assetRoots.get(url.hostname);
      const rel = decodeURIComponent(url.pathname.replace(/^\//, ""));
      const full = root && ASSET_RE.test(rel) ? resolveIn(root, rel) : null;
      if (!full) return new Response("not found", { status: 404 });
      return net.fetch(pathToFileURL(full).toString());
    });
  }

  function closeAll() {
    for (const w of watchers.values()) w.watcher?.close();
    watchers.clear();
  }

  return { rootOf, refOf, setRoot, trust, assertSender, resolveIn, rememberRecent, register, closeAll };
}

module.exports = { createFolderHost, registerAssetScheme, keyOf };
