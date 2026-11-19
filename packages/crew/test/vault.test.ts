import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  checkBot,
  checkOrigin,
  checkVaultItem,
  hotp,
  newBot,
  originMatches,
  originOf,
  parseBot,
  parseTotp,
  parseVault,
  readTotp,
  SCRUBBED,
  scrubSecrets,
  serializeBot,
  serializeVault,
  totpCode,
  totpSecondsLeft,
  type Totp,
  type VaultItem,
} from "../src/index.ts";

const ascii = (s: string) => base32Encode(new TextEncoder().encode(s));

describe("origins a login may be filled on", () => {
  const origins = ["https://accounts.example.com", "http://127.0.0.1:8765"];

  it("matches only the exact scheme, host and port", () => {
    expect(originMatches(origins, "https://accounts.example.com/login?next=/")).toBe(true);
    expect(originMatches(origins, "https://ACCOUNTS.example.com/")).toBe(true);
    expect(originMatches(origins, "https://accounts.example.com:443/x")).toBe(true);
    expect(originMatches(origins, "http://127.0.0.1:8765/signin")).toBe(true);
    // Look-alikes and neighbours are not the same site.
    expect(originMatches(origins, "https://accounts.example.com.evil.test/login")).toBe(false);
    expect(originMatches(origins, "https://evil.test/accounts.example.com")).toBe(false);
    expect(originMatches(origins, "https://accounts.example.com@evil.test/")).toBe(false);
    expect(originMatches(origins, "https://example.com/")).toBe(false);
    expect(originMatches(origins, "https://login.accounts.example.com/")).toBe(false);
    expect(originMatches(origins, "http://accounts.example.com/")).toBe(false);
    expect(originMatches(origins, "https://accounts.example.com:8443/")).toBe(false);
    expect(originMatches(origins, "http://127.0.0.1:8766/signin")).toBe(false);
    expect(originMatches(origins, "http://localhost:8765/signin")).toBe(false);
    expect(originMatches(origins, "https://accounts.example.com./")).toBe(false);
    expect(originMatches(origins, "https://xn--accunts-x4a.example.com/")).toBe(false);
    expect(originMatches(origins, "about:blank")).toBe(false);
    expect(originMatches(origins, "data:text/html,<form>")).toBe(false);
    expect(originMatches(origins, "file:///C:/login.html")).toBe(false);
    expect(originMatches(origins, "not a url")).toBe(false);
    expect(originOf("javascript:alert(1)")).toBe(null);
  });

  it("takes an origin as the person writes it, and says how to fix one that isn't", () => {
    expect(checkOrigin("https://Accounts.Example.com")).toEqual({ origin: "https://accounts.example.com" });
    expect(checkOrigin("accounts.example.com")).toEqual({ origin: "https://accounts.example.com" });
    expect(checkOrigin("https://accounts.example.com/")).toEqual({ origin: "https://accounts.example.com" });
    expect(checkOrigin("http://127.0.0.1:8765")).toEqual({ origin: "http://127.0.0.1:8765" });
    expect(checkOrigin("http://localhost:3000")).toEqual({ origin: "http://localhost:3000" });
    expect(checkOrigin("https://accounts.example.com/login")).toMatchObject({ error: expect.stringContaining("Write only the origin, https://accounts.example.com") });
    expect(checkOrigin("http://accounts.example.com")).toMatchObject({ error: expect.stringContaining("write https://accounts.example.com") });
    expect(checkOrigin("https://me:pw@accounts.example.com")).toMatchObject({ error: expect.stringContaining("name and password") });
    expect(checkOrigin("ftp://files.example.com")).toMatchObject({ error: expect.stringContaining("not a web address") });
    expect(checkOrigin("")).toMatchObject({ error: expect.stringContaining("https://accounts.example.com") });
  });
});

