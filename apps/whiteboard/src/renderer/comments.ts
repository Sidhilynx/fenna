// Comments on the board: a thread points at an item, or at a spot. x and y
// are where it was made, so a thread on an item that is later deleted still
// shows where it was.

import { createCommentsStore, isText, toast, type Thread } from "@opendeck/shell";
import type { BoardAnchor } from "@opendeck/board";
import { api } from "./api.ts";

export type BoardThread = Thread<BoardAnchor>;

const coord = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 10_000_000;

export const comments = createCommentsStore<BoardAnchor>({
  read: (rel) => api().read(rel),
  write: (rel, text) => api().write(rel, text),
  onChanged: (fn) => api().onChanged(fn),
  anchor(raw) {
    const a: BoardAnchor = {};
    if (isText(raw.item, 64)) a.item = raw.item;
    if (coord(raw.x) && coord(raw.y)) {
      a.x = raw.x;
      a.y = raw.y;
    }
    return a.item !== undefined || a.x !== undefined ? a : null;
  },
  context(thread) {
    return thread.item ? { item: thread.item } : { x: thread.x, y: thread.y };
  },
  note: "This comment is on an item of the Fenna Whiteboard board (or a spot on it). Read the item with read_board, make the change it asks for with the Fenna Whiteboard tools, then reply in the thread with comment, saying what you changed in one sentence.",
  toast,
});
