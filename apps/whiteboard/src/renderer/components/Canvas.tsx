// The board on screen: items drawn by the format's renderer, and every
// pointer gesture on them. Only items on screen are drawn, and an item is
// redrawn only when it (or, for a connector, what it joins) changes.

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  connectorPoints,
  isBox,
  isConnector,
  itemAt,
  itemBounds,
  inkValue,
  itemSvg,
  LIMITS,
  newId,
  onFrameTitle,
  rectContains,
  rectsOverlap,
  rotatedBounds,
  roundedPath,
  textItemHeight,
  type BoardItem,
  type BoxItem,
  type ById,
  type ConnectorItem,
  type End,
  type Pt,
  type Rect,
  type Side,
  type Theme,
} from "@opendeck/board";
import { Menu } from "@opendeck/shell";
import { assetUrl } from "../api.ts";
import { useAssistant } from "../assistant.ts";
import { comments } from "../comments.ts";
import {
  addItems,
  commit,
  fitBoard,
  getState,
  insertImages,
  makeItem,
  moveItem,
  preview,
  refile,
  select,
  setState,
  setTool,
  setView,
  useBoard,
  withGroups,
  zoomTo,
} from "../store.ts";
import { useTheme } from "../theme.ts";
import { CommentLayer } from "./CommentLayer.tsx";
import { itemMenu } from "./menus.tsx";
import { TextEditor } from "./TextEditor.tsx";

type Handle = "nw" | "ne" | "se" | "sw";

type Gesture =
  | { kind: "pan"; sx: number; sy: number; view: { x: number; y: number; zoom: number } }
  | { kind: "move"; start: Pt; before: BoardItem[]; ids: Set<string>; moved: boolean; sx: number; sy: number; hit: string; shift: boolean }
  | { kind: "marquee"; start: Pt; cur: Pt; base: string[] }
  | { kind: "resize"; id: string; handle: Handle; before: BoardItem[]; box: BoxItem; start: Pt }
  | { kind: "rotate"; id: string; before: BoardItem[]; center: Pt; angle: number }
  | { kind: "create"; what: "frame" | "shape"; start: Pt; cur: Pt }
  | { kind: "pen"; points: Pt[] }
  | { kind: "connect"; from: End; start: Pt; cur: Pt; target: string | null }
  | { kind: "end"; id: string; which: "from" | "to"; before: BoardItem[]; target: string | null };

const ITEM_SLOP = 6;

/** Is (x, y) on screen, for an item's box? */
const onScreen = (b: Rect, area: Rect) => rectsOverlap(b, area, 40);

const ItemView = memo(
  function ItemView({ item, all, theme, editing }: { item: BoardItem; all: ById; theme: Theme; editing: boolean; deps: string }) {
    return <g dangerouslySetInnerHTML={{ __html: itemSvg(item, { theme, items: all, editing: editing ? item.id : null, asset: assetUrl }) }} />;
  },
  (a, b) => a.item === b.item && a.theme === b.theme && a.editing === b.editing && a.deps === b.deps,
);

/** What a connector's drawing depends on besides itself: the boxes at its ends. */
function connectorDeps(c: ConnectorItem, all: ById): string {
  const part = (e: End) => {
    if (!("item" in e)) return "";
    const it = all.get(e.item);
    return it && isBox(it) ? `${it.x},${it.y},${it.width},${it.height},${it.rotation ?? 0}` : "-";
  };
  return `${part(c.from)}|${part(c.to)}`;
}

