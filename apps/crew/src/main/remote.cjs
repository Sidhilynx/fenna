// Crew's side of the phone link (docs/plans/crew-mobile.md, section C): this
// computer's keys, the paired phones, the connection to the relay, and what a
// phone may do. A phone runs the same calls the desktop page runs, from an
// allow list; it gets the same events, numbered so it can catch up after a
// gap; it sees a bot's browser as pictures sent when the page changes; and it
// gets a notification when a bot starts waiting on the person.

const fs = require("node:fs");
const path = require("node:path");
const L = require("./phonelink.cjs");
const { describe } = require("./notify.cjs");

const FILE = "phones.json";
const DEFAULT_RELAY = "wss://relay.sidhilynx.com";
const MAX_PHONES = 8;
const BUFFER = 1000;
const CHANGED_MS = 250;
const RESULTS_MS = 10 * 60_000;
const SEEN_MS = 2 * 60 * 60_000;
const CLOCK_SKEW_MS = 60 * 60_000;
const FRAME_ACK_MS = 3000;
const FRAME_GIVE_UP_MS = 30_000;
const WATCHER_BASE = -1000;
const ON_COMPUTER = "Do this on your computer.";

/** What a phone may call. Anything else answers ON_COMPUTER: pickers, revealing secrets, the person's own files, commands, lowering a bot's limits. */
const PHONE_CALLS = new Set([
  "crew:overview", "crew:bot", "crew:history", "crew:create", "crew:update", "crew:delete", "crew:duplicate",
  "crew:forget", "crew:newChat", "crew:openChat", "crew:compact", "crew:send", "crew:run", "crew:stop",
  "crew:answer", "crew:decide", "crew:saveOffer",
  "crew:teamCreate", "crew:teamUpdate", "crew:teamDelete", "crew:teamSend", "crew:teamThread",
  "crew:registrySearch", "crew:connectors", "crew:connectorSave", "crew:connectorTest", "crew:connectorRemove", "crew:connectorSignOut",
  "crew:skills", "crew:skill", "crew:skillUrl", "crew:skillAdd", "crew:skillRemove", "crew:skillLibrary", "crew:skillLibraryPreview",
  "crew:vault", "crew:vaultSave", "crew:vaultRemove",
  "crew:libraryText", "crew:watches", "crew:removeWatch", "crew:setTodo",
  "crew:watch", "crew:control", "crew:navigate", "crew:browserGo", "crew:tab", "crew:siteIcon",
  "crew:meetings", "crew:meeting", "crew:settings", "crew:setSettings", "crew:clis", "crew:runStats", "crew:feedback",
]);
/** Fire-and-forget messages a phone may send. */
const PHONE_SENDS = new Set(["crew:input", "crew:viewport"]);
/** Events a phone gets. */
const PHONE_EVENTS = new Set(["crew:changed", "crew:event", "crew:browser", "crew:cursor", "crew:connectors", "crew:skills", "crew:vault", "crew:meeting", "crew:watches"]);
/** On a replay only the newest of these matters (per bot for crew:browser). */
const LATEST_ONLY = new Set(["crew:changed", "crew:connectors", "crew:skills", "crew:vault"]);

const errorText = (e) => String((e && e.message) || e || "Something went wrong.").replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/**
 * @param {object} o
 * @param {string} o.dir  where phones.json lives (<userData>/Crew)
 * @param {{ available(): Promise<boolean>, encrypt(t: string): Promise<string>, decrypt(d: string): Promise<string> }} o.secrets
 * @param {Map<string, (e: object, ...args: unknown[]) => unknown>} o.calls  the page's handlers, by channel (ipc.cjs)
 * @param {{ watch(slug: string, id: number, mode: string): Promise<unknown>, setViewport(slug: string, view: unknown, id: number): void, input(slug: string, ev: unknown): void, dropWatcher(id: number): void }} o.browsers
 * @param {string} o.name  this computer's name, shown on the phone
 * @param {string} o.version
 * @param {string} [o.relayUrl]
 * @param {(view: object) => void} [o.onPhones]  the desktop's Settings shows this
 * @param {new (url: string) => any} [o.WebSocket]
 * @param {() => number} [o.now]
 * @param {(line: string) => void} [o.log]
 */
