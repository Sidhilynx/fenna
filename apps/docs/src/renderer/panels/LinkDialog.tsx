// Add, change or remove a link (Ctrl+K, or the link button over a
// selection): the text it shows, and where it goes. Typing "/" in the link
// lists the doc's tabs and this tab's headings to link to. It opens as a
// small card under the words, not a modal: Esc or a click away closes it.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { flattenTabs, tabLabel } from "@opendeck/doc";
import { linkAt, selectedText, setLink } from "../editor/commands.ts";
import { getState } from "../store.ts";
import { outlineOf } from "./Sidebar.tsx";

let open: { href: string; text: string; under: { left: number; top: number; bottom: number } } | null = null;
const listeners = new Set<() => void>();
const set = (v: typeof open) => {
  open = v;
  for (const l of listeners) l();
};

/** Where the words being linked are on screen; the middle of the window when there is no selection to measure. */
function selectionBox() {
  const sel = document.getSelection();
  const r = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
  if (r && (r.width || r.height)) return { left: r.left, top: r.top, bottom: r.bottom };
  return { left: window.innerWidth / 2 - 180, top: window.innerHeight / 3, bottom: window.innerHeight / 3 };
}

export function openLinkDialog() {
  set({ href: linkAt(), text: selectedText(), under: selectionBox() });
}

const VALID = /^(https?:\/\/\S+|mailto:\S+|#[A-Za-z][A-Za-z0-9_-]{0,63})$/;

/** "example.com" means https://example.com. */
const normalize = (s: string) => {
  const t = s.trim();
  if (!t || VALID.test(t)) return t;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(t)) return `mailto:${t}`;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t)) return `https://${t}`;
  return t;
};

interface Target {
  href: string;
  label: string;
  kind: "Tab" | "Heading";
}

/** Tabs and the current tab's headings, matching what follows the "/". */
function targets(query: string): Target[] {
  const s = getState();
  if (!s.doc) return [];
  const q = query.toLowerCase();
  const tabs = flattenTabs(s.doc.index.tabs).map((f) => ({ href: `#${f.ref.id}`, label: tabLabel(s.doc!.index.tabs, f.ref.id), kind: "Tab" as const }));
  const heads = outlineOf(s.tab ? s.doc.tabs.get(s.tab)?.tab : null).map((h) => ({ href: `#${h.id}`, label: h.text, kind: "Heading" as const }));
  return [...heads, ...tabs].filter((t) => t.label.toLowerCase().includes(q)).slice(0, 8);
}

/** What an internal link points at, in words. */
function describe(href: string): string | null {
  if (!href.startsWith("#")) return null;
  const t = targets("").find((x) => x.href === href);
  return t ? `${t.kind}: ${t.label}` : null;
}

export function LinkDialog() {
  const state = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => open,
  );
  return state ? <LinkCard key={`${state.under.left},${state.under.top},${state.href}`} state={state} /> : null;
}

const GAP = 8;

function LinkCard({ state }: { state: NonNullable<typeof open> }) {
  const card = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(state.text);
  const [value, setValue] = useState(state.href);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState({ left: Math.max(8, state.under.left), top: state.under.bottom + GAP });

  // Under the words, or above them when there's no room below; always inside the window.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = state.under.bottom + GAP;
    const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, state.under.top - h - GAP);
    setPos({ left: Math.max(8, Math.min(window.innerWidth - w - 8, state.under.left)), top });
  }, [state]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    input.current?.focus();
    const away = (e: MouseEvent) => !card.current?.contains(e.target as Node) && set(null);
    window.addEventListener("mousedown", away, true);
    return () => {
      window.removeEventListener("mousedown", away, true);
      if (prev?.isConnected) prev.focus({ preventScroll: true });
    };
  }, []);

  const picking = value.startsWith("/");
  const options = picking ? targets(value.slice(1)) : [];
  const url = picking ? "" : normalize(value);
  const ok = !picking && (url === "" || VALID.test(url));
  const close = () => set(null);
  const save = (href: string) => {
    close();
    setLink(href, text);
  };
  const choose = (t: Target) => {
    setValue(t.href);
    if (!text.trim()) setText(t.label);
  };
  return createPortal(
    <div
      ref={card}
      className="link-pop"
      role="dialog"
      aria-label={state.href ? "Edit link" : "Add link"}
      style={pos}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <form
        className="link-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (picking && options[active]) return choose(options[active]!);
          if (ok && url) save(url);
        }}
      >
        <label htmlFor="link-text">Text</label>
        <input id="link-text" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
        <label htmlFor="link-url">Link</label>
        <input
          ref={input}
          id="link-url"
          value={value}
          placeholder="Paste a link, or type / for a heading or tab"
          aria-invalid={!ok && !picking}
          role="combobox"
          aria-expanded={picking}
          aria-controls="link-targets"
          onChange={(e) => {
            setValue(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (!picking) return;
            if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(options.length - 1, a + 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
          }}
        />
        {picking && (
          <ul id="link-targets" className="link-targets" role="listbox">
            {options.length ? (
              options.map((t, i) => (
                <li key={t.href} role="option" aria-selected={i === active} className={i === active ? "on" : ""} onMouseDown={(e) => (e.preventDefault(), choose(t))} onMouseEnter={() => setActive(i)}>
                  <span className="link-kind">{t.kind}</span>
                  {t.label}
                </li>
              ))
            ) : (
              <li className="link-none">No heading or tab by that name</li>
            )}
          </ul>
        )}
        {!picking && describe(url) && <p className="link-note">{describe(url)}</p>}
        {!ok && !picking && <p className="link-error">Use a web address (https://…), an email address, or / for a heading or tab.</p>}
        <div className="link-actions">
          {state.href && (
            <button type="button" className="btn ghost link-remove" onClick={() => save("")}>
              Remove link
            </button>
          )}
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ok || !url}>
            Save
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
