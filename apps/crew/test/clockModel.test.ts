import { describe, expect, it } from "vitest";
import type { Watch } from "../src/shared/contract.ts";
import { addMonths, buildAgenda, clockRows, clockText, dayDiff, dayStart, itemsByDay, localInputValue, monthGrid, nextQuarter, parseLocalInput, scheduledRuns, watchTimes, weekDays } from "../src/renderer/clockModel.ts";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

describe("pixel digits", () => {
  it("draws 09:41 as 7 rows with a blank column between glyphs", () => {
    const rows = clockRows("09:41");
    expect(rows).toHaveLength(7);
    for (const r of rows) expect(r).toHaveLength(5 + 1 + 5 + 1 + 3 + 1 + 5 + 1 + 5);
    expect(rows.join("")).toMatch(/^[.x]+$/);
  });

  it("draws unknown characters blank", () => {
    expect(clockRows("?").every((r) => !r.includes("x"))).toBe(true);
  });

  it("formats the clock text in 24 hours with two digits", () => {
    expect(clockText(at(2026, 11, 19, 7, 5))).toBe("07:05");
    expect(clockText(at(2026, 11, 19, 23, 59))).toBe("23:59");
  });

  it("gives the minimum datetime-local value to the minute", () => {
    expect(localInputValue(at(2026, 11, 9, 8, 4))).toBe("2026-11-09T08:04");
  });
});

const timer = (over: Partial<Watch> & { at: string; note: string }): Watch =>
  ({ id: "t1", kind: "timer", created: "2026-11-01T00:00:00.000Z", fired: null, count: 0, ...over }) as Watch;

describe("agenda", () => {
  const now = at(2026, 11, 19, 10, 0);
  const until = at(2026, 11, 26, 10, 0);

  it("lists a one-time timer at its time and skips one that has passed", () => {
    const later = at(2026, 11, 20, 9, 0);
    const past = at(2026, 11, 18, 9, 0);
    const items = watchTimes([timer({ at: later.toISOString(), note: "Call" }), timer({ id: "t2", at: past.toISOString(), note: "Old" })], now, until);
    expect(items).toEqual([{ at: later, kind: "timer", title: "Call" }]);
  });

  it("repeats a timer every N minutes, from the first slot after now", () => {
    const start = at(2026, 11, 19, 8, 0);
    const items = watchTimes([timer({ at: start.toISOString(), every: 60, note: "Hourly" })], now, at(2026, 11, 19, 13, 0));
    expect(items.map((i) => i.at.getHours())).toEqual([10, 11, 12]);
  });

  it("caps one repeating timer so a per-minute watch cannot flood the agenda", () => {
    const items = watchTimes([timer({ at: at(2026, 11, 19, 10, 1).toISOString(), every: 1, note: "Minute" })], now, until);
    expect(items).toHaveLength(50);
  });

  it("estimates a page check from when the watch was set, every N minutes, always after now", () => {
    const created = at(2026, 11, 19, 9, 0);
    const page: Watch = { id: "p", kind: "page", url: "https://www.example.com/pricing", every: 30, note: "Price", created: created.toISOString(), fired: null, count: 0, last: "" } as Watch;
    const items = watchTimes([page], now, at(2026, 11, 19, 11, 0));
    expect(items.map((i) => i.at.getTime())).toEqual([at(2026, 11, 19, 10, 30).getTime()]);
    expect(items[0]!.title).toBe("www.example.com · Price");
  });

  it("builds the agenda from runs and watches, soonest first, inside the window", () => {
    const runs = scheduledRuns((from) => new Date(from.getTime() + 3 * 3_600_000), now, until);
    const items = buildAgenda({ now, until, runs, watches: [timer({ at: at(2026, 11, 20, 9, 0).toISOString(), note: "Call" })] });
    expect(items.filter((i) => i.kind === "timer")).toHaveLength(1);
    expect(items.filter((i) => i.kind === "run").length).toBeGreaterThan(0);
    for (let i = 1; i < items.length; i++) expect(items[i]!.at >= items[i - 1]!.at).toBe(true);
    expect(items.every((i) => i.at >= now && i.at < until)).toBe(true);
  });

  it("stops a schedule at the window's end and at the list's cap", () => {
    const runs = scheduledRuns((from) => new Date(from.getTime() + 60_000), now, new Date(now.getTime() + 5 * 60_000));
    expect(runs.length).toBe(4);
    const many = scheduledRuns((from) => new Date(from.getTime() + 60_000), now, until, 3);
    expect(many).toHaveLength(3);
  });

  it("stops at no schedule when nextAfter gives none", () => {
    expect(scheduledRuns(() => null, now, until)).toEqual([]);
  });
});

