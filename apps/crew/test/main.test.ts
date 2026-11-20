import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectLink } from "@opendeck/crew-mcp";
import { parseRunLog, type RunEvent } from "@opendeck/crew";

const require = createRequire(import.meta.url);
const { createStore } = require("../src/main/store.cjs");
const { createWaits } = require("../src/main/waits.cjs");
const { createLink } = require("../src/main/link.cjs");
const { createRunner } = require("../src/main/runner.cjs");
const { createApprover, createHandlers, MAX_HANDOFFS } = require("../src/main/handlers.cjs");
const { createDisk } = require("../src/main/disk.cjs");
const { createConnectorStore } = require("../src/main/connectors.cjs");
const { createConnections } = require("../src/main/connections.cjs");
const { createGateway } = require("../src/main/gateway.cjs");
const { createServers } = require("../src/main/servers.cjs");
const { createScheduler } = require("../src/main/scheduler.cjs");
const { createViews, shortTime } = require("../src/main/views.cjs");
const { buildPrompt } = require("../src/main/prompt.cjs");
const { toEntry } = require("../src/main/registry.cjs");
const { parseKey, toElectronInput, viewOf, webAddress, safeDownloadName, uniqueName, overCap, downloadRoom, tooBigText, sizeText, KEEP_FREE } = require("../src/main/browser.cjs");
const { toolLabel } = require("../src/main/labels.cjs");
const { createNotifier } = require("../src/main/notify.cjs");
const { checkSettingsPatch, readStored } = require("../src/main/settings.cjs");

type Ev = Record<string, unknown> & { type: string };
type Started = { o: { kind: string; prompt: string; cwd: string; sessionId: string | null; onEvent(e: Ev): void; servers: Record<string, { env: Record<string, string> }> }; token: string; stopped: boolean; emit(e: Ev): void };

let root: string;
let store: ReturnType<typeof createStore>;
let waits: ReturnType<typeof createWaits>;
let link: ReturnType<typeof createLink>;
let runner: ReturnType<typeof createRunner>;
let handle: (ctx: object, method: string, params: object) => Promise<{ text: string }>;
let started: Started[];
let live: { slug: string; event: Ev }[];
let desktopEvents: { slug: string; items: object[] }[];
let clock: Date;

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await tick();
  }
}
const runEvents = (slug: string): RunEvent[] => [...store.runFiles(slug)].reverse().flatMap((f: string) => store.readRun(slug, f));
const lastRun = (slug: string): RunEvent[] => store.readRun(slug, store.runFiles(slug)[0]);

function fakeStartRun(o: Started["o"]) {
  const s: Started = {
    o,
    token: o.servers.crew!.env.OPENDECK_CREW_TOKEN!,
    stopped: false,
    emit: (e) => o.onEvent({ runId: "cli-run", ...e }),
  };
  started.push(s);
  return {
    runId: `cli-${started.length}`,
    stop: () => {
      s.stopped = true;
      setTimeout(() => s.emit({ type: "stopped" }), 0);
    },
  };
}

/** Stands in for the system's secure storage: reversible, but never the plain text. */
const fakeSecrets = {
  available: async () => true,
  encrypt: async (t: string) => `enc:${Buffer.from(t).toString("base64")}`,
  decrypt: async (d: string) => {
    if (!d.startsWith("enc:")) throw new Error("not ours");
    return Buffer.from(d.slice(4), "base64").toString();
  },
  availableSync: () => true,
  encryptSync: (t: string) => `enc:${Buffer.from(t).toString("base64")}`,
};

type FakeConn = { spec: { name: string; env?: Record<string, string> }; calls: { tool: string; args: object }[]; exit: (why: string) => void; closed: boolean };
let conns: FakeConn[];
let connectFails: string | null;
const NOTES_TOOLS = [
  { name: "list_notes", title: "List notes", description: "Lists every note.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "add_note", title: "Add a note", description: "Adds one note.", inputSchema: { type: "object", properties: { text: { type: "string" } } }, annotations: {} },
  { name: "clear_notes", title: "", description: "Deletes every note.", inputSchema: { type: "object" }, annotations: { destructiveHint: true } },
];
const fakeClient = {
  async connectServer(spec: FakeConn["spec"]) {
    if (connectFails) throw new Error(connectFails);
    const c: FakeConn = { spec, calls: [], exit: () => {}, closed: false };
    conns.push(c);
    return {
      pid: null,
      listTools: async () => NOTES_TOOLS,
      callTool: async (tool: string, args: object) => {
        c.calls.push({ tool, args });
        return { content: [{ type: "text", text: `${tool} ran with token ${spec.env?.NOTES_TOKEN}` }], isError: false };
      },
      close: async () => {
        c.closed = true;
      },
      onExit: (fn: (why: string) => void) => {
        c.exit = fn;
      },
      onToolsChanged: () => {},
    };
  },
};

let connectors: ReturnType<typeof createConnectorStore>;
let connections: ReturnType<typeof createConnections>;

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "crew-main-"));
  conns = [];
  connectFails = null;
  connectors = createConnectorStore({ dir: path.join(root, "connectors"), secrets: fakeSecrets });
  connections = createConnections({ connectors, client: fakeClient, onChange: () => {} });
  store = createStore(root, { migrate: (slug: string, legacy: object[]) => connectors.migrate(slug, legacy) });
  store.ensure();
  store.createBot({ name: "Fenna", job: "Leads the crew", how: "Plan and hand out work." });
  store.createBot({ name: "Research", job: "Checks example.com every Monday", schedule: "mondays 10:00", askBefore: ["Signing up for anything"] });
  store.createBot({ name: "Inbox", job: "Sorts email", schedule: "weekdays 09:00, 13:00" });
  started = [];
  live = [];
  desktopEvents = [];
  clock = new Date(2026, 10, 18, 9, 30);
  waits = createWaits({ timeoutMs: 1500 });
  link = createLink({ handle: (ctx: object, m: string, p: object) => handle(ctx, m, p) });
  await link.listen();
  runner = createRunner({
    store,
    startRun: fakeStartRun,
    serversFor: ({ token }: { token: string }) => ({ servers: { crew: { command: "node", env: { OPENDECK_CREW_TOKEN: token } } }, trusted: ["crew"] }),
    link,
    waits,
    toolLabel,
    onChange: () => {},
    emitLive: (slug: string, _runId: string, event: Ev) => live.push({ slug, event }),
    onEnd: (runId: string) => gateway.endRun(runId),
    now: () => clock,
  });
  const approve = createApprover({ store, runner, waits, now: () => clock });
  const gateway = createGateway({ store, connectors, connections, approve, runner, onChange: () => {}, listWaitMs: 500 });
  handle = createHandlers({
    store,
    runner,
    waits,
    approve,
    gateway,
    browsers: { act: async (_slug: string, m: string) => ({ text: `browser ${m}` }) },
    onChange: () => {},
    onDesktop: (slug: string, items: object[]) => desktopEvents.push({ slug, items }),
    disk: createDisk({ store, settingsFile: path.join(root, "disk-quotas.json") }),
    now: () => clock,
  });
});

afterEach(async () => {
  runner.stopAll();
  link.close();
  await connections.stopAll();
  rmSync(root, { recursive: true, force: true });
});

describe("runner", () => {
  it("runs a bot in its folder with its job, logs every event and keeps its session and status", async () => {
    const r = runner.enqueue({ slug: "research", trigger: "person", text: "Check it now" });
    expect(r.queued).toBe(false);
    const s = started[0]!;
    expect(s.o.cwd).toBe(store.botDir("research"));
    expect(s.o.kind).toBe("claude");
    expect(s.o.sessionId).toBeNull();
    expect(s.o.prompt).toMatch(/You are Research/);
    expect(s.o.prompt).toMatch(/"Signing up for anything"/);
    expect(s.o.prompt).toMatch(/The person says:\n<message>\nCheck it now/);
    s.emit({ type: "session", sessionId: "sess-1" });
    s.emit({ type: "tool", id: "t1", server: "browser", tool: "open", label: "Opened example.com", status: "running" });
    s.emit({ type: "tool", id: "t1", status: "done" });
    s.emit({ type: "text", text: "Example.com still shows the Example Domain page.\nNothing changed." });
    s.emit({ type: "done", sessionId: "sess-1" });
    const result = await r.done;
    expect(result).toMatchObject({ outcome: "done", text: expect.stringMatching(/^Example.com still/) });
    const ev = lastRun("research");
    expect(ev.map((e) => e.type)).toEqual(["start", "tool", "tool", "text", "end"]);
    expect(ev[2]).toMatchObject({ type: "tool", server: "browser", tool: "open", label: "Opened example.com", status: "done" });
    const state = store.readState("research");
    expect(state.chats.find((c: { id: string }) => c.id === state.current).sessions.claude).toBe("sess-1");
    expect(state.status).toBe("Example.com still shows the Example Domain page.");
    expect(state.lastRunAt).toBe(clock.toISOString());
    expect(live.map((l) => l.event.type)).toEqual(["start", "tool", "tool", "text", "end"]);

    // Its schedule runs in the runs chat, a conversation of its own.
    const sched = runner.enqueue({ slug: "research", trigger: "schedule" });
    expect(started[1]!.o.sessionId).toBeNull();
    expect(started[1]!.o.prompt).toMatch(/Your schedule woke you/);
    started[1]!.emit({ type: "done" });
    await sched.done;
    runner.enqueue({ slug: "research", trigger: "person", text: "And now?" });
    expect(started[2]!.o.sessionId).toBe("sess-1");
  });

  it("runs at most two at once, one per bot, and starts the next as one ends", async () => {
    const a = runner.enqueue({ slug: "research", trigger: "person", text: "a" });
    const b = runner.enqueue({ slug: "inbox", trigger: "person", text: "b" });
    const c = runner.enqueue({ slug: "fenna", trigger: "person", text: "c" });
    const d = runner.enqueue({ slug: "research", trigger: "person", text: "d" });
    expect([a.queued, b.queued, c.queued, d.queued]).toEqual([false, false, true, true]);
    expect(started).toHaveLength(2);
    expect(runner.queueOrder()).toEqual(["fenna", "research"]);
    started[0]!.emit({ type: "done" });
    await a.done;
    // research's next run waits behind fenna in line; fenna takes the free slot.
    expect(started.map((s) => s.o.cwd.split(path.sep).pop())).toEqual(["research", "inbox", "fenna"]);
    started[1]!.emit({ type: "done" });
    await b.done;
    expect(started[3]!.o.prompt).toMatch(/<message>\nd/);
  });

  it("stops a run and drops the bot's queued runs", async () => {
    const a = runner.enqueue({ slug: "research", trigger: "person", text: "a" });
    const b = runner.enqueue({ slug: "research", trigger: "person", text: "b" });
    expect(runner.stop("research")).toBe(true);
    expect(await b.done).toMatchObject({ outcome: "stopped" });
    expect(await a.done).toMatchObject({ outcome: "stopped" });
    expect(started[0]!.stopped).toBe(true);
    expect(store.readState("research").status).toBe("Stopped");
    expect(runner.stop("research")).toBe(false);
  });

  it("compacts a nearly full chat and continues from its summary in a fresh conversation", async () => {
    const r = runner.enqueue({ slug: "research", trigger: "person", text: "Long job" });
    started[0]!.emit({ type: "session", sessionId: "s-long" });
    started[0]!.emit({ type: "text", text: "Done." });
    started[0]!.emit({ type: "usage", used: 170000, window: 200000 });
    started[0]!.emit({ type: "done" });
    await r.done;
    // 85% full: Crew asks the bot to sum up, in the same conversation.
    expect(started).toHaveLength(2);
    expect(started[1]!.o.sessionId).toBe("s-long");
    expect(started[1]!.o.prompt).toMatch(/Write a summary of this chat/);
    started[1]!.emit({ type: "text", text: "The person wants the long job; it is done." });
    started[1]!.emit({ type: "done" });
    await new Promise((res) => setTimeout(res, 0));
    const st = store.readState("research");
    const chat = st.chats.find((c: { id: string }) => c.id === st.current);
    expect(chat).toMatchObject({ sessions: {}, usage: null, summary: "The person wants the long job; it is done.", title: "Long job" });
    runner.enqueue({ slug: "research", trigger: "person", text: "Next" });
    expect(started[2]!.o.sessionId).toBeNull();
    expect(started[2]!.o.prompt).toContain("<earlier>\nThe person wants the long job; it is done.\n</earlier>");
  });

  it("keeps each chat's conversation apart", async () => {
    const a = runner.enqueue({ slug: "research", trigger: "person", text: "first" });
    started[0]!.emit({ type: "session", sessionId: "s-a" });
    started[0]!.emit({ type: "text", text: "ok" });
    started[0]!.emit({ type: "done" });
    await a.done;
    store.patchState("research", (s: { chats: { id: string }[]; current: string }) => {
      s.chats.push({ id: "c-new", title: "", startedAt: null, sessions: {}, usage: null, summary: "" } as never);
      s.current = "c-new";
    });
    runner.enqueue({ slug: "research", trigger: "person", text: "second" });
    expect(started[1]!.o.sessionId).toBeNull();
    expect(lastRun("research")[0]).toMatchObject({ type: "start", chat: "c-new" });
  });

  it("starts a fresh conversation once when the CLI lost the old one", async () => {
    store.patchState("research", (s: { chats: { id: string; sessions: Record<string, string> }[]; current: string }) => (s.chats.find((c) => c.id === s.current)!.sessions.claude = "gone"));
    const r = runner.enqueue({ slug: "research", trigger: "person", text: "hi" });
    expect(started[0]!.o.sessionId).toBe("gone");
    started[0]!.emit({ type: "error", message: "No conversation found with session ID: gone" });
    expect(started).toHaveLength(2);
    expect(started[1]!.o.sessionId).toBeNull();
    const after = store.readState("research");
    expect(after.chats.find((c: { id: string }) => c.id === after.current).sessions.claude).toBeUndefined();
    started[1]!.emit({ type: "text", text: "Hi." });
    started[1]!.emit({ type: "done" });
    expect((await r.done).outcome).toBe("done");
  });

  it("reports a run that ended having done and said nothing as an error", async () => {
    const r = runner.enqueue({ slug: "inbox", trigger: "person", text: "go" });
    started[0]!.emit({ type: "done" });
    expect(await r.done).toMatchObject({ outcome: "error", message: expect.stringMatching(/Claude Code ended without doing or saying anything/) });
  });

  it("refuses to run a bot whose bot.md has errors, saying why", async () => {
    writeFileSync(path.join(store.botDir("inbox"), "bot.md"), "---\nname: Inbox\njob: Sorts email\nschedule: hourly\nbrain:\n  cli: claude\n---\n");
    const r = await runner.enqueue({ slug: "inbox", trigger: "person", text: "go" }).done;
    expect(r.outcome).toBe("error");
    expect(r.message).toMatch(/bot.md has problems.*"hourly" is not a schedule/);
    expect(started).toHaveLength(0);
    expect(() => runner.enqueue({ slug: "nobody", trigger: "person", text: "x" })).toThrow(/no bot "nobody"/);
  });
});

