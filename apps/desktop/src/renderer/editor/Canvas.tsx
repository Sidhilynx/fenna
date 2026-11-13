// The editing stage: the current slide, fitted or zoomed, with selection,
// hover, drag-to-move, resize handles, snapping guides, marquee selection,
// text editing in place, and the right-click menu.
//
// Live feedback during a drag or resize changes the rendered DOM directly
// (no re-render per frame); the edit is committed once, on release, as one
// undo step.
//
// While the assistant works, its cursor is on the slide: it waits where it
// last was while the AI thinks, and visits each element as a change lands.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type ElementNode, SLIDE_HEIGHT, SLIDE_WIDTH, elementChildren, getAt, getStyle, parentAddress, setContent, setStyles } from "@opendeck/format";
import { CommentLayer, COMMENT_SHORTCUT } from "../panels/CommentLayer.tsx";
import { SlideNotes } from "../panels/NotesPanel.tsx";
import { Icon, Menu, type MenuEntry, shortcut } from "@opendeck/shell";
import { LiveSlide } from "./LiveSlide.tsx";
import type { MotionHooks } from "./motion.ts";
import { type Guide, type Rect, slideRect, snapBox, snapLines } from "./geometry.ts";
import { editTarget, labelOf, pickAddress } from "./selection.ts";
import { cleanInline, cleanList, placeCaret, selectAllIn } from "./textEdit.ts";
import * as cmd from "./commands.ts";
import { newComment } from "./comments.ts";
import { currentSlide, editSlide, endEditing, getState, select, setState, useEditor } from "./store.ts";
import { FormatBar, shouldShowFormatBar } from "./FormatBar.tsx";
const PAD = 48;
/** Room under the fitted slide for its speaker notes. */
const NOTES_ROOM = 56;
type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const TEXT_TAGS = new Set(["h1", "h2", "h3", "p", "ul", "ol"]);

interface Drag {
  kind: "move" | "resize" | "marquee";
  startX: number;
  startY: number;
  moved: boolean;
  handle?: Handle;
  items: { addr: string; dom: HTMLElement; left: number; top: number; width: number; height: number; el: ElementNode }[];
  union?: Rect;
  lines?: { x: number[]; y: number[] };
  aspect?: number;
}

