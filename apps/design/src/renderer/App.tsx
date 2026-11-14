// Fenna Design's window: Home when no design is open; otherwise the header,
// the canvas with its tools, and the side column. Keyboard paths for
// everything live here.

import { useEffect } from "react";
import { setStyles, styleOf } from "@opendeck/artboard";
import { tabs } from "@opendeck/shell";
import { commentOnSelection } from "./commentOn.ts";
import { comments } from "./comments.ts";
import { AskBar } from "./components/AskBar.tsx";
import { Canvas, placeWithKeyboard } from "./components/Canvas.tsx";
import { Dock, TOOL_KEYS } from "./components/Dock.tsx";
import { FloatingBar } from "./components/FloatingBar.tsx";
import { FocusView } from "./components/FocusView.tsx";
import { HeaderBar } from "./components/HeaderBar.tsx";
import { Home } from "./components/Home.tsx";
import { restackSelection } from "./components/menus.tsx";
import { RightPanels } from "./components/RightPanels.tsx";
import { PagePill, ViewControls } from "./components/ViewControls.tsx";
import {
  boot,
  clearSelection,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  editTarget,
  fitPage,
  fitSelection,
  getState,
  insertImages,
  nudge,
  pageBoards,
  paste,
  redo,
  selectAll,
  selectLayers,
  selectedFile,
  setFocus,
  setPanel,
  setState,
  setTool,
  target,
  toggleGuides,
  undo,
  useDesign,
  zoomIn,
  zoomOut,
  zoomTo,
} from "./store.ts";

/** Is the key going into a field (also one inside an artboard, where the event is re-aimed at the artboard)? */
const typingIn = (e: Event) => !!(e.composedPath()[0] as HTMLElement | undefined)?.closest?.("input, textarea, select, [contenteditable='true']");

/** Toggle one text style on the selected layer (Ctrl+B and friends). */
function emphasis(prop: string, on: string, off: string, isOn: (v: string) => boolean) {
  const t = target();
  if (t) editTarget(prop, (root, addr, ctx) => setStyles(root, addr, { [prop]: isOn(styleOf(t.el, prop) ?? "") ? off : on }, ctx));
}

