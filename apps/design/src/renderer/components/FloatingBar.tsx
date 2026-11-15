// The bar over the selection: for an artboard its fill, layout, corners and
// size; for text its style, color, emphasis, link, list and alignment; for
// any other layer its fill, corners, border and opacity; then comment and
// "…". Its pickers open beside the button that opened them.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BOARD_SIZES, FILL_COLORS, FILL_VALUES, HREF_RE, PROPERTIES, contentHtml, setAttr, setContent, setStyles, setTag, styleOf, type ElementNode, type FillColor } from "@opendeck/artboard";
import { Icon, MenuButton, shortcut, type IconName, type MenuEntry } from "@opendeck/shell";
import { useAssistant } from "../assistant.ts";
import { commentOnSelection } from "../commentOn.ts";
import { ColorPopover, hexOf, paintOf } from "../panels/ColorControl.tsx";
import { apply, boardRect, editTarget, getState, sizedBoard, snap, target, useTarget, union, updateNotes, useDesign, type Rect } from "../store.ts";
import { layerElement } from "./ArtboardView.tsx";
import { selectionMenu } from "./menus.tsx";

const TEXT_KINDS: { tag: string; name: string }[] = [
  { tag: "h1", name: "Heading 1" },
  { tag: "h2", name: "Heading 2" },
  { tag: "h3", name: "Heading 3" },
  { tag: "p", name: "Paragraph" },
  { tag: "ul", name: "Bulleted list" },
  { tag: "ol", name: "Numbered list" },
];
const ALIGNS: { value: string; icon: IconName; name: string }[] = [
  { value: "left", icon: "alignLeft", name: "Align left" },
  { value: "center", icon: "alignCenter", name: "Align center" },
  { value: "right", icon: "alignRight", name: "Align right" },
  { value: "justify", icon: "alignJustify", name: "Justify" },
];
const RADII = [0, 4, 8, 16, 24, 48];

/** The selection's box in the stage's own pixels: artboards from the design, layers from where the browser drew them. */
function selectionBox(stage: DOMRect): Rect | null {
  const s = getState();
  const sel = s.selection;
  if (!sel) return null;
  const v = s.view;
  if (sel.kind === "boards") {
    const r = union(sel.files.map((f) => boardRect(f, s)));
    return r ? { x: r.x * v.zoom + v.x, y: r.y * v.zoom + v.y - 28, w: r.w * v.zoom, h: r.h * v.zoom + 28 } : null;
  }
  if (sel.kind === "notes") {
    const boxes = sel.ids.map((id) => document.querySelector<HTMLElement>(`[data-note="${id}"]`)?.getBoundingClientRect()).filter((r): r is DOMRect => !!r);
    return union(boxes.map((r) => ({ x: r.left - stage.left, y: r.top - stage.top, w: r.width, h: r.height })));
  }
  const boxes = sel.addresses.map((a) => layerElement(sel.file, a)?.getBoundingClientRect()).filter((r): r is DOMRect => !!r);
  return union(boxes.map((r) => ({ x: r.left - stage.left, y: r.top - stage.top, w: r.width, h: r.height })));
}

export function FloatingBar() {
  const selection = useDesign((s) => s.selection);
  const tool = useDesign((s) => s.tool);
  const dragging = useDesign((s) => s.dragging);
  const editing = useDesign((s) => s.editing);
  const view = useDesign((s) => s.view);
  const viewport = useDesign((s) => s.viewport);
  const boards = useDesign((s) => s.boards);
  const index = useDesign((s) => s.index);
  const heights = useDesign((s) => s.heights);
  const notes = useDesign((s) => s.notes);
  const bar = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [linking, setLinking] = useState(false);
  const key = JSON.stringify(selection);
  useEffect(() => setLinking(false), [key]);

  const stickies = selection?.kind === "notes" && selection.ids.every((id) => notes.find((n) => n.id === id)?.kind === "sticky");
  const shown = !!selection && tool === "select" && !dragging && editing?.kind !== "name" && editing?.kind !== "note" && (selection.kind !== "notes" || stickies);

  // After the artboards have been drawn: the bar sits above the selection, or below it when there is no room above.
  useLayoutEffect(() => {
    const el = bar.current;
    const stage = el?.offsetParent?.getBoundingClientRect();
    const box = el && stage ? selectionBox(stage) : null;
    if (!el || !box) return setPos(null);
    const left = Math.min(Math.max(8, box.x + box.w / 2 - el.offsetWidth / 2), Math.max(8, viewport.width - el.offsetWidth - 8));
    const above = box.y - el.offsetHeight - 10;
    // The page menu and the zoom pill sit in the top corners: beside them there is room, under them there is not.
    const clear = above >= 56 || (above >= 8 && left > 150 && left + el.offsetWidth < viewport.width - 200);
    const top = clear ? above : Math.min(viewport.height - 130, box.y + box.h + 10);
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  }, [key, shown, view, viewport, boards, index, heights, notes, linking]);

  if (!shown) return null;
  return (
    <div ref={bar} className="dg-fbar" role="toolbar" aria-label="Selection options" style={pos ? pos : { left: 0, top: 0, visibility: "hidden" }} onPointerDown={(e) => e.stopPropagation()}>
      {selection.kind === "notes" ? <NoteControls ids={selection.ids} /> : linking ? <LinkField close={() => setLinking(false)} /> : <Controls link={() => setLinking(true)} />}
    </div>
  );
}

