// The properties panel: the selected artboard's layers as a tree, then what
// can be changed about the selected one, section by section in the
// reference's order. Every field ends in one checked edit of the artboard's
// tree. The Code tab shows the same declarations as text; Tweaks holds the
// design's variables.

import { useLayoutEffect, useState } from "react";
import { getAt, px } from "@opendeck/format";
import { PROPERTIES, contentHtml, holdsLayers, layerTree, move, setAttr, setContent, setStyles, styleOf, themeOf, type ElementNode, type LayerKind, type LayerRow } from "@opendeck/artboard";
import { Icon, type IconName } from "@opendeck/shell";
import { exportArtboard, type ExportKind } from "../export.ts";
import { layerElement } from "../components/ArtboardView.tsx";
import { Scaled } from "../components/FocusView.tsx";
import { apply, boardRect, editBoard, editTarget, selectLayers, selectedFile, setPanel, setState, sizedBoard, snap, target, useTarget, useDesign, type PanelTab } from "../store.ts";
import { CodeTab } from "./CodeTab.tsx";
import { ColorControl, hexOf } from "./ColorControl.tsx";
import { IconToggle, NumberField, Row, Section, Segmented, SelectField, TextField, type Option, type SegOption } from "./Fields.tsx";
import { TweaksTab } from "./TweaksTab.tsx";

const TABS: { id: PanelTab; name: string }[] = [
  { id: "properties", name: "Properties" },
  { id: "code", name: "Code" },
  { id: "tweaks", name: "Tweaks" },
];

const KIND_ICON: Record<LayerKind, IconName> = {
  Column: "alignJustify",
  Row: "list",
  Grid: "grid",
  Box: "single",
  Heading: "heading1",
  Text: "text",
  Image: "image",
  Shape: "shapes",
  Link: "link",
  Button: "shapeRounded",
  List: "numbered",
  Item: "minus",
  Table: "table",
  Rule: "divider",
  Input: "textType",
};

export function PropertiesPanel() {
  const tab = useDesign((s) => s.tab);
  const file = useDesign((s) => selectedFile(s));
  const hasDoc = useDesign((s) => !!(file && s.boards.get(file)?.doc));

  return (
    <aside className="rp pp" aria-label="Properties">
      <header className="pp-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" className="pp-tab" aria-selected={tab === t.id} onClick={() => setState({ tab: t.id })}>
            {t.name}
          </button>
        ))}
        <span className="dg-fill" />
        <button className="icon-btn" title="Close (Esc)" aria-label="Close properties" onClick={() => setPanel(null)}>
          <Icon name="close" size={16} />
        </button>
      </header>
      {tab === "tweaks" ? (
        <TweaksTab />
      ) : !file ? (
        <div className="rp-empty">
          <p>Nothing selected</p>
          <p className="rp-hint">Click an artboard to see its layers, then a layer to change it.</p>
        </div>
      ) : !hasDoc ? (
        <div className="rp-empty">
          <p>This artboard’s file can’t be read</p>
          <p className="rp-hint">Its problems are shown on the canvas. Fix the file, or ask the AI to rewrite it.</p>
        </div>
      ) : (
        <>
          <LayerTree file={file} />
          <div className="pp-scroll">{tab === "code" ? <CodeTab /> : <Properties />}</div>
        </>
      )}
    </aside>
  );
}

// ── The layer tree ─────────────────────────────────────────────────────────

const ROOT_ONLY = [""];

