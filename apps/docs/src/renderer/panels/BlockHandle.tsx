// Beside the line under the pointer: the connected AI's mark, which opens
// the AI box about that line. Tables and images get a "…" menu of what can
// be done to them instead, and tables "+" edges to add a row or a column.
//
// The line is found by where the pointer is, not by what it is over: the
// whole row across the page column counts, including the gaps between lines
// and the margin the button sits in, so the button never goes away on the
// way to it.

import { useEffect, useState } from "react";
import { BLOCKS } from "@opendeck/doc";
import { Icon, MenuButton, type MenuEntry } from "@opendeck/shell";
import { addColumn, addRow, cellAt, deleteBlock, deleteColumn, deleteRow, setImageWidth, toggleCaption, toggleHeaderRow } from "../editor/commands.ts";
import { newComment } from "../editor/comments.ts";
import { lineAtY } from "../editor/lines.ts";
import { onLayout, pageEl } from "../editor/page.ts";
import { useDocs } from "../store.ts";
import { AssistantMark, useAssistant } from "./assistant.tsx";
import { openInlineAsk } from "./InlineAsk.tsx";

interface Hover {
  id: string;
  tag: string;
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** The middle of the first line, from the top of the block. */
  mid: number;
  empty: boolean;
  /** The furthest right a button may start and still be inside the page's scroll area. */
  limit: number;
}

const WIDTHS: [string, number | null][] = [
  ["Small", 40],
  ["Medium", 70],
  ["Full width", null],
];

/** Blocks that get a "…" menu; every other block gets the AI mark. */
const MENU_BLOCKS = new Set(["table", "figure", "hr"]);
/** How far past the page column the pointer still counts as on a line (the button sits in this). */
const REACH_RIGHT = 56;
const REACH_LEFT = 24;
const BTN = 28;

/** The block level with `y`: the one it's over, else the one just above the gap it's in. */
function blockAtY(page: HTMLElement, y: number): HTMLElement | null {
  const kids = page.children;
  return (kids[lineAtY(kids.length, (i) => kids[i]!.getBoundingClientRect(), y)] as HTMLElement | undefined) ?? null;
}

