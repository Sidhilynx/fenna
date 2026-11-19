// The wallpaper modal for a bot's desktop: each preset as its real picture,
// plus the person's own image. The custom image lives in localStorage under
// fenna:wallpaper:<slug>; the hook below is the one place that reads it.

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { toast } from "@opendeck/shell";
import { WALLPAPERS } from "@opendeck/crew";
import type { BotSummary, Wallpaper } from "../shared/contract.ts";
import { errorText, invoke } from "../shared/api.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import { wallpaperUrl } from "./wallpapers.ts";

const COLUMNS = 3;

const storageKey = (slug: string) => `fenna:wallpaper:${slug}`;

function readCustom(slug: string): string {
  try {
    return localStorage.getItem(storageKey(slug)) || "";
  } catch {
    return "";
  }
}

// The custom image for a bot: "" when none is set. setCustom and clear return
// false when the browser would not store the change.
export function useCustomWallpaper(slug: string) {
  const [entry, setEntry] = useState(() => ({ slug, value: readCustom(slug) }));
  const customBg = entry.slug === slug ? entry.value : readCustom(slug);

  const setCustom = (dataUrl: string): boolean => {
    try {
      localStorage.setItem(storageKey(slug), dataUrl);
    } catch {
      return false;
    }
    setEntry({ slug, value: dataUrl });
    window.dispatchEvent(new Event("storage"));
    return true;
  };

  const clear = (): boolean => {
    try {
      localStorage.removeItem(storageKey(slug));
    } catch {
      return false;
    }
    setEntry({ slug, value: "" });
    window.dispatchEvent(new Event("storage"));
    return true;
  };

  return { customBg, setCustom, clear };
}

const label = (w: Wallpaper) => w.charAt(0).toUpperCase() + w.slice(1);

type Item = { key: string; label: string; src: string; wallpaper: Wallpaper | null };

export function WallpaperPicker({ bot, onClose }: { bot: BotSummary; onClose(): void }) {
  const { customBg, setCustom, clear } = useCustomWallpaper(bot.slug);
  const gridRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const items: Item[] = [
    ...(customBg ? [{ key: "custom", label: "Your image", src: customBg, wallpaper: null }] : []),
    ...WALLPAPERS.map((w) => ({ key: w, label: label(w), src: wallpaperUrl(w), wallpaper: w })),
  ];
  const currentKey = customBg ? "custom" : bot.wallpaper;
  const currentIndex = Math.max(0, items.findIndex((i) => i.key === currentKey));

  const focusItem = (index: number) => {
    const buttons = gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-index]");
    buttons?.[index]?.focus();
  };

  // Focus the current wallpaper on open, and again when a removed image
  // takes its focused button with it.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) focusItem(currentIndex);
  }, [customBg]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const choose = (item: Item) => {
    if (!item.wallpaper) {
      onClose();
      return;
    }
    if (!clear()) toast("Could not remove the image.");
    invoke("crew:update", bot.slug, { wallpaper: item.wallpaper }).catch((e) => toast(errorText(e)));
    onClose();
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = Number((e.target as HTMLElement).dataset.index);
    if (Number.isNaN(index)) return;
    const last = items.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(last, index + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (e.key === "ArrowDown") next = Math.min(last, index + COLUMNS);
    else if (e.key === "ArrowUp") next = Math.max(0, index - COLUMNS);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    focusItem(next);
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      if (setCustom(reader.result)) {
        toast("Wallpaper set.");
        onClose();
      } else {
        toast("Image too large. Choose a smaller one.");
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="desk-modal-scrim" onClick={onClose}>
      <div className="desk-modal-card wall-picker" role="dialog" aria-modal="true" aria-label="Wallpaper" onClick={(e) => e.stopPropagation()}>
        <div className="desk-modal-head">
          <span className="desk-modal-title">Wallpaper</span>
          <button type="button" className="icon-btn win-btn" aria-label="Close" onClick={onClose}>
            <PixelIcon name="close" size={12} />
          </button>
        </div>
        <div className="wall-grid" ref={gridRef} role="group" aria-label="Wallpapers" onKeyDown={onGridKey}>
          {items.map((item, index) => {
            const current = item.key === currentKey;
            return (
              <button
                key={item.key}
                type="button"
                data-index={index}
                className={`wall-item${current ? " current" : ""}`}
                aria-label={item.label}
                aria-current={current ? "true" : undefined}
                tabIndex={index === currentIndex ? 0 : -1}
                onClick={() => choose(item)}
              >
                <span className="wall-thumb">
                  <img className="wall-img" src={item.src} alt="" draggable={false} />
                </span>
                <span className="wall-name">
                  {item.label}
                  {current && <PixelIcon name="check" size={12} />}
                </span>
              </button>
            );
          })}
        </div>
        <div className="desk-modal-actions">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
          {customBg && (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                if (!clear()) toast("Could not remove the image.");
              }}
            >
              Remove image
            </button>
          )}
          <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>
            Choose image
          </button>
        </div>
      </div>
    </div>
  );
}