export function Canvas() {
  const loaded = useEditor((s) => currentSlide(s));
  const theme = useEditor((s) => s.deck?.index.theme ?? null);
  const selection = useEditor((s) => s.selection);
  const editing = useEditor((s) => s.editing);
  const zoom = useEditor((s) => s.zoom);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [tick, setTick] = useState(0);
  const [boxes, setBoxes] = useState<{ addr: string; r: Rect }[]>([]);
  const [hover, setHover] = useState<Rect | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  const slide = loaded?.slide ?? null;
  const remote = useEditor((s) => s.remote);
  const agent = useEditor((s) => s.agent);
  /** Where the AI's cursor points (slide px), and whether a change is still animating. */
  const [aiAt, setAiAt] = useState<Rect | null>(null);
  const [animating, setAnimating] = useState(false);
  const aiName = useRef("");
  if (agent) aiName.current = agent.name;
  const settleRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const showNotes = useEditor((s) => s.notes);
  const notesRoom = showNotes ? NOTES_ROOM : 0;
  const fit = Math.max(0.05, Math.min((stage.w - PAD * 2) / SLIDE_WIDTH, (stage.h - PAD * 2 - notesRoom) / SLIDE_HEIGHT));
  const scale = zoom === "fit" ? fit : zoom;
  useEffect(() => {
    if (getState().fitScale !== fit) setState({ fitScale: fit });
  }, [fit]);

  const section = useCallback(() => frameRef.current?.querySelector<HTMLElement>(".od-slide") ?? null, []);
  const domAt = useCallback((addr: string) => frameRef.current?.querySelector<HTMLElement>(`[data-od="${addr}"]`) ?? null, []);

  // A changed slide or selection makes the hover box stale; the next pointer move redraws it.
  useEffect(() => setHover(null), [slide, selection]);

  const motionHooks = useMemo<MotionHooks>(
    () => ({
      cursor: (el) => {
        const sec = section();
        if (!el || !sec || !el.isConnected) return;
        setAnimating(true);
        setAiAt(slideRect(el, sec, sec.getBoundingClientRect().width / SLIDE_WIDTH));
      },
      settled: () => {
        setAnimating(false);
        setTick((t) => t + 1);
      },
    }),
    [section],
  );
  // On another slide, the cursor starts over from its resting place.
  useEffect(() => setAiAt(null), [loaded?.id]);
  // Between runs it leaves no trace.
  useEffect(() => {
    if (!agent && !animating) setAiAt(null);
  }, [agent, animating]);

  // Re-measure selection boxes whenever anything that moves them changes.
  useLayoutEffect(() => {
    const sec = section();
    if (!sec) return setBoxes([]);
    setBoxes(
      selection
        .map((addr) => {
          const d = domAt(addr);
          return d ? { addr, r: slideRect(d, sec, scale) } : null;
        })
        .filter((x): x is { addr: string; r: Rect } => !!x),
    );
  }, [selection, slide, scale, tick, section, domAt]);

  useEffect(() => {
    // Web fonts arriving change text sizes.
    void document.fonts.ready.then(() => setTick((t) => t + 1));
    const sec = section();
    if (!sec) return;
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    ro.observe(sec);
    return () => ro.disconnect();
  }, [slide, section]);

  // ── Text editing ──────────────────────────────────────────────────────
  const caretAt = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (editing === null) return;
    settleRef.current?.();
    const el = domAt(editing);
    if (!el) return endEditing();
    const isList = el.tagName === "UL" || el.tagName === "OL";
    el.contentEditable = "true";
    el.spellcheck = true;
    el.classList.add("od-editing");
    el.focus({ preventScroll: true });
    if (caretAt.current) placeCaret(el, caretAt.current);
    else selectAllIn(el);
    caretAt.current = null;
    let done = false;
    const commit = (then?: () => void) => {
      if (done) return;
      done = true;
      const html = isList ? cleanList(el) : cleanInline(el);
      const addr = editing;
      el.contentEditable = "false";
      el.classList.remove("od-editing");
      endEditing();
      void editSlide("Edit text", (s, ctx) => setContent(s, addr, html, ctx)).then(() => then?.());
    };
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape" || (mod && e.key === "Enter")) {
        e.preventDefault();
        e.stopPropagation();
        commit();
      } else if (e.key === "Tab" && (el.tagName === "TD" || el.tagName === "TH")) {
        e.preventDefault();
        const next = nextCell(slide, editing, e.shiftKey ? -1 : 1);
        commit(() => next && setState({ editing: next }));
      } else if (mod && ["b", "i", "u"].includes(e.key.toLowerCase())) {
        e.preventDefault();
        document.execCommand({ b: "bold", i: "italic", u: "underline" }[e.key.toLowerCase()]!);
      } else if (e.key === "Enter" && !isList && !e.shiftKey) {
        // One block, many lines: Enter is a line break, not a new paragraph.
        e.preventDefault();
        document.execCommand("insertLineBreak");
      }
      e.stopPropagation();
    };
    const onInput = () => setTick((t) => t + 1);
    const onBlur = () => commit();
    const onPaste = (e: ClipboardEvent) => {
      // Plain text only: pasted formatting never sneaks into a slide.
      e.preventDefault();
      e.stopPropagation();
      document.execCommand("insertText", false, e.clipboardData?.getData("text/plain") ?? "");
    };
    el.addEventListener("keydown", onKey);
    el.addEventListener("input", onInput);
    el.addEventListener("blur", onBlur);
    el.addEventListener("paste", onPaste);
    return () => {
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("input", onInput);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("paste", onPaste);
    };
  }, [editing, domAt, slide]);

  // ── Pointer ───────────────────────────────────────────────────────────
  const toSlide = (e: { clientX: number; clientY: number }) => {
    const sec = section()!.getBoundingClientRect();
    return { x: (e.clientX - sec.left) / scale, y: (e.clientY - sec.top) / scale };
  };

  const hitAddress = (target: EventTarget | null): string | null => {
    const el = (target as Element | null)?.closest?.("[data-od]");
    if (!el || !frameRef.current?.contains(el)) return null;
    return el.getAttribute("data-od");
  };

  const pinnedRects = (exclude: string[]): Rect[] => {
    const sec = section();
    if (!sec || !slide) return [];
    return elementChildren(slide)
      .map((_, i) => String(i))
      .filter((a) => !exclude.includes(a))
      .map((a) => domAt(a))
      .filter((d): d is HTMLElement => !!d)
      .map((d) => slideRect(d, sec, scale));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !slide) return;
    // A change still animating finishes now, so the user acts on the slide as it is.
    settleRef.current?.();
    const target = e.target as HTMLElement;
    const ed = getState().editing;
    if (ed !== null && domAt(ed)?.contains(target)) return; // caret placement inside the text being edited
    if (ed !== null) (document.activeElement as HTMLElement | null)?.blur();
    const start = { startX: e.clientX, startY: e.clientY, moved: false };

    const handle = target.dataset.handle as Handle | undefined;
    if (handle && selection.length === 1) {
      const addr = selection[0]!;
      const dom = domAt(addr);
      const el = getAt(slide, addr);
      if (!dom || !el) return;
      drag.current = { kind: "resize", ...start, handle, items: [{ addr, dom, el, left: dom.offsetLeft, top: dom.offsetTop, width: dom.offsetWidth, height: dom.offsetHeight }], lines: snapLines(pinnedRects([addr])), aspect: dom.offsetWidth / Math.max(1, dom.offsetHeight) };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    const hit = hitAddress(target);
    if (hit === null || hit === "") {
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) select([]);
      drag.current = { kind: "marquee", ...start, items: [] };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    const addr = pickAddress(slide, hit);
    let next = selection;
    if (e.shiftKey || e.metaKey || e.ctrlKey) next = selection.includes(addr) ? selection.filter((a) => a !== addr) : [...selection.filter((a) => !a.startsWith(addr + ".") && !addr.startsWith(a + ".")), addr];
    else if (!selection.includes(addr)) next = [addr];
    select(next);
    const items = next
      .map((a) => ({ a, dom: domAt(a), el: getAt(slide, a) }))
      .filter((x): x is { a: string; dom: HTMLElement; el: ElementNode } => !!x.dom && !!x.el && cmd.isPinned(x.el))
      .map(({ a, dom, el }) => ({ addr: a, dom, el, left: dom.offsetLeft, top: dom.offsetTop, width: dom.offsetWidth, height: dom.offsetHeight }));
    if (items.length && items.length === next.length) {
      const sec = section()!;
      const rs = items.map((i) => slideRect(i.dom, sec, scale));
      const x = Math.min(...rs.map((r) => r.x));
      const y = Math.min(...rs.map((r) => r.y));
      const union = { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
      drag.current = { kind: "move", ...start, items, union, lines: snapLines(pinnedRects(next)) };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      if (!slide || getState().editing !== null) return;
      const hit = hitAddress(e.target);
      const sec = section();
      if (hit === null || hit === "" || !sec) return setHover(null);
      const addr = pickAddress(slide, hit);
      const dom = selection.includes(addr) ? null : domAt(addr);
      setHover(dom ? slideRect(dom, sec, scale) : null);
      return;
    }
    let dx = (e.clientX - d.startX) / scale;
    let dy = (e.clientY - d.startY) / scale;
    if (!d.moved && Math.hypot(dx * scale, dy * scale) < 3) return;
    if (!d.moved) setIsDragging(true);
    d.moved = true;
    setHover(null);
    if (d.kind === "marquee") {
      const a = toSlide({ clientX: d.startX, clientY: d.startY });
      const b = toSlide(e);
      setMarquee({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
      return;
    }
    if (d.kind === "move") {
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      const u = d.union!;
      const snap = e.altKey ? { dx: 0, dy: 0, guides: [] } : snapBox({ ...u, x: u.x + dx, y: u.y + dy }, d.lines!);
      dx += snap.dx;
      dy += snap.dy;
      setGuides(snap.guides);
      for (const it of d.items) it.dom.style.translate = `${dx}px ${dy}px`;
      // getBoundingClientRect includes the translate, so re-measuring follows the drag.
      setTick((t) => t + 1);
      return;
    }
    // resize
    const it = d.items[0]!;
    const h = d.handle!;
    const pinned = cmd.isPinned(it.el);
    let { left, top, width, height } = it;
    if (h.includes("e")) width = it.width + dx;
    if (h.includes("s")) height = it.height + dy;
    if (h.includes("w") && pinned) {
      width = it.width - dx;
      left = it.left + dx;
    }
    if (h.includes("n") && pinned) {
      height = it.height - dy;
      top = it.top + dy;
    }
    const keepAspect = (["img", "svg"].includes(it.el.tag) ? !e.shiftKey : e.shiftKey) && h.length === 2;
    if (keepAspect) {
      const a = d.aspect!;
      if (width / height > a) width = height * a;
      else height = width / a;
      if (h.includes("w")) left = it.left + it.width - width;
      if (h.includes("n")) top = it.top + it.height - height;
    }
    width = Math.max(16, width);
    height = Math.max(16, height);
    it.dom.style.width = `${width}px`;
    if (!TEXT_TAGS.has(it.el.tag)) it.dom.style.height = `${height}px`;
    if (pinned) {
      it.dom.style.left = `${left}px`;
      it.dom.style.top = `${top}px`;
      it.dom.style.right = "auto";
      it.dom.style.bottom = "auto";
    }
    setTick((t) => t + 1);
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setIsDragging(false);
    setGuides([]);
    if (!d || !slide) return;
    if (d.kind === "marquee") {
      setMarquee(null);
      if (!d.moved) return;
      const a = toSlide({ clientX: d.startX, clientY: d.startY });
      const b = toSlide(e);
      const m = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
      const sec = section()!;
      const hits = elementChildren(slide)
        .map((c, i) => ({ c, a: String(i) }))
        .filter(({ c }) => c.tag !== "aside")
        .filter(({ a }) => {
          const dom = domAt(a);
          if (!dom) return false;
          const r = slideRect(dom, sec, scale);
          return r.x < m.x + m.w && r.x + r.w > m.x && r.y < m.y + m.h && r.y + r.h > m.y;
        })
        .map(({ a }) => a);
      select(e.shiftKey ? [...new Set([...selection, ...hits])] : hits);
      return;
    }
    if (!d.moved) return;
    if (d.kind === "move") {
      const t = d.items[0]!.dom.style.translate.split(" ").map((v) => parseFloat(v) || 0);
      const [dx, dy] = [t[0] ?? 0, t[1] ?? 0];
      await editSlide("Move", (s, ctx) => {
        let cur = s;
        for (const it of d.items) cur = setStyles(cur, it.addr, { ...cmd.anchorToTopLeft(it.el, it.dom), left: `${Math.round(it.left + dx)}px`, top: `${Math.round(it.top + dy)}px` }, ctx);
        return cur;
      });
      for (const it of d.items) it.dom.style.translate = "";
      return;
    }
    const it = d.items[0]!;
    const pinned = cmd.isPinned(it.el);
    const props: Record<string, string | null> = { width: `${Math.round(parseFloat(it.dom.style.width))}px` };
    if (!TEXT_TAGS.has(it.el.tag)) props.height = `${Math.round(parseFloat(it.dom.style.height))}px`;
    if (pinned) Object.assign(props, { left: `${Math.round(parseFloat(it.dom.style.left))}px`, top: `${Math.round(parseFloat(it.dom.style.top))}px`, right: null, bottom: null });
    if (getStyle(it.el, "flex") !== undefined && !pinned) props.flex = null;
    const ok = await editSlide("Resize", (s, ctx) => setStyles(s, it.addr, props, ctx));
    if (!ok) setTick((x) => x + 1);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!slide) return;
    const hit = hitAddress(e.target);
    if (hit === null || hit === "") return;
    const target = editTarget(slide, hit);
    if (target !== null) {
      caretAt.current = { x: e.clientX, y: e.clientY };
      setState({ selection: [pickAddress(slide, target)], editing: target });
      return;
    }
    // Drill into a selected group: pick its child under the pointer.
    const sel0 = selection[0];
    if (sel0 !== undefined && hit.startsWith(sel0 + ".")) {
      const depth = sel0 === "" ? 1 : sel0.split(".").length + 1;
      select([hit.split(".").slice(0, depth).join(".")]);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!slide) return;
    const hit = hitAddress(e.target);
    if (hit !== null && hit !== "") {
      const addr = pickAddress(slide, hit);
      if (!selection.includes(addr)) select([addr]);
    } else select([]);
    setMenu({ x: e.clientX, y: e.clientY });
  };

  if (!loaded || !theme) return <div ref={stageRef} className="stage" />;
  if (!slide)
    return (
      <div ref={stageRef} className="stage">
        <div className="stage-broken">
          This slide can’t be shown: {loaded.diagnostics.find((d) => d.severity === "error")?.message}. Fix the file, or ask the assistant to.
        </div>
      </div>
    );

  const w = SLIDE_WIDTH * scale;
  const h = SLIDE_HEIGHT * scale;
  const single = selection.length === 1 ? getAt(slide, selection[0]!) : null;
  const singleBox = boxes.length === 1 ? boxes[0]!.r : null;
  const handles: Handle[] = !single || editing !== null ? [] : cmd.isPinned(single) ? (TEXT_TAGS.has(single.tag) ? ["e", "w"] : ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) : TEXT_TAGS.has(single.tag) ? ["e"] : ["e", "s", "se"];
  const errors = loaded.diagnostics.filter((d) => d.severity === "error");

  return (
    <div ref={stageRef} className="stage" data-zoomed={zoom !== "fit" || undefined}>
      <div className="stage-scroll" style={{ width: Math.max(stage.w, w + PAD * 2), height: Math.max(stage.h, h + PAD * 2 + notesRoom) }}>
        <div className="stage-column">
          <div
            ref={frameRef}
            className="stage-slide"
            style={{ width: w, height: h }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              drag.current = null;
              setIsDragging(false);
              setGuides([]);
              setMarquee(null);
            }}
            onPointerLeave={() => !drag.current && setHover(null)}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
          >
            <LiveSlide slideId={loaded.id} slide={slide} theme={theme} width={w} remote={remote} hooks={motionHooks} settleRef={settleRef} />
            <div className="overlay" aria-hidden>
              {hover && <div className="ov-box hover" style={px(hover, scale)} />}
              {boxes.map((b) => (
                <div key={b.addr} className={`ov-box selected${editing !== null ? " editing" : ""}`} style={px(b.r, scale)} />
              ))}
              {singleBox && single && editing === null && (
                <>
                  {!shouldShowFormatBar(single) && (
                    <div className="ov-label" style={{ left: singleBox.x * scale, top: singleBox.y * scale }}>
                      {labelOf(single)}
                    </div>
                  )}
                  {handles.map((hd) => (
                    <div key={hd} className={`ov-handle ${hd}`} data-handle={hd} style={handlePos(hd, singleBox, scale)} />
                  ))}
                </>
              )}
              {guides.map((g, i) => (
                <div key={i} className={`ov-guide ${g.axis}`} style={g.axis === "x" ? { left: g.at * scale } : { top: g.at * scale }} />
              ))}
              {marquee && <div className="ov-marquee" style={px(marquee, scale)} />}
              {(agent || animating) && aiName.current && (
                <div className={`ai-cursor${agent && !animating ? " waiting" : ""}`} style={cursorPos(aiAt, scale, w, h)}>
                  <Icon name="pointer" size={18} />
                  <span className="ai-cursor-label">{aiName.current}</span>
                </div>
              )}
            </div>
            <CommentLayer frame={frameRef} slideId={loaded.id} measure={`${scale}|${tick}|${loaded.source}`} />
          </div>
          {showNotes && <SlideNotes key={loaded.id} slide={slide} slideId={loaded.id} width={w} />}
        </div>
      </div>
      {errors.length > 0 && (
        <div className="stage-problems" role="status">
          {errors.length === 1 ? "1 problem" : `${errors.length} problems`} in this slide’s file · {errors[0]!.message} (line {errors[0]!.line})
        </div>
      )}
      {menu && <Menu anchor={menu} entries={contextEntries(slide, selection)} onClose={() => setMenu(null)} label="Element" />}
      {single && singleBox && !isDragging && shouldShowFormatBar(single) && (
        <FormatBar
          element={single}
          address={selection[0]!}
          box={singleBox}
          scale={scale}
          frameRef={frameRef}
          stageRef={stageRef}
        />
      )}
    </div>
  );
}

