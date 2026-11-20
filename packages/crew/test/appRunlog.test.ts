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
