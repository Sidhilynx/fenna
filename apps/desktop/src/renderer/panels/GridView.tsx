import { type DragEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import type { LoadedDeck, LoadedSlide } from "@opendeck/format";
import { setSection } from "@opendeck/format";
import {
  deleteSlides,
  duplicateSlides,
  editIndex,
  goTo,
  moveSlides,
  setState,
  setView,
  toggleSkip,
  useEditor,
} from "../editor/store.ts";
import { FitSlide } from "../SlideView.tsx";
import { Menu, type MenuEntry, shortcut } from "@opendeck/shell";
import "./grid.css";

interface SlideItem {
  slide: LoadedSlide;
  globalIndex: number;
}

interface SectionGroup {
  section?: { title: string; start: string };
  slides: SlideItem[];
}

interface DropTarget {
  index: number;
  position: "before" | "after";
}

interface MenuState {
  x: number;
  y: number;
  slideId: string;
  slideIndex: number;
  targetIds: string[];
}

function groupSlidesBySection(deck: LoadedDeck): SectionGroup[] {
  const allSlides: SlideItem[] = deck.slides.map((slide, globalIndex) => ({
    slide,
    globalIndex,
  }));

  const validSections = [...deck.index.sections]
    .map((sec) => ({ sec, index: deck.slides.findIndex((s) => s.id === sec.start) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index);

  if (validSections.length === 0) {
    return allSlides.length > 0 ? [{ slides: allSlides }] : [];
  }

  const groups: SectionGroup[] = [];
  const firstSectionStart = validSections[0]!.index;

  if (firstSectionStart > 0) {
    groups.push({
      slides: allSlides.slice(0, firstSectionStart),
    });
  }

  for (let i = 0; i < validSections.length; i++) {
    const current = validSections[i]!;
    const nextStart = i + 1 < validSections.length ? validSections[i + 1]!.index : allSlides.length;
    groups.push({
      section: current.sec,
      slides: allSlides.slice(current.index, nextStart),
    });
  }

  return groups;
}

export function GridView() {
  const deck = useEditor((s) => s.deck);
  const current = useEditor((s) => s.current);
  const slideSelection = useEditor((s) => s.slideSelection);

  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<number | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const [draggingIds, setDraggingIds] = useState<string[] | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [menuState, setMenuState] = useState<MenuState | null>(null);

  const draggingIdsRef = useRef<string[] | null>(null);
  draggingIdsRef.current = draggingIds;
  const dropTargetRef = useRef<DropTarget | null>(null);
  dropTargetRef.current = dropTarget;

  const dragStartRef = useRef<{ x: number; y: number; index: number; id: string } | null>(null);
  const isDraggingMouseRef = useRef(false);
  const wasDraggingRef = useRef(false);

  useEffect(() => {
    if (editingSection && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSection]);

  useEffect(() => {
    containerRef.current
      ?.querySelector(`[data-slide-index="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current, deck?.slides.length]);

  // Mouse move and up listeners for pointer drag support
  useEffect(() => {
    if (!deck) return;

    const onMouseMove = (e: globalThis.MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;

      if (!isDraggingMouseRef.current) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) {
          isDraggingMouseRef.current = true;
          const moving =
            slideSelection.includes(start.id) && slideSelection.length > 0
              ? slideSelection
              : [start.id];
          setDraggingIds(moving);
        }
      }

      if (isDraggingMouseRef.current) {
        const item = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest<HTMLElement>("[data-slide-index]");
        if (item) {
          const index = Number(item.getAttribute("data-slide-index"));
          const rect = item.getBoundingClientRect();
          const isBefore = e.clientX < rect.left + rect.width / 2;
          const pos = isBefore ? "before" : "after";
          if (dropTargetRef.current?.index !== index || dropTargetRef.current?.position !== pos) {
            setDropTarget({ index, position: pos });
          }
        }
      }
    };

    const onMouseUp = () => {
      if (isDraggingMouseRef.current) {
        wasDraggingRef.current = true;
        const target = dropTargetRef.current;
        const moving = draggingIdsRef.current;
        if (target && moving && moving.length > 0) {
          const allIds = deck.slides.map((s) => s.id);
          const slot = target.position === "before" ? target.index : target.index + 1;
          const movingSet = new Set(moving);
          const to = allIds.slice(0, slot).filter((id) => !movingSet.has(id)).length;
          void moveSlides(moving, to);
        }
        isDraggingMouseRef.current = false;
        setDraggingIds(null);
        setDropTarget(null);
      }
      dragStartRef.current = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [deck, slideSelection]);

  // Keyboard navigation
  useEffect(() => {
    if (!deck) return;

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector(".dialog")) return;

      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;

      if (menuState !== null) {
        if (k === "Escape") {
          e.preventDefault();
          setMenuState(null);
        }
        return;
      }

      const targetIds =
        slideSelection.length > 0
          ? slideSelection
          : deck.slides[current]
            ? [deck.slides[current].id]
            : [];

      if (k === "Escape") {
        e.preventDefault();
        if (editingSection !== null) {
          setEditingSection(null);
        } else {
          setView("edit");
        }
        return;
      }

      if (k === "Enter") {
        e.preventDefault();
        goTo(current);
        setView("edit");
        return;
      }

      if (mod && k.toLowerCase() === "d") {
        e.preventDefault();
        if (targetIds.length > 0) void duplicateSlides(targetIds);
        return;
      }

      if (k === "Delete" || k === "Backspace") {
        e.preventDefault();
        if (targetIds.length > 0) void deleteSlides(targetIds);
        return;
      }

      if (k === "ArrowLeft") {
        e.preventDefault();
        if (current > 0) {
          const next = current - 1;
          setState({ current: next, slideSelection: [deck.slides[next]!.id] });
          anchorRef.current = next;
        }
        return;
      }

      if (k === "ArrowRight") {
        e.preventDefault();
        if (current < deck.slides.length - 1) {
          const next = current + 1;
          setState({ current: next, slideSelection: [deck.slides[next]!.id] });
          anchorRef.current = next;
        }
        return;
      }

      if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;
        const items = Array.from(container.querySelectorAll<HTMLElement>("[data-slide-index]"));
        const currentEl = container.querySelector<HTMLElement>(`[data-slide-index="${current}"]`);
        if (!currentEl) return;
        const currentRect = currentEl.getBoundingClientRect();
        const currentCenterX = (currentRect.left + currentRect.right) / 2;

        if (k === "ArrowDown") {
          const below = items
            .map((elem) => ({
              index: Number(elem.getAttribute("data-slide-index")),
              rect: elem.getBoundingClientRect(),
            }))
            .filter((item) => item.rect.top > currentRect.top + 10);

          if (below.length > 0) {
            const minTop = Math.min(...below.map((b) => b.rect.top));
            const nextRow = below.filter((b) => Math.abs(b.rect.top - minTop) < 20);
            nextRow.sort((a, b) => {
              const distA = Math.abs((a.rect.left + a.rect.right) / 2 - currentCenterX);
              const distB = Math.abs((b.rect.left + b.rect.right) / 2 - currentCenterX);
              return distA - distB;
            });
            const target = nextRow[0]!.index;
            setState({ current: target, slideSelection: [deck.slides[target]!.id] });
            anchorRef.current = target;
          }
        } else {
          const above = items
            .map((elem) => ({
              index: Number(elem.getAttribute("data-slide-index")),
              rect: elem.getBoundingClientRect(),
            }))
            .filter((item) => item.rect.bottom < currentRect.bottom - 10);

          if (above.length > 0) {
            const maxBottom = Math.max(...above.map((a) => a.rect.bottom));
            const prevRow = above.filter((a) => Math.abs(a.rect.bottom - maxBottom) < 20);
            prevRow.sort((a, b) => {
              const distA = Math.abs((a.rect.left + a.rect.right) / 2 - currentCenterX);
              const distB = Math.abs((b.rect.left + b.rect.right) / 2 - currentCenterX);
              return distA - distB;
            });
            const target = prevRow[0]!.index;
            setState({ current: target, slideSelection: [deck.slides[target]!.id] });
            anchorRef.current = target;
          }
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, deck, slideSelection, editingSection, menuState]);

  if (!deck) return <div className="grid-view" />;

  if (deck.slides.length === 0) {
    return (
      <div className="grid-view">
        <div className="empty">
          <p>This deck has no slides yet.</p>
        </div>
      </div>
    );
  }

  const groups = groupSlidesBySection(deck);

  const commitTitle = (startId: string, title: string) => {
    if (editingSection === null) return;
    setEditingSection(null);
    const trimmed = title.trim();
    const currentSection = deck.index.sections.find((s) => s.start === startId);
    if (currentSection && currentSection.title === trimmed) return;
    void editIndex(trimmed ? "Rename section" : "Remove section", (idx) =>
      setSection(idx, startId, trimmed),
    );
  };

  const handleClick = (e: MouseEvent, index: number, id: string) => {
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (e.shiftKey) {
      const anchor = anchorRef.current ?? current;
      const start = Math.min(anchor, index);
      const end = Math.max(anchor, index);
      const range = deck.slides.slice(start, end + 1).map((s) => s.id);
      setState({ slideSelection: range, current: index });
    } else if (mod) {
      const base = slideSelection.length > 0 ? slideSelection : [deck.slides[current]?.id ?? id];
      const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      setState({ slideSelection: next, current: index });
      anchorRef.current = index;
    } else {
      setState({ current: index, slideSelection: [id] });
      anchorRef.current = index;
    }
  };

  const handleDoubleClick = (index: number) => {
    goTo(index);
    setView("edit");
  };

  const handleContextMenu = (e: MouseEvent, index: number, id: string) => {
    e.preventDefault();
    e.stopPropagation();

    let targetIds = slideSelection;
    if (!slideSelection.includes(id)) {
      targetIds = [id];
      setState({ current: index, slideSelection: targetIds });
      anchorRef.current = index;
    }

    setMenuState({
      x: e.clientX,
      y: e.clientY,
      slideId: id,
      slideIndex: index,
      targetIds,
    });
  };

  const handleMouseDown = (e: MouseEvent, index: number, id: string) => {
    if (e.button !== 0 || editingSection !== null) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY, index, id };
    isDraggingMouseRef.current = false;
  };

  const handleDragStart = (e: DragEvent, id: string) => {
    if (editingSection !== null) {
      e.preventDefault();
      return;
    }
    const moving = slideSelection.includes(id) && slideSelection.length > 0 ? slideSelection : [id];
    setDraggingIds(moving);
    e.dataTransfer.setData("application/json", JSON.stringify(moving));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: DragEvent, globalIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const isBefore = e.clientX < rect.left + rect.width / 2;
    const pos = isBefore ? "before" : "after";
    if (dropTarget?.index !== globalIndex || dropTarget?.position !== pos) {
      setDropTarget({ index: globalIndex, position: pos });
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    if (!draggingIds || draggingIds.length === 0) {
      setDropTarget(null);
      setDraggingIds(null);
      return;
    }
    const allIds = deck.slides.map((s) => s.id);
    let slot: number;
    if (dropTarget) {
      slot = dropTarget.position === "before" ? dropTarget.index : dropTarget.index + 1;
    } else {
      slot = allIds.length;
    }
    const movingSet = new Set(draggingIds);
    const to = allIds.slice(0, slot).filter((id) => !movingSet.has(id)).length;
    void moveSlides(draggingIds, to);
    setDropTarget(null);
    setDraggingIds(null);
  };

  const handleDragEnd = () => {
    setDropTarget(null);
    setDraggingIds(null);
  };

  const getMenuEntries = (): MenuEntry[] => {
    if (!menuState) return [];
    const isAllHidden = menuState.targetIds.every(
      (id) => deck.slides.find((s) => s.id === id)?.slide?.attrs.hidden !== undefined,
    );
    const hasSectionAtCurrent = deck.index.sections.some((sec) => sec.start === menuState.slideId);

    return [
      {
        label: "Open",
        onSelect: () => {
          goTo(menuState.slideIndex);
          setView("edit");
        },
      },
      {
        label: "Duplicate",
        shortcut: shortcut("Mod+D"),
        onSelect: () => {
          void duplicateSlides(menuState.targetIds);
        },
      },
      {
        label: isAllHidden ? "Show slide" : "Skip slide",
        onSelect: () => {
          void toggleSkip(menuState.targetIds);
        },
      },
      "separator",
      {
        label: "Start a section here",
        disabled: hasSectionAtCurrent,
        onSelect: () => {
          const id = menuState.slideId;
          void editIndex("Add section", (idx) => setSection(idx, id, "Section"));
          setEditingSection(id);
          setEditingTitle("Section");
        },
      },
      "separator",
      {
        label: "Delete",
        danger: true,
        shortcut: shortcut("Backspace"),
        onSelect: () => {
          void deleteSlides(menuState.targetIds);
        },
      },
    ];
  };

  return (
    <div
      ref={containerRef}
      className="grid-view"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={handleDrop}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDropTarget(null);
        }
      }}
    >
      <div className="grid-content">
        {groups.map((group, groupIdx) => (
          <section
            key={group.section?.start ?? `untitled-${groupIdx}`}
            className="grid-section"
            aria-label={group.section?.title ?? "Untitled section"}
          >
            {group.section && (
              <div className="grid-section-header">
                {editingSection === group.section.start ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    className="grid-section-input"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        commitTitle(group.section!.start, editingTitle);
                      } else if (e.key === "Escape") {
                        setEditingSection(null);
                      }
                      e.stopPropagation();
                    }}
                    onBlur={() => {
                      commitTitle(group.section!.start, editingTitle);
                    }}
                  />
                ) : (
                  <h2
                    className="grid-section-title"
                    onClick={() => {
                      setEditingSection(group.section!.start);
                      setEditingTitle(group.section!.title);
                    }}
                    title="Click to rename"
                  >
                    {group.section.title}
                  </h2>
                )}
              </div>
            )}
            <div className="grid-thumbs">
              {group.slides.map(({ slide: s, globalIndex }) => {
                const isCurrent = globalIndex === current;
                const isSelected = slideSelection.includes(s.id);
                const isSkipped = s.slide?.attrs.hidden !== undefined;
                const hasError = !s.slide || s.diagnostics.some((d) => d.severity === "error");
                const isDragging = draggingIds?.includes(s.id);

                return (
                  <div
                    key={s.id}
                    data-slide-index={globalIndex}
                    className={`grid-item${isCurrent ? " current" : ""}${isSelected ? " selected" : ""}${isDragging ? " dragging" : ""}`}
                    draggable={editingSection === null}
                    onMouseDown={(e) => handleMouseDown(e, globalIndex, s.id)}
                    onDragStart={(e) => handleDragStart(e, s.id)}
                    onDragOver={(e) => handleDragOver(e, globalIndex)}
                    onDragEnd={handleDragEnd}
                    onClick={(e) => handleClick(e, globalIndex, s.id)}
                    onDoubleClick={() => handleDoubleClick(globalIndex)}
                    onContextMenu={(e) => handleContextMenu(e, globalIndex, s.id)}
                    tabIndex={isCurrent ? 0 : -1}
                  >
                    <div
                      className={`grid-thumb${isSkipped ? " skipped" : ""}${isSelected || isCurrent ? " selected" : ""}`}
                    >
                      {s.slide ? (
                        <FitSlide slide={s.slide} theme={deck.index.theme} />
                      ) : (
                        <span className="thumb-broken" />
                      )}
                      {hasError && <span className="grid-thumb-flag" aria-label="has problems" />}
                      {dropTarget?.index === globalIndex && dropTarget.position === "before" && (
                        <div className="grid-insert-bar before" />
                      )}
                      {dropTarget?.index === globalIndex && dropTarget.position === "after" && (
                        <div className="grid-insert-bar after" />
                      )}
                    </div>
                    <div className="grid-thumb-meta">
                      <span className="grid-thumb-num">{globalIndex + 1}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {menuState && (
        <Menu
          anchor={{ x: menuState.x, y: menuState.y }}
          entries={getMenuEntries()}
          onClose={() => setMenuState(null)}
        />
      )}
    </div>
  );
}
