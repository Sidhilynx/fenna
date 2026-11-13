// The one renderer: an item → SVG markup. The canvas, PNG and SVG export and
// the Home cover all draw with it, so a board looks the same everywhere.
// Colors here are the board's content colors (the "slide" of this app), in
// both themes; the editor's own chrome uses the shell's tokens instead.

import { connectorPoints, drawingPoints, midpoint, roundedPath, type ById, type Pt } from "./geometry.ts";
import {
  FILL_VALUES,
  INK_VALUES,
  STICKERS,
  TEXT_SIZE_PX,
  type Align,
  type BoardItem,
  type Cap,
  type ConnectorItem,
  type FillColor,
  type InkColor,
  type ShapeKind,
  type ShapeItem,
  type StickerId,
  type StickyItem,
  type TextItem,
  type TextStyle,
  type Theme,
} from "./schema.ts";
import { layoutText, LINE_HEIGHT, TEXT_PAD, textWidth } from "./text.ts";

export const FONT = "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif";

/** The board's own surface colors in each theme. */
export const CANVAS: Record<Theme, { bg: string; grid: string; frame: string; frameLine: string; frameTitle: string; cell: string; cellLine: string; header: string; onFill: string; author: string }> = {
  dark: { bg: "#1a1a1a", grid: "#242424", frame: "#202020", frameLine: "#3c3c3c", frameTitle: "#c8c8c8", cell: "#1f1f1f", cellLine: "#3a3a3a", header: "#2a2a2a", onFill: "#1b1b1b", author: "rgba(0,0,0,0.45)" },
  light: { bg: "#f7f7f6", grid: "#e9e9e7", frame: "#ffffff", frameLine: "#d4d4d2", frameTitle: "#4a4a4a", cell: "#ffffff", cellLine: "#d4d4d2", header: "#f0f0ee", onFill: "#1b1b1b", author: "rgba(0,0,0,0.45)" },
};

