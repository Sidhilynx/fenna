// Words Home (and the assistant's history) show: the greeting, how long ago,
// a new document's title from a draft.

export function greeting(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** The name to greet: the first word of the account name; a one-word "JordanLeeM" is cut at its second capital, and anything that still looks like a handle is not used. */
export function greetingName(account: string): string | null {
  const word = account.trim().split(/\s+/)[0] ?? "";
  if (!word) return null;
  const camel = word.match(/^[A-Z][a-z]+(?=[A-Z])/);
  const name = camel ? camel[0] : word;
  return /[\d_@.]/.test(name) || name.length < 2 ? null : name.charAt(0).toUpperCase() + name.slice(1);
}

/** "23h", "2d", "3w": how long ago, for the sidebar. */
export function shortAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 604800)}w`;
}

/** "23h ago", "yesterday", "3w ago", then a date: for the recent rows and chat history. */
export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 7) return d === 1 ? "yesterday" : `${d}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** A new document's title from the draft's first words (the save dialog lets the user change it). */
export function titleFromDraft(draft: string): string {
  const words = draft.trim().split(/\s+/).slice(0, 6).join(" ").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return words.length > 48 ? `${words.slice(0, 47)}…` : words;
}
