// Search the official MCP Registry for connectors, from the main process,
// and turn each result into a connector to install when that's possible.

const F = require("./format.cjs");

const BASE = "https://registry.modelcontextprotocol.io/v0/servers";
const TIMEOUT_MS = 15_000;

function connectorName(serverName) {
  const last = String(serverName).split("/").pop() || "";
  let n = last
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  if (!n) n = "connector";
  if (F.RESERVED_SERVERS.includes(n)) n = `${n}-mcp`;
  return n;
}

const positional = (list) => (Array.isArray(list) ? list.filter((a) => a && a.type === "positional" && typeof a.value === "string").map((a) => a.value) : []);

/**
 * One registry server as an entry the page can offer, with a connector to
 * fill in and install when we can run it: the values it needs are listed
 * empty (secret when the registry says so), and note says what to fill in.
 */
function toEntry(raw) {
  const s = raw && raw.server ? raw.server : raw;
  const name = connectorName(s.name);
  const origin = `registry ${String(s.name).slice(0, 180)}`;
  const base = {
    name: String(s.name),
    title: String(s.title || s.name.split("/").pop()),
    description: String(s.description || "").slice(0, 500),
    version: String(s.version || ""),
    repository: s.repository && typeof s.repository.url === "string" ? s.repository.url : null,
  };
  const remote = (s.remotes || []).find((r) => r && (r.type === "streamable-http" || r.type === "http" || r.type === "sse") && typeof r.url === "string");
  if (remote) {
    const wanted = (remote.headers || []).filter((h) => h && h.isRequired && F.HEADER_KEY_RE.test(String(h.name)));
    const headers = wanted.map((h) => ({ key: String(h.name), value: "", secret: h.isSecret !== false }));
    const parts = /\{[^}]+\}/.test(remote.url);
    const note = [headers.length ? `Fill in ${headers.map((h) => h.key).join(", ")} before it connects.` : "", parts ? "Replace the {…} parts of its address." : ""].filter(Boolean).join(" ");
    return { ...base, connector: { type: "url", name, url: remote.url, headers, origin }, note };
  }
  const pkg = (s.packages || []).find((p) => p && (!p.transport || p.transport.type === "stdio") && ["npm", "pypi", "oci"].includes(p.registryType));
  if (!pkg) return { ...base, connector: null, note: "It has no package or web address Crew can start." };
  const env = [];
  const required = [];
  for (const v of pkg.environmentVariables || []) {
    if (!v || !v.isRequired || !F.ENV_KEY_RE.test(String(v.name))) continue;
    env.push({ key: v.name, value: typeof v.default === "string" ? v.default : "", secret: v.isSecret === true });
    if (typeof v.default !== "string") required.push(v.name);
  }
  const id = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
  const args = positional(pkg.packageArguments);
  let command;
  let cmdArgs;
  if (pkg.registryType === "npm") [command, cmdArgs] = ["npx", ["-y", id, ...args]];
  else if (pkg.registryType === "pypi") [command, cmdArgs] = ["uvx", [pkg.version ? `${pkg.identifier}==${pkg.version}` : pkg.identifier, ...args]];
  else [command, cmdArgs] = ["docker", ["run", "-i", "--rm", ...env.flatMap((v) => ["-e", v.key]), `${pkg.identifier}${pkg.version ? `:${pkg.version}` : ""}`, ...args]];
  const runtime = { npm: "Node.js (npx)", pypi: "uv (uvx)", oci: "Docker" }[pkg.registryType];
  const note = [`Needs ${runtime} on this computer.`, required.length ? `Fill in ${required.join(", ")} before it runs.` : ""].filter(Boolean).join(" ");
  return { ...base, connector: { type: "command", name, command, args: cmdArgs, env, origin }, note };
}

/**
 * @param {string} query
 * @param {typeof fetch} [fetchFn]
 */
async function searchRegistry(query, fetchFn = fetch) {
  const q = String(query || "").trim().slice(0, 100);
  if (!q) return [];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let body;
  try {
    const res = await fetchFn(`${BASE}?search=${encodeURIComponent(q)}&version=latest&limit=30`, { headers: { accept: "application/json", "user-agent": "fenna-crew" }, signal: ctl.signal });
    if (!res.ok) throw new Error(`The MCP Registry answered ${res.status}. Try again later.`);
    body = await res.json();
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("The MCP Registry didn't answer. Check your connection and try again.");
    if (e instanceof Error && /MCP Registry/.test(e.message)) throw e;
    throw new Error("Couldn't reach the MCP Registry. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
  const seen = new Map();
  for (const raw of (body && body.servers) || []) {
    const s = raw && raw.server ? raw.server : raw;
    if (!s || typeof s.name !== "string") continue;
    const meta = raw._meta && raw._meta["io.modelcontextprotocol.registry/official"];
    if (meta && meta.status && meta.status !== "active") continue;
    const prev = seen.get(s.name);
    if (!prev || (meta && meta.isLatest)) seen.set(s.name, raw);
  }
  return [...seen.values()].map(toEntry);
}

module.exports = { searchRegistry, toEntry };