function createRemote({ dir, secrets, calls, browsers, name, version, relayUrl = process.env.FENNA_RELAY_URL || DEFAULT_RELAY, onPhones = () => {}, WebSocket, now = Date.now, log = () => {} }) {
  const file = path.join(dir, FILE);
  /** @type {{ id: string, name: string, platform: string, ecdh: string, sign: string, push: string | null, pairedAt: string, lastSeen: string | null }[]} */
  let phones = [];
  let sealedDevice = null;
  /** @type {import("@opendeck/crew-link").Device | null} */
  let device = null;
  let problem = null;
  let relay = null;
  let relayStatus = "stopped";
  /** @type {{ secret: string | null, until: number, code: string | null, connected: string | null, timer: any } | null} */
  let pairing = null;
  const epoch = L.randomB64(9);
  let seq = 0;
  /** @type {{ seq: number, ch: string, p: unknown }[]} */
  const buffer = [];
  let changed = { last: 0, pending: undefined, timer: null };
  /** phone id → its live session */
  const sessions = new Map();
  const keys = new Map();
  const joiner = L.createJoiner(now);
  let started = false;
  let saveTimer = null;

  // ── Disk ──────────────────────────────────────────────────────────

  function read() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      phones = Array.isArray(raw.phones) ? raw.phones.filter((p) => p && L.isDeviceId(p.id) && typeof p.ecdh === "string" && typeof p.sign === "string") : [];
      sealedDevice = typeof raw.device === "string" ? raw.device : null;
    } catch {
      phones = [];
      sealedDevice = null;
    }
  }

  function write() {
    const tmp = `${file}.tmp`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, device: sealedDevice, phones }, null, 2), "utf8");
    fs.renameSync(tmp, file);
  }

  function saveSoon() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      write();
    }, 2000);
  }

  /** This computer's keys: opened from disk, or made the first time. */
  async function ensureDevice() {
    if (device) return device;
    if (!(await secrets.available())) {
      problem = "This computer has no secure storage for keys, so phone access is off.";
      throw new Error(problem);
    }
    if (sealedDevice) {
      try {
        device = await L.loadDevice(JSON.parse(await secrets.decrypt(sealedDevice)));
        problem = null;
        return device;
      } catch {
        problem = "Crew can't open its phone keys (they were saved by another user or computer). Remove your phones and connect them again.";
        throw new Error(problem);
      }
    }
    const made = await L.newDevice();
    sealedDevice = await secrets.encrypt(JSON.stringify(made.stored));
    device = made.device;
    problem = null;
    write();
    return device;
  }

  // ── Keys and sending ─────────────────────────────────────────────

  async function keyOf(phone) {
    let k = keys.get(phone.id);
    if (!k) {
      k = { pair: await L.pairKey(device.ecdhKey, phone.ecdh, device.id, phone.id), push: null };
      keys.set(phone.id, k);
    }
    return k;
  }

  const phoneById = (id) => phones.find((p) => p.id === id) || null;
  /** Each phone's watcher id in browser.cjs: negative, so it never meets a page's webContents id; stable while Crew runs. */
  const watcherIds = new Map();
  const watcherId = (phone) => {
    if (!watcherIds.has(phone.id)) watcherIds.set(phone.id, WATCHER_BASE - watcherIds.size - 1);
    return watcherIds.get(phone.id);
  };

  /** Messages to one phone go out in the order they were made, sealed one after another. */
  function sendTo(phone, msg) {
    const s = sessions.get(phone.id);
    if (!s || !relay) return;
    s.queue = s.queue
      .then(async () => {
        const k = await keyOf(phone);
        const sealed = await L.seal(k.pair, device.id, phone.id, msg);
        for (const piece of L.toPieces(sealed)) if (!relay || !relay.send({ t: "send", to: phone.id, d: piece })) return;
      })
      .catch((e) => log(`phone: ${errorText(e)}`));
  }

  function online() {
    return [...sessions.entries()].filter(([, s]) => s.online).map(([id]) => phoneById(id)).filter(Boolean);
  }

  // ── The relay ────────────────────────────────────────────────────

  const wanted = () => phones.length > 0 || !!(pairing && pairing.secret);

  function allowList() {
    if (relay) relay.send({ t: "allow", phones: phones.map((p) => p.id), pairing: !!(pairing && pairing.secret && pairing.until > now()) });
  }

  async function connect() {
    if (relay || !wanted()) return;
    await ensureDevice();
    if (relay || !wanted()) return;
    relay = L.connectRelay({
      url: relayUrl,
      hubId: device.id,
      device,
      role: "computer",
      WebSocket,
      onReady: () => allowList(),
      onMessage: (m) => void onRelay(m).catch((e) => log(`phone: ${errorText(e)}`)),
      onStatus: (status) => {
        relayStatus = status;
        // Without the relay no phone is reachable: each says hello again when it is.
        if (status !== "online") for (const [id, s] of sessions) if (s.online) gone(id);
        tell();
      },
      onRefused: (code, reason) => {
        problem = `The relay refused this computer (${code} ${reason}).`;
        relay = null;
        tell();
      },
    });
  }

  function disconnectIfIdle() {
    if (wanted() || !relay) return;
    relay.stop();
    relay = null;
    relayStatus = "stopped";
  }

  async function onRelay(m) {
    if (m.t === "msg") return onMessage(m.from, m.d);
    if (m.t === "presence" || m.t === "undelivered") {
      const id = m.t === "presence" ? m.id : m.to;
      if (m.t === "presence" && m.online) return;
      gone(id);
      return;
    }
    if (m.t === "pushed" && !m.ok && m.error === "unregistered" && m.token) {
      for (const p of phones) if (p.push === m.token) p.push = null;
      write();
      tell();
    }
  }

  // ── Pairing ──────────────────────────────────────────────────────

  async function startPairing() {
    await ensureDevice();
    if (phones.length >= MAX_PHONES) throw new Error(`${MAX_PHONES} phones are connected, the most Crew keeps. Remove one first.`);
    if (pairing && pairing.timer) clearTimeout(pairing.timer);
    const secret = L.randomB64(16);
    const until = now() + L.PAIR_TTL_MS;
    const code = L.makePairCode({ r: relayUrl, h: device.id, k: device.ecdhPublic, s: secret, n: name });
    pairing = { secret, until, code, connected: null, timer: setTimeout(endPairing, L.PAIR_TTL_MS) };
    await connect();
    allowList();
    tell();
    return { code, expiresAt: new Date(until).toISOString() };
  }

  function endPairing() {
    if (!pairing) return;
    clearTimeout(pairing.timer);
    pairing = null;
    allowList();
    disconnectIfIdle();
    tell();
  }

  async function pair(from, d) {
    if (!pairing || !pairing.secret || pairing.until < now() || phones.length >= MAX_PHONES) return;
    let req;
    try {
      req = JSON.parse(d);
    } catch {
      return;
    }
    let box;
    try {
      box = await L.openPairRequest(device, from, req, pairing.secret);
    } catch {
      return;
    }
    const phone = { id: from, name: box.name || "Phone", platform: box.platform, ecdh: req.ecdh, sign: box.sign, push: null, pairedAt: new Date(now()).toISOString(), lastSeen: new Date(now()).toISOString() };
    phones = [...phones.filter((p) => p.id !== from), phone];
    keys.delete(from);
    write();
    pairing.secret = null;
    pairing.code = null;
    pairing.connected = phone.name;
    clearTimeout(pairing.timer);
    pairing.timer = setTimeout(endPairing, 60_000);
    allowList();
    sessions.set(from, newSession());
    const push = await L.pushKeyRaw(device.ecdhKey, phone.ecdh, device.id, phone.id);
    sendTo(phone, { k: "paired", name, push });
    tell();
  }

  // ── A phone's session ────────────────────────────────────────────

  function newSession() {
    return { id: "", online: false, visible: false, queue: Promise.resolve(), watching: new Set(), frame: { n: 0, inFlight: 0, sentAt: 0, pending: null, lastAck: 0 }, results: new Map(), seen: new Map(), sent: 0 };
  }

  function gone(id) {
    const s = sessions.get(id);
    const phone = phoneById(id);
    if (!s || !phone) return;
    if (s.online) {
      phone.lastSeen = new Date(now()).toISOString();
      saveSoon();
    }
    s.online = false;
    s.visible = false;
    s.watching.clear();
    s.frame.pending = null;
    browsers.dropWatcher(watcherId(phone));
    tell();
  }

  async function onMessage(from, d) {
    const whole = joiner.add(from, d);
    if (whole === null) return;
    const phone = phoneById(from);
    if (!phone) {
      if (whole.startsWith("{")) await pair(from, whole);
      return;
    }
    let msg;
    try {
      msg = await L.open((await keyOf(phone)).pair, from, device.id, whole);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.k !== "string") return;
    if (!sessions.has(from)) sessions.set(from, newSession());
    const s = sessions.get(from);
    if (msg.k === "hello") return hello(phone, s, msg);
    if (!s.online) return;
    if (msg.k === "call") return call(phone, s, msg);
    if (msg.k === "send") return fire(phone, s, msg);
    if (msg.k === "ack") return ack(phone, s, msg.n);
    if (msg.k === "visible") {
      s.visible = msg.on === true;
      return;
    }
    if (msg.k === "push") return setPush(phone, msg.token);
    if (msg.k === "bye") gone(from);
  }

  function setPush(phone, token) {
    const t = typeof token === "string" && token.length <= 4096 ? token : null;
    if (phone.push === t) return;
    phone.push = t;
    write();
    tell();
  }

  function hello(phone, s, msg) {
    if (s.online) browsers.dropWatcher(watcherId(phone));
    s.id = String(msg.session || "");
    s.online = true;
    s.visible = msg.visible === true;
    s.watching.clear();
    s.frame = { n: 0, inFlight: 0, sentAt: 0, pending: null, lastAck: now() };
    phone.lastSeen = new Date(now()).toISOString();
    if (msg.push !== undefined) setPush(phone, msg.push);
    saveSoon();
    const first = buffer.length ? buffer[0].seq : seq + 1;
    const canReplay = msg.epoch === epoch && Number.isInteger(msg.seq) && msg.seq <= seq && msg.seq >= first - 1;
    sendTo(phone, { k: "welcome", epoch, seq, resync: !canReplay, name, version });
    s.sent = canReplay ? msg.seq : seq;
    if (canReplay) for (const e of replayAfter(msg.seq)) sendEvent(phone, s, e);
    tell();
  }

  /** The events after seq, without ones a newer event of the same kind replaces. */
  function replayAfter(after) {
    const list = buffer.filter((e) => e.seq > after);
    const keep = new Set();
    const newest = new Map();
    for (const e of list) {
      const key = LATEST_ONLY.has(e.ch) ? e.ch : e.ch === "crew:browser" && e.p && e.p.slug ? `b:${e.p.slug}` : null;
      if (key) newest.set(key, e.seq);
    }
    for (const seqOf of newest.values()) keep.add(seqOf);
    return list.filter((e) => {
      const key = LATEST_ONLY.has(e.ch) || e.ch === "crew:browser";
      return !key || keep.has(e.seq);
    });
  }

  async function call(phone, s, msg) {
    const id = typeof msg.id === "string" ? msg.id.slice(0, 64) : "";
    if (!id) return;
    const t = now();
    for (const [k, v] of s.results) if (t - v.at > RESULTS_MS) s.results.delete(k);
    for (const [k, at] of s.seen) if (t - at > SEEN_MS) s.seen.delete(k);
    const done = s.results.get(id);
    if (done) {
      if (done.msg) sendTo(phone, done.msg);
      return;
    }
    if (s.seen.has(id)) return;
    s.seen.set(id, t);
    if (!Number.isFinite(msg.ts) || Math.abs(t - msg.ts) > CLOCK_SKEW_MS) return answer(phone, s, id, false, "Your phone's clock is more than an hour off. Set it to the right time and try again.");
    const ch = String(msg.ch || "");
    const args = Array.isArray(msg.args) ? msg.args : [];
    if (!PHONE_CALLS.has(ch)) return answer(phone, s, id, false, ON_COMPUTER);
    s.results.set(id, { at: t, msg: null });
    try {
      const value = ch === "crew:watch" ? await watch(phone, s, args[0], args[1]) : await run(phone, ch, args);
      answer(phone, s, id, true, value);
    } catch (e) {
      answer(phone, s, id, false, errorText(e));
    }
  }

  function run(phone, ch, args) {
    const fn = calls.get(ch);
    if (!fn) throw new Error(ON_COMPUTER);
    return fn({ sender: { id: watcherId(phone) }, phone: phone.id }, ...args);
  }

  function answer(phone, s, id, ok, value) {
    const msg = ok ? { k: "result", id, ok: true, value: value === undefined ? null : value } : { k: "result", id, ok: false, error: String(value) };
    s.results.set(id, { at: now(), msg });
    sendTo(phone, msg);
  }

  async function watch(phone, s, slug, mode) {
    if (typeof slug !== "string") throw new Error("Say which bot.");
    if (!["live", "thumb", "off"].includes(mode)) throw new Error('Watch mode is "live", "thumb" or "off".');
    if (mode === "off") s.watching.delete(slug);
    else s.watching.add(slug);
    if (mode === "live") s.frame = { ...s.frame, inFlight: 0, pending: null, lastAck: now() };
    return browsers.watch(slug, watcherId(phone), mode === "live" ? "remote" : mode);
  }

  function fire(phone, s, msg) {
    const ch = String(msg.ch || "");
    const args = Array.isArray(msg.args) ? msg.args : [];
    if (!PHONE_SENDS.has(ch) || typeof args[0] !== "string") return;
    if (ch === "crew:input") browsers.input(args[0], args[1]);
    else if (ch === "crew:viewport") browsers.setViewport(args[0], args[1], watcherId(phone));
  }

  // ── Frames ───────────────────────────────────────────────────────

  function frame(slug, f) {
    for (const phone of online()) {
      const s = sessions.get(phone.id);
      if (!s.watching.has(slug)) continue;
      // A phone that stopped answering long ago is gone, whatever the relay thinks.
      if (now() - s.frame.lastAck > FRAME_GIVE_UP_MS && s.frame.inFlight) {
        s.watching.delete(slug);
        browsers.dropWatcher(watcherId(phone));
        continue;
      }
      if (s.frame.inFlight && now() - s.frame.sentAt < FRAME_ACK_MS) {
        s.frame.pending = { slug, f };
        continue;
      }
      sendFrame(phone, s, slug, f);
    }
  }

  function sendFrame(phone, s, slug, f) {
    s.frame.n++;
    s.frame.inFlight = s.frame.n;
    s.frame.sentAt = now();
    s.frame.pending = null;
    sendTo(phone, { k: "frame", n: s.frame.n, slug, tab: f.tab, jpeg: new Uint8Array(f.jpeg), width: f.width, height: f.height, viewWidth: f.viewWidth, viewHeight: f.viewHeight });
  }

  function ack(phone, s, n) {
    if (n !== s.frame.inFlight) return;
    s.frame.inFlight = 0;
    s.frame.lastAck = now();
    const p = s.frame.pending;
    if (p && s.watching.has(p.slug)) sendFrame(phone, s, p.slug, p.f);
  }

  // ── Events ───────────────────────────────────────────────────────

  function emit(ch, p) {
    seq++;
    buffer.push({ seq, ch, p });
    if (buffer.length > BUFFER) buffer.splice(0, buffer.length - BUFFER);
    for (const phone of online()) {
      if (ch === "crew:cursor" && !(p && sessions.get(phone.id).watching.has(p.slug))) continue;
      sendEvent(phone, sessions.get(phone.id), { seq, ch, p });
    }
  }

  /** One event to one phone, naming the one it got before, so the phone sees a gap. */
  function sendEvent(phone, s, e) {
    sendTo(phone, { k: "ev", seq: e.seq, a: s.sent, ch: e.ch, p: e.p });
    s.sent = e.seq;
  }

  /** The desktop page's events; those a phone needs go to the phones. crew:changed at most 4 a second, the newest winning. */
  function publish(ch, p) {
    if (!PHONE_EVENTS.has(ch) || !started) return;
    if (ch !== "crew:changed") return emit(ch, p);
    const wait = CHANGED_MS - (now() - changed.last);
    if (wait <= 0 && !changed.timer) {
      changed.last = now();
      return emit(ch, p);
    }
    changed.pending = p;
    if (!changed.timer) {
      changed.timer = setTimeout(() => {
        changed.timer = null;
        changed.last = now();
        const latest = changed.pending;
        changed.pending = undefined;
        emit("crew:changed", latest);
      }, Math.max(0, wait));
    }
  }

  // ── Notifications ────────────────────────────────────────────────

  let notified = new Set();

  /** Everything waiting now; each new wait is pushed once to each phone that isn't open in front. */
  function needs(waiting, offers = []) {
    const items = [
      ...waiting.map((w) => ({ id: w.id, slug: w.slug, title: w.botName, body: describe(w), kind: w.kind })),
      ...offers.map((o) => ({ id: `offer:${o.id}`, slug: o.slug, title: o.botName, body: "Save the login you just used?", kind: "offer" })),
    ];
    const fresh = items.filter((i) => !notified.has(i.id) && i.body);
    notified = new Set(items.map((i) => i.id));
    if (!fresh.length || !relay || !relay.ready || !device) return;
    for (const phone of phones) {
      const s = sessions.get(phone.id);
      if (!phone.push || (s && s.online && s.visible)) continue;
      void pushTo(phone, fresh).catch((e) => log(`push: ${errorText(e)}`));
    }
  }

  async function pushTo(phone, items) {
    const k = await keyOf(phone);
    if (!k.push) k.push = await L.importPushKey(await L.pushKeyRaw(device.ecdhKey, phone.ecdh, device.id, phone.id));
    for (const item of items.slice(0, 5)) {
      const d = await L.seal(k.push, device.id, phone.id, { id: item.id, slug: item.slug, title: item.title, body: item.body, kind: item.kind });
      if (relay) relay.send({ t: "push", token: phone.push, d });
    }
  }

  // ── The desktop's view ───────────────────────────────────────────

  function view() {
    return {
      problem,
      relay: relayStatus,
      relayUrl,
      pairing: pairing ? { code: pairing.code, expiresAt: new Date(pairing.until).toISOString(), connected: pairing.connected } : null,
      phones: phones.map((p) => {
        const s = sessions.get(p.id);
        return { id: p.id, name: p.name, platform: p.platform, pairedAt: p.pairedAt, lastSeen: p.lastSeen, online: !!(s && s.online), notifications: !!p.push };
      }),
    };
  }

  function tell() {
    onPhones(view());
  }

  async function remove(id) {
    const phone = phoneById(id);
    if (!phone) throw new Error("That phone isn't connected any more.");
    const s = sessions.get(id);
    if (s && s.online) {
      sendTo(phone, { k: "revoked" });
      await s.queue;
    }
    browsers.dropWatcher(watcherId(phone));
    phones = phones.filter((p) => p.id !== id);
    sessions.delete(id);
    keys.delete(id);
    write();
    allowList();
    disconnectIfIdle();
    tell();
    return view();
  }

  return {
    PHONE_CALLS,
    PHONE_EVENTS,
    /** Reads the paired phones and connects to the relay if there are any. */
    async start() {
      started = true;
      read();
      if (phones.length) {
        await connect().catch((e) => {
          problem = problem || errorText(e);
          tell();
        });
      }
    },
    stop() {
      started = false;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        write();
      }
      if (changed.timer) clearTimeout(changed.timer);
      if (pairing && pairing.timer) clearTimeout(pairing.timer);
      for (const [id, s] of sessions) {
        const phone = phoneById(id);
        if (phone && s.online) browsers.dropWatcher(watcherId(phone));
      }
      if (relay) relay.stop();
      relay = null;
    },
    view,
    startPairing,
    cancelPairing: () => {
      endPairing();
      return view();
    },
    remove,
    publish,
    frame,
    needs,
  };
}

module.exports = { createRemote, PHONE_CALLS, PHONE_EVENTS, PHONE_SENDS, ON_COMPUTER };