describe("week strip", () => {
  it("starts at today's midnight and runs seven days", () => {
    const now = at(2026, 11, 19, 15, 30);
    const days = weekDays(now);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual(at(2026, 11, 19));
    expect(days[6]).toEqual(at(2026, 11, 25));
  });

  it("puts each item in its day's column and drops items outside the week", () => {
    const now = at(2026, 11, 19, 15, 30);
    const items = [
      { at: at(2026, 11, 19, 16, 0), kind: "run" as const, title: "today" },
      { at: at(2026, 11, 25, 8, 0), kind: "timer" as const, title: "last day" },
      { at: at(2026, 11, 26, 8, 0), kind: "timer" as const, title: "too late" },
    ];
    const cols = itemsByDay(items, now);
    expect(cols[0]!.map((i) => i.title)).toEqual(["today"]);
    expect(cols[6]!.map((i) => i.title)).toEqual(["last day"]);
    expect(cols.flat()).toHaveLength(2);
  });

  it("counts calendar days across a daylight saving change", () => {
    expect(dayDiff(at(2026, 3, 28, 12), at(2026, 3, 29, 1))).toBe(1);
  });
});

describe("reminder picker", () => {
  it("parses a datetime-local value and refuses what isn't one", () => {
    expect(parseLocalInput("2026-11-20T09:05")?.getTime()).toBe(at(2026, 11, 20, 9, 5).getTime());
    expect(parseLocalInput("")).toBeNull();
    expect(parseLocalInput("2026-02-30T09:00")).toBeNull();
    expect(parseLocalInput("2026-11-20T24:00")).toBeNull();
    expect(parseLocalInput("2026-11-20 09:00")).toBeNull();
  });

  it("round-trips with localInputValue", () => {
    const d = at(2026, 1, 3, 7, 45);
    expect(parseLocalInput(localInputValue(d))?.getTime()).toBe(d.getTime());
  });

  it("lays a month out as six Monday-first weeks", () => {
    const days = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(days).toHaveLength(42);
    expect(days[0]!.getDay()).toBe(1);
    expect(days[0]!.getTime()).toBe(at(2026, 10, 26).getTime());
    expect(days[6]!.getTime()).toBe(at(2026, 11, 1).getTime());
    expect(days.filter((d) => d.getMonth() === 10)).toHaveLength(30);
  });

  it("starts on the 1st when the month starts on a Monday", () => {
    expect(monthGrid(2026, 5)[0]!.getTime()).toBe(at(2026, 6, 1).getTime());
  });

  it("moves by months without spilling past a short month", () => {
    expect(addMonths(at(2026, 1, 31, 9, 30), 1).getTime()).toBe(at(2026, 2, 28, 9, 30).getTime());
    expect(addMonths(at(2026, 12, 15), 1).getTime()).toBe(at(2027, 1, 15).getTime());
    expect(addMonths(at(2026, 1, 15), -1).getTime()).toBe(at(2025, 12, 15).getTime());
  });

  it("offers the next quarter hour, rolling over the day", () => {
    expect(nextQuarter(at(2026, 11, 20, 9, 2)).getTime()).toBe(at(2026, 11, 20, 9, 15).getTime());
    expect(nextQuarter(at(2026, 11, 20, 9, 15)).getTime()).toBe(at(2026, 11, 20, 9, 30).getTime());
    expect(nextQuarter(at(2026, 11, 20, 23, 50)).getTime()).toBe(at(2026, 11, 21, 0, 0).getTime());
  });

  it("finds the day's midnight", () => {
    expect(dayStart(at(2026, 11, 20, 13, 7)).getTime()).toBe(at(2026, 11, 20).getTime());
  });
});
