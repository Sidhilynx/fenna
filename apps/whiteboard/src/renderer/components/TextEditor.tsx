// Editing text in place: a field laid exactly over where the renderer draws
// the item's text, at the same size, so typing looks like the board. Esc or a
// click elsewhere keeps the text; Enter makes a new line (Ctrl+Enter keeps).

import { useLayoutEffect, useRef, useState } from "react";
import { connectorLabelBox, LINE_HEIGHT, layoutText, TEXT_SIZE_PX, textBox, type BoardItem } from "@opendeck/board";
import { finishEditing, getState, setState, useBoard } from "../store.ts";
import { useTheme } from "../theme.ts";

const FONT_WEIGHT = (bold?: boolean) => (bold ? 700 : 400);

export function TextEditor() {
  const editing = useBoard((s) => s.editing)!;
  const item = useBoard((s) => s.byId.get(s.editing!.id));
  const view = useBoard((s) => s.view);
  const theme = useTheme();
  if (!item) return null;
  const key = `${editing.id}:${editing.cell?.join(",") ?? ""}`;
  return <Field key={key} item={item} cell={editing.cell} view={view} theme={theme} />;
}

function initial(item: BoardItem, cell?: [number, number]): string {
  if (item.kind === "table" && cell) return item.cells[cell[0]]?.[cell[1]] ?? "";
  if (item.kind === "frame") return item.title;
  if (item.kind === "connector") return item.label ?? "";
  return "text" in item ? (item.text ?? "") : "";
}

function Field({ item, cell, view, theme }: { item: BoardItem; cell?: [number, number]; view: { x: number; y: number; zoom: number }; theme: "dark" | "light" }) {
  const [value, setValue] = useState(() => initial(item, cell));
  const latest = useRef(value);
  latest.current = value;
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const done = useRef(false);
  const z = view.zoom;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, []);

  const keep = () => {
    if (done.current) return;
    done.current = true;
    finishEditing(latest.current);
  };

  const single = item.kind === "frame" || item.kind === "connector" || (item.kind === "table" && !!cell);
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey || single))) {
      e.preventDefault();
      keep();
      getState().byId.has(item.id) && setState({ selection: [item.id] });
    }
  };

  const toScreen = (x: number, y: number) => ({ left: x * z + view.x, top: y * z + view.y });
  let style: React.CSSProperties;
  let className = "wb-editor";
  let wrapper: React.CSSProperties | null = null;

  if (item.kind === "frame") {
    style = { ...toScreen(item.x, item.y - 26), width: Math.max(120, item.width * z), height: 22, fontSize: 14, fontWeight: 600 };
    className += " wb-editor-line";
  } else if (item.kind === "connector") {
    const b = connectorLabelBox({ ...item, label: value || " " }, getState().byId);
    const w = Math.max(120, (b?.width ?? 120) + 40);
    const mid = b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : { x: 0, y: 0 };
    style = { left: mid.x * z + view.x - w / 2, top: mid.y * z + view.y - 14, width: w, height: 28, fontSize: 13, textAlign: "center" };
    className += " wb-editor-line wb-editor-chip";
  } else if (item.kind === "table" && cell) {
    const rows = item.cells.length;
    const cols = item.cells[0]?.length ?? 1;
    const rh = item.height / rows;
    const cw = item.width / cols;
    const px = TEXT_SIZE_PX[item.size ?? "body"];
    style = { ...toScreen(item.x + cell[1] * cw, item.y + cell[0] * rh), width: cw * z, height: rh * z, fontSize: px * z, fontWeight: FONT_WEIGHT(cell[0] === 0), padding: `0 ${10 * z}px`, textAlign: item.align ?? "left" };
    className += " wb-editor-line wb-editor-cell";
  } else if (item.kind === "sticky" || item.kind === "text" || item.kind === "shape") {
    const box = textBox(item, theme);
    const px = TEXT_SIZE_PX[item.size ?? "body"];
    const block = layoutText(value || " ", { width: box.width, size: item.size, bold: item.bold, list: item.list });
    const top = box.middle ? Math.max(0, (box.height - block.height) / 2) : 0;
    const height = item.kind === "text" ? Math.max(block.height, Math.round(px * LINE_HEIGHT)) : box.height - top;
    wrapper = { left: item.x * z + view.x, top: item.y * z + view.y, width: item.width * z, height: item.height * z, transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined };
    style = {
      left: (box.x - item.x) * z,
      top: (box.y - item.y + top) * z,
      width: box.width * z,
      height: height * z,
      fontSize: px * z,
      lineHeight: LINE_HEIGHT,
      fontWeight: FONT_WEIGHT(item.bold),
      fontStyle: item.italic ? "italic" : undefined,
      textAlign: box.align,
      color: box.color,
    };
    className += item.kind === "text" ? "" : " wb-editor-on-fill";
  } else return null;

  const field = single ? (
    <input ref={ref} className={className} style={style} value={value} maxLength={item.kind === "frame" ? 200 : 2000} aria-label={item.kind === "frame" ? "Frame name" : item.kind === "connector" ? "Connector label" : "Cell"} onChange={(e) => setValue(e.target.value)} onBlur={keep} onKeyDown={onKeyDown} onPointerDown={(e) => e.stopPropagation()} />
  ) : (
    <textarea ref={ref} className={className} style={style} value={value} spellCheck aria-label="Text" onChange={(e) => setValue(e.target.value)} onBlur={keep} onKeyDown={onKeyDown} onPointerDown={(e) => e.stopPropagation()} />
  );
  return wrapper ? (
    <div className="wb-editor-box" style={wrapper}>
      {field}
    </div>
  ) : (
    field
  );
}
