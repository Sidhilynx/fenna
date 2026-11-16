// The "…" menu of the selection (also the right-click menu): what can be
// done with an artboard, a layer or a note, with the same shortcuts the keys
// have.

import { getAt } from "@opendeck/format";
import { restack, setStyles, styleOf, unwrap, wrapIn, type ElementNode } from "@opendeck/artboard";
import { shortcut, type MenuEntry } from "@opendeck/shell";
import { commentOnSelection } from "../commentOn.ts";
import { canPaste, copySelection, cutSelection, deleteSelection, duplicateSelection, editBoard, getState, paste, setFocus, setState } from "../store.ts";
import { layerElement } from "./ArtboardView.tsx";

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
export function restackSelection(where: "forward" | "backward" | "front" | "back") {
  const sel = getState().selection;
  const label = where === "front" ? "Bring to front" : where === "back" ? "Send to back" : where === "forward" ? "Bring forward" : "Send backward";
  if (sel?.kind === "layers" && sel.addresses.length === 1) editBoard(label, sel.file, (root, ctx) => restack(root, sel.addresses[0]!, where, ctx));
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
  const isPinned = one ? styleOf(one, "position") === "absolute" : false;
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
      isPinned
        ? {
            label: "Put back in layout",
            hint: "Flows with the artboard again",
            onSelect: () =>
              editBoard("Put back in layout", layers.file, (r, ctx) =>
                setStyles(r, layers.addresses[0]!, { position: null, left: null, top: null, right: null, bottom: null }, ctx)
              ),
          }
        : {
            label: "Pin in place",
            hint: "Move it freely on artboard",
            onSelect: () => {
              const dom = layerElement(layers.file, layers.addresses[0]!);
              const hostEl = document.querySelector<HTMLElement>(`[data-file="${layers.file}"]`);
              if (dom && hostEl) {
                const ar = hostEl.getBoundingClientRect();
                const er = dom.getBoundingClientRect();
                const zoom = getState().view.zoom;
                const left = Math.round((er.left - ar.left) / zoom);
                const top = Math.round((er.top - ar.top) / zoom);
                const width = Math.round(er.width / zoom);
                editBoard("Pin in place", layers.file, (r, ctx) =>
                  setStyles(r, layers.addresses[0]!, {
                    position: "absolute",
                    left: `${left}px`,
                    top: `${top}px`,
                    width: `${width}px`,
                    right: null,
                    bottom: null,
                  }, ctx)
                );
              }
            },
          },
      "separator",
      { label: "Wrap in column", onSelect: () => wrapSelection("column") },
      { label: "Wrap in row", onSelect: () => wrapSelection("row") },
      { label: "Wrap in grid", onSelect: () => wrapSelection("grid") },
      { label: "Unwrap", disabled: one?.tag !== "div", onSelect: unwrapSelection },
      "separator",
      { label: "Bring to front", shortcut: shortcut("Mod+Shift+]"), disabled: !one || at >= siblings - 1, onSelect: () => restackSelection("front") },
      { label: "Bring forward", shortcut: "]", disabled: !one || at >= siblings - 1, onSelect: () => restackSelection("forward") },
      { label: "Send backward", shortcut: "[", disabled: !one || at <= 0, onSelect: () => restackSelection("backward") },
      { label: "Send to back", shortcut: shortcut("Mod+Shift+["), disabled: !one || at <= 0, onSelect: () => restackSelection("back") },
    );
  }
  if (sel?.kind !== "notes") out.push("separator", { label: "Comment", shortcut: shortcut("Mod+Alt+M"), disabled: !sel, onSelect: commentOnSelection });
  out.push("separator", { label: "Delete", shortcut: shortcut("Backspace"), danger: true, disabled: !sel, onSelect: deleteSelection }, "separator", { label: `Ask ${ai}`, shortcut: shortcut("Mod+K"), onSelect: () => setState({ asking: true }) });
  return out;
}
