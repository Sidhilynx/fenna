// The phone link end to end: the Node relay, Crew's side (remote.cjs) and the
// phone's side (crew-link/phone.ts), with a socket that can duplicate what it
// sends or drop the connection, to prove calls run once and nothing is lost.
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { startRelay } from "../../../services/relay/server.mjs";
import { importPushKey, open as openSealed } from "@opendeck/crew-link";
import { createPhoneLink, STORE_KEYS, type Frame, type LinkState } from "@opendeck/crew-link/phone";

const require = createRequire(import.meta.url);
const { createRemote, ON_COMPUTER } = require("../src/main/remote.cjs");

type Relay = Awaited<ReturnType<typeof startRelay>>;
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const until = async (fn: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A WebSocket that can send every message twice, and that tests can cut. */
function chaosSocket() {
  const sockets: WebSocket[] = [];
  const chaos = { duplicate: false };
  class ChaosSocket extends WebSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
    }
    override send(data: string) {
      super.send(data);
      if (chaos.duplicate && typeof data === "string" && data.includes('"t":"send"')) super.send(data);
    }
  }
  return { ChaosSocket, chaos, cut: () => sockets.at(-1)?.close(4000, "cut") };
}

function memoryStore() {
  const m = new Map<string, string>();
  return {
    map: m,
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => void m.set(k, v),
    remove: async (k: string) => void m.delete(k),
  };
}

const secrets = {
  available: async () => true,
  encrypt: async (t: string) => Buffer.from(t).toString("base64"),
  decrypt: async (d: string) => Buffer.from(d, "base64").toString(),
};

function fakeBrowsers() {
  const log: string[] = [];
  return {
    log,
    watch: async (slug: string, id: number, mode: string) => (log.push(`watch ${slug} ${id} ${mode}`), { slug, mode }),
    setViewport: (slug: string, view: { width: number }, id: number) => void log.push(`view ${slug} ${view.width} ${id}`),
    input: (slug: string, ev: { type: string }) => void log.push(`input ${slug} ${ev.type}`),
    dropWatcher: (id: number) => void log.push(`drop ${id}`),
  };
}

async function world(o: { dir?: string; relay?: Relay; pushes?: { token: string; data: { h: string; d: string } }[] } = {}) {
  const pushes = o.pushes ?? [];
  const relay = o.relay ?? (await startRelay({ port: 0, push: async (token, data) => (pushes.push({ token, data: data as { h: string; d: string } }), { ok: true }) }));
  if (!o.relay) cleanups.push(() => relay.close());
  const dir = o.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "crew-remote-"));
  if (!o.dir) cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const counts = { send: 0 };
  const calls = new Map<string, (e: unknown, ...a: unknown[]) => unknown>([
    ["crew:overview", () => ({ bots: [{ slug: "inbox" }] })],
    ["crew:send", async (_e, slug, text) => {
      counts.send++;
      await sleep(Number(String(text).match(/slow(\d+)/)?.[1] ?? 0));
      return { runId: `${slug}-${counts.send}`, queued: false };
    }],
    ["crew:bot", (_e, slug) => {
      throw new Error(`There is no bot "${slug}".`);
    }],
    ["crew:vaultReveal", () => ({ password: "hunter2" })],
  ]);
  const browsers = fakeBrowsers();
  const views: unknown[] = [];
  const remote = createRemote({ dir, secrets, calls, browsers, name: "Studio PC", version: "0.9.12", relayUrl: relay.url, onPhones: (v: unknown) => views.push(v) });
  await remote.start();
  cleanups.push(() => remote.stop());
  return { relay, dir, remote, browsers, counts, views, pushes };
}

function phone(name = "Pixel 8", backoff = { minBackoffMs: 20, maxBackoffMs: 60 }) {
  const store = memoryStore();
  const { ChaosSocket, chaos, cut } = chaosSocket();
  const events: { ch: string; p: unknown }[] = [];
  const frames: Frame[] = [];
  const states: LinkState[] = [];
  let resyncs = 0;
  const link = createPhoneLink({
    store,
    name,
    platform: "android",
    app: "1.0.0",
    WebSocket: ChaosSocket as never,
    onState: (s) => states.push(s),
    onEvent: (ch, p) => events.push({ ch, p }),
    onFrame: (f) => frames.push(f),
    onResync: () => resyncs++,
    relayOptions: backoff,
    callTimeoutMs: 3000,
  });
  cleanups.push(() => link.stop());
  return { link, store, chaos, cut, events, frames, states, get resyncs() {
    return resyncs;
  }, get state() {
    return link.state;
  } };
}

async function paired(backoff?: { minBackoffMs: number; maxBackoffMs: number }) {
  const w = await world();
  const p = phone("Pixel 8", backoff);
  const { code } = await w.remote.startPairing();
  await p.link.pair(code);
  await until(() => p.state.ready);
  return { w, p };
}

