// Menus: one component for dropdowns, the "…" menus and right-click menus.
// Keyboard: arrows move, Enter/Space choose, Esc closes, typing a letter
// jumps to the next item starting with it. An item with a submenu opens it
// on hover, Enter or →; ← or Esc goes back. Disabled items are announced but
// skipped. Positioned to stay on screen; a long menu scrolls.
//
// A menu may open with a prompt row at the top ("Find a format, or describe
// one"): typing there filters the items when asked to, arrows still move
// through them, and Enter with words no item matches hands the words on
// (to the AI, usually).

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons.tsx";

type Item = {
  label: string;
  /** What choosing the item does; an item with a submenu opens that instead. */
  onSelect?: () => void;
  submenu?: MenuEntry[];
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  hint?: string;
  /** A short fact at the right (a count, a state). */
  aside?: string;
  /** Shown before the label (a maker's logo, say). */
  icon?: ReactNode;
};

/** An item, a line between groups, a small heading, or a line of plain text (why the items below are off, say). */
export type MenuEntry = Item | "separator" | { heading: string; aside?: string } | { note: string };

export interface MenuPrompt {
  placeholder: string;
  /** Narrow the items to those whose label holds what is typed. */
  filter?: boolean;
  /** Enter with words and no matching item. */
  onSubmit?(text: string): void;
}

interface Props {
  entries: MenuEntry[];
  /** Screen point (right-click) or the element to hang under. */
  anchor: { x: number; y: number } | HTMLElement;
  align?: "start" | "end";
  onClose(): void;
  label?: string;
  /** A submenu: hang beside the anchor, and go back to the parent on ← or Esc. */
  onBack?(): void;
  prompt?: MenuPrompt;
}

const HOVER_OPEN = 140;
const isItem = (e: MenuEntry): e is Item => typeof e === "object" && "label" in e;
/** Every item a menu can reach, submenus opened out: what a filtering prompt searches. */
const reachable = (es: MenuEntry[]): Item[] => es.flatMap((e) => (isItem(e) ? (e.submenu ? reachable(e.submenu) : [e]) : []));

