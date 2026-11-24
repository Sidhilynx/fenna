import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createMeetingEngine, replyText, addressed, formatLine, WAKES_PER_HOUR, CHAT_MAX } = require("../src/main/meeting-engine.cjs");

const START = new Date(2026, 10, 21, 9, 0, 0);

function setup(extra: Record<string, unknown> = {}) {
  const onLine = vi.fn();
  const onWake = vi.fn();
  const flags = { busy: false };
  const engine = createMeetingEngine({
    botName: "Scout",
    now: () => new Date(Date.now()),
    onLine,
    onWake,
    busy: () => flags.busy,
    ...extra,
  });
  return { engine, onLine, onWake, flags };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("captions", () => {
  it("finalizes a block after 1500 ms of silence, with the speaker and the time", () => {
    const { engine, onLine } = setup();
    engine.caption({ block: 1, speaker: "Sam", text: "Hello there" });
    vi.advanceTimersByTime(1499);
    expect(onLine).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLine).toHaveBeenCalledWith("[09:00:01] Sam: Hello there");
    expect(engine.lines()).toEqual(["[09:00:01] Sam: Hello there"]);
  });

  it("resets the final timer on every update to the block, and keeps the latest text", () => {
    const { engine, onLine } = setup();
    engine.caption({ block: 1, speaker: "Sam", text: "Hel" });
    vi.advanceTimersByTime(1000);
    engine.caption({ block: 1, speaker: "Sam", text: "Hello" });
    vi.advanceTimersByTime(1000);
    expect(onLine).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onLine.mock.calls[0][0]).toContain("Sam: Hello");
  });

  it("finalizes an open block at once when a newer block starts, and not the newer one", () => {
    const { engine, onLine } = setup();
    engine.caption({ block: 1, speaker: "Sam", text: "First" });
    engine.caption({ block: 2, speaker: "Priya", text: "Second" });
    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onLine.mock.calls[0][0]).toContain("Sam: First");
    vi.advanceTimersByTime(1500);
    expect(onLine).toHaveBeenCalledTimes(2);
    expect(onLine.mock.calls[1][0]).toContain("Priya: Second");
  });

  it("writes what a speaker adds to a block after a pause as a new line, without repeating what was written", () => {
    const { engine, onLine } = setup();
    engine.caption({ block: 1, speaker: "Sam", text: "Can you hear me" });
    vi.advanceTimersByTime(1500);
    engine.caption({ block: 1, speaker: "Sam", text: "Can you hear me now Scout" });
    vi.advanceTimersByTime(1500);
    engine.caption({ block: 1, speaker: "Sam", text: "Can you hear me now Scout" });
    vi.advanceTimersByTime(1500);
    expect(onLine.mock.calls.map((c) => c[0].split(": ")[1])).toEqual(["Can you hear me", "now Scout"]);
  });

  it("finalizes several open lower blocks in order when a newer one starts", () => {
    const { engine, onLine } = setup();
    engine.caption({ block: 5, speaker: "Sam", text: "five" });
    engine.caption({ block: 3, speaker: "Sam", text: "three" });
    expect(onLine).not.toHaveBeenCalled();
    engine.caption({ block: 7, speaker: "Sam", text: "seven" });
    expect(onLine.mock.calls.map((c) => c[0].split(": ")[1])).toEqual(["three", "five"]);
  });

  it("writes a block once; later updates to it are ignored", () => {
    const { engine, onLine } = setup();
    engine.caption({ block: 1, speaker: "Sam", text: "a" });
    vi.advanceTimersByTime(1500);
    engine.caption({ block: 1, speaker: "Sam", text: "b" });
    vi.advanceTimersByTime(5000);
    expect(onLine).toHaveBeenCalledTimes(1);
    expect(engine.lines()).toHaveLength(1);
  });

  it("drops empty and whitespace text, and names a missing speaker Someone", () => {
    const { engine, onLine } = setup();
    engine.caption({ block: 1, speaker: "Sam", text: "   " });
    engine.caption({ block: 2, speaker: "Sam", text: "" });
    vi.advanceTimersByTime(3000);
    expect(onLine).not.toHaveBeenCalled();
    engine.caption({ block: 3, speaker: "", text: "hi" });
    vi.advanceTimersByTime(1500);
    expect(onLine.mock.calls[0][0]).toContain("Someone: hi");
  });
});

describe("chat", () => {
  it("ignores messages from You in any case, and empty ones", () => {
    const { engine, onLine } = setup();
    engine.chat({ sender: "You", text: "hi" });
    engine.chat({ sender: "you", text: "hi" });
    engine.chat({ sender: "YOU", text: "hi" });
    engine.chat({ sender: "Priya", text: "  " });
    expect(onLine).not.toHaveBeenCalled();
    expect(engine.lines()).toEqual([]);
  });

  it("writes a chat message at once as a chat line", () => {
    const { engine, onLine } = setup();
    engine.chat({ sender: "Priya", text: "What is the deadline?" });
    expect(onLine).toHaveBeenCalledWith("[09:00:00] Priya (chat): What is the deadline?");
  });
});

