// A deck as a PowerPoint file with real, editable text boxes, shapes,
// images and tables.
//
// Positions and sizes come from the browser's own layout of each slide
// (rendered off screen at full size with the same renderer as the editor),
// so the PowerPoint matches what you see: flex and grid layouts are already
// resolved into boxes. Styles come from the computed styles of those boxes.
//
// 1920 CSS px = 13.333 in (PowerPoint's 16:9 "wide" layout): 1 px = 1/144 in
// = 0.5 pt, so a 64px heading is 32pt.

import PptxGenJS from "pptxgenjs";
import { type LoadedDeck, notesOf } from "@opendeck/format";
import { slideMarkup } from "@opendeck/render";
import { api, assetBase } from "../api.ts";

type Slide = ReturnType<PptxGenJS["addSlide"]>;
type TextProps = PptxGenJS.TextPropsOptions;

const IN = (px: number) => px / 144;
const PT = (px: number) => px / 2;

interface Color {
  hex: string;
  /** 0–100, PowerPoint's transparency */
  transparency: number;
}

function parseColor(css: string): Color | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(css);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (a <= 0.001) return null;
  const hex = [m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("").toUpperCase();
  return { hex, transparency: Math.round((1 - a) * 100) };
}

/** First solid color of a background (a gradient becomes its first stop). */
function backgroundColor(cs: CSSStyleDeclaration): Color | null {
  const solid = parseColor(cs.backgroundColor);
  if (solid) return solid;
  const stop = /rgba?\([^)]*\)/.exec(cs.backgroundImage);
  return stop ? parseColor(stop[0]) : null;
}

function basicFace(family: string): string {
  const f = family.toLowerCase();
  if (/mono|code|courier/.test(f)) return "Courier New";
  if (/serif|garamond|georgia|times|baskerville|lora|playfair|domine|bitter|instrument/.test(f) && !/sans/.test(f)) return "Georgia";
  return "Arial";
}

