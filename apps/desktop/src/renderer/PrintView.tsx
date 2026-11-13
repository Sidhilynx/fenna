// What a hidden print window shows: every slide in the show (or one, for a
// PNG) at full 1920×1080 size, one per page. Tells the main process when
// fonts and images are in, so the PDF/PNG is never missing either.

import { useEffect } from "react";
import { SLIDE_WIDTH } from "@opendeck/format";
import { api } from "./api.ts";
import { boot, useEditor } from "./editor/store.ts";
import { SlideView, useSlideStyles } from "./SlideView.tsx";

export function PrintView() {
  const deck = useEditor((s) => s.deck);
  useSlideStyles(deck?.index.theme ?? null);
  const only = /only=(\d+)/.exec(location.hash)?.[1];
  const slides = deck ? (only !== undefined ? deck.slides.slice(Number(only), Number(only) + 1) : deck.slides.filter((s) => s.slide?.attrs.hidden === undefined)) : [];

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    if (!deck) return;
    let cancelled = false;
    void (async () => {
      // The Google Fonts stylesheet first, then every face the deck names: fonts.ready
      // alone resolves before a stylesheet that hasn't arrived yet has asked for anything.
      const link = document.getElementById("od-fonts") as HTMLLinkElement | null;
      if (link && !link.sheet)
        await new Promise((r) => {
          link.addEventListener("load", r, { once: true });
          link.addEventListener("error", r, { once: true });
          setTimeout(r, 8000);
        });
      await Promise.all(deck.index.theme.fonts.flatMap((f) => [400, 600, 700].map((w) => document.fonts.load(`${w} 32px "${f.family}"`).catch(() => null))));
      await document.fonts.ready;
      const imgs = [...document.images];
      await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((r) => ((img.onload = r), (img.onerror = r))))));
      // One more frame so layout settles after the last image.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (!cancelled) api().exports.printReady();
    })();
    return () => {
      cancelled = true;
    };
  }, [deck]);

  return (
    <div className="print-root">
      <style>{`@page { size: 1920px 1080px; margin: 0 } html, body, #root { background: #fff; overflow: visible; height: auto; } ::-webkit-scrollbar { display: none; } .print-page { break-after: page; width: 1920px; height: 1080px; overflow: hidden; }`}</style>
      {deck &&
        slides.map((s) =>
          s.slide ? (
            <div key={s.id} className="print-page">
              <SlideView slide={s.slide} theme={deck.index.theme} width={SLIDE_WIDTH} />
            </div>
          ) : null,
        )}
    </div>
  );
}
