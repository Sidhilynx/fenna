// The person's settings: which ones exist, what each may hold, and what they
// are until changed. Anything else is refused (the page) or dropped (the file).

const F = require("./format.cjs");

const MAX_CONCURRENT = { min: 1, max: 4 };
const MAX_TEXT = 100;

const DEFAULTS = { notifications: true, defaultCli: "claude", defaultModel: "", defaultEffort: "", maxConcurrent: 2, usageCounts: true, usageNoticeSeen: false };

/** Each setting that can be changed: a check that returns the value or throws what to fix. */
const CHECKS = {
  openAtLogin: (v) => bool(v, "Open at login"),
  notifications: (v) => bool(v, "Notifications"),
  usageCounts: (v) => bool(v, "Anonymous usage counts"),
  usageNoticeSeen: (v) => bool(v, "The usage notice"),
  maxConcurrent: (v) => {
    if (!Number.isInteger(v) || v < MAX_CONCURRENT.min || v > MAX_CONCURRENT.max) throw new Error(`Runs at once is a whole number from ${MAX_CONCURRENT.min} to ${MAX_CONCURRENT.max}.`);
    return v;
  },
  defaultCli: (v) => {
    if (!F.CLI_KINDS.includes(v)) throw new Error(`Default CLI is one of: ${F.CLI_KINDS.join(", ")}.`);
    return v;
  },
  defaultModel: (v) => text(v, "Default model"),
  defaultEffort: (v) => text(v, "Default effort"),
};

function bool(v, what) {
  if (typeof v !== "boolean") throw new Error(`${what} is on or off.`);
  return v;
}

function text(v, what) {
  if (typeof v !== "string" || v.length > MAX_TEXT) throw new Error(`${what} is text, at most ${MAX_TEXT} characters.`);
  return v;
}

/** The patch the page sent, checked: only known settings, each of the right type and range. Throws saying what to fix. */
function checkSettingsPatch(patch) {
  const out = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(CHECKS, key)) throw new Error(`There is no setting "${key.slice(0, 40)}". The settings are: ${Object.keys(CHECKS).join(", ")}.`);
    out[key] = CHECKS[key](value);
  }
  return out;
}

/** What settings.json held, keeping only what is still a setting and still valid. */
function readStored(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(CHECKS)) {
    if (!(key in raw)) continue;
    try {
      out[key] = CHECKS[key](raw[key]);
    } catch {
      // A value this version doesn't accept goes back to its default.
    }
  }
  return out;
}

module.exports = { DEFAULTS, MAX_CONCURRENT, checkSettingsPatch, readStored };
