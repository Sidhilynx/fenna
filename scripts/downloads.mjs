// How many times each installer was downloaded from the published GitHub
// releases, per app and per system. Needs the GitHub CLI (gh), signed in.
//
//   node scripts/downloads.mjs                 all releases
//   node scripts/downloads.mjs v0.9.0          one release
import { execFileSync } from "node:child_process";

const REPO = "Sidhilynx/fenna";
const only = process.argv[2];

const releases = JSON.parse(execFileSync("gh", ["api", "--paginate", "--slurp", `repos/${REPO}/releases`], { encoding: "utf8" })).flat();
const system = (name) => (name.endsWith(".exe") ? "Windows" : name.endsWith(".dmg") ? "macOS" : name.endsWith(".AppImage") ? "Linux AppImage" : name.endsWith(".deb") ? "Linux deb" : null);
const app = (name) => /^Fenna-([A-Za-z]+)-/.exec(name)?.[1] ?? null;

const counts = new Map();
let total = 0;
for (const r of releases) {
  if (r.draft || (only && r.tag_name !== only)) continue;
  for (const a of r.assets ?? []) {
    const s = system(a.name);
    const n = app(a.name);
    if (!s || !n) continue;
    const row = counts.get(n) ?? new Map();
    row.set(s, (row.get(s) ?? 0) + a.download_count);
    counts.set(n, row);
    total += a.download_count;
  }
}

const systems = ["Windows", "macOS", "Linux AppImage", "Linux deb"];
console.log(["App", ...systems, "Total"].map((c, i) => (i ? c.padStart(15) : c.padEnd(12))).join(""));
for (const [n, row] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
  const sum = [...row.values()].reduce((x, y) => x + y, 0);
  console.log([n.padEnd(12), ...systems.map((s) => String(row.get(s) ?? 0).padStart(15)), String(sum).padStart(15)].join(""));
}
console.log(`\n${total} downloads${only ? ` of ${only}` : ""} across ${releases.filter((r) => !r.draft).length} published releases`);
