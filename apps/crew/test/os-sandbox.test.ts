import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const os = require("../src/main/os-sandbox.cjs");
const { wrap, detect, defaultReadDeny, seatbeltProfile, bwrapArgs } = os;
const explain: (sandbox: string, platform: string) => string = os.describe;

const BWRAP = { bwrap: true, sandboxExec: false };
const SEATBELT = { bwrap: false, sandboxExec: true };
const NONE = { bwrap: false, sandboxExec: false };
const TRICKY = ['say "hi"', "two words", "it's", "back\\slash", ""];

let base: string;
let repo: string;
let home: string;

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), "os-sandbox-"));
  repo = path.join(base, "repo");
  home = path.join(base, "home");
  mkdirSync(repo, { recursive: true });
  mkdirSync(path.join(home, ".ssh"), { recursive: true });
  mkdirSync(path.join(home, ".config", "gcloud"), { recursive: true });
  writeFileSync(path.join(home, ".npmrc"), "token=x");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("wrap on Linux with bubblewrap", () => {
  it("builds the exact bwrap line for one writable folder", () => {
    const r = wrap({ platform: "linux", command: "claude", args: ["-p", "hi"], writable: [repo], available: BWRAP });
    expect(r).toEqual({
      command: "bwrap",
      args: ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--bind", repo, repo, "--die-with-parent", "--", "claude", "-p", "hi"],
      sandbox: "bubblewrap",
    });
  });

  it("binds every writable folder", () => {
    const other = path.join(base, "other");
    const r = wrap({ platform: "linux", command: "x", writable: [repo, other], available: BWRAP });
    expect(r.args).toEqual(expect.arrayContaining(["--bind", repo, repo, "--bind", other, other]));
  });

  it("hides each deny folder with a tmpfs, and skips deny paths that are files or missing", () => {
    const r = wrap({
      platform: "linux",
      command: "x",
      writable: [repo],
      readDeny: [path.join(home, ".ssh"), path.join(home, ".npmrc"), path.join(home, "missing")],
      available: BWRAP,
    });
    expect(r.args.slice(r.args.indexOf("--bind"))).toEqual([
      "--bind", repo, repo,
      "--tmpfs", path.join(home, ".ssh"),
      "--die-with-parent", "--", "x",
    ]);
  });

  it("does not cut the network", () => {
    const r = wrap({ platform: "linux", command: "x", writable: [repo], available: BWRAP });
    expect(r.args).not.toContain("--unshare-net");
  });

  it("passes the arguments after -- unchanged, even with spaces and quotes", () => {
    const r = wrap({ platform: "linux", command: "claude", args: TRICKY, writable: [repo], available: BWRAP });
    const dash = r.args.indexOf("--");
    expect(r.args.slice(dash + 1)).toEqual(["claude", ...TRICKY]);
  });

  it("falls back to no sandbox when bwrap is not installed", () => {
    const r = wrap({ platform: "linux", command: "claude", args: ["a b"], writable: [repo], available: NONE });
    expect(r).toEqual({ command: "claude", args: ["a b"], sandbox: "none" });
  });

  it("ignores bubblewrap on macOS even when it is reported", () => {
    const r = wrap({ platform: "darwin", command: "x", writable: [repo], available: BWRAP });
    expect(r.sandbox).toBe("none");
  });
});

describe("bwrapArgs", () => {
  it("places the deny tmpfs after the writable binds and before the command", () => {
    const args = bwrapArgs([repo], [path.join(home, ".ssh")], "c", []);
    const deny = args.indexOf(path.join(home, ".ssh"));
    expect(args[deny - 1]).toBe("--tmpfs");
    expect(deny).toBeGreaterThan(args.indexOf(repo));
    expect(args.slice(-2)).toEqual(["--", "c"]);
  });
});

describe("wrap on macOS with sandbox-exec", () => {
  it("builds the exact sandbox-exec line with the profile", () => {
    const r = wrap({
      platform: "darwin",
      command: "claude",
      args: ["-p"],
      writable: ["/Users/me/repo"],
      readDeny: ["/Users/me/.ssh"],
      available: SEATBELT,
    });
    expect(r.command).toBe("/usr/bin/sandbox-exec");
    expect(r.sandbox).toBe("seatbelt");
    expect(r.args).toEqual([
      "-p",
      '(version 1)(allow default)(deny file-write*)(allow file-write* (subpath "/Users/me/repo"))(allow file-write* (subpath "/private/tmp") (subpath "/private/var/folders") (literal "/dev/null") (literal "/dev/tty"))(deny file-read* (subpath "/Users/me/.ssh"))',
      "claude",
      "-p",
    ]);
  });

  it("allows several writable folders in one write rule, and omits the read rule when nothing is denied", () => {
    const profile = seatbeltProfile(["/a", "/b"], []);
    expect(profile).toContain('(allow file-write* (subpath "/a") (subpath "/b"))');
    expect(profile).not.toContain("file-read*");
  });

  it("escapes quotes and backslashes in paths", () => {
    const profile = seatbeltProfile(['/Users/me/my "repo"\\x'], ['/Users/me/"q"']);
    expect(profile).toContain('(subpath "/Users/me/my \\"repo\\"\\\\x")');
    expect(profile).toContain('(deny file-read* (subpath "/Users/me/\\"q\\""))');
  });

  it("passes the arguments after the profile unchanged, even with spaces and quotes", () => {
    const r = wrap({ platform: "darwin", command: "claude", args: TRICKY, writable: ["/Users/me/repo"], available: SEATBELT });
    expect(r.args.slice(2)).toEqual(["claude", ...TRICKY]);
  });

  it("falls back to no sandbox when sandbox-exec is missing", () => {
    const r = wrap({ platform: "darwin", command: "claude", args: ["x"], writable: ["/Users/me/repo"], available: NONE });
    expect(r).toEqual({ command: "claude", args: ["x"], sandbox: "none" });
  });
});

