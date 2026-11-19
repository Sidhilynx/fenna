// Wakes bots on their schedules. Checks every half minute (and whenever the
// crew changes) which bots are due. A run missed while the app was closed
// runs once when it opens, if it was missed by less than a day; older ones
// are skipped. A bot that is already running or queued is not stacked up.

const F = require("./format.cjs");

const TICK_MS = 30_000;
const CATCH_UP_MS = 24 * 3600_000;

/**
 * @param {object} o
 * @param {ReturnType<import("./store.cjs").createStore>} o.store
 * @param {{ enqueue: Function, running(slug: string): object|null, isQueued(slug: string): boolean }} o.runner
 * @param {() => Date} [o.now]
 */
function createScheduler({ store, runner, now = () => new Date() }) {
  let timer = null;

  /** The next time a bot wakes, or null (manual, or bot.md can't be read). */
  function nextFor(slug) {
    const r = store.readBot(slug);
    if (!r || !r.bot || r.diagnostics.some((d) => d.severity === "error")) return null;
    const s = F.parseSchedule(r.bot.schedule);
    if ("error" in s || s.schedule.kind === "manual") return null;
    const state = store.readState(slug);
    const base = state.lastScheduledAt ? new Date(state.lastScheduledAt) : null;
    return { schedule: s.schedule, due: base ? F.nextRun(s.schedule, base) : null };
  }

  /** Wake every bot that is due. Returns the slugs woken. */
  function tick() {
    const t = now();
    const woke = [];
    for (const slug of store.slugs()) {
      const n = nextFor(slug);
      if (!n) continue;
      if (!n.due) {
        // First time seen: count from now, so a new bot waits for its first slot.
        store.patchState(slug, (s) => {
          s.lastScheduledAt = t.toISOString();
        });
        continue;
      }
      if (n.due.getTime() > t.getTime()) continue;
      store.patchState(slug, (s) => {
        s.lastScheduledAt = t.toISOString();
      });
      if (t.getTime() - n.due.getTime() > CATCH_UP_MS) continue;
      if (runner.running(slug) || runner.isQueued(slug)) continue;
      runner.enqueue({ slug, trigger: "schedule" });
      woke.push(slug);
    }
    return woke;
  }

  return {
    tick,
    /** When a bot next wakes on its own (ISO), or null. */
    nextRun(slug) {
      const n = nextFor(slug);
      if (!n) return null;
      const t = now();
      const due = n.due && n.due.getTime() > t.getTime() ? n.due : F.nextRun(n.schedule, t);
      return due ? due.toISOString() : null;
    },
    start() {
      if (timer) return;
      tick();
      timer = setInterval(tick, TICK_MS);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createScheduler };
