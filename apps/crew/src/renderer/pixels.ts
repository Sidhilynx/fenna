// The pixel art of Crew's bot faces: sixteen characters on a 16 by 16 grid.
// '.' empty, 'b' body, 's' shade (lower-right edge and details), 'k' ink.
// Eyes are not drawn here: each design says where they sit, and the moods are
// made from that in code.

import type { Avatar, Mood } from "@opendeck/crew";

export const GRID = 16;

export interface Sprite {
  rows: readonly string[];
  /** Top row of both eyes, and the left column of each. Both 2 by 2 blocks lie on body pixels. */
  eyes: { y: number; xs: readonly [number, number] };
}

export const SPRITES: Record<Avatar, Sprite> = {
  sprout: {
    rows: [
      "................",
      "..bbb......bbb..",
      ".bbbbbs..bbbbbs.",
      ".bbbbbbs.bbbbbs.",
      "..sbbbbsssbbbs..",
      "....ssss.ss.....",
      ".......ss.......",
      ".......ss.......",
      "..bbbbbbbbbbbs..",
      "..bbbbbbbbbbbs..",
      "...bbbbbbbbbs...",
      "...bbbbbbbbbs...",
      "...bbbbbbbbbs...",
      "...bbbbbbbbss...",
      "...bbbbbbbbss...",
      "....ssssssss....",
    ],
    eyes: { y: 10, xs: [5, 9] },
  },
  pebble: {
    rows: [
      "................",
      "................",
      "................",
      "....bbbbb..bbb..",
      "..bbbbbbbb.bbbb.",
      ".bbbbbbbbbsbbbbs",
      ".bbbbbbbbbbbbbbs",
      "bbbbbbbbbbbbbbbs",
      "bbbbbbbbbbbbbbbs",
      "bbbsbbbbbbbbbbbs",
      "bbbbbbbbbbbbbbss",
      ".bbbbbbbbbbbbsss",
      ".sbbbbbbbbbsssss",
      "..sssssssssssss.",
      "................",
      "................",
    ],
    eyes: { y: 7, xs: [4, 10] },
  },
  lantern: {
    rows: [
      "......ssss......",
      ".....s....s.....",
      ".....s....s.....",
      "....ssssssss....",
      "...ssssssssss...",
      "..kbbbbbbbbbbk..",
      "..kbbbbbbbbbbk..",
      "..kbbbbbbbbbbk..",
      "..kbbbbbbbbbbk..",
      "..kbbbbbbbbbsk..",
      "..kbbbbbbbbbsk..",
      "..kbbbbbbbbbsk..",
      "..ssssssssssss..",
      ".ssssssssssssss.",
      "....ss....ss....",
      "................",
    ],
    eyes: { y: 7, xs: [5, 9] },
  },
  kettle: {
    rows: [
      "................",
      ".......ss.......",
      "......ssss......",
      "....bbbbbbbb....",
      "...ssssssssss...",
      "b.bbbbbbbbbbssss",
      "bbbbbbbbbbbbs.ss",
      ".bbbbbbbbbbbs.ss",
      "..bbbbbbbbbbs.ss",
      "..bbbbbbbbbbssss",
      "..bbbbbbbbbbss..",
      "...bbbbbbbbss...",
      "...bbbbbbbbss...",
      "....ssssssss....",
      "................",
      "................",
    ],
    eyes: { y: 6, xs: [4, 8] },
  },
  moth: {
    rows: [
      "................",
      "....s......s....",
      ".....s....s.....",
      "..bb..s..s..bb..",
      ".bbbb.bbbb.bbbbs",
      "bbbbbbbbbbbbbbbs",
      "bbssbbbbbbbbssbs",
      "bbssbbbbbbbbssbs",
      ".bbbbbbbbbbbbbs.",
      ".bbbbbbbbbbbbss.",
      "..bbbb.bb.bbss..",
      "...bbb.bb.bbs...",
      "....bs.bb.sb....",
      ".......ss.......",
      "................",
      "................",
    ],
    eyes: { y: 5, xs: [6, 9] },
  },
  owl: {
    rows: [
      ".b............b.",
      ".bb..........bb.",
      "..bbbbbbbbbbbb..",
      ".bbbbbbbbbbbbbb.",
      ".bbssssbbssssbbs",
      ".bbsbbsbbsbbsbbs",
      ".bbsbbsbbsbbsbbs",
      ".bbsssskkssssbbs",
      ".bbbbbbbbbbbbbbs",
      ".bbbsbbbsbbbsbbs",
      "..bbbsbbbsbbbsbs",
      "..bbbbsbbbsbbbss",
      "...bbbbbbbbbbss.",
      "....ssssssssss..",
      "....ss......ss..",
      "................",
    ],
    eyes: { y: 5, xs: [4, 10] },
  },
  rover: {
    rows: [
      ".......bb.......",
      ".......ss.......",
      ".......ss.......",
      "..bbbbbbbbbbbb..",
      ".bbbbbbbbbbbbbs.",
      ".bbbbbbbbbbbbbs.",
      ".bbbbbbbbbbbbbs.",
      ".bbbbbbbbbbbbbs.",
      ".bbbbbbbbbbbbbs.",
      ".bbssssssssbbbs.",
      ".bbbbbbbbbbbbss.",
      "..ssssssssssss..",
      "..ssss....ssss..",
      "..sbbs....sbbs..",
      "..ssss....ssss..",
      "................",
    ],
    eyes: { y: 5, xs: [4, 10] },
  },
  kite: {
    rows: [
      ".......ss.......",
      "......bssb......",
      ".....bbssbb.....",
      "....bbbssbbb....",
      "...bbbbssbbbb...",
      "..bbbbbssbbbbs..",
      ".ssssssssssssss.",
      "..bbbbbssbbbbs..",
      "...bbbbssbbbs...",
      "....bbbssbbs....",
      ".....bbssbs.....",
      "......ss........",
      ".....sbb........",
      "....bbs.........",
      ".....sbb........",
      "....s...........",
    ],
    eyes: { y: 4, xs: [4, 10] },
  },
  cactus: {
    rows: [
      "................",
      ".....bbbbbb.....",
      "....bbbbbbbb....",
      "....bbbbbbbs.bs.",
      ".bs.bbbbbbbs.bs.",
      ".bs.bbbbbbbs.bs.",
      ".bs.bbbbbbbsbbs.",
      ".bs.bbbbbbbs....",
      ".bbbbbbbbbbs....",
      "...sbbsbbbbs....",
      "....bbbbbbbs....",
      "....bbbbbsbs....",
      "....bbbbbbss....",
      "...ssssssssss...",
      "................",
      "................",
    ],
    eyes: { y: 4, xs: [5, 9] },
  },
  octo: {
    rows: [
      "................",
      "................",
      "....bbbbbbbb....",
      "...bbbbbbbbbb...",
      "..bbbbbbbbbbbb..",
      "..bbbbbbbbbbbbs.",
      "..bbbbbbbbbbbbs.",
      "..bbbbbbbbbbbbs.",
      "..bbbbbbbbbbbbs.",
      "..bbbbbbbbbbbss.",
      ".bs..bs..bs..bs.",
      ".bs..bs..bs..bs.",
      "bs...bs..sb...sb",
      "s....s....s....s",
      "................",
      "................",
    ],
    eyes: { y: 5, xs: [4, 10] },
  },
  beacon: {
    rows: [
      ".......ss.......",
      "......ssss......",
      "....ssssssss....",
      "...ssssssssss...",
      "..sbbbbbbbbbbs..",
      "..sbbbbbbbbbbs..",
      "..sbbbbbbbbbbs..",
      "..sbbbbbbbbbbs..",
      "..sbbbbbbbbbss..",
      "ssssssssssssssss",
      ".....bbbbbs.....",
      ".....bbbbbs.....",
      "...ssssssssss...",
      "...bbbbbbbbbs...",
      "...bbbbbbbbbs...",
      ".ssssssssssssss.",
    ],
    eyes: { y: 5, xs: [4, 10] },
  },
  acorn: {
    rows: [
      ".......ss.......",
      ".......ss.......",
      "...ssssssssss...",
      "..ssbsbsbsbsss..",
      "..sbsbsbsbsbss..",
      "..ssssssssssss..",
      "...bbbbbbbbbbs..",
      "...bbbbbbbbbbs..",
      "...bbbbbbbbbbs..",
      "...bbbbbbbbbbs..",
      "....bbbbbbbbs...",
      "....bbbbbbbss...",
      ".....bbbbbss....",
      "......bbbss.....",
      ".......bss......",
      "................",
    ],
    eyes: { y: 7, xs: [5, 9] },
  },
  comet: {
    rows: [
      "................",
      ".........bbbb...",
      "........bbbbbb..",
      ".......bbbbbbbs.",
      ".......bbbbbbbs.",
      ".....ssbbbbbbbs.",
      "...ss..bbbbbbss.",
      ".ss...ssbbbbss..",
      "....ss...ssss...",
      "..ss...ss.......",
      "ss...ss.........",
      "...ss...........",
      "................",
      "................",
      "................",
      "................",
    ],
    eyes: { y: 4, xs: [8, 12] },
  },
  shell: {
    rows: [
      "................",
      "........ssss....",
      ".......ssbbbss..",
      "......ssbsssbss.",
      ".bbb..sbsbbbsbs.",
      "bbbbbb.sbsbsbsbs",
      "bbbbbbbsbsbbbsbs",
      "bbbbbbbsbbsssbss",
      "bbbbbbbbssbbbbss",
      "bbbbbbbbbsssssss",
      "bbbbbbbbbbbbbbbs",
      ".bbbbbbbbbbbbbss",
      "..ssssssssssssss",
      "................",
      "................",
      "................",
    ],
    eyes: { y: 6, xs: [1, 4] },
  },
  cloud: {
    rows: [
      "................",
      "................",
      "......bbbb......",
      "....bbbbbbb.....",
      "...bbbbbbbbb.bb.",
      "..bbbbbbbbbbbbbs",
      ".bbbbbbbbbbbbbbs",
      ".bbbbbbbbbbbbbbs",
      "bbbbbbbbbbbbbbbs",
      "bbbbbbbbbbbbbbss",
      "bbbbbbbbbbbbbsss",
      ".sbbbbbbbbbbssss",
      "..sssssssssssss.",
      "................",
      "................",
      "................",
    ],
    eyes: { y: 7, xs: [4, 10] },
  },
  crate: {
    rows: [
      "................",
      "................",
      ".bbbbbbbbbbbbbb.",
      ".bkbbbbbbbbbbkb.",
      ".bbbbbbbbbbbbbs.",
      ".ssssssssssssss.",
      ".bbbbbbbbbbbbbs.",
      ".bbbbbbbbbbbbbs.",
      ".bbbbbbbbbbbbbs.",
      ".bbbbbbbbbbbbbs.",
      ".ssssssssssssss.",
      ".bbbbbbbbbbbbbs.",
      ".bkbbbbbbbbbkbs.",
      ".bbbbbbbbbbbbss.",
      ".ssssssssssssss.",
      "................",
    ],
    eyes: { y: 7, xs: [4, 10] },
  },
};

