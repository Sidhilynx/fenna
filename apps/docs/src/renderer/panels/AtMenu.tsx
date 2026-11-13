// "@" in the text: a menu at the caret to ask the AI, put in a date, or link
// to a tab. The caret stays in the text while it is open: the words typed
// after "@" filter it, ↑ ↓ move, Enter or Tab chooses, Esc closes and leaves
// the "@" as typed. Choosing replaces "@" and the words after it.

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { flattenTabs, tabLabel } from "@opendeck/doc";
import { Icon } from "@opendeck/shell";
import { insertDate, insertTabLink } from "../editor/commands.ts";
import { localDate, matchMentions, mentionQuery, opensMention } from "../editor/lines.ts";
import { currentBlock, openChip, pageEl } from "../editor/page.ts";
import { flushTyping, getState } from "../store.ts";
import { AssistantMark, useAssistant } from "./assistant.tsx";
import { openInlineAsk } from "./InlineAsk.tsx";

interface At {
  node: Text;
  /** Where the "@" is in `node`. */
  offset: number;
  query: string;
}

interface Item {
  id: string;
  group: string;
  label: string;
  icon: ReactNode;
  /** Other words that find it. */
  also?: string;
  run(): void | Promise<void>;
}

/** The "@" being typed at the caret, if there is one. */
function atCaret(prev: At | null): At | null {
  const sel = document.getSelection();
  if (!prev || !sel?.rangeCount || !sel.isCollapsed) return null;
  const { node, offset } = prev;
  if (sel.focusNode !== node || !node.isConnected) return null;
  const query = mentionQuery(node.data, offset, sel.focusOffset);
  return query === null ? null : { node, offset, query };
}