describe("addressed", () => {
  it("matches the name as a whole word, in any case, and with a leading @", () => {
    expect(addressed("Scout, write it up", ["Scout"])).toBe(true);
    expect(addressed("hey SCOUT", ["Scout"])).toBe(true);
    expect(addressed("ping @scout please", ["Scout"])).toBe(true);
    expect(addressed("the scout badge", ["Scout"])).toBe(true);
    expect(addressed("scoutmaster is here", ["Scout"])).toBe(false);
    expect(addressed("nothing here", ["Scout"])).toBe(false);
  });

  it("matches a one-letter-wrong word for names of 5 or more letters", () => {
    expect(addressed("Skout, can you", ["Scout"])).toBe(true);
    expect(addressed("Stout, can you", ["Scout"])).toBe(true);
    expect(addressed("Scoo, can you", ["Scout"])).toBe(false);
  });

  it("does not fuzzy-match names of 4 letters", () => {
    expect(addressed("Ros, can you", ["Ross"])).toBe(false);
    expect(addressed("Rosa, can you", ["Ross"])).toBe(false);
    expect(addressed("Ross, can you", ["Ross"])).toBe(true);
  });

  it("matches a multi-word name as a phrase, ignoring case and spacing", () => {
    expect(addressed("hey ada  bot can you", ["Ada Bot"])).toBe(true);
    expect(addressed("hey Ada, can you", ["Ada Bot"])).toBe(false);
    expect(addressed("hey adabot", ["Ada Bot"])).toBe(false);
  });

  it("checks every name, and ignores empty ones", () => {
    expect(addressed("hey Fen", ["Scout", "", "Fen"])).toBe(true);
    expect(addressed("hey you", ["", "  "])).toBe(false);
  });
});

