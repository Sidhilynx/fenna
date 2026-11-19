// Copy what a bot's computer needs to open Fenna documents into Crew: the
// five editor pages (dist/editors/<kind>), the folder hosts they talk to
// (src/main/editors/hosts.cjs, from Fenna Workspace) and each editor's
// export handlers (src/main/editors/<kind>Export.cjs).
// An editor that hasn't been built yet is built first.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const repo = path.resolve(appRoot, "../..");

const EDITORS = [
  { kind: "deck", app: "desktop" },
  { kind: "doc", app: "docs" },
  { kind: "sheet", app: "sheets" },
  { kind: "board", app: "whiteboard" },
  { kind: "design", app: "design" },
];

for (const { kind, app } of EDITORS) {
  const src = path.join(repo, "apps", app, "dist");
  if (!fs.existsSync(path.join(src, "index.html"))) {
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, "apps", app, "package.json"), "utf8")).name;
    execSync(`npm run build -w ${pkg}`, { cwd: repo, stdio: "inherit", shell: true });
  }
  const dest = path.join(appRoot, "dist", "editors", kind);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

const hosts = path.join(appRoot, "src", "main", "editors");
fs.mkdirSync(hosts, { recursive: true });
fs.copyFileSync(path.join(repo, "apps", "workspace", "src", "main", "hosts.cjs"), path.join(hosts, "hosts.cjs"));
for (const { kind, app } of EDITORS) fs.copyFileSync(path.join(repo, "apps", app, "src", "main", "export.cjs"), path.join(hosts, `${kind}Export.cjs`));