export interface RenderContext {
  theme: Theme;
  /** Every item, by id: connectors find their ends here. */
  items: ById;
  /** Where images are served from ("odboard://token/"), or data URLs by src for an export. */
  asset?: (src: string) => string | null;
  /** Items whose text is being edited: drawn without it. */
  editing?: string | null;
  /** The Home cover: text as bars, lines that stay visible when tiny. */
  cover?: boolean;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => Math.round(v * 100) / 100;

export const fillValue = (c: FillColor | undefined, fallback: FillColor) => FILL_VALUES[c ?? fallback];
export const inkValue = (c: InkColor | undefined, theme: Theme) => INK_VALUES[theme][c ?? "default"];

// ── Shapes ───────────────────────────────────────────────────────────────

const CLOUD = "M25 56C9 56 3 42 13 34C7 20 21 10 33 16C38 3 61 1 67 15C80 7 97 18 89 32C100 38 95 57 79 56Z";

function scalePath(d: string, x: number, y: number, sx: number, sy: number): string {
  let i = 0;
  return d.replace(/-?\d+(\.\d+)?/g, (m) => String(n(i++ % 2 === 0 ? x + Number(m) * sx : y + Number(m) * sy)));
}

function rrect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${n(x + rr)} ${n(y)}H${n(x + w - rr)}Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + rr)}V${n(y + h - rr)}Q${n(x + w)} ${n(y + h)} ${n(x + w - rr)} ${n(y + h)}H${n(x + rr)}Q${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - rr)}V${n(y + rr)}Q${n(x)} ${n(y)} ${n(x + rr)} ${n(y)}Z`;
}

/** A shape's outline (`body`) and any inner line it has (a cylinder's lip), as path data. */
export function shapePath(kind: ShapeKind, x: number, y: number, w: number, h: number): { body: string; detail?: string } {
  switch (kind) {
    case "square":
    case "rect":
      return { body: rrect(x, y, w, h, Math.min(14, w / 6, h / 6)) };
    case "circle":
      return { body: `M${n(x)} ${n(y + h / 2)}A${n(w / 2)} ${n(h / 2)} 0 1 0 ${n(x + w)} ${n(y + h / 2)}A${n(w / 2)} ${n(h / 2)} 0 1 0 ${n(x)} ${n(y + h / 2)}Z` };
    case "pill":
      return { body: rrect(x, y, w, h, Math.min(w, h) / 2) };
    case "diamond":
      return { body: `M${n(x + w / 2)} ${n(y)}L${n(x + w)} ${n(y + h / 2)}L${n(x + w / 2)} ${n(y + h)}L${n(x)} ${n(y + h / 2)}Z` };
    case "hexagon": {
      const s = Math.min(w * 0.25, h * 0.5);
      return { body: `M${n(x + s)} ${n(y)}H${n(x + w - s)}L${n(x + w)} ${n(y + h / 2)}L${n(x + w - s)} ${n(y + h)}H${n(x + s)}L${n(x)} ${n(y + h / 2)}Z` };
    }
    case "parallelogram": {
      const s = Math.min(w * 0.22, h * 0.6);
      return { body: `M${n(x + s)} ${n(y)}H${n(x + w)}L${n(x + w - s)} ${n(y + h)}H${n(x)}Z` };
    }
    case "cylinder": {
      const ry = Math.min(h * 0.14, w * 0.25);
      const rx = w / 2;
      return {
        body: `M${n(x)} ${n(y + ry)}A${n(rx)} ${n(ry)} 0 0 1 ${n(x + w)} ${n(y + ry)}V${n(y + h - ry)}A${n(rx)} ${n(ry)} 0 0 1 ${n(x)} ${n(y + h - ry)}Z`,
        detail: `M${n(x)} ${n(y + ry)}A${n(rx)} ${n(ry)} 0 0 0 ${n(x + w)} ${n(y + ry)}`,
      };
    }
    case "drum": {
      const rx = Math.min(w * 0.14, h * 0.25);
      const ry = h / 2;
      return {
        body: `M${n(x + rx)} ${n(y)}H${n(x + w - rx)}A${n(rx)} ${n(ry)} 0 0 1 ${n(x + w - rx)} ${n(y + h)}H${n(x + rx)}A${n(rx)} ${n(ry)} 0 0 1 ${n(x + rx)} ${n(y)}Z`,
        detail: `M${n(x + w - rx)} ${n(y)}A${n(rx)} ${n(ry)} 0 0 0 ${n(x + w - rx)} ${n(y + h)}`,
      };
    }
    case "document": {
      const r = Math.min(12, w / 8, h / 8);
      return {
        body: `M${n(x)} ${n(y + r)}Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}H${n(x + w - r)}Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + r)}V${n(y + h * 0.88)}C${n(x + w * 0.72)} ${n(y + h * 0.7)} ${n(x + w * 0.32)} ${n(y + h * 1.08)} ${n(x)} ${n(y + h * 0.9)}Z`,
      };
    }
    case "cloud":
      return { body: scalePath(CLOUD, x, y, w / 100, h / 58) };
    case "person": {
      const r = Math.min(w, h) * 0.2;
      const cx = x + w / 2;
      return {
        body: `M${n(cx - r)} ${n(y + r)}A${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(y + r)}A${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(y + r)}ZM${n(x + w * 0.08)} ${n(y + h)}C${n(x + w * 0.08)} ${n(y + h * 0.5)} ${n(x + w * 0.92)} ${n(y + h * 0.5)} ${n(x + w * 0.92)} ${n(y + h)}Z`,
      };
    }
  }
}

/** The box text sits in inside a shape, as fractions of its size. */
function shapeTextBox(kind: ShapeKind): [number, number, number, number] {
  switch (kind) {
    case "diamond":
      return [0.25, 0.22, 0.5, 0.56];
    case "circle":
      return [0.15, 0.15, 0.7, 0.7];
    case "hexagon":
    case "parallelogram":
      return [0.18, 0.08, 0.64, 0.84];
    case "cylinder":
      return [0.06, 0.24, 0.88, 0.66];
    case "drum":
      return [0.08, 0.08, 0.72, 0.84];
    case "document":
      return [0.06, 0.06, 0.88, 0.7];
    case "cloud":
      return [0.2, 0.25, 0.6, 0.58];
    case "person":
      return [0.1, 0.62, 0.8, 0.36];
    default:
      return [0, 0, 1, 1];
  }
}

// ── Text ─────────────────────────────────────────────────────────────────

interface TextOpts extends TextStyle {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  /** Centre the lines vertically in the box. */
  middle?: boolean;
  /** Cut what doesn't fit the box, ending the last line with an ellipsis. */
  clip?: boolean;
  underline?: boolean;
  cover?: boolean;
}

function ellipsize(line: string, width: number, px: number, bold?: boolean): string {
  let s = line;
  while (s && textWidth(`${s}…`, px, bold) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function textSvg(text: string, o: TextOpts): string {
  if (!text) return "";
  const block = layoutText(text, { width: o.width, height: o.clip ? o.height : undefined, size: o.size, bold: o.bold, list: o.list });
  const { px, lineHeight } = block;
  let lines = block.lines;
  if (o.clip && lines.length > block.fits) {
    lines = lines.slice(0, block.fits);
    lines[lines.length - 1] = ellipsize(lines[lines.length - 1]!, o.width - (o.list ? px * 1.1 : 0), px, o.bold);
  }
  const total = lines.length * lineHeight;
  const top = o.middle ? o.y + Math.max(0, (o.height - total) / 2) : o.y;
  const indent = o.list ? px * 1.1 : 0;
  const align = o.align ?? "left";
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const ax = align === "center" ? o.x + indent + (o.width - indent) / 2 : align === "right" ? o.x + o.width : o.x + indent;
  // Baseline of the first line: centred in its line box, Inter's cap height ≈ 0.73em.
  const base = top + (lineHeight - px) / 2 + px * 0.8;
  if (o.cover) {
    return lines
      .slice(0, 4)
      .map((l, i) => {
        if (!l) return "";
        const w = Math.min(o.width, textWidth(l, px, o.bold));
        const x = align === "center" ? o.x + (o.width - w) / 2 : align === "right" ? o.x + o.width - w : o.x;
        return `<rect x="${n(x)}" y="${n(top + i * lineHeight + lineHeight * 0.3)}" width="${n(w)}" height="${n(px * 0.55)}" rx="${n(px * 0.27)}" fill="${o.fill}" opacity="0.55"/>`;
      })
      .join("");
  }
  const weight = o.bold ? 700 : 400;
  const style = o.italic ? ' font-style="italic"' : "";
  const deco = o.underline ? ' text-decoration="underline"' : "";
  const tspans = lines
    .map((l, i) => {
      const y = n(base + i * lineHeight);
      const bullet = o.list && l !== "" ? `<tspan x="${n(o.x)}" y="${y}" text-anchor="start">•</tspan>` : "";
      return `${bullet}<tspan x="${n(ax)}" y="${y}">${esc(l) || " "}</tspan>`;
    })
    .join("");
  return `<text font-family="${esc(FONT)}" font-size="${px}" font-weight="${weight}"${style}${deco} fill="${o.fill}" text-anchor="${anchor}" xml:space="preserve">${tspans}</text>`;
}

/** Height a text item needs for its text at `width`. */
export function textItemHeight(text: string, style: TextStyle, width: number): number {
  const b = layoutText(text || " ", { width, size: style.size, bold: style.bold, list: style.list });
  return Math.max(b.lineHeight, b.height);
}

// ── Connectors and drawings ──────────────────────────────────────────────

function capSvg(cap: Cap | undefined, tip: Pt, from: Pt, color: string, cover?: boolean): string {
  if (!cap || cap === "none") return "";
  if (cap === "dot") return `<circle cx="${n(tip.x)}" cy="${n(tip.y)}" r="4.5" fill="${color}"/>`;
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const len = 11;
  const spread = 0.5;
  const p1 = { x: tip.x - len * Math.cos(a - spread), y: tip.y - len * Math.sin(a - spread) };
  const p2 = { x: tip.x - len * Math.cos(a + spread), y: tip.y - len * Math.sin(a + spread) };
  return `<path d="M${n(p1.x)} ${n(p1.y)}L${n(tip.x)} ${n(tip.y)}L${n(p2.x)} ${n(p2.y)}" fill="none" stroke="${color}" stroke-width="2"${cover ? ' vector-effect="non-scaling-stroke"' : ""} stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** A connector's label box, centred on its route; also where the editor puts its label field. */
