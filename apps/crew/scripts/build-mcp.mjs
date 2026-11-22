// Bundle what the packaged app runs on Electron's own Node, without
// TypeScript or node_modules: the crew, browser and gateway MCP servers, the
// Fenna apps' server (rooted in each bot's library), and what the main
// process reads: the bot folder format and the client it starts connectors with.
// pdf.js is copied as it is (read_file reads PDFs with it): its legacy build
// and the font data it reads text with, laid out as in its package.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { cpSync, rmSync } from "node:fs";
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

const pdfjs = path.resolve(path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.mjs")), "..", "..");
const pdfOut = path.join(out, "pdfjs");
rmSync(pdfOut, { recursive: true, force: true });
for (const part of ["legacy/build/pdf.mjs", "legacy/build/pdf.worker.mjs", "cmaps", "standard_fonts", "LICENSE"]) {
  cpSync(path.join(pdfjs, part), path.join(pdfOut, part), { recursive: true });
}
console.log("copied build/mcp/pdfjs");
