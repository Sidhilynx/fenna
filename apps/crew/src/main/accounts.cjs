// A Google account of its own for each bot (docs/plans/crew-bot-accounts.md,
// section C). Crew signs the bot's browser in to the account from the vault,
// in its own code over the DevTools protocol, the way the Meet join runs, so
// the model never sees the password or the sign-in pages. Every secret used
// in a sign-in is scrubbed from each message before it leaves this file:
// views, broadcasts, notices, returned text and errors.

const G = require("./google-scripts.cjs");

const SIGN_IN_MS = 90_000;
const CHALLENGE_MS = 15_000;
const LOOK_MS = 1000;
const ACTION_MS = 1500;
const CODE_MIN_LEFT_S = 3;
const CODE_MAX_SUBMITS = 2;
const FIRST_CHECK_MS = 20_000;
const CHECK_EVERY_MS = 30 * 60_000;
const NOTICE = "Google sign-in needs you";

/** The text with every secret replaced, so nothing typed into Google comes back out. */
function scrub(text, secrets) {
  let out = String(text ?? "");
  for (const s of secrets) if (s) out = out.split(s).join("…");
  return out;
}

/** The view's state as a short phrase, for the bot's prompt. */
function stateWords(v) {
  switch (v.state) {
    case "missing":
      return "not in the vault on this computer";
    case "signed_out":
      return "signed out";
    case "signing_in":
      return "signing in now";
    case "signed_in":
      return "signed in";
    case "other_account":
      return v.signedInAs ? `signed in as ${v.signedInAs} instead` : "signed in as another account";
    case "needs_you":
      return `needs you: ${v.message}`;
    default:
      return "not checked yet";
  }
}

/** What a browser session says about the bot's account, given the account's email (lowercase). */
function sessionState(email, session) {
  if (!session.signedIn) return { state: "signed_out", signedInAs: null };
  if (session.accounts.some((a) => a.email.toLowerCase() === email)) return { state: "signed_in", signedInAs: null };
  return { state: "other_account", signedInAs: session.accounts[0]?.email ?? null };
}

/**
 * The bots' Google accounts. Crew wires in `store` (readBot, slugs), `vault`
 * (get, secrets, code), `browsers` (googleSession, openTask, signOutGoogle),
 * and the hooks `notify`, `broadcast` and `onChange`. The clock and timers are
 * injected so tests can run them.
 * @param {object} deps
 * @returns {{ view, list, check, signIn, signOut, controlReturned, ensure, promptLine, start, stop }}
 */
