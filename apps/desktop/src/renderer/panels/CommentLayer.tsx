// Comment pins on the slide, and the thread they open. Pins sit at the top
// right of the element a thread points at; the thread opens beside its pin.

import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { addComment, deleteThread, type Draft, openThread, resolveThread, setAskAssistant, threadsOn, useComments } from "../editor/comments.ts";
import type { Thread } from "../editor/threads.ts";
import { Icon, ThreadCard, shortcut } from "@opendeck/shell";
import "./comments.css";

interface Pin {
  key: string;
  thread: Thread | null;
  draft: Draft | null;
  x: number;
  y: number;
}

const PIN = 24;

/** Pins for the slide's open threads, positioned over the stage frame. `measure` changes whenever the slide may have moved. */
export function CommentLayer({ frame, slideId, measure }: { frame: RefObject<HTMLDivElement | null>; slideId: string; measure: string }) {
  const threads = useComments((s) => s.threads);
  const open = useComments((s) => s.open);
  const [pins, setPins] = useState<Pin[]>([]);

  useLayoutEffect(() => {
    const f = frame.current;
    if (!f) return;
    const fr = f.getBoundingClientRect();
    const items: { key: string; thread: Thread | null; draft: Draft | null; anchor: string }[] = threadsOn(slideId).map(({ thread, anchor }) => ({ key: thread.id, thread, draft: null, anchor }));
    if (open && "draft" in open && open.draft.slide === slideId) items.push({ key: "draft", thread: null, draft: open.draft, anchor: open.draft.addr });
    const taken = new Map<string, number>();
    const next = items.map((it) => {
      const el = it.anchor ? f.querySelector<HTMLElement>(`[data-od="${it.anchor}"]`) : null;
      const r = el?.getBoundingClientRect() ?? fr;
      // Several threads on one element line up leftwards from its corner.
      const n = taken.get(it.anchor) ?? 0;
      taken.set(it.anchor, n + 1);
      // Just outside the element's top right corner, clear of its resize handles; a slide's thread sits inside its corner.
      const x = Math.min(fr.width - PIN / 2, Math.max(PIN / 2, r.right - fr.left + (it.anchor ? PIN / 2 + 4 : -PIN) - n * (PIN + 4)));
      const y = Math.min(fr.height - PIN / 2, Math.max(PIN / 2, r.top - fr.top + (it.anchor ? -PIN / 2 : PIN)));
      return { key: it.key, thread: it.thread, draft: it.draft, x, y };
    });
    setPins((prev) => (JSON.stringify(prev.map((p) => [p.key, p.x, p.y, p.thread?.comments.length])) === JSON.stringify(next.map((p) => [p.key, p.x, p.y, p.thread?.comments.length])) && prev.every((p, i) => p.thread === next[i]!.thread) ? prev : next));
  }, [frame, slideId, measure, threads, open]);

  const openKey = open ? ("draft" in open ? "draft" : open.thread) : null;
  const active = pins.find((p) => p.key === openKey) ?? null;

  return (
    <>
      <div className="cm-pins">
        {pins.map((p) => (
          <button
            key={p.key}
            className={`cm-pin${p.key === openKey ? " open" : ""}`}
            style={{ left: p.x - PIN / 2, top: p.y - PIN / 2 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => openThread(p.key === openKey || !p.thread ? null : p.thread.id)}
            aria-label={p.thread ? `Comment thread, ${p.thread.comments.length} ${p.thread.comments.length === 1 ? "comment" : "comments"}` : "New comment"}
            aria-expanded={p.key === openKey}
            data-pin={p.key}
          >
            {p.thread ? p.thread.comments.length : <Icon name="chat" size={12} />}
          </button>
        ))}
      </div>
      {active && <ThreadPopover key={active.key} pinKey={active.key} thread={active.thread} draft={active.draft} />}
    </>
  );
}

/** The open thread, beside its pin: to its right if there's room, else to its left; always inside the window. */
function ThreadPopover({ pinKey, thread, draft }: { pinKey: string; thread: Thread | null; draft: Draft | null }) {
  const working = useComments((s) => (thread ? s.working[thread.id] : undefined));
  const ask = useComments((s) => s.askAssistant);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const place = () => {
      const pin = document.querySelector<HTMLElement>(`[data-pin="${pinKey}"]`);
      const box = ref.current;
      if (!pin || !box) return;
      const p = pin.getBoundingClientRect();
      const w = box.offsetWidth;
      const h = box.offsetHeight;
      const left = p.right + 8 + w <= window.innerWidth - 8 ? p.right + 8 : Math.max(8, p.left - 8 - w);
      const top = Math.min(Math.max(8, p.top - 8), window.innerHeight - 8 - h);
      setPos((o) => (o && o.left === left && o.top === top ? o : { left, top }));
    };
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener("resize", place);
    return () => (ro.disconnect(), window.removeEventListener("resize", place));
  });

  // A click anywhere else closes the thread; a click on another pin opens that one instead.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (ref.current?.contains(t) || t?.closest(".cm-pin, .menu")) return;
      openThread(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);

  return (
    <div ref={ref} className="cm-thread" style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}>
      {/* Focus once placed: a hidden field can't take focus. */}
      {pos && (
        <ThreadCard
          thread={thread}
          working={working}
          askAssistant={ask}
          onAskAssistant={setAskAssistant}
          onSend={(text) => addComment(thread ? { thread: thread.id } : { draft: draft! }, text)}
          onResolve={thread ? () => resolveThread(thread.id) : undefined}
          onDelete={thread ? () => deleteThread(thread.id) : undefined}
          onClose={() => openThread(null)}
        />
      )}
    </div>
  );
}

export const COMMENT_SHORTCUT = shortcut("Mod+Alt+M");
