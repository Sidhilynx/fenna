import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createAccounts } = require("../src/main/accounts.cjs");
const G = require("../src/main/google-scripts.cjs");

const LOGIN = "Scout Gmail";
const EMAIL = "scout@example.com";
const PASSWORD = "correct-horse-9";
const CODE = "482913";
const TOTP = "JBSWY3DPEHPK3PXP";

type Session = { signedIn: boolean; accounts: { email: string; name: string | null }[] };
const SIGNED_OUT: Session = { signedIn: false, accounts: [] };

/**
 * A Google sign-in in a fake browser tab. `flow` is the list of pages Google
 * shows in order; each Next (or account pick) moves to the next one, and the
 * last one stays. Typed text goes where the page's field is. Reaching a
 * "signed_in" page signs the browser in as the bot's account.
 */
function fakeWorld(opts: { flow?: string[]; session?: Session; error?: string | null; password?: string; totp?: string | null; secondsLeft?: number } = {}) {
  const w = {
    flow: opts.flow ?? ["email", "password", "code", "signed_in"],
    index: 0,
    session: opts.session ?? SIGNED_OUT,
    failSession: false,
    error: opts.error ?? null,
    password: opts.password ?? PASSWORD,
    totp: opts.totp === undefined ? TOTP : opts.totp,
    secondsLeft: opts.secondsLeft ?? 20,
    items: { [LOGIN]: { name: LOGIN, label: LOGIN, username: "Scout@Example.com", origins: ["https://accounts.google.com"] } } as Record<string, { name: string; label: string; username: string; origins: string[] }>,
    typedEmail: "",
    closed: false,
    inserted: [] as { stage: string; text: string }[],
    picks: [] as unknown[],
    nexts: 0,
    opened: [] as string[],
    sessionCalls: 0,
    signOuts: 0,
    codeCalls: 0,
    openError: null as Error | null,
  };
  const stage = () => w.flow[Math.min(w.index, w.flow.length - 1)];
  const advance = () => {
    w.index++;
    if (stage() === "signed_in") w.session = { signedIn: true, accounts: [{ email: EMAIL, name: "Scout" }] };
  };
  const tab = {
    alive: () => !w.closed,
    close: async () => {
      w.closed = true;
    },
    waitForControl: async () => {},
    cdp: async (method: string, p: { text: string }) => {
      if (method === "Input.insertText") {
        w.inserted.push({ stage: stage(), text: p.text });
        if (stage() === "email") w.typedEmail = p.text;
      }
      return {};
    },
    evaluate: async (fn: { name: string }, arg: { field?: string; email?: string } | null) => {
      switch (fn.name) {
        case "googleStage":
          return { stage: stage(), error: w.error };
        case "googleFocus":
          return { found: true, focused: true, value: arg?.field === "email" ? w.typedEmail : "" };
        case "googleNext":
          w.nexts++;
          advance();
          return { clicked: true };
        case "googlePick":
          w.picks.push(arg);
          advance();
          return { picked: "account" };
        default:
          throw new Error(`unexpected page function ${fn.name}`);
      }
    },
  };
  const browsers = {
    googleSession: async () => {
      w.sessionCalls++;
      if (w.failSession) throw new Error("browser is busy");
      return w.session;
    },
    openTask: async (_slug: string, o: { url: string }) => {
      if (w.openError) throw w.openError;
      w.opened.push(o.url);
      return tab;
    },
    signOutGoogle: async () => {
      w.signOuts++;
      w.session = SIGNED_OUT;
    },
  };
  const vault = {
    get: (name: string) => w.items[name] ?? null,
    // Shaped like the real vault: the 2-factor setup as an object, its key in `secret`.
    secrets: async () => ({ password: w.password, totp: w.totp ? { secret: w.totp, digits: 6, period: 30, algorithm: "SHA1" } : null }),
    code: async () => {
      w.codeCalls++;
      return { code: CODE, secondsLeft: w.secondsLeft };
    },
  };
  const store = {
    readBot: () => ({ bot: { name: "Scout", account: LOGIN } }),
    slugs: () => ["scout"],
  };
  return { w, tab, browsers, vault, store };
}

