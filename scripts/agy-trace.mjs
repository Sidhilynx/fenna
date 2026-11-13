// The tool calls of an Antigravity run started by scripts/agy-try.mjs, one
// line each: step, tool, arguments, and whether the call failed (with why).
// agy prints only its final answer; this is how you see what it actually did
// (wrong tool choices, retries, refused arguments) for the review.
//
//   node scripts/agy-trace.mjs                 the latest run
//   node scripts/agy-trace.mjs <conversation>  a given run (file name without .db)
//   node scripts/agy-trace.mjs --full          arguments in full, not cut at 300 characters

import { readdirSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const full = args.includes("--full");
const named = args.find((a) => !a.startsWith("--"));
const dir = path.join(realpathSync.native(tmpdir()), "opendeck-agy-home", ".gemini", "antigravity-cli", "conversations");
const runs = readdirSync(dir)
  .filter((f) => f.endsWith(".db"))
  .map((f) => ({ id: f.slice(0, -3), at: statSync(path.join(dir, f)).mtimeMs }))
  .sort((a, b) => b.at - a.at);
const id = named ?? runs[0]?.id;
if (!id) {
  console.error(`no runs in ${dir}`);
  process.exit(1);
}

const clean = (b) =>
  Buffer.from(b ?? [])
    .toString("utf8")
    .replace(/[^\x20-\x7e -￿\n]/g, " ")
    .replace(/ +/g, " ")
    .trim();
// Errors a server returns as a tool result: the call went through, the change did not.
const REFUSED = /Nothing was saved[^"]{0,200}|Nothing was changed[^"]{0,200}|has no argument[^"]{0,200}|There is no [^"]{0,200}/;

const db = new DatabaseSync(path.join(dir, `${id}.db`), { readOnly: true });
const found = [];
console.log(`run ${id}`);
for (const row of db.prepare("select idx, error_details as e, step_payload as d from steps order by idx").all()) {
  const text = clean(row.d);
  const tool = /"ToolName":"([A-Za-z0-9_.-]+)"/.exec(text)?.[1];
  if (tool) {
    // A call the client refused (bad arguments, server error) has its message in error_details.
    const err = clean(row.e);
    const why = /MCP error.*/.exec(err)?.[0] ?? err;
    const call = { idx: row.idx, tool, args: /"Arguments":(\{.*?\}),"ServerName"/s.exec(text)?.[1] ?? "", why: why.slice(0, 260) };
    // The step that asks for a call and the step that carries its result name the same call.
    const prev = found[found.length - 1];
    if (prev && prev.idx === row.idx - 1 && prev.tool === tool && prev.args === call.args) prev.why ||= call.why;
    else found.push(call);
  } else if (found.length) {
    const refused = REFUSED.exec(text)?.[0];
    const last = found[found.length - 1];
    if (refused && !last.why) last.why = refused.slice(0, 260);
  }
}
for (const c of found) {
  const shown = full ? c.args : c.args.slice(0, 300) + (c.args.length > 300 ? "…" : "");
  console.log(`${c.idx}\t${c.tool}${c.why ? "\t[FAILED]" : ""}\t${shown.replace(/\s+/g, " ")}`);
  if (c.why) console.log(`\t  -> ${c.why}`);
}
console.log(`${found.length} tool calls, ${found.filter((c) => c.why).length} failed`);
