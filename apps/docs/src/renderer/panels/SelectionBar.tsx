// The bar over selected text (a double-click selects a word): ask the AI,
// comment, text style, bold, italic, underline, strikethrough, code, color
// and highlight, lists, and link. Its buttons keep the selection.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TEXT_COLORS, type TextColor } from "@opendeck/doc";
import { Icon, type IconName, MenuButton, type MenuEntry, shortcut } from "@opendeck/shell";
import { colorAt, setHighlight, setStyle, setTextColor, styleAt, toggleCode, toggleList } from "../editor/commands.ts";
import { newComment } from "../editor/comments.ts";
import { changed, pageEl } from "../editor/page.ts";
import { setState } from "../store.ts";
import { openLinkDialog } from "./LinkDialog.tsx";

const NAMES: Record<TextColor, string> = { red: "Red", yellow: "Yellow", green: "Green", teal: "Teal", purple: "Purple" };
const STYLES: [string, "p" | "h1" | "h2" | "h3", IconName][] = [
  ["Text", "p", "text"],
  ["Heading 1", "h1", "heading1"],
  ["Heading 2", "h2", "heading2"],
  ["Heading 3", "h3", "heading3"],
];

/** The page's selection, if there is one worth a bar: not collapsed, inside the text, not mid-drag. */
function selectionRect(): DOMRect | null {
  const page = pageEl();
  const sel = document.getSelection();
  if (!page || !sel?.rangeCount || sel.isCollapsed || !page.contains(sel.anchorNode) || !page.contains(sel.focusNode)) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return r.width || r.height ? r : null;
}

export function SelectionBar() {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [, setTick] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const update = () => {
      // A menu of the bar is open: keep the bar where it is.
      if (document.querySelector('[role="menu"]') || bar.current?.contains(document.activeElement)) return;
      setRect(dragging.current ? null : selectionRect());
      setTick((t) => t + 1);
    };
    const down = (e: MouseEvent) => {
      if (bar.current?.contains(e.target as Node) || (e.target as Element).closest?.('[role="menu"]')) return;
      dragging.current = true;
      setRect(null);
    };
    const up = () => {
      dragging.current = false;
      requestAnimationFrame(update);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && rect) setRect(null);
    };
    document.addEventListener("selectionchange", update);
    document.addEventListener("mousedown", down, true);
    document.addEventListener("mouseup", up, true);
    document.addEventListener("keydown", key);
    const stage = pageEl()?.closest(".dt-stage");
    stage?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("mouseup", up, true);
      document.removeEventListener("keydown", key);
      stage?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [rect]);

  // Above the selection, or below it when there's no room above; always inside the window.
  useLayoutEffect(() => {
    if (!rect || !bar.current) return setPos(null);
    const w = bar.current.offsetWidth;
    const h = bar.current.offsetHeight;
    const top = rect.top - h - 10 >= 52 ? rect.top - h - 10 : rect.bottom + 10;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2));
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  }, [rect]);

  if (!rect) return null;
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const on = (cmd: string) => document.queryCommandState(cmd);
  const exec = (cmd: string) => {
    document.execCommand(cmd);
    void changed();
    setTick((t) => t + 1);
  };

  const styleEntries = (): MenuEntry[] => {
    const now = styleAt();
    return STYLES.map(([label, tag, mark]) => ({ label, icon: <Icon name={mark} size={16} />, checked: now === tag, shortcut: shortcut(`Mod+Alt+${tag === "p" ? "0" : tag[1]}`), onSelect: () => setStyle(tag) }));
  };
  const colorEntries = (): MenuEntry[] => {
    const now = colorAt();
    return [
      { heading: "Text" },
      { label: "Default", icon: <span className="sel-swatch" />, checked: !now.color, onSelect: () => setTextColor(null) },
      ...TEXT_COLORS.map((c) => ({ label: NAMES[c], icon: <span className="sel-swatch" data-text={c} />, checked: now.color === c, onSelect: () => setTextColor(c) })),
      "separator",
      { heading: "Highlight" },
      { label: "No highlight", icon: <span className="sel-swatch none" />, checked: !now.highlight, onSelect: () => setHighlight(false) },
      { label: "Yellow", icon: <span className="sel-swatch mark" />, checked: now.highlight, onSelect: () => setHighlight(true) },
    ];
  };
  const listEntries = (): MenuEntry[] => {
    const now = styleAt();
    return [
      { label: "Bulleted list", icon: <Icon name="list" size={16} />, checked: now === "ul", onSelect: () => toggleList("ul") },
      { label: "Numbered list", icon: <Icon name="numbered" size={16} />, checked: now === "ol", onSelect: () => toggleList("ol") },
      { label: "Checklist", icon: <Icon name="checklist" size={16} />, checked: now === "check", onSelect: () => toggleList("check") },
    ];
  };

  const btn = (icon: "bold" | "italic" | "underline" | "strike", cmd: string, label: string, keys: string) => (
    <button className="icon-btn" aria-pressed={on(cmd)} onMouseDown={keep} onClick={() => exec(cmd)} title={`${label} (${shortcut(keys)})`} aria-label={label}>
      <Icon name={icon} />
    </button>
  );

  return (
    <div ref={bar} className="sel-bar" role="toolbar" aria-label="Format selection" style={pos ?? { visibility: "hidden" }}>
      <button className="icon-btn" onMouseDown={keep} onClick={() => setState({ asking: true })} title="Ask AI about the selection" aria-label="Ask AI about the selection">
        <Icon name="sparkle" />
      </button>
      <button className="icon-btn" onMouseDown={keep} onClick={() => newComment()} title={`Comment (${shortcut("Mod+Alt+M")})`} aria-label="Comment">
        <Icon name="chat" />
      </button>
      <span className="tb-sep" aria-hidden />
      <MenuButton className="icon-btn wide" label="Text style" title="Text style" entries={styleEntries}>
        <Icon name="textSize" />
        <Icon name="chevronDown" size={12} />
      </MenuButton>
      <span className="tb-sep" aria-hidden />
      {btn("bold", "bold", "Bold", "Mod+B")}
      {btn("italic", "italic", "Italic", "Mod+I")}
      {btn("underline", "underline", "Underline", "Mod+U")}
      {btn("strike", "strikeThrough", "Strikethrough", "Mod+Shift+X")}
      <button className="icon-btn" onMouseDown={keep} onClick={toggleCode} title={`Code (${shortcut("Mod+E")})`} aria-label="Code">
        <Icon name="braces" />
      </button>
      <MenuButton className="icon-btn wide" label="Color and highlight" title="Color and highlight" entries={colorEntries}>
        <Icon name="palette" />
        <Icon name="chevronDown" size={12} />
      </MenuButton>
      <span className="tb-sep" aria-hidden />
      <MenuButton className="icon-btn wide" label="Lists" title="Lists" entries={listEntries}>
        <Icon name="list" />
        <Icon name="chevronDown" size={12} />
      </MenuButton>
      <span className="tb-sep" aria-hidden />
      <button className="icon-btn" onMouseDown={keep} onClick={openLinkDialog} title={`Link (${shortcut("Mod+K")})`} aria-label="Link">
        <Icon name="link" />
      </button>
    </div>
  );
}