export function connectorLabelBox(c: ConnectorItem, items: ById): { x: number; y: number; width: number; height: number } | null {
  const pts = connectorPoints(c, items);
  if (!pts || !c.label) return null;
  const { pt } = midpoint(pts);
  const w = Math.min(240, textWidth(c.label, TEXT_SIZE_PX.small)) + 16;
  return { x: pt.x - w / 2, y: pt.y - 11, width: w, height: 22 };
}

function connectorSvg(c: ConnectorItem, ctx: RenderContext): string {
  const pts = connectorPoints(c, ctx.items);
  if (!pts) return "";
  const color = inkValue(c.color, ctx.theme);
  const dash = c.lineStyle === "dashed" ? ' stroke-dasharray="8 6"' : "";
  const vec = ctx.cover ? ' vector-effect="non-scaling-stroke"' : "";
  let out = `<path d="${roundedPath(pts, c.route === "straight" ? 0 : 14)}" fill="none" stroke="${color}" stroke-width="2"${dash}${vec} stroke-linecap="round" stroke-linejoin="round"/>`;
  out += capSvg(c.startCap, pts[0]!, pts[1]!, color, ctx.cover);
  out += capSvg(c.endCap ?? "arrow", pts[pts.length - 1]!, pts[pts.length - 2]!, color, ctx.cover);
  const box = connectorLabelBox(c, ctx.items);
  if (box && !ctx.cover && ctx.editing !== c.id) {
    out += `<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" rx="6" fill="${CANVAS[ctx.theme].bg}"/>`;
    out += textSvg(c.label!.length > 40 ? `${c.label!.slice(0, 39)}…` : c.label!, { x: box.x + 7, y: box.y + 1, width: box.width - 14, height: 20, size: "small", align: "center", fill: color, clip: true });
  }
  return out;
}

