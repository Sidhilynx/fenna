// Each bot's own browser: offscreen windows (one per tab) in the bot's own
// persistent session (persist:crew-<slug>), so sign-ins stay between runs.
// The bot drives the active tab through the DevTools protocol
// (webContents.debugger): it reads the page as text with refs, and clicks,
// types, presses and scrolls through the Input domain, never by looking at
// our screen. Frames of the active tab are painted only while someone
// watches: while the person watches live, at 60 a second as GPU textures
// drawn straight onto the page's canvas (JPEGs when there is no GPU
// texture); thumbnails once a second as small JPEGs.
//
// The page lays out at the size of the person's view while they watch it
// live (crew:viewport), and at a default size otherwise. Pages that open a
// window (target=_blank, window.open) open a new tab instead.
//
// Sound plays only while the person has the bot's computer open in a
// window they can see, and not for a tab (or a bot) they muted. Stop
// pauses every video and sound in the bot's tabs.
//
// While the person has control, the bot's browser tools wait a moment and
// then fail, and the person's mouse and keys go straight to the page. No
// frame or keystroke from that time reaches the model. If the person sends
// a form with a password then, its origin, username and password go to
// onCapture (Crew offers to save them to the vault), never to the bot.
//
// Logins from the vault are filled by Crew itself (fillLogin, fillCode),
// in one step inside the page that refuses unless the page is on the
// login's origin. Filled fields never show their text in snapshot, and no
// screenshot is taken while a filled secret shows as text.
//
// Waiting without looking: every tab tells Crew when its page shows a site
// notification (the page sees notifications as granted, and nothing is shown
// on screen), and a bot can watch one element of a page for changes. Both
// come through the DevTools protocol binding of each tab, never a screenshot.
// Watches are kept per bot and re-armed when their tab loads again.

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow, screen, session, sharedTexture } = require("electron");
const { pageSnapshot, pageTarget, pageSelectAll, pageChoose, pageScroll, pageFillLogin, pageFillCode, pageSecretShown, CAPTURE_SOURCE, NOTIFY_SOURCE, pageWatchTarget, pageWatchArm, pageWatchStop } = require("./page-scripts.cjs");
const { LIMITS } = require("./format.cjs");


/** The page size when nobody watches live, in CSS pixels. */
const DEFAULT_VIEW = { width: 1280, height: 800 };
/** Downloads are saved in the bot's workspace, under this folder. */
const DOWNLOAD_DIR = "downloads";
/** The PC's drive keeps this much free: a download may not take it. */
const KEEP_FREE = 1024 ** 3;
const DOWNLOAD_NAME_MAX = 120;
/** Recent downloads kept per bot. */
const DOWNLOADS_KEPT = 20;
const VIEW_LIMITS = { minWidth: 360, maxWidth: 3840, minHeight: 240, maxHeight: 2400 };
const MAX_TABS = LIMITS.browserTabs;
const CONTROL_MESSAGE = "The person has control of the browser. Wait, then call snapshot again.";
const FPS = { live: 60, thumb: 1 };
/** Live frames as JPEGs, when the GPU gives no texture: as many as the page can decode. */
const JPEG_LIVE_FPS = 30;
const THUMB_WIDTH = 320;
const SNAPSHOT_CHARS = 14_000;
const LOAD_TIMEOUT_MS = 20_000;
/** Back to the default size this long after the last live watcher leaves. */
const DEFAULT_AFTER_MS = 2000;
const FAVICON_BYTES = 64 * 1024;
/** The world the take-control capture runs in, and the binding it reports through. */
const CAPTURE_WORLD = "fenna-crew-capture";
const CAPTURE_BINDING = "__fennaCrewSave";
/** The page's notifications, reported from the page's own world through this binding. */
const NOTIFY_BINDING = "__fennaCrewNotify";
const NOTIFY_PER_MINUTE = 30;
const NOTIFY_TEXT_CAP = 300;
const NOTICES_KEPT = 50;
/** Element watches: the world they run in and the binding they report through. */
const WATCH_WORLD = "fenna-crew-watch";
const WATCH_BINDING = "__fennaCrewWatch";
const WATCH_DEBOUNCE_MS = 1500;
const WATCH_TEXT_CAP = 4000;
/** A watch whose element is not on the page yet is looked for this often, for this long after each load. */
const WATCH_RETRY_MS = 5000;
const WATCH_RETRY_WINDOW_MS = 60_000;
/** Page text: how long a page may take to load, what is read, and the wait after load. */
const PAGE_TEXT_MS = 30_000;
const PAGE_TEXT_CAP = 50_000;
const PAGE_TEXT_SETTLE_MS = 2000;
/** The replay's pictures: the bot actions that get one, the width and JPEG quality, and at most one a bot per gap. */
const STEP_ACTIONS = new Set(["open", "back", "click", "type", "press", "scroll", "switch_tab"]);
const STEP_WIDTH = 480;
const STEP_JPEG_QUALITY = 60;
const STEP_GAP_MS = 700;
const STEP_CAPTURE_MS = 2000;

const CHROME_VERSION = "134.0.6998.88";
const CHROME_MAJOR = "134";
const CHROME_UA = process.platform === "darwin"
  ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`
  : process.platform === "linux"
  ? `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`
  : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;

const EMULATE_CHROME_SCRIPT = `
(function() {
  try {
    const brands = [
      { brand: "Google Chrome", version: "${CHROME_MAJOR}" },
      { brand: "Chromium", version: "${CHROME_MAJOR}" },
      { brand: "Not=A?Brand", version: "24" }
    ];
    const fullVersionList = [
      { brand: "Google Chrome", version: "${CHROME_VERSION}" },
      { brand: "Chromium", version: "${CHROME_VERSION}" },
      { brand: "Not=A?Brand", version: "24.0.0.0" }
    ];
    if (navigator.userAgentData) {
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => ({
          brands,
          mobile: false,
          platform: 'Windows',
          getHighEntropyValues: async () => ({
            architecture: 'x86',
            bitness: '64',
            brands,
            fullVersionList,
            mobile: false,
            model: '',
            platform: 'Windows',
            platformVersion: '15.0.0',
            uaFullVersion: '${CHROME_VERSION}'
          }),
          toJSON: () => ({ brands, mobile: false, platform: 'Windows' })
        }),
        configurable: true
      });
    }
  } catch (e) {}
})();
`;

const FIX_SELECT_DPI_SCRIPT = `
(function() {
  try {
    const style = document.createElement('style');
    style.id = 'fenna-crew-select-fix';
    style.textContent = 'select { font-size: 14px !important; line-height: normal !important; zoom: 1 !important; } select option { font-size: 14px !important; padding: 4px 8px !important; background: #fff !important; color: #111 !important; }';
    if (document.head) document.head.appendChild(style);
    else document.addEventListener('DOMContentLoaded', () => document.head && document.head.appendChild(style));
  } catch(e) {}
})();
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEYS = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
};
const MODS = { alt: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, shift: 8 };

/** "Control+A" → a key event for Input.dispatchKeyEvent, or an error message. */
function parseKey(spec) {
  const parts = String(spec).split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { error: "Name a key, like Enter." };
  let modifiers = 0;
  for (const m of parts.slice(0, -1)) {
    const bit = MODS[m.toLowerCase()];
    if (!bit) return { error: `"${m}" is not a modifier. Use Control, Shift, Alt or Meta, like "Control+A".` };
    modifiers |= bit;
  }
  const last = parts[parts.length - 1];
  const named = KEYS[last.toLowerCase()];
  if (named) return { ...named, modifiers, text: modifiers & 6 ? undefined : named.text };
  if (/^[a-z0-9]$/i.test(last)) {
    const ch = modifiers & 8 ? last.toUpperCase() : last.toLowerCase();
    const upper = last.toUpperCase();
    return { key: ch, code: /\d/.test(last) ? `Digit${last}` : `Key${upper}`, keyCode: upper.charCodeAt(0), modifiers, text: modifiers & 6 ? undefined : ch };
  }
  return { error: `"${last}" is not a key press knows. Keys: ${Object.values(KEYS).map((k) => (k.key === " " ? "Space" : k.key)).join(", ")}, or a letter or digit.` };
}

/** A view size from the page, kept within limits; null when it isn't one. */
function viewOf(v) {
  if (!v || typeof v !== "object" || !Number.isFinite(v.width) || !Number.isFinite(v.height)) return null;
  const width = Math.round(Math.max(VIEW_LIMITS.minWidth, Math.min(VIEW_LIMITS.maxWidth, v.width)));
  const height = Math.round(Math.max(VIEW_LIMITS.minHeight, Math.min(VIEW_LIMITS.maxHeight, v.height)));
  const scale = Number.isFinite(v.scale) ? Math.max(1, Math.min(3, Math.round(v.scale * 4) / 4)) : null;
  return { width, height, scale };
}

