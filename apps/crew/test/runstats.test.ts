import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createRunStats, summarize, digest, resetAt, windowFrom } = require("../src/main/runstats.cjs");
const F = require("../src/main/format.cjs");

// Local times throughout: the page's days and weeks are the person's own.
const NOW = new Date(2026, 11, 2, 12, 0); // Wednesday 2 Dec 2026
const at = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m, d, h, min);
const midnight = (y: number, m: number, d: number) => new Date(y, m, d).getTime();

type Outcome = "done" | "error" | "stopped" | null;
interface Opts {
  slug?: string;
  name?: string;
  cli?: string;
  outcome?: Outcome;
  ms?: number;
  tokens?: [number, number, number | null?] | null;
  message?: string | null;
}

/** A run as the reader gives it: its start, tokens and end lines, in order. */
function run(when: Date, o: Opts = {}) {
  const slug = o.slug ?? "research";
  const t0 = when.toISOString();
  const events: Record<string, unknown>[] = [{ type: "start", at: t0, runId: "r", trigger: "person", text: "", from: null, team: null, cli: o.cli ?? "claude", model: "" }];
  if (o.tokens) events.push({ type: "tokens", at: t0, input: o.tokens[0], output: o.tokens[1], costUsd: o.tokens[2] ?? null });
  if (o.outcome !== null) events.push({ type: "end", at: new Date(when.getTime() + (o.ms ?? 60_000)).toISOString(), outcome: o.outcome ?? "done", message: o.message ?? null });
  return { slug, name: o.name ?? "Research", file: F.runFileName(when), events };
}

