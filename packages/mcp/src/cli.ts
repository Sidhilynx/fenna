#!/usr/bin/env node
// fenna-slides-mcp --deck <folder>   (stdio)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./index.ts";

const flag = process.argv.indexOf("--deck");
const arg = process.argv.find((a) => a.startsWith("--deck="))?.slice(7) ?? (flag > 0 ? process.argv[flag + 1] : undefined);
const deck = arg && !arg.startsWith("--") ? arg : process.env.OPENDECK_DECK;
if (!deck) {
  process.stderr.write("usage: fenna-slides-mcp --deck <folder>\n");
  process.exit(2);
}
createServer(deck)
  .connect(new StdioServerTransport())
  .catch((e: unknown) => {
    process.stderr.write(`fenna-slides-mcp: ${(e as Error).message}\n`);
    process.exit(1);
  });
