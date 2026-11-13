// The grid: only the rows and columns in view are drawn, with frozen rows
// and columns pinned, merged cells, text that runs into empty neighbours,
// chips for checkbox, dropdown, person and date cells, the editor, and every
// mouse and keyboard way of moving, selecting, filling and resizing.

import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type CellData,
  colToLetter,
  DEFAULT_FONT_SIZE,
  type EvalValue,
  formatCellRef,
  formatCellValue,
  FormulaError,
  FUNCTIONS,
  LIMITS,
  type GroupRange,
  type MergeRange,
  parseRangeRef,
} from "@opendeck/sheet";
import { Icon, Menu } from "@opendeck/shell";
import { comments } from "../comments.ts";
import {
  addColToRight,
  addRowsToBottom,
  cancelEditing,
  clearSelection,
  commitEditing,
  copySelection,
  currentSheet,
  deleteColsAt,
  deleteRowsAt,
  dropdownOf,
  fillRangeTo,
  getState,
  groupSelection,
  insertColsAt,
  insertRowsAt,
  pasteSelection,
  previewResize,
  resizeTo,
  selectCell,
  selectionBounds,
  setCellInput,
  setRightPanel,
  setSelection,
  setState,
  startEditing,
  toggleCheckbox,
  toggleGroup,
  ungroupSelection,
  useSheets,
} from "../store.ts";
import { ChartLayer } from "./ChartLayer.tsx";
import { CellPopover, type CellPopoverAt } from "./CellPopover.tsx";
import { type MenuTarget, cellMenuEntries, insertEntries } from "./menus.tsx";

const ROW_HEADER_W = 46;
const COL_HEADER_H = 26;
/** The strip above the column headers (or left of the row headers) that shows groups. */
const GROUP_BAND = 18;
const OVERSCAN = 3;
const PT = 4 / 3;