/** A smooth path through a pen stroke's points. */
function strokePath(pts: Pt[]): string {
  if (pts.length < 3) return roundedPath(pts, 0);
  let d = `M${n(pts[0]!.x)} ${n(pts[0]!.y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    d += `Q${n(p.x)} ${n(p.y)} ${n((p.x + q.x) / 2)} ${n((p.y + q.y) / 2)}`;
  }
  const last = pts[pts.length - 1]!;
  return `${d}L${n(last.x)} ${n(last.y)}`;
}

// ── Stickers ─────────────────────────────────────────────────────────────

/** Each sticker on a 100×100 grid: filled parts, then line work. Drawn with a white die-cut edge. */
const STICKER_ART: Record<StickerId, { parts: [string, string][]; lines?: string; text?: [string, string]; turn?: number }> = {
  heart: { parts: [["M50 86C20 66 8 49 12 32C16 15 38 11 50 28C62 11 84 15 88 32C92 49 80 66 50 86Z", "#e5484d"]] },
  star: { parts: [["M50 8L61 36L91 38L68 57L76 87L50 70L24 87L32 57L9 38L39 36Z", "#f5c542"]] },
  "thumbs-up": { parts: [["M14 46H30V88H14Z", "#5b8cff"], ["M30 46H42L52 18C55 10 66 13 64 24L60 40H80C86 40 90 46 88 52L82 80C81 85 77 88 72 88H30Z", "#f2b84b"]], lines: "M60 54H86M58 66H84M56 77H80" },
  "thumbs-down": { parts: [["M14 46H30V88H14Z", "#5b8cff"], ["M30 46H42L52 18C55 10 66 13 64 24L60 40H80C86 40 90 46 88 52L82 80C81 85 77 88 72 88H30Z", "#f2b84b"]], lines: "M60 54H86M58 66H84M56 77H80", turn: 180 },
  "plus-one": { parts: [["M10 26Q10 14 22 14H78Q90 14 90 26V74Q90 86 78 86H22Q10 86 10 74Z", "#4f8df5"]], text: ["+1", "#ffffff"] },
  check: { parts: [["M50 8A42 42 0 1 0 50 92A42 42 0 1 0 50 8Z", "#3fb950"]], lines: "M30 51L44 65L71 36" },
  cross: { parts: [["M50 8A42 42 0 1 0 50 92A42 42 0 1 0 50 8Z", "#e5484d"]], lines: "M34 34L66 66M66 34L34 66" },
  question: { parts: [["M50 8A42 42 0 1 0 50 92A42 42 0 1 0 50 8Z", "#8e6bf0"]], text: ["?", "#ffffff"] },
  warning: { parts: [["M50 10L92 84Q94 90 88 90H12Q6 90 8 84Z", "#f5c542"]], text: ["!", "#2b2b2b"] },
  idea: { parts: [["M38 72H62V82Q62 89 55 89H45Q38 89 38 82Z", "#b8b8b8"], ["M50 11C30 11 19 27 22 42C24 54 34 58 36 68H64C66 58 76 54 78 42C81 27 70 11 50 11Z", "#fbe38e"]], lines: "M44 68V52L50 46L56 52V68" },
  flag: { parts: [["M22 8H31V93H22Z", "#8a8a8a"], ["M31 13H82L69 32L82 51H31Z", "#e5484d"]] },
  pin: { parts: [["M50 93C50 93 19 58 19 38C19 19 33 7 50 7C67 7 81 19 81 38C81 58 50 93 50 93Z", "#e5484d"], ["M50 25A12 12 0 1 0 50 49A12 12 0 1 0 50 25Z", "#ffffff"]] },
  target: { parts: [["M50 8A42 42 0 1 0 50 92A42 42 0 1 0 50 8Z", "#e5484d"], ["M50 22A28 28 0 1 0 50 78A28 28 0 1 0 50 22Z", "#ffffff"], ["M50 36A14 14 0 1 0 50 64A14 14 0 1 0 50 36Z", "#e5484d"]] },
  trophy: { parts: [["M32 78H68V90H32Z", "#c9932e"], ["M42 60H58V78H42Z", "#c9932e"], ["M27 12H73V36C73 53 62 62 50 62C38 62 27 53 27 36Z", "#f5c542"]], lines: "M27 20H14C14 36 22 42 30 42M73 20H86C86 36 78 42 70 42" },
  rocket: { parts: [["M42 66L50 92L58 66Z", "#f0a476"], ["M36 52L20 74L37 70Z", "#e5484d"], ["M64 52L80 74L63 70Z", "#e5484d"], ["M50 7C67 21 71 44 64 68H36C29 44 33 21 50 7Z", "#e8e8e8"], ["M50 28A9 9 0 1 0 50 46A9 9 0 1 0 50 28Z", "#5b8cff"]] },
  clock: { parts: [["M50 8A42 42 0 1 0 50 92A42 42 0 1 0 50 8Z", "#5b8cff"], ["M50 18A32 32 0 1 0 50 82A32 32 0 1 0 50 18Z", "#ffffff"]], lines: "M50 30V50L64 58" },
  smile: { parts: [["M50 8A42 42 0 1 0 50 92A42 42 0 1 0 50 8Z", "#f5c542"]], lines: "M37 38V42M63 38V42M32 58C40 72 60 72 68 58" },
  sad: { parts: [["M50 8A42 42 0 1 0 50 92A42 42 0 1 0 50 8Z", "#8ec4f2"]], lines: "M37 38V42M63 38V42M33 70C41 58 59 58 67 70" },
  fire: { parts: [["M50 93C27 93 17 77 21 60C25 44 40 38 40 19C53 27 59 38 57 50C62 46 64 38 64 31C77 44 83 58 79 72C75 86 65 93 50 93Z", "#f08a3c"], ["M50 92C39 92 34 84 36 76C38 68 46 64 47 54C55 60 58 66 57 72C61 70 62 66 62 63C68 70 69 78 66 84C63 89 58 92 50 92Z", "#f5c542"]] },
  bolt: { parts: [["M57 5L21 55H46L39 95L79 40H54Z", "#f5c542"]] },
  "arrow-right": { parts: [["M10 38H55V18L91 50L55 82V62H10Z", "#5b8cff"]] },
  "arrow-up": { parts: [["M10 38H55V18L91 50L55 82V62H10Z", "#3fb950"]], turn: -90 },
  speech: { parts: [["M12 22C12 15 17 10 24 10H76C83 10 88 15 88 22V58C88 65 83 70 76 70H44L25 88V70C17 70 12 65 12 58Z", "#acd4f6"]], lines: "M34 40H34.5M50 40H50.5M66 40H66.5" },
  eyes: { parts: [["M30 18C42 18 47 34 47 50C47 66 42 82 30 82C18 82 13 66 13 50C13 34 18 18 30 18Z", "#ffffff"], ["M70 18C82 18 87 34 87 50C87 66 82 82 70 82C58 82 53 66 53 50C53 34 58 18 70 18Z", "#ffffff"], ["M34 48A8 9 0 1 0 34 66A8 9 0 1 0 34 48Z", "#2b2b2b"], ["M74 48A8 9 0 1 0 74 66A8 9 0 1 0 74 48Z", "#2b2b2b"]] },
};

const INKY = "#2b2b2b";

/** A sticker at (x, y), `size` wide and high. */
export function stickerSvg(id: StickerId, x: number, y: number, w: number, h: number): string {
  const art = STICKER_ART[id] ?? STICKER_ART.star;
  const s = Math.min(w, h) / 100;
  const ox = x + (w - 100 * s) / 2;
  const oy = y + (h - 100 * s) / 2;
  const turn = art.turn ? ` rotate(${art.turn} 50 50)` : "";
  const all = art.parts.map(([d]) => d).join("");
  const edge = `<path d="${all}${art.lines ?? ""}" fill="#ffffff" stroke="#ffffff" stroke-width="12" stroke-linejoin="round" stroke-linecap="round"/>`;
  const shadow = `<path d="${all}" fill="none" stroke="rgba(0,0,0,0.18)" stroke-width="15" stroke-linejoin="round"/>`;
  const fills = art.parts.map(([d, f]) => `<path d="${d}" fill="${f}" stroke="${INKY}" stroke-width="3.5" stroke-linejoin="round"/>`).join("");
  const lines = art.lines ? `<path d="${art.lines}" fill="none" stroke="${INKY}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` : "";
  const text = art.text ? `<text x="50" y="${art.text[0] === "!" ? 80 : 66}" font-family="${esc(FONT)}" font-size="${art.text[0] === "+1" ? 44 : 50}" font-weight="800" fill="${art.text[1]}" text-anchor="middle">${esc(art.text[0])}</text>` : "";
  return `<g transform="translate(${n(ox)} ${n(oy)}) scale(${n(s * 1000) / 1000})${turn}">${shadow}${edge}${fills}${lines}${text}</g>`;
}