describe("wrap elsewhere", () => {
  it("returns the command and arguments unchanged on Windows", () => {
    const r = wrap({ platform: "win32", command: "claude.exe", args: ["a b"], writable: ["C:\\repo"], available: { bwrap: true, sandboxExec: true } });
    expect(r).toEqual({ command: "claude.exe", args: ["a b"], sandbox: "none" });
  });

  it("returns a copy of the arguments, not the same array", () => {
    const args = ["x"];
    const r = wrap({ platform: "freebsd", command: "c", args, writable: [repo] });
    expect(r.args).toEqual(["x"]);
    expect(r.args).not.toBe(args);
  });

  it("defaults the arguments to none", () => {
    expect(wrap({ platform: "win32", command: "c", writable: [repo] }).args).toEqual([]);
  });
});

describe("wrap validation", () => {
  it.each(["linux", "darwin", "win32"])("refuses an empty writable list on %s", (platform) => {
    expect(() => wrap({ platform, command: "c", writable: [], available: { bwrap: true, sandboxExec: true } })).toThrow(/at least one folder/);
  });

  it("refuses a missing writable list", () => {
    expect(() => wrap({ platform: "linux", command: "c", writable: undefined as any, available: BWRAP })).toThrow(/at least one folder/);
  });

  it("refuses a relative writable folder, and says which one", () => {
    expect(() => wrap({ platform: "linux", command: "c", writable: ["repo"], available: BWRAP })).toThrow(/"repo" isn't a full path/);
  });

  it("refuses a relative deny path", () => {
    expect(() => wrap({ platform: "darwin", command: "c", writable: ["/Users/me/repo"], readDeny: [".ssh"], available: SEATBELT })).toThrow(/".ssh" isn't a full path/);
  });

  it("refuses non-text paths", () => {
    expect(() => wrap({ platform: "linux", command: "c", writable: [42 as any], available: BWRAP })).toThrow(/isn't a full path/);
  });

  it("refuses bad paths even when no sandbox is used", () => {
    expect(() => wrap({ platform: "win32", command: "c", writable: ["relative"] })).toThrow(/full path/);
  });
});

describe("detect", () => {
  it("finds bubblewrap at /usr/bin on Linux", () => {
    const seen: string[] = [];
    const exists = (f: string) => {
      seen.push(f);
      return f === "/usr/bin/bwrap";
    };
    expect(detect("linux", exists)).toEqual({ bwrap: true, sandboxExec: false });
    expect(seen).toContain("/usr/bin/bwrap");
  });

  it("finds bubblewrap at /bin on Linux", () => {
    expect(detect("linux", (f: string) => f === "/bin/bwrap")).toEqual({ bwrap: true, sandboxExec: false });
  });

  it("reports no bubblewrap on Linux when neither file exists", () => {
    expect(detect("linux", () => false)).toEqual({ bwrap: false, sandboxExec: false });
  });

  it("finds sandbox-exec on macOS and ignores bubblewrap there", () => {
    const seen: string[] = [];
    const exists = (f: string) => {
      seen.push(f);
      return true;
    };
    expect(detect("darwin", exists)).toEqual({ bwrap: false, sandboxExec: true });
    expect(seen).toEqual(["/usr/bin/sandbox-exec"]);
  });

  it("reports no sandbox-exec on macOS when it is missing", () => {
    expect(detect("darwin", () => false)).toEqual({ bwrap: false, sandboxExec: false });
  });

  it("reports nothing on Windows, whatever exists", () => {
    expect(detect("win32", () => true)).toEqual({ bwrap: false, sandboxExec: false });
  });

  it("uses the real file system when no exists is given", () => {
    expect(detect("win32")).toEqual({ bwrap: false, sandboxExec: false });
  });
});

describe("defaultReadDeny", () => {
  it("lists the secret folders and files under home, joined for this system", () => {
    expect(defaultReadDeny("/home/me")).toEqual([
      path.join("/home/me", ".ssh"),
      path.join("/home/me", ".aws"),
      path.join("/home/me", ".azure"),
      path.join("/home/me", ".config/gcloud"),
      path.join("/home/me", ".gnupg"),
      path.join("/home/me", ".docker"),
      path.join("/home/me", ".kube"),
      path.join("/home/me", ".npmrc"),
      path.join("/home/me", ".pypirc"),
      path.join("/home/me", ".netrc"),
      path.join("/home/me", ".git-credentials"),
      path.join("/home/me", ".config/gh"),
    ]);
  });

  it("returns twelve entries, all under home", () => {
    const list = defaultReadDeny(home);
    expect(list).toHaveLength(12);
    for (const p of list) expect(p.startsWith(home + path.sep)).toBe(true);
  });
});

describe("describe", () => {
  it("says where commands run in a Linux sandbox", () => {
    expect(explain("bubblewrap", "linux")).toBe("Commands run in a Linux sandbox: they can change only the bot's repos.");
  });

  it("says where commands run in a macOS sandbox", () => {
    expect(explain("seatbelt", "darwin")).toBe("Commands run in a macOS sandbox: they can change only the bot's repos.");
  });

  it("says Windows has no sandbox yet", () => {
    expect(explain("none", "win32")).toBe("Windows has no Crew sandbox yet: Crew relies on each AI's own limits and your approvals.");
  });

  it("says no sandbox tool was found elsewhere", () => {
    expect(explain("none", "linux")).toBe("No sandbox tool was found (install bubblewrap): commands run as you.");
    expect(explain("none", "darwin")).toBe("No sandbox tool was found (install bubblewrap): commands run as you.");
  });
});
