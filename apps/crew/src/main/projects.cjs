// A bot's projects: node, npm and npx run in Files/Projects/<name> with the
// person's own Node, under Node's permission model (--permission), so a
// process can read and write only its project folder and can't start other
// programs. It can still reach the internet. Electron's own Node is never
// used: it can't enforce permissions.
//
// A command runs with argv and no shell, in the project folder, with a
// minimal environment (no tokens, no ELECTRON_*). The first command in a
// project asks the person (Approve once, Always for this project, Deny).
// Foreground commands wait up to five minutes. Background ones run until
// stopped, the bot is stopped by the person, or Crew quits; a background
// process that prints a localhost address gets a tab in the bot's browser.
// Every command is logged in the run as a `command` event.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");

const MIN_NODE_MAJOR = 22;
const MAX_RUNNING = 3;
const FOREGROUND_MS = 5 * 60_000;
const OUTPUT_KEEP = 64 * 1024;
const OUTPUT_SHOWN = 16 * 1024;
const TAIL_CHARS = 2048;
const FLUSH_MS = 100;
const ENDED_KEPT = 20;
const MAX_COMMAND = 2000;
const PROGRAMS = ["node", "npm", "npx"];
const OPERATORS = /[|&;<>`]|\$\(/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const PORT_RES = [/(?:localhost|127\.0\.0\.1):(\d{1,5})\b/, /listening on (?:port )?(\d{1,5})\b/i];
const NPM_FLAGS = ["--ignore-scripts", "--no-audit", "--no-fund"];
const NODE_HELP = "Projects need Node.js 22 or newer on this computer: nodejs.org";

const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const isPort = (n) => Number.isInteger(n) && n >= 1 && n <= 65535;

/** A command line in words: quotes group words, nothing else is special (backslashes stay, so Windows paths work). Null when a quote is open. */
function splitWords(line) {
  const words = [];
  let cur = null;
  let quote = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur = cur ?? "";
    } else if (/\s/.test(ch)) {
      if (cur !== null) {
        words.push(cur);
        cur = null;
      }
    } else cur = (cur ?? "") + ch;
  }
  if (quote) return null;
  if (cur !== null) words.push(cur);
  return words;
}

/** The program and its arguments, or a refusal that says what to write instead. */
function parseCommand(line) {
  const text = String(line ?? "").trim();
  if (!text) throw new Error("Say the command to run, like npm init -y.");
  if (text.length > MAX_COMMAND) throw new Error(`The command is ${text.length} characters; the most is ${MAX_COMMAND}. Shorten it.`);
  if (OPERATORS.test(text)) throw new Error("A command runs one program: it can't use | & ; < > backticks or $( . Write one command, like npm install express.");
  const words = splitWords(text);
  if (!words) throw new Error("A quote is not closed in the command. Close it, like npm install \"my-package\".");
  const program = words[0];
  if (!PROGRAMS.includes(program)) throw new Error(`"${program.slice(0, 40)}" can't run in a project. Allowed: node, npm, npx.`);
  const args = words.slice(1);
  if (program === "node" && (!args.length || args[0].startsWith("-"))) {
    throw new Error("node runs a file: write node, then the file, like node server.js. Flags can't come before the file.");
  }
  return { program, args };
}

function projectName(v) {
  const name = typeof v === "string" ? v.trim() : "";
  if (!NAME_RE.test(name) || name.endsWith(".") || RESERVED_NAME.test(name)) {
    throw new Error(`Name the project with letters, digits, dashes, dots or underscores, like "site" or "my-app". It lives in Files/Projects/<name>.`);
  }
  return name;
}

/** The text of a process's last output, and how much came before it. */
function shownOf(rec) {
  const shown = rec.out.slice(-OUTPUT_SHOWN);
  const cut = rec.total > shown.length ? `[Output: ${kb(rec.total)}. The first ${kb(rec.total - shown.length)} were cut; this is the last ${kb(shown.length)}.]\n` : "";
  return { shown, cut };
}

