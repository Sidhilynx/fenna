// What a comment thread points at: an artboard, and maybe one layer on it.
// `addr` is where the layer was and `snippet` its words then, so the thread
// follows the layer when others are added or removed around it (the format
// package's `anchorOf` finds it again).

import { FILE_RE } from "./schema.ts";

export interface DesignAnchor {
  /** The artboard's file name. */
  file: string;
  /** The layer's address when the thread was made; "" is the whole artboard. */
  addr: string;
  snippet: string;
}

/** A stored thread's anchor fields, checked; null drops the thread. */
export function designAnchor(t: Record<string, unknown>): DesignAnchor | null {
  if (typeof t.file !== "string" || !FILE_RE.test(t.file)) return null;
  const addr = typeof t.addr === "string" && /^(\d+(\.\d+)*)?$/.test(t.addr) ? t.addr : "";
  return { file: t.file, addr, snippet: typeof t.snippet === "string" ? t.snippet.slice(0, 200) : "" };
}
