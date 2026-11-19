// Each wallpaper is a 320x180 pixel-art landscape, scaled up crisp by the desktop.

import type { Wallpaper } from "../shared/contract.ts";
import slate from "./assets/wallpapers/slate.png";
import teal from "./assets/wallpapers/teal.png";
import clay from "./assets/wallpapers/clay.png";
import indigo from "./assets/wallpapers/indigo.png";
import graphite from "./assets/wallpapers/graphite.png";
import moss from "./assets/wallpapers/moss.png";

const URLS: Record<Wallpaper, string> = { slate, teal, clay, indigo, graphite, moss };

export const wallpaperUrl = (w: Wallpaper): string => URLS[w];
