// The link between Crew on a computer and the person's phone: device keys,
// the pairing code, the keys both sides agree on, and sealed messages.
// Web Crypto only (Node 22+, Electron, Android WebView); P-256 everywhere.
// docs/plans/crew-mobile.md, section A, is the specification.

export { connectRelay } from "./relay.ts";
export type { RelayConnection, RelayOptions, RelaySocket, RelayStatus } from "./relay.ts";

export const PROTOCOL = 1;
/** A pairing code works for this long, once. */
export const PAIR_TTL_MS = 120_000;
/** The largest message the relay passes on, in characters. */
export const MAX_MESSAGE = 1_000_000;
/** A call older than this is dropped. */
export const MAX_CALL_AGE_MS = 5 * 60_000;
const CODE_PREFIX = "fenna1.";
const RELAY_TEXT = "fenna-relay-v1";
const PAIR_INFO = "fenna-pair-v1";
const LINK_SALT = "fenna-crew-link-v1";
const PUSH_INFO = "fenna-push-v1";

const subtle = () => {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error("This device has no Web Crypto, which the phone link needs.");
  return s;
};
const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

// ── base64url ─────────────────────────────────────────────────────────

/** Bytes to base64url, without padding. Works on large buffers (frames). */
export function toB64(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url (or plain base64) to bytes. Throws on anything else. */
export function fromB64(text: string): Uint8Array<ArrayBuffer> {
  if (typeof text !== "string" || !/^[A-Za-z0-9_\-+/]*={0,2}$/.test(text)) throw new Error("That isn't base64 text.");
  const plain = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(plain + "=".repeat((4 - (plain.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomB64(bytes: number): string {
  return toB64(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

// ── Binary values inside JSON ─────────────────────────────────────────

/** ArrayBuffer and Uint8Array become { $b, $t } so they survive JSON; everything else is kept. */
export function encodeValue(v: unknown): unknown {
  if (v instanceof ArrayBuffer) return { $b: toB64(v), $t: "ab" };
  if (v instanceof Uint8Array) return { $b: toB64(v), $t: "u8" };
  if (Array.isArray(v)) return v.map(encodeValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = encodeValue(x);
    return out;
  }
  return v;
}

/** The inverse of encodeValue. */
export function decodeValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decodeValue);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.$b === "string" && (o.$t === "ab" || o.$t === "u8") && Object.keys(o).length === 2) {
      const bytes = fromB64(o.$b);
      return o.$t === "u8" ? bytes : bytes.buffer;
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[k] = decodeValue(x);
    return out;
  }
  return v;
}

// ── Device keys ───────────────────────────────────────────────────────

/** What a device keeps on disk: its private keys as JWK (the computer seals them), its public keys as text. */
export interface StoredDevice {
  v: 1;
  signPrivate: JsonWebKey;
  /** ECDSA P-256 public key, SPKI, base64url. */
  signPublic: string;
  ecdhPrivate: JsonWebKey;
  /** ECDH P-256 public key, raw (65 bytes), base64url. */
  ecdhPublic: string;
}

export interface Device {
  id: string;
  signKey: CryptoKey;
  ecdhKey: CryptoKey;
  signPublic: string;
  ecdhPublic: string;
}

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

/** The device id of an ECDSA public key: 22 characters of base64url(SHA-256(SPKI)). */
export async function deviceIdOf(signPublic: string): Promise<string> {
  const hash = await subtle().digest("SHA-256", fromB64(signPublic));
  return toB64(hash).slice(0, 22);
}

export function isDeviceId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{22}$/.test(v);
}

/** A new device: both key pairs, and what to keep of them. */
export async function newDevice(): Promise<{ device: Device; stored: StoredDevice }> {
  const sign = (await subtle().generateKey(ECDSA, true, ["sign", "verify"])) as CryptoKeyPair;
  const ecdh = (await subtle().generateKey(ECDH, true, ["deriveBits"])) as CryptoKeyPair;
  const stored: StoredDevice = {
    v: 1,
    signPrivate: await subtle().exportKey("jwk", sign.privateKey),
    signPublic: toB64(await subtle().exportKey("spki", sign.publicKey)),
    ecdhPrivate: await subtle().exportKey("jwk", ecdh.privateKey),
    ecdhPublic: toB64(await subtle().exportKey("raw", ecdh.publicKey)),
  };
  return { device: await loadDevice(stored), stored };
}

/** A device from what it kept. Throws if the keys don't load. */
export async function loadDevice(stored: StoredDevice): Promise<Device> {
  if (!stored || stored.v !== 1) throw new Error("The phone link's keys are from another version.");
  const signKey = await subtle().importKey("jwk", stored.signPrivate, ECDSA, false, ["sign"]);
  const ecdhKey = await subtle().importKey("jwk", stored.ecdhPrivate, ECDH, false, ["deriveBits"]);
  return { id: await deviceIdOf(stored.signPublic), signKey, ecdhKey, signPublic: stored.signPublic, ecdhPublic: stored.ecdhPublic };
}

// ── Signing in to the relay ───────────────────────────────────────────

export function relayText(hubId: string, deviceId: string, challenge: string): string {
  return `${RELAY_TEXT}:${hubId}:${deviceId}:${challenge}`;
}

/** The answer to the relay's challenge: a signature with the device's ECDSA key. */
export async function signChallenge(device: Device, hubId: string, challenge: string): Promise<string> {
  return toB64(await subtle().sign(SIGN, device.signKey, utf8.encode(relayText(hubId, device.id, challenge))));
}

/** The relay's check: the id is the key's, and the key signed this challenge. */
export async function verifyChallenge(signPublic: string, hubId: string, deviceId: string, challenge: string, signature: string): Promise<boolean> {
  try {
    if ((await deviceIdOf(signPublic)) !== deviceId) return false;
    const key = await subtle().importKey("spki", fromB64(signPublic), ECDSA, false, ["verify"]);
    return await subtle().verify(SIGN, key, fromB64(signature), utf8.encode(relayText(hubId, deviceId, challenge)));
  } catch {
    return false;
  }
}

// ── The pairing code ──────────────────────────────────────────────────

export interface PairCode {
  /** The relay's address, wss:// (ws:// only on this computer or the Android emulator's host, for development). */
  r: string;
  /** The computer's hub id. */
  h: string;
  /** The computer's ECDH public key, raw, base64url. */
  k: string;
  /** The one-time secret, 16 bytes, base64url. */
  s: string;
  /** The computer's name, for the phone to show. */
  n: string;
}

export function makePairCode(code: PairCode): string {
  return CODE_PREFIX + toB64(utf8.encode(JSON.stringify(code)));
}

const BAD_CODE = "That isn't a Crew pairing code. On your computer, open Crew, Settings, Phone, Connect a phone, and scan the code it shows.";

/** Reads a pairing code as scanned or typed (spaces and line breaks are ignored). Throws in words a person can act on. */
export function parsePairCode(text: string): PairCode {
  const clean = String(text || "").replace(/\s+/g, "");
  if (!clean.startsWith(CODE_PREFIX)) throw new Error(BAD_CODE);
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(fromUtf8.decode(fromB64(clean.slice(CODE_PREFIX.length))));
  } catch {
    throw new Error("That code is cut short or mistyped. Scan it again, or copy it again from your computer.");
  }
  const relay = typeof o.r === "string" ? o.r : "";
  if (!/^wss:\/\/[^\s/]+/.test(relay) && !/^ws:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?(\/|$)/.test(relay)) throw new Error(BAD_CODE);
  if (!isDeviceId(o.h) || typeof o.k !== "string" || typeof o.s !== "string" || o.k.length < 80 || o.s.length < 20) throw new Error(BAD_CODE);
  return { r: relay, h: o.h, k: o.k, s: o.s, n: typeof o.n === "string" ? o.n.slice(0, 60) : "Your computer" };
}

// ── Agreed keys ───────────────────────────────────────────────────────

async function sharedSecret(mine: CryptoKey, theirs: string): Promise<CryptoKey> {
  const pub = await subtle().importKey("raw", fromB64(theirs), ECDH, false, []);
  const bits = await subtle().deriveBits({ name: "ECDH", public: pub }, mine, 256);
  return subtle().importKey("raw", bits, "HKDF", false, ["deriveKey", "deriveBits"]);
}

async function hkdfKey(base: CryptoKey, salt: Uint8Array<ArrayBuffer>, info: string, extractable: boolean): Promise<CryptoKey> {
  return subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: utf8.encode(info) }, base, { name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"]);
}

/** The key that seals the pairing request: only someone who read the code (its secret) can make or open it. */
export async function pairBoxKey(mine: CryptoKey, theirEcdh: string, secret: string): Promise<CryptoKey> {
  return hkdfKey(await sharedSecret(mine, theirEcdh), fromB64(secret), PAIR_INFO, false);
}

/** The key every later message between this computer and this phone is sealed with. Both sides get the same key. */
export async function pairKey(mine: CryptoKey, theirEcdh: string, hubId: string, phoneId: string): Promise<CryptoKey> {
  return hkdfKey(await sharedSecret(mine, theirEcdh), utf8.encode(LINK_SALT), `${hubId}:${phoneId}`, false);
}

/** The key notifications are sealed with, as raw bytes (base64url) for the phone's native side. */
export async function pushKeyRaw(mine: CryptoKey, theirEcdh: string, hubId: string, phoneId: string): Promise<string> {
  const key = await hkdfKey(await sharedSecret(mine, theirEcdh), utf8.encode(LINK_SALT), `${PUSH_INFO}:${hubId}:${phoneId}`, true);
  return toB64(await subtle().exportKey("raw", key));
}

export async function importPushKey(raw: string): Promise<CryptoKey> {
  return subtle().importKey("raw", fromB64(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// ── Sealed messages ───────────────────────────────────────────────────

const aad = (from: string, to: string) => utf8.encode(`${from}>${to}`);

/** Seals a value from one device to another: "1.<nonce>.<ciphertext>". Binary values inside are kept (encodeValue). */
export async function seal(key: CryptoKey, from: string, to: string, value: unknown): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = utf8.encode(JSON.stringify(encodeValue(value)));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: aad(from, to) }, key, data);
  return `${PROTOCOL}.${toB64(iv)}.${toB64(ct)}`;
}

/** Opens a sealed message. Throws if it was sealed with another key, for another direction, or changed on the way. */
export async function open(key: CryptoKey, from: string, to: string, text: string): Promise<unknown> {
  const parts = typeof text === "string" ? text.split(".") : [];
  if (parts.length !== 3 || parts[0] !== String(PROTOCOL)) throw new Error("A message in an unknown format.");
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(parts[1] as string), additionalData: aad(from, to) }, key, fromB64(parts[2] as string));
  } catch {
    throw new Error("A message that doesn't open with this pair's key.");
  }
  return decodeValue(JSON.parse(fromUtf8.decode(plain)));
}

