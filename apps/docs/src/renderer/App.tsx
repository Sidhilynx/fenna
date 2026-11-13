import { useEffect, useState } from "react";
import { flattenTabs, tabLabel } from "@opendeck/doc";
import { Dialog, Icon, MenuButton, Toast, shortcut, tabs } from "@opendeck/shell";
import { Page } from "./Page.tsx";
import { loadComments } from "./editor/comments.ts";
import { AssistantPanel } from "./panels/AssistantPanel.tsx";
import { CommentsPanel } from "./panels/CommentsPanel.tsx";
import { ExportMenu } from "./panels/ExportMenu.tsx";
import { Home } from "./panels/Home.tsx";
import { LinkDialog } from "./panels/LinkDialog.tsx";
import { ModeMenu } from "./panels/ModeMenu.tsx";
import { Sidebar, outlineOf, scrollToBlock } from "./panels/Sidebar.tsx";
import { Toolbar } from "./panels/Toolbar.tsx";
import { boot, getState, goToTab, redo, renameDoc, togglePanel, undo, useDocs } from "./store.ts";

export function App() {
  const ref = useDocs((s) => s.ref);
  const doc = useDocs((s) => s.doc);
  const loading = useDocs((s) => s.loading);
  const sidebar = useDocs((s) => s.sidebar);
  const chat = useDocs((s) => s.chat);
  const comments = useDocs((s) => s.comments);
  const canUndo = useDocs((s) => s.undo.length > 0);
  const canRedo = useDocs((s) => s.redo.length > 0);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => void boot(), []);
  useEffect(() => void loadComments(ref?.root ?? null), [ref?.root]);

  // Undo and redo from anywhere in the window (after accepting a suggestion, say), not only from inside the text.
  // Text fields and the page keep their own: the page's handler runs first and takes the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable='true']")) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      e.preventDefault();
      void (k === "y" || e.shiftKey ? redo() : undo());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const title = doc?.index.title ?? ref?.name ?? "";
  useEffect(() => {
    if (title) tabs.meta({ title });
  }, [title]);

  if (!loading && (!ref || !doc)) return <Home />;

  return (
    <div className="docs">
      <header className="dt-top">
        <button className="icon-btn" aria-pressed={sidebar} onClick={() => togglePanel("sidebar")} title="Tabs" aria-label="Show tabs">
          <Icon name="sidebar" />
        </button>
        <MenuButton
          className="btn ghost dt-title"
          label="Doc"
          entries={() => [
            { label: "Rename…", onSelect: () => setRenaming(true) },
            "separator",
            { label: "Undo", shortcut: shortcut("Mod+Z"), disabled: !canUndo, onSelect: () => void undo() },
            { label: "Redo", shortcut: shortcut("Mod+Shift+Z"), disabled: !canRedo, onSelect: () => void redo() },
          ]}
        >
          <span className="dt-title-text">{title}</span> <Icon name="chevronDown" size={14} />
        </MenuButton>
        <span className="dt-fill" />
        {doc && <ExportMenu />}
        <button className={`btn ghost${chat ? " on" : ""}`} aria-pressed={chat} onClick={() => togglePanel("chat")}>
          <Icon name="panelRight" size={16} /> {chat ? "Hide chat" : "Show chat"}
        </button>
      </header>
      {loading || !doc ? (
        <main className="dt-loading" aria-busy />
      ) : (
        <main className={`dt-main${chat || comments ? " with-chat" : ""}`}>
          {sidebar && <Sidebar />}
          <section className="dt-stage">
            <div className="dt-float">
              {!sidebar ? <OutlineButton /> : <span />}
              <ModeMenu />
            </div>
            {doc.problems.length > 0 && <div className="dp-problem">{doc.problems[0]}</div>}
            <Page />
            <Toolbar />
          </section>
          {chat && <AssistantPanel />}
          {comments && <CommentsPanel />}
        </main>
      )}
      {renaming && <RenameDoc title={title} onClose={() => setRenaming(false)} />}
      <LinkDialog />
      <Toast />
    </div>
  );
}

/** With the tab list hidden: the tab's name, opening a menu of tabs and headings. */
function OutlineButton() {
  const tab = useDocs((s) => s.tab);
  const name = useDocs((s) => (s.doc && s.tab ? tabLabel(s.doc.index.tabs, s.tab) : ""));
  return (
    <MenuButton
      className="btn dt-outline"
      label="Tabs and headings"
      entries={() => {
        const s = getState();
        if (!s.doc) return [];
        const flat = flattenTabs(s.doc.index.tabs);
        const heads = outlineOf(s.tab ? s.doc.tabs.get(s.tab)?.tab : null);
        return [
          { heading: "Tabs" },
          ...flat.map((f) => ({ label: `${"  ".repeat(f.depth)}${tabLabel(s.doc!.index.tabs, f.ref.id)}`, checked: f.ref.id === tab, onSelect: () => void goToTab(f.ref.id) })),
          ...(heads.length ? ["separator" as const, { heading: "Headings" }, ...heads.map((h) => ({ label: `${"  ".repeat(h.level - 1)}${h.text}`, onSelect: () => scrollToBlock(h.id) }))] : []),
        ];
      }}
    >
      <Icon name="outline" size={16} /> {name} <Icon name="chevronDown" size={14} />
    </MenuButton>
  );
}

function RenameDoc({ title, onClose }: { title: string; onClose(): void }) {
  const [value, setValue] = useState(title);
  return (
    <Dialog title="Rename doc" onClose={onClose} width={400}>
      <form
        className="dd-form"
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
          void renameDoc(value);
        }}
      >
        <label htmlFor="doc-name">Name</label>
        <input id="doc-name" data-autofocus value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} />
        <div className="link-actions">
          <button type="submit" className="btn primary" disabled={!value.trim()}>
            Rename
          </button>
        </div>
      </form>
    </Dialog>
  );
}
