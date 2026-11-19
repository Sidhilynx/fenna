#!/usr/bin/env node
// A tiny OAuth-protected MCP server for testing Fenna Crew's sign-in, on
// this computer only (127.0.0.1). It follows the MCP authorization spec:
// protected resource metadata, authorization server metadata, dynamic
// client registration, an authorize page that approves at once (no
// person needed), a token endpoint with PKCE (S256) and refresh tokens,
// and revocation. The MCP endpoint (/mcp) has one tool, whoami, and
// answers 401 without a valid access token.
//
//   node oauth-server.mjs [--port=8765] [--ttl=3600] [--no-registration]
//
// --ttl is how many seconds an access token lasts; --no-registration
// leaves out dynamic registration, and then only the client id
// "pasted-client" is known. Imported, startOAuthServer() does the same and
// returns { url, stats, close }.
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export const PERSON = "person@example.test";
export const PASTED_CLIENT = "pasted-client";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const token = () => b64url(randomBytes(24));

/** An unsigned OpenID id_token: only its claims matter here. */
const idToken = (sub) => `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(JSON.stringify({ sub, email: PERSON, name: "Test Person" }))}.`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (d) => (s += d));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

const loopback = (uri) => {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
  } catch {
    return false;
  }
};

export async function startOAuthServer({ port = 0, ttl = 3600, registration = true } = {}) {
  const clients = new Map(registration ? [] : [[PASTED_CLIENT, { client_id: PASTED_CLIENT, redirect_uris: [] }]]);
  const codes = new Map();
  const access = new Map();
  const refresh = new Map();
  const stats = { registrations: 0, authorizations: 0, tokens: 0, refreshes: 0, revocations: 0, rejected: 0, calls: 0, lastChallengeMethod: "" };
  let base = "";

  const issue = (clientId) => {
    const a = token();
    const r = token();
    access.set(a, { clientId, expires: Date.now() + ttl * 1000 });
    refresh.set(r, { clientId });
    return { access_token: a, token_type: "Bearer", expires_in: ttl, refresh_token: r, id_token: idToken(clientId) };
  };

  function mcpServer() {
    const s = new McpServer({ name: "oauth-test", version: "1.0.0" });
    s.registerTool("whoami", { title: "Who am I", description: "Says who is signed in.", inputSchema: {}, annotations: { readOnlyHint: true } }, async () => {
      stats.calls++;
      return { content: [{ type: "text", text: `Signed in as ${PERSON}` }] };
    });
    return s;
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, base);
    try {
      if (req.method === "GET" && u.pathname.startsWith("/.well-known/oauth-protected-resource")) {
        return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ["notes"], bearer_methods_supported: ["header"] });
      }
      if (req.method === "GET" && (u.pathname === "/.well-known/oauth-authorization-server" || u.pathname === "/.well-known/openid-configuration")) {
        return json(res, 200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          ...(registration ? { registration_endpoint: `${base}/register` } : {}),
          revocation_endpoint: `${base}/revoke`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          scopes_supported: ["notes"],
        });
      }
      if (req.method === "POST" && u.pathname === "/register" && registration) {
        const meta = JSON.parse((await readBody(req)) || "{}");
        if (!Array.isArray(meta.redirect_uris) || !meta.redirect_uris.length || !meta.redirect_uris.every(loopback)) return json(res, 400, { error: "invalid_redirect_uri" });
        const client = { ...meta, client_id: `client-${token()}`, client_id_issued_at: Math.floor(Date.now() / 1000) };
        clients.set(client.client_id, client);
        stats.registrations++;
        return json(res, 201, client);
      }
      if (req.method === "GET" && u.pathname === "/authorize") {
        const q = u.searchParams;
        const client = clients.get(q.get("client_id") || "");
        const redirect = q.get("redirect_uri") || "";
        if (!client) return json(res, 400, { error: "invalid_client" });
        const known = client.client_id === PASTED_CLIENT ? loopback(redirect) : client.redirect_uris.includes(redirect);
        if (!known) return json(res, 400, { error: "invalid_redirect_uri" });
        stats.lastChallengeMethod = q.get("code_challenge_method") || "";
        const back = new URL(redirect);
        if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) {
          back.searchParams.set("error", "invalid_request");
        } else {
          const code = token();
          codes.set(code, { clientId: client.client_id, challenge: q.get("code_challenge"), redirect });
          back.searchParams.set("code", code);
          stats.authorizations++;
        }
        if (q.get("state")) back.searchParams.set("state", q.get("state"));
        res.writeHead(302, { location: back.href });
        return res.end();
      }
      if (req.method === "POST" && u.pathname === "/token") {
        const p = new URLSearchParams(await readBody(req));
        if (p.get("grant_type") === "authorization_code") {
          const c = codes.get(p.get("code") || "");
          codes.delete(p.get("code") || "");
          const verifier = p.get("code_verifier") || "";
          const ok = c && c.clientId === p.get("client_id") && c.redirect === p.get("redirect_uri") && b64url(createHash("sha256").update(verifier).digest()) === c.challenge;
          if (!ok) {
            stats.rejected++;
            return json(res, 400, { error: "invalid_grant", error_description: "The code, verifier or redirect doesn't match." });
          }
          stats.tokens++;
          return json(res, 200, issue(c.clientId));
        }
        if (p.get("grant_type") === "refresh_token") {
          const r = refresh.get(p.get("refresh_token") || "");
          if (!r || r.clientId !== p.get("client_id")) {
            stats.rejected++;
            return json(res, 400, { error: "invalid_grant", error_description: "Unknown refresh token." });
          }
          refresh.delete(p.get("refresh_token"));
          stats.refreshes++;
          return json(res, 200, issue(r.clientId));
        }
        return json(res, 400, { error: "unsupported_grant_type" });
      }
      if (req.method === "POST" && u.pathname === "/revoke") {
        const t = new URLSearchParams(await readBody(req)).get("token") || "";
        if (access.delete(t) || refresh.delete(t)) stats.revocations++;
        res.writeHead(200);
        return res.end();
      }
      if (u.pathname === "/mcp") {
        const auth = /^Bearer (.+)$/.exec(req.headers.authorization || "");
        const a = auth && access.get(auth[1]);
        if (!a || a.expires < Date.now()) {
          return json(res, 401, { error: "invalid_token" }, { "www-authenticate": `Bearer error="invalid_token", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
        }
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        const s = mcpServer();
        res.on("close", () => {
          void transport.close();
          void s.close();
        });
        await s.connect(transport);
        const body = req.method === "POST" ? JSON.parse((await readBody(req)) || "null") : undefined;
        return transport.handleRequest(req, res, body);
      }
      if (u.pathname === "/stats") return json(res, 200, stats);
      json(res, 404, { error: "not_found" });
    } catch (e) {
      json(res, 500, { error: "server_error", error_description: String(e && e.message) });
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    url: `${base}/mcp`,
    base,
    stats,
    /** Make every access token expire now (refresh tokens stay good). */
    expireAll() {
      for (const a of access.values()) a.expires = 0;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const s = await startOAuthServer({ port: Number(arg("port") || 0), ttl: Number(arg("ttl") || 3600), registration: !process.argv.includes("--no-registration") });
  process.stdout.write(`OAuth test MCP server at ${s.url}\n`);
}
