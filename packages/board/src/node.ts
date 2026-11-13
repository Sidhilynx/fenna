// Reading a board folder from disk, for Node (the MCP server and tests).
// The editor reads through the shell's folder host instead.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCanvas, parseMeta, type ParsedCanvas } from "./board.ts";
import type { BoardMeta } from "./schema.ts";
import type { Problem } from "./validate.ts";

const readOr = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : null);

export interface BoardOnDisk extends ParsedCanvas {
  meta: BoardMeta;
  metaProblems: Problem[];
  /** canvas.json as it was read, for version checks. */
  canvasSource: string | null;
}

export function readBoardFolder(root: string): BoardOnDisk {
  const { meta, problems } = parseMeta(readOr(path.join(root, "board.json")), path.basename(root));
  const canvasSource = readOr(path.join(root, "canvas.json"));
  return { ...parseCanvas(canvasSource), meta, metaProblems: problems, canvasSource };
}
