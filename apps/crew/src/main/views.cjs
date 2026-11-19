// What the page shows, put together from the store, the runner, the waits,
// the scheduler and the browsers (the shapes in src/shared/contract.ts).

const F = require("./format.cjs");

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SLEEP_AFTER_MS = 60 * 60_000;
const pad = (n) => String(n).padStart(2, "0");

/** "17:00" today, "Fri 17:00" this week, "28 Nov 17:00" later. */
function shortTime(d, now) {
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - day0) / 86_400_000);
  if (days === 0) return hm;
  if (days > 0 && days < 7) return `${DAYS[d.getDay()]} ${hm}`;
  return `${d.getDate()} ${d.toLocaleString("en", { month: "short" })} ${hm}`;
}

function createViews({ store, runner, waits, scheduler, browsers, settings, offers = () => [], now = () => new Date() }) {
  function teamsOf() {
    const out = [];
    for (const slug of store.teamSlugs()) {
      const t = store.readTeam(slug);
      if (t && t.team) out.push({ slug, ...t.team, diagnostics: t.diagnostics });
    }
    return out;
  }

  function summary(slug, teams) {
    const r = store.readBot(slug);
    if (!r) return null;
    const t = now();
    const bot = r.bot;
    const state = store.readState(slug);
    const run = runner.running(slug);
    const queued = runner.isQueued(slug);
    const waiting = waits.list().filter((w) => w.slug === slug);
    const next = scheduler.nextRun(slug);
    const s = bot ? F.parseSchedule(bot.schedule) : { error: "" };
    const errors = r.diagnostics.filter((d) => d.severity === "error");

    let mood = "idle";
    let statusLine = state.status || "Ready";
    if (waiting.length) {
      mood = "need";
      const w = waiting[0];
      statusLine = w.kind === "ask" ? `Needs you: ${w.question}` : `Needs you: approve “${w.action}”`;
    } else if (run) {
      mood = run.mood && run.mood !== "need" ? run.mood : "work";
      statusLine = (run.statusSet && state.status) || run.lastTool || "Starting";
    } else if (queued) {
      mood = "work";
      statusLine = "Waiting for a free slot";
    } else if (errors.length) {
      statusLine = "bot.md has a problem";
    } else if (next && new Date(next).getTime() - t.getTime() > SLEEP_AFTER_MS) {
      mood = "sleep";
      statusLine = `Asleep until ${shortTime(new Date(next), t)}`;
    }

    return {
      slug,
      name: bot ? bot.name || slug : slug,
      job: bot ? bot.job : "",
      ...(bot ? { avatar: bot.avatar, color: bot.color } : F.defaultAvatar(slug)),
      mood,
      statusLine: statusLine.slice(0, 200),
      status: state.status,
      schedule: bot ? bot.schedule : "",
      scheduleLabel: "error" in s ? (bot ? bot.schedule : "") : F.describeSchedule(s.schedule),
      nextRun: next,
      lastRunAt: state.lastRunAt,
      running: !!run,
      runningChat: run ? run.chat : null,
      queued,
      needs: waiting.length,
      wallpaper: bot ? bot.wallpaper : F.WALLPAPERS[0],
      brain: bot ? bot.brain : { cli: "claude", model: "", effort: "" },
      leads: teams.filter((x) => x.lead === slug).map((x) => x.slug),
      teams: teams.filter((x) => x.lead === slug || x.members.includes(slug)).map((x) => x.slug),
      diagnostics: r.diagnostics,
      browser: browsers.state(slug),
      currentChat: state.current,
      chats: state.chats.map((c) => ({ id: c.id, title: c.title, startedAt: c.startedAt, usage: c.usage, compacted: !!c.summary })),
    };
  }

  /** The chat each run file belongs to, read from its first line; a file's start never changes. */
  const chatOfFile = new Map();
  function runChat(slug, file) {
    const key = `${slug}/${file}`;
    if (!chatOfFile.has(key)) {
      const start = store.readRun(slug, file).find((e) => e.type === "start");
      if (!start) return F.RUNS_CHAT;
      chatOfFile.set(key, F.chatOfRun(start));
    }
    return chatOfFile.get(key);
  }

  function runSummaries(slug, limit) {
    const out = [];
    for (const file of store.runFiles(slug).slice(0, limit)) {
      const events = store.readRun(slug, file);
      const start = events.find((e) => e.type === "start");
      const end = events.find((e) => e.type === "end");
      const texts = events.filter((e) => e.type === "text");
      out.push({
        file,
        at: start ? start.at : F.runFileDate(file).toISOString(),
        trigger: start ? start.trigger : "person",
        text: start ? String(start.text || "").slice(0, 300) : "",
        outcome: end ? end.outcome : runner.running(slug) && runner.running(slug).file === file ? "running" : "stopped",
        reply: texts.length ? String(texts[texts.length - 1].text).slice(0, 300) : end && end.message ? String(end.message).slice(0, 300) : "",
      });
    }
    return out;
  }

  return {
    overview() {
      const teams = teamsOf();
      const bots = store.slugs().map((s) => summary(s, teams)).filter(Boolean);
      return {
        bots,
        teams: teams.map(({ slug, name, lead, members, purpose, diagnostics }) => ({ slug, name, lead, members, purpose, diagnostics })),
        waiting: waits.list(),
        offers: offers(),
        queue: runner.queueOrder(),
        settings: settings(),
        firstLaunch: bots.every((b) => !b.lastRunAt && !b.running && store.runFiles(b.slug).length === 0),
      };
    },

    bot(slug) {
      const r = store.readBot(slug);
      if (!r) throw new Error(`There is no bot "${slug}".`);
      const teams = teamsOf();
      return {
        summary: summary(slug, teams),
        bot: r.bot,
        memory: store.readMemory(slug),
        library: store.library(slug),
        runs: runSummaries(slug, 20),
        folder: store.botDir(slug),
      };
    },

    /** Runs oldest first, `limit` of them ending before the run file `before`. */
    history(slug, { before, limit = 10, chat } = {}) {
      const id = chat || store.readState(slug).current;
      const files = store.runFiles(slug).filter((f) => runChat(slug, f) === id);
      const start = before ? files.indexOf(before) + 1 : 0;
      if (before && start === 0) throw new Error(`There is no run "${before}"; reload the chat.`);
      const n = Math.min(Math.max(1, Number(limit) || 10), 50);
      const page = files.slice(start, start + n);
      return { chat: id, runs: page.reverse().map((file) => ({ file, events: store.readRun(slug, file) })), more: files.length > start + n };
    },

    team(slug) {
      const t = teamsOf().find((x) => x.slug === slug);
      if (!t) throw new Error(`There is no team "${slug}".`);
      return t;
    },
  };
}

module.exports = { createViews, shortTime };
