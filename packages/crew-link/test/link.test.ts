import { describe, expect, it } from "vitest";
import {
  decodeValue, deviceIdOf, encodeValue, fromB64, importPushKey, isDeviceId, loadDevice, makePairCode, newDevice, open,
  openPairRequest, pairKey, pairRequest, parsePairCode, pushKeyRaw, randomB64, seal, signChallenge, toB64, verifyChallenge,
} from "../src/index.ts";

async function pair() {
  const computer = await newDevice();
  const phone = await newDevice();
  const hub = computer.device.id;
  const kc = await pairKey(computer.device.ecdhKey, phone.device.ecdhPublic, hub, phone.device.id);
  const kp = await pairKey(phone.device.ecdhKey, computer.device.ecdhPublic, hub, phone.device.id);
  return { computer, phone, hub, kc, kp };
}

describe("base64url", () => {
  it("round-trips every byte value and large buffers", () => {
    const all = new Uint8Array(256).map((_, i) => i);
    expect([...fromB64(toB64(all))]).toEqual([...all]);
    const big = new Uint8Array(300_000).map((_, i) => (i * 7) & 255);
    expect(fromB64(toB64(big))).toEqual(big);
    expect(toB64(all)).not.toMatch(/[+/=]/);
  });
  it("refuses text that isn't base64", () => {
    expect(() => fromB64("not base64!")).toThrow(/base64/);
  });
});

describe("values", () => {
  it("keeps ArrayBuffer and Uint8Array through JSON", () => {
    const v = { a: new Uint8Array([1, 2, 3]), b: [new Uint8Array([9]).buffer], c: "x", d: null, e: { f: 1 } };
    const back = decodeValue(JSON.parse(JSON.stringify(encodeValue(v)))) as typeof v;
    expect(back.a).toBeInstanceOf(Uint8Array);
    expect([...back.a]).toEqual([1, 2, 3]);
    expect(back.b[0]).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(back.b[0] as ArrayBuffer)]).toEqual([9]);
    expect(back.c).toBe("x");
    expect(back.e).toEqual({ f: 1 });
  });
  it("leaves objects that only look binary alone", () => {
    expect(decodeValue({ $b: "AA", $t: "ab", other: 1 })).toEqual({ $b: "AA", $t: "ab", other: 1 });
  });
});

describe("devices", () => {
  it("makes an id from the signing key and loads again from what it kept", async () => {
    const { device, stored } = await newDevice();
    expect(isDeviceId(device.id)).toBe(true);
    expect(await deviceIdOf(stored.signPublic)).toBe(device.id);
    const again = await loadDevice(JSON.parse(JSON.stringify(stored)));
    expect(again.id).toBe(device.id);
    expect(again.ecdhPublic).toBe(device.ecdhPublic);
  });
  it("signs the relay's challenge, and the relay can check it", async () => {
    const { device } = await newDevice();
    const n = randomB64(32);
    const sig = await signChallenge(device, "hub", n);
    expect(await verifyChallenge(device.signPublic, "hub", device.id, n, sig)).toBe(true);
    expect(await verifyChallenge(device.signPublic, "hub", device.id, randomB64(32), sig)).toBe(false);
    expect(await verifyChallenge(device.signPublic, "other-hub", device.id, n, sig)).toBe(false);
    const other = await newDevice();
    expect(await verifyChallenge(other.device.signPublic, "hub", device.id, n, sig)).toBe(false);
    expect(await verifyChallenge("garbage", "hub", device.id, n, sig)).toBe(false);
  });
});

describe("pairing code", () => {
  it("round-trips and ignores spaces and line breaks", async () => {
    const { device } = await newDevice();
    const code = { r: "wss://relay.example.com", h: device.id, k: device.ecdhPublic, s: randomB64(16), n: "Studio PC" };
    const text = makePairCode(code);
    expect(parsePairCode(text)).toEqual(code);
    expect(parsePairCode(` ${text.slice(0, 20)}\n${text.slice(20)} `)).toEqual(code);
  });
  it("says what to do with anything else", async () => {
    expect(() => parsePairCode("hello")).toThrow(/Connect a phone/);
    expect(() => parsePairCode("fenna1.abc")).toThrow(/cut short/);
    const { device } = await newDevice();
    const http = makePairCode({ r: "http://evil.example.com", h: device.id, k: device.ecdhPublic, s: randomB64(16), n: "x" });
    expect(() => parsePairCode(http)).toThrow(/Connect a phone/);
    const local = makePairCode({ r: "ws://127.0.0.1:8787", h: device.id, k: device.ecdhPublic, s: randomB64(16), n: "x" });
    expect(parsePairCode(local).r).toBe("ws://127.0.0.1:8787");
  });
});