function px(r: Rect, s: number) {
  return { left: r.x * s, top: r.y * s, width: r.w * s, height: r.h * s };
}

/** Room the cursor and its label need inside the slide's edge (screen px). */
const CURSOR_ROOM = { x: 120, y: 40 };
/** Where the AI's cursor rests before it has visited anything (screen px from the slide's corner). */
const CURSOR_REST = 24;

/** The cursor sits at the end of the element it is on (its bottom right), kept inside the slide. */
function cursorPos(at: Rect | null, s: number, w: number, h: number) {
  if (!at) return { left: CURSOR_REST, top: CURSOR_REST };
  return {
    left: Math.max(0, Math.min(w - CURSOR_ROOM.x, (at.x + at.w) * s - 6)),
    top: Math.max(0, Math.min(h - CURSOR_ROOM.y, (at.y + at.h) * s - 6)),
  };
}

function handlePos(h: Handle, r: Rect, s: number) {
  const x = h.includes("w") ? r.x : h.includes("e") ? r.x + r.w : r.x + r.w / 2;
  const y = h.includes("n") ? r.y : h.includes("s") ? r.y + r.h : r.y + r.h / 2;
  return { left: x * s, top: y * s };
}

/** The next table cell for Tab / Shift+Tab while typing in a table. */
function nextCell(slide: ElementNode | null, addr: string, dir: 1 | -1): string | null {
  if (!slide) return null;
  const row = parentAddress(addr);
  const table = parentAddress(row);
  const t = getAt(slide, table);
  if (!t) return null;
  const cells: string[] = [];
  elementChildren(t).forEach((r, ri) => elementChildren(r).forEach((_, ci) => cells.push(`${table}.${ri}.${ci}`.replace(/^\./, ""))));
  const i = cells.indexOf(addr);
  return cells[i + dir] ?? null;
}

