// The Clock app's pure parts: the pixel digits of the big clock, and the agenda
// of what a bot will do next (its schedule, its timers, its page checks). No
// React and no DOM here, so the tests can check every rule.

import type { Watch } from "../shared/contract.ts";

const GLYPHS: Record<string, readonly string[]> = {
  "0": [".xxx.", "x...x", "x..xx", "x.x.x", "xx..x", "x...x", ".xxx."],
  "1": ["..x..", ".xx..", "..x..", "..x..", "..x..", "..x..", ".xxx."],
  "2": [".xxx.", "x...x", "....x", "...x.", "..x..", ".x...", "xxxxx"],
  "3": ["xxxxx", "...x.", "..x..", "...x.", "....x", "x...x", ".xxx."],
  "4": ["...x.", "..xx.", ".x.x.", "x..x.", "xxxxx", "...x.", "...x."],
  "5": ["xxxxx", "x....", "xxxx.", "....x", "....x", "x...x", ".xxx."],
  "6": ["..xx.", ".x...", "x....", "xxxx.", "x...x", "x...x", ".xxx."],
  "7": ["xxxxx", "....x", "...x.", "..x..", ".x...", ".x...", ".x..."],
  "8": [".xxx.", "x...x", "x...x", ".xxx.", "x...x", "x...x", ".xxx."],
  "9": [".xxx.", "x...x", "x...x", ".xxxx", "....x", "...x.", ".xx.."],
  ":": ["...", ".x.", ".x.", "...", ".x.", ".x.", "..."],
  " ": ["...", "...", "...", "...", "...", "...", "..."],
};

/** The rows of a clock text ("09:41") as a pixel grid, one glyph after another with a column between. Unknown characters are blank. */
export function clockRows(text: string): string[] {
  const glyphs = [...text].map((c) => GLYPHS[c] ?? GLYPHS[" "]!);
  const rows: string[] = [];
  for (let y = 0; y < 7; y++) rows.push(glyphs.map((g) => g[y]!).join("."));
  return rows;
}

/** "09:41" for a time, 24 hours, always two digits. */
export function clockText(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export type AgendaKind = "run" | "timer" | "page";

export interface AgendaItem {
  at: Date;
  kind: AgendaKind;
  title: string;
}

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
/** At most this many times one repeating watch is listed in the horizon. */
const PER_WATCH = 50;
/** The agenda's longest list. */
const MAX_ITEMS = 200;

/**
 * The times a bot is scheduled to run, from `now` until `until`. nextAfter is
 * packages/crew's nextRun bound to the bot's schedule (null when it has none).
 */
export function scheduledRuns(nextAfter: (from: Date) => Date | null, now: Date, until: Date, max = MAX_ITEMS): Date[] {
  const out: Date[] = [];
  let from = now;
  while (out.length < max) {
    const at = nextAfter(from);
    if (!at || at.getTime() >= until.getTime()) break;
    out.push(at);
    from = at;
  }
  return out;
}

/** The host of a page watch, for a short title: "https://www.example.com/a" → "www.example.com". */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The times this bot's timer and page watches come up in [now, until). A timer
 * is at its time and then every `every` minutes. A page is checked every
 * `every` minutes; its next check is estimated from when it was set, since
 * Crew does not keep the time of the last check.
 */
export function watchTimes(watches: readonly Watch[], now: Date, until: Date): AgendaItem[] {
  const out: AgendaItem[] = [];
  const end = until.getTime();
  const t0 = now.getTime();
  for (const w of watches) {
    if (w.kind === "timer") {
      const due = Date.parse(w.at);
      if (Number.isNaN(due)) continue;
      const step = w.every ? w.every * MIN_MS : 0;
      let at = due;
      if (at < t0) {
        if (!step) continue;
        at += Math.ceil((t0 - due) / step) * step;
      }
      for (let n = 0; at < end && n < PER_WATCH; n++) {
        out.push({ at: new Date(at), kind: "timer", title: w.note });
        if (!step) break;
        at += step;
      }
    } else if (w.kind === "page") {
      const step = w.every * MIN_MS;
      const created = Date.parse(w.created);
      if (Number.isNaN(created) || step <= 0) continue;
      let at = created;
      if (at <= t0) at += Math.floor((t0 - created) / step) * step + step;
      const title = `${hostOf(w.url)} · ${w.note}`;
      for (let n = 0; at < end && n < PER_WATCH; n++) {
        out.push({ at: new Date(at), kind: "page", title });
        at += step;
      }
    }
  }
  return out;
}

/** The agenda: scheduled runs and watch times in [now, until), soonest first, at most MAX_ITEMS. */
export function buildAgenda(input: { now: Date; until: Date; runs: readonly Date[]; watches: readonly Watch[] }): AgendaItem[] {
  const runs: AgendaItem[] = input.runs
    .filter((at) => at.getTime() >= input.now.getTime() && at.getTime() < input.until.getTime())
    .map((at) => ({ at, kind: "run", title: "Scheduled run" }));
  return [...runs, ...watchTimes(input.watches, input.now, input.until)].sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_ITEMS);
}

/** Local midnight of a date. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole days from one date's day to another's, in the local calendar (DST safe). */
export function dayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

/** The week strip's days: today and the days after, `count` of them, each at local midnight. */
export function weekDays(now: Date, count = 7): Date[] {
  const first = startOfDay(now);
  return Array.from({ length: count }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
}

/** The items of each day column (index from weekDays); items outside the week are left out. */
export function itemsByDay(items: readonly AgendaItem[], now: Date, count = 7): AgendaItem[][] {
  const cols: AgendaItem[][] = Array.from({ length: count }, () => []);
  for (const item of items) {
    const i = dayDiff(now, item.at);
    if (i >= 0 && i < count) cols[i]!.push(item);
  }
  return cols;
}

/** A local date and minute as a datetime-local value: "2026-11-20T09:00". */
export function localInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A datetime-local value ("2026-11-20T09:00") as a local date, or null when it is not one. */
export function parseLocalInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && h < 24 && mi < 60 ? date : null;
}

/** Midnight of a date's day. */
export function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The 42 days (six weeks, Monday first) a month's calendar shows, starting on or before the 1st. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const back = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - back + i));
}

/** The same day and time `months` months away, kept inside the shorter month (31 Jan + 1 is 28 or 29 Feb). */
export function addMonths(d: Date, months: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1, d.getHours(), d.getMinutes());
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return target;
}

/** The first whole quarter hour after `now`: what the reminder picker offers before the person picks. */
export function nextQuarter(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15 + 15);
  return d;
}
