// The receiver for the Fenna apps' anonymous usage counts and feedback
// (PRIVACY.md#usage-counts). A Cloudflare Worker with one D1 database (binding
// DB, tables in schema.sql) and one secret (DASH_KEY) for the owner's dashboard.
//
//   POST /v1/ping       one install's counts for one day      → 204 | 400
//   POST /v1/feedback   a rating and a line of text           → 204 | 400 | 429
//   GET  /dash?key=…    the owner's dashboard (sets a cookie, then /dash works alone)
//
// It stores no IP address: nothing here reads the request's address headers.

const APPS = ["crew", "slides", "docs", "sheets", "whiteboard", "design"];
const OS = ["win", "mac", "linux"];
const ARCH = ["x64", "arm64"];
const CLIS = ["claude", "codex", "agy"];
const COUNTS = [
  "bots", "groups", "connectors", "logins",
  "runs", "runs_ok", "runs_failed", "runs_scheduled", "runs_watch", "runs_manual",
  "approvals", "approvals_denied", "questions", "take_control",
  "messages", "bots_created", "editor_opens",
];
const FIRSTS = ["signed_in", "bot", "run_ok"];
const MAX_BODY = 4096;
const FEEDBACK_PER_DAY = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,4}(-[0-9A-Za-z.]{1,20})?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/v1/ping") return await ping(request, env);
      if (request.method === "POST" && url.pathname === "/v1/feedback") return await feedback(request, env);
      if (request.method === "GET" && url.pathname === "/dash") return await dash(request, env, url);
      if (request.method === "GET" && url.pathname === "/") return text("Fenna usage counts. See https://github.com/Sidhilynx/fenna/blob/main/PRIVACY.md#usage-counts\n");
      return text("Not found\n", 404);
    } catch (err) {
      if (err instanceof BadRequest) return json({ error: err.message }, 400);
      throw err;
    }
  },
};

class BadRequest extends Error {}

async function body(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new BadRequest(`body over ${MAX_BODY} bytes`);
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequest("body must be a JSON object");
    return value;
  } catch (err) {
    if (err instanceof BadRequest) throw err;
    throw new BadRequest("body is not JSON");
  }
}

function need(ok, message) {
  if (!ok) throw new BadRequest(message);
}

function common(b) {
  need(b.v === 1, "v must be 1");
  need(typeof b.id === "string" && UUID.test(b.id), "id must be a v4 uuid");
  need(APPS.includes(b.app), `app must be one of ${APPS.join(", ")}`);
  need(typeof b.version === "string" && VERSION.test(b.version), "version must look like 1.2.3");
  need(OS.includes(b.os), `os must be one of ${OS.join(", ")}`);
}

/** Within ten days before the server's date and one day after (time zones). */
function plausibleDay(day) {
  if (typeof day !== "string" || !DAY.test(day)) return false;
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  const now = Date.now();
  return t >= now - 10 * 86400e3 && t <= now + 86400e3;
}

async function ping(request, env) {
  const b = await body(request);
  common(b);
  need(ARCH.includes(b.arch), `arch must be one of ${ARCH.join(", ")}`);
  need(plausibleDay(b.day), "day must be YYYY-MM-DD within the last ten days");
  need(Array.isArray(b.cli) && b.cli.every((c) => CLIS.includes(c)), `cli must be a list of ${CLIS.join(", ")}`);
  need(b.counts && typeof b.counts === "object" && !Array.isArray(b.counts), "counts must be an object");
  need(b.first && typeof b.first === "object" && !Array.isArray(b.first), "first must be an object");
  const counts = {};
  for (const key of COUNTS) {
    const n = b.counts[key];
    if (n === undefined) continue;
    need(Number.isInteger(n) && n >= 0 && n <= 1e6, `counts.${key} must be a whole number`);
    if (n > 0) counts[key] = n;
  }
  const first = {};
  for (const key of FIRSTS) first[key] = b.first[key] === true;
  await env.DB.prepare(
    `INSERT INTO pings (day, id, app, version, os, arch, cli, counts, first, received)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT (day, id, app) DO UPDATE SET version = ?4, os = ?5, arch = ?6, cli = ?7, counts = ?8, first = ?9, received = ?10`,
  ).bind(b.day, b.id, b.app, b.version, b.os, b.arch, JSON.stringify([...new Set(b.cli)]), JSON.stringify(counts), JSON.stringify(first), new Date().toISOString()).run();
  return new Response(null, { status: 204 });
}

