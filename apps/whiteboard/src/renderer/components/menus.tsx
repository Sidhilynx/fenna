// The "…" menu of the selection (also the right-click menu): the same items,
// order and shortcuts as the reference.

import { shortcut, type MenuEntry } from "@opendeck/shell";
import {
  canGroup,
  canPaste,
  canReorder,
  canTidy,
  canUngroup,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  group,
  pasteFromClipboard,
  reorder,
  selectedItems,
  setState,
  tidyUp,
  toggleLock,
  ungroup,
} from "../store.ts";

/** `ai`: the connected assistant's name. */
export function itemMenu(ai: string): MenuEntry[] {
  const sel = selectedItems();
  const one = sel.length === 1 ? sel[0]! : null;
  const locked = sel.length > 0 && sel.every((it) => it.locked);
  const link = one && "link" in one && one.link ? one.link : null;
  const out: MenuEntry[] = [];
  if (link) {
    out.push({ label: "Open link", hint: link.length > 48 ? `${link.slice(0, 47)}…` : link, onSelect: () => window.open(link, "_blank", "noopener") });
  }
  if (one?.kind === "frame") out.push({ label: "Rename", disabled: locked, onSelect: () => setState({ editing: { id: one.id } }) });
  out.push(
    { label: locked ? "Unlock" : "Lock", shortcut: shortcut("Mod+Shift+L"), disabled: !sel.length, onSelect: toggleLock },
    "separator",
    { label: "Cut", shortcut: shortcut("Mod+X"), disabled: !sel.length || locked, onSelect: cutSelection },
    { label: "Copy", shortcut: shortcut("Mod+C"), disabled: !sel.length, onSelect: copySelection },
    { label: "Paste", shortcut: shortcut("Mod+V"), disabled: !canPaste(), onSelect: () => void pasteFromClipboard() },
    { label: "Duplicate", shortcut: shortcut("Mod+D"), disabled: !sel.length, onSelect: duplicateSelection },
    "separator",
    { label: "Bring to front", shortcut: "]", disabled: !canReorder(true), onSelect: () => reorder(true) },
    { label: "Send to back", shortcut: "[", disabled: !canReorder(false), onSelect: () => reorder(false) },
    { label: "Group", shortcut: shortcut("Mod+G"), disabled: !canGroup(), onSelect: group },
    { label: "Ungroup", shortcut: shortcut("Mod+Shift+G"), disabled: !canUngroup(), onSelect: ungroup },
    { label: "Tidy up", disabled: !canTidy(), onSelect: tidyUp },
    "separator",
    { label: "Delete", shortcut: shortcut("Backspace"), danger: true, disabled: !sel.length || locked, onSelect: deleteSelection },
    "separator",
    { label: `Ask ${ai}`, shortcut: shortcut("Mod+K"), onSelect: () => setState({ asking: true }) },
  );
  return out;
}