function Btn({ icon, label, on, onClick, children, disabled }: { icon?: IconName; label: string; on?: boolean; onClick(): void; children?: React.ReactNode; disabled?: boolean }) {
  return (
    <button className="icon-btn dg-fb-btn" aria-label={label} title={label} aria-pressed={on} disabled={disabled} onClick={onClick}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

const Sep = () => <span className="dg-fb-sep" aria-hidden />;

/** A swatch that opens the color picker for one style property of the target. */
function Swatch({ prop, label, el, computed, allowNone }: { prop: string; label: string; el: ElementNode; computed?: string; allowNone?: boolean }) {
  const tweaks = useDesign((s) => s.index.tweaks);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const value = styleOf(el, prop) ?? "";
  const paint = paintOf(value || computed || "", tweaks);
  return (
    <>
      <button ref={ref} className="icon-btn dg-fb-btn" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`dg-swatch${paint ? "" : " none"}`} style={paint ? { background: paint } : undefined} />
      </button>
      {open && ref.current && (
        <ColorPopover
          anchor={ref.current}
          value={value || computed || ""}
          allowNone={allowNone}
          onPick={(v) => {
            setOpen(false);
            editTarget(label, (root, addr, ctx) => setStyles(root, addr, { [prop]: v }, ctx));
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Controls({ link }: { link(): void }) {
  const ai = useAssistant();
  const t = useTarget();
  const index = useDesign((s) => s.index);
  const many = useDesign((s) => (s.selection?.kind === "boards" ? s.selection.files.length : s.selection?.kind === "layers" ? s.selection.addresses.length : 0) > 1);
  const set = (label: string, props: Record<string, string | null>) => editTarget(label, (root, addr, ctx) => setStyles(root, addr, props, ctx));
  const tail = (
    <>
      <Btn icon="chat" label={`Comment (${shortcut("Mod+Alt+M")})`} onClick={commentOnSelection} />
      <MenuButton className="icon-btn dg-fb-btn" label="More" title="More" entries={() => selectionMenu(ai.name)}>
        <Icon name="dots" size={18} />
      </MenuButton>
    </>
  );
  if (!t || many) return tail;

  const { el, file, address } = t;
  const board = index.boards[file]!;
  const own = (name: string) => styleOf(el, name) ?? "";
  const on = (name: string) => !!PROPERTIES[name]?.on.includes(el.tag);
  const dom = layerElement(file, address);
  const cs = dom ? getComputedStyle(dom) : null;
  const radius = (
    <MenuButton
      className="icon-btn dg-fb-btn"
      label="Corner radius"
      title="Corner radius"
      entries={() => RADII.map((r) => ({ label: r ? `${r} px` : "Square", checked: (own("border-radius") || "0px") === `${r}px`, onSelect: () => set("Radius", { "border-radius": r ? `${r}px` : null }) }))}
    >
      <Icon name="shapeRounded" size={18} />
    </MenuButton>
  );

  if (address === "") {
    const display = own("display");
    const layout = display === "grid" ? "grid" : /flex/.test(display) ? (own("flex-direction").startsWith("column") ? "column" : "row") : "none";
    const lay = (kind: string) =>
      set("Layout", kind === "none" ? { display: null, "flex-direction": null, "grid-template-columns": null } : kind === "grid" ? { display: "grid", "flex-direction": null, "grid-template-columns": own("grid-template-columns") || "1fr 1fr" } : { display: "flex", "flex-direction": kind, "grid-template-columns": null });
    return (
      <>
        <Swatch prop="background" label="Fill" el={el} allowNone />
        <MenuButton
          className="icon-btn dg-fb-btn"
          label="Layout"
          title="Layout"
          entries={() => [
            { label: "Stack down", checked: layout === "column", onSelect: () => lay("column") },
            { label: "Stack across", checked: layout === "row", onSelect: () => lay("row") },
            { label: "Grid", checked: layout === "grid", onSelect: () => lay("grid") },
            { label: "None", checked: layout === "none", onSelect: () => lay("none") },
          ]}
        >
          <Icon name="alignJustify" size={18} />
        </MenuButton>
        {radius}
        <MenuButton
          className="icon-btn dg-fb-btn"
          label="Size"
          title="Size"
          entries={() => [
            { heading: `Now ${board.w} × ${board.h}` },
            ...BOARD_SIZES.map((b) => ({ label: b.name, aside: `${b.width} × ${b.height}`, checked: b.width === board.w && b.height === board.h, onSelect: () => apply("Resize artboard", sizedBoard(snap(), file, { x: board.x, y: board.y, w: b.width, h: b.height })) })),
          ]}
        >
          <Icon name="resize" size={18} />
        </MenuButton>
        <Sep />
        {tail}
      </>
    );
  }

  if (on("font-size") && el.tag !== "div") {
    const styleName = el.attrs["data-style"];
    const kind = TEXT_KINDS.find((k) => k.tag === el.tag);
    const bold = Number(own("font-weight") === "bold" ? 700 : own("font-weight") || cs?.fontWeight || 400) >= 600;
    const italic = (own("font-style") || cs?.fontStyle) === "italic";
    const underline = (own("text-decoration") || cs?.textDecorationLine || "").includes("underline");
    const align = own("text-align") || (cs?.textAlign === "start" ? "left" : cs?.textAlign) || "left";
    const list = el.tag === "ul" || el.tag === "ol";
    const styles = (): MenuEntry[] => [
      { heading: "Theme" },
      ...Object.entries(index.textStyles).map(([name, decls]) => ({
        label: name,
        aside: /font-size:\s*([\d.]+px)/.exec(decls)?.[1],
        checked: styleName === name,
        // The style's own size and weight show only where the layer sets none of its own.
        onSelect: () => editTarget("Text style", (root, addr, ctx) => setStyles(setAttr(root, addr, "data-style", name, ctx), addr, { "font-size": null, "font-weight": null, "line-height": null, "letter-spacing": null }, ctx)),
      })),
      "separator",
      { heading: "Custom" },
      { label: "No style", hint: "Size and weight from the properties panel", checked: !styleName, onSelect: () => editTarget("Text style", (root, addr, ctx) => setAttr(root, addr, "data-style", null, ctx)) },
      ...(kind ? ["separator" as const, { heading: "Kind" }, ...TEXT_KINDS.map((k) => ({ label: k.name, checked: k.tag === el.tag, onSelect: () => editTarget(k.name, (root, addr, ctx) => setTag(root, addr, k.tag, ctx)) }))] : []),
    ];
    return (
      <>
        <MenuButton className="btn ghost dg-fb-style" label="Text style" title="Text style" entries={styles}>
          <span>{styleName ?? kind?.name ?? "Text"}</span>
          <Icon name="chevronDown" size={14} />
        </MenuButton>
        <Swatch prop="color" label="Text color" el={el} computed={hexOf(cs?.color ?? "")} />
        <Btn icon="bold" label={`Bold (${shortcut("Mod+B")})`} on={bold} onClick={() => set("Bold", { "font-weight": bold ? "400" : "700" })} />
        <Btn icon="italic" label={`Italic (${shortcut("Mod+I")})`} on={italic} onClick={() => set("Italic", { "font-style": italic ? "normal" : "italic" })} />
        <Btn icon="underline" label={`Underline (${shortcut("Mod+U")})`} on={underline} onClick={() => set("Underline", { "text-decoration": underline ? "none" : "underline" })} />
        <Btn icon="link" label={el.tag === "a" ? "Edit link" : "Add link"} on={el.tag === "a" && !!el.attrs.href} disabled={list} onClick={link} />
        {kind && <Btn icon="list" label={list ? "Turn into a paragraph" : "Bulleted list"} on={list} onClick={() => editTarget(list ? "Paragraph" : "Bulleted list", (root, addr, ctx) => setTag(root, addr, list ? "p" : "ul", ctx))} />}
        {on("text-align") && (
          <MenuButton className="icon-btn dg-fb-btn" label="Alignment" title="Alignment" entries={() => ALIGNS.map((a) => ({ label: a.name, checked: a.value === align, onSelect: () => set("Align", { "text-align": a.value }) }))}>
            <Icon name={ALIGNS.find((a) => a.value === align)?.icon ?? "alignLeft"} size={18} />
          </MenuButton>
        )}
        <Sep />
        {tail}
      </>
    );
  }

  const opacity = own("opacity") ? Math.round(Number(own("opacity")) * 100) : 100;
  const border = own("border").split(" ").find((p) => ["solid", "dashed", "dotted"].includes(p)) ?? "none";
  return (
    <>
      {on("background") && <Swatch prop="background" label="Fill" el={el} allowNone />}
      {on("border-radius") && radius}
      {on("border") && (
        <MenuButton
          className="icon-btn dg-fb-btn"
          label="Border"
          title="Border"
          entries={() => ["none", "solid", "dashed", "dotted"].map((v) => ({ label: v.charAt(0).toUpperCase() + v.slice(1), checked: v === border, onSelect: () => set("Border", { border: v === "none" ? null : `1px ${v} ${hexOf(cs?.color ?? "") || "currentColor"}` }) }))}
        >
          <Icon name="lineStyle" size={18} />
        </MenuButton>
      )}
      <MenuButton className="btn ghost dg-fb-style" label="Opacity" title="Opacity" entries={() => [100, 75, 50, 25, 10].map((v) => ({ label: `${v}%`, checked: v === opacity, onSelect: () => set("Opacity", { opacity: v === 100 ? null : String(v / 100) }) }))}>
        {opacity}%
      </MenuButton>
      <Sep />
      {tail}
    </>
  );
}

function NoteControls({ ids }: { ids: string[] }) {
  const fill = useDesign((s) => {
    const n = s.notes.find((x) => x.id === ids[0]);
    return n?.kind === "sticky" ? n.fill : "yellow";
  });
  return (
    <>
      {FILL_COLORS.map((c: FillColor) => (
        <button key={c} className="icon-btn dg-fb-btn" aria-pressed={c === fill} aria-label={c.charAt(0).toUpperCase() + c.slice(1)} title={c.charAt(0).toUpperCase() + c.slice(1)} onClick={() => updateNotes("Note color", ids, (n) => (n.kind === "sticky" ? { ...n, fill: c } : n))}>
          <span className="dg-swatch" style={{ background: FILL_VALUES[c] }} />
        </button>
      ))}
    </>
  );
}

/** A link as people type it, made into one the format takes. */
function normalizeLink(raw: string): string | null {
  const t = raw.trim();
  if (HREF_RE.test(t)) return t;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$|\?|#|:)/i.test(t) && !/\.html$/i.test(t)) return `https://${t}`;
  return null;
}

function LinkField({ close }: { close(): void }) {
  const t = useTarget();
  const [value, setValue] = useState(t?.el.tag === "a" ? (t.el.attrs.href ?? "") : "");
  const [bad, setBad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => input.current?.focus(), []);
  if (!t) return null;
  const save = () => {
    const href = normalizeLink(value);
    if (value.trim() && !href) return setBad(true);
    editTarget(href ? "Link" : "Remove link", (root, addr, ctx) => {
      if (t.el.tag === "a") return setAttr(root, addr, "href", href, ctx);
      const inner = contentHtml(t.el).replace(/<a [^>]*>|<\/a>/g, "");
      return setContent(root, addr, href ? `<a href="${href.replace(/"/g, "&quot;")}">${inner}</a>` : inner, ctx);
    });
    close();
  };
  return (
    <form
      className="dg-link"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Icon name="link" size={18} />
      <input
        ref={input}
        value={value}
        placeholder="https://… or Pricing.html"
        aria-label="Link"
        aria-invalid={bad}
        title={bad ? "Type a web address, or another artboard’s file like Pricing.html" : undefined}
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
      <button type="button" className="icon-btn dg-fb-btn" aria-label="Close" title="Close (Esc)" onClick={close}>
        <Icon name="close" size={18} />
      </button>
    </form>
  );
}
