// Each bot's own Google Chrome (docs/plans/crew-bot-accounts.md, "Revision"):
// a Chrome profile of the bot's own under <userData>/Crew/chrome/<slug>, used
// for its Google account and its calls. Google refuses sign-in and calls from
// Crew's built-in browser, and refuses a sign-in in a Chrome something drives.
// So the person signs the bot in by hand in a plain Chrome window (no
// debugging at all), and Crew then drives that profile openly, over a pipe
// only Crew holds (no network port): Chrome tells pages it is automated, and
// Crew hides nothing. One Chrome per profile at a time, plain or driven.

const fs = require("node:fs");
const { spawn: spawnProcess } = require("node:child_process");
const { createPipeConnection } = require("./cdp-pipe.cjs");
const { findChrome } = require("./chrome-find.cjs");

/** A driven Chrome with no tab of Crew's open closes after this long. */
const IDLE_MS = 2 * 60_000;
/** How long Chrome may take to answer once started. */
const START_MS = 20_000;
/** How long a page Crew reads (fetchText) may take to load. */
const LOAD_MS = 20_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COMMON_ARGS = ["--no-first-run", "--no-default-browser-check"];
/** A driven Chrome runs minimized; calls must keep running there (timers, captions, the shared screen). */
const DRIVEN_ARGS = ["--remote-debugging-pipe", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"];

/**
 * @param {object} o
 * @param {(slug: string) => string} o.profileDir  the bot's Chrome profile folder
 * @param {() => string | null} [o.find]  Chrome's executable, or null when it isn't installed
 * @param {typeof spawnProcess} [o.spawn]
 * @param {(slug: string) => void} [o.onPlainClosed]  the person closed the bot's plain Chrome window
 */
function createChrome({ profileDir, find = () => findChrome(), spawn = spawnProcess, onPlainClosed = () => {} }) {
  /** slug → { mode: "plain" | "driven", child, conn (driven), tabs: Set<targetId>, idle, ready } */
  const all = new Map();

  function exe() {
    const p = find();
    if (!p) throw new Error("Google Chrome isn't installed on this computer. Install it from google.com/chrome, then try again.");
    return p;
  }

  function dirOf(slug) {
    const d = profileDir(slug);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  /** Forget an instance once its process is gone. */
  function track(slug, inst) {
    inst.child.once("exit", () => {
      if (all.get(slug) !== inst) return;
      all.delete(slug);
      clearTimeout(inst.idle);
      if (inst.conn) inst.conn.close();
      if (inst.mode === "plain") onPlainClosed(slug);
    });
  }

  /** Closes a driven Chrome once it has had no tab of Crew's for IDLE_MS. */
  function touch(slug, inst) {
    clearTimeout(inst.idle);
    if (inst.tabs.size) return;
    inst.idle = setTimeout(() => {
      if (all.get(slug) === inst && !inst.tabs.size) void stop(slug);
    }, IDLE_MS);
  }

  async function stop(slug) {
    const inst = all.get(slug);
    if (!inst) return;
    const gone = new Promise((r) => inst.child.once("exit", r));
    if (inst.conn) await inst.conn.send("Browser.close").catch(() => {});
    else inst.child.kill();
    await Promise.race([gone, sleep(5000)]);
    if (all.get(slug) === inst) {
      inst.child.kill();
      all.delete(slug);
    }
  }

  /** The bot's Chrome, started driven when it isn't running. Refuses while the person's plain window is open. */
  async function driven(slug) {
    const cur = all.get(slug);
    if (cur && cur.mode === "plain") throw new Error("The bot's Chrome window is open for the person to sign in. Crew waits until they close it.");
    if (cur) {
      await cur.ready;
      return cur;
    }
    const child = spawn(exe(), [`--user-data-dir=${dirOf(slug)}`, ...COMMON_ARGS, ...DRIVEN_ARGS, "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], windowsHide: false });
    const conn = createPipeConnection(child.stdio[3], child.stdio[4]);
    const inst = { mode: "driven", child, conn, tabs: new Set(), idle: null, ready: null };
    all.set(slug, inst);
    track(slug, inst);
    inst.ready = (async () => {
      const late = sleep(START_MS).then(() => {
        throw new Error("Google Chrome didn't start in 20 seconds.");
      });
      await Promise.race([conn.send("Browser.getVersion"), late]);
      // Start out of the person's way: Crew's own blank first window, minimized.
      const { targetInfos } = await conn.send("Target.getTargets");
      const first = targetInfos.find((t) => t.type === "page");
      if (first) {
        const { windowId } = await conn.send("Browser.getWindowForTarget", { targetId: first.targetId });
        await conn.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } }).catch(() => {});
      }
      touch(slug, inst);
    })();
    try {
      await inst.ready;
    } catch (e) {
      await stop(slug);
      throw e;
    }
    return inst;
  }

  /** A new tab in the bot's driven Chrome, attached over its own session. */
  async function newTarget(inst, url, { background = false } = {}) {
    const { targetId } = await inst.conn.send("Target.createTarget", { url: "about:blank", background });
    const { sessionId } = await inst.conn.send("Target.attachToTarget", { targetId, flatten: true });
    return { targetId, sessionId };
  }

  return {
    /** Whether Google Chrome is installed. */
    available: () => !!find(),

    /** "plain" while the person's window is open, "driven" while Crew drives it, else null. */
    running: (slug) => (all.get(slug) ? all.get(slug).mode : null),

    /**
     * The bot's Chrome as a plain window on `url`, nothing driving it, for the
     * person to sign in. A driven Chrome with a call open refuses; one without
     * is closed first (one Chrome per profile).
     */
    async openForPerson(slug, url) {
      const cur = all.get(slug);
      if (cur && cur.mode === "plain") return;
      if (cur && cur.tabs.size) throw new Error("The bot's Chrome is busy with a call. Try again when it has left.");
      if (cur) await stop(slug);
      const child = spawn(exe(), [`--user-data-dir=${dirOf(slug)}`, ...COMMON_ARGS, url], { stdio: "ignore", windowsHide: false });
      const inst = { mode: "plain", child, conn: null, tabs: new Set(), idle: null, ready: Promise.resolve() };
      all.set(slug, inst);
      track(slug, inst);
    },

    /** The cookies of the bot's Chrome profile (Chrome is started driven if needed). */
    async cookies(slug) {
      const inst = await driven(slug);
      const { cookies } = await inst.conn.send("Storage.getCookies");
      touch(slug, inst);
      return cookies || [];
    },

    /** Removes every cookie of the bot's Chrome profile: it is the bot's Google profile and holds nothing else. */
    async clearCookies(slug) {
      const inst = await driven(slug);
      await inst.conn.send("Storage.clearCookies");
      touch(slug, inst);
    },

    /** The text of a page loaded in a background tab of the bot's Chrome (its sign-in applies). */
    async fetchText(slug, url) {
      const inst = await driven(slug);
      const { targetId, sessionId } = await newTarget(inst, url, { background: true });
      inst.tabs.add(targetId);
      try {
        await inst.conn.send("Page.navigate", { url }, sessionId);
        for (const by = Date.now() + LOAD_MS; Date.now() < by; ) {
          const r = await inst.conn.send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }, sessionId).catch(() => null);
          if (r && r.result && r.result.value === "complete") break;
          await sleep(300);
        }
        const r = await inst.conn.send("Runtime.evaluate", { expression: "document.body ? document.body.innerText : ''", returnByValue: true }, sessionId);
        return String((r.result && r.result.value) || "");
      } finally {
        inst.tabs.delete(targetId);
        await inst.conn.send("Target.closeTarget", { targetId }).catch(() => {});
        touch(slug, inst);
      }
    },

    /**
     * A tab for a call (meetings.cjs), shaped like the built-in browser's
     * meeting tab: bindings and scripts in place before `url` loads, page
     * functions in an isolated world, the DevTools protocol, close. onGone
     * runs once when the tab or Chrome goes away.
     */
    async openTab(slug, { url, bindings = [], scripts = [], onBinding = () => {}, onGone = () => {} }) {
      const inst = await driven(slug);
      const { targetId, sessionId } = await newTarget(inst, url);
      inst.tabs.add(targetId);
      touch(slug, inst);
      let alive = true;
      let world = null;
      let href = "";
      const names = new Set(bindings.map((x) => x.name));
      const gone = () => {
        if (!alive) return;
        alive = false;
        inst.tabs.delete(targetId);
        off();
        touch(slug, inst);
        onGone();
      };
      const off = inst.conn.on((ev) => {
        if (ev.method === "Target.targetDestroyed" && ev.params.targetId === targetId) return gone();
        if (ev.method === "Target.detachedFromTarget" && ev.params.sessionId === sessionId) return gone();
        if (ev.sessionId !== sessionId) return;
        if (ev.method === "Runtime.bindingCalled" && names.has(ev.params.name)) onBinding(ev.params.name, String(ev.params.payload || ""));
        if (ev.method === "Page.frameNavigated" && ev.params.frame && !ev.params.frame.parentId) {
          world = null;
          href = ev.params.frame.url || href;
        }
      });
      void inst.conn.closed.then(gone);
      await inst.conn.send("Target.setDiscoverTargets", { discover: true }).catch(() => {});
      const cdp = (method, params = {}) => {
        if (!alive) return Promise.reject(new Error("The meeting's tab was closed."));
        return inst.conn.send(method, params, sessionId);
      };
      await cdp("Page.enable");
      await cdp("Runtime.enable");
      // The window stays minimized, so the page is told it has focus: typed chat and key presses land as they do in a window in front.
      await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
      for (const x of bindings) await cdp("Runtime.addBinding", x);
      for (const s of scripts) await cdp("Page.addScriptToEvaluateOnNewDocument", s);
      const r = await cdp("Page.navigate", { url });
      if (r.errorText) {
        await inst.conn.send("Target.closeTarget", { targetId }).catch(() => {});
        gone();
        throw new Error(`Couldn't open ${url}: ${r.errorText}.`);
      }
      href = url;
      // Calls run out of the person's way; they can bring the window up from the taskbar.
      const { windowId } = await inst.conn.send("Browser.getWindowForTarget", { targetId }).catch(() => ({ windowId: null }));
      if (windowId !== null) await inst.conn.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } }).catch(() => {});

      /** A page function (meet-scripts) in the tab's own isolated world. */
      async function evaluate(fn, arg) {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (!world) {
            const { frameTree } = await cdp("Page.getFrameTree");
            world = (await cdp("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "fenna-meet-act" })).executionContextId;
          }
          try {
            const res = await cdp("Runtime.evaluate", { expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`, contextId: world, returnByValue: true, awaitPromise: true });
            if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || "script error");
            return res.result.value;
          } catch (e) {
            if (attempt === 0 && /context|Execution/i.test(String(e && e.message))) {
              world = null;
              continue;
            }
            throw e;
          }
        }
        return null;
      }

      return {
        id: targetId,
        cdp,
        evaluate,
        /** An expression in the page's own world (where the stage lives). */
        async main(expression) {
          const res = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
          if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || "script error");
          return res.result.value;
        },
        url: () => (alive ? href : ""),
        alive: () => alive,
        // Nobody takes control of the bot's Chrome through Crew: the person uses its window directly.
        waitForControl: async () => {},
        close() {
          if (!alive) return;
          void inst.conn.send("Target.closeTarget", { targetId }).catch(() => {});
          gone();
        },
      };
    },

    /** Brings the bot's driven Chrome window up for the person (a call they want to see). */
    async show(slug) {
      const inst = all.get(slug);
      if (!inst || !inst.conn) return false;
      const { targetInfos } = await inst.conn.send("Target.getTargets");
      const page = targetInfos.find((t) => t.type === "page" && inst.tabs.has(t.targetId)) || targetInfos.find((t) => t.type === "page");
      if (!page) return false;
      const { windowId } = await inst.conn.send("Browser.getWindowForTarget", { targetId: page.targetId });
      await inst.conn.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
      await inst.conn.send("Target.activateTarget", { targetId: page.targetId }).catch(() => {});
      return true;
    },

    /** The bot was deleted: its Chrome closes and its profile, with its Google sign-in, goes. */
    async forget(slug) {
      await stop(slug);
      fs.rmSync(profileDir(slug), { recursive: true, force: true });
    },

    /** Crew is quitting: every driven Chrome closes; the person's plain windows stay theirs. */
    async closeAll() {
      await Promise.all([...all.entries()].filter(([, i]) => i.mode === "driven").map(([slug]) => stop(slug)));
    },
  };
}

module.exports = { createChrome };