function onKey(e: KeyboardEvent) {
  const s = getState();
  if (e.defaultPrevented || !s.ready) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === "k" && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    setState({ asking: !s.asking });
    return;
  }
  if (typingIn(e) || s.editing || (e.target as HTMLElement | null)?.closest?.(".menu, [role=dialog]")) return;
  const go = (fn: () => void) => {
    e.preventDefault();
    fn();
  };
  if (s.focus) {
    if (e.key === "Escape") go(() => setFocus(null));
    return;
  }
  const sel = s.selection;
  const file = selectedFile(s);
  if (mod) {
    if (k === "z") return go(() => (e.shiftKey ? redo() : undo()));
    if (k === "y") return go(redo);
    if (k === "m" && e.altKey) return go(commentOnSelection);
    if (k === "a") return go(selectAll);
    if (k === "c" && !e.shiftKey) return go(copySelection);
    if (k === "x") return go(cutSelection);
    if (k === "d") return go(duplicateSelection);
    if (k === "b" && sel?.kind === "layers") return go(() => emphasis("font-weight", "700", "400", (v) => v === "bold" || Number(v) >= 600));
    if (k === "i" && sel?.kind === "layers") return go(() => emphasis("font-style", "italic", "normal", (v) => v === "italic"));
    if (k === "u" && sel?.kind === "layers") return go(() => emphasis("text-decoration", "underline", "none", (v) => v.includes("underline")));
    if (e.key === "Enter" && (file ?? pageBoards(s)[0])) return go(() => setFocus(file ?? pageBoards(s)[0]!));
    if (k === "=" || k === "+") return go(zoomIn);
    if (k === "-") return go(zoomOut);
    if (k === "0") return go(() => zoomTo(1));
    return;
  }
  if (e.altKey) return;
  if (e.shiftKey && e.code === "Digit1") return go(fitPage);
  if (e.shiftKey && e.code === "Digit2") return go(fitSelection);
  if (e.shiftKey && k === "g") return go(toggleGuides);
  switch (e.key) {
    case "Escape":
      if (comments.get().open) return go(() => comments.openThread(null));
      if (s.flyout) return go(() => setState({ flyout: null }));
      if (s.tool !== "select") return go(() => setTool("select"));
      // From a layer, Esc steps out to its artboard; from the artboard, to nothing.
      if (sel?.kind === "layers") return go(() => selectLayers(sel.file, []));
      if (sel) return go(clearSelection);
      if (s.panel) return go(() => setPanel(null));
      return;
    case "Delete":
    case "Backspace":
      return go(deleteSelection);
    case "]":
      return go(() => restackSelection("forward"));
    case "[":
      return go(() => restackSelection("backward"));
    case "ArrowLeft":
    case "ArrowRight":
    case "ArrowUp":
    case "ArrowDown": {
      if (!sel || sel.kind === "layers") return;
      const d = e.shiftKey ? 10 : 1;
      return go(() => nudge(e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0));
    }
    case "Enter": {
      if (placeWithKeyboard()) return go(() => {});
      if (sel?.kind === "boards" && sel.files.length === 1) return go(() => setState({ editing: { kind: "name", file: sel.files[0]! } }));
      if (sel?.kind === "notes" && sel.ids.length === 1 && s.notes.find((n) => n.id === sel.ids[0])?.kind === "sticky") return go(() => setState({ editing: { kind: "note", id: sel.ids[0]! } }));
      return;
    }
    case "Tab": {
      // Tab walks the page's artboards, so the canvas has a keyboard path.
      const files = pageBoards(s);
      if (!files.length || (e.target as HTMLElement | null)?.closest?.("button, a, [role=tab], [role=treeitem]")) return;
      const at = file ? files.indexOf(file) : -1;
      return go(() => selectLayers(files[(at + (e.shiftKey ? -1 : 1) + files.length) % files.length]!, []));
    }
  }
  if (!e.shiftKey && TOOL_KEYS[k]) return go(() => setTool(TOOL_KEYS[k]!));
}

function onPaste(e: ClipboardEvent) {
  if (!getState().ready || typingIn(e) || getState().editing) return;
  const files = [...(e.clipboardData?.files ?? [])];
  e.preventDefault();
  if (files.length) void insertImages(files);
  else paste();
}

export function App() {
  const ref = useDesign((s) => s.ref);
  const ready = useDesign((s) => s.ready);
  const loading = useDesign((s) => s.loading);
  const asking = useDesign((s) => s.asking);
  const broken = useDesign((s) => s.broken);
  const problems = useDesign((s) => s.problems);
  const focus = useDesign((s) => s.focus);
  const title = useDesign((s) => (s.ready ? s.index.title : (s.ref?.name ?? "")));

  useEffect(() => void boot(), []);
  useEffect(() => void comments.load(ref?.root ?? null), [ref?.root]);
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

  if (!loading && (!ref || !ready)) return <Home />;

  const indexProblems = problems.filter((p) => p.where === "design.json" || p.where === "notes.json");
  const problem = broken ? `This design can’t be read: ${broken}. The file is left as it is and nothing is saved; fix it, or restore a version.` : indexProblems.length ? indexProblems.map((p) => p.message).join(" · ") : null;

  return (
    <div className="dg">
      <HeaderBar />
      {loading || !ready ? (
        <main className="dg-loading" aria-busy />
      ) : (
        <div className="dg-body">
          <section className="dg-stage">
            <Canvas />
            {problem && (
              <div className="dg-problem" role="alert">
                {problem}
              </div>
            )}
            <PagePill />
            <ViewControls />
            <FloatingBar />
            <div className="dg-bottom">
              {asking && <AskBar />}
              <Dock />
            </div>
            {focus && <FocusView file={focus} />}
          </section>
          <RightPanels />
        </div>
      )}
    </div>
  );
}
