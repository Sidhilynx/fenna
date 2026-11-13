// The margin beside the page: a card for each open comment thread and each
// suggestion, level with the words it is about. The words a thread is on
// are highlighted in the text (the browser's highlight API, so the page
// itself is never changed for it). When the window is too narrow for a
// margin, only the card in use shows, under its words.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { acceptSuggestion, rejectSuggestion } from "@opendeck/doc";
import { Icon, ThreadCard, ago } from "@opendeck/shell";
import { rangeIn } from "../editor/caret.ts";
import { type DocAnchor, type DocThread, addComment, deleteThread, openThread, quoteRange, resolveThread, setAskAssistant, threadsOn, useComments } from "../editor/comments.ts";
import { onLayout, pageEl } from "../editor/page.ts";
import { editTab, useDocs } from "../store.ts";

const CARD_W = 280;
const GAP = 10;
/** The gap between page and cards, and the least room left of the page, together. */
const MARGIN_ROOM = 40 + 64;

interface SuggestionItem {
  sid: string;
  inserted: string;
  deleted: string;
  /** Made by the AI (through MCP) rather than typed here. */
  ai: boolean;
  at: number;
  els: HTMLElement[];
}

type Item = { key: string; kind: "thread"; thread: DocThread } | { key: string; kind: "draft"; anchor: DocAnchor } | { key: string; kind: "suggestion"; s: SuggestionItem };

/** The suggestions on the page, in reading order. */
function readSuggestions(page: HTMLElement): SuggestionItem[] {
  const by = new Map<string, SuggestionItem>();
  for (const el of page.querySelectorAll<HTMLElement>("ins[data-sid], del[data-sid]")) {
    const sid = el.dataset.sid!;
    const s = by.get(sid) ?? { sid, inserted: "", deleted: "", ai: el.dataset.by === "ai", at: Number(el.dataset.at) || 0, els: [] };
    if (el.tagName === "INS") s.inserted += el.textContent ?? "";
    else s.deleted += el.textContent ?? "";
    s.els.push(el);
    by.set(sid, s);
  }
  return [...by.values()].filter((s) => s.inserted || s.deleted);
}

/** Where a thread's words are: exactly (`exact`), or the whole block when they're gone or there were none. */
function anchorRange(page: HTMLElement, a: DocAnchor): { range: Range; exact: boolean } | null {
  const block = page.querySelector<HTMLElement>(`:scope > [id="${CSS.escape(a.block)}"]`);
  if (!block) return null;
  const q = quoteRange(block, a.quote);
  if (q) return { range: rangeIn(block, q[0], q[1]), exact: true };
  const range = document.createRange();
  range.selectNodeContents(block);
  return { range, exact: false };
}

const quoteOf = (raw: string, max = 60) => {
  const s = raw.replace(/\s+/g, " ").trim();
  return `“${s.length > max ? `${s.slice(0, max - 1)}…` : s}”`;
};

function decide(sid: string, accept: boolean) {
  void editTab(accept ? "Accept suggestion" : "Reject suggestion", (blocks) => {
    const tab = { type: "element" as const, tag: "article", attrs: {}, children: blocks };
    return (accept ? acceptSuggestion(tab, sid) : rejectSuggestion(tab, sid)).children as typeof blocks;
  });
}

