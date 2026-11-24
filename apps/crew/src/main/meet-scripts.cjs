// Scripts for the Google Meet tab the bot is in. Each page function is sent as
// source text through the DevTools protocol, so it must not use anything outside
// its own body: every helper and regex is defined inside it. Meet hides its class
// names, so everything is found by role, aria-label and visible text (MEET_LABELS
// is the documented list; the functions carry their own copies).

const MEET_LABELS = {
  button: 'button, [role="button"]',
  nameInput: 'input[aria-label="Your name"]',
  nameInputPlaceholder: "your name",
  joinButtons: ["Join now", "Ask to join"],
  micOn: "Turn off microphone",
  micOff: "Turn on microphone",
  cameraOn: "Turn off camera",
  cameraOff: "Turn on camera",
  waiting: ["Asking to be let in", "Please wait until a meeting host brings you into the call"],
  inCall: "Leave call",
  denied: ["You can't join this video call", "denied your request", "You've been removed"],
  ended: ["You left the meeting", "The call has ended", "You've left the call"],
  captionsOn: "Turn off captions",
  captionsOff: "Turn on captions",
  captionsRegion: '[role="region"][aria-label*="Captions" i]',
  chatToggle: "Chat with everyone",
  chatInput: 'textarea[aria-label^="Send a message" i]',
  messageId: "[data-message-id]",
  senderAttr: "data-sender-name",
  present: ["Share screen", "Present now"],
  stopPresenting: "Stop presenting",
  people: "^People\\b.*?(\\d+)",
  signInHost: "accounts.google.com",
};

