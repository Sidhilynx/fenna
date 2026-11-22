import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createAccounts } = require("../src/main/accounts.cjs");

const LOGIN = "Scout Gmail";
const BOT_EMAIL = "scout@gmail.com";
const SIGNING_IN = "Sign in to Google in the Chrome window that opened, then close it.";
const LIST_URL = "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard";
const NOW_ISO = "2026-11-22T09:00:00.000Z";
const THIRTY_MIN = 30 * 60_000;

type Cookie = { name: string; domain: string; expires: number };
type World = ReturnType<typeof world>["w"];

/** The body Google's ListAccounts returns, with its anti-hijacking prefix. */
function listing(...emails: string[]) {
  return `)]}'\n${JSON.stringify(["gaia.l.a.r", emails.map((e) => ["gaia.l.a", 1, "Name", e])])}`;
}

/** A Google sign-in cookie that expires in an hour (seconds, as Chrome reports it). */
function sid(expires = Date.parse(NOW_ISO) / 1000 + 3600): Cookie {
  return { name: "SID", domain: ".google.com", expires };
}

function world() {
  const w = {
    nowMs: Date.parse(NOW_ISO),
    bots: {
      scout: { name: "Scout", account: LOGIN as string | null },
      pine: { name: "Pine", account: LOGIN as string | null },
    } as Record<string, { name: string; account: string | null }>,
    vault: {
      [LOGIN]: { name: LOGIN, label: "Scout Gmail", username: "Scout@Gmail.com" },
    } as Record<string, { name: string; label: string; username: string }>,
    available: true,
    running: {} as Record<string, "plain" | "driven" | null>,
    cookies: [] as Cookie[],
    cookiesThrow: false,
    cookieCalls: [] as string[],
    listing: listing(BOT_EMAIL),
    fetchReject: false,
    fetchCalls: [] as string[],
    openThrows: false,
    opened: [] as { slug: string; url: string }[],
    cleared: [] as string[],
    broadcasts: [] as { channel: string; payload: { slug: string; account: unknown } }[],
    changes: 0,
    timers: [] as { fn: () => Promise<void>; ms: number; handle: { id: number } }[],
    clearedTimers: [] as { id: number }[],
  };
  const chrome = {
    available: () => w.available,
    running: (slug: string) => w.running[slug] ?? null,
    cookies: async (slug: string) => {
      w.cookieCalls.push(slug);
      if (w.cookiesThrow) throw new Error("profile is locked");
      return w.cookies.map((c) => ({ ...c }));
    },
    fetchText: async (_slug: string, url: string) => {
      w.fetchCalls.push(url);
      if (w.fetchReject) throw new Error("offline");
      return w.listing;
    },
    openForPerson: async (slug: string, url: string) => {
      if (w.openThrows) throw new Error("Chrome could not start");
      w.opened.push({ slug, url });
      w.running[slug] = "plain";
    },
    clearCookies: async (slug: string) => {
      w.cleared.push(slug);
      w.cookies = [];
    },
  };
  const store = {
    readBot: (slug: string) => (w.bots[slug] ? { bot: { ...w.bots[slug] } } : null),
    slugs: () => Object.keys(w.bots),
  };
  const vault = {
    get: (name: string) => (w.vault[name] ? { ...w.vault[name] } : null),
  };
  let nextId = 1;
  const accounts = createAccounts({
    store,
    vault,
    chrome,
    broadcast: (channel: string, payload: { slug: string; account: unknown }) => w.broadcasts.push({ channel, payload }),
    onChange: () => {
      w.changes += 1;
    },
    now: () => new Date(w.nowMs),
    setTimer: (fn: () => Promise<void>, ms: number) => {
      const handle = { id: nextId++ };
      w.timers.push({ fn, ms, handle });
      return handle;
    },
    clearTimer: (h: { id: number }) => {
      w.clearedTimers.push(h);
    },
  });
  return { w, a: accounts };
}

describe("view", () => {
  it("is null for a bot without an account", () => {
    const { w, a } = world();
    w.bots.scout.account = null;
    expect(a.view("scout")).toBeNull();
  });

  it("is unknown before any check, with the login and its email", () => {
    const { a } = world();
    expect(a.view("scout")).toEqual({
      slug: "scout",
      login: LOGIN,
      email: "scout@gmail.com",
      state: "unknown",
      signedInAs: null,
      message: "",
      checkedAt: null,
    });
  });

  it("is missing when the vault lacks the login", () => {
    const { w, a } = world();
    w.vault = {};
    expect(a.view("scout").state).toBe("missing");
  });

  it("is no_chrome when Chrome isn't installed", () => {
    const { w, a } = world();
    w.available = false;
    expect(a.view("scout").state).toBe("no_chrome");
  });

  it("is signing_in with the exact message while the plain window is open", () => {
    const { w, a } = world();
    w.running.scout = "plain";
    const v = a.view("scout");
    expect(v.state).toBe("signing_in");
    expect(v.message).toBe(SIGNING_IN);
  });
});

