// @mentions in a group chat message: who they name, and where they are in the text.

export interface MentionTarget {
  /** What the person types after the @. */
  name: string;
  /** The bot's folder name. */
  slug: string;
}

export type Piece = { text: string; slug?: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Cuts a message into plain text and mentions. The longest names match first; `@all` and `@everyone` have an empty slug. */
export function splitMentions(text: string, bots: readonly MentionTarget[]): Piece[] {
  const names = [...bots.flatMap((b) => [b.name, b.slug]), "all", "everyone"].filter(Boolean).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(^|[^\\w@])@(${names.map(escape).join("|")})(?![\\w-])`, "gi");
  const pieces: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index + m[1]!.length;
    if (start > last) pieces.push({ text: text.slice(last, start) });
    const word = m[2]!.toLowerCase();
    const bot = bots.find((b) => b.name.toLowerCase() === word || b.slug.toLowerCase() === word);
    pieces.push({ text: `@${m[2]}`, slug: bot?.slug ?? "" });
    last = start + 1 + m[2]!.length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last) });
  return pieces;
}

/** The "@..." the caret is in the middle of typing, if any: where it starts and what follows the @. */
export function openMention(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, query: m[2]! } : null;
}