// ── Long messages ─────────────────────────────────────────────────────

/** Sealed text longer than this goes in pieces (the relay passes at most MAX_MESSAGE). */
export const PIECE_CHARS = 900_000;
const PIECES_MAX = 64;

/** A sealed text as the relay messages to send: itself, or pieces "p.<id>.<i>.<n>.<part>". */
export function toPieces(text: string, id = randomB64(6)): string[] {
  if (text.length <= PIECE_CHARS) return [text];
  const n = Math.ceil(text.length / PIECE_CHARS);
  if (n > PIECES_MAX) throw new Error("That is too much to send to the phone at once.");
  return Array.from({ length: n }, (_, i) => `p.${id}.${i}.${n}.${text.slice(i * PIECE_CHARS, (i + 1) * PIECE_CHARS)}`);
}

/** Puts pieces back together; whole texts pass straight through. Unfinished pieces are dropped after a minute. */
export function createJoiner(now: () => number = Date.now) {
  const open = new Map<string, { parts: (string | undefined)[]; got: number; at: number }>();
  return {
    /** The whole text once every piece arrived, or null while waiting (or for a piece that makes no sense). */
    add(from: string, d: string): string | null {
      if (!d.startsWith("p.")) return d;
      for (const [k, v] of open) if (now() - v.at > 60_000) open.delete(k);
      const m = /^p\.([A-Za-z0-9_-]{1,16})\.(\d{1,2})\.(\d{1,2})\./.exec(d);
      if (!m) return null;
      const i = Number(m[2]);
      const n = Number(m[3]);
      if (n < 2 || n > PIECES_MAX || i >= n) return null;
      const key = `${from}:${m[1]}`;
      const rec = open.get(key) || { parts: new Array<string | undefined>(n), got: 0, at: now() };
      if (rec.parts.length !== n) return null;
      if (rec.parts[i] === undefined) {
        rec.parts[i] = d.slice(m[0].length);
        rec.got++;
      }
      open.set(key, rec);
      if (rec.got < n) return null;
      open.delete(key);
      return rec.parts.join("");
    },
  };
}

