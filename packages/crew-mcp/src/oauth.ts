// Sign-in for web (URL) connectors, following the MCP authorization spec:
// discover the server's protected resource metadata and its authorization
// server's metadata, register Fenna Crew as a client when the server offers
// dynamic registration (or use a client id the person pasted), then the
// authorization code flow with PKCE. The person signs in in their own
// browser; a one-time loopback server on 127.0.0.1 with a random port
// catches the code. The SDK's auth() does discovery, registration, PKCE
// and refresh; this file keeps its state in the app's encrypted store and
// turns its failures into sentences that say what to do.
//
// Tokens live only in the AuthStore the app gives (encrypted on disk), and
// in memory while a connection uses them. Nothing here logs them.

import { randomBytes } from "node:crypto";
import http from "node:http";
import { auth, discoverOAuthServerInfo, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/** How long the person has to finish signing in in their browser. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const CALLBACK_PATH = "/callback";

/** What sign-in keeps for one connector: secret as a whole (tokens, and a registered client's secret if it has one). */
export interface AuthData {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  /** The loopback address the client was registered with. */
  redirectUri?: string;
  discovery?: OAuthDiscoveryState;
}

/** Where a connector's sign-in is kept; the app encrypts it. save(null) forgets it. */
export interface AuthStore {
  load(): Promise<AuthData | null>;
  save(data: AuthData | null): Promise<void>;
}

export type SignInProblem = "no_registration" | "no_oauth" | "denied" | "timeout" | "cancelled" | "failed";

/** Why sign-in didn't finish, in words to show; code says what the page can offer next. */
export class SignInError extends Error {
  code: SignInProblem;
  constructor(code: SignInProblem, message: string) {
    super(message);
    this.code = code;
  }
}

/** The connection needs the person to sign in (again): there are no tokens, or they can't be refreshed. */
export class SignInNeeded extends Error {
  constructor(host: string) {
    super(`${host} needs you to sign in. Open Connectors and choose Sign in on this connector.`);
  }
}

export const hostOf = (url: string | URL) => {
  try {
    return new URL(url).host;
  } catch {
    return String(url);
  }
};

/** Who signed in, from an OpenID id_token's claims, when the server sends one. */
export function accountOf(tokens: Pick<OAuthTokens, "id_token"> | undefined): string | null {
  const parts = tokens?.id_token?.split(".");
  if (!parts || parts.length < 2) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    for (const k of ["email", "preferred_username", "name"]) {
      const v = claims[k];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 200);
    }
  } catch {
    /* not a token we can read: no name to show */
  }
  return null;
}

interface ProviderOptions {
  store: AuthStore;
  data: AuthData;
  /** Set while signing in: the loopback address that catches the code. */
  redirectUri?: string;
  /** A client id the person pasted, for servers without dynamic registration. */
  clientId?: string;
  /** Set while signing in: open the authorization page in the person's browser. Unset, a needed sign-in throws SignInNeeded. */
  open?: (url: URL) => void | Promise<void>;
  host: string;
}

/** The SDK's view of one connector's sign-in, kept in the app's store. */
export function createProvider(o: ProviderOptions): OAuthClientProvider & { readonly expectedState: string } {
  const data = o.data;
  let verifier = "";
  let state = "";
  const persist = () => o.store.save(data);
  const redirect = () => o.redirectUri ?? data.redirectUri;
  return {
    get redirectUrl() {
      return redirect();
    },
    get clientMetadata(): OAuthClientMetadata {
      const uri = redirect();
      return {
        client_name: "Fenna Crew",
        redirect_uris: uri ? [uri] : [],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      };
    },
    get expectedState() {
      return state;
    },
    state() {
      state = randomBytes(24).toString("base64url");
      return state;
    },
    clientInformation() {
      if (!o.clientId) return data.client;
      return data.client && data.client.client_id === o.clientId ? data.client : { client_id: o.clientId };
    },
    async saveClientInformation(info) {
      data.client = info;
      await persist();
    },
    tokens() {
      return data.tokens;
    },
    async saveTokens(tokens) {
      data.tokens = tokens;
      await persist();
    },
    async redirectToAuthorization(url) {
      if (!o.open) throw new SignInNeeded(o.host);
      await o.open(url);
    },
    saveCodeVerifier(v) {
      verifier = v;
    },
    codeVerifier() {
      return verifier;
    },
    async invalidateCredentials(scope) {
      if (scope === "all" || scope === "client") delete data.client;
      if (scope === "all" || scope === "tokens") delete data.tokens;
      if (scope === "all" || scope === "discovery") delete data.discovery;
      if (scope === "all" || scope === "verifier") verifier = "";
      await persist();
    },
    async saveDiscoveryState(d) {
      data.discovery = d;
      await persist();
    },
    discoveryState() {
      return data.discovery;
    },
  };
}

/** Whether a server signs people in with OAuth: it publishes authorization server metadata (found through its protected resource metadata, or at its own origin). */
export async function supportsOAuth(url: string): Promise<boolean> {
  try {
    const info = await discoverOAuthServerInfo(url);
    return !!info.authorizationServerMetadata;
  } catch {
    return false;
  }
}

/** For a connection that is already signed in: refreshes on its own, and throws SignInNeeded when it can't. */
export async function connectionProvider(url: string, store: AuthStore): Promise<OAuthClientProvider> {
  const data = (await store.load()) ?? {};
  if (!data.tokens) throw new SignInNeeded(hostOf(url));
  return createProvider({ store, data, host: hostOf(url) });
}

