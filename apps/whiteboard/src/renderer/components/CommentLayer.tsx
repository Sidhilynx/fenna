// Comments on the board itself: a pin at each open thread (on its item's
// corner, or the spot it was left at), and the open thread or a new comment
// in a card beside its pin.

import { useEffect, useState } from "react";
import { ThreadCard, userName } from "@opendeck/shell";
import { itemBounds, KIND_LABELS, type BoardItem, type Pt } from "@opendeck/board";
import { comments, type BoardThread } from "../comments.ts";
import { getState, setState, useBoard } from "../store.ts";

/** Where a thread's pin sits on the board. */
export function threadSpot(t: { item?: string; x?: number; y?: number }): Pt | null {
  const s = getState();
  const it = t.item ? s.byId.get(t.item) : undefined;
  const b = it && itemBounds(it, s.byId);
  if (b) return { x: b.x + b.width, y: b.y };
  return t.x !== undefined && t.y !== undefined ? { x: t.x, y: t.y } : null;
}

/** A line saying what a thread is on: "Sticky note · Expand the MCP tools". */
export function threadQuote(t: { item?: string }): string {
  const it: BoardItem | undefined = t.item ? getState().byId.get(t.item) : undefined;
  if (!it) return t.item ? "A deleted item" : "A spot on the board";
  const words = it.kind === "frame" ? it.title : it.kind === "connector" ? (it.label ?? "") : it.kind === "table" ? it.cells[0]!.join(" · ") : "text" in it ? (it.text ?? "") : "";
  const line = words.split("\n")[0]!.trim();
  return line ? `${KIND_LABELS[it.kind]} · ${line.length > 48 ? `${line.slice(0, 47)}…` : line}` : KIND_LABELS[it.kind];
}

export function CommentLayer({ toScreen }: { toScreen: (p: Pt) => Pt }) {
  const threads = comments.use((s) => s.threads);
  const open = comments.use((s) => s.open);
  const working = comments.use((s) => s.working);
  const ask = comments.use((s) => s.askAssistant);
  useBoard((s) => s.byId);
  useBoard((s) => s.view);
  const viewport = useBoard((s) => s.viewport);
  const [me, setMe] = useState("");
  useEffect(() => {
    void userName()
      .then((n) => setMe(n.trim()))
      .catch(() => {});
  }, []);
  const openId = open && "thread" in open ? open.thread : null;
  const draft = open && "draft" in open ? open.draft : null;

  const pins = threads.filter((t) => !t.resolved || t.id === openId);
  const card = (spot: Pt | null, node: React.ReactNode) => {
    if (!spot) return null;
    const p = toScreen(spot);
    const left = Math.min(Math.max(8, p.x + 22), viewport.width - 336);
    const top = Math.min(Math.max(8, p.y - 8), viewport.height - 260);
    return (
      <div className="wb-comment-card" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {node}
      </div>
    );
  };
  const openThread = openId ? threads.find((t) => t.id === openId) : null;

  return (
    <>
      {pins.map((t) => {
        const spot = threadSpot(t);
        if (!spot) return null;
        const p = toScreen(spot);
        const ai = t.comments[0]?.author === "ai";
        const who = ai ? "the AI" : me || "you";
        return (
          <button
            key={t.id}
            className={`wb-pin${t.id === openId ? " on" : ""}${t.resolved ? " resolved" : ""}`}
            style={{ left: p.x, top: p.y }}
            title={t.comments[0]?.text ?? "Comment"}
            aria-label={`Comment by ${who}: ${t.comments[0]?.text ?? ""}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              comments.openThread(t.id === openId ? null : t.id);
              if (t.id !== openId) setState({ panel: "comments" });
            }}
          >
            {t.comments.length > 1 ? t.comments.length : ai ? "AI" : (me.slice(0, 1) || "Y").toUpperCase()}
          </button>
        );
      })}
      {draft &&
        card(
          threadSpot(draft),
          <ThreadCard
            thread={null}
            quote={threadQuote(draft)}
            askAssistant={ask}
            onAskAssistant={comments.setAskAssistant}
            onSend={(text) => {
              const id = comments.add({ draft }, text);
              if (id) comments.openThread(id);
            }}
            onClose={() => comments.openThread(null)}
          />,
        )}
      {openThread &&
        card(
          threadSpot(openThread),
          <ThreadCard
            thread={openThread as BoardThread}
            quote={threadQuote(openThread)}
            working={working[openThread.id]}
            askAssistant={ask}
            onAskAssistant={comments.setAskAssistant}
            onSend={(text) => comments.add({ thread: openThread.id }, text)}
            onResolve={openThread.resolved ? undefined : () => comments.resolve(openThread.id)}
            onDelete={() => comments.remove(openThread.id)}
            onClose={() => comments.openThread(null)}
          />,
        )}
    </>
  );
}
