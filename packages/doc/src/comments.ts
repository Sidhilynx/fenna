// Where a comment on a doc points: a tab, a block in it, and the words it was
// left on. The thread itself (its comments, resolved or not) is the shell's
// format; this is the doc's part of it, checked the same way by the editor
// and the MCP server.

export interface DocAnchor {
  tab: string;
  block: string;
  /** The words the comment was left on; "" for the whole block. */
  quote: string;
}

export const MAX_QUOTE = 400;

const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

/** A thread's anchor as read from comments.json, or null when it isn't one. */
export function docAnchor(t: Record<string, unknown>): DocAnchor | null {
  if (!text(t.tab, 64) || !text(t.block, 24) || !t.block) return null;
  return { tab: t.tab, block: t.block, quote: text(t.quote, MAX_QUOTE) ? t.quote : "" };
}