export function Menu({ entries, anchor, align = "start", onClose, label, onBack, prompt }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown: MenuEntry[] = prompt?.filter && q ? reachable(entries).filter((e) => e.label.toLowerCase().includes(q)) : entries;
  const items = shown.filter(isItem);
  const [active, setActive] = useState(() => (prompt ? -1 : items.findIndex((i) => !i.disabled)));
  const [sub, setSub] = useState<number | null>(null);
  const hoverTimer = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left: number;
    let top: number;
    if (anchor instanceof HTMLElement) {
      const r = anchor.getBoundingClientRect();
      if (onBack) {
        left = r.right + w + 4 <= window.innerWidth - 8 ? r.right + 4 : r.left - w - 4;
        top = r.top - 6;
      } else {
        left = align === "end" ? r.right - w : r.left;
        top = r.bottom + 4;
        if (top + h > window.innerHeight - 8) top = r.top - h - 4;
      }
    } else {
      left = anchor.x;
      top = anchor.y;
      if (top + h > window.innerHeight - 8) top = Math.max(8, anchor.y - h);
    }
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - h - 8, top));
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  }, [anchor, align, onBack, shown.length]);

  // Focus once placed: a menu still hidden while it is measured cannot take focus.
  const placed = pos !== null;
  useEffect(() => {
    if (!placed) return;
    if (input.current) input.current.focus();
    else ref.current?.focus();
  }, [placed]);

  useEffect(() => {
    if (active >= 0) rows.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    if (onBack) return;
    // The root menu owns closing: a press outside every open menu, or the window losing focus or size.
    const away = (e: MouseEvent) => {
      if (!(e.target instanceof Element && e.target.closest(".menu"))) onClose();
    };
    const blur = () => onClose();
    window.addEventListener("mousedown", away, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", blur);
    };
  }, [onClose, onBack]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const choose = (i: number) => {
    const item = items[i];
    if (!item || item.disabled) return;
    if (item.submenu) {
      setActive(i);
      setSub(i);
      return;
    }
    onClose();
    item.onSelect?.();
  };

  const step = (from: number, dir: 1 | -1) => {
    for (let k = 1; k <= items.length; k++) {
      const i = (from + dir * k + items.length) % items.length;
      if (!items[i]!.disabled) return i;
    }
    return from;
  };

  const back = () => {
    setSub(null);
    (input.current ?? ref.current)?.focus();
  };

  const submit = () => {
    const text = query.trim();
    if (active >= 0 && items[active]) return choose(active);
    if (text && prompt?.onSubmit) {
      onClose();
      prompt.onSubmit(text);
    }
  };

  let n = -1;
  const open = sub !== null ? items[sub] : null;
  return createPortal(
    <>
      <div
        ref={ref}
        className={`menu${prompt ? " with-prompt" : ""}`}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden", left: 0, top: 0 }}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          const typing = e.target === input.current;
          if (e.key === "ArrowDown") setActive((a) => step(a, 1));
          else if (e.key === "ArrowUp") setActive((a) => step(a < 0 ? 0 : a, -1));
          else if (!typing && e.key === "Home") setActive(step(-1, 1));
          else if (!typing && e.key === "End") setActive(step(items.length, -1));
          else if (e.key === "Enter" || (!typing && e.key === " ")) {
            if (typing) submit();
            else choose(active);
          } else if (e.key === "ArrowRight" && items[active]?.submenu && (!typing || !query)) choose(active);
          else if ((e.key === "ArrowLeft" && (!typing || !query) || e.key === "Escape") && onBack) onBack();
          else if (e.key === "Escape" || e.key === "Tab") onClose();
          else if (!typing && e.key.length === 1) {
            const k = e.key.toLowerCase();
            const start = active;
            for (let j = 1; j <= items.length; j++) {
              const i = (start + j) % items.length;
              if (!items[i]!.disabled && items[i]!.label.toLowerCase().startsWith(k)) {
                setActive(i);
                break;
              }
            }
          } else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {prompt && (
          <input
            ref={input}
            className="menu-prompt"
            value={query}
            placeholder={prompt.placeholder}
            aria-label={prompt.placeholder}
            maxLength={2000}
            onChange={(e) => {
              setQuery(e.target.value);
              setSub(null);
              setActive(prompt.filter && e.target.value.trim() ? 0 : -1);
            }}
          />
        )}
        {prompt?.filter && q && !items.length && <div className="menu-note">{prompt.onSubmit ? "Press Enter to ask" : "Nothing matches"}</div>}
        {shown.map((e, i) => {
          if (e === "separator") return <div key={i} className="menu-sep" role="separator" />;
          if ("note" in e)
            return (
              <div key={i} className="menu-note">
                {e.note}
              </div>
            );
          if ("heading" in e)
            return (
              <div key={i} className="menu-heading">
                <span>{e.heading}</span>
                {e.aside && <span className="menu-heading-aside">{e.aside}</span>}
              </div>
            );
          n++;
          const idx = n;
          return (
            <div
              key={i}
              ref={(el) => {
                rows.current[idx] = el;
              }}
              role={e.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={e.checked}
              aria-disabled={e.disabled}
              aria-haspopup={e.submenu ? "menu" : undefined}
              aria-expanded={e.submenu ? sub === idx : undefined}
              className={`menu-item${idx === active ? " active" : ""}${e.danger ? " danger" : ""}${e.disabled ? " disabled" : ""}`}
              onMouseEnter={() => {
                if (e.disabled) return;
                setActive(idx);
                window.clearTimeout(hoverTimer.current);
                if (e.submenu ? sub !== idx : sub !== null) hoverTimer.current = window.setTimeout(() => setSub(e.submenu ? idx : null), HOVER_OPEN);
              }}
              onClick={() => choose(idx)}
            >
              {e.icon}
              <span className="menu-label">
                <span className="menu-text">{e.label}</span>
                {e.hint && <span className="menu-hint">{e.hint}</span>}
              </span>
              {e.checked !== undefined && e.aside && <span className="menu-check">{e.checked && <Icon name="check" size={16} />}</span>}
              {e.aside && <span className="menu-aside">{e.aside}</span>}
              {e.shortcut && <kbd className="menu-kbd">{e.shortcut}</kbd>}
              {e.checked !== undefined && !e.aside && <span className="menu-check">{e.checked && <Icon name="check" size={16} />}</span>}
              {e.submenu && <Icon name="chevronRight" size={14} className="menu-more" />}
            </div>
          );
        })}
      </div>
      {open?.submenu && rows.current[sub!] && <Menu entries={open.submenu} anchor={rows.current[sub!]!} label={open.label} onClose={onClose} onBack={back} />}
    </>,
    document.body,
  );
}

/** A button that opens a menu below itself. */
export function MenuButton({
  entries,
  children,
  className = "btn ghost",
  align,
  label,
  title,
  prompt,
}: {
  entries: MenuEntry[] | (() => MenuEntry[]);
  children: ReactNode;
  className?: string;
  align?: "start" | "end";
  label?: string;
  title?: string;
  prompt?: MenuPrompt;
}) {
  const [open, setOpen] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        className={className}
        aria-haspopup="menu"
        aria-expanded={!!open}
        aria-label={label}
        title={title}
        onMouseDown={(e) => {
          // Toggle on press, like native menus; the outside-click handler would otherwise reopen it.
          e.preventDefault();
          setOpen(open ? null : e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(e.currentTarget);
          }
        }}
      >
        {children}
      </button>
      {open && <Menu entries={typeof entries === "function" ? entries() : entries} anchor={open} align={align} label={label} prompt={prompt} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Platform-correct shortcut text: "Mod+D" → "Ctrl+D" or "⌘D". */
export function shortcut(s: string): string {
  const mac = navigator.platform.toLowerCase().includes("mac");
  if (!mac) return s.replace(/Mod/g, "Ctrl");
  return s.replace(/Mod\+/g, "⌘").replace(/Shift\+/g, "⇧").replace(/Alt\+/g, "⌥").replace(/Backspace/, "⌫");
}
