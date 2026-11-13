// A modal dialog: traps focus, closes on Esc and backdrop click, returns
// focus to where it was.

import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons.tsx";

export function Dialog({ title, onClose, children, width = 560 }: { title: string; onClose(): void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current?.querySelector<HTMLElement>(".dialog-body button, .dialog-body input, .dialog-body [tabindex='0']");
    first?.focus();
    return () => prev?.focus();
  }, []);
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal
        aria-label={title}
        style={{ width }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          } else if (e.key === "Tab") {
            const f = [...(ref.current?.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex='0']") ?? [])].filter((x) => !x.hasAttribute("disabled"));
            if (!f.length) return;
            const i = f.indexOf(document.activeElement as HTMLElement);
            const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 ? 0 : i + 1;
            f[next]!.focus();
            e.preventDefault();
          }
        }}
      >
        <header className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
