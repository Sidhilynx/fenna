// Build script for Fenna Workspace:
// 1. Builds Workspace Home with Vite
// 2. Bundles the unified Workspace MCP server
// 3. Copies the built editor dists (Slides, Docs, Sheets, Whiteboard, Design) into dist/editors/
// 4. Syncs export delegate handlers into src/main/exports/

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const repo = path.resolve(appRoot, "../..");

console.log("Building Fenna Workspace...");

// 1. Vite build for workspace renderer
console.log("> vite build");
execSync("npx vite build", { cwd: appRoot, stdio: "inherit", shell: true });

// 2. Bundle unified MCP server
console.log("> build-mcp");
execSync("node scripts/build-mcp.mjs", { cwd: appRoot, stdio: "inherit" });

// 3. Ensure apps have dist, build if missing, and copy to dist/editors/
const EDITORS = [
  { kind: "deck", app: "desktop", pkg: "@opendeck/desktop" },
  { kind: "doc", app: "docs", pkg: "@opendeck/docs" },
  { kind: "sheet", app: "sheets", pkg: "@opendeck/sheets" },
  { kind: "board", app: "whiteboard", pkg: "@opendeck/whiteboard" },
  { kind: "design", app: "design", pkg: "@opendeck/design" },
];

const targetEditorsDir = path.join(appRoot, "dist", "editors");
fs.mkdirSync(targetEditorsDir, { recursive: true });

for (const { kind, app, pkg } of EDITORS) {
  const srcDist = path.join(repo, "apps", app, "dist");
  if (!fs.existsSync(srcDist) || !fs.existsSync(path.join(srcDist, "index.html"))) {
    console.log(`> building missing dist for ${pkg}...`);
    execSync(`npm run build -w ${pkg}`, { cwd: repo, stdio: "inherit" });
  }

  const dest = path.join(targetEditorsDir, kind);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(srcDist, dest, { recursive: true });
  console.log(`copied ${app}/dist -> dist/editors/${kind}`);
}

// 4. Sync export delegate handlers
const exportsDir = path.join(appRoot, "src", "main", "exports");
fs.mkdirSync(exportsDir, { recursive: true });

const EXPORT_MAP = {
  deckExport: "apps/desktop/src/main/export.cjs",
  docExport: "apps/docs/src/main/export.cjs",
  sheetExport: "apps/sheets/src/main/export.cjs",
  boardExport: "apps/whiteboard/src/main/export.cjs",
  designExport: "apps/design/src/main/export.cjs",
};

for (const [targetName, relSrc] of Object.entries(EXPORT_MAP)) {
  const srcFile = path.join(repo, relSrc);
  const destFile = path.join(exportsDir, `${targetName}.cjs`);
  if (fs.existsSync(srcFile)) {
    fs.copyFileSync(srcFile, destFile);
  }
}
console.log("synced export handlers to src/main/exports/");

console.log("Fenna Workspace build complete.");