export const stickerLabel = (id: string) => STICKERS.find((s) => s.id === id)?.label ?? id;

// ── Items ────────────────────────────────────────────────────────────────

function shapeSvg(it: ShapeItem, ctx: RenderContext): string {
  const { body, detail } = shapePath(it.shape, it.x, it.y, it.width, it.height);
  const open = it.fill === "none";
  const fill = it.fill === "none" ? "none" : fillValue(it.fill, "gray");
  const strokeColor = it.stroke ? inkValue(it.stroke, ctx.theme) : open ? inkValue("default", ctx.theme) : null;
  const vec = ctx.cover ? ' vector-effect="non-scaling-stroke"' : "";
  const stroke = strokeColor ? ` stroke="${strokeColor}" stroke-width="2"${it.lineStyle === "dashed" ? ' stroke-dasharray="8 6"' : ""}${vec} stroke-linejoin="round"` : "";
  let out = `<path d="${body}" fill="${fill}"${stroke}/>`;
  if (detail) out += `<path d="${detail}" fill="none" stroke="${strokeColor ?? "rgba(0,0,0,0.28)"}" stroke-width="${strokeColor ? 2 : 1.5}"${vec}/>`;
  if (it.text && ctx.editing !== it.id) {
    const box = textBox(it, ctx.theme);
    out += textSvg(it.text, { ...box, size: it.size, bold: it.bold, italic: it.italic, list: it.list, fill: box.color, clip: true, underline: !!it.link, cover: ctx.cover });
  }
  return out;
}

