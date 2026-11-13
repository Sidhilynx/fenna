// Export: the whole board drawn by the same renderer as the canvas, as an
// SVG (with the app's font and the board's images inside it, so it looks the
// same anywhere) or a PNG at twice the size.

import { boardSvg, boundsOf, type BoardItem } from "@opendeck/board";
import { toast } from "@opendeck/shell";
import { api, assetUrl, plainError } from "./api.ts";
import { getState } from "./store.ts";
import { currentTheme } from "./theme.ts";

export type ExportKind = "png" | "svg";

const PAD = 48;
/** Browsers draw no canvas over about 16k pixels a side. */
const MAX_SIDE = 16_000;

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** The Inter faces the page uses, as @font-face rules with the font inside. */
async function embeddedFonts(): Promise<string> {
  const rules: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of [...list]) {
      if (!(rule instanceof CSSFontFaceRule) || !/Inter/.test(rule.style.getPropertyValue("font-family"))) continue;
      const url = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue("src"))?.[1];
      if (!url) continue;
      try {
        const data = await toDataUrl(await (await fetch(new URL(url, sheet.href ?? document.baseURI))).blob());
        rules.push(`@font-face{font-family:Inter;font-style:${rule.style.getPropertyValue("font-style") || "normal"};font-weight:100 900;src:url(${data}) format("woff2");unicode-range:${rule.style.getPropertyValue("unicode-range") || "U+0-10FFFF"}}`);
      } catch {
        /* the export falls back to the system font */
      }
    }
  }
  return rules.join("");
}

/** Each image the items use, as a data URL. */
async function embeddedImages(items: readonly BoardItem[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const it of items) {
    if (it.kind !== "image" || out.has(it.src)) continue;
    try {
      out.set(it.src, await toDataUrl(await (await fetch(assetUrl(it.src))).blob()));
    } catch {
      /* drawn as an empty frame */
    }
  }
  return out;
}

export async function buildSvg(): Promise<{ svg: string; width: number; height: number } | null> {
  const s = getState();
  const b = boundsOf(s.items, s.byId);
  if (!b) return null;
  const area = { x: Math.floor(b.x - PAD), y: Math.floor(b.y - PAD - 28), width: Math.ceil(b.width + PAD * 2), height: Math.ceil(b.height + PAD * 2 + 28) };
  const images = await embeddedImages(s.items);
  const svg = boardSvg(s.items, { theme: currentTheme(), items: s.byId, asset: (src) => images.get(src) ?? null }, area);
  const fonts = await embeddedFonts();
  return { svg: fonts ? svg.replace(/^<svg([^>]*)>/, `<svg$1><style>${fonts}</style>`) : svg, width: area.width, height: area.height };
}

function rasterize(svg: string, width: number, height: number): Promise<Uint8Array> {
  const scale = Math.max(0.1, Math.min(2, MAX_SIDE / width, MAX_SIDE / height));
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => (blob ? void blob.arrayBuffer().then((b) => resolve(new Uint8Array(b))) : reject(new Error("the picture is too big"))), "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("the board couldn’t be drawn"));
    };
    img.src = url;
  });
}

export async function exportBoard(kind: ExportKind) {
  const s = getState();
  const title = s.meta?.title ?? "board";
  try {
    const built = await buildSvg();
    if (!built) {
      toast("The board is empty; there is nothing to export.");
      return;
    }
    const bytes = kind === "svg" ? new TextEncoder().encode(built.svg) : await rasterize(built.svg, built.width, built.height);
    const file = await api().saveExport(title, kind, bytes);
    if (file) toast(`Saved ${file.split(/[\\/]/).pop()}.`);
  } catch (e) {
    toast(`Couldn’t export: ${plainError(e)}`);
  }
}