/**
 * @param {object} o
 * @param {ReturnType<import("./disk.cjs").createDisk>} o.disk  locates Files/Projects/<name>
 * @param {ReturnType<import("./store.cjs").createStore>} o.store  the bot's folder and settings
 * @param {{ record(runId: string, event: object): void }} o.runner
 * @param {(ctx: object, a: { action: string, details: string, source: string, tool: string|null }) => Promise<{ allowed: boolean, always: boolean, by: string }>} o.approve
 * @param {{ act(slug: string, method: string, params: object): Promise<object> }} o.browsers  the bot's browser (browser.cjs)
 * @param {(channel: string, payload: unknown) => void} o.broadcast
 * @param {string} [o.nodePath]  the Node to run with; found on PATH when left out
 * @param {() => Date} [o.now]
 * @param {typeof childProcess.spawn} [o.spawn]  starts a process (tests put a fake here)
 * @param {(exe: string) => string} [o.versionOf]  the Node version of an executable (tests)
 */
function createProjects({ disk, store, runner, approve, browsers, broadcast, nodePath, now = () => new Date(), spawn = childProcess.spawn, versionOf = defaultVersionOf }) {
  /** id → process record, in start order. */
  const procs = new Map();
  /** runId → project names the person approved once, for the rest of that run. */
  const approvedInRun = new Map();
  /** runId → project names the person denied, for the rest of that run. */
  const deniedInRun = new Map();
  const nodeCache = new Map();

  const iso = () => now().toISOString();
  const botOf = (slug) => {
    const r = store.readBot(slug);
    return r && r.bot ? r.bot : null;
  };
  const botName = (slug) => {
    const bot = botOf(slug);
    return bot ? bot.name : slug;
  };

  /** Node on PATH (where.exe on Windows), or the one given. Never Electron's own. */
  function findNode() {
    if (nodePath) return nodePath;
    const r = childProcess.spawnSync(process.platform === "win32" ? "where.exe" : "which", ["node"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    const found = String(r.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && fs.existsSync(s));
    return found.find((s) => s.toLowerCase().endsWith(".exe")) || found[0] || null;
  }

  /** The person's Node, checked for version: its real path, its folder, and its version text. */
  function nodeFor() {
    const exe = findNode();
    if (!exe || !fs.existsSync(exe)) throw new Error(NODE_HELP);
    const real = fs.realpathSync.native(exe);
    if (process.versions.electron && real === fs.realpathSync.native(process.execPath)) throw new Error(NODE_HELP);
    if (!nodeCache.has(real)) {
      let version;
      try {
        version = String(versionOf(real)).trim();
      } catch {
        throw new Error(NODE_HELP);
      }
      nodeCache.set(real, version);
    }
    const version = nodeCache.get(real);
    if (!(Number(version.split(".")[0]) >= MIN_NODE_MAJOR)) throw new Error(`${NODE_HELP} This computer has ${version}.`);
    return { exe: real, dir: fs.realpathSync.native(path.dirname(real)), version };
  }

  /** npm-cli.js or npx-cli.js (both ship in the npm package) beside Node: Windows node_modules next to node.exe; Unix ../lib/node_modules. */
  function entryOf(nodeDir, name) {
    const file = `${name}-cli.js`;
    for (const parts of [
      [nodeDir, "node_modules", "npm", "bin", file],
      [nodeDir, "..", "lib", "node_modules", "npm", "bin", file],
    ]) {
      const p = path.join(...parts);
      if (fs.existsSync(p)) {
        const entry = fs.realpathSync.native(p);
        return { entry, pkgRoot: fs.realpathSync.native(path.resolve(path.dirname(entry), "..")) };
      }
    }
    throw new Error(`${name} isn't next to Node.js on this computer. Reinstall Node.js 22 or newer from nodejs.org.`);
  }

  const approvalFile = (slug) => path.join(store.botDir(slug), "projects.json");

  function approvedAlways(slug) {
    try {
      const v = JSON.parse(fs.readFileSync(approvalFile(slug), "utf8"));
      return Array.isArray(v.approved) ? v.approved.filter((s) => typeof s === "string") : [];
    } catch {
      return [];
    }
  }

  function saveAlways(slug, project) {
    const list = [...new Set([...approvedAlways(slug), project])];
    const file = approvalFile(slug);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ approved: list }, null, 2)}\n`);
    fs.renameSync(tmp, file);
  }

  /** The first command in a project waits for the person; once approved (once for the run, or always) it runs. */
  async function permit(ctx, slug, project) {
    if (approvedAlways(slug).includes(project)) return;
    if ((approvedInRun.get(ctx.runId) || new Set()).has(project)) return;
    if ((deniedInRun.get(ctx.runId) || new Set()).has(project)) {
      throw new Error(`The person said no to commands in Projects/${project} in this run. Don't try again or another way; say in your reply that it was not approved.`);
    }
    const r = await approve(ctx, {
      action: `Run commands in Projects/${project}`,
      details: `${botName(slug)} wants to run node, npm and npx in Projects/${project}. They can read and write only that folder and can't start other programs, but they can reach the internet.`,
      source: "project",
      tool: null,
    });
    if (!r.allowed) {
      if (r.by === "timeout") throw new Error(`The person didn't answer in time, so no command ran in Projects/${project}. Don't do it another way; say in your reply that it waits for their approval.`);
      if (r.by === "stopped") throw new Error("The run was stopped before the person answered.");
      if (!deniedInRun.has(ctx.runId)) deniedInRun.set(ctx.runId, new Set());
      deniedInRun.get(ctx.runId).add(project);
      throw new Error(`Denied by the person: no command ran in Projects/${project}. Don't try again or another way; say in your reply that it was not approved.`);
    }
    if (r.always) saveAlways(slug, project);
    else {
      if (!approvedInRun.has(ctx.runId)) approvedInRun.set(ctx.runId, new Set());
      approvedInRun.get(ctx.runId).add(project);
    }
  }

  const runningOf = (slug) => [...procs.values()].filter((r) => r.slug === slug && r.status === "running");

  function infoOf(rec) {
    return {
      id: rec.id,
      slug: rec.slug,
      project: rec.project,
      command: rec.command,
      background: rec.background,
      status: rec.status,
      exitCode: rec.exitCode,
      port: rec.port,
      startedAt: rec.startedAt,
      endedAt: rec.endedAt,
      tail: rec.out.slice(-TAIL_CHARS),
    };
  }

  function emit(rec) {
    broadcast("crew:process", { slug: rec.slug, info: infoOf(rec) });
  }

  function flush(rec) {
    clearTimeout(rec.timer);
    rec.timer = null;
    const parts = new Map();
    for (const p of rec.pending) parts.set(p.stream, (parts.get(p.stream) || "") + p.text);
    rec.pending = [];
    for (const [stream, text] of parts) broadcast("crew:processOutput", { slug: rec.slug, id: rec.id, stream, text });
  }

  /** Output goes to the screen about ten times a second per process, and to the kept tail at once. */
  function write(rec, stream, text) {
    if (!text) return;
    rec.total += Buffer.byteLength(text);
    rec.out += text;
    if (rec.out.length > OUTPUT_KEEP) rec.out = rec.out.slice(-OUTPUT_KEEP);
    rec.pending.push({ stream, text });
    if (!rec.timer) rec.timer = setTimeout(() => flush(rec), FLUSH_MS);
    if (rec.background && rec.port === null) scanPort(rec, text);
  }

  /** The first localhost address the output names: its port, and a tab in the bot's browser. */
  function scanPort(rec, text) {
    const seen = rec.scan + text;
    rec.scan = seen.slice(-80);
    for (const re of PORT_RES) {
      const m = re.exec(seen);
      if (!m || !isPort(Number(m[1]))) continue;
      rec.port = Number(m[1]);
      emit(rec);
      Promise.resolve()
        .then(() => browsers.act(rec.slug, "open", { url: `http://localhost:${rec.port}`, new_tab: true }))
        .catch(() => {});
      return;
    }
  }

  function note(rec, text) {
    write(rec, "err", `\n[${text}]\n`);
  }

  function kill(rec) {
    rec.stopping = true;
    try {
      rec.child.kill();
    } catch {
      /* already gone */
    }
  }

  /** The process ended (or never started). Records the outcome, the run log line for a foreground command, and wakes its waiter. */
  function done(rec, { code = null, error = null }) {
    if (rec.ended) return;
    rec.ended = true;
    clearTimeout(rec.limit);
    if (error) {
      note(rec, `It did not start: ${error.message}`);
      rec.status = "failed";
    } else {
      rec.exitCode = typeof code === "number" ? code : null;
      rec.status = rec.stopping ? "stopped" : rec.exitCode === 0 ? "exited" : "failed";
    }
    if (rec.timedOut) note(rec, "Stopped: it ran longer than 5 minutes.");
    rec.endedAt = iso();
    rec.ms = Date.now() - rec.startMs;
    flush(rec);
    pruneEnded(rec.slug);
    emit(rec);
    if (!rec.background) {
      runner.record(rec.runId, { type: "command", at: rec.endedAt, project: rec.project, command: rec.command.slice(0, 300), exitCode: rec.exitCode, ms: rec.ms, background: false });
    }
    if (rec.waiter) rec.waiter();
  }

  function pruneEnded(slug) {
    const ended = [...procs.values()].filter((r) => r.slug === slug && r.status !== "running");
    for (const r of ended.slice(0, Math.max(0, ended.length - ENDED_KEPT))) procs.delete(r.id);
  }

  function attach(rec, child) {
    const out = new StringDecoder("utf8");
    const err = new StringDecoder("utf8");
    child.stdout.on("data", (b) => write(rec, "out", out.write(b)));
    child.stderr.on("data", (b) => write(rec, "err", err.write(b)));
    child.on("error", (error) => done(rec, { error }));
    child.on("close", (code) => done(rec, { code }));
  }

  /** A command in one of the bot's projects. Foreground: its exit code, time and the end of its output. Background: its id at once. */
  async function command(ctx, p) {
    const slug = ctx.slug;
    const bot = botOf(slug);
    if (!bot || bot.projects !== "on") throw new Error(`Projects are off for ${botName(slug)}. Ask the person to turn them on in Details.`);
    const project = projectName(p.project);
    const { program, args } = parseCommand(p.command);
    const background = p.background === true;
    if (runningOf(slug).length >= MAX_RUNNING) {
      throw new Error(`${MAX_RUNNING} processes are running for ${botName(slug)}, the most at once. Stop one with processes {action: "stop", id} first. Running: ${runningOf(slug).map((r) => r.id).join(", ")}.`);
    }
    const node = nodeFor();
    const tool = program === "node" ? null : entryOf(node.dir, program);
    await permit(ctx, slug, project);

    const loc = disk.locate(slug, `Files/Projects/${project}`);
    fs.mkdirSync(loc.abs, { recursive: true });
    const dir = fs.realpathSync.native(loc.abs);
    const tmp = path.join(dir, ".tmp");
    fs.mkdirSync(tmp, { recursive: true });

    const perms = ["--permission", `--allow-fs-read=${dir}`, `--allow-fs-read=${node.dir}`, `--allow-fs-write=${dir}`];
    let argv;
    if (program === "node") argv = [...perms, ...args];
    else if (program === "npx") argv = [...perms, `--allow-fs-read=${tool.pkgRoot}`, tool.entry, ...args];
    else {
      const cache = path.join(dir, ".npm-cache");
      fs.mkdirSync(cache, { recursive: true });
      argv = [...perms, `--allow-fs-read=${tool.pkgRoot}`, `--allow-fs-read=${cache}`, `--allow-fs-write=${cache}`, tool.entry, ...args, "--cache", cache, ...NPM_FLAGS];
    }
    const env = { PATH: node.dir, TEMP: tmp, TMP: tmp, TMPDIR: tmp, HOME: dir, USERPROFILE: dir };
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;

    const text = String(p.command).trim();
    const rec = {
      id: crypto.randomUUID().slice(0, 8),
      slug,
      runId: ctx.runId,
      project,
      command: text,
      background,
      status: "running",
      exitCode: null,
      port: null,
      startedAt: iso(),
      endedAt: null,
      child: null,
      out: "",
      total: 0,
      pending: [],
      timer: null,
      scan: "",
      stopping: false,
      timedOut: false,
      ended: false,
      waiter: null,
      limit: null,
      ms: 0,
      startMs: Date.now(),
    };
    let child;
    try {
      child = spawn(node.exe, argv, { cwd: dir, env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      throw new Error(`Couldn't start ${program} in Projects/${project}: ${e.message}`);
    }
    rec.child = child;
    procs.set(rec.id, rec);
    attach(rec, child);
    emit(rec);

    if (background) {
      runner.record(ctx.runId, { type: "command", at: rec.startedAt, project, command: text.slice(0, 300), exitCode: null, ms: 0, background: true });
      return {
        text: `Started ${text} in Projects/${project} as ${rec.id}. It runs in the background. Check it with processes {action: "output", id: "${rec.id}"}; when it prints a localhost address, Crew opens it in your browser.`,
      };
    }
    const waited = new Promise((resolve) => (rec.waiter = resolve));
    rec.limit = setTimeout(() => {
      rec.timedOut = true;
      kill(rec);
    }, FOREGROUND_MS);
    await waited;
    const { shown, cut } = shownOf(rec);
    const outcome = rec.timedOut ? "Stopped: it ran longer than 5 minutes." : rec.exitCode === null ? "It stopped without an exit code." : `Exit code ${rec.exitCode} after ${seconds(rec.ms)}.`;
    return { text: `${outcome}\n${cut}${shown || "(no output)"}` };
  }

  /** The bot's process: a record for it, or a refusal naming the ones there are. */
  function get(slug, id) {
    const rec = procs.get(String(id ?? ""));
    if (!rec || rec.slug !== slug) {
      const mine = [...procs.values()].filter((r) => r.slug === slug).map((r) => r.id);
      throw new Error(`There is no process "${String(id ?? "").slice(0, 20)}". Processes: ${mine.join(", ") || "none"}. List them with processes {action: "list"}.`);
    }
    return rec;
  }

  const lineOf = (r) => `${r.id}  ${r.status}  Projects/${r.project}  ${r.command}${r.port !== null ? `  http://localhost:${r.port}` : ""}${r.exitCode !== null ? `  exit ${r.exitCode}` : ""}`;

  return {
    /** The bot's processes: the node, npm and npx commands it ran in its projects. */
    command,

    /** The processes tool: list them, stop one, or read its output (the end of it, 16 KB at most). */
    processes(ctx, p) {
      const slug = ctx.slug;
      const action = p.action;
      if (action === "list") {
        const mine = [...procs.values()].filter((r) => r.slug === slug);
        return { text: mine.length ? mine.map(lineOf).join("\n") : "No processes." };
      }
      if (action === "stop") {
        const rec = get(slug, p.id);
        if (rec.status !== "running") return { text: `${rec.id} has already ${rec.status === "stopped" ? "stopped" : "ended"}.` };
        kill(rec);
        return { text: `Stopping ${rec.id}.` };
      }
      if (action === "output") {
        const rec = get(slug, p.id);
        const { shown, cut } = shownOf(rec);
        return { text: `${lineOf(rec)}\n${cut}${shown || "(no output yet)"}` };
      }
      throw new Error(`Use the action list, stop or output, not "${String(action ?? "").slice(0, 20)}".`);
    },

    /** The IPC view: the bot's processes, as the Processes window shows them. */
    list(slug) {
      return [...procs.values()].filter((r) => r.slug === slug).map(infoOf);
    },

    /** The person stopped the bot's run: its background processes stop too. Returns the bot's processes. */
    stop(slug, id) {
      const rec = get(slug, id);
      if (rec.status === "running") kill(rec);
      return [...procs.values()].filter((r) => r.slug === slug).map(infoOf);
    },

    /** The person stopped the bot's run: its running processes stop. */
    stopAll(slug) {
      for (const rec of runningOf(slug)) kill(rec);
    },

    /** Crew quits: every running process stops. */
    killAll() {
      for (const rec of [...procs.values()]) if (rec.status === "running") kill(rec);
    },

    /** A run ended: its once-only approvals and denials end with it. */
    endRun(runId) {
      approvedInRun.delete(runId);
      deniedInRun.delete(runId);
    },
  };
}

/** The version of a Node executable, as `node -p process.versions.node` says it. */
function defaultVersionOf(exe) {
  return childProcess.execFileSync(exe, ["-p", "process.versions.node"], { encoding: "utf8", windowsHide: true, timeout: 15_000, env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {} });
}

module.exports = { createProjects, splitWords, parseCommand, projectName, MAX_RUNNING, FOREGROUND_MS, OUTPUT_KEEP, OUTPUT_SHOWN };