/** The person's input, from the page's ControlInput, as an Electron input event within the view. */
const DOM_TO_ELECTRON_KEY = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", " ": "Space", Escape: "Escape", Enter: "Enter" };
function toElectronInput(ev, view = DEFAULT_VIEW) {
  if (!ev || typeof ev !== "object") return null;
  const mods = Array.isArray(ev.modifiers) ? ev.modifiers.filter((m) => ["shift", "control", "alt", "meta"].includes(m)) : [];
  const num = (v, max) => (Number.isFinite(v) ? Math.max(-max, Math.min(max, v)) : 0);
  const x = Math.round(Math.max(0, Math.min(view.width, num(ev.x, view.width))));
  const y = Math.round(Math.max(0, Math.min(view.height, num(ev.y, view.height))));
  switch (ev.type) {
    case "mouseDown":
    case "mouseUp":
      return { type: ev.type, x, y, button: ["left", "right", "middle"].includes(ev.button) ? ev.button : "left", clickCount: Math.max(1, Math.min(3, Number(ev.clickCount) || 1)), modifiers: mods };
    case "mouseMove":
      return { type: "mouseMove", x, y, modifiers: mods };
    case "mouseWheel":
      // The page sends DOM wheel deltas (down is positive); Electron's are the other way round.
      return { type: "mouseWheel", x, y, deltaX: -num(ev.deltaX, 5000), deltaY: -num(ev.deltaY, 5000), canScroll: true };
    case "keyDown":
    case "keyUp":
    case "char": {
      const key = typeof ev.key === "string" && ev.key.length <= 20 ? ev.key : "";
      if (!key) return null;
      return { type: ev.type, keyCode: ev.type === "char" ? key : DOM_TO_ELECTRON_KEY[key] || key, modifiers: mods };
    }
    default:
      return null;
  }
}

/** An http(s) address from what was typed, or an error saying what is wrong. */
function webAddress(typed) {
  let url = String(typed || "").trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
  let u;
  try {
    u = new URL(url);
  } catch {
    return { error: `"${String(typed).slice(0, 200)}" is not a web address. Write it like https://example.com.` };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "Only http and https pages open in this browser." };
  return { url: u };
}

const blank = (url) => !url || url === "about:blank";

/** A Google Meet call's link: only the meeting tool opens one, in a tab of its own. */
const callLink = (u) => u.origin === "https://meet.google.com" && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\/|$)/i.test(u.pathname);

/**
 * A file name safe to save in a folder: the last part of the name the page
 * gave (no folders), with control and Windows-reserved characters turned into
 * "_", no leading dots and no trailing dots or spaces.
 */
