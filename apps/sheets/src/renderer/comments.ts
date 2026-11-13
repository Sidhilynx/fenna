// Comments store for Fenna Sheets, anchored on { sheetId, range }.

import { createCommentsStore, isText, toast, type Thread } from "@opendeck/shell";
import { api } from "./api.ts";

export interface SheetAnchor {
  sheetId: string;
  range: string;
}

export type SheetThread = Thread<SheetAnchor>;

export const comments = createCommentsStore<SheetAnchor>({
  read: (rel) => api().read(rel),
  write: (rel, text) => api().write(rel, text),
  onChanged: (fn) => api().onChanged(fn),
  anchor(raw) {
    if (!isText(raw.sheetId, 80) || !isText(raw.range, 40)) return null;
    return { sheetId: raw.sheetId, range: raw.range };
  },
  context(thread) {
    return { sheetId: thread.sheetId, range: thread.range };
  },
  note: "This comment is attached to a cell or range in Fenna Sheets. Inspect it with read_sheet and apply requested edits with write_cells, then reply concisely.",
  toast,
});

