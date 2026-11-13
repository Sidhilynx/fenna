// The bar over the selection: what the selected kind can change, in the
// reference's order, then lock, comment and "…". Its pickers open above it.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CAPS,
  COLOR_LABELS,
  FILL_COLORS,
  FILL_VALUES,
  INK_COLORS,
  INK_VALUES,
  KIND_LABELS,
  LINE_STYLES,
  ROUTES,
  SHAPE_DEFAULTS,
  SHAPE_LABELS,
  TEXT_SIZE_LABELS,
  TEXT_SIZE_PX,
  TEXT_SIZES,
  textItemHeight,
  type Align,
  type BoardItem,
  type Cap,
  type FillColor,
  type InkColor,
  type ItemKind,
  type ShapeKind,
  type TextSize,
} from "@opendeck/board";
import { Icon, MenuButton, shortcut, type IconName } from "@opendeck/shell";
import { useAssistant } from "../assistant.ts";
import { commentOnSelection, getState, setState, styleSelection, toggleLock, updateItems, useBoard } from "../store.ts";
import { useTheme } from "../theme.ts";
import { selectionScreenBox } from "./Canvas.tsx";
import { itemMenu } from "./menus.tsx";
import { ShapeIcon } from "./ShapeIcon.tsx";

type Pop = "shape" | "color" | "style" | "startCap" | "endCap" | null;
const TEXTY: ItemKind[] = ["sticky", "text", "shape"];
const ALIGN_NEXT: Record<Align, Align> = { left: "center", center: "right", right: "left" };
const ALIGN_ICON: Record<Align, IconName> = { left: "alignLeft", center: "alignCenter", right: "alignRight" };

/** A link as people type it, made into one a browser opens. */
export function normalizeLink(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^(https?:|mailto:)/i.test(t)) return t.slice(0, 2000);
  if (/^[\w.-]+\.[a-z]{2,}(\/|$|\?|#|:)/i.test(t)) return `https://${t}`.slice(0, 2000);
  return null;
}

export function FloatingBar() {
  const selection = useBoard((s) => s.selection);
  const byId = useBoard((s) => s.byId);
  const tool = useBoard((s) => s.tool);
  const dragging = useBoard((s) => s.dragging);
  const linking = useBoard((s) => s.linking);
  const editing = useBoard((s) => s.editing);
  useBoard((s) => s.view);
  useBoard((s) => s.viewport);
  const [pop, setPop] = useState<Pop>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const sel = selection.map((id) => byId.get(id)).filter((it): it is BoardItem => !!it);
  const kinds = new Set(sel.map((it) => it.kind));
  const kind = kinds.size === 1 ? sel[0]!.kind : null;
  const key = `${selection.join(",")}|${linking}`;

  useEffect(() => setPop(null), [selection.join(",")]);
  useLayoutEffect(() => {
    if (bar.current) setWidth(bar.current.offsetWidth);
  });

  if (!sel.length || tool !== "select" || dragging || (editing && kind === "table")) return null;
  const box = selectionScreenBox();
  if (!box) return null;
  const { viewport } = getState();
  // Above the selection, clear of its connection dots; the rotate handle sits above the bar.
  const above = box.y - 72;
  const top = above >= 8 ? above : Math.min(viewport.height - 120, box.y + box.height + 32);
  const left = Math.min(Math.max(8, box.x + box.width / 2 - width / 2), Math.max(8, viewport.width - width - 8));
  const locked = sel.every((it) => it.locked);

  return (
    <div
      ref={bar}
      key={key}
      className="wb-fbar"
      role="toolbar"
      aria-label={kind ? `${KIND_LABELS[kind]} options` : "Selection options"}
      style={{ left, top, visibility: width ? "visible" : "hidden" }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape" && pop) {
          e.stopPropagation();
          setPop(null);
        }
      }}
    >
      {linking ? <LinkField item={sel[0]!} /> : <Controls sel={sel} kind={locked ? null : kind} locked={locked} pop={pop} setPop={setPop} />}
    </div>
  );
}

