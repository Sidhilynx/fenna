// A bot's or team's folder name, made from its name: lowercase letters,
// digits and dashes, safe on every operating system.

export const SLUG_MAX = 40;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
// Folder names Windows refuses, whatever the extension.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

export function isSlug(s: unknown): s is string {
  return typeof s === "string" && SLUG_RE.test(s) && !s.includes("--") && !RESERVED.test(s);
}

/** The slug for a name: "Inbox Helper!" → "inbox-helper". Never empty. */
export function slugify(name: string): string {
  let s = String(name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX).replace(/-+$/, "");
  if (!s) s = "bot";
  if (RESERVED.test(s)) s = `${s}-bot`;
  return s;
}

/** A slug for `name` that isn't in `taken`: "research", then "research-2", … */
export function uniqueSlug(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(name);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const tail = `-${n}`;
    const s = base.slice(0, SLUG_MAX - tail.length).replace(/-+$/, "") + tail;
    if (!used.has(s)) return s;
  }
}