function LayerTree({ file }: { file: string }) {
  const root = useDesign((s) => s.boards.get(file)?.doc?.root ?? null);
  const selection = useDesign((s) => s.selection);
  const picked = selection?.kind === "layers" && selection.file === file ? selection.addresses : ROOT_ONLY;
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ address: string; where: "before" | "after" | "inside" } | null>(null);
  if (!root) return null;
  const rows = layerTree(root, closed);

  const toggle = (address: string) => setClosed((c) => (c.has(address) ? new Set([...c].filter((a) => a !== address)) : new Set([...c, address])));
  const place = (e: React.DragEvent, row: LayerRow) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = (e.clientY - r.top) / r.height;
    const el = getAt(root, row.address) as ElementNode | null;
    const inside = !!el && holdsLayers(el) && el.tag === "div" && (row.address === "" || (t > 0.3 && t < 0.7));
    return inside ? "inside" : t < 0.5 ? "before" : "after";
  };
  const land = () => {
    if (drag === null || !drop || drop.address === drag) return;
    const parent = drop.where === "inside" ? drop.address : drop.address.includes(".") ? drop.address.slice(0, drop.address.lastIndexOf(".")) : "";
    const at = drop.where === "inside" ? Infinity : Number(drop.address.slice(drop.address.lastIndexOf(".") + 1)) + (drop.where === "after" ? 1 : 0);
    editBoard("Move layer", file, (r, ctx) => move(r, drag, parent, at, ctx));
  };

  return (
    <div
      className="pp-tree"
      role="tree"
      aria-label="Layers"
      onKeyDown={(e) => {
        const i = rows.findIndex((r) => r.address === picked[0]);
        const next = e.key === "ArrowDown" ? rows[i + 1] : e.key === "ArrowUp" ? rows[i - 1] : null;
        if (next) {
          e.preventDefault();
          e.stopPropagation();
          selectLayers(file, [next.address]);
          e.currentTarget.querySelector<HTMLElement>(`[data-address="${next.address}"]`)?.focus();
        } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && rows[i]?.hasChildren) {
          e.preventDefault();
          e.stopPropagation();
          if (closed.has(rows[i]!.address) === (e.key === "ArrowRight")) toggle(rows[i]!.address);
        }
      }}
    >
      {rows.map((row) => {
        const on = picked.includes(row.address);
        return (
          <div
            key={row.address}
            role="treeitem"
            aria-selected={on}
            aria-expanded={row.hasChildren ? !closed.has(row.address) : undefined}
            tabIndex={on ? 0 : -1}
            data-address={row.address}
            className={`pp-layer${on ? " on" : ""}${drop?.address === row.address && drag !== null ? ` drop-${drop.where}` : ""}`}
            style={{ paddingLeft: 6 + row.depth * 14 }}
            draggable={row.address !== ""}
            onClick={(e) => selectLayers(file, e.shiftKey && row.address && picked[0] ? [...new Set([...picked, row.address])] : [row.address])}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", row.text);
              setDrag(row.address);
            }}
            onDragOver={(e) => {
              if (drag === null || row.address === drag || row.address.startsWith(`${drag}.`)) return;
              const where = place(e, row);
              if (row.address === "" && where !== "inside") return;
              e.preventDefault();
              if (drop?.address !== row.address || drop.where !== where) setDrop({ address: row.address, where });
            }}
            onDrop={(e) => {
              e.preventDefault();
              land();
            }}
            onDragEnd={() => {
              setDrag(null);
              setDrop(null);
            }}
          >
            {row.hasChildren ? (
              <button
                className="pp-twist"
                tabIndex={-1}
                aria-label={closed.has(row.address) ? "Expand" : "Collapse"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(row.address);
                }}
              >
                <Icon name={closed.has(row.address) ? "chevronRight" : "chevronDown"} size={12} />
              </button>
            ) : (
              <span className="pp-twist" />
            )}
            <Icon name={KIND_ICON[row.kind]} size={14} />
            <span className="pp-layer-kind">{row.kind}</span>
            {row.text && <span className="pp-layer-text">“{row.text}”</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── The sections ───────────────────────────────────────────────────────────

const WEIGHTS: Option[] = [
  ["100", "Thin"],
  ["200", "Extra light"],
  ["300", "Light"],
  ["400", "Regular"],
  ["500", "Medium"],
  ["600", "Semibold"],
  ["700", "Bold"],
  ["800", "Extra bold"],
  ["900", "Black"],
].map(([value, label]) => ({ value: value!, label: label! }));
const SHADOWS: Option[] = [
  { value: "", label: "None" },
  { value: "0 1px 3px rgba(0,0,0,0.16)", label: "Small" },
  { value: "0 6px 20px rgba(0,0,0,0.16)", label: "Medium" },
  { value: "0 18px 48px rgba(0,0,0,0.22)", label: "Large" },
];
const H_ALIGN: SegOption[] = [
  { value: "start", title: "Left", icon: "alignLeft" },
  { value: "center", title: "Center", icon: "alignCenter" },
  { value: "end", title: "Right", icon: "alignRight" },
];
const V_ALIGN: SegOption[] = [
  { value: "start", title: "Top", icon: "alignTop" },
  { value: "center", title: "Middle", icon: "alignMiddle" },
  { value: "end", title: "Bottom", icon: "alignBottom" },
];
const TEXT_ALIGN: SegOption[] = [...H_ALIGN.map((o, i) => ({ ...o, value: ["left", "center", "right"][i]! })), { value: "justify", title: "Justify", icon: "alignJustify" }];
const titled = (v: string) => v.charAt(0).toUpperCase() + v.slice(1).replace(/-/g, " ");
const options = (name: string): Option[] => (PROPERTIES[name]?.options ?? []).map((value) => ({ value, label: titled(value) }));
const normal = (v: string | undefined) => (v === "flex-start" ? "start" : v === "flex-end" ? "end" : (v ?? null));

function Properties() {
  const t = useTarget();
  const index = useDesign((s) => s.index);
  const board = t ? index.boards[t.file] : undefined;
  const [sides, setSides] = useState(false);
  const [corners, setCorners] = useState(false);
  const [computed, setComputed] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<ExportKind>("png");
  const [scale, setScale] = useState("2");
  const key = t ? `${t.file}|${t.address}` : "";

  // What the browser draws where nothing is set, shown dimmed: read after the artboard has been laid out.
  useLayoutEffect(() => {
    const el = t ? layerElement(t.file, t.address) : null;
    if (!el) return setComputed({});
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const zoom = el.offsetWidth ? r.width / el.offsetWidth : 1;
    const next: Record<string, string> = { width: `${Math.round(r.width / (zoom || 1))}px`, height: `${Math.round(r.height / (zoom || 1))}px` };
    for (const name of Object.keys(PROPERTIES)) if (!(name in next)) next[name] = cs.getPropertyValue(name);
    setComputed((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
  }, [key, t?.el, index.tweaks, index.textStyles]);

  if (!t || !board) {
    return (
      <div className="rp-empty">
        <p>Several layers selected</p>
        <p className="rp-hint">Select one layer to change its properties.</p>
      </div>
    );
  }

  const { el, file, address } = t;
  const isRoot = address === "";
  const on = (name: string) => !!PROPERTIES[name]?.on.includes(el.tag);
  const own = (name: string) => styleOf(el, name) ?? "";
  const seen = (name: string) => own(name) || computed[name] || "";
  const set = (label: string, props: Record<string, string | null>) => editTarget(label, (root, addr, ctx) => setStyles(root, addr, props, ctx));
  const num = (name: string) => px(seen(name));
  const pxOr = (v: number | null) => (v === null ? null : `${v}px`);
  const parentEl = isRoot ? null : (getAt(t.root, address.includes(".") ? address.slice(0, address.lastIndexOf(".")) : "") as ElementNode | null);
  const flexDir = (n: ElementNode | null) => (n && /flex/.test(styleOf(n, "display") ?? "") ? (styleOf(n, "flex-direction")?.startsWith("column") ? "column" : "row") : null);

  // Size
  const resize = (w: number | null, h: number | null) => apply("Resize artboard", sizedBoard(snap(), file, { x: board.x, y: board.y, w: w ?? board.w, h: h ?? board.h }));
  const mode = (name: string) => (own(name) === "100%" ? "fill" : /px$/.test(own(name)) ? "fixed" : "hug");
  const setMode = (name: string, m: string) => set(titled(name), { [name]: m === "fill" ? "100%" : m === "fixed" ? `${num(name) ?? 100}px` : null });
  const MODES: Option[] = [
    { value: "fixed", label: "Fixed" },
    { value: "fill", label: "Fill" },
    { value: "hug", label: "Hug" },
  ];
  const absolute = own("position") === "absolute";

  // Layout
  const display = own("display");
  const layout = display === "grid" ? "grid" : /flex/.test(display) ? "stack" : "none";
  const dir = own("flex-direction").startsWith("column") ? "column" : "row";
  const wrap = own("flex-wrap") === "wrap";
  const setLayout = (v: string) =>
    set("Layout", v === "stack" ? { display: "flex", "flex-direction": own("flex-direction") || "column", "grid-template-columns": null, "grid-template-rows": null } : v === "grid" ? { display: "grid", "grid-template-columns": own("grid-template-columns") || "1fr 1fr", "flex-direction": null, "flex-wrap": null } : { display: null, "flex-direction": null, "flex-wrap": null, "justify-content": null, "align-items": null, gap: null, "grid-template-columns": null, "grid-template-rows": null });
  // Across is the main axis of a row and the cross axis of a column; a grid aligns what its cells hold.
  const acrossProp = layout === "grid" ? "justify-items" : dir === "row" ? "justify-content" : "align-items";
  const downProp = layout === "grid" ? "align-items" : dir === "row" ? "align-items" : "justify-content";
  const stretched = own("align-items") === "stretch" || (!own("align-items") && layout === "stack");
  const pad = own("padding").split(" ").filter(Boolean);
  const padOf = (i: number) => px(pad.length === 1 ? pad[0]! : pad.length === 2 ? pad[i % 2]! : pad.length === 3 ? pad[i === 3 ? 1 : i]! : (pad[i] ?? "0")) ?? 0;
  const setPad = (i: number, v: number | null) => set("Padding", { padding: [0, 1, 2, 3].map((k) => `${k === i ? (v ?? 0) : padOf(k)}px`).join(" ") });

  // Aligning the layer itself: a container aligns what it holds; anything else moves within its parent, or aligns its text.
  const container = el.tag === "div" && layout !== "none";
  const parentDir = flexDir(parentEl);
  const alignH = (v: string) => (container ? set("Align", { [acrossProp]: v }) : parentDir === "column" ? set("Align", { "align-self": v }) : on("text-align") ? set("Align", { "text-align": v === "start" ? "left" : v === "end" ? "right" : "center" }) : undefined);
  const alignV = (v: string) => (container ? set("Align", { [downProp]: v }) : parentDir === "row" ? set("Align", { "align-self": v }) : undefined);
  const canH = container || parentDir === "column" || on("text-align");
  const canV = container || parentDir === "row";

  // Appearance
  const radius = own("border-radius").split(" ").filter(Boolean);
  const radiusOf = (i: number) => px(radius.length === 1 ? radius[0]! : radius.length === 2 ? radius[i % 2]! : radius.length === 3 ? radius[i === 3 ? 1 : i]! : (radius[i] ?? "0")) ?? 0;
  const borderParts = own("border").split(" ").filter(Boolean);
  const borderStyle = borderParts.find((p) => ["solid", "dashed", "dotted"].includes(p)) ?? "none";
  const borderWidth = px(borderParts.find((p) => /^\d/.test(p)) ?? "") ?? 1;
  const borderColor = borderParts.find((p) => /^(#|rgb|hsl|var)/.test(p)) ?? hexOf(computed.color ?? "") ?? "#000000";
  const setBorder = (style: string, width: number, color: string) => set("Border", { border: style === "none" ? null : `${width}px ${style} ${color}` });
  const opacity = own("opacity") ? Math.round(Number(own("opacity")) * 100) : 100;
  const blur = /blur\(([\d.]+)px\)/.exec(own("filter"))?.[1];

  const isText = on("font-size") && el.tag !== "div";
  const href = el.attrs.href ?? "";
  const advanced = Object.entries(PROPERTIES).filter(([name, spec]) => spec.group === "advanced" && on(name));
  const rect = boardRect(file);

  return (
    <>
      <div className="pp-align" role="toolbar" aria-label="Align">
        {H_ALIGN.map((o) => (
          <button key={o.value} className="icon-btn" disabled={!canH} aria-label={`Align ${o.title.toLowerCase()}`} title={`Align ${o.title.toLowerCase()}`} onClick={() => alignH(o.value)}>
            <Icon name={o.icon!} size={16} />
          </button>
        ))}
        {V_ALIGN.map((o) => (
          <button key={o.value} className="icon-btn" disabled={!canV} aria-label={`Align ${o.title.toLowerCase()}`} title={`Align ${o.title.toLowerCase()}`} onClick={() => alignV(o.value)}>
            <Icon name={o.icon!} size={16} />
          </button>
        ))}
      </div>

      <Section title="Size" id="size">
        <Row label="Width">
          <NumberField label="Width" value={isRoot ? board.w : num("width")} dim={!isRoot && mode("width") !== "fixed"} min={isRoot ? 16 : 0} max={8000} onCommit={(v) => (isRoot ? resize(v, null) : set("Width", { width: pxOr(v) }))} />
          <SelectField label="Width behavior" value={isRoot ? "fixed" : mode("width")} options={isRoot ? MODES.slice(0, 1) : MODES} onChange={(m) => setMode("width", m)} />
        </Row>
        <Row label="Height">
          <NumberField label="Height" value={isRoot ? board.h : num("height")} dim={!isRoot && mode("height") !== "fixed"} min={isRoot ? 16 : 0} max={8000} onCommit={(v) => (isRoot ? resize(null, v) : set("Height", { height: pxOr(v) }))} />
          <SelectField label="Height behavior" value={isRoot ? "fixed" : mode("height")} options={isRoot ? [{ value: "fixed", label: board.expand === "fill" ? "At least" : "Fixed" }] : MODES} onChange={(m) => setMode("height", m)} />
        </Row>
        {!isRoot && (
          <Row label="Position">
            <SelectField
              label="Position"
              value={absolute ? "absolute" : "inline"}
              options={[
                { value: "inline", label: "Inline" },
                { value: "absolute", label: "Absolute" },
              ]}
              onChange={(v) => set("Position", v === "absolute" ? { position: "absolute", left: own("left") || "0px", top: own("top") || "0px" } : { position: null, left: null, top: null, right: null, bottom: null })}
            />
          </Row>
        )}
        {absolute && (
          <Row label="Left, top">
            <NumberField label="Left" value={px(own("left"))} min={-8000} max={8000} onCommit={(v) => set("Left", { left: pxOr(v) })} />
            <NumberField label="Top" value={px(own("top"))} min={-8000} max={8000} onCommit={(v) => set("Top", { top: pxOr(v) })} />
          </Row>
        )}
      </Section>

      <Section title="Layout" id="layout">
        {el.tag === "div" && (
          <Row label="Layout">
            <SelectField
              label="Layout"
              value={layout}
              options={[
                { value: "stack", label: "Stack" },
                { value: "grid", label: "Grid" },
                { value: "none", label: "None" },
              ]}
              onChange={setLayout}
            />
          </Row>
        )}
        {el.tag === "div" && layout === "stack" && (
          <Row label="Direction">
            <Segmented
              label="Direction"
              value={dir}
              options={[
                { value: "row", title: "Across", icon: "arrowRight" },
                { value: "column", title: "Down", icon: "arrowRight", turn: 90 },
              ]}
              onChange={(v) => set("Direction", { "flex-direction": v })}
            />
            <IconToggle icon="wrapText" title="Wrap onto more lines" on={wrap} onClick={() => set("Wrap", { "flex-wrap": wrap ? null : "wrap" })} />
          </Row>
        )}
        {container && (
          <Row label="Align">
            <Segmented label="Across" value={normal(own(acrossProp) || undefined)} options={H_ALIGN} clear onChange={(v) => set("Align", { [acrossProp]: v })} />
            <Segmented label="Down" value={normal(own(downProp) || undefined)} options={V_ALIGN} clear onChange={(v) => set("Align", { [downProp]: v })} />
            {layout === "stack" && <IconToggle icon="wide" title="Stretch to fill" on={stretched} onClick={() => set("Align", { "align-items": stretched ? "start" : "stretch" })} />}
          </Row>
        )}
        {container && (
          <Row label="Gap">
            <NumberField label="Gap" value={px(own("gap").split(" ")[0] ?? "") ?? 0} min={0} max={512} onCommit={(v) => set("Gap", { gap: v ? `${v}px` : null })} />
          </Row>
        )}
        {layout === "grid" && (
          <>
            <Row label="Columns">
              <TextField label="Columns" value={own("grid-template-columns")} placeholder="1fr 1fr" mono onCommit={(v) => set("Columns", { "grid-template-columns": v || null })} />
            </Row>
            <Row label="Rows">
              <TextField label="Rows" value={own("grid-template-rows")} placeholder="auto" mono onCommit={(v) => set("Rows", { "grid-template-rows": v || null })} />
            </Row>
          </>
        )}
        <Row label="Padding">
          {sides ? (
            <div className="pp-four">
              {["Top", "Right", "Bottom", "Left"].map((name, i) => (
                <NumberField key={name} label={`Padding ${name.toLowerCase()}`} unit={name.charAt(0)} value={padOf(i)} min={0} max={400} onCommit={(v) => setPad(i, v)} />
              ))}
            </div>
          ) : (
            <NumberField label="Padding" value={pad.length <= 1 ? padOf(0) : null} min={0} max={400} onCommit={(v) => set("Padding", { padding: v ? `${v}px` : null })} />
          )}
          <IconToggle icon="bordersOuter" title="Each side on its own" on={sides} onClick={() => setSides(!sides)} />
        </Row>
      </Section>

      {on("font-size") && (
        <Section title="Text" id="text">
          {on("font-family") && (
            <Row label="Font">
              <SelectField
                label="Font"
                value={(seen("font-family").split(",")[0] ?? "").trim().replace(/["']/g, "")}
                dim={!own("font-family")}
                options={[...new Set([...index.fonts, "system-ui", "serif", "monospace"])].map((f) => ({ value: f, label: f === "system-ui" ? "System" : f === "serif" ? "Serif" : f === "monospace" ? "Monospace" : f }))}
                onChange={(v) => set("Font", { "font-family": ["system-ui", "serif", "monospace"].includes(v) ? v : `${v}, system-ui, sans-serif` })}
              />
            </Row>
          )}
          <Row label="Weight">
            <SelectField label="Weight" value={seen("font-weight") === "normal" ? "400" : seen("font-weight") === "bold" ? "700" : seen("font-weight")} dim={!own("font-weight")} options={WEIGHTS} onChange={(v) => set("Weight", { "font-weight": v })} />
          </Row>
          <Row label="Size">
            <NumberField label="Font size" value={num("font-size")} dim={!own("font-size")} min={6} max={400} onCommit={(v) => set("Font size", { "font-size": pxOr(v) })} />
          </Row>
          {on("line-height") && (
            <Row label="Spacing" title="Line height, letter spacing">
              <TextField label="Line height" icon="lineThin" value={own("line-height") || "normal"} dim={!own("line-height")} onCommit={(v) => set("Line height", { "line-height": v === "normal" ? null : v || null })} />
              <TextField label="Letter spacing" icon="textSize" value={own("letter-spacing") || "normal"} dim={!own("letter-spacing")} onCommit={(v) => set("Letter spacing", { "letter-spacing": v === "normal" ? null : v || null })} />
            </Row>
          )}
          <Row label="Color">
            <ColorControl label="Text color" value={own("color")} shown={hexOf(computed.color ?? "")} onCommit={(v) => set("Text color", { color: v })} />
          </Row>
          {on("text-align") && (
            <Row label="Align">
              <Segmented label="Text align" value={own("text-align") || (computed["text-align"] === "start" ? "left" : (computed["text-align"] ?? "left"))} options={TEXT_ALIGN} onChange={(v) => set("Text align", { "text-align": v })} />
            </Row>
          )}
        </Section>
      )}

      <Section title="Appearance" id="appearance">
        {on("background") && (
          <Row label="Fill">
            <ColorControl label="Fill" value={own("background")} allowNone onCommit={(v) => set("Fill", { background: v })} />
            <button className="icon-btn pp-toggle" disabled={!own("background")} aria-label="Remove the fill" title="Remove the fill" onClick={() => set("Fill", { background: null })}>
              <Icon name="minus" size={16} />
            </button>
          </Row>
        )}
        <Row label="Opacity">
          <NumberField label="Opacity" unit="%" value={opacity} min={0} max={100} onCommit={(v) => set("Opacity", { opacity: v === null || v >= 100 ? null : String(v / 100) })} />
          <input className="pp-range" type="range" min={0} max={100} value={opacity} aria-label="Opacity" onChange={(e) => set("Opacity", { opacity: Number(e.target.value) >= 100 ? null : String(Number(e.target.value) / 100) })} />
        </Row>
        {on("border-radius") && (
          <Row label="Radius">
            {corners ? (
              <div className="pp-four">
                {["Top left", "Top right", "Bottom right", "Bottom left"].map((name, i) => (
                  <NumberField key={name} label={`Radius ${name.toLowerCase()}`} unit="" value={radiusOf(i)} min={0} max={2000} onCommit={(v) => set("Radius", { "border-radius": [0, 1, 2, 3].map((k) => `${k === i ? (v ?? 0) : radiusOf(k)}px`).join(" ") })} />
                ))}
              </div>
            ) : (
              <NumberField label="Radius" value={radius.length <= 1 ? radiusOf(0) : null} min={0} max={2000} onCommit={(v) => set("Radius", { "border-radius": v ? `${v}px` : null })} />
            )}
            <IconToggle icon="viewport" title="Each corner on its own" on={corners} onClick={() => setCorners(!corners)} />
          </Row>
        )}
        {on("border") && (
          <>
            <Row label="Border">
              <SelectField label="Border" value={borderStyle} options={["none", "solid", "dashed", "dotted"].map((v) => ({ value: v, label: titled(v) }))} onChange={(v) => setBorder(v, borderWidth, borderColor)} />
              {borderStyle !== "none" && <NumberField label="Border width" value={borderWidth} min={1} max={64} onCommit={(v) => setBorder(borderStyle, v ?? 1, borderColor)} />}
            </Row>
            {borderStyle !== "none" && (
              <Row label="Border color">
                <ColorControl label="Border color" value={borderColor} onCommit={(v) => setBorder(borderStyle, borderWidth, v ?? "#000000")} />
              </Row>
            )}
          </>
        )}
      </Section>

      <Section title="Effects" id="effects" open={false}>
        {on("box-shadow") && (
          <Row label="Shadow">
            <SelectField label="Shadow" value={own("box-shadow")} options={SHADOWS} onChange={(v) => set("Shadow", { "box-shadow": v || null })} />
          </Row>
        )}
        <Row label="Blur">
          <NumberField label="Blur" value={blur ? Number(blur) : 0} min={0} max={200} onCommit={(v) => set("Blur", { filter: v ? `blur(${v}px)` : null })} />
        </Row>
        <Row label="Blend">
          <SelectField label="Blend" value={own("mix-blend-mode") || "normal"} options={options("mix-blend-mode")} onChange={(v) => set("Blend", { "mix-blend-mode": v === "normal" ? null : v })} />
        </Row>
      </Section>

      {(el.tag === "a" || isText) && (
        <Section title="Link" id="link" open={false}>
          <Row label="Destination" title="A web address, or another artboard’s file like Pricing.html">
            <TextField
              label="Destination"
              value={href}
              placeholder="https://… or Pricing.html"
              onCommit={(v) =>
                editTarget("Link", (root, addr, ctx) => {
                  if (el.tag === "a") return setAttr(root, addr, "href", v || null, ctx);
                  if (!v) return root;
                  return setContent(root, addr, `<a href="${v.replace(/"/g, "&quot;")}">${contentHtml(el).replace(/<a [^>]*>|<\/a>/g, "")}</a>`, ctx);
                })
              }
            />
          </Row>
        </Section>
      )}

      <Section title="Export" id="export" open={false}>
        {rect && (
          <div className="pp-preview">
            <Scaled file={file} doc={{ title: board.title, vars: {}, root: t.root }} theme={themeOf(index)} width={rect.w} height={rect.h} mode="fit" />
          </div>
        )}
        <Row label="Format">
          <SelectField
            label="Format"
            value={kind}
            options={[
              { value: "png", label: "PNG" },
              { value: "pdf", label: "PDF" },
              { value: "html", label: "HTML" },
            ]}
            onChange={(v) => setKind(v as ExportKind)}
          />
        </Row>
        {kind === "png" && (
          <Row label="Scale">
            <SelectField label="Scale" value={scale} options={["1", "2", "3"].map((v) => ({ value: v, label: `${v}×` }))} onChange={setScale} />
          </Row>
        )}
        <button className="btn pp-export" onClick={() => void exportArtboard(file, kind, Number(scale))}>
          Export {board.title} as {kind.toUpperCase()}
        </button>
      </Section>

      <Section title="Advanced" id="advanced" open={false}>
        {advanced.map(([name, spec]) => (
          <Row key={name} label={name}>
            {spec.options ? (
              <SelectField label={name} value={own(name) || (computed[name] ?? "")} dim={!own(name)} options={spec.options.map((value) => ({ value, label: value }))} onChange={(v) => set(name, { [name]: v })} />
            ) : (
              <TextField label={name} value={own(name) || (computed[name] ?? "")} dim={!own(name)} mono onCommit={(v) => set(name, { [name]: v || null })} />
            )}
          </Row>
        ))}
      </Section>
    </>
  );
}
