import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createUsage, buildPing, buildFeedback, runCounts, localDay, COUNT_KEYS, MAX_BODY, MAX_DAYS } = require("../src/main/usage.cjs");

let dir: string;
let clock: Date;
let on: boolean;
let posts: { url: string; body: string }[];
let reply: { ok: boolean; status: number } | "throw";

function make(env: Record<string, string> = {}) {
  return createUsage({
    dir,
    version: "0.9.6",
    enabled: () => on,
    totals: () => ({ bots: 3, groups: 1, connectors: 0, logins: 2 }),
    signedIn: async () => ["codex", "claude"],
    fetch: async (url: string, init: { body: string }) => {
      posts.push({ url, body: init.body });
      if (reply === "throw") throw new Error("offline");
      return reply;
    },
    env,
    now: () => clock,
    platform: "win32",
    arch: "x64",
  });
}
const file = () => path.join(dir, "usage.json");
const at = (s: string) => new Date(`${s}T12:00:00`);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-"));
  clock = at("2026-11-20");
  on = true;
  posts = [];
  reply = { ok: true, status: 204 };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("the counter store", () => {
  it("counts per local day and rolls over at midnight", async () => {
    const u = make();
    u.count("messages");
    u.count("messages", 2);
    clock = at("2026-11-21");
    u.count("messages");
    u.flush();
    const saved = JSON.parse(fs.readFileSync(file(), "utf8"));
    expect(saved.days["2026-11-20"].counts).toEqual({ messages: 3 });
    expect(saved.days["2026-11-21"].counts).toEqual({ messages: 1 });
  });

  it("sends only finished days, omits zeros, and adds the totals", async () => {
    const u = make();
    u.count("runs");
    u.count("runs_ok");
    clock = at("2026-11-21");
    expect(await u.sendDue()).toBe(1);
    const body = JSON.parse(posts[0].body);
    expect(body.day).toBe("2026-11-20");
    expect(body.counts).toEqual({ bots: 3, groups: 1, logins: 2, runs: 1, runs_ok: 1 });
    expect("connectors" in body.counts).toBe(false);
  });

  it("marks a day sent and never sends it twice", async () => {
    const u = make();
    u.count("runs");
    clock = at("2026-11-21");
    await u.sendDue();
    await u.sendDue();
    expect(posts).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).days["2026-11-20"].sent).toBe(true);
  });

  it("sends at most the 7 most recent unsent days and drops older ones", async () => {
    const u = make();
    for (let d = 1; d <= 10; d++) {
      clock = at(`2026-11-${String(d).padStart(2, "0")}`);
      u.count("messages");
    }
    clock = at("2026-11-20");
    expect(await u.sendDue()).toBe(MAX_DAYS);
    const days = posts.map((p) => JSON.parse(p.body).day);
    expect(days[0]).toBe("2026-11-04");
    expect(days.at(-1)).toBe("2026-11-10");
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).days["2026-11-01"]).toBeUndefined();
  });

  it("keeps a failed day, and tries again only the next day", async () => {
    const u = make();
    u.count("runs");
    clock = at("2026-11-21");
    reply = { ok: false, status: 503 };
    expect(await u.sendDue()).toBe(0);
    reply = { ok: true, status: 204 };
    expect(await u.sendDue()).toBe(0);
    expect(posts).toHaveLength(1);
    clock = at("2026-11-22");
    expect(await u.sendDue()).toBe(1);
    expect(posts).toHaveLength(2);
  });

  it("drops a day the server rejects instead of sending it every day", async () => {
    const u = make();
    u.count("runs");
    clock = at("2026-11-21");
    u.count("messages");
    clock = at("2026-11-22");
    reply = { ok: false, status: 400 };
    expect(await u.sendDue()).toBe(0);
    expect(posts).toHaveLength(2);
    reply = { ok: true, status: 204 };
    expect(await u.sendDue()).toBe(0);
    expect(posts).toHaveLength(2);
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).days).toEqual({});
  });

  it("counts a day Crew was open on, even with no events", async () => {
    const u = make();
    u.active();
    clock = at("2026-11-21");
    expect(await u.sendDue()).toBe(1);
    const body = JSON.parse(posts[0].body);
    expect(body.day).toBe("2026-11-20");
    expect(body.counts).toEqual({ bots: 3, groups: 1, logins: 2 });
  });

  it("marks nothing active while counts are off", async () => {
    on = false;
    const u = make();
    u.active();
    u.flush();
    expect(fs.existsSync(file())).toBe(false);
  });

  it("fails silently when the network is down", async () => {
    const u = make();
    u.count("runs");
    clock = at("2026-11-21");
    reply = "throw";
    await expect(u.sendDue()).resolves.toBe(0);
  });

  it("sends each ping with a new random id and keeps none on disk", async () => {
    const u = make();
    u.count("runs");
    clock = at("2026-11-21");
    u.count("runs");
    clock = at("2026-11-22");
    expect(await u.sendDue()).toBe(2);
    const ids = posts.map((p) => JSON.parse(p.body).id);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[0]).not.toBe(ids[1]);
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).id).toBeUndefined();
  });

  it("drops an id kept by an older version", async () => {
    fs.writeFileSync(file(), JSON.stringify({ v: 1, id: "0f8fad5b-d9cb-469f-a165-70867728950e", days: { "2026-11-19": { counts: { runs: 1 }, sent: false } } }));
    const u = make();
    expect(await u.sendDue()).toBe(1);
    expect(JSON.parse(posts[0]!.body).id).not.toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).id).toBeUndefined();
  });

  it("counts nothing while off, and purging deletes the counters", async () => {
    const u = make();
    u.count("runs");
    u.flush();
    expect(fs.existsSync(file())).toBe(true);
    on = false;
    u.purge();
    expect(fs.existsSync(file())).toBe(false);
    u.count("runs");
    u.flush();
    expect(fs.existsSync(file())).toBe(false);
    clock = at("2026-11-21");
    expect(await u.sendDue()).toBe(0);
    expect(posts).toHaveLength(0);
  });

  it("FENNA_NO_USAGE=1 disables counting and sending, and clears old counters at start", async () => {
    const first = make();
    first.count("runs");
    first.flush();
    expect(fs.existsSync(file())).toBe(true);
    const u = make({ FENNA_NO_USAGE: "1" });
    u.start();
    expect(fs.existsSync(file())).toBe(false);
    u.count("runs");
    u.flush();
    clock = at("2026-11-21");
    expect(await u.sendDue()).toBe(0);
    expect(fs.existsSync(file())).toBe(false);
    expect(posts).toHaveLength(0);
    u.stop();
  });

  it("ignores names it does not know", () => {
    const u = make();
    u.count("bot_names");
    u.flush();
    expect(fs.existsSync(file())).toBe(false);
  });

  it("run counts follow the kind of run and its outcome", () => {
    expect(runCounts({ trigger: "schedule", outcome: "done" })).toEqual(["runs", "runs_ok", "runs_scheduled"]);
    expect(runCounts({ trigger: "schedule", outcome: "error", manual: true })).toEqual(["runs", "runs_failed", "runs_manual"]);
    expect(runCounts({ trigger: "watch", outcome: "stopped" })).toEqual(["runs", "runs_watch"]);
    expect(runCounts({ trigger: "person", outcome: "done" })).toEqual(["runs", "runs_ok", "runs_manual"]);
    expect(runCounts({ trigger: "bot", outcome: "done" })).toEqual(["runs", "runs_ok"]);
    expect(runCounts({ trigger: "compact", outcome: "done" })).toEqual([]);
  });

  it("remembers the steps reached", async () => {
    const u = make();
    u.run({ trigger: "person", outcome: "done" });
    u.reached("bot");
    clock = at("2026-11-21");
    await u.sendDue();
    expect(JSON.parse(posts[0].body).first).toEqual({ signed_in: true, bot: true, run_ok: true });
  });
});

