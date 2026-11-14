// Reading a design folder from disk, for Node (the MCP server and tests).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadDesign, type LoadedDesign } from "./design.ts";

export function readDesignFolder(root: string): LoadedDesign {
  const reader = (relPath: string): string | null => {
    const full = path.join(root, relPath);
    return existsSync(full) ? readFileSync(full, "utf8") : null;
  };
  return loadDesign(reader, path.basename(root));
}

