// Theme hook tracking the system / shell appearance mode.

import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

const media = window.matchMedia("(prefers-color-scheme: dark)");

export function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "dark" || set === "light") return set;
  return media.matches ? "dark" : "light";
}

function subscribe(fn: () => void) {
  media.addEventListener("change", fn);
  const obs = new MutationObserver(fn);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    media.removeEventListener("change", fn);
    obs.disconnect();
  };
}

export const useTheme = (): Theme => useSyncExternalStore(subscribe, currentTheme);