/** Where an item's text sits (in its own, unrotated frame), how it is aligned and its color: the renderer and the editor share it. */
export function textBox(it: StickyItem | TextItem | ShapeItem, theme: Theme): { x: number; y: number; width: number; height: number; align: Align; middle: boolean; color: string } {
  if (it.kind === "sticky") {
    const [pt, pr, pb, pl] = TEXT_PAD.sticky;
    return { x: it.x + pl, y: it.y + pt, width: it.width - pl - pr, height: it.height - pt - pb, align: it.align ?? "left", middle: false, color: CANVAS[theme].onFill };
  }
  if (it.kind === "text") return { x: it.x, y: it.y, width: it.width, height: it.height, align: it.align ?? "left", middle: false, color: inkValue(it.color, theme) };
  const [fx, fy, fw, fh] = shapeTextBox(it.shape);
  const [pt, pr, pb, pl] = TEXT_PAD.shape;
  const open = it.fill === "none";
  const color = it.color ? inkValue(it.color, open ? theme : "light") : open ? inkValue("default", theme) : CANVAS[theme].onFill;
  return { x: it.x + it.width * fx + pl, y: it.y + it.height * fy + pt, width: Math.max(8, it.width * fw - pl - pr), height: Math.max(8, it.height * fh - pt - pb), align: it.align ?? "center", middle: true, color };
}

