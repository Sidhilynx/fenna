import { describe, expect, it } from "vitest";
import { MAX_QUERY, lineAtY, localDate, matchMentions, mentionQuery, opensMention } from "../src/renderer/editor/lines.ts";

describe("opensMention", () => {
  it("opens at the start of a line and after a space", () => {
    expect(opensMention("@", 0)).toBe(true);
    expect(opensMention("ask @", 4)).toBe(true);
    expect(opensMention("a @", 2)).toBe(true);
  });
  it("stays text inside a word, like an email address", () => {
    expect(opensMention("me@home", 2)).toBe(false);
  });
  it("needs an @ at that place", () => {
    expect(opensMention("ask a", 4)).toBe(false);
    expect(opensMention("", 0)).toBe(false);
  });
});

describe("mentionQuery", () => {
  it("is the words between the @ and the caret", () => {
    expect(mentionQuery("see @to", 4, 5)).toBe("");
    expect(mentionQuery("see @tod and more", 4, 8)).toBe("tod");
    expect(mentionQuery("@today's date", 0, 13)).toBe("today's date");
  });
  it("ends when the caret goes back past the @, the @ is gone, or it runs too long or over a line", () => {
    expect(mentionQuery("see @to", 4, 4)).toBeNull();
    expect(mentionQuery("see to", 4, 6)).toBeNull();
    expect(mentionQuery(`@${"x".repeat(MAX_QUERY + 1)}`, 0, MAX_QUERY + 2)).toBeNull();
    expect(mentionQuery("@a\nb", 0, 4)).toBeNull();
  });
});

describe("matchMentions", () => {
  const items = [
    { label: "Claude", also: "ai assistant" },
    { label: "Today’s date", also: "today's now" },
    { label: "Plan" },
  ];
  it("lists everything for no words", () => {
    expect(matchMentions(items, "")).toEqual(items);
    expect(matchMentions(items, "  ")).toEqual(items);
  });
  it("finds by label or other words, ignoring case", () => {
    expect(matchMentions(items, "CLA").map((i) => i.label)).toEqual(["Claude"]);
    expect(matchMentions(items, "ai").map((i) => i.label)).toEqual(["Claude"]);
    expect(matchMentions(items, "today's").map((i) => i.label)).toEqual(["Today’s date"]);
    expect(matchMentions(items, "pl").map((i) => i.label)).toEqual(["Plan"]);
  });
  it("finds nothing for words nothing has", () => {
    expect(matchMentions(items, "zzz")).toEqual([]);
  });
});

describe("lineAtY", () => {
  // Three lines of 20 with gaps of 10: [0,20] [30,50] [60,80].
  const lines = [0, 30, 60].map((top) => ({ top, bottom: top + 20 }));
  const at = (y: number) => lineAtY(lines.length, (i) => lines[i]!, y);
  it("is the line the pointer is over", () => {
    expect(at(5)).toBe(0);
    expect(at(30)).toBe(1);
    expect(at(80)).toBe(2);
  });
  it("in a gap, is the line above it, so the handle doesn't drop between lines", () => {
    expect(at(25)).toBe(0);
    expect(at(55)).toBe(1);
    expect(at(500)).toBe(2);
  });
  it("above the first line, is the first; with no lines, none", () => {
    expect(at(-40)).toBe(0);
    expect(lineAtY(0, () => ({ top: 0, bottom: 0 }), 10)).toBe(-1);
  });
  it("finds a line among hundreds", () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ top: i * 30, bottom: i * 30 + 20 }));
    expect(lineAtY(many.length, (i) => many[i]!, 4517)).toBe(150);
    expect(lineAtY(many.length, (i) => many[i]!, 4525)).toBe(150);
  });
});

describe("localDate", () => {
  it("is the day on this computer's calendar, not UTC's", () => {
    const lateEvening = new Date(2026, 10, 12, 23, 30);
    expect(localDate(0, lateEvening)).toBe("2026-11-12");
    const earlyMorning = new Date(2026, 10, 13, 0, 30);
    expect(localDate(0, earlyMorning)).toBe("2026-11-13");
  });
  it("counts days forward across a month and a year", () => {
    expect(localDate(1, new Date(2026, 10, 30, 12))).toBe("2026-12-01");
    expect(localDate(1, new Date(2026, 11, 31, 12))).toBe("2027-01-01");
  });
});
