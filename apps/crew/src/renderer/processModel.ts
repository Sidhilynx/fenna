// Pure helpers for a bot's commands: their times and status lines, the last
// lines of their output, the output kept per command (64 KB, newest kept) and
// whether a console is following its end. No DOM, so they are tested alone.

import type { ProcessInfo } from "../shared/contract.ts";
import { atBottom } from "./termModel.ts";

/** The most output a console keeps per command, in characters. */
export const OUTPUT_MAX = 64 * 1024;

export interface OutSeg {
  stream: "out" | "err";
  text: string;
}

/** A command's output as the console keeps it: the segments in order, and whether earlier ones were dropped. */
export interface OutBuf {
  segs: OutSeg[];
  cut: boolean;
}

export const EMPTY_BUF: OutBuf = { segs: [], cut: false };

/** The terminal's colour and cursor codes (CSI), which a plain text view shows as junk. */
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * Text as a console shows it: colour codes removed, and on each line only what
 * a carriage return left at the end (a progress bar redraws its line).
 */
export function cleanOutput(text: string): string {
  return text
    .replace(ANSI, "")
    .split("\n")
    .map((line) => {
      const plain = line.endsWith("\r") ? line.slice(0, -1) : line;
      return plain.slice(plain.lastIndexOf("\r") + 1);
    })
    .join("\n");
}

/** A duration for people: "4.2 s", "45 s", "2 min 5 s", "1 h 3 min". Negative or unknown is "0 s". */
export function formatDuration(ms: number): string {
  const s = Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 60) return `${Math.floor(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${Math.floor(s % 60)} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** How long a command has run (or ran): from its start to its end, or to `now` while it runs. */
export function runTime(p: ProcessInfo, now: number): number {
  const start = Date.parse(p.startedAt);
  const end = p.endedAt ? Date.parse(p.endedAt) : now;
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return end - start;
}

/** The status in a few words: "Running", "Exited 0", "Stopped", "Failed". */
export function statusText(p: ProcessInfo): string {
  if (p.status === "running") return "Running";
  if (p.status === "stopped") return "Stopped";
  if (p.status === "failed") return "Failed";
  return p.exitCode === null ? "Exited" : `Exited ${p.exitCode}`;
}

/** The line over a command's output: "$ npm install express · Projects/site · exited 0 in 4.2 s". */
export function headerLine(p: ProcessInfo, now: number): string {
  const dur = formatDuration(runTime(p, now));
  const end =
    p.status === "running"
      ? `running for ${dur}`
      : p.status === "stopped"
        ? `stopped after ${dur}`
        : p.status === "failed"
          ? `failed after ${dur}`
          : `${statusText(p).toLowerCase()} in ${dur}`;
  return `$ ${p.command} · ${projectLabel(p.project)} · ${end}`;
}

/** A project's place on the bot's disk, as people read it: "Projects/site". */
export const projectLabel = (project: string): string => `Projects/${project}`;

/** A project's folder on the bot's disk: "Files/Projects/site". */
export const projectPath = (project: string): string => `Files/Projects/${project}`;

/** The address the bot's browser opens for a port the command listens on. */
export const portUrl = (port: number): string => `http://localhost:${port}`;

/** The last `n` lines of text, without the empty line after a final newline. */
export function lastLines(text: string, n: number): string[] {
  const lines = cleanOutput(text).split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(Math.max(0, lines.length - n));
}

/** A command's output as one string. */
export function bufText(buf: OutBuf): string {
  return buf.segs.map((s) => s.text).join("");
}

/**
 * Adds output to a command's buffer and drops the oldest characters past
 * `max`, so the newest output is what stays. `cut` says some was dropped.
 */
export function appendOutput(buf: OutBuf, stream: OutSeg["stream"], text: string, max: number = OUTPUT_MAX): OutBuf {
  if (!text) return buf;
  const segs = [...buf.segs, { stream, text }];
  let total = segs.reduce((n, s) => n + s.text.length, 0);
  let cut = buf.cut;
  while (total > max && segs.length > 1) {
    total -= segs[0]!.text.length;
    segs.shift();
    cut = true;
  }
  if (total > max) {
    const first = segs[0]!;
    segs[0] = { stream: first.stream, text: first.text.slice(first.text.length - max) };
    cut = true;
  }
  return { segs, cut };
}

/** A command's buffer when the console first sees it: what the main process says its last lines are. */
export function seedOutput(tail: string): OutBuf {
  return tail ? appendOutput(EMPTY_BUF, "out", tail) : EMPTY_BUF;
}

/** The commands in order, newest first, with one entry per id (a newer copy replaces an older one). */
export function upsertProcess(list: readonly ProcessInfo[], info: ProcessInfo): ProcessInfo[] {
  const rest = list.filter((p) => p.id !== info.id);
  return [info, ...rest].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}

/** Whether a console is at its end: scrolling to the bottom follows output again, scrolling up stops it. */
export function isFollowing(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return atBottom(scrollTop, scrollHeight, clientHeight);
}

/** How many commands are running in each project. */
export function runningByProject(list: readonly ProcessInfo[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of list) if (p.status === "running") counts.set(p.project, (counts.get(p.project) ?? 0) + 1);
  return counts;
}
