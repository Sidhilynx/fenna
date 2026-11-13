// A deck as one standalone web page: every slide, the deck's fonts and
// images inlined, scaled to the window, with arrow-key / click navigation.
// It works offline except for Google Fonts, which load when online and fall
// back to each stack's next face otherwise.

import type { LoadedDeck } from "@opendeck/format";
import { BASE_CSS, fontFaceCss, googleFontsUrl, slideMarkup } from "@opendeck/render";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function deckToHtml(deck: LoadedDeck, assetData: (rel: string) => Promise<string | null>): Promise<string> {
  const theme = deck.index.theme;
  const slides = deck.slides.filter((s) => s.slide && s.slide.attrs.hidden === undefined);
  let body = slides.map((s) => slideMarkup(s.slide!, theme)).join("\n");
  let fontCss = fontFaceCss(theme);

  // Inline every assets/… reference (images in slides, font files in @font-face).
  const refs = new Set<string>([...body.matchAll(/(?:src="|url\(")(assets\/[^"]+)"/g)].map((m) => m[1]!).concat([...fontCss.matchAll(/url\("(assets\/[^"]+)"\)/g)].map((m) => m[1]!)));
  for (const rel of refs) {
    const data = await assetData(rel);
    if (!data) continue;
    body = body.split(`src="${rel}"`).join(`src="${data}"`);
    fontCss = fontCss.split(`url("${rel}")`).join(`url("${data}")`);
  }
  const fonts = googleFontsUrl(theme);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(deck.index.title)}</title>
${fonts ? `<link rel="stylesheet" href="${esc(fonts)}">` : ""}
<style>
${BASE_CSS}
${fontCss}
html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
.deck { position: fixed; inset: 0; display: grid; place-items: center; }
.deck .od-slide { position: absolute; left: 50%; top: 50%; transform-origin: 0 0; display: none; }
.deck .od-slide.on { display: flex; }
.count { position: fixed; right: 16px; bottom: 12px; font: 12px system-ui, sans-serif; color: #888; }
</style>
</head>
<body>
<div class="deck">
${body}
</div>
<div class="count" aria-live="polite"></div>
<script>
(() => {
  const slides = [...document.querySelectorAll(".od-slide")];
  const count = document.querySelector(".count");
  let i = Math.max(0, Math.min(slides.length - 1, (parseInt((location.hash.match(/slide-(\\d+)/) || [])[1], 10) || 1) - 1));
  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    for (const el of slides) el.style.transform = "scale(" + s + ") translate(-50%, -50%)";
  }
  function show(n) {
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((el, k) => el.classList.toggle("on", k === i));
    count.textContent = (i + 1) + " / " + slides.length;
    history.replaceState(null, "", "#slide-" + (i + 1));
  }
  addEventListener("resize", fit);
  addEventListener("keydown", (e) => {
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) show(i + 1);
    else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) show(i - 1);
    else if (e.key === "Home") show(0);
    else if (e.key === "End") show(slides.length - 1);
    else return;
    e.preventDefault();
  });
  addEventListener("click", (e) => { if (!e.target.closest("a")) show(e.clientX < innerWidth / 3 ? i - 1 : i + 1); });
  fit();
  show(i);
})();
</script>
</body>
</html>
`;
}
