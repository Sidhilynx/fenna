import { useEffect, useRef, useState } from "react";
import { setSection } from "@opendeck/format";
import {
  addSlide,
  deleteSlides,
  duplicateSlides,
  editIndex,
  getState,
  goTo,
  moveSlides,
  setState,
  toggleSkip,
  useEditor,
} from "./editor/store.ts";
import { SlideView } from "./SlideView.tsx";
import { Icon, Menu, type MenuEntry, shortcut } from "@opendeck/shell";
import "./strip.css";

const THUMB = 136;
/** A slide changed from outside rings in the strip if it changed this recently. */
const TOUCH_MS = 2000;

function typingIn(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el?.closest?.("input, textarea, select, [contenteditable='true']");
}

interface DragState {
  movingIds: string[];
  dropIndex: number;
  lineTop: number;
}

/** The thumbnail column: every slide, its number, and its section headings. */
export function SlideStrip({ onAddSlide }: { onAddSlide(): void }) {
  const deck = useEditor((s) => s.deck);
  const current = useEditor((s) => s.current);
  const slideSelection = useEditor((s) => s.slideSelection);
  const remote = useEditor((s) => s.remote);
  const ref = useRef<HTMLElement>(null);
  const leadRef = useRef<number>(current);

  const pointerDownRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    id: string;
    index: number;
    shift: boolean;
    ctrl: boolean;
    dragging: boolean;
  } | null>(null);

  const scrollSpeedRef = useRef(0);
  const lastPointerYRef = useRef(0);
  const dragStateRef = useRef<DragState | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const [menuAnchor, setMenuAnchor] = useState<{
    id: string;
    anchor: HTMLElement | { x: number; y: number };
  } | null>(null);

  const [editingSection, setEditingSection] = useState<{
    slideId: string;
    initial: string;
  } | null>(null);

  useEffect(() => {
    leadRef.current = current;
  }, [current]);

  // Keep the current slide in view as it changes (keys, new slides, the AI adding one).
  useEffect(() => {
    if (!dragState) {
      ref.current?.querySelector(".thumb.current")?.scrollIntoView({ block: "nearest" });
    }
  }, [current, deck?.slides.length, dragState !== null]);

  const updateDropTarget = (pointerY: number) => {
    const ds = dragStateRef.current;
    if (!ds || !deck) return;
    const stripEl = ref.current;
    if (!stripEl) return;

    const order = deck.slides.map((s) => s.id);
    const rest = order.filter((id) => !ds.movingIds.includes(id));
    if (rest.length === 0) return;

    let dropIndex = rest.length;
    for (let i = 0; i < rest.length; i++) {
      const el = stripEl.querySelector(`[data-slide-id="${rest[i]}"]`) as HTMLElement | null;
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (pointerY < mid) {
        dropIndex = i;
        break;
      }
    }

    const stripRect = stripEl.getBoundingClientRect();
    let lineTop = 0;
    if (dropIndex < rest.length) {
      const targetEl = stripEl.querySelector(`[data-slide-id="${rest[dropIndex]}"]`) as HTMLElement | null;
      if (targetEl) {
        const r = targetEl.getBoundingClientRect();
        lineTop = r.top - stripRect.top + stripEl.scrollTop - 1;
      }
    } else {
      const lastEl = stripEl.querySelector(`[data-slide-id="${rest[rest.length - 1]}"]`) as HTMLElement | null;
      if (lastEl) {
        const r = lastEl.getBoundingClientRect();
        lineTop = r.bottom - stripRect.top + stripEl.scrollTop + 1;
      }
    }

    const nextState = { ...ds, dropIndex, lineTop };
    dragStateRef.current = nextState;
    setDragState(nextState);
  };

  const checkAutoScroll = (pointerY: number) => {
    const stripEl = ref.current;
    if (!stripEl) return;
    const rect = stripEl.getBoundingClientRect();
    const EDGE = 40;
    const topDist = pointerY - rect.top;
    const bottomDist = rect.bottom - pointerY;

    if (topDist < EDGE) {
      const intensity = Math.max(0, (EDGE - topDist) / EDGE);
      scrollSpeedRef.current = -Math.max(2, Math.round(intensity * 10));
    } else if (bottomDist < EDGE) {
      const intensity = Math.max(0, (EDGE - bottomDist) / EDGE);
      scrollSpeedRef.current = Math.max(2, Math.round(intensity * 10));
    } else {
      scrollSpeedRef.current = 0;
    }
  };

  useEffect(() => {
    if (!dragState) return;
    let rafId: number;
    const tick = () => {
      if (scrollSpeedRef.current !== 0 && ref.current) {
        ref.current.scrollTop += scrollSpeedRef.current;
        updateDropTarget(lastPointerYRef.current);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      scrollSpeedRef.current = 0;
    };
  }, [dragState !== null]);

  const handlePointerDown = (e: React.PointerEvent, id: string, index: number) => {
    if (e.button !== 0) return;
    if (
      (e.target as HTMLElement).closest(".thumb-more-btn") ||
      (e.target as HTMLElement).closest(".strip-section-input")
    ) {
      return;
    }

    try {
      ref.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    pointerDownRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      id,
      index,
      shift: e.shiftKey,
      ctrl: e.metaKey || e.ctrlKey,
      dragging: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const pd = pointerDownRef.current;
    if (!pd || pd.pointerId !== e.pointerId || !deck) return;

    if (!pd.dragging) {
      const dist = Math.hypot(e.clientX - pd.startX, e.clientY - pd.startY);
      if (dist > 4) {
        pd.dragging = true;
        const curSel = getState().slideSelection;
        const movingIds = curSel.includes(pd.id)
          ? deck.slides.filter((s) => curSel.includes(s.id)).map((s) => s.id)
          : [pd.id];
        if (!curSel.includes(pd.id)) {
          setState({ slideSelection: [pd.id] });
        }
        const initial = { movingIds, dropIndex: pd.index, lineTop: 0 };
        dragStateRef.current = initial;
        setDragState(initial);
      } else {
        return;
      }
    }

    lastPointerYRef.current = e.clientY;
    updateDropTarget(e.clientY);
    checkAutoScroll(e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const pd = pointerDownRef.current;
    if (!pd || pd.pointerId !== e.pointerId) return;

    try {
      ref.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    pointerDownRef.current = null;
    scrollSpeedRef.current = 0;

    if (pd.dragging) {
      const ds = dragStateRef.current;
      dragStateRef.current = null;
      setDragState(null);
      if (ds && ds.movingIds.length > 0) {
        void moveSlides(ds.movingIds, ds.dropIndex);
      }
      return;
    }

    if (!deck) return;
    ref.current?.focus();

    if (pd.shift) {
      const min = Math.min(current, pd.index);
      const max = Math.max(current, pd.index);
      const ids = deck.slides.slice(min, max + 1).map((s) => s.id);
      setState({ slideSelection: ids });
      leadRef.current = pd.index;
    } else if (pd.ctrl) {
      const curSel = getState().slideSelection;
      const base = curSel.length ? curSel : (deck.slides[current] ? [deck.slides[current].id] : []);
      const next = base.includes(pd.id) ? base.filter((x) => x !== pd.id) : [...base, pd.id];
      setState({ slideSelection: next });
      leadRef.current = pd.index;
    } else {
      goTo(pd.index);
      setState({ slideSelection: [pd.id] });
      leadRef.current = pd.index;
    }
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    const pd = pointerDownRef.current;
    if (!pd || pd.pointerId !== e.pointerId) return;
    try {
      ref.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    pointerDownRef.current = null;
    scrollSpeedRef.current = 0;
    dragStateRef.current = null;
    setDragState(null);
  };

  const moveUp = (targets: string[]) => {
    if (!deck) return;
    const order = deck.slides.map((s) => s.id);
    const rest = order.filter((id) => !targets.includes(id));
    const firstIdx = Math.min(...targets.map((id) => order.indexOf(id)));
    if (firstIdx > 0) {
      const slideBefore = order[firstIdx - 1]!;
      const to = rest.indexOf(slideBefore);
      void moveSlides(targets, to);
    }
  };

  const moveDown = (targets: string[]) => {
    if (!deck) return;
    const order = deck.slides.map((s) => s.id);
    const rest = order.filter((id) => !targets.includes(id));
    const lastIdx = Math.max(...targets.map((id) => order.indexOf(id)));
    if (lastIdx < order.length - 1) {
      const slideAfter = order[lastIdx + 1]!;
      const to = rest.indexOf(slideAfter) + 1;
      void moveSlides(targets, to);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!deck || deck.slides.length === 0) return;
    const s = getState();
    if (s.selection.length > 0 || s.editing !== null || typingIn(e.target)) return;

    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;

    const getTargetIds = () => {
      const curSel = getState().slideSelection;
      if (curSel.length > 0) {
        return deck.slides.filter((x) => curSel.includes(x.id)).map((x) => x.id);
      }
      const cur = deck.slides[current]?.id;
      return cur ? [cur] : [];
    };

    if (e.altKey && k === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      moveUp(getTargetIds());
      return;
    }
    if (e.altKey && k === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveDown(getTargetIds());
      return;
    }

    if (e.shiftKey && (k === "ArrowUp" || k === "ArrowDown")) {
      e.preventDefault();
      e.stopPropagation();
      const dir = k === "ArrowUp" ? -1 : 1;
      const curLead = leadRef.current ?? current;
      const nextLead = Math.max(0, Math.min(deck.slides.length - 1, curLead + dir));
      leadRef.current = nextLead;
      const min = Math.min(current, nextLead);
      const max = Math.max(current, nextLead);
      const ids = deck.slides.slice(min, max + 1).map((x) => x.id);
      setState({ slideSelection: ids });
      ref.current?.querySelectorAll(".thumb")[nextLead]?.scrollIntoView({ block: "nearest" });
      return;
    }

    if (!mod && !e.altKey && !e.shiftKey && k === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const next = Math.max(0, current - 1);
      goTo(next);
      const nextId = deck.slides[next]?.id;
      if (nextId) setState({ slideSelection: [nextId] });
      leadRef.current = next;
      return;
    }
    if (!mod && !e.altKey && !e.shiftKey && k === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      const next = Math.min(deck.slides.length - 1, current + 1);
      goTo(next);
      const nextId = deck.slides[next]?.id;
      if (nextId) setState({ slideSelection: [nextId] });
      leadRef.current = next;
      return;
    }

    if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      const targets = getTargetIds();
      if (targets.length) void deleteSlides(targets);
      return;
    }

    if (mod && k.toLowerCase() === "d") {
      e.preventDefault();
      e.stopPropagation();
      const targets = getTargetIds();
      if (targets.length) void duplicateSlides(targets);
      return;
    }
  };

  const openMenu = (id: string, anchor: HTMLElement | { x: number; y: number }) => {
    if (!deck) return;
    const curSel = getState().slideSelection;
    if (!curSel.includes(id)) {
      const idx = deck.slides.findIndex((s) => s.id === id);
      if (idx >= 0) goTo(idx);
      setState({ slideSelection: [id] });
    }
    setMenuAnchor({ id, anchor });
  };

  const saveSection = (slideId: string, value: string) => {
    const t = value.trim();
    void editIndex(t ? "Set section" : "Remove section", (idx) => setSection(idx, slideId, t));
    setEditingSection(null);
  };

  if (!deck) return null;
  const sectionAt = new Map(deck.index.sections.map((s) => [s.start, s.title]));

  const getMenuEntries = (clickedId: string): MenuEntry[] => {
    const curSel = getState().slideSelection;
    const targetIds = curSel.includes(clickedId)
      ? deck.slides.filter((s) => curSel.includes(s.id)).map((s) => s.id)
      : [clickedId];

    const allHidden = targetIds.every(
      (id) => deck.slides.find((s) => s.id === id)?.slide?.attrs.hidden !== undefined,
    );

    const order = deck.slides.map((s) => s.id);
    const firstIdx = Math.min(...targetIds.map((id) => order.indexOf(id)));
    const lastIdx = Math.max(...targetIds.map((id) => order.indexOf(id)));
    const canMoveUp = firstIdx > 0;
    const canMoveDown = lastIdx < order.length - 1;

    return [
      {
        label: targetIds.length > 1 ? "Duplicate slides" : "Duplicate slide",
        shortcut: shortcut("Mod+D"),
        onSelect: () => void duplicateSlides(targetIds),
      },
      {
        label: "Copy link to slide",
        onSelect: () => {
          const idx = deck.slides.findIndex((s) => s.id === clickedId);
          if (idx >= 0) void navigator.clipboard.writeText(`#slide-${idx + 1}`);
        },
      },
      {
        label: allHidden
          ? targetIds.length > 1
            ? "Show slides"
            : "Show slide"
          : targetIds.length > 1
            ? "Skip slides"
            : "Skip slide",
        onSelect: () => void toggleSkip(targetIds),
      },
      "separator",
      {
        label: "Add slide after",
        onSelect: () => {
          const lastTargetIdx = Math.max(
            ...targetIds.map((id) => deck.slides.findIndex((s) => s.id === id)),
          );
          void addSlide(undefined, lastTargetIdx);
        },
      },
      {
        label: "Start a section here",
        onSelect: () => {
          const firstId = targetIds[0] ?? clickedId;
          const existing = sectionAt.get(firstId) ?? "";
          setEditingSection({ slideId: firstId, initial: existing });
        },
      },
      {
        label: "Move up",
        disabled: !canMoveUp,
        onSelect: () => moveUp(targetIds),
      },
      {
        label: "Move down",
        disabled: !canMoveDown,
        onSelect: () => moveDown(targetIds),
      },
      "separator",
      {
        label: targetIds.length > 1 ? "Delete slides" : "Delete slide",
        danger: true,
        shortcut: shortcut("Backspace"),
        onSelect: () => void deleteSlides(targetIds),
      },
    ];
  };

  return (
    <nav
      ref={ref}
      className="strip"
      tabIndex={0}
      aria-label="Slides"
      onKeyDown={handleKeyDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {deck.slides.map((s, i) => {
        const section = sectionAt.get(s.id);
        const broken = s.diagnostics.some((d) => d.severity === "error");
        const hidden = s.slide?.attrs.hidden !== undefined;
        const isSelected = slideSelection.includes(s.id);
        const isDragging = dragState?.movingIds.includes(s.id);
        const isEditingSection = editingSection?.slideId === s.id;

        return (
          <div key={s.id} data-slide-id={s.id}>
            {isEditingSection ? (
              <input
                ref={(input) => {
                  if (input) {
                    input.focus();
                    input.select();
                  }
                }}
                className="strip-section-input"
                defaultValue={editingSection.initial}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    saveSection(s.id, e.currentTarget.value);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditingSection(null);
                  }
                }}
                onBlur={(e) => {
                  const val = e.currentTarget.value.trim();
                  if (val !== editingSection.initial) {
                    saveSection(s.id, val);
                  } else {
                    setEditingSection(null);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              />
            ) : section ? (
              <div
                className="strip-section"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingSection({ slideId: s.id, initial: section });
                }}
              >
                {section}
              </div>
            ) : null}
            <div
              role="button"
              tabIndex={-1}
              className={`thumb${i === current ? " current" : ""}${isSelected ? " selected" : ""}${hidden ? " skipped" : ""}${isDragging ? " dragging" : ""}`}
              aria-current={i === current}
              aria-selected={isSelected}
              title={broken ? "This slide has problems" : undefined}
              onPointerDown={(e) => handlePointerDown(e, s.id, i)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openMenu(s.id, { x: e.clientX, y: e.clientY });
              }}
            >
              <span className="thumb-num">{i + 1}</span>
              <span
                // A new key per change restarts the ring.
                key={remote?.slideId === s.id ? remote.at : 0}
                className={`thumb-img${remote?.slideId === s.id && i !== current && Date.now() - remote.at < TOUCH_MS ? " touched" : ""}`}
              >
                {s.slide ? (
                  <SlideView slide={s.slide} theme={deck.index.theme} width={THUMB} />
                ) : (
                  <span className="thumb-broken" style={{ width: THUMB }} />
                )}
                {broken && <span className="thumb-flag" aria-label="has problems" />}
                <button
                  type="button"
                  className="icon-btn thumb-more-btn"
                  aria-label="Slide actions"
                  title="Slide actions"
                  aria-expanded={menuAnchor?.id === s.id}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    openMenu(s.id, e.currentTarget);
                  }}
                >
                  <Icon name="dots" size={14} />
                </button>
              </span>
            </div>
          </div>
        );
      })}

      {dragState && <div className="strip-drop-line" style={{ top: dragState.lineTop }} aria-hidden />}

      <button className="strip-add" onClick={onAddSlide} aria-label="Add slide">
        <Icon name="plus" size={14} />
        <span>Add slide</span>
      </button>

      {menuAnchor && (
        <Menu
          entries={getMenuEntries(menuAnchor.id)}
          anchor={menuAnchor.anchor}
          align="end"
          label="Slide actions"
          onClose={() => setMenuAnchor(null)}
        />
      )}
    </nav>
  );
}
