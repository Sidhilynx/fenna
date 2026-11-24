// The sandbox: a bot (or a person) runs a small JavaScript program on the
// bot's own disk, like a terminal on a real computer, and the program can
// reach nothing else. Each run is a hidden window in its own in-memory
// session with no network, no permissions and no Node. The only door is the
// fenna API (sandbox-preload.cjs), and every call comes back here, where the
// path policy is checked against the bot's disk (disk.cjs locate).
//
// Node's vm is not a boundary, so nothing here relies on it. The parts that
// decide what a program may do (paths, the policy, output and the API) are
// plain functions and a run object, so they are tested without Electron.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DISK_ROOTS } = require("./disk.cjs");

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_MAX = 256 * 1024;
/** Room kept at the end of the output for the last lines: a stop, an error, an exit code. */
const TAIL_RESERVE = 4 * 1024;
const MESSAGE_MAX = 2000;
const PROGRAM_MAX = 1024 * 1024;
const TRANSFER_MAX = 10 * 1024 * 1024;
const PATH_MAX = 4096;
const PER_BOT = 2;
const TOTAL = 4;
const ARGS_MAX = 64;
const ARG_MAX = 1000;
const ARGS_TOTAL_MAX = 4096;
const WRITE_ROOTS = ["Files", "Downloads"];
const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'";
const MB = 1024 * 1024;

const MSG = {
  path: "Say which file or folder.",
  absolute: "Paths can't be absolute. Use a path under Files/, Documents/, Downloads/ or Trash/, or a path relative to the working folder.",
  parent: "A path can't use .. to leave the folder. Stay inside the bot's disk.",
  root: "The working folder must start with Files/, Documents/, Downloads/ or Trash/.",
  trashRead: "Files in Trash can't be read by a program. Restore them first.",
  writeRoot: "A program can only write inside Files/ or Downloads/, as a file.",
  stopped: "Stopped by the crew.",
  finished: "The program has already finished.",
  badCall: "That call isn't from this program.",
};

const mb = (n) => `${(n / MB).toFixed(1)} MB`;
const statOrNull = (p) => {
  try {
    return fs.statSync(p);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return null;
    throw e;
  }
};
/** Turns a file system error into a sentence without the disk's real path in it. */
function guardFs(fn) {
  try {
    return fn();
  } catch (e) {
    if (e && e.code) throw new Error(`The disk couldn't do that (${e.code}).`);
    throw e;
  }
}

/** Program output, kept to `max` bytes. Past the cap it stops and says so once. */
function createOutput(max = OUTPUT_MAX - TAIL_RESERVE) {
  const NOTE = "\n[Output stopped at 256 KB.]\n";
  let text = "";
  let bytes = 0;
  let cut = false;
  return {
    add(s) {
      if (cut) return;
      const n = Buffer.byteLength(s);
      if (bytes + n <= max) {
        text += s;
        bytes += n;
        return;
      }
      const part = Buffer.from(s).subarray(0, max - bytes).toString("utf8").replace(/�$/, "");
      text += part + NOTE;
      cut = true;
    },
    get text() {
      return text;
    },
    get cut() {
      return cut;
    },
  };
}

/** The segments of a path the person or bot typed, after the syntax checks. Throws with what to change. */
function syntax(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error(MSG.path);
  if (input.length > PATH_MAX) throw new Error("That path is too long.");
  if (/^[\\/]/.test(input) || /^[A-Za-z]:/.test(input) || input.includes("\\")) throw new Error(MSG.absolute);
  const segs = input.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.includes("..")) throw new Error(MSG.parent);
  return segs;
}

/** The working folder, as segments. It must be under one of the disk's roots. */
function workingFolder(cwd) {
  const segs = syntax(cwd ?? "Files");
  if (!DISK_ROOTS.includes(segs[0])) throw new Error(MSG.root);
  return segs;
}

/**
 * A path a program gives, as a disk path. Paths that start with a root are
 * disk paths; anything else is relative to the working folder. Nothing can
 * leave the disk: absolute paths and .. are refused here, and disk.locate
 * checks the rest (names, links, the bot's folder) when the path is used.
 */
function resolveDiskPath(input, cwdSegs) {
  const segs = syntax(input);
  const full = DISK_ROOTS.includes(segs[0]) ? segs : [...cwdSegs, ...segs];
  return full.join("/");
}

function checkArgs(args) {
  if (args === undefined) return [];
  if (!Array.isArray(args)) throw new Error("The arguments must be a list of text values.");
  if (args.length > ARGS_MAX) throw new Error(`A program can take at most ${ARGS_MAX} arguments.`);
  let total = 0;
  for (const a of args) {
    if (typeof a !== "string") throw new Error("Every argument must be text.");
    if (a.length > ARG_MAX) throw new Error(`An argument can be at most ${ARG_MAX} characters.`);
    total += a.length;
  }
  if (total > ARGS_TOTAL_MAX) throw new Error(`The arguments together can be at most ${ARGS_TOTAL_MAX} characters.`);
  return args.slice();
}

