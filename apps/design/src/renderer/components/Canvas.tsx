// The canvas: the page's artboards (each drawn by the format's renderer),
// the notes beside them, and every pointer gesture on them. Artboards and
// notes live in one layer moved and scaled with the view; names, outlines and
// handles are drawn over it in screen pixels, so they stay the same size.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getAt, snippetOf } from "@opendeck/format";
import {
  BOARD_SIZES,
  ELEMENTS,
  FILL_VALUES,
  LIMITS,
  STICKY_INK,
  insertHtml,
  holdsLayers,
  layerAddress,
  noteBounds,
  onStroke,
  setContent,
  themeOf,
  type ElementNode,
  type NoteItem,
} from "@opendeck/artboard";
import { Icon, Menu, MenuButton, toast } from "@opendeck/shell";
import { useAssistant } from "../assistant.ts";
import { comments } from "../comments.ts";
import { artboardExportMenu } from "../export.ts";
import {
  addArtboard,
  addSticky,
  addStroke,
  apply,
  boardRect,
  editBoard,
  finishNote,
  fitPage,
  getState,
  insertImages,
  movedBoards,
  movedNotes,
  pageBoards,
  pageNotes,
  preview,
  renameArtboard,
  select,
  selectBoards,
  selectLayers,
  setFocus,
  setState,
  setTool,
  setView,
  sizedBoard,
  snap,
  togglePanel,
  useDesign,
  zoomTo,
  type Rect,
  type Snap,
} from "../store.ts";
import { cleanInline, cleanList, placeCaret } from "../textEdit.ts";
import { ArtboardView, layerElement } from "./ArtboardView.tsx";
import { CommentLayer } from "./CommentLayer.tsx";
import { selectionMenu } from "./menus.tsx";

type Handle = "nw" | "ne" | "se" | "sw";
type Pt = { x: number; y: number };

type Gesture =
  | { kind: "pan"; sx: number; sy: number; view: { x: number; y: number; zoom: number } }
  | { kind: "move"; what: "boards" | "notes"; ids: string[]; start: Pt; before: Snap; moved: boolean; sx: number; sy: number; click: (() => void) | null }
  | { kind: "marquee"; start: Pt; cur: Pt; base: string[] }
  | { kind: "resize"; file: string; handle: Handle; box: Rect; before: Snap; start: Pt }
  | { kind: "pen"; points: Pt[] };

/** What is under a pointer event: a note, or an artboard and the address of the element in it. */
type Hit = { note: string } | { file: string; address: string | null } | null;

const typingIn = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, [contenteditable='true']");

