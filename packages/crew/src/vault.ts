// The vault: the person's site logins, kept once on this computer and
// granted to bots by name (bot.md `logins`). A login is a label, the
// origins it may be used on, a username, a password, and optionally the
// secret for 2-factor sign-in codes (TOTP) and notes.
//
// The app keeps the vault encrypted (Electron safeStorage) in its own file
// under userData, and the password and code secret are sealed again inside
// it. Bots never see them: Crew fills them into the page itself, and only
// when the page's origin is exactly one the login names.
//
// This module checks what the person types, matches origins, makes sign-in
// codes (RFC 6238, with Web Crypto, so it runs in the app and in tests
// alike) and blanks secrets out of text.

import { LIMITS, TOTP_ALGORITHMS, type Diagnostic, type TotpAlgorithm } from "./schema.ts";
import { isSlug, uniqueSlug } from "./slug.ts";

/** How a site's 2-factor codes are made: the shared secret (base32) and the code's shape. */
export interface Totp {
  /** Base32, uppercase, no padding or spaces. */
  secret: string;
  digits: number;
  /** Seconds each code lasts. */
  period: number;
  algorithm: TotpAlgorithm;
}

/**
 * One login. In the app's vault file `password` and `totp` are sealed (the
 * app's encrypted text; `totp` holds the Totp as JSON before sealing) or ""
 * when there is none; nothing else is secret.
 */
export interface VaultItem {
  /** Stable id, a slug; what bot.md grants. */
  name: string;
  label: string;
  /** Exact origins (scheme, host, port) the login may be filled on. */
  origins: string[];
  username: string;
  password: string;
  totp: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

/**
 * What the add and edit forms send. password and totp are plain text, sent
 * once; keepPassword / keepTotp leave the saved ones as they are. totp is a
 * base32 secret or an otpauth:// address (what a site's QR code holds); ""
 * with keepTotp false removes it.
 */
export interface VaultItemInput {
  name?: string;
  label: string;
  origins: string[];
  username: string;
  password?: string;
  keepPassword?: boolean;
  totp?: string;
  keepTotp?: boolean;
  notes?: string;
}

/** What the page shows instead of a secret. Never the secret's length. */
export const MASK = "••••••••";
/** What a secret is replaced with in text that leaves the app. */
export const SCRUBBED = "[hidden]";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** The origin of a web address ("https://accounts.example.com"), or null when it has none we fill logins on. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * The origin the person typed, normalized, or what is wrong with it. https
 * everywhere; http only on this computer (localhost, 127.0.0.1, [::1]).
 * A page address is not an origin: the error says which origin to write.
 */
export function checkOrigin(text: string): { origin: string } | { error: string } {
  const t = String(text ?? "").trim();
  if (!t) return { error: "Write the site's origin, like https://accounts.example.com." };
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return { error: `"${t.slice(0, 80)}" is not a web address. Write the origin, like https://accounts.example.com.` };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: `"${t.slice(0, 80)}" is not a web address. Write the origin, like https://accounts.example.com.` };
  if (u.protocol === "http:" && !LOCAL_HOST.test(u.hostname)) return { error: `${u.origin} is not https. Logins are filled only on https sites (http only on this computer), so write https://${u.host}.` };
  if (u.username || u.password) return { error: `"${t.slice(0, 80)}" has a name and password in it. Write only the origin, like ${u.protocol}//${u.host}.` };
  if ((u.pathname && u.pathname !== "/") || u.search || u.hash) {
    return { error: `Write only the origin, ${u.origin}, without the page address after it. A login is filled on every page of that origin and nowhere else.` };
  }
  return { origin: u.origin };
}

/** Whether the page at `url` is exactly on one of these origins (scheme, host and port all equal). */
export function originMatches(origins: readonly string[], url: string): boolean {
  const o = originOf(url);
  return o !== null && origins.includes(o);
}

// ── Sign-in codes (TOTP, RFC 6238) ─────────────────────────────────────

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 (RFC 4648) to bytes, ignoring case, spaces, dashes and padding; null when it isn't base32. */
export function base32Decode(text: string): Uint8Array | null {
  const s = String(text).toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!s || /[^A-Z2-7]/.test(s)) return null;
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Bytes to base32, no padding. */
export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

const TOTP_HELP = "Paste the setup key the site shows (letters A–Z and digits 2–7), or the otpauth:// address its QR code holds.";

