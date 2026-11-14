// Home: the shell's Home, each recent design shown as its first artboard,
// drawn by the same renderer as the canvas.

import { useEffect, useState } from "react";
import { Home as ShellHome, type HomeItem } from "@opendeck/shell";
import { checkIndex, loadBoard, themeOf } from "@opendeck/artboard";
import { api, type RecentDesign } from "../api.ts";
import { chooseDesign, createDesign, openRecent, openRecentInTab } from "../store.ts";
import { Scaled } from "./FocusView.tsx";

function Cover({ recent }: { recent: RecentDesign }) {
  if (!recent.cover) return null;
  const { index } = checkIndex(recent.index, recent.title);
  const board = index.boards[recent.cover.file];
  const doc = board ? loadBoard(recent.cover.file, recent.cover.html, index).doc : null;
  if (!board || !doc) return null;
  return (
    <div className="dg-cover">
      <Scaled file={recent.cover.file} doc={doc} theme={themeOf(index)} width={board.w} height={board.h} mode="fit" />
    </div>
  );
}

export function Home() {
  const [recent, setRecent] = useState<RecentDesign[] | null>(null);
  useEffect(() => {
    void api()
      .recent()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  const items: HomeItem[] | null = recent ? recent.map((r) => ({ root: r.root, title: r.title, edited: r.edited, cover: <Cover recent={r} /> })) : null;

  return (
    <ShellHome
      noun="design"
      nouns="designs"
      items={items}
      onChoose={() => void chooseDesign()}
      onStart={createDesign}
      onOpen={(root, newTab) => (newTab ? openRecentInTab(root) : void openRecent(root))}
      placeholder="Describe a design to make, or press Enter for an empty canvas"
    />
  );
}
