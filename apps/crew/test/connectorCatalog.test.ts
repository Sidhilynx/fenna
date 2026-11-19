import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connectorNameProblem } from "@opendeck/crew";
import { CATEGORIES, CONNECTOR_CATALOG } from "../src/renderer/connectorCatalog.ts";

const logos = join(dirname(fileURLToPath(import.meta.url)), "../src/renderer/assets/connectors");
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

  it("has a logo file exactly when it says so", () => {
    for (const e of CONNECTOR_CATALOG) expect(existsSync(join(logos, `${e.id}.svg`)), e.id).toBe(e.logo);
  });

  it("has 25 entries, with Arsaze as the one featured entry, first", () => {
    expect(CONNECTOR_CATALOG).toHaveLength(25);
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
    expect(arsaze).toMatchObject({ name: "Arsaze", vendor: "Sidhilynx", kind: "url", url: "https://api.arsaze.com/mcp", auth: "oauth", category: "Design", logo: true });
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
