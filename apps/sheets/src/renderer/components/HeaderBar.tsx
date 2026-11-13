// The header: the workbook's name and its menu, Export, and the chat.

import { useEffect, useState } from "react";
import { ago, Dialog, ExportButton, type ExportFormat, Icon, MenuButton, shortcut } from "@opendeck/shell";
import { duplicateWorkbook, exportCsvFile, exportXlsxFile, redo, reload, renameWorkbook, setRightPanel, togglePanel, undo, useSheets } from "../store.ts";

type Kind = "xlsx" | "csv";
const FORMATS: ExportFormat<Kind>[] = [
  { kind: "xlsx", icon: "excel", name: "Excel", hint: "Editable .xlsx workbook, every sheet" },
  { kind: "csv", icon: "csv", name: "CSV", hint: "This sheet's values as plain text" },
];

/** "edited just now", "edited 5m ago", "edited Nov 12". */
function edited(at: number): string {
  const a = ago(at);
  return a === "now" ? "edited just now" : /^\d+[mh]$/.test(a) ? `edited ${a} ago` : `edited ${a}`;
}

export function HeaderBar() {
  const title = useSheets((s) => s.workbook?.index.title ?? s.ref?.name ?? "Untitled");
  const panel = useSheets((s) => s.rightPanel);
  const canUndo = useSheets((s) => s.undo.length > 0);
  const canRedo = useSheets((s) => s.redo.length > 0);
  const lastAt = useSheets((s) => s.history[0]?.at ?? null);
  const [renaming, setRenaming] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <header className="sh-top">
      <MenuButton
        className="btn ghost sh-title"
        label="Workbook"
        entries={() => [
          { heading: lastAt ? `Saved on this computer · ${edited(lastAt)}` : "Saved on this computer" },
          { label: "Open chat", icon: <Icon name="chat" size={16} />, onSelect: () => setRightPanel("chat") },
          { label: "Version history", icon: <Icon name="history" size={16} />, onSelect: () => setRightPanel("history") },
          "separator",
          { label: "Rename…", icon: <Icon name="pencil" size={16} />, onSelect: () => setRenaming(true) },
          { label: "Duplicate", icon: <Icon name="copy" size={16} />, onSelect: () => void duplicateWorkbook() },
          { label: "Refresh", icon: <Icon name="refresh" size={16} />, onSelect: () => void reload() },
          "separator",
          { label: "Undo", shortcut: shortcut("Mod+Z"), disabled: !canUndo, onSelect: () => void undo() },
          { label: "Redo", shortcut: shortcut("Mod+Shift+Z"), disabled: !canRedo, onSelect: () => void redo() },
        ]}
      >
        <span className="sh-title-text">{title}</span>
        <Icon name="chevronDown" size={14} />
      </MenuButton>
      <span className="sh-fill" />
      <ExportButton title={title} note="Save a copy to send or open elsewhere. The workbook itself stays a folder on this computer." formats={FORMATS} onExport={(k) => void (k === "xlsx" ? exportXlsxFile() : exportCsvFile())} />
      <button className={`btn ghost${panel === "chat" ? " on" : ""}`} aria-pressed={panel === "chat"} onClick={() => togglePanel("chat")} title={`Chat (${shortcut("Mod+Shift+L")})`}>
        <Icon name="panelRight" size={16} /> {panel === "chat" ? "Hide chat" : "Show chat"}
      </button>
      {renaming && <RenameDialog title={title} onClose={() => setRenaming(false)} />}
    </header>
  );
}

function RenameDialog({ title, onClose }: { title: string; onClose(): void }) {
  const [value, setValue] = useState(title);
  return (
    <Dialog title="Rename workbook" onClose={onClose} width={400}>
      <form
        className="dlg-form"
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
          void renameWorkbook(value);
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