function meetState() {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const shown = (el) => el.getClientRects().length > 0;
  const live = () => [...document.querySelectorAll('button, [role="button"]')].filter((b) => shown(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true");
  const named = (prefix) => live().some((b) => norm(b.getAttribute("aria-label")).startsWith(prefix));
  const says = (phrases) => {
    const text = norm(document.body ? document.body.innerText : "");
    return phrases.some((p) => text.includes(norm(p)));
  };
  const inputs = () => [...document.querySelectorAll("input")].filter(shown);
  const nameField = inputs().some((i) => i.getAttribute("aria-label") === "Your name" || /your name/i.test(i.getAttribute("placeholder") || ""));
  const joinShown = live().some((b) => ["join now", "ask to join"].includes(norm(b.textContent)));
  const chatShown = [...document.querySelectorAll("textarea")].some((t) => shown(t) && norm(t.getAttribute("aria-label")).startsWith("send a message"));
  const people = live()
    .map((b) => /^People\b.*?(\d+)/i.exec(String(b.getAttribute("aria-label") || "").trim()))
    .find(Boolean);

  let state = "unknown";
  if (location.hostname === "accounts.google.com") state = "signin";
  else if (named("leave call")) state = "incall";
  else if (says(["You can't join this video call", "denied your request", "You've been removed"])) state = "denied";
  else if (says(["You left the meeting", "The call has ended", "You've left the call"])) state = "ended";
  else if (says(["Asking to be let in", "Please wait until a meeting host brings you into the call"])) state = "waiting";
  else if (nameField || joinShown) state = "prejoin";

  return {
    state,
    // A narrow or minimized window moves the toggle into the overflow menu; the captions region still shows they are on.
    captions: named("turn off captions") || !!document.querySelector('[role="region"][aria-label*="Captions" i]'),
    chatOpen: chatShown,
    presenting: named("stop presenting"),
    people: people ? Number(people[1]) : null,
  };
}

/** Focuses the guest name field with its text selected, so Crew can type the name over it with real key input. */
function meetNameFocus() {
  const shown = (el) => el.getClientRects().length > 0;
  const inputs = [...document.querySelectorAll("input")].filter(shown);
  const field = inputs.find((i) => i.getAttribute("aria-label") === "Your name") || inputs.find((i) => /your name/i.test(i.getAttribute("placeholder") || "")) || null;
  if (!field) return { found: false, focused: false, value: "" };
  field.focus();
  field.select();
  return { found: true, focused: document.activeElement === field, value: field.value };
}

/**
 * Turns the microphone off and presses Join now, else Ask to join. Meet enables
 * its guest button only for a name typed for real (Crew types it first with
 * meetNameFocus and Input.insertText); the name is set from script only when
 * the field is still empty after that.
 */
function meetPrejoin(arg) {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const shown = (el) => el.getClientRects().length > 0;
  const off = (b) => b.disabled || b.getAttribute("aria-disabled") === "true";
  const all = () => [...document.querySelectorAll('button, [role="button"]')].filter(shown);
  const live = () => all().filter((b) => !off(b));
  const named = (prefix) => live().find((b) => norm(b.getAttribute("aria-label")).startsWith(prefix)) || null;
  const says = (b, words) => norm(b.textContent) === words || norm(b.getAttribute("aria-label")) === words;

  const inputs = [...document.querySelectorAll("input")].filter(shown);
  const field = inputs.find((i) => i.getAttribute("aria-label") === "Your name") || inputs.find((i) => /your name/i.test(i.getAttribute("placeholder") || "")) || null;
  const name = (arg || {}).name;
  let filled = !!field && typeof name === "string" && field.value === name;
  if (field && !field.value && typeof name === "string" && name) {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setValue.call(field, name);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    filled = field.value === name;
  }

  const mic = named("turn off microphone");
  if (mic) mic.click();

  const buttons = live();
  const join = buttons.find((b) => says(b, "join now"));
  if (join) {
    join.click();
    return { clicked: "join", filled, disabled: false, nameField: !!field };
  }
  const ask = buttons.find((b) => says(b, "ask to join"));
  if (ask) {
    ask.click();
    return { clicked: "ask", filled, disabled: false, nameField: !!field };
  }
  const disabled = all().some((b) => off(b) && (says(b, "join now") || says(b, "ask to join")));
  return { clicked: null, filled, disabled, nameField: !!field };
}

function meetCaptionsOn() {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const shown = (el) => el.getClientRects().length > 0;
  const live = () => [...document.querySelectorAll('button, [role="button"]')].filter((b) => shown(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true");
  const named = (prefix) => live().find((b) => norm(b.getAttribute("aria-label")).startsWith(prefix)) || null;

  if (named("turn off captions") || document.querySelector('[role="region"][aria-label*="Captions" i]')) return { on: true };
  const toggle = named("turn on captions");
  if (!toggle) {
    // No toggle in sight (a narrow or minimized window hides it): Crew presses Meet's "c" shortcut, so nothing may hold the focus.
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    return { on: false, key: true };
  }
  toggle.click();
  return { on: true };
}

function meetChatFocus() {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const shown = (el) => el.getClientRects().length > 0;
  const live = () => [...document.querySelectorAll('button, [role="button"]')].filter((b) => shown(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true");
  const chatInput = () => [...document.querySelectorAll("textarea")].find((t) => shown(t) && norm(t.getAttribute("aria-label")).startsWith("send a message")) || null;

  if (!chatInput()) {
    const toggle = live().find((b) => norm(b.getAttribute("aria-label")).startsWith("chat with everyone"));
    if (toggle) toggle.click();
  }
  const input = chatInput();
  if (!input) return { ok: false };
  input.focus();
  return { ok: document.activeElement === input };
}

function meetPresent() {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const shown = (el) => el.getClientRects().length > 0;
  const live = () => [...document.querySelectorAll('button, [role="button"]')].filter((b) => shown(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true");
  const named = (prefix) => live().find((b) => norm(b.getAttribute("aria-label")).startsWith(prefix)) || null;

  if (named("stop presenting")) return { clicked: false };
  const share = named("share screen") || named("present now");
  if (!share) return { clicked: false };
  share.click();
  return { clicked: true };
}

function meetStopPresenting() {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const shown = (el) => el.getClientRects().length > 0;
  const live = () => [...document.querySelectorAll('button, [role="button"]')].filter((b) => shown(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true");

  const stop = live().find((b) => norm(b.getAttribute("aria-label")).startsWith("stop presenting"));
  if (!stop) return { clicked: false };
  stop.click();
  return { clicked: true };
}

function meetLeave() {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const shown = (el) => el.getClientRects().length > 0;
  const live = () => [...document.querySelectorAll('button, [role="button"]')].filter((b) => shown(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true");

  const leave = live().find((b) => norm(b.getAttribute("aria-label")).startsWith("leave call"));
  if (!leave) return { clicked: false };
  leave.click();
  return { clicked: true };
}

/** Runs in the main world before the page: fakes camera, microphone and screen share for the Meet origins only. */
function meetMediaMain(arg) {
  try {
    if (!arg.hosts.includes(location.origin)) return;
    const md = navigator.mediaDevices;
    if (!md) return;
    const proto = Object.getPrototypeOf(md);
    const define = (obj, key, value) => Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });

    let mic = null;
    const micSource = () => {
      if (!mic) {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const dest = ctx.createMediaStreamDestination();
        osc.connect(gain);
        gain.connect(dest);
        osc.start();
        ctx.resume().catch(() => {});
        mic = dest.stream.getAudioTracks()[0];
      }
      return mic.clone();
    };

    let camera = null;
    const cameraSource = () => {
      if (!camera) {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const g = canvas.getContext("2d");
        const paint = () => {
          g.fillStyle = "#202124";
          g.fillRect(0, 0, 640, 360);
          g.fillStyle = "#ffffff";
          g.font = "32px sans-serif";
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(arg.name, 320, 180, 600);
        };
        paint();
        setInterval(paint, 1000);
        camera = canvas.captureStream(5).getVideoTracks()[0];
      }
      return camera.clone();
    };

    const stage = document.createElement("canvas");
    stage.width = 1280;
    stage.height = 720;
    const sg = stage.getContext("2d");
    let image = null;
    let track = null;
    let timer = 0;
    const paintStage = () => {
      sg.fillStyle = "#000";
      sg.fillRect(0, 0, 1280, 720);
      if (!image) return;
      const k = Math.min(1280 / image.naturalWidth, 720 / image.naturalHeight);
      const w = image.naturalWidth * k;
      const h = image.naturalHeight * k;
      sg.drawImage(image, (1280 - w) / 2, (720 - h) / 2, w, h);
    };
    paintStage();

    const displayMedia = () => {
      if (track) track.stop();
      const stream = stage.captureStream(4);
      const t = stream.getVideoTracks()[0];
      const nativeStop = Object.getPrototypeOf(t).stop;
      const stop = () => {
        if (t.readyState === "ended") return;
        nativeStop.call(t);
        if (track === t) {
          track = null;
          clearInterval(timer);
        }
        t.dispatchEvent(new Event("ended"));
      };
      Object.defineProperty(t, "stop", { value: stop, writable: true, configurable: true });
      track = t;
      clearInterval(timer);
      timer = setInterval(paintStage, 500);
      return Promise.resolve(stream);
    };

    define(proto, "getUserMedia", function getUserMedia(c) {
      return new Promise((resolve) => {
        const want = c || {};
        if (!want.audio && !want.video) throw new TypeError("audio or video must be requested");
        const tracks = [];
        if (want.audio) tracks.push(micSource());
        if (want.video) tracks.push(cameraSource());
        resolve(new MediaStream(tracks));
      });
    });
    define(proto, "enumerateDevices", function enumerateDevices() {
      const device = (kind, deviceId, label) => ({ deviceId, kind, label, groupId: "fenna" });
      return Promise.resolve([
        device("audioinput", "fenna-microphone", "Fenna microphone"),
        device("videoinput", "fenna-camera", "Fenna camera"),
        device("audiooutput", "fenna-speaker", "Fenna speaker"),
      ]);
    });
    define(proto, "getDisplayMedia", displayMedia);

    const perms = navigator.permissions;
    if (perms) {
      const originalQuery = perms.query;
      define(Object.getPrototypeOf(perms), "query", function query(desc) {
        if (desc && (desc.name === "camera" || desc.name === "microphone")) return Promise.resolve({ name: desc.name, state: "granted", onchange: null });
        return originalQuery.call(perms, desc);
      });
    }

    Object.defineProperty(window, "__fennaStage", {
      value: {
        draw(dataUrl) {
          return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              image = img;
              paintStage();
              resolve();
            };
            img.onerror = () => reject(new Error("the stage image did not load"));
            img.src = dataUrl;
          });
        },
        clear() {
          image = null;
          paintStage();
        },
        active() {
          return track !== null;
        },
      },
      configurable: true,
      enumerable: false,
      writable: false,
    });
  } catch {
    // A failed fake must never break the Meet page.
  }
}

/** Runs in the isolated world: reports captions and new chat messages through the binding. */
function meetListenIsolated(arg) {
  try {
    const CAP = 2000;
    const WAIT = 300;
    const clip = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, CAP);
    const emit = (event) => {
      try {
        if (typeof window[arg.binding] === "function") window[arg.binding](JSON.stringify(event));
      } catch {
        // The page side is gone; nothing to report to.
      }
    };

    let live = false;
    let timer = 0;
    const ids = new WeakMap();
    let nextId = 1;
    const blockId = (el) => {
      let id = ids.get(el);
      if (!id) {
        id = nextId++;
        ids.set(el, id);
      }
      return id;
    };
    const recs = new WeakMap();
    const fire = (block, rec) => {
      rec.timer = 0;
      if (!rec.latest || rec.latest.key === rec.sent) return;
      rec.sent = rec.latest.key;
      rec.at = Date.now();
      emit({ kind: "caption", block: blockId(block), speaker: rec.latest.speaker, text: rec.latest.text });
    };
    const caption = (block, speaker, text) => {
      if (!text) return;
      let rec = recs.get(block);
      if (!rec) {
        rec = { latest: null, sent: "", at: 0, timer: 0 };
        recs.set(block, rec);
      }
      const key = speaker + "\n" + text;
      rec.latest = { key, speaker, text };
      if (key === rec.sent || rec.timer) return;
      const wait = WAIT - (Date.now() - rec.at);
      if (wait <= 0) fire(block, rec);
      else rec.timer = setTimeout(() => fire(block, rec), wait);
    };

    const leafTexts = (node) => {
      const out = [];
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = clip(n.nodeValue);
        if (t) out.push(t);
      }
      return out;
    };
    const scanCaptions = () => {
      const region = document.querySelector('[role="region"][aria-label*="Captions" i]');
      if (!region) return;
      for (const block of region.children) {
        // Meet's own controls in the region ("Jump to bottom") are not captions.
        if (block.matches('button, [role="button"]') || block.querySelector('button, [role="button"]')) continue;
        const parts = leafTexts(block);
        if (parts.length) caption(block, parts[0], clip(parts.slice(1).join(" ")));
      }
    };

    const chatSeen = new Set();
    const scanChat = () => {
      for (const el of document.querySelectorAll("[data-message-id]")) {
        const id = el.getAttribute("data-message-id");
        if (!id || chatSeen.has(id)) continue;
        const text = clip(el.innerText);
        if (!text) continue;
        chatSeen.add(id);
        const holder = el.closest("[data-sender-name]");
        emit({ kind: "chat", id, sender: holder ? holder.getAttribute("data-sender-name") || "" : "", text });
      }
    };

    const scan = () => {
      timer = 0;
      if (!live) return;
      scanCaptions();
      scanChat();
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(scan, 100);
    };
    const seed = () => {
      for (const el of document.querySelectorAll("[data-message-id]")) {
        const id = el.getAttribute("data-message-id");
        if (id) chatSeen.add(id);
      }
      live = true;
      schedule();
    };

    new MutationObserver(schedule).observe(document, { subtree: true, childList: true, characterData: true });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", seed, { once: true });
    else seed();
  } catch {
    // The listener is optional; the page keeps working without it.
  }
}

/** JavaScript text for Page.addScriptToEvaluateOnNewDocument (main world). */
function meetMediaSource({ hosts, name }) {
  return "(" + meetMediaMain.toString() + ")(" + JSON.stringify({ hosts, name }) + ")";
}

/** JavaScript text for Page.addScriptToEvaluateOnNewDocument with worldName (isolated world). */
function meetListenSource({ binding }) {
  return "(" + meetListenIsolated.toString() + ")(" + JSON.stringify({ binding }) + ")";
}

module.exports = { MEET_LABELS, meetMediaSource, meetState, meetNameFocus, meetPrejoin,meetCaptionsOn, meetChatFocus, meetPresent, meetStopPresenting, meetLeave, meetListenSource };
