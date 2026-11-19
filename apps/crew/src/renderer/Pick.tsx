// A labelled dropdown button: the picker for CLI, model, effort and the like.

import { MenuButton, type MenuEntry } from "@opendeck/shell";
import { Glyph } from "./Glyph.tsx";

export function Pick({ label, value, entries, disabled }: { label: string; value: string; entries: MenuEntry[]; disabled?: boolean }) {
  return (
    <div className={`pick${disabled ? " off" : ""}`}>
      <span className="pick-label">{label}</span>
      {disabled ? (
        <span className="pick-value">{value}</span>
      ) : (
        <MenuButton className="btn pick-btn" label={`${label}: ${value}`} entries={entries}>
          <span className="ell">{value}</span>
          <Glyph name="chevron" size={12} />
        </MenuButton>
      )}
    </div>
  );
}
