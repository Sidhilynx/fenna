import { afterEach, describe, expect, it } from "vitest";
import { newDevice, type Device, type RelayIn } from "../../../packages/crew-link/src/index.ts";
import { connectRelay, type RelayStatus } from "../../../packages/crew-link/src/relay.ts";
import { startRelay } from "../server.mjs";
import { CLOSE, LIMITS } from "../hub.js";

type Relay = Awaited<ReturnType<typeof startRelay>>;
let relays: Relay[] = [];
let clients: { stop(): void }[] = [];

afterEach(async () => {
  for (const c of clients) c.stop();
  clients = [];
  for (const r of relays) await r.close();
  relays = [];
});

async function relay(o: Parameters<typeof startRelay>[0] = {}) {
  const r = await startRelay({ port: 0, ...o });
  relays.push(r);
  return r;
}

const until = async (fn: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

function client(url: string, hubId: string, device: Device, role: "computer" | "phone", extra: Partial<Parameters<typeof connectRelay>[0]> = {}) {
  const got: RelayIn[] = [];
  const statuses: RelayStatus[] = [];
  const log = { ready: 0, computer: null as boolean | null, refused: null as number | null };
  const c = connectRelay({
    url,
    hubId,
    device,
    role,
    minBackoffMs: 20,
    maxBackoffMs: 100,
    onMessage: (m) => got.push(m),
    onReady: (on) => {
      log.ready++;
      log.computer = on;
    },
    onStatus: (s) => statuses.push(s),
    onRefused: (code) => {
      log.refused = code;
    },
    ...extra,
  });
  clients.push(c);
  return { c, got, statuses, log };
}

async function setup() {
  const r = await relay();
  const pc = (await newDevice()).device;
  const phone = (await newDevice()).device;
  const comp = client(r.url, pc.id, pc, "computer");
  await until(() => comp.log.ready === 1);
  comp.c.send({ t: "allow", phones: [phone.id], pairing: false });
  await new Promise((res) => setTimeout(res, 30));
  return { r, pc, phone, comp };
}

describe("relay", () => {
  it("signs devices in, tells each about the other, and passes messages both ways", async () => {
    const { r, pc, phone, comp } = await setup();
    const ph = client(r.url, pc.id, phone, "phone");
    await until(() => ph.log.ready === 1);
    expect(ph.log.computer).toBe(true);
    await until(() => comp.got.some((m) => m.t === "presence" && m.id === phone.id && m.online));
    expect(ph.c.send({ t: "send", to: pc.id, d: "sealed-1" })).toBe(true);
    await until(() => comp.got.some((m) => m.t === "msg"));
    expect(comp.got.find((m) => m.t === "msg")).toEqual({ t: "msg", from: phone.id, d: "sealed-1" });
    comp.c.send({ t: "send", to: phone.id, d: "sealed-2" });
    await until(() => ph.got.some((m) => m.t === "msg"));
    expect(ph.got.find((m) => m.t === "msg")).toEqual({ t: "msg", from: pc.id, d: "sealed-2" });
  });

  it("tells the phone when the computer goes and comes back, and says when a message can't be delivered", async () => {
    const { r, pc, phone, comp } = await setup();
    const ph = client(r.url, pc.id, phone, "phone");
    await until(() => ph.log.ready === 1);
    comp.c.stop();
    await until(() => ph.got.some((m) => m.t === "presence" && !m.online));
    ph.c.send({ t: "send", to: pc.id, d: "x" });
    await until(() => ph.got.some((m) => m.t === "undelivered"));
    const again = client(r.url, pc.id, pc, "computer");
    await until(() => again.log.ready === 1);
    await until(() => ph.got.filter((m) => m.t === "presence" && m.online).length === 1);
  });

  it("refuses a phone that isn't paired, for good", async () => {
    const { r, pc } = await setup();
    const stranger = (await newDevice()).device;
    const ph = client(r.url, pc.id, stranger, "phone");
    await until(() => ph.log.refused !== null);
    expect(ph.log.refused).toBe(CLOSE.notPaired);
    expect(ph.statuses.at(-1)).toBe("stopped");
    expect(ph.log.ready).toBe(0);
  });

  it("lets a new phone in while pairing is open, and puts it out when the computer doesn't keep it", async () => {
    const { r, pc, phone, comp } = await setup();
    const newcomer = (await newDevice()).device;
    comp.c.send({ t: "allow", phones: [phone.id], pairing: true });
    await new Promise((res) => setTimeout(res, 30));
    const ph = client(r.url, pc.id, newcomer, "phone");
    await until(() => ph.log.ready === 1);
    comp.c.send({ t: "allow", phones: [phone.id], pairing: false });
    await until(() => ph.log.refused === CLOSE.notPaired);
  });

  it("refuses a device that signs in with someone else's id", async () => {
    const r = await relay();
    const pc = (await newDevice()).device;
    const other = (await newDevice()).device;
    const imposter = { ...other, id: pc.id };
    const c = client(r.url, pc.id, imposter, "computer");
    await until(() => c.log.refused !== null);
    expect(c.log.refused).toBe(CLOSE.auth);
  });

  it("refuses a computer on another computer's hub, before the socket opens", async () => {
    const r = await relay();
    const pc = (await newDevice()).device;
    const other = (await newDevice()).device;
    const res = await fetch(r.url.replace("ws:", "http:") + `/v1/hub/${pc.id}?id=${other.id}&role=computer`, { headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" } }).catch((e) => e);
    expect(res instanceof Error || res.status === 400).toBe(true);
  });

  it("keeps one socket per device: the newest wins", async () => {
    const { r, pc, phone } = await setup();
    const a = client(r.url, pc.id, phone, "phone", { minBackoffMs: 5000, maxBackoffMs: 5000 });
    await until(() => a.log.ready === 1);
    const b = client(r.url, pc.id, phone, "phone");
    await until(() => b.log.ready === 1);
    await until(() => a.statuses.at(-1) === "waiting");
  });

  it("reconnects on its own after the relay restarts", async () => {
    const r = await relay();
    const port = r.port;
    const pc = (await newDevice()).device;
    const comp = client(r.url, pc.id, pc, "computer");
    await until(() => comp.log.ready === 1);
    await r.close();
    relays = relays.filter((x) => x !== r);
    await until(() => comp.statuses.includes("waiting"));
    const r2 = await relay({ port });
    expect(r2.port).toBe(port);
    await until(() => comp.log.ready === 2, 5000);
  });

  it("sends notifications through push, and limits how many a minute", async () => {
    const sent: { token: string; data: object }[] = [];
    const r = await relay({ push: async (token, data) => (sent.push({ token, data }), { ok: true }) });
    const pc = (await newDevice()).device;
    const comp = client(r.url, pc.id, pc, "computer");
    await until(() => comp.log.ready === 1);
    for (let i = 0; i < LIMITS.pushesPerMinute + 2; i++) comp.c.send({ t: "push", token: "tok", d: `n${i}` });
    await until(() => comp.got.filter((m) => m.t === "pushed").length === LIMITS.pushesPerMinute + 2);
    expect(sent.length).toBe(LIMITS.pushesPerMinute);
    expect(sent[0]).toEqual({ token: "tok", data: { h: pc.id, d: "n0" } });
    const refused = comp.got.filter((m) => m.t === "pushed" && !m.ok);
    expect(refused).toHaveLength(2);
    expect(refused[0]).toMatchObject({ error: expect.stringMatching(/too many/) });
  });

  it("says push isn't set up when the relay has no push service", async () => {
    const r = await relay();
    const pc = (await newDevice()).device;
    const comp = client(r.url, pc.id, pc, "computer");
    await until(() => comp.log.ready === 1);
    comp.c.send({ t: "push", token: "tok", d: "x" });
    await until(() => comp.got.some((m) => m.t === "pushed"));
    expect(comp.got.find((m) => m.t === "pushed")).toMatchObject({ ok: false, error: "push is not set up" });
  });

  it("doesn't let a phone send pushes or change the allow list", async () => {
    const { r, pc, phone, comp } = await setup();
    const ph = client(r.url, pc.id, phone, "phone");
    await until(() => ph.log.ready === 1);
    ph.c.send({ t: "allow", phones: [], pairing: true });
    ph.c.send({ t: "push", token: "t", d: "x" });
    await until(() => ph.got.filter((m) => m.t === "error").length === 2);
    const stranger = (await newDevice()).device;
    const s = client(r.url, pc.id, stranger, "phone");
    await until(() => s.log.refused !== null);
    expect(comp.log.ready).toBe(1);
  });
});
