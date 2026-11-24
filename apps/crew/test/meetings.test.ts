import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createMeetings, meetingLink, transcriptName, consentText } = require("../src/main/meetings.cjs");
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
    expect(text).toContain("Never open a call or use the browser tools on its tab");
    expect(text).toContain("Call join once per call");
  });
});

/**
 * A Meet tab that behaves like the real guest page: Ask to join stays disabled
 * until the name is typed with real key input (Input.insertText into the
 * focused field), not set from script.
 */
function fakeMeet(start: { state?: string; typedOnly?: boolean } = {}) {
  const page = {
    state: start.state ?? "prejoin",
    name: "",
    typed: false,
    focused: false,
    typedOnly: start.typedOnly ?? true,
    closed: false,
    inserted: [] as string[],
    captions: false,
    /** The captions toggle is hidden (a minimized window); "keys" takes Meet's c shortcut, "none" ignores it too. */
    toggle: "shown" as "shown" | "keys" | "none",
    keys: [] as string[],
  };
  const tab = {
    alive: () => !page.closed,
    close: () => void (page.closed = true),
    waitForControl: async () => {},
    main: async () => false,
    cdp: async (method: string, p: { text: string; type?: string; key?: string }) => {
      if (method === "Input.dispatchKeyEvent" && p.type === "keyDown" && p.key) {
        page.keys.push(p.key);
        if (p.key === "c" && page.toggle === "keys") page.captions = !page.captions;
        return {};
      }
      if (method !== "Input.insertText") return {};
      page.inserted.push(p.text);
      if (page.focused) {
        page.name = p.text;
        page.typed = true;
      }
      return {};
    },
    evaluate: async (fn: { name: string }, arg: { name?: string } | null) => {
      switch (fn.name) {
        case "meetState":
          return { state: page.state, captions: page.captions, chatOpen: false, presenting: false, people: page.state === "incall" ? 2 : null };
        case "meetNameFocus":
          if (page.state !== "prejoin") return { found: false, focused: false, value: "" };
          page.focused = true;
          return { found: true, focused: true, value: page.name };
        case "meetPrejoin":
          if (page.state !== "prejoin") return { clicked: null, filled: false, disabled: false, nameField: false };
          if (!page.name && arg && arg.name) page.name = arg.name;
          if (page.typedOnly && !page.typed) return { clicked: null, filled: true, disabled: true, nameField: true };
          page.state = "waiting";
          return { clicked: "ask", filled: true, disabled: false, nameField: true };
        case "meetCaptionsOn":
          if (page.captions) return { on: true };
          if (page.toggle !== "shown") return { on: false, key: true };
          page.captions = true;
          return { on: true };
        case "meetChatFocus":
          return { ok: true };
        case "meetLeave":
          page.state = "ended";
          return { clicked: true };
        default:
          return null;
      }
    },
  };
  return { page, tab };
}

