// A system notification when a bot starts waiting on the person (a question,
// an approval, an offer to save a login) and the window is out of sight.

const MAX_BODY = 140;

const clip = (text) => {
  const one = String(text).replace(/\s+/g, " ").trim();
  return one.length > MAX_BODY ? `${one.slice(0, MAX_BODY - 1)}…` : one;
};

/** What the notification says for one thing waiting, or null when there is nothing to say. */
function describe(wait) {
  if (wait.kind === "ask") return clip(wait.question);
  if (wait.kind === "approval") return clip(`Approve: ${wait.action}`);
  return null;
}

const hostOf = (origin) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

/**
 * @param {object} o
 * @param {{ new (o: { title: string, body: string }): { on(ev: "click", fn: () => void): void, show(): void }, isSupported(): boolean }} o.Notification
 * @param {() => boolean} o.enabled      the Notifications setting
 * @param {() => boolean} o.attended     the window is visible, not minimized and focused
 * @param {(slug: string) => void} o.open  show the window on that bot's chat
 */
function createNotifier({ Notification, enabled, attended, open }) {
  /** Ids already told about (or seen while the person was looking), kept only while they still wait. */
  let seen = new Set();
  /** Shown notifications, held so they are not collected before the person clicks. */
  const shown = new Set();

  return {
    /** Call with everything waiting now. Each wait is announced once, however often this runs. */
    check(waiting, offers = []) {
      const items = [
        ...waiting.map((w) => ({ id: w.id, slug: w.slug, title: w.botName, body: describe(w) })),
        ...offers.map((o) => ({ id: `offer:${o.id}`, slug: o.slug, title: o.botName, body: `Save the login for ${hostOf(o.origin)}?` })),
      ];
      const next = new Set(items.map((i) => i.id));
      const fresh = items.filter((i) => !seen.has(i.id));
      seen = next;
      if (!fresh.length || !enabled() || attended() || !Notification.isSupported()) return 0;
      let count = 0;
      for (const item of fresh) {
        if (!item.body) continue;
        const n = new Notification({ title: item.title, body: item.body });
        shown.add(n);
        n.on("click", () => {
          shown.delete(n);
          open(item.slug);
        });
        n.on("close", () => shown.delete(n));
        n.show();
        count++;
      }
      return count;
    },
  };
}

module.exports = { createNotifier, describe };
