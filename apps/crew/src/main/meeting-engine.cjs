// The transcript of a meeting, as pure logic. Caption blocks and chat lines
// go in; the engine keeps one line per finished block or message, and wakes
// the bot (once it is free, and within its hourly limit) when someone says
// its name. Timers and the clock are injected, so tests can run them.

const FINAL_MS = 1500;
const WAKE_DELAY_MS = 700;
const WAKE_LINES = 60;
const WAKE_CHARS = 6000;
const WAKES_PER_HOUR = 60;
const HOUR_MS = 3_600_000;
const CHAT_MAX = 500;
const CHAT_PARTS = 3;

const WORD = /[\p{L}\p{N}']+/gu;
const NAME_EDGE = "(?<![\\p{L}\\p{N}'])";
const NAME_END = "(?![\\p{L}\\p{N}'])";

const clean = (v) => String(v ?? "").trim();
const pad = (n) => String(n).padStart(2, "0");

function formatLine(date, speaker, text) {
  return `[${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}] ${speaker}: ${text}`;
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when the text names one of the names: as a whole word, optionally after "@", and for one-word names of 5+ letters with one letter wrong. */
function addressed(text, names) {
  const body = String(text ?? "");
  const words = body.toLowerCase().match(WORD) || [];
  return names.some((raw) => {
    const name = clean(raw).toLowerCase();
    if (!name) return false;
    const parts = name.split(/\s+/);
    const phrase = new RegExp(`${NAME_EDGE}@?${parts.map(escapeRe).join("\\s+")}${NAME_END}`, "iu");
    if (phrase.test(body)) return true;
    if (parts.length > 1 || (name.match(/\p{L}/gu) || []).length < 5) return false;
    return words.some((w) => levenshtein(w, name) <= 1);
  });
}

/** Where a chunk of at most max characters should end: a line break, else a sentence end, else a space. */
function breakAt(s, max) {
  const win = s.slice(0, max + 1);
  const line = win.lastIndexOf("\n");
  if (line > 0) return line;
  const sentence = Math.max(win.lastIndexOf(". "), win.lastIndexOf("? "), win.lastIndexOf("! "));
  if (sentence > 0) return sentence + 1;
  const space = win.lastIndexOf(" ");
  if (space > 0) return space;
  return max;
}

function splitParts(text) {
  const parts = [];
  let rest = text;
  while (rest.length > CHAT_MAX) {
    if (parts.length === CHAT_PARTS - 1) {
      return [...parts, rest.slice(0, breakAt(rest, CHAT_MAX - 1)).trimEnd() + "…"];
    }
    const cut = breakAt(rest, CHAT_MAX);
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return [...parts, rest];
}

/** The chat text for a final reply: null for nothing or SKIP, else plain text in at most 3 messages. */
function replyText(finalText) {
  if (finalText === null || finalText === undefined) return null;
  const raw = String(finalText).trim();
  if (!raw || /^[\s\p{P}`*]*skip[\s\p{P}`*]*$/iu.test(raw)) return null;
  const text = raw
    .replace(/```(?:[^\n`]*\n)?([\s\S]*?)```/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/^([ \t]*)[*+][ \t]+/gm, "$1- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return splitParts(text);
}

/**
 * One meeting's transcript. caption() takes a Meet caption block, chat() a
 * chat message; both end up in lines() and may wake the bot through onWake.
 */
function createMeetingEngine({
  botName,
  aliases = [],
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onLine = () => {},
  onWake = () => {},
  busy = () => false,
} = {}) {
  const names = [botName, ...aliases].map(clean).filter(Boolean);
  /** block number → the block as it reads now, with its final timer. */
  const open = new Map();
  /** block number → how many of its words are already written as lines. */
  const done = new Map();
  const lines = [];
  /** How many lines the last wake already carried. */
  let cursor = 0;
  /** Times (ms) of the wakes in the last hour. */
  const wakes = [];
  let wakeTimer = null;
  let pending = false;
  let stopped = false;

  function emit(speaker, text) {
    const line = formatLine(now(), speaker, text);
    lines.push(line);
    onLine(line);
    if (addressed(text, names)) scheduleWake();
  }

  function finalize(block) {
    const b = open.get(block);
    if (!b) return;
    clearTimer(b.timer);
    open.delete(block);
    done.set(block, b.words);
    emit(b.speaker, b.text);
  }

  function caption({ block, speaker, text } = {}) {
    if (stopped) return;
    const all = clean(text);
    if (!all) return;
    // Meet keeps adding to a speaker's block after a pause: only the words after those already written are new.
    // Words already written that Meet later corrects stay as they were written.
    const words = all.split(" ");
    const written = done.get(block) || 0;
    if (words.length <= written) return;
    const body = words.slice(written).join(" ");
    const older = [...open.keys()].filter((k) => k < block).sort((a, b) => a - b);
    for (const k of older) finalize(k);
    const prev = open.get(block);
    if (prev) clearTimer(prev.timer);
    const entry = { speaker: clean(speaker) || "Someone", text: body, words: words.length, timer: null };
    entry.timer = setTimer(() => finalize(block), FINAL_MS);
    open.set(block, entry);
  }

  function chat({ sender, text } = {}) {
    if (stopped) return;
    const who = clean(sender) || "Someone";
    const body = clean(text);
    if (!body || who.toLowerCase() === "you") return;
    emit(`${who} (chat)`, body);
  }

  function scheduleWake() {
    if (wakeTimer || pending) return;
    wakeTimer = setTimer(due, WAKE_DELAY_MS);
  }

  function due() {
    wakeTimer = null;
    attempt();
  }

  /** The lines since the last wake, the newest that fit the caps, with a note on how many were left out. */
  function wakeText() {
    const fresh = lines.slice(cursor);
    const kept = [];
    let chars = 0;
    for (let i = fresh.length - 1; i >= 0 && kept.length < WAKE_LINES; i--) {
      const cost = fresh[i].length + (kept.length ? 1 : 0);
      if (kept.length && chars + cost > WAKE_CHARS) break;
      kept.unshift(fresh[i]);
      chars += cost;
    }
    const earlier = fresh.length - kept.length;
    const head = earlier ? [`(${earlier} earlier lines are in the transcript.)`] : [];
    return [...head, ...kept].join("\n");
  }

  function attempt() {
    if (stopped) return;
    pending = false;
    if (cursor >= lines.length) return;
    if (busy()) {
      pending = true;
      return;
    }
    const t = now().getTime();
    while (wakes.length && t - wakes[0] >= HOUR_MS) wakes.shift();
    if (wakes.length >= WAKES_PER_HOUR) {
      wakeTimer = setTimer(due, wakes[0] + HOUR_MS - t);
      return;
    }
    wakes.push(t);
    const text = wakeText();
    cursor = lines.length;
    onWake(text);
  }

  function runEnded() {
    if (!stopped && pending) attempt();
  }

  function stop() {
    stopped = true;
    for (const b of open.values()) clearTimer(b.timer);
    open.clear();
    if (wakeTimer) clearTimer(wakeTimer);
    wakeTimer = null;
    pending = false;
  }

  return { caption, chat, runEnded, stop, lines: () => lines.slice() };
}

module.exports = {
  createMeetingEngine,
  replyText,
  addressed,
  formatLine,
  FINAL_MS,
  WAKE_DELAY_MS,
  WAKE_LINES,
  WAKE_CHARS,
  WAKES_PER_HOUR,
  CHAT_MAX,
  CHAT_PARTS,
};
