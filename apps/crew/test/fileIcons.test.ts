import { describe, expect, it } from "vitest";
import { DESKTOP_APPS, DISK_ROOTS, FILE_KINDS } from "../src/shared/contract.ts";
import { FENNA_APPS } from "@opendeck/crew";
import { FILE_ICONS, FILE_ICON_NAMES, PX_CLASS, appIconFor, fileIconFor, rootIconFor } from "../src/renderer/fileIcons.ts";

const KEYS = new Set<string>([".", ...Object.keys(PX_CLASS)]);

describe("disk icons", () => {
  it("has exactly the named set, once each", () => {
    expect(Object.keys(FILE_ICONS).sort()).toEqual([...FILE_ICON_NAMES].sort());
    expect(new Set(FILE_ICON_NAMES).size).toBe(FILE_ICON_NAMES.length);
  });

  for (const name of FILE_ICON_NAMES) {
    describe(name, () => {
      const rows = FILE_ICONS[name];

      it("is a 16 by 16 grid", () => {
        expect(rows).toHaveLength(16);
        for (const row of rows) expect(row).toHaveLength(16);
      });

      it("uses only palette keys", () => {
        for (const row of rows) for (const ch of row) expect(KEYS.has(ch)).toBe(true);
      });

      it("is drawn, not blank", () => {
        expect(rows.join("")).toMatch(/[^.]/);
      });
    });
  }

  it("draws the palette classes only from the named colours", () => {
    expect(new Set(Object.values(PX_CLASS)).size).toBe(Object.keys(PX_CLASS).length);
    for (const cls of Object.values(PX_CLASS)) expect(cls).toMatch(/^fi-[a-z-]+$/);
  });

  it("gives every file kind an icon", () => {
    for (const kind of FILE_KINDS) expect(FILE_ICON_NAMES).toContain(fileIconFor(kind));
    expect(fileIconFor("folder")).toBe("folder");
    expect(fileIconFor("deck")).toBe("deck");
  });

  it("gives every top folder an icon", () => {
    for (const root of DISK_ROOTS) expect(FILE_ICON_NAMES).toContain(rootIconFor(root));
    expect(rootIconFor("Trash")).toBe("trash");
  });

  it("gives every desktop app and Fenna app an icon", () => {
    for (const app of DESKTOP_APPS) expect(FILE_ICON_NAMES).toContain(appIconFor(app));
    for (const app of FENNA_APPS) expect(FILE_ICON_NAMES).toContain(appIconFor(app.id));
    expect(appIconFor("fenna-docs")).toBe("fenna-docs");
    expect(appIconFor("library")).toBe("documents");
  });

  it("draws the folder and the open folder differently", () => {
    expect(FILE_ICONS.folder.join("")).not.toBe(FILE_ICONS["folder-open"].join(""));
  });
});
