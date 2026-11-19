// Choosing a bot's face: a button showing the face, and a popover with every
// design in the chosen color, the colors, and Shuffle.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { AVATARS, AVATAR_COLORS, type Avatar as AvatarId, type AvatarColor, type Mood } from "@opendeck/crew";
import { Avatar, Face } from "./Avatar.tsx";
import { useCrew } from "./crew.tsx";

const COLUMNS = 8;

export interface FaceChoice {
  avatar: AvatarId;
  color: AvatarColor;
}

/** "Lantern, ochre": what the face is called in tooltips and labels. */
export function faceName(avatar: AvatarId, color: AvatarColor): string {
  return `${avatar.charAt(0).toUpperCase()}${avatar.slice(1)}, ${color}`;
}

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

/** A random design no bot has while one is free, in the color the fewest bots have. */
export function suggestFace(used: readonly FaceChoice[]): FaceChoice {
  const free = AVATARS.filter((a) => !used.some((u) => u.avatar === a));
  const count = (c: AvatarColor) => used.filter((u) => u.color === c).length;
  const least = Math.min(...AVATAR_COLORS.map(count));
  return { avatar: pick(free.length ? free : AVATARS), color: pick(AVATAR_COLORS.filter((c) => count(c) === least)) };
}

/** Moves a radio selection with the arrow keys; returns the new index, or null for other keys. */
function step(e: KeyboardEvent, i: number, n: number, columns: number): number | null {
  const by = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? columns : e.key === "ArrowUp" ? -columns : 0;
  if (!by) return null;
  e.preventDefault();
  const next = i + by;
  if (next >= 0 && next < n) return next;
  return Math.abs(by) === 1 ? (next + n) % n : i;
}

export function FaceButton({ avatar, color, mood = "idle", size, onChange }: { avatar: AvatarId; color: AvatarColor; mood?: Mood; size: number; onChange(next: FaceChoice): void }) {
  const { overview } = useCrew();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const name = faceName(avatar, color);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) {
      setAt(null);
      return;
    }
    const b = button.current?.getBoundingClientRect();
    const p = pop.current?.getBoundingClientRect();
    if (!b || !p) return;
    const below = b.bottom + 6 + p.height <= window.innerHeight - 8;
    setAt({
      left: Math.max(8, Math.min(b.left, window.innerWidth - p.width - 8)),
      top: below ? b.bottom + 6 : Math.max(8, b.top - 6 - p.height),
    });
    pop.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const choose = (next: FaceChoice, focus: string) => {
    onChange(next);
    requestAnimationFrame(() => pop.current?.querySelector<HTMLElement>(`[data-face="${focus}"]`)?.focus());
  };

  return (
    <>
      <button ref={button} type="button" className="face-btn" aria-label={`Face: ${name}`} title={name} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Face avatar={avatar} color={color} mood={mood} size={size} />
      </button>
      {open && (
        <div
          ref={pop}
          className="face-pop"
          role="dialog"
          aria-label="Choose a face"
          style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: "hidden" }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            } else if (e.key === "Tab") {
              e.preventDefault();
              close();
            }
          }}
        >
          <div className="face-grid" role="radiogroup" aria-label="Design">
            {AVATARS.map((a, i) => (
              <button
                key={a}
                type="button"
                role="radio"
                data-face={a}
                className="face-opt"
                aria-checked={a === avatar}
                aria-label={faceName(a, color)}
                title={faceName(a, color)}
                tabIndex={a === avatar ? 0 : -1}
                onClick={() => onChange({ avatar: a, color })}
                onKeyDown={(e) => {
                  const j = step(e, i, AVATARS.length, COLUMNS);
                  if (j !== null && j !== i) choose({ avatar: AVATARS[j]!, color }, AVATARS[j]!);
                }}
              >
                <Avatar avatar={a} color={color} size={32} />
              </button>
            ))}
          </div>
          <div className="face-colors" role="radiogroup" aria-label="Color">
            {AVATAR_COLORS.map((c, i) => (
              <button
                key={c}
                type="button"
                role="radio"
                data-face={c}
                className="face-color"
                style={{ "--sw": `var(--av-${c})` } as CSSProperties}
                aria-checked={c === color}
                aria-label={c}
                title={c}
                tabIndex={c === color ? 0 : -1}
                onClick={() => onChange({ avatar, color: c })}
                onKeyDown={(e) => {
                  const j = step(e, i, AVATAR_COLORS.length, 1);
                  if (j !== null && j !== i) choose({ avatar, color: AVATAR_COLORS[j]! }, AVATAR_COLORS[j]!);
                }}
              />
            ))}
          </div>
          <button type="button" className="btn ghost face-shuffle" onClick={() => onChange(suggestFace(overview.bots))}>
            Shuffle
          </button>
        </div>
      )}
    </>
  );
}
