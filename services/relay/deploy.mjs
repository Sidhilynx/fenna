// Deploy the relay to Cloudflare with the REST API: bundle worker.js (with
// hub.js and the crew-link sources), upload it as the Worker fenna-relay with
// the Hub Durable Object, set the FCM secret when a service account is there,
// and attach the custom domain relay.sidhilynx.com. Never prints the token or
// the service account.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const cf = path.join(os.homedir(), ".cloudflare");
const token = fs.readFileSync(path.join(cf, "token.env"), "utf8").split(/\r?\n/).find((l) => l.includes("="))?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
const zone = fs.readFileSync(path.join(cf, "zone.id"), "utf8").trim();
const API = "https://api.cloudflare.com/client/v4";
const NAME = "fenna-relay";
const HOST = "relay.sidhilynx.com";

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

const bundle = await build({
  entryPoints: [path.join(here, "worker.js")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  conditions: ["worker", "browser"],
  mainFields: ["module", "main"],
  write: false,
});
const script = bundle.outputFiles[0].text;
console.log("bundle:", script.length, "bytes");

// The Hub class gets its SQLite storage once, under tag v1. Cloudflare refuses
// a tag that was already applied, so a script that has it is uploaded without
// the migration; the error text is the fallback for a script whose settings
// don't show the tag.
const metadata = (migrate) => ({
  main_module: "worker.js",
  compatibility_date: "2026-11-01",
  bindings: [{ type: "durable_object_namespace", name: "HUB", class_name: "Hub" }],
  keep_bindings: ["secret_text"],
  observability: { enabled: false },
  ...(migrate ? { migrations: { new_tag: "v1", new_sqlite_classes: ["Hub"] } } : {}),
});

async function upload(migrate) {
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata(migrate))], { type: "application/json" }));
  form.append("worker.js", new Blob([script], { type: "application/javascript+module" }), "worker.js");
  await call("PUT", `/accounts/${account}/workers/scripts/${NAME}`, form, true);
}

const settings = await call("GET", `/accounts/${account}/workers/scripts/${NAME}/settings`).catch(() => null);
if (settings && settings.migration_tag) {
  await upload(false);
} else {
  try {
    await upload(true);
  } catch (err) {
    if (!/migration tag/i.test(err.message)) throw err;
    await upload(false);
  }
}
console.log("worker: uploaded");

const fcmFile = path.join(cf, "fcm-service-account.json");
if (fs.existsSync(fcmFile)) {
  await call("PUT", `/accounts/${account}/workers/scripts/${NAME}/secrets`, { name: "FCM_SERVICE_ACCOUNT", text: fs.readFileSync(fcmFile, "utf8"), type: "secret_text" });
  console.log("secret: FCM_SERVICE_ACCOUNT set");
} else {
  console.log("notifications stay off until ~/.cloudflare/fcm-service-account.json is added");
}

await call("PUT", `/accounts/${account}/workers/domains`, { environment: "production", hostname: HOST, service: NAME, zone_id: zone });
console.log("domain:", HOST, "attached");

console.log("relay: wss://relay.sidhilynx.com");
