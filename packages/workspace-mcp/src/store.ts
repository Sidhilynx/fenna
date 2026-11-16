import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { DeckStore, StoreError } from "@opendeck/mcp";
import { DocStore } from "@opendeck/doc-mcp";
import { SheetStore } from "@opendeck/sheet-mcp";
import { BoardStore } from "@opendeck/board-mcp";
import { DesignStore } from "@opendeck/artboard-mcp";

export type ProductKind = "deck" | "doc" | "sheet" | "board" | "design";

export interface WorkspaceDocSummary {
  path: string;
  relPath: string;
  name: string;
  kind: ProductKind;
  title: string;
}

export function detectKind(dir: string): ProductKind | null {
  if (!dir || typeof dir !== "string") return null;
  if (fs.existsSync(path.join(dir, "deck.json"))) return "deck";
  if (fs.existsSync(path.join(dir, "doc.json"))) return "doc";
  if (fs.existsSync(path.join(dir, "sheet.json"))) return "sheet";
  if (fs.existsSync(path.join(dir, "board.json")) || fs.existsSync(path.join(dir, "canvas.json"))) return "board";
  if (fs.existsSync(path.join(dir, "design.json")) || fs.existsSync(path.join(dir, "artboard.json"))) return "design";
  return null;
}

async function readTitle(dir: string, kind: ProductKind): Promise<string> {
  try {
    switch (kind) {
      case "deck": {
        const text = await fsp.readFile(path.join(dir, "deck.json"), "utf8");
        const idx = JSON.parse(text);
        return typeof idx.title === "string" ? idx.title : path.basename(dir);
      }
      case "doc": {
        const text = await fsp.readFile(path.join(dir, "doc.json"), "utf8");
        const idx = JSON.parse(text);
        return typeof idx.title === "string" ? idx.title : path.basename(dir);
      }
      case "sheet": {
        const text = await fsp.readFile(path.join(dir, "sheet.json"), "utf8");
        const idx = JSON.parse(text);
        return typeof idx.title === "string" ? idx.title : path.basename(dir);
      }
      case "board": {
        const text = await fsp.readFile(path.join(dir, "board.json"), "utf8").catch(() => null);
        if (text) {
          const idx = JSON.parse(text);
          if (typeof idx.title === "string") return idx.title;
        }
        return path.basename(dir);
      }
      case "design": {
        const text = await fsp.readFile(path.join(dir, "design.json"), "utf8").catch(() => null);
        if (text) {
          const idx = JSON.parse(text);
          if (typeof idx.title === "string") return idx.title;
        }
        return path.basename(dir);
      }
    }
  } catch {
    return path.basename(dir);
  }
}

export class WorkspaceStore {
  readonly root: string;
  private deckStores = new Map<string, DeckStore>();
  private docStores = new Map<string, DocStore>();
  private sheetStores = new Map<string, SheetStore>();
  private boardStores = new Map<string, BoardStore>();
  private designStores = new Map<string, DesignStore>();

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async listDocuments(): Promise<WorkspaceDocSummary[]> {
    const list: WorkspaceDocSummary[] = [];
    const rootKind = detectKind(this.root);
    if (rootKind) {
      const title = await readTitle(this.root, rootKind);
      list.push({ path: this.root, relPath: ".", name: path.basename(this.root), kind: rootKind, title });
      return list;
    }

    try {
      const entries = await fsp.readdir(this.root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sub = path.join(this.root, entry.name);
        const k = detectKind(sub);
        if (k) {
          const title = await readTitle(sub, k);
          list.push({ path: sub, relPath: entry.name, name: entry.name, kind: k, title });
        }
      }
    } catch {}

    return list;
  }

  private async resolveTarget(docPath?: string, expectedKind?: ProductKind): Promise<string> {
    if (docPath) {
      const target = path.resolve(this.root, docPath);
      if (!fs.existsSync(target)) {
        throw new StoreError(`Document folder not found: ${docPath}`);
      }
      return target;
    }

    const docs = await this.listDocuments();
    if (expectedKind) {
      const match = docs.find((d) => d.kind === expectedKind);
      if (match) return match.path;
      throw new StoreError(`No ${expectedKind} document found in workspace ${this.root}. Specify a path.`);
    }

    if (docs.length > 0) return docs[0]!.path;
    return this.root;
  }

  async getDeckStore(docPath?: string): Promise<DeckStore> {
    const target = await this.resolveTarget(docPath, "deck");
    let store = this.deckStores.get(target);
    if (!store) {
      store = new DeckStore(target);
      this.deckStores.set(target, store);
    }
    return store;
  }

  async getDocStore(docPath?: string): Promise<DocStore> {
    const target = await this.resolveTarget(docPath, "doc");
    let store = this.docStores.get(target);
    if (!store) {
      store = new DocStore(target);
      this.docStores.set(target, store);
    }
    return store;
  }

  async getSheetStore(docPath?: string): Promise<SheetStore> {
    const target = await this.resolveTarget(docPath, "sheet");
    let store = this.sheetStores.get(target);
    if (!store) {
      store = new SheetStore(target);
      this.sheetStores.set(target, store);
    }
    return store;
  }

  async getBoardStore(docPath?: string): Promise<BoardStore> {
    const target = await this.resolveTarget(docPath, "board");
    let store = this.boardStores.get(target);
    if (!store) {
      store = new BoardStore(target);
      this.boardStores.set(target, store);
    }
    return store;
  }

  async getDesignStore(docPath?: string): Promise<DesignStore> {
    const target = await this.resolveTarget(docPath, "design");
    let store = this.designStores.get(target);
    if (!store) {
      store = new DesignStore(target);
      this.designStores.set(target, store);
    }
    return store;
  }
}
