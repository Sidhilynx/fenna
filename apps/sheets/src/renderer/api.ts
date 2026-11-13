// Fenna Sheets' typed IPC calls over @opendeck/shell's bridge.

import { bridge } from "@opendeck/shell";

export interface SheetFolderRef {
  root: string;
  name: string;
  asset: string;
}

export interface RecentSheet {
  root: string;
  name: string;
  title: string;
  edited: number;
  index: unknown;
  cover: unknown;
}

export interface OpensheetApi {
  current(): Promise<SheetFolderRef | null>;
  choose(): Promise<SheetFolderRef | null>;
  recent(): Promise<RecentSheet[]>;
  openPath(root: string): Promise<SheetFolderRef | null>;
  openInTab(root: string): Promise<boolean>;
  create(title: string, files: Record<string, string>): Promise<SheetFolderRef | null>;
  read(rel: string): Promise<string | null>;
  list(dir: string): Promise<string[]>;
  write(rel: string, text: string): Promise<boolean>;
  remove(rel: string): Promise<boolean>;
  onChanged(fn: (paths: string[]) => void): () => void;
  exports: {
    save(title: string, ext: "xlsx" | "csv", bytes: Uint8Array): Promise<string | null>;
    pickImport(kind: "xlsx" | "csv"): Promise<{ name: string; bytes: Uint8Array } | null>;
  };
}

const call = <T>(channel: string, ...args: unknown[]) => bridge().invoke<T>(channel, ...args);

const calls: OpensheetApi = {
  current: () => call("sheet:current"),
  choose: () => call("sheet:choose"),
  recent: () => call("sheet:recent"),
  openPath: (root) => call("sheet:openPath", root),
  openInTab: (root) => call("sheet:openInTab", root),
  create: (title, files) => call("sheet:create", title, files),
  read: (rel) => call("sheet:read", rel),
  list: (dir) => call("sheet:list", dir),
  write: (rel, text) => call("sheet:write", rel, text),
  remove: (rel) => call("sheet:remove", rel),
  onChanged: (fn) => bridge().on<string[]>("sheet:changed", fn),
  exports: {
    save: (title, ext, bytes) => call("sheetExport:save", title, ext, bytes),
    pickImport: (kind) => call("sheetImport:pick", kind),
  },
};

export const api = (): OpensheetApi => calls;

export const plainError = (e: unknown) =>
  (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

