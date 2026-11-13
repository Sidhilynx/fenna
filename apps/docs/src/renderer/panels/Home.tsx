// Fenna Docs' Home: the shell's Home, with docs. Each recent doc is drawn from
// the first lines of its first tab; the words written here wait (unsent) in
// the new doc's chat.

import { useEffect, useMemo, useState } from "react";
import { type ElementNode, checkIndex, docContext, parseTab, textOf } from "@opendeck/doc";
import { type HomeItem, Home as ShellHome } from "@opendeck/shell";
import { type RecentDoc, api } from "../api.ts";
import { chooseDoc, createDoc, openRecent, openRecentInTab } from "../store.ts";

/** A tiny page: the first tab's title and first few lines. */
function Cover({ d }: { d: RecentDoc }) {
  const index = checkIndex(d.index).index;
  const tab = d.cover && index ? parseTab(d.cover, docContext(index)).tab : null;
  const lines = ((tab?.children ?? []) as ElementNode[]).slice(0, 4).map((b) => textOf(b).replace(/\s+/g, " ").trim()).filter(Boolean);
  return (
    <span className="hm-doc-cover" aria-hidden>
      <span className="hm-doc-title">{d.coverTitle || d.title}</span>
      {lines.map((l, i) => (
        <span key={i} className="hm-doc-line">
          {l}
        </span>
      ))}
    </span>
  );
}

export function Home() {
  const [recent, setRecent] = useState<RecentDoc[] | null>(null);
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
  const items = useMemo<HomeItem[] | null>(() => recent?.map((d) => ({ root: d.root, title: d.title, edited: d.edited, cover: <Cover d={d} /> })) ?? null, [recent]);
  return (
    <ShellHome
      noun="doc"
      nouns="docs"
      items={items}
      placeholder="What should we write? Describe the doc, or start blank"
      onChoose={() => void chooseDoc()}
      onStart={(title, draft) => createDoc(title, draft)}
      onOpen={(root, newTab) => (newTab ? openRecentInTab(root) : void openRecent(root))}
    />
  );
}
