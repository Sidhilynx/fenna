import { describe, expect, it } from "vitest";
import { normalizeHex, parseBorder, parsePx, resolveColorHex, themeColorName } from "./utils.tsx";

describe("Inspector helpers", () => {
  describe("parsePx", () => {
    it("parses valid pixel values", () => {
      expect(parsePx("24px")).toBe(24);
      expect(parsePx("0px")).toBe(0);
      expect(parsePx("-12px")).toBe(-12);
      expect(parsePx("100.5px")).toBe(100.5);
    });

    it("returns null for non-px or empty values", () => {
      expect(parsePx("auto")).toBeNull();
      expect(parsePx("")).toBeNull();
      expect(parsePx(undefined)).toBeNull();
      expect(parsePx("50%")).toBeNull();
    });
  });

  describe("parseBorder", () => {
    it("handles unset, none, and zero", () => {
      expect(parseBorder(undefined)).toEqual({ style: "none", width: 1, color: "var(--line)" });
      expect(parseBorder("none")).toEqual({ style: "none", width: 1, color: "var(--line)" });
      expect(parseBorder("0")).toEqual({ style: "none", width: 1, color: "var(--line)" });
    });

    it("parses valid border declarations in any order", () => {
      expect(parseBorder("1px solid var(--line)")).toEqual({
        style: "solid",
        width: 1,
        color: "var(--line)",
      });
      expect(parseBorder("dashed 3px #ff0000")).toEqual({
        style: "dashed",
        width: 3,
        color: "#ff0000",
      });
      expect(parseBorder("var(--accent) dotted 2px")).toEqual({
        style: "dotted",
        width: 2,
        color: "var(--accent)",
      });
    });
  });

  describe("ColorControl helpers", () => {
    it("extracts theme color names from var(--name)", () => {
      expect(themeColorName("var(--accent)")).toBe("accent");
      expect(themeColorName("var(--paper)")).toBe("paper");
      expect(themeColorName("var(--card-bg)")).toBe("card-bg");
      expect(themeColorName("#ffffff")).toBeNull();
      expect(themeColorName("rgba(0,0,0,0.5)")).toBeNull();
      expect(themeColorName(null)).toBeNull();
    });

    it("normalizes hex strings", () => {
      expect(normalizeHex("#fff")).toBe("#fff");
      expect(normalizeHex("fff")).toBe("#fff");
      expect(normalizeHex("FF6B35")).toBe("#ff6b35");
      expect(normalizeHex("#123456")).toBe("#123456");
      expect(normalizeHex("not-a-hex")).toBeNull();
    });

    it("resolves color hex against theme colors dictionary", () => {
      const themeColors = { accent: "#ff6b35", paper: "#f7f7f5" };
      expect(resolveColorHex("var(--accent)", themeColors)).toBe("#ff6b35");
      expect(resolveColorHex("var(--paper)", themeColors)).toBe("#f7f7f5");
      expect(resolveColorHex("#112233", themeColors)).toBe("#112233");
      expect(resolveColorHex("", themeColors)).toBe("");
    });
  });
});
