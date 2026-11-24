// A bot's conversation: its runs' events in order, loaded from the run
// logs and kept live, turned into the items the chat draws.

import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, invoke, on } from "../shared/api.ts";
import type { ApprovalSource, ChatSummary, HistoryPage, LiveEvent, RunEvent } from "../shared/contract.ts";
import { chatOfRun, RUNS_CHAT, type RunAttachment } from "@opendeck/crew";
import { wakeLine } from "./text.ts";

export interface RunLog {
  key: string;
  runId: string;
  events: RunEvent[];
}

export interface Step {
  id: string;
  label: string;
  status: "running" | "done" | "failed";
}

export type Item =
  | { kind: "you"; key: string; text: string; at: string; attachments: RunAttachment[] }
  | { kind: "note"; key: string; text: string }
  | { kind: "bot"; key: string; runId: string; text: string; at: string }
  | { kind: "steps"; key: string; steps: Step[] }
  | { kind: "ask"; key: string; askId: string; question: string; options: string[]; multi: boolean; answer: { by: string; answer: string[] } | null }
  | { kind: "approval"; key: string; approvalId: string; action: string; details: string; source: ApprovalSource; tool: string | null; decision: { by: string; allowed: boolean; always: boolean } | null }
  | { kind: "end"; key: string; outcome: "error" | "stopped"; message: string };