function Btn({ icon, label, on, onClick, children, disabled }: { icon?: IconName; label: string; on?: boolean; onClick(): void; children?: React.ReactNode; disabled?: boolean }) {
  return (
    <button className="icon-btn wb-fb-btn" aria-label={label} title={label} aria-pressed={on} disabled={disabled} onClick={onClick}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

const Sep = () => <span className="wb-fb-sep" aria-hidden />;

function Controls({ sel, kind, locked, pop, setPop }: { sel: BoardItem[]; kind: ItemKind | null; locked: boolean; pop: Pop; setPop(p: Pop): void }) {
  const ai = useAssistant();
  const theme = useTheme();
  const first = sel[0]!;
  const f = first as BoardItem & { size?: TextSize; bold?: boolean; italic?: boolean; align?: Align; list?: boolean; color?: string; fill?: string; link?: string };
  const toggle = (p: Exclude<Pop, null>) => setPop(pop === p ? null : p);
  const parts: React.ReactNode[] = [];
  const texty = kind !== null && TEXTY.includes(kind);

  if (kind === "text" || kind === "shape") {
    parts.push(
      <Btn key="shape" label={kind === "text" ? "Turn into a shape" : "Shape"} on={pop === "shape"} onClick={() => toggle("shape")}>
        {kind === "text" ? <Icon name="text" size={18} /> : <ShapeIcon kind={(first as { shape: ShapeKind }).shape} />}
      </Btn>,
      <Sep key="s0" />,
    );
  }
  if (texty || kind === "table") {
    const size = f.size ?? "body";
    parts.push(
      <MenuButton
        key="size"
        className="btn ghost wb-fb-size"
        label="Text size"
        title="Text size"
        entries={() => TEXT_SIZES.map((s) => ({ label: TEXT_SIZE_LABELS[s], aside: `${TEXT_SIZE_PX[s]}px`, checked: s === size, onSelect: () => styleSelection("Text size", { size: s === "body" ? undefined : s }) }))}
      >
        {TEXT_SIZE_LABELS[size]}
      </MenuButton>,
    );
  }
  if (kind === "text") {
    parts.push(
      <Btn key="color" label="Text color" on={pop === "color"} onClick={() => toggle("color")}>
        <span className="wb-swatch-t" style={{ background: INK_VALUES[theme][(f.color as InkColor) ?? "default"] }}>
          T
        </span>
      </Btn>,
    );
  }
  if (texty) {
    parts.push(
      <Btn key="b" icon="bold" label={`Bold (${shortcut("Mod+B")})`} on={!!f.bold} onClick={() => styleSelection("Bold", { bold: f.bold ? undefined : true })} />,
      <Btn key="i" icon="italic" label={`Italic (${shortcut("Mod+I")})`} on={!!f.italic} onClick={() => styleSelection("Italic", { italic: f.italic ? undefined : true })} />,
      <Btn key="link" icon="link" label={f.link ? "Edit link" : "Add link"} on={!!f.link} onClick={() => setState({ linking: true })} />,
      <Sep key="s1" />,
      <Btn key="list" icon="list" label="Bulleted list" on={!!f.list} onClick={() => styleSelection("List", { list: f.list ? undefined : true })} />,
    );
  }
  if (texty || kind === "table") {
    const align = f.align ?? (kind === "shape" ? "center" : "left");
    parts.push(<Btn key="align" icon={ALIGN_ICON[align]} label={`Align ${ALIGN_NEXT[align]}`} onClick={() => styleSelection("Align", { align: ALIGN_NEXT[align] })} />);
  }
  if (kind === "sticky" || kind === "shape" || kind === "frame" || kind === "table") {
    const value = kind === "shape" ? (f.fill ?? "gray") : (f.color ?? (kind === "sticky" ? "yellow" : "gray"));
    parts.push(
      <Sep key="s2" />,
      <Btn key="fill" label={kind === "shape" ? "Fill" : "Color"} on={pop === "color"} onClick={() => toggle("color")}>
        <span className={`wb-swatch${value === "none" ? " none" : ""}`} style={value === "none" ? undefined : { background: FILL_VALUES[value as FillColor] }} />
      </Btn>,
    );
  }
  if (kind === "shape") parts.push(<Btn key="style" icon="lineStyle" label="Border" on={pop === "style"} onClick={() => toggle("style")} />);
  if (kind === "connector") {
    const c = first as Extract<BoardItem, { kind: "connector" }>;
    parts.push(
      <Btn key="start" icon={capIcon(c.startCap ?? "none", "start")} label="Start of line" on={pop === "startCap"} onClick={() => toggle("startCap")} />,
      <Btn key="style" icon="lineStyle" label="Line style" on={pop === "style"} onClick={() => toggle("style")} />,
      <Btn key="end" icon={capIcon(c.endCap ?? "arrow", "end")} label="End of line" on={pop === "endCap"} onClick={() => toggle("endCap")} />,
    );
  }
  if (kind === "drawing") parts.push(<Btn key="style" icon="lineStyle" label="Line style" on={pop === "style"} onClick={() => toggle("style")} />);
  if (parts.length) parts.push(<Sep key="s3" />);
  parts.push(<Btn key="lock" icon={locked ? "lock" : "unlock"} label={locked ? `Unlock (${shortcut("Mod+Shift+L")})` : `Lock (${shortcut("Mod+Shift+L")})`} on={locked} onClick={toggleLock} />);
  if (kind === "text" && f.link) parts.push(<Btn key="open" icon="arrowDiagonal" label={`Open ${f.link}`} onClick={() => window.open(f.link, "_blank", "noopener")} />);
  parts.push(
    <Sep key="s4" />,
    <Btn key="comment" icon="chat" label={`Comment (${shortcut("Mod+Alt+M")})`} onClick={commentOnSelection} />,
    <MenuButton key="more" className="icon-btn wb-fb-btn" label="More" title="More" entries={() => itemMenu(ai.name)}>
      <Icon name="dots" size={18} />
    </MenuButton>,
  );

  return (
    <>
      {parts}
      {pop && kind && <Popover pop={pop} kind={kind} first={first} close={() => setPop(null)} />}
    </>
  );
}

function capIcon(cap: Cap, end: "start" | "end"): IconName {
  if (cap === "arrow") return end === "start" ? "arrowLeft" : "arrowRight";
  if (cap === "dot") return "capDot";
  return "lineThin";
}

function Popover({ pop, kind, first, close }: { pop: Exclude<Pop, null>; kind: ItemKind; first: BoardItem; close(): void }) {
  const theme = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("[aria-pressed=true], button")?.focus({ preventScroll: true });
  }, [pop]);
  const f = first as BoardItem & Record<string, unknown>;
  let body: React.ReactNode = null;

  if (pop === "shape") {
    const rows: (ShapeKind | "text")[][] = [["text", "square", "circle"], ["pill", "diamond", "rect", "hexagon", "parallelogram"], ["cylinder", "drum", "document", "cloud", "person"]];
    const current = kind === "text" ? "text" : (f.shape as ShapeKind);
    body = (
      <div className="wb-pop-grid" role="group" aria-label="Shapes">
        {rows.map((row, i) => (
          <div key={i} className="wb-pop-row">
            {row.map((k) => (
              <button key={k} className="icon-btn wb-fb-btn" aria-pressed={k === current} aria-label={k === "text" ? "Text" : SHAPE_LABELS[k]} title={k === "text" ? "Text" : SHAPE_LABELS[k]} onClick={() => {
                  convert(first, k);
                  close();
                }}>
                {k === "text" ? <Icon name="text" size={18} /> : <ShapeIcon kind={k} />}
              </button>
            ))}
          </div>
        ))}
      </div>
    );
  } else if (pop === "color") {
    const ink = kind === "text";
    const list: readonly string[] = ink ? INK_COLORS : kind === "shape" ? [...FILL_COLORS, "none"] : FILL_COLORS;
    const field = kind === "shape" ? "fill" : "color";
    const value = (f[field] as string | undefined) ?? (ink ? "default" : kind === "sticky" ? "yellow" : "gray");
    body = (
      <div className="wb-pop-row" role="group" aria-label="Colors">
        {list.map((c) => (
          <button
            key={c}
            className="wb-swatch-btn"
            aria-pressed={c === value}
            aria-label={c === "none" ? "No fill" : COLOR_LABELS[c as FillColor]}
            title={c === "none" ? "No fill" : COLOR_LABELS[c as FillColor]}
            onClick={() => styleSelection(ink ? "Text color" : "Color", { [field]: c === (ink ? "default" : null) ? undefined : c })}
          >
            <span className={`wb-swatch${c === "none" ? " none" : ""}`} style={c === "none" ? undefined : { background: ink ? INK_VALUES[theme][c as InkColor] : FILL_VALUES[c as FillColor] }} />
          </button>
        ))}
      </div>
    );
  } else if (pop === "style") {
    const color = (f.kind === "shape" ? f.stroke : f.color) as InkColor | undefined;
    const field = f.kind === "shape" ? "stroke" : "color";
    body = (
      <div className="wb-pop-col">
        <div className="wb-seg" role="group" aria-label="Line">
          {LINE_STYLES.map((st) => (
            <button key={st} className="wb-seg-btn" aria-pressed={(f.lineStyle ?? "solid") === st} aria-label={st === "solid" ? "Solid" : "Dashed"} title={st === "solid" ? "Solid" : "Dashed"} onClick={() => styleSelection("Line style", { lineStyle: st === "solid" ? undefined : st })}>
              <Icon name={st === "solid" ? "lineThin" : "lineDashed"} size={18} />
            </button>
          ))}
        </div>
        {kind === "connector" && (
          <div className="wb-seg" role="group" aria-label="Route">
            {ROUTES.map((r) => (
              <button key={r} className="wb-seg-btn text" aria-pressed={(f.route ?? "elbow") === r} onClick={() => styleSelection("Route", { route: r === "elbow" ? undefined : r })}>
                {r === "elbow" ? "Elbow" : "Straight"}
              </button>
            ))}
          </div>
        )}
        <div className="wb-pop-row" role="group" aria-label="Colors">
          {kind === "shape" && (
            <button className="wb-swatch-btn" aria-pressed={!color} aria-label="No border" title="No border" onClick={() => styleSelection("Border", { stroke: undefined, lineStyle: undefined })}>
              <span className="wb-swatch none" />
            </button>
          )}
          {INK_COLORS.map((c) => (
            <button key={c} className="wb-swatch-btn" aria-pressed={kind === "shape" ? color === c : (color ?? "default") === c} aria-label={COLOR_LABELS[c]} title={COLOR_LABELS[c]} onClick={() => styleSelection("Line color", { [field]: c === "default" && kind !== "shape" ? undefined : c })}>
              <span className="wb-swatch" style={{ background: INK_VALUES[theme][c] }} />
            </button>
          ))}
        </div>
      </div>
    );
  } else {
    const end = pop === "startCap" ? "start" : "end";
    const field = pop;
    const value = (f[field] as Cap | undefined) ?? (end === "end" ? "arrow" : "none");
    body = (
      <div className="wb-pop-row" role="group" aria-label={end === "start" ? "Start of line" : "End of line"}>
        {CAPS.map((cap) => (
          <button key={cap} className="icon-btn wb-fb-btn" aria-pressed={cap === value} aria-label={cap === "none" ? "No end" : cap === "arrow" ? "Arrow" : "Dot"} title={cap === "none" ? "No end" : cap === "arrow" ? "Arrow" : "Dot"} onClick={() => styleSelection("Line end", { [field]: cap === (end === "end" ? "arrow" : "none") ? undefined : cap })}>
            <Icon name={capIcon(cap, end)} size={18} style={cap === "dot" && end === "end" ? { transform: "scaleX(-1)" } : undefined} />
          </button>
        ))}
      </div>
    );
  }
  return (
    <div ref={ref} className="wb-pop" onPointerDown={(e) => e.stopPropagation()}>
      {body}
    </div>
  );
}