async function feedback(request, env) {
  const b = await body(request);
  common(b);
  need(b.rating === null || b.rating === undefined || b.rating === "up" || b.rating === "down", "rating must be up, down or null");
  need(typeof b.text === "string" && b.text.length <= 1000, "text must be a string of at most 1000 characters");
  need(b.text.trim() !== "" || b.rating, "send a rating or some text");
  const since = new Date(Date.now() - 86400e3).toISOString();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE id = ?1 AND received > ?2").bind(b.id, since).first();
  if (recent.n >= FEEDBACK_PER_DAY) return json({ error: "too much feedback from this install today" }, 429);
  await env.DB.prepare("INSERT INTO feedback (received, id, app, version, os, rating, text) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(new Date().toISOString(), b.id, b.app, b.version, b.os, b.rating ?? null, b.text.trim()).run();
  return new Response(null, { status: 204 });
}

// ---- dashboard -------------------------------------------------------------

function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieKey(request) {
  const m = /(?:^|;\s*)fenna_dash=([^;]+)/.exec(request.headers.get("cookie") || "");
  return m ? decodeURIComponent(m[1]) : null;
}

async function dash(request, env, url) {
  if (!env.DASH_KEY) return text("Dashboard is not set up\n", 404);
  const given = url.searchParams.get("key");
  if (given !== null) {
    if (!sameKey(given, env.DASH_KEY)) return text("Not found\n", 404);
    return new Response(null, {
      status: 303,
      headers: {
        location: `/dash${url.searchParams.get("app") ? `?app=${encodeURIComponent(url.searchParams.get("app"))}` : ""}`,
        "set-cookie": `fenna_dash=${encodeURIComponent(env.DASH_KEY)}; Path=/dash; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`,
      },
    });
  }
  if (!sameKey(cookieKey(request), env.DASH_KEY)) return text("Not found\n", 404);
  const app = APPS.includes(url.searchParams.get("app")) ? url.searchParams.get("app") : "crew";
  return new Response(page(app, await stats(env, app)), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" },
  });
}

function isoDay(t) {
  return new Date(t).toISOString().slice(0, 10);
}

