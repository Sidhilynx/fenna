import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MASK, totpCode, type RunEvent } from "@opendeck/crew";

const require = createRequire(import.meta.url);
const { createStore } = require("../src/main/store.cjs");
const { createWaits } = require("../src/main/waits.cjs");
const { createApprover, createHandlers } = require("../src/main/handlers.cjs");
const { createVault } = require("../src/main/vault.cjs");
const { createLogins } = require("../src/main/logins.cjs");
const { buildPrompt } = require("../src/main/prompt.cjs");
const { toolLabel } = require("../src/main/labels.cjs");

const PASSWORD = "Fx9-Vault-Proof-7Qz!";
const TOTP_KEY = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const SITE = "http://127.0.0.1:8765";

/** Stands in for the system's secure storage: reversible, but never the plain text. */
const fakeSecrets = {
  available: async () => true,
  encrypt: async (t: string) => `enc:${Buffer.from(t).toString("base64")}`,
  decrypt: async (d: string) => {
    if (!d.startsWith("enc:")) throw new Error("not ours");
    return Buffer.from(d.slice(4), "base64").toString();
  },
};

let root: string;
let store: ReturnType<typeof createStore>;
let vault: ReturnType<typeof createVault>;
let waits: ReturnType<typeof createWaits>;
let logins: ReturnType<typeof createLogins>;
let handle: (ctx: object, method: string, params: object) => Promise<{ text: string }>;
let events: { runId: string; event: RunEvent }[];
let page: { url: string; title: string };
let fills: Record<string, unknown>[];
let browserText: string;
let clock: number;

const ctx = (slug = "research", runId = "run-1") => ({ slug, runId, team: null, chain: null });
const runLog = () => JSON.stringify(events);
const loginEvents = () => events.map((e) => e.event).filter((e): e is Extract<RunEvent, { type: "login" }> => e.type === "login");

/** The bot's browser, as far as logins see it: where the active tab is, and the fills Crew makes. */
const fakeBrowsers = {
  page: async () => page,
  fillLogin: async (_slug: string, p: Record<string, unknown>) => {
    if (new URL(page.url).origin !== p.origin) throw Object.assign(new Error("origin"), { code: "origin", expected: p.origin, actual: new URL(page.url).origin });
    fills.push({ kind: "login", ...p });
    if (p.submit) page = { url: `${SITE}/code`, title: "Enter your code" };
    return { filledUser: true, filledPassword: true, submitted: !!p.submit, button: "Sign in", changed: p.submit ? ` The page changed to Enter your code (${SITE}/code); call snapshot before acting on it.` : "" };
  },
  fillCode: async (_slug: string, p: Record<string, unknown>) => {
    if (new URL(page.url).origin !== p.origin) throw Object.assign(new Error("origin"), { code: "origin", expected: p.origin, actual: new URL(page.url).origin });
    fills.push({ kind: "code", ...p });
    if (p.submit) page = { url: `${SITE}/home`, title: "Signed in as alice" };
    return { submitted: !!p.submit, changed: p.submit ? ` The page changed to Signed in as alice (${SITE}/home); call snapshot before acting on it.` : "" };
  },
  act: async (_slug: string, m: string) => ({ text: m === "snapshot" ? `Page: x\n- textbox "Password" value="${PASSWORD}" [e3]` : browserText }),
};

