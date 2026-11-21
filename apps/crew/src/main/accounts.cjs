// A Google account of its own for each bot (docs/plans/crew-bot-accounts.md,
// "Revision"). The account lives in the bot's own Google Chrome (chrome.cjs),
// because Google refuses sign-in and calls from Crew's built-in browser. The
// person signs the bot in by hand, once, in a plain Chrome window nothing
// drives: Google wants a password typed only there, and Crew never types it.
// Crew then reads the profile's session to say where the account stands, and
// the bot's calls run in that profile.

const G = require("./google-scripts.cjs");

const CHECK_EVERY_MS = 30 * 60_000;
/** Google's list of the accounts signed in to a browser (the one Chrome itself reads). */
const LIST_ACCOUNTS = "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard";
/** The cookies a Google sign-in sets; any one, unexpired, means the profile is signed in. */
const SIGN_IN_COOKIES = ["SID", "__Secure-1PSID", "__Secure-3PSID"];
const SIGNING_IN = "Sign in to Google in the Chrome window that opened, then close it.";

/** The view's state as a short phrase, for the bot's prompt. */
function stateWords(v) {
  switch (v.state) {
    case "missing":
      return "its login isn't in the vault on this computer";
    case "no_chrome":
      return "Google Chrome isn't installed, so it can't be used";
    case "signed_out":
      return "signed out";
    case "signing_in":
      return "the person is signing it in now";
    case "signed_in":
      return "signed in";
    case "other_account":
      return v.signedInAs ? `signed in as ${v.signedInAs} instead` : "signed in as another account";
    default:
      return "not checked yet";
  }
}

/**
 * @param {object} o
 * @param {{ readBot(slug: string): { bot?: { name?: string, account?: string | null } } | null, slugs(): string[] }} o.store
 * @param {{ get(name: string): { name: string, label: string, username: string } | null }} o.vault
 * @param {ReturnType<import("./chrome.cjs").createChrome>} o.chrome
 * @param {(channel: string, payload: unknown) => void} o.broadcast
 * @param {() => void} [o.onChange]
 * @param {() => Date} [o.now]
 * @param {(fn: () => void, ms: number) => unknown} [o.setTimer]
 * @param {(h: unknown) => void} [o.clearTimer]
 */
