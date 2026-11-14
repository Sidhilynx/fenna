// The "…" menu of the selection (also the right-click menu): what can be
// done with an artboard, a layer or a note, with the same shortcuts the keys
// have.

import { getAt } from "@opendeck/format";
import { restack, unwrap, wrapIn, type ElementNode } from "@opendeck/artboard";
import { shortcut, type MenuEntry } from "@opendeck/shell";
import { commentOnSelection } from "../commentOn.ts";
import { canPaste, copySelection, cutSelection, deleteSelection, duplicateSelection, editBoard, getState, paste, setFocus, setState } from "../store.ts";

/** Wrap the selected layers in a container that lays them out. */
export function wrapSelection(kind: "column" | "row" | "grid") {
  const sel = getState().selection;
  if (sel?.kind === "layers") editBoard(`Wrap in ${kind}`, sel.file, (root, ctx) => wrapIn(root, sel.addresses, kind, ctx));
}

export function unwrapSelection() {
  const sel = getState().selection;
  if (sel?.kind === "layers" && sel.addresses.length === 1) editBoard("Unwrap", sel.file, (root, ctx) => unwrap(root, sel.addresses[0]!, ctx), { selection: { kind: "boards", files: [sel.file] } });
}

/** Paint order of the selected layer among its siblings. */
export function restackSelection(where: "forward" | "backward") {
  const sel = getState().selection;
  if (sel?.kind === "layers" && sel.addresses.length === 1) editBoard(where === "forward" ? "Bring forward" : "Send backward", sel.file, (root, ctx) => restack(root, sel.addresses[0]!, where, ctx));
}

/** `ai`: the connected assistant's name. */
export function selectionMenu(ai: string): MenuEntry[] {
  const s = getState();
  const sel = s.selection;
  const layers = sel?.kind === "layers" ? sel : null;
  const boards = sel?.kind === "boards" ? sel.files : [];
  const root = layers ? s.boards.get(layers.file)?.doc?.root : null;
  const one = layers?.addresses.length === 1 ? (getAt(root ?? ({ children: [] } as never), layers.addresses[0]!) as ElementNode | null) : null;
  const siblings = one && layers ? ((getAt(root!, layers.addresses[0]!.includes(".") ? layers.addresses[0]!.slice(0, layers.addresses[0]!.lastIndexOf(".")) : "") as ElementNode | null)?.children.filter((c) => c.type === "element").length ?? 1) : 1;
  const at = one && layers ? Number(layers.addresses[0]!.slice(layers.addresses[0]!.lastIndexOf(".") + 1)) : 0;
  const out: MenuEntry[] = [];
  if (boards.length === 1) {
    out.push({ label: "Rename", shortcut: "Enter", onSelect: () => setState({ editing: { kind: "name", file: boards[0]! } }) }, { label: "Open on its own", shortcut: shortcut("Mod+Enter"), onSelect: () => setFocus(boards[0]!) }, "separator");
  }
  out.push(
    { label: "Duplicate", shortcut: shortcut("Mod+D"), disabled: !sel || (!!layers && layers.addresses.length !== 1), onSelect: duplicateSelection },
    { label: "Cut", shortcut: shortcut("Mod+X"), disabled: !sel || sel.kind === "notes", onSelect: cutSelection },
    { label: "Copy", shortcut: shortcut("Mod+C"), disabled: !sel || sel.kind === "notes", onSelect: copySelection },
    { label: "Paste", shortcut: shortcut("Mod+V"), disabled: !canPaste(), onSelect: paste },
  );
  if (layers) {
    out.push(
      "separator",
      { label: "Wrap in column", onSelect: () => wrapSelection("column") },
      { label: "Wrap in row", onSelect: () => wrapSelection("row") },
      { label: "Wrap in grid", onSelect: () => wrapSelection("grid") },
      { label: "Unwrap", disabled: one?.tag !== "div", onSelect: unwrapSelection },
      "separator",
      { label: "Bring forward", shortcut: "]", disabled: !one || at >= siblings - 1, onSelect: () => restackSelection("forward") },
      { label: "Send backward", shortcut: "[", disabled: !one || at <= 0, onSelect: () => restackSelection("backward") },
    );
  }
  if (sel?.kind !== "notes") out.push("separator", { label: "Comment", shortcut: shortcut("Mod+Alt+M"), disabled: !sel, onSelect: commentOnSelection });
  out.push("separator", { label: "Delete", shortcut: shortcut("Backspace"), danger: true, disabled: !sel, onSelect: deleteSelection }, "separator", { label: `Ask ${ai}`, shortcut: shortcut("Mod+K"), onSelect: () => setState({ asking: true }) });
  return out;
}
