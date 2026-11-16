#!/usr/bin/env node
// fenna-workspace-mcp --workspace <folder> | --path <folder> (stdio)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./index.ts";

const flagWs = process.argv.indexOf("--workspace");
const flagPath = process.argv.indexOf("--path");
const argWs = process.argv.find((a) => a.startsWith("--workspace="))?.slice(12) ?? (flagWs > 0 ? process.argv[flagWs + 1] : undefined);
const argPath = process.argv.find((a) => a.startsWith("--path="))?.slice(7) ?? (flagPath > 0 ? process.argv[flagPath + 1] : undefined);

const target = (argWs && !argWs.startsWith("--") ? argWs : null) || (argPath && !argPath.startsWith("--") ? argPath : null) || process.env.OPENDECK_WORKSPACE || process.cwd();

createServer(target)
  .connect(new StdioServerTransport())
  .catch((e: unknown) => {
    process.stderr.write(`fenna-workspace-mcp: ${(e as Error).message}\n`);
    process.exit(1);
  });