export function Canvas() {
  const index = useDesign((s) => s.index);
  const boards = useDesign((s) => s.boards);
  const page = useDesign((s) => s.page);
  const notes = useDesign((s) => s.notes);
  const selection = useDesign((s) => s.selection);
  const editing = useDesign((s) => s.editing);
  const tool = useDesign((s) => s.tool);
  const view = useDesign((s) => s.view);
  const viewport = useDesign((s) => s.viewport);
  const heights = useDesign((s) => s.heights);
  const guides = useDesign((s) => s.guides);
  const dragging = useDesign((s) => s.dragging);
  const panel = useDesign((s) => s.panel);
  const penWidth = useDesign((s) => s.penWidth);
  const penDashed = useDesign((s) => s.penDashed);
  const ai = useAssistant();
  const host = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [, redraw] = useState(0);
  const [space, setSpace] = useState(false);
  const [menu, setMenu] = useState<Pt | null>(null);
  const [hover, setHover] = useState<{ file: string; address: string } | null>(null);

  const files = pageBoards({ index, boards, notes, page });
  const onPage = pageNotes({ notes, page });
  const theme = useMemo(() => themeOf(index), [index.tweaks, index.textStyles]);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      setState({ viewport: { width: el.clientWidth, height: el.clientHeight } });
      if (getState().fitPending && el.clientWidth) {
        setState({ fitPending: false });
        fitPage();
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // Wheel: scroll pans, Ctrl or a pinch zooms about the pointer. Not passive, so the page never scrolls.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".dg-note-editor, .menu")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = getState().view;
      if (e.ctrlKey || e.metaKey) zoomTo(v.zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), { x: e.clientX - r.left, y: e.clientY - r.top });
      else {
        const k = e.deltaMode === 1 ? 16 : 1;
        setView({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX) * k, y: v.y - (e.shiftKey ? 0 : e.deltaY) * k });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Space held: the hand, while it's down.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !typingIn(e.composedPath()[0] ?? null) && !getState().editing) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Typing into a layer: its own element on the artboard takes the text, and what was typed becomes the layer's content.
  const editFile = editing?.kind === "layer" ? editing.file : null;
  const editAddress = editing?.kind === "layer" ? editing.address : null;
  const caretAt = useRef<Pt | undefined>(undefined);
  useEffect(() => {
    if (editFile === null || editAddress === null) return;
    const el = layerElement(editFile, editAddress);
    if (!el) {
      setState({ editing: null });
      return;
    }
    const list = el.tagName === "UL" || el.tagName === "OL";
    el.contentEditable = "true";
    el.focus({ preventScroll: true });
    placeCaret(el, caretAt.current);
    caretAt.current = undefined;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const html = list ? cleanList(el) : cleanInline(el);
      setState({ editing: null });
      editBoard("Edit text", editFile, (root, ctx) => setContent(root, editAddress, html, ctx));
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        finish();
      }
    };
    el.addEventListener("blur", finish);
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("blur", finish);
      el.removeEventListener("keydown", onKey);
      finish();
    };
  }, [editFile, editAddress]);

  // Outlines of layers are read from the DOM, which the artboards update after this render: draw once more when they have.
  const [, settle] = useState(0);
  useLayoutEffect(() => settle((n) => n + 1), [boards, index, selection, heights, viewport, editing]);

  const toCanvas = (cx: number, cy: number): Pt => {
    const r = host.current!.getBoundingClientRect();
    const v = getState().view;
    return { x: (cx - r.left - v.x) / v.zoom, y: (cy - r.top - v.y) / v.zoom };
  };
  const toScreen = (r: Rect): Rect => ({ x: r.x * view.zoom + view.x, y: r.y * view.zoom + view.y, w: r.w * view.zoom, h: r.h * view.zoom });

  /** A layer's box in the canvas's own pixels, read from where the browser drew it. */
  const layerBox = (file: string, address: string): Rect | null => {
    const el = layerElement(file, address);
    const frame = host.current?.getBoundingClientRect();
    if (!el || !frame) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left - frame.left, y: r.top - frame.top, w: r.width, h: r.height };
  };

  // Found from the point, not from the event: while a drag has the pointer, the browser reports its events on the canvas itself.
  const hitOf = (e: { clientX: number; clientY: number }): Hit => {
    const path = elementsUnder(e.clientX, e.clientY);
    const note = path.find((n) => n.dataset?.note);
    if (note) return { note: note.dataset.note! };
    const board = path.find((n) => n.dataset?.file);
    if (board) return { file: board.dataset.file!, address: path.find((n) => n.dataset?.od !== undefined)?.dataset.od ?? null };
    const frame = path.find((n) => n.dataset?.frame);
    if (frame) return { file: frame.dataset.frame!, address: null };
    const p = toCanvas(e.clientX, e.clientY);
    const s = getState();
    const stroke = [...pageNotes(s)].reverse().find((n) => n.kind === "stroke" && onStroke(n, p.x, p.y, 6 / s.view.zoom));
    return stroke ? { note: stroke.id } : null;
  };

  /** The layer an element belongs to (a bold word is part of its paragraph); "" is the artboard itself. */
  const layerOf = (file: string, address: string | null): string => {
    const root = getState().boards.get(file)?.doc?.root;
    return root && address ? layerAddress(root, address) : "";
  };

  const begin = (e: React.PointerEvent, g: Gesture) => {
    gesture.current = g;
    try {
      host.current?.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is gone already; moves still reach the canvas */
    }
  };

  /** Put new content into the container under the pointer (or the artboard's root), and select it. */
  const insertAt = (label: string, hit: Hit, html: string, edit: boolean) => {
    if (!hit || !("file" in hit)) {
      toast(`Click inside an artboard to add ${label === "Add text" ? "text" : "a shape"} to it.`);
      return;
    }
    const root = getState().boards.get(hit.file)?.doc?.root;
    let parent = layerOf(hit.file, hit.address);
    while (root && parent !== "" && (getAt(root, parent) as ElementNode | null)?.tag !== "div") parent = parent.includes(".") ? parent.slice(0, parent.lastIndexOf(".")) : "";
    const at = editBoard(label, hit.file, (r, ctx) => insertHtml(r, parent, html, undefined, ctx), { tool: "select", flyout: null });
    if (at !== null && edit) setState({ editing: { kind: "layer", file: hit.file, address: at } });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const s = getState();
    if (s.flyout) setState({ flyout: null });
    const hit = hitOf(e);
    if (s.editing?.kind === "layer" && hit && "file" in hit && hit.file === s.editing.file && hit.address !== null && (hit.address === s.editing.address || hit.address.startsWith(`${s.editing.address}.`))) return;
    if (s.editing) (document.activeElement as HTMLElement | null)?.blur?.();
    host.current?.focus({ preventScroll: true });
    e.preventDefault();
    if (e.button === 1 || s.tool === "hand" || space) {
      begin(e, { kind: "pan", sx: e.clientX, sy: e.clientY, view: s.view });
      return;
    }
    if (e.button !== 0) return;
    const p = toCanvas(e.clientX, e.clientY);
    switch (s.tool) {
      case "pen":
        begin(e, { kind: "pen", points: [p] });
        setState({ dragging: true });
        return;
      case "artboard": {
        const size = BOARD_SIZES.find((b) => b.name === s.boardSize) ?? BOARD_SIZES[0]!;
        addArtboard(size.name, { x: p.x - size.width / 2, y: p.y - size.height / 2 });
        return;
      }
      case "sticky":
        addSticky(p);
        return;
      case "text":
        insertAt("Add text", hit, "<p>Text</p>", true);
        return;
      case "shape": {
        const line = s.shapeKind === "line";
        const arrow = s.shapeKind.startsWith("arrow");
        insertAt("Add shape", hit, `<x-shape kind="${s.shapeKind}" style="width:${line ? 240 : arrow ? 160 : 120}px;height:${line ? 2 : arrow ? 80 : 120}px;background:var(--accent)"></x-shape>`, false);
        return;
      }
      case "comment": {
        if (!hit || !("file" in hit)) {
          toast("Click an artboard, or a layer on it, to comment there.");
          return;
        }
        const root = s.boards.get(hit.file)?.doc?.root;
        const addr = layerOf(hit.file, hit.address);
        const el = root && addr ? getAt(root, addr) : null;
        comments.draft({ file: hit.file, addr: el ? addr : "", snippet: el ? snippetOf(el) : "" });
        setState({ panel: "comments", tool: "select" });
        return;
      }
    }
    if (!hit) {
      if (!e.shiftKey) select(null);
      begin(e, { kind: "marquee", start: p, cur: p, base: e.shiftKey && s.selection?.kind === "boards" ? s.selection.files : [] });
      return;
    }
    if ("note" in hit) {
      const had = s.selection?.kind === "notes" ? s.selection.ids : [];
      const ids = e.shiftKey ? (had.includes(hit.note) ? had.filter((id) => id !== hit.note) : [...had, hit.note]) : had.includes(hit.note) ? had : [hit.note];
      select(ids.length ? { kind: "notes", ids } : null);
      begin(e, { kind: "move", what: "notes", ids, start: p, before: snap(), moved: false, sx: e.clientX, sy: e.clientY, click: !e.shiftKey && had.length > 1 ? () => select({ kind: "notes", ids: [hit.note] }) : null });
      return;
    }
    const sel = s.selection;
    const hadBoards = sel?.kind === "boards" ? sel.files : [];
    if (e.shiftKey && sel?.kind !== "layers") {
      selectBoards(hadBoards.includes(hit.file) ? hadBoards.filter((f) => f !== hit.file) : [...hadBoards, hit.file]);
      return;
    }
    const active = hadBoards.includes(hit.file) || (sel?.kind === "layers" && sel.file === hit.file);
    const layer = layerOf(hit.file, hit.address);
    // The first click takes the artboard; a click inside the one already taken goes to the layer under it. Dragging moves the artboard either way.
    let click: (() => void) | null = null;
    if (!active) selectBoards([hit.file]);
    else if (e.shiftKey && sel?.kind === "layers" && layer) click = () => selectLayers(hit.file, sel.addresses.includes(layer) ? sel.addresses.filter((a) => a !== layer) : [...sel.addresses, layer]);
    else click = () => selectLayers(hit.file, [layer]);
    const moving = active && hadBoards.length > 1 ? hadBoards : [hit.file];
    begin(e, { kind: "move", what: "boards", ids: moving, start: p, before: snap(), moved: false, sx: e.clientX, sy: e.clientY, click });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) {
      if (!guides || tool !== "select") return;
      const hit = hitOf(e);
      const next = hit && "file" in hit && hit.address !== null ? { file: hit.file, address: layerOf(hit.file, hit.address) } : null;
      if (next?.file !== hover?.file || next?.address !== hover?.address) setHover(next);
      return;
    }
    const s = getState();
    const p = toCanvas(e.clientX, e.clientY);
    switch (g.kind) {
      case "pan":
        setView({ ...g.view, x: g.view.x + e.clientX - g.sx, y: g.view.y + e.clientY - g.sy });
        return;
      case "move": {
        if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 3) return;
        if (!g.moved) {
          g.moved = true;
          setState({ dragging: true });
        }
        const dx = Math.round(p.x - g.start.x);
        const dy = Math.round(p.y - g.start.y);
        preview(g.what === "boards" ? movedBoards(g.before, g.ids, dx, dy) : movedNotes(g.before, g.ids, dx, dy));
        return;
      }
      case "marquee": {
        g.cur = p;
        const x = Math.min(g.start.x, p.x);
        const y = Math.min(g.start.y, p.y);
        const w = Math.abs(p.x - g.start.x);
        const h = Math.abs(p.y - g.start.y);
        const inside = pageBoards(s).filter((f) => {
          const b = boardRect(f, s)!;
          return b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y;
        });
        selectBoards([...new Set([...g.base, ...inside])]);
        redraw((n) => n + 1);
        return;
      }
      case "resize": {
        const b = g.box;
        const west = g.handle.includes("w");
        const north = g.handle.includes("n");
        let w = b.w + (west ? -1 : 1) * (p.x - g.start.x);
        let h = b.h + (north ? -1 : 1) * (p.y - g.start.y);
        if (e.shiftKey) {
          const k = Math.max(w / b.w, h / b.h);
          w = b.w * k;
          h = b.h * k;
        }
        w = Math.min(LIMITS.maxSize, Math.max(LIMITS.minSize, Math.round(w)));
        h = Math.min(LIMITS.maxSize, Math.max(LIMITS.minSize, Math.round(h)));
        preview(sizedBoard(g.before, g.file, { x: west ? b.x + b.w - w : b.x, y: north ? b.y + b.h - h : b.y, w, h }));
        setState({ dragging: true });
        return;
      }
      case "pen": {
        const last = g.points[g.points.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) * s.view.zoom >= 2 && g.points.length < LIMITS.strokePoints) {
          g.points.push(p);
          redraw((n) => n + 1);
        }
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (host.current?.hasPointerCapture(e.pointerId)) host.current.releasePointerCapture(e.pointerId);
    if (!g) return;
    setState({ dragging: false });
    switch (g.kind) {
      case "move":
        if (g.moved) apply(g.ids.length === 1 ? "Move" : `Move ${g.ids.length} ${g.what === "boards" ? "artboards" : "notes"}`, snap(), {}, g.before);
        else g.click?.();
        return;
      case "resize":
        apply("Resize artboard", snap(), {}, g.before);
        return;
      case "marquee":
        redraw((n) => n + 1);
        return;
      case "pen":
        redraw((n) => n + 1);
        addStroke(g.points.map((q): [number, number] => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10]));
        return;
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = getState();
    if (s.tool !== "select" || s.editing) return;
    const hit = hitOf(e);
    if (!hit) return;
    if ("note" in hit) {
      if (s.notes.find((n) => n.id === hit.note)?.kind === "sticky") setState({ selection: { kind: "notes", ids: [hit.note] }, editing: { kind: "note", id: hit.note } });
      return;
    }
    const root = s.boards.get(hit.file)?.doc?.root;
    let address = layerOf(hit.file, hit.address);
    let el = root && address ? (getAt(root, address) as ElementNode | null) : null;
    // A list is typed into as a whole, so Enter makes the next item.
    if (root && el?.tag === "li") {
      address = address.includes(".") ? address.slice(0, address.lastIndexOf(".")) : "";
      el = getAt(root, address) as ElementNode | null;
    }
    if (!el || !address) return;
    if (ELEMENTS[el.tag]?.children !== "inline" && el.tag !== "ul" && el.tag !== "ol") {
      selectLayers(hit.file, [address]);
      return;
    }
    caretAt.current = { x: e.clientX, y: e.clientY };
    setState({ selection: { kind: "layers", file: hit.file, addresses: [address] }, editing: { kind: "layer", file: hit.file, address } });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const s = getState();
    const hit = hitOf(e);
    if (hit && "note" in hit) {
      if (!(s.selection?.kind === "notes" && s.selection.ids.includes(hit.note))) select({ kind: "notes", ids: [hit.note] });
    } else if (hit) {
      const layer = layerOf(hit.file, hit.address);
      const sel = s.selection;
      const has = sel?.kind === "boards" ? sel.files.includes(hit.file) && !layer : sel?.kind === "layers" && sel.file === hit.file && sel.addresses.includes(layer);
      if (!has) selectLayers(hit.file, [layer]);
    } else if (!s.selection) return;
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const onDrop = (e: React.DragEvent) => {
    const dropped = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    if (!dropped.length) return;
    e.preventDefault();
    const hit = hitOf(e);
    if (hit && "file" in hit) {
      const root = getState().boards.get(hit.file)?.doc?.root;
      const layer = layerOf(hit.file, hit.address);
      const el = root && layer ? (getAt(root, layer) as ElementNode | null) : null;
      selectLayers(hit.file, el && holdsLayers(el) ? [layer] : []);
    }
    void insertImages(dropped);
  };

  // ── Drawing ────────────────────────────────────────────────────────────

  const g = gesture.current;
  const grid = 32 * view.zoom >= 12 ? 32 * view.zoom : 32 * view.zoom * Math.ceil(12 / (32 * view.zoom));
  const cursor = space || tool === "hand" ? (g?.kind === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : "crosshair";
  const area: Rect = { x: -view.x / view.zoom, y: -view.y / view.zoom, w: viewport.width / view.zoom, h: viewport.height / view.zoom };
  const seen = (r: Rect) => r.x < area.x + area.w + 200 && r.x + r.w > area.x - 200 && r.y < area.y + area.h + 200 && r.y + r.h > area.y - 200;
  const selBoards = selection?.kind === "boards" ? selection.files : [];
  const selLayers = selection?.kind === "layers" ? selection : null;
  const selNotes = selection?.kind === "notes" ? selection.ids : [];
  const single = selBoards.length === 1 ? selBoards[0]! : null;
  const strokes = onPage.filter((n): n is Extract<NoteItem, { kind: "stroke" }> => n.kind === "stroke");
  const rectStyle = (r: Rect): React.CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });
  const hoverBox = hover && !dragging && !editing && hover.address !== "" && !(selLayers?.file === hover.file && selLayers.addresses.includes(hover.address)) ? layerBox(hover.file, hover.address) : null;
  const guideBoxes: Rect[] = [];
  if (guides && selLayers?.addresses.length === 1 && !dragging) {
    const el = getAt(boards.get(selLayers.file)?.doc?.root ?? ({ children: [] } as never), selLayers.addresses[0]!) as ElementNode | null;
    if (el && holdsLayers(el)) el.children.filter((c) => c.type === "element").forEach((_, i) => guideBoxes.push(layerBox(selLayers.file, `${selLayers.addresses[0]}.${i}`) ?? { x: 0, y: 0, w: 0, h: 0 }));
  }

  return (
    <div
      ref={host}
      className="dg-canvas"
      tabIndex={-1}
      aria-label="Canvas"
      style={{ cursor, backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === "file")) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      <div className="dg-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        <svg className="dg-strokes" aria-hidden>
          {strokes.map((n) => (
            <polyline key={n.id} points={n.points.map((p) => p.join(",")).join(" ")} strokeWidth={n.width} strokeDasharray={n.dashed ? `${n.width * 2} ${n.width * 2.5}` : undefined} />
          ))}
          {g?.kind === "pen" && g.points.length > 1 && <polyline points={g.points.map((p) => `${p.x},${p.y}`).join(" ")} strokeWidth={penWidth} strokeDasharray={penDashed ? `${penWidth * 2} ${penWidth * 2.5}` : undefined} />}
        </svg>
        {onPage.map((n) =>
          n.kind === "sticky" ? (
            <div key={n.id} className="dg-sticky" data-note={n.id} style={{ left: n.x, top: n.y, width: n.w, minHeight: n.h, background: FILL_VALUES[n.fill], color: STICKY_INK }}>
              {editing?.kind === "note" && editing.id === n.id ? <NoteEditor note={n} fresh={editing.fresh} /> : n.text || <span className="dg-sticky-empty">Double-click to write</span>}
            </div>
          ) : null,
        )}
        {files.map((file) => {
          const b = index.boards[file]!;
          const loaded = boards.get(file);
          const r = boardRect(file, { ...getState(), index, heights })!;
          if (!seen(r)) return null;
          const grows = b.expand === "fill";
          return (
            <div key={file} className={`dg-frame${grows ? " grows" : ""}`} data-frame={file} style={{ left: b.x, top: b.y, width: b.w, ...(grows ? { minHeight: b.h } : { height: b.h }) }}>
              {loaded?.doc ? (
                <ArtboardView file={file} doc={loaded.doc} theme={theme} canvas frozen={editFile === file} onHeight={grows ? reportHeight : undefined} />
              ) : (
                <div className="dg-broken" role="alert">
                  <strong>This artboard’s file can’t be read</strong>
                  <span>{loaded?.broken ?? "It is missing."}</span>
                  <span>artboards/{file} is left as it is. Fix it there, or ask the AI to rewrite it.</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="dg-overlay">
        {files.map((file) => {
          const r = toScreen(boardRect(file, { ...getState(), index, heights })!);
          if (r.x > viewport.width || r.x + r.w < 0 || r.y - 28 > viewport.height || r.y + r.h < 0) return null;
          const on = selBoards.includes(file) || selLayers?.file === file;
          return (
            <BoardStrip key={file} file={file} title={index.boards[file]!.title} box={r} on={on} renaming={editing?.kind === "name" && editing.file === file} properties={panel === "properties"} />
          );
        })}
        {selBoards.map((file) => {
          const r = boardRect(file, { ...getState(), index, heights });
          return r ? (
            <div key={file} className="dg-sel" style={rectStyle(toScreen(r))}>
              {single === file && !dragging && tool === "select" && (["nw", "ne", "se", "sw"] as Handle[]).map((h) => (
                <span
                  key={h}
                  className={`dg-handle ${h}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (e.button !== 0) return;
                    begin(e, { kind: "resize", file, handle: h, box: { ...index.boards[file]!, w: index.boards[file]!.w, h: index.boards[file]!.h }, before: snap(), start: toCanvas(e.clientX, e.clientY) });
                  }}
                />
              ))}
            </div>
          ) : null;
        })}
        {selLayers && <div className="dg-sel soft" style={rectStyle(toScreen(boardRect(selLayers.file, { ...getState(), index, heights }) ?? { x: 0, y: 0, w: 0, h: 0 }))} />}
        {guideBoxes.map((r, i) => (
          <div key={i} className="dg-guide" style={rectStyle(r)} />
        ))}
        {hoverBox && guides && <div className="dg-hover" style={rectStyle(hoverBox)} />}
        {selLayers?.addresses.map((a) => {
          const r = layerBox(selLayers.file, a);
          return r ? <div key={a} className={`dg-sel layer${editing?.kind === "layer" ? " typing" : ""}`} style={rectStyle(r)} /> : null;
        })}
        {selNotes.map((id) => {
          const n = onPage.find((x) => x.id === id);
          const r = !n ? null : n.kind === "sticky" ? stickyBox(host.current, id) : toScreen(noteBounds(n));
          return r ? <div key={id} className="dg-sel" style={rectStyle(r)} /> : null;
        })}
        {g?.kind === "marquee" && <div className="dg-marquee" style={rectStyle(toScreen({ x: Math.min(g.start.x, g.cur.x), y: Math.min(g.start.y, g.cur.y), w: Math.abs(g.cur.x - g.start.x), h: Math.abs(g.cur.y - g.start.y) }))} />}
      </div>

      {!files.length && !onPage.length && (
        <div className="dg-empty">
          <p>This canvas has no artboards yet. Add one, or let {ai.name} add some.</p>
          <button className="btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => addArtboard(BOARD_SIZES[0]!.name)}>
            Add an artboard
          </button>
        </div>
      )}
      <CommentLayer layerBox={layerBox} toScreen={toScreen} />
      {menu && <Menu entries={selectionMenu(ai.name)} anchor={menu} label="Selection actions" onClose={() => setMenu(null)} />}
    </div>
  );
}

/** An artboard that grows with its content says how tall it is drawn. */
function reportHeight(file: string, height: number) {
  if (getState().heights[file] !== height) setState((s) => ({ heights: { ...s.heights, [file]: height } }));
}

/** The element at a screen point, looking inside artboards' shadow roots, then each thing that holds it. */
function elementsUnder(x: number, y: number): HTMLElement[] {
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  for (let inner = el?.shadowRoot?.elementFromPoint(x, y) as HTMLElement | null | undefined; el && inner && inner !== el; inner = el.shadowRoot?.elementFromPoint(x, y) as HTMLElement | null | undefined) el = inner;
  const out: HTMLElement[] = [];
  for (let n: HTMLElement | null = el; n; n = n.parentElement ?? ((n.getRootNode() as ShadowRoot).host as HTMLElement | undefined) ?? null) out.push(n);
  return out;
}

/** A sticky's box as it is drawn (it grows with its text), in the canvas's own pixels. */
function stickyBox(host: HTMLElement | null, id: string): Rect | null {
  const el = host?.querySelector<HTMLElement>(`[data-note="${id}"]`);
  if (!el || !host) return null;
  const r = el.getBoundingClientRect();
  const f = host.getBoundingClientRect();
  return { x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height };
}

function NoteEditor({ note, fresh }: { note: Extract<NoteItem, { kind: "sticky" }>; fresh?: boolean }) {
  const [value, setValue] = useState(note.text);
  const latest = useRef(value);
  latest.current = value;
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const keep = () => {
    if (done.current) return;
    done.current = true;
    finishNote(note.id, latest.current, fresh);
  };
  return (
    <textarea
      ref={ref}
      className="dg-note-editor"
      value={value}
      maxLength={4000}
      aria-label="Sticky note"
      onChange={(e) => setValue(e.target.value)}
      onBlur={keep}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          keep();
        }
      }}
    />
  );
}

/** The line above an artboard: its name (double-click renames), and its actions while it is selected or pointed at. */
function BoardStrip({ file, title, box, on, renaming, properties }: { file: string; title: string; box: Rect; on: boolean; renaming: boolean; properties: boolean }) {
  const [value, setValue] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!renaming) return;
    setValue(title);
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, [renaming]);
  const narrow = box.w < 150;
  return (
    <div className={`dg-strip${on ? " on" : ""}`} style={{ left: box.x, top: box.y - 28, width: Math.max(box.w, 60) }} data-frame={file}>
      {renaming ? (
        <input
          ref={input}
          className="dg-strip-input"
          value={value}
          maxLength={LIMITS.titleChars}
          aria-label="Artboard name"
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => renameArtboard(file, value)}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") renameArtboard(file, value);
            else if (e.key === "Escape") setState({ editing: null });
          }}
        />
      ) : (
        <span
          className="dg-strip-name"
          title="Double-click to rename"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setState({ selection: { kind: "boards", files: [file] }, editing: { kind: "name", file } });
          }}
        >
          {title}
        </span>
      )}
      {!narrow && !renaming && (
        <span className="dg-strip-actions" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <button
            className="dg-strip-btn"
            aria-pressed={on && properties}
            aria-label="Properties"
            title="Properties"
            onClick={() => {
              if (!on) selectBoards([file]);
              if (!(on && properties)) setState({ panel: "properties" });
              else togglePanel("properties");
            }}
          >
            <Icon name="sliders" size={14} />
          </button>
          <button className="dg-strip-btn" aria-label={`Open ${title} on its own`} title="Open on its own" onClick={() => setFocus(file)}>
            <Icon name="viewport" size={14} />
          </button>
          <MenuButton className="dg-strip-btn" label={`Export ${title}`} title="Export" align="end" entries={() => artboardExportMenu(file)}>
            <Icon name="download" size={14} />
          </MenuButton>
        </span>
      )}
    </div>
  );
}

/** With a tool chosen, Enter puts its item in the middle of the screen (the keyboard path for the dock). */
export function placeWithKeyboard(): boolean {
  const s = getState();
  if (s.tool === "artboard") addArtboard(s.boardSize);
  else if (s.tool === "sticky") addSticky({ x: (s.viewport.width / 2 - s.view.x) / s.view.zoom, y: (s.viewport.height / 2 - s.view.y) / s.view.zoom });
  else return false;
  setTool("select");
  return true;
}
