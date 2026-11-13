// Fenna Sheets' window: Home when no workbook is open; otherwise the header,
// formula bar, grid with its toolbar, the side column, and the sheet tabs.

import { useEffect } from "react";
import { tabs } from "@opendeck/shell";
import { comments } from "./comments.ts";
import { SheetDialogs } from "./components/Dialogs.tsx";
import { FormulaBar } from "./components/FormulaBar.tsx";
import { Grid } from "./components/Grid.tsx";
import { HeaderBar } from "./components/HeaderBar.tsx";
import { Home } from "./components/Home.tsx";
import { commentOnSelection } from "./components/menus.tsx";
import { RightPanels } from "./components/RightPanels.tsx";
import { SheetTabs } from "./components/SheetTabs.tsx";
import { Toolbar } from "./components/Toolbar.tsx";
import { boot, clearSelection, getState, redo, setRightPanel, setState, togglePanel, toggleStyleProp, undo, useSheets } from "./store.ts";

export function App() {
  const ref = useSheets((s) => s.ref);
  const workbook = useSheets((s) => s.workbook);
  const loading = useSheets((s) => s.loading);
  const problem = useSheets((s) => {
    const l = s.activeSheetId ? s.workbook?.sheets.get(s.activeSheetId) : null;
    return l && !l.sheet ? `This sheet’s file can’t be read (${l.error ?? "unknown problem"}). It is left as it is on disk; fix it or delete the sheet.` : (s.workbook?.problems[0] ?? null);
  });

  useEffect(() => void boot(), []);
  useEffect(() => void comments.load(ref?.root ?? null), [ref?.root]);

  const title = workbook?.index.title ?? ref?.name ?? "";
  useEffect(() => {
    if (title) tabs.meta({ title });
  }, [title]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !getState().workbook) return;
      const mod = e.ctrlKey || e.metaKey;
      const t = e.target as HTMLElement | null;
      const typing = !!t?.closest("input, textarea, select, [contenteditable='true']");
      const inGrid = !!t?.closest(".grid-host");
      const k = e.key.toLowerCase();
      if (e.key === "Escape" && !typing && !inGrid && getState().rightPanel && !t?.closest(".menu, [role=dialog]")) {
        setRightPanel(null);
        return;
      }
      if (!mod) return;
      if (k === "k" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setState({ asking: !getState().asking });
      } else if (k === "l" && e.shiftKey) {
        e.preventDefault();
        togglePanel("chat");
      } else if (k === "m" && e.altKey) {
        e.preventDefault();
        commentOnSelection();
      } else if (!typing && !e.altKey && (k === "z" || k === "y")) {
        e.preventDefault();
        void (k === "y" || e.shiftKey ? redo() : undo());
      } else if (inGrid && !e.altKey) {
        if (k === "b" || k === "i" || k === "u" || (k === "x" && e.shiftKey)) {
          e.preventDefault();
          void toggleStyleProp(k === "b" ? "bold" : k === "i" ? "italic" : k === "u" ? "underline" : "strike");
        } else if (e.key === "\\") {
          e.preventDefault();
          void clearSelection("formatting");
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (!loading && (!ref || !workbook)) return <Home />;

  return (
    <div className="sheets">
      <HeaderBar />
      {loading || !workbook ? (
        <main className="sh-loading" aria-busy />
      ) : (
        <>
          <FormulaBar />
          <div className="sh-body">
            <section className="sh-stage">
              {problem && (
                <div className="sh-problem" role="alert">
                  {problem}
                </div>
              )}
              <Grid />
              <Toolbar />
            </section>
            <RightPanels />
          </div>
          <SheetTabs />
          <SheetDialogs />
        </>
      )}
    </div>
  );
}
