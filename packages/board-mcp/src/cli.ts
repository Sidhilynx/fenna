#!/usr/bin/env node
// fenna-whiteboard-mcp --board <folder> (stdio)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./index.ts";

const flag = process.argv.indexOf("--board");
const arg = process.argv.find((a) => a.startsWith("--board="))?.slice(8) ?? (flag > 0 ? process.argv[flag + 1] : undefined);
const board = arg && !arg.startsWith("--") ? arg : process.env.OPENDECK_BOARD;
if (!board) {
  process.stderr.write("usage: fenna-whiteboard-mcp --board <folder>\n");
  process.exit(2);
}
createServer(board)
  .connect(new StdioServerTransport())
  .catch((e: unknown) => {
    process.stderr.write(`fenna-whiteboard-mcp: ${(e as Error).message}\n`);
    process.exit(1);
  });
