// The activity replay: what a bot did in one run, step by step, and how its
// browser looked after each browser step. The run log holds the steps (its
// tool events); the pictures are saved here, for the current run only, as
// runs/<runId>/frames/<n>.jpg with an index in frames/frames.json. A run keeps
// at most FRAMES_MAX pictures: past that, every other one is dropped and new
// ones come every other step. The 30 most recent runs of a bot keep their
// pictures; older ones are deleted.

const fs = require("node:fs");
const path = require("node:path");
const { toolLabel } = require("./labels.cjs");

const FRAMES_MAX = 300;
const RUNS_KEPT = 30;
const RUN_ID = /^[0-9a-f-]{8,64}$/i;

/**
 * @param {object} o
 * @param {ReturnType<import("./store.cjs").createStore>} o.store
 * @param {{ running(slug: string): { runId: string } | null }} o.runner
 * @param {number} [o.framesMax]
 * @param {number} [o.runsKept]
 */
function createReplay({ store, runner, framesMax = FRAMES_MAX, runsKept = RUNS_KEPT }) {
  /** @type {Map<string, { slug: string, stride: number, seen: number, index: object[] }>} runId → the pictures saved in this process */
  const live = new Map();

  const runsDir = (slug) => path.join(store.botDir(slug), "runs");
  const framesDir = (slug, runId) => path.join(runsDir(slug), runId, "frames");
  const indexFile = (slug, runId) => path.join(framesDir(slug, runId), "frames.json");

  /** Newest first: the time a run's pictures were last written (its folder when it has none). */
  function lastWrite(slug, runId) {
    for (const file of [indexFile(slug, runId), path.join(runsDir(slug), runId)]) {
      try {
        return fs.statSync(file).mtimeMs;
      } catch {
        /* not there: try the next */
      }
    }
    return 0;
  }

  /** Delete the pictures of the runs of this bot that are not the `runsKept` most recent, counting the run that is starting. */
  function pruneRuns(slug, starting) {
    let dirs;
    try {
      dirs = fs.readdirSync(runsDir(slug), { withFileTypes: true }).filter((d) => d.isDirectory() && RUN_ID.test(d.name) && d.name !== starting);
    } catch {
      return;
    }
    const ranked = dirs.map((d) => ({ runId: d.name, at: lastWrite(slug, d.name) })).sort((a, b) => b.at - a.at);
    for (const old of ranked.slice(runsKept - 1)) {
      fs.rmSync(path.join(runsDir(slug), old.runId), { recursive: true, force: true });
    }
  }

  /** The state of a run's pictures, made when its first step arrives (and older runs of the bot forgotten). */
  function stateFor(slug, runId) {
    let st = live.get(runId);
    if (st) return st;
    for (const [id, other] of live) if (other.slug === slug) live.delete(id);
    st = { slug, stride: 1, seen: 0, index: [] };
    live.set(runId, st);
    pruneRuns(slug, runId);
    return st;
  }

  /**
   * A bot's browser step finished: keep its picture if the current run has room
   * for it. Frames come from the browser (the bot's own tabs), never from the screen.
   * @param {string} slug
   * @param {{ at: string, action: string, url: string, jpeg: Buffer }} step
   */
  function onStep(slug, step) {
    const cur = runner.running(slug);
    if (!cur || !RUN_ID.test(cur.runId)) return;
    const st = stateFor(slug, cur.runId);
    const n = st.seen++;
    if (n % st.stride !== 0) return;
    if (st.index.length >= framesMax) {
      st.stride *= 2;
      const dir = framesDir(slug, cur.runId);
      st.index = st.index.filter((e) => {
        if (e.n % st.stride === 0) return true;
        fs.rmSync(path.join(dir, `${e.n}.jpg`), { force: true });
        return false;
      });
      if (n % st.stride !== 0) return;
    }
    const dir = framesDir(slug, cur.runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${n}.jpg`), step.jpeg);
    st.index.push({ n, at: step.at, action: step.action, url: step.url });
    fs.writeFileSync(indexFile(slug, cur.runId), JSON.stringify(st.index));
  }

  /** The saved pictures of a run, in order: [{ n, at, action, url }]. */
  function readIndex(slug, runId) {
    try {
      const list = JSON.parse(fs.readFileSync(indexFile(slug, runId), "utf8"));
      return Array.isArray(list) ? list.filter((e) => e && Number.isInteger(e.n) && typeof e.at === "string") : [];
    } catch {
      return [];
    }
  }

  /** The run file (name) that holds a run's start event, or null. */
  function fileOf(slug, runId) {
    for (const file of store.runFiles(slug)) {
      if (store.readRun(slug, file).some((e) => e.type === "start" && e.runId === runId)) return file;
    }
    return null;
  }

  /**
   * Every step of a run, oldest first: its tool calls (labels as the chat
   * shows them), with the picture after each browser step. A picture with no
   * tool call of its own is a step of its own. Pictures come as data URLs.
   * @returns {{ at: string, label: string, frame?: string, url?: string }[]}
   */
  function steps(slug, runId) {
    if (!RUN_ID.test(String(runId))) throw new Error(`"${String(runId).slice(0, 60)}" is not a run.`);
    const file = fileOf(slug, runId);
    if (!file) throw new Error("That run is not in this bot's history.");

    // A tool call is logged twice (running, then done): it starts at its first event and is named by its last.
    const calls = new Map();
    for (const e of store.readRun(slug, file)) {
      if (e.type !== "tool") continue;
      const got = calls.get(e.id);
      if (got) Object.assign(got, { label: e.label || got.label, tool: e.tool || got.tool, server: e.server || got.server });
      else calls.set(e.id, { at: e.at, label: e.label || "", tool: e.tool || "", server: e.server || "" });
    }
    const toolSteps = [...calls.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const browserSteps = toolSteps.filter((s) => s.server === "browser");

    // A picture belongs to the latest browser call of its action that started before it.
    const frames = readIndex(slug, runId).sort((a, b) => a.n - b.n);
    const owner = new Map();
    const orphans = [];
    for (const f of frames) {
      const t = Date.parse(f.at);
      let pick = null;
      for (let i = browserSteps.length - 1; i >= 0; i--) {
        const s = browserSteps[i];
        if (Date.parse(s.at) > t || owner.has(s) || s.tool !== f.action) continue;
        pick = s;
        break;
      }
      if (pick) owner.set(pick, f);
      else orphans.push(f);
    }

    const out = [];
    for (const s of toolSteps) {
      const f = owner.get(s);
      out.push({ at: s.at, label: s.label || toolLabel(s.tool, {}, s.server) || s.tool, ...(f ? pictureOf(slug, runId, f) : {}) });
    }
    for (const f of orphans) {
      out.push({ at: f.at, label: (toolLabel(f.action, { url: f.url }, "browser") || f.action).trim(), ...pictureOf(slug, runId, f) });
    }
    return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  /** The fields a step takes from its picture: the address, and the JPEG as a data URL when the file is there. */
  function pictureOf(slug, runId, f) {
    const out = {};
    if (f.url) out.url = f.url;
    try {
      out.frame = `data:image/jpeg;base64,${fs.readFileSync(path.join(framesDir(slug, runId), `${f.n}.jpg`)).toString("base64")}`;
    } catch {
      /* the picture was dropped */
    }
    return out;
  }

  return { onStep, steps };
}

module.exports = { createReplay, FRAMES_MAX, RUNS_KEPT };