/** Accounts over a fake world, with every broadcast and notice collected in `log`. */
function setup(world: ReturnType<typeof fakeWorld>, log: unknown[] = []) {
  const notices: unknown[][] = [];
  const broadcasts: unknown[][] = [];
  const accounts = createAccounts({
    store: world.store,
    vault: world.vault,
    browsers: world.browsers,
    notify: (...args: unknown[]) => {
      notices.push(args);
      log.push(args);
    },
    broadcast: (...args: unknown[]) => {
      broadcasts.push(args);
      log.push(args);
    },
  });
  return { accounts, notices, broadcasts };
}

/** Runs the fake clock until `p` settles. */
async function settle<T>(p: Promise<T>): Promise<T> {
  let out: { ok: boolean; v: unknown } | null = null;
  p.then(
    (v) => (out = { ok: true, v }),
    (v) => (out = { ok: false, v }),
  );
  for (let i = 0; i < 400 && !out; i++) await vi.advanceTimersByTimeAsync(500);
  const done = out as { ok: boolean; v: unknown } | null;
  if (!done) throw new Error("still running");
  if (!done.ok) throw done.v;
  return done.v as T;
}

/** Follows a promise without waiting for it. */
function track<T>(p: Promise<T>) {
  const r = { done: false, value: undefined as T | undefined };
  p.then((v) => {
    r.done = true;
    r.value = v;
  });
  return r;
}

describe("the account view", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 10, 22, 9, 0) }));
  afterEach(() => vi.useRealTimers());

  it("is null for a bot without an account, and unknown until the first check", () => {
    const world = fakeWorld();
    world.store.readBot = () => ({ bot: { name: "Scout", account: null } });
    const { accounts } = setup(world);
    expect(accounts.view("scout")).toBeNull();
    expect(accounts.list()).toEqual([]);
    expect(accounts.promptLine("scout")).toBe("");

    const fresh = setup(fakeWorld());
    expect(fresh.accounts.view("scout")).toEqual({ slug: "scout", login: LOGIN, email: EMAIL, state: "unknown", signedInAs: null, message: "", checkedAt: null });
    expect(fresh.accounts.list()).toHaveLength(1);
  });

  it("says missing when the login isn't in the vault, without asking the browser", async () => {
    const world = fakeWorld();
    world.w.items = {};
    const { accounts } = setup(world);
    const v = await accounts.check("scout");
    expect(v).toMatchObject({ state: "missing", email: "" });
    expect(world.w.sessionCalls).toBe(0);
  });

  it("reads signed out, signed in (any letter case), and another account, with the first email it sees", async () => {
    const world = fakeWorld({ session: SIGNED_OUT });
    const { accounts } = setup(world);
    expect((await accounts.check("scout"))?.state).toBe("signed_out");

    world.w.session = { signedIn: true, accounts: [{ email: "SCOUT@example.com", name: null }] };
    expect(await accounts.check("scout")).toMatchObject({ state: "signed_in", signedInAs: null });

    world.w.session = { signedIn: true, accounts: [{ email: "sam@example.com", name: null }, { email: "x@example.com", name: null }] };
    expect(await accounts.check("scout")).toMatchObject({ state: "other_account", signedInAs: "sam@example.com" });

    world.w.session = { signedIn: true, accounts: [] };
    expect(await accounts.check("scout")).toMatchObject({ state: "other_account", signedInAs: null });
  });

  it("keeps the last state and says when it tried when the browser can't be asked", async () => {
    vi.setSystemTime(new Date(2026, 10, 22, 9, 0));
    const world = fakeWorld({ session: { signedIn: true, accounts: [{ email: EMAIL, name: null }] } });
    const { accounts } = setup(world);
    const first = await accounts.check("scout");
    expect(first?.state).toBe("signed_in");

    vi.setSystemTime(new Date(2026, 10, 22, 9, 5));
    world.w.failSession = true;
    const second = await accounts.check("scout");
    expect(second?.state).toBe("signed_in");
    expect(second?.checkedAt).not.toBe(first?.checkedAt);
  });

  it("broadcasts each change of the view, with onChange, and not an unchanged one", async () => {
    const world = fakeWorld({ session: SIGNED_OUT });
    const changes: number[] = [];
    const accounts = createAccounts({
      store: world.store,
      vault: world.vault,
      browsers: world.browsers,
      notify: () => {},
      broadcast: (name: string, payload: unknown) => broadcasts.push([name, payload]),
      onChange: () => changes.push(1),
    });
    const broadcasts: unknown[] = [];
    await accounts.check("scout");
    expect(broadcasts).toEqual([["crew:account", { slug: "scout", account: expect.objectContaining({ state: "signed_out" }) }]]);
    expect(changes).toHaveLength(1);
  });
});