export function BlockHandle() {
  const [hover, setHover] = useState<Hover | null>(null);
  const ai = useAssistant();
  const asking = useDocs((s) => s.inlineAsk?.block ?? null);

  useEffect(() => {
    const page = pageEl();
    const wrap = page?.parentElement;
    const stage = wrap?.closest<HTMLElement>(".dt-stage");
    if (!page || !wrap || !stage) return;
    let current: HTMLElement | null = null;
    let frame = 0;
    let last: { x: number; y: number } | null = null;

    const place = (b: HTMLElement | null) => {
      current = b;
      if (!b?.id) return setHover(null);
      const w = wrap.getBoundingClientRect();
      const r = b.getBoundingClientRect();
      const first = (b.tagName === "UL" || b.tagName === "OL" ? b.querySelector("li") : b) ?? b;
      const lh = parseFloat(getComputedStyle(first).lineHeight) || 26;
      const mid = first.getBoundingClientRect().top - r.top + Math.min(lh, r.height) / 2;
      const empty = !b.textContent?.trim() && !b.querySelector("img, table, hr, time, span[data-dropdown]");
      const limit = stage.getBoundingClientRect().left + stage.clientWidth - w.left - BTN - 4;
      setHover((h) =>
        h && h.id === b.id && h.top === r.top - w.top && h.bottom === r.bottom - w.top && h.right === r.right - w.left && h.mid === mid && h.empty === empty && h.limit === limit
          ? h
          : { id: b.id, tag: b.tagName.toLowerCase(), top: r.top - w.top, right: r.right - w.left, bottom: r.bottom - w.top, left: r.left - w.left, mid, empty, limit },
      );
    };
    // While a block's menu is open, its handle stays put.
    const menuOpen = () => !!document.querySelector('[role="menu"]');
    const update = () => {
      frame = 0;
      if (!last || menuOpen()) return;
      const p = page.getBoundingClientRect();
      const { x, y } = last;
      if (x < p.left - REACH_LEFT || x > p.right + REACH_RIGHT || y < p.top - 4 || y > p.bottom + 4) {
        if (current) place(null);
        return;
      }
      const b = blockAtY(page, y);
      if (b !== current) place(b);
    };
    const onMove = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onLeave = () => {
      last = null;
      if (!menuOpen()) place(null);
    };
    const relayout = () => (current?.isConnected ? place(current) : place(null));
    stage.addEventListener("pointermove", onMove, { passive: true });
    stage.addEventListener("pointerleave", onLeave);
    const off = onLayout(relayout);
    // A column opening beside the page (chat, comments) or the window resizing moves the lines.
    const ro = new ResizeObserver(relayout);
    ro.observe(page);
    ro.observe(stage);
    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      off();
      ro.disconnect();
    };
  }, []);

  if (!hover || hover.id === asking) return null;
  const label = BLOCKS[hover.tag]?.label ?? "block";
  const isTable = hover.tag === "table";
  // Buttons keep the caret where it was in the text.
  const keep = (e: React.MouseEvent) => e.preventDefault();

  if (!MENU_BLOCKS.has(hover.tag)) {
    const what = hover.empty ? `Ask ${ai.name} to write here` : `Ask ${ai.name} about this ${label.toLowerCase()}`;
    return (
      <button className="bh bh-ai" style={{ top: hover.top + hover.mid - BTN / 2, left: Math.min(hover.right + 10, hover.limit) }} onMouseDown={keep} onClick={() => openInlineAsk(hover.id)} title={what} aria-label={what}>
        <AssistantMark size={16} />
      </button>
    );
  }

  const entries = (): MenuEntry[] => {
    const cell = isTable ? cellAt(hover.id) : null;
    const out: MenuEntry[] = [
      { label: `Ask ${ai.name}`, icon: <AssistantMark size={16} />, onSelect: () => openInlineAsk(hover.id) },
      { label: "Comment", icon: <Icon name="chat" size={16} />, onSelect: () => newComment(hover.id) },
    ];
    if (isTable) {
      out.push("separator", { label: "Add row", onSelect: () => addRow(hover.id, cell?.[0]) }, { label: "Add column", onSelect: () => addColumn(hover.id, cell?.[1]) }, { label: "Header row", onSelect: () => toggleHeaderRow(hover.id) });
      if (cell) out.push({ label: "Delete row", onSelect: () => deleteRow(hover.id, cell[0]) }, { label: "Delete column", onSelect: () => deleteColumn(hover.id, cell[1]) });
    }
    if (hover.tag === "figure") {
      const fig = pageEl()?.querySelector<HTMLElement>(`:scope > [id="${CSS.escape(hover.id)}"]`);
      const width = Number(fig?.getAttribute("data-width") ?? 100);
      out.push("separator", ...WIDTHS.map(([name, w]) => ({ label: name, checked: (w ?? 100) === width, onSelect: () => setImageWidth(hover.id, w) })), { label: fig?.querySelector("figcaption") ? "Remove caption" : "Add caption", onSelect: () => toggleCaption(hover.id) });
    }
    out.push("separator", { label: `Delete ${label.toLowerCase()}`, danger: true, onSelect: () => deleteBlock(hover.id, `Delete ${label.toLowerCase()}`) });
    return out;
  };

  return (
    <>
      <div className="bh bh-menu" style={{ top: hover.top + Math.min(hover.mid, 22) - BTN / 2, left: Math.min(hover.right + (isTable ? 22 : 10), hover.limit) }}>
        <MenuButton className="icon-btn bh-btn" label={`${label} actions`} title={`${label} actions`} align="start" entries={entries}>
          <Icon name="dots" />
        </MenuButton>
      </div>
      {isTable && (
        <>
          <button className="bh bh-edge bh-col" style={{ top: hover.top, left: hover.right + 2, height: hover.bottom - hover.top }} onMouseDown={keep} onClick={() => addColumn(hover.id)} title="Add column" aria-label="Add column">
            <Icon name="plus" size={12} />
          </button>
          <button className="bh bh-edge bh-row" style={{ top: hover.bottom + 2, left: hover.left, width: hover.right - hover.left }} onMouseDown={keep} onClick={() => addRow(hover.id)} title="Add row" aria-label="Add row">
            <Icon name="plus" size={12} />
          </button>
        </>
      )}
    </>
  );
}