export function Margin() {
  const tab = useDocs((s) => s.tab);
  const paint = useDocs((s) => s.paint);
  const threads = useComments((s) => s.threads);
  const open = useComments((s) => s.open);
  const working = useComments((s) => s.working);
  const ask = useComments((s) => s.askAssistant);
  const panel = useDocs((s) => s.comments);
  const [tick, setTick] = useState(0);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [tops, setTops] = useState<Map<string, number>>(new Map());
  const [roomy, setRoomy] = useState(true);
  const [caretSid, setCaretSid] = useState<string | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => onLayout(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    const onResize = () => setTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The suggestion the caret is in (for the narrow layout), and opening a thread by clicking its words.
  useEffect(() => {
    const page = pageEl();
    if (!page) return;
    const onSel = () => {
      const n = document.getSelection()?.focusNode ?? null;
      const m = (n?.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element | null))?.closest("ins[data-sid], del[data-sid]") as HTMLElement | null;
      setCaretSid(m && page.contains(m) ? m.dataset.sid! : null);
    };
    const onUp = () => {
      const sel = document.getSelection();
      if (!sel?.rangeCount || !sel.isCollapsed || !tab) return;
      const node = sel.focusNode!;
      const hit = threadsOn(tab).find((t) => {
        const a = anchorRange(page, t);
        return a?.exact && a.range.isPointInRange(node, sel.focusOffset);
      });
      if (hit) openThread(hit.id);
    };
    document.addEventListener("selectionchange", onSel);
    page.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("selectionchange", onSel);
      page.removeEventListener("mouseup", onUp);
    };
  }, [tab]);

  const items: Item[] = [];
  if (tab) {
    for (const t of threads) if (t.tab === tab && !t.resolved) items.push({ key: t.id, kind: "thread", thread: t });
    if (open && "draft" in open && open.draft.tab === tab) items.push({ key: "draft", kind: "draft", anchor: open.draft });
    for (const s of suggestions) items.push({ key: `s:${s.sid}`, kind: "suggestion", s });
  }
  const openKey = open ? ("draft" in open ? "draft" : open.thread) : null;

  // Read the page: suggestions, where each card's words are, highlights.
  useLayoutEffect(() => {
    const page = pageEl();
    const wrap = box.current?.parentElement;
    if (!page || !wrap || !tab) return;
    const sugg = readSuggestions(page);
    if (sugg.map((s) => s.sid + s.inserted + s.deleted).join() !== suggestions.map((s) => s.sid + s.inserted + s.deleted).join()) setSuggestions(sugg);
    const stage = wrap.closest(".dt-stage");
    const wr = wrap.getBoundingClientRect();
    // Room for a margin once the page moves left to make it (see .dp-paper in styles.css), not where it sits now.
    setRoomy(!!stage && stage.clientWidth >= page.offsetWidth + CARD_W + MARGIN_ROOM);
    const anchorTop = new Map<string, number>();
    const ranges: Range[] = [];
    let openRange: Range | null = null;
    for (const it of items) {
      if (it.kind === "suggestion") {
        const r = it.s.els[0]?.getBoundingClientRect();
        if (r) anchorTop.set(it.key, r.top - wr.top);
        continue;
      }
      const a = it.kind === "thread" ? it.thread : it.anchor;
      const r = anchorRange(page, a);
      if (!r) continue;
      anchorTop.set(it.key, r.range.getBoundingClientRect().top - wr.top);
      if (r.exact) {
        if (it.key === openKey) openRange = r.range;
        else ranges.push(r.range);
      }
    }
    if (typeof Highlight !== "undefined") {
      CSS.highlights.set("od-comment", new Highlight(...ranges));
      if (openRange) CSS.highlights.set("od-comment-open", new Highlight(openRange));
      else CSS.highlights.delete("od-comment-open");
    }
    // Stack the cards down the margin in the order of their words, never overlapping.
    const sorted = items.filter((i) => anchorTop.has(i.key)).sort((a, b) => anchorTop.get(a.key)! - anchorTop.get(b.key)!);
    const next = new Map<string, number>();
    let floor = 0;
    for (const it of sorted) {
      const y = Math.max(anchorTop.get(it.key)!, floor);
      next.set(it.key, y);
      floor = y + (cards.current.get(it.key)?.offsetHeight ?? 60) + GAP;
    }
    // The open card sits level with its words; the cards above it move up to make room.
    if (openKey && next.has(openKey)) {
      const want = anchorTop.get(openKey)!;
      const shift = next.get(openKey)! - want;
      if (shift > 0) {
        let ceiling = want;
        for (let i = sorted.findIndex((x) => x.key === openKey); i >= 0; i--) {
          const k = sorted[i]!.key;
          if (k === openKey) {
            next.set(k, want);
            continue;
          }
          const h = cards.current.get(k)?.offsetHeight ?? 60;
          const y = Math.min(next.get(k)!, ceiling - GAP - h);
          next.set(k, y);
          ceiling = y;
        }
        let low = want + (cards.current.get(openKey)?.offsetHeight ?? 60) + GAP;
        for (const it of sorted.slice(sorted.findIndex((x) => x.key === openKey) + 1)) {
          const y = Math.max(anchorTop.get(it.key)!, low);
          next.set(it.key, y);
          low = y + (cards.current.get(it.key)?.offsetHeight ?? 60) + GAP;
        }
      }
    }
    if ([...next].some(([k, v]) => tops.get(k) !== v) || next.size !== tops.size) setTops(next);
  });

  useEffect(() => () => {
    if (typeof Highlight !== "undefined") {
      CSS.highlights.delete("od-comment");
      CSS.highlights.delete("od-comment-open");
    }
  }, []);

  // With the Comments column open, threads show there; the margin keeps the suggestions.
  const shown = panel ? items.filter((i) => i.kind === "suggestion") : items;
  const visible = roomy ? shown : shown.filter((i) => i.key === openKey || (i.kind === "suggestion" && i.s.sid === caretSid));

  return (
    <div ref={box} className={`dp-margin${roomy ? "" : " narrow"}`} data-tick={tick} data-paint={paint}>
      {visible.map((it) => {
        const top = tops.get(it.key);
        // Not yet placed: invisible but focusable, so a new card can take the caret at once.
        const style = top === undefined ? { opacity: 0, pointerEvents: "none" as const } : { top };
        const keep = (el: HTMLElement | null) => {
          if (el) cards.current.set(it.key, el);
          else cards.current.delete(it.key);
        };
        if (it.kind === "suggestion") return <SuggestionCard key={it.key} refFn={keep} style={style} s={it.s} />;
        const thread = it.kind === "thread" ? it.thread : null;
        const anchor = it.kind === "thread" ? it.thread : it.anchor;
        const isOpen = it.key === openKey;
        return (
          <div key={it.key} ref={keep} className={`dp-card${isOpen ? " open" : ""}`} style={style}>
            <ThreadCard
              thread={thread}
              quote={isOpen && anchor.quote ? anchor.quote : undefined}
              working={thread ? working[thread.id] : undefined}
              askAssistant={ask}
              onAskAssistant={setAskAssistant}
              collapsed={!isOpen}
              onExpand={() => thread && openThread(thread.id)}
              onSend={(text) => addComment(thread ? { thread: thread.id } : { draft: it.kind === "draft" ? it.anchor : (anchor as DocAnchor) }, text)}
              onResolve={thread ? () => resolveThread(thread.id) : undefined}
              onDelete={thread ? () => deleteThread(thread.id) : undefined}
              onClose={() => openThread(null)}
            />
          </div>
        );
      })}
    </div>
  );
}

