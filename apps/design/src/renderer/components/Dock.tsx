// The tools at the bottom: select and hand, then what you can put on the
// canvas or an artboard, comments, and Ask. The artboard, pencil and shape
// buttons show their choices above the bar.

import { BOARD_SIZES, STROKE_WIDTHS, type ShapeKind } from "@opendeck/artboard";
import { Icon, shortcut, type IconName } from "@opendeck/shell";
import { useAssistant } from "../assistant.ts";
import { addArtboard, getState, setState, setTool, useDesign, type Tool } from "../store.ts";

/** Single-key shortcuts for the tools. */
export const TOOL_KEYS: Record<string, Tool> = { v: "select", h: "hand", t: "text", a: "artboard", s: "sticky", p: "pen", r: "shape", c: "comment" };
const keyOf = (t: Tool) => Object.entries(TOOL_KEYS).find(([, v]) => v === t)?.[0]?.toUpperCase() ?? "";

/** The shapes the dock offers, of the format's kinds. */
const SHAPES: { kind: ShapeKind; icon: IconName; name: string }[] = [
  { kind: "rect", icon: "shapeRect", name: "Rectangle" },
  { kind: "ellipse", icon: "shapeEllipse", name: "Oval" },
  { kind: "arrow-right", icon: "shapeArrowRight", name: "Arrow" },
  { kind: "line", icon: "shapeLine", name: "Line" },
];

export function Dock() {
  const tool = useDesign((s) => s.tool);
  const flyout = useDesign((s) => s.flyout);
  const shapeKind = useDesign((s) => s.shapeKind);
  const asking = useDesign((s) => s.asking);
  const ai = useAssistant();
  const shape = SHAPES.find((s) => s.kind === shapeKind) ?? SHAPES[0]!;

  return (
    <div className="dg-dock-wrap" onPointerDown={(e) => e.stopPropagation()}>
      {flyout === "artboard" && <ArtboardFlyout />}
      {flyout === "pen" && <PenFlyout />}
      {flyout === "shape" && <ShapeFlyout />}
      <nav className="dg-dock" aria-label="Tools">
        <ToolBtn tool={tool} t="select" icon="pointer" name="Select" />
        <ToolBtn tool={tool} t="hand" icon="hand" name="Hand" />
        <span className="dg-dock-sep" aria-hidden />
        <ToolBtn tool={tool} t="text" icon="text" name="Text" />
        <ToolBtn tool={tool} t="artboard" icon="frame" name="Artboard" />
        <ToolBtn tool={tool} t="sticky" icon="sticky" name="Sticky note" />
        <ToolBtn tool={tool} t="pen" icon="pencil" name="Pencil" />
        <ToolBtn tool={tool} t="shape" icon={shape.icon} name={shape.name} />
        <ToolBtn tool={tool} t="comment" icon="chat" name="Comment" />
        <button className={`dg-ask${asking ? " on" : ""}`} aria-pressed={asking} title={`Ask ${ai.name} (${shortcut("Mod+K")})`} onClick={() => setState({ asking: !getState().asking })}>
          Ask {ai.name}
        </button>
      </nav>
    </div>
  );
}

function ToolBtn({ tool, t, icon, name }: { tool: Tool; t: Tool; icon: IconName; name: string }) {
  return (
    <button className="dg-tool" aria-pressed={tool === t} aria-label={name} title={`${name} (${keyOf(t)})`} onClick={() => setTool(t)}>
      <Icon name={icon} size={18} />
    </button>
  );
}

function ArtboardFlyout() {
  const chosen = useDesign((s) => s.boardSize);
  return (
    <div className="dg-fly" role="toolbar" aria-label="Artboard sizes">
      {BOARD_SIZES.map((b) => (
        <button
          key={b.name}
          className="dg-fly-size"
          aria-pressed={chosen === b.name}
          title={`Add a ${b.width} × ${b.height} artboard beside the others`}
          onClick={() => {
            setState({ boardSize: b.name });
            addArtboard(b.name);
          }}
        >
          <span>{b.name}</span>
          <span className="dg-fly-dim">{b.expand === "fill" ? `${b.width} wide` : `${b.width} × ${b.height}`}</span>
        </button>
      ))}
    </div>
  );
}

function PenFlyout() {
  const width = useDesign((s) => s.penWidth);
  const dashed = useDesign((s) => s.penDashed);
  return (
    <div className="dg-fly" role="toolbar" aria-label="Pencil">
      {STROKE_WIDTHS.map((w, i) => (
        <button key={w} className="icon-btn dg-fb-btn" aria-pressed={width === w} aria-label={`Stroke ${i + 1} of ${STROKE_WIDTHS.length}`} title={`${w} px`} onClick={() => setState({ penWidth: w })}>
          <span className="dg-dot" style={{ width: 4 + i * 3, height: 4 + i * 3 }} />
        </button>
      ))}
      <span className="dg-fb-sep" aria-hidden />
      <button className="icon-btn dg-fb-btn" aria-pressed={dashed} aria-label="Dashed" title="Dashed" onClick={() => setState({ penDashed: !dashed })}>
        <Icon name="lineDashed" size={18} />
      </button>
    </div>
  );
}

function ShapeFlyout() {
  const shapeKind = useDesign((s) => s.shapeKind);
  return (
    <div className="dg-fly" role="toolbar" aria-label="Shapes">
      {SHAPES.map((s) => (
        <button key={s.kind} className="icon-btn dg-fb-btn" aria-pressed={s.kind === shapeKind} aria-label={s.name} title={s.name} onClick={() => setState({ shapeKind: s.kind })}>
          <Icon name={s.icon} size={18} />
        </button>
      ))}
    </div>
  );
}