async function stats(env, app) {
  const today = Date.now();
  const from90 = isoDay(today - 90 * 86400e3);
  const from30 = isoDay(today - 30 * 86400e3);
  const from7 = isoDay(today - 7 * 86400e3);
  const rows = (await env.DB.prepare("SELECT day, id, version, os, cli, counts, first FROM pings WHERE app = ?1 AND day >= ?2").bind(app, from90).all()).results;
  const firstSeen = new Map(
    (await env.DB.prepare("SELECT id, MIN(day) AS d FROM pings WHERE app = ?1 GROUP BY id").bind(app).all()).results.map((r) => [r.id, r.d]),
  );
  const feedbackRows = (await env.DB.prepare("SELECT received, version, os, rating, text FROM feedback WHERE app = ?1 ORDER BY received DESC LIMIT 100").bind(app).all()).results;

  const days = [];
  for (let t = Date.parse(`${from30}T00:00:00Z`); isoDay(t) <= isoDay(today); t += 86400e3) days.push(isoDay(t));
  const active = new Map(days.map((d) => [d, new Set()]));
  const fresh = new Map(days.map((d) => [d, 0]));
  const daysById = new Map();
  const last7 = { ids: new Set(), os: {}, version: {}, cli: {}, counts: {} };
  const latestFirst = new Map();
  for (const r of rows) {
    if (active.has(r.day)) active.get(r.day).add(r.id);
    if (!daysById.has(r.id)) daysById.set(r.id, new Set());
    daysById.get(r.id).add(r.day);
    const prev = latestFirst.get(r.id);
    if (!prev || r.day > prev.day) latestFirst.set(r.id, { day: r.day, first: JSON.parse(r.first), os: r.os, version: r.version, cli: JSON.parse(r.cli) });
    if (r.day >= from7) {
      last7.ids.add(r.id);
      for (const [k, n] of Object.entries(JSON.parse(r.counts))) {
        if (!["bots", "groups", "connectors", "logins"].includes(k)) last7.counts[k] = (last7.counts[k] || 0) + n;
      }
    }
  }
  for (const [, d] of firstSeen) if (fresh.has(d)) fresh.set(d, fresh.get(d) + 1);
  for (const id of last7.ids) {
    const l = latestFirst.get(id);
    last7.os[l.os] = (last7.os[l.os] || 0) + 1;
    last7.version[l.version] = (last7.version[l.version] || 0) + 1;
    for (const c of l.cli.length ? l.cli : ["none"]) last7.cli[c] = (last7.cli[c] || 0) + 1;
  }

  // Of the installs first seen at least N days ago, the share seen again on or after day N.
  const retention = [1, 7, 30].map((n) => {
    let cohort = 0;
    let kept = 0;
    for (const [id, d] of firstSeen) {
      const start = Date.parse(`${d}T00:00:00Z`);
      if (start > today - n * 86400e3 || d < from90) continue;
      cohort++;
      const back = isoDay(start + n * 86400e3);
      if ([...(daysById.get(id) || [])].some((x) => x >= back)) kept++;
    }
    return { n, cohort, kept };
  });

  const everyone = [...latestFirst.values()];
  const funnel = {
    installs: everyone.length,
    signed_in: everyone.filter((l) => l.first.signed_in).length,
    bot: everyone.filter((l) => l.first.bot).length,
    run_ok: everyone.filter((l) => l.first.run_ok).length,
  };

  return {
    days: days.map((d) => ({ day: d, active: active.get(d).size, fresh: fresh.get(d) })),
    weekly: last7.ids.size,
    total: firstSeen.size,
    retention,
    funnel,
    os: last7.os,
    version: last7.version,
    cli: last7.cli,
    counts: last7.counts,
    feedback: feedbackRows,
  };
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "–");

function bars(days) {
  const max = Math.max(1, ...days.map((d) => d.active));
  const w = 100 / days.length;
  return `<svg class="chart" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Active installs per day, last 30 days">${days
    .map((d, i) => {
      const h = (36 * d.active) / max;
      const hf = (36 * Math.min(d.fresh, d.active)) / max;
      return `<rect x="${i * w + w * 0.15}" y="${40 - h}" width="${w * 0.7}" height="${h}" class="a"><title>${d.day}: ${d.active} active, ${d.fresh} new</title></rect><rect x="${i * w + w * 0.15}" y="${40 - hf}" width="${w * 0.7}" height="${hf}" class="n"></rect>`;
    })
    .join("")}</svg><div class="axis"><span>${days[0].day}</span><span>${days[days.length - 1].day}</span></div>`;
}

const LABELS = {
  runs: "Runs", runs_ok: "Runs that finished", runs_failed: "Runs that failed",
  runs_scheduled: "Runs on a schedule", runs_watch: "Runs woken by a watch", runs_manual: "Runs started by hand",
  approvals: "Approvals asked", approvals_denied: "Approvals denied", questions: "Questions asked",
  take_control: "Take control", messages: "Messages sent", bots_created: "Bots created", editor_opens: "Editors opened",
  claude: "Claude Code", codex: "Codex", agy: "Antigravity", none: "None signed in",
  win: "Windows", mac: "macOS", linux: "Linux",
};

function table(title, obj, total) {
  const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return `<section><h2>${title}</h2><p class="muted">No data yet.</p></section>`;
  return `<section><h2>${title}</h2><table>${rows.map(([k, n]) => `<tr><td>${esc(LABELS[k] || k)}</td><td class="num">${n}</td><td class="num muted">${total ? pct(n, total) : ""}</td></tr>`).join("")}</table></section>`;
}

