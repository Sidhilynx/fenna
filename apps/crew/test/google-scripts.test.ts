import { createRequire } from "node:module";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { SIGN_IN_ORIGIN, signInUrl, googleStage, googleFocus, googleNext, googlePick, parseListAccounts } = require("../src/main/google-scripts.cjs");

const PAGE_FUNCTIONS = { googleStage, googleFocus, googleNext, googlePick };

const SAMPLE = `["gaia.l.a.r",[["gaia.l.a",1,"Scout Bot","scout.bot@gmail.com","https://lh3.googleusercontent.com/a/x",1,1,0,null,1,"1234567890",null,null,null,null,1]]]`;

interface Opts {
  tag?: string;
  attrs?: Record<string, string>;
  text?: string;
  value?: string;
  visible?: boolean;
  disabled?: boolean;
  parent?: FakeEl;
}

interface FakeEl {
  tag: string;
  attrs: Record<string, string>;
  parent: FakeEl | null;
  textContent: string;
  value: string;
  disabled: boolean;
  visible: boolean;
  clicks: number;
  selected: boolean;
  getAttribute(name: string): string | null;
  getClientRects(): object[];
  click(): void;
  focus(): void;
  select(): void;
}

/** A fake element: a tag, attributes (id included), text, a visible flag, a disabled flag, and click and select counters. */
function fakeEl(o: Opts = {}): FakeEl {
  const el: FakeEl = {
    tag: o.tag ?? "div",
    attrs: o.attrs ?? {},
    parent: o.parent ?? null,
    textContent: o.text ?? "",
    value: o.value ?? "",
    disabled: o.disabled ?? false,
    visible: o.visible ?? true,
    clicks: 0,
    selected: false,
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null),
    getClientRects: () => (el.visible ? [{}] : []),
    click: () => {
      el.clicks++;
    },
    focus: () => {},
    select: () => {
      el.selected = true;
    },
  };
  return el;
}

