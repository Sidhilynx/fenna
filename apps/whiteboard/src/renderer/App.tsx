// Fenna Whiteboard's window: Home when no board is open; otherwise the header, the
// board with its tools, and the side column. Keyboard paths for everything
// live here.

import { useEffect } from "react";
import { boundsOf, describeProblems } from "@opendeck/board";
import { tabs } from "@opendeck/shell";
import { comments } from "./comments.ts";
import { AskBar } from "./components/AskBar.tsx";
import { Canvas } from "./components/Canvas.tsx";
import { Dock, TOOL_KEYS } from "./components/Dock.tsx";
import { FloatingBar } from "./components/FloatingBar.tsx";
import { HeaderBar } from "./components/HeaderBar.tsx";
import { Home } from "./components/Home.tsx";
import { RightPanels } from "./components/RightPanels.tsx";
import { ViewControls } from "./components/ViewControls.tsx";
import {
  addItems,
  boot,
  clearSelection,
  commentOnSelection,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  fitBoard,
  getState,
  group,
  makeItem,
  nudge,
  pasteFrom,
  redo,
  reorder,
  selectAll,
  selectedItems,
  setPanel,
  setState,
  setTool,
  styleSelection,
  toggleFlyout,
  toggleLock,
  undo,
  ungroup,
  useBoard,
  viewCenter,
  zoomIn,
  zoomOut,
  zoomTo,
} from "./store.ts";

const typingIn = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest("input, textarea, select, [contenteditable='true']");

function onKey(e: KeyboardEvent) {
  const s = getState();
  if (e.defaultPrevented || !s.meta) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const typing = typingIn(e.target);
  if (mod && k === "k" && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    setState({ asking: !s.asking });
    return;
  }
  if (typing || (e.target as HTMLElement | null)?.closest(".menu, [role=dialog]")) return;
  const sel = selectedItems();
  const go = (fn: () => void) => {
    e.preventDefault();
    fn();
  };
  if (mod) {
    if (k === "z") return go(() => (e.shiftKey ? redo() : undo()));
    if (k === "y") return go(redo);
    if (k === "m" && e.altKey) return go(commentOnSelection);
    if (k === "a") return go(selectAll);
    if (k === "c" && !e.shiftKey) return go(copySelection);
    if (k === "x") return go(cutSelection);
    if (k === "d") return go(duplicateSelection);
    if (k === "g") return go(() => (e.shiftKey ? ungroup() : group()));
    if (k === "l" && e.shiftKey) return go(toggleLock);
    if (k === "b" && sel.length) return go(() => styleSelection("Bold", { bold: sel.every((it) => "bold" in it && it.bold) ? undefined : true }, ["sticky", "text", "shape"]));
    if (k === "i" && sel.length) return go(() => styleSelection("Italic", { italic: sel.every((it) => "italic" in it && it.italic) ? undefined : true }, ["sticky", "text", "shape"]));
    if (k === "=" || k === "+") return go(zoomIn);
    if (k === "-") return go(zoomOut);
    if (k === "0") return go(() => zoomTo(1));
    return;
  }
  if (e.altKey) return;
  if (e.shiftKey && e.code === "Digit1") return go(() => fitBoard());
  if (e.shiftKey && e.code === "Digit2") return go(() => fitBoard(sel.length ? boundsOf(sel, s.byId) : null));
  switch (e.key) {
    case "Escape":
      if (comments.get().open) return go(() => comments.openThread(null));
      if (s.flyout) return go(() => setState({ flyout: null }));
      if (s.linking) return go(() => setState({ linking: false }));
      if (s.tool !== "select") return go(() => setTool("select"));
      if (s.selection.length) return go(clearSelection);
      if (s.panel) return go(() => setPanel(null));
      return;
    case "Delete":
    case "Backspace":
      return go(deleteSelection);
    case "]":
      return go(() => reorder(true));
    case "[":
      return go(() => reorder(false));
    case "ArrowLeft":
    case "ArrowRight":
    case "ArrowUp":
    case "ArrowDown": {
      if (!sel.length) return;
      const d = e.shiftKey ? 10 : 1;
      return go(() => nudge(e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0));
    }
    case "Enter": {
      // With a tool chosen, Enter puts its item in the middle of the screen.
      const t = s.tool;
      if (t === "text" || t === "sticky" || t === "frame" || t === "shape") {
        const it = makeItem(t, viewCenter());
        addItems(`Add ${t}`, [it], { edit: t === "text" || t === "sticky" });
        setTool("select");
        return go(() => {});
      }
      const one = sel.length === 1 ? sel[0]! : null;
      if (!one || one.locked) return;
      if (one.kind === "table") return go(() => setState({ editing: { id: one.id, cell: [0, 0] } }));
      if (["sticky", "text", "shape", "frame", "connector"].includes(one.kind)) return go(() => setState({ editing: { id: one.id } }));
      return;
    }
  }
  if (!e.shiftKey && s.meta.settings.shortcuts && TOOL_KEYS[k]) {
    const t = TOOL_KEYS[k]!;
    return go(() => (t === "stickers" ? toggleFlyout("stickers") : setTool(t)));
  }
}

function onPaste(e: ClipboardEvent) {
  if (!getState().meta || typingIn(e.target)) return;
  const files = [...(e.clipboardData?.files ?? [])];
  const text = e.clipboardData?.getData("text/plain") ?? "";
  e.preventDefault();
  void pasteFrom({ text, files });
}

export function App() {
  const ref = useBoard((s) => s.ref);
  const meta = useBoard((s) => s.meta);
  const loading = useBoard((s) => s.loading);
  const asking = useBoard((s) => s.asking);
  const broken = useBoard((s) => s.broken);
  const problems = useBoard((s) => s.problems);
  const kept = useBoard((s) => s.kept.length);

  useEffect(() => void boot(), []);
  useEffect(() => void comments.load(ref?.root ?? null), [ref?.root]);

  const title = meta?.title ?? ref?.name ?? "";
  useEffect(() => {
    if (title) tabs.meta({ title });
  }, [title]);

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  if (!loading && (!ref || !meta)) return <Home />;

  const problem = broken
    ? `This board can’t be read: ${broken}. The file is left as it is and nothing is saved; fix it, or restore a version.`
    : kept
      ? `${kept === 1 ? "One item" : `${kept} items`} in canvas.json can’t be shown; they are kept in the file as they are.`
      : null;

  return (
    <div className="wb">
      <HeaderBar />
      {loading || !meta ? (
        <main className="wb-loading" aria-busy />
      ) : (
        <div className="wb-body">
          <section className="wb-stage">
            <Canvas />
            {problem && (
              <div className="wb-problem" role="alert" title={describeProblems(problems)}>
                {problem}
              </div>
            )}
            <ViewControls />
            <FloatingBar />
            <div className="wb-bottom">
              {asking && <AskBar />}
              <Dock />
            </div>
          </section>
          <RightPanels />
        </div>
      )}
    </div>
  );
}
