// Run the whiteboard app with Vite hot reload on the sample board.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

const server = await createServer({
  configFile: path.join(here, "..", "vite.config.ts"),
  server: { port: 5184 },
});
await server.listen();
const address = server.httpServer?.address();
const port = typeof address === "object" && address ? address.port : 5184;
const devUrl = `http://localhost:${port}`;
console.log(`[vite] listening on ${devUrl}`);

const env = {
  ...process.env,
  OPENDECK_DEV_URL: devUrl,
  OPENDECK_BOARD: process.env.OPENDECK_BOARD || path.join(repo, "examples", "sample-board"),
};
delete env.ELECTRON_RUN_AS_NODE;

const electron = path.join(repo, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const child = spawn(electron, [path.join(here, "..")], { stdio: "inherit", env });

child.on("exit", (code) => {
  server.close();
  process.exit(code ?? 0);
});

