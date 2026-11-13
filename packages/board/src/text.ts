// Text layout: how wide a run of text is and where it wraps. One function for
// the canvas, exports, the Home cover and the MCP server, so a sticky wraps
// the same everywhere. Widths are Inter's average advances, close enough to
// the bundled font that edited and drawn text break at the same words.

import { TEXT_SIZE_PX, type TextSize } from "./schema.ts";

const NARROW = new Set("il.,:;!|'`ıj");
const SEMI = new Set("ftrI()[]{}-/\\\" ");
const WIDE_LOWER = new Set("mw");
const WIDE_UPPER = new Set("MW");

/** Advance of one character, in em. */
function advance(ch: string): number {
  if (ch === " ") return 0.26;
  if (NARROW.has(ch)) return 0.26;
  if (SEMI.has(ch)) return 0.36;
  if (WIDE_LOWER.has(ch)) return 0.8;
  if (WIDE_UPPER.has(ch)) return 0.92;
  if (ch >= "0" && ch <= "9") return 0.6;
  if (ch >= "a" && ch <= "z") return 0.54;
  if (ch >= "A" && ch <= "Z") return 0.66;
  const code = ch.codePointAt(0) ?? 0;
  // CJK, kana, hangul and emoji take a full em.
  if (code >= 0x2e80) return 1;
  return 0.6;
}

/** Width of `text` set at `px`, in board units. */
export function textWidth(text: string, px: number, bold = false): number {
  let em = 0;
  for (const ch of text) em += advance(ch);
  return em * px * (bold ? 1.06 : 1);
}

export const LINE_HEIGHT = 1.4;

/**
 * The lines `text` sets in, at most `maxWidth` wide. Lines break at spaces;
 * a word too long for a line breaks between letters. Newlines are kept.
 */
export function wrapText(text: string, maxWidth: number, px: number, bold = false): string[] {
  const out: string[] = [];
  const room = Math.max(px, maxWidth);
  for (const para of text.split("\n")) {
    if (!para) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/(?<= )/)) {
      const tryLine = line + word;
      if (textWidth(tryLine.trimEnd(), px, bold) <= room) {
        line = tryLine;
        continue;
      }
      if (line) out.push(line.trimEnd());
      line = "";
      // A word longer than the line: break it.
      let rest = word;
      while (textWidth(rest.trimEnd(), px, bold) > room) {
        let cut = 1;
        while (cut < rest.length && textWidth(rest.slice(0, cut + 1), px, bold) <= room) cut++;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line.trimEnd());
  }
  return out;
}

export interface TextBlock {
  lines: string[];
  px: number;
  lineHeight: number;
  /** Height of all the lines. */
  height: number;
  /** How many lines fit in the room given; the rest are cut. */
  fits: number;
}

/** Lines of an item's text in a box `width` × `height` (height Infinity: no limit). Bullets take their indent from the width. */
export function layoutText(text: string, opts: { width: number; height?: number; size?: TextSize; bold?: boolean; list?: boolean }): TextBlock {
  const px = TEXT_SIZE_PX[opts.size ?? "body"];
  const indent = opts.list ? px * 1.1 : 0;
  const lineHeight = Math.round(px * LINE_HEIGHT);
  const lines = wrapText(text, opts.width - indent, px, opts.bold);
  const room = opts.height ?? Infinity;
  const fits = Math.max(1, Math.min(lines.length, Math.floor(room / lineHeight)));
  return { lines, px, lineHeight, height: lines.length * lineHeight, fits };
}

/** Insets of text inside each kind, in board units: [top, right, bottom, left]. */
export const TEXT_PAD = {
  sticky: [18, 18, 34, 18],
  shape: [12, 16, 12, 16],
  text: [0, 0, 0, 0],
} as const;
