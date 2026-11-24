import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connectorNameProblem } from "@opendeck/crew";
import { CATEGORIES, CONNECTOR_CATALOG } from "../src/renderer/connectorCatalog.ts";
import { CONNECTOR_LOGOS } from "../src/renderer/connectorLogos.ts";

const logos = join(dirname(fileURLToPath(import.meta.url)), "../src/renderer/assets/connectors");
/** WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const lin = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
}
const MARKETING = /unleash|supercharge|seamless|powerful|effortless|magic|elevate|empower|robust|intuitive|comprehensive|recipes|launch|best-in-class|world-class/i;

describe("connector catalog", () => {
  it("has unique ids that are valid connector names", () => {
    const ids = CONNECTOR_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(connectorNameProblem(id), id).toBeNull();
  });

  it("uses https addresses and a docs page for each entry", () => {
    for (const e of CONNECTOR_CATALOG) {
      expect(e.docs.startsWith("https://"), e.id).toBe(true);
      if (e.kind === "url") {
        expect(e.url?.startsWith("https://"), e.id).toBe(true);
        expect(e.command, e.id).toBeUndefined();
      } else {
        expect(e.command, e.id).toBeTruthy();
        expect(e.url, e.id).toBeUndefined();
      }
    }
  });

  it("has a catalog entry and a logo file for each logo", () => {
    const ids = CONNECTOR_CATALOG.map((e) => e.id);
    for (const id of Object.keys(CONNECTOR_LOGOS)) {
      expect(ids, id).toContain(id);
      expect(existsSync(join(logos, `${id}.svg`)), id).toBe(true);
    }
  });

  it("shows a brand colour only where the logo has one, and hides a colour that would vanish on a theme", () => {
    for (const [id, logo] of Object.entries(CONNECTOR_LOGOS)) {
      if (!logo.color) {
        expect(logo.clash, id).toBeUndefined();
        continue;
      }
      expect(logo.color, id).toMatch(/^#[0-9A-F]{6}$/);
      const L = luminance(logo.color.slice(1));
      expect(logo.clash, id).toBe(L < 0.05 ? "dark" : L > 0.6 ? "light" : undefined);
    }
  });

  it("keeps each category together, in CATEGORIES order, after the featured entries", () => {
    const plain = CONNECTOR_CATALOG.filter((e) => !e.featured).map((e) => CATEGORIES.indexOf(e.category));
    expect(plain).toEqual([...plain].sort((a, b) => a - b));
  });

  it("has 37 entries, with Arsaze as the one featured entry, first", () => {
    expect(CONNECTOR_CATALOG).toHaveLength(37);
    expect(CONNECTOR_CATALOG[0]!.id).toBe("arsaze");
    expect(CONNECTOR_CATALOG.filter((e) => e.featured).map((e) => e.id)).toEqual(["arsaze"]);
  });

  it("lists featured entries before the rest", () => {
    const firstPlain = CONNECTOR_CATALOG.findIndex((e) => !e.featured);
    const lastFeatured = CONNECTOR_CATALOG.reduce((last, e, i) => (e.featured ? i : last), -1);
    expect(lastFeatured).toBeLessThan(firstPlain);
  });

  it("gives Arsaze a remote address with sign-in in the Design category", () => {
    const arsaze = CONNECTOR_CATALOG[0]!;
    expect(arsaze).toMatchObject({ name: "Arsaze", vendor: "Sidhilynx", kind: "url", url: "https://api.arsaze.com/mcp", auth: "oauth", category: "Design" });
  });

  it("names each required environment value as an upper-case variable", () => {
    for (const e of CONNECTOR_CATALOG) for (const v of e.env ?? []) expect(v.name, e.id).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  it("has a known category and a short plain description", () => {
    for (const e of CONNECTOR_CATALOG) {
      expect(CATEGORIES as readonly string[], e.id).toContain(e.category);
      expect(e.description.length, e.id).toBeLessThan(90);
      expect(e.description, e.id).not.toMatch(MARKETING);
      expect(e.description, e.id).not.toContain("!");
    }
  });
});
