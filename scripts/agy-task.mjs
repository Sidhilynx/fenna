// Hand a task spec to a builder model (Antigravity, Gemini Flash by default)
// in an isolated git worktree. The builder may read the repo and write only
// inside its worktree; its shell commands run in Antigravity's sandbox. It never touches the main
// checkout. The lead reviews the branch and merges it.
//
//   node scripts/agy-task.mjs docs/tasks/01-inspector.md [--model gemini-3.8-flash-high]
//
// Writes the builder's log next to the worktree: <worktree>.log

import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const mi = args.indexOf("--model");
const model = mi >= 0 ? args.splice(mi, 2)[1] : "gemini-3.8-flash-high";
const spec = args[0];
if (!spec) {
  console.error("usage: node scripts/agy-task.mjs <docs/tasks/NN-name.md> [--model m]");
  process.exit(2);
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = path.basename(spec, ".md");
const wtRoot = path.join(path.dirname(repo), "opendeck-wt");
const wt = path.join(wtRoot, name);
const branch = `task/${name}`;
mkdirSync(wtRoot, { recursive: true });

if (!existsSync(wt)) {
  execFileSync("git", ["-C", repo, "worktree", "add", "-B", branch, wt, "HEAD"], { stdio: "inherit" });
  // Share the main checkout's installed packages.
  symlinkSync(path.join(repo, "node_modules"), path.join(wt, "node_modules"), "junction");
}

const fwd = (p) => p.split(path.sep).join("/");
const home = path.join(realpathSync.native(tmpdir()), "opendeck-agy-builder");
mkdirSync(path.join(home, ".gemini", "config"), { recursive: true });
writeFileSync(path.join(home, ".gemini", "config", "mcp_config.json"), JSON.stringify({ mcpServers: {} }));

const settings = {
  permissions: {
    allow: [`read_file(${fwd(wt)}/**)`, `read_file(${fwd(repo)}/**)`, `write_file(${fwd(wt)}/**)`, "command(*)"],
    deny: ["unsandboxed(*)", "read_url(*)", "execute_url(*)", "escalate_admin(*)"],
  },
};

const prompt = `You are a builder on the Fenna Slides repository (this folder). Your task is in ${fwd(spec)}.
First read AGENTS.md and the task file completely, then read every source file the task names before you write anything.
Rules: change only the files the task allows. Follow the existing code style. Use only the APIs the task lists; read their source to use them correctly.
Do not start the app, Electron, Vite or any server: you cannot see or close them (the lead reviews the UI with screenshots). Do not run npm install.
When you finish, run: npx tsc -p apps/desktop/tsconfig.json  and fix every error you introduced.
End with a short summary: what you built, what you could not do and why, and any change you need outside your files.`;

const env = { ...process.env, USERPROFILE: home, HOME: home, AGY_CLI_DISABLE_AUTO_UPDATE: "1" };
if (process.platform === "win32") {
  const parsed = path.parse(home);
  Object.assign(env, { HOMEDRIVE: parsed.root.replace(/\\$/, ""), HOMEPATH: home.slice(parsed.root.length - 1) });
}
delete env.ELECTRON_RUN_AS_NODE;
const agy = process.env.AGY_BIN || (process.platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? "", "agy", "bin", "agy.exe") : "agy");

const log = createWriteStream(`${wt}.log`);
const started = Date.now();
log.write(`[${new Date().toISOString()}] ${name} with ${model}\n`);
const child = spawn(agy, ["--disable-slash-commands", "--sandbox", "--settings", JSON.stringify(settings), "--model", model, "--mode", "accept-edits", "--print-timeout", "3000s", "-p", prompt], { cwd: wt, env, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
child.on("exit", (code) => {
  log.end(`\n[exit ${code} after ${((Date.now() - started) / 60000).toFixed(1)} min]\n`);
  console.log(`${name}: exit ${code}; log ${wt}.log; branch ${branch}`);
});