describe("signing in", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 10, 22, 9, 0) });
  });
  afterEach(() => vi.useRealTimers());

  it("types the email, the password and the code, and closes the tab once signed in", async () => {
    const world = fakeWorld();
    const { accounts, notices } = setup(world);
    const r = await settle(accounts.signIn("scout"));
    expect(r).toEqual({ state: "signed_in", text: `Signed in as ${EMAIL}.` });
    expect(world.w.opened).toEqual([G.signInUrl(EMAIL)]);
    expect(world.w.inserted).toEqual([
      { stage: "email", text: EMAIL },
      { stage: "password", text: PASSWORD },
      { stage: "code", text: CODE },
    ]);
    expect(world.w.closed).toBe(true);
    expect(notices).toEqual([]);
    expect(accounts.view("scout")?.state).toBe("signed_in");
  });

  it("does not retype an email that Google's field already holds", async () => {
    const world = fakeWorld({ flow: ["password", "signed_in"] });
    world.w.typedEmail = EMAIL;
    const { accounts } = setup(world);
    await settle(accounts.signIn("scout"));
    expect(world.w.inserted.map((i) => i.text)).toEqual([PASSWORD]);
  });

  it("picks the bot's account on the chooser before the password", async () => {
    const world = fakeWorld({ flow: ["chooser", "password", "signed_in"] });
    const { accounts } = setup(world);
    const r = await settle(accounts.signIn("scout"));
    expect(r.state).toBe("signed_in");
    expect(world.w.picks).toEqual([{ email: EMAIL }]);
  });

  it("stops after one wrong password, leaves the tab open, and says so with Google's text", async () => {
    const world = fakeWorld({ flow: ["email", "password", "password"], error: "Wrong password. Try again." });
    const { accounts, notices } = setup(world);
    const r = await settle(accounts.signIn("scout"));
    expect(r.state).toBe("needs_you");
    expect(r.text).toBe(`Google didn't take the password saved for ${LOGIN}. Fix it in the vault, or take control and sign in. Google said: Wrong password. Try again.`);
    expect(world.w.inserted.filter((i) => i.stage === "password")).toHaveLength(1);
    expect(world.w.closed).toBe(false);
    expect(accounts.view("scout")).toMatchObject({ state: "needs_you", message: r.text });
    expect(notices).toEqual([["scout", "Google sign-in needs you", r.text]]);
  });

  it("keeps saying what the person must do while the browser is still signed out, and moves on once they sign in", async () => {
    const world = fakeWorld({ flow: ["email", "password", "password"], error: "Wrong password. Try again." });
    const { accounts } = setup(world);
    const r = await settle(accounts.signIn("scout"));
    expect((await accounts.check("scout"))?.state).toBe("needs_you");
    expect(accounts.view("scout")?.message).toBe(r.text);
    world.w.session = { signedIn: true, accounts: [{ email: EMAIL, name: "Scout" }] };
    expect((await accounts.check("scout"))?.state).toBe("signed_in");
  });

  it("scrubs the 2-factor key from an error that echoes it", async () => {
    const world = fakeWorld();
    world.w.openError = new Error(`setup key ${TOTP} rejected`);
    const { accounts } = setup(world);
    const r = await settle(accounts.signIn("scout"));
    expect(r.text).not.toContain(TOTP);
  });

  it("stops at two codes, and does not send a third", async () => {
    const world = fakeWorld({ flow: ["email", "code", "code", "code"] });
    const { accounts } = setup(world);
    const r = await settle(accounts.signIn("scout"));
    expect(r.state).toBe("needs_you");
    expect(r.text).toBe(`Google keeps asking for a sign-in code for ${LOGIN}. Take control and enter one yourself.`);
    expect(world.w.inserted.filter((i) => i.stage === "code")).toHaveLength(2);
  });

  it("stops at a sign-in code when the login has no 2-factor key", async () => {
    const world = fakeWorld({ flow: ["email", "code"], totp: null });
    const { accounts } = setup(world);
    const r = await settle(accounts.signIn("scout"));
    expect(r).toEqual({
      state: "needs_you",
      text: `Google asks for a sign-in code and ${LOGIN} has no 2-factor setup key. Take control and enter it, or add the key in the vault.`,
    });
    expect(world.w.inserted.some((i) => i.stage === "code")).toBe(false);
  });

  it("waits for a fresh code when the current one is about to expire", async () => {
    const world = fakeWorld({ flow: ["code", "signed_in"], secondsLeft: 2 });
    const { accounts } = setup(world);
    const r = await settle(accounts.signIn("scout"));
    expect(r.state).toBe("signed_in");
    expect(world.w.codeCalls).toBe(2);
  });

  it("stops when Google blocks the browser", async () => {
    const world = fakeWorld({ flow: ["email", "blocked"] });
    const { accounts } = setup(world);
    const r = await settle(accounts.signIn("scout"));
    expect(r).toEqual({ state: "needs_you", text: "Google won't sign in from this browser right now. Take control and sign in yourself." });
  });

  it("gives a challenge 15 seconds, then stops and leaves the tab open", async () => {
    const world = fakeWorld({ flow: ["challenge"] });
    const { accounts, notices } = setup(world);
    const r = track(accounts.signIn("scout"));
    await vi.advanceTimersByTimeAsync(14_000);
    expect(r.done).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(r.value).toEqual({
      state: "needs_you",
      text: "Google wants something only you can give (a phone prompt or a puzzle). Take control of Scout's browser and finish signing in.",
    });
    expect(world.w.closed).toBe(false);
    expect(notices).toHaveLength(1);
  });

  it("stops at 90 seconds even when Google keeps moving on", async () => {
    const world = fakeWorld({ flow: ["email"] });
    const { accounts } = setup(world);
    const r = track(accounts.signIn("scout"));
    await vi.advanceTimersByTimeAsync(89_000);
    expect(r.done).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(r.done).toBe(true);
    expect(r.value?.state).toBe("needs_you");
    expect(world.w.nexts).toBeGreaterThan(20);
  });

  it("runs one sign-in at a time per bot", async () => {
    const world = fakeWorld();
    const { accounts } = setup(world);
    const first = accounts.signIn("scout");
    const second = accounts.signIn("scout");
    expect(second).toBe(first);
    await settle(first);
    expect(world.w.opened).toHaveLength(1);
  });

  it("refuses when the browser is signed in as someone else, and opens no tab", async () => {
    const world = fakeWorld({ session: { signedIn: true, accounts: [{ email: "someone@example.com", name: null }] } });
    const { accounts } = setup(world);
    const r = await settle(accounts.signIn("scout"));
    expect(r.text).toBe(`The browser is signed in as someone@example.com, not ${EMAIL}. Ask the person to sign it out in your Details, then try again.`);
    expect(world.w.opened).toEqual([]);
  });

  it("says a missing or empty vault entry when the password isn't there", async () => {
    const world = fakeWorld({ password: "" });
    const { accounts } = setup(world);
    const r = await settle(accounts.signIn("scout"));
    expect(r).toEqual({ state: "needs_you", text: `The vault has no password for ${LOGIN}. Add it, or take control and sign in.` });
    expect(world.w.opened).toEqual([]);
  });

  it("says a missing login, and asks for nothing when there is no account", async () => {
    const missing = fakeWorld();
    missing.w.items = {};
    expect((await settle(setup(missing).accounts.signIn("scout"))).text).toBe(`${LOGIN} isn't in the vault on this computer. Add it, then try again.`);

    const none = fakeWorld();
    none.store.readBot = () => ({ bot: { name: "Scout", account: null } });
    expect((await settle(setup(none).accounts.signIn("scout"))).state).toBeNull();
  });

  it("says what went wrong when the sign-in fails, and never echoes a secret in it", async () => {
    const world = fakeWorld();
    world.w.openError = new Error(`Chrome refused ${PASSWORD}`);
    const { accounts } = setup(world);
    const r = await settle(accounts.signIn("scout"));
    expect(r.text).toBe("Couldn't sign in: Chrome refused ….");
    expect(r.text).not.toContain(PASSWORD);
    expect(accounts.view("scout")?.state).toBe("signed_out");
  });
});

