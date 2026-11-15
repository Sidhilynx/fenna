// The header: the design's name and its menu, Export, and the chat.

import { useEffect, useState } from "react";
import { ago, ExportButton, Icon, MenuButton, shortcut, type ExportFormat } from "@opendeck/shell";
import { exportDesign, exportTarget, type ExportKind } from "../export.ts";
import { duplicateDesign, pageBoards, redo, reload, renameDesign, setPanel, togglePanel, undo, useDesign } from "../store.ts";
import { NameDialog } from "./ViewControls.tsx";

const FORMATS: ExportFormat<ExportKind>[] = [
  { kind: "html", icon: "code", name: "HTML", hint: "The selected artboard as one web page, its images inside" },
  { kind: "pdf", icon: "doc", name: "PDF", hint: "Every artboard on this page, one sheet each at its own size" },
  { kind: "png", icon: "image", name: "PNG", hint: "The selected artboard as a picture, sharp at twice the size" },
];

function edited(at: number): string {
  const a = ago(at);
  return a === "now" ? "edited just now" : /^\d+[mh]$/.test(a) ? `edited ${a} ago` : `edited ${a}`;
}

export function HeaderBar() {
  const title = useDesign((s) => (s.ready ? s.index.title : (s.ref?.name ?? "Untitled design")));
  const panel = useDesign((s) => s.panel);
  const canUndo = useDesign((s) => s.undo.length > 0);
  const canRedo = useDesign((s) => s.redo.length > 0);
  const lastAt = useDesign((s) => s.history[0]?.at ?? null);
  const picked = useDesign((s) => {
    void s.selection;
    const file = s.ready ? exportTarget() : null;
    return file ? (s.index.boards[file]?.title ?? null) : null;
  });
  const empty = useDesign((s) => pageBoards(s).length === 0);
  const [renaming, setRenaming] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <header className="dg-top">
      <MenuButton
        className="btn ghost dg-title"
        label="Design"
        entries={() => [
          { heading: lastAt ? `Saved on this computer · ${edited(lastAt)}` : "Saved on this computer" },
          { label: "Open chat", icon: <Icon name="chat" size={16} />, onSelect: () => setPanel("chat") },
          { label: "Comments", icon: <Icon name="chat" size={16} />, onSelect: () => setPanel("comments") },
          { label: "Version history", icon: <Icon name="history" size={16} />, onSelect: () => setPanel("history") },
          "separator",
          { label: "Rename…", icon: <Icon name="pencil" size={16} />, onSelect: () => setRenaming(true) },
          { label: "Duplicate", icon: <Icon name="copy" size={16} />, onSelect: () => void duplicateDesign() },
          { label: "Refresh", icon: <Icon name="refresh" size={16} />, onSelect: () => void reload() },
          "separator",
          { label: "Undo", shortcut: shortcut("Mod+Z"), disabled: !canUndo, onSelect: undo },
          { label: "Redo", shortcut: shortcut("Mod+Shift+Z"), disabled: !canRedo, onSelect: redo },
        ]}
      >
        <span className="dg-title-text">{title}</span>
        <Icon name="chevronDown" size={14} />
      </MenuButton>
      <span className="dg-fill" />
      <ExportButton
        title={title}
        note={empty ? "This page has no artboards; there is nothing to export yet." : `HTML and PNG save “${picked}”. Each artboard’s own download button has more sizes. The design itself stays a folder on this computer.`}
        formats={FORMATS}
        onExport={(k) => void exportDesign(k)}
      />
      <button className={`btn ghost${panel === "chat" ? " on" : ""}`} aria-pressed={panel === "chat"} onClick={() => togglePanel("chat")} title="Chat">
        <Icon name="panelRight" size={16} /> {panel === "chat" ? "Hide chat" : "Show chat"}
      </button>
      {renaming && <NameDialog heading="Rename design" name={title} onClose={() => setRenaming(false)} onSave={renameDesign} />}
    </header>
  );
}
