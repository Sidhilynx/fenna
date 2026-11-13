// The tools at the bottom: select and hand, then what you can put on the
// board, comments, and Ask. The pen, shape and sticker buttons open their
// choices above the bar.

import { useEffect, useRef, useState } from "react";
import { COLOR_LABELS, INK_COLORS, INK_VALUES, SHAPE_LABELS, STICKERS, stickerSvg, type ShapeKind, type StickerId } from "@opendeck/board";
import { Icon, shortcut, type IconName } from "@opendeck/shell";
import { useAssistant } from "../assistant.ts";
import { addItems, getState, insertImages, makeItem, setState, setTool, toggleFlyout, useBoard, viewCenter, type Tool } from "../store.ts";
import { useTheme } from "../theme.ts";
import { ShapeIcon } from "./ShapeIcon.tsx";

/** Single-key shortcuts for the tools (when turned on). */
export const TOOL_KEYS: Record<string, Tool | "stickers"> = { v: "select", h: "hand", t: "text", f: "frame", s: "sticky", p: "pen", a: "arrow", r: "shape", e: "stickers", c: "comment" };
const keyOf = (t: Tool | "stickers") => Object.entries(TOOL_KEYS).find(([, v]) => v === t)?.[0]?.toUpperCase() ?? "";

const SHAPE_ROWS: (ShapeKind | "text")[][] = [["text", "square", "circle"], ["pill", "diamond", "rect", "hexagon", "parallelogram"], ["cylinder", "drum", "document", "cloud", "person"]];

export function Dock() {
  const tool = useBoard((s) => s.tool);
  const flyout = useBoard((s) => s.flyout);
  const penMode = useBoard((s) => s.penMode);
  const shapeKind = useBoard((s) => s.shapeKind);
  const keys = useBoard((s) => s.meta?.settings.shortcuts ?? true);
  const asking = useBoard((s) => s.asking);
  const ai = useAssistant();

  return (
    <div className="wb-dock-wrap" onPointerDown={(e) => e.stopPropagation()}>
      {flyout === "pen" && <PenFlyout />}
      {flyout === "shapes" && <ShapeFlyout />}
      {flyout === "stickers" && <StickerFlyout />}
      <nav className="wb-dock" aria-label="Tools">
        <ToolBtn tool={tool} keys={keys} t="select" icon="pointer" name="Select" />
        <ToolBtn tool={tool} keys={keys} t="hand" icon="hand" name="Hand" />
        <span className="wb-dock-sep" aria-hidden />
        <ToolBtn tool={tool} keys={keys} t="text" icon="text" name="Text" />
        <ToolBtn tool={tool} keys={keys} t="frame" icon="frame" name="Frame" />
        <ToolBtn tool={tool} keys={keys} t="sticky" icon="sticky" name="Sticky note" />
        <ToolBtn
          tool={tool}
          keys={keys}
          t={penMode}
          icon={penMode === "pen" ? "pencil" : "arrowDiagonal"}
          name={penMode === "pen" ? "Pen" : "Arrow"}
          pressed={tool === "pen" || tool === "arrow"}
          onClick={() => {
            setTool(penMode);
            toggleFlyout("pen");
          }}
        />
        <ToolBtn
          tool={tool}
          keys={keys}
          t="shape"
          name={SHAPE_LABELS[shapeKind]}
          onClick={() => {
            setTool("shape");
            toggleFlyout("shapes");
          }}
        >
          <ShapeIcon kind={shapeKind} />
        </ToolBtn>
        <ToolBtn tool={tool} keys={keys} t="stickers" icon="smile" name="Stickers" pressed={flyout === "stickers"} onClick={() => toggleFlyout("stickers")} />
        <ToolBtn tool={tool} keys={keys} t="comment" icon="chat" name="Comment" />
        <button className={`wb-ask${asking ? " on" : ""}`} aria-pressed={asking} title={`Ask ${ai.name} (${shortcut("Mod+K")})`} onClick={() => setState({ asking: !getState().asking })}>
          Ask {ai.name}
        </button>
      </nav>
    </div>
  );
}

