// The phone's side of the link: pairing with a code, the session with the
// computer, calls that survive a dropped connection, numbered events, and
// the bot's screen as pictures. The phone app uses this; so do the tests.
// docs/plans/crew-mobile.md, sections C and E.

import {
  createJoiner, loadDevice, newDevice, open, pairKey, pairRequest, parsePairCode, randomB64, seal, toPieces,
  type ComputerMessage, type Device, type PhoneMessage, type RelayIn, type StoredDevice,
} from "./index.ts";
import { connectRelay, type RelayConnection, type RelaySocket, type RelayStatus } from "./relay.ts";

/** Where the phone keeps its keys and its pairing (Capacitor Preferences on Android). */
export interface PhoneStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** The keys the phone keeps; the native side reads PUSH_KEY to open notifications. */
export const STORE_KEYS = { device: "crew.device", pair: "crew.pair", pushKey: "crew.pushKey", hub: "crew.hub", phone: "crew.phoneId" } as const;

interface Pairing {
  r: string;
  h: string;
  k: string;
  n: string;
}

export type ComputerState = "unknown" | "online" | "offline";

export interface LinkState {
  paired: boolean;
  computerName: string;
  relay: RelayStatus | "idle";
  computer: ComputerState;
  /** The session is up: calls go through now. */
  ready: boolean;
  /** When the computer was last seen going away (ms), or null. */
  offlineSince: number | null;
  /** Why the link stopped for good, in words, or null. */
  problem: string | null;
}

export interface Frame {
  slug: string;
  tab: number;
  jpeg: Uint8Array;
  width: number;
  height: number;
  viewWidth: number;
  viewHeight: number;
  /** Call once the picture is on screen: the computer sends the next one only then. */
  ack(): void;
}

export interface PhoneLinkOptions {
  store: PhoneStore;
  /** This phone's name, shown on the computer ("Pixel 8"). */
  name: string;
  platform: string;
  app: string;
  WebSocket?: new (url: string) => RelaySocket;
  onState(state: LinkState): void;
  onEvent(ch: string, payload: unknown): void;
  onFrame(frame: Frame): void;
  /** What the phone shows may be out of date (the computer restarted, or events were missed): load it again. */
  onResync(): void;
  callTimeoutMs?: number;
  pairTimeoutMs?: number;
  relayOptions?: { pingMs?: number; deadMs?: number; minBackoffMs?: number; maxBackoffMs?: number };
}

const UNREACHABLE = "Your computer isn't reachable. Make sure it's on and Crew is open.";
const SLOW = new Set(["crew:create", "crew:connectorSave", "crew:connectorTest", "crew:skillUrl", "crew:registrySearch", "crew:runStats"]);

