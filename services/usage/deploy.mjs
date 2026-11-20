// Deploy this folder to Cloudflare with the REST API: D1 database, schema,
// Worker with the DB binding, DASH_KEY secret (made once, kept in
// ~/.cloudflare/dash-key.txt), and the custom domain usage.sidhilynx.com.
// Never prints the token or the key.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = here;
const cf = path.join(os.homedir(), ".cloudflare");
const token = fs.readFileSync(path.join(cf, "token.env"), "utf8").split(/\r?\n/).find((l) => l.includes("="))?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
const zone = fs.readFileSync(path.join(cf, "zone.id"), "utf8").trim();
const API = "https://api.cloudflare.com/client/v4";
const NAME = "fenna-usage";
const HOST = "usage.sidhilynx.com";

async function call(method, url, body, isForm) {
  const res = await fetch(API + url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body && !isForm ? { "content-type": "application/json" } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const j = await res.json();
  if (!j.success) throw new Error(`${method} ${url.replace(/[0-9a-f]{32}/g, "…")}: ${JSON.stringify(j.errors)}`);
  return j.result;
}

const account = (await call("GET", "/accounts"))[0].id;

let db = (await call("GET", `/accounts/${account}/d1/database?name=${NAME}`)).find((d) => d.name === NAME);
if (!db) db = await call("POST", `/accounts/${account}/d1/database`, { name: NAME });
const dbId = db.uuid;
console.log("d1:", NAME, "ready");

await call("POST", `/accounts/${account}/d1/database/${dbId}/query`, { sql: fs.readFileSync(path.join(dir, "schema.sql"), "utf8") });
console.log("schema: applied");

const form = new FormData();
form.append("metadata", new Blob([JSON.stringify({
  main_module: "worker.js",
  compatibility_date: "2026-11-01",
  bindings: [{ type: "d1", name: "DB", id: dbId }],
  keep_bindings: ["secret_text"],
  observability: { enabled: false },
})], { type: "application/json" }));
form.append("worker.js", new Blob([fs.readFileSync(path.join(dir, "worker.js"))], { type: "application/javascript+module" }), "worker.js");
await call("PUT", `/accounts/${account}/workers/scripts/${NAME}`, form, true);
console.log("worker: uploaded");

const keyFile = path.join(cf, "dash-key.txt");
let key = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8").trim() : "";
if (!key) {
  key = crypto.randomBytes(24).toString("base64url");
  fs.writeFileSync(keyFile, key + "\n", { mode: 0o600 });
}
await call("PUT", `/accounts/${account}/workers/scripts/${NAME}/secrets`, { name: "DASH_KEY", text: key, type: "secret_text" });
console.log("secret: set");

await call("PUT", `/accounts/${account}/workers/domains`, { environment: "production", hostname: HOST, service: NAME, zone_id: zone });
console.log("domain:", HOST, "attached");

fs.writeFileSync(path.join(cf, "dashboard-link.txt"), `https://${HOST}/dash?key=${key}\n`, { mode: 0o600 });
console.log("dashboard link written to ~/.cloudflare/dashboard-link.txt");