describe("check", () => {
  it("is signed_out with no Google cookie", async () => {
    const { w, a } = world();
    const v = await a.check("scout");
    expect(v.state).toBe("signed_out");
    expect(v.checkedAt).toBe(NOW_ISO);
    expect(w.fetchCalls).toEqual([]);
  });

  it("is signed_out for a Google cookie on another domain", async () => {
    const { w, a } = world();
    w.cookies = [{ name: "SID", domain: ".example.com", expires: Date.parse(NOW_ISO) / 1000 + 3600 }];
    expect((await a.check("scout")).state).toBe("signed_out");
  });

  it("treats an expired sign-in cookie as signed out", async () => {
    const { w, a } = world();
    w.cookies = [sid(Date.parse(NOW_ISO) / 1000 - 60)];
    expect((await a.check("scout")).state).toBe("signed_out");
  });

  it("counts a session cookie (expires -1) as signed in", async () => {
    const { w, a } = world();
    w.cookies = [sid(-1)];
    expect((await a.check("scout")).state).toBe("signed_in");
  });

  it("is signed_in when ListAccounts lists the bot's email, asking Google's list URL", async () => {
    const { w, a } = world();
    w.cookies = [sid()];
    const v = await a.check("scout");
    expect(v.state).toBe("signed_in");
    expect(w.fetchCalls).toEqual([LIST_URL]);
    expect(w.cookieCalls).toEqual(["scout"]);
  });

  it("matches the bot's email in any letter case", async () => {
    const { w, a } = world();
    w.cookies = [sid()];
    w.listing = listing("SCOUT@gmail.COM");
    expect((await a.check("scout")).state).toBe("signed_in");
  });

  it("reads a ListAccounts body without the prefix too", async () => {
    const { w, a } = world();
    w.cookies = [sid()];
    w.listing = JSON.stringify(["gaia.l.a.r", [["gaia.l.a", 1, "Scout", BOT_EMAIL]]]);
    expect((await a.check("scout")).state).toBe("signed_in");
  });

  it("is other_account, with the email signed in, when ListAccounts lists someone else", async () => {
    const { w, a } = world();
    w.cookies = [sid()];
    w.listing = listing("other@gmail.com");
    const v = await a.check("scout");
    expect(v.state).toBe("other_account");
    expect(v.signedInAs).toBe("other@gmail.com");
  });

  it("is signed_in when fetchText fails, since nothing says it is someone else", async () => {
    const { w, a } = world();
    w.cookies = [sid()];
    w.fetchReject = true;
    expect((await a.check("scout")).state).toBe("signed_in");
  });

  it("is signed_in when ListAccounts lists nothing", async () => {
    const { w, a } = world();
    w.cookies = [sid()];
    w.listing = listing();
    expect((await a.check("scout")).state).toBe("signed_in");
  });

  it("keeps the old state and sets checkedAt when the profile can't be read", async () => {
    const { w, a } = world();
    w.cookies = [sid()];
    await a.check("scout");
    w.cookiesThrow = true;
    w.nowMs += 60_000;
    const v = await a.check("scout");
    expect(v.state).toBe("signed_in");
    expect(v.checkedAt).toBe(new Date(w.nowMs).toISOString());
  });

  it.each<[string, (w: World) => void]>([
    ["signing_in", (w) => (w.running.scout = "plain")],
    ["missing", (w) => (w.vault = {})],
    ["no_chrome", (w) => (w.available = false)],
  ])("does not read cookies while %s", async (_name, setup) => {
    const { w, a } = world();
    setup(w);
    await a.check("scout");
    expect(w.cookieCalls).toEqual([]);
  });
});

describe("broadcasts", () => {
  it("sends one per change, and none for an unchanged check", async () => {
    const { w, a } = world();
    await a.check("scout");
    expect(w.broadcasts).toEqual([{ channel: "crew:account", payload: { slug: "scout", account: a.view("scout") } }]);
    expect(w.changes).toBe(1);
    await a.check("scout");
    expect(w.broadcasts).toHaveLength(1);
    expect(w.changes).toBe(1);
  });

  it("sends again when the state changes", async () => {
    const { w, a } = world();
    await a.check("scout");
    w.cookies = [sid()];
    await a.check("scout");
    expect(w.broadcasts).toHaveLength(2);
    expect(w.broadcasts[1].payload.account).toMatchObject({ state: "signed_in" });
    expect(w.changes).toBe(2);
  });
});

