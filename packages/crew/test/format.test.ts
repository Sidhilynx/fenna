import { readdirSync, readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AVATARS,
  AVATAR_COLORS,
  checkBot,
  defaultAvatar,
  mentionedBots,
  pickAvatar,
  checkConnector,
  checkTeam,
  GATEWAY_NAME_MAX,
  gatewayToolName,
  levelOf,
  newGrant,
  parseConnectorFile,
  serializeConnectorFile,
  describeSchedule,
  emptyState,
  formatSchedule,
  isSlug,
  LIMITS,
  newBot,
  nextRun,
  parseBot,
  parseRunLog,
  parseSchedule,
  parseState,
  MAIN_CHAT,
  RUNS_CHAT,
  chatOfRun,
  newChatId,
  parseTeam,
  parseThread,
  parseYaml,
  runFileDate,
  runFileName,
  serializeBot,
  serializeState,
  serializeTeam,
  slugify,
  stringifyYaml,
  uniqueSlug,
  type Schedule,
} from "../src/index.ts";

const sample = new URL("../../../examples/sample-crew/", import.meta.url);

const BOT = `---
name: Research
job: Tracks competitor pricing every Monday
schedule: Mondays 10:00
brain:
  cli: codex
  model: gpt-5
  effort: medium
connectors:
  - fenna-docs
  - fenna-sheets
  - name: calendar
    allow: [list_events, get_event]
    ask: [create_event]
    off: [delete_event]
    default: ask
  - name: tracker
    allow: [find.issue, "-odd/name"]
    default: off
askBefore:
  - Signing up for trials
  - "Sending: anything"
avatar: lantern
color: ochre
wallpaper: clay
---

Visit each pricing page.

Report only real changes.
`;

const sched = (t: string): Schedule => {
  const r = parseSchedule(t);
  if ("error" in r) throw new Error(r.error);
  return r.schedule;
};

