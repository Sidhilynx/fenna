// Anonymous usage counts and feedback (PRIVACY.md, "Usage counts").
//
// Events are counted here as they happen, per local day, in usage.json in
// userData. Each finished day is sent once to the usage server as plain
// numbers: never names, text, addresses or files. Off means nothing is
// counted or sent and the file is deleted; FENNA_NO_USAGE=1 turns it all off.
// Feedback is separate: it is sent only when the person presses Send.
//
// FENNA_USAGE_URL replaces the server's address, for testing against a local
// server. It is not a setting and is not documented for people.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const BASE = "https://usage.sidhilynx.com";
const PROTOCOL = 1;
const MAX_BODY = 4096;
const MAX_FEEDBACK = 1000;
const MAX_DAYS = 7;
const FIRST_SEND_MS = 60_000;
const CHECK_MS = 6 * 60 * 60_000;
const FLUSH_MS = 1000;
const SEND_TIMEOUT_MS = 15_000;
/** Sent days are kept this long, so a day is never sent twice. */
const KEEP_SENT_DAYS = 14;

/** Every count there is, in the order they are sent. */
const COUNT_KEYS = [
  "bots", "groups", "connectors", "logins",
  "runs", "runs_ok", "runs_failed", "runs_scheduled", "runs_watch", "runs_manual",
  "approvals", "approvals_denied", "questions", "take_control", "messages", "bots_created", "editor_opens",
];
/** The counts read from the app when a day is sent (totals), not counted by events. */
const TOTAL_KEYS = ["bots", "groups", "connectors", "logins"];
const EVENT_KEYS = COUNT_KEYS.filter((k) => !TOTAL_KEYS.includes(k));
const FIRST_KEYS = ["signed_in", "bot", "run_ok"];
const CLI_ORDER = ["claude", "codex", "agy"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The local date as YYYY-MM-DD. */
function localDay(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

const osName = (platform = process.platform) => (platform === "win32" ? "win" : platform === "darwin" ? "mac" : "linux");
const archName = (arch = process.arch) => (arch === "arm64" ? "arm64" : "x64");

/** The counts a run adds when it ends: what kind of run it was and how it went. Hand-offs and summaries add none. */
function runCounts({ trigger, outcome, manual = false }) {
  if (trigger === "compact") return [];
  const out = ["runs"];
  if (outcome === "done") out.push("runs_ok");
  else if (outcome === "error") out.push("runs_failed");
  if (trigger === "schedule") out.push(manual ? "runs_manual" : "runs_scheduled");
  else if (trigger === "watch") out.push("runs_watch");
  else if (trigger === "person") out.push("runs_manual");
  return out;
}

const whole = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * The body of one ping. Only what the contract lists, zeros left out.
 * @param {{ id: string, version: string, os: string, arch: string, day: string, cli: string[], counts: Record<string, number>, first: Record<string, boolean> }} o
 */
function buildPing({ id, version, os, arch, day, cli, counts, first }) {
  const out = {};
  for (const k of COUNT_KEYS) {
    const n = whole(counts[k]);
    if (n) out[k] = n;
  }
  const seen = new Set(cli);
  return {
    v: PROTOCOL,
    id,
    app: "crew",
    version,
    os,
    arch,
    day,
    cli: CLI_ORDER.filter((k) => seen.has(k)),
    counts: out,
    first: { signed_in: !!first.signed_in, bot: !!first.bot, run_ok: !!first.run_ok },
  };
}

/** The body of one piece of feedback. The text is cut to its limit. */
function buildFeedback({ id, version, os, rating, text }) {
  return { v: PROTOCOL, id, app: "crew", version, os, rating: rating === "up" || rating === "down" ? rating : null, text: String(text || "").trim().slice(0, MAX_FEEDBACK) };
}

/**
 * @param {object} o
 * @param {string} o.dir  where usage.json lives (userData)
 * @param {string} o.version
 * @param {() => boolean} o.enabled  counting and sending are on (the person's switch and FENNA_NO_USAGE)
 * @param {() => Record<string, number>} o.totals  bots, groups, connectors, logins, read when a day is sent
 * @param {() => Promise<string[]>} o.signedIn  the AI apps that are installed and signed in
 * @param {(url: string, init: object) => Promise<{ ok: boolean, status: number }>} o.fetch
 * @param {NodeJS.ProcessEnv} [o.env]
 * @param {() => Date} [o.now]
 */
function createUsage({ dir, version, enabled, totals, signedIn, fetch, env = process.env, now = () => new Date(), platform = process.platform, arch = process.arch }) {
  const file = path.join(dir, "usage.json");
  const base = (env.FENNA_USAGE_URL || BASE).replace(/\/+$/, "");
  let data = null;
  let flushTimer = null;
  let checkTimer = null;
  let firstTimer = null;
  let sending = false;

  const on = () => env.FENNA_NO_USAGE !== "1" && enabled();

  function fresh() {
    return { v: 1, days: {}, first: { signed_in: false, bot: false, run_ok: false }, failedOn: "" };
  }

  /** usage.json as it is on disk, repaired: only what this version knows. */
  function load() {
    if (data) return data;
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      raw = null;
    }
    const d = fresh();
    if (raw && typeof raw === "object") {
      if (typeof raw.failedOn === "string" && DAY_RE.test(raw.failedOn)) d.failedOn = raw.failedOn;
      for (const k of FIRST_KEYS) d.first[k] = !!(raw.first && raw.first[k] === true);
      if (raw.days && typeof raw.days === "object") {
        for (const [day, v] of Object.entries(raw.days)) {
          if (!DAY_RE.test(day) || !v || typeof v !== "object") continue;
          const counts = {};
          for (const k of EVENT_KEYS) if (whole(v.counts && v.counts[k])) counts[k] = whole(v.counts[k]);
          d.days[day] = { counts, sent: v.sent === true };
        }
      }
    }
    data = d;
    return d;
  }

  function write() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!data) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      fs.renameSync(tmp, file);
    } catch {
      // Counts are a convenience; a disk that won't take them loses them.
    }
  }

  function later() {
    if (!flushTimer) {
      flushTimer = setTimeout(write, FLUSH_MS);
      if (flushTimer.unref) flushTimer.unref();
    }
  }

  /** Forget every count, the number and the steps reached. */
  function purge() {
    clearTimeout(flushTimer);
    flushTimer = null;
    data = null;
    try {
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}.tmp`, { force: true });
    } catch {
      // Nothing more to do: it is not counted any more either way.
    }
  }

  /** Days that are over and not yet sent, newest first, at most MAX_DAYS; older ones are dropped. */
  function pending(today) {
    const d = load();
    const open = Object.keys(d.days).filter((day) => day < today && !d.days[day].sent).sort().reverse();
    for (const day of open.slice(MAX_DAYS)) delete d.days[day];
    const sentKept = Object.keys(d.days).filter((day) => d.days[day].sent).sort().reverse();
    for (const day of sentKept.slice(KEEP_SENT_DAYS)) delete d.days[day];
    return open.slice(0, MAX_DAYS);
  }

  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    return r;
  }

  const api = {
    /** Count one event (or n). Nothing happens while usage counts are off. */
    count(name, n = 1) {
      if (!on() || !EVENT_KEYS.includes(name)) return;
      const d = load();
      const day = localDay(now());
      const entry = d.days[day] || (d.days[day] = { counts: {}, sent: false });
      entry.counts[name] = (entry.counts[name] || 0) + whole(n);
      later();
    },

    /** Crew is open today, even if nothing else happens: the day is sent with its totals. */
    active() {
      if (!on()) return;
      const d = load();
      const day = localDay(now());
      if (d.days[day]) return;
      d.days[day] = { counts: {}, sent: false };
      later();
    },

    /** The person reached a step for the first time ("signed_in", "bot", "run_ok"). */
    reached(step) {
      if (!on() || !FIRST_KEYS.includes(step)) return;
      const d = load();
      if (d.first[step]) return;
      d.first[step] = true;
      later();
    },

    /** Count the end of a run. */
    run(info) {
      for (const k of runCounts(info)) api.count(k);
      if (info.outcome === "done" && info.trigger !== "compact") api.reached("run_ok");
    },

    /** Delete everything kept (the person turned counts off). */
    purge,

    /** Write what is waiting to disk now. */
    flush: write,

    /** The bodies that would be sent for finished days, newest first. For tests and the first-start check. */
    async bodies() {
      const days = pending(localDay(now()));
      const cli = await signedIn().catch(() => []);
      return days.map((day) => buildPing({ id: crypto.randomUUID(), version, os: osName(platform), arch: archName(arch), day, cli, counts: { ...load().days[day].counts, ...totals() }, first: load().first }));
    },

    /**
     * Send every finished day not yet sent (at most seven, oldest first). A failure ends the
     * attempt, and the next one waits for another day. Returns how many days were sent.
     */
    async sendDue() {
      if (sending || !on()) return 0;
      const today = localDay(now());
      const d = load();
      if (d.failedOn === today) return 0;
      const days = pending(today).reverse();
      if (!days.length) {
        write();
        return 0;
      }
      sending = true;
      let sent = 0;
      try {
        const cli = await signedIn().catch(() => []);
        if (cli.length) d.first.signed_in = true;
        let t = {};
        try {
          t = totals();
        } catch {
          t = {};
        }
        if (whole(t.bots) > 1) d.first.bot = true;
        for (const day of days) {
          if (!on()) return sent;
          const body = JSON.stringify(buildPing({ id: crypto.randomUUID(), version, os: osName(platform), arch: archName(arch), day, cli, counts: { ...d.days[day].counts, ...t }, first: d.first }));
          if (Buffer.byteLength(body) > MAX_BODY) {
            delete d.days[day];
            continue;
          }
          let ok = false;
          let rejected = false;
          try {
            const r = await post(`${base}/v1/ping`, body);
            ok = r.ok;
            rejected = r.status === 400;
          } catch {
            ok = false;
          }
          if (!data) return sent;
          if (rejected) {
            // The server will never take this day as it is; sending it again won't help.
            delete d.days[day];
            continue;
          }
          if (!ok) {
            d.failedOn = today;
            return sent;
          }
          d.days[day].sent = true;
          d.failedOn = "";
          sent++;
        }
      } finally {
        sending = false;
        if (data) write();
      }
      return sent;
    },

    /**
     * Send what the person wrote. Works with usage counts off: they pressed Send. Throws
     * with what to tell them when it can't be sent.
     */
    async sendFeedback({ rating = null, text = "" } = {}) {
      if (rating !== null && rating !== "up" && rating !== "down") throw new Error('The rating is "up", "down" or none.');
      if (typeof text !== "string" || text.length > MAX_FEEDBACK) throw new Error(`The feedback is text, at most ${MAX_FEEDBACK} characters.`);
      if (!rating && !text.trim()) throw new Error("Pick Good or Not good, or write something.");
      const body = JSON.stringify(buildFeedback({ id: crypto.randomUUID(), version, os: osName(platform), rating, text }));
      if (Buffer.byteLength(body) > MAX_BODY) throw new Error("That feedback is too long to send. Shorten it.");
      let r;
      try {
        r = await post(`${base}/v1/feedback`, body);
      } catch {
        throw new Error("Couldn't send. Check your connection.");
      }
      if (!r.ok) throw new Error("Couldn't send. Check your connection.");
      return true;
    },

    /** The first check 60 seconds after start, then one every 6 hours. */
    start() {
      if (env.FENNA_NO_USAGE === "1") {
        purge();
        return;
      }
      const check = () => {
        api.active();
        void api.sendDue().catch(() => undefined);
      };
      api.active();
      firstTimer = setTimeout(check, FIRST_SEND_MS);
      checkTimer = setInterval(check, CHECK_MS);
      for (const t of [firstTimer, checkTimer]) if (t.unref) t.unref();
    },

    stop() {
      clearTimeout(firstTimer);
      clearInterval(checkTimer);
      if (data && on()) write();
    },
  };
  return api;
}

/** A stand-in that counts nothing, for tests and callers that don't track usage. */
const noUsage = { count() {}, active() {}, reached() {}, run() {} };

module.exports = { createUsage, buildPing, buildFeedback, runCounts, localDay, osName, archName, noUsage, COUNT_KEYS, MAX_FEEDBACK, MAX_DAYS, MAX_BODY };
