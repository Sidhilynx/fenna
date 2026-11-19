// Crew's pixel motion: the loading bar, the row of faces on the first
// screens, and the "working" line under a bot's last message. Every
// animation moves in whole pixels (CSS steps) and stops under
// prefers-reduced-motion; the words beside them carry the meaning.

import type { CSSProperties } from "react";
import { AVATARS, AVATAR_COLORS, type Avatar as AvatarId, type AvatarColor } from "@opendeck/crew";
import { Avatar } from "./Avatar.tsx";

const SEGMENTS = 12;

/** An endless loading bar of square segments, filling one block at a time. */
export function PixelLoader() {
  return (
    <span className="px-loader" aria-hidden>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <i key={i} style={{ "--i": i } as CSSProperties} />
      ))}
    </span>
  );
}

const PARADE: { avatar: AvatarId; color: AvatarColor }[] = [0, 3, 6, 9, 12].map((n, i) => ({
  avatar: AVATARS[n % AVATARS.length]!,
  color: AVATAR_COLORS[(i * 2 + 1) % AVATAR_COLORS.length]!,
}));

/** A few bot faces hopping one after another: the crew getting ready. */
export function CrewParade({ size = 32 }: { size?: number }) {
  return (
    <span className="px-parade" aria-hidden>
      {PARADE.map((p, i) => (
        <span key={p.avatar} className="px-hop" style={{ "--i": i } as CSSProperties}>
          <Avatar avatar={p.avatar} color={p.color} mood="work" size={size} />
        </span>
      ))}
    </span>
  );
}

/** Three blocks lighting in turn: the bot is thinking or typing. */
export function PixelDots() {
  return (
    <span className="px-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}