/** One item's markup, wrapped in a group carrying its id (and its rotation). */
export function itemSvg(it: BoardItem, ctx: RenderContext): string {
  const t = ctx.theme;
  const c = CANVAS[t];
  let body = "";
  switch (it.kind) {
    case "sticky": {
      body = `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.width)}" height="${n(it.height)}" rx="3" fill="${fillValue(it.color, "yellow")}" stroke="rgba(0,0,0,0.1)"${ctx.cover ? ' vector-effect="non-scaling-stroke"' : ""}/>`;
      const box = textBox(it, t);
      if (ctx.editing !== it.id) body += textSvg(it.text, { ...box, size: it.size, bold: it.bold, italic: it.italic, list: it.list, fill: box.color, clip: true, underline: !!it.link, cover: ctx.cover });
      if (it.author && !ctx.cover) body += `<text x="${n(box.x)}" y="${n(it.y + it.height - 14)}" font-family="${esc(FONT)}" font-size="12" fill="${c.author}">${esc(it.author.length > 40 ? `${it.author.slice(0, 39)}…` : it.author)}</text>`;
      break;
    }
    case "text":
      if (ctx.editing !== it.id) body = textSvg(it.text, { ...textBox(it, t), size: it.size, bold: it.bold, italic: it.italic, list: it.list, fill: inkValue(it.color, t), underline: !!it.link, cover: ctx.cover });
      break;
    case "shape":
      body = shapeSvg(it, ctx);
      break;
    case "frame": {
      const tint = it.color && it.color !== "gray" ? FILL_VALUES[it.color] : null;
      const vec = ctx.cover ? ' vector-effect="non-scaling-stroke"' : "";
      body = `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.width)}" height="${n(it.height)}" rx="20" fill="${c.frame}" stroke="${tint ?? c.frameLine}" stroke-width="${ctx.cover ? 1 : 2.5}"${vec}/>`;
      if (tint) body += `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.width)}" height="${n(it.height)}" rx="20" fill="${tint}" opacity="${t === "dark" ? 0.12 : 0.22}"/>`;
      if (!ctx.cover && ctx.editing !== it.id) {
        const title = it.title || "Frame";
        const fitted = textWidth(title, 14, true) > it.width ? ellipsize(title, it.width, 14, true) : title;
        body += `<text x="${n(it.x + 6)}" y="${n(it.y - 9)}" font-family="${esc(FONT)}" font-size="14" font-weight="600" fill="${c.frameTitle}">${esc(fitted)}</text>`;
      }
      break;
    }
    case "connector":
      body = connectorSvg(it, ctx);
      break;
    case "drawing": {
      const dash = it.lineStyle === "dashed" ? ' stroke-dasharray="10 8"' : "";
      body = `<path d="${strokePath(drawingPoints(it))}" fill="none" stroke="${inkValue(it.color, t)}" stroke-width="4"${dash}${ctx.cover ? ' vector-effect="non-scaling-stroke"' : ""} stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    }
    case "table": {
      const rows = it.cells.length;
      const cols = it.cells[0]?.length ?? 1;
      const rh = it.height / rows;
      const cw = it.width / cols;
      const head = it.color && it.color !== "gray" ? FILL_VALUES[it.color] : c.header;
      const headInk = it.color && it.color !== "gray" ? c.onFill : inkValue("default", t);
      body = `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.width)}" height="${n(it.height)}" rx="6" fill="${c.cell}"/>`;
      body += `<path d="${rrect(it.x, it.y, it.width, rh, 6)}" fill="${head}"/><rect x="${n(it.x)}" y="${n(it.y + rh / 2)}" width="${n(it.width)}" height="${n(rh / 2)}" fill="${head}"/>`;
      let grid = "";
      for (let r = 1; r < rows; r++) grid += `M${n(it.x)} ${n(it.y + r * rh)}H${n(it.x + it.width)}`;
      for (let k = 1; k < cols; k++) grid += `M${n(it.x + k * cw)} ${n(it.y)}V${n(it.y + it.height)}`;
      body += `<path d="${grid}" stroke="${c.cellLine}" stroke-width="1"${ctx.cover ? ' vector-effect="non-scaling-stroke"' : ""}/>`;
      body += `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.width)}" height="${n(it.height)}" rx="6" fill="none" stroke="${c.cellLine}" stroke-width="1.5"${ctx.cover ? ' vector-effect="non-scaling-stroke"' : ""}/>`;
      if (ctx.editing !== it.id) {
        it.cells.forEach((row, r) =>
          row.forEach((cell, k) => {
            if (cell) body += textSvg(cell, { x: it.x + k * cw + 10, y: it.y + r * rh + 4, width: cw - 20, height: rh - 8, size: it.size, bold: r === 0, align: it.align, fill: r === 0 ? headInk : inkValue("default", t), middle: true, clip: true, cover: ctx.cover });
          }),
        );
      }
      break;
    }
    case "sticker":
      body = stickerSvg(it.sticker, it.x, it.y, it.width, it.height);
      break;
    case "image": {
      const href = ctx.asset?.(it.src) ?? null;
      body = href
        ? `<image href="${esc(href)}" x="${n(it.x)}" y="${n(it.y)}" width="${n(it.width)}" height="${n(it.height)}" preserveAspectRatio="xMidYMid meet"/>`
        : `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.width)}" height="${n(it.height)}" rx="6" fill="${c.header}" stroke="${c.cellLine}" stroke-dasharray="6 5"/>`;
      break;
    }
  }
  const rot = "rotation" in it && it.rotation ? ` transform="rotate(${n(it.rotation)} ${n(it.x + it.width / 2)} ${n(it.y + it.height / 2)})"` : "";
  return `<g data-id="${esc(it.id)}"${rot}>${body}</g>`;
}

/** Every item in order, for an SVG of the board (export) or one region of it. */
export function boardSvg(items: readonly BoardItem[], ctx: RenderContext, area: { x: number; y: number; width: number; height: number }, opts: { background?: boolean } = {}): string {
  const bg = opts.background === false ? "" : `<rect x="${n(area.x)}" y="${n(area.y)}" width="${n(area.width)}" height="${n(area.height)}" fill="${CANVAS[ctx.theme].bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(area.x)} ${n(area.y)} ${n(area.width)} ${n(area.height)}" width="${Math.ceil(area.width)}" height="${Math.ceil(area.height)}">${bg}${items.map((it) => itemSvg(it, ctx)).join("")}</svg>`;
}

/** The height of one line of text at `size`, for an editor that must line up with the drawn text. */
export const lineHeightPx = (size: TextStyle["size"]) => Math.round(TEXT_SIZE_PX[size ?? "body"] * LINE_HEIGHT);