// ── Messages ──────────────────────────────────────────────────────────

/** What the relay and a device say to each other (plain JSON; d is sealed). */
export type RelayIn =
  | { t: "challenge"; n: string }
  | { t: "ready"; computer: boolean }
  | { t: "msg"; from: string; d: string }
  | { t: "undelivered"; to: string }
  | { t: "presence"; id: string; online: boolean }
  | { t: "pushed"; ok: boolean; token?: string; error?: string }
  | { t: "error"; error: string };

export type RelayOut =
  | { t: "auth"; pub: string; sig: string }
  | { t: "allow"; phones: string[]; pairing: boolean }
  | { t: "send"; to: string; d: string }
  | { t: "push"; token: string; d: string };

/** The pairing request, sent unsealed with its own sealed box. */
export interface PairRequest {
  k: "pair";
  ecdh: string;
  box: string;
}

/** Inside a pairing request's box. */
export interface PairBox {
  name: string;
  sign: string;
  platform: string;
  ts: number;
}

/** From the phone, sealed with the pair key. */
export type PhoneMessage =
  | { k: "hello"; ts: number; session: string; epoch: string | null; seq: number; visible: boolean; push: string | null; app: string }
  | { k: "call"; ts: number; id: string; ch: string; args: unknown[] }
  | { k: "send"; ts: number; ch: string; args: unknown[] }
  | { k: "ack"; ts: number; n: number }
  | { k: "visible"; ts: number; on: boolean }
  | { k: "push"; ts: number; token: string | null }
  | { k: "bye"; ts: number };