/** Text into a shape, a shape into another shape, or a shape back into text, keeping the words. */
function convert(it: BoardItem, to: ShapeKind | "text") {
  updateItems(to === "text" ? "Turn into text" : "Change shape", [it.id], (x) => {
    if (x.kind !== "text" && x.kind !== "shape") return x;
    const style = { size: x.size, bold: x.bold, italic: x.italic, align: x.align, list: x.list, link: x.link };
    const clean = Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined));
    const base = { id: x.id, x: x.x, y: x.y, rotation: x.rotation, locked: x.locked, frame: x.frame, group: x.group };
    const b = Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined)) as { id: string; x: number; y: number };
    if (to === "text") {
      const text = x.text ?? "";
      const width = Math.max(120, x.width);
      return { ...b, kind: "text", width, height: textItemHeight(text, clean, width), text, ...clean } as BoardItem;
    }
    if (x.kind === "shape") return { ...x, shape: to };
    const d = SHAPE_DEFAULTS[to];
    return { ...b, kind: "shape", shape: to, width: Math.max(d.width, x.width), height: d.height, text: x.text, ...clean } as BoardItem;
  });
}

function LinkField({ item }: { item: BoardItem }) {
  const current = "link" in item ? (item.link ?? "") : "";
  const [value, setValue] = useState(current);
  const [bad, setBad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => input.current?.focus(), []);
  const close = () => setState({ linking: false });
  const save = () => {
    const link = normalizeLink(value);
    if (value.trim() && !link) {
      setBad(true);
      return;
    }
    styleSelection(link ? "Add link" : "Remove link", { link: link ?? undefined }, TEXTY);
    close();
  };
  return (
    <form
      className="wb-link"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Icon name="link" size={18} />
      <input
        ref={input}
        value={value}
        placeholder="https://…"
        aria-label="Link"
        aria-invalid={bad}
        title={bad ? "Type a web address, like example.com" : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setBad(false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      />
      <button type="button" className="icon-btn wb-fb-btn" aria-label="Close" title="Close (Esc)" onClick={close}>
        <Icon name="close" size={18} />
      </button>
    </form>
  );
}