function page(app, s) {
  const f = s.funnel;
  const step = (label, n) => `<tr><td>${label}</td><td class="num">${n}</td><td class="num muted">${pct(n, f.installs)}</td></tr>`;
  const today = s.days[s.days.length - 1];
  const yesterday = s.days[s.days.length - 2];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fenna usage</title><meta name="robots" content="noindex">
<style>
:root{--bg:#f7f6f3;--panel:#fff;--line:#e2e0da;--text:#161616;--muted:#6b6b6b;--bar:#161616;--new:#8a8a8a;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0b;--panel:#141414;--line:#262626;--text:#efefef;--muted:#8d8d8d;--bar:#efefef;--new:#6a6a6a;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1080px;margin:0 auto;padding:32px 16px 64px}header{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap;justify-content:space-between}
h1{font-size:22px;margin:0}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 12px;font-weight:600}
nav a{color:var(--muted);margin-left:12px;text-decoration:none}nav a[aria-current]{color:var(--text);font-weight:600}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:24px 0}
.kpi,section{background:var(--panel);border:1px solid var(--line);padding:16px}.kpi b{display:block;font-size:28px;font-variant-numeric:tabular-nums}.kpi span{color:var(--muted);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:12px}
.chart{width:100%;height:160px;display:block}.chart .a{fill:var(--bar)}.chart .n{fill:var(--new)}.axis{display:flex;justify-content:space-between;color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse}td{padding:6px 0;border-top:1px solid var(--line)}td.num{text-align:right;font-variant-numeric:tabular-nums;width:80px}
.muted{color:var(--muted)}.fb{border-top:1px solid var(--line);padding:10px 0}.fb p{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}.legend{font-size:12px;color:var(--muted)}
</style></head><body><main>
<header><h1>Fenna usage</h1><nav>${APPS.map((a) => `<a href="/dash?app=${a}"${a === app ? ' aria-current="page"' : ""}>${a}</a>`).join("")}</nav></header>
<div class="kpis">
<div class="kpi"><b>${yesterday ? yesterday.active : 0}</b><span>active yesterday</span></div>
<div class="kpi"><b>${today.active}</b><span>reported for today so far</span></div>
<div class="kpi"><b>${s.weekly}</b><span>active in the last 7 days</span></div>
<div class="kpi"><b>${s.total}</b><span>installs ever seen</span></div>
</div>
<section><h2>Active installs per day</h2>${bars(s.days)}<p class="legend">Full bar: active that day. Grey part: first seen that day. A day's counts arrive the next day.</p></section>
<div class="grid">
<section><h2>Coming back</h2><table>${s.retention.map((r) => `<tr><td>After ${r.n} day${r.n > 1 ? "s" : ""}</td><td class="num">${r.kept} of ${r.cohort}</td><td class="num muted">${pct(r.kept, r.cohort)}</td></tr>`).join("")}</table></section>
<section><h2>First steps, every install</h2><table>${step("Installed and opened", f.installs)}${step("Signed in to an AI app", f.signed_in)}${step("Has a bot", f.bot)}${step("Had a run finish", f.run_ok)}</table></section>
${table("Done in the last 7 days", s.counts, 0)}
${table("AI app, last 7 days", s.cli, s.weekly)}
${table("System, last 7 days", s.os, s.weekly)}
${table("Version, last 7 days", s.version, s.weekly)}
</div>
<section style="margin-top:12px"><h2>Feedback</h2>${s.feedback.length ? s.feedback.map((r) => `<div class="fb"><span class="muted">${esc(r.received.slice(0, 16).replace("T", " "))} · ${esc(r.version)} · ${esc(r.os)}${r.rating ? ` · ${r.rating === "up" ? "Good" : "Not good"}` : ""}</span><p>${esc(r.text)}</p></div>`).join("") : '<p class="muted">No feedback yet.</p>'}</section>
</main></body></html>`;
}

const text = (s, status = 200) => new Response(s, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
