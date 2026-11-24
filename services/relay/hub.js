// One hub per computer: the relay between Crew on a computer and its paired
// phones. It checks who connects, passes sealed messages it can't read, says
// when the computer or a phone comes and goes, and sends notifications.
// It knows nothing of the platform: worker.js (a Durable Object) and
// server.mjs (Node) give it sockets and a place to keep the allow list.
// docs/plans/crew-mobile.md, section B, is the specification.

import { isDeviceId, randomB64, verifyChallenge } from "../../packages/crew-link/src/index.ts";

export const LIMITS = Object.freeze({
  messageChars: 1_000_000,
  perMinute: 300,
  phones: 8,
  pushesPerMinute: 30,
  pairingMs: 120_000,
  waiting: 16,
});

/** Close codes a device acts on. */
export const CLOSE = Object.freeze({
  auth: 4001,
  notPaired: 4003,
  replaced: 4004,
  limit: 4008,
  tooBig: 4009,
  bad: 4010,
});

/**
 * @typedef {{ id: string, role: "computer" | "phone", n: string, authed: boolean, at: number, window: number, count: number }} Meta
 * @typedef {{ allow: string[] | null, pairingUntil: number }} HubState
 * @typedef {object} Adapter
 * @property {() => any[]} sockets            every open socket of this hub
 * @property {(s: any) => Meta | null} meta
 * @property {(s: any, m: Meta) => void} setMeta
 * @property {(s: any, text: string) => void} send
 * @property {(s: any, code: number, reason: string) => void} close
 * @property {() => HubState} state
 * @property {(st: HubState) => void | Promise<void>} save
 * @property {(token: string, data: { h: string, d: string }) => Promise<{ ok: boolean, error?: string }>} push
 * @property {() => number} [now]
 */

/** Checks the connection's address: the device id and its role. */
export function checkJoin(hubId, id, role) {
  if (!isDeviceId(hubId)) return "That isn't a hub.";
  if (!isDeviceId(id)) return "That isn't a device id.";
  if (role !== "computer" && role !== "phone") return 'The role is "computer" or "phone".';
  if (role === "computer" && id !== hubId) return "A computer connects to its own hub.";
  return null;
}

/**
 * @param {string} hubId
 * @param {Adapter} a
 */
