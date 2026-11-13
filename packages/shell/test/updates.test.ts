import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

type Asset = { name: string; browser_download_url: string };
type Where = { product: string; platform: string; arch: string };
const { _test } = require("../main/updates.cjs") as {
  _test: {
    isNewer(current: string, tag: string): boolean;
    pickAsset(assets: unknown, where: Where): string | null;
    updateFrom(release: unknown, ctx: Where & { current: string; repo: string }): { version: string; url: string } | null;
  };
};

const REPO = "Sidhilynx/fenna";
const dl = (name: string): Asset => ({ name, browser_download_url: `https://github.com/${REPO}/releases/download/v0.9.1/${name}` });
const ASSETS = [
  dl("Fenna-Slides-0.9.1-setup.exe"),
  dl("Fenna-Slides-0.9.1-arm64.dmg"),
  dl("Fenna-Slides-0.9.1-x64.dmg"),
  dl("Fenna-Slides-0.9.1-x86_64.AppImage"),
  dl("Fenna-Slides-0.9.1-amd64.deb"),
  dl("Fenna-Docs-0.9.1-setup.exe"),
];

describe("update check", () => {
  it("compares plain versions, with or without a leading v", () => {
    expect(_test.isNewer("0.9.0", "v0.9.1")).toBe(true);
    expect(_test.isNewer("0.9.0", "v0.10.0")).toBe(true);
    expect(_test.isNewer("0.9.0", "1.0.0")).toBe(true);
    expect(_test.isNewer("0.9.1", "v0.9.1")).toBe(false);
    expect(_test.isNewer("1.0.0", "v0.9.9")).toBe(false);
  });

  it("never offers a pre-release or a tag it can't read", () => {
    expect(_test.isNewer("0.9.0", "v1.0.0-beta.1")).toBe(false);
    expect(_test.isNewer("0.9.0", "latest")).toBe(false);
    expect(_test.isNewer("dev", "v1.0.0")).toBe(false);
  });

  it("picks this app's installer for this computer", () => {
    const pick = (platform: string, arch: string) => _test.pickAsset(ASSETS, { product: "Fenna Slides", platform, arch });
    expect(pick("win32", "x64")).toMatch(/Fenna-Slides-0\.9\.1-setup\.exe$/);
    expect(pick("darwin", "arm64")).toMatch(/Fenna-Slides-0\.9\.1-arm64\.dmg$/);
    expect(pick("darwin", "x64")).toMatch(/Fenna-Slides-0\.9\.1-x64\.dmg$/);
    expect(pick("linux", "x64")).toMatch(/Fenna-Slides-0\.9\.1-x86_64\.AppImage$/);
    expect(_test.pickAsset(ASSETS, { product: "Fenna Sheets", platform: "win32", arch: "x64" })).toBeNull();
    expect(_test.pickAsset(null, { product: "Fenna Slides", platform: "win32", arch: "x64" })).toBeNull();
  });

  it("offers the release page when there's no installer for this computer, and nothing when up to date", () => {
    const ctx = { current: "0.9.0", product: "Fenna Whiteboard", platform: "win32", arch: "x64", repo: REPO };
    expect(_test.updateFrom({ tag_name: "v0.9.1", assets: ASSETS }, ctx)).toEqual({ version: "0.9.1", url: `https://github.com/${REPO}/releases/tag/v0.9.1` });
    expect(_test.updateFrom({ tag_name: "v0.9.0", assets: ASSETS }, ctx)).toBeNull();
    expect(_test.updateFrom({ tag_name: "v0.9.1", draft: true, assets: ASSETS }, ctx)).toBeNull();
    expect(_test.updateFrom(null, ctx)).toBeNull();
  });
});
