// One version for the whole Fenna family: the four apps and their MCP servers.
//
//   node scripts/release-version.mjs v0.9.0        check a tag matches every app (the release workflow runs this)
//   node scripts/release-version.mjs --set 0.9.1   set the version everywhere, before tagging
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPS = ["desktop", "docs", "sheets", "whiteboard"].map((a) => path.join(repo, "apps", a, "package.json"));
const SERVERS = ["mcp", "doc-mcp", "sheet-mcp", "board-mcp"].map((p) => path.join(repo, "packages", p, "src", "index.ts"));
const SERVER_VERSION = /(new McpServer\(\{ name: "fenna-[a-z]+", version: )"([^"]+)"/;
const PLAIN = /^\d+\.\d+\.\d+$/;

const fail = (msg) => {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
};

const versions = () => [
  ...APPS.map((f) => [path.relative(repo, f), JSON.parse(readFileSync(f, "utf8")).version]),
  ...SERVERS.map((f) => [path.relative(repo, f), SERVER_VERSION.exec(readFileSync(f, "utf8"))?.[2] ?? "(none)"]),
];

const [arg, value] = process.argv.slice(2);
if (arg === "--set") {
  if (!PLAIN.test(value ?? "")) fail("usage: --set <x.y.z>");
  for (const f of APPS) {
    const pkg = JSON.parse(readFileSync(f, "utf8"));
    pkg.version = value;
    writeFileSync(f, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  for (const f of SERVERS) writeFileSync(f, readFileSync(f, "utf8").replace(SERVER_VERSION, `$1"${value}"`));
  console.log(`version ${value} set in ${APPS.length} apps and ${SERVERS.length} MCP servers; commit, then tag v${value}`);
} else if (arg) {
  const want = arg.replace(/^v/, "");
  if (!PLAIN.test(want)) fail(`tag ${arg} is not vX.Y.Z`);
  const wrong = versions().filter(([, v]) => v !== want);
  if (wrong.length) fail(`tag ${arg} doesn't match:\n${wrong.map(([f, v]) => `  ${f}: ${v}`).join("\n")}\nRun: node scripts/release-version.mjs --set ${want}`);
  console.log(`every app and MCP server is ${want}`);
} else {
  for (const [f, v] of versions()) console.log(`${v.padEnd(10)} ${f}`);
}