async function until(fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function addLogin(over: Record<string, unknown> = {}) {
  return vault.save({ label: "Test site", origins: [SITE], username: "alice", password: PASSWORD, totp: TOTP_KEY, notes: "", ...over });
}

function grant(slug: string, list: { name: string; level: "allow" | "ask" }[]) {
  store.updateBot(slug, { logins: list });
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "crew-vault-"));
  store = createStore(root);
  store.ensure();
  store.createBot({ name: "Research", job: "Reads a site" });
  store.createBot({ name: "Inbox", job: "Sorts mail" });
  vault = createVault({ file: path.join(root, "vault.dat"), secrets: fakeSecrets });
  await vault.load();
  waits = createWaits({ timeoutMs: 1500 });
  events = [];
  fills = [];
  browserText = "ok";
  page = { url: `${SITE}/login`, title: "Sign in" };
  clock = Date.parse("2026-11-18T09:30:00Z");
  const runner = { record: (runId: string, event: RunEvent) => events.push({ runId, event }) };
  const approve = createApprover({ store, runner, waits });
  logins = createLogins({ store, vault, browsers: fakeBrowsers, approve, runner, onChange: () => {}, clock: () => clock });
  handle = createHandlers({ store, runner, waits, approve, browsers: fakeBrowsers, gateway: { handle: async () => ({ text: "" }) }, logins, onChange: () => {} });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the vault on this computer", () => {
  it("keeps the whole file encrypted, secrets sealed again inside, and the page's view masked", async () => {
    await addLogin({ notes: "Ask IT for the recovery codes" });
    const disk = readFileSync(path.join(root, "vault.dat"), "utf8");
    for (const plain of [PASSWORD, TOTP_KEY, "alice", "Test site", "127.0.0.1", "recovery"]) expect(disk).not.toContain(plain);
    if (process.platform !== "win32") expect(statSync(path.join(root, "vault.dat")).mode & 0o777).toBe(0o600);
    const inner = await fakeSecrets.decrypt(disk.trim());
    expect(inner).not.toContain(PASSWORD);
    expect(inner).not.toContain(TOTP_KEY);
    const item = vault.list()[0]!;
    const view = vault.view(item, [{ slug: "research", name: "Research", level: "ask" }]);
    expect(view).toEqual({
      name: "test-site",
      label: "Test site",
      origins: [SITE],
      username: "alice",
      password: MASK,
      hasPassword: true,
      hasTotp: true,
      notes: "Ask IT for the recovery codes",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      lastUsedAt: null,
      usedBy: [{ slug: "research", name: "Research", level: "ask" }],
    });
    expect(JSON.stringify(view)).not.toContain(PASSWORD);
    expect(JSON.stringify(view)).not.toContain(TOTP_KEY);
    // Opened again from disk, it still holds the same login.
    const again = createVault({ file: path.join(root, "vault.dat"), secrets: fakeSecrets });
    await again.load();
    expect((await again.secrets("test-site")).password).toBe(PASSWORD);
    expect((await again.code("test-site", clock)).code).toBe(await totpCode({ secret: TOTP_KEY, digits: 6, period: 30, algorithm: "SHA1" }, clock));
  });

  it("keeps the saved password and key when editing, and says what to fix", async () => {
    await addLogin();
    const edited = await vault.save({ label: "Test site (work)", origins: [SITE, "https://accounts.example.com"], username: "alice@work", keepPassword: true, keepTotp: true }, { replace: "test-site" });
    expect(edited.name).toBe("test-site");
    expect((await vault.secrets("test-site")).password).toBe(PASSWORD);
    expect((await vault.secrets("test-site")).totp).toMatchObject({ secret: TOTP_KEY });
    await vault.save({ label: "Test site", origins: [SITE], username: "alice", keepPassword: true, totp: "" }, { replace: "test-site" });
    expect(vault.get("test-site").totp).toBe("");
    await expect(vault.save({ label: "New", origins: [SITE], username: "bob", keepPassword: true })).rejects.toThrow(/Type the password/);
    await expect(vault.save({ label: "Bad", origins: ["https://evil.example/login"], username: "x", password: "y" })).rejects.toThrow(/Write only the origin, https:\/\/evil\.example/);
    await expect(vault.save({ label: "Gone", origins: [SITE], username: "x", password: "y" }, { replace: "nope" })).rejects.toThrow(/no login "nope"/);
    const second = await addLogin();
    expect(second.name).toBe("test-site-2");
    expect(vault.match(SITE, "alice")!.name).toBe("test-site");
  });

  it("leaves a vault it can't open as it is, and refuses to write over it", async () => {
    writeFileSync(path.join(root, "vault.dat"), "garbage-from-another-computer\n");
    const v = createVault({ file: path.join(root, "vault.dat"), secrets: fakeSecrets });
    await v.load();
    expect(v.problem()).toMatch(/can't be opened/);
    expect(v.list()).toEqual([]);
    await expect(v.save({ label: "x", origins: [SITE], username: "a", password: "b" })).rejects.toThrow(/can't be opened/);
    expect(readFileSync(path.join(root, "vault.dat"), "utf8")).toBe("garbage-from-another-computer\n");
  });
});

