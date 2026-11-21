// Scripts for Google's sign-in pages in a bot's browser tab. Each page function is
// sent as source text through the DevTools protocol, so it must not use anything
// outside its own body: every helper and selector is defined inside it. Google
// hides its class names, so everything is found by type, name, autocomplete,
// aria-label, role, data attributes and visible text. "Visible" means the element
// has a box (getClientRects().length > 0).

const SIGN_IN_ORIGIN = "https://accounts.google.com";

/** The sign-in page for one account, with its email filled in. A plain function: Crew uses it, not the page. */
function signInUrl(email) {
  return `https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmyaccount.google.com%2F&Email=${encodeURIComponent(email)}`;
}

/** Which Google page the tab shows, and the page's own error text when it has one. */
function googleStage() {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const shown = (el) => el.getClientRects().length > 0;
  const has = (selector) => [...document.querySelectorAll(selector)].some(shown);
  const text = norm(document.body ? document.body.innerText : "");
  const error = [...document.querySelectorAll('[aria-live="assertive"], [role="alert"]')].find((el) => shown(el) && norm(el.textContent)) || null;

  let stage = "unknown";
  if (location.hostname === "myaccount.google.com") stage = "signed_in";
  else if (["This browser or app may not be secure", "Couldn't sign you in", "Couldn’t sign you in"].some((p) => text.includes(p))) stage = "blocked";
  else if (has('input[name="totpPin"], input[id="totpPin"], input[autocomplete="one-time-code"]')) stage = "code";
  else if (has('input[type="password"]')) stage = "password";
  else if (has('input[type="email"], input[name="identifier"]')) stage = "email";
  else if (has("[data-identifier], [data-email]")) stage = "chooser";
  else if (location.hostname === "accounts.google.com") stage = "challenge";

  return { stage, error: error ? norm(error.textContent).slice(0, 300) : null };
}

/** Focuses the visible input for one sign-in step with its text selected, so Crew can type over it with real key input. The password value is never returned. */
function googleFocus(arg) {
  const shown = (el) => el.getClientRects().length > 0;
  const selectors = {
    email: 'input[type="email"], input[name="identifier"]',
    password: 'input[type="password"]',
    code: 'input[name="totpPin"], input[id="totpPin"], input[autocomplete="one-time-code"]',
  };
  const field = (arg || {}).field;
  const selector = Object.prototype.hasOwnProperty.call(selectors, field) ? selectors[field] : null;
  const el = selector ? [...document.querySelectorAll(selector)].find(shown) || null : null;
  if (!el) return { found: false, focused: false, value: "" };
  el.focus();
  el.select();
  return { found: true, focused: document.activeElement === el, value: field === "password" ? "" : el.value };
}

/** Clicks the visible, enabled Next button of the current sign-in step. Returns whether it clicked. */
function googleNext() {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const shown = (el) => el.getClientRects().length > 0;
  const usable = (el) => shown(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true";
  const labelled = [...document.querySelectorAll('button, [role="button"]')].find((b) => usable(b) && (norm(b.textContent) === "next" || norm(b.getAttribute("aria-label")) === "next")) || null;
  let fallback = null;
  for (const selector of ["#identifierNext button", "#passwordNext button", "#totpNext button", "#identifierNext", "#passwordNext", "#totpNext"]) {
    fallback = [...document.querySelectorAll(selector)].find(usable) || null;
    if (fallback) break;
  }
  const button = labelled || fallback;
  if (!button) return { clicked: false };
  button.click();
  return { clicked: true };
}

/** On the account chooser, clicks the account with this email, else "Use another account". */
function googlePick(arg) {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const shown = (el) => el.getClientRects().length > 0;
  const wanted = norm((arg || {}).email);
  if (wanted) {
    const account = [...document.querySelectorAll("[data-identifier], [data-email]")].find((el) => shown(el) && [el.getAttribute("data-identifier"), el.getAttribute("data-email")].some((v) => norm(v) === wanted));
    if (account) {
      account.click();
      return { picked: "account" };
    }
  }
  const other = [...document.querySelectorAll('button, [role="button"], a')].find((el) => shown(el) && norm(el.textContent) === "use another account");
  if (other) {
    other.click();
    return { picked: "other" };
  }
  return { picked: null };
}

/** The accounts signed in to this browser, from the body of Google's ListAccounts response. Never throws; [] when the body doesn't parse. */
function parseListAccounts(text) {
  try {
    if (typeof text !== "string") return [];
    const body = text.replace(/^\)\]\}'[^\S\n]*\r?\n?/, "");
    const data = JSON.parse(body);
    if (!Array.isArray(data) || data[0] !== "gaia.l.a.r" || !Array.isArray(data[1])) return [];
    const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const accounts = [];
    for (const entry of data[1]) {
      if (!Array.isArray(entry)) continue;
      const email = entry.find((v) => typeof v === "string" && EMAIL.test(v));
      if (!email) continue;
      const name = typeof entry[2] === "string" && entry[2] ? entry[2] : null;
      accounts.push({ email: email.toLowerCase(), name });
    }
    return accounts;
  } catch {
    return [];
  }
}

module.exports = { SIGN_IN_ORIGIN, signInUrl, googleStage, googleFocus, googleNext, googlePick, parseListAccounts };