describe("joining a call", () => {
  let dir = "";
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 10, 21, 9, 0) });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-meet-"));
  });
  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function setup(fake: ReturnType<typeof fakeMeet>, accounts: unknown = null, chrome: unknown = null) {
    const state = { chats: [] as unknown[] };
    return createMeetings({
      accounts,
      chrome,
      store: { readBot: () => ({ bot: { name: "Scout" } }), botDir: () => dir, patchState: (_slug: string, fn: (s: unknown) => void) => fn(state) },
      runner: { enqueue: () => ({ done: new Promise(() => {}) }), running: () => false, isQueued: () => false },
      browsers: { openMeeting: async () => fake.tab },
      stage: null,
      broadcast: () => {},
    });
  }

  /** Runs the fake clock until `p` settles. */
  async function settle<T>(p: Promise<T>): Promise<T> {
    let out: { ok: boolean; v: unknown } | null = null;
    p.then(
      (v) => (out = { ok: true, v }),
      (v) => (out = { ok: false, v }),
    );
    for (let i = 0; i < 120 && !out; i++) await vi.advanceTimersByTimeAsync(500);
    const done = out as { ok: boolean; v: unknown } | null;
    if (!done) throw new Error("still running");
    if (!done.ok) throw done.v;
    return done.v as T;
  }

  const join = (meetings: ReturnType<typeof setup>) => settle<{ text: string }>(meetings.act({ slug: "scout" }, { action: "join", url: "https://meet.google.com/abc-defg-hij" }));

  it("types the guest name for real, so Meet's Ask to join wakes up, and asks once", async () => {
    const fake = fakeMeet();
    const meetings = setup(fake);
    const r = await join(meetings);
    expect(fake.page.inserted).toEqual(["Scout (Fenna)"]);
    expect(fake.page.state).toBe("waiting");
    expect(r.text).toContain('Asked to join abc-defg-hij as "Scout (Fenna)"');
    expect(r.text).toContain("Don't call join again");
    expect(meetings.list()[0].state).toBe("waiting");
    meetings.stopAll();
  });

  it("when Join can't be pressed, keeps the call's tab, says what the person must do, and joins once they do it", async () => {
    const fake = fakeMeet();
    // Typing doesn't reach the field: the button stays disabled.
    fake.tab.cdp = async () => ({});
    const meetings = setup(fake);
    const r = await join(meetings);
    expect(r.text).toContain("the button stayed disabled");
    expect(r.text).toContain("take control of your browser");
    expect(r.text).not.toMatch(/sign-in/);
    expect(fake.page.closed).toBe(false);
    expect(meetings.list()[0].state).toBe("stuck");

    await expect(join(meetings)).rejects.toThrow("Don't join again");
    expect((await meetings.act({ slug: "scout" }, { action: "status" })).text).toContain("join screen");

    // The person takes control and presses Join; the host lets the bot in.
    fake.page.state = "incall";
    await vi.advanceTimersByTimeAsync(5000);
    const view = meetings.list()[0];
    expect(view.state).toBe("incall");
    expect(fs.readFileSync(path.join(dir, "workspace", "Meetings", view.transcript.split("/").pop()), "utf8")).toContain("Joined the call.");
    meetings.stopAll();
  });

  const transcript = (meetings: ReturnType<typeof setup>) => fs.readFileSync(path.join(dir, "workspace", "Meetings", meetings.list()[0].transcript.split("/").pop() as string), "utf8");

  it("turns captions on with Meet's c shortcut when the toggle is hidden, and presses it only once", async () => {
    const fake = fakeMeet({ state: "incall" });
    fake.page.toggle = "keys";
    const meetings = setup(fake);
    await join(meetings);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.page.captions).toBe(true);
    expect(fake.page.keys.filter((k) => k === "c")).toEqual(["c"]);
    expect(transcript(meetings)).not.toContain("could not be turned on");
    meetings.stopAll();
  });

  it("says in the transcript when captions can't be turned on, keeps trying, and says when they come on", async () => {
    const fake = fakeMeet({ state: "incall" });
    fake.page.toggle = "none";
    const meetings = setup(fake);
    await join(meetings);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(transcript(meetings)).toContain("Meet's captions could not be turned on");
    const tries = fake.page.keys.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fake.page.keys.length).toBeGreaterThan(tries);
    expect(fake.page.keys.length).toBeLessThan(tries + 5);
    fake.page.captions = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(transcript(meetings)).toContain("Meet's captions are on");
    meetings.stopAll();
  });

  it("names a real Google sign-in page, and presses join itself once the person has signed in", async () => {
    const fake = fakeMeet({ state: "signin" });
    const meetings = setup(fake);
    const r = await join(meetings);
    expect(r.text).toContain("Meet wants a Google sign-in");
    expect(meetings.list()[0].state).toBe("stuck");

    // Signed in: Meet shows its join screen with no name to type, and Crew asks to join.
    fake.page.state = "prejoin";
    fake.page.typedOnly = false;
    await vi.advanceTimersByTimeAsync(6000);
    expect(fake.page.state).toBe("waiting");
    await vi.advanceTimersByTimeAsync(3000);
    expect(meetings.list()[0].state).toBe("waiting");
    meetings.stopAll();
  });

  it("signs the bot in to its own Google account before it joins", async () => {
    const fake = fakeMeet();
    const ensured: string[] = [];
    const meetings = setup(fake, { ensure: async (slug: string) => (ensured.push(slug), { state: "signed_in", email: "scout@gmail.com" }) });
    const r = await join(meetings);
    expect(ensured).toEqual(["scout"]);
    expect(r.text).toContain("Asked to join abc-defg-hij");
    meetings.stopAll();
  });

  it("doesn't join while the bot's own account is signed out, and says how the person signs it in", async () => {
    const fake = fakeMeet();
    const meetings = setup(fake, { ensure: async () => ({ state: "signed_out", email: "scout@gmail.com", message: "" }) });
    await expect(join(meetings)).rejects.toThrow('Your Google account (scout@gmail.com) is signed out. Call account with {action: "sign_in"}');
    expect(meetings.list()).toEqual([]);
    expect(fake.page.inserted).toEqual([]);
  });

  it("runs the call in the bot's own Chrome when Chrome is installed, and Show call brings it up", async () => {
    const fake = fakeMeet();
    const shown: string[] = [];
    const opened: string[] = [];
    const chrome = { available: () => true, openTab: async (_slug: string, o: { url: string }) => (opened.push(o.url), fake.tab), show: async (slug: string) => (shown.push(slug), true) };
    const meetings = setup(fake, null, chrome);
    const r = await join(meetings);
    expect(opened).toEqual(["https://meet.google.com/abc-defg-hij"]);
    expect(r.text).toContain("Asked to join abc-defg-hij");
    expect(meetings.list()[0].inChrome).toBe(true);
    await meetings.person("scout", "show");
    expect(shown).toEqual(["scout"]);
    meetings.stopAll();
  });

  it("tells a bot without an account why Meet refused it as a guest", async () => {
    const fake = fakeMeet({ state: "denied" });
    const meetings = setup(fake);
    const r = await join(meetings);
    expect(r.text).toContain("doesn't take guests without a Google account");
    expect(r.text).toContain("under Google account");
    expect(meetings.list()).toEqual([]);
  });

  it("gives up after 10 minutes at the join screen and closes the tab", async () => {
    const fake = fakeMeet();
    fake.tab.cdp = async () => ({});
    const meetings = setup(fake);
    await join(meetings);
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(meetings.list()).toEqual([]);
    expect(fake.page.closed).toBe(true);
  });
});