function ToolBtn({ tool, keys, t, icon, name, children, onClick, pressed }: { tool: Tool; keys: boolean; t: Tool | "stickers"; icon?: IconName; name: string; children?: React.ReactNode; onClick?(): void; pressed?: boolean }) {
  return (
    <button className="wb-tool" aria-pressed={pressed ?? tool === t} aria-label={name} title={keys ? `${name} (${keyOf(t)})` : name} onClick={onClick ?? (() => setTool(t as Tool))}>
      {icon ? <Icon name={icon} size={18} /> : children}
    </button>
  );
}

function PenFlyout() {
  const penMode = useBoard((s) => s.penMode);
  const color = useBoard((s) => s.penColor);
  const theme = useTheme();
  return (
    <div className="wb-fly" role="toolbar" aria-label="Pen">
      <button className="icon-btn wb-fb-btn" aria-pressed={penMode === "pen"} aria-label="Pen" title="Pen" onClick={() => setState({ tool: "pen", penMode: "pen" })}>
        <Icon name="pencil" size={18} />
      </button>
      <button className="icon-btn wb-fb-btn" aria-pressed={penMode === "arrow"} aria-label="Arrow" title="Arrow" onClick={() => setState({ tool: "arrow", penMode: "arrow" })}>
        <Icon name="arrowDiagonal" size={18} />
      </button>
      <span className="wb-fb-sep" aria-hidden />
      {INK_COLORS.map((c) => (
        <button key={c} className="wb-swatch-btn" aria-pressed={color === c} aria-label={COLOR_LABELS[c]} title={COLOR_LABELS[c]} onClick={() => setState({ penColor: c, tool: "pen", penMode: "pen" })}>
          <span className="wb-swatch" style={{ background: INK_VALUES[theme][c] }} />
        </button>
      ))}
    </div>
  );
}

function ShapeFlyout() {
  const shapeKind = useBoard((s) => s.shapeKind);
  return (
    <div className="wb-fly wb-pop-grid" role="group" aria-label="Shapes">
      {SHAPE_ROWS.map((row, i) => (
        <div key={i} className="wb-pop-row">
          {row.map((k) => (
            <button
              key={k}
              className="icon-btn wb-fb-btn"
              aria-pressed={k === shapeKind}
              aria-label={k === "text" ? "Text" : SHAPE_LABELS[k]}
              title={k === "text" ? "Text" : SHAPE_LABELS[k]}
              onClick={() => (k === "text" ? setTool("text") : setState({ shapeKind: k, tool: "shape", flyout: null }))}
            >
              {k === "text" ? <Icon name="text" size={18} /> : <ShapeIcon kind={k} />}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function StickerFlyout() {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const q = query.trim().toLowerCase();
  const list = STICKERS.filter((s) => !q || s.label.toLowerCase().includes(q) || s.id.includes(q));
  const place = (id: StickerId) => {
    const it = makeItem("sticker", viewCenter(), { sticker: id } as never);
    addItems("Add sticker", [it]);
    setState({ flyout: null, tool: "select" });
  };
  return (
    <div
      className="wb-fly wb-stickers"
      role="dialog"
      aria-label="Stickers"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setState({ flyout: null });
        }
      }}
    >
      <div className="wb-sticker-search">
        <Icon name="search" size={16} />
        <input
          ref={input}
          value={query}
          placeholder="Search stickers"
          aria-label="Search stickers"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && list[0]) place(list[0].id);
          }}
        />
      </div>
      <div className="wb-sticker-grid">
        {!q && (
          <button
            className="wb-sticker"
            aria-label="Insert an image"
            title="Insert an image"
            onClick={() => {
              setState({ flyout: null });
              void insertImages(null);
            }}
          >
            <Icon name="image" size={22} />
          </button>
        )}
        {list.map((s) => (
          <button key={s.id} className="wb-sticker" aria-label={s.label} title={s.label} onClick={() => place(s.id)}>
            <svg viewBox="-8 -8 116 116" width="34" height="34" aria-hidden dangerouslySetInnerHTML={{ __html: stickerSvg(s.id, 0, 0, 100, 100) }} />
          </button>
        ))}
        {!list.length && <p className="wb-sticker-none">No sticker matches “{query.trim()}”.</p>}
      </div>
    </div>
  );
}
