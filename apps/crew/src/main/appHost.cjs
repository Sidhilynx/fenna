// The bot's own use of its apps: each app it opens runs in a hidden window in
// this process, with the app's session and preload (apps.cjs), so the bot can
// test it and call its tools whether or not anyone is watching. The bot drives
// the page with the page scripts its browser uses (page-scripts.cjs), over the
// DevTools protocol (webContents.debugger), and reads what the page logs and
// what breaks in it. Windows close after 10 minutes unused, at most 3 per bot,
// and all of a bot's when it is deleted.

const { BrowserWindow } = require("electron");
const { pageSnapshot, pageTarget, pageSelectAll } = require("./page-scripts.cjs");

const MAX_PER_BOT = 3;
const IDLE_MS = 10 * 60_000;
const CALL_MS = 10_000;
const RESULT_MAX = 64 * 1024;
const LOAD_MS = 15_000;
/** How long a tool call waits for the page to define the tool after it loads, and how often it looks. */
const DEFINE_WAIT_MS = 5000;
const DEFINE_POLL_MS = 100;
const ERRORS_KEPT = 20;
const LINE_MAX = 300;
const SNAPSHOT_CHARS = 14_000;
const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
const WORLD = "crew-app";

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
  return { error: `"${last}" is not a key press knows. Keys: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, PageUp, PageDown, Home, End, Space, or a letter or digit.` };
}

const clip = (s, n = LINE_MAX) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

const withTimeout = (p, ms, message) => {
  let timer;
  return Promise.race([p, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))]).finally(() => clearTimeout(timer));
};

const keyOf = (slug, name) => `${slug}/${name}`;

/**
 * @param {object} o
 * @param {{ list(slug: string): object[], manifest(slug: string, name: string): { app: object|null, problems: string[] }, session(slug: string, name: string): object, preloadPath: string, callTool(wc: object, name: string, input: object, opts?: object): Promise<unknown>, toolsOf(wc: object): string[] }} o.apps
 * @param {(channel: string, payload: unknown) => void} [o.broadcast]
 * @param {new (opts: object) => object} [o.BrowserWindow]
 */
