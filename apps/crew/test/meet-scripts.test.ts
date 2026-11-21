import { createRequire } from "node:module";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { MEET_LABELS, meetMediaSource, meetState, meetPrejoin, meetCaptionsOn, meetChatFocus, meetPresent, meetStopPresenting, meetLeave, meetListenSource } = require("../src/main/meet-scripts.cjs");

const PAGE_FUNCTIONS = { meetState, meetPrejoin, meetCaptionsOn, meetChatFocus, meetPresent, meetStopPresenting, meetLeave };

describe("meet page functions", () => {
  it("each compiles alone from its source text and uses no outside name", () => {
    for (const [name, fn] of Object.entries(PAGE_FUNCTIONS)) {
      const source = fn.toString();
      expect(() => new vm.Script("(" + source + ")"), name).not.toThrow();
      expect(source, name).not.toContain("MEET_LABELS");
    }
  });

  it("the generated scripts compile", () => {
    expect(() => new vm.Script(meetMediaSource({ hosts: ["https://meet.google.com"], name: "Scout (Fenna)" }))).not.toThrow();
    expect(() => new vm.Script(meetListenSource({ binding: "__x" }))).not.toThrow();
  });

  it("the generated media script carries the host list and the name as data", () => {
    const source = meetMediaSource({ hosts: ["https://meet.google.com"], name: "Scout (Fenna)" });
    expect(source).toContain('"https://meet.google.com"');
    expect(source).toContain('"Scout (Fenna)"');
  });

  it("the generated listen script carries the binding name as data", () => {
    expect(meetListenSource({ binding: "__x" })).toContain('{"binding":"__x"}');
  });
});

/** A minimal button for the page functions: an aria-label or text, a visible box, and a click counter. */
function fakeButton(label: string, text = "") {
  const b = {
    clicks: 0,
    disabled: false,
    textContent: text,
    innerText: text,
    getAttribute: (n: string) => (n === "aria-label" ? label : null),
    getClientRects: () => [{}],
    click() {
      b.clicks++;
    },
  };
  return b;
}

/** A fake page: buttons for button queries, nothing for other selectors, and body text. */
function fakePage(buttons: ReturnType<typeof fakeButton>[], bodyText = "") {
  const ctx: Record<string, unknown> = {
    document: {
      body: { innerText: bodyText },
      querySelectorAll: (sel: string) => (sel.includes("button") ? buttons : []),
    },
    location: { origin: "https://meet.google.com" },
  };
  vm.createContext(ctx);
  const run = (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => vm.runInContext(`(${fn.toString()})`, ctx)(...args);
  return { ctx, run };
}

describe("meet page functions on a fake page", () => {
  it("reads the call state from the Leave call button and the captions toggle", () => {
    const { run } = fakePage([fakeButton("Leave call"), fakeButton("Turn off captions"), fakeButton("Stop presenting"), fakeButton("People (3)")], "");
    expect(run(meetState)).toEqual({ state: "incall", captions: true, chatOpen: false, presenting: true, people: 3 });
  });

  it("reads the waiting and ended states from page text", () => {
    expect(fakePage([], "Asking to be let in").run(meetState)).toMatchObject({ state: "waiting" });
    expect(fakePage([], "You left the meeting").run(meetState)).toMatchObject({ state: "ended" });
    expect(fakePage([], "You can't join this video call").run(meetState)).toMatchObject({ state: "denied" });
    expect(fakePage([]).run(meetState)).toEqual({ state: "unknown", captions: false, chatOpen: false, presenting: false, people: null });
  });

  it("clicks Join now on the pre-join screen, turning the microphone off first", () => {
    const mic = fakeButton("Turn off microphone");
    const join = fakeButton("", "Join now");
    const { run } = fakePage([mic, join], "");
    expect(run(meetPrejoin, { name: "Scout (Fenna)" })).toEqual({ clicked: "join", filled: false });
    expect(mic.clicks).toBe(1);
    expect(join.clicks).toBe(1);
  });

  it("asks to join when only Ask to join is there, and clicks nothing when neither is", () => {
    const ask = fakeButton("", "Ask to join");
    expect(fakePage([ask]).run(meetPrejoin, {})).toEqual({ clicked: "ask", filled: false });
    expect(ask.clicks).toBe(1);
    expect(fakePage([]).run(meetPrejoin, {})).toEqual({ clicked: null, filled: false });
  });

  it("turns captions on only when they are off", () => {
    const off = fakeButton("Turn on captions");
    expect(fakePage([off]).run(meetCaptionsOn)).toEqual({ on: true });
    expect(off.clicks).toBe(1);
    const on = fakeButton("Turn off captions");
    expect(fakePage([on]).run(meetCaptionsOn)).toEqual({ on: true });
    expect(on.clicks).toBe(0);
  });

  it("presents once and leaves once, and reports a click only when it made one", () => {
    const share = fakeButton("Share screen");
    expect(fakePage([share]).run(meetPresent)).toEqual({ clicked: true });
    expect(share.clicks).toBe(1);
    expect(fakePage([fakeButton("Stop presenting")]).run(meetPresent)).toEqual({ clicked: false });

    const stop = fakeButton("Stop presenting");
    expect(fakePage([stop]).run(meetStopPresenting)).toEqual({ clicked: true });
    expect(stop.clicks).toBe(1);

    const leave = fakeButton("Leave call");
    expect(fakePage([leave]).run(meetLeave)).toEqual({ clicked: true });
    expect(leave.clicks).toBe(1);
    expect(fakePage([]).run(meetLeave)).toEqual({ clicked: false });
  });

  it("skips disabled buttons", () => {
    const leave = fakeButton("Leave call");
    leave.disabled = true;
    expect(fakePage([leave]).run(meetLeave)).toEqual({ clicked: false });
    expect(leave.clicks).toBe(0);
  });
});

describe("meet labels", () => {
  it("lists the labels the contract names", () => {
    expect(Object.keys(MEET_LABELS).sort()).toEqual(
      [
        "button",
        "nameInput",
        "nameInputPlaceholder",
        "joinButtons",
        "micOn",
        "micOff",
        "cameraOn",
        "cameraOff",
        "waiting",
        "inCall",
        "denied",
        "ended",
        "captionsOn",
        "captionsOff",
        "captionsRegion",
        "chatToggle",
        "chatInput",
        "messageId",
        "senderAttr",
        "present",
        "stopPresenting",
        "people",
      ].sort(),
    );
  });
});