describe("tools reaching the app over the pipe", () => {
  async function client(slug: string, text = "go") {
    const r = runner.enqueue({ slug, trigger: "person", text });
    const s = started[started.length - 1]!;
    return { r, s, c: connectLink(link.pipe, s.token) };
  }

  it("asks the person and returns their answer, with both in the run log", async () => {
    const { s, c } = await client("inbox");
    const p = c.call("ask", { question: "Which inbox first?", options: ["Work", "Personal"], multi: false });
    await until(() => waits.list().length === 1);
    const w = waits.list()[0];
    expect(w).toMatchObject({ kind: "ask", slug: "inbox", botName: "Inbox", question: "Which inbox first?" });
    const views = createViews({ store, runner, waits, scheduler: { nextRun: () => null }, browsers: { state: () => null }, settings: () => ({ openAtLogin: false, maxConcurrent: 2 }), now: () => clock });
    expect(views.overview().bots.find((b: { slug: string }) => b.slug === "inbox")).toMatchObject({ mood: "need", needs: 1, statusLine: "Needs you: Which inbox first?" });
    expect(waits.answer(w.id, ["Work"])).toBe(true);
    expect((await p).text).toBe('The person answered: "Work".');
    s.emit({ type: "done" });
    const ev = runEvents("inbox");
    expect(ev.filter((e) => e.type === "ask" || e.type === "answer")).toEqual([
      expect.objectContaining({ type: "ask", askId: w.id, options: ["Work", "Personal"] }),
      expect.objectContaining({ type: "answer", askId: w.id, answer: ["Work"], by: "person" }),
    ]);
  });

  it("tells the bot to stop when an approval is denied, and when nobody answers", async () => {
    const { c } = await client("inbox");
    const p = c.call("approval", { action: "Send the reply to Priya", details: "Thursday works." });
    await until(() => waits.list().length === 1);
    waits.answer(waits.list()[0].id, { allowed: false });
    expect((await p).text).toMatch(/^Denied by the person. Don't do it/);
    const timedOut = await c.call("approval", { action: "Send it anyway" });
    expect(timedOut.text).toMatch(/No answer after \d+ minutes?, so it is not approved/);
    const decisions = runEvents("inbox").filter((e) => e.type === "decision");
    expect(decisions.map((d) => d.type === "decision" && [d.allowed, d.by])).toEqual([
      [false, "person"],
      [false, "timeout"],
    ]);
  });

  it("refuses a token from a run that ended", async () => {
    const { s, r, c } = await client("inbox");
    s.emit({ type: "done" });
    await r.done;
    await expect(c.call("remember", { note: "x" })).rejects.toThrow(/This run has ended/);
  });

  it("remembers, sets status and passes browser calls on", async () => {
    const { c } = await client("research");
    expect((await c.call("remember", { note: "Example.com has one link.\nThat's all." })).text).toBe("Saved to memory.");
    expect(store.readMemory("research")).toBe("- 2026-11-18: Example.com has one link. That's all.\n");
    await c.call("status", { status: "Reading example.com", mood: "work" });
    expect(store.readState("research").status).toBe("Reading example.com");
    expect(runner.running("research")).toMatchObject({ statusSet: true });
    expect((await c.call("browser.snapshot", {})).text).toBe("browser snapshot");
  });

  it("hands work to another bot and returns its reply, within the team's thread", async () => {
    store.createTeam({ name: "Launch", lead: "fenna", members: ["research"], purpose: "Ship it" });
    const r = runner.enqueue({ slug: "fenna", trigger: "person", text: "What does example.com say?", team: "launch" });
    const lead = started[0]!;
    expect(lead.o.prompt).toMatch(/You lead this team/);
    const c = connectLink(link.pipe, lead.token);
    const p = c.call("message", { bot: "research", message: "Read example.com and reply with one line." });
    await until(() => started.length === 2);
    const member = started[1]!;
    expect(member.o.prompt).toMatch(/Fenna \(fenna\) handed you this task/);
    expect(member.o.prompt).toMatch(/You are a member; fenna leads it/);
    member.emit({ type: "text", text: "It says Example Domain." });
    member.emit({ type: "done" });
    expect((await p).text).toBe("Research replied:\nIt says Example Domain.");
    lead.emit({ type: "done" });
    await r.done;
    const thread = store.readThread("launch");
    expect(thread.map((m: { from: string }) => m.from)).toEqual(["fenna", "research"]);
    expect(runEvents("fenna").filter((e) => e.type === "handoff" || e.type === "handback").map((e) => e.type)).toEqual(["handoff", "handback"]);
    expect(runEvents("research")[0]).toMatchObject({ type: "start", trigger: "bot", from: "fenna", team: "launch" });
  });

  it("stops loops: no messaging a bot that waits on you, and at most six hand-offs per message", async () => {
    const ctx = { slug: "research", runId: "x", team: null, chain: { count: { n: 0 }, stack: ["fenna", "research"] } };
    await expect(handle(ctx, "message", { bot: "fenna", message: "back to you" })).rejects.toThrow(/Fenna is waiting on you/);
    await expect(handle(ctx, "message", { bot: "research", message: "me" })).rejects.toThrow(/That is you/);
    await expect(handle(ctx, "message", { bot: "reserch", message: "x" })).rejects.toThrow(/no bot "reserch". Did you mean "research"\?/);
    const full = { ...ctx, chain: { count: { n: MAX_HANDOFFS }, stack: ["research"] } };
    await expect(handle(full, "message", { bot: "inbox", message: "x" })).rejects.toThrow(/handed on 6 times/);
  });

  it("copies a hand-off's files, tells the receiver where they are, and logs them on both runs", async () => {
    mkdirSync(path.join(store.botDir("research"), "workspace", "notes"), { recursive: true });
    writeFileSync(path.join(store.botDir("research"), "workspace", "notes", "brief.md"), "Notes");
    const r = runner.enqueue({ slug: "research", trigger: "person", text: "Go" });
    const ctx = { slug: "research", runId: r.runId, team: null, chain: null };
    const p = handle(ctx, "message", { bot: "inbox", message: "Sort these notes.", files: ["Files/notes"] });
    await until(() => started.length === 2);
    const member = started[1]!;
    expect(member.o.prompt).toMatch(/Research \(research\) handed you this task[\s\S]*They copied these files onto your disk for the task \(their originals stay with them\):\n- Files\/From Research\/notes\/brief\.md$/);
    member.emit({ type: "text", text: "Sorted." });
    member.emit({ type: "done" });
    expect((await p).text).toBe("Copied 1 file to Inbox: Files/From Research/notes/brief.md. Your files are unchanged.\n\nInbox replied:\nSorted.");
    const copied = { name: "brief.md", size: 5, fromPath: "Files/notes/brief.md", toPath: "Files/From Research/notes/brief.md" };
    expect(runEvents("research").filter((e) => e.type === "files")).toEqual([expect.objectContaining({ type: "files", from: "research", to: "inbox", files: [copied] })]);
    expect(runEvents("inbox").filter((e) => e.type === "files")).toEqual([expect.objectContaining({ type: "files", from: "research", to: "inbox", files: [copied] })]);
    expect(readFileSync(path.join(store.botDir("inbox"), "workspace", "From Research", "notes", "brief.md"), "utf8")).toBe("Notes");
    expect(readFileSync(path.join(store.botDir("research"), "workspace", "notes", "brief.md"), "utf8")).toBe("Notes");
    started[0]!.emit({ type: "done" });
    await r.done;
  });

  it("refuses a hand-off to an unknown bot before copying anything", async () => {
    mkdirSync(path.join(store.botDir("research"), "workspace"), { recursive: true });
    writeFileSync(path.join(store.botDir("research"), "workspace", "a.txt"), "a");
    const ctx = { slug: "research", runId: "x", team: null, chain: null };
    await expect(handle(ctx, "message", { bot: "reserch", message: "x", files: ["Files/a.txt"] })).rejects.toThrow('Did you mean "research"?');
    await expect(handle(ctx, "message", { bot: "reserch", message: "x", files: ["Files/a.txt"] })).rejects.toThrow("Bots: fenna, inbox.");
    expect(existsSync(path.join(store.botDir("inbox"), "workspace", "From Research"))).toBe(false);
    expect(runEvents("research").filter((e) => e.type === "files")).toEqual([]);
  });

  it("says in the step line how many files a hand-off carries", () => {
    expect(toolLabel("message_bot", { bot: "inbox", message: "x" }, "crew")).toBe("Handed a task to inbox");
    expect(toolLabel("message_bot", { bot: "inbox", message: "x", files: ["Files/a.txt"] }, "crew")).toBe("Handed a task to inbox, with 1 file");
    expect(toolLabel("message_bot", { bot: "inbox", message: "x", files: ["Files/a", "Files/b"] }, "crew")).toBe("Handed a task to inbox, with 2 files");
  });

  /** Install the notes connector and grant it to a bot: list_notes allow, add_note ask, clear_notes off. */
  async function grantNotes(slug: string) {
    connectors.save(await connectors.prepare({ name: "notes", type: "command", command: "node", args: ["notes.mjs"], env: [{ key: "NOTES_TOKEN", value: "s3cret-token", secret: true }] }));
    const bot = store.readBot(slug).bot;
    store.updateBot(slug, { connectors: [...bot.connectors, { type: "grant", name: "notes", tools: { list_notes: "allow", add_note: "ask", clear_notes: "off" }, default: "ask" }] });
  }
  const gw = async (c: ReturnType<typeof connectLink>, method: string, params: object) => (await c.call(method, params as Record<string, unknown>)) as { text: string; data: { tools?: { name: string; description: string }[]; content?: { text: string }[] } };

  it("gives a bot only its allow and ask tools, runs allow at once and ask only after approval, and logs every call", async () => {
    await grantNotes("inbox");
    const { c, s } = await client("inbox");
    const listed = await gw(c, "gateway.list", {});
    expect(listed.data.tools!.map((t) => t.name)).toEqual(["notes__list_notes", "notes__add_note"]);
    expect(listed.data.tools![1]!.description).toMatch(/^Adds one note\.\n\nThe person approves each call/);
    const read = await gw(c, "gateway.call", { name: "notes__list_notes", arguments: {} });
    expect(read.data.content![0]!.text).toBe("list_notes ran with token s3cret-token");
    expect(waits.list()).toHaveLength(0);

    const write = gw(c, "gateway.call", { name: "notes__add_note", arguments: { text: "milk" } });
    await until(() => waits.list().length === 1);
    expect(waits.list()[0]).toMatchObject({ kind: "approval", source: "connector", tool: "notes/add_note", action: "Add a note (notes)", details: '{\n  "text": "milk"\n}' });
    expect(conns[0]!.calls.map((x) => x.tool)).toEqual(["list_notes"]);
    waits.answer(waits.list()[0].id, { allowed: true });
    expect((await write).data.content![0]!.text).toMatch(/^add_note ran/);
    expect(conns[0]!.calls).toEqual([{ tool: "list_notes", args: {} }, { tool: "add_note", args: { text: "milk" } }]);
    expect(conns).toHaveLength(1);

    await expect(c.call("gateway.call", { name: "notes__clear_notes", arguments: {} })).rejects.toThrow(/no connector tool "notes__clear_notes"/);
    s.emit({ type: "done" });
    const ev = lastRun("inbox").filter((e) => e.type === "connector");
    expect(ev).toEqual([
      expect.objectContaining({ bot: "inbox", connector: "notes", tool: "list_notes", level: "allow", outcome: "done", message: null }),
      expect.objectContaining({ bot: "inbox", connector: "notes", tool: "add_note", level: "ask", outcome: "done" }),
    ]);
    expect(JSON.stringify(lastRun("inbox"))).not.toContain("s3cret-token");
  });

  it("keeps a denied call from running, remembers 'always for this bot' in bot.md, and applies a change made mid-run", async () => {
    await grantNotes("inbox");
    const { c } = await client("inbox");
    await gw(c, "gateway.list", {});
    const denied = c.call("gateway.call", { name: "notes__add_note", arguments: { text: "x" } });
    await until(() => waits.list().length === 1);
    waits.answer(waits.list()[0].id, { allowed: false });
    await expect(denied).rejects.toThrow(/Denied by the person: add_note did not run\. Don't do it, and don't try another way/);
    expect(conns.flatMap((x) => x.calls)).toEqual([]);

    const always = gw(c, "gateway.call", { name: "notes__add_note", arguments: { text: "y" } });
    await until(() => waits.list().length === 1);
    waits.answer(waits.list()[0].id, { allowed: true, always: true });
    await always;
    expect(store.readBot("inbox").bot.connectors.find((x: { type: string }) => x.type === "grant").tools.add_note).toBe("allow");
    await gw(c, "gateway.call", { name: "notes__add_note", arguments: { text: "z" } });
    expect(waits.list()).toHaveLength(0);

    const bot = store.readBot("inbox").bot;
    store.updateBot("inbox", { connectors: bot.connectors.map((x: { type: string }) => (x.type === "grant" ? { ...x, tools: { ...(x as { tools: object }).tools, list_notes: "off" } } : x)) });
    await expect(c.call("gateway.call", { name: "notes__list_notes", arguments: {} })).rejects.toThrow(/turned list_notes from notes off for you/);
    const outcomes = lastRun("inbox").filter((e) => e.type === "connector").map((e) => (e as { outcome: string }).outcome);
    expect(outcomes).toEqual(["denied", "done", "done", "denied"]);
  });

  it("leaves out a connector that can't start, and says why on the connector", async () => {
    await grantNotes("inbox");
    connectFails = "Couldn't start \"node\": it isn't installed.";
    const { c } = await client("inbox");
    expect((await gw(c, "gateway.list", {})).data.tools).toEqual([]);
    expect(connectors.get("notes")).toMatchObject({ status: "error", error: "Couldn't start \"node\": it isn't installed." });
  });

  it("starts a stopped connector again when it was in use", async () => {
    await grantNotes("inbox");
    const { c } = await client("inbox");
    await gw(c, "gateway.call", { name: "notes__list_notes", arguments: {} });
    conns[0]!.exit("It stopped. It said: boom s3cret-token");
    expect(connectors.get("notes")).toMatchObject({ status: "error", error: "It stopped. It said: boom ••• Crew is starting it again." });
    await gw(c, "gateway.call", { name: "notes__list_notes", arguments: {} });
    expect(conns).toHaveLength(2);
    expect(connections.running("notes")).toBe(true);
  });

  it("hands a run the gateway only when the bot has installed connectors, and trusts every server", async () => {
    const servers = createServers({ link, store, connectors, connections, packaged: false, resources: "", repo: "/repo", homes: path.join(root, "homes") });
    const plain = servers({ slug: "research", bot: store.readBot("research").bot, token: "t" });
    expect(Object.keys(plain.servers)).toEqual(["crew", "browser", "fenna"]);
    expect(plain.trusted).toEqual(["crew", "browser", "fenna"]);
    expect(plain).not.toHaveProperty("permissionTool");
    await grantNotes("research");
    const withGrant = servers({ slug: "research", bot: store.readBot("research").bot, token: "t" });
    expect(Object.keys(withGrant.servers)).toEqual(["crew", "browser", "fenna", "gateway"]);
    expect(withGrant.servers.gateway.args.at(-1)).toBe("--server=gateway");
    expect(JSON.stringify(withGrant.servers)).not.toContain("s3cret-token");
    expect(withGrant.trusted).toContain("gateway");
  });

  it("creates a bot only after the person approves", async () => {
    const { c } = await client("fenna");
    await expect(c.call("create_bot", { name: "", job: "x" })).rejects.toThrow(/Add "name:"/);
    const p = c.call("create_bot", { name: "Weekly Report", job: "Writes the Friday report", schedule: "fridays 17:00", askBefore: ["Sending it"] });
    await until(() => waits.list().length === 1);
    expect(waits.list()[0].details).toMatch(/Schedule: Fridays at 17:00/);
    waits.answer(waits.list()[0].id, { allowed: true });
    expect((await p).text).toMatch(/Created Weekly Report \(folder "weekly-report"\)/);
    expect(store.readBot("weekly-report").bot).toMatchObject({ schedule: "fridays 17:00", askBefore: ["Sending it"], brain: { cli: "claude" } });
  });

  it("ends what waits on the person when the run is stopped", async () => {
    const { c } = await client("inbox");
    const p = c.call("ask", { question: "Still there?", options: [], multi: false });
    await until(() => waits.list().length === 1);
    runner.stop("inbox");
    expect((await p).text).toBe("The run was stopped before the person answered.");
    expect(waits.list()).toEqual([]);
  });
});

describe("connectors on this computer", () => {
  it("keeps secret values encrypted on disk and away from the page, and keeps them when editing", async () => {
    const c = connectors.save(
      await connectors.prepare({ name: "notes", type: "command", command: "node", args: ["notes.mjs"], env: [{ key: "NOTES_DIR", value: "C:\\notes", secret: false }, { key: "NOTES_TOKEN", value: "s3cret-token", secret: true }] }),
    );
    const file = readFileSync(path.join(root, "connectors", "notes.json"), "utf8");
    expect(file).not.toContain("s3cret-token");
    expect(file).toContain("C:\\\\notes");
    expect((await connectors.spec(c)).env).toEqual({ NOTES_DIR: "C:\\notes", NOTES_TOKEN: "s3cret-token" });
    const view = connectors.view(c);
    expect(view.env).toEqual([
      { key: "NOTES_DIR", value: "C:\\notes", secret: false, set: true },
      { key: "NOTES_TOKEN", value: "", secret: true, set: true },
    ]);
    expect(JSON.stringify(view)).not.toContain("s3cret");
    const edited = await connectors.prepare({ name: "notes", type: "command", command: "node", args: ["notes.mjs", "--v2"], env: [{ key: "NOTES_TOKEN", value: "", secret: true, keep: true }] }, { replace: "notes" });
    expect((await connectors.spec(edited)).env).toEqual({ NOTES_TOKEN: "s3cret-token" });
    await expect(connectors.prepare({ name: "notes", type: "command", command: "node" })).rejects.toThrow(/already a connector named "notes"/);
    await expect(connectors.prepare({ name: "other", type: "command", command: "node" }, { replace: "notes" })).rejects.toThrow(/name can't be changed/);
    await expect(connectors.prepare({ name: "x", type: "url", url: "http://example.com" })).rejects.toThrow(/https:\/\//);
    const locked = createConnectorStore({ dir: path.join(root, "c2"), secrets: { ...fakeSecrets, available: async () => false, availableSync: () => false } });
    await expect(locked.prepare({ name: "x", type: "command", command: "node", env: [{ key: "T", value: "v", secret: true }] })).rejects.toThrow(/no secure storage/);
  });

  it("moves a connector written the older way out of bot.md, keeping its values secret and a grant in its place", async () => {
    const file = path.join(store.botDir("inbox"), "bot.md");
    const text = readFileSync(file, "utf8").replace("  - fenna-docs\n", "  - fenna-docs\n  - name: calendar\n    command: npx\n    args: [-y, \"@example/calendar-mcp\"]\n    env:\n      CAL_TOKEN: tok-123\n  - name: tracker\n    url: https://mcp.example.com/mcp\n");
    writeFileSync(file, text);
    connectors.save(await connectors.prepare({ name: "tracker", type: "url", url: "https://other.example.com/mcp" }));
    const r = store.readBot("inbox");
    expect(r.diagnostics).toEqual([]);
    expect(r.bot.connectors.filter((c: { type: string }) => c.type === "grant").map((c: { name: string }) => c.name)).toEqual(["calendar", "tracker-2"]);
    const after = readFileSync(file, "utf8");
    expect(after).not.toMatch(/command|tok-123|mcp\.example\.com/);
    expect(after).toMatch(/  - name: calendar\n    default: ask\n/);
    const cal = connectors.get("calendar");
    expect(cal).toMatchObject({ type: "command", command: "npx", args: ["-y", "@example/calendar-mcp"], origin: "bot inbox", status: "untested" });
    expect(cal.env[0].value).not.toBe("tok-123");
    expect((await connectors.spec(cal)).env).toEqual({ CAL_TOKEN: "tok-123" });
    expect(connectors.get("tracker-2")).toMatchObject({ url: "https://mcp.example.com/mcp" });
    expect(store.readBot("inbox").bot.connectors).toEqual(r.bot.connectors);
  });

  it("leaves an older bot.md alone and refuses to change it when its connectors can't be moved", () => {
    const file = path.join(store.botDir("inbox"), "bot.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("  - fenna-docs\n", "  - fenna-docs\n  - name: calendar\n    command: npx\n    env:\n      CAL_TOKEN: tok-123\n"));
    const before = readFileSync(file, "utf8");
    const locked = createConnectorStore({ dir: path.join(root, "c3"), secrets: { ...fakeSecrets, available: async () => false, availableSync: () => false } });
    const s2 = createStore(root, { migrate: (slug: string, legacy: object[]) => locked.migrate(slug, legacy) });
    const r = s2.readBot("inbox");
    expect(r.diagnostics[0].message).toMatch(/holds the connectors calendar the older way, and they couldn't be moved.*no secure storage/);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(() => s2.updateBot("inbox", { schedule: "manual" })).toThrow(/Fix that first, so they aren't lost/);
  });
});

describe("scheduler", () => {
  it("wakes a bot at its time, not before, and doesn't stack runs", () => {
    const sched = createScheduler({ store, runner, now: () => clock });
    expect(sched.tick()).toEqual([]); // first sight: counts from now
    expect(store.readState("inbox").lastScheduledAt).toBe(clock.toISOString());
    expect(sched.nextRun("inbox")).toBe(new Date(2026, 10, 18, 13, 0).toISOString());
    expect(sched.nextRun("fenna")).toBeNull();
    clock = new Date(2026, 10, 18, 12, 59);
    expect(sched.tick()).toEqual([]);
    clock = new Date(2026, 10, 18, 13, 0, 20);
    expect(sched.tick()).toEqual(["inbox"]);
    expect(started[0]!.o.prompt).toMatch(/Your schedule woke you/);
    clock = new Date(2026, 10, 19, 9, 0, 5);
    expect(sched.tick()).toEqual([]); // still running from 13:00: not stacked
    expect(store.readState("inbox").lastScheduledAt).toBe(clock.toISOString());
  });

  it("catches up a run missed by less than a day, and skips older ones", () => {
    const sched = createScheduler({ store, runner, now: () => clock });
    store.patchState("research", (s: { lastScheduledAt: string }) => (s.lastScheduledAt = new Date(2026, 10, 16, 10, 0).toISOString()));
    store.patchState("inbox", (s: { lastScheduledAt: string }) => (s.lastScheduledAt = new Date(2026, 10, 18, 8, 0).toISOString()));
    clock = new Date(2026, 10, 23, 11, 0); // Monday 11:00: research due at 10:00; inbox's 18 Nov 09:00 is days old
    expect(sched.tick()).toEqual(["research"]);
  });
});

describe("views", () => {
  it("says when a bot sleeps, in short local time", () => {
    const now = new Date(2026, 10, 18, 9, 30);
    expect(shortTime(new Date(2026, 10, 18, 17, 0), now)).toBe("17:00");
    expect(shortTime(new Date(2026, 10, 20, 17, 0), now)).toBe("Fri 17:00");
    expect(shortTime(new Date(2026, 10, 28, 17, 0), now)).toBe("28 Nov 17:00");
    const views = createViews({ store, runner, waits, scheduler: { nextRun: (s: string) => (s === "research" ? new Date(2026, 10, 23, 10, 0).toISOString() : null) }, browsers: { state: () => null }, settings: () => ({ openAtLogin: false, maxConcurrent: 2 }), now: () => now });
    const o = views.overview();
    expect(o.firstLaunch).toBe(true);
    const research = o.bots.find((b: { slug: string }) => b.slug === "research");
    expect(research).toMatchObject({ mood: "sleep", statusLine: "Asleep until Mon 10:00", scheduleLabel: "Mondays at 10:00" });
    expect(o.bots.find((b: { slug: string }) => b.slug === "fenna")).toMatchObject({ mood: "idle", statusLine: "Ready", scheduleLabel: "Only when asked" });
  });

  it("pages chat history oldest first", async () => {
    for (let i = 0; i < 3; i++) {
      clock = new Date(2026, 10, 18, 9, 30 + i);
      const r = runner.enqueue({ slug: "fenna", trigger: "person", text: `m${i}` });
      started[started.length - 1]!.emit({ type: "text", text: `r${i}` });
      started[started.length - 1]!.emit({ type: "done" });
      await r.done;
    }
    const views = createViews({ store, runner, waits, scheduler: { nextRun: () => null }, browsers: { state: () => null }, settings: () => ({}), now: () => clock });
    const page = views.history("fenna", { limit: 2 });
    expect(page.more).toBe(true);
    expect(page.runs.map((r: { events: RunEvent[] }) => (r.events[0] as { text: string }).text)).toEqual(["m1", "m2"]);
    const older = views.history("fenna", { before: page.runs[0].file, limit: 2 });
    expect(older).toMatchObject({ more: false });
    expect(older.runs).toHaveLength(1);
    expect(views.bot("fenna").runs[0]).toMatchObject({ trigger: "person", text: "m2", outcome: "done" });
  });
});

describe("store", () => {
  it("keeps every write whole and refuses bad names", () => {
    expect(store.slugs()).toEqual(["fenna", "inbox", "research"]);
    expect(() => store.botDir("../x")).toThrow(/not a bot folder name/);
    expect(() => store.createBot({ name: "x".repeat(41), job: "j" })).toThrow(/the most is 40/);
    expect(store.createBot({ name: "Research", job: "Another" })).toBe("research-2");
    expect(store.updateBot("inbox", { schedule: "Daily 7:00", brain: { effort: "high" } })).toMatchObject({ schedule: "daily 07:00", brain: { cli: "claude", effort: "high" } });
    expect(() => store.updateBot("inbox", { schedule: "sometimes" })).toThrow(/not a schedule/);
    store.appendRun("inbox", "2026-11-18T09-00-00.000Z.jsonl", { type: "text", at: "x", text: "hi" });
    expect(parseRunLog(readFileSync(path.join(store.botDir("inbox"), "runs", "2026-11-18T09-00-00.000Z.jsonl"), "utf8")).events).toHaveLength(1);
    expect(existsSync(path.join(store.botDir("inbox"), "state.json.tmp"))).toBe(false);
  });
});

describe("prompt", () => {
  it("tells a bot who it is, its rules, memory, library and the crew", () => {
    const p = buildPrompt({
      slug: "research",
      bot: store.readBot("research").bot,
      memory: "- 2026-11-16: one link",
      library: [{ path: "example-check", kind: "doc", title: "Example.com check" }],
      others: [{ slug: "inbox", name: "Inbox", job: "Sorts email" }],
      team: null,
      trigger: "welcome",
      text: "",
      from: null,
      now: new Date(2026, 10, 18, 9, 5),
    });
    expect(p).toMatch(/Your schedule: Mondays at 10:00\./);
    expect(p).toMatch(/Never type or read passwords/);
    expect(p).toMatch(/<memory>\n- 2026-11-16: one link\n<\/memory>/);
    expect(p).toMatch(/- example-check \(doc\): Example.com check/);
    expect(p).toMatch(/- inbox: Inbox, Sorts email/);
    expect(p).toMatch(/It is now Wednesday 2026-11-18 09:05/);
    expect(p).toMatch(/first time/);
    expect(p).toMatch(/Pin sites you use often and documents you make to your desktop with the desktop tool/);
  });
});

describe("desktop", () => {
  const ids = (slug: string) => store.readDesktop(slug).map((s: { id: string }) => s.id);
  const desk = (action: string, params: object = {}) => handle({ slug: "inbox" }, "desktop", { action, ...params });

  it("starts with the built-in windows and one Fenna app per Fenna app the bot has", () => {
    expect(store.readDesktop("inbox")).toEqual([
      { id: "browser", kind: "app", app: "browser", label: "Browser" },
      { id: "files", kind: "app", app: "files", label: "Files" },
      { id: "library", kind: "app", app: "library", label: "Documents" },
      { id: "terminal", kind: "app", app: "terminal", label: "Terminal" },
      { id: "activity", kind: "app", app: "activity", label: "Activity" },
      { id: "clock", kind: "app", app: "clock", label: "Clock" },
      { id: "connectors", kind: "app", app: "connectors", label: "Connectors" },
      { id: "trash", kind: "app", app: "trash", label: "Trash" },
      { id: "code", kind: "app", app: "code", label: "Code" },
      { id: "processes", kind: "app", app: "processes", label: "Processes" },
      { id: "console", kind: "app", app: "console", label: "Console" },
      { id: "fenna-docs", kind: "fenna", app: "fenna-docs", label: "Fenna Docs" },
      { id: "fenna-sheets", kind: "fenna", app: "fenna-sheets", label: "Fenna Sheets" },
      { id: "fenna-slides", kind: "fenna", app: "fenna-slides", label: "Fenna Slides" },
      { id: "fenna-whiteboard", kind: "fenna", app: "fenna-whiteboard", label: "Fenna Whiteboard" },
      { id: "fenna-design", kind: "fenna", app: "fenna-design", label: "Fenna Design" },
    ]);
    store.createBot({ name: "Quiet", job: "Waits", connectors: [] });
    expect(store.readDesktop("quiet")).toHaveLength(11);
  });

  it("gives the default desktop when desktop.json is broken or not a list", () => {
    writeFileSync(path.join(store.botDir("inbox"), "desktop.json"), "{ not json");
    expect(store.readDesktop("inbox")).toHaveLength(16);
    writeFileSync(path.join(store.botDir("inbox"), "desktop.json"), JSON.stringify([{ id: "x", kind: "web", url: "javascript:alert(1)", label: "X" }]));
    expect(store.readDesktop("inbox")).toHaveLength(16);
  });

  it("adds the built-ins that came later to a desktop saved before them, once", () => {
    const old = [
      { id: "browser", kind: "app", app: "browser", label: "Browser" },
      { id: "files", kind: "app", app: "files", label: "Files" },
    ];
    writeFileSync(path.join(store.botDir("inbox"), "desktop.json"), JSON.stringify(old));
    expect(ids("inbox")).toEqual(["browser", "files", "code", "processes", "console"]);
    store.writeDesktop("inbox", old);
    expect(ids("inbox")).toEqual(["browser", "files"]);
  });

  it("saves a desktop and reads it back in order, keeping only each shortcut's own fields", () => {
    const saved = store.writeDesktop("inbox", [
      { id: "pricing", kind: "web", url: "https://example.com/pricing", label: "  Pricing  ", extra: true },
      { id: "check", kind: "doc", path: "example-check", label: "Check" },
    ]);
    expect(saved).toEqual([
      { id: "pricing", kind: "web", url: "https://example.com/pricing", label: "Pricing" },
      { id: "check", kind: "doc", path: "example-check", label: "Check" },
    ]);
    expect(store.readDesktop("inbox")).toEqual(saved);
    expect(existsSync(path.join(store.botDir("inbox"), "desktop.json.tmp"))).toBe(false);
  });

  it("keeps a grid cell when it is a whole cell from 0 to 40, and drops any other position", () => {
    const saved = store.writeDesktop("inbox", [
      { id: "a", kind: "app", app: "files", label: "A", pos: { col: 2, row: 0 } },
      { id: "b", kind: "app", app: "files", label: "B", pos: { col: 41, row: 0 } },
      { id: "c", kind: "app", app: "files", label: "C", pos: { col: 1, row: -1 } },
      { id: "d", kind: "app", app: "files", label: "D", pos: { col: 1.5, row: 2 } },
      { id: "e", kind: "app", app: "files", label: "E", pos: { col: "3", row: 2 } },
      { id: "f", kind: "app", app: "files", label: "F", pos: "2,2" },
      { id: "g", kind: "app", app: "files", label: "G", pos: { col: 40, row: 40 } },
    ]);
    expect(saved.map((s) => [s.id, "pos" in s ? s.pos : undefined])).toEqual([
      ["a", { col: 2, row: 0 }],
      ["b", undefined],
      ["c", undefined],
      ["d", undefined],
      ["e", undefined],
      ["f", undefined],
      ["g", { col: 40, row: 40 }],
    ]);
    expect(store.readDesktop("inbox")).toEqual(saved);
  });

  it("refuses a bad address, a javascript: address and a bad document name, saying how to fix it", () => {
    expect(() => store.writeDesktop("inbox", [{ id: "a", kind: "web", url: "example.com", label: "A" }])).toThrow(/not a web address. Write it in full, like https:\/\/example.com/);
    expect(() => store.writeDesktop("inbox", [{ id: "a", kind: "web", url: "javascript:alert(1)", label: "A" }])).toThrow(/must open an http or https address, not javascript:/);
    expect(() => store.writeDesktop("inbox", [{ id: "a", kind: "doc", path: ".hidden", label: "A" }])).toThrow(/not a library file name/);
    expect(() => store.writeDesktop("inbox", [{ id: "a", kind: "doc", path: "../x", label: "A" }])).toThrow(/not a library file name/);
    expect(() => store.writeDesktop("inbox", [{ id: "a", kind: "app", app: "mail", label: "A" }])).toThrow(/Use one of: browser, files, library, terminal, activity, clock, connectors, trash, code, processes, console/);
    expect(() => store.writeDesktop("inbox", [{ id: "a", kind: "fenna", app: "fenna-mail", label: "A" }])).toThrow(/Use one of: fenna-docs, fenna-sheets, fenna-slides, fenna-whiteboard, fenna-design/);
    expect(() => store.writeDesktop("inbox", [{ id: "a", kind: "clock", label: "A" }])).toThrow(/Kinds are app, fenna, web, doc and userapp/);
  });

  it("refuses a label that is empty or longer than 40 characters, and ids that repeat or are not ids", () => {
    expect(() => store.writeDesktop("inbox", [{ id: "a", kind: "app", app: "files", label: "   " }])).toThrow(/needs a label/);
    expect(() => store.writeDesktop("inbox", [{ id: "a", kind: "app", app: "files", label: "x".repeat(41) }])).toThrow(/label is 41 characters; the most is 40/);
    expect(() =>
      store.writeDesktop("inbox", [
        { id: "a", kind: "app", app: "files", label: "A" },
        { id: "a", kind: "app", app: "browser", label: "B" },
      ]),
    ).toThrow(/Two shortcuts have the id "a"/);
    expect(() => store.writeDesktop("inbox", [{ id: "Bad Id", kind: "app", app: "files", label: "A" }])).toThrow(/Ids use lowercase letters, digits and dashes/);
  });

  it("refuses more than 48 shortcuts, and a bot that isn't there", () => {
    const many = Array.from({ length: 49 }, (_, i) => ({ id: `s${i}`, kind: "app", app: "files", label: `S${i}` }));
    expect(() => store.writeDesktop("inbox", many)).toThrow(/at most 48 shortcuts; this one has 49/);
    expect(store.writeDesktop("inbox", many.slice(0, 48))).toHaveLength(48);
    expect(() => store.writeDesktop("nobody", [])).toThrow(/There is no bot "nobody"/);
  });

  it("adds a shortcut with a new id from its label, and says what it added", async () => {
    expect((await desk("add", { kind: "web", url: "https://example.com/pricing", label: "Example pricing" })).text).toBe(
      'Added "Example pricing" as example-pricing.\n' +
        [
          "browser  app  Browser  browser",
          "files  app  Files  files",
          "library  app  Documents  library",
          "terminal  app  Terminal  terminal",
          "activity  app  Activity  activity",
          "clock  app  Clock  clock",
          "connectors  app  Connectors  connectors",
          "trash  app  Trash  trash",
          "code  app  Code  code",
          "processes  app  Processes  processes",
          "console  app  Console  console",
          "fenna-docs  fenna  Fenna Docs  fenna-docs",
          "fenna-sheets  fenna  Fenna Sheets  fenna-sheets",
          "fenna-slides  fenna  Fenna Slides  fenna-slides",
          "fenna-whiteboard  fenna  Fenna Whiteboard  fenna-whiteboard",
          "fenna-design  fenna  Fenna Design  fenna-design",
          "example-pricing  web  Example pricing  https://example.com/pricing",
        ].join("\n"),
    );
    expect(ids("inbox").at(-1)).toBe("example-pricing");
    await desk("add", { kind: "web", url: "https://example.com/pricing", label: "Example pricing" });
    expect(ids("inbox").at(-1)).toBe("example-pricing-2");
    await desk("add", { kind: "doc", path: "example-check", label: "Check" });
    await desk("add", { kind: "fenna", app: "fenna-sheets", label: "Prices" });
    expect(ids("inbox").slice(-2)).toEqual(["check", "prices"]);
    expect(desktopEvents.at(-1)).toMatchObject({ slug: "inbox", items: store.readDesktop("inbox") });
  });

  it("renames, moves and removes by id, and lists what is there", async () => {
    expect((await desk("list")).text.split("\n")[0]).toBe("16 shortcuts on the desktop.");
    expect((await desk("rename", { id: "files", label: "Documents" })).text).toMatch(/^Renamed files to "Documents"\./);
    expect(store.readDesktop("inbox")[1]).toMatchObject({ id: "files", label: "Documents" });
    expect((await desk("move", { id: "fenna-docs", to: 1 })).text).toMatch(/^Moved Fenna Docs to position 1\./);
    expect(ids("inbox").slice(0, 2)).toEqual(["fenna-docs", "browser"]);
    expect((await desk("remove", { id: "connectors" })).text).toMatch(/^Removed "Connectors" from the desktop\./);
    expect(ids("inbox")).not.toContain("connectors");
    expect(desktopEvents).toHaveLength(3);
  });

  it("says how to fix a shortcut id, a position, a label or an action it does not know", async () => {
    await expect(desk("remove", { id: "nope" })).rejects.toThrow(/^No shortcut with id nope\. Shortcuts: browser, files, library, terminal, activity, clock, connectors, trash, code, processes, console, fenna-docs, fenna-sheets, fenna-slides, fenna-whiteboard, fenna-design\.$/);
    await expect(desk("move", { id: "files", to: 17 })).rejects.toThrow(/Move to a position from 1 to 16; 1 is the first shortcut\./);
    await expect(desk("rename", { id: "files", label: "" })).rejects.toThrow(/needs a label/);
    await expect(desk("sort")).rejects.toThrow(/Use the action list, add, remove, rename or move, not "sort"\./);
    expect(desktopEvents).toHaveLength(0);
    expect(store.readDesktop("inbox")).toHaveLength(16);
  });
});

describe("registry, keys and labels", () => {
  it("turns registry entries into connectors to fill in, with secret fields, and says why not", () => {
    const npm = toEntry({ server: { name: "io.github.acme/calendar", description: "Cal", version: "1.2.0", packages: [{ registryType: "npm", identifier: "@acme/cal-mcp", version: "1.2.0", transport: { type: "stdio" }, environmentVariables: [{ name: "CAL_TOKEN", isRequired: true, isSecret: true }, { name: "OPTIONAL" }] }] } });
    expect(npm.connector).toEqual({ type: "command", name: "calendar", command: "npx", args: ["-y", "@acme/cal-mcp@1.2.0"], env: [{ key: "CAL_TOKEN", value: "", secret: true }], origin: "registry io.github.acme/calendar" });
    expect(npm.note).toMatch(/Fill in CAL_TOKEN/);
    const remote = toEntry({ server: { name: "com.example/browser", version: "1", remotes: [{ type: "streamable-http", url: "https://mcp.example.com/mcp" }] } });
    expect(remote.connector).toEqual({ type: "url", name: "browser-mcp", url: "https://mcp.example.com/mcp", headers: [], origin: "registry com.example/browser" });
    const header = toEntry({ server: { name: "x/y", remotes: [{ type: "streamable-http", url: "https://a.example/{tenant}/mcp", headers: [{ name: "Authorization", isRequired: true, isSecret: true }] }] } });
    expect(header.connector).toMatchObject({ type: "url", headers: [{ key: "Authorization", value: "", secret: true }] });
    expect(header.note).toBe("Fill in Authorization before it connects. Replace the {…} parts of its address.");
    expect(toEntry({ server: { name: "x/z", packages: [{ registryType: "nuget", identifier: "z" }] } }).connector).toBeNull();
  });

  it("reads key names the model writes, and maps the person's input", () => {
    expect(parseKey("Enter")).toMatchObject({ key: "Enter", keyCode: 13, text: "\r", modifiers: 0 });
    expect(parseKey("Control+A")).toMatchObject({ key: "a", code: "KeyA", modifiers: 2, text: undefined });
    expect(parseKey("Shift+Tab")).toMatchObject({ key: "Tab", modifiers: 8 });
    expect(parseKey("Hyper+A").error).toMatch(/not a modifier/);
    expect(parseKey("F13").error).toMatch(/Keys: Enter, Tab/);
    expect(toElectronInput({ type: "mouseDown", x: 5000, y: -3, button: "left", clickCount: 1 })).toEqual({ type: "mouseDown", x: 1280, y: 0, button: "left", clickCount: 1, modifiers: [] });
    // Input lands inside the view the person sees, whatever its size.
    expect(toElectronInput({ type: "mouseMove", x: 2000, y: 640 }, { width: 1404, height: 658 })).toEqual({ type: "mouseMove", x: 1404, y: 640, modifiers: [] });
    expect(toElectronInput({ type: "mouseWheel", x: 10, y: 10, deltaX: 0, deltaY: 120 })).toMatchObject({ deltaY: -120 });
    expect(toElectronInput({ type: "keyDown", key: "ArrowUp", modifiers: ["shift", "bogus"] })).toEqual({ type: "keyDown", keyCode: "Up", modifiers: ["shift"] });
    expect(toElectronInput({ type: "eval", code: "x" })).toBeNull();
  });

  it("labels tool calls in plain words", () => {
    expect(toolLabel("open", { url: "https://example.com/a" }, "browser")).toBe("Opened example.com");
    expect(toolLabel("new_document", { kind: "doc", title: "Check" }, "crew")).toBe("Made the doc “Check”");
    expect(toolLabel("write_tab", {}, "fenna")).toBe("Wrote a doc");
    expect(toolLabel("list_events", {}, "calendar")).toBe("calendar: list events");
    expect(toolLabel("notes__add_note", { text: "x" }, "gateway")).toBe("notes: add note");
    expect(toolLabel("mystery", {}, "crew")).toBeNull();
  });
});

describe("the bot's browser", () => {
  it("lays pages out at the person's view size, kept within limits", () => {
    expect(viewOf({ width: 1404.8, height: 658.4, scale: 1.25 })).toEqual({ width: 1405, height: 658, scale: 1.25 });
    expect(viewOf({ width: 100, height: 99999, scale: 9 })).toEqual({ width: 360, height: 2400, scale: 3 });
    expect(viewOf({ width: 800, height: 600 })).toEqual({ width: 800, height: 600, scale: null });
    expect(viewOf({ width: "wide", height: 600 })).toBeNull();
    expect(viewOf(null)).toBeNull();
  });

  it("opens only web addresses, and says how to write one", () => {
    expect(webAddress("en.wikipedia.org").url.href).toBe("https://en.wikipedia.org/");
    expect(webAddress("http://127.0.0.1:8080/x").url.href).toBe("http://127.0.0.1:8080/x");
    expect(webAddress("file:///C:/secret.txt").error).toMatch(/Only http and https/);
    expect(webAddress("http://").error).toMatch(/is not a web address. Write it like https:\/\/example.com/);
  });

  it("labels its tab steps in plain words", () => {
    expect(toolLabel("open", { url: "https://en.wikipedia.org", new_tab: true }, "browser")).toBe("Opened en.wikipedia.org in a new tab");
    expect(toolLabel("tabs", {}, "browser")).toBe("Looked at its tabs");
    expect(toolLabel("switch_tab", { tab: 2 }, "browser")).toBe("Switched to tab 2");
    expect(toolLabel("close_tab", {}, "browser")).toBe("Closed a tab");
  });

  it("creates and manages the isolated bot workspace folder", () => {
    const slug = store.createBot({ name: "Worker", job: "Does tasks", how: "Runs scripts", schedule: "manual", cli: "claude" });
    const ws = store.workspaceDir(slug);
    expect(existsSync(ws)).toBe(true);

    store.writeWorkspaceFile(slug, "notes.md", "# Hello World\nTesting bot workspace.");
    const files = store.workspaceFiles(slug);
    expect(files.some((f: { name: string }) => f.name === "notes.md")).toBe(true);

    const content = store.readWorkspaceFile(slug, "notes.md");
    expect(content).toContain("Hello World");
  });

  it("refuses workspace paths that leave the folder, sibling prefixes included", () => {
    const slug = store.createBot({ name: "Fence", job: "Stays inside", how: "", schedule: "manual", cli: "claude" });
    const outside = ["../workspace2/x.md", "../bot.md", "..", ""];
    for (const rel of outside) {
      expect(() => store.writeWorkspaceFile(slug, rel, "x")).toThrow(/outside the bot's workspace/);
      expect(() => store.readWorkspaceFile(slug, rel)).toThrow(/outside the bot's workspace/);
    }
    expect(existsSync(path.join(store.workspaceDir(slug), "..", "workspace2"))).toBe(false);
  });
});

describe("library previews", () => {
  it("reads a doc as plain text, summarizes sheets and decks, and stays inside the library", () => {
    const slug = store.createBot({ name: "Reader", job: "Reads", how: "", schedule: "manual", cli: "claude" });
    const lib = path.join(store.botDir(slug), "library");
    mkdirSync(path.join(lib, "memo", "tabs"), { recursive: true });
    writeFileSync(path.join(lib, "memo", "doc.json"), JSON.stringify({ title: "Memo", tabs: [{ id: "a", title: "Plan" }] }));
    writeFileSync(path.join(lib, "memo", "tabs", "a.html"), '<h1>Hi &amp; bye</h1><p>One <del>old</del><ins>new</ins></p><script>alert(1)</script>');
    const doc = store.libraryText(slug, "memo");
    expect(doc.text).toBe("Plan\n\nHi & bye\nOne new");
    expect(doc.summary).toBe("1 tab");

    mkdirSync(path.join(lib, "tally", "sheets"), { recursive: true });
    writeFileSync(path.join(lib, "tally", "sheet.json"), JSON.stringify({ title: "Tally", sheets: [{ id: "s", title: "Sales" }] }));
    writeFileSync(path.join(lib, "tally", "sheets", "s.json"), JSON.stringify({ cells: { A1: { v: 1 }, C4: { v: 2 } } }));
    expect(store.libraryText(slug, "tally")).toMatchObject({ text: "Sales: 4 rows, 3 columns", summary: "1 sheet" });

    mkdirSync(path.join(lib, "pitch"), { recursive: true });
    writeFileSync(path.join(lib, "pitch", "deck.json"), JSON.stringify({ title: "Pitch", slides: ["a", "b"] }));
    expect(store.libraryText(slug, "pitch").summary).toBe("2 slides");

    writeFileSync(path.join(lib, "memo", "tabs", "a.html"), "x".repeat(300 * 1024));
    const big = store.libraryText(slug, "memo");
    expect(big.text.length).toBeLessThanOrEqual(200 * 1024);
    expect(big.truncated).toBe(true);

    mkdirSync(path.join(lib, "wall", "artboards"), { recursive: true });
    writeFileSync(path.join(lib, "wall", "design.json"), JSON.stringify({ title: "Wall", order: ["a.html", "b.html", "../x.html"], boards: { "a.html": { title: "Poster" }, "b.html": { title: "Banner" } } }));
    writeFileSync(path.join(lib, "wall", "artboards", "a.html"), "<style>p{}</style><h1>Hello &amp; welcome</h1>");
    writeFileSync(path.join(lib, "wall", "artboards", "b.html"), "<p>Sale</p>");
    const wall = store.libraryText(slug, "wall");
    expect(wall.summary).toBe("Design, 2 artboards");
    expect(wall.text).toContain("Poster\n\nHello & welcome");
    expect(wall.text).toContain("Banner\n\nSale");
    expect(wall.text).not.toContain("p{}");

    mkdirSync(path.join(lib, "sketch"), { recursive: true });
    writeFileSync(path.join(lib, "sketch", "board.json"), JSON.stringify({ title: "Sketch" }));
    writeFileSync(path.join(lib, "sketch", "canvas.json"), JSON.stringify({ items: Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, kind: "sticky" })) }));
    expect(store.libraryText(slug, "sketch")).toEqual({ text: "", summary: "Whiteboard, 12 items", truncated: false });
    expect(store.library(slug).find((i: { path: string }) => i.path === "sketch")).toMatchObject({ kind: "board", title: "Sketch" });
    expect(store.library(slug).find((i: { path: string }) => i.path === "wall")).toMatchObject({ kind: "design", title: "Wall" });

    for (const id of ["..", "../bot.md", "memo/tabs", ".hidden", "missing"]) expect(() => store.libraryText(slug, id)).toThrow(/not a file in the library/);
  });
});

describe("notifications", () => {
  type Shown = { title: string; body: string; click(): void };
  function setup(opts: { enabled?: boolean; attended?: boolean } = {}) {
    const shown: Shown[] = [];
    const opened: string[] = [];
    const state = { enabled: opts.enabled ?? true, attended: opts.attended ?? false, supported: true };
    class FakeNotification {
      static isSupported = () => state.supported;
      handlers: Record<string, () => void> = {};
      constructor(private o: { title: string; body: string }) {}
      on(ev: string, fn: () => void) {
        this.handlers[ev] = fn;
      }
      show() {
        shown.push({ title: this.o.title, body: this.o.body, click: () => this.handlers.click?.() });
      }
    }
    const notifier = createNotifier({ Notification: FakeNotification, enabled: () => state.enabled, attended: () => state.attended, open: (slug: string) => opened.push(slug) });
    return { notifier, shown, opened, state };
  }
  const ask = { id: "a1", kind: "ask", slug: "research", botName: "Research", question: "Which sheet should I use?" };
  const approval = { id: "p1", kind: "approval", slug: "inbox", botName: "Inbox", action: "sending the email" };

  it("notifies once for a new wait while the window is out of sight, naming the bot and the question", () => {
    const { notifier, shown } = setup();
    expect(notifier.check([ask])).toBe(1);
    expect(shown).toEqual([expect.objectContaining({ title: "Research", body: "Which sheet should I use?" })]);
    notifier.check([ask]);
    notifier.check([ask]);
    expect(shown).toHaveLength(1);
  });

  it("says what an approval and a login offer need", () => {
    const { notifier, shown } = setup();
    notifier.check([approval], [{ id: "o1", slug: "inbox", botName: "Inbox", origin: "https://mail.example.com" }]);
    expect(shown.map((s) => s.body)).toEqual(["Approve: sending the email", "Save the login for mail.example.com?"]);
  });

  it("stays quiet while the window is focused, and does not tell later about what it saw then", () => {
    const { notifier, shown, state } = setup({ attended: true });
    notifier.check([ask]);
    state.attended = false;
    notifier.check([ask]);
    expect(shown).toHaveLength(0);
    notifier.check([ask, approval]);
    expect(shown).toHaveLength(1);
  });

  it("stays quiet with Notifications off, or where the system has none", () => {
    const off = setup({ enabled: false });
    off.notifier.check([ask]);
    expect(off.shown).toHaveLength(0);
    const none = setup();
    none.state.supported = false;
    none.notifier.check([ask]);
    expect(none.shown).toHaveLength(0);
  });

  it("announces a wait again only as a new one, after it was answered", () => {
    const { notifier, shown } = setup();
    notifier.check([ask]);
    notifier.check([]);
    notifier.check([{ ...ask, id: "a2" }]);
    expect(shown).toHaveLength(2);
  });

  it("opens the bot's chat when the notification is clicked", () => {
    const { notifier, shown, opened } = setup();
    notifier.check([approval]);
    shown[0]!.click();
    expect(opened).toEqual(["inbox"]);
  });

  it("keeps a long question to one short line", () => {
    const { notifier, shown } = setup();
    notifier.check([{ ...ask, question: `Which\n${"word ".repeat(100)}` }]);
    expect(shown[0]!.body.length).toBeLessThanOrEqual(140);
    expect(shown[0]!.body).not.toContain("\n");
  });
});

describe("settings", () => {
  it("accepts known settings of the right type and range", () => {
    expect(checkSettingsPatch({ notifications: false, openAtLogin: true, maxConcurrent: 4, defaultCli: "codex", defaultModel: "gpt-5", defaultEffort: "" })).toEqual({
      notifications: false,
      openAtLogin: true,
      maxConcurrent: 4,
      defaultCli: "codex",
      defaultModel: "gpt-5",
      defaultEffort: "",
    });
  });

  it("refuses a setting that does not exist, saying which ones do", () => {
    expect(() => checkSettingsPatch({ fontScale: "compact" })).toThrow(/no setting "fontScale".*notifications/);
    expect(() => checkSettingsPatch({ storagePath: "/x" })).toThrow(/no setting "storagePath"/);
    expect(() => checkSettingsPatch({ __proto__: null, toString: 1 })).toThrow(/no setting "toString"/);
  });

  it("refuses the wrong type or an out-of-range number", () => {
    expect(() => checkSettingsPatch({ notifications: "yes" })).toThrow(/on or off/);
    expect(() => checkSettingsPatch({ openAtLogin: 1 })).toThrow(/on or off/);
    for (const n of [0, 5, 2.5, "2", NaN, null]) expect(() => checkSettingsPatch({ maxConcurrent: n })).toThrow(/1 to 4/);
    expect(() => checkSettingsPatch({ defaultCli: "gemini" })).toThrow(/one of: claude/);
    expect(() => checkSettingsPatch({ defaultModel: 7 })).toThrow(/text/);
    expect(() => checkSettingsPatch({ defaultEffort: "x".repeat(101) })).toThrow(/at most 100/);
  });

  it("drops stored settings that are gone or no longer valid", () => {
    expect(readStored({ fontScale: "compact", minimizeToTray: true, theme: "dark", notifications: false, maxConcurrent: 9, defaultCli: "codex" })).toEqual({ notifications: false, defaultCli: "codex" });
    expect(readStored(null)).toEqual({});
  });
});

describe("faces", () => {
  it("gives a new bot a design no other bot has, and the least used color", () => {
    const seen = store.slugs().map((s: string) => store.readBot(s).bot);
    expect(new Set(seen.map((b: { avatar: string }) => b.avatar)).size).toBe(3);
    const slug = store.createBot({ name: "Scout", job: "Looks around" });
    const bot = store.readBot(slug).bot;
    expect(seen.map((b: { avatar: string }) => b.avatar)).not.toContain(bot.avatar);
    expect(readFileSync(path.join(store.botDir(slug), "bot.md"), "utf8")).toMatch(new RegExp(`avatar: ${bot.avatar}\ncolor: ${bot.color}\n`));
    const used = new Set(seen.map((b: { color: string }) => b.color));
    if (used.size < 10) expect(used.has(bot.color)).toBe(false);
  });

  it("keeps a chosen face, and uses a free design for every bot until they run out", () => {
    expect(store.readBot(store.createBot({ name: "Pick", job: "j", avatar: "crate", color: "plum" })).bot).toMatchObject({ avatar: "crate", color: "plum" });
    for (let i = 0; i < 12; i++) store.createBot({ name: `Bot ${i}`, job: "j" });
    const faces = store.slugs().map((s: string) => store.readBot(s).bot.avatar);
    expect(new Set(faces).size).toBe(16);
    expect(store.createBot({ name: "Seventeenth", job: "j" })).toBeTruthy();
  });

  it("the overview and the bot view carry the face", () => {
    store.updateBot("research", { avatar: "lantern", color: "ochre" });
    const views = createViews({ store, runner, waits, scheduler: { nextRun: () => null }, browsers: { state: () => null }, settings: () => ({}) });
    expect(views.overview().bots.find((b: { slug: string }) => b.slug === "research")).toMatchObject({ avatar: "lantern", color: "ochre" });
    expect(views.bot("research").bot).toMatchObject({ avatar: "lantern", color: "ochre" });
  });

  it("create_bot takes a face, or leaves it to Crew", async () => {
    const ctx = { slug: "fenna", runId: "x", team: null, chain: { count: { n: 0 }, stack: ["fenna"] } };
    const ask = async (extra: object) => {
      const p = handle(ctx, "create_bot", { name: "Maker", job: "Makes things", ...extra });
      await until(() => waits.list().length > 0);
      waits.answer(waits.list()[0].id, { allowed: true });
      return p;
    };
    await ask({ avatar: "Moth", color: "iris" });
    expect(store.readBot("maker").bot).toMatchObject({ avatar: "moth", color: "iris" });
    await ask({});
    const second = store.readBot("maker-2").bot;
    expect(second.avatar).not.toBe("moth");
  });
});

describe("group chat", () => {
  const { createTeamChat } = require("../src/main/team-chat.cjs");
  let chat: ReturnType<typeof createTeamChat>;
  beforeEach(() => {
    store.createTeam({ name: "Launch", lead: "fenna", members: ["research", "inbox"], purpose: "Ship it" });
    chat = createTeamChat({ store, runner, onChange: () => {} });
  });
  const reply = async (n: number, slugText: string) => {
    await until(() => started.length === n);
    started[n - 1]!.emit({ type: "text", text: slugText });
    started[n - 1]!.emit({ type: "done" });
  };
  const from = () => store.readThread("launch").map((m: { from: string }) => m.from);

  it("goes to the lead when nobody is mentioned", async () => {
    chat.send("launch", "Where are we?");
    await reply(1, "On track.");
    await until(() => from().length === 2);
    expect(started).toHaveLength(1);
    expect(from()).toEqual(["person", "fenna"]);
    expect(runEvents("fenna")[0]).toMatchObject({ type: "start", trigger: "person", team: "launch" });
  });

  it("goes to each mentioned member in turn, in order of mention, each reply under its own slug", async () => {
    chat.send("launch", "@INBOX then @research: status please");
    await reply(1, "Inbox here.");
    await reply(2, "Research here.");
    await until(() => from().length === 3);
    expect(from()).toEqual(["person", "inbox", "research"]);
    expect(started[0]!.o.prompt).toMatch(/status please/);
    expect(started).toHaveLength(2);
  });

  it("@all goes to the lead and every member, one after another", async () => {
    chat.send("launch", "@all stand up");
    await reply(1, "a");
    expect(started).toHaveLength(1);
    await reply(2, "b");
    await reply(3, "c");
    await until(() => from().length === 4);
    expect(from()).toEqual(["person", "fenna", "research", "inbox"]);
  });

  it("refuses a team that does not exist", () => {
    expect(() => chat.send("nope", "hi")).toThrow(/no team/);
  });
});

describe("downloads from the bot's browser", () => {
  it("keeps only the last part of the name the page gave, with no reserved or control characters", () => {
    expect(safeDownloadName("../../etc/passwd")).toBe("passwd");
    expect(safeDownloadName("C:\\Users\\x\\report.pdf")).toBe("report.pdf");
    expect(safeDownloadName("a\u0000b\u001fc.txt")).toBe("a_b_c.txt");
    expect(safeDownloadName("what?*<a>|.csv")).toBe("what___a__.csv");
    expect(safeDownloadName("..hidden.txt")).toBe("hidden.txt");
    expect(safeDownloadName("name. ")).toBe("name");
    expect(safeDownloadName("")).toBe("download");
    expect(safeDownloadName("..")).toBe("download");
  });

  it("gives a free name as it is, then adds (2), (3) on clashes and keeps the extension", () => {
    expect(uniqueName("report.pdf", () => false)).toBe("report.pdf");
    const taken = new Set(["report.pdf", "report (2).pdf"]);
    expect(uniqueName("report.pdf", (n) => taken.has(n))).toBe("report (3).pdf");
    expect(uniqueName("archive", (n) => n === "archive")).toBe("archive (2)");
    expect(uniqueName(".bashrc", (n) => n === "bashrc")).toBe("bashrc (2)");
    expect(uniqueName("..\\data.tar.gz", (n) => n === "data.tar.gz")).toBe("data.tar (2).gz");
  });

  it("keeps every name within 120 characters, the suffix included", () => {
    const long = `${"a".repeat(300)}.pdf`;
    const first = uniqueName(long, () => false);
    expect(first.length).toBe(120);
    expect(first.endsWith(".pdf")).toBe(true);
    const taken = new Set([first]);
    const second = uniqueName(long, (n) => taken.has(n));
    expect(second.length).toBeLessThanOrEqual(120);
    expect(second).toMatch(/ \(2\)\.pdf$/);
    expect(second.endsWith(".pdf")).toBe(true);
    expect(uniqueName("x".repeat(500), () => false).length).toBe(120);
  });

  it("refuses a download over its room: a known total over it, or more received than it", () => {
    const mb = 1024 * 1024;
    expect(overCap(0, 500 * mb, 500 * mb)).toBe(false);
    expect(overCap(0, 500 * mb + 1, 500 * mb)).toBe(true);
    expect(overCap(100 * mb, 0, 500 * mb)).toBe(false);
    expect(overCap(500 * mb + 1, 0, 500 * mb)).toBe(true);
    expect(overCap(10, 0, 5)).toBe(true);
    expect(overCap(5, 0, 5)).toBe(false);
    expect(overCap(0, 0, 0)).toBe(false);
  });

  it("gives a download the bot's free space, or the PC's drive less 1 GB, whichever is less", () => {
    const gb = 1024 ** 3;
    expect(KEEP_FREE).toBe(gb);
    expect(downloadRoom(2 * gb, 100 * gb)).toEqual({ bytes: 2 * gb, drive: false });
    expect(downloadRoom(50 * gb, 3 * gb)).toEqual({ bytes: 2 * gb, drive: true });
    expect(downloadRoom(50 * gb, 0.5 * gb)).toEqual({ bytes: 0, drive: true });
    expect(downloadRoom(0, 100 * gb)).toEqual({ bytes: 0, drive: false });
    expect(downloadRoom(Infinity, Infinity)).toEqual({ bytes: Infinity, drive: false });
  });

  it("says the size, the free space and what the person can do when a download is too big", () => {
    const gb = 1024 ** 3;
    const mb = 1024 * 1024;
    expect(tooBigText(1.5 * gb, 300 * mb, true, false)).toBe(
      "it is 1.5 GB, and 300.0 MB is free on the bot's disk. Ask the person to make this bot's disk larger in its Details (Disk size).",
    );
    expect(tooBigText(600 * mb, 10 * mb, false, false)).toBe(
      "it is more than 600.0 MB, and 10.0 MB is free on the bot's disk. Ask the person to make this bot's disk larger in its Details (Disk size).",
    );
    expect(tooBigText(3 * gb, 2 * gb, true, true)).toBe(
      "it is 3.0 GB, and only 2.0 GB can be saved here: the PC keeps 1 GB free. Ask the person to free up space on this computer.",
    );
  });

  it("says a size in words", () => {
    expect(sizeText(512)).toBe("512 B");
    expect(sizeText(12 * 1024)).toBe("12 KB");
    expect(sizeText(3.4 * 1024 * 1024)).toBe("3.4 MB");
    expect(sizeText(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });
});

describe("chat export and duplicate", () => {
  const { chatMarkdown, chatFileName, copyName } = require("../src/main/store.cjs");

  it("writes the transcript as Markdown: a heading per run, You, the bot, and steps", () => {
    const md = chatMarkdown("Research", [
      {
        file: "a.jsonl",
        events: [
          { type: "start", at: "2026-03-02T09:05:00.000Z", runId: "r1", trigger: "person", text: "Check the news", from: "", team: "", cli: "claude", model: "" },
          { type: "tool", at: "2026-03-02T09:05:01.000Z", id: "t1", server: "browser", tool: "open", label: "Opened example.com", status: "running" },
          { type: "tool", at: "2026-03-02T09:05:02.000Z", id: "t1", server: "browser", tool: "open", label: "Opened example.com", status: "done" },
          { type: "tool", at: "2026-03-02T09:05:03.000Z", id: "t2", server: "browser", tool: "click", label: "Click Send", status: "failed" },
          { type: "text", at: "2026-03-02T09:05:04.000Z", text: "Two stories matter." },
          { type: "end", at: "2026-03-02T09:05:05.000Z", outcome: "done" },
        ],
      },
      { file: "b.jsonl", events: [{ type: "start", at: "2026-03-03T09:00:00.000Z", runId: "r2", trigger: "schedule", text: "", from: "", team: "", cli: "claude", model: "" }, { type: "text", at: "2026-03-03T09:00:01.000Z", text: "Nothing new." }] },
    ]);
    expect(md.startsWith("# Research chat\n")).toBe(true);
    expect(md).toMatch(/## 2026-03-0\d \d\d:\d\d · You asked\n\n\*\*You:\*\* Check the news\n\n- Opened example\.com\n- Click Send \(failed\)\n\n\*\*Research:\*\* Two stories matter\.\n/);
    expect(md.match(/Opened example\.com/g)).toHaveLength(1);
    expect(md).toMatch(/· Schedule\n\n\*\*Research:\*\* Nothing new\.\n$/);
  });

  it("says so when nothing was said", () => {
    expect(chatMarkdown("Fenna", [])).toBe("# Fenna chat\n\nNothing said yet.\n");
  });

  it("names the file after the bot, without characters a file name can't hold", () => {
    expect(chatFileName("Research")).toBe("Research chat.md");
    expect(chatFileName('a/b:c*"d?')).toBe("abcd chat.md");
    expect(chatFileName("///")).toBe("Bot chat.md");
  });

  it("names a copy and numbers it while the name is taken, within the name limit", () => {
    expect(copyName("Research", ["Research"])).toBe("Research copy");
    expect(copyName("Research", ["Research", "research copy"])).toBe("Research copy 2");
    const long = copyName("x".repeat(40), []);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith(" copy")).toBe(true);
  });

  it("duplicates settings and memory with a new face, and leaves runs, library and state behind", () => {
    const slug = store.createBot({ name: "Research", job: "Reads the news", how: "Read, then summarize.", schedule: "weekdays 09:00", askBefore: ["sending email"] });
    store.appendMemory(slug, "Likes short answers");
    store.appendRun(slug, "2026-03-02T09-05-00.000Z.jsonl", { type: "start", at: "2026-03-02T09:05:00.000Z", runId: "r", trigger: "person", text: "hi", from: "", team: "", cli: "claude", model: "" });
    store.patchState(slug, (s: { chats: { id: string; sessions: Record<string, string> }[]; current: string }) => {
      s.chats.find((c) => c.id === s.current)!.sessions = { claude: "abc" };
    });
    const copy = store.duplicateBot(slug);
    expect(copy).not.toBe(slug);
    const a = store.readBot(slug).bot;
    const b = store.readBot(copy).bot;
    expect(b.name).toBe("Research copy");
    expect({ ...b, name: "", avatar: "", color: "" }).toEqual({ ...a, name: "", avatar: "", color: "" });
    expect(b.avatar).not.toBe(a.avatar);
    expect(store.readMemory(copy)).toBe(store.readMemory(slug));
    expect(store.runFiles(copy)).toEqual([]);
    expect(store.library(copy)).toEqual([]);
    expect(store.readState(copy).chats.every((c: { sessions: object }) => !Object.keys(c.sessions).length)).toBe(true);
    expect(store.readBot(store.duplicateBot(slug)).bot.name).toBe("Research copy 2");
  });

  it("refuses to duplicate a bot that isn't there", () => {
    expect(() => store.duplicateBot("nobody")).toThrow(/no bot/i);
  });
});

describe("site icons", () => {
  const { createSiteIcons, isAllowedOrigin, originOf, pickIconHref } = require("../src/main/siteicons.cjs");
  const DAY = 24 * 60 * 60 * 1000;
  const publicHost = async () => [{ address: "93.184.216.34", family: 4 }];
  const reply = (body: string | Buffer, type: string) => new Response(body, { status: 200, headers: { "content-type": type } });
  const fakeSite = (files: Record<string, () => Response>) => {
    const calls: { url: string; init: { credentials: string; redirect: string } }[] = [];
    const fetch = async (url: string, init: { credentials: string; redirect: string }) => {
      calls.push({ url, init });
      return files[url] ? files[url]() : new Response(null, { status: 404 });
    };
    return { fetch, calls };
  };
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "crew-icons-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("picks the icon the page declares on the site, and refuses other hosts", () => {
    const origin = "https://www.example.com";
    expect(pickIconHref(`<link rel="shortcut icon" href="/a.ico"><link rel="icon" href="/logo.png?v=1&amp;x=2">`, origin)).toBe("https://www.example.com/a.ico");
    expect(pickIconHref(`<link rel="apple-touch-icon" href="/t.png"><link rel="icon" href="/logo.png?v=1&amp;x=2">`, origin)).toBe("https://www.example.com/logo.png?v=1&x=2");
    expect(pickIconHref(`<link rel="apple-touch-icon" href="https://cdn.www.example.com/t.png">`, origin)).toBe("https://cdn.www.example.com/t.png");
    expect(pickIconHref(`<link rel="apple-touch-icon" href="https://m.example.com/t.png">`, origin)).toBeNull();
    expect(pickIconHref(`<link rel="icon" href="https://evil.test/x.png">`, origin)).toBeNull();
    expect(pickIconHref(`<link rel="icon" href="data:image/png;base64,AAAA">`, origin)).toBeNull();
    expect(pickIconHref(`<link rel="stylesheet" href="/a.css">`, origin)).toBeNull();
    expect(pickIconHref(`<LINK REL='Icon' HREF=/up.png>`, origin)).toBe("https://www.example.com/up.png");
    expect(pickIconHref("<p>no icon</p>", origin)).toBeNull();
  });

  it("allows public https and localhost, and refuses private addresses, credentials and other schemes", () => {
    for (const good of ["https://www.youtube.com", "http://localhost:3000", "http://127.0.0.1:8080", "https://8.8.8.8", "http://[::1]:5000"]) {
      expect(isAllowedOrigin(good)).toBe(true);
    }
    for (const bad of ["ftp://a.example.com", "file:///etc/passwd", "https://user:pw@a.example.com", "http://10.0.0.5", "http://192.168.1.1", "http://172.20.1.1", "http://169.254.169.254", "http://[fd00::1]", "http://intranet", "not a url"]) {
      expect(isAllowedOrigin(bad)).toBe(false);
    }
    expect(originOf("https://www.youtube.com/")).toBe("https://www.youtube.com");
    expect(originOf("https://www.youtube.com/watch?v=1")).toBeNull();
  });

  it("reads the icon once, sends no cookies, and keeps it on disk for a week", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const site = fakeSite({
      "https://www.example.com/": () => reply("<html><link rel='icon' href='/logo.png'></html>", "text/html; charset=utf-8"),
      "https://www.example.com/logo.png": () => reply(png, "image/png"),
    });
    let now = 1_000_000;
    const src = await createSiteIcons({ dir, fetch: site.fetch, lookup: publicHost, now: () => now }).get("https://www.example.com");
    expect(src).toBe(`data:image/png;base64,${png.toString("base64")}`);
    expect(site.calls.every((c) => c.init.credentials === "omit" && c.init.redirect === "manual")).toBe(true);
    expect(await createSiteIcons({ dir, fetch: site.fetch, lookup: publicHost, now: () => now }).get("https://www.example.com")).toBe(src);
    expect(site.calls.length).toBe(2);
    now += 8 * DAY;
    expect(await createSiteIcons({ dir, fetch: site.fetch, lookup: publicHost, now: () => now }).get("https://www.example.com")).toBe(src);
    expect(site.calls.length).toBe(4);
  });

  it("falls back to /favicon.ico, refuses off-site, oversize and non-image replies, and caches the miss", async () => {
    const site = fakeSite({
      "https://a.example.com/": () => reply("<link rel='icon' href='https://other.test/x.png'>", "text/html"),
      "https://a.example.com/favicon.ico": () => reply(Buffer.alloc(101 * 1024), "image/x-icon"),
      "https://b.example.com/favicon.ico": () => reply("<html>", "text/html"),
    });
    const icons = () => createSiteIcons({ dir, fetch: site.fetch, lookup: publicHost });
    expect(await icons().get("https://a.example.com")).toBeNull();
    expect(await icons().get("https://b.example.com")).toBeNull();
    expect(site.calls.some((c) => c.url.includes("other.test"))).toBe(false);
    const calls = site.calls.length;
    expect(await icons().get("https://a.example.com")).toBeNull();
    expect(site.calls.length).toBe(calls);
  });

  it("refuses redirects off the site and hosts that resolve to private addresses", async () => {
    const site = fakeSite({
      "https://c.example.com/favicon.ico": () => new Response(null, { status: 302, headers: { location: "https://evil.test/x.ico" } }),
    });
    const lookup = async (host: string) => (host === "rebind.example.com" ? [{ address: "10.0.0.7", family: 4 }] : publicHost());
    const icons = createSiteIcons({ dir, fetch: site.fetch, lookup });
    expect(await icons.get("https://c.example.com")).toBeNull();
    expect(await icons.get("https://rebind.example.com")).toBeNull();
    expect(site.calls.map((c) => c.url)).toEqual(["https://c.example.com/", "https://c.example.com/favicon.ico"]);
  });

  it("fetches at most four sites at once", async () => {
    let active = 0;
    let peak = 0;
    const fetch = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return new Response(null, { status: 404 });
    };
    const icons = createSiteIcons({ dir, fetch, lookup: publicHost });
    await Promise.all(["a", "b", "c", "d", "e", "f"].map((s) => icons.get(`https://${s}.example.com`)));
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });
});
