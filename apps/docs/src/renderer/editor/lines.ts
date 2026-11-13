// Small rules the page's pointer and "@" handling follow, kept apart from
// the DOM so they can be tested on their own.

/** The longest run of words after "@" the menu still filters by. */
export const MAX_QUERY = 30;

/** Does an "@" at `offset` in `text` start a mention: at the start of the text, or after a space? */
export function opensMention(text: string, offset: number): boolean {
  if (text[offset] !== "@") return false;
  const before = text[offset - 1];
  return before === undefined || /\s/.test(before);
}

/** The words typed after the "@" at `offset`, up to the caret; null once the "@" is gone, the caret left it, or it ran too long. */
export function mentionQuery(text: string, offset: number, caret: number): string | null {
  if (text[offset] !== "@" || caret <= offset) return null;
  const q = text.slice(offset + 1, caret);
  return q.length > MAX_QUERY || /\n/.test(q) ? null : q;
}

/** The items whose label (or other words) contain the query, in their order. */
export function matchMentions<T extends { label: string; also?: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? items.filter((i) => `${i.label} ${i.also ?? ""}`.toLowerCase().includes(q)) : items;
}

/**
 * The line level with `y`, of `count` lines in reading order whose extents
 * `extent(i)` gives: the one `y` is over, else the one just above the gap
 * it's in, else the first. -1 when there are none.
 */
export function lineAtY(count: number, extent: (i: number) => { top: number; bottom: number }, y: number): number {
  let lo = 0;
  let hi = count - 1;
  let hit = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const r = extent(m);
    if (y < r.top) hi = m - 1;
    else {
      hit = m;
      if (y <= r.bottom) break;
      lo = m + 1;
    }
  }
  return hit < 0 && count > 0 ? 0 : hit;
}

/** A day as YYYY-MM-DD on this computer's calendar (not UTC's): today, or `days` from `now`. */
export function localDate(days = 0, now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
