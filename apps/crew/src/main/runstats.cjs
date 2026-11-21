// Usage: what the runs say about the work each CLI and bot did on this
// computer. Runs and time come from each run's start and end lines; tokens
// and cost come from the tokens line a CLI reports, and are null wherever no
// run reported them (never 0). The reader parses only the start, end and
// tokens lines of each run file, and keeps a file's result until the file
// changes (its mtime or size). Files older than the 12 weeks shown are not read.

const fs = require("node:fs/promises");
const path = require("node:path");
const F = require("./format.cjs");

const DAY_BUCKETS = 30;
const WEEK_BUCKETS = 12;
const RANGE_DAYS = { "7d": 7, "30d": 30 };
const LIMIT_HITS_SHOWN = 200;
/** The same words the shell's friendly() turns into "hit its usage limit". */
const LIMIT = /rate.?limit|quota|429|usage limit/i;
/** A reset time a CLI states: "resets 3pm", "try again at 14:30", "resets at 3:00 PM". */
const RESET = /(?:resets?|try again(?: at)?|available again(?: at)?)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
const KEPT = new Set(["start", "end", "tokens"]);
const OUTCOME_KEY = { done: "ok", error: "failed", stopped: "stopped", unfinished: "unfinished" };

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Monday, local time. */
const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7));
const nonNeg = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

/** The earliest moment the page can show: the first day of the oldest week. */
function windowFrom(now) {
  return addDays(startOfWeek(now), -7 * (WEEK_BUCKETS - 1));
}

/** The start of a range ("7d", "30d" or "12w") that ends today. */
function rangeFrom(range, now) {
  if (range === "12w") return windowFrom(now);
  return addDays(startOfDay(now), -((RANGE_DAYS[range] || RANGE_DAYS["30d"]) - 1));
}

/**
 * The reset time a limit message states, as an ISO time after `from` (the
 * next time of day it names), or null when the message states none.
 */
function resetAt(message, from) {
  const m = RESET.exec(String(message || ""));
  if (!m || (!m[2] && !m[3])) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (m[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
  } else if (hour > 23) return null;
  if (minute > 59) return null;
  let at = new Date(from.getFullYear(), from.getMonth(), from.getDate(), hour, minute);
  if (at <= from) at = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, hour, minute);
  return at.toISOString();
}

/** What one run file says: its start, end and tokens lines, the only ones the page needs. */
function digest(text) {
  const events = [];
  for (const line of String(text).split("\n")) {
    if (!line.startsWith('{"type":"')) continue;
    const close = line.indexOf('"', 9);
    if (close < 0 || !KEPT.has(line.slice(9, close))) continue;
    try {
      const ev = JSON.parse(line);
      if (typeof ev.at === "string") events.push(ev);
    } catch {
      /* a cut-off last line */
    }
  }
  return events;
}

/** One run as the numbers the page needs; null when it has no start. */
function measure(events) {
  let start = null;
  let end = null;
  const tokens = [];
  for (const ev of events) {
    if (ev.type === "start" && !start) start = ev;
    else if (ev.type === "end") end = ev;
    else if (ev.type === "tokens") tokens.push(ev);
  }
  const t0 = start ? Date.parse(start.at) : NaN;
  if (!Number.isFinite(t0)) return null;
  const t1 = end ? Date.parse(end.at) : NaN;
  let input = null;
  let output = null;
  let costUsd = null;
  for (const t of tokens) {
    input = (input ?? 0) + nonNeg(t.input);
    output = (output ?? 0) + nonNeg(t.output);
    if (Number.isFinite(t.costUsd)) costUsd = (costUsd ?? 0) + t.costUsd;
  }
  return {
    start: t0,
    cli: start.cli ? String(start.cli) : "unknown",
    outcome: end ? (end.outcome in OUTCOME_KEY ? end.outcome : "unfinished") : "unfinished",
    ms: Number.isFinite(t1) ? Math.max(0, t1 - t0) : 0,
    endAt: Number.isFinite(t1) ? t1 : null,
    message: end && typeof end.message === "string" ? end.message : null,
    input,
    output,
    costUsd,
  };
}

const emptyRow = () => ({ runs: 0, ok: 0, failed: 0, stopped: 0, unfinished: 0, ms: 0, tokens: null, tokenRuns: 0, costUsd: null });

function addTo(row, r) {
  row.runs++;
  row[OUTCOME_KEY[r.outcome]]++;
  row.ms += r.ms;
  if (r.input !== null) {
    row.tokens = { input: (row.tokens ? row.tokens.input : 0) + r.input, output: (row.tokens ? row.tokens.output : 0) + r.output };
    row.tokenRuns++;
  }
  if (r.costUsd !== null) row.costUsd = (row.costUsd ?? 0) + r.costUsd;
}

/**
 * The page's numbers, from runs: [{ slug, name, file, events }], oldest or
 * newest first. `range` picks what the stats, tables and limit hits cover;
 * the day and week buckets always cover the last 30 days and 12 weeks.
 */
