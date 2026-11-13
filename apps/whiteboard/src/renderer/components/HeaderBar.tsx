// The header: the board's name and its menu, Export, and the chat.

import { useEffect, useState } from "react";
import { ago, Dialog, ExportButton, Icon, MenuButton, shortcut, type ExportFormat } from "@opendeck/shell";
import { exportBoard, type ExportKind } from "../export.ts";
import { duplicateBoard, redo, reload, renameBoard, setPanel, togglePanel, undo, useBoard } from "../store.ts";

const FORMATS: ExportFormat<ExportKind>[] = [
  { kind: "png", icon: "image", name: "PNG", hint: "A picture of the whole board, sharp at twice the size" },
  { kind: "svg", icon: "shapes", name: "SVG", hint: "The whole board as vectors, for design tools and print" },
];

function edited(at: number): string {
  const a = ago(at);
  return a === "now" ? "edited just now" : /^\d+[mh]$/.test(a) ? `edited ${a} ago` : `edited ${a}`;
}

export function HeaderBar() {
  const title = useBoard((s) => s.meta?.title ?? s.ref?.name ?? "Untitled board");
  const panel = useBoard((s) => s.panel);
  const canUndo = useBoard((s) => s.undo.length > 0);
  const canRedo = useBoard((s) => s.redo.length > 0);
  const lastAt = useBoard((s) => s.history[0]?.at ?? null);
  const empty = useBoard((s) => s.items.length === 0);
  const [renaming, setRenaming] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <header className="wb-top">
      <MenuButton
        className="btn ghost wb-title"
        label="Board"
        entries={() => [
          { heading: lastAt ? `Saved on this computer · ${edited(lastAt)}` : "Saved on this computer" },
          { label: "Open chat", icon: <Icon name="chat" size={16} />, onSelect: () => setPanel("chat") },
          { label: "Comments", icon: <Icon name="chat" size={16} />, onSelect: () => setPanel("comments") },
          { label: "Version history", icon: <Icon name="history" size={16} />, onSelect: () => setPanel("history") },
          "separator",
          { label: "Rename…", icon: <Icon name="pencil" size={16} />, onSelect: () => setRenaming(true) },
          { label: "Duplicate", icon: <Icon name="copy" size={16} />, onSelect: () => void duplicateBoard() },
          { label: "Refresh", icon: <Icon name="refresh" size={16} />, onSelect: () => void reload() },
          "separator",
          { label: "Undo", shortcut: shortcut("Mod+Z"), disabled: !canUndo, onSelect: undo },
          { label: "Redo", shortcut: shortcut("Mod+Shift+Z"), disabled: !canRedo, onSelect: redo },
        ]}
      >
        <span className="wb-title-text">{title}</span>
        <Icon name="chevronDown" size={14} />
      </MenuButton>
      <span className="wb-fill" />
      <ExportButton
        title={title}
        note={empty ? "The board is empty; an export would be a blank picture." : "Save a copy to send or open elsewhere. The board itself stays a folder on this computer."}
        formats={FORMATS}
        onExport={(k) => void exportBoard(k)}
      />
      <button className={`btn ghost${panel === "chat" ? " on" : ""}`} aria-pressed={panel === "chat"} onClick={() => togglePanel("chat")} title="Chat">
        <Icon name="panelRight" size={16} /> {panel === "chat" ? "Hide chat" : "Show chat"}
      </button>
      {renaming && <RenameDialog title={title} onClose={() => setRenaming(false)} />}
    </header>
  );
}

function RenameDialog({ title, onClose }: { title: string; onClose(): void }) {
  const [value, setValue] = useState(title);
  return (
    <Dialog title="Rename board" onClose={onClose} width={400}>
      <form
        className="dlg-form"
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
          renameBoard(value);
        }}
      >
        <label htmlFor="wb-name">Name</label>
        <input id="wb-name" data-autofocus value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} />
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
