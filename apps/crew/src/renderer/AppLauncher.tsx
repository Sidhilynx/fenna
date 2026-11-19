// The start screen of a Fenna app on a bot's desktop: its name and use, a New
// button, and the bot's documents of this kind, newest first. The window frame
// (title bar and close button) is drawn by the desktop around this body.

import { useRef, useState, type KeyboardEvent } from "react";
import { FENNA_APPS, type FennaAppId, type LibraryKind } from "@opendeck/crew";
import { errorText, invoke } from "../shared/api.ts";
import type { BotSummary, LibraryItem } from "../shared/contract.ts";
import { FileIcon } from "./FileIcon.tsx";
import { appIconFor } from "./fileIcons.ts";
import { useBotDetail } from "./crew.tsx";
import { when } from "./util.ts";

/** The word for one kind of document in buttons and empty states. */
export const KIND_NOUN: Record<LibraryKind, string> = { doc: "doc", sheet: "sheet", deck: "deck", board: "whiteboard", design: "design" };

/** The documents of one kind, newest edit first. Returns a new list; the library is not changed. */
export function kindNewestFirst(library: LibraryItem[], kind: LibraryKind): LibraryItem[] {
  const time = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : t;
  };
  return library.filter((f) => f.kind === kind).sort((a, b) => time(b.edited) - time(a.edited));
}

/** The title the person typed, trimmed; an empty one becomes "Untitled <noun>". */
export function newDocTitle(typed: string, kind: LibraryKind): string {
  return typed.trim() || `Untitled ${KIND_NOUN[kind]}`;
}

// An empty folder, drawn one pixel at a time on a 14 by 7 grid.
const EMPTY_FOLDER = ["xxxxx..........", "x...xxxxxxxxxx", "x............x", "x............x", "x............x", "x............x", "xxxxxxxxxxxxxx"];
const EMPTY_PIXELS = EMPTY_FOLDER.flatMap((row, y) => [...row].flatMap((c, x) => (c === "x" ? [{ x, y }] : [])));

function EmptyArt() {
  return (
    <svg className="app-launcher-art" width="56" height="28" viewBox="0 0 14 7" shapeRendering="crispEdges" aria-hidden="true">
      {EMPTY_PIXELS.map((p) => (
        <rect key={`${p.x},${p.y}`} x={p.x} y={p.y} width={1} height={1} />
      ))}
    </svg>
  );
}

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

export function AppLauncher({ bot, app, onOpenDoc }: { bot: BotSummary; app: FennaAppId; onOpenDoc(path: string): void }) {
  const meta = FENNA_APPS.find((a) => a.id === app)!;
  const kind = meta.kind;
  const noun = KIND_NOUN[kind];
  const { detail } = useBotDetail(bot);
  const docs = kindNewestFirst(detail?.library ?? [], kind);

  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const cards = useRef<(HTMLButtonElement | null)[]>([]);

  const create = () => {
    if (busy) return;
    setBusy(true);
    setFailed("");
    invoke("crew:newDoc", bot.slug, kind, newDocTitle(title, kind))
      .then(({ path }) => {
        setBusy(false);
        onOpenDoc(path);
      })
      .catch((e) => {
        setBusy(false);
        setFailed(errorText(e));
      });
  };

  const cancel = () => {
    setNaming(false);
    setTitle("");
    setFailed("");
  };

  // Arrow keys move between the cards; the New button and its field come first in the tab order.
  const onCardKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = STEP[e.key];
    if (!step) return;
    e.preventDefault();
    const at = cards.current.indexOf(e.currentTarget);
    cards.current[at + step]?.focus();
  };

  return (
    <div className="app-launcher">
      <header className="app-launcher-head">
        <span className="app-launcher-icon">
          <FileIcon name={appIconFor(app)} size={48} />
        </span>
        <div className="app-launcher-id">
          <h2 className="app-launcher-name">{meta.name}</h2>
          <p className="app-launcher-use">{meta.use.split(" Not for ")[0]}</p>
        </div>
      </header>

      <div className="app-launcher-new">
        {naming ? (
          <form
            className="app-launcher-form"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <input
              className="field"
              aria-label="Title"
              placeholder={`Untitled ${noun}`}
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancel();
              }}
            />
            <button type="submit" className="btn primary" disabled={busy}>
              Create
            </button>
          </form>
        ) : (
          <button type="button" className="btn primary" onClick={() => setNaming(true)}>
            New {noun}
          </button>
        )}
        {failed && (
          <p className="app-launcher-error" role="alert">
            {failed}
          </p>
        )}
      </div>

      {detail &&
        (docs.length ? (
          <div className="app-launcher-cards">
            {docs.map((f, i) => (
              <button
                key={f.path}
                ref={(el) => {
                  cards.current[i] = el;
                }}
                type="button"
                className="app-launcher-card"
                onClick={() => onOpenDoc(f.path)}
                onKeyDown={onCardKey}
              >
                <span className="app-launcher-card-title ell">{f.title}</span>
                <span className="app-launcher-card-meta">Edited {when(f.edited)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="app-launcher-empty">
            <EmptyArt />
            <p className="hint">No {noun}s yet.</p>
          </div>
        ))}
    </div>
  );
}