describe("pairing request", () => {
  it("opens only with the secret the computer showed", async () => {
    const computer = await newDevice();
    const phone = await newDevice();
    const s = randomB64(16);
    const code = parsePairCode(makePairCode({ r: "wss://r.example", h: computer.device.id, k: computer.device.ecdhPublic, s, n: "PC" }));
    const req = await pairRequest(phone.device, code, "Pixel 8", "android");
    const box = await openPairRequest(computer.device, phone.device.id, req, s);
    expect(box.name).toBe("Pixel 8");
    expect(box.sign).toBe(phone.device.signPublic);
    await expect(openPairRequest(computer.device, phone.device.id, req, randomB64(16))).rejects.toThrow();
  });
  it("refuses a request whose keys aren't the sending phone's", async () => {
    const computer = await newDevice();
    const phone = await newDevice();
    const other = await newDevice();
    const s = randomB64(16);
    const code = { r: "wss://r.example", h: computer.device.id, k: computer.device.ecdhPublic, s, n: "PC" };
    const req = await pairRequest(phone.device, code, "Pixel", "android");
    await expect(openPairRequest(computer.device, other.device.id, req, s)).rejects.toThrow();
  });
});

describe("sealed messages", () => {
  it("both sides agree on the key and open each other's messages", async () => {
    const { computer, phone, kc, kp } = await pair();
    const sealed = await seal(kp, phone.device.id, computer.device.id, { k: "call", id: "1", bytes: new Uint8Array([7, 8]) });
    const opened = (await open(kc, phone.device.id, computer.device.id, sealed)) as { k: string; bytes: Uint8Array };
    expect(opened.k).toBe("call");
    expect([...opened.bytes]).toEqual([7, 8]);
  });
  it("uses a fresh nonce for every message", async () => {
    const { computer, phone, kp } = await pair();
    const a = await seal(kp, phone.device.id, computer.device.id, "same");
    const b = await seal(kp, phone.device.id, computer.device.id, "same");
    expect(a).not.toBe(b);
  });
  it("refuses a changed byte, the other direction, and another phone's key", async () => {
    const { computer, phone, kc, kp, hub } = await pair();
    const sealed = await seal(kp, phone.device.id, computer.device.id, { hi: 1 });
    const [v, iv, ct] = sealed.split(".") as [string, string, string];
    const bytes = fromB64(ct);
    bytes[0] = (bytes[0] as number) ^ 1;
    await expect(open(kc, phone.device.id, computer.device.id, `${v}.${iv}.${toB64(bytes)}`)).rejects.toThrow(/doesn't open/);
    await expect(open(kc, computer.device.id, phone.device.id, sealed)).rejects.toThrow(/doesn't open/);
    const other = await newDevice();
    const k2 = await pairKey(computer.device.ecdhKey, other.device.ecdhPublic, hub, other.device.id);
    await expect(open(k2, phone.device.id, computer.device.id, sealed)).rejects.toThrow(/doesn't open/);
    await expect(open(kc, phone.device.id, computer.device.id, "2.a.b")).rejects.toThrow(/unknown format/);
  });
  it("gives both sides the same push key, different from the pair key", async () => {
    const { computer, phone, hub } = await pair();
    const a = await pushKeyRaw(computer.device.ecdhKey, phone.device.ecdhPublic, hub, phone.device.id);
    const b = await pushKeyRaw(phone.device.ecdhKey, computer.device.ecdhPublic, hub, phone.device.id);
    expect(a).toBe(b);
    expect(fromB64(a).length).toBe(32);
    const k = await importPushKey(a);
    const sealed = await seal(k, hub, phone.device.id, { title: "Inbox" });
    expect(await open(await importPushKey(b), hub, phone.device.id, sealed)).toEqual({ title: "Inbox" });
  });
});
