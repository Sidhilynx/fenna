// Home: what a new tab shows, shared by every app on the shell. A sidebar
// (Home, Search, the app's documents and the recent list), a greeting, one
// place to start a document, and the latest documents as rows with a
// picture. After Arsaze's Home.
//
// The composer's words are only a draft for the new document's assistant:
// they wait in its composer and nothing runs until the user sends them there.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { updates, userName } from "./bridge.ts";
import { greeting, greetingName, relativeTime, shortAgo, titleFromDraft } from "./homeText.ts";
import { Icon } from "./ui/icons.tsx";
import "./home.css";

const RECENT_COUNT = 5;
const RECENT_SEARCH_COUNT = 10;
const SIDEBAR_RECENT = 8;

export interface HomeItem {
  /** The document's folder (its identity). */
  root: string;
  title: string;
  /** When it last changed (ms since epoch). */
  edited: number;
  /** A small picture of it (the app draws it), or null for its initial. */
  cover: ReactNode | null;
}

export interface HomeProps {
  /** What the app's documents are called: one and many ("deck", "decks"). */
  noun: string;
  nouns: string;
  /** Recently opened documents, newest first; null while loading. */
  items: HomeItem[] | null;
  /** Pick a folder to open. */
  onChoose(): void;
  /** Start a new document: a title from the draft (may be ""), and the draft for its assistant. */
  onStart(title: string, draft: string): Promise<void>;
  /** Open one of `items`, here or in a new tab. */
  onOpen(root: string, newTab: boolean): void;
  /** The composer's placeholder. */
  placeholder: string;
  /** More controls in the composer's bar (a theme for the new document, say). */
  composerExtra?: ReactNode;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function Home({ noun, nouns, items, onChoose, onStart, onOpen, placeholder, composerExtra }: HomeProps) {
  const [name, setName] = useState<string | null>(null);
  const [update, setUpdate] = useState<{ version: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hello = greeting(new Date().getHours());

  useEffect(() => {
    let alive = true;
    void userName()
      .then((n) => alive && setName(greetingName(n)))
      .catch(() => {});
    void updates
      .latest()
      .then((u) => alive && setUpdate(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onStart(titleFromDraft(draft), draft);
    } finally {
      setBusy(false);
    }
  };

  // N starts a document, / searches the recent ones. Never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        void start();
      } else if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const q = query.trim().toLowerCase();
  const all = items ?? [];
  const shown = q ? all.filter((d) => d.title.toLowerCase().includes(q)).slice(0, RECENT_SEARCH_COUNT) : showAll ? all : all.slice(0, RECENT_COUNT);
  const rows = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>(".hm-row") ?? []);
  const moveFocus = (e: React.KeyboardEvent, from: number) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = rows();
    const next = from + (e.key === "ArrowDown" ? 1 : -1);
    if (next < 0) search.current?.focus();
    else list[Math.min(next, list.length - 1)]?.focus();
  };
  const open = (e: React.MouseEvent | React.KeyboardEvent, root: string) => onOpen(root, e.ctrlKey || e.metaKey);

  return (
    <div className="hm">
      <aside className="hm-side" aria-label="App">
        <button type="button" className="hm-nav" aria-current="page">
          <Icon name="home" /> <span>Home</span>
        </button>
        <button type="button" className="hm-nav" onClick={() => search.current?.focus()} title="Search (/)">
          <Icon name="search" /> <span>Search</span>
        </button>
        <div className="hm-gap" />
        <div className="hm-nav-row">
          <button type="button" className="hm-nav" onClick={onChoose} title={`Open a ${noun} folder`}>
            <Icon name="folder" /> <span>{cap(nouns)}</span>
            {items !== null && <span className="hm-nav-n">{items.length}</span>}
          </button>
          <button type="button" className="hm-nav-add" onClick={() => void start()} aria-label={`New ${noun}`} title={`New ${noun} (N)`}>
            <Icon name="plus" />
          </button>
        </div>
        {all.length > 0 && (
          <>
            <button type="button" className="hm-sect" aria-expanded={recentOpen} onClick={() => setRecentOpen((o) => !o)}>
              Recent <Icon name="chevronDown" size={12} />
            </button>
            {recentOpen &&
              all.slice(0, SIDEBAR_RECENT).map((d) => (
                <button key={d.root} type="button" className="hm-rec" title={d.root} onClick={(e) => open(e, d.root)} onAuxClick={(e) => e.button === 1 && onOpen(d.root, true)}>
                  <span>{d.title}</span>
                  <span>{shortAgo(d.edited)}</span>
                </button>
              ))}
          </>
        )}
        {update && (
          <div className="hm-side-foot">
            <span className="hm-update">Version {update.version} is out</span>
            <button type="button" className="btn" onClick={() => void updates.open()}>
              Download
            </button>
          </div>
        )}
      </aside>

      <main className="hm-main">
        <div className="hm-in">
          <h1 className="hm-hello">{name ? `${hello}, ${name}` : hello}</h1>

          <section className="hm-start" aria-label={`New ${noun}`}>
            <div className="hm-composer">
              <textarea
                value={draft}
                rows={2}
                maxLength={4000}
                disabled={busy}
                className="hm-composer-in"
                placeholder={placeholder}
                aria-label={`${placeholder}. Optional`}
                onChange={(e) => {
                  setDraft(e.target.value);
                  e.currentTarget.style.height = "auto";
                  e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && draft.trim()) {
                    e.preventDefault();
                    void start();
                  }
                }}
              />
              <div className="hm-composer-bar">
                <div className="hm-composer-act">
                  <button type="button" className="hm-btn hm-btn-pri" disabled={busy} onClick={onChoose}>
                    Open folder
                  </button>
                  <button type="button" className="hm-btn" disabled={busy} onClick={() => void start()}>
                    <Icon name="plus" size={14} /> Start blank
                  </button>
                  {composerExtra}
                </div>
                <div className="hm-composer-end">
                  <span className="hm-hint">
                    <kbd>N</kbd> new {noun} <span aria-hidden>·</span> <kbd>/</kbd> search
                  </span>
                  {draft.trim() && (
                    <button type="button" className="hm-send" disabled={busy} onClick={() => void start()} title={`Start a ${noun} with this draft`} aria-label={`Start a ${noun} with this draft`}>
                      <Icon name="arrowUp" size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <p className="hm-start-foot">Drafts open in the editor. Nothing runs until you send it.</p>
          </section>

          {items && items.length > 0 && (
            <section className="hm-recent" aria-labelledby="hm-recent-title">
              <h2 id="hm-recent-title">Recent {nouns}</h2>
              <label className="hm-search">
                <Icon name="search" />
                <input
                  ref={search}
                  type="search"
                  value={query}
                  placeholder={`Search ${items.length} ${items.length === 1 ? noun : nouns}`}
                  aria-label={`Search ${nouns}`}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") moveFocus(e, -1);
                    else if (e.key === "Escape" && query) setQuery("");
                  }}
                />
              </label>
              <div className="hm-list" ref={listRef}>
                {shown.map((d, i) => (
                  <div
                    key={d.root}
                    className="hm-row"
                    role="link"
                    tabIndex={0}
                    title={d.root}
                    aria-label={`Open ${d.title}`}
                    onClick={(e) => open(e, d.root)}
                    onAuxClick={(e) => e.button === 1 && onOpen(d.root, true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") open(e, d.root);
                      else moveFocus(e, i);
                    }}
                  >
                    <span className="hm-cover">{d.cover ?? <span className="hm-cover-ini">{d.title.charAt(0).toUpperCase()}</span>}</span>
                    <span className="hm-row-nm">{d.title}</span>
                    <span className="hm-row-when">Edited {relativeTime(d.edited)}</span>
                  </div>
                ))}
                {q && shown.length === 0 && <p className="hm-none">No {nouns} match.</p>}
              </div>
              {!q && all.length > RECENT_COUNT && (
                <button type="button" className="hm-all" onClick={() => setShowAll((s) => !s)}>
                  {showAll ? `Fewer ${nouns}` : `All ${nouns}`}
                </button>
              )}
            </section>
          )}
          {items && items.length === 0 && <p className="hm-line">{cap(nouns)} you open appear here.</p>}
        </div>
      </main>
    </div>
  );
}