describe("the other actions", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 10, 22, 9, 0) }));
  afterEach(() => vi.useRealTimers());

  it("signs the bot's browser out and reads the result", async () => {
    const world = fakeWorld({ session: { signedIn: true, accounts: [{ email: EMAIL, name: null }] } });
    const { accounts } = setup(world);
    expect((await accounts.check("scout"))?.state).toBe("signed_in");
    expect((await accounts.signOut("scout"))?.state).toBe("signed_out");
    expect(world.w.signOuts).toBe(1);
  });

  it("ensure signs in only when the browser is signed out", async () => {
    const signedIn = fakeWorld({ session: { signedIn: true, accounts: [{ email: EMAIL, name: null }] } });
    const a = setup(signedIn).accounts;
    expect((await a.ensure("scout"))?.state).toBe("signed_in");
    expect(signedIn.w.opened).toEqual([]);

    const signedOut = fakeWorld();
    const b = setup(signedOut).accounts;
    const v = await settle(b.ensure("scout"));
    expect(v?.state).toBe("signed_in");
    expect(signedOut.w.opened).toHaveLength(1);
  });

  it("writes one prompt line that names the account and its state, and never a password", () => {
    const world = fakeWorld({ session: { signedIn: true, accounts: [{ email: "sam@example.com", name: null }] } });
    const { accounts } = setup(world);
    expect(accounts.promptLine("scout")).toBe(
      'Your own Google account is scout@example.com (not checked yet). Your browser stays signed in to it, so Gmail, Calendar, Drive and Meet open as you. Never sign in to any other Google account, and never type its password: if Google asks you to sign in, call account with {action: "sign_in"}.',
    );
  });

  it("checks every bot's account 20 seconds after start, then every 30 minutes, until stop", async () => {
    const world = fakeWorld({ session: SIGNED_OUT });
    const { accounts } = setup(world);
    accounts.start();
    await vi.advanceTimersByTimeAsync(19_000);
    expect(world.w.sessionCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(world.w.sessionCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(world.w.sessionCalls).toBe(2);
    accounts.stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(world.w.sessionCalls).toBe(2);
  });
});

describe("secrets", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 10, 22, 9, 0) }));
  afterEach(() => vi.useRealTimers());

  it("keeps the password and the code out of every view, broadcast, notice and returned text", async () => {
    const log: unknown[] = [];

    const happy = fakeWorld();
    const h = setup(happy, log);
    log.push(await settle(h.accounts.signIn("scout")));
    log.push(h.accounts.view("scout"), h.accounts.list(), h.accounts.promptLine("scout"));

    const wrong = fakeWorld({ flow: ["email", "password", "password"], error: "Wrong password. Try again." });
    const w = setup(wrong, log);
    log.push(await settle(w.accounts.signIn("scout")));
    log.push(w.accounts.view("scout"), w.accounts.list(), w.accounts.promptLine("scout"));

    const chrome = fakeWorld();
    chrome.w.openError = new Error(`Chrome refused ${PASSWORD}`);
    const c = setup(chrome, log);
    log.push(await settle(c.accounts.signIn("scout")));
    log.push(c.accounts.view("scout"));

    expect(h.broadcasts.length).toBeGreaterThan(0);
    const all = JSON.stringify(log);
    expect(all).toContain(EMAIL);
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain(CODE);
    expect(all).not.toContain(TOTP);
  });
});
