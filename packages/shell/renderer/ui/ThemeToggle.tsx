import { useEffect, useState } from "react";
import { bridge } from "../bridge.ts";
import { Icon } from "./icons.tsx";

export type ThemeMode = "dark" | "light" | "system";

/** Light or dark, one click. It starts from the system's choice; after a click the app keeps the person's. */
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme !== "light");

  useEffect(() => {
    bridge()
      ?.invoke<{ mode: ThemeMode; dark: boolean }>("shell:theme")
      .then((res) => {
        if (typeof res?.dark === "boolean") {
          document.documentElement.dataset.theme = res.dark ? "dark" : "light";
          setDark(res.dark);
        }
      })
      .catch(() => {});

    const off = bridge()?.on<{ mode: "dark" | "light" }>("shell:themeChanged", ({ mode: changedMode }) => {
      document.documentElement.dataset.theme = changedMode;
      setDark(changedMode === "dark");
    });
    return () => off?.();
  }, []);

  const toggle = async () => {
    const next: ThemeMode = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setDark(next === "dark");
    try {
      const res = await bridge().invoke<{ mode: ThemeMode; dark: boolean }>("shell:theme", next);
      if (typeof res?.dark === "boolean") {
        document.documentElement.dataset.theme = res.dark ? "dark" : "light";
        setDark(res.dark);
      }
    } catch {
      /* the page already switched; the shell keeps its own choice */
    }
  };

  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button className={className ?? "icon-btn"} onClick={() => void toggle()} title={label} aria-label={label}>
      <Icon name={dark ? "sun" : "moon"} size={16} />
    </button>
  );
}
