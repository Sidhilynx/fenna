// Floating format bar: appears above a selected text element.
// Mirrors the compact toolbar pattern: type/style picker, color swatch,
// bold/italic/underline/link, list & alignment, comment, and element actions.
// All edits go through @opendeck/format + editSlide.

import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ELEMENTS,
  type ElementNode,
  PROPERTIES,
  type SlideNode,
  type ValueContext,
  cloneNode,
  elementChildren,
  insert,
  lastIndex,
  parentAddress,
  remove,
  resolvedStyle,
  setAttr,
  setStyles,
} from "@opendeck/format";
import { computedOf, normalizeHex, resolveColorHex, rgbToHex } from "../panels/inspector/utils.tsx";
import { Icon, MenuButton, shortcut } from "@opendeck/shell";
import * as cmd from "./commands.ts";
import { newComment } from "./comments.ts";
import { type Rect } from "./geometry.ts";
import { editSlide, useEditor } from "./store.ts";
import "./formatbar.css";

const TEXT_TAGS = new Set(["h1", "h2", "h3", "p", "ul", "ol"]);
const SAFE_HREF = /^(https?:\/\/\S+|mailto:\S+|#slide-\d{1,3})$/;

const TAG_OPTIONS = [
  { tag: "h1", label: "Heading 1" },
  { tag: "h2", label: "Heading 2" },
  { tag: "h3", label: "Heading 3" },
  { tag: "p", label: "Paragraph" },
  { tag: "ul", label: "Bullet list" },
  { tag: "ol", label: "Numbered list" },
] as const;

const TAG_LABEL: Record<string, string> = Object.fromEntries(TAG_OPTIONS.map((o) => [o.tag, o.label]));

const ALIGN_OPTIONS = [
  { value: "left", icon: "alignLeft" as const, label: "Align left" },
  { value: "center", icon: "alignCenter" as const, label: "Align center" },
  { value: "right", icon: "alignRight" as const, label: "Align right" },
  { value: "justify", icon: "alignJustify" as const, label: "Justify" },
] as const;

/** Convert a text/list node's tag while keeping valid attrs, styles, and children. */
export function convertTag(slide: ElementNode, address: string, el: ElementNode, nextTag: string, ctx: ValueContext): ElementNode {
  if (el.tag === nextTag) return slide;
  const next = cloneNode(el);
  const spec = ELEMENTS[nextTag];
  const allowedAttrs = new Set(["id", ...(spec?.attrs ?? [])]);
  for (const k of Object.keys(next.attrs)) {
    if (!allowedAttrs.has(k)) delete next.attrs[k];
  }
  next.style = next.style.filter((d) => PROPERTIES[d.name]?.on.includes(nextTag));

  const wasList = el.tag === "ul" || el.tag === "ol";
  const willList = nextTag === "ul" || nextTag === "ol";
  if (wasList && !willList) {
    const joined: SlideNode[] = [];
    elementChildren(next).forEach((li, idx) => {
      if (idx > 0) joined.push({ type: "element", tag: "br", attrs: {}, style: [], children: [], line: 0, col: 0 });
      joined.push(...li.children);
    });
    next.children = joined;
  } else if (!wasList && willList) {
    const items: ElementNode[] = [];
    let bucket: SlideNode[] = [];
    for (const c of next.children) {
      if (c.type === "element" && c.tag === "br") {
        items.push({ type: "element", tag: "li", attrs: {}, style: [], children: bucket, line: 0, col: 0 });
        bucket = [];
      } else {
        bucket.push(c);
      }
    }
    if (bucket.length || !items.length) {
      items.push({ type: "element", tag: "li", attrs: {}, style: [], children: bucket, line: 0, col: 0 });
    }
    next.children = items;
  }

  next.tag = nextTag;
  const without = remove(slide, address, ctx);
  return insert(without, parentAddress(address), [next], lastIndex(address), ctx).slide;
}

interface Props {
  element: ElementNode;
  address: string;
  box: Rect;
  scale: number;
  frameRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
}

export function FormatBar({ element, address, box, scale, frameRef, stageRef }: Props) {
  const theme = useEditor((s) => s.deck?.index.theme ?? null);
  const editing = useEditor((s) => s.editing);
  const barRef = useRef<HTMLDivElement>(null);
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const colorPopRef = useRef<HTMLDivElement>(null);
  const linkPopRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);

  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [colorPos, setColorPos] = useState<{ left: number; top: number } | null>(null);
  const [hexDraft, setHexDraft] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState(false);
  const [, setSelTick] = useState(0);

  const isEditingThis = editing === address;

  // Track inline selection formatting state while editing.
  useEffect(() => {
    if (!isEditingThis) return;
    const onSel = () => setSelTick((t) => t + 1);
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [isEditingThis]);

  // Reset popovers when selection changes.
  useEffect(() => {
    setColorOpen(false);
    setLinkOpen(false);
    setLinkError(false);
  }, [address]);

  // Place toolbar above (or below if near top) the selected box in viewport coords.
  useLayoutEffect(() => {
    const place = () => {
      const fr = frameRef.current?.getBoundingClientRect();
      const bar = barRef.current;
      if (!fr || !bar) return;
      const bw = bar.offsetWidth;
      const bh = bar.offsetHeight;
      const bLeft = fr.left + box.x * scale;
      const bTop = fr.top + box.y * scale;
      const bWidth = box.w * scale;
      const bHeight = box.h * scale;
      const GAP = 10;
      const above = bTop - bh - GAP;
      const below = bTop + bHeight + GAP;
      const top = above >= 52 ? above : Math.min(window.innerHeight - bh - 8, below);
      const left = Math.max(8, Math.min(bLeft + bWidth / 2 - bw / 2, window.innerWidth - bw - 8));
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
    };
    place();
    const stageEl = stageRef.current;
    stageEl?.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    const ro = new ResizeObserver(place);
    if (barRef.current) ro.observe(barRef.current);
    if (frameRef.current) ro.observe(frameRef.current);
    return () => {
      stageEl?.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
      ro.disconnect();
    };
  }, [box.x, box.y, box.w, box.h, scale, frameRef, stageRef, element.tag, colorOpen, linkOpen]);

  // Position color popover below swatch button.
  useLayoutEffect(() => {
    if (!colorOpen || !colorBtnRef.current) return;
    const r = colorBtnRef.current.getBoundingClientRect();
    const popW = 224;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - popW - 8));
    const top = Math.min(r.bottom + 6, window.innerHeight - 190);
    setColorPos({ left, top });
  }, [colorOpen]);

  // Close popovers on outside click / Escape.
  useEffect(() => {
    if (!colorOpen && !linkOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (colorOpen && !colorPopRef.current?.contains(t) && !colorBtnRef.current?.contains(t)) {
        setColorOpen(false);
      }
      if (linkOpen && !linkPopRef.current?.contains(t) && !barRef.current?.contains(t)) {
        setLinkOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setColorOpen(false);
        setLinkOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [colorOpen, linkOpen]);

  if (!TEXT_TAGS.has(element.tag)) return null;

  const resolved = theme
    ? new Map(resolvedStyle(element, theme).map((d) => [d.name, d.value]))
    : new Map<string, string>();
  const inlineMap = new Map(element.style.map((d) => [d.name, d.value]));
  const get = (prop: string) => inlineMap.get(prop) ?? resolved.get(prop) ?? "";

  const fontWeight = get("font-weight");
  const fontStyle = get("font-style");
  const textDecor = get("text-decoration");
  const align = get("text-align") || "left";
  const rawColor = get("color") || "";
  const themeColors = theme?.colors ?? {};
  const swatchBg = resolveColorHex(rawColor, themeColors) || rgbToHex(computedOf(address, "color")) || "var(--text)";

  const isBold = isEditingThis
    ? document.queryCommandState("bold")
    : fontWeight === "700" || fontWeight === "bold" || Number(fontWeight) >= 600;
  const isItalic = isEditingThis ? document.queryCommandState("italic") : fontStyle === "italic";
  const isUnderline = isEditingThis ? document.queryCommandState("underline") : textDecor.includes("underline");
  const isList = element.tag === "ul" || element.tag === "ol";

  const textStyleNames = Object.keys(theme?.textStyles ?? {});
  const activeStyleName = element.attrs["data-style"];
  const pickerLabel = activeStyleName ? activeStyleName.replace(/-/g, " ") : (TAG_LABEL[element.tag] ?? element.tag);
  const activeAlignOpt = ALIGN_OPTIONS.find((o) => o.value === align) ?? ALIGN_OPTIONS[0];

  const toggleBold = () => {
    if (isEditingThis) {
      document.execCommand("bold");
      setSelTick((t) => t + 1);
      return;
    }
    void editSlide("Bold", (s, ctx) => setStyles(s, address, { "font-weight": isBold ? "400" : "700" }, ctx));
  };

  const toggleItalic = () => {
    if (isEditingThis) {
      document.execCommand("italic");
      setSelTick((t) => t + 1);
      return;
    }
    void editSlide("Italic", (s, ctx) => setStyles(s, address, { "font-style": isItalic ? "normal" : "italic" }, ctx));
  };

  const toggleUnderline = () => {
    if (isEditingThis) {
      document.execCommand("underline");
      setSelTick((t) => t + 1);
      return;
    }
    void editSlide("Underline", (s, ctx) => setStyles(s, address, { "text-decoration": isUnderline ? "none" : "underline" }, ctx));
  };

  const openLink = () => {
    setColorOpen(false);
    if (isEditingThis) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) savedRange.current = sel.getRangeAt(0).cloneRange();
    } else {
      savedRange.current = null;
    }
    setLinkDraft("");
    setLinkError(false);
    setLinkOpen((o) => !o);
  };

  const applyLink = () => {
    const url = linkDraft.trim();
    if (!url) {
      if (isEditingThis && savedRange.current) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(savedRange.current);
        document.execCommand("unlink");
      }
      setLinkOpen(false);
      return;
    }
    if (!SAFE_HREF.test(url)) {
      setLinkError(true);
      return;
    }
    if (isEditingThis && savedRange.current) {
      const dom = document.querySelector<HTMLElement>(`.stage .od-slide [data-od="${address}"]`);
      dom?.focus({ preventScroll: true });
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRange.current);
      document.execCommand("createLink", false, url);
      setLinkOpen(false);
      return;
    }
    if (!isList) {
      void editSlide("Add link", (s, ctx) => {
        const target = cloneNode(element);
        const unwrapped: SlideNode[] = [];
        for (const c of target.children) {
          if (c.type === "element" && c.tag === "a") unwrapped.push(...c.children);
          else unwrapped.push(c);
        }
        const linked: ElementNode = { type: "element", tag: "a", attrs: { href: url }, style: [], children: unwrapped, line: 0, col: 0 };
        target.children = [linked];
        const without = remove(s, address, ctx);
        return insert(without, parentAddress(address), [target], lastIndex(address), ctx).slide;
      });
    }
    setLinkOpen(false);
  };

  const applyColor = (val: string | null) => {
    void editSlide("Text color", (s, ctx) => setStyles(s, address, { color: val }, ctx));
    setColorOpen(false);
  };

  const pinned = cmd.isPinned(element);

  return (
    <>
      <div
        ref={barRef}
        className="fmt-bar"
        role="toolbar"
        aria-label="Text formatting"
        style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden", left: 0, top: 0 }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          // Keep text selection and focus inside contentEditable while clicking toolbar controls.
          if (!(e.target as HTMLElement).closest("input")) e.preventDefault();
        }}
      >
        {/* Text type / style dropdown */}
        <MenuButton
          className="btn ghost fmt-tag-btn"
          label="Text type"
          align="start"
          entries={[
            ...TAG_OPTIONS.map((opt) => ({
              label: opt.label,
              checked: element.tag === opt.tag,
              onSelect: () => void editSlide(`Change to ${opt.label}`, (s, ctx) => convertTag(s, address, element, opt.tag, ctx)),
            })),
            ...(textStyleNames.length
              ? [
                  "separator" as const,
                  { heading: "Text style" } as const,
                  {
                    label: "None",
                    checked: !activeStyleName,
                    onSelect: () => void editSlide("Text style", (s, ctx) => setAttr(s, address, "data-style", null, ctx)),
                  },
                  ...textStyleNames.map((name) => ({
                    label: name.replace(/-/g, " "),
                    checked: activeStyleName === name,
                    onSelect: () => void editSlide("Text style", (s, ctx) => setAttr(s, address, "data-style", name, ctx)),
                  })),
                ]
              : []),
          ]}
        >
          <Icon name="textType" size={14} />
          <span className="fmt-tag-label">{pickerLabel}</span>
          <Icon name="chevronDown" size={12} />
        </MenuButton>

        <span className="fmt-sep" aria-hidden />

        {/* Color swatch */}
        <button
          ref={colorBtnRef}
          type="button"
          className="icon-btn fmt-btn fmt-swatch-btn"
          title="Text color"
          aria-label="Text color"
          aria-expanded={colorOpen}
          onClick={() => {
            setLinkOpen(false);
            setHexDraft(normalizeHex(swatchBg) ?? "");
            setColorOpen((o) => !o);
          }}
        >
          <span className="fmt-color-swatch" style={{ background: swatchBg }} />
        </button>

        {/* Bold / Italic / Underline / Link */}
        <button type="button" className={`icon-btn fmt-btn${isBold ? " on" : ""}`} aria-pressed={isBold} title="Bold (Ctrl+B)" aria-label="Bold" onClick={toggleBold}>
          <Icon name="bold" size={14} />
        </button>
        <button type="button" className={`icon-btn fmt-btn${isItalic ? " on" : ""}`} aria-pressed={isItalic} title="Italic (Ctrl+I)" aria-label="Italic" onClick={toggleItalic}>
          <Icon name="italic" size={14} />
        </button>
        <button type="button" className={`icon-btn fmt-btn${isUnderline ? " on" : ""}`} aria-pressed={isUnderline} title="Underline (Ctrl+U)" aria-label="Underline" onClick={toggleUnderline}>
          <Icon name="underline" size={14} />
        </button>
        <button type="button" className={`icon-btn fmt-btn${linkOpen ? " on" : ""}`} aria-expanded={linkOpen} title="Add link" aria-label="Add link" onClick={openLink}>
          <Icon name="link" size={14} />
        </button>

        <span className="fmt-sep" aria-hidden />

        {/* List toggle & Alignment */}
        <button
          type="button"
          className={`icon-btn fmt-btn${isList ? " on" : ""}`}
          aria-pressed={isList}
          title={isList ? "Convert to paragraph" : "Bullet list"}
          aria-label={isList ? "Convert to paragraph" : "Bullet list"}
          onClick={() => void editSlide(isList ? "Paragraph" : "Bullet list", (s, ctx) => convertTag(s, address, element, isList ? "p" : "ul", ctx))}
        >
          <Icon name="list" size={14} />
        </button>

        <MenuButton
          className="icon-btn fmt-btn"
          label="Alignment"
          title="Alignment"
          entries={ALIGN_OPTIONS.map((opt) => ({
            label: opt.label,
            checked: align === opt.value,
            onSelect: () => void editSlide("Align", (s, ctx) => setStyles(s, address, { "text-align": opt.value }, ctx)),
          }))}
        >
          <Icon name={activeAlignOpt.icon} size={14} />
        </MenuButton>

        <span className="fmt-sep" aria-hidden />

        {/* Comment & More */}
        <button type="button" className="icon-btn fmt-btn" title="Comment" aria-label="Comment" onClick={newComment}>
          <Icon name="chat" size={14} />
        </button>

        <MenuButton
          className="icon-btn fmt-btn"
          label="Element actions"
          title="More actions"
          align="end"
          entries={[
            { label: "Duplicate", shortcut: shortcut("Mod+D"), onSelect: () => void cmd.duplicateSelection() },
            { label: pinned ? "Put back in layout" : "Pin in place", onSelect: () => void cmd.setPinned(!pinned) },
            "separator",
            { label: "Bring forward", shortcut: shortcut("Mod+]"), onSelect: () => void cmd.restack("forward") },
            { label: "Send backward", shortcut: shortcut("Mod+["), onSelect: () => void cmd.restack("backward") },
            "separator",
            { label: "Delete", shortcut: "Delete", danger: true, onSelect: () => void cmd.deleteSelection() },
          ]}
        >
          <Icon name="dots" size={14} />
        </MenuButton>
      </div>

      {/* Color picker popover */}
      {colorOpen &&
        createPortal(
          <div
            ref={colorPopRef}
            className="fmt-popover"
            style={colorPos ? { left: colorPos.left, top: colorPos.top } : { visibility: "hidden", left: 0, top: 0 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="fmt-pop-head">
              <span>Theme colors</span>
              {inlineMap.has("color") && (
                <button type="button" className="fmt-pop-reset" onClick={() => applyColor(null)}>
                  Reset
                </button>
              )}
            </div>
            <div className="fmt-pop-grid">
              {Object.entries(themeColors).map(([name, hex]) => {
                const active = rawColor === `var(--${name})` || rawColor.toLowerCase() === hex.toLowerCase();
                return (
                  <button
                    key={name}
                    type="button"
                    className={`fmt-pop-swatch${active ? " active" : ""}`}
                    title={name}
                    aria-label={name}
                    style={{ background: hex }}
                    onClick={() => applyColor(`var(--${name})`)}
                  />
                );
              })}
            </div>
            <div className="fmt-pop-hex">
              <input
                type="text"
                className="fmt-pop-input"
                placeholder="#hex"
                aria-label="Hex color"
                value={hexDraft}
                onChange={(e) => setHexDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const hex = normalizeHex(hexDraft);
                    if (hex) applyColor(hex);
                  }
                }}
              />
            </div>
          </div>,
          document.body,
        )}

      {/* Link URL popover */}
      {linkOpen &&
        pos &&
        createPortal(
          <div
            ref={linkPopRef}
            className="fmt-popover fmt-link-pop"
            style={{ left: Math.max(8, Math.min(pos.left + 120, window.innerWidth - 260)), top: pos.top + 42 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              type="text"
              className={`fmt-pop-input${linkError ? " error" : ""}`}
              placeholder="https://… or #slide-2"
              aria-label="Link URL"
              value={linkDraft}
              onChange={(e) => {
                setLinkDraft(e.target.value);
                setLinkError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                } else if (e.key === "Escape") {
                  setLinkOpen(false);
                }
              }}
            />
            <button type="button" className="btn primary fmt-link-apply" onClick={applyLink}>
              Apply
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

/** True when this element should show a FormatBar. */
export function shouldShowFormatBar(el: ElementNode | null): boolean {
  return !!el && TEXT_TAGS.has(el.tag);
}