/** One selector part: an optional tag, an optional #id, and any [attr] or [attr="value"] tests. Anything else throws, so the fake never guesses. */
function compoundMatches(el: FakeEl, part: string): boolean {
  const m = /^([a-z]*)((?:#[\w-]+)?)((?:\[[^\]]+\])*)$/i.exec(part);
  if (!m) throw new Error(`fake page cannot match selector part: ${part}`);
  const [, tag, id, attrs] = m;
  if (tag && el.tag !== tag) return false;
  if (id && el.getAttribute("id") !== id.slice(1)) return false;
  for (const a of attrs.match(/\[[^\]]+\]/g) ?? []) {
    const eq = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(a);
    if (!eq) throw new Error(`fake page cannot match attribute test: ${a}`);
    const [, name, value] = eq;
    const actual = el.getAttribute(name);
    if (actual === null) return false;
    if (value !== undefined && actual !== value) return false;
  }
  return true;
}

/** A group like "#identifierNext button": the last part matches the element, the others match its ancestors in order. */
function groupMatches(el: FakeEl, parts: string[]): boolean {
  if (!compoundMatches(el, parts[parts.length - 1])) return false;
  let rest = parts.slice(0, -1);
  for (let anc = el.parent; rest.length && anc; anc = anc.parent) {
    if (compoundMatches(anc, rest[rest.length - 1])) rest = rest.slice(0, -1);
  }
  return rest.length === 0;
}

/** A fake page: the elements, in document order, body text, a location, and a focus that sets document.activeElement. */
function fakePage(elements: FakeEl[] = [], page: { hostname?: string; text?: string } = {}) {
  const hostname = page.hostname ?? "accounts.google.com";
  let active: FakeEl | null = null;
  for (const el of elements) {
    el.focus = () => {
      active = el;
    };
  }
  const document = {
    body: { innerText: page.text ?? "" },
    get activeElement() {
      return active;
    },
    querySelectorAll: (selector: string) => elements.filter((el) => selector.split(", ").some((group) => groupMatches(el, group.split(" ")))),
  };
  const ctx: Record<string, unknown> = { document, location: { hostname, origin: `https://${hostname}` } };
  vm.createContext(ctx);
  const run = (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => vm.runInContext(`(${fn.toString()})`, ctx)(...args);
  return { run };
}

const input = (attrs: Record<string, string>, o: Opts = {}) => fakeEl({ tag: "input", attrs, ...o });
const button = (text: string, o: Opts = {}) => fakeEl({ tag: "button", text, ...o });

describe("google page functions", () => {
  it("each compiles alone from its source text", () => {
    for (const [name, fn] of Object.entries(PAGE_FUNCTIONS)) {
      expect(() => new vm.Script("(" + fn.toString() + ")"), name).not.toThrow();
    }
  });

  it("runs on an empty page, so nothing outside the function body is needed", () => {
    const { run } = fakePage([], { hostname: "example.com" });
    expect(run(googleStage)).toEqual({ stage: "unknown", error: null });
    expect(run(googleFocus, { field: "email" })).toEqual({ found: false, focused: false, value: "" });
    expect(run(googleNext)).toEqual({ clicked: false });
    expect(run(googlePick, { email: "scout.bot@gmail.com" })).toEqual({ picked: null });
  });

  it("builds the sign-in url with the email encoded, and exposes the origin", () => {
    expect(SIGN_IN_ORIGIN).toBe("https://accounts.google.com");
    expect(signInUrl("scout.bot+x@gmail.com")).toBe(
      "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmyaccount.google.com%2F&Email=scout.bot%2Bx%40gmail.com",
    );
  });
});

describe("googleStage", () => {
  it("reads signed_in from the account page host", () => {
    expect(fakePage([input({ type: "password" })], { hostname: "myaccount.google.com" }).run(googleStage)).toEqual({ stage: "signed_in", error: null });
  });

  it("reads blocked from the page text, with either apostrophe", () => {
    expect(fakePage([input({ type: "password" })], { text: "This browser or app may not be secure" }).run(googleStage)).toMatchObject({ stage: "blocked" });
    expect(fakePage([], { text: "Couldn’t sign you in" }).run(googleStage)).toMatchObject({ stage: "blocked" });
    expect(fakePage([], { text: "Couldn't sign you in" }).run(googleStage)).toMatchObject({ stage: "blocked" });
  });

  it("reads code from the one-time code input, by name, id or autocomplete", () => {
    expect(fakePage([input({ name: "totpPin" })]).run(googleStage)).toMatchObject({ stage: "code" });
    expect(fakePage([input({ id: "totpPin" })]).run(googleStage)).toMatchObject({ stage: "code" });
    expect(fakePage([input({ autocomplete: "one-time-code" })]).run(googleStage)).toMatchObject({ stage: "code" });
  });

  it("reads password, email and chooser from their inputs and elements", () => {
    expect(fakePage([input({ type: "password" })]).run(googleStage)).toMatchObject({ stage: "password" });
    expect(fakePage([input({ type: "email" })]).run(googleStage)).toMatchObject({ stage: "email" });
    expect(fakePage([input({ name: "identifier" })]).run(googleStage)).toMatchObject({ stage: "email" });
    expect(fakePage([fakeEl({ tag: "li", attrs: { "data-identifier": "scout.bot@gmail.com" } })]).run(googleStage)).toMatchObject({ stage: "chooser" });
    expect(fakePage([fakeEl({ tag: "li", attrs: { "data-email": "scout.bot@gmail.com" } })]).run(googleStage)).toMatchObject({ stage: "chooser" });
  });

  it("reads challenge for anything else on the sign-in host, and unknown elsewhere", () => {
    expect(fakePage([], { text: "Verify it's you" }).run(googleStage)).toEqual({ stage: "challenge", error: null });
    expect(fakePage([], { hostname: "example.com" }).run(googleStage)).toEqual({ stage: "unknown", error: null });
  });

  it("checks in the order the plan gives: blocked before code, code before password, password before email, email before chooser", () => {
    expect(fakePage([input({ type: "password" })], { text: "Couldn't sign you in" }).run(googleStage)).toMatchObject({ stage: "blocked" });
    expect(fakePage([input({ type: "password" }), input({ name: "totpPin" })]).run(googleStage)).toMatchObject({ stage: "code" });
    expect(fakePage([input({ type: "email" }), input({ type: "password" })]).run(googleStage)).toMatchObject({ stage: "password" });
    expect(fakePage([input({ type: "email" }), fakeEl({ attrs: { "data-identifier": "a@b.co" } })]).run(googleStage)).toMatchObject({ stage: "email" });
    expect(fakePage([fakeEl({ attrs: { "data-identifier": "a@b.co" } })], { hostname: "accounts.google.com" }).run(googleStage)).toMatchObject({ stage: "chooser" });
    expect(fakePage([input({ type: "password" })], { hostname: "myaccount.google.com" }).run(googleStage)).toMatchObject({ stage: "signed_in" });
  });

  it("ignores hidden inputs, so a hidden password field on the sign-in host is a challenge", () => {
    expect(fakePage([input({ type: "password" }, { visible: false })]).run(googleStage)).toEqual({ stage: "challenge", error: null });
  });

  it("returns the visible alert text, collapsed and at most 300 characters", () => {
    const alert = fakeEl({ attrs: { role: "alert" }, text: "  Wrong   password.\n Try again " });
    expect(fakePage([alert], { hostname: "example.com" }).run(googleStage)).toEqual({ stage: "unknown", error: "Wrong password. Try again" });
    const long = fakeEl({ attrs: { "aria-live": "assertive" }, text: "x".repeat(400) });
    expect(fakePage([long], { hostname: "example.com" }).run(googleStage)).toMatchObject({ error: "x".repeat(300) });
  });

  it("returns no error text for a hidden alert", () => {
    const hidden = fakeEl({ attrs: { role: "alert" }, text: "Wrong password", visible: false });
    expect(fakePage([hidden], { hostname: "example.com" }).run(googleStage)).toEqual({ stage: "unknown", error: null });
  });
});

describe("googleFocus", () => {
  it("focuses the email input with its text selected and returns its value", () => {
    const email = input({ type: "email" }, { value: "scout.bot@gmail.com" });
    const { run } = fakePage([email]);
    expect(run(googleFocus, { field: "email" })).toEqual({ found: true, focused: true, value: "scout.bot@gmail.com" });
    expect(email.selected).toBe(true);
  });

  it("never returns a password value", () => {
    const pw = input({ type: "password" }, { value: "hunter2" });
    const result = fakePage([pw]).run(googleFocus, { field: "password" });
    expect(result).toEqual({ found: true, focused: true, value: "" });
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(pw.selected).toBe(true);
  });

  it("finds the code input by name and returns its value", () => {
    const code = input({ name: "totpPin" }, { value: "123456" });
    expect(fakePage([code]).run(googleFocus, { field: "code" })).toEqual({ found: true, focused: true, value: "123456" });
  });

  it("reports not found for a missing or hidden input, and for an unknown field", () => {
    expect(fakePage([]).run(googleFocus, { field: "password" })).toEqual({ found: false, focused: false, value: "" });
    expect(fakePage([input({ type: "password" }, { visible: false })]).run(googleFocus, { field: "password" })).toEqual({ found: false, focused: false, value: "" });
    expect(fakePage([input({ type: "password" })]).run(googleFocus, { field: "nope" })).toEqual({ found: false, focused: false, value: "" });
  });
});

describe("googleNext", () => {
  it("clicks the Next button, whatever its case and spacing", () => {
    const next = button("  nEXT ");
    expect(fakePage([next]).run(googleNext)).toEqual({ clicked: true });
    expect(next.clicks).toBe(1);
  });

  it("clicks a Next button known by its aria-label", () => {
    const next = button("", { attrs: { "aria-label": "Next" } });
    expect(fakePage([next]).run(googleNext)).toEqual({ clicked: true });
    expect(next.clicks).toBe(1);
  });

  it("skips disabled buttons, by property and by aria-disabled", () => {
    const disabled = button("Next", { disabled: true });
    const ariaDisabled = button("Next", { attrs: { "aria-disabled": "true" } });
    const enabled = button("Next");
    expect(fakePage([disabled, ariaDisabled, enabled]).run(googleNext)).toEqual({ clicked: true });
    expect(disabled.clicks).toBe(0);
    expect(ariaDisabled.clicks).toBe(0);
    expect(enabled.clicks).toBe(1);
  });

  it("skips a hidden Next button", () => {
    const hidden = button("Next", { visible: false });
    expect(fakePage([hidden]).run(googleNext)).toEqual({ clicked: false });
    expect(hidden.clicks).toBe(0);
  });

  it("falls back to the button inside #identifierNext, then to #passwordNext and #totpNext", () => {
    const identifier = fakeEl({ attrs: { id: "identifierNext" } });
    const idButton = button("", { parent: identifier });
    expect(fakePage([identifier, idButton]).run(googleNext)).toEqual({ clicked: true });
    expect(idButton.clicks).toBe(1);

    const passwordHolder = fakeEl({ attrs: { id: "passwordNext" } });
    const passwordButton = button("", { parent: passwordHolder });
    const totp = fakeEl({ attrs: { id: "totpNext" } });
    expect(fakePage([passwordHolder, passwordButton, totp]).run(googleNext)).toEqual({ clicked: true });
    expect(passwordButton.clicks).toBe(1);
    expect(totp.clicks).toBe(0);
  });

  it("uses the bare #totpNext element when no other step's Next is there", () => {
    const totp = fakeEl({ attrs: { id: "totpNext" } });
    expect(fakePage([totp]).run(googleNext)).toEqual({ clicked: true });
    expect(totp.clicks).toBe(1);
  });

  it("clicks nothing when there is no Next", () => {
    expect(fakePage([button("Back")]).run(googleNext)).toEqual({ clicked: false });
  });
});

describe("googlePick", () => {
  it("clicks the account whose data-identifier matches, ignoring case", () => {
    const account = fakeEl({ tag: "li", attrs: { "data-identifier": "Scout.Bot@Gmail.com" } });
    expect(fakePage([account]).run(googlePick, { email: "scout.bot@gmail.com" })).toEqual({ picked: "account" });
    expect(account.clicks).toBe(1);
  });

  it("matches data-email too", () => {
    const account = fakeEl({ tag: "li", attrs: { "data-email": "scout.bot@gmail.com" } });
    expect(fakePage([account]).run(googlePick, { email: "SCOUT.BOT@gmail.com" })).toEqual({ picked: "account" });
    expect(account.clicks).toBe(1);
  });

  it("picks Use another account when the email is not listed", () => {
    const other = button("Use another account");
    const { run } = fakePage([fakeEl({ tag: "li", attrs: { "data-identifier": "other@gmail.com" } }), other]);
    expect(run(googlePick, { email: "scout.bot@gmail.com" })).toEqual({ picked: "other" });
    expect(other.clicks).toBe(1);
  });

  it("prefers the listed account over Use another account", () => {
    const account = fakeEl({ tag: "li", attrs: { "data-identifier": "scout.bot@gmail.com" } });
    const other = button("Use another account");
    expect(fakePage([other, account]).run(googlePick, { email: "scout.bot@gmail.com" })).toEqual({ picked: "account" });
    expect(other.clicks).toBe(0);
  });

  it("picks nothing when neither is on the page, or the account is hidden", () => {
    expect(fakePage([button("Back")]).run(googlePick, { email: "scout.bot@gmail.com" })).toEqual({ picked: null });
    const hidden = fakeEl({ tag: "li", attrs: { "data-identifier": "scout.bot@gmail.com" }, visible: false });
    expect(fakePage([hidden]).run(googlePick, { email: "scout.bot@gmail.com" })).toEqual({ picked: null });
    expect(hidden.clicks).toBe(0);
  });
});

describe("parseListAccounts", () => {
  it("reads the email (lowercased) and name from a real-shaped body", () => {
    expect(parseListAccounts(SAMPLE)).toEqual([{ email: "scout.bot@gmail.com", name: "Scout Bot" }]);
  });

  it("strips the )]}' prefix line", () => {
    expect(parseListAccounts(")]}'\n" + SAMPLE)).toEqual([{ email: "scout.bot@gmail.com", name: "Scout Bot" }]);
  });

  it("lowercases the email", () => {
    expect(parseListAccounts(SAMPLE.replace("scout.bot@gmail.com", "Scout.Bot@Gmail.COM"))).toEqual([{ email: "scout.bot@gmail.com", name: "Scout Bot" }]);
  });

  it("skips an entry without an email and gives a null name when there is none", () => {
    const body = `["gaia.l.a.r",[["gaia.l.a",1,"No Mail"],["gaia.l.a",1,"","a@b.co"]]]`;
    expect(parseListAccounts(body)).toEqual([{ email: "a@b.co", name: null }]);
  });

  it("returns nothing for junk, null and other shapes, and never throws", () => {
    for (const bad of ["not json", "", null, undefined, 42, `["other",[]]`, "{}", ")]}'\n{broken", `["gaia.l.a.r","x"]`]) {
      expect(() => parseListAccounts(bad as string)).not.toThrow();
      expect(parseListAccounts(bad as string)).toEqual([]);
    }
  });
});