describe("a bot using a login", () => {
  it("sees only its granted logins for this page, never a secret", async () => {
    await addLogin();
    await addLogin({ label: "Other site", origins: ["https://other.example"], username: "zed" });
    expect((await logins.handle(ctx(), "logins", {})).text).toMatch(/no logins from the vault/);
    grant("research", [{ name: "test-site", level: "ask" }]);
    const here = (await logins.handle(ctx(), "logins", {})).text;
    expect(here).toContain("- test-site: Test site, username alice, 2-factor codes (fill_code), the person approves each sign-in");
    expect(here).not.toContain("other-site");
    expect(here).not.toContain(PASSWORD);
    page = { url: "https://elsewhere.example/", title: "x" };
    expect((await logins.handle(ctx(), "logins", {})).text).toMatch(/None of your logins is for https:\/\/elsewhere\.example\. Yours: test-site \(http:\/\/127\.0\.0\.1:8765\)/);
    // A login it isn't granted is refused just like one that doesn't exist.
    page = { url: `${SITE}/login`, title: "Sign in" };
    const notMine = await logins.handle(ctx(), "sign_in", { login: "other-site" }).catch((e: Error) => e.message);
    const none = await logins.handle(ctx(), "sign_in", { login: "no-such" }).catch((e: Error) => e.message);
    expect(notMine).toBe(none.replace("no-such", "other-site"));
    expect(fills).toEqual([]);
  });

  it("asks the person for an ask login, then fills and submits; the password never comes back", async () => {
    await addLogin();
    grant("research", [{ name: "test-site", level: "ask" }]);
    const p = handle(ctx(), "browser.sign_in", { login: "test-site", submit: true });
    await until(() => waits.list().length === 1);
    const w = waits.list()[0]!;
    expect(w).toMatchObject({ kind: "approval", source: "login", tool: "test-site", action: "Sign in to 127.0.0.1:8765 as alice" });
    expect(w.details).toContain("Login: Test site");
    expect(w.details).toContain(`Site: ${SITE}`);
    expect(JSON.stringify(w)).not.toContain(PASSWORD);
    expect(fills).toEqual([]);
    waits.answer(w.id, { allowed: true, always: false });
    const r = await p;
    expect(r.text).toMatch(/^Crew filled the username and password of "Test site" on http:\/\/127\.0\.0\.1:8765 and pressed “Sign in”\. The page changed to Enter your code/);
    expect(r.text).toContain('call fill_code {login: "test-site", submit: true}');
    expect(fills).toEqual([{ kind: "login", origin: SITE, username: "alice", password: PASSWORD, usernameRef: null, passwordRef: null, submit: true }]);
    // One approval covers the code step of the same sign-in.
    const code = await handle(ctx(), "browser.fill_code", { login: "test-site", submit: true });
    expect(code.text).toMatch(/Crew filled the current sign-in code of "Test site" and submitted\. The page changed to Signed in as alice/);
    expect(waits.list()).toEqual([]);
    expect(fills[1]).toMatchObject({ kind: "code", origin: SITE, code: await totpCode({ secret: TOTP_KEY, digits: 6, period: 30, algorithm: "SHA1" }, clock) });
    // Whatever the page shows later, the bot never reads a secret Crew filled.
    expect((await handle(ctx(), "browser.snapshot", {})).text).toBe('Page: x\n- textbox "Password" value="[hidden]" [e3]');
    browserText = `It failed: ${fills[1]!.code} was wrong`;
    expect((await handle(ctx(), "browser.click", { ref: "e1" })).text).toBe("It failed: [hidden] was wrong");
    const log = runLog();
    expect(log).not.toContain(PASSWORD);
    expect(log).not.toContain(String(fills[1]!.code));
    expect(log).not.toContain(TOTP_KEY);
    expect(loginEvents().map((e) => [e.action, e.level, e.outcome, e.origin, e.label])).toEqual([
      ["sign_in", "ask", "done", SITE, "Test site"],
      ["fill_code", "ask", "done", SITE, "Test site"],
    ]);
    expect(events.map((e) => e.event.type)).toEqual(["approval", "decision", "login", "login"]);
    expect(vault.get("test-site").lastUsedAt).not.toBe(null);
  });

  it("fills an allow login without asking", async () => {
    await addLogin();
    grant("research", [{ name: "test-site", level: "allow" }]);
    const r = await handle(ctx(), "browser.sign_in", { login: "test-site" });
    expect(r.text).toMatch(/Nothing was submitted/);
    expect(waits.list()).toEqual([]);
    expect(events.map((e) => e.event.type)).toEqual(["login"]);
    expect(fills).toHaveLength(1);
  });

  it("refuses a page on another origin and fills nothing", async () => {
    await addLogin();
    grant("research", [{ name: "test-site", level: "allow" }]);
    for (const url of ["http://127.0.0.1:8766/login", "http://localhost:8765/login", "https://127.0.0.1:8765/login"]) {
      page = { url, title: "Sign in" };
      const msg = await handle(ctx(), "browser.sign_in", { login: "test-site", submit: true }).catch((e: Error) => e.message);
      expect(msg).toContain(`Crew won't fill "Test site" here: this page is on ${new URL(url).origin}, and that login is only for ${SITE}.`);
    }
    expect(fills).toEqual([]);
    expect(loginEvents().map((e) => e.outcome)).toEqual(["refused", "refused", "refused"]);
    // The page moving away between the check and the fill is caught in the page itself.
    page = { url: `${SITE}/login`, title: "Sign in" };
    const moving = { ...fakeBrowsers, fillLogin: async (_s: string, p: Record<string, unknown>) => Promise.reject(Object.assign(new Error("origin"), { code: "origin", expected: p.origin, actual: "https://evil.example" })) };
    const runner = { record: (runId: string, event: RunEvent) => events.push({ runId, event }) };
    const l2 = createLogins({ store, vault, browsers: moving, approve: createApprover({ store, runner, waits }), runner, onChange: () => {} });
    await expect(l2.handle(ctx(), "sign_in", { login: "test-site" })).rejects.toThrow(/The page left http:\/\/127\.0\.0\.1:8765 \(it is on https:\/\/evil\.example now\), so Crew filled nothing/);
  });

  it("keeps a denied login denied for the rest of the run, without asking again", async () => {
    await addLogin();
    grant("research", [{ name: "test-site", level: "ask" }]);
    const p = handle(ctx(), "browser.sign_in", { login: "test-site", submit: true }).catch((e: Error) => e.message);
    await until(() => waits.list().length === 1);
    waits.answer(waits.list()[0]!.id, { allowed: false, always: false });
    expect(await p).toMatch(/^Denied by the person: Crew did not sign in with "Test site"\. Don't try again/);
    const again = await handle(ctx(), "browser.sign_in", { login: "test-site", submit: true }).catch((e: Error) => e.message);
    expect(again).toMatch(/denied signing in with "Test site" in this run/);
    expect(waits.list()).toEqual([]);
    expect(fills).toEqual([]);
    expect(loginEvents().map((e) => e.outcome)).toEqual(["denied", "denied"]);
    // A new run asks again.
    logins.endRun("run-1");
    const next = handle(ctx("research", "run-2"), "browser.sign_in", { login: "test-site" });
    await until(() => waits.list().length === 1);
    waits.answer(waits.list()[0]!.id, { allowed: true, always: false });
    await next;
    expect(fills).toHaveLength(1);
  });

  it("remembers 'Always for this bot' as allow in bot.md, and times out without filling", async () => {
    await addLogin();
    grant("research", [{ name: "test-site", level: "ask" }]);
    const p = handle(ctx(), "browser.sign_in", { login: "test-site" });
    await until(() => waits.list().length === 1);
    waits.answer(waits.list()[0]!.id, { allowed: true, always: true });
    await p;
    expect(store.readBot("research").bot.logins).toEqual([{ name: "test-site", level: "allow" }]);
    expect(readFileSync(path.join(store.botDir("research"), "bot.md"), "utf8")).toContain("logins:\n  - name: test-site\n    level: allow\n");
    grant("inbox", [{ name: "test-site", level: "ask" }]);
    const t = await handle(ctx("inbox", "run-9"), "browser.sign_in", { login: "test-site" }).catch((e: Error) => e.message);
    expect(t).toMatch(/didn't answer in time/);
    expect(fills).toHaveLength(1);
  });

  it("says a login without a setup key has no codes", async () => {
    await addLogin({ totp: "" });
    grant("research", [{ name: "test-site", level: "allow" }]);
    await expect(logins.handle(ctx(), "fill_code", { login: "test-site" })).rejects.toThrow(/has no 2-factor codes in the vault/);
  });

  it("tells a bot with logins how to sign in, and labels the steps", () => {
    const bot = store.readBot("research").bot;
    const base = { slug: "research", memory: "", library: [], others: [], team: null, trigger: "person", text: "hi", from: null, now: new Date(2026, 10, 18) };
    expect(buildPrompt({ ...base, bot })).toContain("call ask_human to ask the person to take control");
    expect(buildPrompt({ ...base, bot: { ...bot, logins: [{ name: "test-site", level: "ask" }] } })).toContain("call logins: if one of your logins fits, call sign_in");
    expect(toolLabel("sign_in", { login: "test-site" }, "browser")).toBe("Asked Crew to sign in with test-site");
    expect(toolLabel("fill_code", {}, "browser")).toBe("Asked Crew for a sign-in code");
    expect(toolLabel("logins", {}, "browser")).toBe("Looked for its logins");
  });

  it("writes nothing secret into the bot's folder", async () => {
    await addLogin();
    grant("research", [{ name: "test-site", level: "allow" }]);
    await handle(ctx(), "browser.sign_in", { login: "test-site", submit: true });
    await handle(ctx(), "browser.fill_code", { login: "test-site", submit: true });
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const f of walk(path.join(root, "bots"))) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toContain(PASSWORD);
      expect(text, f).not.toContain(TOTP_KEY);
    }
    expect(existsSync(path.join(root, "vault.dat"))).toBe(true);
  });
});
