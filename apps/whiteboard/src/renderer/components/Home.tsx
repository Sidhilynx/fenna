// Home: the shell's Home, each recent board shown as a miniature of itself
// (frames, notes and shapes in their colors, text as bars).

import { useEffect, useState } from "react";
import { Home as ShellHome, type HomeItem } from "@opendeck/shell";
import { boundsOf, byId, CANVAS, checkItems, itemSvg, type BoardItem } from "@opendeck/board";
import { api, type RecentBoard } from "../api.ts";
import { chooseBoard, createBoard, openRecent, openRecentInTab } from "../store.ts";
import { useTheme } from "../theme.ts";

function BoardCover({ items }: { items: BoardItem[] }) {
  const theme = useTheme();
  const all = byId(items);
  const b = boundsOf(items, all);
  if (!b) return <svg className="wb-cover" viewBox="0 0 48 27" aria-hidden />;
  // Keep the cover's shape: pad the board's box out to 16:9.
  const pad = Math.max(b.width, b.height) * 0.06;
  let w = b.width + pad * 2;
  let h = b.height + pad * 2;
  if (w / h > 16 / 9) h = (w * 9) / 16;
  else w = (h * 16) / 9;
  const x = b.x + b.width / 2 - w / 2;
  const y = b.y + b.height / 2 - h / 2;
  const svg = items
    .slice(0, 400)
    .map((it) => itemSvg(it, { theme, items: all, cover: true }))
    .join("");
  return (
    <svg className="wb-cover" viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <rect x={x} y={y} width={w} height={h} fill={CANVAS[theme].bg} />
      <g dangerouslySetInnerHTML={{ __html: svg }} />
    </svg>
  );
}

function coverItems(cover: unknown): BoardItem[] | null {
  const list = cover && typeof cover === "object" ? (cover as { items?: unknown }).items : null;
  return Array.isArray(list) ? checkItems(list).items : null;
}

export function Home() {
  const [recent, setRecent] = useState<RecentBoard[] | null>(null);
  useEffect(() => {
    void api()
      .recent()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  const items: HomeItem[] | null = recent
    ? recent.map((r) => {
        const list = coverItems(r.cover);
        return { root: r.root, title: r.title, edited: r.edited, cover: list ? <BoardCover items={list} /> : null };
      })
    : null;

  return (
    <ShellHome
      noun="board"
      nouns="boards"
      items={items}
      onChoose={() => void chooseBoard()}
      onStart={createBoard}
      onOpen={(root, newTab) => (newTab ? openRecentInTab(root) : void openRecent(root))}
      placeholder="Describe a board to make, or press Enter for a blank whiteboard"
    />
  );
}
