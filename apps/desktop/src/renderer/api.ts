// Fenna Slides' own calls to its main process, typed, over the shell's bridge
// (@opendeck/shell: tabs and the assistant are the shell's).

import { bridge } from "@opendeck/shell";

export interface DeckRef {
  root: string;
  name: string;
  /** Where this deck's assets are served: "odasset://<deck token>/". */
  asset: string;
}

/** A deck from the recent list, as Home shows it. */
export interface RecentDeck {
  root: string;
  name: string;
  title: string;
  /** When its files last changed (ms since epoch). */
  edited: number;
  /** Its deck.json as parsed, or null when missing or broken. */
  index: unknown;
  /** Its first slide's file, for the picture; null when there is none. */
  cover: string | null;
}

export interface OpendeckApi {
  current(): Promise<DeckRef | null>;
  /** Pick a folder and open it in this tab. Null if cancelled, or if another tab had it (that tab is shown). */
  choose(): Promise<DeckRef | null>;
  /** Recently opened decks, newest first. */
  recent(): Promise<RecentDeck[]>;
  /** Reopen a deck from the recent list in this tab (null: another tab had it, and is shown). */
  openPath(root: string): Promise<DeckRef | null>;
  /** Open a deck from the recent list in a new tab. */
  openInTab(root: string): Promise<boolean>;
  /** Ask where to create a new deck, write its starter files, open it. Null if cancelled. */
  create(title: string, files: Record<string, string>): Promise<DeckRef | null>;
  read(rel: string): Promise<string | null>;
  list(dir: string): Promise<string[]>;
  write(rel: string, text: string): Promise<boolean>;
  /** Delete a slide file (slides/<id>.html only). */
  remove(rel: string): Promise<boolean>;
  /** Show the file picker; copies chosen images into assets/ and returns their paths. */
  pickImages(): Promise<string[]>;
  /** Copy image bytes (e.g. pasted) into assets/; returns the path. */
  importAsset(name: string, bytes: Uint8Array): Promise<string>;
  onChanged(fn: (paths: string[]) => void): () => void;
  exports: {
    /** Each returns the saved file's path, or null if the user cancelled. */
    pdf(title: string): Promise<string | null>;
    png(title: string, index: number): Promise<string | null>;
    save(title: string, ext: "html" | "pptx", bytes: Uint8Array): Promise<string | null>;
    assetData(rel: string): Promise<string | null>;
    /** Sent by a hidden print window once everything has rendered. */
    printReady(): void;
  };
}

const call = <T>(channel: string, ...args: unknown[]) => bridge().invoke<T>(channel, ...args);

/** Fenna Slides' calls to its main process (main.cjs), over the shell's bridge. */
const calls: OpendeckApi = {
  current: () => call("deck:current"),
  choose: () => call("deck:choose"),
  recent: () => call("deck:recent"),
  openPath: (root) => call("deck:openPath", root),
  openInTab: (root) => call("deck:openInTab", root),
  create: (title, files) => call("deck:create", title, files),
  read: (rel) => call("deck:read", rel),
  list: (dir) => call("deck:list", dir),
  write: (rel, text) => call("deck:write", rel, text),
  remove: (rel) => call("deck:remove", rel),
  pickImages: () => call("deck:pickImages"),
  importAsset: (name, bytes) => call("deck:importAsset", name, bytes),
  onChanged: (fn) => bridge().on<string[]>("deck:changed", fn),
  exports: {
    pdf: (title) => call("export:pdf", title),
    png: (title, index) => call("export:png", title, index),
    save: (title, ext, bytes) => call("export:save", title, ext, bytes),
    assetData: (rel) => call("export:assetData", rel),
    printReady: () => bridge().send("print:ready"),
  },
};

export const api = (): OpendeckApi => calls;

/** Asset URL prefix of the open deck; set when a deck opens (each tab's deck has its own). */
let assetPrefix = "odasset://none/";
export const assetBase = (): string => assetPrefix;
export function setAssetBase(prefix: string) {
  assetPrefix = prefix;
}
