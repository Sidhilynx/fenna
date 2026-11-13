// Drive a deck, a doc, a sheet or a board with Antigravity (Gemini Flash) through its MCP
// server, the way the app's chat will. Nothing of the user's own
// Antigravity setup is used or changed: it runs in a home of its own, and
// may only call Fenna Slides' tools.
//
//   node scripts/agy-try.mjs --deck <folder> [--model gemini-3.8-flash-medium] "<request>"
//   node scripts/agy-try.mjs --doc <folder> "<request>"
//   node scripts/agy-try.mjs --sheet <folder> "<request>"
//   node scripts/agy-try.mjs --board <folder> "<request>"
//
// Run it on a COPY of a sample, never on examples/ itself. See what the
// model did with node scripts/agy-trace.mjs.

import { spawn } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const deckArg = opt("--deck", "");
const docArg = opt("--doc", "");
const sheetArg = opt("--sheet", "");
const boardArg = opt("--board", "");
const model = opt("--model", "gemini-3.8-flash-medium");
const prompt = args.join(" ");
const target = deckArg || docArg || sheetArg || boardArg;
if (!target || !prompt) {
  console.error('usage: node scripts/agy-try.mjs --deck|--doc|--sheet|--board <folder> [--model m] "<request>"');
  process.exit(2);
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = deckArg
  ? { name: "fenna-slides", cli: "packages/mcp/src/cli.ts", flag: `--deck=${path.resolve(deckArg)}` }
  : docArg
    ? { name: "fenna-docs", cli: "packages/doc-mcp/src/cli.ts", flag: `--doc=${path.resolve(docArg)}` }
    : sheetArg
      ? { name: "fenna-sheets", cli: "packages/sheet-mcp/src/cli.ts", flag: `--sheet=${path.resolve(sheetArg)}` }
      : { name: "fenna-whiteboard", cli: "packages/board-mcp/src/cli.ts", flag: `--board=${path.resolve(boardArg)}` };
// The long form of the path: Windows' TEMP is often an 8.3 short name
// (JORDAN~1), and Antigravity's permission rules match the long one.
const home = path.join(realpathSync.native(tmpdir()), "opendeck-agy-home");
const cfgDir = path.join(home, ".gemini", "config");
mkdirSync(cfgDir, { recursive: true });
writeFileSync(
  path.join(cfgDir, "mcp_config.json"),
  JSON.stringify({ mcpServers: { [server.name]: { command: process.execPath, args: [path.join(repo, server.cli), server.flag] } } }),
);
const work = path.join(home, "work");
mkdirSync(work, { recursive: true });

const toolDocs = path.join(home, ".gemini", "antigravity-cli", "mcp", server.name).split(path.sep).join("/");
const settings = {
  permissions: {
    allow: [`mcp(${server.name}/*)`, `read_file(**)`],
    deny: ["command(*)", "unsandboxed(*)", "write_file(*)", "read_url(*)", "execute_url(*)", "escalate_admin(*)"],
  },
};
const parsed = path.parse(home);
const env = { ...process.env, USERPROFILE: home, HOME: home, AGY_CLI_DISABLE_AUTO_UPDATE: "1" };
if (process.platform === "win32") Object.assign(env, { HOMEDRIVE: parsed.root.replace(/\\$/, ""), HOMEPATH: home.slice(parsed.root.length - 1) });
delete env.ELECTRON_RUN_AS_NODE;

// The real executable, not a shell shim: --settings carries JSON that a shell would mangle.
const agy =
  process.env.AGY_BIN ||
  (process.platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? "", "agy", "bin", "agy.exe") : "agy");

const started = Date.now();
const child = spawn(agy, ["--disable-slash-commands", "--settings", JSON.stringify(settings), "--model", model, "--print-timeout", "600s", "-p", prompt], {
  cwd: work,
  env,
  stdio: ["ignore", "inherit", "inherit"],
});
child.on("exit", (code) => {
  console.error(`\n[agy exited ${code} after ${((Date.now() - started) / 1000).toFixed(1)}s]`);
  process.exit(code ?? 1);
});
