// Runs bots: one turn of the bot's CLI at a time per bot, at most
// `maxConcurrent` at once across the crew (hand-offs from a running bot
// don't count, or a lead waiting on its member could never finish). The
// rest wait in a queue, in order. Every event goes to the run's log file
// (runs/<iso>.jsonl) and to the page as it happens.

const crypto = require("node:crypto");
const F = require("./format.cjs");
const { buildPrompt } = require("./prompt.cjs");

const RUN_TIMEOUT_MS = 30 * 60_000;
/** A chat this full after a person's run is compacted before the next one. */
const COMPACT_AT = 0.8;
const COMPACT_ASK =
  "Your context is getting full, so this chat will continue in a fresh conversation. Write a summary of this chat for yourself to continue from: what the person wants, what you did and found, decisions, open tasks, names, links and file paths that matter. Reply with only the summary, at most 400 words.";
const LOST_SESSION = /no conversation found|(session|thread|conversation)[^.]{0,40}not found|unknown (session|conversation)/i;

const firstLine = (t) => String(t || "").trim().split(/\r?\n/)[0].replace(/[*_`#>]/g, "").trim().slice(0, F.LIMITS.status);

/** The library folder a path names (its first segment), or null for an absolute path, one with "..", or anything that is not a plain name. */
function libraryFolder(p) {
  if (typeof p !== "string") return null;
  const s = p.trim().replace(/\\/g, "/");
  if (!s || s.startsWith("/") || /^[A-Za-z]:/.test(s) || s.includes("..")) return null;
  const first = s.split("/").find((seg) => seg && seg !== ".");
  return first && first.length <= 200 && /^\w[\w.-]*$/.test(first) ? first : null;
}

/** The folder new_document reports in its result: `at path "<folder>"`. */
function folderFromResult(text) {
  const m = /\bat path "([^"\n]+)"/.exec(String(text || ""));
  return m ? libraryFolder(m[1]) : null;
}

/** Calls that make or change a library document: the fenna tools, and new_document. */
const isLibraryCall = (server, tool) => server === "fenna" || tool === "new_document";

/**
 * @param {object} o
 * @param {ReturnType<import("./store.cjs").createStore>} o.store
 * @param {Function} o.startRun     the shell's startRun
 * @param {(o: { slug: string, bot: object, token: string }) => object} o.serversFor  servers, trusted, home, env
 * @param {{ issue(ctx: object): string, revoke(token: string): void }} o.link
 * @param {ReturnType<import("./waits.cjs").createWaits>} o.waits
 * @param {(slug: string, runId: string, event: object) => void} o.emitLive
 * @param {() => void} o.onChange
 * @param {(tool: string, params: object, server: string) => string|null} [o.toolLabel]
 * @param {(name: string) => boolean} [o.installed]  whether a granted connector is installed (the prompt names only those)
 * @param {(runId: string) => void} [o.onEnd]  a run ended (its connector calls in flight are stopped)
 */
function createRunner({ store, startRun, serversFor, link, waits, emitLive, onChange, toolLabel, installed, onEnd = () => {}, now = () => new Date(), maxConcurrent = 2, runTimeoutMs = RUN_TIMEOUT_MS }) {
  /** @type {Map<string, object>} slug → its running run */
  const active = new Map();
  /** @type {object[]} */
  const queue = [];
  const byId = new Map();

  const iso = () => now().toISOString();

  function record(run, event) {
    store.appendRun(run.slug, run.file, event);
    emitLive(run.slug, run.runId, event);
  }

  function others(slug) {
    const out = [];
    for (const s of store.slugs()) {
      if (s === slug) continue;
      const r = store.readBot(s);
      if (r && r.bot) out.push({ slug: s, name: r.bot.name, job: r.bot.job });
    }
    return out;
  }

  function teamInfo(teamSlug) {
    if (!teamSlug) return null;
    const t = store.readTeam(teamSlug);
    return t && t.team ? { slug: teamSlug, ...t.team } : null;
  }

  /**
   * Queue a run. trigger: person | schedule | bot | welcome | watch | compact. A hand-off
   * (trigger "bot") carries the chain it belongs to. `chat` picks the chat; by default the
   * person's own messages go to their current chat and everything else to the runs chat.
   * @returns {{ runId: string, queued: boolean, done: Promise<{ outcome: string, text: string, message: string|null }> }}
   */
  function enqueue({ slug, trigger, text = "", from = null, team = null, chain = null, chat = null }) {
    if (!store.readBot(slug)) throw new Error(`There is no bot "${slug}".`);
    const runId = crypto.randomUUID();
    let resolve;
    const done = new Promise((r) => (resolve = r));
    const item = { runId, slug, trigger, text: trigger === "compact" ? COMPACT_ASK : text, from, team, chain, chat, resolve, handoff: trigger === "bot" };
    queue.push(item);
    pump();
    onChange();
    const r = active.get(slug);
    return { runId, queued: !r || r.runId !== runId, done };
  }

  function rootCount() {
    let n = 0;
    for (const r of active.values()) if (!r.handoff) n++;
    return n;
  }

  function pump() {
    for (let i = 0; i < queue.length; ) {
      const item = queue[i];
      if (active.has(item.slug) || (!item.handoff && rootCount() >= maxConcurrent)) {
        i++;
        continue;
      }
      queue.splice(i, 1);
      begin(item);
    }
  }

  function begin(item) {
    let at = now();
    // Two runs of one bot in the same millisecond still get their own files.
    while (store.hasRun(item.slug, F.runFileName(at))) at = new Date(at.getTime() + 1);
    const run = {
      ...item,
      file: F.runFileName(at),
      startedAt: at,
      lastText: "",
      lastTool: "",
      statusSet: false,
      mood: null,
      stopping: false,
      retried: false,
      handle: null,
      token: null,
      timer: null,
      cli: "claude",
    };
    const loaded = store.readBot(item.slug);
    const bot = loaded && loaded.bot;
    active.set(item.slug, run);
    byId.set(run.runId, run);
    run.cli = bot ? bot.brain.cli : "claude";
    run.chat = chatFor(item);
    if (item.trigger === "person" && run.chat !== F.RUNS_CHAT) {
      store.patchState(item.slug, (s) => {
        const c = F.chatIn(s, run.chat);
        if (!c.title) c.title = firstLine(item.text).slice(0, 80);
        if (!c.startedAt) c.startedAt = at.toISOString();
      });
    }
    record(run, { type: "start", at: at.toISOString(), runId: run.runId, trigger: item.trigger, text: item.text, from: item.from, team: item.team, cli: run.cli, model: bot ? bot.brain.model : "", chat: run.chat });
    const errors = loaded ? loaded.diagnostics.filter((d) => d.severity === "error") : [];
    if (!bot || errors.length) {
      finish(run, "error", `bot.md has problems, so it can't run: ${errors.map((d) => d.message).join(" ") || "it could not be read."}`);
      return;
    }
    run.timer = setTimeout(() => {
      run.timeoutHit = true;
      stopRun(run);
    }, runTimeoutMs);
    launch(run, bot);
  }

  /** The chat a queued run goes to: the one it names, the person's current chat for what they typed, else the runs chat. */
  function chatFor(item) {
    if (item.chat) return item.chat;
    if (item.trigger === "person" && !item.team) return store.readState(item.slug).current;
    return F.RUNS_CHAT;
  }

  function launch(run, bot) {
    const chat = F.chatIn(store.readState(run.slug), run.chat);
    const sessionId = run.retried ? null : chat.sessions[bot.brain.cli] || null;
    run.sessionId = sessionId;
    // A fresh conversation in a compacted chat starts from the chat's summary.
    const earlier = !sessionId && chat.summary && run.trigger !== "compact" ? chat.summary : "";
    const from = run.from ? store.readBot(run.from) : null;
    const prompt = buildPrompt({
      slug: run.slug,
      bot,
      memory: store.readMemory(run.slug),
      library: store.library(run.slug),
      watches: store.readWatches(run.slug),
      todos: store.readTodos(run.slug),
      others: others(run.slug),
      team: teamInfo(run.team),
      trigger: run.trigger,
      text: run.text,
      earlier,
      from: from && from.bot ? { slug: run.from, name: from.bot.name } : null,
      now: now(),
      installed,
    });
    if (!run.token) run.token = link.issue({ slug: run.slug, runId: run.runId, team: run.team, chain: run.chain });
    try {
      run.handle = startRun({
        kind: bot.brain.cli,
        model: bot.brain.model,
        effort: bot.brain.effort,
        prompt,
        cwd: store.botDir(run.slug),
        sessionId,
        ...serversFor({ slug: run.slug, bot, token: run.token }),
        toolLabel,
        onEvent: (ev) => onEvent(run, ev),
      });
    } catch (e) {
      finish(run, "error", e.message);
    }
  }

  function onEvent(run, ev) {
    if (run.ended) return;
    if (ev.type === "session" && ev.sessionId) {
      store.patchState(run.slug, (s) => {
        F.chatIn(s, run.chat).sessions[run.cli] = ev.sessionId;
      });
    } else if (ev.type === "usage") {
      const usage = { used: Math.max(0, Math.round(Number(ev.used) || 0)), window: Number(ev.window) > 0 ? Math.round(Number(ev.window)) : null };
      run.usage = usage;
      record(run, { type: "usage", at: iso(), ...usage });
    } else if (ev.type === "delta") {
      emitLive(run.slug, run.runId, { type: "delta", at: iso(), text: ev.text });
    } else if (ev.type === "text") {
      run.lastText = ev.text;
      record(run, { type: "text", at: iso(), text: ev.text });
    } else if (ev.type === "tool") {
      if (ev.label) run.lastTool = ev.label;
      const prev = run.tools || (run.tools = new Map());
      const known = prev.get(ev.id) || {};
      const merged = { server: ev.server || known.server || "", tool: ev.tool || known.tool || "", label: ev.label || known.label || "" };
      // The path argument comes with the call, the new document's path only with its result.
      const path = ev.path ?? known.path;
      if (isLibraryCall(merged.server, merged.tool)) merged.doc = known.doc || libraryFolder(path) || folderFromResult(ev.result) || null;
      prev.set(ev.id, { ...merged, path });
      record(run, { type: "tool", at: iso(), id: String(ev.id), ...merged, status: ev.status });
      if (ev.status === "running") onChange();
    } else if (ev.type === "done") {
      // A CLI that ends "successfully" having done and said nothing was stopped by something it didn't report.
      if (!run.lastText && !run.tools) finish(run, "error", `${F.CLI_NAMES[run.cli]} ended without doing or saying anything. Try again; if it keeps happening, check that it is signed in, or pick another brain.`);
      else finish(run, "done", null);
    } else if (ev.type === "stopped") {
      finish(run, "stopped", run.timeoutHit ? `Stopped after ${Math.round(runTimeoutMs / 60_000)} minutes, the longest a run may take.` : null);
    } else if (ev.type === "error") {
      // A conversation the CLI no longer has: start a fresh one, once.
      if (run.sessionId && !run.retried && LOST_SESSION.test(String(ev.message))) {
        run.retried = true;
        store.patchState(run.slug, (s) => {
          delete F.chatIn(s, run.chat).sessions[run.cli];
        });
        const r = store.readBot(run.slug);
        if (r && r.bot) return launch(run, r.bot);
      }
      finish(run, "error", String(ev.message || "The CLI stopped with an error."));
    }
  }

  function finish(run, outcome, message) {
    if (run.ended) return;
    run.ended = true;
    clearTimeout(run.timer);
    if (run.token) link.revoke(run.token);
    waits.cancelRun(run.runId);
    onEnd(run.runId);
    active.delete(run.slug);
    byId.delete(run.runId);
    record(run, { type: "end", at: iso(), outcome, message });
    let full = false;
    store.patchState(run.slug, (s) => {
      const chat = F.chatIn(s, run.chat);
      if (run.usage) chat.usage = { ...run.usage, at: iso() };
      if (run.trigger === "compact" && outcome === "done" && run.lastText.trim()) {
        chat.summary = run.lastText.trim().slice(0, F.MAX_SUMMARY);
        chat.sessions = {};
        chat.usage = null;
      }
      full = run.trigger !== "compact" && !!chat.usage && !!chat.usage.window && chat.usage.used / chat.usage.window >= COMPACT_AT;
      if (run.trigger === "compact") return;
      s.lastRunAt = iso();
      s.mood = "idle";
      if (!run.statusSet) {
        if (outcome === "done" && run.lastText) s.status = firstLine(run.lastText);
        else if (outcome === "error") s.status = firstLine(`Stopped: ${message || "error"}`);
        else if (outcome === "stopped") s.status = "Stopped";
      }
    });
    run.resolve({ outcome, text: run.lastText, message });
    if (full && outcome === "done") enqueue({ slug: run.slug, trigger: "compact", chat: run.chat });
    pump();
    onChange();
  }

  function stopRun(run) {
    run.stopping = true;
    waits.cancelRun(run.runId);
    if (run.handle) run.handle.stop();
    else finish(run, "stopped", null);
  }

  return {
    enqueue,

    /** Stop a bot's run and drop its queued ones. True if there was anything to stop. */
    stop(slug) {
      let any = false;
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].slug !== slug) continue;
        const [item] = queue.splice(i, 1);
        item.resolve({ outcome: "stopped", text: "", message: "Stopped before it started." });
        any = true;
      }
      const run = active.get(slug);
      if (run) {
        stopRun(run);
        any = true;
      }
      if (any) onChange();
      return any;
    },

    stopAll() {
      for (const item of queue.splice(0)) item.resolve({ outcome: "stopped", text: "", message: "Fenna Crew quit." });
      for (const run of active.values()) stopRun(run);
    },

    /** Log an event in a running run (asks, approvals, hand-offs, status). */
    record(runId, event) {
      const run = byId.get(runId);
      if (run) record(run, event);
    },

    /** The bot set its own status in this run. */
    markStatus(runId, mood) {
      const run = byId.get(runId);
      if (!run) return;
      run.statusSet = true;
      run.mood = mood || run.mood;
    },

    running(slug) {
      const r = active.get(slug);
      return r ? { runId: r.runId, lastTool: r.lastTool, statusSet: r.statusSet, mood: r.mood, startedAt: r.startedAt.toISOString(), file: r.file, chat: r.chat } : null;
    },

    isQueued(slug) {
      return queue.some((q) => q.slug === slug);
    },

    queueOrder() {
      return queue.map((q) => q.slug);
    },

    activeSlugs() {
      return [...active.keys()];
    },
  };
}

module.exports = { createRunner, libraryFolder, folderFromResult };
