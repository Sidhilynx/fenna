import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moveIndex, stepTime } from "../src/renderer/Replay.tsx";

const require = createRequire(import.meta.url);
const { createStore } = require("../src/main/store.cjs");
const { createReplay } = require("../src/main/replay.cjs");
const F = require("../src/main/format.cjs");

const SLUG = "research";
const T0 = Date.parse("2026-11-19T10:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

let root: string;
let store: ReturnType<typeof createStore>;
let current: string | null;
const runner = { running: () => (current ? { runId: current } : null) };
const runDir = (runId: string) => path.join(store.botDir(SLUG), "runs", runId);
const framesJson = (runId: string) => JSON.parse(readFileSync(path.join(runDir(runId), "frames", "frames.json"), "utf8")) as { n: number; at: string; action: string; url: string }[];

/** A run's log: its start, and each tool call as running then done. */
function writeRun(runId: string, startSecond: number, calls: { id: string; tool: string; server?: string; label?: string; second: number }[]) {
  const file = F.runFileName(new Date(at(startSecond)));
  const events: object[] = [{ type: "start", at: at(startSecond), runId, trigger: "person", text: "", from: null, team: null, cli: "claude", model: "" }];
  for (const c of calls) {
    const base = { type: "tool", at: at(c.second), id: c.id, server: c.server ?? "browser", tool: c.tool, label: c.label ?? `Did ${c.tool}` };
    events.push({ ...base, status: "running" }, { ...base, at: at(c.second + 3), status: "done" });
  }
  for (const e of events) store.appendRun(SLUG, file, e as never);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crew-replay-"));
  store = createStore(root);
  store.createBot({ name: "Research", job: "Checks example.com every Monday" });
  current = null;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("steps", () => {
  it("lists each tool call once, oldest first, with the label the chat shows", () => {
    writeRun("11111111-aaaa", 0, [
      { id: "t1", tool: "open", label: "Opened example.com", second: 5 },
      { id: "t2", tool: "snapshot", label: "Read the page", second: 20 },
      { id: "t3", tool: "click", label: "Clicked on the page", second: 30 },
    ]);
    const replay = createReplay({ store, runner });
    const out = replay.steps(SLUG, "11111111-aaaa");
    expect(out.map((s: { label: string }) => s.label)).toEqual(["Opened example.com", "Read the page", "Clicked on the page"]);
    expect(out.map((s: { at: string }) => s.at)).toEqual([at(5), at(20), at(30)]);
    expect(out.every((s: object) => !("frame" in s))).toBe(true);
  });

  it("gives each browser call the picture taken after it, and a picture with no call of its own is a step", () => {
    writeRun("22222222-bbbb", 0, [
      { id: "a", tool: "open", label: "Opened example.com", second: 5 },
      { id: "b", tool: "click", label: "Clicked on the page", second: 10 },
      { id: "c", tool: "scroll", label: "Scrolled down", second: 20 },
    ]);
    current = "22222222-bbbb";
    const replay = createReplay({ store, runner });
    replay.onStep(SLUG, { at: at(6), action: "open", url: "https://example.com/", jpeg: JPEG });
    replay.onStep(SLUG, { at: at(11), action: "click", url: "https://example.com/next", jpeg: JPEG });
    // A press that the log never recorded.
    replay.onStep(SLUG, { at: at(15), action: "press", url: "https://example.com/next", jpeg: JPEG });
    current = null;

    const out = replay.steps(SLUG, "22222222-bbbb");
    expect(out.map((s: { label: string }) => s.label)).toEqual(["Opened example.com", "Clicked on the page", "Pressed", "Scrolled down"]);
    expect(out[0].url).toBe("https://example.com/");
    expect(out[1].url).toBe("https://example.com/next");
    expect(out[0].frame).toBe(`data:image/jpeg;base64,${JPEG.toString("base64")}`);
    expect(out[3].frame).toBeUndefined();
  });

  it("rejects a run that is not in the history, and a name that is not a run", () => {
    const replay = createReplay({ store, runner });
    expect(() => replay.steps(SLUG, "33333333-cccc")).toThrow("not in this bot's history");
    expect(() => replay.steps(SLUG, "../../etc")).toThrow("is not a run");
  });

  it("keeps no picture when no run is going", () => {
    const replay = createReplay({ store, runner });
    replay.onStep(SLUG, { at: at(1), action: "click", url: "", jpeg: JPEG });
    expect(existsSync(path.join(store.botDir(SLUG), "runs"))).toBe(true);
    expect(readdirSync(path.join(store.botDir(SLUG), "runs"))).toEqual([]);
  });
});

describe("caps", () => {
  it("drops every other picture when the run is full, and then takes every other step", () => {
    current = "44444444-dddd";
    const replay = createReplay({ store, runner, framesMax: 4 });
    for (let i = 0; i < 10; i++) replay.onStep(SLUG, { at: at(i), action: "click", url: "", jpeg: JPEG });
    const index = framesJson("44444444-dddd");
    expect(index.map((e) => e.n)).toEqual([0, 4, 8]);
    const files = readdirSync(path.join(runDir("44444444-dddd"), "frames")).filter((f) => f.endsWith(".jpg")).sort();
    expect(files).toEqual(["0.jpg", "4.jpg", "8.jpg"]);
  });

  it("holds at most 300 pictures a run", () => {
    current = "55555555-eeee";
    const replay = createReplay({ store, runner });
    for (let i = 0; i < 700; i++) replay.onStep(SLUG, { at: at(i), action: "click", url: "", jpeg: JPEG });
    const index = framesJson("55555555-eeee");
    expect(index.length).toBeLessThanOrEqual(300);
    expect(index.length).toBeGreaterThan(150);
    expect(index.every((e) => e.n % 4 === 0)).toBe(true);
  });
});

describe("cleanup", () => {
  it("keeps the pictures of the 30 most recent runs, counting the one starting", () => {
    const replay = createReplay({ store, runner });
    for (let i = 1; i <= 32; i++) {
      current = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      replay.onStep(SLUG, { at: at(i), action: "click", url: "", jpeg: JPEG });
      // Ranked by when each run last had a picture, oldest first.
      const idx = path.join(runDir(current), "frames", "frames.json");
      utimesSync(idx, new Date(T0 + i * 1000), new Date(T0 + i * 1000));
    }
    current = null;
    const kept = readdirSync(path.join(store.botDir(SLUG), "runs")).sort();
    expect(kept).toHaveLength(30);
    expect(kept).not.toContain("00000000-0000-4000-8000-000000000001");
    expect(kept).not.toContain("00000000-0000-4000-8000-000000000002");
    expect(kept).toContain("00000000-0000-4000-8000-000000000032");
  });

  it("leaves the run log files alone", () => {
    writeRun("66666666-ffff", 0, [{ id: "x", tool: "open", second: 2 }]);
    const replay = createReplay({ store, runner, runsKept: 1 });
    for (let i = 0; i < 3; i++) {
      current = `77777777-000${i}`;
      replay.onStep(SLUG, { at: at(i), action: "click", url: "", jpeg: JPEG });
    }
    current = null;
    const files = readdirSync(path.join(store.botDir(SLUG), "runs"));
    expect(files.some((f) => f.endsWith(".jsonl"))).toBe(true);
    expect(files.filter((f) => f.startsWith("7777"))).toHaveLength(1);
  });
});

describe("the replay's keys and times", () => {
  it("moves one step with the arrows and jumps with Home and End, never past the ends", () => {
    expect(moveIndex(2, "ArrowLeft", 5)).toBe(1);
    expect(moveIndex(0, "ArrowLeft", 5)).toBe(0);
    expect(moveIndex(3, "ArrowRight", 5)).toBe(4);
    expect(moveIndex(4, "ArrowRight", 5)).toBe(4);
    expect(moveIndex(2, "Home", 5)).toBe(0);
    expect(moveIndex(2, "End", 5)).toBe(4);
    expect(moveIndex(0, "ArrowRight", 0)).toBeNull();
    expect(moveIndex(2, "a", 5)).toBeNull();
  });

  it("shows a step time with seconds, and nothing for a time that is not one", () => {
    expect(stepTime("not a time")).toBe("");
    expect(stepTime(at(65))).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});
