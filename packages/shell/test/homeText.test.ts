import { describe, expect, it } from "vitest";
import { greeting, greetingName, relativeTime, shortAgo, titleFromDraft } from "../renderer/homeText.ts";

const NOW = Date.UTC(2026, 10, 11, 12);
const ago = (s: number) => NOW - s * 1000;

describe("Home's words", () => {
  it("greets by the hour", () => {
    expect(greeting(3)).toBe("Good evening");
    expect(greeting(9)).toBe("Good morning");
    expect(greeting(14)).toBe("Good afternoon");
    expect(greeting(20)).toBe("Good evening");
  });

  it("greets by first name only when it looks like one", () => {
    expect(greetingName("Jordan Lee M")).toBe("Jordan");
    expect(greetingName("JordanLeeM")).toBe("Jordan");
    expect(greetingName("jordan")).toBe("Jordan");
    expect(greetingName("dev_01")).toBeNull();
    expect(greetingName("j")).toBeNull();
    expect(greetingName("   ")).toBeNull();
  });

  it("says how long ago, short and long", () => {
    expect(shortAgo(ago(30), NOW)).toBe("now");
    expect(shortAgo(ago(90 * 60), NOW)).toBe("1h");
    expect(shortAgo(ago(23 * 3600), NOW)).toBe("23h");
    expect(shortAgo(ago(4 * 86400), NOW)).toBe("4d");
    expect(shortAgo(ago(15 * 86400), NOW)).toBe("2w");
    expect(shortAgo(NOW + 5000, NOW)).toBe("now");
    expect(relativeTime(ago(10), NOW)).toBe("just now");
    expect(relativeTime(ago(23 * 3600), NOW)).toBe("23h ago");
    expect(relativeTime(ago(30 * 3600), NOW)).toBe("yesterday");
    expect(relativeTime(ago(3 * 86400), NOW)).toBe("3d ago");
    expect(relativeTime(ago(20 * 86400), NOW)).toBe("2w ago");
    expect(relativeTime(ago(400 * 86400), NOW)).toMatch(/2025/);
  });

  it("titles a new deck from the draft's first words, safe as a folder name", () => {
    expect(titleFromDraft("Make a 6-slide deck about our Q3 results for the board")).toBe("Make a 6-slide deck about our");
    expect(titleFromDraft('Pitch: "AI/ML" <draft>')).toBe("Pitch AI ML draft");
    expect(titleFromDraft("   ")).toBe("");
    expect(titleFromDraft("x".repeat(80)).length).toBe(48);
  });
});
