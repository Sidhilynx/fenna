// Dev loop: Vite for the page (hot reload), Electron pointed at it.
// Usage: npm run dev -w @opendeck/sheets [-- --sheet=<folder>]
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");
const require = createRequire(import.meta.url);
const electron = require("electron");

const server = await createServer({ configFile: path.join(appDir, "vite.config.ts") });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error("vite did not start");

const sheetArg = process.argv.find((a) => a.startsWith("--sheet=")) ?? `--sheet=${path.resolve(appDir, "../../examples/sample-sheet")}`;
const child = spawn(electron, [appDir, sheetArg], { stdio: "inherit", env: { ...process.env, OPENDECK_DEV_URL: url } });
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});

