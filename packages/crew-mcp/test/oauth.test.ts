// Sign-in for web connectors against a real local OAuth-protected MCP
// server (fixtures/oauth-server.mjs): discovery, dynamic registration,
// PKCE, the loopback catch, refresh, sign out, and a pasted client id.
import { createHash } from "node:crypto";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectServer, signIn, signOut, supportsOAuth, accountOf, SignInError, type AuthData, type AuthStore } from "../src/client.ts";
// @ts-expect-error a plain JavaScript fixture
import { startOAuthServer, PERSON, PASTED_CLIENT } from "./fixtures/oauth-server.mjs";

interface Fixture {
  url: string;
  base: string;
  stats: { registrations: number; authorizations: number; tokens: number; refreshes: number; revocations: number; rejected: number; calls: number; lastChallengeMethod: string };
  expireAll(): void;
  close(): Promise<void>;
}

/** An AuthStore in memory; saves counts how often it was written. */
function memoryStore() {
  let data: AuthData | null = null;
  const s = {
    saves: 0,
    get data() {
      return data;
    },
    async load() {
      return data ? (JSON.parse(JSON.stringify(data)) as AuthData) : null;
    },
    async save(d: AuthData | null) {
      s.saves++;
      data = d ? (JSON.parse(JSON.stringify(d)) as AuthData) : null;
    },
  };
  return s satisfies AuthStore & { saves: number };
}

/** Stands in for the person's browser: follows the authorize page's redirect to the loopback address. */
function browser(seen: string[] = []) {
  return async (url: string) => {
    seen.push(url);
    const r = await fetch(url, { redirect: "manual" });
    const to = r.headers.get("location");
    if (to) await fetch(to);
  };
}

let server: Fixture;
afterEach(async () => {
  await server?.close();
});

describe("discovery", () => {
  beforeEach(async () => {
    server = await startOAuthServer();
  });

  it("finds the authorization server through the protected resource metadata", async () => {
    expect(await supportsOAuth(server.url)).toBe(true);
  });

  it("says no for a server without OAuth metadata", async () => {
    const plain = http.createServer((_q, res) => {
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => plain.listen(0, "127.0.0.1", () => r()));
    const port = (plain.address() as { port: number }).port;
    try {
      expect(await supportsOAuth(`http://127.0.0.1:${port}/mcp`)).toBe(false);
      await expect(signIn({ url: `http://127.0.0.1:${port}/mcp`, store: memoryStore(), openBrowser: browser() })).rejects.toMatchObject({ code: "no_oauth" });
    } finally {
      plain.close();
    }
  });
});

describe("signing in", () => {
  beforeEach(async () => {
    server = await startOAuthServer();
  });

  it("registers itself, signs in with PKCE (S256) through a loopback address, and keeps the tokens in the store", async () => {
    const store = memoryStore();
    const seen: string[] = [];
    const r = await signIn({ url: server.url, store, openBrowser: browser(seen) });
    expect(r.account).toBe(PERSON);
    expect(server.stats).toMatchObject({ registrations: 1, authorizations: 1, tokens: 1, rejected: 0, lastChallengeMethod: "S256" });
    const auth = new URL(seen[0]!);
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(auth.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(auth.searchParams.get("state")).toBeTruthy();
    expect(store.data?.tokens?.access_token).toBeTruthy();
    expect(store.data?.tokens?.refresh_token).toBeTruthy();
    expect(store.data?.client?.client_id).toMatch(/^client-/);
    // The loopback server is gone once signed in.
    await expect(fetch(auth.searchParams.get("redirect_uri")!)).rejects.toThrow();
  });

  it("is refused by the server when the verifier doesn't match the challenge", async () => {
    const seen: string[] = [];
    // Catch the code ourselves instead of the loopback, then exchange it with a wrong verifier.
    const store = memoryStore();
    const run = signIn({ url: server.url, store, openBrowser: (u) => void seen.push(u), timeoutMs: 1500 });
    await new Promise((r) => setTimeout(r, 300));
    const auth = new URL(seen[0]!);
    const r = await fetch(auth, { redirect: "manual" });
    const code = new URL(r.headers.get("location")!).searchParams.get("code")!;
    const verifier = "not-the-verifier-not-the-verifier-not-the-verifier";
    expect(createHash("sha256").update(verifier).digest("base64url")).not.toBe(auth.searchParams.get("code_challenge"));
    const token = await fetch(`${server.base}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: auth.searchParams.get("client_id")!, redirect_uri: auth.searchParams.get("redirect_uri")! }),
    });
    expect(token.status).toBe(400);
    expect(await token.json()).toMatchObject({ error: "invalid_grant" });
    await expect(run).rejects.toMatchObject({ code: "timeout" });
    expect(store.data).toBeNull();
  });

  it("connects with the saved sign-in, and refreshes an expired token on its own", async () => {
    const store = memoryStore();
    await signIn({ url: server.url, store, openBrowser: browser() });
    const first = store.data!.tokens!.access_token;
    const conn = await connectServer({ name: "t", url: server.url, auth: store });
    try {
      expect((await conn.listTools()).map((t) => t.name)).toEqual(["whoami"]);
      server.expireAll();
      const r = await conn.callTool("whoami", {});
      expect(r.content).toEqual([{ type: "text", text: `Signed in as ${PERSON}` }]);
      expect(server.stats.refreshes).toBe(1);
      expect(store.data!.tokens!.access_token).not.toBe(first);
    } finally {
      await conn.close();
    }
  });

  it("signs out: the server revokes the tokens and the store forgets them; connecting then asks to sign in", async () => {
    const store = memoryStore();
    await signIn({ url: server.url, store, openBrowser: browser() });
    await signOut({ url: server.url, store });
    expect(store.data).toBeNull();
    expect(server.stats.revocations).toBe(2);
    await expect(connectServer({ name: "t", url: server.url, auth: store })).rejects.toMatchObject({ signIn: true, message: expect.stringMatching(/needs you to sign in again/) });
    await expect(connectServer({ name: "t", url: server.url })).rejects.toMatchObject({ signIn: true, message: expect.stringMatching(/needs signing in \(401\)\. Choose Sign in/) });
  });

  it("can be cancelled while it waits for the browser", async () => {
    const abort = new AbortController();
    const run = signIn({ url: server.url, store: memoryStore(), openBrowser: () => abort.abort(), signal: abort.signal });
    await expect(run).rejects.toMatchObject({ code: "cancelled" });
  });

  it("reads who signed in from an OpenID id_token, and nothing from anything else", () => {
    const claims = Buffer.from(JSON.stringify({ email: "a@b.test" })).toString("base64url");
    expect(accountOf({ id_token: `x.${claims}.` })).toBe("a@b.test");
    expect(accountOf({ id_token: "garbage" })).toBeNull();
    expect(accountOf(undefined)).toBeNull();
  });
});

describe("a server without dynamic registration", () => {
  beforeEach(async () => {
    server = await startOAuthServer({ registration: false });
  });

  it("asks for a client id, and signs in with the one the person pastes", async () => {
    const err = await signIn({ url: server.url, store: memoryStore(), openBrowser: browser() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignInError);
    expect(err).toMatchObject({ code: "no_registration", message: expect.stringMatching(/doesn't let apps register themselves. Paste the client ID/) });
    const store = memoryStore();
    const r = await signIn({ url: server.url, store, clientId: PASTED_CLIENT, openBrowser: browser() });
    expect(r.account).toBe(PERSON);
    expect(store.data?.client?.client_id).toBe(PASTED_CLIENT);
  });
});
