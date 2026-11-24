// A device's connection to its hub on the relay, kept up for as long as it is
// wanted: signs in, pings, notices a dead socket, and reconnects with backoff.
// Crew's main process and the phone app use this same client.

import { signChallenge, type Device, type RelayIn, type RelayOut } from "./index.ts";

/** What the client is doing now. */
export type RelayStatus = "connecting" | "online" | "waiting" | "stopped";

export interface RelaySocket {
  readyState: number;
  send(text: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface RelayOptions {
  url: string;
  hubId: string;
  device: Device;
  role: "computer" | "phone";
  /** WebSocket constructor (globalThis.WebSocket by default). */
  WebSocket?: new (url: string) => RelaySocket;
  /** Messages from the relay once signed in (msg, presence, undelivered, pushed, error). */
  onMessage(msg: RelayIn): void;
  /** Signed in: whether the computer is online. Called on every (re)connection. */
  onReady(computerOnline: boolean): void;
  onStatus?(status: RelayStatus, detail: { code?: number; reason?: string; retryIn?: number }): void;
  /** The relay refused this device for good (not paired, or signed in wrong): the client stops. */
  onRefused?(code: number, reason: string): void;
  pingMs?: number;
  deadMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  random?: () => number;
}

/** Close codes after which retrying can't help. */
const FINAL = new Set([4001, 4003]);

export function connectRelay(o: RelayOptions) {
  const Ctor = o.WebSocket || (globalThis as unknown as { WebSocket: new (url: string) => RelaySocket }).WebSocket;
  if (!Ctor) throw new Error("This device has no WebSocket.");
  const pingMs = o.pingMs ?? 25_000;
  const deadMs = o.deadMs ?? 60_000;
  const minBackoff = o.minBackoffMs ?? 1000;
  const maxBackoff = o.maxBackoffMs ?? 30_000;
  const random = o.random ?? Math.random;
  const address = `${o.url.replace(/\/+$/, "")}/v1/hub/${o.hubId}?id=${encodeURIComponent(o.device.id)}&role=${o.role}`;

  let ws: RelaySocket | null = null;
  let ready = false;
  let stopped = false;
  let attempt = 0;
  let heard = 0;
  let pinger: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let status: RelayStatus = "connecting";

  const setStatus = (s: RelayStatus, detail: { code?: number; reason?: string; retryIn?: number } = {}) => {
    status = s;
    o.onStatus?.(s, detail);
  };

  function clearTimers() {
    if (pinger) clearInterval(pinger);
    pinger = null;
  }

  function schedule(code?: number, reason?: string) {
    if (stopped) return;
    const base = Math.min(maxBackoff, minBackoff * 2 ** Math.min(attempt, 10));
    const wait = Math.round(base / 2 + random() * (base / 2));
    attempt++;
    setStatus("waiting", { code, reason, retryIn: wait });
    retry = setTimeout(() => {
      retry = null;
      open();
    }, wait);
  }

  function open() {
    if (stopped) return;
    ready = false;
    setStatus("connecting");
    let sock: RelaySocket;
    try {
      sock = new Ctor(address);
    } catch {
      schedule();
      return;
    }
    ws = sock;
    heard = Date.now();
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      heard = Date.now();
      const text = typeof ev.data === "string" ? ev.data : "";
      if (text === "pong") return;
      let msg: RelayIn;
      try {
        msg = JSON.parse(text) as RelayIn;
      } catch {
        return;
      }
      if (msg.t === "challenge") {
        void signChallenge(o.device, o.hubId, msg.n).then((sig) => {
          if (ws === sock && sock.readyState === 1) sock.send(JSON.stringify({ t: "auth", pub: o.device.signPublic, sig }));
        });
        return;
      }
      if (msg.t === "ready") {
        ready = true;
        attempt = 0;
        setStatus("online");
        o.onReady(msg.computer);
        return;
      }
      if (ready) o.onMessage(msg);
    };
    sock.onopen = () => {
      heard = Date.now();
      clearTimers();
      pinger = setInterval(() => {
        if (ws !== sock) return;
        if (Date.now() - heard > deadMs) {
          // No word (not even a pong) for too long: the network went away under us.
          try {
            sock.close(4000, "dead");
          } catch {
            /* closing a broken socket can throw */
          }
          lost(sock, 4000, "no answer");
          return;
        }
        if (sock.readyState === 1) sock.send("ping");
      }, pingMs);
    };
    sock.onerror = () => {};
    sock.onclose = (ev) => lost(sock, ev.code, ev.reason);
  }

  function lost(sock: RelaySocket, code: number, reason: string) {
    if (ws !== sock) return;
    ws = null;
    ready = false;
    clearTimers();
    if (stopped) return;
    if (FINAL.has(code)) {
      stopped = true;
      setStatus("stopped", { code, reason });
      o.onRefused?.(code, reason);
      return;
    }
    schedule(code, reason);
  }

  open();

  return {
    /** Sends a message to the relay; false when not signed in right now (nothing is queued here). */
    send(msg: RelayOut): boolean {
      if (!ws || !ready || ws.readyState !== 1) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    get ready() {
      return ready;
    },
    get status() {
      return status;
    },
    /** Try now instead of waiting out the backoff (the app came to the front, the network came back). */
    nudge() {
      if (stopped || ws) return;
      if (retry) clearTimeout(retry);
      retry = null;
      attempt = 0;
      open();
    },
    /** Drop the socket and reconnect (a network change makes the old socket a zombie). */
    reconnect() {
      if (stopped) return;
      const old = ws;
      if (old) {
        ws = null;
        ready = false;
        clearTimers();
        try {
          old.close(1000, "reconnect");
        } catch {
          /* already closed */
        }
      }
      if (retry) clearTimeout(retry);
      retry = null;
      attempt = 0;
      open();
    },
    stop() {
      stopped = true;
      clearTimers();
      if (retry) clearTimeout(retry);
      retry = null;
      const old = ws;
      ws = null;
      ready = false;
      if (old) {
        try {
          old.close(1000, "bye");
        } catch {
          /* already closed */
        }
      }
      setStatus("stopped", {});
    },
  };
}

export type RelayConnection = ReturnType<typeof connectRelay>;
