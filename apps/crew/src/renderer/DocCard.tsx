// A document a bot made or changed, shown under its reply in the chat. The
// card and its Open button both open the document in the bot's computer.

import type { LibraryKind } from "@opendeck/crew";
import type { LibraryItem } from "../shared/contract.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import { useCrew } from "./crew.tsx";
import { KIND_ICON } from "./pixelIcons.ts";
import { clock } from "./util.ts";

/** The kind's name on a card: "Slides", not "Deck". */
export const CARD_KIND: Record<LibraryKind, string> = { doc: "Doc", sheet: "Sheet", deck: "Slides", board: "Whiteboard", design: "Design" };

export function DocCard({ slug, item }: { slug: string; item: LibraryItem }) {
  const { go } = useCrew();
  const open = () => go({ name: "computer", slug, open: item.path });
  return (
    <div className="doc-card">
      <button type="button" className="doc-card-main" onClick={open} title={`Open ${item.title}`}>
        <span className="lib-icon" aria-hidden>
          <PixelIcon name={KIND_ICON[item.kind]} />
        </span>
        <span className="doc-card-text">
          <span className="doc-card-title ell">{item.title}</span>
          <span className="doc-card-meta">
            {CARD_KIND[item.kind]} · Edited {clock(item.edited)}
          </span>
        </span>
      </button>
      <button type="button" className="btn small" onClick={open} aria-label={`Open ${item.title}`}>
        Open
      </button>
    </div>
  );
}

/** The cards for one reply, in the chat's column. */
export function DocCards({ slug, items, indent }: { slug: string; items: LibraryItem[]; indent: "chat" | "dock" }) {
  return (
    <div className={`doc-cards ${indent}`}>
      {items.map((item) => (
        <DocCard key={item.path} slug={slug} item={item} />
      ))}
    </div>
  );
}
