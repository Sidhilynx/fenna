// The bot's disk icons: 16 by 16 pixel art in colour (the bot's computer is
// allowed colour; Crew's own chrome stays monochrome). Each grid uses only the
// palette keys below; FileIcon.tsx colours a key by its class (fi-*), and the
// hues live as CSS variables in styles.css, both themes.
import type { FennaAppId } from "@opendeck/crew";
import type { DesktopApp, DiskRoot, FileKind } from "../shared/contract.ts";

/** Palette keys: k ink, w paper, l and m greys, then hue pairs (light, dark). */
export const PX_CLASS = {
  k: "fi-ink",
  w: "fi-paper",
  l: "fi-grey-light",
  m: "fi-grey",
  b: "fi-blue",
  B: "fi-blue-dark",
  n: "fi-green",
  N: "fi-green-dark",
  a: "fi-amber",
  A: "fi-amber-dark",
  r: "fi-red",
  R: "fi-red-dark",
  p: "fi-pink",
  P: "fi-pink-dark",
  v: "fi-violet",
  V: "fi-violet-dark",
  t: "fi-teal",
  T: "fi-teal-dark",
} as const;

export type PxKey = keyof typeof PX_CLASS;

export const FILE_ICON_NAMES = [
  "folder", "folder-open", "documents", "downloads", "trash", "trash-full", "drive",
  "doc", "sheet", "deck", "board", "design", "image", "video", "audio", "pdf", "text", "code", "archive", "other",
  "browser", "files", "terminal", "clock", "activity", "connectors", "fenna-docs", "fenna-sheets", "fenna-slides", "fenna-whiteboard", "fenna-design",
] as const;
export type FileIconName = (typeof FILE_ICON_NAMES)[number];

const SIZE = 16;

/** A 16 by 16 canvas of palette keys; '.' is empty. Rectangles are clipped to the canvas. */
class Canvas {
  private cells: string[][] = Array.from({ length: SIZE }, () => Array<string>(SIZE).fill("."));

  fill(k: PxKey, x: number, y: number, w: number, h: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.put(k, xx, yy);
  }

  /** A 1px outline of a rectangle. */
  frame(k: PxKey, x: number, y: number, w: number, h: number): void {
    this.fill(k, x, y, w, 1);
    this.fill(k, x, y + h - 1, w, 1);
    this.fill(k, x, y, 1, h);
    this.fill(k, x + w - 1, y, 1, h);
  }

  rows(): string[] {
    return this.cells.map((row) => row.join(""));
  }

  private put(k: PxKey, x: number, y: number): void {
    const row = this.cells[y];
    if (row && x >= 0 && x < SIZE) row[x] = k;
  }
}

type Draw = (c: Canvas) => void;

/** The window tile the app icons sit on: a grey edge, paper inside. */
function tile(c: Canvas): void {
  c.frame("m", 0, 0, SIZE, SIZE);
  c.fill("w", 1, 1, 14, 14);
}

/** A folder body: a tab, the back and the front face. */
function folderBody(c: Canvas): void {
  c.fill("A", 1, 3, 6, 2);
  c.fill("A", 1, 4, 14, 10);
  c.fill("a", 1, 6, 14, 7);
}

