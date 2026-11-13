// The formula bar: what the active cell holds (its formula, or its value as
// typed), editable here as in the cell; then zoom and version history.

import { useMemo, useRef, useState } from "react";
import { formatCellRef, FUNCTIONS } from "@opendeck/sheet";
import { Icon, MenuButton } from "@opendeck/shell";
import { cancelEditing, commitEditing, currentSheet, editText, getState, setState, startEditing, togglePanel, useSheets } from "../store.ts";

const ZOOMS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];

export function FormulaBar() {
  const anchor = useSheets((s) => s.selection.anchor);
  const editing = useSheets((s) => s.editing);
  const cell = useSheets((s) => currentSheet(s)?.cells[formatCellRef(s.selection.anchor.r, s.selection.anchor.c)]);
  const zoom = useSheets((s) => s.zoom);
  const panel = useSheets((s) => s.rightPanel);
  const input = useRef<HTMLInputElement>(null);
  const [pick, setPick] = useState(0);
  const here = editing && editing.r === anchor.r && editing.c === anchor.c;
  const value = here ? editing.value : editText(cell);
  const locked = cell?.t === "checkbox" || cell?.t === "dropdown" || cell?.t === "person";

  const hints = useMemo(() => {
    if (editing?.source !== "formula" || !value.startsWith("=")) return [];
    const m = /([A-Za-z][A-Za-z0-9.]*)$/.exec(value);
    if (!m) return [];
    const q = m[1]!.toUpperCase();
    return FUNCTIONS.filter((f) => f.name.startsWith(q) && f.name !== q).slice(0, 8);
  }, [editing?.source, value]);

  const insert = (name: string) => {
    const ed = getState().editing;
    if (ed) setState({ editing: { ...ed, value: ed.value.replace(/([A-Za-z][A-Za-z0-9.]*)$/, `${name}(`) } });
    input.current?.focus();
  };

  return (
    <div className="fx">
      <span className="fx-mark" aria-hidden>
        <i>fx</i>
      </span>
      <div className="fx-field">
        <input
          ref={input}
          className="fx-input"
          aria-label={`Contents of ${formatCellRef(anchor.r, anchor.c)}`}
          value={value}
          readOnly={locked}
          spellCheck={false}
          placeholder={locked ? "" : "Type a value, = for a formula, or @ to insert a person, date, or dropdown"}
          onFocus={() => {
            if (!locked && !getState().editing) startEditing(anchor.r, anchor.c, "formula");
          }}
          onChange={(e) => {
            setPick(0);
            const ed = getState().editing;
            if (!ed) startEditing(anchor.r, anchor.c, "formula", e.target.value);
            else setState({ editing: { ...ed, value: e.target.value, source: "formula" } });
          }}
          onBlur={() =>
            setTimeout(() => {
              const ed = getState().editing;
              if (ed?.source === "formula" && !document.activeElement?.closest(".fx, .c-editor, .menu")) void commitEditing();
            }, 120)
          }
          onKeyDown={(e) => {
            if (hints.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setPick((i) => (i + (e.key === "ArrowDown" ? 1 : hints.length - 1)) % hints.length);
            } else if (hints.length && e.key === "Tab") {
              e.preventDefault();
              insert(hints[pick]!.name);
            } else if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              void commitEditing(e.key === "Tab" ? (e.shiftKey ? "left" : "right") : e.shiftKey ? "up" : "down");
              document.querySelector<HTMLElement>(".grid-host")?.focus();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEditing();
              document.querySelector<HTMLElement>(".grid-host")?.focus();
            }
          }}
        />
        {hints.length > 0 && (
          <div className="c-suggest fx-suggest" role="listbox" aria-label="Functions" onMouseDown={(e) => e.preventDefault()}>
            {hints.map((f, i) => (
              <div key={f.name} role="option" aria-selected={i === pick} className={`c-suggest-row${i === pick ? " on" : ""}`} onMouseEnter={() => setPick(i)} onClick={() => insert(f.name)}>
                <span className="c-suggest-sig">{f.sig}</span>
                <span className="c-suggest-desc">{f.desc}</span>
              </div>
            ))}
            <div className="c-suggest-foot">Tab to insert</div>
          </div>
        )}
      </div>
      <MenuButton className="btn ghost fx-zoom" label="Zoom" entries={() => ZOOMS.map((z) => ({ label: `${Math.round(z * 100)}%`, checked: Math.abs(zoom - z) < 0.001, onSelect: () => setState({ zoom: z }) }))}>
        {Math.round(zoom * 100)}% <Icon name="chevronDown" size={12} />
      </MenuButton>
      <button className={`icon-btn${panel === "history" ? " on" : ""}`} aria-pressed={panel === "history"} title="Version history" aria-label="Version history" onClick={() => togglePanel("history")}>
        <Icon name="history" size={17} />
      </button>
    </div>
  );
}