function firstFamily(cs: CSSStyleDeclaration): string {
  return (cs.fontFamily.split(",")[0] ?? "Arial").trim().replace(/^["']|["']$/g, "");
}

interface Ctx {
  pptx: PptxGenJS;
  basicFonts: boolean;
  origin: DOMRect;
  images: Map<string, string | null>;
}

function rectOf(el: Element, ctx: Ctx) {
  const r = el.getBoundingClientRect();
  return { x: IN(r.left - ctx.origin.left), y: IN(r.top - ctx.origin.top), w: IN(r.width), h: IN(r.height) };
}

function face(cs: CSSStyleDeclaration, ctx: Ctx) {
  const fam = firstFamily(cs);
  return ctx.basicFonts ? basicFace(fam) : fam;
}

function transform(text: string, cs: CSSStyleDeclaration) {
  if (cs.textTransform === "uppercase") return text.toUpperCase();
  if (cs.textTransform === "lowercase") return text.toLowerCase();
  if (cs.textTransform === "capitalize") return text.replace(/\b\w/g, (c) => c.toUpperCase());
  return text;
}

/** Inline content as PowerPoint text runs, keeping bold/italic/underline/color and line breaks. */
function runs(el: Element, ctx: Ctx, out: PptxGenJS.TextProps[] = []): PptxGenJS.TextProps[] {
  for (const node of [...el.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement!;
      const cs = getComputedStyle(parent);
      const text = transform((node.textContent ?? "").replace(/\s+/g, " "), cs);
      if (!text) continue;
      const color = parseColor(cs.color);
      out.push({
        text,
        options: {
          bold: Number(cs.fontWeight) >= 600,
          italic: cs.fontStyle === "italic",
          underline: cs.textDecorationLine.includes("underline") ? { style: "sng" } : undefined,
          strike: cs.textDecorationLine.includes("line-through") ? "sngStrike" : undefined,
          color: color?.hex,
          transparency: color?.transparency || undefined,
          fontFace: face(cs, ctx),
          fontSize: PT(parseFloat(cs.fontSize)),
          hyperlink: parent.closest("a")?.getAttribute("href") ? { url: parent.closest("a")!.getAttribute("href")! } : undefined,
        },
      });
    } else if (node instanceof HTMLBRElement) {
      if (out.length) out[out.length - 1]!.options = { ...out[out.length - 1]!.options, breakLine: true };
      else out.push({ text: "", options: { breakLine: true } });
    } else if (node instanceof Element && !["UL", "OL"].includes(node.tagName)) runs(node, ctx, out);
  }
  // Trim the run edges like the browser does.
  if (out[0]) out[0].text = out[0].text!.replace(/^\s+/, "");
  const last = out[out.length - 1];
  if (last) last.text = last.text!.replace(/\s+$/, "");
  return out;
}

function boxOptions(el: Element, cs: CSSStyleDeclaration, ctx: Ctx): TextProps {
  const r = rectOf(el, ctx);
  const fill = backgroundColor(cs);
  const bw = parseFloat(cs.borderTopWidth) || 0;
  const line = bw > 0 && cs.borderTopStyle !== "none" ? parseColor(cs.borderTopColor) : null;
  const lineHeight = parseFloat(cs.lineHeight);
  const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((p) => PT(parseFloat(p) || 0)) as [number, number, number, number];
  return {
    ...r,
    margin: pad,
    valign: "top",
    align: (["left", "center", "right", "justify"].includes(cs.textAlign) ? cs.textAlign : "left") as TextProps["align"],
    fill: fill ? { color: fill.hex, transparency: fill.transparency } : undefined,
    line: line ? { color: line.hex, width: PT(bw), dashType: cs.borderTopStyle === "dashed" ? "dash" : cs.borderTopStyle === "dotted" ? "sysDot" : "solid" } : undefined,
    rectRadius: parseFloat(cs.borderTopLeftRadius) ? IN(parseFloat(cs.borderTopLeftRadius)) : undefined,
    shape: parseFloat(cs.borderTopLeftRadius) ? ctx.pptx.ShapeType.roundRect : undefined,
    lineSpacing: Number.isFinite(lineHeight) ? PT(lineHeight) : undefined,
    charSpacing: parseFloat(cs.letterSpacing) ? PT(parseFloat(cs.letterSpacing)) : undefined,
    rotate: rotation(cs),
    transparency: cs.opacity !== "1" ? Math.round((1 - Number(cs.opacity)) * 100) : undefined,
    fit: "none",
    wrap: cs.whiteSpace !== "nowrap",
  };
}

function rotation(cs: CSSStyleDeclaration): number | undefined {
  const m = /matrix\(([^,]+),\s*([^,]+)/.exec(cs.transform);
  if (!m) return undefined;
  const deg = Math.round((Math.atan2(Number(m[2]), Number(m[1])) * 180) / Math.PI);
  return deg ? deg : undefined;
}

const SHAPES: Record<string, keyof PptxGenJS["ShapeType"]> = {
  rect: "rect",
  rounded: "roundRect",
  ellipse: "ellipse",
  diamond: "diamond",
  triangle: "triangle",
  "arrow-right": "rightArrow",
  "arrow-left": "leftArrow",
  "arrow-up": "upArrow",
  "arrow-down": "downArrow",
  line: "line",
};

/** A painted box (a card, a pill's background) as a rectangle. */
function paintBox(slide: Slide, el: Element, cs: CSSStyleDeclaration, ctx: Ctx) {
  const fill = backgroundColor(cs);
  const bw = parseFloat(cs.borderTopWidth) || 0;
  const line = bw > 0 && cs.borderTopStyle !== "none" ? parseColor(cs.borderTopColor) : null;
  if (!fill && !line) return;
  const radius = parseFloat(cs.borderTopLeftRadius) || 0;
  slide.addShape(radius ? ctx.pptx.ShapeType.roundRect : ctx.pptx.ShapeType.rect, {
    ...rectOf(el, ctx),
    fill: fill ? { color: fill.hex, transparency: fill.transparency } : { type: "none" },
    line: line ? { color: line.hex, width: PT(bw) } : { type: "none" },
    rectRadius: radius ? IN(radius) : undefined,
    rotate: rotation(cs),
  });
}

async function imageData(src: string, ctx: Ctx): Promise<string | null> {
  if (!ctx.images.has(src)) ctx.images.set(src, src.startsWith(assetBase()) ? await api().exports.assetData(src.slice(assetBase().length)) : null);
  return ctx.images.get(src) ?? null;
}

async function walk(el: Element, slide: Slide, ctx: Ctx) {
  for (const child of [...el.children]) {
    const cs = getComputedStyle(child);
    if (cs.display === "none" || child.tagName === "ASIDE") continue;
    const tag = child.tagName.toLowerCase();
    if (tag === "div") {
      paintBox(slide, child, cs, ctx);
      await walk(child, slide, ctx);
    } else if (["h1", "h2", "h3", "p"].includes(tag)) {
      const text = runs(child, ctx);
      if (text.length) slide.addText(text, boxOptions(child, cs, ctx));
      else paintBox(slide, child, cs, ctx);
    } else if (tag === "ul" || tag === "ol") {
      const paras: PptxGenJS.TextProps[] = [];
      const items = [...child.querySelectorAll("li")];
      for (const li of items) {
        const depth = (li.parentElement?.closest("li") ? 1 : 0) + (li.parentElement?.parentElement?.closest("li") ? 1 : 0);
        const r = runs(li, ctx);
        if (!r.length) r.push({ text: "", options: {} });
        r[0]!.options = { ...r[0]!.options, bullet: tag === "ol" && !li.parentElement?.closest("li") ? { type: "number" } : true, indentLevel: depth };
        r[r.length - 1]!.options = { ...r[r.length - 1]!.options, breakLine: true };
        paras.push(...r);
      }
      if (paras.length) slide.addText(paras, boxOptions(child, cs, ctx));
    } else if (tag === "img") {
      const src = (child as HTMLImageElement).src;
      const data = await imageData(src.startsWith("odasset:") ? src : (child.getAttribute("src") ?? ""), ctx);
      if (!data) continue;
      const r = rectOf(child, ctx);
      const img = child as HTMLImageElement;
      slide.addImage({
        data,
        ...r,
        sizing: img.naturalWidth ? { type: cs.objectFit === "contain" ? "contain" : "cover", w: r.w, h: r.h } : undefined,
        rounding: parseFloat(cs.borderTopLeftRadius) >= Math.min(img.width, img.height) / 2,
        transparency: cs.opacity !== "1" ? Math.round((1 - Number(cs.opacity)) * 100) : undefined,
        altText: img.alt || undefined,
      });
    } else if (tag === "svg") {
      const clone = child.cloneNode(true) as SVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const svg = new XMLSerializer().serializeToString(clone);
      slide.addImage({ data: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`, ...rectOf(child, ctx), altText: child.getAttribute("aria-label") ?? undefined });
    } else if (tag === "x-shape") {
      const kind = child.getAttribute("kind") ?? "rect";
      const fill = backgroundColor(cs);
      const r = rectOf(child, ctx);
      if (kind === "line") {
        const c = parseColor(cs.borderTopColor) ?? parseColor(cs.color);
        slide.addShape(ctx.pptx.ShapeType.line, { x: r.x, y: r.y, w: r.w, h: 0, line: { color: c?.hex ?? "888888", width: PT(parseFloat(cs.borderTopWidth) || 4) }, rotate: rotation(cs) });
      } else {
        const bw = parseFloat(cs.borderTopWidth) || 0;
        const line = bw > 0 && cs.borderTopStyle !== "none" ? parseColor(cs.borderTopColor) : null;
        slide.addShape(ctx.pptx.ShapeType[SHAPES[kind] ?? "rect"], {
          ...r,
          fill: fill ? { color: fill.hex, transparency: fill.transparency } : { type: "none" },
          line: line ? { color: line.hex, width: PT(bw) } : { type: "none" },
          rotate: rotation(cs),
        });
      }
    } else if (tag === "hr") {
      const r = rectOf(child, ctx);
      const c = parseColor(cs.borderTopColor);
      slide.addShape(ctx.pptx.ShapeType.line, { x: r.x, y: r.y, w: r.w, h: 0, line: { color: c?.hex ?? "888888", width: PT(parseFloat(cs.borderTopWidth) || 2) } });
    } else if (tag === "table") {
      addTable(child as HTMLTableElement, slide, ctx);
    }
  }
}

function addTable(table: HTMLTableElement, slide: Slide, ctx: Ctx) {
  const rows = [...table.rows];
  if (!rows.length) return;
  const first = [...rows[0]!.cells];
  const data: PptxGenJS.TableRow[] = rows.map((tr) => {
    const rowFill = backgroundColor(getComputedStyle(tr));
    return [...tr.cells].map((cell) => {
      const cs = getComputedStyle(cell);
      const color = parseColor(cs.color);
      const border = parseColor(cs.borderBottomColor);
      return {
        text: runs(cell, ctx),
        options: {
          fontFace: face(cs, ctx),
          fontSize: PT(parseFloat(cs.fontSize)),
          bold: Number(cs.fontWeight) >= 600,
          color: color?.hex,
          align: (["left", "center", "right"].includes(cs.textAlign) ? cs.textAlign : "left") as "left" | "center" | "right",
          valign: "top" as const,
          fill: rowFill ? { color: rowFill.hex, transparency: rowFill.transparency } : undefined,
          margin: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((p) => PT(parseFloat(p) || 0)) as [number, number, number, number],
          border: [{ type: "none" }, { type: "none" }, border ? { type: "solid", color: border.hex, pt: 0.75 } : { type: "none" }, { type: "none" }],
        },
      };
    });
  });
  const r = rectOf(table, ctx);
  slide.addTable(data, { x: r.x, y: r.y, w: r.w, colW: first.map((c) => IN(c.getBoundingClientRect().width)), rowH: rows.map((tr) => IN(tr.getBoundingClientRect().height)) });
}

/** Build the .pptx. The deck's fonts must already be loaded in this page (they are, in the editor). */
export async function deckToPptx(deck: LoadedDeck, opts: { basicFonts: boolean }): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = deck.index.title;

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-30000px;top:0;width:1920px;height:1080px;pointer-events:none;contain:strict";
  document.body.appendChild(host);
  try {
    await document.fonts.ready;
    const ctx: Ctx = { pptx, basicFonts: opts.basicFonts, origin: new DOMRect(), images: new Map() };
    for (const s of deck.slides) {
      if (!s.slide) continue;
      host.innerHTML = slideMarkup(s.slide, deck.index.theme, { assetBase: assetBase() });
      const section = host.firstElementChild as HTMLElement;
      await Promise.all([...section.querySelectorAll("img")].map((img) => (img.complete ? null : new Promise((r) => ((img.onload = r), (img.onerror = r))))));
      ctx.origin = section.getBoundingClientRect();
      const slide = pptx.addSlide();
      const cs = getComputedStyle(section);
      const bg = backgroundColor(cs);
      if (bg) slide.background = { color: bg.hex, transparency: bg.transparency };
      if (s.slide.attrs.hidden !== undefined) slide.hidden = true;
      await walk(section, slide, ctx);
      const notes = notesOf(s.slide);
      if (notes) slide.addNotes(notes);
    }
  } finally {
    host.remove();
  }
  const out = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  return out;
}