const DRAW: Record<FileIconName, Draw> = {
  folder: folderBody,
  "folder-open": (c) => {
    folderBody(c);
    c.fill("w", 3, 4, 9, 2);
    c.fill("a", 1, 6, 14, 7);
  },
  documents: (c) => {
    c.fill("A", 1, 3, 6, 2);
    c.fill("A", 1, 4, 14, 10);
    c.fill("w", 4, 1, 8, 10);
    c.fill("m", 6, 3, 4, 1);
    c.fill("m", 6, 5, 4, 1);
    c.fill("a", 1, 6, 14, 7);
  },
  downloads: (c) => {
    folderBody(c);
    c.fill("b", 7, 4, 2, 3);
    c.fill("B", 5, 7, 6, 1);
    c.fill("B", 6, 8, 4, 1);
    c.fill("B", 7, 9, 2, 1);
  },
  trash: (c) => {
    c.fill("m", 2, 3, 12, 2);
    c.fill("m", 6, 2, 4, 1);
    c.fill("m", 4, 5, 8, 10);
    c.fill("l", 6, 6, 1, 7);
    c.fill("l", 9, 6, 1, 7);
  },
  "trash-full": (c) => {
    c.fill("w", 5, 0, 4, 3);
    c.fill("m", 2, 3, 12, 2);
    c.fill("m", 4, 5, 8, 10);
    c.fill("l", 6, 6, 1, 7);
    c.fill("l", 9, 6, 1, 7);
  },
  drive: (c) => {
    c.fill("m", 1, 4, 14, 9);
    c.fill("l", 2, 5, 12, 4);
    c.fill("n", 11, 11, 2, 1);
    c.fill("b", 3, 11, 4, 1);
  },
  doc: (c) => {
    c.fill("b", 3, 1, 10, 14);
    c.fill("B", 3, 1, 10, 1);
    c.fill("w", 5, 4, 6, 1);
    c.fill("w", 5, 6, 6, 1);
    c.fill("w", 5, 8, 6, 1);
    c.fill("w", 5, 10, 4, 1);
  },
  sheet: (c) => {
    c.fill("w", 2, 2, 12, 12);
    c.fill("n", 2, 2, 12, 3);
    c.fill("N", 2, 7, 12, 1);
    c.fill("N", 2, 10, 12, 1);
    c.fill("N", 6, 5, 1, 9);
    c.fill("N", 10, 5, 1, 9);
    c.frame("N", 2, 2, 12, 12);
  },
  deck: (c) => {
    c.frame("A", 1, 2, 14, 10);
    c.fill("a", 2, 3, 12, 8);
    c.fill("w", 4, 5, 8, 1);
    c.fill("w", 4, 7, 6, 1);
    c.fill("A", 7, 12, 2, 2);
    c.fill("A", 4, 14, 8, 1);
  },
  board: (c) => {
    c.fill("v", 1, 1, 7, 7);
    c.fill("V", 1, 7, 7, 1);
    c.fill("v", 8, 4, 7, 7);
    c.fill("V", 8, 10, 7, 1);
    c.fill("v", 4, 9, 7, 6);
    c.fill("V", 4, 14, 7, 1);
    c.fill("w", 2, 3, 4, 1);
    c.fill("w", 9, 6, 4, 1);
    c.fill("w", 5, 11, 4, 1);
  },
  design: (c) => {
    c.frame("p", 1, 1, 14, 14);
    c.fill("P", 6, 4, 4, 3);
    c.fill("P", 7, 7, 2, 3);
    c.fill("k", 7, 10, 2, 1);
    c.fill("w", 8, 5, 1, 4);
  },
  image: (c) => {
    c.fill("b", 1, 2, 14, 9);
    c.fill("a", 10, 4, 2, 2);
    c.fill("n", 3, 7, 3, 1);
    c.fill("n", 2, 8, 5, 1);
    c.fill("n", 1, 9, 7, 1);
    c.fill("n", 1, 10, 9, 1);
    c.fill("N", 1, 11, 14, 3);
  },
  video: (c) => {
    c.fill("r", 1, 3, 14, 10);
    for (const y of [4, 7, 10]) {
      c.fill("w", 2, y, 1, 1);
      c.fill("w", 13, y, 1, 1);
    }
    c.fill("R", 4, 5, 8, 6);
    c.fill("w", 7, 6, 1, 4);
    c.fill("w", 8, 7, 1, 2);
  },
  audio: (c) => {
    c.fill("b", 2, 10, 5, 3);
    c.fill("B", 6, 2, 1, 11);
    c.fill("B", 7, 2, 2, 1);
    c.fill("B", 9, 3, 1, 2);
  },
  pdf: (c) => {
    c.fill("w", 2, 1, 12, 14);
    c.frame("m", 2, 1, 12, 14);
    c.fill("l", 4, 3, 8, 1);
    c.fill("l", 4, 4, 6, 1);
    c.fill("r", 2, 6, 12, 5);
    c.fill("w", 4, 8, 8, 1);
  },
  text: (c) => {
    c.fill("w", 3, 1, 10, 14);
    c.frame("m", 3, 1, 10, 14);
    c.fill("k", 5, 4, 6, 1);
    c.fill("k", 5, 6, 6, 1);
    c.fill("k", 5, 8, 6, 1);
    c.fill("k", 5, 10, 4, 1);
  },
  code: (c) => {
    c.fill("v", 3, 3, 3, 1);
    c.fill("v", 3, 3, 1, 10);
    c.fill("v", 3, 12, 3, 1);
    c.fill("v", 10, 3, 3, 1);
    c.fill("v", 12, 3, 1, 10);
    c.fill("v", 10, 12, 3, 1);
    c.fill("V", 7, 7, 2, 2);
  },
  archive: (c) => {
    c.fill("t", 2, 3, 12, 3);
    c.fill("T", 3, 6, 10, 8);
    c.fill("w", 7, 6, 2, 8);
    c.fill("k", 7, 7, 2, 1);
    c.fill("k", 7, 9, 2, 1);
    c.fill("k", 7, 11, 2, 1);
  },
  other: (c) => {
    c.fill("l", 3, 1, 10, 14);
    c.frame("m", 3, 1, 10, 14);
    c.fill("m", 5, 5, 6, 1);
    c.fill("m", 5, 8, 4, 1);
  },
  browser: (c) => {
    tile(c);
    c.fill("m", 1, 1, 14, 2);
    c.fill("b", 5, 5, 6, 8);
    c.fill("b", 4, 6, 8, 6);
    c.fill("n", 6, 7, 2, 2);
    c.fill("n", 9, 9, 2, 2);
  },
  files: (c) => {
    tile(c);
    c.fill("A", 3, 4, 5, 2);
    c.fill("A", 3, 5, 10, 8);
    c.fill("a", 3, 7, 10, 6);
  },
  terminal: (c) => {
    tile(c);
    c.fill("k", 2, 3, 12, 10);
    c.fill("n", 4, 5, 1, 1);
    c.fill("n", 5, 6, 1, 1);
    c.fill("n", 6, 7, 1, 1);
    c.fill("n", 5, 8, 1, 1);
    c.fill("n", 4, 9, 1, 1);
    c.fill("N", 8, 10, 4, 1);
  },
  clock: (c) => {
    tile(c);
    c.fill("w", 5, 2, 6, 12);
    c.fill("w", 3, 4, 10, 8);
    c.fill("w", 4, 3, 8, 10);
    c.frame("t", 4, 3, 8, 10);
    c.fill("t", 3, 5, 1, 6);
    c.fill("t", 12, 5, 1, 6);
    c.fill("T", 5, 2, 6, 1);
    c.fill("T", 5, 13, 6, 1);
    c.fill("k", 8, 5, 1, 4);
    c.fill("k", 9, 8, 2, 1);
    c.fill("r", 8, 8, 1, 1);
  },
  activity: (c) => {
    tile(c);
    c.fill("n", 3, 9, 3, 3);
    c.fill("n", 6, 6, 3, 6);
    c.fill("N", 9, 4, 3, 8);
  },
  connectors: (c) => {
    tile(c);
    c.fill("m", 5, 3, 1, 4);
    c.fill("m", 10, 3, 1, 4);
    c.fill("v", 4, 6, 8, 4);
    c.fill("V", 4, 9, 8, 1);
    c.fill("m", 7, 10, 2, 3);
  },
  "fenna-docs": (c) => {
    tile(c);
    c.fill("b", 5, 4, 6, 8);
    c.fill("w", 6, 6, 4, 1);
    c.fill("w", 6, 8, 4, 1);
    c.fill("w", 6, 10, 3, 1);
  },
  "fenna-sheets": (c) => {
    tile(c);
    c.fill("n", 4, 4, 8, 2);
    c.fill("w", 4, 6, 8, 6);
    c.fill("N", 4, 7, 8, 1);
    c.fill("N", 7, 6, 1, 6);
    c.frame("N", 4, 4, 8, 8);
  },
  "fenna-slides": (c) => {
    tile(c);
    c.frame("A", 3, 4, 10, 7);
    c.fill("a", 4, 5, 8, 5);
    c.fill("w", 5, 6, 6, 1);
    c.fill("w", 5, 8, 4, 1);
    c.fill("A", 7, 11, 2, 1);
    c.fill("A", 5, 12, 6, 1);
  },
  "fenna-whiteboard": (c) => {
    tile(c);
    c.fill("v", 4, 4, 4, 4);
    c.fill("V", 4, 7, 4, 1);
    c.fill("v", 9, 6, 4, 4);
    c.fill("V", 9, 9, 4, 1);
    c.fill("w", 5, 5, 2, 1);
  },
  "fenna-design": (c) => {
    tile(c);
    c.frame("p", 3, 3, 10, 10);
    c.fill("P", 6, 5, 4, 3);
    c.fill("P", 7, 8, 2, 3);
    c.fill("k", 7, 11, 2, 1);
    c.fill("w", 8, 6, 1, 4);
  },
};