function createAccounts({ store, vault, chrome, broadcast, onChange = () => {}, now = () => new Date(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h) }) {
  /** slug → what the last check saw, with the login it was about */
  const memo = new Map();
  let timer = null;

  /** The bot's account as bot.md and the vault say, or null when it has none. */
  function base(slug) {
    const r = store.readBot(slug);
    const bot = r && r.bot;
    const login = bot && bot.account;
    if (!login) return null;
    const item = vault.get(login);
    return { name: (bot && bot.name) || slug, login, label: (item && item.label) || login, email: String((item && item.username) || "").toLowerCase(), missing: !item };
  }

  function view(slug) {
    const b = base(slug);
    if (!b) return null;
    const m = memo.get(slug);
    const k = m && m.login === b.login ? m : {};
    let state = k.state || "unknown";
    if (b.missing) state = "missing";
    else if (!chrome.available()) state = "no_chrome";
    else if (chrome.running(slug) === "plain") state = "signing_in";
    return {
      slug,
      login: b.login,
      email: b.email,
      state,
      signedInAs: state === "other_account" ? k.signedInAs || null : null,
      message: state === "signing_in" ? SIGNING_IN : "",
      checkedAt: k.checkedAt || null,
    };
  }

  /** Records what was seen, and tells the app when the bot's view changed. */
  function update(slug, patch) {
    const before = JSON.stringify(view(slug));
    const b = base(slug);
    if (b) memo.set(slug, { ...patch, login: b.login });
    else memo.delete(slug);
    const after = view(slug);
    if (JSON.stringify(after) !== before) {
      broadcast("crew:account", { slug, account: after });
      onChange();
    }
    return after;
  }

  /** Who the bot's Chrome profile is signed in to Google as. */
  async function session(slug) {
    const cookies = await chrome.cookies(slug);
    const t = now().getTime() / 1000;
    const signedIn = cookies.some((c) => /(^|\.)google\.com$/.test(String(c.domain || "").replace(/^\./, "")) && SIGN_IN_COOKIES.includes(c.name) && (!c.expires || c.expires < 0 || c.expires > t));
    if (!signedIn) return { signedIn: false, accounts: [] };
    const accounts = G.parseListAccounts(await chrome.fetchText(slug, LIST_ACCOUNTS).catch(() => ""));
    return { signedIn: true, accounts };
  }

  /** Looks at the bot's Chrome profile and records where its account stands. */
  async function check(slug) {
    const b = base(slug);
    if (!b) return update(slug, {});
    const cur = view(slug);
    // These say all there is to say without starting Chrome.
    if (["missing", "no_chrome", "signing_in"].includes(cur.state)) return cur;
    let s;
    try {
      s = await session(slug);
    } catch {
      return update(slug, { ...memo.get(slug), checkedAt: now().toISOString() });
    }
    const checkedAt = now().toISOString();
    if (!s.signedIn) return update(slug, { state: "signed_out", checkedAt });
    // Google didn't list the accounts: signed in, and nothing says it's someone else.
    if (!s.accounts.length || s.accounts.some((a) => a.email === b.email)) return update(slug, { state: "signed_in", checkedAt });
    return update(slug, { state: "other_account", signedInAs: s.accounts[0].email, checkedAt });
  }

  /** Opens the bot's Chrome on Google's sign-in page for the person; Crew checks again when they close it. */
  async function signIn(slug) {
    const v = await check(slug);
    const b = base(slug);
    if (!v || !b) return { state: null, text: "You have no Google account of your own. The person can give you one in your Details, under Google account." };
    if (v.state === "missing") return { state: v.state, text: `The login ${b.login} isn't in the vault on this computer. Ask the person to add it.` };
    if (v.state === "no_chrome") return { state: v.state, text: "Google Chrome isn't installed on this computer. Ask the person to install it from google.com/chrome." };
    if (v.state === "signed_in") return { state: v.state, text: `Signed in as ${b.email}.` };
    if (v.state === "other_account") return { state: v.state, text: `Your Chrome is signed in as ${v.signedInAs || "another account"}, not ${b.email}. Ask the person to sign it out in your Details, then sign in again.` };
    if (v.state !== "signing_in") {
      // signing_in comes from the open window itself, so closing it lets the next check through.
      const before = JSON.stringify(v);
      await chrome.openForPerson(slug, G.signInUrl(b.email));
      const after = view(slug);
      if (JSON.stringify(after) !== before) {
        broadcast("crew:account", { slug, account: after });
        onChange();
      }
    }
    return { state: "signing_in", text: `Crew opened ${b.name}'s Chrome on Google's sign-in page for ${b.email}. The person signs in there and closes the window; Crew checks then. Ask them with ask_human if they haven't seen it.` };
  }

  return {
    view,
    list: () => store.slugs().map(view).filter(Boolean),
    check,
    signIn,
    /** Signs the bot's Chrome profile out of Google (it holds nothing but the bot's Google sign-in). */
    async signOut(slug) {
      await chrome.clearCookies(slug);
      return check(slug);
    },
    /** The person closed the bot's plain Chrome window: see whether they signed it in. */
    plainClosed: (slug) => check(slug),
    /** Where the account stands before a call. Never opens a window: signing in is the person's. */
    ensure: (slug) => check(slug),
    promptLine(slug) {
      const v = view(slug);
      if (!v) return "";
      return `Your own Google account is ${v.email || v.login} (${stateWords(v)}). It lives in a Google Chrome of your own that Crew runs for your calls, so you join Meet as it. Never sign in to any other Google account and never type its password: when it is signed out, call account with {action: "sign_in"}, which opens the window where the person signs you in.`;
    },
    /** Every 30 minutes, checks the bots whose Chrome is running anyway (a check never starts Chrome on its own schedule). */
    start() {
      const tick = async () => {
        for (const slug of store.slugs()) if (chrome.running(slug) === "driven") await check(slug).catch(() => {});
        timer = setTimer(tick, CHECK_EVERY_MS);
      };
      timer = setTimer(tick, CHECK_EVERY_MS);
    },
    stop() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}

module.exports = { createAccounts };
