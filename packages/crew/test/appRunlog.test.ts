import { describe, expect, it } from "vitest";
import { parseRunLog, runLine, RUN_EVENT_TYPES, type RunEvent } from "../src/runlog.ts";

describe("app_tool run events", () => {
  it("is a run event type, written and read back", () => {
    const ev: RunEvent = { type: "app_tool", at: "2026-11-20T10:00:00.000Z", app: "notes-board", tool: "add_note", ok: true, ms: 42 };
    expect(RUN_EVENT_TYPES).toContain("app_tool");
    const back = parseRunLog(runLine(ev));
    expect(back.skipped).toBe(0);
    expect(back.events).toEqual([ev]);
  });
});

describe("tokens run events", () => {
  it("is a run event type, with a cost that may be null", () => {
    const reported: RunEvent = { type: "tokens", at: "2026-11-21T10:00:00.000Z", input: 1200, output: 300, costUsd: 0.42 };
    const unpriced: RunEvent = { type: "tokens", at: "2026-11-21T10:00:00.000Z", input: 5, output: 1, costUsd: null };
    expect(RUN_EVENT_TYPES).toContain("tokens");
    const back = parseRunLog(runLine(reported) + runLine(unpriced));
    expect(back.skipped).toBe(0);
    expect(back.events).toEqual([reported, unpriced]);
  });
});