/** Characters after which a click on a cell, while writing a formula, puts that cell's reference in. */
const REF_SLOT = /[=(,+\-*/^&<>:;]\s*$/;

function isFilled(cell: CellData | undefined): boolean {
  return !!cell && (cell.f !== undefined || (cell.v !== undefined && cell.v !== null && cell.v !== "") || (!!cell.t && cell.t !== "auto"));
}

function borderCss(side?: { style: string; color?: string }) {
  if (!side) return undefined;
  const px = side.style === "thick" || side.style === "double" ? 3 : side.style === "medium" ? 2 : 1;
  const kind = side.style === "dashed" || side.style === "dotted" || side.style === "double" ? side.style : "solid";
  return `${px}px ${kind} ${side.color ?? "var(--text-2)"}`;
}

/** Where the data edge is from (r, c) going (dr, dc), the way Ctrl+arrow jumps. */
function dataEdge(cells: Record<string, CellData>, r: number, c: number, dr: number, dc: number, rows: number, cols: number) {
  const has = (rr: number, cc: number) => isFilled(cells[formatCellRef(rr, cc)]);
  const inside = (rr: number, cc: number) => rr >= 0 && rr < rows && cc >= 0 && cc < cols;
  let rr = r;
  let cc = c;
  if (has(rr, cc) && inside(rr + dr, cc + dc) && has(rr + dr, cc + dc)) {
    while (inside(rr + dr, cc + dc) && has(rr + dr, cc + dc)) {
      rr += dr;
      cc += dc;
    }
    return { r: rr, c: cc };
  }
  while (inside(rr + dr, cc + dc)) {
    rr += dr;
    cc += dc;
    if (has(rr, cc)) return { r: rr, c: cc };
  }
  return { r: rr, c: cc };
}

export function Grid() {
  const workbook = useSheets((s) => s.workbook);
  const sheet = useSheets((s) => currentSheet(s));
  const selection = useSheets((s) => s.selection);
  const editing = useSheets((s) => s.editing);
  const zoom = useSheets((s) => s.zoom);
  const evaluated = useSheets((s) => s.evaluated);
  const condStyles = useSheets((s) => s.condStyles);
  const resizing = useSheets((s) => s.resizing);
  const clipboard = useSheets((s) => s.clipboard);
  const threads = comments.use((s) => s.threads);

  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLInputElement>(null);
  const [view, setView] = useState({ top: 0, left: 0, width: 1200, height: 700 });
  const [menu, setMenu] = useState<{ x: number; y: number; kind: MenuTarget } | null>(null);
  const [popover, setPopover] = useState<CellPopoverAt | null>(null);
  const [fillTo, setFillTo] = useState<{ r: number; c: number } | null>(null);
  const [addRows, setAddRows] = useState("1");
  const [suggest, setSuggest] = useState(0);
  const drag = useRef<
    | null
    | { kind: "cells" }
    | { kind: "cols"; from: number }
    | { kind: "rows"; from: number }
    | { kind: "resizeCol"; col: number; x: number; size: number }
    | { kind: "resizeRow"; row: number; y: number; size: number }
    | { kind: "fill" }
  >(null);

  const sheetId = sheet?.id ?? "";
  // Header sizes: the headers, and the group strip when the sheet has groups.
  const HW = ROW_HEADER_W + (sheet?.rowGroups.length ? GROUP_BAND : 0);
  const HH = COL_HEADER_H + (sheet?.colGroups.length ? GROUP_BAND : 0);
  const values = useMemo(() => evaluated.get(sheetId) ?? new Map<string, EvalValue>(), [sheetId, evaluated]);
  const conds = useMemo(() => condStyles.get(sheetId) ?? new Map(), [sheetId, condStyles]);

  const commentAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of threads) {
      if (t.resolved || t.sheetId !== sheetId) continue;
      const p = parseRangeRef(t.range);
      if (p) map.set(formatCellRef(p.r1, p.c1), t.id);
    }
    return map;
  }, [sheetId, threads]);

  const shown = (ref: string, cell: CellData | undefined): string => (workbook ? formatCellValue(values.get(ref) ?? cell?.v ?? null, cell, workbook.index) : "");

  // Rows a filter or a collapsed group hides.
  const hidden = useMemo(() => {
    const out = new Set<number>();
    for (const g of sheet?.rowGroups ?? []) if (g.collapsed) for (let r = g.start; r <= Math.min(g.end, (sheet?.rows ?? 0) - 1); r++) out.add(r);
    const f = sheet?.filter;
    const r = f ? parseRangeRef(f.range) : null;
    if (!sheet || !f || !r || !workbook) return out;
    const entries = Object.entries(f.columnFilters);
    if (!entries.length) return out;
    for (let row = r.r1 + 1; row <= r.r2; row++) {
      for (const [k, allowed] of entries) {
        const ref = formatCellRef(row, Number(k));
        if (!allowed.includes(formatCellValue(values.get(ref) ?? sheet.cells[ref]?.v ?? null, sheet.cells[ref], workbook.index))) {
          out.add(row);
          break;
        }
      }
    }
    return out;
  }, [sheet, values, workbook]);

  const layout = useMemo(() => {
    const cols = sheet?.cols ?? 0;
    const rows = sheet?.rows ?? 0;
    const colW = new Array<number>(cols);
    const colX = new Array<number>(cols + 1);
    colX[0] = 0;
    const folded = new Set<number>();
    for (const g of sheet?.colGroups ?? []) if (g.collapsed) for (let c = g.start; c <= Math.min(g.end, cols - 1); c++) folded.add(c);
    for (let c = 0; c < cols; c++) {
      const base = resizing?.kind === "col" && resizing.index === c ? resizing.size : (sheet!.colWidths[c] ?? LIMITS.defaultColWidth);
      colW[c] = folded.has(c) ? 0 : Math.round(base * zoom);
      colX[c + 1] = colX[c]! + colW[c]!;
    }
    const rowH = new Array<number>(rows);
    const rowY = new Array<number>(rows + 1);
    rowY[0] = 0;
    for (let r = 0; r < rows; r++) {
      const base = resizing?.kind === "row" && resizing.index === r ? resizing.size : (sheet!.rowHeights[r] ?? LIMITS.defaultRowHeight);
      rowH[r] = hidden.has(r) ? 0 : Math.round(base * zoom);
      rowY[r + 1] = rowY[r]! + rowH[r]!;
    }
    return { colW, colX, rowH, rowY, width: colX[cols]!, height: rowY[rows]! };
  }, [sheet, zoom, resizing, hidden]);

  const merges = useMemo(() => {
    const top = new Map<string, MergeRange>();
    const covered = new Set<string>();
    for (const m of sheet?.merges ?? []) {
      top.set(`${m.r1},${m.c1}`, m);
      for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(`${r},${c}`);
    }
    return { top, covered };
  }, [sheet]);

  // Size and scroll of the view.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setView((p) => (p.top === el.scrollTop && p.left === el.scrollLeft && p.width === el.clientWidth && p.height === el.clientHeight ? p : { top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight }));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheetId]);

  // Keep the moving end of the selection in view.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !sheet) return;
    const { r, c } = selection.focus;
    const frozenH = layout.rowY[Math.min(sheet.frozenRows, sheet.rows)] ?? 0;
    const frozenW = layout.colX[Math.min(sheet.frozenCols, sheet.cols)] ?? 0;
    if (selection.mode !== "rows" && c >= sheet.frozenCols) {
      const x1 = layout.colX[c] ?? 0;
      const x2 = layout.colX[c + 1] ?? x1;
      if (x1 < el.scrollLeft + frozenW) el.scrollLeft = Math.max(0, x1 - frozenW);
      else if (x2 > el.scrollLeft + el.clientWidth - HW) el.scrollLeft = x2 - el.clientWidth + HW + 8;
    }
    if (selection.mode !== "cols" && r >= sheet.frozenRows) {
      const y1 = layout.rowY[r] ?? 0;
      const y2 = layout.rowY[r + 1] ?? y1;
      if (y1 < el.scrollTop + frozenH) el.scrollTop = Math.max(0, y1 - frozenH);
      else if (y2 > el.scrollTop + el.clientHeight - HH - 64) el.scrollTop = y2 - el.clientHeight + HH + 64;
    }
  }, [selection.focus, selection.mode, sheetId]);

  // The editor takes the keys while it is open; the grid gets them back when it closes.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing?.source === "cell") requestAnimationFrame(() => editor.current?.focus());
    if (!editing && wasEditing.current && !document.activeElement?.closest("input, textarea, .menu, [role=dialog]")) host.current?.focus({ preventScroll: true });
    wasEditing.current = !!editing;
  }, [editing?.r, editing?.c, editing?.source, !!editing]);

  // Drags: selecting, resizing, filling.
  useEffect(() => {
    const cellAt = (e: MouseEvent) => {
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-r]");
      if (!t) return null;
      return { r: Number(t.dataset.r ?? -1), c: Number(t.dataset.c ?? -1) };
    };
    const move = (e: MouseEvent) => {
      const d = drag.current;
      const s = currentSheet();
      if (!d || !s) return;
      if (d.kind === "resizeCol") return previewResize("col", d.col, Math.max(30, Math.min(800, d.size + (e.clientX - d.x) / zoom)));
      if (d.kind === "resizeRow") return previewResize("row", d.row, Math.max(18, Math.min(400, d.size + (e.clientY - d.y) / zoom)));
      const at = cellAt(e);
      if (!at) return;
      if (d.kind === "cells" && at.r >= 0 && at.c >= 0) selectCell(at.r, at.c, true);
      else if (d.kind === "cols" && at.c >= 0) setSelection({ anchor: { r: 0, c: d.from }, focus: { r: s.rows - 1, c: at.c }, mode: "cols" });
      else if (d.kind === "rows" && at.r >= 0) setSelection({ anchor: { r: d.from, c: 0 }, focus: { r: at.r, c: s.cols - 1 }, mode: "rows" });
      else if (d.kind === "fill" && at.r >= 0 && at.c >= 0) {
        const b = selectionBounds();
        // Fill goes one way: down or up, or across, whichever the pointer moved more.
        const down = at.r > b.r2 ? at.r - b.r2 : at.r < b.r1 ? b.r1 - at.r : 0;
        const across = at.c > b.c2 ? at.c - b.c2 : at.c < b.c1 ? b.c1 - at.c : 0;
        setFillTo(down >= across ? { r: at.r, c: b.c2 } : { r: b.r2, c: at.c });
      }
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      const r = getState().resizing;
      if ((d?.kind === "resizeCol" || d?.kind === "resizeRow") && r) void resizeTo(r.kind, r.index, r.size);
      if (d?.kind === "fill") {
        setFillTo((target) => {
          if (target) {
            const b = selectionBounds();
            const dst = { r1: Math.min(b.r1, target.r), c1: Math.min(b.c1, target.c), r2: Math.max(b.r2, target.r), c2: Math.max(b.c2, target.c) };
            if (dst.r1 !== b.r1 || dst.r2 !== b.r2 || dst.c1 !== b.c1 || dst.c2 !== b.c2) {
              void fillRangeTo(`${formatCellRef(dst.r1, dst.c1)}:${formatCellRef(dst.r2, dst.c2)}`).then(() => setSelection({ anchor: { r: dst.r1, c: dst.c1 }, focus: { r: dst.r2, c: dst.c2 }, mode: "cells" }));
            }
          }
          return null;
        });
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [zoom]);

  // What the editor suggests: functions after "=", the insert menu after "@".
  const fnHints = useMemo(() => {
    if (!editing?.value.startsWith("=")) return [];
    const m = /([A-Za-z][A-Za-z0-9.]*)$/.exec(editing.value);
    if (!m) return [];
    const q = m[1]!.toUpperCase();
    return FUNCTIONS.filter((f) => f.name.startsWith(q) && f.name !== q).slice(0, 8);
  }, [editing?.value]);
  const atOpen = editing?.source === "cell" && editing.value === "@";

  if (!sheet || !workbook) return null;

  // ── What is in view ──────────────────────────────────────────────────────
  const frozenR = Math.min(sheet.frozenRows, sheet.rows);
  const frozenC = Math.min(sheet.frozenCols, sheet.cols);
  const frozenH = layout.rowY[frozenR] ?? 0;
  const frozenW = layout.colX[frozenC] ?? 0;
  const firstIn = (offsets: number[], from: number, count: number, pos: number) => {
    let lo = from;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((offsets[mid + 1] ?? 0) <= pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const c0 = Math.max(frozenC, firstIn(layout.colX, frozenC, sheet.cols, view.left + frozenW) - OVERSCAN);
  let c1 = c0;
  while (c1 < sheet.cols - 1 && (layout.colX[c1] ?? 0) < view.left + view.width) c1++;
  c1 = Math.min(sheet.cols - 1, c1 + OVERSCAN);
  const r0 = Math.max(frozenR, firstIn(layout.rowY, frozenR, sheet.rows, view.top + frozenH) - OVERSCAN);
  let r1 = r0;
  while (r1 < sheet.rows - 1 && (layout.rowY[r1] ?? 0) < view.top + view.height) r1++;
  r1 = Math.min(sheet.rows - 1, r1 + OVERSCAN);
  const cols: number[] = [];
  for (let c = 0; c < frozenC; c++) if (layout.colW[c]) cols.push(c);
  for (let c = c0; c <= c1; c++) if (layout.colW[c]) cols.push(c);
  const rows: number[] = [];
  for (let r = 0; r < frozenR; r++) if (!hidden.has(r)) rows.push(r);
  for (let r = r0; r <= r1; r++) if (!hidden.has(r)) rows.push(r);

  const sel = selectionBounds(selection);
  const filterRange = sheet.filter ? parseRangeRef(sheet.filter.range) : null;
  const inSel = (r: number, c: number) => (selection.mode === "cols" ? c >= sel.c1 && c <= sel.c2 : selection.mode === "rows" ? r >= sel.r1 && r <= sel.r2 : r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2);
  const multi = selection.mode !== "cells" || sel.r1 !== sel.r2 || sel.c1 !== sel.c2;
  const xOf = (c: number) => HW + (layout.colX[c] ?? 0) + (c < frozenC ? view.left : 0);
  const yOf = (r: number) => HH + (layout.rowY[r] ?? 0) + (r < frozenR ? view.top : 0);

  // Text that runs into empty cells to its right.
  const spill = new Map<string, number>();
  for (const r of rows) {
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i]!;
      const ref = formatCellRef(r, c);
      const cell = sheet.cells[ref];
      if (!cell || cell.t || merges.top.has(`${r},${c}`) || merges.covered.has(`${r},${c}`)) continue;
      if ((cell.s?.wrap ?? "overflow") !== "overflow") continue;
      const v = values.get(ref) ?? cell.v;
      const align = cell.s?.alignH ?? "auto";
      if (typeof v !== "string" || !v || (align !== "auto" && align !== "left")) continue;
      let extra = 0;
      for (let j = i + 1; j < cols.length && j - i <= 12; j++) {
        const cc = cols[j]!;
        if (cc !== cols[j - 1]! + 1 || isFilled(sheet.cells[formatCellRef(r, cc)]) || merges.covered.has(`${r},${cc}`) || merges.top.has(`${r},${cc}`)) break;
        extra += layout.colW[cc] ?? 0;
      }
      if (extra) spill.set(ref, extra);
    }
  }

  const openMenu = (e: React.MouseEvent, kind: MenuTarget) => {
    e.preventDefault();
    setPopover(null);
    setMenu({ x: e.clientX, y: e.clientY, kind });
  };

  // ── One cell ─────────────────────────────────────────────────────────────
  const renderCell = (r: number, c: number) => {
    const key = `${r},${c}`;
    if (merges.covered.has(key)) return null;
    const merge = merges.top.get(key);
    const ref = formatCellRef(r, c);
    const cell = sheet.cells[ref];
    const v = values.get(ref) ?? cell?.v ?? null;
    const cond = conds.get(ref);
    const s = cell?.s;
    const isEditing = editing?.source === "cell" && editing.r === r && editing.c === c;
    const w = merge ? layout.colX[merge.c2 + 1]! - layout.colX[merge.c1]! : (layout.colW[c] ?? 0);
    const h = merge ? layout.rowY[merge.r2 + 1]! - layout.rowY[merge.r1]! : (layout.rowH[r] ?? 0);
    const err = v instanceof FormulaError ? v : null;
    const isNum = typeof v === "number" && !cell?.t;
    const alignH = s?.alignH && s.alignH !== "auto" ? s.alignH : isNum || typeof v === "boolean" ? "right" : err ? "center" : "left";
    const bold = cond?.bold ?? s?.bold;
    const italic = cond?.italic ?? s?.italic;
    const fill = cond?.fill ?? s?.fill;
    const style: CSSProperties = {
      left: xOf(c),
      top: yOf(r),
      width: w,
      height: h,
      zIndex: (r < frozenR && c < frozenC ? 8 : r < frozenR || c < frozenC ? 6 : 1) + (isEditing ? 20 : 0) + (spill.has(ref) ? 1 : 0),
      // Frozen cells cover the rows and columns scrolling under them.
      background: fill ?? (r < frozenR || c < frozenC ? "var(--grid-cell)" : undefined),
      color: cond?.color ?? s?.color,
      fontWeight: bold ? 600 : undefined,
      fontStyle: italic ? "italic" : undefined,
      fontSize: ((s?.fontSize ?? DEFAULT_FONT_SIZE) * PT * zoom).toFixed(2) + "px",
      textDecoration: [s?.underline ? "underline" : "", s?.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
      borderTop: borderCss(s?.borders?.top),
      borderRight: borderCss(s?.borders?.right),
      borderBottom: borderCss(s?.borders?.bottom),
      borderLeft: borderCss(s?.borders?.left),
    };
    const text = cell ? shown(ref, cell) : "";
    const thread = commentAt.get(ref);
    const isFilterHead = !!filterRange && r === filterRange.r1 && c >= filterRange.c1 && c <= filterRange.c2;
    const chipAt = (e: React.MouseEvent<HTMLElement>, kind: CellPopoverAt["kind"]) => {
      e.stopPropagation();
      selectCell(r, c);
      setPopover({ r, c, kind, anchor: e.currentTarget });
    };
    let body: React.ReactNode;
    if (isEditing) body = null;
    else if (cell?.t === "checkbox") {
      body = (
        <button
          className={`c-check${v === true ? " on" : ""}`}
          role="checkbox"
          aria-checked={v === true}
          aria-label={`${ref} checkbox`}
          tabIndex={-1}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => {
            selectCell(r, c);
            void toggleCheckbox(r, c);
          }}
        >
          {v === true && <Icon name="check" size={12} />}
        </button>
      );
    } else if (cell?.t === "dropdown") {
      const dd = dropdownOf(cell.dropdownId);
      const opt = dd?.options.find((o) => o.label === String(v ?? "") || o.id === String(v ?? ""));
      body = (
        <button className={`c-chip opt-${opt?.color ?? "none"}`} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => chipAt(e, "dropdown")}>
          <span className="c-chip-text">{opt?.label ?? (v ? String(v) : "")}</span>
          <Icon name="chevronDown" size={12} />
        </button>
      );
    } else if (cell?.t === "person") {
      const name = cell.person?.name ?? (typeof v === "string" ? v : "");
      body = (
        <button className={`c-chip c-person${name ? "" : " empty"}`} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => chipAt(e, "person")}>
          {name ? <span className="c-avatar">{name.slice(0, 1).toUpperCase()}</span> : <Icon name="person" size={13} />}
          <span className="c-chip-text">{name || "Person"}</span>
        </button>
      );
    } else if (cell?.t === "date") {
      body = (
        <button className={`c-chip c-date${text ? "" : " empty"}`} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => chipAt(e, "date")}>
          <Icon name="calendar" size={13} />
          <span className="c-chip-text">{text || "Date"}</span>
        </button>
      );
    } else if (text) {
      const extra = spill.get(ref);
      body = (
        <span className="c-text" style={extra ? { width: w + extra } : undefined}>
          {text}
        </span>
      );
    }
    return (
      <div
        key={ref}
        data-r={r}
        data-c={c}
        className={[
          "cell",
          sheet.showGridlines ? "" : "no-grid",
          spill.has(ref) ? "spills" : "",
          `v-${s?.alignV ?? "top"}`,
          `h-${alignH}`,
          s?.wrap === "wrap" ? "wrap" : "",
          isFilterHead ? "has-filter" : "",
          inSel(r, c) && multi ? "in-sel" : "",
          err ? "err" : "",
          r === frozenR - 1 ? "frozen-edge-b" : "",
          c === frozenC - 1 ? "frozen-edge-r" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={style}
        title={err ? `${err.code} ${err.message}` : undefined}
        onMouseDown={(e) => {
          if (e.button !== 0) {
            if (!inSel(r, c)) selectCell(r, c);
            return;
          }
          setMenu(null);
          setPopover(null);
          const ed = getState().editing;
          // Writing a formula: a click puts this cell's reference in.
          if (ed && ed.value.startsWith("=") && REF_SLOT.test(ed.value) && (ed.r !== r || ed.c !== c)) {
            e.preventDefault();
            setState({ editing: { ...ed, value: `${ed.value}${ref}` } });
            requestAnimationFrame(() => (ed.source === "cell" ? editor.current : document.querySelector<HTMLInputElement>(".fx-input"))?.focus());
            return;
          }
          if (ed && (ed.r !== r || ed.c !== c)) void commitEditing();
          drag.current = { kind: "cells" };
          selectCell(r, c, e.shiftKey);
        }}
        onDoubleClick={() => {
          if (!cell?.t || cell.t === "date") startEditing(r, c, "cell");
        }}
        onContextMenu={(e) => openMenu(e, "cell")}
      >
        {body}
        {isFilterHead && (
          <button
            className={`c-filter${sheet.filter?.columnFilters[String(c)] ? " on" : ""}`}
            aria-label={`Filter column ${colToLetter(c)}`}
            tabIndex={-1}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => chipAt(e, "filter")}
          >
            <Icon name="filter" size={12} />
          </button>
        )}
        {thread && (
          <span
            className="c-comment"
            title="Comment"
            onMouseDown={(e) => {
              e.stopPropagation();
              comments.openThread(thread);
              setRightPanel("comments");
            }}
          />
        )}
      </div>
    );
  };

  // ── The editor ───────────────────────────────────────────────────────────
  const renderEditor = () => {
    if (editing?.source !== "cell") return null;
    const { r, c } = editing;
    const merge = merges.top.get(`${r},${c}`);
    const w = merge ? layout.colX[merge.c2 + 1]! - layout.colX[merge.c1]! : (layout.colW[c] ?? 0);
    const h = merge ? layout.rowY[merge.r2 + 1]! - layout.rowY[merge.r1]! : (layout.rowH[r] ?? 0);
    const cell = sheet.cells[formatCellRef(r, c)];
    const finish = (dir?: "down" | "up" | "right" | "left") => void commitEditing(dir);
    const insertFn = (name: string) => setState({ editing: { ...editing, value: editing.value.replace(/([A-Za-z][A-Za-z0-9.]*)$/, `${name}(`), fresh: false } });
    const width = Math.max(w, Math.min(560, (editing.value.length + 2) * 8 * zoom));
    return (
      <div className="c-editor" style={{ left: xOf(c), top: yOf(r), minWidth: w, width, height: Math.max(h, 24) }}>
        <input
          ref={editor}
          value={editing.value}
          placeholder="@ to insert, = for a formula"
          aria-label={`Edit ${formatCellRef(r, c)}`}
          spellCheck={false}
          style={{ fontSize: `${((cell?.s?.fontSize ?? DEFAULT_FONT_SIZE) * PT * zoom).toFixed(2)}px`, fontWeight: cell?.s?.bold ? 600 : undefined }}
          onChange={(e) => {
            setSuggest(0);
            setState({ editing: { ...editing, value: e.target.value } });
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (fnHints.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setSuggest((i) => (i + (e.key === "ArrowDown" ? 1 : fnHints.length - 1)) % fnHints.length);
              return;
            }
            if (fnHints.length && e.key === "Tab") {
              e.preventDefault();
              insertFn(fnHints[suggest]!.name);
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              finish(e.shiftKey ? "up" : "down");
            } else if (e.key === "Tab") {
              e.preventDefault();
              finish(e.shiftKey ? "left" : "right");
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEditing();
            } else if (editing.fresh && e.key.startsWith("Arrow") && !(editing.value.startsWith("=") && REF_SLOT.test(editing.value))) {
              e.preventDefault();
              finish(e.key === "ArrowDown" ? "down" : e.key === "ArrowUp" ? "up" : e.key === "ArrowLeft" ? "left" : "right");
            }
          }}
          onBlur={() => {
            // A click on a suggestion or the formula bar keeps the edit open.
            setTimeout(() => {
              const cur = getState().editing;
              if (cur && cur.r === r && cur.c === c && cur.source === "cell" && !document.activeElement?.closest(".c-editor, .fx-input, .menu")) void commitEditing();
            }, 120);
          }}
        />
        {fnHints.length > 0 && (
          <div className="c-suggest" role="listbox" aria-label="Functions" onMouseDown={(e) => e.preventDefault()}>
            {fnHints.map((f, i) => (
              <div key={f.name} role="option" aria-selected={i === suggest} className={`c-suggest-row${i === suggest ? " on" : ""}`} onMouseEnter={() => setSuggest(i)} onClick={() => insertFn(f.name)}>
                <span className="c-suggest-sig">{f.sig}</span>
                <span className="c-suggest-desc">{f.desc}</span>
              </div>
            ))}
            <div className="c-suggest-foot">Tab to insert</div>
          </div>
        )}
      </div>
    );
  };

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== host.current) return;
    const mod = e.ctrlKey || e.metaKey;
    const { anchor, focus } = selection;
    const k = e.key;
    const go = (r: number, c: number, extend: boolean) => {
      e.preventDefault();
      selectCell(r, c, extend);
    };
    // One step, past rows and columns a filter or a collapsed group hides.
    const stepR = (r: number, d: number) => {
      let n = r + d;
      while (n >= 0 && n < sheet.rows && !layout.rowH[n]) n += d;
      return n < 0 || n >= sheet.rows ? r : n;
    };
    const stepC = (c: number, d: number) => {
      let n = c + d;
      while (n >= 0 && n < sheet.cols && !layout.colW[n]) n += d;
      return n < 0 || n >= sheet.cols ? c : n;
    };
    if (k === "F2" || (k === "Enter" && !e.shiftKey && !mod)) {
      e.preventDefault();
      const cell = sheet.cells[formatCellRef(anchor.r, anchor.c)];
      if (cell?.t === "checkbox") return void toggleCheckbox(anchor.r, anchor.c);
      if (cell?.t === "dropdown" || cell?.t === "person") {
        const el = scroller.current?.querySelector<HTMLElement>(`[data-r="${anchor.r}"][data-c="${anchor.c}"] .c-chip`);
        if (el) setPopover({ r: anchor.r, c: anchor.c, kind: cell.t, anchor: el });
        return;
      }
      return startEditing(anchor.r, anchor.c, "cell");
    }
    if (k === "Enter" && e.shiftKey) return go(stepR(anchor.r, -1), anchor.c, false);
    if (k === "Escape") {
      e.preventDefault();
      if (getState().clipboard) setState({ clipboard: null });
      else selectCell(anchor.r, anchor.c);
      return;
    }
    if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      return void clearSelection("contents");
    }
    if (mod && !e.altKey) {
      const key = k.toLowerCase();
      if (key === "c" || key === "x") {
        e.preventDefault();
        return copySelection(key === "x");
      }
      if (key === "v") {
        e.preventDefault();
        return void pasteSelection(e.shiftKey);
      }
      if (key === "a") {
        e.preventDefault();
        return setSelection({ anchor: { r: 0, c: 0 }, focus: { r: sheet.rows - 1, c: sheet.cols - 1 }, mode: "cells" });
      }
      if (key === "d" || key === "r") {
        e.preventDefault();
        const b = selectionBounds();
        if (key === "d" && b.r2 > b.r1) void fillDown(b, "down");
        else if (key === "r" && b.c2 > b.c1) void fillDown(b, "right");
        return;
      }
      if (k === ";") {
        e.preventDefault();
        const now = new Date();
        return void setCellInput(anchor.r, anchor.c, `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`);
      }
      if (k === " ") {
        e.preventDefault();
        return setSelection({ anchor: { r: 0, c: Math.min(anchor.c, focus.c) }, focus: { r: sheet.rows - 1, c: Math.max(anchor.c, focus.c) }, mode: "cols" });
      }
      if (k === "Home") return go(0, 0, e.shiftKey);
      if (k === "End") {
        let lr = 0;
        let lc = 0;
        for (const ref of Object.keys(sheet.cells)) {
          const m = /^([A-Z]+)(\d+)$/.exec(ref);
          if (!m) continue;
          lr = Math.max(lr, Number(m[2]) - 1);
          lc = Math.max(lc, m[1]!.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1);
        }
        return go(lr, lc, e.shiftKey);
      }
      if (k.startsWith("Arrow")) {
        const from = e.shiftKey ? focus : anchor;
        const [dr, dc] = k === "ArrowUp" ? [-1, 0] : k === "ArrowDown" ? [1, 0] : k === "ArrowLeft" ? [0, -1] : [0, 1];
        const to = dataEdge(sheet.cells, from.r, from.c, dr, dc, sheet.rows, sheet.cols);
        return go(to.r, to.c, e.shiftKey);
      }
    }
    if (mod && e.altKey && (k === "=" || k === "-")) {
      e.preventDefault();
      const b = selectionBounds();
      if (k === "=") return void (selection.mode === "cols" ? insertColsAt(b.c1, b.c2 - b.c1 + 1) : insertRowsAt(b.r1, b.r2 - b.r1 + 1));
      return void (selection.mode === "cols" ? deleteColsAt(b.c1, b.c2 - b.c1 + 1) : deleteRowsAt(b.r1, b.r2 - b.r1 + 1));
    }
    if (e.altKey && e.shiftKey && !mod && (k === "ArrowRight" || k === "ArrowLeft")) {
      e.preventDefault();
      const axis = selection.mode === "rows" ? "row" : "col";
      return void (k === "ArrowRight" ? groupSelection(axis) : ungroupSelection(axis));
    }
    if (e.shiftKey && k === " " && !mod) {
      e.preventDefault();
      return setSelection({ anchor: { r: Math.min(anchor.r, focus.r), c: 0 }, focus: { r: Math.max(anchor.r, focus.r), c: sheet.cols - 1 }, mode: "rows" });
    }
    if (k === " " && !mod) {
      const cell = sheet.cells[formatCellRef(anchor.r, anchor.c)];
      if (cell?.t === "checkbox") {
        e.preventDefault();
        return void toggleCheckbox(anchor.r, anchor.c);
      }
    }
    const from = e.shiftKey ? focus : anchor;
    const page = Math.max(1, Math.floor((view.height - HH) / (LIMITS.defaultRowHeight * zoom)) - 1);
    if (k === "ArrowUp") return go(stepR(from.r, -1), from.c, e.shiftKey);
    if (k === "ArrowDown") return go(stepR(from.r, 1), from.c, e.shiftKey);
    if (k === "ArrowLeft") return go(from.r, stepC(from.c, -1), e.shiftKey);
    if (k === "ArrowRight") return go(from.r, stepC(from.c, 1), e.shiftKey);
    if (k === "PageDown") return go(from.r + page, from.c, e.shiftKey);
    if (k === "PageUp") return go(from.r - page, from.c, e.shiftKey);
    if (k === "Home") return go(from.r, 0, e.shiftKey);
    if (k === "End") return go(from.r, sheet.cols - 1, e.shiftKey);
    if (k === "Tab") return go(anchor.r, stepC(anchor.c, e.shiftKey ? -1 : 1), false);
    if (!mod && !e.altKey && k.length === 1) {
      const cell = sheet.cells[formatCellRef(anchor.r, anchor.c)];
      if (cell?.t === "checkbox" || cell?.t === "dropdown") return;
      e.preventDefault();
      startEditing(anchor.r, anchor.c, "cell", k);
    }
  };

  const fillDown = (b: { r1: number; c1: number; r2: number; c2: number }, dir: "down" | "right") => {
    const src = dir === "down" ? { r1: b.r1, c1: b.c1, r2: b.r1, c2: b.c2 } : { r1: b.r1, c1: b.c1, r2: b.r2, c2: b.c1 };
    setSelection({ anchor: { r: src.r1, c: src.c1 }, focus: { r: src.r2, c: src.c2 }, mode: "cells" });
    return fillRangeTo(`${formatCellRef(b.r1, b.c1)}:${formatCellRef(b.r2, b.c2)}`).then(() => setSelection({ anchor: { r: b.r1, c: b.c1 }, focus: { r: b.r2, c: b.c2 }, mode: "cells" }));
  };

  // ── Selection frame, fill and clipboard outlines ─────────────────────────
  const rect = (a: { r1: number; c1: number; r2: number; c2: number }) => {
    const x1 = HW + (layout.colX[a.c1] ?? 0) + (a.c2 < frozenC ? view.left : 0);
    const x2 = HW + (layout.colX[a.c2 + 1] ?? layout.width) + (a.c2 < frozenC ? view.left : 0);
    const y1 = HH + (layout.rowY[a.r1] ?? 0) + (a.r2 < frozenR ? view.top : 0);
    const y2 = HH + (layout.rowY[a.r2 + 1] ?? layout.height) + (a.r2 < frozenR ? view.top : 0);
    return { left: x1, top: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) };
  };
  const selRect = selection.mode === "cols" ? { r1: 0, c1: sel.c1, r2: sheet.rows - 1, c2: sel.c2 } : selection.mode === "rows" ? { r1: sel.r1, c1: 0, r2: sel.r2, c2: sheet.cols - 1 } : sel;
  const anchorMerge = merges.top.get(`${selection.anchor.r},${selection.anchor.c}`);
  const anchorRect = rect(anchorMerge ?? { r1: selection.anchor.r, c1: selection.anchor.c, r2: selection.anchor.r, c2: selection.anchor.c });
  const frame = rect(selRect);
  const clip = clipboard && clipboard.from.sheetId === sheet.id ? rect({ r1: clipboard.from.r, c1: clipboard.from.c, r2: clipboard.from.r + clipboard.rows - 1, c2: clipboard.from.c + clipboard.cols - 1 }) : null;
  const fillRect = fillTo ? rect({ r1: Math.min(sel.r1, fillTo.r), c1: Math.min(sel.c1, fillTo.c), r2: Math.max(sel.r2, fillTo.r), c2: Math.max(sel.c2, fillTo.c) }) : null;
  const fit = (col: number) => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return;
    let max = 40;
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!m || m[1] !== colToLetter(col)) continue;
      ctx.font = `${cell.s?.bold ? 600 : 400} ${(cell.s?.fontSize ?? DEFAULT_FONT_SIZE) * PT}px Inter, sans-serif`;
      max = Math.max(max, ctx.measureText(shown(ref, cell)).width + (cell.t ? 44 : 16));
    }
    void resizeTo("col", col, Math.min(800, Math.ceil(max)));
  };

  return (
    <div
      ref={host}
      className="grid-host"
      tabIndex={0}
      role="grid"
      aria-label={`${sheet.title}, ${formatCellRef(selection.anchor.r, selection.anchor.c)}`}
      aria-rowcount={sheet.rows}
      aria-colcount={sheet.cols}
      onKeyDown={onKeyDown}
    >
      <div
        ref={scroller}
        className="grid-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          setView({ top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight });
        }}
      >
        <div className="grid-canvas" style={{ width: HW + layout.width + 48, height: HH + layout.height + 64 }}>
          <button
            className="g-corner"
            style={{ left: view.left, top: view.top, width: HW, height: HH }}
            aria-label="Select all"
            tabIndex={-1}
            onClick={() => setSelection({ anchor: { r: 0, c: 0 }, focus: { r: sheet.rows - 1, c: sheet.cols - 1 }, mode: "cells" })}
          />
          {cols.map((c) => {
            const on = selection.mode === "rows" || (c >= sel.c1 && c <= sel.c2);
            const whole = selection.mode === "cols" && c >= sel.c1 && c <= sel.c2;
            return (
              <div
                key={`h${c}`}
                data-c={c}
                data-r={-1}
                className={`g-col${on ? " on" : ""}${whole ? " whole" : ""}`}
                style={{ left: xOf(c), top: view.top + HH - COL_HEADER_H, width: layout.colW[c], height: COL_HEADER_H, zIndex: c < frozenC ? 32 : 30 }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  setMenu(null);
                  if (getState().editing) void commitEditing();
                  const from = e.shiftKey ? (selection.mode === "cols" ? selection.anchor.c : sel.c1) : c;
                  drag.current = { kind: "cols", from };
                  setSelection({ anchor: { r: 0, c: from }, focus: { r: sheet.rows - 1, c }, mode: "cols" });
                }}
                onContextMenu={(e) => {
                  if (!(selection.mode === "cols" && c >= sel.c1 && c <= sel.c2)) setSelection({ anchor: { r: 0, c }, focus: { r: sheet.rows - 1, c }, mode: "cols" });
                  openMenu(e, "col");
                }}
              >
                {colToLetter(c)}
                <span
                  className="g-resize-col"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    drag.current = { kind: "resizeCol", col: c, x: e.clientX, size: sheet.colWidths[c] ?? LIMITS.defaultColWidth };
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    fit(c);
                  }}
                  title="Drag to resize; double-click to fit"
                />
              </div>
            );
          })}
          {sheet.cols < LIMITS.maxCols && (
            <button className="g-addcol" style={{ left: HW + layout.width, top: view.top + HH - COL_HEADER_H, height: COL_HEADER_H }} title="Add a column" aria-label="Add a column" tabIndex={-1} onClick={() => void addColToRight(1)}>
              <Icon name="plus" size={14} />
            </button>
          )}
          {rows.map((r) => {
            const on = selection.mode === "cols" || (r >= sel.r1 && r <= sel.r2);
            const whole = selection.mode === "rows" && r >= sel.r1 && r <= sel.r2;
            return (
              <div
                key={`h${r}`}
                data-r={r}
                data-c={-1}
                className={`g-row${on ? " on" : ""}${whole ? " whole" : ""}`}
                style={{ left: view.left + HW - ROW_HEADER_W, top: yOf(r), width: ROW_HEADER_W, height: layout.rowH[r], zIndex: r < frozenR ? 32 : 28 }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  setMenu(null);
                  if (getState().editing) void commitEditing();
                  const from = e.shiftKey ? (selection.mode === "rows" ? selection.anchor.r : sel.r1) : r;
                  drag.current = { kind: "rows", from };
                  setSelection({ anchor: { r: from, c: 0 }, focus: { r, c: sheet.cols - 1 }, mode: "rows" });
                }}
                onContextMenu={(e) => {
                  if (!(selection.mode === "rows" && r >= sel.r1 && r <= sel.r2)) setSelection({ anchor: { r, c: 0 }, focus: { r, c: sheet.cols - 1 }, mode: "rows" });
                  openMenu(e, "row");
                }}
              >
                {r + 1}
                <span
                  className="g-resize-row"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    drag.current = { kind: "resizeRow", row: r, y: e.clientY, size: sheet.rowHeights[r] ?? LIMITS.defaultRowHeight };
                  }}
                />
              </div>
            );
          })}
          {sheet.colGroups.length > 0 && (
            <div className="g-band cols" style={{ left: view.left, top: view.top, width: HW + layout.width, height: GROUP_BAND }}>
              {sheet.colGroups.map((g) => (
                <GroupMark key={g.start} axis="col" group={g} min={HW} from={xOf(g.start) - view.left} to={xOf(Math.min(g.end, sheet.cols - 1) + 1) - view.left} />
              ))}
            </div>
          )}
          {sheet.rowGroups.length > 0 && (
            <div className="g-band rows" style={{ left: view.left, top: view.top, width: GROUP_BAND, height: HH + layout.height }}>
              {sheet.rowGroups.map((g) => (
                <GroupMark key={g.start} axis="row" group={g} min={HH} from={yOf(g.start) - view.top} to={yOf(Math.min(g.end, sheet.rows - 1) + 1) - view.top} />
              ))}
            </div>
          )}
          {rows.flatMap((r) => cols.map((c) => renderCell(r, c)))}
          {frozenR > 0 && <div className="g-freeze-h" style={{ top: HH + frozenH + view.top - 1, left: view.left, width: HW + layout.width }} />}
          {frozenC > 0 && <div className="g-freeze-v" style={{ left: HW + frozenW + view.left - 1, top: view.top, height: HH + layout.height }} />}
          {clip && <div className={`g-clip${clipboard!.cut ? " cut" : ""}`} style={clip} />}
          <div className="g-frame" style={frame} />
          {!editing && <div className="g-anchor" style={anchorRect} />}
          {fillRect && <div className="g-fillto" style={fillRect} />}
          {!editing && selection.mode === "cells" && (
            <span
              className="g-handle"
              style={{ left: frame.left + frame.width - 4, top: frame.top + frame.height - 4 }}
              title="Drag to fill"
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                drag.current = { kind: "fill" };
              }}
            />
          )}
          {renderEditor()}
          <ChartLayer sheet={sheet} values={values} zoom={zoom} origin={{ x: HW, y: HH }} />
          <div className="g-addrows" style={{ left: view.left + HW + 12, top: HH + layout.height + 14 }}>
            <button className="btn ghost" disabled={sheet.rows >= LIMITS.maxRows} onClick={() => void addRowsToBottom(Math.max(1, Number.parseInt(addRows, 10) || 1))}>
              <Icon name="plus" size={14} /> Add
            </button>
            <input type="number" min={1} max={10000} value={addRows} aria-label="How many rows to add" onChange={(e) => setAddRows(e.target.value.replace(/\D/g, "").slice(0, 5))} onKeyDown={(e) => e.key === "Enter" && void addRowsToBottom(Math.max(1, Number.parseInt(addRows, 10) || 1))} />
            <span>{Number.parseInt(addRows, 10) === 1 ? "row" : "rows"}</span>
          </div>
        </div>
      </div>
      {atOpen && <AtMenu anchor={editor.current} />}
      {popover && <CellPopover at={popover} onClose={() => setPopover(null)} />}
      {menu && <Menu anchor={{ x: menu.x, y: menu.y }} entries={cellMenuEntries(menu.kind)} onClose={() => setMenu(null)} label="Cell actions" />}
    </div>
  );
}

