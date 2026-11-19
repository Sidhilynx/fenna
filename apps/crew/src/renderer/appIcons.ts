// The app icons of the built-in Fenna apps, 96 by 96 PNGs in assets/apps.
// The URLs are resolved by the bundler, so they work in the built app.
import type { FennaAppId } from "@opendeck/crew";

const ICONS: Record<FennaAppId, string> = {
  "fenna-docs": new URL("./assets/apps/docs.png", import.meta.url).href,
  "fenna-sheets": new URL("./assets/apps/sheets.png", import.meta.url).href,
  "fenna-slides": new URL("./assets/apps/slides.png", import.meta.url).href,
  "fenna-whiteboard": new URL("./assets/apps/whiteboard.png", import.meta.url).href,
  "fenna-design": new URL("./assets/apps/design.png", import.meta.url).href,
};

export function fennaAppIcon(id: FennaAppId): string {
  return ICONS[id];
}