describe("bot.md", () => {
  it("reads every setting and the body", () => {
    const { bot, diagnostics } = parseBot(BOT);
    expect(diagnostics).toEqual([]);
    expect(bot).toEqual({
      name: "Research",
      job: "Tracks competitor pricing every Monday",
      avatar: "lantern",
      color: "ochre",
      schedule: "mondays 10:00",
      brain: { cli: "codex", model: "gpt-5", effort: "medium" },
      connectors: [
        { type: "fenna", app: "fenna-docs" },
        { type: "fenna", app: "fenna-sheets" },
        { type: "grant", name: "calendar", tools: { list_events: "allow", get_event: "allow", create_event: "ask", delete_event: "off" }, default: "ask" },
        { type: "grant", name: "tracker", tools: { "find.issue": "allow", "-odd/name": "allow" }, default: "off" },
      ],
      logins: [],
      projects: "off",
      askBefore: ["Signing up for trials", "Sending: anything"],
      wallpaper: "clay",
      how: "Visit each pricing page.\n\nReport only real changes.",
    });
  });

  it("writes what it reads, and reads what it writes", () => {
    const { bot } = parseBot(BOT);
    const text = serializeBot(bot!);
    const again = parseBot(text);
    expect(again.diagnostics).toEqual([]);
    expect(again.bot).toEqual(bot);
    expect(serializeBot(again.bot!)).toBe(text);
    expect(text).toContain('  - "Sending: anything"');
  });

  it("reads Windows line endings and a byte order mark", () => {
    const { bot, diagnostics } = parseBot("﻿" + BOT.replace(/\n/g, "\r\n"));
    expect(diagnostics).toEqual([]);
    expect(bot!.name).toBe("Research");
  });

  it("says how to fix a file with no front matter", () => {
    const r = parseBot("name: Research\n");
    expect(r.bot).toBeNull();
    expect(r.diagnostics[0]!.message).toMatch(/must start with a line "---"/);
    expect(parseBot("---\nname: x\n").bot).toBeNull();
  });

  it("names unknown keys with a likely fix and the allowed list", () => {
    const r = parseBot(BOT.replace("schedule:", "shedule:"));
    const w = r.diagnostics.find((d) => d.severity === "warning")!;
    expect(w.message).toMatch(/Unknown setting "shedule".*Did you mean "schedule"\?.*Settings: name, job, avatar, color, schedule/);
    expect(w.line).toBe(4);
    expect(r.bot!.schedule).toBe("manual");
  });

  it("refuses bad values with messages that say what to write", () => {
    const bad = (from: string, to: string) => parseBot(BOT.replace(from, to)).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
    expect(bad("cli: codex", "cli: claud")[0]).toMatch(/Did you mean "claude"/);
    expect(bad("Mondays 10:00", "monday 10:00")[0]).toMatch(/mondays 10:00/);
    expect(bad("Mondays 10:00", "mondays 25:00")[0]).toMatch(/Hours go 00 to 23/);
    expect(bad("  - fenna-docs\n", "  - fenna-doc\n")[0]).toMatch(/Did you mean "fenna-docs"/);
    expect(bad("name: tracker", "name: browser")[0]).toMatch(/taken by Fenna Crew/);
    expect(bad("name: tracker", "name: gateway")[0]).toMatch(/taken by Fenna Crew/);
    expect(bad("name: tracker", "name: Tracker")[0]).toMatch(/lowercase letters/);
    expect(bad("effort: medium", "effort: very high")[0]).toMatch(/one word/);
    expect(bad("model: gpt-5", "model: gpt 5; rm")[0]).toMatch(/characters a model name can't have/);
    expect(bad("name: Research\n", "")[0]).toMatch(/Add "name:"/);
  });

  it("refuses names and lists past their limits", () => {
    const long = "N".repeat(LIMITS.name + 1);
    const r = parseBot(BOT.replace("name: Research", `name: ${long}`));
    expect(r.diagnostics[0]!.message).toBe(`"name" is ${LIMITS.name + 1} characters; the most is ${LIMITS.name}. Shorten it.`);
    expect(r.bot!.name.length).toBe(LIMITS.name);
    const many = Array.from({ length: LIMITS.askBefore + 1 }, (_, i) => `  - Action ${i}`).join("\n");
    expect(parseBot(BOT.replace("  - Signing up for trials\n", many + "\n")).diagnostics.some((d) => /at most 20 actions/.test(d.message))).toBe(true);
  });

  it("reports broken YAML on the right line", () => {
    const r = parseBot("---\nname: A\njob: b\n\tschedule: manual\nbrain:\n  cli: claude\n---\n");
    expect(r.diagnostics[0]).toMatchObject({ severity: "error", line: 4 });
    expect(r.diagnostics[0]!.message).toMatch(/tab/);
    const q = parseBot('---\nname: "Open\njob: b\nbrain:\n  cli: claude\n---\n');
    expect(q.diagnostics[0]).toMatchObject({ line: 2 });
    const multi = parseBot("---\nname: A\njob: |\n  b\nbrain:\n  cli: claude\n---\n");
    expect(multi.diagnostics[0]!.message).toMatch(/multi-line/);
  });

  it("checks grants with messages that say what to write", () => {
    const bad = (from: string, to: string) => parseBot(BOT.replace(from, to)).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
    expect(bad("default: ask", "default: aks")[0]).toMatch(/default "aks" is not a level\. Did you mean "ask"\?.*allow, ask, off/);
    expect(bad("ask: [create_event]", "ask: [create_event, list_events]")[0]).toBe('Connector "calendar" lists the tool "list_events" under both allow and ask. Keep it in one.');
    expect(bad("ask: [create_event]", "ask: [create event]")[0]).toMatch(/"create event" under ask, which is not a tool name/);
    expect(bad("ask: [create_event]", "ask: create_event")[0]).toMatch(/ask should be a list of tool names/);
    const unknown = parseBot(BOT.replace("ask: [create_event]", "asks: [create_event]")).diagnostics[0]!;
    expect(unknown).toMatchObject({ severity: "warning" });
    expect(unknown.message).toMatch(/Unknown key in connector "calendar" "asks".*Did you mean "ask"\?.*name, allow, ask, off, default/);
    const plain = parseBot(BOT.replace("  - fenna-sheets\n", "  - notes\n")).diagnostics[0]!.message;
    expect(plain).toMatch(/"notes" is not a Fenna app.*"- name: notes"/);
    const noDefault = parseBot(BOT.replace("    default: off\n", "")).bot!.connectors[3];
    expect(noDefault).toMatchObject({ name: "tracker", default: "ask" });
  });

  it("reads a connector written the older way as a grant, and hands it over to be installed", () => {
    const old = BOT.replace(
      "  - name: tracker\n    allow: [find.issue, \"-odd/name\"]\n    default: off\n",
      "  - name: tracker\n    url: https://mcp.example.com/mcp\n  - name: files\n    command: npx\n    args: [-y, files-mcp]\n    env:\n      FILES_TOKEN: abc\n",
    );
    const r = parseBot(old);
    expect(r.diagnostics).toEqual([]);
    expect(r.legacy).toEqual([
      { type: "url", name: "tracker", url: "https://mcp.example.com/mcp" },
      { type: "command", name: "files", command: "npx", args: ["-y", "files-mcp"], env: { FILES_TOKEN: "abc" } },
    ]);
    expect(r.bot!.connectors.slice(3)).toEqual([
      { type: "grant", name: "tracker", tools: {}, default: "ask" },
      { type: "grant", name: "files", tools: {}, default: "ask" },
    ]);
    const text = serializeBot(r.bot!);
    expect(text).not.toMatch(/command|url:|FILES_TOKEN|abc/);
    expect(parseBot(text).legacy).toEqual([]);
    expect(parseBot(old.replace("url: https://mcp.example.com/mcp", "url: http://mcp.example.com/mcp")).diagnostics[0]!.message).toMatch(/https:\/\//);
    expect(parseBot(old.replace("    command: npx\n", "    command: npx\n    url: https://a.example/mcp\n")).diagnostics[0]!.message).toMatch(/both command and url/);
  });

  it("builds a new bot with defaults, and checks one built in code", () => {
    const r = newBot({ name: "Inbox", job: "Sorts email", schedule: "Weekdays 13:00,09:00" });
    expect(r.diagnostics).toEqual([]);
    expect(r.bot.schedule).toBe("weekdays 09:00, 13:00");
    expect(r.bot.connectors.map((c) => (c.type === "fenna" ? c.app : ""))).toEqual(["fenna-docs", "fenna-sheets", "fenna-slides", "fenna-whiteboard", "fenna-design"]);
    expect(newBot({ name: "", job: "x" }).diagnostics[0]!.message).toMatch(/Add "name:"/);
    expect(checkBot({ ...r.bot, schedule: "hourly" }).diagnostics[0]!.message).toMatch(/not a schedule/);
  });
});

describe("YAML subset", () => {
  it("round-trips nested maps, lists of maps and awkward strings", () => {
    const v = { a: "plain", b: "", c: ["x", "- y", "#z", "k: v"], d: { e: "1", f: [] }, g: [{ h: "i", j: ["k"] }, {}], l: {} };
    const text = stringifyYaml(v);
    const back = parseYaml(text);
    expect(back.problems).toEqual([]);
    expect(back.value).toEqual(v);
  });

  it("strips comments but keeps # inside quotes and words", () => {
    expect(parseYaml('# top\na: x # note\nb: "y # z"\nc: C#\n').value).toEqual({ a: "x", b: "y # z", c: "C#" });
  });

  it("refuses duplicate keys and flow maps", () => {
    expect(parseYaml("a: 1\na: 2\n").problems[0]!.message).toMatch(/set twice/);
    expect(parseYaml("a: {b: 1}\n").problems[0]!.message).toMatch(/own indented line/);
  });
});

describe("slugs", () => {
  it("makes safe, unique folder names", () => {
    expect(slugify("Inbox Helper!")).toBe("inbox-helper");
    expect(slugify("Café Crème")).toBe("cafe-creme");
    expect(slugify("   ")).toBe("bot");
    expect(slugify("CON")).toBe("con-bot");
    expect(slugify("x".repeat(100)).length).toBe(40);
    expect(uniqueSlug("Research", ["research", "research-2"])).toBe("research-3");
    expect(uniqueSlug("y".repeat(60), ["y".repeat(40)])).toBe("y".repeat(38) + "-2");
    expect(isSlug("research-2")).toBe(true);
    for (const bad of ["", "Research", "-a", "a-", "a--b", "../x", "nul", "a".repeat(41)]) expect(isSlug(bad), bad).toBe(false);
  });
});

describe("schedules", () => {
  it("reads every form and writes it back the same", () => {
    for (const t of ["manual", "daily 08:00", "weekdays 09:00, 13:00", "mondays 10:00", "sundays 07:05", "every 2h 08:00-18:00"]) {
      expect(formatSchedule(sched(t))).toBe(t);
    }
    expect(formatSchedule(sched("  WEEKDAYS   9:00 ,13:00 "))).toBe("weekdays 09:00, 13:00");
  });

  it("explains each mistake", () => {
    const err = (t: unknown) => {
      const r = parseSchedule(t);
      return "error" in r ? r.error : "";
    };
    expect(err("")).toMatch(/empty/);
    expect(err(null)).toMatch(/empty/);
    expect(err("hourly")).toMatch(/"hourly" is not a schedule. Write one of/);
    expect(err("09:00")).toMatch(/Say which days first, like `daily 09:00`/);
    expect(err("friday 17:00")).toMatch(/`fridays 17:00`/);
    expect(err("weekdays")).toMatch(/Add a time/);
    expect(err("weekdays 9am")).toMatch(/HH:MM/);
    expect(err("every 2h")).toMatch(/every 2h 08:00-18:00/);
    expect(err("every 30m")).toMatch(/every hour/);
    expect(err("every 13h 08:00-18:00")).toMatch(/1 to 12 hours/);
    expect(err("every 2h 18:00-08:00")).toMatch(/end after it starts/);
    expect(err(`daily ${Array.from({ length: 13 }, (_, i) => `${String(i).padStart(2, "0")}:00`).join(",")}`)).toMatch(/At most 12/);
  });

  it("says each in plain words", () => {
    expect(describeSchedule(sched("weekdays 09:00, 13:00"))).toBe("Weekdays at 09:00 and 13:00");
    expect(describeSchedule(sched("mondays 10:00"))).toBe("Mondays at 10:00");
    expect(describeSchedule(sched("daily 08:00, 12:00, 18:00"))).toBe("Every day at 08:00, 12:00 and 18:00");
    expect(describeSchedule(sched("every 1h 08:00-18:00"))).toBe("Every hour, 08:00 to 18:00");
    expect(describeSchedule(sched("manual"))).toBe("Only when asked");
  });

  it("finds the next run on the local wall clock", () => {
    const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
    // Wednesday 18 November 2026, 09:30.
    const wed = at(2026, 11, 18, 9, 30);
    expect(nextRun(sched("manual"), wed)).toBeNull();
    expect(nextRun(sched("weekdays 09:00, 13:00"), wed)).toEqual(at(2026, 11, 18, 13, 0));
    expect(nextRun(sched("weekdays 09:00"), at(2026, 11, 20, 9, 0))).toEqual(at(2026, 11, 23, 9, 0)); // Friday 09:00 exactly → Monday
    expect(nextRun(sched("mondays 10:00"), wed)).toEqual(at(2026, 11, 23, 10, 0));
    expect(nextRun(sched("wednesdays 09:30"), wed)).toEqual(at(2026, 11, 25, 9, 30)); // strictly after
    expect(nextRun(sched("daily 08:00"), at(2026, 12, 31, 23, 0))).toEqual(at(2027, 1, 1, 8, 0));
    expect(nextRun(sched("every 2h 08:00-18:00"), wed)).toEqual(at(2026, 11, 18, 10, 0));
    expect(nextRun(sched("every 3h 08:00-18:00"), at(2026, 11, 18, 17, 0))).toEqual(at(2026, 11, 19, 8, 0)); // 08, 11, 14, 17 then tomorrow
    expect(nextRun(sched("every 1h 08:00-09:00"), at(2026, 11, 18, 8, 0))).toEqual(at(2026, 11, 18, 9, 0));
    // Around the end of daylight saving time in many zones: wall-clock hours, whatever the offset.
    const n = nextRun(sched("daily 09:00"), at(2026, 10, 25, 9, 0))!;
    expect([n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes()]).toEqual([2026, 9, 26, 9, 0]);
    const m = nextRun(sched("sundays 03:30"), at(2026, 3, 28, 12, 0))!;
    expect([m.getDate(), m.getDay()]).toEqual([29, 0]);
  });
});

describe("faces", () => {
  const base = (extra: string) => `---\nname: Scout\njob: Looks around\n${extra}brain:\n  cli: claude\n---\n`;

  it("accepts any case, and writes both, after job, always", () => {
    const { bot, diagnostics } = parseBot(base("avatar: Owl\ncolor: SEA\n"));
    expect(diagnostics).toEqual([]);
    expect(bot).toMatchObject({ avatar: "owl", color: "sea" });
    const text = serializeBot(bot!);
    expect(text).toMatch(/job: Looks around\navatar: owl\ncolor: sea\nschedule:/);
    expect(parseBot(text).bot).toEqual(bot);
    expect(serializeBot(parseBot(base("")).bot!)).toMatch(/\navatar: \w+\ncolor: \w+\n/);
  });

  it("derives a stable default from the name when missing, without a diagnostic", () => {
    const a = parseBot(base(""));
    expect(a.diagnostics).toEqual([]);
    expect({ avatar: a.bot!.avatar, color: a.bot!.color }).toEqual(defaultAvatar("Scout"));
    expect(defaultAvatar("Scout")).toEqual(defaultAvatar("  scout "));
    expect(AVATARS).toContain(defaultAvatar("x").avatar);
    expect(AVATAR_COLORS).toContain(defaultAvatar("x").color);
    const faces = new Set(["Research", "Inbox", "Fenna", "Scout", "Ledger", "Pixel", "Mail", "Docs"].map((n) => defaultAvatar(n).avatar));
    expect(faces.size).toBeGreaterThan(3);
  });

  it("warns on an unknown value with a did-you-mean and falls back to the default", () => {
    const r = parseBot(base("avatar: ow1\ncolor: seaa\n"));
    const [a, c] = r.diagnostics;
    expect(a).toMatchObject({ severity: "warning", line: 4 });
    expect(a!.message).toMatch(/avatar "ow1" is not one we have.*Did you mean "owl"\?.*Avatars: sprout/);
    expect(c!.message).toMatch(/Did you mean "sea"\?.*Colors: clay/);
    expect(r.bot).toMatchObject(defaultAvatar("Scout"));
  });

  it("reads CRLF files and a byte order mark", () => {
    const r = parseBot("﻿" + base("avatar: kite\ncolor: plum\n").replace(/\n/g, "\r\n"));
    expect(r.diagnostics).toEqual([]);
    expect(r.bot).toMatchObject({ avatar: "kite", color: "plum" });
  });

  it("newBot takes them, or picks from the name", () => {
    expect(newBot({ name: "Scout", job: "j", avatar: "moth", color: "iris" }).bot).toMatchObject({ avatar: "moth", color: "iris" });
    expect(newBot({ name: "Scout", job: "j" }).bot).toMatchObject(defaultAvatar("Scout"));
  });

  it("pickAvatar prefers a design nobody has and the least used color", () => {
    const own = defaultAvatar("Scout");
    const first = pickAvatar("Scout", []);
    expect(first).toEqual(own);
    const second = pickAvatar("Scout", [first]);
    expect(second.avatar).not.toBe(first.avatar);
    expect(second.color).not.toBe(first.color);
    const all = AVATARS.map((avatar) => ({ avatar, color: "clay" }));
    expect(pickAvatar("Scout", all).avatar).toBe(own.avatar);
    expect(pickAvatar("Scout", all).color).not.toBe("clay");
  });
});

describe("mentions", () => {
  const people = [
    { slug: "fenna", name: "Fenna" },
    { slug: "research", name: "Research" },
    { slug: "market-research", name: "Market Research" },
    { slug: "inbox", name: "Inbox" },
  ];
  it("finds whole names in any case, longest first, in order", () => {
    expect(mentionedBots("hi", people)).toEqual([]);
    expect(mentionedBots("@research please", people)).toEqual(["research"]);
    expect(mentionedBots("@Market Research and @INBOX: go", people)).toEqual(["market-research", "inbox"]);
    expect(mentionedBots("@inbox @research @inbox", people)).toEqual(["inbox", "research"]);
    expect(mentionedBots("@researcher", people)).toEqual([]);
    expect(mentionedBots("mail a@inbox.com", people)).toEqual([]);
    expect(mentionedBots("@market-research", people)).toEqual(["market-research"]);
  });
  it("@all and @everyone mean everyone", () => {
    expect(mentionedBots("@all go", people)).toEqual(["fenna", "research", "market-research", "inbox"]);
    expect(mentionedBots("@Everyone!", people)).toHaveLength(4);
    expect(mentionedBots("@allen", people)).toEqual([]);
  });
});

describe("team.md", () => {
  const TEAM = "---\nname: Launch\nlead: fenna\nmembers:\n  - research\n  - inbox\n---\n\nShip the release.\n";
  it("reads, writes and checks members against the bots that exist", () => {
    const r = parseTeam(TEAM, ["fenna", "research", "inbox"]);
    expect(r.diagnostics).toEqual([]);
    expect(r.team).toEqual({ name: "Launch", lead: "fenna", members: ["research", "inbox"], purpose: "Ship the release." });
    expect(serializeTeam(r.team!)).toBe(TEAM);
    const missing = parseTeam(TEAM, ["fenna", "research", "inboxes"]);
    expect(missing.diagnostics[0]!.message).toBe('Member "inbox" is not a bot here. Did you mean "inboxes"?');
    expect(checkTeam({ name: "T", lead: "a", members: ["a", "b", "b"], purpose: "" }).diagnostics.map((d) => d.severity)).toEqual(["warning"]);
    expect(checkTeam({ name: "T", lead: "a", members: ["a", "b"], purpose: "" }, ["a", "b"])).toMatchObject({ team: { lead: "a", members: ["b"] }, diagnostics: [] });
    expect(parseTeam("---\nname: T\n---\n").diagnostics[0]!.message).toMatch(/Add "lead:"/);
  });
});

describe("state.json and run logs", () => {
  it("reads state forgivingly", () => {
    expect(parseState(null).state).toEqual(emptyState());
    expect(parseState("{oops").diagnostics[0]!.message).toMatch(/starting fresh/);
    const s = parseState(JSON.stringify({ sessions: { claude: "abc-1", codex: "bad id!" }, mood: "sleepy", status: "x".repeat(500), lastRunAt: "2026-11-18T09:00:00Z", allowedTools: ["mcp__cal__list"] }));
    expect(s.state.chats.find((c) => c.id === MAIN_CHAT)!.sessions).toEqual({ claude: "abc-1" });
    expect(s.state.current).toBe(MAIN_CHAT);
    expect(s.state.mood).toBe("idle");
    expect(s.state.status.length).toBe(LIMITS.status);
    expect(s.state.lastRunAt).toBe("2026-11-18T09:00:00.000Z");
    expect(s.state).not.toHaveProperty("allowedTools");
    expect(parseState(serializeState(s.state)).state).toEqual(s.state);
  });

  it("keeps the runs chat and the person's chats, and never makes the runs chat current", () => {
    const s = parseState(JSON.stringify({ chats: [{ id: "c-1", title: "Hi", startedAt: "2026-11-20T09:00:00Z", sessions: { claude: "s1" }, usage: { used: 1200, window: 200000, at: "2026-11-20T09:01:00Z" }, summary: "earlier" }, { id: "bad id" }, { id: "c-1" }], current: "runs" }));
    expect(s.state.chats.map((c) => c.id)).toEqual([RUNS_CHAT, "c-1"]);
    expect(s.state.current).toBe("c-1");
    expect(s.state.chats[1]).toMatchObject({ title: "Hi", sessions: { claude: "s1" }, usage: { used: 1200, window: 200000 }, summary: "earlier" });
    expect(parseState(serializeState(s.state)).state).toEqual(s.state);
  });

  it("puts older runs in the right chat", () => {
    expect(chatOfRun({ trigger: "person", team: null })).toBe(MAIN_CHAT);
    expect(chatOfRun({ trigger: "person", team: "launch" })).toBe(RUNS_CHAT);
    expect(chatOfRun({ trigger: "schedule", team: null })).toBe(RUNS_CHAT);
    expect(chatOfRun({ trigger: "schedule", team: null, chat: "c-9" })).toBe("c-9");
    expect(newChatId(new Date(36), ["c-10"])).toBe("c-11");
  });

  it("names run files by time and reads them back, skipping a cut-off line", () => {
    const d = new Date("2026-11-18T09:00:05.123Z");
    const name = runFileName(d);
    expect(name).toBe("2026-11-18T09-00-05.123Z.jsonl");
    expect(runFileDate(name)).toEqual(d);
    expect(runFileDate("notes.jsonl")).toBeNull();
    const log = parseRunLog(`{"type":"text","at":"x","text":"hi"}\n{"type":"nope","at":"x"}\n{"type":"end","at":"x"`);
    expect(log.events).toHaveLength(1);
    expect(log.skipped).toBe(2);
    expect(parseThread('{"at":"a","from":"person","text":"hi"}\n{"at":')).toEqual([{ at: "a", from: "person", text: "hi" }]);
  });
});

describe("connectors on this computer", () => {
  const FILE = {
    name: "notes",
    type: "command",
    command: "node",
    args: ["server.mjs"],
    env: [
      { key: "NOTES_DIR", value: "C:\\notes", secret: false },
      { key: "NOTES_TOKEN", value: "ZW5jcnlwdGVk", secret: true },
    ],
    origin: "command",
    status: "ready",
    error: "",
    checkedAt: "2026-11-18T09:00:00.000Z",
    tools: [
      { name: "list_notes", title: "List notes", description: "Lists notes", readOnly: true, destructive: false },
      { name: "delete_note", title: "", description: "", readOnly: false, destructive: true },
    ],
  };

  it("reads and writes a connector file", () => {
    const r = parseConnectorFile(JSON.stringify(FILE));
    expect(r.diagnostics).toEqual([]);
    expect(r.connector).toMatchObject({ name: "notes", type: "command", command: "node", url: "", headers: [], status: "ready" });
    expect(parseConnectorFile(serializeConnectorFile(r.connector!)).connector).toEqual(r.connector);
    expect(parseConnectorFile("{oops").connector).toBeNull();
  });

  it("says what to fix in a connector", () => {
    const errors = (patch: object) => checkConnector({ ...FILE, ...patch }).diagnostics.map((d) => d.message);
    expect(errors({ name: "Notes" })[0]).toMatch(/lowercase letters, digits and dashes/);
    expect(errors({ name: "crew" })[0]).toMatch(/taken by Fenna Crew/);
    expect(errors({ name: "fenna-docs" })[0]).toMatch(/taken by Fenna Crew/);
    expect(errors({ type: "stdio" })[0]).toMatch(/either "command".*or "url"/);
    expect(errors({ command: "" })[0]).toMatch(/Say which program starts it/);
    expect(errors({ args: "server.mjs" })[0]).toMatch(/list of words/);
    expect(errors({ env: [{ key: "1BAD", value: "x" }] })[0]).toMatch(/not an environment name/);
    expect(errors({ env: [{ key: "A", value: "1" }, { key: "A", value: "2" }] })[0]).toMatch(/given twice/);
    expect(errors({ type: "url", url: "http://example.com/mcp" })[0]).toMatch(/https:\/\//);
    expect(errors({ type: "url", url: "http://localhost:3000/mcp" })).toEqual([]);
    expect(errors({ type: "url", url: "https://a.example/mcp", headers: [{ key: "Bad Header", value: "x" }] })[0]).toMatch(/not a header name/);
    expect(errors({ type: "url", url: "https://a.example/mcp", headers: [{ key: "X-A", value: "a\nb" }] })[0]).toMatch(/line break/);
  });

  it("grants read-only tools, asks for the rest, and names gateway tools safely", () => {
    const c = parseConnectorFile(JSON.stringify({ ...FILE, tools: [...FILE.tools, { name: "wipe", readOnly: true, destructive: true }] })).connector!;
    const g = newGrant("notes", c.tools);
    expect(g).toEqual({ type: "grant", name: "notes", tools: { list_notes: "allow", delete_note: "ask", wipe: "ask" }, default: "ask" });
    expect(levelOf(g, "list_notes")).toBe("allow");
    expect(levelOf(g, "added_later")).toBe("ask");
    expect(levelOf({ ...g, default: "off" }, "added_later")).toBe("off");
    expect(levelOf(g, "constructor")).toBe("ask");
    expect(gatewayToolName("notes", "list_notes")).toBe("notes__list_notes");
    expect(gatewayToolName("notes", "find.issue/x")).toBe("notes__find_issue_x");
    const long = gatewayToolName("a-very-long-connector-name-here", "and_a_very_long_tool_name_that_goes_on");
    expect(long.length).toBe(GATEWAY_NAME_MAX);
    expect(long).not.toBe(gatewayToolName("a-very-long-connector-name-here", "and_a_very_long_tool_name_that_goes_on_too"));
    const withGrant = newBot({ name: "N", job: "j", connectors: [g] });
    expect(withGrant.diagnostics).toEqual([]);
    expect(serializeBot(withGrant.bot)).toContain("  - name: notes\n    allow:\n      - list_notes\n    ask:\n      - delete_note\n      - wipe\n    default: ask\n");
  });
});

describe("sample crew", () => {
  it("loads every bot and team with zero diagnostics", () => {
    const bots = readdirSync(new URL("bots/", sample));
    expect(bots.length).toBeGreaterThanOrEqual(2);
    for (const slug of bots) {
      expect(isSlug(slug), slug).toBe(true);
      const r = parseBot(readFileSync(new URL(`bots/${slug}/bot.md`, sample), "utf8"));
      expect(r.diagnostics, slug).toEqual([]);
      expect(r.legacy, slug).toEqual([]);
      const st = new URL(`bots/${slug}/state.json`, sample);
      if (existsSync(st)) expect(parseState(readFileSync(st, "utf8")).diagnostics, slug).toEqual([]);
    }
    const teams = existsSync(new URL("teams/", sample)) ? readdirSync(new URL("teams/", sample)) : [];
    for (const slug of teams) expect(parseTeam(readFileSync(new URL(`teams/${slug}/team.md`, sample), "utf8"), bots).diagnostics, slug).toEqual([]);
  });
});
