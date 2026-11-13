import { useEffect, useState } from "react";
import { SHAPE_KINDS } from "@opendeck/format";
import { Dialog, Icon, type IconName, type MenuEntry, MenuButton, Toast, shortcut, tabs } from "@opendeck/shell";
import { Canvas } from "./editor/Canvas.tsx";
import * as cmd from "./editor/commands.ts";
import { loadComments, newComment } from "./editor/comments.ts";
import { SHAPE_KEYS, useShortcuts, zoomStep } from "./editor/shortcuts.ts";
import { boot, editIndex, goTo, redo, setState, setView, togglePanel, undo, useEditor } from "./editor/store.ts";
import { Present } from "./Present.tsx";
import { SlideStrip } from "./SlideStrip.tsx";
import { useSlideStyles } from "./SlideView.tsx";
import { AssistantPanel } from "./panels/AssistantPanel.tsx";
import { ExportMenu } from "./panels/ExportMenu.tsx";
import { GridView } from "./panels/GridView.tsx";
import { Inspector } from "./panels/Inspector.tsx";
import { NewSlideDialog } from "./panels/NewSlideDialog.tsx";
import { COMMENT_SHORTCUT } from "./panels/CommentLayer.tsx";
import { Home } from "./panels/Home.tsx";

const SHAPES: Record<string, { label: string; icon: IconName }> = {
  rect: { label: "Rectangle", icon: "shapeRect" },
  rounded: { label: "Rounded rectangle", icon: "shapeRounded" },
  ellipse: { label: "Ellipse", icon: "shapeEllipse" },
  diamond: { label: "Diamond", icon: "shapeDiamond" },
  triangle: { label: "Triangle", icon: "shapeTriangle" },
  "arrow-right": { label: "Arrow right", icon: "shapeArrowRight" },
  "arrow-left": { label: "Arrow left", icon: "shapeArrowLeft" },
  "arrow-up": { label: "Arrow up", icon: "shapeArrowUp" },
  "arrow-down": { label: "Arrow down", icon: "shapeArrowDown" },
  line: { label: "Line", icon: "shapeLine" },
};

/** The shape menu: every kind the format has, lines after a rule. */
function shapeEntries(): MenuEntry[] {
  const entry = (k: string): MenuEntry => ({
    label: SHAPES[k]?.label ?? k,
    icon: <Icon name={SHAPES[k]?.icon ?? "shapes"} size={16} />,
    shortcut: SHAPE_KEYS[k],
    onSelect: () => void cmd.insertShape(k),
  });
  const lines = SHAPE_KINDS.filter((k) => k === "line");
  return [...SHAPE_KINDS.filter((k) => k !== "line").map(entry), ...(lines.length ? ["separator" as const, ...lines.map(entry)] : [])];
}

