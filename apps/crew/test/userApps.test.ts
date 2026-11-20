import { describe, expect, it } from "vitest";
import { layoutDesktop } from "../src/renderer/Desktop.tsx";
import { CHANGED_MS, appBadge, grantLine, permissionLines, syncAppIcons, userAppIcon, userAppId, waitsForYou } from "../src/renderer/userApps.ts";
import type { AppGrant, AppToolDef, DesktopShortcut } from "../src/shared/contract.ts";

const NONE: AppGrant = { documents: "none", network: [], bot: false };
const tool = (name: string): AppToolDef => ({ name, description: "", input: { type: "object" } });
const NOW = Date.parse("2026-11-20T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("permissionLines", () => {
  it("says what the app asks for, one plain line each, in install-card order", () => {
    const asks: AppGrant = { documents: "write", network: ["https://api.example.com", "http://localhost:8080"], bot: true };
    expect(permissionLines(asks, "Research", [tool("add_note"), tool("list_notes")])).toEqual([
      "Change your documents",
      "Connect to api.example.com",
      "Connect to localhost:8080",
      "Send Research messages",
      "Gives Research these tools: add_note, list_notes",
    ]);
  });

  it("reads documents as read, and says nothing for an app that asks for nothing", () => {
    expect(permissionLines({ ...NONE, documents: "read" }, "Bot", [])).toEqual(["Read your documents"]);
    expect(permissionLines(NONE, "Bot", [])).toEqual([]);
  });

  it("keeps an origin it cannot parse as typed", () => {
    expect(permissionLines({ ...NONE, network: ["not a url"] }, "Bot", [])).toEqual(["Connect to not a url"]);
  });
});

describe("grantLine", () => {
  it("is 'Nothing allowed yet' without a grant", () => {
    expect(grantLine(null, "Bot")).toBe("Nothing allowed yet");
  });

  it("says what the grant allows in one line, or that it allows nothing beyond the app's folder", () => {
    expect(grantLine({ documents: "read", network: ["https://a.test"], bot: true }, "Bot")).toBe("Read your documents, Connect to a.test, Send Bot messages");
    expect(grantLine(NONE, "Bot")).toBe("Nothing outside its own folder");
  });
});

describe("appBadge and waitsForYou", () => {
  it("an app waits for the person with no grant, or when its manifest asks for more", () => {
    expect(waitsForYou({ grant: null, pending: false })).toBe(true);
    expect(waitsForYou({ grant: NONE, pending: true })).toBe(true);
    expect(waitsForYou({ grant: NONE, pending: false })).toBe(false);
  });

  it("shows 'needs' while the app waits, even if it also changed lately", () => {
    expect(appBadge({ grant: null, pending: false, updatedAt: ago(1000) }, NOW)).toBe("needs");
    expect(appBadge({ grant: NONE, pending: true, updatedAt: ago(1000) }, NOW)).toBe("needs");
  });

  it("shows 'changed' for ten minutes after its files change, and nothing after", () => {
    expect(appBadge({ grant: NONE, pending: false, updatedAt: ago(CHANGED_MS - 1000) }, NOW)).toBe("changed");
    expect(appBadge({ grant: NONE, pending: false, updatedAt: ago(CHANGED_MS) }, NOW)).toBe(null);
  });

  it("shows nothing for an unreadable time", () => {
    expect(appBadge({ grant: NONE, pending: false, updatedAt: "" }, NOW)).toBe(null);
  });
});

describe("userAppIcon", () => {
  it("uses the icon the manifest names when Crew draws it, else the generic one", () => {
    expect(userAppIcon("sheet")).toBe("sheet");
    expect(userAppIcon("no-such-icon")).toBe("other");
    expect(userAppIcon("")).toBe("other");
  });
});

describe("syncAppIcons", () => {
  const app = (name: string, title = name) => ({ name, title });
  const files: DesktopShortcut = { id: "files", kind: "app", app: "files", label: "Files" };

  it("adds an icon for each app that has none, labelled with its title", () => {
    const next = syncAppIcons([files], [app("invoice-tracker", "Invoice tracker")]);
    expect(next).toEqual([files, { id: userAppId("invoice-tracker"), kind: "userapp", app: "invoice-tracker", label: "Invoice tracker" }]);
  });

  it("returns the same list when every app already has its icon", () => {
    const items: DesktopShortcut[] = [files, { id: userAppId("notes"), kind: "userapp", app: "notes", label: "Notes" }];
    expect(syncAppIcons(items, [app("notes", "Notes")])).toBe(items);
  });

  it("removes the icon of an app that is gone and keeps the rest in order", () => {
    const items: DesktopShortcut[] = [files, { id: userAppId("gone"), kind: "userapp", app: "gone", label: "Gone" }, { id: userAppId("notes"), kind: "userapp", app: "notes", label: "Notes" }];
    expect(syncAppIcons(items, [app("notes", "Notes")])).toEqual([files, items[2]]);
  });

  it("keeps a label the person gave the icon", () => {
    const items: DesktopShortcut[] = [{ id: userAppId("notes"), kind: "userapp", app: "notes", label: "My notes" }];
    expect(syncAppIcons(items, [app("notes", "Notes")])).toBe(items);
  });

  it("cuts a long title to the label limit and falls back to the name when the title is blank", () => {
    const next = syncAppIcons([], [app("a", "x".repeat(60)), app("b", "   ")]);
    expect(next[0]).toMatchObject({ label: "x".repeat(40) });
    expect(next[1]).toMatchObject({ label: "b" });
  });

  it("places a new app's icon in the next free slot on the desktop", () => {
    const cells = (items: DesktopShortcut[]) => Object.fromEntries([...layoutDesktop(items, 3, 2)].map(([id, c]) => [id, [c.col, c.row]]));
    const items: DesktopShortcut[] = [
      { id: "browser", kind: "app", app: "browser", label: "Browser" },
      { id: "files", kind: "app", app: "files", label: "Files", pos: { col: 0, row: 1 } },
    ];
    const next = syncAppIcons(items, [app("notes", "Notes")]);
    expect(cells(next)).toEqual({ browser: [0, 0], files: [0, 1], [userAppId("notes")]: [1, 0] });
  });
});
