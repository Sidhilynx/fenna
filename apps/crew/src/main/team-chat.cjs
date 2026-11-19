// A person's message to a group chat (a team, in the data): who gets it, and
// where each reply goes.

const F = require("./format.cjs");

/**
 * @param {object} o
 * @param {ReturnType<import("./store.cjs").createStore>} o.store
 * @param {ReturnType<import("./runner.cjs").createRunner>} o.runner
 * @param {() => void} o.onChange
 */
function createTeamChat({ store, runner, onChange }) {
  const iso = () => new Date().toISOString();

  /**
   * Bots the message @mentions get it one after another (@all: the lead, then every member); with no mention it
   * goes to the lead. Each reply goes in the thread under that bot's folder name. At most LIMITS.teamMembers runs
   * start. Returns the first run.
   */
  function send(slug, text) {
    const t = store.readTeam(slug);
    if (!t || !t.team) throw new Error(`There is no team "${slug}".`);
    const errors = t.diagnostics.filter((d) => d.severity === "error");
    if (errors.length) throw new Error(`team.md has problems: ${errors.map((d) => d.message).join(" ")}`);
    const people = [t.team.lead, ...t.team.members].map((s) => {
      const b = store.readBot(s);
      return { slug: s, name: b && b.bot ? b.bot.name : s };
    });
    const mentioned = F.mentionedBots(text, people).slice(0, F.LIMITS.teamMembers);
    const targets = mentioned.length ? mentioned : [t.team.lead];
    const ask = (to) => {
      const r = runner.enqueue({ slug: to, trigger: "person", text, team: slug });
      const done = r.done.then((res) => {
        store.appendThread(slug, { at: iso(), from: to, text: res.text || (res.message ? `(${res.message})` : "(no reply)") });
        onChange();
      });
      return { r, done };
    };
    store.appendThread(slug, { at: iso(), from: "person", text });
    const first = ask(targets[0]);
    targets.slice(1).reduce(
      (prev, to) =>
        prev
          .then(() => ask(to).done)
          .catch((e) => {
            store.appendThread(slug, { at: iso(), from: to, text: `(${e.message})` });
            onChange();
          }),
      first.done,
    );
    return { runId: first.r.runId, queued: first.r.queued };
  }

  return { send };
}

module.exports = { createTeamChat };