/** One group in the strip: a bracket over its columns (or beside its rows) with a button to collapse it, or a lone button where it is collapsed. */
function GroupMark({ axis, group, min, from, to }: { axis: "col" | "row"; group: GroupRange; min: number; from: number; to: number }) {
  const what = axis === "col" ? `columns ${colToLetter(group.start)}–${colToLetter(group.end)}` : `rows ${group.start + 1}–${group.end + 1}`;
  const pos = axis === "col" ? "left" : "top";
  const size = axis === "col" ? "width" : "height";
  return (
    <>
      {!group.collapsed && <span className="g-group-line" style={{ [pos]: from + 4, [size]: Math.max(0, to - from - 14) }} />}
      <button
        className="g-group-btn"
        style={{ [pos]: group.collapsed ? Math.max(min + 1, from - 7) : to - 16 }}
        title={group.collapsed ? `Expand ${what}` : `Collapse ${what}`}
        aria-label={group.collapsed ? `Expand ${what}` : `Collapse ${what}`}
        aria-expanded={!group.collapsed}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => void toggleGroup(axis, group.start)}
      >
        <Icon name={group.collapsed ? "plus" : "minus"} size={10} />
      </button>
    </>
  );
}

/** "@" typed into a cell: insert a chip there instead of text. Choosing, Esc or a click away ends the edit. */
function AtMenu({ anchor }: { anchor: HTMLElement | null }) {
  if (!anchor) return null;
  return <Menu anchor={anchor} entries={[{ heading: "Insert" }, ...insertEntries()]} label="Insert" onClose={cancelEditing} />;
}
