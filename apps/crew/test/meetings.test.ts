import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { meetingLink, transcriptName, consentText } = require("../src/main/meetings.cjs");
const { buildPrompt } = require("../src/main/prompt.cjs");

describe("meeting links", () => {
  it("takes a Google Meet link and keeps only the call's code", () => {
    expect(meetingLink("https://meet.google.com/abc-defg-hij")).toEqual({ url: "https://meet.google.com/abc-defg-hij", code: "abc-defg-hij", origin: "https://meet.google.com" });
    expect(meetingLink("  https://meet.google.com/ABC-DEFG-HIJ?authuser=1 ").code).toBe("abc-defg-hij");
  });

  it("refuses other sites, Meet pages that are not calls, and things that are not links, saying what a link looks like", () => {
    for (const bad of ["https://zoom.us/j/123", "https://meet.google.com/", "https://meet.google.com/landing", "http://meet.google.com/abc-defg-hij", "abc-defg-hij", "", null]) {
      const r = meetingLink(bad);
      expect(r.error).toMatch(/meet\.google\.com\/abc-defg-hij/);
    }
  });

  it("allows the test pages Crew was started with, and nothing else on their host", () => {
    const r = meetingLink("http://127.0.0.1:5000/index.html?code=e2e-call", ["http://127.0.0.1:5000"]);
    expect(r).toMatchObject({ code: "e2e-call", origin: "http://127.0.0.1:5000" });
    expect(meetingLink("http://127.0.0.1:5001/index.html", ["http://127.0.0.1:5000"]).error).toBeTruthy();
  });
});

describe("transcripts and the hello", () => {
  it("names a transcript by its local start time and the call", () => {
    expect(transcriptName(new Date(2026, 10, 21, 9, 5), "abc-defg-hij")).toBe("2026-11-21 09.05 abc-defg-hij.md");
    expect(transcriptName(new Date(2026, 0, 2, 23, 59), "a/b\\c")).toBe("2026-01-02 23.59 abc.md");
  });

  it("says what the bot is and how to ask it", () => {
    const t = consentText("Scout");
    expect(t).toContain("AI assistant");
    expect(t).toContain('Say "Scout"');
    expect(t.length).toBeLessThanOrEqual(500);
  });
});

describe("meeting prompts", () => {
  const bot = { name: "Scout", job: "Takes notes", schedule: "manual", how: "", connectors: [], askBefore: [], logins: [], projects: "off" };
  const base = { slug: "scout", bot, memory: "", library: [], others: [], team: null, now: new Date(2026, 10, 21, 9, 30), installed: () => true };

  it("sends only the new lines on a resumed call session, with how the reply reaches the call", () => {
    const text = buildPrompt({ ...base, trigger: "meeting", text: "[09:30:01] Sam: Scout, what's next?", resumed: true });
    expect(text).toContain("[09:30:01] Sam: Scout, what's next?");
    expect(text).toContain("Reply with only SKIP");
    expect(text).not.toContain("Your memory");
    expect(text.length).toBeLessThan(1500);
  });

  it("sends the whole prompt the first time a call wakes the bot", () => {
    const text = buildPrompt({ ...base, trigger: "meeting", text: "[09:30:01] Sam: Scout?", resumed: false });
    expect(text).toContain("Your memory");
    expect(text).toContain("Reply with only SKIP");
  });

  it("tells the bot, when the call ends, that its reply goes to the person", () => {
    const text = buildPrompt({ ...base, trigger: "meeting_end", text: "The call ended.\nThe whole transcript: Files/Meetings/x.md" });
    expect(text).toContain("This reply goes to the person, not to the call");
    expect(text).not.toContain("Reply with only SKIP");
  });

  it("tells every bot how to join a call without driving it", () => {
    const text = buildPrompt({ ...base, trigger: "person", text: "hi" });
    expect(text).toContain('{action: "join", url, note');
    expect(text).toContain("Never use the browser tools on the call's tab");
  });
});
