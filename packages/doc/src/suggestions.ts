// Suggestions: edits made in Suggesting mode, kept in the text as
// <ins data-sid> and <del data-sid> until someone accepts or rejects them.
// One suggestion is every <ins>/<del> sharing a sid (typing over a word is a
// <del> and an <ins> with one sid: a replacement).

import { type DocNode, type ElementNode, elementChildren, serializeNode, textOf, tidyInline } from "./tab.ts";

export interface Suggestion {
  sid: string;
  /** The block it starts in. */
  block: string;
  inserted: string;
  deleted: string;
  by: string;
  at: number;
}

function* marks(nodes: DocNode[]): Generator<ElementNode> {
  for (const n of nodes) {
    if (n.type !== "element") continue;
    if ((n.tag === "ins" || n.tag === "del") && n.attrs["data-sid"]) yield n;
    yield* marks(n.children);
  }
}

/** Every suggestion in a tab, in reading order. */
export function suggestionsOf(tab: ElementNode): Suggestion[] {
  const out = new Map<string, Suggestion>();
  for (const b of elementChildren(tab)) {
    for (const m of marks(b.children)) {
      const sid = m.attrs["data-sid"]!;
      const s = out.get(sid) ?? { sid, block: b.attrs.id ?? "", inserted: "", deleted: "", by: m.attrs["data-by"] ?? "you", at: Number(m.attrs["data-at"] ?? 0) || 0 };
      if (m.tag === "ins") s.inserted += textOf(m);
      else s.deleted += textOf(m);
      out.set(sid, s);
    }
  }
  return [...out.values()];
}

/** Apply a decision to every suggestion `which` picks: accepting keeps insertions and drops deletions; rejecting does the opposite. */
function decide(nodes: DocNode[], which: (sid: string) => boolean, accept: boolean): DocNode[] {
  const out: DocNode[] = [];
  for (const n of nodes) {
    if (n.type !== "element") {
      out.push(n);
      continue;
    }
    const sid = n.attrs["data-sid"];
    if ((n.tag === "ins" || n.tag === "del") && sid && which(sid)) {
      const keep = (n.tag === "ins") === accept;
      if (keep) out.push(...decide(n.children, which, accept));
      continue;
    }
    out.push({ ...n, children: decide(n.children, which, accept) });
  }
  return out;
}

function decideTab(tab: ElementNode, which: (sid: string) => boolean, accept: boolean): ElementNode {
  const blocks = tab.children.map((b) => {
    if (b.type !== "element") return b;
    const walk = (n: ElementNode): ElementNode => {
      const kids = decide(n.children, which, accept).map((c) => (c.type === "element" && !["ins", "del"].includes(c.tag) ? walk(c) : c));
      const inline = ["h1", "h2", "h3", "p", "blockquote", "li", "th", "td", "figcaption"].includes(n.tag);
      return { ...n, children: inline ? tidyInline(kids) : kids };
    };
    return walk(b);
  });
  return { ...tab, children: dropEmptied(tab.children, blocks) };
}

const MEDIA = (n: DocNode): boolean => n.type === "element" && (n.tag === "img" || n.tag === "hr" || n.children.some(MEDIA));
const emptied = (was: DocNode, now: DocNode) => was.type === "element" && now.type === "element" && textOf(was).trim() !== "" && textOf(now).trim() === "" && !MEDIA(now);

/** A block, list item or row a decision left empty goes, rather than staying as a blank line; so does a list or table left with nothing in it. */
function dropEmptied(was: DocNode[], now: DocNode[]): DocNode[] {
  const out: DocNode[] = [];
  now.forEach((n, k) => {
    const w = was[k];
    if (!w || n.type !== "element" || w.type !== "element") return void out.push(n);
    if (emptied(w, n) && n.tag !== "th" && n.tag !== "td") return;
    if (["ul", "ol", "table", "tr", "li"].includes(n.tag) && n.children.length === w.children.length) {
      const kids = dropEmptied(w.children, n.children);
      if (!kids.length && n.tag !== "li") return;
      return void out.push({ ...n, children: kids });
    }
    out.push(n);
  });
  return out;
}

export const acceptSuggestion = (tab: ElementNode, sid: string) => decideTab(tab, (s) => s === sid, true);
export const rejectSuggestion = (tab: ElementNode, sid: string) => decideTab(tab, (s) => s === sid, false);
export const acceptAll = (tab: ElementNode) => decideTab(tab, () => true, true);
export const rejectAll = (tab: ElementNode) => decideTab(tab, () => true, false);

