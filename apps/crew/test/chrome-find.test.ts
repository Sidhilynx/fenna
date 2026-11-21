import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { findChrome } = require("../src/main/chrome-find.cjs");

const WIN_FILES = [
  ["C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"],
  ["C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"],
  ["C:\\Users\\me\\AppData\\Local", "Google", "Chrome", "Application", "chrome.exe"],
].map((parts) => path.win32.join(...parts));

const MAC_SYSTEM = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MAC_USER = "/Users/me/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LINUX_FILES = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"];

/** A fake filesystem: only these paths exist. */
function present(...files: string[]) {
  const set = new Set(files);
  return (file: string) => set.has(file);
}

const WIN_ENV = {
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
  LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
};

describe("findChrome on Windows", () => {
  it("finds Chrome under Program Files first", () => {
    expect(findChrome({ platform: "win32", env: WIN_ENV, exists: present(...WIN_FILES) })).toBe(WIN_FILES[0]);
  });

  it("falls through to Program Files (x86), then to the user's install", () => {
    expect(findChrome({ platform: "win32", env: WIN_ENV, exists: present(WIN_FILES[1], WIN_FILES[2]) })).toBe(WIN_FILES[1]);
    expect(findChrome({ platform: "win32", env: WIN_ENV, exists: present(WIN_FILES[2]) })).toBe(WIN_FILES[2]);
  });

  it("skips variables that are not set", () => {
    const env = { ProgramFiles: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" };
    expect(findChrome({ platform: "win32", env, exists: present(WIN_FILES[2]) })).toBe(WIN_FILES[2]);
    expect(findChrome({ platform: "win32", env: { ProgramFiles: "C:\\Program Files" }, exists: present(WIN_FILES[1]) })).toBeNull();
  });

  it("builds Windows paths with backslashes even when run on another OS", () => {
    const found = findChrome({ platform: "win32", env: WIN_ENV, exists: present(WIN_FILES[0]) });
    expect(found).toContain("\\");
    expect(found).toBe("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
  });
});

describe("findChrome on macOS", () => {
  it("finds Chrome in /Applications, then in the user's Applications folder", () => {
    const env = { HOME: "/Users/me" };
    expect(findChrome({ platform: "darwin", env, exists: present(MAC_SYSTEM, MAC_USER) })).toBe(MAC_SYSTEM);
    expect(findChrome({ platform: "darwin", env, exists: present(MAC_USER) })).toBe(MAC_USER);
  });

  it("skips the user's folder when HOME is not set", () => {
    expect(findChrome({ platform: "darwin", env: {}, exists: present(MAC_USER) })).toBeNull();
    expect(findChrome({ platform: "darwin", env: {}, exists: present(MAC_SYSTEM) })).toBe(MAC_SYSTEM);
  });
});

describe("findChrome on Linux", () => {
  it("tries each Chrome name in order", () => {
    expect(findChrome({ platform: "linux", env: {}, exists: present(...LINUX_FILES) })).toBe(LINUX_FILES[0]);
    expect(findChrome({ platform: "linux", env: {}, exists: present(LINUX_FILES[1], LINUX_FILES[2]) })).toBe(LINUX_FILES[1]);
    expect(findChrome({ platform: "linux", env: {}, exists: present(LINUX_FILES[2]) })).toBe(LINUX_FILES[2]);
  });
});

describe("findChrome overrides and misses", () => {
  it("uses OPENDECK_CHROME over every platform path when it exists", () => {
    const env = { ...WIN_ENV, OPENDECK_CHROME: "D:\\test\\chrome.exe" };
    expect(findChrome({ platform: "win32", env, exists: present("D:\\test\\chrome.exe", WIN_FILES[0]) })).toBe("D:\\test\\chrome.exe");
  });

  it("falls back to the platform search when OPENDECK_CHROME is set but missing", () => {
    const env = { ...WIN_ENV, OPENDECK_CHROME: "D:\\missing\\chrome.exe" };
    expect(findChrome({ platform: "win32", env, exists: present(WIN_FILES[0]) })).toBe(WIN_FILES[0]);
  });

  it("returns null when nothing exists", () => {
    expect(findChrome({ platform: "linux", env: {}, exists: present() })).toBeNull();
    expect(findChrome({ platform: "win32", env: WIN_ENV, exists: present() })).toBeNull();
  });

  it("finds nothing on an unknown platform unless the override exists", () => {
    expect(findChrome({ platform: "freebsd", env: {}, exists: present(...LINUX_FILES) })).toBeNull();
    expect(findChrome({ platform: "freebsd", env: { OPENDECK_CHROME: "/opt/chrome" }, exists: present("/opt/chrome") })).toBe("/opt/chrome");
  });

  it("never picks Chromium or Edge", () => {
    const others = ["C:\\Program Files\\Chromium\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "/usr/bin/chromium"];
    expect(findChrome({ platform: "win32", env: WIN_ENV, exists: present(...others) })).toBeNull();
    expect(findChrome({ platform: "linux", env: {}, exists: present(...others) })).toBeNull();
  });
});
