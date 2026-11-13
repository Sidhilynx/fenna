// Borders: gridlines on or off, the color and line for new borders, and the
// ten ways to put them on the selection.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BORDER_STYLES, type BorderStyle } from "@opendeck/sheet";
import { Icon, type IconName, Menu } from "@opendeck/shell";
import { applyBorders, type BorderPreset, currentSheet, setState, toggleGridlines, useSheets } from "../store.ts";
import { ColorPanel } from "./ColorPanel.tsx";

const PRESETS: { id: BorderPreset; icon: IconName; label: string }[] = [
  { id: "all", icon: "bordersAll", label: "All borders" },
  { id: "inner", icon: "bordersInner", label: "Inner borders" },
  { id: "horizontal", icon: "bordersHorizontal", label: "Horizontal borders" },
  { id: "vertical", icon: "bordersVertical", label: "Vertical borders" },
  { id: "outer", icon: "bordersOuter", label: "Outer borders" },
  { id: "left", icon: "bordersLeft", label: "Left border" },
  { id: "top", icon: "bordersTop", label: "Top border" },
  { id: "right", icon: "bordersRight", label: "Right border" },
  { id: "bottom", icon: "bordersBottom", label: "Bottom border" },
  { id: "clear", icon: "bordersNone", label: "Clear borders" },
];

const LINE: Record<BorderStyle, IconName> = { thin: "lineThin", medium: "lineMedium", thick: "lineThick", dashed: "lineDashed", dotted: "lineDotted", double: "lineDouble" };
const label = (s: BorderStyle) => s[0]!.toUpperCase() + s.slice(1);

export function BordersPanel({ anchor, onClose }: { anchor: HTMLElement; onClose(): void }) {
  const panel = useRef<HTMLDivElement>(null);
  const colorRow = useRef<HTMLButtonElement>(null);
  const lineRow = useRef<HTMLButtonElement>(null);
  const [sub, setSub] = useState<null | "color" | "line">(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const gridlines = useSheets((s) => currentSheet(s)?.showGridlines ?? true);
  const color = useSheets((s) => s.borderColor);
  const line = useSheets((s) => s.borderStyle);

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top = r.top - h - 6;
    if (top < 8) top = r.bottom + 6;
    setPos({ left: Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)), top });
  }, [anchor]);

  useEffect(() => {
    if (pos) panel.current?.querySelector<HTMLElement>("button")?.focus();
  }, [pos === null]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.contains(t) || (t instanceof Element && t.closest(".menu, .cp-panel"))) return;
      onClose();
    };
    window.addEventListener("mousedown", away, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  const buttons = () => [...(panel.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];

  return createPortal(
    <>
      <div
        ref={panel}
        className="bp-panel menu"
        role="menu"
        aria-label="Borders"
        style={pos ?? { visibility: "hidden", left: 0, top: 0 }}
        onKeyDown={(e) => {
          const list = buttons();
          const i = list.indexOf(document.activeElement as HTMLButtonElement);
          const inGrid = (document.activeElement as HTMLElement)?.classList.contains("bp-preset");
          if (e.key === "Escape") {
            if (sub) setSub(null);
            else {
              onClose();
              anchor.focus();
            }
          } else if (e.key === "ArrowDown") list[Math.min(list.length - 1, i + (inGrid ? 5 : 1))]?.focus();
          else if (e.key === "ArrowUp") list[Math.max(0, i - (inGrid ? 5 : 1))]?.focus();
          else if (e.key === "ArrowRight" && inGrid) list[Math.min(list.length - 1, i + 1)]?.focus();
          else if (e.key === "ArrowLeft" && inGrid) list[Math.max(0, i - 1)]?.focus();
          else if (e.key === "ArrowRight" && document.activeElement === colorRow.current) setSub("color");
          else if (e.key === "ArrowRight" && document.activeElement === lineRow.current) setSub("line");
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <button role="menuitemcheckbox" aria-checked={gridlines} className="menu-item bp-row" onClick={() => void toggleGridlines()} onMouseEnter={() => setSub(null)}>
          <span className="menu-label bp-indent">Show gridlines</span>
          <span className="menu-check">{gridlines && <Icon name="check" size={16} />}</span>
        </button>
        <div className="menu-sep" />
        <button ref={colorRow} className={`menu-item bp-row${sub === "color" ? " active" : ""}`} aria-haspopup="dialog" aria-expanded={sub === "color"} onClick={() => setSub("color")} onMouseEnter={() => setSub("color")}>
          <span className="bp-color" style={{ background: color }} aria-hidden />
          <span className="menu-label">Color</span>
          <Icon name="chevronRight" size={14} className="menu-more" />
        </button>
        <button ref={lineRow} className={`menu-item bp-row${sub === "line" ? " active" : ""}`} aria-haspopup="menu" aria-expanded={sub === "line"} onClick={() => setSub("line")} onMouseEnter={() => setSub("line")}>
          <Icon name={LINE[line]} size={16} />
          <span className="menu-label">Thickness</span>
          <Icon name="chevronRight" size={14} className="menu-more" />
        </button>
        <div className="menu-sep" />
        <div className="bp-grid" onMouseEnter={() => setSub(null)}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className="bp-preset"
              title={p.label}
              aria-label={p.label}
              onClick={() => {
                onClose();
                void applyBorders(p.id);
              }}
            >
              <Icon name={p.icon} size={18} />
            </button>
          ))}
        </div>
      </div>
      {sub === "color" && colorRow.current && (
        <ColorPanel anchor={colorRow.current} place="beside" none="Automatic" value={color === "#737373" ? undefined : color} onPick={(c) => setState({ borderColor: c ?? "#737373" })} onClose={() => setSub(null)} />
      )}
      {sub === "line" && lineRow.current && (
        <Menu
          anchor={lineRow.current}
          label="Thickness"
          onBack={() => {
            setSub(null);
            lineRow.current?.focus();
          }}
          onClose={() => setSub(null)}
          entries={BORDER_STYLES.map((s) => ({ label: label(s), icon: <Icon name={LINE[s]} size={16} />, checked: s === line, onSelect: () => setState({ borderStyle: s }) }))}
        />
      )}
    </>,
    document.body,
  );
}