describe("wakes", () => {
  it("wakes 700 ms after an addressed line, with the lines since the last wake", () => {
    const { engine, onWake } = setup();
    engine.caption({ block: 1, speaker: "Sam", text: "Scout, what is the deadline?" });
    vi.advanceTimersByTime(1500);
    expect(onWake).not.toHaveBeenCalled();
    vi.advanceTimersByTime(699);
    expect(onWake).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(onWake.mock.calls[0][0]).toBe("[09:00:01] Sam: Scout, what is the deadline?");
  });

  it("includes one wake for two addressed lines that arrive before it fires", () => {
    const { engine, onWake } = setup();
    engine.chat({ sender: "Sam", text: "Scout, one" });
    vi.advanceTimersByTime(300);
    engine.chat({ sender: "Priya", text: "Scout, two" });
    vi.advanceTimersByTime(400);
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(onWake.mock.calls[0][0].split("\n")).toHaveLength(2);
  });

  it("holds only the lines since the previous wake", () => {
    const { engine, onWake } = setup();
    engine.chat({ sender: "Sam", text: "Scout, first" });
    vi.advanceTimersByTime(700);
    engine.chat({ sender: "Sam", text: "unrelated remark" });
    engine.chat({ sender: "Priya", text: "Scout, second" });
    vi.advanceTimersByTime(700);
    expect(onWake).toHaveBeenCalledTimes(2);
    const second = onWake.mock.calls[1][0].split("\n");
    expect(second).toHaveLength(2);
    expect(second[0]).toContain("unrelated remark");
    expect(second[1]).toContain("Scout, second");
    expect(onWake.mock.calls[1][0]).not.toContain("Scout, first");
  });

  it("caps a wake at 60 lines and names how many earlier lines were left out", () => {
    const { engine, onWake } = setup();
    for (let i = 0; i < 70; i++) engine.chat({ sender: "Sam", text: `note ${i}` });
    engine.chat({ sender: "Sam", text: "Scout, summarise" });
    vi.advanceTimersByTime(700);
    const parts = onWake.mock.calls[0][0].split("\n");
    expect(parts[0]).toBe("(11 earlier lines are in the transcript.)");
    expect(parts).toHaveLength(61);
    expect(parts[60]).toContain("Scout, summarise");
  });

  it("caps a wake at 6000 characters, keeping the newest lines that fit", () => {
    const { engine, onWake } = setup();
    const long = "a".repeat(1000);
    for (let i = 0; i < 9; i++) engine.chat({ sender: "Sam", text: long });
    engine.chat({ sender: "Sam", text: "Scout, go" });
    vi.advanceTimersByTime(700);
    const text = onWake.mock.calls[0][0] as string;
    const parts = text.split("\n");
    expect(parts[0]).toBe("(4 earlier lines are in the transcript.)");
    expect(parts.slice(1).join("\n").length).toBeLessThanOrEqual(6000);
    expect(parts.slice(1)).toHaveLength(6);
    expect(parts[parts.length - 1]).toContain("Scout, go");
  });

  it("waits while busy and fires when runEnded is called", () => {
    const { engine, onWake, flags } = setup();
    flags.busy = true;
    engine.chat({ sender: "Sam", text: "Scout, hold on" });
    vi.advanceTimersByTime(700);
    expect(onWake).not.toHaveBeenCalled();
    engine.chat({ sender: "Priya", text: "more while busy" });
    flags.busy = false;
    engine.runEnded();
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(onWake.mock.calls[0][0].split("\n")).toHaveLength(2);
    engine.runEnded();
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it("limits wakes to 60 in a rolling hour, then wakes when the oldest leaves the hour", () => {
    const { engine, onWake } = setup();
    let firstWakeAt = 0;
    onWake.mockImplementation(() => {
      if (onWake.mock.calls.length === 1) firstWakeAt = Date.now();
    });
    for (let i = 0; i < WAKES_PER_HOUR; i++) {
      engine.chat({ sender: "Sam", text: `Scout, ask ${i}` });
      vi.advanceTimersByTime(700);
    }
    expect(onWake).toHaveBeenCalledTimes(WAKES_PER_HOUR);
    engine.chat({ sender: "Sam", text: "Scout, one more" });
    vi.advanceTimersByTime(700);
    expect(onWake).toHaveBeenCalledTimes(WAKES_PER_HOUR);
    vi.advanceTimersByTime(firstWakeAt + 3_600_000 - Date.now() - 1);
    expect(onWake).toHaveBeenCalledTimes(WAKES_PER_HOUR);
    vi.advanceTimersByTime(1);
    expect(onWake).toHaveBeenCalledTimes(WAKES_PER_HOUR + 1);
    expect(onWake.mock.calls[WAKES_PER_HOUR][0]).toContain("Scout, one more");
  });
});

describe("stop", () => {
  it("clears every timer and makes later calls do nothing", () => {
    const { engine, onLine, onWake } = setup();
    engine.caption({ block: 1, speaker: "Sam", text: "Scout, open block" });
    engine.chat({ sender: "Sam", text: "Scout, a chat line" });
    const before = engine.lines();
    engine.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    engine.caption({ block: 2, speaker: "Sam", text: "after stop" });
    engine.chat({ sender: "Sam", text: "Scout, after stop" });
    engine.runEnded();
    vi.advanceTimersByTime(10_000);
    expect(onWake).not.toHaveBeenCalled();
    expect(onLine).toHaveBeenCalledTimes(1);
    expect(engine.lines()).toEqual(before);
  });

  it("lines() returns a copy", () => {
    const { engine } = setup();
    engine.chat({ sender: "Sam", text: "hi" });
    engine.lines().length = 0;
    expect(engine.lines()).toHaveLength(1);
  });
});

describe("formatLine", () => {
  it("pads the local time to two digits", () => {
    expect(formatLine(new Date(2026, 0, 2, 3, 4, 5), "Ada", "x")).toBe("[03:04:05] Ada: x");
  });
});

describe("replyText", () => {
  it("returns null for nothing", () => {
    expect(replyText(null)).toBeNull();
    expect(replyText(undefined)).toBeNull();
    expect(replyText("")).toBeNull();
    expect(replyText(" \n\t ")).toBeNull();
  });

  it("returns null for SKIP in its forms", () => {
    for (const s of ["SKIP", "skip", "Skip.", "**SKIP**", "`SKIP`", " *skip!* ", "__SKIP__"]) {
      expect(replyText(s)).toBeNull();
    }
  });

  it("keeps text that only starts with skip", () => {
    expect(replyText("skipping the review")).toEqual(["skipping the review"]);
  });

  it("strips markdown to plain text", () => {
    expect(replyText("**Bold** and __under__ and `code`")).toEqual(["Bold and under and code"]);
    expect(replyText("```js\nconst a = 1;\n```")).toEqual(["const a = 1;"]);
    expect(replyText("## Title\nText")).toEqual(["Title\nText"]);
    expect(replyText("See [docs](https://example.com)")).toEqual(["See docs (https://example.com)"]);
    expect(replyText("* one\n+ two")).toEqual(["- one\n- two"]);
    expect(replyText("a\n\n\n\nb")).toEqual(["a\n\nb"]);
  });

  it("returns short text as one message", () => {
    expect(replyText("  Done, the doc is shared.  ")).toEqual(["Done, the doc is shared."]);
  });

  it("breaks at a line break before the limit", () => {
    const a = "a".repeat(300);
    const b = "b".repeat(300);
    expect(replyText(`${a}\n${b}`)).toEqual([a, b]);
  });

  it("breaks at a sentence end before the limit", () => {
    const x = "x".repeat(480);
    const y = "y".repeat(100);
    expect(replyText(`${x}. ${y}`)).toEqual([`${x}.`, y]);
  });

  it("splits long text into at most 3 messages of at most 500 characters, ending the last with an ellipsis", () => {
    const parts = replyText("word ".repeat(500)) as string[];
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(CHAT_MAX);
    expect(parts[2].endsWith("…")).toBe(true);
    expect(parts[0].endsWith("word")).toBe(true);
  });
});
