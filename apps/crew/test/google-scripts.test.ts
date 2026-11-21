import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { signInUrl, parseListAccounts } = require("../src/main/google-scripts.cjs");

const SAMPLE = `["gaia.l.a.r",[["gaia.l.a",1,"Scout Bot","scout.bot@gmail.com","https://lh3.googleusercontent.com/a/x",1,1,0,null,1,"1234567890",null,null,null,null,1]]]`;

describe("signInUrl", () => {
  it("opens Google's sign-in page for the account, with the email encoded", () => {
    expect(signInUrl("scout.bot+x@gmail.com")).toBe("https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmyaccount.google.com%2F&Email=scout.bot%2Bx%40gmail.com");
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