function contextEntries(slide: ElementNode, selection: string[]): MenuEntry[] {
  if (!selection.length)
    return [
      { label: "Paste", shortcut: shortcut("Mod+V"), onSelect: () => document.execCommand("paste") },
      { label: "Comment on the slide", shortcut: COMMENT_SHORTCUT, onSelect: newComment },
      { label: "Select all", shortcut: shortcut("Mod+A"), onSelect: () => select(elementChildren(slide).map((_, i) => String(i)).filter((a) => getAt(slide, a)?.tag !== "aside")) },
    ];
  const els = selection.map((a) => getAt(slide, a)).filter((x): x is ElementNode => !!x);
  const one = els.length === 1 ? els[0]! : null;
  const allPinned = els.every(cmd.isPinned);
  const editable = one && selection[0] !== undefined ? editTarget(slide, selection[0]) : null;
  return [
    ...(editable !== null && editable !== undefined ? [{ label: "Edit text", shortcut: "Enter", onSelect: () => setState({ editing: editable }) } as MenuEntry, "separator" as const] : []),
    { label: "Cut", shortcut: shortcut("Mod+X"), onSelect: () => document.execCommand("cut") },
    { label: "Copy", shortcut: shortcut("Mod+C"), onSelect: () => document.execCommand("copy") },
    { label: "Paste", shortcut: shortcut("Mod+V"), onSelect: () => document.execCommand("paste") },
    { label: "Duplicate", shortcut: shortcut("Mod+D"), onSelect: () => void cmd.duplicateSelection() },
    "separator",
    { label: "Bring to front", shortcut: shortcut("Mod+Shift+]"), disabled: !one, onSelect: () => void cmd.restack("front") },
    { label: "Bring forward", shortcut: shortcut("Mod+]"), disabled: !one, onSelect: () => void cmd.restack("forward") },
    { label: "Send backward", shortcut: shortcut("Mod+["), disabled: !one, onSelect: () => void cmd.restack("backward") },
    { label: "Send to back", shortcut: shortcut("Mod+Shift+["), disabled: !one, onSelect: () => void cmd.restack("back") },
    "separator",
    els.length > 1 ? { label: "Group", shortcut: shortcut("Mod+G"), onSelect: () => void cmd.groupSelection() } : { label: "Ungroup", shortcut: shortcut("Mod+Shift+G"), disabled: one?.tag !== "div", onSelect: () => void cmd.ungroupSelection() },
    allPinned ? { label: "Put back in layout", hint: "Flows with the slide again", onSelect: () => void cmd.setPinned(false) } : { label: "Pin in place", hint: "Move it freely", onSelect: () => void cmd.setPinned(true) },
    "separator",
    { label: "Comment", shortcut: COMMENT_SHORTCUT, disabled: !one, onSelect: newComment },
    "separator",
    { label: "Delete", shortcut: "Delete", danger: true, onSelect: () => void cmd.deleteSelection() },
  ];
}
