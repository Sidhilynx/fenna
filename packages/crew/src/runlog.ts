// runs/<iso>.jsonl: every event of one run, one JSON object per line, in
// order. A run is one turn of a bot: woken by its schedule, a message from
// the person, a hand-off from another bot, or a watch that fired. The app
// appends as events happen, so a crash leaves at most a cut-off last line,
// which reading skips.
//
// teams/<slug>/thread.jsonl: the team's conversation, one message per line.

import type { CliKind, Mood } from "./schema.ts";

/** app: an app on the bot's computer sent the bot a message (crew.bot.tell). compact: the app asked the bot to sum up its chat before the chat starts a fresh conversation. */
export const RUN_TRIGGERS = ["person", "schedule", "bot", "welcome", "watch", "compact", "app"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];
export type ToolStatus = "running" | "done" | "failed";
export type AnsweredBy = "person" | "timeout" | "stopped";
/** Who asked for an approval: the bot itself (request_approval), a connector tool on "ask", a vault login on "ask", a bot's first command in a project, or (older logs) the CLI. */
export type ApprovalSource = "bot" | "connector" | "login" | "project" | "cli";
/** How a call to a connector's tool through the gateway ended. */
export type ConnectorOutcome = "done" | "failed" | "denied" | "timeout" | "stopped";
/** How a use of a vault login ended: filled, refused by Crew (wrong site, not granted, nothing to fill), denied by the person, or no answer. */
export type LoginOutcome = "done" | "refused" | "failed" | "denied" | "timeout" | "stopped";

/** One file a hand-off copied: its name, its size, and where it came from and went (disk paths on each bot's disk). */
export interface HandoffFile {
  name: string;
  size: number;
  fromPath: string;
  toPath: string;
}

/** A file the person attached to a message: saved at `path` (a disk path, e.g. Files/Inbox/q3.xlsx). */
export interface RunAttachment {
  path: string;
  name: string;
  kind: string;
  size: number;
}

export type RunEvent =
  | { type: "start"; at: string; runId: string; trigger: RunTrigger; text: string; from: string | null; team: string | null; cli: CliKind; model: string; chat?: string; attachments?: RunAttachment[] }
  | { type: "text"; at: string; text: string }
  | { type: "tool"; at: string; id: string; server: string; tool: string; label: string; status: ToolStatus; doc?: string | null; error?: string }
  | { type: "ask"; at: string; askId: string; question: string; options: string[]; multi: boolean }
  | { type: "answer"; at: string; askId: string; answer: string[]; by: AnsweredBy }
  | { type: "approval"; at: string; approvalId: string; action: string; details: string; source: ApprovalSource; tool: string | null }
  | { type: "decision"; at: string; approvalId: string; allowed: boolean; always: boolean; by: AnsweredBy }
  | { type: "status"; at: string; status: string; mood: Mood }
  | { type: "handoff"; at: string; to: string; text: string }
  | { type: "handback"; at: string; from: string; text: string }
  | { type: "files"; at: string; from: string; to: string; files: HandoffFile[] }
  | { type: "connector"; at: string; bot: string; connector: string; tool: string; level: "allow" | "ask"; outcome: ConnectorOutcome; ms: number; message: string | null }
  | { type: "login"; at: string; bot: string; login: string; label: string; origin: string; action: "sign_in" | "fill_code"; level: "allow" | "ask" | null; outcome: LoginOutcome; message: string | null }
  | { type: "app_tool"; at: string; app: string; tool: string; ok: boolean; ms: number }
  | { type: "command"; at: string; project: string; command: string; exitCode: number | null; ms: number; background: boolean; port?: number }
  | { type: "usage"; at: string; used: number; window: number | null }
  /** What the CLI reported for the whole turn (optional: Antigravity reports none). input counts cached input too; costUsd is the API-equivalent estimate the CLI gives, null when it gives none. */
  | { type: "tokens"; at: string; input: number; output: number; costUsd: number | null }
  | { type: "end"; at: string; outcome: "done" | "error" | "stopped"; message: string | null };

export const RUN_EVENT_TYPES = ["start", "text", "tool", "ask", "answer", "approval", "decision", "status", "handoff", "handback", "files", "connector", "login", "app_tool", "command", "usage", "tokens", "end"] as const;

/** A run's file name from its start time: colons are not allowed in Windows file names. */
export function runFileName(start: Date): string {
  return `${start.toISOString().replace(/:/g, "-")}.jsonl`;
}

/** The start time a run file name holds, or null if it isn't one. */
export function runFileDate(name: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2}(?:\.\d{3})?Z)\.jsonl$/.exec(name);
  if (!m) return null;
  const d = new Date(`${m[1]}:${m[2]}:${m[3]}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function runLine(ev: RunEvent): string {
  return JSON.stringify(ev) + "\n";
}

/** Read a run file. Lines that are cut off or not events are skipped and counted. */
export function parseRunLog(src: string): { events: RunEvent[]; skipped: number } {
  const events: RunEvent[] = [];
  let skipped = 0;
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as { type?: unknown; at?: unknown };
      if (v && typeof v === "object" && (RUN_EVENT_TYPES as readonly unknown[]).includes(v.type) && typeof v.at === "string") {
        const ev = v as RunEvent;
        // A tool event's doc is a library folder name, or null when a library call named none.
        if (ev.type === "tool" && "doc" in ev && ev.doc !== null && typeof ev.doc !== "string") delete ev.doc;
        events.push(ev);
      } else skipped++;
    } catch {
      skipped++;
    }
  }
  return { events, skipped };
}

export interface ThreadMessage {
  at: string;
  /** "person", or the slug of the bot that wrote it. */
  from: string;
  text: string;
}

export function parseThread(src: string): ThreadMessage[] {
  const out: ThreadMessage[] = [];
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as Partial<ThreadMessage>;
      if (typeof v.at === "string" && typeof v.from === "string" && typeof v.text === "string") out.push({ at: v.at, from: v.from, text: v.text });
    } catch {
      /* a cut-off last line */
    }
  }
  return out;
}
