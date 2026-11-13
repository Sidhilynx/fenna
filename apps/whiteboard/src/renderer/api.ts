// Fenna Whiteboard's calls to its main process, over @opendeck/shell's bridge.

import { bridge } from "@opendeck/shell";

export interface BoardFolderRef {
  root: string;
  name: string;
  /** Where this board's images are served: "odboard://<token>/". */
  asset: string;
}

export interface RecentBoard {
  root: string;
  name: string;
  title: string;
  edited: number;
  index: unknown;
  cover: unknown;
}

const call = <T>(channel: string, ...args: unknown[]) => bridge().invoke<T>(channel, ...args);

export interface OpenboardApi {
  current(): Promise<BoardFolderRef | null>;
  choose(): Promise<BoardFolderRef | null>;
  recent(): Promise<RecentBoard[]>;
  openPath(root: string): Promise<BoardFolderRef | null>;
  openInTab(root: string): Promise<boolean>;
  create(title: string, files: Record<string, string>): Promise<BoardFolderRef | null>;
  read(rel: string): Promise<string | null>;
  write(rel: string, text: string): Promise<boolean>;
  onChanged(fn: (paths: string[]) => void): () => void;
  /** Copies images the user picks into assets/; their paths there. */
  pickImages(): Promise<string[]>;
  /** Copies one image's bytes into assets/; its path there. */
  importAsset(name: string, bytes: Uint8Array): Promise<string>;
  saveExport(title: string, ext: "png" | "svg", bytes: Uint8Array): Promise<string | null>;
}

const calls: OpenboardApi = {
  current: () => call("board:current"),
  choose: () => call("board:choose"),
  recent: () => call("board:recent"),
  openPath: (root) => call("board:openPath", root),
  openInTab: (root) => call("board:openInTab", root),
  create: (title, files) => call("board:create", title, files),
  read: (rel) => call("board:read", rel),
  write: (rel, text) => call("board:write", rel, text),
  onChanged: (fn) => bridge().on<string[]>("board:changed", fn),
  pickImages: () => call("board:pickImages"),
  importAsset: (name, bytes) => call("board:importAsset", name, bytes),
  saveExport: (title, ext, bytes) => call("boardExport:save", title, ext, bytes),
};

export const api = (): OpenboardApi => calls;

export const plainError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

let assetPrefix = "odboard://none/";
export function setAssetBase(prefix: string) {
  assetPrefix = prefix;
}
/** The URL an image in assets/ is served at. */
export const assetUrl = (src: string) => `${assetPrefix}${src}`;