function safeDownloadName(name) {
  const last = String(name || "").split(/[\\/]/).pop() || "";
  const clean = last.replace(/[\x00-\x1f\x7f<>:"|?*]/g, "_").replace(/^\.+/, "").replace(/[. ]+$/, "").trim();
  return clean || "download";
}

/**
 * A name in a folder that `taken` says is free: "report.pdf", then
 * "report (2).pdf", "report (3).pdf"... The extension is kept and the whole
 * name fits in DOWNLOAD_NAME_MAX characters, the stem shortened to make room.
 */
function uniqueName(name, taken) {
  const base = safeDownloadName(name);
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 && base.length - dot <= 32 ? base.slice(dot) : "";
  const stem = ext ? base.slice(0, dot) : base;
  for (let n = 1; ; n++) {
    const tag = n === 1 ? "" : ` (${n})`;
    const head = stem.slice(0, Math.max(1, DOWNLOAD_NAME_MAX - tag.length - ext.length));
    const candidate = `${head}${tag}${ext}`;
    if (!taken(candidate)) return candidate;
  }
}

/** True when a download is too big for `cap` bytes: its total is known and over it, or it has received more than it. */
function overCap(received, total, cap) {
  return received > cap || (total > 0 && total > cap);
}

/**
 * What a download may take: the bot's free space, or the PC's drive's free space less KEEP_FREE, whichever is less.
 * `drive` is true when the drive is the limit.
 */
function downloadRoom(botFree, driveFreeBytes) {
  const onDrive = driveFreeBytes - KEEP_FREE;
  return { bytes: Math.max(0, Math.min(botFree, onDrive)), drive: onDrive < botFree };
}

/** The reason a bot gets when a download is too big: its size, the room there is, and what the person can do. */
function tooBigText(size, room, known, drive) {
  const what = known ? `it is ${sizeText(size)}` : `it is more than ${sizeText(size)}`;
  if (drive) return `${what}, and only ${sizeText(room)} can be saved here: the PC keeps 1 GB free. Ask the person to free up space on this computer.`;
  return `${what}, and ${sizeText(room)} is free on the bot's disk. Ask the person to make this bot's disk larger in its Details (Disk size).`;
}

/** Bytes in words for a result line: "512 B", "12 KB", "3.4 MB", "1.2 GB". */
function sizeText(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** The lines for downloads that finished or failed since the bot's last successful browser call. Marks them told. */
function downloadNews(b) {
  const news = b.downloads.filter((d) => !d.told && d.state !== "progressing");
  for (const d of news) d.told = true;
  return news.map((d) => (d.state === "done" ? `Downloaded ${d.name} to ${d.path} (${sizeText(d.bytes)}).` : `Download of ${d.name} failed: ${d.reason}.`));
}

/** A rate limiter: take() is true for at most `max` calls in any `windowMs`, and false for the rest. */
function rateLimiter(max, windowMs, now = Date.now) {
  let stamps = [];
  return () => {
    const t = now();
    stamps = stamps.filter((s) => t - s < windowMs);
    if (stamps.length >= max) return false;
    stamps.push(t);
    return true;
  };
}

/** The newest item first, the list cut to `cap` items. A new list; the old one is not changed. */
function pushCapped(list, item, cap) {
  return [item, ...list].slice(0, cap);
}

/** Text as a string cut to `cap` characters; anything that is not a string is "". */
function clipText(v, cap) {
  return typeof v === "string" ? v.slice(0, cap) : "";
}

/**
 * The unread count a chat or mail site puts in a tab's title: "(3) WhatsApp",
 * "Inbox (3) - Gmail", "[2] Slack". null when the title has none. At most
 * three digits, so a year like "(2024)" is not a count.
 */
function unreadCount(title) {
  const m = /(?:^|\s)[([](\d{1,3})[)\]](?=\s|$)/.exec(String(title ?? ""));
  return m ? Number(m[1]) : null;
}

/** The origin of a tab's address, or "" when it has none (blank, or a destroyed tab). */
/** Another tab already on this site (not the active one), or null: opening the site switches to it. */
function otherSiteTab(tabs, origin, activeId) {
  return tabs.find((t) => t.origin === origin && t.id !== activeId) ?? null;
}

function originOf(t) {
  if (t.wc.isDestroyed()) return "";
  try {
    const origin = new URL(t.wc.getURL()).origin;
    return origin === "null" ? "" : origin;
  } catch {
    return "";
  }
}

/**
 * @param {object} o
 * @param {(slug: string, frame: object) => void} o.onFrame  JPEG frames (thumbnails, and live frames without a GPU texture)
 * @param {(slug: string, cursor: object) => void} o.onCursor
 * @param {(slug: string, state: object) => void} o.onState
 * @param {() => Electron.WebFrameMain | null} [o.liveTarget]  the page's frame that GPU live frames go to
 * @param {(slug: string, login: { origin: string, username: string, password: string }) => void} [o.onCapture]
 *   the person sent a form with a password while in control
 * @param {number} [o.controlWaitMs]  how long a bot's tool waits for the person to give control back
 * @param {(slug: string) => string} [o.workspaceDir]  the bot's workspace folder; downloads go to its downloads/ folder.
 *   Without it every download is refused.
 * @param {(slug: string) => number} [o.diskFree]  bytes left on the bot's disk; a download that won't fit is refused
 * @param {(dir: string) => number} [o.driveFree]  bytes free on the drive a folder is on; a download may not take
 *   the last KEEP_FREE (1 GB) of it
 * @param {(slug: string, n: { origin: string, title: string, body: string, at: string }) => void} [o.onSiteNotification]
 *   a site in the bot's browser showed a notification (at most 30 a minute a bot are passed on)
 * @param {(slug: string, n: { origin: string, title: string, count: number }) => void} [o.onTitleCount]
 *   a tab's title gained an unread count (the site shows new activity while it is not in front)
 * @param {(slug: string, id: string, text: string) => void} [o.onElementChange]  a watched element's text changed
 * @param {(slug: string, step: { at: string, action: string, url: string, jpeg: Buffer }) => void} [o.onStep]
 *   a bot action finished: a small JPEG of the active tab after it, for the replay (at most one a bot per 700 ms)
 */
function createBrowsers({ onFrame, onCursor, onState, liveTarget = () => null, onCapture = () => {}, controlWaitMs = 15_000, workspaceDir = null, diskFree = null, driveFree = null, onSiteNotification = () => {}, onTitleCount = () => {}, onElementChange = () => {}, onStep = () => {}, onDownload = () => {} }) {
  /** @type {Map<string, object>} slug → the bot's browser */
  const all = new Map();
  /** @type {Map<string, Map<number, "live"|"thumb">>} slug → watcher → mode */
  const watchers = new Map();
  /** @type {Map<string, { width: number, height: number, scale: number|null }>} slug → the person's view size */
  const wanted = new Map();
  /** The window the person watches in is on screen (not hidden in the tray or minimized). */
  let hostVisible = true;
  /** @type {Map<string, Set<number>>} slug → pages that have the bot's computer open */
  const present = new Map();
  /** @type {Map<string, () => boolean>} slug → the gap between a bot's replay pictures */
  const stepGates = new Map();

  function modeOf(slug) {
    const w = watchers.get(slug);
    if (!w || !w.size) return "off";
    return [...w.values()].includes("live") ? "live" : "thumb";
  }

  const displayScale = () => {
    try {
      return Math.max(1, Math.min(3, screen.getPrimaryDisplay().scaleFactor || 1));
    } catch {
      return 1;
    }
  };

  const activeTab = (b) => b.tabs.find((t) => t.id === b.active) || null;

  /** The folder a bot's downloads go to (made if missing), or null when there is none. */
  function downloadFolder(slug) {
    if (!workspaceDir) return null;
    try {
      const dir = path.join(workspaceDir(slug), DOWNLOAD_DIR);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      return null;
    }
  }

  /** A page's download in a bot's session: saved to its folder without a dialog, capped, and recorded for the bot. */
  function startDownload(b, item) {
    const fail = (reason) => {
      item.cancel();
      b.downloads.push({ name: safeDownloadName(item.getFilename()), path: "", bytes: 0, state: "failed", reason, told: false });
    };
    const dir = downloadFolder(b.slug);
    if (!dir) return fail("Crew can't save downloads for this bot.");
    // What the bot's disk has left, or the PC's drive less KEEP_FREE, less what the bot's other downloads are still taking.
    const limit = downloadRoom(diskFree ? diskFree(b.slug) : Infinity, driveFree ? driveFree(dir) : Infinity);
    const room = Math.max(0, limit.bytes - b.downloads.reduce((n, d) => n + (d.state === "progressing" ? d.bytes : 0), 0));
    const total = item.getTotalBytes();
    if (overCap(0, total, room)) return fail(tooBigText(total, room, true, limit.drive));
    const name = uniqueName(item.getFilename(), (n) => fs.existsSync(path.join(dir, n)) || b.downloadNames.has(n));
    b.downloadNames.add(name);
    item.setSavePath(path.join(dir, name));
    const rec = { name, path: `${DOWNLOAD_DIR}/${name}`, bytes: 0, state: "progressing", reason: "", told: false };
    let stopped = "";
    b.downloads.push(rec);
    if (b.downloads.length > DOWNLOADS_KEPT) b.downloads.splice(0, b.downloads.length - DOWNLOADS_KEPT);
    item.on("updated", () => {
      rec.bytes = item.getReceivedBytes();
      if (stopped) return;
      if (overCap(rec.bytes, total, room)) {
        stopped = tooBigText(Math.max(rec.bytes, total), room, total > 0, limit.drive);
        item.cancel();
      }
    });
    item.once("done", (_e, state) => {
      b.downloadNames.delete(name);
      rec.bytes = item.getReceivedBytes();
      if (state === "completed") rec.state = "done";
      else {
        rec.state = "failed";
        rec.reason = stopped || (state === "cancelled" ? "it was cancelled." : "the connection stopped.");
      }
      onDownload(b.slug, rec);
    });
  }

  /**
   * The bot's session. Downloads are kept only from its own tabs (in the
   * bot's browser); one listener per session, so a browser closed and opened
   * again, or a page-text load, replaces the old one.
   */
  function sessionOf(slug) {
    const partition = `persist:crew-${slug}`;
    const ses = session.fromPartition(partition);
    ses.setUserAgent(CHROME_UA);
    ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    ses.removeAllListeners("will-download");
    ses.on("will-download", (e, item, wc) => {
      const b = all.get(slug);
      if (b && wc && b.tabs.some((t) => t.wc.id === wc.id)) startDownload(b, item);
      else e.preventDefault();
    });
    return ses;
  }

  function openBrowser(slug) {
    const partition = `persist:crew-${slug}`;
    const ses = sessionOf(slug);
    const want = wanted.get(slug);
    return { slug, partition, ses, tabs: [], active: null, seq: 0, control: false, view: { ...DEFAULT_VIEW }, scale: (want && want.scale) || displayScale(), lastFrame: 0, trailing: null, sending: false, repaint: false, lastThumb: 0, defaultTimer: null, favicons: new Map(), muted: false, downloads: [], downloadNames: new Set(), notices: [], notifyLimit: rateLimiter(NOTIFY_PER_MINUTE, 60_000), elementWatches: new Map() };
  }

  const tell = (b) => onState(b.slug, stateOf(b));

  const windowOptions = (b) => ({
    show: false,
    width: b.view.width,
    height: b.view.height,
    useContentSize: true,
    webPreferences: { offscreen: { useSharedTexture: true, deviceScaleFactor: b.scale }, partition: b.partition, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });

  /** Fetch a tab's icon through the bot's own session, as a small data URL the page can show. */
  async function loadFavicon(b, t, urls) {
    const url = (urls || []).find((u) => /^https?:/i.test(u) || /^data:image\//i.test(u));
    if (!url) return;
    if (url.startsWith("data:")) {
      t.favicon = url.length <= FAVICON_BYTES ? url : null;
      tell(b);
      return;
    }
    if (b.favicons.has(url)) {
      t.favicon = b.favicons.get(url);
      tell(b);
      return;
    }
    try {
      const res = await b.ses.fetch(url, { signal: AbortSignal.timeout(5000) });
      const type = (res.headers.get("content-type") || "").split(";")[0].trim();
      if (!res.ok || !/^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|gif|jpeg|webp)$/.test(type)) return;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > FAVICON_BYTES) return;
      const data = `data:${type};base64,${buf.toString("base64")}`;
      b.favicons.set(url, data);
      if (!t.wc.isDestroyed()) {
        t.favicon = data;
        tell(b);
      }
    } catch {
      /* no icon: the page shows a plain one */
    }
  }

  /** Set up a tab around an offscreen window (new, or one a page opened). */
  function addTab(b, win, { activate = true } = {}) {
    const wc = win.webContents;
    wc.setUserAgent(CHROME_UA);
    try {
      wc.setZoomFactor(1);
      wc.setVisualZoomLevelLimits(1, 1);
    } catch (_) {}
    const t = { id: ++b.seq, win, wc, world: null, watchWorld: null, favicon: null, ready: null, latest: null, muted: false, capture: null, unread: 0 };
    wc.setWindowOpenHandler(({ url }) => {
      if (!/^https?:/i.test(url)) return { action: "deny" };
      if (b.tabs.length >= MAX_TABS) {
        // No room for another tab: open it here rather than lose it.
        void wc.loadURL(url).catch(() => {});
        return { action: "deny" };
      }
      return { action: "allow", overrideBrowserWindowOptions: windowOptions(b) };
    });
    wc.on("did-create-window", (child) => {
      const nt = addTab(b, child, { activate: true });
      nt.ready = attach(nt);
      if (b.control) void arm(nt);
    });
    wc.on("will-navigate", (e, url) => {
      if (!/^(https?:|about:blank)/i.test(url)) e.preventDefault();
    });
    for (const ev of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated"]) wc.on(ev, () => tell(b));
    wc.on("did-navigate", () => {
      t.favicon = null;
    });
    for (const ev of ["did-finish-load", "did-navigate-in-page"]) wc.on(ev, () => rearmWatches(b, t));
    wc.on("page-title-updated", (_e, title) => onTitle(b, t, title));
    wc.on("page-favicon-updated", (_e, urls) => void loadFavicon(b, t, urls));
    const size = () => (win.isDestroyed() ? [b.view.width, b.view.height] : win.getContentSize());
    const emit = (image, kind) => {
      if (modeOf(b.slug) === "off" || b.active !== t.id || win.isDestroyed() || image.isEmpty()) return;
      const img = kind === "thumb" ? image.resize({ width: THUMB_WIDTH, quality: "good" }) : image;
      const px = img.getSize();
      const [viewWidth, viewHeight] = size();
      onFrame(b.slug, { slug: b.slug, tab: t.id, jpeg: new Uint8Array(img.toJPEG(kind === "live" ? 80 : 60)), width: px.width, height: px.height, viewWidth, viewHeight, kind });
    };
    /** A JPEG at most fps times a second; the last change of a burst is sent when its turn comes. */
    const throttled = (image, kind, fps) => {
      const wait = 1000 / fps - 5 - (Date.now() - b.lastFrame);
      if (wait <= 0) {
        clearTimeout(b.trailing);
        b.trailing = null;
        b.lastFrame = Date.now();
        emit(image, kind);
        return;
      }
      t.latest = image;
      if (!b.trailing) {
        b.trailing = setTimeout(() => {
          b.trailing = null;
          b.lastFrame = Date.now();
          if (t.latest) emit(t.latest, kind);
          t.latest = null;
        }, wait);
      }
    };
    /**
     * A GPU frame straight to the page's canvas; one at a time, so a slow page
     * skips frames instead of queueing them. A skipped frame asks for a fresh
     * paint once the send is done, so a page that paints once isn't left out.
     */
    async function sendTexture(texture) {
      const frame = liveTarget();
      if (!frame || b.sending) {
        texture.release();
        b.repaint = true;
        return;
      }
      b.sending = true;
      try {
        const imported = sharedTexture.importSharedTexture({ textureInfo: texture.textureInfo, allReferencesReleased: () => texture.release() });
        const [viewWidth, viewHeight] = size();
        await sharedTexture.sendSharedTexture({ frame, importedSharedTexture: imported }, b.slug, viewWidth, viewHeight);
        imported.release();
      } catch {
        /* the page went away or isn't listening: the next frame tries again */
      } finally {
        b.sending = false;
        if (b.repaint && !wc.isDestroyed()) {
          b.repaint = false;
          wc.invalidate();
        }
      }
    }
    /**
     * A tab a page opened (target=_blank, window.open) paints with neither a
     * GPU texture nor a bitmap, so its frames are captured instead, at most
     * fps a second; the last change of a burst is captured when its turn comes.
     */
    const captured = (kind, fps) => {
      const wait = 1000 / fps - 5 - (Date.now() - b.lastFrame);
      if (wait > 0) {
        if (!b.trailing) {
          b.trailing = setTimeout(() => {
            b.trailing = null;
            captured(kind, fps);
          }, wait);
        }
        return;
      }
      b.lastFrame = Date.now();
      wc.capturePage().then((img) => emit(img, kind), () => {});
    };
    /** A thumbnail once a second, from the page as it is now. */
    function thumb() {
      const now = Date.now();
      if (now - b.lastThumb < 1000 / FPS.thumb - 5) return;
      b.lastThumb = now;
      wc.capturePage().then((img) => emit(img, "thumb"), () => {});
    }
    wc.on("paint", (e, _dirty, image) => {
      const texture = e.texture;
      const mode = modeOf(b.slug);
      if (b.active !== t.id || mode === "off") {
        if (texture) texture.release();
        return;
      }
      if (mode === "live") {
        if (texture) void sendTexture(texture);
        else if (image.isEmpty()) captured("live", JPEG_LIVE_FPS);
        else throttled(image, "live", JPEG_LIVE_FPS);
        return;
      }
      if (texture) {
        texture.release();
        thumb();
      } else if (image.isEmpty()) captured("thumb", FPS.thumb);
      else throttled(image, "thumb", FPS.thumb);
    });
    wc.on("audio-state-changed", () => tell(b));
    wc.debugger.on("message", (_e, method, params) => {
      if (method === "Page.frameNavigated" && params && params.frame && !params.frame.parentId) {
        t.world = null;
        t.watchWorld = null;
      }
      if (method === "Runtime.bindingCalled" && params && params.name === NOTIFY_BINDING) onNotification(b, t, params.payload);
      if (method === "Runtime.bindingCalled" && params && params.name === WATCH_BINDING) onWatchText(b, t, params.payload);
      // Only while the person has control: the bot's own clicks never save anything.
      if (method === "Runtime.bindingCalled" && params && params.name === CAPTURE_BINDING && b.control) {
        let v = null;
        try {
          v = JSON.parse(String(params.payload || ""));
        } catch {
          return;
        }
        if (v && typeof v.origin === "string" && typeof v.password === "string" && v.password && v.password.length <= 1000) {
          onCapture(b.slug, { origin: v.origin, username: typeof v.username === "string" ? v.username.slice(0, 200) : "", password: v.password });
        }
      }
    });
    wc.on("destroyed", () => dropTab(b, t.id));
    b.tabs.push(t);
    applyAudio(b);
    if (activate || b.active === null) b.active = t.id;
    applyMode(b);
    tell(b);
    return t;
  }

  /** The protocol answers only once the page has a document. */
  async function attach(t) {
    if (t.wc.isDestroyed()) return;
    if (!t.wc.debugger.isAttached()) t.wc.debugger.attach("1.3");
    await t.wc.debugger.sendCommand("Page.enable");
    try {
      await t.wc.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: EMULATE_CHROME_SCRIPT + "\n" + FIX_SELECT_DPI_SCRIPT });
    } catch (_) {}
    // Notifications and element watches report through bindings, kept for every page of the tab.
    try {
      await cdp(t, "Runtime.enable");
      await cdp(t, "Runtime.addBinding", { name: NOTIFY_BINDING });
      await cdp(t, "Runtime.addBinding", { name: WATCH_BINDING, executionContextName: WATCH_WORLD });
      await cdp(t, "Page.addScriptToEvaluateOnNewDocument", { source: NOTIFY_SOURCE });
    } catch (_) {}
  }

  /** A page showed a notification: kept for the bot (newest first), and passed on unless the bot is over its limit. */
  function onNotification(b, t, payload) {
    if (!b.notifyLimit()) return;
    const origin = originOf(t);
    let v = null;
    try {
      v = JSON.parse(String(payload || ""));
    } catch {
      return;
    }
    if (!origin || !v || typeof v !== "object") return;
    const n = { origin, title: clipText(v.title, NOTIFY_TEXT_CAP), body: clipText(v.body, NOTIFY_TEXT_CAP), at: new Date().toISOString() };
    b.notices = pushCapped(b.notices, n, NOTICES_KEPT);
    onSiteNotification(b.slug, n);
  }

  /** A tab's title: a count that went up is passed on; the count is kept per tab. */
  function onTitle(b, t, title) {
    const count = unreadCount(title);
    const prev = t.unread ?? 0;
    t.unread = count ?? 0;
    if (count === null || count <= prev) return;
    const origin = originOf(t);
    if (!origin) return;
    onTitleCount(b.slug, { origin, title: clipText(title, NOTIFY_TEXT_CAP), count });
  }

  /** A watched element's text changed on the tab that watches it. */
  function onWatchText(b, t, payload) {
    let v = null;
    try {
      v = JSON.parse(String(payload || ""));
    } catch {
      return;
    }
    const rec = v && typeof v.id === "string" ? b.elementWatches.get(v.id) : null;
    if (!rec || rec.tabId !== t.id || typeof v.text !== "string") return;
    const text = v.text.slice(0, WATCH_TEXT_CAP);
    if (text === rec.last) return;
    rec.last = text;
    onElementChange(b.slug, rec.id, text);
  }

  /** Watch a tab for the person sending a password form (only while they have control). */
  async function arm(t) {
    if (t.capture || t.wc.isDestroyed()) return;
    t.capture = "arming";
    try {
      await t.ready;
      await cdp(t, "Runtime.enable");
      await cdp(t, "Runtime.addBinding", { name: CAPTURE_BINDING, executionContextName: CAPTURE_WORLD });
      const { identifier } = await cdp(t, "Page.addScriptToEvaluateOnNewDocument", { source: CAPTURE_SOURCE, worldName: CAPTURE_WORLD });
      t.capture = identifier;
      const { frameTree } = await cdp(t, "Page.getFrameTree");
      const w = await cdp(t, "Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: CAPTURE_WORLD });
      await cdp(t, "Runtime.evaluate", { expression: CAPTURE_SOURCE, contextId: w.executionContextId });
    } catch {
      /* a tab that closed or can't be watched: nothing to offer from it */
    }
  }

  async function disarm(t) {
    const id = t.capture;
    t.capture = null;
    if (!id || t.wc.isDestroyed()) return;
    try {
      if (id !== "arming") await cdp(t, "Page.removeScriptToEvaluateOnNewDocument", { identifier: id });
      await cdp(t, "Runtime.removeBinding", { name: CAPTURE_BINDING });
    } catch {
      /* gone */
    }
  }

  /** The isolated world element watches run in, for this tab's current page. */
  async function watchWorld(t) {
    if (!t.watchWorld) {
      const { frameTree } = await cdp(t, "Page.getFrameTree");
      const r = await cdp(t, "Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: WATCH_WORLD });
      t.watchWorld = r.executionContextId;
    }
    return t.watchWorld;
  }

  /** Run a page-scripts watch function in the tab's watch world. { error: "gone" } when the page went away. */
  async function watchEval(t, fn, arg) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const contextId = await watchWorld(t);
        const r = await cdp(t, "Runtime.evaluate", { expression: `(${fn.toString()})(${JSON.stringify(arg)})`, contextId, returnByValue: true });
        return r.exceptionDetails ? { error: "gone" } : r.result.value ?? { error: "gone" };
      } catch {
        t.watchWorld = null;
      }
    }
    return { error: "gone" };
  }

  /**
   * Arm a watch on a tab. An element that is not on the page yet is looked
   * for again every few seconds, until the retry window after the load ends.
   */
  async function runWatch(b, rec, t) {
    clearTimeout(rec.timer);
    rec.timer = null;
    if (b.elementWatches.get(rec.id) !== rec || t.wc.isDestroyed() || originOf(t) !== rec.origin) return;
    if (rec.tabId !== null && rec.tabId !== t.id) await stopWatch(b, rec);
    rec.tabId = t.id;
    const r = await watchEval(t, pageWatchArm, { id: rec.id, selector: rec.selector, debounce: WATCH_DEBOUNCE_MS, cap: WATCH_TEXT_CAP });
    if (b.elementWatches.get(rec.id) !== rec) {
      await watchEval(t, pageWatchStop, rec.id);
      return;
    }
    if (r.error === "missing") {
      if (Date.now() < rec.retryUntil) rec.timer = setTimeout(() => void runWatch(b, rec, t), WATCH_RETRY_MS);
      return;
    }
    if (typeof r.text === "string") rec.last = r.text;
  }

  /** Stop a watch on the tab that runs it, if any. */
  async function stopWatch(b, rec) {
    const old = rec.tabId === null ? null : b.tabs.find((x) => x.id === rec.tabId);
    rec.tabId = null;
    if (old && !old.wc.isDestroyed()) await watchEval(old, pageWatchStop, rec.id);
  }

  /** Drop a watch under this id: its record, its retry, and the page's observer. */
  async function forgetWatch(b, id) {
    const rec = b.elementWatches.get(id);
    if (!rec) return;
    b.elementWatches.delete(id);
    clearTimeout(rec.timer);
    await stopWatch(b, rec);
  }

  /**
   * A tab loaded, or moved within its page: the watches of its address are
   * armed on it; a watch that ran on this tab for another address stops.
   */
  function rearmWatches(b, t) {
    const origin = originOf(t);
    for (const rec of b.elementWatches.values()) {
      if (rec.origin !== origin) {
        if (rec.tabId === t.id) {
          clearTimeout(rec.timer);
          rec.tabId = null;
        }
        continue;
      }
      rec.retryUntil = Date.now() + WATCH_RETRY_WINDOW_MS;
      void runWatch(b, rec, t);
    }
  }

  function newTab(b, { activate = true } = {}) {
    const win = new BrowserWindow(windowOptions(b));
    const t = addTab(b, win, { activate });
    t.ready = t.wc
      .loadURL("about:blank")
      .catch(() => {})
      .then(() => attach(t));
    if (b.control) void arm(t);
    return t;
  }

  /** A tab went away (closed by the bot, the person, or the page itself). */
  function dropTab(b, id) {
    const i = b.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    b.tabs.splice(i, 1);
    if (b.active === id) b.active = b.tabs.length ? b.tabs[Math.min(i, b.tabs.length - 1)].id : null;
    for (const rec of b.elementWatches.values()) {
      if (rec.tabId !== id) continue;
      clearTimeout(rec.timer);
      rec.tabId = null;
    }
    applyMode(b);
    tell(b);
  }

  /** Sound only while the person sees the bot's computer, and not for what they muted. */
  function applyAudio(b) {
    const hearing = hostVisible && !!present.get(b.slug)?.size;
    for (const t of b.tabs) if (!t.wc.isDestroyed()) t.wc.setAudioMuted(!hearing || b.muted || t.muted);
  }

  /** Paint only the active tab, and only while someone watches. */
  function applyMode(b) {
    const mode = modeOf(b.slug);
    for (const t of b.tabs) {
      if (t.wc.isDestroyed()) continue;
      if (mode === "off" || t.id !== b.active) {
        if (t.wc.isPainting()) t.wc.stopPainting();
        continue;
      }
      t.wc.setFrameRate(FPS[mode]);
      if (!t.wc.isPainting()) t.wc.startPainting();
      b.lastFrame = 0;
      b.lastThumb = 0;
      t.wc.invalidate();
    }
  }

  function setActive(b, id) {
    if (b.active === id) return;
    b.active = id;
    applyMode(b);
    tell(b);
  }

  /** Lay every tab out at this size (CSS pixels). */
  function resize(b, view) {
    if (b.view.width === view.width && b.view.height === view.height) return;
    b.view = { width: view.width, height: view.height };
    for (const t of b.tabs) if (!t.win.isDestroyed()) t.win.setContentSize(view.width, view.height);
    applyMode(b);
    tell(b);
  }

  function stateOf(b) {
    const t = b ? activeTab(b) : null;
    if (!b || !t || t.wc.isDestroyed()) {
      return { url: "", title: "", loading: false, control: !!(b && b.control), canGoBack: false, canGoForward: false, tabs: [], active: null, view: b ? { ...b.view } : { ...DEFAULT_VIEW }, muted: !!(b && b.muted) };
    }
    const tabs = b.tabs
      .filter((x) => !x.wc.isDestroyed())
      .map((x) => {
        const url = x.wc.getURL();
        const title = x.wc.getTitle();
        return { id: x.id, url: blank(url) ? "" : url, title: blank(title) || title === url ? "" : title, loading: x.wc.isLoading(), favicon: x.favicon, audible: x.wc.isCurrentlyAudible(), muted: x.muted, heard: x.wc.isCurrentlyAudible() && !x.wc.isAudioMuted() };
      });
    const cur = tabs.find((x) => x.id === t.id);
    return {
      url: cur.url,
      title: cur.title,
      loading: cur.loading,
      control: b.control,
      canGoBack: t.wc.navigationHistory.canGoBack(),
      canGoForward: t.wc.navigationHistory.canGoForward(),
      tabs,
      active: t.id,
      view: { ...b.view },
      muted: b.muted,
    };
  }

  /** The bot's browser with an active tab ready for the protocol. */
  /**
   * What meetings.cjs drives a call's tab with: page
   * functions in an isolated world of its own, the DevTools protocol, and
   * close. The bot's browser tools never act through it.
   */
  function tabHandle(b, t) {
    t.wc.debugger.on("message", (_e, method, params) => {
      if (method === "Page.frameNavigated" && params && params.frame && !params.frame.parentId) t.meetWorld = null;
    });
    const alive = () => !t.wc.isDestroyed();
    /** A meet-scripts page function in the tab's own isolated world. */
    async function evaluateIn(fn, arg) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!t.meetWorld) {
          const { frameTree } = await cdp(t, "Page.getFrameTree");
          t.meetWorld = (await cdp(t, "Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "fenna-meet-act" })).executionContextId;
        }
        try {
          const res = await cdp(t, "Runtime.evaluate", { expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`, contextId: t.meetWorld, returnByValue: true, awaitPromise: true });
          if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || "script error");
          return res.result.value;
        } catch (e) {
          if (attempt === 0 && /context|Execution/i.test(String(e && e.message))) {
            t.meetWorld = null;
            continue;
          }
          throw e;
        }
      }
      return null;
    }
    return {
      id: t.id,
      cdp: (method, params) => cdp(t, method, params),
      evaluate: evaluateIn,
      /** An expression in the page's own world (where the stage lives). */
      async main(expression) {
        const res = await cdp(t, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || "script error");
        return res.result.value;
      },
      url: () => (alive() ? t.wc.getURL() : ""),
      alive,
      waitForControl: () => waitForControl(b),
      close() {
        if (!alive()) return;
        t.win.destroy();
        dropTab(b, t.id);
        if (!b.tabs.length) newTab(b);
      },
    };
  }

  async function get(slug) {
    let b = all.get(slug);
    if (!b) {
      b = openBrowser(slug);
      all.set(slug, b);
    }
    if (!activeTab(b)) newTab(b);
    await activeTab(b).ready;
    return b;
  }

  async function tabOf(b) {
    const t = activeTab(b);
    if (!t || t.wc.isDestroyed()) throw new Error("The browser has no tab open. Use open to go somewhere.");
    await t.ready;
    return t;
  }

  const cdp = (t, method, params = {}) => t.wc.debugger.sendCommand(method, params);

  /** Run a page-scripts function in the bot's isolated world on the active tab. */
  async function evaluate(b, fn, arg) {
    const t = await tabOf(b);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!t.world) {
        const { frameTree } = await cdp(t, "Page.getFrameTree");
        const r = await cdp(t, "Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "fenna-crew" });
        t.world = r.executionContextId;
      }
      try {
        const r = await cdp(t, "Runtime.evaluate", { expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`, contextId: t.world, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(`The page refused to be read (${r.exceptionDetails.text || "script error"}). Try snapshot again.`);
        return r.result.value;
      } catch (e) {
        if (attempt === 0 && /context|Execution/i.test(String(e.message))) {
          t.world = null;
          continue;
        }
        throw e;
      }
    }
    return null;
  }

  async function waitLoad(b, ms = LOAD_TIMEOUT_MS) {
    const end = Date.now() + ms;
    await sleep(150);
    for (;;) {
      const t = activeTab(b);
      if (!t || t.wc.isDestroyed() || !t.wc.isLoading() || Date.now() >= end) break;
      await sleep(100);
    }
    await sleep(250);
  }

  function tabLine(b, x) {
    const t = b.tabs.find((y) => y.id === x.id);
    const title = t && !t.wc.isDestroyed() ? t.wc.getTitle() : "";
    const url = t && !t.wc.isDestroyed() ? t.wc.getURL() : "";
    return `${x.id === b.active ? "*" : " "} tab ${x.id}: ${blank(title) || title === url ? "(no title)" : title} (${blank(url) ? "empty" : url})`;
  }

  async function snapshotText(b) {
    const s = await evaluate(b, pageSnapshot, { maxChars: SNAPSHOT_CHARS });
    const head = [`Page: ${s.title || "(no title)"}`, `URL: ${s.url}`];
    if (b.tabs.length > 1) head.push(`Tab ${b.active} is active; ${b.tabs.length} tabs are open (call tabs to list them).`);
    if (s.height > s.view * 1.2) {
      const screens = Math.max(1, Math.ceil(s.height / s.view));
      const at = Math.min(100, Math.round((s.scrollY / Math.max(1, s.height - s.view)) * 100));
      head.push(`Scrolled ${at}% down a page ${screens} screens tall.`);
    }
    if (s.above) head.push(`(${s.above} parts above are left out; scroll up to read them.)`);
    const body = s.text || "(The page has no text or controls to read yet. If it is still loading, snapshot again.)";
    const tail = s.dropped ? `\n(… more below, cut to keep this short. Scroll down and snapshot again to read on.)` : "";
    return `${head.join("\n")}\n\n${body}${tail}`;
  }

  /** Point the person's view at where the bot acts, and give them a moment to see it. */
  async function cursor(b, x, y, action, target) {
    onCursor(b.slug, { slug: b.slug, tab: b.active, x, y, action, target });
    if (modeOf(b.slug) === "live") await sleep(220);
  }

  async function target(b, ref) {
    const t = await evaluate(b, pageTarget, ref);
    if (!t || t.error === "stale") throw new Error(`Ref ${ref} is not on the page any more (the page changed). Call snapshot for new refs.`);
    if (t.error === "hidden") throw new Error(`Ref ${ref} is hidden right now. Call snapshot to see what is on the page.`);
    return t;
  }

  async function mouseClick(b, x, y) {
    const t = await tabOf(b);
    await cdp(t, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await cdp(t, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await cdp(t, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  async function key(b, k) {
    const t = await tabOf(b);
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers: k.modifiers || 0 };
    await cdp(t, "Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}) });
    await cdp(t, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  const describeTarget = (t) => `${t.tag === "a" ? "link" : t.tag} “${t.name}”`;

  const where = (b) => ({ tab: b.active, url: activeTab(b) ? activeTab(b).wc.getURL() : "" });

  /** What changed after an action: a new tab, or a new page in this one. */
  async function changed(b, before) {
    await waitLoad(b, 10_000);
    const t = activeTab(b);
    if (!t) return " The tab closed; call tabs to see what is open.";
    const title = t.wc.getTitle() || "(no title)";
    if (b.active !== before.tab) return ` It opened tab ${b.active}, now active: ${title} (${t.wc.getURL()}); call snapshot before acting on it.`;
    const now = t.wc.getURL();
    return now !== before.url ? ` The page changed to ${title} (${now}); call snapshot before acting on it.` : "";
  }

  function tabById(b, id) {
    const t = b.tabs.find((x) => x.id === id);
    if (!t) throw new Error(`There is no tab ${id}. Open tabs: ${b.tabs.map((x) => x.id).join(", ") || "none"}. Call tabs to list them.`);
    return t;
  }

  const actions = {
    async open(b, p) {
      const a = webAddress(p.url);
      if (a.error) throw new Error(a.error);
      if (callLink(a.url)) throw new Error(`${a.url.href} is a video call. Join it with the meeting tool, {action: "join", url: "${a.url.href}"}; the browser tools never open a call.`);
      // One tab per site: sites like WhatsApp Web run in one tab only, and a second one takes the session from the first
      // (a watch keeps its site open in a tab of its own). An open site is switched to, not opened again.
      const same = otherSiteTab(b.tabs.map((x) => ({ id: x.id, origin: originOf(x), tab: x })), a.url.origin, b.active)?.tab;
      if (same) {
        setActive(b, same.id);
        await same.ready;
        // The site's front page keeps the tab as it is (a reload would sign some sites out); a page on it is opened there.
        const wantsPage = a.url.pathname !== "/" || a.url.search !== "";
        if (same.meeting) return { text: `Tab ${same.id} is your meeting on ${a.url.host}, so you're in that tab now. Use the meeting tool for the call; open other sites in a new tab.` };
        if (wantsPage && same.wc.getURL() !== a.url.href) {
          const r = await cdp(same, "Page.navigate", { url: a.url.href });
          if (r.errorText) throw new Error(`Couldn't open ${a.url.href}: ${r.errorText}. Check the address, or try again later.`);
          await waitLoad(b);
        }
        return { text: `${a.url.host} was already open in tab ${same.id}, so you're in that tab now (a site runs in one tab).\n${await snapshotText(b)}` };
      }
      // The meeting's tab stays on the call: anything else opens beside it.
      const onMeeting = !!activeTab(b)?.meeting;
      if (p.new_tab || onMeeting) {
        if (b.tabs.length >= MAX_TABS) throw new Error(`${MAX_TABS} tabs are open, the most a bot can have. Close one with close_tab (call tabs to see them), or open without new_tab to use this one.`);
        const t = newTab(b);
        await t.ready;
      }
      const t = await tabOf(b);
      await cursor(b, b.view.width / 2, 0, "open", a.url.host);
      const r = await cdp(t, "Page.navigate", { url: a.url.href });
      if (r.errorText) throw new Error(`Couldn't open ${a.url.href}: ${r.errorText}. Check the address, or try again later.`);
      await waitLoad(b);
      const lead = onMeeting ? `Opened in a new tab, tab ${b.active}, beside your meeting.\n` : p.new_tab ? `Opened in a new tab, tab ${b.active}.\n` : "";
      return { text: lead + (await snapshotText(b)) };
    },

    async snapshot(b) {
      return { text: await snapshotText(b) };
    },

    async click(b, p) {
      const t = await target(b, p.ref);
      if (t.disabled) throw new Error(`${describeTarget(t)} is disabled. Call snapshot to see what the page needs first.`);
      await cursor(b, t.x, t.y, "click", describeTarget(t));
      const before = where(b);
      await mouseClick(b, t.x, t.y);
      const covered = t.covered ? ` Something was on top of it (“${t.covered}”); if nothing happened, close that first.` : "";
      return { text: `Clicked ${describeTarget(t)}.${covered}${await changed(b, before)}` };
    },

    async type(b, p) {
      const t = await target(b, p.ref);
      if (t.password) throw new Error("That is a password or sign-in code field. Bots never type those: call logins, then sign_in (or fill_code for a code) and Crew fills it from the vault. If you have no login for this site, call ask_human to ask the person to take control and sign in.");
      if (t.payment) throw new Error("That is a payment field. Bots never type payment details: ask the person to take control and fill it in.");
      if (t.select) {
        const r = await evaluate(b, pageChoose, { ref: p.ref, text: p.text });
        if (r.error) throw new Error(`No option "${p.text}" in that list. Options: ${r.error.join(", ")}.`);
        await cursor(b, t.x, t.y, "type", describeTarget(t));
        return { text: `Chose “${r.chose}”.` };
      }
      if (!t.field) throw new Error(`Ref ${p.ref} is a ${t.tag}, not a field you can type in. Click it, or snapshot to find the field.`);
      await cursor(b, t.x, t.y, "type", describeTarget(t));
      await mouseClick(b, t.x, t.y);
      await evaluate(b, pageSelectAll, p.ref);
      const text = String(p.text || "");
      if (text) await cdp(await tabOf(b), "Input.insertText", { text });
      else await key(b, KEYS.backspace);
      if (!p.submit) return { text: `Typed into ${describeTarget(t)}.` };
      const before = where(b);
      await key(b, KEYS.enter);
      return { text: `Typed into ${describeTarget(t)} and pressed Enter.${await changed(b, before)}` };
    },

    async press(b, p) {
      const k = parseKey(p.key);
      if (k.error) throw new Error(k.error);
      onCursor(b.slug, { slug: b.slug, tab: b.active, x: b.view.width / 2, y: b.view.height / 2, action: "press", target: String(p.key) });
      const before = where(b);
      await key(b, k);
      return { text: `Pressed ${p.key}.${await changed(b, before)}` };
    },

    async scroll(b, p) {
      if (p.ref) {
        const t = await target(b, p.ref);
        await cursor(b, t.x, t.y, "scroll", describeTarget(t));
      } else {
        const x = b.view.width / 2;
        const y = b.view.height / 2;
        await cursor(b, x, y, "scroll", p.direction === "up" ? "up" : "down");
        const screens = Math.max(0.25, Math.min(20, Number(p.screens) || 1));
        await cdp(await tabOf(b), "Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: (p.direction === "up" ? -1 : 1) * screens * b.view.height * 0.85 });
        await sleep(350);
      }
      const s = await evaluate(b, pageScroll);
      const max = Math.max(1, s.height - s.view);
      const at = Math.min(100, Math.round((s.scrollY / max) * 100));
      const edge = s.scrollY <= 0 ? " That is the top." : s.scrollY >= max - 2 ? " That is the bottom." : "";
      return { text: `Now ${at}% down the page.${edge} Call snapshot to read what is here.` };
    },

    async back(b) {
      const t = await tabOf(b);
      const h = await cdp(t, "Page.getNavigationHistory");
      if (h.currentIndex <= 0) throw new Error("There is no page to go back to in this tab. Use open to go somewhere.");
      await cdp(t, "Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex - 1].id });
      await waitLoad(b);
      return { text: await snapshotText(b) };
    },

    async screenshot(b) {
      const t = await tabOf(b);
      if (await evaluate(b, pageSecretShown).catch(() => false)) {
        throw new Error("A password or code Crew filled shows as text on this page right now, so no screenshot is taken. Use snapshot to read the page.");
      }
      const wasPainting = t.wc.isPainting();
      if (!wasPainting) t.wc.startPainting();
      try {
        const r = await cdp(t, "Page.captureScreenshot", { format: "jpeg", quality: 60 });
        return { text: `What tab ${t.id} shows now (${b.view.width}×${b.view.height}). Use refs from snapshot to act on it.`, image: { data: r.data, mimeType: "image/jpeg" } };
      } finally {
        if (!wasPainting) t.wc.stopPainting();
      }
    },

    async notifications(b) {
      if (!b.notices.length) return { text: "No notifications yet." };
      return { text: b.notices.map((n) => `${n.at}  ${n.origin}  ${n.title} — ${n.body}`).join("\n") };
    },

    async tabs(b) {
      const live = b.tabs.filter((x) => !x.wc.isDestroyed());
      return { text: `${live.length} of at most ${MAX_TABS} tabs open; * is the active one, which every other tool acts on.\n${live.map((x) => tabLine(b, x)).join("\n")}` };
    },

    async switch_tab(b, p) {
      const t = tabById(b, Number(p.tab));
      setActive(b, t.id);
      await t.ready;
      return { text: `Switched to tab ${t.id}.\n${await snapshotText(b)}` };
    },

    async close_tab(b, p) {
      const id = p.tab === undefined || p.tab === null ? b.active : Number(p.tab);
      const t = tabById(b, id);
      if (t.meeting) throw new Error(`Tab ${id} is your meeting. To leave the call, use the meeting tool: {action: "leave"}.`);
      t.win.destroy();
      dropTab(b, id);
      if (!b.tabs.length) newTab(b);
      const cur = activeTab(b);
      await cur.ready;
      const title = cur.wc.getTitle();
      const url = cur.wc.getURL();
      return { text: `Closed tab ${id}. Tab ${cur.id} is active: ${blank(title) || title === url ? "(no title)" : title} (${blank(url) ? "empty" : url}). Call snapshot to read it.` };
    },
  };

  const FILL_ERRORS = {
    stale: (r) => `Ref ${r.ref} is not on the page any more. Call snapshot for new refs, or leave the refs out and Crew finds the fields.`,
    notPassword: (r) => `Ref ${r.ref} is not a password field. Leave password_ref out and Crew finds it.`,
    notText: (r) => `Ref ${r.ref} is not a field Crew can fill. Call snapshot, or leave the ref out and Crew finds the field.`,
  };

  /** A fill refused because the page is not on the login's origin; says where it is. */
  const originError = (expected, actual) => Object.assign(new Error(`origin`), { code: "origin", expected, actual });

  /** Press the form's submit button (or Enter), and say what changed. */
  async function submitForm(b, button) {
    const before = where(b);
    if (button) {
      await cursor(b, button.x, button.y, "click", `button “${button.name}”`);
      await mouseClick(b, button.x, button.y);
    } else await key(b, KEYS.enter);
    return changed(b, before);
  }

  async function waitForControl(b) {
    const end = Date.now() + controlWaitMs;
    while (b.control && Date.now() < end) await sleep(250);
    if (b.control) throw new Error(CONTROL_MESSAGE);
  }

  /** The person's view of this bot's browser went away: back to the default size soon. */
  function scheduleDefault(b) {
    clearTimeout(b.defaultTimer);
    b.defaultTimer = setTimeout(() => {
      if (modeOf(b.slug) !== "live") resize(b, DEFAULT_VIEW);
    }, DEFAULT_AFTER_MS);
  }

  /**
   * A small picture of the active tab after a bot action, for the replay. It
   * is painted offscreen only for the moment it takes, and never while a
   * filled secret shows (no picture then). Never throws: the action is done.
   */
  async function captureStep(b, action) {
    try {
      if (!stepGates.has(b.slug)) stepGates.set(b.slug, rateLimiter(1, STEP_GAP_MS));
      if (!stepGates.get(b.slug)()) return;
      const t = activeTab(b);
      if (!t || t.wc.isDestroyed()) return;
      if (await evaluate(b, pageSecretShown).catch(() => true)) return;
      const at = new Date().toISOString();
      const url = t.wc.getURL();
      const wasPainting = t.wc.isPainting();
      if (!wasPainting) t.wc.startPainting();
      let img = null;
      try {
        img = await Promise.race([t.wc.capturePage(), sleep(STEP_CAPTURE_MS).then(() => null)]);
      } finally {
        if (!wasPainting && !t.wc.isDestroyed()) t.wc.stopPainting();
      }
      if (!img || img.isEmpty()) return;
      const jpeg = img.resize({ width: STEP_WIDTH }).toJPEG(STEP_JPEG_QUALITY);
      onStep(b.slug, { at, action, url: blank(url) ? "" : url, jpeg });
    } catch {
      /* no picture this time: the action itself has already happened */
    }
  }

  async function forPerson(slug) {
    const b = await get(slug);
    if (!b.control) throw new Error("Take control of the browser first.");
    return b;
  }

  return {
    /** A bot's browser tool call. */
    async act(slug, method, params) {
      const fn = Object.prototype.hasOwnProperty.call(actions, method) ? actions[method] : null;
      if (!fn) throw new Error(`Unknown browser action "${method}".`);
      const b = await get(slug);
      await waitForControl(b);
      const result = await fn(b, params || {});
      if (b.control) throw new Error(CONTROL_MESSAGE);
      if (STEP_ACTIONS.has(method)) await captureStep(b, method);
      tell(b);
      // Downloads that finished (or failed) since the last call are said in this result.
      const news = downloadNews(b);
      return news.length ? { ...result, text: `${result.text}\n\n${news.join("\n")}` } : result;
    },

    /** The active tab's address, once the person has given control back. Opens the browser if it isn't. */
    async page(slug) {
      const b = await get(slug);
      await waitForControl(b);
      const t = await tabOf(b);
      return { url: t.wc.getURL(), title: t.wc.getTitle() };
    },

    /**
     * Fill a vault login into the active tab and optionally submit, only if
     * the page is on `origin` (checked inside the page, in the same step as
     * the fill). Throws an error with code "origin" when it isn't.
     */
    async fillLogin(slug, { origin, username, password, usernameRef = null, passwordRef = null, submit = false }) {
      const b = await get(slug);
      await waitForControl(b);
      const r = await evaluate(b, pageFillLogin, { origin, username, password, usernameRef, passwordRef });
      if (r.error === "origin") throw originError(origin, r.origin);
      if (r.error === "none") throw new Error("This page has no username or password field Crew can see. Call snapshot: if the sign-in form is behind a button, click it first; then call sign_in again with the field refs.");
      if (r.error) throw new Error(FILL_ERRORS[r.error](r));
      const after = submit ? await submitForm(b, r.button) : "";
      if (b.control) throw new Error(CONTROL_MESSAGE);
      tell(b);
      return { filledUser: r.filledUser, filledPassword: r.filledPassword, submitted: !!submit, button: r.button ? r.button.name : null, changed: after };
    },

    /** Fill a sign-in code into the active tab (by ref, or its code field), only if the page is on `origin`. */
    async fillCode(slug, { origin, code, ref = null, submit = false }) {
      const b = await get(slug);
      await waitForControl(b);
      const r = await evaluate(b, pageFillCode, { origin, code, ref });
      if (r.error === "origin") throw originError(origin, r.origin);
      if (r.error === "none") throw new Error("Crew can't tell which field takes the code. Call snapshot and give its ref.");
      if (r.error) throw new Error(FILL_ERRORS[r.error](r));
      const after = submit ? await submitForm(b, r.button) : "";
      if (b.control) throw new Error(CONTROL_MESSAGE);
      tell(b);
      return { submitted: !!submit, changed: after };
    },

    /** The site notifications this bot's browser showed, newest first (the last 50). */
    notifications(slug) {
      const b = all.get(slug);
      return b ? b.notices.slice() : [];
    },

    /**
     * The text of a page, loaded in a hidden window in the bot's own session
     * (its sign-ins apply). Throws if it isn't loaded in 30 seconds.
     */
    async pageText(slug, url) {
      const a = webAddress(url);
      if (a.error) throw new Error(a.error);
      sessionOf(slug);
      const win = new BrowserWindow({ show: false, width: DEFAULT_VIEW.width, height: DEFAULT_VIEW.height, webPreferences: { partition: `persist:crew-${slug}`, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      const wc = win.webContents;
      wc.setWindowOpenHandler(() => ({ action: "deny" }));
      const load = (async () => {
        await wc.loadURL(a.url.href).catch((e) => {
          throw new Error(`Couldn't load ${a.url.href}: ${e.message}. Check the address, or try again later.`);
        });
        await sleep(PAGE_TEXT_SETTLE_MS);
        const text = await wc.executeJavaScript("document.body ? document.body.innerText : ''");
        return String(text || "").trim().slice(0, PAGE_TEXT_CAP);
      })();
      let timer = null;
      const late = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Couldn't load ${a.url.href} in 30 seconds.`)), PAGE_TEXT_MS);
      });
      try {
        return await Promise.race([load, late]);
      } finally {
        clearTimeout(timer);
        if (!win.isDestroyed()) win.destroy();
      }
    },

    /**
     * Watch one element of the active tab, by a ref from its latest snapshot.
     * Its text is reported through onElementChange when it changes.
     */
    async watchElement(slug, { id, ref }) {
      const b = await get(slug);
      await waitForControl(b);
      const t = await tabOf(b);
      if (!id) throw new Error("A watch needs an id.");
      const r = await evaluate(b, pageWatchTarget, ref);
      if (r.error === "stale") throw new Error(`No element with ref ${ref} on the page. Call snapshot again and use a ref from it.`);
      if (r.error === "unreachable") throw new Error(`Ref ${ref} can't be found again by its address on this page. Call snapshot and watch a different element.`);
      await forgetWatch(b, id);
      const rec = { id, origin: r.origin, url: r.url, selector: r.selector, last: r.text, tabId: null, timer: null, retryUntil: Date.now() + WATCH_RETRY_WINDOW_MS };
      b.elementWatches.set(id, rec);
      await runWatch(b, rec, t);
      return { origin: r.origin, url: r.url, selector: r.selector, text: r.text };
    },

    /**
     * Start watching an element an earlier watch named (Crew does this when it
     * starts, and it is kept when the tab navigates): on an open tab of its
     * origin, or in a new background tab at its address.
     */
    async armElement(slug, { id, origin, url, selector }) {
      const a = webAddress(url);
      if (a.error) throw new Error(a.error);
      if (!id || !origin || !selector) throw new Error("A watch needs its id, origin and selector.");
      const b = await get(slug);
      await forgetWatch(b, id);
      const rec = { id, origin, url: a.url.href, selector, last: "", tabId: null, timer: null, retryUntil: Date.now() + WATCH_RETRY_WINDOW_MS };
      b.elementWatches.set(id, rec);
      const open = b.tabs.find((x) => originOf(x) === origin);
      if (open) {
        await open.ready;
        await runWatch(b, rec, open);
        return { tab: open.id };
      }
      if (b.tabs.length >= MAX_TABS) throw new Error(`${MAX_TABS} tabs are open, the most a bot can have, so Crew can't open ${a.url.href} to watch it. Close a tab, then watch again.`);
      const t = newTab(b, { activate: false });
      await t.ready;
      t.wc.loadURL(a.url.href).catch(() => {});
      return { tab: t.id };
    },

    /**
     * A notification watch hears a site only while one of the bot's tabs is on
     * it: open the site in a background tab unless one already is. Returns
     * whether it opened one.
     */
    async keepSite(slug, origin) {
      const a = webAddress(origin);
      if (a.error) throw new Error(a.error);
      const b = await get(slug);
      if (b.tabs.some((x) => originOf(x) === a.url.origin)) return { opened: false };
      if (b.tabs.length >= MAX_TABS) throw new Error(`${MAX_TABS} tabs are open, the most a bot can have, so Crew can't keep ${a.url.origin} open to hear it. Close a tab.`);
      const t = newTab(b, { activate: false });
      await t.ready;
      t.wc.loadURL(`${a.url.origin}/`).catch(() => {});
      return { opened: true };
    },

    /** Whether one of the bot's tabs is on this site now (without opening the browser). */
    hasSite(slug, origin) {
      const b = all.get(slug);
      return !!b && b.tabs.some((x) => originOf(x) === origin);
    },

    /** Stop a watch: the page's observer goes too. */
    async unwatchElement(slug, id) {
      const b = all.get(slug);
      if (b) await forgetWatch(b, id);
    },

    /** The browser's state, or null if it hasn't been opened. */
    state(slug) {
      const b = all.get(slug);
      return b && b.tabs.length ? stateOf(b) : null;
    },

    /** A page watches a bot's screen. "live" opens the browser if needed; "thumb" only watches an open one. */
    async watch(slug, watcherId, mode) {
      const w = watchers.get(slug) || new Map();
      if (mode === "off") w.delete(watcherId);
      else w.set(watcherId, mode);
      if (w.size) watchers.set(slug, w);
      else watchers.delete(slug);
      const b = mode === "live" ? await get(slug) : all.get(slug);
      if (!b) return stateOf(null);
      if (modeOf(slug) === "live") {
        clearTimeout(b.defaultTimer);
        if (wanted.has(slug)) resize(b, wanted.get(slug));
      } else scheduleDefault(b);
      applyMode(b);
      return stateOf(b);
    },

    /**
     * The size of the person's view of a bot's screen (CSS pixels, and the
     * screen's pixel ratio). Used while someone watches live; new tabs paint
     * at that pixel ratio.
     */
    setViewport(slug, view) {
      const v = viewOf(view);
      if (!v) return;
      wanted.set(slug, v);
      const b = all.get(slug);
      if (!b) return;
      if (v.scale) b.scale = v.scale;
      if (modeOf(slug) !== "live") return;
      resize(b, v);
      // The view (and its canvas) just appeared or changed: paint it now, even if the page hasn't changed.
      const t = activeTab(b);
      if (t && !t.wc.isDestroyed()) {
        try {
          t.wc.setZoomFactor(1);
          t.wc.setVisualZoomLevelLimits(1, 1);
        } catch (_) {}
        t.wc.invalidate();
      }
    },

    /** Forget a page that went away (closed or reloaded). */
    dropWatcher(watcherId) {
      for (const [slug, p] of present) {
        if (!p.delete(watcherId)) continue;
        if (!p.size) present.delete(slug);
        const b = all.get(slug);
        if (b) {
          applyAudio(b);
          tell(b);
        }
      }
      for (const [slug, w] of watchers) {
        if (!w.delete(watcherId)) continue;
        if (!w.size) watchers.delete(slug);
        const b = all.get(slug);
        if (!b) continue;
        if (modeOf(slug) !== "live") scheduleDefault(b);
        applyMode(b);
      }
    },

    /** A page opened (or left) a bot's computer: its sound is heard only while it is open. */
    setPresent(slug, watcherId, on) {
      const p = present.get(slug) || new Set();
      if (on) p.add(watcherId);
      else p.delete(watcherId);
      if (p.size) present.set(slug, p);
      else present.delete(slug);
      const b = all.get(slug);
      if (b) {
        applyAudio(b);
        tell(b);
      }
    },

    /** The window the person watches in was shown, or hidden (tray) or minimized: no sound while they can't see it. */
    setHostVisible(visible) {
      hostVisible = !!visible;
      for (const b of all.values()) {
        applyAudio(b);
        tell(b);
      }
    },

    /** The person mutes or unmutes one tab (id) or the whole bot (id null). Works while only watching. */
    setMuted(slug, id, muted) {
      const b = all.get(slug);
      if (!b) throw new Error("That bot's browser isn't open.");
      if (id === null) b.muted = !!muted;
      else tabById(b, id).muted = !!muted;
      applyAudio(b);
      tell(b);
      return stateOf(b);
    },

    /** Pause every video and sound in the bot's tabs (its run was stopped). */
    stopMedia(slug) {
      const b = all.get(slug);
      if (!b) return;
      for (const t of b.tabs) {
        if (t.wc.isDestroyed()) continue;
        for (const frame of t.wc.mainFrame.framesInSubtree) {
          frame.executeJavaScript("for (const m of document.querySelectorAll('video, audio')) m.pause();").catch(() => {});
        }
      }
    },

    async setControl(slug, on) {
      const b = await get(slug);
      b.control = !!on;
      if (on) activeTab(b).wc.focus();
      // A password form the person sends while in control can be saved to the vault.
      await Promise.all(b.tabs.map((t) => (on ? arm(t) : disarm(t))));
      tell(b);
      return stateOf(b);
    },

    /** The person's mouse or key, only while they have control. */
    input(slug, ev) {
      const b = all.get(slug);
      const t = b && activeTab(b);
      if (!b || !t || !b.control || t.wc.isDestroyed()) return;
      const e = toElectronInput(ev, b.view);
      if (!e) return;
      if (e.type === "keyDown" || e.type === "mouseDown") t.wc.focus();
      t.wc.sendInputEvent(e);
    },

    /** The person goes to an address in the active tab, while they have control. */
    async navigate(slug, url) {
      const b = await forPerson(slug);
      const a = webAddress(url);
      if (a.error) throw new Error(a.error);
      activeTab(b).wc.loadURL(a.url.href).catch(() => {});
      await sleep(100);
      return stateOf(b);
    },

    /** Back, forward, reload, or stop loading, in the active tab, while the person has control. */
    async history(slug, what) {
      const b = await forPerson(slug);
      const wc = activeTab(b).wc;
      if (what === "back" && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      else if (what === "forward" && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      else if (what === "reload") wc.reload();
      else if (what === "stop") wc.stop();
      await sleep(100);
      return stateOf(b);
    },

    /** The person opens, switches to or closes a tab, while they have control. */
    async tab(slug, action, id) {
      const b = await forPerson(slug);
      if (action === "new") {
        if (b.tabs.length >= MAX_TABS) throw new Error(`${MAX_TABS} tabs are open, the most a bot's browser can have. Close one first.`);
        await newTab(b).ready;
      } else if (action === "switch") {
        setActive(b, tabById(b, id).id);
      } else if (action === "close") {
        tabById(b, id).win.destroy();
        dropTab(b, id);
        if (!b.tabs.length) await newTab(b).ready;
      } else throw new Error('A tab action is "new", "switch" or "close".');
      activeTab(b).wc.focus();
      return stateOf(b);
    },

    /**
     * A tab for a call (meetings.cjs): a new active tab whose bindings and
     * scripts are in place before the page loads, then `url`. Binding calls
     * come to onBinding; onGone runs once when the tab closes, whoever
     * closes it. The bot's browser tools never navigate it or close it.
     * @returns {Promise<{ id: number, cdp: Function, evaluate: Function, main: Function, url: () => string, close: () => void, alive: () => boolean }>}
     */
    async openMeeting(slug, { url, bindings = [], scripts = [], onBinding = () => {}, onGone = () => {} }) {
      const b = await get(slug);
      await waitForControl(b);
      if (b.tabs.some((x) => x.meeting && !x.wc.isDestroyed())) throw new Error("You are already in a meeting. Leave it first.");
      // A plain tab on the call's site (one the person opened, or a join done by hand) would put the bot in the call twice.
      const origin = new URL(url).origin;
      for (const x of b.tabs.filter((x) => !x.meeting && originOf(x) === origin)) {
        if (!x.win.isDestroyed()) x.win.destroy();
        dropTab(b, x.id);
      }
      if (b.tabs.length >= MAX_TABS) throw new Error(`${MAX_TABS} tabs are open, the most a bot can have. Close one with close_tab first.`);
      const t = newTab(b);
      t.meeting = true;
      await t.ready;
      const names = new Set(bindings.map((x) => x.name));
      t.wc.debugger.on("message", (_e, method, params) => {
        if (method === "Runtime.bindingCalled" && params && names.has(params.name)) onBinding(params.name, String(params.payload || ""));
      });
      t.wc.once("destroyed", () => onGone());
      for (const x of bindings) await cdp(t, "Runtime.addBinding", x);
      for (const s of scripts) await cdp(t, "Page.addScriptToEvaluateOnNewDocument", s);
      const r = await cdp(t, "Page.navigate", { url });
      if (r.errorText) {
        t.win.destroy();
        throw new Error(`Couldn't open ${url}: ${r.errorText}.`);
      }
      tell(b);
      return tabHandle(b, t);
    },

    close(slug) {
      const b = all.get(slug);
      all.delete(slug);
      watchers.delete(slug);
      wanted.delete(slug);
      if (!b) return;
      clearTimeout(b.defaultTimer);
      clearTimeout(b.trailing);
      for (const rec of b.elementWatches.values()) clearTimeout(rec.timer);
      b.elementWatches.clear();
      for (const t of [...b.tabs]) if (!t.win.isDestroyed()) t.win.destroy();
      onState(slug, stateOf(null));
    },

    closeAll() {
      for (const slug of [...all.keys()]) this.close(slug);
    },
  };
}

module.exports = { createBrowsers, otherSiteTab, unreadCount, parseKey, toElectronInput, viewOf, webAddress, safeDownloadName, uniqueName, overCap, downloadRoom, tooBigText, sizeText, rateLimiter, pushCapped, clipText, KEEP_FREE, MAX_TABS, DEFAULT_VIEW, NOTIFY_PER_MINUTE, NOTICES_KEPT, NOTIFY_TEXT_CAP };