describe("summarize: the numbers", () => {
  it("has zero runs, empty tables and every bucket at zero", () => {
    const s = summarize([], NOW, "30d");
    expect(s.totals).toMatchObject({ runs: 0, ok: 0, failed: 0, stopped: 0, unfinished: 0, ms: 0, tokens: null, costUsd: null, limitHits: 0 });
    expect(s.bots).toEqual([]);
    expect(s.limitHits).toEqual([]);
    expect(s.days).toHaveLength(30);
    expect(s.weeks).toHaveLength(12);
    expect(s.days.every((d) => d.runs === 0 && d.ms === 0)).toBe(true);
    expect(s.weeks.every((w) => w.runs === 0)).toBe(true);
  });

  it("shows the three CLIs even with no runs, with tokens and cost not reported", () => {
    const s = summarize([], NOW, "30d");
    expect(s.clis.map((c) => c.cli)).toEqual(["claude", "codex", "antigravity"]);
    expect(s.clis.map((c) => c.name)).toEqual(["Claude Code", "Codex", "Antigravity"]);
    for (const c of s.clis) expect(c).toMatchObject({ runs: 0, tokens: null, tokenRuns: 0, costUsd: null });
  });

  it("counts one run: outcome, time from start to end, tokens and cost as the CLI reported them", () => {
    const s = summarize([run(at(2026, 11, 2, 9), { cli: "claude", ms: 90_000, tokens: [1200, 300, 0.42] })], NOW, "30d");
    expect(s.totals).toMatchObject({ runs: 1, ok: 1, failed: 0, ms: 90_000, tokens: { input: 1200, output: 300 }, tokenRuns: 1, costUsd: 0.42 });
    const claude = s.clis.find((c) => c.cli === "claude")!;
    expect(claude).toMatchObject({ runs: 1, ok: 1, ms: 90_000, tokens: { input: 1200, output: 300 }, costUsd: 0.42 });
  });

  it("counts a failed and a stopped run apart from the ok ones", () => {
    const runs = [run(at(2026, 11, 2, 8), { outcome: "error", message: "It broke." }), run(at(2026, 11, 2, 9), { outcome: "stopped" }), run(at(2026, 11, 2, 10), { outcome: "done" })];
    const s = summarize(runs, NOW, "30d");
    expect(s.totals).toMatchObject({ runs: 3, ok: 1, failed: 1, stopped: 1, unfinished: 0 });
  });

  it("counts a cut-off run (a start with no end) as unfinished, with no time and no outcome", () => {
    const s = summarize([run(at(2026, 11, 2, 9), { outcome: null, ms: 0 }), run(at(2026, 11, 2, 10), { outcome: "done", ms: 30_000 })], NOW, "30d");
    expect(s.totals).toMatchObject({ runs: 2, ok: 1, failed: 0, stopped: 0, unfinished: 1, ms: 30_000 });
  });

  it("gives a run with an end line but no start nothing (it is skipped)", () => {
    const orphan = { slug: "research", name: "Research", file: "2026-12-02T09-00-00.000Z.jsonl", events: [{ type: "end", at: at(2026, 11, 2, 9).toISOString(), outcome: "done", message: null }] };
    expect(summarize([orphan], NOW, "30d").totals.runs).toBe(0);
  });

  it("keeps tokens and cost null, never 0, where no run reported them", () => {
    const s = summarize([run(at(2026, 11, 2, 9), { cli: "antigravity" }), run(at(2026, 11, 2, 10), { cli: "codex", tokens: [500, 40, null] })], NOW, "30d");
    const antigravity = s.clis.find((c) => c.cli === "antigravity")!;
    const codex = s.clis.find((c) => c.cli === "codex")!;
    expect(antigravity).toMatchObject({ runs: 1, tokens: null, tokenRuns: 0, costUsd: null });
    expect(codex).toMatchObject({ runs: 1, tokens: { input: 500, output: 40 }, tokenRuns: 1, costUsd: null });
    expect(s.totals.costUsd).toBeNull();
  });

  it("sums tokens only over the runs that reported them, and says how many", () => {
    const s = summarize([run(at(2026, 11, 2, 9), { tokens: [100, 10, 0.1] }), run(at(2026, 11, 2, 10), { tokens: null })], NOW, "30d");
    const claude = s.clis.find((c) => c.cli === "claude")!;
    expect(claude).toMatchObject({ runs: 2, tokens: { input: 100, output: 10 }, tokenRuns: 1, costUsd: 0.1 });
  });

  it("names each run's CLI in the three-CLI table, and the bot's main CLI is the one it ran with most", () => {
    const runs = [
      run(at(2026, 11, 2, 8), { slug: "research", cli: "claude" }),
      run(at(2026, 11, 2, 9), { slug: "research", cli: "codex" }),
      run(at(2026, 11, 2, 10), { slug: "research", cli: "codex" }),
      run(at(2026, 11, 2, 11), { slug: "mail", name: "Mail", cli: "antigravity", ms: 600_000 }),
    ];
    const s = summarize(runs, NOW, "30d");
    expect(s.bots.map((b) => b.slug)).toEqual(["mail", "research"]);
    expect(s.bots[0]).toMatchObject({ name: "Mail", runs: 1, ms: 600_000, cli: "antigravity" });
    expect(s.bots[1]).toMatchObject({ name: "Research", runs: 3, cli: "codex" });
  });

  it("handles 5000 synthetic runs over three CLIs and forty bots", () => {
    const clis = ["claude", "codex", "antigravity"];
    const runs: ReturnType<typeof run>[] = [];
    let claudeRuns = 0;
    let failed = 0;
    for (let i = 0; i < 5000; i++) {
      const cli = clis[i % 3];
      const outcome: Outcome = i % 7 === 0 ? "error" : "done";
      if (cli === "claude") claudeRuns++;
      if (outcome === "error") failed++;
      // Spread over the last 60 days (all inside the 12 weeks shown), 25 minutes apart.
      const when = new Date(NOW.getTime() - ((i * 25 * 60_000) % (60 * 86_400_000)));
      runs.push(run(when, { slug: `bot-${i % 40}`, name: `Bot ${i % 40}`, cli, outcome, ms: 120_000, tokens: cli === "codex" ? null : [10, 5, null], message: outcome === "error" ? "Failed." : null }));
    }
    const s = summarize(runs, NOW, "12w");
    expect(s.totals.runs).toBe(5000);
    expect(s.totals.failed).toBe(failed);
    expect(s.totals.ms).toBe(5000 * 120_000);
    expect(s.clis.find((c) => c.cli === "claude")!.runs).toBe(claudeRuns);
    expect(s.clis.find((c) => c.cli === "codex")!.tokens).toBeNull();
    expect(s.bots).toHaveLength(40);
    expect(s.bots.reduce((n, b) => n + b.runs, 0)).toBe(5000);
    expect(s.weeks.reduce((n, w) => n + w.runs, 0)).toBe(5000);
    expect(s.days.reduce((n, d) => n + d.runs, 0)).toBeLessThanOrEqual(5000);
    expect(s.limitHits).toEqual([]);
  });
});

