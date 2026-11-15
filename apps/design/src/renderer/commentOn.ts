// Starting a comment on what is selected.

import { snippetOf } from "@opendeck/format";
import { toast } from "@opendeck/shell";
import { comments } from "./comments.ts";
import { getState, selectedFile, setState, target } from "./store.ts";

/** Open the comment box on the selected layer, or on the selected artboard. */
export function commentOnSelection() {
  const file = selectedFile();
  if (!file) {
    toast("Select an artboard or a layer to comment on.");
    return;
  }
  const t = target();
  const layer = t && t.address && getState().selection?.kind === "layers" ? t : null;
  comments.draft({ file, addr: layer?.address ?? "", snippet: layer ? snippetOf(layer.el) : "" });
  setState({ panel: "comments", tool: "select" });
}