const PAGE = (title: string, line: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fenna Crew</title>` +
  `<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:Canvas;color:CanvasText}main{max-width:420px;padding:24px}h1{font-size:18px;margin:0 0 6px}p{margin:0;opacity:.75}</style>` +
  `</head><body><main><h1>${title}</h1><p>${line}</p></main></body></html>`;
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A one-time server on 127.0.0.1 that waits for the authorization server to send the person back with a code. */
async function loopback(host: string) {
  let done: (r: { code?: string; error?: string; state?: string }) => void = () => {};
  const result = new Promise<{ code?: string; error?: string; state?: string }>((r) => (done = r));
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (u.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }
    const code = u.searchParams.get("code") ?? undefined;
    const error = u.searchParams.get("error") ?? undefined;
    const ok = !!code && !error;
    res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(
      ok
        ? PAGE("You're signed in", `Fenna Crew is connected to ${escape(host)}. You can close this tab.`)
        : PAGE("Sign-in didn't finish", `${escape(host)} said: ${escape(u.searchParams.get("error_description") || error || "no code")}. Go back to Fenna Crew to try again.`),
    );
    done({ code, error: error ?? (code ? undefined : "no_code"), state: u.searchParams.get("state") ?? undefined });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  return { redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`, result, close: () => server.close() };
}

/** An SDK or network failure while signing in, as a SignInError. */
function explain(e: unknown, host: string): SignInError {
  if (e instanceof SignInError) return e;
  const msg = String((e as Error)?.message ?? e);
  if (/dynamic client registration/i.test(msg))
    return new SignInError("no_registration", `${host} doesn't let apps register themselves. Paste the client ID it gave you for Fenna Crew (from its developer or app settings), then sign in again.`);
  if (/invalid_client|unauthorized_client|client.*(not found|unknown)/i.test(msg)) return new SignInError("no_registration", `${host} doesn't know that client ID. Check the client ID, then sign in again.`);
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed|ECONNRESET/i.test(msg)) return new SignInError("failed", `Couldn't reach ${host}. Check the address and your connection, then try again.`);
  return new SignInError("failed", `Sign-in with ${host} failed: ${msg.slice(0, 300)}`);
}

export interface SignInOptions {
  /** The connector's MCP address. */
  url: string;
  store: AuthStore;
  /** A client id the person pasted; without one, Crew registers itself when the server allows it. */
  clientId?: string;
  /** Open the authorization page in the person's default browser. */
  openBrowser(url: string): void | Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Sign the person in: the authorization page opens in their browser, the
 * loopback server catches the code, and the tokens are saved in the store.
 * Returns who signed in when the server says. Throws SignInError.
 */
export async function signIn(o: SignInOptions): Promise<{ account: string | null }> {
  const host = hostOf(o.url);
  if (o.signal?.aborted) throw new SignInError("cancelled", "Sign-in was cancelled.");
  if (!(await supportsOAuth(o.url))) throw new SignInError("no_oauth", `${host} doesn't offer sign-in (it publishes no OAuth metadata). Add the header it asks for instead, often Authorization with "Bearer <token>".`);
  const back = await loopback(host);
  // A fresh start: a client registered for another loopback port can't be used again.
  const data: AuthData = { redirectUri: back.redirectUri };
  const provider = createProvider({ store: o.store, data, redirectUri: back.redirectUri, clientId: o.clientId || undefined, open: (url) => o.openBrowser(url.href), host });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const first = await auth(provider, { serverUrl: o.url });
    if (first === "AUTHORIZED") return { account: accountOf(data.tokens) };
    const stop = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SignInError("timeout", `Sign-in with ${host} wasn't finished within ${Math.round((o.timeoutMs ?? SIGN_IN_TIMEOUT_MS) / 60_000)} minutes. Try again.`)), o.timeoutMs ?? SIGN_IN_TIMEOUT_MS);
      onAbort = () => reject(new SignInError("cancelled", "Sign-in was cancelled."));
      if (o.signal?.aborted) onAbort();
      else o.signal?.addEventListener("abort", onAbort, { once: true });
    });
    const r = await Promise.race([back.result, stop]);
    if (r.state !== provider.expectedState) throw new SignInError("failed", `${host} sent back a sign-in that doesn't match the one Fenna Crew started. Try again.`);
    if (r.error || !r.code) throw new SignInError(r.error === "access_denied" ? "denied" : "failed", r.error === "access_denied" ? `Sign-in with ${host} was declined.` : `${host} didn't sign you in (${r.error}). Try again.`);
    await auth(provider, { serverUrl: o.url, authorizationCode: r.code });
    if (!data.tokens) throw new SignInError("failed", `${host} gave no access token. Try again.`);
    return { account: accountOf(data.tokens) };
  } catch (e) {
    await o.store.save(null).catch(() => undefined);
    throw explain(e, host);
  } finally {
    clearTimeout(timer);
    if (onAbort) o.signal?.removeEventListener("abort", onAbort);
    back.close();
  }
}

/** Forget the sign-in, and ask the server to revoke its tokens when it offers that (best effort). */
export async function signOut(o: { url: string; store: AuthStore }): Promise<void> {
  const data = await o.store.load().catch(() => null);
  await o.store.save(null);
  // OpenID metadata types leave it out, but OAuth servers publish it (RFC 7009 / RFC 8414).
  const meta = data?.discovery?.authorizationServerMetadata as { revocation_endpoint?: unknown } | undefined;
  const endpoint = typeof meta?.revocation_endpoint === "string" ? meta.revocation_endpoint : null;
  const clientId = data?.client?.client_id;
  if (!endpoint || !clientId || !data?.tokens) return;
  for (const [kind, value] of [
    ["refresh_token", data.tokens.refresh_token],
    ["access_token", data.tokens.access_token],
  ] as const) {
    if (!value) continue;
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: value, token_type_hint: kind, client_id: clientId }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
  }
}