export function AtMenu() {
  const ai = useAssistant();
  const [at, setAt] = useState<At | null>(null);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const atRef = useRef<At | null>(null);
  atRef.current = at;

  const docTabs = getState().doc?.index.tabs ?? [];
  const all: Item[] = [
    { id: "ai", group: `Ask ${ai.name}`, label: ai.name, icon: <AssistantMark size={18} />, also: "ai assistant ask write", run: askAi },
    { id: "date", group: "Dates", label: "Date", icon: <Icon name="calendar" size={16} />, also: "pick", run: () => { const chip = insertDate(); if (chip) openChip(chip); } },
    { id: "today", group: "Dates", label: "Today’s date", icon: <Icon name="calendar" size={16} />, also: "today's now", run: () => void insertDate(localDate()) },
    { id: "tomorrow", group: "Dates", label: "Tomorrow’s date", icon: <Icon name="calendar" size={16} />, also: "tomorrow's", run: () => void insertDate(localDate(1)) },
    ...flattenTabs(docTabs).map((f) => {
      const name = tabLabel(docTabs, f.ref.id);
      return { id: `tab:${f.ref.id}`, group: "Tabs", label: name, icon: <Icon name="doc" size={16} />, also: "tab link", run: () => insertTabLink(f.ref.id, name) };
    }),
  ];
  const items = matchMentions(all, at?.query ?? "");
  const current = Math.min(active, Math.max(0, items.length - 1));

  // Typing "@" after a space or at a line's start opens the menu; moving away or typing past it closes it.
  useEffect(() => {
    const page = pageEl();
    if (!page) return;
    const onInput = (e: Event) => {
      const ev = e as InputEvent;
      if (ev.inputType !== "insertText" || !ev.data?.endsWith("@")) return;
      const sel = document.getSelection();
      const node = sel?.focusNode;
      if (!sel?.isCollapsed || !(node instanceof Text)) return;
      const offset = sel.focusOffset - 1;
      if (!opensMention(node.data, offset)) return;
      if (node.parentElement?.closest("pre, code, a")) return;
      setActive(0);
      setAt({ node, offset, query: "" });
    };
    const onSel = () => {
      if (!atRef.current) return;
      const next = atCaret(atRef.current);
      if (!next) return setAt(null);
      if (next.query !== atRef.current.query) {
        setActive(0);
        setAt(next);
      }
    };
    const onBlur = () => setTimeout(() => document.activeElement !== page && setAt(null), 0);
    page.addEventListener("input", onInput);
    page.addEventListener("blur", onBlur);
    document.addEventListener("selectionchange", onSel);
    return () => {
      page.removeEventListener("input", onInput);
      page.removeEventListener("blur", onBlur);
      document.removeEventListener("selectionchange", onSel);
    };
  }, []);

  // Words that match nothing, ending in a space: the "@" was just text.
  useEffect(() => {
    if (at && !items.length && /\s$/.test(at.query)) setAt(null);
  });

  const choose = async (item: Item | undefined) => {
    const a = atRef.current;
    if (!item || !a) return;
    setAt(null);
    const sel = document.getSelection();
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(a.node, Math.min(a.node.length, a.offset + 1 + a.query.length));
    sel?.removeAllRanges();
    sel?.addRange(r);
    document.execCommand("delete");
    await item.run();
  };

  // The keys, ahead of the page's own while the menu is open.
  useEffect(() => {
    if (!at || !items.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement !== pageEl()) return;
      const k = e.key;
      if (k !== "ArrowDown" && k !== "ArrowUp" && k !== "Enter" && k !== "Tab" && k !== "Escape") return;
      if (e.ctrlKey || e.metaKey || e.altKey || (k === "Enter" && e.shiftKey)) return;
      e.preventDefault();
      e.stopPropagation();
      if (k === "ArrowDown") setActive((current + 1) % items.length);
      else if (k === "ArrowUp") setActive((current - 1 + items.length) % items.length);
      else if (k === "Escape") setAt(null);
      else void choose(items[current]);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // Hang under the "@" (above it when there's no room below).
  useLayoutEffect(() => {
    if (!at || !menu.current) return setPos(null);
    const r = document.createRange();
    r.setStart(at.node, at.offset);
    r.setEnd(at.node, Math.min(at.node.length, at.offset + 1));
    const c = r.getBoundingClientRect();
    const h = menu.current.offsetHeight;
    const w = menu.current.offsetWidth;
    const below = c.bottom + 6;
    const top = below + h > window.innerHeight - 8 && c.top - 6 - h > 8 ? c.top - 6 - h : below;
    setPos({ left: Math.max(8, Math.min(window.innerWidth - w - 8, c.left)), top });
  }, [at, items.length]);

  // Keep the active row in view, and tell assistive tech which row it is.
  useEffect(() => {
    const page = pageEl();
    const row = menu.current?.querySelector<HTMLElement>(`[data-i="${current}"]`);
    row?.scrollIntoView({ block: "nearest" });
    if (!page) return;
    if (at && items.length) {
      page.setAttribute("aria-activedescendant", row?.id ?? "");
      page.setAttribute("aria-controls", "at-menu");
    } else {
      page.removeAttribute("aria-activedescendant");
      page.removeAttribute("aria-controls");
    }
  });

  if (!at || !items.length) return null;
  let group = "";
  return createPortal(
    <div ref={menu} id="at-menu" className="menu at-menu" role="listbox" aria-label="Insert" style={pos ?? { visibility: "hidden" }} onMouseDown={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        const head = it.group !== group ? (group = it.group) : null;
        return (
          <div key={it.id} role="presentation">
            {head && <div className="menu-heading">{head}</div>}
            <div id={`at-${i}`} data-i={i} role="option" aria-selected={i === current} className={`menu-item${i === current ? " active" : ""}`} onMouseMove={() => i !== current && setActive(i)} onClick={() => void choose(it)}>
              <span className="at-icon">{it.icon}</span>
              <span className="menu-label">{it.label}</span>
            </div>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

/** "@AI" chosen: the AI box on this line (in its place if the line is empty, under it if not). */
async function askAi() {
  // New lines get their ids when typing is read back; read it now so this line has its own.
  await flushTyping();
  const b = currentBlock();
  if (b?.id) openInlineAsk(b.id);
}
