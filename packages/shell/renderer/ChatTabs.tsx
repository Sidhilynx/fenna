// The assistant column's tab row: one tab per open conversation, New chat,
// and (passed in) the history control. Opening, closing and reordering use
// FLIP so the other tabs slide instead of jumping; the dragged tab follows
// the pointer straight from the event. None of it plays under
// prefers-reduced-motion. After Arsaze's chat tabs.

import { type ReactNode, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./ui/icons.tsx";

const EASE = "cubic-bezier(.2,.8,.2,1)";
const GAP = 2;
const DRAG_START_PX = 3;

export interface ChatTab {
  id: string;
  title: string;
  running: boolean;
}

interface Rect {
  left: number;
  width: number;
}

interface DragState {
  id: string;
  from: number;
  over: number;
  width: number;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ChatTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onReorder,
  onNew,
  trailing,
  locked,
}: {
  tabs: ChatTab[];
  activeId: string;
  onSelect(id: string): void;
  onClose(id: string): void;
  onReorder(ids: string[]): void;
  onNew(): void;
  trailing: ReactNode;
  /** A reply is running: the other tabs and New chat wait for it. */
  locked: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const elsRef = useRef(new Map<string, HTMLDivElement>());
  const lastRects = useRef(new Map<string, Rect>());
  const flipFrom = useRef<Map<string, Rect> | null>(null);
  const [fade, setFade] = useState({ left: false, right: false });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [flipTick, setFlipTick] = useState(0);
  const suppressClick = useRef(false);

  // Positions in the scroller's content space, so scrolling never reads as movement.
  const measure = useCallback((): Map<string, Rect> => {
    const out = new Map<string, Rect>();
    const sc = scrollerRef.current;
    if (!sc) return out;
    const base = sc.getBoundingClientRect().left - sc.scrollLeft;
    elsRef.current.forEach((el, id) => {
      const r = el.getBoundingClientRect();
      out.set(id, { left: r.left - base, width: r.width });
    });
    return out;
  }, []);

  const updateFade = useCallback(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    const left = sc.scrollLeft > 1;
    const right = sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 1;
    setFade((f) => (f.left === left && f.right === right ? f : { left, right }));
  }, []);

  const ids = tabs.map((t) => t.id).join("|");
  useLayoutEffect(() => {
    const next = measure();
    const from = flipFrom.current ?? lastRects.current;
    flipFrom.current = null;
    if (!reducedMotion() && from.size > 0) {
      next.forEach((rect, id) => {
        const el = elsRef.current.get(id);
        const prev = from.get(id);
        if (!el) return;
        if (!prev) el.animate([{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }], { duration: 160, easing: EASE });
        else if (Math.abs(prev.left - rect.left) > 0.5) el.animate([{ transform: `translateX(${prev.left - rect.left}px)` }, { transform: "none" }], { duration: 150, easing: EASE });
      });
    }
    lastRects.current = measure();
    updateFade();
  }, [ids, flipTick, measure, updateFade]);

  useEffect(() => {
    elsRef.current.get(activeId)?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [activeId, ids]);

  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    const ro = new ResizeObserver(() => {
      lastRects.current = measure();
      updateFade();
    });
    ro.observe(sc);
    return () => ro.disconnect();
  }, [measure, updateFade]);

  const startDrag = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-tab-close]")) return;
    // Pressing a tab selects it: the highlight follows the press, not the release.
    onSelect(id);
    if (tabs.length < 2 || locked) return;
    const sc = scrollerRef.current;
    const el = e.currentTarget as HTMLDivElement;
    if (!sc) return;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startScroll = sc.scrollLeft;
    const from = tabs.findIndex((t) => t.id === id);
    const rects = measure();
    const ordered = tabs.map((t) => rects.get(t.id));
    const me = ordered[from];
    if (!me || ordered.some((r) => !r)) return;
    const rs = ordered as Rect[];
    let started = false;
    let over = from;
    let lastX = startX;
    let raf = 0;

    const apply = () => {
      raf = 0;
      const raw = lastX - startX + (sc.scrollLeft - startScroll);
      if (!started) {
        if (Math.abs(raw) < DRAG_START_PX) return;
        started = true;
        try {
          el.setPointerCapture(pointerId);
        } catch {
          /* the window listeners below still follow the pointer */
        }
        setDrag({ id, from, over: from, width: me.width });
      }
      const last = rs[rs.length - 1]!;
      const dx = Math.min(last.left + last.width - (me.left + me.width), Math.max(rs[0]!.left - me.left, raw));
      el.style.transition = "none";
      el.style.transform = `translateX(${dx}px)`;
      const center = me.left + dx + me.width / 2;
      let hover = over;
      rs.forEach((r, i) => {
        if (center >= r.left && center < r.left + r.width) hover = i;
      });
      if (hover !== over) {
        over = hover;
        setDrag({ id, from, over, width: me.width });
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const move = (ev: PointerEvent) => {
      lastX = ev.clientX;
      schedule();
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      sc.removeEventListener("scroll", schedule);
      if (raf) cancelAnimationFrame(raf);
      if (!started) return;
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      // Where every tab looks right now, so they glide into their places.
      flipFrom.current = measure();
      el.style.transform = "";
      el.style.transition = "";
      const order = tabs.map((t) => t.id);
      const [moved] = order.splice(from, 1);
      order.splice(over, 0, moved!);
      setDrag(null);
      setFlipTick((n) => n + 1);
      if (over !== from) onReorder(order);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    sc.addEventListener("scroll", schedule);
  };

  const shiftFor = (index: number): number => {
    if (!drag) return 0;
    const step = drag.width + GAP;
    if (index > drag.from && index <= drag.over) return -step;
    if (index < drag.from && index >= drag.over) return step;
    return 0;
  };

  const mask = fade.left || fade.right ? `linear-gradient(to right, ${fade.left ? "transparent 0, #000 16px" : "#000 0"}, ${fade.right ? "#000 calc(100% - 16px), transparent 100%" : "#000 100%"})` : undefined;

  return (
    <div className="ct">
      <div
        ref={scrollerRef}
        role="tablist"
        aria-label="Chats"
        className="ct-scroll"
        style={{ WebkitMaskImage: mask, maskImage: mask }}
        onScroll={updateFade}
        onWheel={(e) => {
          const sc = scrollerRef.current;
          if (sc && Math.abs(e.deltaY) > Math.abs(e.deltaX)) sc.scrollLeft += e.deltaY;
        }}
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeId;
          const dragging = drag?.id === tab.id;
          const shift = dragging ? 0 : shiftFor(index);
          const waits = locked && !isActive;
          return (
            <div
              key={tab.id}
              ref={(el) => {
                if (el) elsRef.current.set(tab.id, el);
                else elsRef.current.delete(tab.id);
              }}
              role="tab"
              aria-selected={isActive}
              aria-disabled={waits || undefined}
              tabIndex={isActive ? 0 : -1}
              title={waits ? `${tab.title} · opens when the reply finishes` : tab.title}
              className={`ct-tab${isActive ? " active" : ""}${dragging ? " dragging" : ""}`}
              style={{ transform: shift ? `translateX(${shift}px)` : undefined, transition: dragging ? "none" : drag && !reducedMotion() ? `transform 150ms ${EASE}, background-color 120ms, color 120ms` : undefined }}
              onPointerDown={(e) => (waits ? undefined : startDrag(e, tab.id))}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => {
                if (e.button !== 1 || (locked && isActive)) return;
                e.preventDefault();
                onClose(tab.id);
              }}
              onClick={() => {
                if (!suppressClick.current && !waits) onSelect(tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const to = tabs[index + (e.key === "ArrowRight" ? 1 : -1)];
                  if (to) elsRef.current.get(to.id)?.focus();
                } else if ((e.key === "Enter" || e.key === " ") && !waits) {
                  e.preventDefault();
                  onSelect(tab.id);
                } else if (e.key === "Delete" && !(locked && isActive)) {
                  e.preventDefault();
                  onClose(tab.id);
                }
              }}
            >
              <span className={`ct-status${tab.running ? " on" : ""}`} aria-hidden>
                {tab.running && <span className="ct-spin" />}
              </span>
              <span className="ct-title">{tab.title}</span>
              <button
                type="button"
                data-tab-close
                tabIndex={-1}
                className="ct-close"
                disabled={locked && isActive}
                aria-label={`Close ${tab.title}`}
                title={locked && isActive ? "Stop the reply or let it finish first" : "Close"}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <Icon name="close" size={10} />
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="ct-btn" onClick={onNew} disabled={locked} title={locked ? "New chat · when the reply finishes" : "New chat"} aria-label="New chat">
        <Icon name="plus" />
      </button>
      {trailing}
    </div>
  );
}
