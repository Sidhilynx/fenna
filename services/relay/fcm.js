// Notifications to Android phones through Firebase Cloud Messaging (HTTP v1).
// The relay only ever sends a data message holding the hub id and a blob
// sealed by the computer for that phone; Google sees neither the text nor who
// it is from. Needs the project's service account JSON (FCM_SERVICE_ACCOUNT).

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

const b64url = (bytes) => {
  let bin = "";
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlText = (text) => b64url(new TextEncoder().encode(text));

function pemToDer(pem) {
  const body = String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The service account, checked. Throws saying what is missing. */
export function readServiceAccount(json) {
  let sa;
  try {
    sa = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    throw new Error("FCM_SERVICE_ACCOUNT isn't JSON.");
  }
  for (const key of ["client_email", "private_key", "project_id"]) if (!sa || typeof sa[key] !== "string" || !sa[key]) throw new Error(`FCM_SERVICE_ACCOUNT has no ${key}.`);
  return { email: sa.client_email, key: sa.private_key, project: sa.project_id, tokenUri: sa.token_uri || "https://oauth2.googleapis.com/token" };
}

/** A signed JWT asking Google for an access token. */
export async function serviceJwt(sa, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const head = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlText(JSON.stringify({ iss: sa.email, scope: SCOPE, aud: sa.tokenUri, iat, exp: iat + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(sig)}`;
}

/**
 * @param {{ serviceAccount: string | object, fetch?: typeof fetch, now?: () => number }} o
 * @returns {(token: string, data: { h: string, d: string }) => Promise<{ ok: boolean, error?: string }>}
 */
export function createFcm({ serviceAccount, fetch: f = fetch, now = Date.now }) {
  const sa = readServiceAccount(serviceAccount);
  let access = { token: "", until: 0 };

  async function accessToken() {
    if (access.token && now() < access.until) return access.token;
    const res = await f(sa.tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${await serviceJwt(sa, now())}`,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || typeof j.access_token !== "string") throw new Error(`Google refused the relay's sign-in (${res.status}).`);
    access = { token: j.access_token, until: now() + Math.max(60, (Number(j.expires_in) || 3600) - 120) * 1000 };
    return access.token;
  }

  return async function push(token, data) {
    const res = await f(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project)}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { token, data: { h: data.h, d: data.d }, android: { priority: "HIGH", ttl: "900s" } } }),
    });
    if (res.ok) return { ok: true };
    const j = await res.json().catch(() => ({}));
    const status = j && j.error && j.error.status;
    const detail = JSON.stringify((j && j.error && j.error.details) || []);
    // The phone uninstalled the app or its token changed: the computer forgets this token.
    if (res.status === 404 || status === "NOT_FOUND" || /UNREGISTERED/.test(detail)) return { ok: false, error: "unregistered" };
    if (res.status === 401) access = { token: "", until: 0 };
    return { ok: false, error: `FCM answered ${res.status}${status ? ` ${status}` : ""}` };
  };
}
