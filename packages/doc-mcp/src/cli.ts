#!/usr/bin/env node
// fenna-docs-mcp --doc <folder>   (stdio)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./index.ts";

const flag = process.argv.indexOf("--doc");
const arg = process.argv.find((a) => a.startsWith("--doc="))?.slice(6) ?? (flag > 0 ? process.argv[flag + 1] : undefined);
const doc = arg && !arg.startsWith("--") ? arg : process.env.OPENDECK_DOC;
if (!doc) {
  process.stderr.write("usage: fenna-docs-mcp --doc <folder>\n");
  process.exit(2);
}
createServer(doc)
  .connect(new StdioServerTransport())
  .catch((e: unknown) => {
    process.stderr.write(`fenna-docs-mcp: ${(e as Error).message}\n`);
    process.exit(1);
  });
