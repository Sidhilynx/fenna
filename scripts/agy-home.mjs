// A home folder of its own for one Antigravity run. Antigravity reads its MCP
// servers from <home>/.gemini/config/mcp_config.json, and the home is the
// USERPROFILE/HOME it is started with, so each run gets its own folder and
// two runs at once never share a config.

import { mkdirSync, mkdtempSync, realpathSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// wholeHome: remove the whole folder when the run ends; otherwise only its config.
export function startAgyHome(prefix, mcpServers, { wholeHome = false } = {}) {
  const home = mkdtempSync(path.join(realpathSync.native(tmpdir()), prefix));
  const cfgDir = path.join(home, ".gemini", "config");
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(path.join(cfgDir, "mcp_config.json"), JSON.stringify({ mcpServers }));
  // The agent works in its own folder, away from .gemini.
  const work = path.join(home, "work");
  mkdirSync(work);
  let ended = false;
  // Runs on every exit path that goes through process.exit, including errors.
  // Folders above the config are removed only when empty (a run's conversation stays).
  const end = () => {
    if (ended) return;
    ended = true;
    if (wholeHome) {
      rmSync(home, { recursive: true, force: true });
      return;
    }
    rmSync(cfgDir, { recursive: true, force: true });
    for (const dir of [work, path.join(home, ".gemini"), home]) {
      try {
        rmdirSync(dir);
      } catch {
        // Not empty: keep it.
      }
    }
  };
  process.on("exit", end);
  return { home, work, end };
}

// Ctrl+C and kill: stop the agent too, then let the exit handler clean up.
export function forwardSignals(child) {
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig));
}
