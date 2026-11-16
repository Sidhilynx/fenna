import { useEffect, useState } from "react";
import { bridge } from "../bridge.ts";
import { Icon } from "./icons.tsx";

export type ThemeMode = "dark" | "light" | "system";

export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    bridge()
      ?.invoke<{ mode: ThemeMode; dark: boolean }>("shell:theme")
      .then((res) => {
        if (res?.mode) setMode(res.mode);
        if (typeof res?.dark === "boolean") {
          document.documentElement.dataset.theme = res.dark ? "dark" : "light";
        }
      })
      .catch(() => {});

    const off = bridge()?.on<{ mode: "dark" | "light" }>("shell:themeChanged", ({ mode: changedMode }) => {
      document.documentElement.dataset.theme = changedMode;
    });
    return () => off?.();
  }, []);

  const cycle = async () => {
    const next: ThemeMode = mode === "dark" ? "light" : mode === "light" ? "system" : "dark";
    try {
      const res = await bridge().invoke<{ mode: ThemeMode; dark: boolean }>("shell:theme", next);
      if (res?.mode) setMode(res.mode);
      if (typeof res?.dark === "boolean") {
        document.documentElement.dataset.theme = res.dark ? "dark" : "light";
      }
    } catch {
      const cur = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = cur;
    }
  };

  const iconName = mode === "dark" ? "moon" : mode === "light" ? "sun" : "viewport";
  const label = mode.charAt(0).toUpperCase() + mode.slice(1);

  return (
    <button
      className={className ?? "icon-btn"}
      onClick={() => void cycle()}
      title={`Theme: ${label} (click to switch)`}
      aria-label={`Toggle theme: current ${label}`}
    >
      <Icon name={iconName} size={16} />
    </button>
  );
}
