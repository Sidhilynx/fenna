// Fenna Workspace Home: unified landing page for Slides, Docs, Sheets,
// Whiteboard, and Design.

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName, McpGuideDialog, userName } from "@opendeck/shell";
import { type ProductKind, type WorkspaceProduct, type WorkspaceRecentDoc, api } from "./api.ts";
import "./styles.css";

const PRODUCTS: { id: ProductKind; name: string; kindName: string; icon: IconName; noun: string; nouns: string; placeholder: string; desc: string }[] = [
  { id: "deck", name: "Fenna Slides", kindName: "Deck", icon: "deck", noun: "deck", nouns: "decks", placeholder: "What should we present? Describe the deck, or start blank", desc: "Slides that live on your computer and work with any AI." },
  { id: "doc", name: "Fenna Docs", kindName: "Doc", icon: "doc", noun: "document", nouns: "documents", placeholder: "What should we write? Describe the doc, or start blank", desc: "Documents that live on your computer and work with any AI." },
  { id: "sheet", name: "Fenna Sheets", kindName: "Sheet", icon: "sheet", noun: "workbook", nouns: "workbooks", placeholder: "What should we calculate? Describe the sheet, or start blank", desc: "Spreadsheets that live on your computer and work with any AI." },
  { id: "board", name: "Fenna Whiteboard", kindName: "Whiteboard", icon: "board", noun: "whiteboard", nouns: "whiteboards", placeholder: "What should we map? Describe the board, or start blank", desc: "A whiteboard that lives on your computer and works with any AI." },
  { id: "design", name: "Fenna Design", kindName: "Design", icon: "design", noun: "design", nouns: "designs", placeholder: "What should we design? Describe the artboards, or start blank", desc: "A design canvas of artboards that lives on your computer." },
];

function greeting(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function greetingName(account: string): string | null {
  const word = account.trim().split(/\s+/)[0] ?? "";
  if (!word) return null;
  const camel = word.match(/^[A-Z][a-z]+(?=[A-Z])/);
  const name = camel ? camel[0] : word;
  return /[\d_@.]/.test(name) || name.length < 2 ? null : name.charAt(0).toUpperCase() + name.slice(1);
}

function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 7) return d === 1 ? "yesterday" : `${d}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function shortAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 604800)}w`;
}

