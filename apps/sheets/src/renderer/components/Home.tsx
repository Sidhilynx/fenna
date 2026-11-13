// Home screen for Fenna Sheets: reuses @opendeck/shell's Home with mini grid previews.

import { useEffect, useState } from "react";
import { Home as ShellHome, type HomeItem } from "@opendeck/shell";
import { formatCellRef, type SheetData } from "@opendeck/sheet";
import { api, type RecentSheet } from "../api.ts";
import { chooseSheet, createWorkbook, openRecent, openRecentInTab } from "../store.ts";

/** The first rows and columns of the sheet in miniature: grid lines, and a bar where a cell holds something. */
function SheetCover({ cover }: { cover: SheetData }) {
  const rows = 5;
  const cols = 4;
  const w = 48 / cols;
  const h = 27 / rows;
  const bars: { x: number; y: number; len: number; head: boolean }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cover.cells?.[formatCellRef(r, c)];
      const text = cell?.f ? "0000" : cell?.v !== undefined && cell?.v !== null ? String(cell.v) : "";
      if (text) bars.push({ x: c * w + 1.5, y: r * h + h / 2 - 0.9, len: Math.min(w - 3, 1.5 + text.length * 0.7), head: r === 0 });
    }
  }
  return (
    <svg className="sh-cover" viewBox="0 0 48 27" preserveAspectRatio="none" aria-hidden>
      {Array.from({ length: rows - 1 }, (_, i) => (
        <line key={`r${i}`} className="sh-cover-line" x1="0" x2="48" y1={(i + 1) * h} y2={(i + 1) * h} />
      ))}
      {Array.from({ length: cols - 1 }, (_, i) => (
        <line key={`c${i}`} className="sh-cover-line" y1="0" y2="27" x1={(i + 1) * w} x2={(i + 1) * w} />
      ))}
      {bars.map((b) => (
        <rect key={`${b.x},${b.y}`} className={`sh-cover-bar${b.head ? " head" : ""}`} x={b.x} y={b.y} width={b.len} height="1.8" rx="0.9" />
      ))}
    </svg>
  );
}

export function Home() {
  const [recent, setRecent] = useState<RecentSheet[] | null>(null);
  useEffect(() => {
    void api()
      .recent()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  const items: HomeItem[] | null = recent
    ? recent.map((r) => ({
        root: r.root,
        title: r.title,
        edited: r.edited,
        cover: r.cover && typeof r.cover === "object" && "cells" in r.cover ? <SheetCover cover={r.cover as SheetData} /> : null,
      }))
    : null;

  return (
    <ShellHome
      noun="sheet"
      nouns="sheets"
      items={items}
      onChoose={() => void chooseSheet()}
      onStart={createWorkbook}
      onOpen={(root, newTab) => (newTab ? openRecentInTab(root) : void openRecent(root))}
      placeholder="Describe a spreadsheet to build, or press Enter for a blank sheet"
    />
  );
}