/** A sign-in code setup from a base32 key or an otpauth://totp/ address, or what is wrong with it. */
export function parseTotp(text: string): { totp: Totp } | { error: string } {
  const t = String(text ?? "").trim();
  let secret = t;
  let digits = 6;
  let period = 30;
  let algorithm: TotpAlgorithm = "SHA1";
  if (/^otpauth:/i.test(t)) {
    let u: URL;
    try {
      u = new URL(t);
    } catch {
      return { error: `That otpauth address can't be read. ${TOTP_HELP}` };
    }
    if (u.host.toLowerCase() !== "totp") return { error: `That is a ${u.host || "different"} code, not a time-based one (otpauth://totp/…). Crew makes time-based codes only.` };
    secret = u.searchParams.get("secret") ?? "";
    if (u.searchParams.has("digits")) digits = Number(u.searchParams.get("digits"));
    if (u.searchParams.has("period")) period = Number(u.searchParams.get("period"));
    const alg = (u.searchParams.get("algorithm") ?? "SHA1").toUpperCase();
    if (!(TOTP_ALGORITHMS as readonly string[]).includes(alg)) return { error: `The code's algorithm "${alg.slice(0, 20)}" is not one Crew makes: ${TOTP_ALGORITHMS.join(", ")}.` };
    algorithm = alg as TotpAlgorithm;
  }
  const bytes = base32Decode(secret);
  if (!bytes) return { error: `That is not a setup key. ${TOTP_HELP}` };
  if (bytes.length < 10) return { error: `That setup key is too short (${bytes.length} bytes; sites give at least 10). Check that you pasted all of it.` };
  if (bytes.length > 128) return { error: "That setup key is too long to be one. Check what you pasted." };
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) return { error: "A sign-in code has 6, 7 or 8 digits; the otpauth address says otherwise." };
  if (!Number.isInteger(period) || period < 10 || period > 300) return { error: "A sign-in code lasts 10 to 300 seconds; the otpauth address says otherwise." };
  return { totp: { secret: base32Encode(bytes), digits, period, algorithm } };
}

/** Read a Totp the app stored (JSON); null when it isn't one. */
export function readTotp(json: string): Totp | null {
  try {
    const v = JSON.parse(json) as Partial<Totp>;
    if (typeof v.secret !== "string" || !base32Decode(v.secret)) return null;
    const alg = (TOTP_ALGORITHMS as readonly string[]).includes(String(v.algorithm)) ? (v.algorithm as TotpAlgorithm) : "SHA1";
    const digits = Number.isInteger(v.digits) && v.digits! >= 6 && v.digits! <= 8 ? v.digits! : 6;
    const period = Number.isInteger(v.period) && v.period! >= 10 && v.period! <= 300 ? v.period! : 30;
    return { secret: v.secret, digits, period, algorithm: alg };
  } catch {
    return null;
  }
}

const HASH: Record<TotpAlgorithm, string> = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };

/** The HOTP value (RFC 4226) of a key and counter, as `digits` digits. */
export async function hotp(key: Uint8Array, counter: number, digits = 6, algorithm: TotpAlgorithm = "SHA1"): Promise<string> {
  const msg = new Uint8Array(8);
  let c = Math.floor(counter);
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const k = await globalThis.crypto.subtle.importKey("raw", key as Uint8Array<ArrayBuffer>, { name: "HMAC", hash: HASH[algorithm] }, false, ["sign"]);
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", k, msg));
  const off = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[off]! & 0x7f) << 24) | (mac[off + 1]! << 16) | (mac[off + 2]! << 8) | mac[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** The code a site expects at `timeMs` (RFC 6238). */
export async function totpCode(totp: Totp, timeMs: number = Date.now()): Promise<string> {
  const key = base32Decode(totp.secret);
  if (!key) throw new Error("The saved setup key can't be read. Edit the login and paste it again.");
  return hotp(key, Math.floor(timeMs / 1000 / totp.period), totp.digits, totp.algorithm);
}

/** Seconds the current code still lasts. */
export function totpSecondsLeft(totp: Pick<Totp, "period">, timeMs: number = Date.now()): number {
  return totp.period - (Math.floor(timeMs / 1000) % totp.period);
}

// ── Checking a login ───────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Why a vault item name can't be used, or null. */
export function vaultNameProblem(name: string): string | null {
  return isSlug(name) ? null : `A login's name is lowercase letters, digits and dashes, up to 40 characters (like "example-mail"); "${String(name).slice(0, 40)}" isn't.`;
}

/**
 * Check a login as the person typed it. The name comes from the label when
 * not given (unique among `taken`). The secrets come back in plain text for
 * the app to seal; `totp` is the parsed setup, or null (none, or kept).
 */
export function checkVaultItem(input: unknown, { taken = [] as readonly string[] } = {}): { item: Omit<VaultItem, "password" | "totp" | "createdAt" | "updatedAt" | "lastUsedAt">; password: string; keepPassword: boolean; totp: Totp | null; keepTotp: boolean; diagnostics: Diagnostic[] } {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d: Diagnostic[] = [];
  const err = (message: string) => d.push({ severity: "error", message });

  const label = str(r.label).replace(/\s+/g, " ").trim();
  if (!label) err("Give the login a label, like Example Mail.");
  else if (label.length > LIMITS.vaultLabel) err(`The label is ${label.length} characters; the most is ${LIMITS.vaultLabel}.`);

  let name = str(r.name).trim();
  if (!name) name = uniqueSlug(label || "login", taken);
  else if (vaultNameProblem(name)) err(vaultNameProblem(name)!);

  const origins: string[] = [];
  const rawOrigins = Array.isArray(r.origins) ? r.origins : [];
  if (!Array.isArray(r.origins) || !rawOrigins.some((o) => str(o).trim())) err("Add the origin the login is for, like https://accounts.example.com. Crew fills it only on that origin.");
  if (rawOrigins.length > LIMITS.vaultOrigins) err(`A login can have at most ${LIMITS.vaultOrigins} origins; this one has ${rawOrigins.length}.`);
  for (const o of rawOrigins.slice(0, LIMITS.vaultOrigins)) {
    if (!str(o).trim()) continue;
    const c = checkOrigin(str(o));
    if ("error" in c) err(c.error);
    else if (!origins.includes(c.origin)) origins.push(c.origin);
  }

  const username = str(r.username).trim();
  if (username.length > LIMITS.vaultUsername) err(`The username is ${username.length} characters; the most is ${LIMITS.vaultUsername}.`);
  if (/[\r\n]/.test(username)) err("The username can't hold a line break.");

  const keepPassword = r.keepPassword === true;
  const password = keepPassword ? "" : str(r.password);
  if (!keepPassword && !password) err("Type the password. Crew keeps it encrypted on this computer and fills it in for your bots.");
  if (password.length > LIMITS.vaultPassword) err(`The password is ${password.length} characters; the most is ${LIMITS.vaultPassword}.`);
  if (/[\r\n]/.test(password)) err("The password can't hold a line break.");

  const keepTotp = r.keepTotp === true;
  let totp: Totp | null = null;
  const totpText = keepTotp ? "" : str(r.totp).trim();
  if (totpText) {
    const t = parseTotp(totpText);
    if ("error" in t) err(`2-factor setup key: ${t.error}`);
    else totp = t.totp;
  }

  const notes = str(r.notes).trim();
  if (notes.length > LIMITS.vaultNotes) err(`The notes are ${notes.length} characters; the most is ${LIMITS.vaultNotes}.`);

  return { item: { name, label: label.slice(0, LIMITS.vaultLabel), origins, username, notes: notes.slice(0, LIMITS.vaultNotes) }, password, keepPassword, totp, keepTotp, diagnostics: d };
}

/** Read the vault's contents (the JSON inside the app's encrypted file). Items that can't be read are left out and counted. */
export function parseVault(json: string): { items: VaultItem[]; skipped: number } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { items: [], skipped: 1 };
  }
  const list = raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? ((raw as { items: unknown[] }).items) : [];
  const items: VaultItem[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const v of list.slice(0, LIMITS.vaultItems)) {
    const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const name = str(r.name);
    const origins = Array.isArray(r.origins) ? r.origins.map(str).filter((o) => { const c = checkOrigin(o); return "origin" in c && c.origin === o; }) : [];
    if (vaultNameProblem(name) || seen.has(name) || !origins.length) {
      skipped++;
      continue;
    }
    seen.add(name);
    const time = (x: unknown) => (typeof x === "string" && !Number.isNaN(Date.parse(x)) ? new Date(x).toISOString() : null);
    items.push({
      name,
      label: str(r.label).slice(0, LIMITS.vaultLabel) || name,
      origins: origins.slice(0, LIMITS.vaultOrigins),
      username: str(r.username).slice(0, LIMITS.vaultUsername),
      password: str(r.password),
      totp: str(r.totp),
      notes: str(r.notes).slice(0, LIMITS.vaultNotes),
      createdAt: time(r.createdAt) ?? new Date(0).toISOString(),
      updatedAt: time(r.updatedAt) ?? new Date(0).toISOString(),
      lastUsedAt: time(r.lastUsedAt),
    });
  }
  return { items, skipped };
}

export function serializeVault(items: readonly VaultItem[]): string {
  return JSON.stringify({ version: 1, items: items.map((i) => ({ name: i.name, label: i.label, origins: i.origins, username: i.username, password: i.password, totp: i.totp, notes: i.notes, createdAt: i.createdAt, updatedAt: i.updatedAt, lastUsedAt: i.lastUsedAt })) });
}

/**
 * Text with every secret blanked out. Short secrets (under 4 characters)
 * are left alone: they would blank out ordinary words.
 */
export function scrubSecrets(text: string, secrets: Iterable<string>): string {
  let out = String(text);
  const list = [...new Set([...secrets].filter((s) => typeof s === "string" && s.length >= 4))].sort((a, b) => b.length - a.length);
  for (const s of list) out = out.split(s).join(SCRUBBED);
  return out;
}