function summarize(runs, now = new Date(), range = "30d") {
  const from = rangeFrom(range, now).getTime();
  const dayStarts = [];
  for (let i = DAY_BUCKETS - 1; i >= 0; i--) dayStarts.push(addDays(startOfDay(now), -i).getTime());
  const weekStarts = [];
  for (let i = WEEK_BUCKETS - 1; i >= 0; i--) weekStarts.push(addDays(startOfWeek(now), -7 * i).getTime());
  const days = new Map(dayStarts.map((t) => [t, { start: t, runs: 0, ms: 0 }]));
  const weeks = new Map(weekStarts.map((t) => [t, { start: t, runs: 0, ms: 0 }]));

  const totals = emptyRow();
  totals.limitHits = 0;
  const clis = new Map(F.CLI_KINDS.map((k) => [k, { cli: k, name: F.CLI_NAMES[k], ...emptyRow() }]));
  const bots = new Map();
  const limitHits = [];

  for (const run of runs) {
    const r = measure(run.events || []);
    if (!r) continue;
    const day = days.get(startOfDay(new Date(r.start)).getTime());
    if (day) {
      day.runs++;
      day.ms += r.ms;
    }
    const week = weeks.get(startOfWeek(new Date(r.start)).getTime());
    if (week) {
      week.runs++;
      week.ms += r.ms;
    }
    if (r.start < from) continue;

    addTo(totals, r);
    if (!clis.has(r.cli)) clis.set(r.cli, { cli: r.cli, name: F.CLI_NAMES[r.cli] || r.cli, ...emptyRow() });
    addTo(clis.get(r.cli), r);

    if (!bots.has(run.slug)) bots.set(run.slug, { slug: run.slug, name: run.name || run.slug, runs: 0, ms: 0, byCli: new Map() });
    const bot = bots.get(run.slug);
    bot.runs++;
    bot.ms += r.ms;
    bot.byCli.set(r.cli, (bot.byCli.get(r.cli) || 0) + 1);

    if (r.outcome === "error" && r.endAt !== null && LIMIT.test(r.message || "")) {
      totals.limitHits++;
      limitHits.push({ at: new Date(r.endAt).toISOString(), slug: run.slug, name: bot.name, cli: r.cli, message: r.message, resetsAt: resetAt(r.message, new Date(r.endAt)) });
    }
  }

  const botRows = [...bots.values()]
    .map((b) => {
      let cli = null;
      let most = -1;
      for (const [k, n] of b.byCli) if (n > most) [cli, most] = [k, n];
      return { slug: b.slug, name: b.name, runs: b.runs, ms: b.ms, cli };
    })
    .sort((a, b) => b.ms - a.ms || b.runs - a.runs || a.name.localeCompare(b.name));
  limitHits.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return {
    range,
    generatedAt: now.toISOString(),
    totals,
    clis: [...clis.values()].sort((a, b) => F.CLI_KINDS.indexOf(a.cli) - F.CLI_KINDS.indexOf(b.cli)),
    bots: botRows,
    days: dayStarts.map((t) => days.get(t)),
    weeks: weekStarts.map((t) => weeks.get(t)),
    limitHits: limitHits.slice(0, LIMIT_HITS_SHOWN),
  };
}

/**
 * The page's reader over every bot's runs/ folder. `store` is the crew store
 * (slugs, readBot, botDir); `now` is injectable for tests.
 */
function createRunStats({ store, now = () => new Date() }) {
  /** @type {Map<string, { mtimeMs: number, size: number, events: object[] }>} */
  const cache = new Map();

  /** The runs since `from`, and how many run files the bots have in all. */
  async function collect(from) {
    const seen = new Set();
    const runs = [];
    let ever = 0;
    for (const slug of store.slugs()) {
      const dir = path.join(store.botDir(slug), "runs");
      let names;
      try {
        names = await fs.readdir(dir);
      } catch {
        continue;
      }
      const loaded = store.readBot(slug);
      const name = loaded && loaded.bot ? loaded.bot.name : slug;
      for (const file of names) {
        const at = F.runFileDate(file);
        if (!at) continue;
        ever++;
        if (at < from) continue;
        const full = path.join(dir, file);
        let st;
        try {
          st = await fs.stat(full);
        } catch {
          continue;
        }
        seen.add(full);
        let hit = cache.get(full);
        if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) {
          hit = { mtimeMs: st.mtimeMs, size: st.size, events: digest(await fs.readFile(full, "utf8").catch(() => "")) };
          cache.set(full, hit);
        }
        runs.push({ slug, name, file, events: hit.events });
      }
    }
    for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
    return { runs, ever };
  }

  return {
    /** The Usage page's numbers for a range ("7d", "30d" or "12w"); runsEver counts every run the bots have. */
    async get(range = "30d") {
      const at = now();
      const { runs, ever } = await collect(windowFrom(at));
      return { ...summarize(runs, at, range), runsEver: ever };
    },
  };
}

module.exports = { createRunStats, summarize, digest, resetAt, windowFrom };
