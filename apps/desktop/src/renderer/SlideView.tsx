import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ElementNode, Theme } from "@opendeck/format";
import { BASE_CSS, fontFaceCss, googleFontsUrl, slideMarkup } from "@opendeck/render";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@opendeck/format";
import { assetBase } from "./api.ts";

interface Props {
  slide: ElementNode;
  theme: Theme;
  /** Rendered width in CSS px; height follows 16:9. */
  width: number;
  annotate?: boolean;
}

/** One slide drawn at any size: the 1920×1080 page, scaled. */
export const SlideView = memo(function SlideView({ slide, theme, width, annotate }: Props) {
  const scale = width / SLIDE_WIDTH;
  const html = useMemo(() => slideMarkup(slide, theme, { assetBase: assetBase(), annotate }), [slide, theme, annotate]);
  return (
    <div className="slide-frame" style={{ width, height: SLIDE_HEIGHT * scale }}>
      <div
        className="slide-scale"
        style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT, transform: `scale(${scale})` }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});

/** A slide that fills its container's width (previews in grids and dialogs). */
export function FitSlide({ slide, theme }: { slide: ElementNode; theme: Theme }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="fit-slide">
      {width > 0 && <SlideView slide={slide} theme={theme} width={width} />}
    </div>
  );
}

/** Loads the deck's fonts and the slide base stylesheet into the page, once per theme. */
export function useSlideStyles(theme: Theme | null) {
  useEffect(() => {
    if (!theme) return;
    let base = document.getElementById("od-base") as HTMLStyleElement | null;
    if (!base) {
      base = document.createElement("style");
      base.id = "od-base";
      document.head.appendChild(base);
    }
    base.textContent = BASE_CSS + "\n" + fontFaceCss(theme, assetBase());
    const url = googleFontsUrl(theme);
    let link = document.getElementById("od-fonts") as HTMLLinkElement | null;
    if (url) {
      if (!link) {
        link = document.createElement("link");
        link.id = "od-fonts";
        link.rel = "stylesheet";
        document.head.appendChild(link);
      }
      if (link.href !== url) link.href = url;
    } else link?.remove();
  }, [theme]);
}