describe("signIn", () => {
  it("says there is no account and opens nothing", async () => {
    const { w, a } = world();
    w.bots.scout.account = null;
    const r = await a.signIn("scout");
    expect(r.state).toBeNull();
    expect(r.text).toContain("You have no Google account");
    expect(w.opened).toEqual([]);
  });

  it("says the login is missing and opens nothing", async () => {
    const { w, a } = world();
    w.vault = {};
    const r = await a.signIn("scout");
    expect(r.state).toBe("missing");
    expect(r.text).toContain("isn't in the vault");
    expect(w.opened).toEqual([]);
  });

  it("says Chrome isn't installed and opens nothing", async () => {
    const { w, a } = world();
    w.available = false;
    const r = await a.signIn("scout");
    expect(r.state).toBe("no_chrome");
    expect(r.text).toContain("Google Chrome isn't installed");
    expect(w.opened).toEqual([]);
  });

  it("says it is already signed in and opens nothing", async () => {
    const { w, a } = world();
    w.cookies = [sid()];
    const r = await a.signIn("scout");
    expect(r.state).toBe("signed_in");
    expect(r.text).toBe(`Signed in as ${BOT_EMAIL}.`);
    expect(w.opened).toEqual([]);
  });

  it("says another account is signed in and opens nothing", async () => {
    const { w, a } = world();
    w.cookies = [sid()];
    w.listing = listing("other@gmail.com");
    const r = await a.signIn("scout");
    expect(r.state).toBe("other_account");
    expect(r.text).toContain("other@gmail.com");
    expect(w.opened).toEqual([]);
  });

  it("opens the bot's Chrome on the sign-in page for its email when signed out", async () => {
    const { w, a } = world();
    const r = await a.signIn("scout");
    expect(w.opened).toHaveLength(1);
    expect(w.opened[0].slug).toBe("scout");
    expect(w.opened[0].url).toContain("Email=");
    expect(w.opened[0].url).toContain(encodeURIComponent(BOT_EMAIL));
    expect(r.state).toBe("signing_in");
    expect(r.text).toMatch(/the person/i);
    expect(r.text).toContain("ask_human");
    expect(a.view("scout").state).toBe("signing_in");
  });

  it("does not open a second window while signing in", async () => {
    const { w, a } = world();
    await a.signIn("scout");
    const cookieCalls = w.cookieCalls.length;
    const r = await a.signIn("scout");
    expect(w.opened).toHaveLength(1);
    expect(w.cookieCalls).toHaveLength(cookieCalls);
    expect(r.state).toBe("signing_in");
  });

  it("rejects when the window can't open", async () => {
    const { w, a } = world();
    w.openThrows = true;
    await expect(a.signIn("scout")).rejects.toThrow("Chrome could not start");
  });
});

describe("plainClosed", () => {
  it("checks again after the person signed in and closed the window", async () => {
    const { w, a } = world();
    await a.signIn("scout");
    expect(a.view("scout").state).toBe("signing_in");
    w.running.scout = null;
    w.cookies = [sid()];
    const v = await a.plainClosed("scout");
    expect(v.state).toBe("signed_in");
    expect(a.view("scout").state).toBe("signed_in");
  });
});

describe("signOut", () => {
  it("clears the profile's cookies, then reports signed_out", async () => {
    const { w, a } = world();
    w.cookies = [sid()];
    await a.check("scout");
    const v = await a.signOut("scout");
    expect(w.cleared).toEqual(["scout"]);
    expect(w.cookies).toEqual([]);
    expect(v.state).toBe("signed_out");
    expect(a.view("scout").state).toBe("signed_out");
  });
});

describe("ensure", () => {
  it("leaves a signed-out account signed out and opens no window", async () => {
    const { w, a } = world();
    const v = await a.ensure("scout");
    expect(v.state).toBe("signed_out");
    expect(w.opened).toEqual([]);
  });
});

describe("promptLine", () => {
  it("is empty without an account", () => {
    const { w, a } = world();
    w.bots.scout.account = null;
    expect(a.promptLine("scout")).toBe("");
  });

  it("names the email and the state before a check", () => {
    const { a } = world();
    const line = a.promptLine("scout");
    expect(line).toContain(BOT_EMAIL);
    expect(line).toContain("not checked yet");
  });

  it("names the email and the state after a check", async () => {
    const { a } = world();
    await a.check("scout");
    expect(a.promptLine("scout")).toContain("signed out");
  });

  it("says never to type the password and points at the account sign_in action", () => {
    const { a } = world();
    const line = a.promptLine("scout");
    expect(line).toContain("never type its password");
    expect(line).toContain('{action: "sign_in"}');
  });
});

describe("start and stop", () => {
  it("checks only bots whose Chrome is driven, then reschedules every 30 minutes", async () => {
    const { w, a } = world();
    w.running.scout = "driven";
    w.running.pine = null;
    a.start();
    expect(w.timers).toHaveLength(1);
    expect(w.timers[0].ms).toBe(THIRTY_MIN);
    await w.timers[0].fn();
    expect(w.cookieCalls).toEqual(["scout"]);
    expect(w.timers).toHaveLength(2);
    expect(w.timers[1].ms).toBe(THIRTY_MIN);
  });

  it("clears the pending timer on stop, once", () => {
    const { w, a } = world();
    a.start();
    const handle = w.timers[0].handle;
    a.stop();
    a.stop();
    expect(w.clearedTimers).toEqual([handle]);
  });
});

describe("secrets", () => {
  it("never puts the word password in a view or a broadcast", async () => {
    const { w, a } = world();
    await a.signIn("scout");
    w.running.scout = null;
    w.cookies = [sid()];
    await a.plainClosed("scout");
    await a.signOut("scout");
    const shown = JSON.stringify([a.list(), w.broadcasts]);
    expect(shown).not.toMatch(/password/i);
    expect(a.promptLine("scout").match(/password/gi)).toHaveLength(1);
  });
});