function SuggestionCard({ s, style, refFn }: { s: SuggestionItem; style: React.CSSProperties; refFn(el: HTMLElement | null): void }) {
  const what = s.inserted && s.deleted ? (
    <>
      Replace <b>{quoteOf(s.deleted, 40)}</b> with <b>{quoteOf(s.inserted, 40)}</b>
    </>
  ) : s.inserted ? (
    <>
      Add <b>{quoteOf(s.inserted)}</b>
    </>
  ) : (
    <>
      Delete <b>{quoteOf(s.deleted)}</b>
    </>
  );
  return (
    <div ref={refFn} className="dp-card sg-card" style={style} role="group" aria-label="Suggestion">
      <div className="sg-head">
        <span className={s.ai ? "cm-avatar ai" : "cm-avatar"} aria-hidden>
          <Icon name={s.ai ? "sparkle" : "person"} size={14} />
        </span>
        <span className="sg-who">
          <span className="cm-author">{s.ai ? "Assistant" : "You"}</span>
          <span className="cm-time">{ago(s.at)}</span>
        </span>
        <span className="sg-actions">
          <button className="icon-btn" title="Accept" aria-label="Accept suggestion" onMouseDown={(e) => e.preventDefault()} onClick={() => decide(s.sid, true)}>
            <Icon name="check" size={16} />
          </button>
          <button className="icon-btn" title="Reject" aria-label="Reject suggestion" onMouseDown={(e) => e.preventDefault()} onClick={() => decide(s.sid, false)}>
            <Icon name="close" size={16} />
          </button>
        </span>
      </div>
      <div className="sg-text">{what}</div>
    </div>
  );
}
