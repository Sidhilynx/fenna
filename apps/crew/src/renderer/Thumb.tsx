// A bot's screen as a small picture: its latest thumbnail inside its own
// wallpaper, with the taskbar strip under it. A bot without a picture yet shows
// its bare desktop (its wallpaper), with no words over it.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { BotSummary } from "../shared/contract.ts";
import { Avatar } from "./Avatar.tsx";
import { useScreen, useWatch } from "./screens.ts";
import { wallpaperUrl } from "./wallpapers.ts";
import { PixelField } from "./PixelField.tsx";

export function useVisible(ref: React.RefObject<Element | null>): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setOn(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setOn(entries.some((e) => e.isIntersecting)), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}

export const wallStyle = (bot: Pick<BotSummary, "wallpaper">): CSSProperties => ({ "--wall": `var(--wall-${bot.wallpaper})`, "--wall-img": `url(${wallpaperUrl(bot.wallpaper)})` }) as CSSProperties;

export function Thumb({ bot, label, onOpen, children }: { bot: BotSummary; label: string; onOpen(): void; children?: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const visible = useVisible(ref);
  useWatch(bot.slug, "thumb", visible);
  const { thumb } = useScreen(bot.slug);
  return (
    <button ref={ref} type="button" className="thumb" style={wallStyle(bot)} aria-label={label} onClick={onOpen}>
      <PixelField className="flat" color="--desk-ink" density={5} alpha={0.45} cell={2} glitch={0.1} />
      {thumb && (
        <span className="thumb-win">
          <img src={thumb} alt="" draggable={false} />
        </span>
      )}
      <span className="thumb-bar">
        <Avatar avatar={bot.avatar} color={bot.color} mood={bot.mood} size={16} />
        <i className={bot.browser ? "on" : ""} />
        <i />
        <i />
      </span>
      {children}
    </button>
  );
}
