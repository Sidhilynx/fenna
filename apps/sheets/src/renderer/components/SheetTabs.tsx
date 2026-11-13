// The bar under the grid: add a sheet, the list of sheets, a tab per sheet
// with its menu, and the selection's sum, average and count.

import { useEffect, useRef, useState } from "react";
import { Icon, MenuButton, type MenuEntry } from "@opendeck/shell";
import { addSheet, deleteSheet, duplicateSheet, getState, importCsvFile, importXlsxFile, moveSheet, renameSheet, selectionStats, setActiveSheet, useSheets } from "../store.ts";

const addEntries = (): MenuEntry[] => [
  { label: "Blank sheet", icon: <Icon name="sheet" size={16} />, onSelect: () => void addSheet() },
  { label: "Import CSV…", icon: <Icon name="csv" size={16} />, onSelect: () => void importCsvFile() },
  { label: "Import from Excel…", icon: <Icon name="excel" size={16} />, onSelect: () => void importXlsxFile() },
];

function fmt(n: number): string {
  return Number(n.toPrecision(12)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function SheetTabs() {
  const sheets = useSheets((s) => s.workbook?.index.sheets ?? []);
  const active = useSheets((s) => s.activeSheetId);
  useSheets((s) => s.selection);
  useSheets((s) => s.evaluated);
  const [renaming, setRenaming] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const stats = selectionStats();

  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(".st-tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, sheets.length]);

  const tabMenu = (id: string, i: number): MenuEntry[] => [
    { label: "Rename", icon: <Icon name="pencil" size={16} />, onSelect: () => setRenaming(id) },
    { label: "Duplicate", icon: <Icon name="copy" size={16} />, onSelect: () => void duplicateSheet(id) },
    "separator",
    { label: "Move left", icon: <Icon name="arrowLeft" size={16} />, disabled: i === 0, onSelect: () => void moveSheet(id, -1) },
    { label: "Move right", icon: <Icon name="arrowRight" size={16} />, disabled: i === sheets.length - 1, onSelect: () => void moveSheet(id, 1) },
    "separator",
    { label: "Delete", icon: <Icon name="trash" size={16} />, danger: true, disabled: sheets.length <= 1, onSelect: () => void deleteSheet(id) },
  ];

  return (
    <footer className="st" aria-label="Sheets">
      <button className="icon-btn" title="Add sheet" aria-label="Add sheet" onClick={() => void addSheet()}>
        <Icon name="plus" size={16} />
      </button>
      <MenuButton
        className="btn ghost st-list"
        label="All sheets"
        title="All sheets"
        entries={() => [
          { label: "Add sheet", icon: <Icon name="plus" size={16} />, submenu: addEntries() },
          "separator",
          ...getState().workbook!.index.sheets.map((s) => ({ label: s.title, checked: s.id === getState().activeSheetId, onSelect: () => setActiveSheet(s.id) })),
        ]}
      >
        <Icon name="list" size={16} />
        <Icon name="chevronDown" size={12} />
      </MenuButton>
      <div ref={strip} className="st-tabs" role="tablist" aria-label="Sheets">
        {sheets.map((s, i) =>
          renaming === s.id ? (
            <input
              key={s.id}
              className="st-rename"
              autoFocus
              defaultValue={s.title}
              maxLength={200}
              aria-label="Sheet name"
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => {
                setRenaming(null);
                void renameSheet(s.id, e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(null);
              }}
            />
          ) : (
            <div key={s.id} className={`st-tab${s.id === active ? " on" : ""}`}>
              <button
                role="tab"
                aria-selected={s.id === active}
                className="st-name"
                title={s.title.length > 24 ? s.title : undefined}
                onClick={() => setActiveSheet(s.id)}
                onDoubleClick={() => setRenaming(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "F2") setRenaming(s.id);
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    const next = sheets[i + (e.key === "ArrowRight" ? 1 : -1)];
                    if (next) {
                      setActiveSheet(next.id);
                      requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>(".st-tab.on .st-name")?.focus());
                    }
                  }
                }}
              >
                {s.title}
              </button>
              <MenuButton className="st-caret" label={`${s.title} options`} entries={() => tabMenu(s.id, i)}>
                <Icon name="chevronDown" size={12} />
              </MenuButton>
            </div>
          ),
        )}
      </div>
      {stats && (
        <div className="st-stats" aria-live="polite">
          {"sum" in stats && stats.sum !== undefined && (
            <>
              <span>Sum {fmt(stats.sum)}</span>
              <span>Average {fmt(stats.avg!)}</span>
            </>
          )}
          <span>Count {stats.count}</span>
        </div>
      )}
    </footer>
  );
}
