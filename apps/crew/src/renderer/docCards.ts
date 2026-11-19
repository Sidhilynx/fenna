// Which library documents a run made or changed, and where their cards go in
// the chat. A run's library tool calls name their document (each tool event
// carries `doc`, the library folder), so those are the run's cards. Logs from
// before that named nothing: for them a document counts when its last change
// falls inside the run's span (from its start to its end, or to now while it
// runs).

import type { LibraryItem, RunEvent } from "../shared/contract.ts";

/** File times and event times come from one clock, but a write can land just after the event that caused it. */
const SLACK_MS = 2000;

export interface RunSpan {
  start: number;
  /** null while the run has no end event yet. */
  end: number | null;
}

/** A run's span in epoch milliseconds, or null when its events carry no usable times. */
export function runSpan(events: RunEvent[]): RunSpan | null {
  const begin = events.find((e) => e.type === "start") ?? events[0];
  if (!begin) return null;
  const start = Date.parse(begin.at);
  if (Number.isNaN(start)) return null;
  const endEvent = events.find((e) => e.type === "end");
  const end = endEvent ? Date.parse(endEvent.at) : NaN;
  return { start, end: Number.isNaN(end) ? null : end };
}

/** The library documents whose last change falls inside the span, oldest change first. */
export function touchedDocs(library: LibraryItem[], span: RunSpan, now: number): LibraryItem[] {
  const from = span.start - SLACK_MS;
  const to = (span.end ?? now) + SLACK_MS;
  return library
    .map((item) => ({ item, at: Date.parse(item.edited) }))
    .filter(({ at }) => !Number.isNaN(at) && at >= from && at <= to)
    .sort((a, b) => a.at - b.at)
    .map(({ item }) => item);
}

/** Whether a run's log has document fields at all. Logs from before they existed have none. */
export function hasDocFields(events: RunEvent[]): boolean {
  return events.some((e) => e.type === "tool" && "doc" in e);
}

/** The library folders a run's tool calls named, in the order they first came up, each once. */
export function namedDocPaths(events: RunEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) if (e.type === "tool" && typeof e.doc === "string" && !out.includes(e.doc)) out.push(e.doc);
  return out;
}

/**
 * The library documents a run made or changed. Named documents match the
 * library by exact path, and a named folder no longer in the library is skipped.
 * Only a log with no document fields falls back to the time window.
 */
export function runDocs(library: LibraryItem[], events: RunEvent[], now: number): LibraryItem[] {
  if (hasDocFields(events)) {
    const byPath = new Map(library.map((item) => [item.path, item]));
    return namedDocPaths(events).flatMap((p) => byPath.get(p) ?? []);
  }
  const span = runSpan(events);
  return span ? touchedDocs(library, span, now) : [];
}

/**
 * The document cards for each chat item that should carry them, keyed by item key.
 * A run's cards go after its last bot reply, or after its last item when it has none.
 * `items` are the chat's items (keys are `${run.key}:${index}`), `runs` the runs they came from.
 */
export function docCardAnchors(
  items: { key: string; kind: string }[],
  runs: { key: string; events: RunEvent[] }[],
  library: LibraryItem[],
  now: number,
): Map<string, LibraryItem[]> {
  const out = new Map<string, LibraryItem[]>();
  if (!library.length) return out;
  for (const run of runs) {
    const docs = runDocs(library, run.events, now);
    if (!docs.length) continue;
    const own = items.filter((i) => i.key.startsWith(`${run.key}:`));
    const anchor = [...own].reverse().find((i) => i.kind === "bot") ?? own[own.length - 1];
    if (!anchor) continue;
    const prior = out.get(anchor.key) ?? [];
    const seen = new Set(prior.map((d) => d.path));
    out.set(anchor.key, [...prior, ...docs.filter((d) => !seen.has(d.path) && seen.add(d.path))]);
  }
  return out;
}