// ── Turning an edit into suggestions ───────────────────────────────────
// When the doc is in Suggesting mode, an edit made outside the editor (the
// AI, through the MCP server) is saved as suggestions instead: the new tab
// is compared with the one it replaces, block by block, and what changed is
// marked. Accepting every suggestion gives the edited tab; rejecting every
// one gives the tab as it was. What text marks can't hold (code blocks,
// dividers, an image's file, a list's kind) changes directly, as it does
// when a person types in Suggesting mode.

/** Tags whose content is text and marks, where <ins> and <del> can go. */
const INLINE_HOLDERS = new Set(["h1", "h2", "h3", "p", "blockquote", "li", "th", "td", "figcaption"]);
const NESTED_LISTS = new Set(["ul", "ol"]);
const CONTAINERS = new Set(["ul", "ol", "table", "tr", "figure"]);

export interface SuggestBy {
  by: string;
  at: number;
  /** A new suggestion id; one per changed block, so each can be decided alone. */
  sid(): string;
}

const ser = (n: DocNode) => serializeNode(n);
const text = (t: string): DocNode => ({ type: "text", text: t });
const markOf = (tag: "ins" | "del", sid: string, s: SuggestBy, children: DocNode[]): ElementNode => ({
  type: "element",
  tag,
  attrs: { "data-sid": sid, "data-by": s.by, "data-at": String(s.at) },
  children,
});

