import { describe, expect, it } from "vitest";
import type { Theme } from "@opendeck/format";
import { googleFontsUrl } from "@opendeck/render";
import { withoutBundledFonts } from "../src/renderer/fonts/bundled.ts";

const theme: Theme = {
  colors: {},
  fonts: [
    { family: "Instrument Serif", source: "google" },
    { family: "inter", source: "google", weights: [400, 600] },
    { family: "Space Grotesk", source: "google", weights: [500, 700] },
    { family: "Lora", source: "google", weights: [400] },
    { family: "Brand", source: "assets/brand.woff2" },
  ],
  textStyles: {},
};

describe("bundled slide fonts", () => {
  it("leaves only the families the app does not ship in the Google Fonts link", () => {
    const remote = withoutBundledFonts(theme);
    expect(remote.fonts.map((f) => f.family)).toEqual(["Lora", "Brand"]);
    expect(googleFontsUrl(remote)).toBe("https://fonts.googleapis.com/css2?family=Lora:wght@400&display=swap");
  });

  it("asks Google for nothing when every Google family is bundled", () => {
    const bundled: Theme = { ...theme, fonts: theme.fonts.slice(0, 3) };
    expect(googleFontsUrl(withoutBundledFonts(bundled))).toBeNull();
  });
});
