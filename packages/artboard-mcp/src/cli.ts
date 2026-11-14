#!/usr/bin/env node
// fenna-design-mcp --design <folder> (stdio)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./index.ts";

const flag = process.argv.indexOf("--design");
const arg = process.argv.find((a) => a.startsWith("--design="))?.slice(9) ?? (flag > 0 ? process.argv[flag + 1] : undefined);
const design = arg && !arg.startsWith("--") ? arg : process.env.OPENDECK_DESIGN;
if (!design) {
  process.stderr.write("usage: fenna-design-mcp --design <folder>\n");
  process.exit(2);
}
createServer(design)
  .connect(new StdioServerTransport())
  .catch((e: unknown) => {
    process.stderr.write(`fenna-design-mcp: ${(e as Error).message}\n`);
    process.exit(1);
  });