/** A use of a vault login in plain words: what Crew filled, or why it didn't. */
export function loginLine(e: Extract<RunEvent, { type: "login" }>): string {
  const what = e.label || e.login;
  const site = e.origin.replace(/^https?:\/\//, "");
  const step = e.action === "fill_code" ? "a sign-in code" : "the login";
  if (e.outcome === "done") return `Crew filled ${step} ${what}${site ? ` on ${site}` : ""}`;
  if (e.outcome === "refused") return `Crew refused ${step} ${what}${e.message ? `: ${e.message}` : ""}`;
  if (e.outcome === "denied") return `You denied ${step} ${what}`;
  if (e.outcome === "timeout") return `No answer for ${step} ${what}`;
  if (e.outcome === "stopped") return `Stopped before ${step} ${what}`;
  return `Crew couldn't fill ${step} ${what}`;
}

/** A call of one of the bot's apps, in plain words. */
export function appToolLine(e: Extract<RunEvent, { type: "app_tool" }>): string {
  return `App ${e.app}: ${e.tool}${e.ok ? "" : " (failed)"}`;
}

/** A command run in a project: started for a background process, ran (with its exit code) for a foreground one. */
export function commandLine(e: Extract<RunEvent, { type: "command" }>): string {
  if (e.background) return `Started ${e.command} in ${e.project}${e.port ? `, on port ${e.port}` : ""}`;
  return `Ran ${e.command} in ${e.project}${e.exitCode === 0 ? "" : ` (exit ${e.exitCode ?? "?"})`}`;
}

/** A chat's name in the list: the person's first words, or what kind of chat it is. */
export function chatName(c: ChatSummary): string {
  if (c.id === RUNS_CHAT) return "Runs";
  if (c.title) return c.title;
  return c.startedAt ? "New chat" : "Earlier chat";
}

const same = (a: RunEvent, b: RunEvent) => a.type === b.type && a.at === b.at && JSON.stringify(a) === JSON.stringify(b);

function logOf(r: HistoryPage["runs"][number]): RunLog {
  const start = r.events.find((e) => e.type === "start");
  return { key: r.file, runId: start && start.type === "start" ? start.runId : r.file, events: r.events };
}

/** The events of every run as the chat shows them. `names` turns a bot slug into its name for hand-offs. */
export function buildItems(runs: RunLog[], names: (slug: string) => string): Item[] {
  const out: Item[] = [];
  const steps = new Map<string, Step>();
  for (const run of runs) {
    const answers = new Map<string, { by: string; answer: string[] }>();
    const decisions = new Map<string, { by: string; allowed: boolean; always: boolean }>();
    for (const e of run.events) {
      if (e.type === "answer") answers.set(e.askId, { by: e.by, answer: e.answer });
      if (e.type === "decision") decisions.set(e.approvalId, { by: e.by, allowed: e.allowed, always: e.always });
    }
    let group: Extract<Item, { kind: "steps" }> | null = null;
    // A compact run is one line; its summary stays with the app, not in the chat.
    const compact = run.events.some((e) => e.type === "start" && e.trigger === "compact");
    if (compact) {
      const end = run.events.find((e) => e.type === "end");
      out.push({ kind: "note", key: `${run.key}:compact`, text: !end ? "Compacting this chat" : end.outcome === "done" ? "Compacted. It continues from a summary." : "Compacting failed. The chat continues as it was." });
      continue;
    }
    run.events.forEach((e, i) => {
      const key = `${run.key}:${i}`;
      if (e.type !== "tool") group = null;
      switch (e.type) {
        case "start":
          if (e.trigger === "person" && (e.text || e.attachments?.length)) out.push({ kind: "you", key, text: e.text, at: e.at, attachments: e.attachments ?? [] });
          else if (e.trigger === "schedule") out.push({ kind: "note", key, text: "Woke up on its schedule" });
          else if (e.trigger === "bot") out.push({ kind: "note", key, text: `${e.from ? names(e.from) : "Another bot"} asked: ${e.text}` });
          else if (e.trigger === "watch") out.push({ kind: "note", key, text: wakeLine(e.text) });
          else if (e.trigger === "app") out.push({ kind: "note", key, text: `An app sent: ${e.text}` });
          break;
        case "text":
          if (e.text.trim()) out.push({ kind: "bot", key, runId: run.runId, text: e.text.trim(), at: e.at });
          break;
        case "tool": {
          const id = `${run.key}:${e.id}`;
          const seen = steps.get(id);
          if (seen) {
            seen.label = e.label;
            seen.status = e.status;
            break;
          }
          if (!group) {
            group = { kind: "steps", key, steps: [] };
            out.push(group);
          }
          const step: Step = { id: e.id, label: e.label, status: e.status };
          steps.set(id, step);
          group.steps.push(step);
          break;
        }
        case "ask":
          out.push({ kind: "ask", key, askId: e.askId, question: e.question, options: e.options, multi: e.multi, answer: answers.get(e.askId) ?? null });
          break;
        case "approval":
          out.push({ kind: "approval", key, approvalId: e.approvalId, action: e.action, details: e.details, source: e.source, tool: e.tool, decision: decisions.get(e.approvalId) ?? null });
          break;
        case "handoff":
          out.push({ kind: "note", key, text: `Handed to ${names(e.to)}: ${e.text}` });
          break;
        case "handback":
          out.push({ kind: "note", key, text: `${names(e.from)} replied: ${e.text}` });
          break;
        case "login":
          // A fill shows as its step line; a refusal or denial is said once, quietly.
          if (e.outcome !== "done") out.push({ kind: "note", key, text: loginLine(e) });
          break;
        case "app_tool":
          out.push({ kind: "steps", key, steps: [{ id: key, label: appToolLine(e), status: e.ok ? "done" : "failed" }] });
          break;
        case "command":
          out.push({ kind: "steps", key, steps: [{ id: key, label: commandLine(e), status: e.exitCode === 0 || e.background ? "done" : "failed" }] });
          break;
        case "end":
          if (e.outcome !== "done") out.push({ kind: "end", key, outcome: e.outcome, message: e.message ?? "" });
          break;
        default:
          break;
      }
    });
  }
  return out;
}

const PAGE = 6;

/** A bot's runs in one chat (by default the person's current chat): the last few from disk, then every event as it happens. */
export function useRuns(slug: string, chat?: string, limit = PAGE) {
  const [runs, setRuns] = useState<RunLog[]>([]);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [delta, setDelta] = useState<{ runId: string; text: string } | null>(null);
  const [error, setError] = useState("");
  const slugRef = useRef(slug);
  slugRef.current = slug;
  const chatRef = useRef(chat);
  chatRef.current = chat;

  useEffect(() => {
    setRuns([]);
    setMore(false);
    setLoaded(false);
    setDelta(null);
    setError("");
    let alive = true;
    let ready = false;
    let shown = chat ?? null;
    const runChats = new Map<string, string>();
    const buffered: LiveEvent[] = [];
    const apply = (ev: LiveEvent) => {
      const e = ev.event;
      if (e.type === "start") runChats.set(ev.runId, chatOfRun(e));
      // Runs of other chats, and runs that began before this view knew their chat, aren't shown.
      if (runChats.get(ev.runId) !== shown) return;
      if (e.type === "delta") {
        setDelta((d) => ({ runId: ev.runId, text: (d && d.runId === ev.runId ? d.text : "") + e.text }));
        return;
      }
      if (e.type === "text" || e.type === "end") setDelta(null);
      setRuns((prev) => {
        const i = prev.findIndex((r) => r.runId === ev.runId);
        if (i < 0) return [...prev, { key: `live-${ev.runId}`, runId: ev.runId, events: [e] }];
        if (prev[i]!.events.some((x) => same(x, e))) return prev;
        const next = prev.slice();
        next[i] = { ...prev[i]!, events: [...prev[i]!.events, e] };
        return next;
      });
    };
    const off = on("crew:event", (ev) => {
      if (ev.slug !== slug) return;
      if (ready) apply(ev);
      else buffered.push(ev);
    });
    invoke("crew:history", slug, { limit, chat }).then(
      (h) => {
        if (!alive) return;
        shown = h.chat;
        for (const r of h.runs) {
          const start = r.events.find((e) => e.type === "start");
          if (start && start.type === "start") runChats.set(start.runId, h.chat);
        }
        setRuns(h.runs.map(logOf));
        setMore(h.more);
        setLoaded(true);
        ready = true;
        buffered.forEach(apply);
      },
      (e) => {
        if (!alive) return;
        setError(errorText(e));
        setLoaded(true);
        ready = true;
        buffered.forEach(apply);
      },
    );
    return () => {
      alive = false;
      off();
    };
  }, [slug, chat, limit]);

  const earlier = useCallback(() => {
    const first = runs[0]?.key;
    if (!first || first.startsWith("live-")) return;
    invoke("crew:history", slugRef.current, { before: first, limit: PAGE, chat: chatRef.current }).then(
      (h) => {
        setRuns((prev) => [...h.runs.map(logOf), ...prev]);
        setMore(h.more);
      },
      (e) => setError(errorText(e)),
    );
  }, [runs]);

  return { runs, more, loaded, delta, error, earlier };
}
