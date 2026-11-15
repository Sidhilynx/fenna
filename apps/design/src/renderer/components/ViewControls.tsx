// Top of the canvas: the page menu at the left; at the right the play view,
// the properties panel and the zoom menu, with the reference's items.

import { useState } from "react";
import { Dialog, Icon, MenuButton, shortcut } from "@opendeck/shell";
import {
  addPage,
  deletePage,
  fitPage,
  fitSelection,
  pageBoards,
  redo,
  renamePage,
  selectedFile,
  setFocus,
  setPage,
  toggleGuides,
  togglePanel,
  undo,
  useDesign,
  zoomIn,
  zoomOut,
  zoomTo,
} from "../store.ts";

export function ViewControls() {
  const zoom = useDesign((s) => s.view.zoom);
  const panel = useDesign((s) => s.panel);
  const guides = useDesign((s) => s.guides);
  const hasSelection = useDesign((s) => !!s.selection);
  const canPlay = useDesign((s) => pageBoards(s).some((f) => s.boards.get(f)?.doc));
  const canUndo = useDesign((s) => s.undo.length > 0);
  const canRedo = useDesign((s) => s.redo.length > 0);
  const pct = Math.round(zoom * 100);

  return (
    <div className="dg-view" onPointerDown={(e) => e.stopPropagation()}>
      <div className="dg-pill">
        <button
          className="icon-btn"
          aria-label="Open the artboard on its own"
          title={`Play (${shortcut("Mod+Enter")})`}
          disabled={!canPlay}
          onClick={() => {
            const picked = selectedFile();
            setFocus(picked ?? pageBoards()[0] ?? null);
          }}
        >
          <Icon name="play" size={18} />
        </button>
        <button className="icon-btn" aria-pressed={panel === "properties"} aria-label="Properties" title="Properties" onClick={() => togglePanel("properties")}>
          <Icon name="sliders" size={18} />
        </button>
        <MenuButton
          className="btn ghost dg-zoom"
          label="Zoom"
          title="Zoom"
          align="end"
          entries={() => [
            { label: "Zoom in", shortcut: shortcut("Mod++"), onSelect: zoomIn },
            { label: "Zoom out", shortcut: shortcut("Mod+−"), onSelect: zoomOut },
            { label: "Fit artboards", shortcut: "Shift+1", onSelect: fitPage },
            { label: "Zoom to selection", shortcut: "Shift+2", disabled: !hasSelection, onSelect: fitSelection },
            "separator",
            { heading: `Now ${pct}%` },
            ...[25, 50, 75, 100, 150, 200].map((z) => ({ label: `${z}%`, checked: z === pct, onSelect: () => zoomTo(z / 100) })),
            "separator",
            { label: "Layout guides", shortcut: "Shift+G", checked: guides, onSelect: toggleGuides },
            "separator",
            { label: "Undo", shortcut: shortcut("Mod+Z"), disabled: !canUndo, onSelect: undo },
            { label: "Redo", shortcut: shortcut("Mod+Shift+Z"), disabled: !canRedo, onSelect: redo },
          ]}
        >
          {pct}%
          <Icon name="chevronDown" size={14} />
        </MenuButton>
      </div>
    </div>
  );
}

export function PagePill() {
  const pages = useDesign((s) => s.index.pages);
  const page = useDesign((s) => s.page);
  const count = useDesign((s) => pageBoards(s).length);
  const [renaming, setRenaming] = useState(false);
  const current = pages.find((p) => p.id === page) ?? pages[0]!;

  return (
    <div className="dg-pages" onPointerDown={(e) => e.stopPropagation()}>
      <MenuButton
        className="btn ghost dg-page-btn"
        label="Pages"
        title="Pages"
        entries={() => [
          ...pages.map((p) => ({ label: p.name, checked: p.id === current.id, onSelect: () => setPage(p.id) })),
          "separator",
          { label: "Rename page…", onSelect: () => setRenaming(true) },
          { label: "Delete page", danger: true, disabled: pages.length < 2, hint: pages.length < 2 ? "A design keeps one page" : count ? `With its ${count === 1 ? "artboard" : `${count} artboards`}` : undefined, onSelect: () => deletePage(current.id) },
          "separator",
          { label: "New page", icon: <Icon name="plus" size={16} />, onSelect: addPage },
        ]}
      >
        <span className="dg-page-name">{current.name}</span>
        <Icon name="chevronDown" size={14} />
      </MenuButton>
      {renaming && <NameDialog heading="Rename page" name={current.name} onClose={() => setRenaming(false)} onSave={(name) => renamePage(current.id, name)} />}
    </div>
  );
}

/** A dialog with one name to change. */
export function NameDialog({ heading, name, onClose, onSave }: { heading: string; name: string; onClose(): void; onSave(name: string): void }) {
  const [value, setValue] = useState(name);
  return (
    <Dialog title={heading} onClose={onClose} width={400}>
      <form
        className="dlg-form"
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
          onSave(value);
        }}
      >
        <label htmlFor="dg-name">Name</label>
        <input id="dg-name" data-autofocus value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} />
        <div className="dlg-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!value.trim()}>
            Rename
          </button>
        </div>
      </form>
    </Dialog>
  );
}