interface Pending {
  id: string;
  ch: string;
  args: unknown[];
  resolve(v: unknown): void;
  reject(e: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export function createPhoneLink(o: PhoneLinkOptions) {
  const callTimeout = o.callTimeoutMs ?? 20_000;
  const pairTimeout = o.pairTimeoutMs ?? 20_000;
  let device: Device | null = null;
  let pairing: Pairing | null = null;
  /** The pairing code's one-time secret, while pairing. */
  let secret = "";
  let key: CryptoKey | null = null;
  let relay: RelayConnection | null = null;
  let session = randomB64(9);
  let epoch: string | null = null;
  let lastSeq = 0;
  let visible = true;
  let pushToken: string | null | undefined;
  let queue: Promise<void> = Promise.resolve();
  const pending = new Map<string, Pending>();
  const joiner = createJoiner();
  let pairWaiter: { resolve(): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  const state: LinkState = { paired: false, computerName: "", relay: "idle", computer: "unknown", ready: false, offlineSince: null, problem: null };

  const tell = () => o.onState({ ...state });
  const set = (patch: Partial<LinkState>) => {
    Object.assign(state, patch);
    tell();
  };

  async function ensureDevice(): Promise<Device> {
    if (device) return device;
    const raw = await o.store.get(STORE_KEYS.device);
    if (raw) {
      try {
        device = await loadDevice(JSON.parse(raw) as StoredDevice);
        return device;
      } catch {
        /* unreadable keys: make new ones (the phone pairs again) */
      }
    }
    const made = await newDevice();
    await o.store.set(STORE_KEYS.device, JSON.stringify(made.stored));
    device = made.device;
    return device;
  }

  /** Sealed messages go out in the order they were made. */
  function post(msg: PhoneMessage) {
    queue = queue
      .then(async () => {
        if (!relay || !key || !pairing || !device) return;
        const text = await seal(key, device.id, pairing.h, msg);
        for (const piece of toPieces(text)) if (!relay.send({ t: "send", to: pairing.h, d: piece })) return;
      })
      .catch(() => {});
  }

  function hello() {
    if (!relay || !relay.ready || !key) return;
    post({ k: "hello", ts: Date.now(), session, epoch, seq: lastSeq, visible, push: pushToken === undefined ? null : pushToken, app: o.app });
  }

  function failAll(message: string) {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    pending.clear();
  }

  function offline() {
    if (state.computer !== "offline") set({ computer: "offline", ready: false, offlineSince: Date.now() });
  }

  async function onRelay(m: RelayIn) {
    if (!pairing || !device) return;
    if (m.t === "presence" && m.id === pairing.h) {
      if (m.online) {
        set({ computer: "online", offlineSince: null });
        hello();
      } else offline();
      return;
    }
    if (m.t === "undelivered") {
      offline();
      return;
    }
    if (m.t !== "msg" || m.from !== pairing.h) return;
    const whole = joiner.add(m.from, m.d);
    if (whole === null || !key) return;
    let msg: ComputerMessage;
    try {
      msg = (await open(key, pairing.h, device.id, whole)) as ComputerMessage;
    } catch {
      return;
    }
    onComputer(msg);
  }

  function onComputer(msg: ComputerMessage) {
    if (msg.k === "paired") {
      void finishPairing(msg.name, msg.push);
      return;
    }
    if (msg.k === "welcome") {
      const fresh = msg.resync || msg.epoch !== epoch;
      epoch = msg.epoch;
      if (fresh) lastSeq = msg.seq;
      set({ computer: "online", ready: true, offlineSince: null, computerName: msg.name || state.computerName });
      // Calls made before the connection dropped go again, with the same ids: the computer answers each once.
      for (const p of pending.values()) {
        post({ k: "call", ts: Date.now(), id: p.id, ch: p.ch, args: p.args });
      }
      if (fresh) o.onResync();
      return;
    }
    if (msg.k === "result") {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(new Error(msg.error));
      return;
    }
    if (msg.k === "ev") {
      if (msg.seq <= lastSeq) return;
      const gap = msg.a > lastSeq;
      lastSeq = msg.seq;
      if (gap) {
        o.onResync();
        return;
      }
      o.onEvent(msg.ch, msg.p);
      return;
    }
    if (msg.k === "frame") {
      const n = msg.n;
      let acked = false;
      o.onFrame({
        slug: msg.slug, tab: msg.tab, jpeg: msg.jpeg, width: msg.width, height: msg.height, viewWidth: msg.viewWidth, viewHeight: msg.viewHeight,
        ack: () => {
          if (acked) return;
          acked = true;
          post({ k: "ack", ts: Date.now(), n });
        },
      });
      return;
    }
    if (msg.k === "revoked") void forget("This phone was removed on your computer. Connect it again from Crew's Settings.");
  }

  async function finishPairing(name: string, push: string) {
    if (!pairing || !device) return;
    pairing.n = name || pairing.n;
    await o.store.set(STORE_KEYS.pair, JSON.stringify(pairing));
    await o.store.set(STORE_KEYS.pushKey, push);
    await o.store.set(STORE_KEYS.hub, pairing.h);
    await o.store.set(STORE_KEYS.phone, device.id);
    set({ paired: true, computerName: pairing.n, problem: null });
    if (pairWaiter) {
      clearTimeout(pairWaiter.timer);
      pairWaiter.resolve();
      pairWaiter = null;
    }
    hello();
  }

  function connect() {
    if (!pairing || !device || relay) return;
    const p = pairing;
    relay = connectRelay({
      url: p.r,
      hubId: p.h,
      device,
      role: "phone",
      WebSocket: o.WebSocket,
      ...o.relayOptions,
      onReady: (computerOnline) => {
        if (!computerOnline) offline();
        else set({ computer: "online", offlineSince: null });
        if (state.paired) hello();
        else if (computerOnline && device) void pairRequest(device, { r: p.r, h: p.h, k: p.k, s: secret, n: p.n }, o.name, o.platform).then((req) => relay?.send({ t: "send", to: p.h, d: JSON.stringify(req) }));
        else if (pairWaiter) failPairing(UNREACHABLE);
      },
      onMessage: (m) => void onRelay(m),
      onStatus: (s) => {
        if (s !== "online") set({ relay: s, ready: false });
        else set({ relay: s });
      },
      onRefused: (code) => {
        relay = null;
        if (!state.paired) failPairing("This code has expired or was already used. Make a new one on your computer.");
        else void forget(code === 4003 ? "Your computer no longer knows this phone. Connect it again from Crew's Settings." : "The relay refused this phone. Connect it again from Crew's Settings.");
      },
    });
  }

  function failPairing(message: string) {
    if (!pairWaiter) return;
    clearTimeout(pairWaiter.timer);
    const w = pairWaiter;
    pairWaiter = null;
    relay?.stop();
    relay = null;
    pairing = null;
    key = null;
    w.reject(new Error(message));
  }

  async function forget(problem: string | null) {
    failAll(problem || "This phone was disconnected.");
    relay?.stop();
    relay = null;
    pairing = null;
    key = null;
    epoch = null;
    lastSeq = 0;
    for (const k of [STORE_KEYS.pair, STORE_KEYS.pushKey, STORE_KEYS.hub]) await o.store.remove(k);
    set({ paired: false, computerName: "", relay: "idle", computer: "unknown", ready: false, offlineSince: null, problem });
  }

  return {
    /** Opens the saved pairing, if any, and connects. Resolves whether this phone is paired. */
    async load(): Promise<boolean> {
      const raw = await o.store.get(STORE_KEYS.pair);
      if (!raw) {
        tell();
        return false;
      }
      try {
        pairing = JSON.parse(raw) as Pairing;
        const d = await ensureDevice();
        key = await pairKey(d.ecdhKey, pairing.k, pairing.h, d.id);
      } catch {
        await forget("This phone's link couldn't be read. Connect it again from Crew's Settings.");
        return false;
      }
      set({ paired: true, computerName: pairing.n, problem: null });
      connect();
      return true;
    },

    /** Pairs with the computer whose code this is. Rejects with what to do. */
    async pair(codeText: string): Promise<void> {
      const code = parsePairCode(codeText);
      if (pairWaiter) throw new Error("Already connecting. Wait a moment.");
      if (relay) {
        relay.stop();
        relay = null;
      }
      const d = await ensureDevice();
      pairing = { r: code.r, h: code.h, k: code.k, n: code.n };
      secret = code.s;
      key = await pairKey(d.ecdhKey, code.k, code.h, d.id);
      epoch = null;
      lastSeq = 0;
      set({ paired: false, computerName: code.n, problem: null });
      const done = new Promise<void>((resolve, reject) => {
        pairWaiter = { resolve, reject, timer: setTimeout(() => failPairing("Your computer didn't answer. Make a new code on it and try again."), pairTimeout) };
      });
      connect();
      return done;
    },

    /** A call to the computer, as the desktop page makes it. Rejects at once when the computer isn't reachable. */
    invoke(ch: string, ...args: unknown[]): Promise<unknown> {
      if (!state.paired) return Promise.reject(new Error("This phone isn't connected to a computer."));
      if (!state.ready) return Promise.reject(new Error(UNREACHABLE));
      const id = randomB64(12);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Your computer took too long to answer. Try again."));
        }, SLOW.has(ch) ? callTimeout * 3 : callTimeout);
        pending.set(id, { id, ch, args, resolve, reject, timer });
        post({ k: "call", ts: Date.now(), id, ch, args });
      });
    },

    /** A fire-and-forget message (the bot's browser input, the view size); dropped when not connected. */
    send(ch: string, ...args: unknown[]) {
      if (state.ready) post({ k: "send", ts: Date.now(), ch, args });
    },

    /** The app came to the front (true) or went to the back: the computer sends notifications only while it is in the back. */
    setVisible(on: boolean) {
      visible = on;
      if (state.ready) post({ k: "visible", ts: Date.now(), on });
      if (on) relay?.nudge();
    },

    setPushToken(token: string | null) {
      pushToken = token;
      if (state.ready) post({ k: "push", ts: Date.now(), token });
    },

    /** The network changed: drop the old socket and connect again now. */
    reconnect() {
      relay?.reconnect();
    },

    /** A new app session (the app started again): the computer forgets what this phone watched. */
    newSession() {
      session = randomB64(9);
      hello();
    },

    /** Forgets the computer on this phone. */
    async unpair() {
      if (state.ready) post({ k: "bye", ts: Date.now() });
      await queue;
      await forget(null);
    },

    get state(): LinkState {
      return { ...state };
    },

    stop() {
      failAll("The app closed.");
      relay?.stop();
      relay = null;
    },
  };
}

export type PhoneLink = ReturnType<typeof createPhoneLink>;