describe("the ping", () => {
  const input = {
    id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    version: "0.9.6",
    os: "win",
    arch: "x64",
    day: "2026-11-19",
    cli: ["agy", "claude"],
    counts: { bots: 2, runs: 0, runs_ok: 4, secret: 9, bot_names: 1 },
    first: { signed_in: true, bot: false, run_ok: true, extra: true },
  };

  it("has exactly the fields of the contract and nothing else", () => {
    const p = buildPing(input);
    expect(Object.keys(p)).toEqual(["v", "id", "app", "version", "os", "arch", "day", "cli", "counts", "first"]);
    expect(p).toEqual({
      v: 1,
      id: input.id,
      app: "crew",
      version: "0.9.6",
      os: "win",
      arch: "x64",
      day: "2026-11-19",
      cli: ["claude", "agy"],
      counts: { bots: 2, runs_ok: 4 },
      first: { signed_in: true, bot: false, run_ok: true },
    });
  });

  it("stays well under 4 KB even with every count set", () => {
    const counts = Object.fromEntries(COUNT_KEYS.map((k: string) => [k, 999999]));
    const p = buildPing({ ...input, cli: ["claude", "codex", "agy"], counts });
    expect(Object.keys(p.counts)).toEqual(COUNT_KEYS);
    expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(MAX_BODY);
  });

  it("uses the local date for a day", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("feedback", () => {
  it("has exactly the fields of the contract, with the text cut to 1000 characters", () => {
    const p = buildFeedback({ id: "x", version: "0.9.6", os: "mac", rating: "down", text: `  ${"a".repeat(1500)}` });
    expect(Object.keys(p)).toEqual(["v", "id", "app", "version", "os", "rating", "text"]);
    expect(p.text).toHaveLength(1000);
    expect(p.rating).toBe("down");
    expect(buildFeedback({ id: "x", version: "1", os: "mac", rating: "meh", text: "" }).rating).toBeNull();
  });

  it("is sent even when usage counts are off, with a number that is not kept", async () => {
    on = false;
    const u = make();
    await u.sendFeedback({ rating: "up", text: "Works well" });
    const body = JSON.parse(posts[0].body);
    expect(posts[0].url).toBe("https://usage.sidhilynx.com/v1/feedback");
    expect(body).toMatchObject({ v: 1, app: "crew", version: "0.9.6", os: "win", rating: "up", text: "Works well" });
    expect(fs.existsSync(file())).toBe(false);
  });

  it("refuses empty or over-long feedback, and says so when it can't be sent", async () => {
    const u = make();
    await expect(u.sendFeedback({ rating: null, text: "  " })).rejects.toThrow(/Pick Good/);
    await expect(u.sendFeedback({ rating: null, text: "a".repeat(1001) })).rejects.toThrow(/1000/);
    reply = "throw";
    await expect(u.sendFeedback({ rating: "down", text: "" })).rejects.toThrow("Couldn't send. Check your connection.");
    reply = { ok: false, status: 400 };
    await expect(u.sendFeedback({ rating: "down", text: "" })).rejects.toThrow("Couldn't send. Check your connection.");
  });
});
