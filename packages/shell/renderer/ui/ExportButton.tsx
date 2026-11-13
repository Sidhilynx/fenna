// Export: a button in the header, and a panel under it with each format the
// app can save a copy as (icon, name, what it is). The document itself stays
// a folder on this computer; this only writes copies.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons.tsx";

export interface ExportFormat<K extends string = string> {
  kind: K;
  icon: IconName;
  name: string;
  hint: string;
}

interface Props<K extends string> {
  /** The document's title, shown at the top of the panel. */
  title: string;
  /** One line under the title. */
  note: string;
  formats: readonly ExportFormat<K>[];
  onExport(kind: K): void;
}

export function ExportButton<K extends string>(props: Props<K>) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} className="btn ghost" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="export" size={16} /> Export
      </button>
      {open && button.current && <ExportPanel {...props} anchor={button.current} onClose={() => setOpen(false)} />}
    </>
  );
}

function ExportPanel<K extends string>({ anchor, onClose, title, note, formats, onExport }: Props<K> & { anchor: HTMLElement; onClose(): void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>(() => {
    const r = anchor.getBoundingClientRect();
    return { left: Math.max(8, r.right - 360), top: r.bottom + 6 };
  });

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = panel.current?.offsetWidth ?? 360;
    setPos({ left: Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)), top: r.bottom + 6 });
  }, [anchor]);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>(".ex-row")?.focus();
  }, []);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    window.addEventListener("mousedown", away, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  const close = () => {
    onClose();
    anchor.focus();
  };
  const rows = () => [...(panel.current?.querySelectorAll<HTMLElement>(".ex-row") ?? [])];

  return createPortal(
    <div
      ref={panel}
      className="ex-panel"
      role="dialog"
      aria-label="Export"
      style={pos}
      onKeyDown={(e) => {
        const list = rows();
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (e.key === "Escape") close();
        else if (e.key === "ArrowDown") list[(i + 1) % list.length]?.focus();
        else if (e.key === "ArrowUp") list[(i - 1 + list.length) % list.length]?.focus();
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="ex-head">
        <span className="ex-title">{title}</span>
        <button className="icon-btn" title="Close" aria-label="Close" onClick={close}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <p className="ex-sub">{note}</p>
      <div className="ex-list">
        {formats.map((f) => (
          <button
            key={f.kind}
            className="ex-row"
            onClick={() => {
              onClose();
              onExport(f.kind);
            }}
          >
            <span className="ex-tile" aria-hidden>
              <Icon name={f.icon} />
            </span>
            <span className="ex-text">
              <span className="ex-name">{f.name}</span>
              <span className="ex-hint">{f.hint}</span>
            </span>
            <Icon name="download" size={16} className="ex-go" />
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