export function App() {
  const [selectedProduct, setSelectedProduct] = useState<ProductKind | "all">("all");
  const [recent, setRecent] = useState<WorkspaceRecentDoc[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
  const [themeMode, setThemeMode] = useState<"dark" | "light" | "system">("system");
  const searchInput = useRef<HTMLInputElement>(null);

  const loadRecent = async () => {
    try {
      const list = await api.recent();
      setRecent(list);
    } catch {
      setRecent([]);
    }
  };

  useEffect(() => {
    void loadRecent();
    void userName().then((n) => setName(greetingName(n))).catch(() => {});
    void api.getTheme().then((t) => setThemeMode(t.mode)).catch(() => {});
  }, []);

  const currentProductDef = PRODUCTS.find((p) => p.id === selectedProduct) ?? null;

  const filteredDocs = useMemo(() => {
    let list = recent;
    if (selectedProduct !== "all") {
      list = list.filter((d) => d.product === selectedProduct);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((d) => d.title.toLowerCase().includes(q) || d.productName.toLowerCase().includes(q));
    }
    return list;
  }, [recent, selectedProduct, query]);

  const productCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of PRODUCTS) map[p.id] = 0;
    for (const d of recent) {
      map[d.product] = (map[d.product] ?? 0) + 1;
    }
    return map;
  }, [recent]);

  const handleStart = async (kind: ProductKind) => {
    if (busy) return;
    setBusy(true);
    try {
      const title = draft.trim().slice(0, 48);
      await api.create(kind, title, draft);
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = (root: string, inNewTab: boolean) => {
    if (inNewTab) void api.openInTab(root);
    else void api.open(root);
  };

  const handleChoose = async (kind?: ProductKind) => {
    await api.choose(kind);
  };

  const handleToggleTheme = async () => {
    const next = themeMode === "dark" ? "light" : themeMode === "light" ? "system" : "dark";
    setThemeMode(next);
    try {
      const res = await api.setTheme(next);
      document.documentElement.dataset.theme = res.dark ? "dark" : "light";
    } catch {}
  };

  // Global keyboard shortcuts: / to search, N to start new
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (e.metaKey || e.ctrlKey || e.altKey || isInput) return;
      if (e.key === "/") {
        e.preventDefault();
        searchInput.current?.focus();
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        const targetKind = selectedProduct === "all" ? "deck" : selectedProduct;
        void handleStart(targetKind);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedProduct, draft, busy]);

  return (
    <div className="ws-home">
      {/* Sidebar */}
      <aside className="ws-side" aria-label="Fenna Workspace Navigation">
        <button
          type="button"
          className={`ws-nav ${selectedProduct === "all" ? "ws-nav-active" : ""}`}
          onClick={() => setSelectedProduct("all")}
          aria-current={selectedProduct === "all" ? "page" : undefined}
        >
          <Icon name="home" /> <span>Home</span>
        </button>

        <button type="button" className="ws-nav" onClick={() => searchInput.current?.focus()} title="Search (/)">
          <Icon name="search" /> <span>Search</span>
        </button>

        <button type="button" className="ws-nav" onClick={() => setShowMcp(true)} title="MCP setup guide">
          <Icon name="code" /> <span>MCP Setup</span>
        </button>

        <div className="ws-side-divider" />
        <div className="ws-side-label">PRODUCTS</div>

        {PRODUCTS.map((prod) => {
          const isActive = selectedProduct === prod.id;
          const count = productCounts[prod.id] || 0;
          return (
            <div key={prod.id} className="ws-product-nav-row">
              <button
                type="button"
                className={`ws-nav ${isActive ? "ws-nav-active" : ""}`}
                onClick={() => setSelectedProduct(prod.id)}
                aria-current={isActive ? "page" : undefined}
                title={prod.desc}
              >
                <Icon name={prod.icon} />
                <span className="ws-nav-title">{prod.name}</span>
                {count > 0 && <span className="ws-nav-count">{count}</span>}
              </button>
              <button
                type="button"
                className="ws-nav-add"
                onClick={() => void handleStart(prod.id)}
                aria-label={`New ${prod.noun}`}
                title={`New ${prod.noun}`}
              >
                <Icon name="plus" size={14} />
              </button>
            </div>
          );
        })}

        {recent.length > 0 && (
          <>
            <div className="ws-side-divider" />
            <button
              type="button"
              className="ws-sect-toggle"
              aria-expanded={recentOpen}
              onClick={() => setRecentOpen((o) => !o)}
            >
              <span>Recent</span>
              <Icon name="chevronDown" size={12} />
            </button>
            {recentOpen && (
              <div className="ws-recent-side-list">
                {recent.slice(0, 8).map((d) => (
                  <button
                    key={d.root}
                    type="button"
                    className="ws-side-item"
                    onClick={(e) => handleOpen(d.root, e.ctrlKey || e.metaKey)}
                    title={`${d.title} (${d.productName})\n${d.root}`}
                  >
                    <Icon name={d.product as IconName} size={14} />
                    <span className="ws-side-item-title">{d.title}</span>
                    <span className="ws-side-item-time">{shortAgo(d.edited)}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <div className="ws-side-spacer" />
        <div className="ws-side-divider" />
        <button
          type="button"
          className="ws-nav ws-theme-nav"
          onClick={handleToggleTheme}
          title={`Switch theme (current: ${themeMode})`}
          aria-label={`Toggle theme: ${themeMode}`}
        >
          <Icon name={themeMode === "dark" ? "moon" : themeMode === "light" ? "sun" : "viewport"} size={16} />
          <span className="ws-nav-title">Theme: {themeMode.charAt(0).toUpperCase() + themeMode.slice(1)}</span>
        </button>
      </aside>

      {/* Main Content Area */}
      <main className="ws-main" role="main">
        <header className="ws-header">
          {selectedProduct === "all" ? (
            <div className="ws-greeting-block">
              <h1 className="ws-greeting">
                {greeting(new Date().getHours())}{name ? `, ${name}` : ""}
              </h1>
              <p className="ws-subtitle">Unified workspace for Slides, Docs, Sheets, Whiteboard, and Design.</p>
            </div>
          ) : (
            <div className="ws-product-hero">
              <div className="ws-product-badge">
                <Icon name={currentProductDef?.icon || "doc"} size={22} />
                <h2>{currentProductDef?.name}</h2>
              </div>
              <p className="ws-subtitle">{currentProductDef?.desc}</p>
              <div className="ws-hero-actions">
                <button
                  type="button"
                  className="ws-btn ws-btn-primary"
                  onClick={() => void handleStart(selectedProduct)}
                  disabled={busy}
                >
                  <Icon name="plus" size={14} /> <span>New {currentProductDef?.kindName}</span>
                </button>
                <button
                  type="button"
                  className="ws-btn ws-btn-secondary"
                  onClick={() => void handleChoose(selectedProduct)}
                >
                  <Icon name="folder" size={14} /> <span>Open {currentProductDef?.noun} folder</span>
                </button>
              </div>
            </div>
          )}
        </header>

        {/* Universal Composer Bar (when on Home/All) */}
        {selectedProduct === "all" && (
          <section className="ws-composer-section">
            <div className="ws-composer-box">
              <textarea
                className="ws-composer-input"
                rows={2}
                placeholder="What should we create? Describe a deck, doc, sheet, board, or design..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void handleStart("deck");
                  }
                }}
              />
              <div className="ws-composer-footer">
                <div className="ws-product-pills" role="radiogroup" aria-label="Target format">
                  {PRODUCTS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="ws-pill-btn"
                      onClick={() => void handleStart(p.id)}
                      title={`Create a new ${p.name}`}
                    >
                      <Icon name={p.icon} size={13} />
                      <span>{p.kindName}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="ws-btn ws-btn-secondary"
                  onClick={() => void handleChoose()}
                  title="Open existing document folder"
                >
                  <Icon name="folder" size={14} /> <span>Open Folder</span>
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Recent Documents Table */}
        <section className="ws-docs-section">
          <div className="ws-docs-header">
            <h3>{selectedProduct === "all" ? "Recent documents" : `Recent ${currentProductDef?.nouns}`}</h3>
            <div className="ws-search-wrapper">
              <Icon name="search" size={14} />
              <input
                ref={searchInput}
                type="text"
                className="ws-search-field"
                placeholder="Filter files (/)…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button type="button" className="ws-search-clear" onClick={() => setQuery("")} aria-label="Clear filter">
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="ws-docs-list" role="list">
            {filteredDocs.length === 0 ? (
              <div className="ws-empty-state">
                <p>No documents found{query ? ` matching "${query}"` : ""}.</p>
                <div className="ws-empty-actions">
                  <button
                    type="button"
                    className="ws-btn ws-btn-primary"
                    onClick={() => void handleStart(selectedProduct === "all" ? "deck" : selectedProduct)}
                  >
                    Start new {selectedProduct === "all" ? "deck" : currentProductDef?.noun}
                  </button>
                  <button
                    type="button"
                    className="ws-btn ws-btn-secondary"
                    onClick={() => void handleChoose(selectedProduct === "all" ? undefined : selectedProduct)}
                  >
                    Open folder
                  </button>
                </div>
              </div>
            ) : (
              filteredDocs.map((doc) => (
                <div
                  key={doc.root}
                  className="ws-doc-row"
                  role="listitem"
                  tabIndex={0}
                  onClick={(e) => handleOpen(doc.root, e.ctrlKey || e.metaKey)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleOpen(doc.root, e.ctrlKey || e.metaKey);
                  }}
                  title={`${doc.title}\n${doc.root}`}
                >
                  <div className="ws-row-icon">
                    <Icon name={doc.product as IconName} size={18} />
                  </div>
                  <div className="ws-row-main">
                    <span className="ws-row-title">{doc.title}</span>
                    <span className="ws-row-path">{doc.root}</span>
                  </div>
                  <div className="ws-row-meta">
                    <span className="ws-product-tag">{doc.productName}</span>
                    <span className="ws-row-time">{relativeTime(doc.edited)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {showMcp && <McpGuideDialog open={showMcp} onClose={() => setShowMcp(false)} noun="workspace" />}
    </div>
  );
}
