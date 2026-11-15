// Comments on the canvas itself: a pin at each open thread (on its layer's
// corner, or its artboard's), and the open thread or a new comment in a card
// beside its pin.

import { useEffect, useState } from "react";
import { ThreadCard, userName } from "@opendeck/shell";
import type { DesignAnchor } from "@opendeck/artboard";
import { comments, threadQuote, threadTarget, type DesignThread } from "../comments.ts";
import { boardRect, setState, useDesign, type Rect } from "../store.ts";

interface Props {
  /** A layer's box as drawn, in the canvas's pixels. */
  layerBox(file: string, address: string): Rect | null;
  toScreen(r: Rect): Rect;
}

export function CommentLayer({ layerBox, toScreen }: Props) {
  const threads = comments.use((s) => s.threads);
  const open = comments.use((s) => s.open);
  const working = comments.use((s) => s.working);
  const ask = comments.use((s) => s.askAssistant);
  const page = useDesign((s) => s.page);
  const index = useDesign((s) => s.index);
  useDesign((s) => s.boards);
  useDesign((s) => s.view);
  useDesign((s) => s.heights);
  const viewport = useDesign((s) => s.viewport);
  const [me, setMe] = useState("");
  useEffect(() => {
    void userName()
      .then((n) => setMe(n.trim()))
      .catch(() => {});
  }, []);
  const openId = open && "thread" in open ? open.thread : null;
  const draft = open && "draft" in open ? open.draft : null;

  /** Where a thread's pin sits: the top right corner of its layer, or of its artboard. */
  const spot = (t: DesignAnchor): { x: number; y: number } | null => {
    if (index.boards[t.file]?.page !== page) return null;
    const at = threadTarget(t);
    const box = (at?.address ? layerBox(t.file, at.address) : null) ?? (boardRect(t.file) ? toScreen(boardRect(t.file)!) : null);
    return box ? { x: box.x + box.w, y: box.y } : null;
  };
  const card = (p: { x: number; y: number } | null, node: React.ReactNode) => {
    if (!p) return null;
    const left = Math.min(Math.max(8, p.x + 22), viewport.width - 336);
    const top = Math.min(Math.max(8, p.y - 8), viewport.height - 260);
    return (
      <div className="dg-comment-card" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
        {node}
      </div>
    );
  };
  const openThread = openId ? threads.find((t) => t.id === openId) : null;

  return (
    <>
      {threads
        .filter((t) => !t.resolved || t.id === openId)
        .map((t) => {
          const p = spot(t);
          if (!p) return null;
          const ai = t.comments[0]?.author === "ai";
          return (
            <button
              key={t.id}
              className={`dg-pin${t.id === openId ? " on" : ""}${t.resolved ? " resolved" : ""}`}
              style={{ left: p.x, top: p.y }}
              title={t.comments[0]?.text ?? "Comment"}
              aria-label={`Comment by ${ai ? "the AI" : me || "you"}: ${t.comments[0]?.text ?? ""}`}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
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
          spot(draft),
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
          spot(openThread),
          <ThreadCard
            thread={openThread as DesignThread}
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