export function App() {
  const ref = useEditor((s) => s.ref);
  const deck = useEditor((s) => s.deck);
  const loading = useEditor((s) => s.loading);
  const presenting = useEditor((s) => s.presenting);
  const current = useEditor((s) => s.current);
  const view = useEditor((s) => s.view);
  const rightPanel = useEditor((s) => (s.chat ? "chat" : s.inspector ? "design" : null));
  const canUndo = useEditor((s) => s.undo.length > 0);
  const canRedo = useEditor((s) => s.redo.length > 0);
  const undoLabel = useEditor((s) => s.undo[s.undo.length - 1]?.label);
  const redoLabel = useEditor((s) => s.redo[s.redo.length - 1]?.label);
  const [newSlide, setNewSlide] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // The grid shows every slide itself, so the strip steps aside there.
  const strip = useEditor((s) => s.thumbnails && s.view === "edit");
  useSlideStyles(deck?.index.theme ?? null);
  useShortcuts();

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    void loadComments(ref?.root ?? null);
  }, [ref?.root]);

  // The tab in the window's strip carries the deck's title.
  const title = deck?.index.title ?? ref?.name ?? "";
  useEffect(() => {
    if (title) tabs.meta({ title });
  }, [title]);

  if (presenting && deck) return <Present deck={deck} start={current} onExit={(at) => (setState({ presenting: false }), goTo(at))} />;
  if (!loading && (!ref || !deck)) return <Home />;

  const count = deck?.slides.length ?? 0;
  return (
    <div className="app">
      <header className="topbar">
        {deck ? (
          <MenuButton
            className="btn ghost title-btn"
            label="Deck"
            entries={() => [
              { label: "Rename…", onSelect: () => setRenaming(true) },
              "separator",
              { label: "Undo", shortcut: shortcut("Mod+Z"), disabled: !canUndo, onSelect: () => void undo() },
              { label: "Redo", shortcut: shortcut("Mod+Shift+Z"), disabled: !canRedo, onSelect: () => void redo() },
            ]}
          >
            <span className="title" title={ref?.root}>
              {title}
            </span>
            <Icon name="chevronDown" size={14} />
          </MenuButton>
        ) : (
          <div className="title">{title}</div>
        )}
        {deck && (
          <div className="topbar-group">
            <button className="icon-btn" disabled={!canUndo} onClick={() => void undo()} title={`Undo${undoLabel ? ` ${undoLabel.toLowerCase()}` : ""} (${shortcut("Mod+Z")})`} aria-label="Undo">
              <Icon name="undo" />
            </button>
            <button className="icon-btn" disabled={!canRedo} onClick={() => void redo()} title={`Redo${redoLabel ? ` ${redoLabel.toLowerCase()}` : ""} (${shortcut("Mod+Shift+Z")})`} aria-label="Redo">
              <Icon name="redo" />
            </button>
          </div>
        )}
        {deck && (
          <div className="topbar-actions">
            <button className={`btn ghost${rightPanel === "chat" ? " on" : ""}`} aria-pressed={rightPanel === "chat"} onClick={() => togglePanel("chat")}>
              <Icon name="panelRight" size={16} /> {rightPanel === "chat" ? "Hide chat" : "Show chat"}
            </button>
          </div>
        )}
      </header>

      {loading || !deck ? (
        <main className="app-loading">
          <div className="skel-strip">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skel-thumb"><div className="skel-shimmer" style={{ animationDelay: `${i * 0.2}s` }} /></div>
            ))}
          </div>
          <div className="skel-stage">
            <div className="skel-card"><div className="skel-shimmer" /></div>
          </div>
        </main>
      ) : (
        <main className={`workspace${strip ? "" : " no-strip"}${rightPanel ? " with-panel" : ""}${rightPanel === "chat" ? " with-chat" : ""}`}>
          {strip && (
            <aside className="left">
              <div className="left-head">
                <SlideTools onAddSlide={() => setNewSlide(true)} />
              </div>
              <SlideStrip onAddSlide={() => setNewSlide(true)} />
            </aside>
          )}

          <section className="center">
            {!strip && (
              <div className="stage-left-tools">
                <SlideTools onAddSlide={() => setNewSlide(true)} />
              </div>
            )}
            {deck.problems.length > 0 && <div className="deck-problems">{deck.problems[0]}</div>}
            {view === "grid" ? (
              <>
                <GridView />
                <StageTools />
              </>
            ) : count ? (
              <>
                <Canvas />
                <StageTools />
                <InsertBar />
              </>
            ) : (
              <div className="empty">
                <p>This deck has no slides yet.</p>
                <button className="btn primary" onClick={() => setNewSlide(true)}>
                  Add a slide
                </button>
              </div>
            )}
          </section>

          {rightPanel === "design" && <Inspector />}
          {rightPanel === "chat" && <AssistantPanel />}
        </main>
      )}
      {newSlide && <NewSlideDialog onClose={() => setNewSlide(false)} />}
      {renaming && <RenameDeck title={title} onClose={() => setRenaming(false)} />}
      <Toast />
    </div>
  );
}

