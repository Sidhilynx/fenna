// Comment threads, shared by every app: what a thread is and how threads are
// stored. Pure functions only; the comments store does the I/O.
//
// Threads live in comments.json beside the document, so they travel with it.
// What a thread points at (a slide element, a passage of a doc) is the app's:
// its fields sit beside the thread's own, and the app's `anchor` function
// checks them when the file is read.

export interface Comment {
  id: string;
  author: "you" | "ai";
  text: string;
  /** Milliseconds since the epoch. */
  at: number;
  /** The assistant could not answer; text says why. */
  error?: boolean;
}

export interface ThreadBase {
  id: string;
  resolved: boolean;
  comments: Comment[];
  /** The assistant conversation for this thread, so replies keep context. */
  session?: { kind: string; id: string };
}

/** A thread with the app's anchor fields beside its own. */
export type Thread<A extends object> = ThreadBase & A;

export const COMMENTS_FILE = "comments.json";
export const MAX_COMMENT = 4000;
const MAX_THREADS = 5000;

export const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

function parseComment(v: unknown): Comment | null {
  const c = v as Partial<Comment> | null;
  if (!c || !isText(c.id, 80) || (c.author !== "you" && c.author !== "ai") || !isText(c.text, MAX_COMMENT) || typeof c.at !== "number") return null;
  return { id: c.id, author: c.author, text: c.text, at: c.at, ...(c.error ? { error: true } : {}) };
}

/**
 * Threads from comments.json. A missing or damaged file gives no threads;
 * bad entries (including ones whose anchor the app refuses) are dropped.
 */
export function parseThreads<A extends object>(text: string | null, anchor: (raw: Record<string, unknown>) => A | null): Thread<A>[] {
  if (!text) return [];
  let data: { threads?: unknown };
  try {
    data = JSON.parse(text) as { threads?: unknown };
  } catch {
    return [];
  }
  if (!data || !Array.isArray(data.threads)) return [];
  const out: Thread<A>[] = [];
  for (const v of data.threads.slice(0, MAX_THREADS)) {
    const t = v as Record<string, unknown> | null;
    if (!t || !isText(t.id, 80) || !Array.isArray(t.comments)) continue;
    const a = anchor(t);
    if (!a) continue;
    const comments = t.comments.map(parseComment).filter((c): c is Comment => !!c);
    if (!comments.length) continue;
    const s = t.session as { kind?: unknown; id?: unknown } | undefined;
    const session = s && isText(s.kind, 40) && isText(s.id, 80) ? { kind: s.kind, id: s.id } : undefined;
    out.push({ id: t.id, ...a, resolved: t.resolved === true, comments, ...(session ? { session } : {}) } as Thread<A>);
  }
  return out;
}

export function serializeThreads(threads: ThreadBase[]): string {
  return JSON.stringify({ version: 1, threads }, null, 2) + "\n";
}

/** "now", "5m", "3h", or a short date. */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