export function Canvas() {
  const items = useBoard((s) => s.items);
  const all = useBoard((s) => s.byId);
  const selection = useBoard((s) => s.selection);
  const editing = useBoard((s) => s.editing);
  const tool = useBoard((s) => s.tool);
  const view = useBoard((s) => s.view);
  const viewport = useBoard((s) => s.viewport);
  const penColor = useBoard((s) => s.penColor);
  const theme = useTheme();
  const ai = useAssistant();
  const host = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [, redraw] = useState(0);
  const [space, setSpace] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      setState({ viewport: { width: el.clientWidth, height: el.clientHeight } });
      if (getState().fitPending && el.clientWidth) {
        setState({ fitPending: false });
        fitBoard();
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
      if ((e.target as HTMLElement).closest(".wb-editor")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = getState().view;
      if (e.ctrlKey || e.metaKey) {
        zoomTo(v.zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), { x: e.clientX - r.left, y: e.clientY - r.top });
      } else {
        const k = e.deltaMode === 1 ? 16 : 1;
        setView({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX) * k, y: v.y - (e.shiftKey ? 0 : e.deltaY) * k });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Space held: the hand, while it's down.
  useEffect(() => {
    const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest("input, textarea, [contenteditable='true']");
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !typing(e.target)) {
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

  const toBoard = (cx: number, cy: number): Pt => {
    const r = host.current!.getBoundingClientRect();
    const v = getState().view;
    return { x: (cx - r.left - v.x) / v.zoom, y: (cy - r.top - v.y) / v.zoom };
  };
  const toScreen = (p: Pt): Pt => ({ x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y });

  const hitAt = (p: Pt, except?: string) => {
    const s = getState();
    const list = except ? s.items.filter((it) => it.id !== except) : s.items;
    return itemAt(p, list, s.byId, ITEM_SLOP / s.view.zoom);
  };

  /** The item a connector end can attach to under `p`. */
  const attachTarget = (p: Pt, except?: string): string | null => {
    const hit = hitAt(p, except);
    return hit && isBox(hit) ? hit.id : null;
  };

  const begin = (e: React.PointerEvent, g: Gesture) => {
    gesture.current = g;
    try {
      host.current?.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is gone already; moves still reach the canvas */
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const s = getState();
    setState({ flyout: null });
    if ((document.activeElement as HTMLElement | null)?.closest(".wb-editor")) return;
    host.current?.focus({ preventScroll: true });
    if (e.button === 1 || s.tool === "hand" || space) {
      e.preventDefault();
      begin(e, { kind: "pan", sx: e.clientX, sy: e.clientY, view: s.view });
      return;
    }
    if (e.button !== 0) return;
    const p = toBoard(e.clientX, e.clientY);
    switch (s.tool) {
      case "pen":
        begin(e, { kind: "pen", points: [p] });
        setState({ dragging: true });
        return;
      case "arrow": {
        const target = attachTarget(p);
        const from: End = target ? { item: target } : { x: Math.round(p.x), y: Math.round(p.y) };
        begin(e, { kind: "connect", from, start: p, cur: p, target: null });
        setState({ dragging: true });
        return;
      }
      case "frame":
      case "shape":
        begin(e, { kind: "create", what: s.tool, start: p, cur: p });
        return;
      case "text":
      case "sticky": {
        const it = makeItem(s.tool, p);
        addItems(s.tool === "text" ? "Add text" : "Add sticky note", [it], { edit: true });
        setTool("select");
        return;
      }
      case "comment": {
        const hit = hitAt(p);
        const b = hit && itemBounds(hit, s.byId);
        comments.draft(hit && b ? { item: hit.id, x: Math.round(p.x), y: Math.round(p.y) } : { x: Math.round(p.x), y: Math.round(p.y) });
        setState({ panel: "comments", tool: "select" });
        return;
      }
    }
    const hit = hitAt(p);
    if (!hit) {
      if (!e.shiftKey) select([]);
      begin(e, { kind: "marquee", start: p, cur: p, base: e.shiftKey ? s.selection : [] });
      return;
    }
    let sel = s.selection;
    if (e.shiftKey) {
      const group = withGroups([hit.id]);
      sel = sel.includes(hit.id) ? sel.filter((id) => !group.includes(id)) : [...sel, ...group];
      select(sel);
    } else if (!sel.includes(hit.id)) {
      sel = withGroups([hit.id]);
      select(sel);
    }
    const ids = new Set(sel.filter((id) => !s.byId.get(id)?.locked));
    for (const it of s.items) if (it.frame && ids.has(it.frame) && !it.locked) ids.add(it.id);
    begin(e, { kind: "move", start: p, before: s.items, ids, moved: false, sx: e.clientX, sy: e.clientY, hit: hit.id, shift: e.shiftKey });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const s = getState();
    const p = toBoard(e.clientX, e.clientY);
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
        preview(g.before.map((it) => (g.ids.has(it.id) ? moveItem(it, dx, dy) : it)));
        return;
      }
      case "marquee": {
        g.cur = p;
        const area = { x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), width: Math.abs(p.x - g.start.x), height: Math.abs(p.y - g.start.y) };
        const inside = s.items.filter((it) => {
          const b = itemBounds(it, s.byId);
          return b && rectContains(area, b);
        });
        setState({ selection: withGroups([...new Set([...g.base, ...inside.map((it) => it.id)])]) });
        redraw((n) => n + 1);
        return;
      }
      case "resize": {
        const b = g.box;
        const keep = e.shiftKey || b.kind === "sticker" || b.kind === "image";
        let dx = p.x - g.start.x;
        let dy = p.y - g.start.y;
        if (b.rotation) {
          const a = (-b.rotation * Math.PI) / 180;
          [dx, dy] = [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
        }
        const west = g.handle.includes("w");
        const north = g.handle.includes("n");
        const min = b.kind === "text" ? 24 : 16;
        let w = Math.max(min, b.width + (west ? -dx : dx));
        let h = Math.max(min, b.height + (north ? -dy : dy));
        if (keep) {
          const k = Math.max(w / b.width, h / b.height);
          w = Math.max(min, b.width * k);
          h = Math.max(min, b.height * k);
        }
        if (b.kind === "text") h = textItemHeight(b.text, b, w);
        w = Math.min(LIMITS.size, Math.round(w));
        h = Math.min(LIMITS.size, Math.round(h));
        const x = west ? b.x + b.width - w : b.x;
        const y = north ? b.y + b.height - h : b.y;
        let next: BoardItem = { ...b, x, y, width: w, height: h };
        if (b.kind === "drawing") next = { ...b, x, y, width: w, height: h, points: b.points.map((v, i) => Math.round((i % 2 ? v * (h / b.height) : v * (w / b.width)) * 10) / 10) };
        preview(g.before.map((it) => (it.id === g.id ? next : it)));
        setState({ dragging: true });
        return;
      }
      case "rotate": {
        let a = (Math.atan2(p.y - g.center.y, p.x - g.center.x) * 180) / Math.PI + 90;
        a = ((a + 540) % 360) - 180;
        const snapped = Math.round(a / 15) * 15;
        if (e.shiftKey || Math.abs(a - snapped) < 4) a = snapped;
        g.angle = Math.round(a);
        preview(g.before.map((it) => (it.id === g.id && isBox(it) ? ({ ...it, rotation: g.angle || undefined } as BoardItem) : it)));
        setState({ dragging: true });
        return;
      }
      case "create":
        g.cur = p;
        redraw((n) => n + 1);
        return;
      case "pen": {
        const last = g.points[g.points.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) * s.view.zoom >= 2 && g.points.length < LIMITS.points) {
          g.points.push(p);
          redraw((n) => n + 1);
        }
        return;
      }
      case "connect":
        g.cur = p;
        g.target = attachTarget(p, "item" in g.from ? g.from.item : undefined);
        redraw((n) => n + 1);
        return;
      case "end": {
        const c = g.before.find((it) => it.id === g.id) as ConnectorItem | undefined;
        if (!c) return;
        const other = c[g.which === "from" ? "to" : "from"];
        g.target = attachTarget(p, "item" in other ? other.item : undefined);
        const end: End = g.target ? { item: g.target } : { x: Math.round(p.x), y: Math.round(p.y) };
        preview(g.before.map((it) => (it.id === g.id ? { ...c, [g.which]: end } : it)));
        setState({ dragging: true });
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (host.current?.hasPointerCapture(e.pointerId)) host.current.releasePointerCapture(e.pointerId);
    if (!g) return;
    const s = getState();
    setState({ dragging: false });
    switch (g.kind) {
      case "move":
        if (g.moved) commit(g.ids.size === 1 ? "Move" : `Move ${g.ids.size} items`, refile(s.items, g.ids), {}, g.before);
        else if (!g.shift && s.selection.length > 1 && s.selection.includes(g.hit)) select([g.hit]);
        return;
      case "marquee":
        redraw((n) => n + 1);
        return;
      case "resize":
        commit("Resize", s.items, {}, g.before);
        return;
      case "rotate":
        commit("Rotate", s.items, {}, g.before);
        redraw((n) => n + 1);
        return;
      case "end":
        commit("Move connector end", s.items, {}, g.before);
        return;
      case "create": {
        const r = { x: Math.min(g.start.x, g.cur.x), y: Math.min(g.start.y, g.cur.y), width: Math.abs(g.cur.x - g.start.x), height: Math.abs(g.cur.y - g.start.y) };
        const drawn = r.width * s.view.zoom > 8 && r.height * s.view.zoom > 8;
        const center = drawn ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : g.start;
        const size = drawn ? { width: Math.max(16, Math.round(r.width)), height: Math.max(16, Math.round(r.height)) } : {};
        const it = g.what === "frame" ? makeItem("frame", center, size) : makeItem("shape", center, { ...size, shape: s.shapeKind } as Partial<BoxItem>);
        if (g.what === "frame" && isBox(it)) {
          // A frame drawn around items takes them in.
          const inside = new Set(s.items.filter((x) => x.kind !== "frame" && !x.frame && rectContains(it, itemBounds(x, s.byId) ?? { x: 0, y: 0, width: Infinity, height: 0 })).map((x) => x.id));
          const next = [...s.items.map((x) => (inside.has(x.id) ? ({ ...x, frame: it.id } as BoardItem) : x)), it];
          commit("Add frame", next, { selection: [it.id] });
        } else addItems("Add shape", [it]);
        setTool("select");
        return;
      }
      case "pen": {
        redraw((n) => n + 1);
        if (g.points.length < 2) return;
        const xs = g.points.map((q) => q.x);
        const ys = g.points.map((q) => q.y);
        const x = Math.floor(Math.min(...xs));
        const y = Math.floor(Math.min(...ys));
        const points = g.points.flatMap((q) => [Math.round((q.x - x) * 10) / 10, Math.round((q.y - y) * 10) / 10]);
        const d: BoardItem = { id: newId("drawing", s.byId), kind: "drawing", x, y, width: Math.max(1, Math.ceil(Math.max(...xs) - x)), height: Math.max(1, Math.ceil(Math.max(...ys) - y)), points, ...(s.penColor !== "default" ? { color: s.penColor } : {}) };
        commit("Draw", refile([...s.items, d], new Set([d.id])));
        return;
      }
      case "connect": {
        redraw((n) => n + 1);
        const p = g.cur;
        const fromItem = "item" in g.from ? g.from.item : null;
        const to: End = g.target ? { item: g.target } : { x: Math.round(p.x), y: Math.round(p.y) };
        if (!g.target && Math.hypot(p.x - g.start.x, p.y - g.start.y) * s.view.zoom < 12) {
          if (s.tool !== "select") setTool("select");
          return;
        }
        if (fromItem && fromItem === g.target) return;
        const c: ConnectorItem = { id: newId("connector", s.byId), kind: "connector", from: g.from, to };
        addItems("Add connector", [c]);
        setTool("select");
        return;
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = getState();
    if (s.tool !== "select") return;
    const p = toBoard(e.clientX, e.clientY);
    const hit = hitAt(p);
    if (!hit || hit.locked) return;
    if (hit.kind === "table") {
      const r = Math.min(hit.cells.length - 1, Math.max(0, Math.floor(((p.y - hit.y) / hit.height) * hit.cells.length)));
      const c = Math.min(hit.cells[0]!.length - 1, Math.max(0, Math.floor(((p.x - hit.x) / hit.width) * hit.cells[0]!.length)));
      setState({ selection: [hit.id], editing: { id: hit.id, cell: [r, c] } });
    } else if (hit.kind === "frame" ? onFrameTitle(p, hit) : ["sticky", "text", "shape", "connector"].includes(hit.kind)) {
      setState({ selection: [hit.id], editing: { id: hit.id } });
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const s = getState();
    const hit = hitAt(toBoard(e.clientX, e.clientY));
    if (hit && !s.selection.includes(hit.id)) select([hit.id]);
    if (!hit && !s.selection.length) return;
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const onDrop = (e: React.DragEvent) => {
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    void insertImages(files, toBoard(e.clientX, e.clientY));
  };

  // ── Drawing ────────────────────────────────────────────────────────────

  const area = { x: -view.x / view.zoom, y: -view.y / view.zoom, width: viewport.width / view.zoom, height: viewport.height / view.zoom };
  const visible = items.filter((it) => {
    const b = itemBounds(it, all);
    return b ? onScreen(b, area) : false;
  });

  const g = gesture.current;
  const grid = 32 * view.zoom >= 12 ? 32 * view.zoom : 32 * view.zoom * Math.ceil(12 / (32 * view.zoom));
  const cursor = space || tool === "hand" ? (g?.kind === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : "crosshair";

  return (
    <div
      ref={host}
      className="wb-canvas"
      tabIndex={-1}
      aria-label="Board"
      style={{ cursor, backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === "file")) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      <svg className="wb-svg" width="100%" height="100%">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {visible.map((it) => (
            <ItemView key={it.id} item={it} all={all} theme={theme} editing={editing?.id === it.id} deps={isConnector(it) ? connectorDeps(it, all) : ""} />
          ))}
          {g?.kind === "pen" && g.points.length > 1 && <path className="wb-pen-live" d={roundedPath(g.points, 0)} stroke={inkValue(penColor, theme)} />}
          {g?.kind === "connect" && <ConnectPreview g={g} all={all} />}
        </g>
      </svg>
      <SelectionLayer
        toScreen={toScreen}
        onHandle={(e, it, h) => {
          e.stopPropagation();
          if (e.button !== 0) return;
          begin(e, { kind: "resize", id: it.id, handle: h, before: getState().items, box: it, start: toBoard(e.clientX, e.clientY) });
        }}
        onRotate={(e, it) => {
          e.stopPropagation();
          if (e.button !== 0) return;
          const b = rotatedBounds(it);
          begin(e, { kind: "rotate", id: it.id, before: getState().items, center: { x: b.x + b.width / 2, y: b.y + b.height / 2 }, angle: it.rotation ?? 0 });
        }}
        onPort={(e, it, side) => {
          e.stopPropagation();
          if (e.button !== 0) return;
          const p = toBoard(e.clientX, e.clientY);
          begin(e, { kind: "connect", from: { item: it.id, side }, start: p, cur: p, target: null });
          setState({ dragging: true });
        }}
        onEnd={(e, c, which) => {
          e.stopPropagation();
          if (e.button !== 0) return;
          begin(e, { kind: "end", id: c.id, which, before: getState().items, target: null });
        }}
        rotating={g?.kind === "rotate" ? g : null}
        target={g?.kind === "connect" || g?.kind === "end" ? g.target : null}
      />
      {g?.kind === "marquee" && <div className="wb-marquee" style={rectStyle(g.start, g.cur, toScreen)} />}
      {g?.kind === "create" && <div className="wb-marquee wb-creating" style={rectStyle(g.start, g.cur, toScreen)} />}
      <CommentLayer toScreen={toScreen} />
      {editing && <TextEditor />}
      {menu && <Menu entries={itemMenu(ai.name)} anchor={menu} label="Item actions" onClose={() => setMenu(null)} />}
    </div>
  );
}

function rectStyle(a: Pt, b: Pt, toScreen: (p: Pt) => Pt): React.CSSProperties {
  const p = toScreen({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) });
  const q = toScreen({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) });
  return { left: p.x, top: p.y, width: q.x - p.x, height: q.y - p.y };
}

function ConnectPreview({ g, all }: { g: Extract<Gesture, { kind: "connect" }>; all: ById }) {
  const to: End = g.target ? { item: g.target } : { x: g.cur.x, y: g.cur.y };
  const temp: ConnectorItem = { id: "__preview", kind: "connector", from: g.from, to };
  const pts = connectorPoints(temp, all);
  if (!pts) return null;
  return <path className="wb-connect-live" d={roundedPath(pts, 14)} />;
}

// ── Selection handles ────────────────────────────────────────────────────

const PORTS: Exclude<Side, "auto">[] = ["top", "right", "bottom", "left"];

function SelectionLayer({
  toScreen,
  onHandle,
  onRotate,
  onPort,
  onEnd,
  rotating,
  target,
}: {
  toScreen: (p: Pt) => Pt;
  onHandle(e: React.PointerEvent, it: BoxItem, h: Handle): void;
  onRotate(e: React.PointerEvent, it: BoxItem): void;
  onPort(e: React.PointerEvent, it: BoxItem, side: Exclude<Side, "auto">): void;
  onEnd(e: React.PointerEvent, c: ConnectorItem, which: "from" | "to"): void;
  rotating: { id: string; angle: number } | null;
  target: string | null;
}) {
  const selection = useBoard((s) => s.selection);
  const all = useBoard((s) => s.byId);
  const zoom = useBoard((s) => s.view.zoom);
  const dragging = useBoard((s) => s.dragging);
  const editing = useBoard((s) => s.editing);
  const sel = selection.slice(0, 500).map((id) => all.get(id)).filter((it): it is BoardItem => !!it);
  const single = sel.length === 1 ? sel[0]! : null;
  const targetItem = target ? all.get(target) : null;
  return (
    <div className="wb-overlay" aria-hidden>
      {targetItem && isBox(targetItem) && <Outline it={targetItem} toScreen={toScreen} zoom={zoom} className="wb-target" />}
      {sel.map((it) =>
        isConnector(it) ? (
          <ConnectorSelection key={it.id} c={it} all={all} toScreen={toScreen} zoom={zoom} handles={!!single && !it.locked && !dragging} onEnd={onEnd} />
        ) : (
          <Outline key={it.id} it={it} toScreen={toScreen} zoom={zoom} className={it.locked ? "wb-sel locked" : "wb-sel"}>
            {single === it && !it.locked && !dragging && editing?.id !== it.id && (
              <>
                {(["nw", "ne", "se", "sw"] as Handle[]).map((h) => (
                  <span key={h} className={`wb-handle ${h}`} onPointerDown={(e) => onHandle(e, it, h)} />
                ))}
                {PORTS.map((side) => (
                  <span key={side} className={`wb-port ${side}`} title="Drag to connect" onPointerDown={(e) => onPort(e, it, side)} />
                ))}
                {it.kind !== "frame" && it.kind !== "table" && <span className="wb-rotate" title="Drag to rotate" onPointerDown={(e) => onRotate(e, it)} />}
              </>
            )}
            {rotating?.id === it.id && (
              <span className="wb-angle" style={{ transform: `translateX(-50%) rotate(${-rotating.angle}deg)` }}>
                {rotating.angle}°
              </span>
            )}
          </Outline>
        ),
      )}
    </div>
  );
}

function Outline({ it, toScreen, zoom, className, children }: { it: BoxItem; toScreen: (p: Pt) => Pt; zoom: number; className: string; children?: React.ReactNode }) {
  const p = toScreen({ x: it.x, y: it.y });
  const style: React.CSSProperties = { left: p.x, top: p.y, width: it.width * zoom, height: it.height * zoom, transform: it.rotation ? `rotate(${it.rotation}deg)` : undefined };
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

function ConnectorSelection({ c, all, toScreen, zoom, handles, onEnd }: { c: ConnectorItem; all: ById; toScreen: (p: Pt) => Pt; zoom: number; handles: boolean; onEnd(e: React.PointerEvent, c: ConnectorItem, which: "from" | "to"): void }) {
  const pts = connectorPoints(c, all);
  if (!pts) return null;
  const scr = pts.map(toScreen);
  const a = scr[0]!;
  const b = scr[scr.length - 1]!;
  return (
    <>
      <svg className="wb-route">
        <path d={roundedPath(scr, c.route === "straight" ? 0 : 14 * zoom)} />
      </svg>
      {handles && (
        <>
          <span className="wb-end" style={{ left: a.x, top: a.y }} onPointerDown={(e) => onEnd(e, c, "from")} />
          <span className="wb-end" style={{ left: b.x, top: b.y }} onPointerDown={(e) => onEnd(e, c, "to")} />
        </>
      )}
    </>
  );
}

/** The screen box of the selection (null: nothing selected or it has no box). */
export function selectionScreenBox(): Rect | null {
  const s = getState();
  let box: Rect | null = null;
  for (const id of s.selection) {
    const it = s.byId.get(id);
    const b = it && itemBounds(it, s.byId);
    if (!b) continue;
    box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), width: Math.max(box.x + box.width, b.x + b.width) - Math.min(box.x, b.x), height: Math.max(box.y + box.height, b.y + b.height) - Math.min(box.y, b.y) } : b;
  }
  if (!box) return null;
  const v = s.view;
  return { x: box.x * v.zoom + v.x, y: box.y * v.zoom + v.y, width: box.width * v.zoom, height: box.height * v.zoom };
}
