// What bots are waiting on the person for: a question (ask_human) or an
// approval (request_approval, create_bot, or the CLI's own permission
// request). The tool call that asked stays open until the person answers in
// the app, the run is stopped, or the wait times out.

const crypto = require("node:crypto");

const DEFAULT_TIMEOUT_MS = 15 * 60_000;

/**
 * @param {{ timeoutMs?: number, onChange?: () => void, now?: () => Date }} [o]
 */
function createWaits({ timeoutMs = DEFAULT_TIMEOUT_MS, onChange = () => {}, now = () => new Date() } = {}) {
  /** @type {Map<string, { record: object, resolve: (r: { value: any, by: "person"|"timeout"|"stopped" }) => void, timer: NodeJS.Timeout }>} */
  const open = new Map();

  function settle(id, value, by) {
    const w = open.get(id);
    if (!w) return false;
    open.delete(id);
    clearTimeout(w.timer);
    w.resolve({ value, by });
    onChange();
    return true;
  }

  return {
    timeoutMs,

    /**
     * Wait for the person. record: { kind: "ask"|"approval", slug, botName, runId, …fields shown }.
     * @returns {{ id: string, done: Promise<{ value: any, by: "person"|"timeout"|"stopped" }> }}
     */
    add(record) {
      const id = crypto.randomUUID();
      const at = now();
      const full = { ...record, id, at: at.toISOString(), expiresAt: new Date(at.getTime() + timeoutMs).toISOString() };
      const done = new Promise((resolve) => {
        const timer = setTimeout(() => settle(id, null, "timeout"), timeoutMs);
        open.set(id, { record: full, resolve, timer });
      });
      onChange();
      return { id, record: full, done };
    },

    /** The person's answer. False if nothing waits under that id (answered, timed out or stopped). */
    answer(id, value) {
      return settle(String(id), value, "person");
    },

    /** End every wait of a run (it was stopped). */
    cancelRun(runId) {
      for (const [id, w] of [...open]) if (w.record.runId === runId) settle(id, null, "stopped");
    },

    get(id) {
      const w = open.get(String(id));
      return w ? w.record : null;
    },

    /** Everything waiting, oldest first. */
    list() {
      return [...open.values()].map((w) => w.record).sort((a, b) => a.at.localeCompare(b.at));
    },
  };
}

module.exports = { createWaits };