function createAccounts({
  store,
  vault,
  browsers,
  notify,
  broadcast,
  onChange = () => {},
  now = () => new Date(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  /** slug → what the last check or sign-in saw, with the login it was about */
  const memo = new Map();
  /** slug → the sign-in running for that bot */
  const running = new Map();
  let timer = null;
  let active = false;

  const iso = () => now().toISOString();

  /** What the bot's login is right now, or null when the bot has no account. */
  function base(slug) {
    const bot = store.readBot(slug)?.bot;
    const login = bot?.account;
    if (!login) return null;
    const item = vault.get(login);
    return {
      name: bot.name || slug,
      login,
      label: item?.label || login,
      email: String(item?.username || "").toLowerCase(),
      missing: !item,
    };
  }

  function view(slug) {
    const b = base(slug);
    if (!b) return null;
    const m = memo.get(slug);
    const k = m && m.login === b.login ? m : {};
    const state = b.missing ? "missing" : k.state || "unknown";
    return {
      slug,
      login: b.login,
      email: b.email,
      state,
      signedInAs: state === "other_account" ? (k.signedInAs ?? null) : null,
      message: state === "needs_you" ? k.message || "" : "",
      checkedAt: k.checkedAt ?? null,
    };
  }

  /** Records a change to a bot's view, and tells the app about it when the view changed. */
  function update(slug, patch) {
    const before = JSON.stringify(view(slug));
    const b = base(slug);
    if (b) {
      const m = memo.get(slug);
      memo.set(slug, { ...(m && m.login === b.login ? m : {}), ...patch, login: b.login });
    } else {
      memo.delete(slug);
    }
    const after = view(slug);
    if (JSON.stringify(after) !== before) {
      broadcast("crew:account", { slug, account: after });
      onChange();
    }
    return after;
  }

  /** Looks at the browser's Google session and records what it says about the bot's account. */
  async function check(slug) {
    const b = base(slug);
    if (!b) return update(slug, {});
    if (b.missing) return update(slug, { state: "missing", checkedAt: iso() });
    // A sign-in is in progress: its own steps say what happens next.
    if (view(slug).state === "signing_in") return view(slug);
    let session;
    try {
      session = await browsers.googleSession(slug);
    } catch {
      // The browser couldn't be asked; keep the last state and say when we tried.
      return update(slug, { checkedAt: iso() });
    }
    if (view(slug).state === "signing_in") return view(slug);
    const seen = sessionState(b.email, session);
    // Still signed out after a sign-in that needs the person: keep saying what they have to do.
    if (seen.state === "signed_out" && view(slug).state === "needs_you") return update(slug, { checkedAt: iso() });
    return update(slug, { ...seen, checkedAt: iso() });
  }

  /** Records that a sign-in stopped where only the person can go on, and tells them. */
  function finish(slug, message, known) {
    const text = scrub(message, known);
    update(slug, { state: "needs_you", message: text, checkedAt: iso() });
    notify(slug, NOTICE, text);
    return { state: "needs_you", text };
  }

  /**
   * Walks Google's sign-in page until it is signed in. Returns null when it is,
   * or the sentence for the person when only they can go on. Each page gets at
   * most one password and two codes, so a wrong secret never locks the account.
   */
  async function drive(b, tab, { password, totp }, known) {
    const deadline = now().getTime() + SIGN_IN_MS;
    const challenge = `Google wants something only you can give (a phone prompt or a puzzle). Take control of ${b.name}'s browser and finish signing in.`;
    let passwordSent = false;
    let codesSent = 0;
    let quietSince = null;
    while (now().getTime() < deadline) {
      await tab.waitForControl();
      const look = await tab.evaluate(G.googleStage, null);
      if (look.stage === "signed_in") return null;
      if (look.stage === "challenge" || look.stage === "unknown") {
        if (quietSince === null) quietSince = now().getTime();
        if (now().getTime() - quietSince >= CHALLENGE_MS) return challenge;
        await sleep(LOOK_MS);
        continue;
      }
      quietSince = null;
      if (look.stage === "blocked") return "Google won't sign in from this browser right now. Take control and sign in yourself.";
      if (look.stage === "chooser") {
        await tab.evaluate(G.googlePick, { email: b.email });
      } else if (look.stage === "email") {
        const field = await tab.evaluate(G.googleFocus, { field: "email" });
        if (field.value !== b.email) await tab.cdp("Input.insertText", { text: b.email });
        await tab.evaluate(G.googleNext, null);
      } else if (look.stage === "password") {
        if (passwordSent) {
          const said = look.error ? ` Google said: ${look.error}` : "";
          return `Google didn't take the password saved for ${b.label}. Fix it in the vault, or take control and sign in.${said}`;
        }
        passwordSent = true;
        await tab.evaluate(G.googleFocus, { field: "password" });
        await tab.cdp("Input.insertText", { text: password });
        await tab.evaluate(G.googleNext, null);
      } else if (look.stage === "code") {
        if (!totp) return `Google asks for a sign-in code and ${b.label} has no 2-factor setup key. Take control and enter it, or add the key in the vault.`;
        if (codesSent >= CODE_MAX_SUBMITS) return `Google keeps asking for a sign-in code for ${b.label}. Take control and enter one yourself.`;
        let code = await vault.code(b.login);
        if (code.secondsLeft < CODE_MIN_LEFT_S) {
          // Too little time left for Google to accept it: wait for the next code.
          await sleep(code.secondsLeft * 1000 + 100);
          code = await vault.code(b.login);
        }
        known.push(code.code);
        codesSent++;
        await tab.evaluate(G.googleFocus, { field: "code" });
        await tab.cdp("Input.insertText", { text: code.code });
        await tab.evaluate(G.googleNext, null);
      }
      await sleep(ACTION_MS);
    }
    return challenge;
  }

  /** The sign-in steps, in order. The secrets it learns are added to `known` so no message can echo them. */
  async function doSignIn(slug) {
    const known = [];
    try {
      const before = await check(slug);
      const b = base(slug);
      if (!b) return { state: null, text: "This bot has no Google account. Pick one in its Details, then try again." };
      if (before.state === "missing") return { state: before.state, text: `${b.login} isn't in the vault on this computer. Add it, then try again.` };
      if (!b.email) return { state: before.state, text: `The vault has no Gmail address for ${b.label}. Add it, then try again.` };
      if (before.state === "signed_in") return { state: before.state, text: `Signed in as ${b.email}.` };
      if (before.state === "other_account") {
        return { state: before.state, text: `The browser is signed in as ${before.signedInAs || "another account"}, not ${b.email}. Ask the person to sign it out in your Details, then try again.` };
      }

      const { password, totp } = await vault.secrets(b.login);
      known.push(password, totp && totp.secret);
      if (!password) return finish(slug, `The vault has no password for ${b.label}. Add it, or take control and sign in.`, known);

      update(slug, { state: "signing_in", message: "" });
      const tab = await browsers.openTask(slug, { url: G.signInUrl(b.email) });
      const stuck = await drive(b, tab, { password, totp }, known);
      if (stuck) return finish(slug, stuck, known);

      // Signed in: the tab has done its job. Read the session again to say so.
      await tab.close();
      update(slug, { state: null, message: "" });
      const after = await check(slug);
      if (after.state === "signed_in") return { state: after.state, text: `Signed in as ${b.email}.` };
      return { state: after.state, text: "Google's sign-in finished but the browser isn't signed in. Try again." };
    } catch (err) {
      const why = scrub(err?.message ?? err, known).replace(/\.+$/, "");
      update(slug, { state: null });
      const v = await check(slug);
      return { state: v ? v.state : null, text: scrub(`Couldn't sign in: ${why}.`, known) };
    }
  }

  function signIn(slug) {
    if (!running.has(slug)) running.set(slug, doSignIn(slug).finally(() => running.delete(slug)));
    return running.get(slug);
  }

  async function signOut(slug) {
    await browsers.signOutGoogle(slug);
    return check(slug);
  }

  async function ensure(slug) {
    const v = await check(slug);
    if (v && v.state === "signed_out") await signIn(slug);
    return view(slug);
  }

  function promptLine(slug) {
    const v = view(slug);
    if (!v) return "";
    return `Your own Google account is ${v.email || v.login} (${stateWords(v)}). Your browser stays signed in to it, so Gmail, Calendar, Drive and Meet open as you. Never sign in to any other Google account, and never type its password: if Google asks you to sign in, call account with {action: "sign_in"}.`;
  }

  function schedule(ms) {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(run, ms);
  }

  async function run() {
    timer = null;
    for (const slug of store.slugs()) {
      if (!active) return;
      await check(slug);
    }
    if (active) schedule(CHECK_EVERY_MS);
  }

  return {
    view,
    list: () => store.slugs().map(view).filter(Boolean),
    check,
    signIn,
    signOut,
    controlReturned: (slug) => check(slug),
    ensure,
    promptLine,
    start() {
      if (active) return;
      active = true;
      schedule(FIRST_CHECK_MS);
    },
    stop() {
      active = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}

module.exports = { createAccounts };