function build(): Record<FileIconName, readonly string[]> {
  const out = {} as Record<FileIconName, readonly string[]>;
  for (const name of FILE_ICON_NAMES) {
    const c = new Canvas();
    DRAW[name](c);
    out[name] = c.rows();
  }
  return out;
}

/** Every icon as 16 rows of palette keys. */
export const FILE_ICONS: Record<FileIconName, readonly string[]> = build();

const BY_KIND: Record<FileKind, FileIconName> = {
  folder: "folder",
  doc: "doc",
  sheet: "sheet",
  deck: "deck",
  board: "board",
  design: "design",
  image: "image",
  video: "video",
  audio: "audio",
  pdf: "pdf",
  text: "text",
  code: "code",
  archive: "archive",
  other: "other",
};

/** The icon for an entry of this kind. */
export function fileIconFor(kind: FileKind): FileIconName {
  return BY_KIND[kind];
}

const ROOT: Record<DiskRoot, FileIconName> = {
  Files: "folder",
  Documents: "documents",
  Downloads: "downloads",
  Trash: "trash",
};

/** The icon for a top folder in the sidebar. */
export function rootIconFor(root: DiskRoot): FileIconName {
  return ROOT[root];
}

const APP: Record<DesktopApp | FennaAppId, FileIconName> = {
  browser: "browser",
  files: "files",
  library: "documents",
  terminal: "terminal",
  activity: "activity",
  clock: "clock",
  connectors: "connectors",
  trash: "trash",
  "fenna-docs": "fenna-docs",
  "fenna-sheets": "fenna-sheets",
  "fenna-slides": "fenna-slides",
  "fenna-whiteboard": "fenna-whiteboard",
  "fenna-design": "fenna-design",
};

/** The icon for a desktop app or a built-in Fenna app. */
export function appIconFor(id: DesktopApp | FennaAppId): FileIconName {
  return APP[id];
}