describe("sign-in codes (RFC 6238)", () => {
  // The test vectors from RFC 6238, appendix B: 8 digits, 30 seconds.
  const seeds: Record<Totp["algorithm"], string> = {
    SHA1: "12345678901234567890",
    SHA256: "12345678901234567890123456789012",
    SHA512: "1234567890123456789012345678901234567890123456789012345678901234",
  };
  const vectors: [number, string, string, string][] = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];

  it("makes the RFC's codes for SHA1, SHA256 and SHA512", async () => {
    for (const [t, sha1, sha256, sha512] of vectors) {
      for (const [algorithm, want] of [["SHA1", sha1], ["SHA256", sha256], ["SHA512", sha512]] as const) {
        const totp: Totp = { secret: ascii(seeds[algorithm]), digits: 8, period: 30, algorithm };
        expect(await totpCode(totp, t * 1000)).toBe(want);
      }
    }
  });

  it("makes RFC 4226's HOTP values, six digits", async () => {
    const key = new TextEncoder().encode(seeds.SHA1);
    const want = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    for (let i = 0; i < want.length; i++) expect(await hotp(key, i)).toBe(want[i]);
  });

  it("reads setup keys and otpauth addresses, and refuses what isn't one", () => {
    expect(parseTotp("jbsw y3dp ehpk 3pxp")).toEqual({ totp: { secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 30, algorithm: "SHA1" } });
    expect(parseTotp("otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example&digits=8&period=60&algorithm=SHA256")).toEqual({ totp: { secret: "JBSWY3DPEHPK3PXP", digits: 8, period: 60, algorithm: "SHA256" } });
    expect(parseTotp("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1")).toMatchObject({ error: expect.stringContaining("time-based") });
    expect(parseTotp("not-a-key!")).toMatchObject({ error: expect.stringContaining("setup key") });
    expect(parseTotp("JBSWY3DP")).toMatchObject({ error: expect.stringContaining("too short") });
    expect(parseTotp("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=4")).toMatchObject({ error: expect.stringContaining("6, 7 or 8") });
    expect(parseTotp("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5")).toMatchObject({ error: expect.stringContaining("SHA1") });
    expect(base32Decode("MZXW6===")).toEqual(new TextEncoder().encode("foo"));
    expect(base32Encode(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI");
    expect(readTotp(JSON.stringify({ secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 30, algorithm: "SHA1" }))).toMatchObject({ secret: "JBSWY3DPEHPK3PXP" });
    expect(readTotp("{}")).toBe(null);
    expect(totpSecondsLeft({ period: 30 }, 59_000)).toBe(1);
    expect(totpSecondsLeft({ period: 30 }, 60_000)).toBe(30);
  });
});

describe("checking a login", () => {
  const good = { label: "Test site", origins: ["http://127.0.0.1:8765", "http://127.0.0.1:8765/", "https://accounts.example.com"], username: "alice", password: "Fx9-Vault!", totp: "JBSWY3DPEHPK3PXP", notes: "Recovery codes in the drawer" };

  it("names it from its label, normalizes origins, and hands back the secrets to seal", () => {
    const r = checkVaultItem(good, { taken: ["test-site"] });
    expect(r.diagnostics).toEqual([]);
    expect(r.item).toEqual({ name: "test-site-2", label: "Test site", origins: ["http://127.0.0.1:8765", "https://accounts.example.com"], username: "alice", notes: "Recovery codes in the drawer" });
    expect(r.password).toBe("Fx9-Vault!");
    expect(r.totp).toEqual({ secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 30, algorithm: "SHA1" });
  });

  it("says what to fix", () => {
    const msg = (input: object) => checkVaultItem(input).diagnostics.map((d) => d.message).join(" | ");
    expect(msg({ ...good, label: "" })).toContain("Give the login a label");
    expect(msg({ ...good, origins: [] })).toContain("Add the origin");
    expect(msg({ ...good, origins: ["https://accounts.example.com/login"] })).toContain("Write only the origin");
    expect(msg({ ...good, password: "" })).toContain("Type the password");
    expect(msg({ ...good, totp: "nope!" })).toContain("2-factor setup key");
    expect(msg({ ...good, name: "Bad Name" })).toContain("lowercase letters");
    expect(msg({ ...good, label: "x".repeat(81) })).toContain("the most is 80");
    expect(checkVaultItem({ ...good, password: "", keepPassword: true, totp: "", keepTotp: true }).diagnostics).toEqual([]);
  });

  it("reads the vault's contents back, leaving out items it can't use", () => {
    const item: VaultItem = { name: "test-site", label: "Test site", origins: ["http://127.0.0.1:8765"], username: "alice", password: "sealed:pw", totp: "", notes: "", createdAt: "2026-11-18T09:00:00.000Z", updatedAt: "2026-11-18T09:00:00.000Z", lastUsedAt: null };
    const json = serializeVault([item]);
    expect(parseVault(json)).toEqual({ items: [item], skipped: 0 });
    const bad = JSON.stringify({ items: [item, { ...item }, { ...item, name: "x2", origins: ["https://a.example/login"] }, { name: "NO" }] });
    expect(parseVault(bad)).toEqual({ items: [item], skipped: 3 });
    expect(parseVault("garbage")).toEqual({ items: [], skipped: 1 });
  });
});

describe("keeping secrets out of text", () => {
  it("blanks every secret, longest first, and leaves short ones alone", () => {
    expect(scrubSecrets("pw is Fx9-Vault! and code 123456 then Fx9-Vault!x", ["Fx9-Vault!", "Fx9-Vault!x", "123456", "ab"])).toBe(`pw is ${SCRUBBED} and code ${SCRUBBED} then ${SCRUBBED}`);
    expect(scrubSecrets("nothing here", [])).toBe("nothing here");
    expect(scrubSecrets("a b ab", ["ab"])).toBe("a b ab");
  });
});

describe("bot.md logins", () => {
  const md = (logins: string) => `---\nname: Research\njob: Reads\nbrain:\n  cli: claude\nconnectors: []\n${logins}askBefore: []\n---\n`;

  it("reads grants by name with allow or ask, short names asking", () => {
    const r = parseBot(md("logins:\n  - name: test-site\n    level: allow\n  - mail\n"));
    expect(r.diagnostics).toEqual([]);
    expect(r.bot!.logins).toEqual([
      { name: "test-site", level: "allow" },
      { name: "mail", level: "ask" },
    ]);
    const out = serializeBot(r.bot!);
    expect(out).toContain("logins:\n  - name: test-site\n    level: allow\n  - name: mail\n    level: ask\n");
    expect(parseBot(out).bot!.logins).toEqual(r.bot!.logins);
  });

  it("leaves logins out of a bot.md that has none", () => {
    const r = parseBot(md(""));
    expect(r.bot!.logins).toEqual([]);
    expect(serializeBot(r.bot!)).not.toContain("logins");
    expect(newBot({ name: "A", job: "B" }).bot.logins).toEqual([]);
  });

  it("says how to fix a grant that is wrong", () => {
    const msgs = (s: string) => parseBot(md(s)).diagnostics.map((d) => d.message);
    expect(msgs("logins:\n  - name: test-site\n    level: alow\n")[0]).toMatch(/level "alow" is not a level\. Did you mean "allow"\?/);
    expect(msgs("logins:\n  - name: Test Site\n")[0]).toMatch(/not a login name/);
    expect(msgs("logins:\n  - level: ask\n")[0]).toMatch(/has no name/);
    expect(msgs("logins: test-site\n")[0]).toMatch(/logins should be a list/);
    expect(msgs("logins:\n  - name: a\n    levle: ask\n")[0]).toMatch(/Unknown key in login "a" "levle".*Did you mean "level"/);
    expect(msgs("logins:\n  - a\n  - a\n")[0]).toMatch(/listed twice/);
    const many = Array.from({ length: 21 }, (_, i) => `  - l${i}\n`).join("");
    expect(msgs(`logins:\n${many}`)[0]).toMatch(/at most 20 logins/);
    const bot = newBot({ name: "A", job: "B" }).bot;
    expect(checkBot({ ...bot, logins: [{ name: "x", level: "never" as "ask" }] }).diagnostics[0]!.message).toMatch(/level "never"/);
  });
});