describe("pairing", () => {
  it("pairs a phone with the code Crew shows, once", async () => {
    const { w, p } = await paired();
    expect(p.state.computerName).toBe("Studio PC");
    const v = w.remote.view();
    expect(v.phones).toHaveLength(1);
    expect(v.phones[0]).toMatchObject({ name: "Pixel 8", platform: "android", online: true });
    expect(v.pairing).toMatchObject({ code: null, connected: "Pixel 8" });
    expect(p.store.map.get(STORE_KEYS.pushKey)).toBeTruthy();
  });

  it("refuses the same code on a second phone", async () => {
    const w = await world();
    const a = phone("A");
    const { code } = await w.remote.startPairing();
    await a.link.pair(code);
    const b = phone("B");
    await expect(b.link.pair(code)).rejects.toThrow(/expired or was already used|didn't answer/);
    expect(w.remote.view().phones.map((x: { name: string }) => x.name)).toEqual(["A"]);
  });

  it("says when a code is mistyped", async () => {
    const p = phone();
    await expect(p.link.pair("fenna1.nonsense")).rejects.toThrow(/cut short or mistyped/);
  });

  it("keeps the pairing across a restart of both sides", async () => {
    const { w, p } = await paired();
    p.link.stop();
    w.remote.stop();
    const w2 = await world({ dir: w.dir, relay: w.relay });
    const again = createPhoneLink({ store: p.store, name: "Pixel 8", platform: "android", app: "1", onState: () => {}, onEvent: () => {}, onFrame: () => {}, onResync: () => {}, relayOptions: { minBackoffMs: 20, maxBackoffMs: 60 } });
    cleanups.push(() => again.stop());
    expect(await again.load()).toBe(true);
    await until(() => again.state.ready);
    expect(await again.invoke("crew:overview")).toEqual({ bots: [{ slug: "inbox" }] });
    expect(w2.remote.view().phones[0].online).toBe(true);
  });
});

describe("calls", () => {
  it("runs the desktop's calls and returns their results and errors in words", async () => {
    const { p } = await paired();
    expect(await p.link.invoke("crew:overview")).toEqual({ bots: [{ slug: "inbox" }] });
    await expect(p.link.invoke("crew:bot", "ghost")).rejects.toThrow('There is no bot "ghost".');
  });

  it("keeps what must stay on the computer there", async () => {
    const { p } = await paired();
    await expect(p.link.invoke("crew:vaultReveal", "mail")).rejects.toThrow(ON_COMPUTER);
    await expect(p.link.invoke("crew:term", "inbox", "ls")).rejects.toThrow(ON_COMPUTER);
  });

  it("runs a call once even when every message arrives twice", async () => {
    const { w, p } = await paired();
    p.chaos.duplicate = true;
    const r = await p.link.invoke("crew:send", "inbox", "hello");
    expect(r).toEqual({ runId: "inbox-1", queued: false });
    await sleep(100);
    expect(w.counts.send).toBe(1);
  });

  it("finishes a call whose connection dropped while it ran, without running it again", async () => {
    const { w, p } = await paired();
    const call = p.link.invoke("crew:send", "inbox", "slow300");
    await sleep(60);
    p.cut();
    expect(await call).toEqual({ runId: "inbox-1", queued: false });
    expect(w.counts.send).toBe(1);
  });

  it("fails at once, in words, while the computer is away", async () => {
    const { w, p } = await paired();
    w.remote.stop();
    await until(() => p.state.computer === "offline");
    await expect(p.link.invoke("crew:overview")).rejects.toThrow(/isn't reachable/);
  });
});

describe("events", () => {
  it("passes the desktop's events a phone needs, and no others", async () => {
    const { w, p } = await paired();
    w.remote.publish("crew:event", { slug: "inbox", runId: "r1", event: { type: "text", text: "hi" } });
    w.remote.publish("crew:term", { slug: "inbox" });
    await until(() => p.events.length === 1);
    await sleep(50);
    expect(p.events).toEqual([{ ch: "crew:event", p: { slug: "inbox", runId: "r1", event: { type: "text", text: "hi" } } }]);
  });

  it("sends crew:changed at most four times a second, ending on the newest", async () => {
    const { w, p } = await paired();
    for (let i = 0; i < 20; i++) w.remote.publish("crew:changed", { n: i });
    await until(() => p.events.some((e) => (e.p as { n: number }).n === 19), 2000);
    expect(p.events.length).toBeLessThanOrEqual(3);
  });

  it("catches up on what it missed while its connection was down", async () => {
    const { w, p } = await paired({ minBackoffMs: 3000, maxBackoffMs: 3000 });
    const resyncs = p.resyncs;
    w.remote.publish("crew:event", { n: 1 });
    await until(() => p.events.length === 1);
    p.cut();
    await until(() => !p.state.ready);
    for (let i = 2; i <= 5; i++) w.remote.publish("crew:event", { n: i });
    for (let i = 0; i < 3; i++) {
      w.remote.publish("crew:changed", { c: i });
      await sleep(300);
    }
    await until(() => p.state.ready);
    await until(() => p.events.filter((e) => e.ch === "crew:event").length === 5);
    expect(p.events.filter((e) => e.ch === "crew:event").map((e) => (e.p as { n: number }).n)).toEqual([1, 2, 3, 4, 5]);
    expect(p.events.filter((e) => e.ch === "crew:changed").map((e) => (e.p as { c: number }).c)).toEqual([2]);
    expect(p.resyncs).toBe(resyncs);
  });

  it("asks the phone to reload when the computer started again", async () => {
    const { w, p } = await paired();
    const before = p.resyncs;
    w.remote.stop();
    await until(() => p.state.computer === "offline");
    await world({ dir: w.dir, relay: w.relay });
    await until(() => p.state.ready);
    expect(p.resyncs).toBe(before + 1);
  });
});

describe("the bot's screen", () => {
  it("watches from the phone as a remote watcher, sizes pages for it, and passes input", async () => {
    const { w, p } = await paired();
    await p.link.invoke("crew:watch", "inbox", "live");
    p.link.send("crew:viewport", "inbox", { width: 412, height: 800, scale: 2 });
    p.link.send("crew:input", "inbox", { type: "mouseDown", x: 1, y: 2, button: "left", clickCount: 1 });
    p.link.send("crew:present", "inbox", true);
    await until(() => w.browsers.log.some((l) => l.startsWith("input")));
    expect(w.browsers.log.find((l) => l.startsWith("watch"))).toMatch(/^watch inbox -\d+ remote$/);
    expect(w.browsers.log.find((l) => l.startsWith("view"))).toMatch(/^view inbox 412 -\d+$/);
    expect(w.browsers.log.some((l) => l.includes("present"))).toBe(false);
  });

  it("sends one picture at a time, and after an ack only the newest", async () => {
    const { w, p } = await paired();
    await p.link.invoke("crew:watch", "inbox", "live");
    const f = (n: number) => ({ slug: "inbox", tab: 1, jpeg: Buffer.from([n, n, n]), width: 3, height: 1, viewWidth: 412, viewHeight: 800 });
    w.remote.frame("inbox", f(1));
    w.remote.frame("inbox", f(2));
    w.remote.frame("inbox", f(3));
    w.remote.frame("other", f(9));
    await until(() => p.frames.length === 1);
    await sleep(80);
    expect(p.frames).toHaveLength(1);
    expect([...(p.frames[0] as Frame).jpeg]).toEqual([1, 1, 1]);
    (p.frames[0] as Frame).ack();
    await until(() => p.frames.length === 2);
    expect([...(p.frames[1] as Frame).jpeg]).toEqual([3, 3, 3]);
    await p.link.invoke("crew:watch", "inbox", "off");
    (p.frames[1] as Frame).ack();
    w.remote.frame("inbox", f(4));
    await sleep(80);
    expect(p.frames).toHaveLength(2);
  });
});

describe("notifications", () => {
  it("pushes a new wait once, sealed so only the phone can read it, while the app is in the back", async () => {
    const { w, p } = await paired();
    p.link.setPushToken("fcm-token-1");
    p.link.setVisible(false);
    await until(() => w.remote.view().phones[0].notifications);
    await sleep(50);
    const wait = { id: "w1", kind: "approval", slug: "inbox", botName: "Inbox", action: "Send the reply", details: "", runId: "r", at: "", expiresAt: "", source: "bot", tool: null };
    w.remote.needs([wait], []);
    w.remote.needs([wait], []);
    await until(() => w.pushes.length === 1);
    await sleep(50);
    expect(w.pushes).toHaveLength(1);
    expect(w.pushes[0]?.token).toBe("fcm-token-1");
    const key = await importPushKey(p.store.map.get(STORE_KEYS.pushKey) as string);
    const hub = p.store.map.get(STORE_KEYS.hub) as string;
    const phoneId = p.store.map.get(STORE_KEYS.phone) as string;
    expect(await openSealed(key, hub, phoneId, w.pushes[0]?.data.d as string)).toEqual({ id: "w1", slug: "inbox", title: "Inbox", body: "Approve: Send the reply", kind: "approval" });
  });

  it("doesn't push while the app is open in front", async () => {
    const { w, p } = await paired();
    p.link.setPushToken("fcm-token-1");
    await until(() => w.remote.view().phones[0].notifications);
    w.remote.needs([{ id: "w2", kind: "ask", slug: "inbox", botName: "Inbox", question: "Which one?", options: [], multi: false, runId: "r", at: "", expiresAt: "" }], []);
    await sleep(150);
    expect(w.pushes).toHaveLength(0);
  });
});

describe("removing a phone", () => {
  it("tells the phone, which forgets the computer", async () => {
    const { w, p } = await paired();
    await w.remote.remove(w.remote.view().phones[0].id);
    await until(() => !p.state.paired);
    expect(p.state.problem).toMatch(/removed on your computer/);
    expect(p.store.map.has(STORE_KEYS.pair)).toBe(false);
    expect(w.remote.view().phones).toEqual([]);
  });
});
