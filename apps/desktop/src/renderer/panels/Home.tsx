// Fenna Slides' Home: the shell's Home, with decks. Each recent deck is drawn
// from its first slide; a new deck starts from the theme picked here, and
// the words written here wait (unsent) in its assistant.

import { useEffect, useMemo, useState } from "react";
import { type ElementNode, type Theme, STARTERS, checkIndex, parseSlide, valueContext } from "@opendeck/format";
import { type HomeItem, Home as ShellHome, Icon, MenuButton } from "@opendeck/shell";
import { type RecentDeck, api } from "../api.ts";
import { chooseDeck, createDeck, openRecent, openRecentInTab } from "../editor/store.ts";
import { SlideView } from "../SlideView.tsx";

const COVER_W = 48;

interface Cover {
  slide: ElementNode;
  theme: Theme;
}

/** The first slide of a recent deck, ready to draw; null when it can't be shown. */
function coverOf(d: RecentDeck): Cover | null {
  if (!d.cover || !d.index) return null;
  const r = checkIndex(d.index);
  if (!r.index) return null;
  const slide = parseSlide(d.cover, valueContext(r.index)).slide;
  return slide ? { slide, theme: r.index.theme } : null;
}

export function Home() {
  const [recent, setRecent] = useState<RecentDeck[] | null>(null);
  const [starter, setStarter] = useState(STARTERS[0]?.key ?? "");

  useEffect(() => {
    let alive = true;
    void api()
      .recent()
      .then((list) => alive && setRecent([...list].sort((a, b) => b.edited - a.edited)))
      .catch(() => alive && setRecent([]));
    return () => {
      alive = false;
    };
  }, []);

  const items = useMemo<HomeItem[] | null>(
    () =>
      recent?.map((d) => {
        const cover = coverOf(d);
        return { root: d.root, title: d.title, edited: d.edited, cover: cover ? <SlideView slide={cover.slide} theme={cover.theme} width={COVER_W} /> : null };
      }) ?? null,
    [recent],
  );
  const starterLabel = STARTERS.find((s) => s.key === starter)?.label ?? "Theme";

  return (
    <ShellHome
      noun="deck"
      nouns="decks"
      items={items}
      placeholder="What should we make? Describe the deck, or start blank"
      onChoose={() => void chooseDeck()}
      onStart={(title, draft) => createDeck(title, starter, draft)}
      onOpen={(root, newTab) => (newTab ? openRecentInTab(root) : void openRecent(root))}
      composerExtra={
        <MenuButton
          className="hm-btn"
          label="Theme for the new deck"
          entries={() => STARTERS.map((s) => ({ label: s.label, hint: s.description, checked: s.key === starter, onSelect: () => setStarter(s.key) }))}
        >
          {starterLabel} <Icon name="chevronDown" size={12} />
        </MenuButton>
      }
    />
  );
}