/** Add slide and the View menu: over the strip, or floating on the stage when the strip is hidden. */
function SlideTools({ onAddSlide }: { onAddSlide(): void }) {
  const view = useEditor((s) => s.view);
  const design = useEditor((s) => s.inspector && !s.chat);
  const thumbnails = useEditor((s) => s.thumbnails);
  const notes = useEditor((s) => s.notes);
  return (
    <>
      <button className="btn ghost" onClick={onAddSlide} title={`New slide (${shortcut("Mod+Shift+N")})`}>
        <Icon name="plus" /> Add slide
      </button>
      <MenuButton
        className="btn ghost"
        label="View"
        entries={() => [
          { label: "One slide", checked: view === "edit", onSelect: () => setView("edit") },
          { label: "Grid", checked: view === "grid", shortcut: shortcut("Mod+Alt+G"), onSelect: () => setView("grid") },
          "separator",
          { label: "Slide thumbnails", checked: thumbnails, onSelect: () => (setView("edit"), togglePanel("thumbnails", !thumbnails)) },
          { label: "Speaker notes", checked: notes, onSelect: () => (setView("edit"), togglePanel("notes", !notes)) },
          { label: "Design panel", checked: design, onSelect: () => (togglePanel("chat", false), togglePanel("inspector", !design)) },
        ]}
      >
        View <Icon name="chevronDown" size={14} />
      </MenuButton>
    </>
  );
}

function RenameDeck({ title, onClose }: { title: string; onClose(): void }) {
  const [value, setValue] = useState(title);
  return (
    <Dialog title="Rename deck" onClose={onClose} width={400}>
      <form
        className="rename-form"
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
          const name = value.trim().slice(0, 200);
          if (name && name !== title) void editIndex("Rename deck", (i) => ({ ...i, title: name }));
        }}
      >
        <label htmlFor="deck-name">Name</label>
        <input id="deck-name" data-autofocus value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} />
        <div className="rename-actions">
          <button type="submit" className="btn primary" disabled={!value.trim()}>
            Rename
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Export, Present, the Design panel toggle and zoom, floating at the stage's top right. */
function StageTools() {
  const zoom = useEditor((s) => s.zoom);
  const fit = useEditor((s) => s.fitScale);
  const design = useEditor((s) => s.inspector && !s.chat);
  const view = useEditor((s) => s.view);
  const count = useEditor((s) => s.deck?.slides.length ?? 0);
  const pct = Math.round((zoom === "fit" ? fit : zoom) * 100);
  return (
    <div className="stage-tools" role="toolbar" aria-label="Deck">
      <ExportMenu />
      <button className="icon-btn" disabled={!count} onClick={() => setState({ presenting: true })} title="Present (F5)" aria-label="Present">
        <Icon name="play" />
      </button>
      <button className="icon-btn" aria-pressed={design} onClick={() => (togglePanel("chat", false), togglePanel("inspector", !design))} title="Design panel" aria-label="Design panel">
        <Icon name="sliders" />
      </button>
      {view === "edit" && (
        <MenuButton
          className="btn ghost zoom-btn"
          label="Zoom"
          align="end"
          entries={() => [
            { label: "Zoom in", shortcut: shortcut("Mod+="), onSelect: () => zoomStep(1) },
            { label: "Zoom out", shortcut: shortcut("Mod+-"), onSelect: () => zoomStep(-1) },
            { label: "Fit the slide", shortcut: shortcut("Mod+0"), checked: zoom === "fit", onSelect: () => setState({ zoom: "fit" }) },
            "separator",
            ...[0.5, 0.75, 1, 1.5, 2].map((z) => ({ label: `${z * 100}%`, checked: zoom === z, onSelect: () => setState({ zoom: z }) })),
          ]}
        >
          {pct}% <Icon name="chevronDown" size={14} />
        </MenuButton>
      )}
    </div>
  );
}

/** Add text, images, tables, shapes and comments. */
function InsertBar() {
  return (
    <div className="insert-bar" role="toolbar" aria-label="Insert">
      <button className="icon-btn" onClick={() => void cmd.insertText()} title="Text" aria-label="Add text">
        <Icon name="text" />
      </button>
      <button className="icon-btn" onClick={() => void cmd.insertImages()} title="Image" aria-label="Add image">
        <Icon name="image" />
      </button>
      <button className="icon-btn" onClick={() => void cmd.insertTable()} title="Table" aria-label="Add table">
        <Icon name="table" />
      </button>
      <MenuButton className="icon-btn wide" label="Add shape" title="Shape" entries={shapeEntries}>
        <Icon name="shapes" />
        <Icon name="chevronDown" size={12} />
      </MenuButton>
      <span className="insert-sep" aria-hidden />
      <button className="icon-btn" onClick={newComment} title={`Comment (${COMMENT_SHORTCUT})`} aria-label="Add comment">
        <Icon name="chat" />
      </button>
    </div>
  );
}