export function createHub(hubId, a) {
  const now = a.now || Date.now;
  let pushes = { window: 0, count: 0 };

  const json = (s, o) => a.send(s, JSON.stringify(o));
  const authed = () => a.sockets().filter((s) => a.meta(s)?.authed);
  const computer = () => authed().find((s) => a.meta(s).role === "computer") || null;
  const phones = () => authed().filter((s) => a.meta(s).role === "phone");
  const pairingOpen = (st) => st.pairingUntil > now();
  const allowed = (st, id) => st.allow === null || st.allow.includes(id) || pairingOpen(st);

  /** A new socket: it gets a challenge and must answer it before anything else. */
  function open(s, id, role) {
    const waiting = a.sockets().filter((x) => x !== s && a.meta(x) && !a.meta(x).authed);
    if (waiting.length >= LIMITS.waiting) a.close(waiting[0], CLOSE.limit, "too many waiting");
    const n = randomB64(32);
    a.setMeta(s, { id, role, n, authed: false, at: now(), window: now(), count: 0 });
    json(s, { t: "challenge", n });
  }

  async function auth(s, m, msg) {
    if (typeof msg.pub !== "string" || typeof msg.sig !== "string" || !(await verifyChallenge(msg.pub, hubId, m.id, m.n, msg.sig))) {
      a.close(s, CLOSE.auth, "auth failed");
      return;
    }
    const st = a.state();
    if (m.role === "phone" && !allowed(st, m.id)) {
      a.close(s, CLOSE.notPaired, "not paired");
      return;
    }
    // The same device again (an app restart, a lingering socket): the newest wins.
    for (const old of authed()) {
      const om = a.meta(old);
      if (old !== s && om.id === m.id) a.close(old, CLOSE.replaced, "replaced");
    }
    if (m.role === "phone" && phones().filter((p) => p !== s).length >= LIMITS.phones) {
      a.close(s, CLOSE.limit, "too many phones");
      return;
    }
    a.setMeta(s, { ...m, authed: true, n: "" });
    const pc = computer();
    json(s, { t: "ready", computer: m.role === "computer" || !!pc });
    if (m.role === "computer") for (const p of phones()) json(p, { t: "presence", id: m.id, online: true });
    else if (pc) json(pc, { t: "presence", id: m.id, online: true });
  }

  async function allow(s, msg) {
    const list = Array.isArray(msg.phones) ? msg.phones.filter(isDeviceId).slice(0, 64) : [];
    const st = { allow: list, pairingUntil: msg.pairing === true ? now() + LIMITS.pairingMs : 0 };
    await a.save(st);
    // A phone taken off the list goes now; phones that came in while pairing stay only if they paired.
    for (const p of phones()) if (!allowed(st, a.meta(p).id)) a.close(p, CLOSE.notPaired, "removed");
  }

  function forward(s, m, msg) {
    if (typeof msg.to !== "string" || typeof msg.d !== "string") return json(s, { t: "error", error: "send needs to and d" });
    const target = m.role === "phone" ? (msg.to === hubId ? computer() : null) : phones().find((p) => a.meta(p).id === msg.to) || null;
    if (!target) return json(s, { t: "undelivered", to: msg.to });
    json(target, { t: "msg", from: m.id, d: msg.d });
  }

  async function push(s, msg) {
    if (typeof msg.token !== "string" || !msg.token || msg.token.length > 4096 || typeof msg.d !== "string") return json(s, { t: "pushed", ok: false, error: "push needs token and d" });
    const t = now();
    if (t - pushes.window > 60_000) pushes = { window: t, count: 0 };
    if (++pushes.count > LIMITS.pushesPerMinute) return json(s, { t: "pushed", ok: false, error: "too many notifications this minute" });
    let r;
    try {
      r = await a.push(msg.token, { h: hubId, d: msg.d });
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e).slice(0, 200) };
    }
    json(s, { t: "pushed", ok: !!r.ok, token: msg.token, ...(r.ok ? {} : { error: r.error || "push failed" }) });
  }

  /** One message from a socket. */
  async function message(s, text) {
    const m = a.meta(s);
    if (!m) return;
    if (text === "ping") return a.send(s, "pong");
    if (typeof text !== "string") return a.close(s, CLOSE.bad, "text only");
    if (text.length > LIMITS.messageChars) return a.close(s, CLOSE.tooBig, "message too big");
    const t = now();
    if (t - m.window > 60_000) {
      m.window = t;
      m.count = 0;
    }
    if (++m.count > LIMITS.perMinute) return a.close(s, CLOSE.limit, "too many messages");
    a.setMeta(s, m);
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return a.close(s, CLOSE.bad, "not json");
    }
    if (!msg || typeof msg !== "object") return a.close(s, CLOSE.bad, "not an object");
    if (!m.authed) {
      if (msg.t === "auth") return auth(s, m, msg);
      return a.close(s, CLOSE.auth, "sign in first");
    }
    if (msg.t === "send") return forward(s, m, msg);
    if (m.role === "computer" && msg.t === "allow") return allow(s, msg);
    if (m.role === "computer" && msg.t === "push") return push(s, msg);
    json(s, { t: "error", error: `unknown message ${String(msg.t).slice(0, 20)}` });
  }

  /** A socket closed (call after it is gone from sockets()). */
  function closed(m) {
    if (!m || !m.authed) return;
    if (m.role === "computer") {
      if (computer()) return;
      for (const p of phones()) json(p, { t: "presence", id: m.id, online: false });
    } else {
      if (phones().some((p) => a.meta(p).id === m.id)) return;
      const pc = computer();
      if (pc) json(pc, { t: "presence", id: m.id, online: false });
    }
  }

  return { open, message, closed };
}
