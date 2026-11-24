import { describe, expect, it } from "vitest";
import { createFcm, readServiceAccount, serviceJwt } from "../fcm.js";

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://fcm.googleapis.com/v1/projects/fenna-test/messages:send";

async function makeAccount() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const b64 = Buffer.from(der).toString("base64").match(/.{1,64}/g)!.join("\n");
  const sa = {
    client_email: "relay@fenna-test.iam.gserviceaccount.com",
    private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
    project_id: "fenna-test",
  };
  return { sa, publicKey: pair.publicKey };
}

type Answer = { status: number; body: unknown };
function fakeFetch(answers: Array<Answer | ((url: string, init: RequestInit) => Answer)>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    const a = typeof next === "function" ? next(url, init) : next;
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const tokenAnswer: Answer = { status: 200, body: { access_token: "ya29.test", expires_in: 3600 } };
const okSend: Answer = { status: 200, body: { name: "projects/fenna-test/messages/1" } };
const tokenCalls = (calls: { url: string }[]) => calls.filter((c) => c.url === TOKEN_URI).length;

describe("readServiceAccount", () => {
  it.each(["client_email", "private_key", "project_id"])("names the missing field %s", async (field) => {
    const { sa } = await makeAccount();
    const broken: Record<string, string> = { ...sa };
    delete broken[field];
    expect(() => readServiceAccount(broken)).toThrow(field);
  });

  it("throws on text that is not JSON", () => {
    expect(() => readServiceAccount("{ not json")).toThrow(/JSON/);
  });

  it("reads a JSON string", async () => {
    const { sa } = await makeAccount();
    const read = readServiceAccount(JSON.stringify(sa));
    expect(read.email).toBe(sa.client_email);
    expect(read.project).toBe("fenna-test");
    expect(read.tokenUri).toBe(TOKEN_URI);
  });
});

describe("serviceJwt", () => {
  it("is a signed RS256 assertion for the messaging scope", async () => {
    const { sa, publicKey } = await makeAccount();
    const now = 1_800_000_000_000;
    const jwt = await serviceJwt(readServiceAccount(sa), now);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p).toMatch(/^[A-Za-z0-9_-]+$/);

    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    expect(header.alg).toBe("RS256");

    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    expect(claims.iss).toBe(sa.client_email);
    expect(claims.scope).toBe("https://www.googleapis.com/auth/firebase.messaging");
    expect(claims.aud).toBe(TOKEN_URI);
    expect(claims.exp).toBe(claims.iat + 3600);
    expect(claims.iat).toBe(Math.floor(now / 1000));

    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      Buffer.from(parts[2], "base64url"),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    expect(ok).toBe(true);
  });
});

describe("createFcm", () => {
  it("fetches an access token, then sends a high-priority data message", async () => {
    const { sa } = await makeAccount();
    const { f, calls } = fakeFetch([tokenAnswer, okSend]);
    const push = createFcm({ serviceAccount: sa, fetch: f });

    expect(await push("phone-token", { h: "hub1", d: "sealed" })).toEqual({ ok: true });

    expect(calls[0].url).toBe(TOKEN_URI);
    expect(calls[1].url).toBe(SEND_URL);
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer ya29.test");
    const body = JSON.parse(calls[1].init.body as string);
    expect(body.message.token).toBe("phone-token");
    expect(body.message.data).toEqual({ h: "hub1", d: "sealed" });
    expect(body.message.android.priority).toBe("HIGH");
  });

  it("reuses the access token for the next push", async () => {
    const { sa } = await makeAccount();
    const { f, calls } = fakeFetch([tokenAnswer, okSend, okSend]);
    const push = createFcm({ serviceAccount: sa, fetch: f });

    await push("phone-token", { h: "hub1", d: "one" });
    await push("phone-token", { h: "hub1", d: "two" });

    expect(tokenCalls(calls)).toBe(1);
    expect(calls.filter((c) => c.url === SEND_URL)).toHaveLength(2);
  });

  it("says unregistered for a 404", async () => {
    const { sa } = await makeAccount();
    const { f } = fakeFetch([tokenAnswer, { status: 404, body: { error: { status: "NOT_FOUND" } } }]);
    const push = createFcm({ serviceAccount: sa, fetch: f });
    expect(await push("gone", { h: "hub1", d: "x" })).toEqual({ ok: false, error: "unregistered" });
  });

  it("says unregistered when the details mention UNREGISTERED", async () => {
    const { sa } = await makeAccount();
    const { f } = fakeFetch([
      tokenAnswer,
      {
        status: 400,
        body: { error: { status: "INVALID_ARGUMENT", details: [{ errorCode: "UNREGISTERED" }] } },
      },
    ]);
    const push = createFcm({ serviceAccount: sa, fetch: f });
    expect(await push("gone", { h: "hub1", d: "x" })).toEqual({ ok: false, error: "unregistered" });
  });

  it("fetches a new access token after a 401", async () => {
    const { sa } = await makeAccount();
    const { f, calls } = fakeFetch([
      tokenAnswer,
      { status: 401, body: { error: { status: "UNAUTHENTICATED" } } },
      { status: 200, body: { access_token: "ya29.second", expires_in: 3600 } },
      okSend,
    ]);
    const push = createFcm({ serviceAccount: sa, fetch: f });

    expect(await push("phone-token", { h: "hub1", d: "x" })).toEqual({ ok: false, error: "FCM answered 401 UNAUTHENTICATED" });
    expect(await push("phone-token", { h: "hub1", d: "y" })).toEqual({ ok: true });

    expect(tokenCalls(calls)).toBe(2);
    const last = calls[calls.length - 1];
    expect((last.init.headers as Record<string, string>).authorization).toBe("Bearer ya29.second");
  });

  it("rejects when Google refuses the sign-in", async () => {
    const { sa } = await makeAccount();
    const { f } = fakeFetch([{ status: 400, body: { error: "invalid_grant" } }]);
    const push = createFcm({ serviceAccount: sa, fetch: f });
    await expect(push("phone-token", { h: "hub1", d: "x" })).rejects.toThrow(/refused/);
  });
});
