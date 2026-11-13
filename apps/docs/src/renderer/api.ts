// Fenna Docs' own calls to its main process, typed, over the shell's bridge
// (@opendeck/shell: tabs and the assistant are the shell's).

import { bridge } from "@opendeck/shell";

export interface DocRef {
  root: string;
  name: string;
  /** Where this doc's images are served: "oddoc://<doc token>/". */
  asset: string;
}

/** A doc from the recent list, as Home shows it. */
export interface RecentDoc {
  root: string;
  name: string;
  title: string;
  /** When its files last changed (ms since epoch). */
  edited: number;
  /** Its doc.json as parsed, or null when missing or broken. */
  index: unknown;
  /** Its first tab's file, for the picture; null when there is none. */
  cover: string | null;
  coverTitle: string;
}

export interface OpendocApi {
  current(): Promise<DocRef | null>;
  /** Pick a folder and open it in this tab. Null if cancelled, or if another tab had it (that tab is shown). */
  choose(): Promise<DocRef | null>;
  recent(): Promise<RecentDoc[]>;
  openPath(root: string): Promise<DocRef | null>;
  openInTab(root: string): Promise<boolean>;
  /** Ask where to create a new doc, write its starter files, open it. Null if cancelled. */
  create(title: string, files: Record<string, string>): Promise<DocRef | null>;
  read(rel: string): Promise<string | null>;
  list(dir: string): Promise<string[]>;
  write(rel: string, text: string): Promise<boolean>;
  /** Delete a tab file (tabs/<id>.html only). */
  remove(rel: string): Promise<boolean>;
  /** Show the file picker; copies chosen images into assets/ and returns their paths. */
  pickImages(): Promise<string[]>;
  /** Copy image bytes (e.g. pasted) into assets/; returns the path. */
  importAsset(name: string, bytes: Uint8Array): Promise<string>;
  onChanged(fn: (paths: string[]) => void): () => void;
  exports: {
    /** Each returns the saved file's path, or null if the user cancelled. */
    pdf(title: string): Promise<string | null>;
    save(title: string, ext: "docx" | "md" | "html", bytes: Uint8Array): Promise<string | null>;
    asset(rel: string): Promise<{ mime: string; bytes: Uint8Array } | null>;
    /** Sent by a hidden print window once everything has rendered. */
    printReady(): void;
  };
}

const call = <T>(channel: string, ...args: unknown[]) => bridge().invoke<T>(channel, ...args);

const calls: OpendocApi = {
  current: () => call("doc:current"),
  choose: () => call("doc:choose"),
  recent: () => call("doc:recent"),
  openPath: (root) => call("doc:openPath", root),
  openInTab: (root) => call("doc:openInTab", root),
  create: (title, files) => call("doc:create", title, files),
  read: (rel) => call("doc:read", rel),
  list: (dir) => call("doc:list", dir),
  write: (rel, text) => call("doc:write", rel, text),
  remove: (rel) => call("doc:remove", rel),
  pickImages: () => call("doc:pickImages"),
  importAsset: (name, bytes) => call("doc:importAsset", name, bytes),
  onChanged: (fn) => bridge().on<string[]>("doc:changed", fn),
  exports: {
    pdf: (title) => call("export:pdf", title),
    save: (title, ext, bytes) => call("export:save", title, ext, bytes),
    asset: (rel) => call("export:asset", rel),
    printReady: () => bridge().send("print:ready"),
  },
};

export const api = (): OpendocApi => calls;

/** Image URL prefix of the open doc; set when a doc opens. */
let assetPrefix = "oddoc://none/";
export const assetBase = (): string => assetPrefix;
export function setAssetBase(prefix: string) {
  assetPrefix = prefix;
}

/** An IPC error as the user should read it. */
export const plainError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
