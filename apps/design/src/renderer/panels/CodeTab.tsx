// The Code tab: the selected layer's inline declarations, one a line, as
// text that can be edited. Leaving the box (or Ctrl+Enter) checks what was
// typed against the format and applies it, or says what is wrong and keeps
// the text for another try.

import { useEffect, useState } from "react";
import { px } from "@opendeck/format";
import { EditError, layerText, setDeclarations, styleOf } from "@opendeck/artboard";
import { apply, context, getState, sizedBoard, snap, target, useTarget, useDesign } from "../store.ts";

export function CodeTab() {
  const t = useTarget();
  const saved = t ? t.el.style.map((d) => `${d.name}: ${d.value};`).join("\n") : "";
  const [code, setCode] = useState(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const key = t ? `${t.file}|${t.address}` : "";
  useEffect(() => {
    setCode(saved);
    setProblem(null);
  }, [key, saved]);

  if (!t) return <div className="rp-empty">Select one layer to see its styles.</div>;
  const words = layerText(t.el);

  const commit = () => {
    if (code.trim() === saved.trim()) return setProblem(null);
    const s = getState();
    const board = s.boards.get(t.file);
    if (!board?.doc) return;
    try {
      const root = setDeclarations(board.doc.root, t.address, code, context());
      setProblem(null);
      const next = { ...snap(s), boards: new Map(s.boards).set(t.file, { ...board, doc: { ...board.doc, root } }) };
      // The artboard is as big as its root says: a width or height typed here resizes it.
      const placed = s.index.boards[t.file];
      const w = px(styleOf(root, "width") ?? "");
      const h = px(styleOf(root, placed?.expand === "fill" ? "min-height" : "height") ?? "");
      apply("Edit styles", t.address === "" && placed ? { ...next, ...sizedBoard(next, t.file, { x: placed.x, y: placed.y, w: w && w >= 16 ? w : placed.w, h: h && h >= 16 ? h : placed.h }) } : next);
    } catch (e) {
      setProblem(e instanceof EditError ? e.message : String(e));
    }
  };

  return (
    <div className="pp-code">
      <div className="pp-code-head">
        <span className="pp-code-tag">&lt;{t.el.tag}&gt;</span>
        {words && <span className="pp-code-text">“{words.length > 48 ? `${words.slice(0, 47)}…` : words}”</span>}
      </div>
      <textarea
        className="pp-code-box"
        value={code}
        rows={Math.max(6, code.split("\n").length + 1)}
        spellCheck={false}
        aria-label="Styles"
        aria-invalid={!!problem}
        placeholder="width: 320px;"
        onChange={(e) => setCode(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setCode(saved);
            setProblem(null);
          }
        }}
      />
      {problem ? (
        <p className="pp-code-problem" role="alert">
          Not applied: {problem}. Fix it, or press Esc to put the styles back.
        </p>
      ) : (
        <p className="pp-code-note">One declaration a line. They apply when you click away.</p>
      )}
    </div>
  );
}