describe("summarize: ranges and buckets", () => {
  it("counts the day buckets (last 30 days) across a month boundary, in local time", () => {
    const runs = [run(at(2026, 10, 29, 10)), run(at(2026, 10, 30, 10)), run(at(2026, 11, 1, 10)), run(at(2026, 11, 1, 23))];
    const s = summarize(runs, NOW, "30d");
    const day = (y: number, m: number, d: number) => s.days.find((b) => b.start === midnight(y, m, d))!;
    expect(s.days[0].start).toBe(midnight(2026, 10, 3));
    expect(s.days[29].start).toBe(midnight(2026, 11, 2));
    expect(day(2026, 10, 29).runs).toBe(1);
    expect(day(2026, 10, 30).runs).toBe(1);
    expect(day(2026, 11, 1).runs).toBe(2);
    expect(day(2026, 11, 2).runs).toBe(0);
  });

  it("counts the week buckets (last 12 weeks, Monday first) across a month boundary", () => {
    const runs = [run(at(2026, 10, 29, 10)), run(at(2026, 10, 30, 10)), run(at(2026, 11, 1, 10))];
    const s = summarize(runs, NOW, "12w");
    expect(s.weeks).toHaveLength(12);
    expect(s.weeks[11].start).toBe(midnight(2026, 10, 30));
    expect(s.weeks[10].start).toBe(midnight(2026, 10, 23));
    expect(s.weeks[10].runs).toBe(1); // Sunday 29 Nov is in the week that began Monday 23 Nov
    expect(s.weeks[11].runs).toBe(2); // Monday 30 Nov and Tuesday 1 Dec
    expect(s.weeks[0].start).toBe(windowFrom(NOW).getTime());
  });

  it("leaves a run older than the chart out of the buckets but not out of the range", () => {
    const old = run(at(2026, 6, 1, 10));
    const s = summarize([old], NOW, "12w");
    expect(s.days.every((d) => d.runs === 0)).toBe(true);
    expect(s.weeks.every((w) => w.runs === 0)).toBe(true);
    expect(s.totals.runs).toBe(0);
  });

  it("limits the stats to 7 days, 30 days or 12 weeks", () => {
    const runs = [run(at(2026, 10, 23, 10)), run(at(2026, 10, 27, 10)), run(at(2026, 11, 1, 10))];
    expect(summarize(runs, NOW, "7d").totals.runs).toBe(2); // from Nov 26
    expect(summarize(runs, NOW, "30d").totals.runs).toBe(3);
    expect(summarize(runs, NOW, "12w").totals.runs).toBe(3);
  });
});

describe("summarize: limit hits", () => {
  it("counts an error that says a plan limit was reached, and not other errors", () => {
    const runs = [
      run(at(2026, 11, 2, 9), { outcome: "error", message: "Claude Code hit its usage limit. Try again later or pick another assistant." }),
      run(at(2026, 11, 2, 10), { outcome: "error", message: "Codex got a 429 from the server." }),
      run(at(2026, 11, 2, 11), { outcome: "error", message: "The CLI stopped with an error." }),
      run(at(2026, 11, 2, 12), { outcome: "stopped", message: "usage limit" }),
    ];
    const s = summarize(runs, NOW, "30d");
    expect(s.totals.limitHits).toBe(2);
    expect(s.limitHits).toHaveLength(2);
    expect(s.limitHits[0]).toMatchObject({ slug: "research", name: "Research", cli: "claude", resetsAt: null });
  });

  it("gives the reset time when the message states one, and null when it does not", () => {
    const runs = [
      run(at(2026, 11, 2, 9), { outcome: "error", message: "Claude Code hit its usage limit. Resets 3pm." }),
      run(at(2026, 11, 2, 10), { cli: "codex", outcome: "error", message: "Codex hit its usage limit." }),
    ];
    const hits = summarize(runs, NOW, "30d").limitHits;
    const withReset = hits.find((h) => h.cli === "claude")!;
    const without = hits.find((h) => h.cli === "codex")!;
    expect(withReset.resetsAt).toBe(at(2026, 11, 2, 15).toISOString());
    expect(without.resetsAt).toBeNull();
  });

  it("lists the newest hit first", () => {
    const runs = [run(at(2026, 11, 1, 9), { outcome: "error", message: "quota exceeded" }), run(at(2026, 11, 2, 9), { outcome: "error", message: "quota exceeded" })];
    const hits = summarize(runs, NOW, "30d").limitHits;
    expect(hits.map((h) => h.at)).toEqual([at(2026, 11, 2, 9, 1).toISOString(), at(2026, 11, 1, 9, 1).toISOString()]);
  });
});

