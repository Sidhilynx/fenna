// A bot's pixel face: an inline SVG on a 16 by 16 grid, in a body tone and a
// shade tone from the theme's tokens. The eyes are drawn from the design's
// anchors, so every mood is the same picture with different eyes.

import type { CSSProperties } from "react";
import type { Avatar as AvatarId, AvatarColor, Mood } from "@opendeck/crew";
import { GRID, MASCOT, SPRITES, eyeRects, spriteRects } from "./pixels.ts";

interface AvatarProps {
  avatar: AvatarId;
  color: AvatarColor;
  mood?: Mood;
  size: number;
  title?: string;
}

function Art({ avatar, mood, size, label, style }: { avatar: AvatarId; mood: Mood; size: number; label: string; style: CSSProperties }) {
  const sprite = SPRITES[avatar];
  return (
    <svg className={`av av-${mood}`} width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`} shapeRendering="crispEdges" role="img" aria-label={label} style={style}>
      {spriteRects(sprite).map((r) => (
        <rect key={`${r.x},${r.y},${r.tone}`} className={`av-${r.tone}`} x={r.x} y={r.y} width={r.w} height={r.h} />
      ))}
      <g className="av-eyes">
        {eyeRects(sprite, mood).map((r) => (
          <rect key={r.x} x={r.x} y={r.y} width={r.w} height={r.h} />
        ))}
      </g>
    </svg>
  );
}

export function Avatar({ avatar, color, mood = "idle", size, title }: AvatarProps) {
  const style = { "--av-body": `var(--av-${color})`, "--av-shade": `var(--av-${color}-shade)` } as CSSProperties;
  return <Art avatar={avatar} mood={mood} size={size} label={title ?? avatar} style={style} />;
}

/** The face with the amber dot when the bot is waiting on the person. `ring` outlines it as selected. */
export function Face({ avatar, color, mood = "idle", size, ring = false, title }: AvatarProps & { ring?: boolean }) {
  return (
    <span className={ring ? "face face-ring" : "face"}>
      <Avatar avatar={avatar} color={color} mood={mood} size={size} title={title} />
      {mood === "need" && <span className="face-dot" />}
    </span>
  );
}

/** Crew's own mark for the header: the mascot in the theme's text tones, not a bot's color. */
export function CrewMark({ size }: { size: number }) {
  const style = { "--av-body": "var(--text)", "--av-shade": "var(--text-3)", "--av-ink": "var(--bg)", "--av-mid": "var(--text-2)", "--av-spark": "var(--text)", "--av-glow": "var(--text-3)", "--av-hi": "var(--text)" } as CSSProperties;
  return (
    <svg className="av" width={size} height={size} viewBox={`0 0 ${GRID} ${MASCOT.length}`} shapeRendering="crispEdges" role="img" aria-label="Fenna Crew" style={style}>
      {spriteRects({ rows: MASCOT }).map((r) => (
        <rect key={`${r.x},${r.y},${r.tone}`} className={`av-${r.tone}`} x={r.x} y={r.y} width={r.w} height={r.h} />
      ))}
    </svg>
  );
}
