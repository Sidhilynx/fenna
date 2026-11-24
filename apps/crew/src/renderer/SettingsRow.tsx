// One row of a settings section: the name and an optional sub line on the left, one control on the right.

import type { ReactNode } from "react";

export function Row({ name, sub, children, htmlFor }: { name: string; sub?: ReactNode; children?: ReactNode; htmlFor?: string }) {
  const meta = (
    <div className="settings-meta">
      <span className="settings-name">{name}</span>
      {sub ? <span className="settings-sub">{sub}</span> : null}
    </div>
  );
  if (htmlFor !== undefined) {
    return (
      <label className="settings-row" htmlFor={htmlFor}>
        {meta}
        <div className="settings-ctrl">{children}</div>
      </label>
    );
  }
  return (
    <div className="settings-row">
      {meta}
      {children ? <div className="settings-ctrl">{children}</div> : null}
    </div>
  );
}
