// Bundle the MCP server into one plain JavaScript file for the packaged app,
// where it runs on Electron's own Node (no TypeScript, no node_modules).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

await build({
  entryPoints: [path.join(repo, "packages/mcp/src/cli.ts")],
  outfile: path.join(here, "..", "build", "mcp", "fenna-slides-mcp.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  minify: false,
  legalComments: "external",
  logLevel: "warning",
});
console.log("bundled build/mcp/fenna-slides-mcp.cjs");
