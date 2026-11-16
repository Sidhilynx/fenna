import { bridge } from "@opendeck/shell";

export type ProductKind = "deck" | "doc" | "sheet" | "board" | "design";

export interface WorkspaceProduct {
  id: ProductKind;
  name: string;
  kind: ProductKind;
  kindName: string;
  noun: string;
  nouns: string;
  marker: string;
  description: string;
}

export interface WorkspaceRecentDoc {
  root: string;
  name: string;
  title: string;
  edited: number;
  product: ProductKind;
  productName: string;
  cover?: string | null;
}

export const api = {
  products: (): Promise<WorkspaceProduct[]> => bridge().invoke<WorkspaceProduct[]>("workspace:products"),
  recent: (product?: ProductKind): Promise<WorkspaceRecentDoc[]> => bridge().invoke<WorkspaceRecentDoc[]>("workspace:recent", product),
  open: (root: string): Promise<boolean> => bridge().invoke<boolean>("workspace:open", root),
  openInTab: (root: string): Promise<boolean> => bridge().invoke<boolean>("workspace:openInTab", root),
  choose: (kind?: ProductKind): Promise<string | null> => bridge().invoke<string | null>("workspace:choose", kind),
  create: (kind: ProductKind, title: string, draft?: string): Promise<string | null> => bridge().invoke<string | null>("workspace:create", kind, title, draft),
};
