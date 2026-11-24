// Small pure helpers for the words and times the UI shows. No imports beyond
// types, so the phone app (apps/crew-mobile) uses them too; util.ts re-exports them.

import type { LibraryKind } from "@opendeck/crew";

export const KIND_LABEL: Record<LibraryKind, string> = { doc: "Doc", sheet: "Sheet", deck: "Deck", board: "Whiteboard", design: "Design" };
export const KIND_PLURAL: Record<LibraryKind, string> = { doc: "Docs", sheet: "Sheets", deck: "Slides", board: "Whiteboards", design: "Designs" };

export function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** A time that is coming: "Today 10:00", "Tomorrow 10:00", "Mon 10:00". */
export function whenNext(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Math.round((dayOf(d) - dayOf(new Date())) / 86_400_000);
  if (diff <= 0) return `Today ${clock(iso)}`;
  if (diff === 1) return `Tomorrow ${clock(iso)}`;
  return `${d.toLocaleDateString([], { weekday: "short" })} ${clock(iso)}`;
}

/** "Today 09:05", "Yesterday", "Mon", "3 Nov". */
export function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Math.round((dayOf(new Date()) - dayOf(d)) / 86_400_000);
  if (diff <= 0) return `Today ${clock(iso)}`;
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}


export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A web address the person typed, made into one the browser can open, or routed to search. */
export function toUrl(text: string): string {
  const t = text.trim();
  if (!t) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[^/\s]+:\d+/.test(t)) return t;
  const isLocal = /^localhost(:\d+)?(\/.*)?$/i.test(t);
  const isDomain = /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i.test(t) || /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/i.test(t);
  if (!/\s/.test(t) && (isLocal || isDomain)) {
    return isLocal ? `http://${t}` : `https://${t}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}

/** The line a run woken by a watch shows: "Woke up: " and the first line of what it was asked to do, at most 80 characters. */
export function wakeLine(text: string): string {
  const first = text.trim().split("\n")[0]!.trim();
  if (!first) return "Woke up on a watch";
  return `Woke up: ${first.length > 80 ? `${first.slice(0, 79).trimEnd()}…` : first}`;
}
