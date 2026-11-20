// Bundle what the packaged app runs on Electron's own Node, without
// TypeScript or node_modules: the crew, browser and gateway MCP servers, the
// Fenna apps' server (rooted in each bot's library), and what the main
// process reads: the bot folder format and the client it starts connectors with.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const out = path.join(here, "..", "build", "mcp");

const bundles = [
  ["packages/crew-mcp/src/cli.ts", "fenna-crew-mcp.cjs"],
  ["packages/workspace-mcp/src/cli.ts", "fenna-workspace-mcp.cjs"],
  ["packages/crew/src/index.ts", "crew-format.cjs"],
  ["packages/sheet/src/index.ts", "crew-sheet.cjs"],
  ["packages/doc/src/index.ts", "crew-doc.cjs"],
  ["packages/crew-mcp/src/client.ts", "crew-client.cjs"],
];

for (const [entry, file] of bundles) {
  await build({
    entryPoints: [path.join(repo, entry)],
    outfile: path.join(out, file),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    minify: false,
    legalComments: "external",
    logLevel: "warning",
  });
  console.log(`bundled build/mcp/${file}`);
}
