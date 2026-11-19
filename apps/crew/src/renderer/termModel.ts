// Pure helpers for a bot's terminal: the command history, Tab completion of
// the last word, the folder a typed word points at, the prompt's folder name
// and the order of the lines on screen. No DOM, so they are tested alone.

import type { TermEntry } from "../shared/contract.ts";

export interface NameEntry {
  name: string;
  isDir: boolean;
}

/** History positions run from 0 (the oldest command) to history.length (the line being typed). */
export function historyStep(history: readonly string[], pos: number, dir: "up" | "down"): number {
  const at = Math.min(pos, history.length);
  return dir === "up" ? Math.max(0, at - 1) : Math.min(history.length, at + 1);
}

/** The line at a history position; the draft at the end of the history. */
export function historyValue(history: readonly string[], pos: number, draft: string): string {
  return pos >= history.length || pos < 0 ? draft : history[pos]!;
}

/** The person's own commands, oldest first, with a repeat of the line before it left out. */
export function historyLines(entries: readonly TermEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.who !== "person" || !e.line.trim()) continue;
    if (out[out.length - 1] !== e.line) out.push(e.line);
  }
  return out;
}

/** Adds entries by id (a newer copy replaces an older one) and keeps the list in time order. */
export function mergeEntries(list: readonly TermEntry[], incoming: readonly TermEntry[]): TermEntry[] {
  const byId = new Map(list.map((e) => [e.id, e] as const));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** The last word of a command line (words split on spaces), and what comes before it. */
export function lastWord(line: string): { head: string; word: string } {
  const i = line.lastIndexOf(" ");
  return { head: line.slice(0, i + 1), word: line.slice(i + 1) };
}

/**
 * The disk folder a typed word's folder part points at, counted from the
 * prompt's folder: "notes/a" in Files/work is Files/work/notes, "../x" goes
 * up first, and a leading "/" starts from the top. `partial` is the name
 * being typed, after the last "/".
 */
export function folderFor(cwd: string, word: string): { dir: string; partial: string } {
  const slash = word.lastIndexOf("/");
  const part = slash < 0 ? "" : word.slice(0, slash);
  const segs = word.startsWith("/") ? [] : cwd.split("/").filter(Boolean);
  for (const s of part.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") segs.pop();
    else segs.push(s);
  }
  return { dir: segs.join("/"), partial: word.slice(slash + 1) };
}

export interface Completion {
  /** The partial name after completing it. */
  text: string;
  /** The names that matched, folders with a "/". Empty when nothing matched. */
  matches: string[];
}

/**
 * Completes a partial name against a folder's names. One match finishes the
 * name (a folder gets "/", a file a space so the next word can start). Several
 * matches finish the part they share and are listed. Case is ignored.
 */
export function completeName(partial: string, entries: readonly NameEntry[]): Completion {
  const low = partial.toLowerCase();
  const hits = entries.filter((e) => e.name.toLowerCase().startsWith(low)).sort((a, b) => a.name.localeCompare(b.name));
  if (!hits.length) return { text: partial, matches: [] };
  const label = (h: NameEntry) => (h.isDir ? `${h.name}/` : h.name);
  if (hits.length === 1) return { text: label(hits[0]!) + (hits[0]!.isDir ? "" : " "), matches: [label(hits[0]!)] };
  const first = hits[0]!.name;
  let len = first.length;
  for (const h of hits.slice(1)) {
    let i = 0;
    while (i < len && i < h.name.length && first[i]!.toLowerCase() === h.name[i]!.toLowerCase()) i++;
    len = i;
  }
  return { text: len > partial.length ? first.slice(0, len) : partial, matches: hits.map(label) };
}

/** Completes the last word of a line against the names in its folder. */
export function completeLast(line: string, entries: readonly NameEntry[]): { line: string; matches: string[] } {
  const { head, word } = lastWord(line);
  const slash = word.lastIndexOf("/");
  const done = completeName(word.slice(slash + 1), entries);
  return { line: head + word.slice(0, slash + 1) + done.text, matches: done.matches };
}

/** The folder as the prompt shows it: the whole path when short, else the top folder, "…" and the last two. */
export function shortCwd(cwd: string, keep = 2): string {
  const segs = cwd.split("/").filter(Boolean);
  if (!segs.length) return "/";
  if (segs.length <= keep + 1) return segs.join("/");
  return [segs[0], "…", ...segs.slice(-keep)].join("/");
}

/** Whether a scrolled log is at its end, give or take a few pixels. */
export function atBottom(scrollTop: number, scrollHeight: number, clientHeight: number, slack = 8): boolean {
  return scrollHeight - scrollTop - clientHeight <= slack;
}