const WORD = /[\p{L}\p{N}_'’-]/u;
/** Whether a cut at `i` falls between words, not inside one. */
const boundary = (s: string, i: number) => i <= 0 || i >= s.length || !(WORD.test(s[i - 1]!) && WORD.test(s[i]!));

/** How much two strings share at the start, cut back so no word is split. */
function wordPrefix(a: string, b: string): number {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  while (p > 0 && !(boundary(a, p) && boundary(b, p))) p--;
  return p;
}

/** How much two strings share at the end (not overlapping `from`), cut back so no word is split. */
function wordSuffix(a: string, b: string, from: number): number {
  let q = 0;
  while (q < a.length - from && q < b.length - from && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  while (q > 0 && !(boundary(a, a.length - q) && boundary(b, b.length - q))) q--;
  return q;
}

/** The smallest suggestion that turns inline content `a` into `b`. */
function diffInline(a: DocNode[], b: DocNode[], sid: string, s: SuggestBy): DocNode[] {
  let i = 0;
  while (i < a.length && i < b.length && ser(a[i]!) === ser(b[i]!)) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && ser(a[a.length - 1 - j]!) === ser(b[b.length - 1 - j]!)) j++;
  const am = a.slice(i, a.length - j);
  const bm = b.slice(i, b.length - j);
  if (!am.length && !bm.length) return b;
  const x = am.length === 1 ? am[0] : undefined;
  const y = bm.length === 1 ? bm[0] : undefined;
  let mid: DocNode[];
  if (x && y && x.type === "text" && y.type === "text") {
    const p = wordPrefix(x.text, y.text);
    const q = wordSuffix(x.text, y.text, p);
    const gone = x.text.slice(p, x.text.length - q);
    const come = y.text.slice(p, y.text.length - q);
    mid = [text(y.text.slice(0, p)), ...(gone ? [markOf("del", sid, s, [text(gone)])] : []), ...(come ? [markOf("ins", sid, s, [text(come)])] : []), text(y.text.slice(y.text.length - q))];
  } else if (x && y && x.type === "element" && y.type === "element" && x.tag === y.tag && JSON.stringify(x.attrs) === JSON.stringify(y.attrs) && x.tag !== "ins" && x.tag !== "del") {
    mid = [{ ...y, children: diffInline(x.children, y.children, sid, s) }];
  } else {
    mid = [...(am.length ? [markOf("del", sid, s, am)] : []), ...(bm.length ? [markOf("ins", sid, s, bm)] : [])];
  }
  return tidyInline([...b.slice(0, i), ...mid, ...b.slice(b.length - j)], false);
}

/** A node's inline part, and the lists nested after it (only list items have both). */
const split = (n: ElementNode) => ({
  inline: n.children.filter((c) => c.type === "text" || !NESTED_LISTS.has(c.tag)),
  lists: n.children.filter((c): c is ElementNode => c.type === "element" && NESTED_LISTS.has(c.tag)),
});

/** Pair two lists of children in order: identical ones first, the rest by position between them. */
function align(a: ElementNode[], b: ElementNode[]): [ElementNode | null, ElementNode | null][] {
  const sa = a.map(ser);
  const sb = b.map(ser);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = sa[i] === sb[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: [ElementNode | null, ElementNode | null][] = [];
  const gapA: ElementNode[] = [];
  const gapB: ElementNode[] = [];
  const flush = () => {
    for (let k = 0; k < Math.max(gapA.length, gapB.length); k++) out.push([gapA[k] ?? null, gapB[k] ?? null]);
    gapA.length = 0;
    gapB.length = 0;
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && sa[i] === sb[j]) {
      flush();
      out.push([a[i++]!, b[j++]!]);
    } else if (j >= b.length || (i < a.length && dp[i + 1]![j]! >= dp[i]![j + 1]!)) gapA.push(a[i++]!);
    else gapB.push(b[j++]!);
  }
  flush();
  return out;
}

/** All of a node's text marked as inserted or deleted; null when nothing in it can carry a mark. */
function markAll(n: ElementNode, tag: "ins" | "del", sid: string, s: SuggestBy): ElementNode | null {
  if (INLINE_HOLDERS.has(n.tag)) {
    const { inline, lists } = split(n);
    const nested = lists.map((l) => markAll(l, tag, sid, s)).filter((l): l is ElementNode => !!l);
    return { ...n, children: [...(inline.length ? [markOf(tag, sid, s, inline)] : []), ...nested] };
  }
  if (CONTAINERS.has(n.tag)) {
    const kids = n.children.flatMap((c): DocNode[] => {
      if (c.type !== "element" || c.tag === "img") return [c];
      const m = markAll(c, tag, sid, s);
      return m ? [m] : [];
    });
    if (kids.some((c) => c.type === "element" && c.tag !== "img")) return { ...n, children: kids };
  }
  return tag === "ins" ? n : null;
}

/** `b` as a suggestion over `a`; `a` itself when nothing changed. */
function suggestNode(a: ElementNode, b: ElementNode, sid: string, s: SuggestBy): ElementNode {
  if (ser(a) === ser(b)) return a;
  if (INLINE_HOLDERS.has(a.tag) && INLINE_HOLDERS.has(b.tag)) {
    const x = split(a);
    const y = split(b);
    return { ...b, children: [...diffInline(x.inline, y.inline, sid, s), ...pairUp(x.lists, y.lists, sid, s)] };
  }
  if (a.tag === b.tag && CONTAINERS.has(b.tag)) return { ...b, children: pairUp(elementChildren(a), elementChildren(b), sid, s) };
  return b;
}

function pairUp(a: ElementNode[], b: ElementNode[], sid: string, s: SuggestBy): ElementNode[] {
  return align(a, b).flatMap(([p, q]): ElementNode[] => {
    if (p && q) return [q.tag === "img" ? q : suggestNode(p, q, sid, s)];
    if (q) return [markAll(q, "ins", sid, s) ?? q];
    const gone = p ? markAll(p, "del", sid, s) : null;
    return gone ? [gone] : [];
  });
}

/**
 * Tab `after` saved as suggestions over tab `before`. Blocks are matched by
 * id; a block missing from `after` stays where it was, its text marked as
 * deleted.
 */
export function suggestTab(before: ElementNode, after: ElementNode, s: SuggestBy): ElementNode {
  const old = elementChildren(before);
  const oldAt = new Map(old.map((b, k) => [b.attrs.id ?? "", k] as const));
  const kept = new Set(elementChildren(after).map((b) => b.attrs.id ?? ""));
  const out: ElementNode[] = [];
  let next = 0;
  const removedBefore = (k: number) => {
    for (; next < k; next++) {
      const b = old[next]!;
      if (kept.has(b.attrs.id ?? "")) continue;
      const gone = markAll(b, "del", s.sid(), s);
      if (gone) out.push(gone);
    }
  };
  for (const b of elementChildren(after)) {
    const k = oldAt.get(b.attrs.id ?? "");
    if (k === undefined) {
      out.push(markAll(b, "ins", s.sid(), s) ?? b);
      continue;
    }
    if (k >= next) {
      removedBefore(k);
      next = k + 1;
    }
    out.push(suggestNode(old[k]!, b, s.sid(), s));
  }
  removedBefore(old.length);
  return { ...after, children: out };
}
