#!/usr/bin/env node
// fenna-sheets-mcp --sheet <folder> (stdio)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./index.ts";

const flag = process.argv.indexOf("--sheet");
const arg = process.argv.find((a) => a.startsWith("--sheet="))?.slice(8) ?? (flag > 0 ? process.argv[flag + 1] : undefined);
const sheet = arg && !arg.startsWith("--") ? arg : process.env.OPENDECK_SHEET;
if (!sheet) {
  process.stderr.write("usage: fenna-sheets-mcp --sheet <folder>\n");
  process.exit(2);
}
createServer(sheet)
  .connect(new StdioServerTransport())
  .catch((e: unknown) => {
    process.stderr.write(`fenna-sheets-mcp: ${(e as Error).message}\n`);
    process.exit(1);
  });

