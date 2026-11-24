// The font families the slides app ships itself: fonts.css here, and Inter
// from the shell. A deck whose theme names one of these loads it from the
// app, so it looks the same offline; only the other Google families are
// fetched from Google Fonts.

import type { Theme } from "@opendeck/format";

const BUNDLED = new Set(["inter", "instrument serif", "space grotesk"]);

/** The theme without the families the app ships, for the Google Fonts link. */
export function withoutBundledFonts(theme: Theme): Theme {
  return { ...theme, fonts: theme.fonts.filter((f) => !BUNDLED.has(f.family.toLowerCase())) };
}