/** From the computer, sealed with the pair key. */
export type ComputerMessage =
  | { k: "paired"; name: string; push: string }
  | { k: "welcome"; epoch: string; seq: number; resync: boolean; name: string; version: string }
  | { k: "result"; id: string; ok: true; value: unknown }
  | { k: "result"; id: string; ok: false; error: string }
  /** a: the seq of the event sent to this phone before this one (some events skip phones), so a gap shows. */
  | { k: "ev"; seq: number; a: number; ch: string; p: unknown }
  | { k: "frame"; n: number; slug: string; tab: number; jpeg: Uint8Array; width: number; height: number; viewWidth: number; viewHeight: number }
  | { k: "revoked" };

/** The pairing request a phone sends after reading a code. */
export async function pairRequest(phone: Device, code: PairCode, name: string, platform: string): Promise<PairRequest> {
  const key = await pairBoxKey(phone.ecdhKey, code.k, code.s);
  const box: PairBox = { name: name.slice(0, 60), sign: phone.signPublic, platform: platform.slice(0, 20), ts: Date.now() };
  return { k: "pair", ecdh: phone.ecdhPublic, box: await seal(key, phone.id, code.h, box) };
}

/** The computer opens a pairing request with the secret it showed. Throws if the phone didn't read this code. */
export async function openPairRequest(computer: Device, phoneId: string, req: PairRequest, secret: string): Promise<PairBox> {
  if (!req || req.k !== "pair" || typeof req.ecdh !== "string" || typeof req.box !== "string") throw new Error("Not a pairing request.");
  const key = await pairBoxKey(computer.ecdhKey, req.ecdh, secret);
  const box = (await open(key, phoneId, computer.id, req.box)) as PairBox;
  if (!box || typeof box.sign !== "string" || (await deviceIdOf(box.sign)) !== phoneId) throw new Error("The phone's keys don't match its id.");
  return { name: String(box.name || "Phone").slice(0, 60), sign: box.sign, platform: String(box.platform || "").slice(0, 20), ts: Number(box.ts) || 0 };
}