function createAppHost({ apps, broadcast = () => {}, BrowserWindow: Win = BrowserWindow, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  /** "slug/name" → an open app: { slug, name, win, wc, errors, world, crashed, idle }. */
  const live = new Map();

  const missing = (slug, name) => {
    const names = apps.list(slug).map((a) => a.name);
    return `No app named "${name}". Apps: ${names.join(", ") || "none"}. Make one with write_file at Files/Apps/${name}/app.json.`;
  };

  /** The app's name from the call; with none, the only app open. */
  function nameFor(slug, name) {
    if (name !== undefined && name !== null && name !== "") {
      const n = String(name);
      if (!NAME_RE.test(n)) throw new Error(`An app's name is lowercase letters, digits and dashes, like notes-board. Got "${clip(n, 40)}".`);
      return n;
    }
    const open = [...live.values()].filter((i) => i.slug === slug);
    if (open.length === 1) return open[0].name;
    if (!open.length) throw new Error(`No app is open. Open one with app {action: "open", name: "…"}. Apps: ${apps.list(slug).map((a) => a.name).join(", ") || "none"}.`);
    throw new Error(`Say which app: name. Open: ${open.map((i) => i.name).join(", ")}.`);
  }

  function touch(inst) {
    clearTimeout(inst.idle);
    inst.idle = setTimeout(() => close(inst.slug, inst.name), IDLE_MS);
    inst.idle.unref?.();
  }

  function create(slug, name) {
    const win = new Win({
      show: false,
      width: 1000,
      height: 700,
      webPreferences: {
        session: apps.session(slug, name),
        preload: apps.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    const wc = win.webContents;
    const inst = { slug, name, win, wc, errors: [], world: null, crashed: null, idle: null };
    const fail = (line) => {
      if (inst.errors.length < ERRORS_KEPT) inst.errors.push(clip(line));
    };
    const inApp = (source) => String(source || "").replace(`crewapp://${slug}/${name}/`, "");
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (e, url) => {
      if (!String(url).startsWith(`crewapp://${slug}/${name}/`)) e.preventDefault();
    });
    // Electron 35+ passes one event object; older versions pass (event, level, message, line, source).
    wc.on("console-message", (...args) => {
      const first = args[0];
      const m = first && typeof first === "object" && "message" in first ? first : { level: args[1], message: args[2], lineNumber: args[3], sourceId: args[4] };
      const warn = m.level === "warning" || m.level === 2;
      if (!warn && m.level !== "error" && m.level !== 3) return;
      const where = m.sourceId ? ` (${inApp(m.sourceId)}:${m.lineNumber})` : "";
      fail(`${warn ? "warning" : "error"}: ${m.message}${where}`);
    });
    wc.on("did-fail-load", (_e, code, desc, url, isMain) => {
      if (isMain && code !== -3) fail(`The page did not load: ${desc} (${inApp(url) || url}).`);
    });
    wc.on("render-process-gone", (_e, details) => {
      inst.crashed = (details && details.reason) || "unknown";
      fail(`The page crashed (${inst.crashed}).`);
    });
    wc.on("did-navigate", () => {
      inst.world = null;
    });
    return inst;
  }

  /** Start the app (or reload it, so an edit to its files shows), wait for the page, and return it. */
  async function start(slug, name) {
    const { app, problems } = apps.manifest(slug, name);
    if (!app) throw new Error(missing(slug, name));
    const key = keyOf(slug, name);
    let inst = live.get(key);
    if (!inst) {
      const mine = [...live.values()].filter((i) => i.slug === slug);
      if (mine.length >= MAX_PER_BOT) throw new Error(`${MAX_PER_BOT} apps are already open for this bot: ${mine.map((i) => i.name).join(", ")}. Close one with app {action: "close", name: "…"} first.`);
      inst = create(slug, name);
      live.set(key, inst);
    }
    inst.errors = [];
    inst.crashed = null;
    inst.world = null;
    const url = `crewapp://${slug}/${name}/${app.entry}`;
    try {
      await withTimeout(inst.win.loadURL(url), LOAD_MS, `${name} did not finish loading in 15 seconds. Its scripts may wait on something that never comes.`);
    } catch (e) {
      if (!inst.errors.length) inst.errors.push(clip(e.message));
    }
    touch(inst);
    return { inst, app, problems };
  }

  /** The open instance, or an error that says how to open it. */
  function liveOf(slug, name) {
    const n = nameFor(slug, name);
    const inst = live.get(keyOf(slug, n));
    if (!inst) throw new Error(`${n} is not open. Call app with action open first.`);
    if (inst.crashed) throw new Error(`${n}'s page crashed (${inst.crashed}). Call app with action open to start it again.`);
    touch(inst);
    return inst;
  }

  const cdp = (inst, method, params = {}) => inst.wc.debugger.sendCommand(method, params);

  /** Run a page-scripts function in the app's isolated world. */
  async function evaluate(inst, fn, arg) {
    if (!inst.wc.debugger.isAttached()) {
      inst.wc.debugger.attach("1.3");
      await cdp(inst, "Page.enable");
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!inst.world) {
        const { frameTree } = await cdp(inst, "Page.getFrameTree");
        const r = await cdp(inst, "Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: WORLD });
        inst.world = r.executionContextId;
      }
      try {
        const r = await cdp(inst, "Runtime.evaluate", { expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`, contextId: inst.world, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(`The page refused to be read (${r.exceptionDetails.text || "script error"}). Try snapshot again.`);
        return r.result.value;
      } catch (e) {
        if (attempt === 0 && /context|Execution/i.test(String(e.message))) {
          inst.world = null;
          continue;
        }
        throw e;
      }
    }
    return null;
  }

  async function snapshotText(inst) {
    const s = await evaluate(inst, pageSnapshot, { maxChars: SNAPSHOT_CHARS });
    if (!s) return "(The page has no text or controls to read yet.)";
    const body = s.text || "(The page has no text or controls to read yet. If it is still loading, snapshot again.)";
    const tail = s.dropped ? "\n(… more below, cut to keep this short.)" : "";
    return `Page: ${s.title || "(no title)"}\n\n${body}${tail}`;
  }

  async function target(inst, ref) {
    const t = await evaluate(inst, pageTarget, ref);
    if (!t || t.error === "stale") throw new Error(`Ref ${ref} is not on the page any more. Call app with action snapshot for new refs.`);
    if (t.error === "hidden") throw new Error(`Ref ${ref} is hidden right now. Call app with action snapshot to see what is on the page.`);
    return t;
  }

  async function mouseClick(inst, x, y) {
    await cdp(inst, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await cdp(inst, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await cdp(inst, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  async function pressKey(inst, k) {
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers: k.modifiers || 0 };
    await cdp(inst, "Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}) });
    await cdp(inst, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  /** Give the page a moment to react before the bot reads it again. */
  const settle = () => new Promise((r) => setTimeout(r, 150));

  /** Stop an app's window (the bot's close, the idle timer, or the bot's deletion). */
  function close(slug, name) {
    const key = keyOf(slug, name);
    const inst = live.get(key);
    if (!inst) return false;
    live.delete(key);
    clearTimeout(inst.idle);
    if (!inst.win.isDestroyed()) inst.win.destroy();
    return true;
  }

  /** Call one of an app's tools, opening the app first if it isn't. Resolves to the JSON text of its result. */
  async function callTool(slug, name, tool, input = {}) {
    const { app } = apps.manifest(slug, name);
    if (!app) throw new Error(missing(slug, name));
    if (!(app.tools || []).some((t) => t.name === tool)) throw new Error(`${name} has no tool "${clip(tool, 40)}". Its tools: ${(app.tools || []).map((t) => t.name).join(", ") || "none"}.`);
    let inst = live.get(keyOf(slug, name));
    if (!inst || inst.crashed) {
      if (inst) close(slug, name);
      inst = (await start(slug, name)).inst;
    }
    touch(inst);
    // A page often defines its tools after it loads (after reading its data), so give it a moment.
    for (let waited = 0; waited < DEFINE_WAIT_MS && !apps.toolsOf(inst.wc).includes(tool) && !inst.crashed; waited += DEFINE_POLL_MS) await sleep(DEFINE_POLL_MS);
    if (!apps.toolsOf(inst.wc).includes(tool)) throw new Error(`${name}'s page does not define the tool "${tool}". Check that its script calls crew.tools.define("${tool}", …) and that it loads without errors.`);
    const result = await withTimeout(apps.callTool(inst.wc, tool, input, { timeoutMs: CALL_MS }), CALL_MS, `${name}'s tool "${tool}" did not answer within 10 seconds. Check it for loops or for waits that never end.`).catch((e) => {
      if (/did not answer within 10 seconds/.test(e.message)) throw e;
      throw new Error(`${name}'s tool "${tool}" failed: ${clip(e.message, 500)}`);
    });
    const json = JSON.stringify(result === undefined ? null : result) ?? "null";
    const size = Buffer.byteLength(json);
    if (size > RESULT_MAX) throw new Error(`${name}'s tool "${tool}" returned ${Math.ceil(size / 1024)} KB; the limit is 64 KB. Return less, such as one page of rows.`);
    touch(inst);
    return json;
  }

  const listText = (slug) => {
    const all = apps.list(slug);
    if (!all.length) return "No apps yet. Make one with write_file at Files/Apps/<name>/app.json (see the app tool's description for the format).";
    const lines = [`${all.length} app${all.length === 1 ? "" : "s"}:`];
    for (const a of all) {
      const state = !a.grant ? "waiting for the person to allow its permissions (install card)" : a.pending ? "waiting for the person to allow its new permissions" : "granted";
      const tools = a.tools.length ? a.tools.map((t) => t.name).join(", ") : "none";
      lines.push(`- ${a.name} (${a.title || a.name}): ${state}. Tools: ${tools}.`);
      for (const p of a.problems) lines.push(`  Problem: ${clip(p, 300)}`);
    }
    return lines.join("\n");
  };

  const actions = {
    click: async (inst, ref) => {
      const t = await target(inst, ref);
      if (t.disabled) throw new Error(`${t.tag} “${t.name}” is disabled. Call app with action snapshot to see what the page needs first.`);
      await mouseClick(inst, t.x, t.y);
      await settle();
      const covered = t.covered ? ` Something was on top of it (“${t.covered}”); if nothing happened, close that first.` : "";
      return `Clicked ${t.tag} “${t.name}”.${covered} Call app with action snapshot to see the result.`;
    },

    type: async (inst, ref, text, submit) => {
      const t = await target(inst, ref);
      if (t.password || t.payment) throw new Error("A bot never types passwords or payment details into an app.");
      if (!t.field) throw new Error(`Ref ${ref} is a ${t.tag}, not a field you can type in. Click it, or snapshot to find the field.`);
      await mouseClick(inst, t.x, t.y);
      await evaluate(inst, pageSelectAll, ref);
      if (text) await cdp(inst, "Input.insertText", { text });
      else await pressKey(inst, KEYS.backspace);
      if (submit) await pressKey(inst, KEYS.enter);
      await settle();
      return `Typed into ${t.tag} “${t.name}”${submit ? " and pressed Enter" : ""}. Call app with action snapshot to see the result.`;
    },

    press: async (inst, key) => {
      const k = parseKey(key);
      if (k.error) throw new Error(k.error);
      await pressKey(inst, k);
      await settle();
      return `Pressed ${key}. Call app with action snapshot to see the result.`;
    },
  };

  const host = {
    /** Start an app for the bot: its problems, the errors its page logged, and a snapshot. */
    async open(slug, name) {
      const n = nameFor(slug, name);
      const { inst, app, problems } = await start(slug, n);
      broadcast("crew:appOpened", { slug, name: n });
      const info = apps.list(slug).find((a) => a.name === n);
      return { title: app.title || n, problems, errors: inst.errors.slice(), granted: !!(info && info.grant), pending: !!(info && info.pending), snapshot: await snapshotText(inst) };
    },

    /** The page as text with refs. */
    async snapshot(slug, name) {
      return snapshotText(liveOf(slug, name));
    },

    async click(slug, name, ref) {
      return actions.click(liveOf(slug, name), ref);
    },

    async type(slug, name, ref, text, submit = false) {
      return actions.type(liveOf(slug, name), ref, String(text ?? ""), !!submit);
    },

    async press(slug, name, key) {
      return actions.press(liveOf(slug, name), key);
    },

    close(slug, name) {
      return close(slug, name);
    },

    callTool,

    /** The bot was deleted: all of its apps close. */
    closeBot(slug) {
      for (const i of [...live.values()]) if (i.slug === slug) close(i.slug, i.name);
    },

    closeAll() {
      for (const i of [...live.values()]) close(i.slug, i.name);
    },

    /** The app tool of the crew MCP server: list, open, snapshot, click, type, press or close. Returns { text }. */
    async handle(ctx, p) {
      const slug = ctx.slug;
      const action = p.action;
      if (action === "list") return { text: listText(slug) };
      if (!["open", "snapshot", "click", "type", "press", "close"].includes(action)) throw new Error(`Use the action list, open, snapshot, click, type, press or close, not "${action}".`);
      if (action === "open") {
        if (p.name === undefined || p.name === "") throw new Error('Say which app: name, like {action: "open", name: "notes-board"}.');
        const r = await host.open(slug, p.name);
        const head = [`Opened ${r.title} (${p.name}).`];
        if (!r.granted) head.push("Its permissions are not allowed yet, so it runs with no documents, no network and no bot. The person must allow them from the app's install card.");
        else if (r.pending) head.push("Its manifest asks for more than the person allowed, so it runs with the old grant until they allow the new one.");
        head.push(r.problems.length ? `Problems:\n${r.problems.map((x) => `- ${clip(x, 300)}`).join("\n")}` : "Problems: none.");
        head.push(r.errors.length ? `Errors:\n${r.errors.map((x) => `- ${x}`).join("\n")}` : "Errors: none.");
        return { text: `${head.join("\n")}\n\n${r.snapshot}` };
      }
      if (action === "close") {
        const n = nameFor(slug, p.name);
        return { text: close(slug, n) ? `Closed ${n}.` : `${n} was not open.` };
      }
      const name = nameFor(slug, p.name);
      if (action === "snapshot") return { text: await host.snapshot(slug, name) };
      if (action === "click") {
        if (!p.ref) throw new Error("click needs ref, like e12. Take refs from app snapshot.");
        return { text: await host.click(slug, name, p.ref) };
      }
      if (action === "type") {
        if (!p.ref) throw new Error("type needs ref, like e7. Take refs from app snapshot.");
        return { text: await host.type(slug, name, p.ref, p.text, p.submit) };
      }
      if (!p.key) throw new Error('press needs key, like {action: "press", key: "Enter"}.');
      return { text: await host.press(slug, name, p.key) };
    },
  };
  return host;
}

module.exports = { createAppHost, parseKey, MAX_PER_BOT, IDLE_MS, CALL_MS, RESULT_MAX };