/**
 * Crew's own mascot: a head with ear-pods and a lamp on a short stem. Not one
 * of the bots' faces: its eyes are drawn in ('k'), and the lamp (a, with glow o
 * and highlight y) is the only amber. 15 columns wide, 17 rows, centered on column 7.
 */
export const MASCOT: readonly string[] = [
  "......aaa.......",
  ".....ayaaa......",
  ".....aaaao......",
  "......aoo.......",
  ".......s........",
  "....bbbbbbb.....",
  "..bbbbbbbbbbm...",
  ".bbkkkbbbkkkbm..",
  "mbbkbkbbbkbkbmm.",
  "mbbkkkbbbkkkbmm.",
  "mbbkkkbbbkkkbms.",
  "sbbbbbbbbbbbbms.",
  ".bbsbbbbbbbsbm..",
  ".bbbbbkbkbbbbm..",
  ".bbbbbbkbbbbms..",
  "..mmmmmmmmmms...",
  "...sssssssss....",
];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Body, shade, ink; the mascot adds a mid shade (m) and its lamp: bulb (a), glow (o), highlight (y). */
export type Tone = "b" | "m" | "s" | "k" | "a" | "o" | "y";
export interface ToneRect extends Rect {
  tone: Tone;
}

/** The sprite as rectangles: horizontal runs per row, then identical runs on consecutive rows joined. */
export function spriteRects(sprite: { rows: readonly string[] }): ToneRect[] {
  const out: ToneRect[] = [];
  const open = new Map<string, ToneRect>();
  sprite.rows.forEach((row, y) => {
    const seen = new Set<string>();
    let x = 0;
    while (x < row.length) {
      const c = row[x] as string;
      let end = x;
      while (end < row.length && row[end] === c) end++;
      if ("bmskaoy".includes(c)) {
        const key = `${c}${x}:${end - x}`;
        seen.add(key);
        const above = open.get(key);
        if (above && above.y + above.h === y) above.h++;
        else {
          const r: ToneRect = { x, y, w: end - x, h: 1, tone: c as Tone };
          out.push(r);
          open.set(key, r);
        }
      }
      x = end;
    }
    for (const key of [...open.keys()]) if (!seen.has(key)) open.delete(key);
  });
  return out;
}

/** The eyes for a mood: resting is 1 by 2, asleep a line one pixel lower, needing 2 by 2. Working draws resting eyes; CSS moves them. */
export function eyeRects(sprite: Sprite, mood: Mood): Rect[] {
  const { y, xs } = sprite.eyes;
  return xs.map((x) => {
    if (mood === "sleep") return { x, y: y + 1, w: 2, h: 1 };
    if (mood === "need") return { x, y, w: 2, h: 2 };
    return { x, y, w: 1, h: 2 };
  });
}