describe("resetAt", () => {
  const from = at(2026, 10, 21, 10, 0);

  it("reads a time of day and takes the next one after the hit", () => {
    expect(resetAt("Resets 3pm.", from)).toBe(at(2026, 10, 21, 15).toISOString());
    expect(resetAt("try again at 14:30", from)).toBe(at(2026, 10, 21, 14, 30).toISOString());
    expect(resetAt("resets at 3:00 PM", from)).toBe(at(2026, 10, 21, 15).toISOString());
    expect(resetAt("resets 9am", from)).toBe(at(2026, 10, 22, 9).toISOString());
  });

  it("says nothing it cannot read as a time", () => {
    expect(resetAt("rate limit reached", from)).toBeNull();
    expect(resetAt("resets 3", from)).toBeNull();
    expect(resetAt("resets in 3 hours", from)).toBeNull();
    expect(resetAt("resets 13am", from)).toBeNull();
    expect(resetAt(null, from)).toBeNull();
  });
});

describe("digest", () => {
  it("keeps only the start, tokens and end lines, and skips a cut-off last line", () => {
    const text = [
      JSON.stringify({ type: "start", at: "2026-11-21T10:00:00.000Z", cli: "claude" }),
      JSON.stringify({ type: "tool", at: "2026-11-21T10:00:01.000Z", id: "1", result: "x".repeat(5000) }),
      JSON.stringify({ type: "tokens", at: "2026-11-21T10:01:00.000Z", input: 5, output: 2, costUsd: null }),
      JSON.stringify({ type: "end", at: "2026-11-21T10:02:00.000Z", outcome: "done", message: null }),
      '{"type":"end","at":"2026-11-21T10:0',
    ].join("\n");
    expect(digest(text).map((e: { type: string }) => e.type)).toEqual(["start", "tokens", "end"]);
  });
});

describe("createRunStats: reading the run files", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeRun(slug: string, when: Date, events: Record<string, unknown>[]) {
    const dir = path.join(root, slug, "runs");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, F.runFileName(when));
    fs.writeFileSync(file, events.map((e) => JSON.stringify(e) + "\n").join(""));
    return file;
  }

  const store = {
    slugs: () => ["research", "mail"].filter((s) => fs.existsSync(path.join(root, s, "bot.md"))),
    botDir: (slug: string) => path.join(root, slug),
    readBot: (slug: string) => ({ bot: { name: slug === "mail" ? "Mail" : "Research" } }),
  };

  function bot(slug: string) {
    fs.mkdirSync(path.join(root, slug), { recursive: true });
    fs.writeFileSync(path.join(root, slug, "bot.md"), "---\n---\n");
  }

  it("reads zero runs from a crew with no bots", async () => {
    const stats = createRunStats({ store, now: () => NOW });
    const s = await stats.get("30d");
    expect(s.runsEver).toBe(0);
    expect(s.totals.runs).toBe(0);
  });

  it("counts every run file in all time, but reads only the ones the page shows", async () => {
    bot("research");
    bot("mail");
    const start = (when: Date) => [{ type: "start", at: when.toISOString(), cli: "claude" }, { type: "end", at: new Date(when.getTime() + 60_000).toISOString(), outcome: "done", message: null }];
    writeRun("research", at(2026, 11, 1, 10), start(at(2026, 11, 1, 10)));
    writeRun("research", at(2026, 5, 1, 10), start(at(2026, 5, 1, 10)));
    writeRun("mail", at(2026, 4, 1, 10), start(at(2026, 4, 1, 10)));
    const s = await createRunStats({ store, now: () => NOW }).get("12w");
    expect(s.runsEver).toBe(3);
    expect(s.totals.runs).toBe(1);
    expect(s.bots.map((b) => b.name)).toEqual(["Research"]);
  });

  it("picks up a run file that changed since the last read, and a cut-off one that got its end", async () => {
    bot("research");
    const when = at(2026, 11, 2, 9);
    const file = writeRun("research", when, [{ type: "start", at: when.toISOString(), cli: "codex" }]);
    const stats = createRunStats({ store, now: () => NOW });
    expect((await stats.get("30d")).totals).toMatchObject({ runs: 1, unfinished: 1, ok: 0 });
    fs.appendFileSync(file, JSON.stringify({ type: "end", at: new Date(when.getTime() + 5_000).toISOString(), outcome: "done", message: null }) + "\n");
    expect((await stats.get("30d")).totals).toMatchObject({ runs: 1, unfinished: 0, ok: 1, ms: 5_000 });
  });

  it("gives a bot's runs the bot's name from bot.md", async () => {
    bot("mail");
    writeRun("mail", at(2026, 11, 2, 9), [{ type: "start", at: at(2026, 11, 2, 9).toISOString(), cli: "antigravity" }]);
    const s = await createRunStats({ store, now: () => NOW }).get("30d");
    expect(s.bots[0]).toMatchObject({ slug: "mail", name: "Mail", cli: "antigravity" });
    expect(s.clis.find((c) => c.cli === "antigravity")!.tokens).toBeNull();
  });
});
