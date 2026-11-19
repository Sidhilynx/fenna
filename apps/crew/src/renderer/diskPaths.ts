// Pure helpers for the bot's disk: disk paths ("Files/notes/a.txt"), sorting,
// selection, name filters, sizes and names. No DOM, so they are tested alone.

import { DISK_ROOTS, type DiskEntry, type DiskRoot, type FileKind } from "../shared/contract.ts";

/** Disk paths use "/" whatever the computer. */
export function joinPath(dir: string, name: string): string {
  return `${dir}/${name}`;
}

export function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

/** The folder a path sits in, or null for a top folder. */
export function parentOf(path: string): string | null {
  const i = path.lastIndexOf("/");
  return i < 0 ? null : path.slice(0, i);
}

/** The top folder a path is under ("Documents/q3" is under "Documents"). */
export function rootOf(path: string): string {
  const i = path.indexOf("/");
  return i < 0 ? path : path.slice(0, i);
}

export function isDiskRoot(path: string): path is DiskRoot {
  return (DISK_ROOTS as readonly string[]).includes(path);
}

/** True when `path` is `folder` or lies inside it. */
export function isUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

export interface Crumb {
  label: string;
  path: string;
}

/** Clickable segments from the top folder down to `path`. */
export function crumbsFor(path: string): Crumb[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((label, i) => ({ label, path: parts.slice(0, i + 1).join("/") }));
}

/**
 * Whether the paths can be dropped on a folder. Nothing goes into itself or
 * into its own folder; a move to the folder it is already in does nothing.
 */
export function canDrop(paths: readonly string[], target: string, mode: "move" | "copy"): boolean {
  if (!paths.length) return false;
  if (paths.some((p) => isUnder(target, p))) return false;
  if (mode === "move" && paths.every((p) => parentOf(p) === target)) return false;
  return true;
}

export type SortKey = "name" | "kind" | "size" | "edited";
export interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

/** Folders first, then by the key. Names compare with numbers in order ("2" before "10"). */
export function sortEntries(entries: readonly DiskEntry[], sort: Sort): DiskEntry[] {
  const byName = (a: DiskEntry, b: DiskEntry) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  const value = (a: DiskEntry, b: DiskEntry): number => {
    switch (sort.key) {
      case "name":
        return byName(a, b);
      case "kind":
        return kindLabel(a.kind).localeCompare(kindLabel(b.kind)) || byName(a, b);
      case "size":
        return a.size - b.size || byName(a, b);
      case "edited":
        return Date.parse(a.edited) - Date.parse(b.edited) || byName(a, b);
    }
  };
  return [...entries].sort((a, b) => {
    const folders = Number(b.kind === "folder") - Number(a.kind === "folder");
    return folders || sort.dir * value(a, b);
  });
}

/** Entries whose name holds the query, ignoring case. An empty query keeps all. */
export function filterEntries(entries: readonly DiskEntry[], query: string): DiskEntry[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...entries];
  return entries.filter((e) => e.name.toLocaleLowerCase().includes(q));
}

/** The paths from the anchor to the target, both included, in the order shown. */
export function selectRange(order: readonly string[], anchor: string, target: string): string[] {
  const a = order.indexOf(anchor);
  const t = order.indexOf(target);
  if (a < 0 || t < 0) return [target];
  const [lo, hi] = a < t ? [a, t] : [t, a];
  return order.slice(lo, hi + 1);
}

/** Moves a selection by one step (arrows); stays put at the ends. */
export function stepIndex(count: number, index: number, by: number): number {
  if (count <= 0) return -1;
  return Math.min(count - 1, Math.max(0, index + by));
}

const UNITS = ["KB", "MB", "GB", "TB"];

/** 0 B, 512 B, 1.2 KB, 340 MB, 1.2 GB. Binary units. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const shown = v < 10 ? Number(v.toFixed(1)) : Math.round(v);
  return `${shown} ${UNITS[i]}`;
}

/** A quota in GB, for the usage line: "5 GB". */
export function formatGb(gb: number): string {
  return `${gb} GB`;
}

/** A short date and time for the list: "Nov 19, 2:05 PM". Empty when the time does not parse. */
export function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const KIND_LABEL: Record<FileKind, string> = {
  folder: "Folder",
  doc: "Document",
  sheet: "Sheet",
  deck: "Slides",
  board: "Whiteboard",
  design: "Design",
  image: "Image",
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  text: "Text",
  code: "Code",
  archive: "Archive",
  other: "File",
};

export function kindLabel(kind: FileKind): string {
  return KIND_LABEL[kind];
}

const MAX_NAME = 200;
const BAD_NAME = /[\\/\u0000-\u001f]/;

/** Why a file or folder name can't be used, or null when it can. */
export function nameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return "Give it a name.";
  if (n === "." || n === "..") return "That name is taken by the system. Pick another.";
  if (BAD_NAME.test(n)) return "Names can't contain / or \\.";
  if (n.length > MAX_NAME) return `Names are at most ${MAX_NAME} characters.`;
  return null;
}

/** "New folder", then "New folder 2", "New folder 3"... not used in the folder. */
export function nextFolderName(existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.toLocaleLowerCase()));
  if (!taken.has("new folder")) return "New folder";
  for (let i = 2; ; i++) {
    const name = `New folder ${i}`;
    if (!taken.has(name.toLocaleLowerCase())) return name;
  }
}

/** "3 items", "1 item, 1 selected". */
export function countWords(count: number, selected: number): string {
  const items = `${count} ${count === 1 ? "item" : "items"}`;
  return selected > 0 ? `${items}, ${selected} selected` : items;
}
