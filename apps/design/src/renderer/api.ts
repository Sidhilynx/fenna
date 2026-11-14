// Fenna Design's calls to its main process, over @opendeck/shell's bridge.

import { bridge } from "@opendeck/shell";

export interface DesignFolderRef {
  root: string;
  name: string;
  /** Where this design's images are served: "oddesign://<token>/". */
  asset: string;
}

export interface RecentDesign {
  root: string;
  name: string;
  title: string;
  edited: number;
  /** design.json as it is on disk (unchecked). */
  index: unknown;
  /** The first artboard's file, for the cover. */
  cover: { file: string; html: string } | null;
}

export interface ExportPage {
  name: string;
  html: string;
  width: number;
  height: number;
}

const call = <T>(channel: string, ...args: unknown[]) => bridge().invoke<T>(channel, ...args);

export interface DesignApi {
  current(): Promise<DesignFolderRef | null>;
  choose(): Promise<DesignFolderRef | null>;
  recent(): Promise<RecentDesign[]>;
  openPath(root: string): Promise<DesignFolderRef | null>;
  openInTab(root: string): Promise<boolean>;
  create(title: string, files: Record<string, string>): Promise<DesignFolderRef | null>;
  read(rel: string): Promise<string | null>;
  write(rel: string, text: string): Promise<boolean>;
  remove(rel: string): Promise<boolean>;
  onChanged(fn: (paths: string[]) => void): () => void;
  /** Copies images the user picks into assets/; their paths there. */
  pickImages(): Promise<string[]>;
  /** Copies one image's bytes into assets/; its path there. */
  importAsset(name: string, bytes: Uint8Array): Promise<string>;
  saveHtml(title: string, bytes: Uint8Array): Promise<string | null>;
  exportPng(title: string, html: string, width: number, height: number, scale: number): Promise<string | null>;
  exportPngs(title: string, pages: ExportPage[], scale: number): Promise<string | null>;
  exportPdf(title: string, html: string, width: number, height: number): Promise<string | null>;
}

const calls: DesignApi = {
  current: () => call("design:current"),
  choose: () => call("design:choose"),
  recent: () => call("design:recent"),
  openPath: (root) => call("design:openPath", root),
  openInTab: (root) => call("design:openInTab", root),
  create: (title, files) => call("design:create", title, files),
  read: (rel) => call("design:read", rel),
  write: (rel, text) => call("design:write", rel, text),
  remove: (rel) => call("design:remove", rel),
  onChanged: (fn) => bridge().on<string[]>("design:changed", fn),
  pickImages: () => call("design:pickImages"),
  importAsset: (name, bytes) => call("design:importAsset", name, bytes),
  saveHtml: (title, bytes) => call("designExport:save", title, "html", bytes),
  exportPng: (title, html, width, height, scale) => call("designExport:png", title, html, width, height, scale),
  exportPngs: (title, pages, scale) => call("designExport:pngs", title, pages, scale),
  exportPdf: (title, html, width, height) => call("designExport:pdf", title, html, width, height),
};

export const api = (): DesignApi => calls;

export const plainError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

let assetPrefix = "oddesign://none/";
export function setAssetBase(prefix: string) {
  assetPrefix = prefix;
}
/** The URL an image in assets/ is served at. */
export const assetUrl = (src: string) => `${assetPrefix}${src}`;