/**
 * Checks a run before anything starts and reads its program. Returns what
 * the run needs: the code, the working folder, the arguments and the time.
 */
function planRun(disk, slug, opts = {}) {
  if (opts.file !== undefined && opts.code !== undefined) throw new Error("Give a program file or code, not both.");
  const cwdSegs = workingFolder(opts.cwd);
  const args = checkArgs(opts.args);
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? Math.min(opts.timeoutMs, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  let code;
  if (opts.code !== undefined) {
    if (typeof opts.code !== "string") throw new Error("The code must be text.");
    if (Buffer.byteLength(opts.code) > PROGRAM_MAX) throw new Error(`That program is ${mb(Buffer.byteLength(opts.code))}. Programs can be at most 1 MB.`);
    code = opts.code;
  } else if (opts.file !== undefined) {
    const file = resolveDiskPath(opts.file, cwdSegs);
    const loc = disk.locate(slug, file);
    if (loc.root === "Trash") throw new Error(MSG.trashRead);
    const st = statOrNull(loc.abs);
    if (!st || !st.isFile()) throw new Error(`There is no program file at ${file}.`);
    if (st.size > PROGRAM_MAX) throw new Error(`That program is ${mb(st.size)}. Programs can be at most 1 MB.`);
    code = guardFs(() => fs.readFileSync(loc.abs, "utf8"));
  } else {
    throw new Error("Give a program file or code to run.");
  }
  return { code, cwd: cwdSegs.join("/"), args, timeoutMs };
}

/**
 * One run's API: every call a program makes lands in dispatch(), which checks
 * it against the policy and the run's state. finish() ends the run once.
 */
function createRun({ disk, slug, cwd, args = [], onFinish = () => {} }) {
  const cwdSegs = cwd.split("/");
  const output = createOutput();
  let finished = false;

  const live = () => {
    if (finished) throw new Error(MSG.finished);
  };
  const locate = (p) => disk.locate(slug, resolveDiskPath(p, cwdSegs));
  const readable = (loc) => {
    if (loc.root === "Trash") throw new Error(MSG.trashRead);
  };
  const writable = (loc) => {
    if (!WRITE_ROOTS.includes(loc.root) || loc.isRoot) throw new Error(MSG.writeRoot);
  };

  function finish(ok, message = "") {
    if (finished) return false;
    finished = true;
    let out = output.text;
    const tail = String(message).trim().slice(0, MESSAGE_MAX);
    if (tail) out += (out && !out.endsWith("\n") ? "\n" : "") + tail + "\n";
    onFinish({ out, ok });
    return true;
  }

  const ops = {
    readText({ path: p }) {
      live();
      const loc = locate(p);
      readable(loc);
      const st = statOrNull(loc.abs);
      if (!st || !st.isFile()) throw new Error(`There is no file at ${loc.segs.join("/")}.`);
      if (st.size > TRANSFER_MAX) throw new Error(`That file is ${mb(st.size)}. A program can read at most 10 MB at a time.`);
      return guardFs(() => fs.readFileSync(loc.abs, "utf8"));
    },
    writeText({ path: p, text }) {
      live();
      if (typeof text !== "string") throw new Error("Give the text to write.");
      const bytes = Buffer.byteLength(text);
      if (bytes > TRANSFER_MAX) throw new Error(`That is ${mb(bytes)}. A program can write at most 10 MB at a time.`);
      const loc = locate(p);
      writable(loc);
      const st = statOrNull(loc.abs);
      if (st && st.isDirectory()) throw new Error(`${loc.segs.join("/")} is a folder. Pick a file name.`);
      const free = disk.free(slug) + (st ? st.size : 0);
      if (bytes > free) throw new Error(`There isn't room on the bot's disk for that. It needs ${mb(bytes)}, and ${mb(free)} is free.`);
      guardFs(() => {
        fs.mkdirSync(path.dirname(loc.abs), { recursive: true });
        fs.writeFileSync(loc.abs, text, "utf8");
      });
      return null;
    },
    list({ path: p }) {
      live();
      const loc = locate(p === undefined ? cwd : p);
      readable(loc);
      const st = statOrNull(loc.abs);
      if (!st) throw new Error(`There is no folder at ${loc.segs.join("/")}.`);
      if (!st.isDirectory()) throw new Error(`${loc.segs.join("/")} is a file, not a folder.`);
      return guardFs(() => fs.readdirSync(loc.abs, { withFileTypes: true }))
        .filter((d) => !d.name.startsWith(".") && (d.isFile() || d.isDirectory()))
        .map((d) => ({ name: d.name, kind: d.isDirectory() ? "folder" : "file" }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    },
    exists({ path: p }) {
      live();
      const loc = locate(p);
      readable(loc);
      return fs.existsSync(loc.abs);
    },
    print({ text }) {
      live();
      // A string of OUTPUT_MAX characters always fills the output's cap, so the rest is never read.
      output.add(String(text ?? "").slice(0, OUTPUT_MAX));
      // Past the cap the program is stopped, so a loop that prints cannot keep the app busy.
      if (output.cut) finish(false);
      return null;
    },
    exit({ code }) {
      live();
      const n = Number(code) || 0;
      finish(n === 0, n === 0 ? "" : `Exited with code ${n}.`);
      return null;
    },
    done({ ok, message }) {
      live();
      finish(ok === true, typeof message === "string" ? message : "");
      return null;
    },
  };

  return {
    dispatch(msg) {
      const op = msg && typeof msg === "object" ? msg.op : undefined;
      if (typeof op !== "string" || !Object.prototype.hasOwnProperty.call(ops, op)) {
        throw new Error(`There is no call called ${JSON.stringify(String(op))}.`);
      }
      return ops[op](msg);
    },
    finish,
    args: args.slice(),
    cwd,
  };
}

/**
 * The page a program runs in. The program's code travels as base64 inside
 * the page, so no text of it can end the script tag. The bootstrap turns the
 * bridge the preload exposes into the fenna API the program sees, routes
 * console.log and console.error to the output, and reports how the program
 * ended, with the line of an uncaught error.
 */
function bootstrap(src) {
  const bridge = globalThis.__fennaBridge;
  const show = (v) => {
    if (typeof v === "string") return v;
    if (v instanceof Error) return String(v);
    try {
      const s = JSON.stringify(v);
      return s === undefined ? String(v) : s;
    } catch (e) {
      return String(v);
    }
  };
  const toText = (values) => values.map(show).join(" ") + "\n";
  const fenna = {
    args: bridge.args,
    cwd: bridge.cwd,
    readText: (p) => bridge.readText(String(p)),
    writeText: (p, text) => bridge.writeText(String(p), String(text)),
    list: (p) => bridge.list(p === undefined ? bridge.cwd : String(p)),
    exists: (p) => bridge.exists(String(p)),
    print: (...values) => bridge.print(toText(values)),
    exit: (code) => bridge.exit(Number(code) || 0),
  };
  const log = (...values) => {
    bridge.print(toText(values)).catch(() => {});
  };
  // The page's own rules already refuse the network, workers and peer connections; these names
  // are also taken away from the program, so it finds nothing to call.
  for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "RTCPeerConnection", "webkitRTCPeerConnection", "Worker", "SharedWorker"]) {
    try {
      delete globalThis[name];
    } catch {}
  }
  try {
    delete Object.getPrototypeOf(globalThis.navigator).sendBeacon;
  } catch {}
  console.log = log;
  console.error = log;
  const lineOf = (e) => {
    // The program's frame is the last "<anonymous>:line:col" on the first frame that has one;
    // the two lines the Function constructor adds in front of the body are not the program's.
    for (const frame of String(e && e.stack ? e.stack : "").split("\n")) {
      const hits = [...frame.matchAll(/<anonymous>:(\d+):\d+/g)];
      if (hits.length) return Math.max(0, Number(hits[hits.length - 1][1]) - 2);
    }
    return 0;
  };
  const run = async () => {
    const bytes = Uint8Array.from(atob(src), (c) => c.charCodeAt(0));
    const body = new TextDecoder().decode(bytes);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction("fenna", body)(fenna);
  };
  run().then(
    () => bridge.done(true, ""),
    (e) => {
      const n = lineOf(e);
      const name = e && e.name ? e.name : "Error";
      const message = e && e.message !== undefined ? e.message : String(e);
      return bridge.done(false, `${n ? `Line ${n}: ` : ""}${name}: ${message}`);
    },
  ).catch(() => {});
}

function programPage(code) {
  const src = Buffer.from(code, "utf8").toString("base64");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>Program</title></head><body><script>(${bootstrap.toString()})("${src}");</script></body></html>`;
}

const pageUrl = (html) => `data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`;

/** Seconds for a message: 20000 is "20", 50 is "0.1". */
const seconds = (ms) => Number((ms / 1000).toFixed(1));

/**
 * The sandbox for the whole crew. run() resolves with what the program
 * printed and whether it finished cleanly; it never rejects, so a refusal
 * reads like the output of a terminal.
 */
function createSandbox({ disk, BrowserWindow, session, ipcMain, preloadPath }) {
  const perBot = new Map();
  let total = 0;
  const running = new Set();

  function release(slug) {
    total -= 1;
    const n = (perBot.get(slug) ?? 1) - 1;
    if (n <= 0) perBot.delete(slug);
    else perBot.set(slug, n);
  }

  function execute(slug, plan) {
    const token = crypto.randomBytes(16).toString("hex");
    const channel = `sandbox:${token}`;
    let resolveResult;
    const result = new Promise((r) => {
      resolveResult = r;
    });
    let timer = null;
    let win = null;
    let ses = null;
    const stop = () => run.finish(false, MSG.stopped);

    function teardown(out) {
      clearTimeout(timer);
      running.delete(stop);
      try {
        ipcMain.removeHandler(channel);
      } catch {}
      try {
        if (win && !win.isDestroyed()) win.destroy();
      } catch {}
      const cleared = ses ? Promise.resolve().then(() => ses.clearStorageData()).catch(() => {}) : Promise.resolve();
      cleared.then(() => {
        release(slug);
        resolveResult(out);
      });
    }

    const run = createRun({ disk, slug, cwd: plan.cwd, args: plan.args, onFinish: teardown });
    running.add(stop);

    try {
      ipcMain.handle(channel, (event, msg) => {
        if (!event || !event.sender || !win || event.sender.id !== win.webContents.id) {
          return { ok: false, error: MSG.badCall };
        }
        try {
          return { ok: true, value: run.dispatch(msg) };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      });
      ses = session.fromPartition(`sandbox-${token}`, { cache: false });
      ses.webRequest.onBeforeRequest((details, cb) => {
        cb({ cancel: !(details.url.startsWith("data:") || details.url === "about:blank") });
      });
      ses.setPermissionRequestHandler((_web, _perm, cb) => cb(false));
      ses.setPermissionCheckHandler(() => false);
      if (typeof ses.setDevicePermissionHandler === "function") ses.setDevicePermissionHandler(() => false);
      // A download would be saved to the person's own Downloads folder, outside the bot's disk.
      ses.on("will-download", (e) => e.preventDefault());
      // Everything that is not a data: URL is refused above; a proxy that goes nowhere also covers
      // the browser's own connections (DNS prefetch, preconnect), which the request hook does not see.
      // The page loads only once the proxy is in place.
      const proxied = Promise.resolve(ses.setProxy({ mode: "fixed_servers", proxyRules: "127.0.0.1:9" })).catch(() => {});

      const config = encodeURIComponent(JSON.stringify({ args: plan.args, cwd: plan.cwd }));
      win = new BrowserWindow({
        show: false,
        width: 640,
        height: 480,
        webPreferences: {
          session: ses,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          preload: preloadPath,
          devTools: false,
          javascript: true,
          images: false,
          webgl: false,
          spellcheck: false,
          additionalArguments: [`--fenna-channel=${channel}`, `--fenna-config=${config}`],
        },
      });
      const wc = win.webContents;
      wc.setWindowOpenHandler(() => ({ action: "deny" }));
      wc.on("will-navigate", (e) => e.preventDefault());
      // Peer connections are not covered by the CSP or the request hook, and a frame brings its own; they may only
      // go through the proxy, which goes nowhere.
      if (typeof wc.setWebRTCIPHandlingPolicy === "function") wc.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
      wc.on("render-process-gone", () => run.finish(false, "The program stopped unexpectedly."));
      win.on("closed", () => run.finish(false, "The program was closed."));
      timer = setTimeout(() => run.finish(false, `Stopped after ${seconds(plan.timeoutMs)} s.`), plan.timeoutMs);
      proxied
        .then(() => win.loadURL(pageUrl(programPage(plan.code))))
        .catch(() => run.finish(false, "The program couldn't start."));
    } catch {
      run.finish(false, "The program couldn't start.");
    }
    return result;
  }

  function run(slug, opts = {}) {
    let plan;
    try {
      plan = planRun(disk, slug, opts);
    } catch (e) {
      return Promise.resolve({ out: e.message, ok: false });
    }
    if ((perBot.get(slug) ?? 0) >= PER_BOT) {
      return Promise.resolve({ out: `This bot is already running ${PER_BOT} programs. Wait for one to finish.`, ok: false });
    }
    if (total >= TOTAL) {
      return Promise.resolve({ out: `The crew is already running ${TOTAL} programs. Wait for one to finish.`, ok: false });
    }
    total += 1;
    perBot.set(slug, (perBot.get(slug) ?? 0) + 1);
    return execute(slug, plan);
  }

  function stopAll() {
    for (const stop of [...running]) stop();
  }

  return { run, stopAll };
}

module.exports = {
  createSandbox,
  createRun,
  createOutput,
  planRun,
  resolveDiskPath,
  programPage,
  DEFAULT_TIMEOUT_MS,
  OUTPUT_MAX,
  PROGRAM_MAX,
  TRANSFER_MAX,
  PER_BOT,
  TOTAL,
  CSP,
};
