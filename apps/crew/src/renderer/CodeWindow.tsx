// The Code window on a bot's computer: a folder tree on the left (one root,
// Files by default), and the selected file on the right with its line numbers.
// The lines the bot changed in the last 15 minutes get a quiet bar, and the
// window follows the bot's edits: when it changes the open file, the view
// reloads; when it changes another file and the person has not clicked for
// 10 seconds, the window switches to that file (Follow, on by default).
// Body only: the window frame is drawn by the desktop.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { BotSummary, DiskEntry, RecentEdit } from "../shared/contract.ts";
import { errorText, invoke, on } from "../shared/api.ts";
import { FileIcon } from "./FileIcon.tsx";
import { fileIconFor } from "./fileIcons.ts";
import { stepIndex } from "./diskPaths.ts";
import { linesIn, NumberedText, readText, useDiskUrl } from "./Viewers.tsx";

/** How long the person must leave the window alone before the Code window follows the bot to another file. */
const FOLLOW_IDLE_MS = 10_000;
const CLOCK_MS = 15_000;

interface Row {
  entry: DiskEntry;
  depth: number;
  isOpen: boolean;
}

const agoText = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000);
  return minutes < 1 ? "just now" : `${minutes} min ago`;
};

/** The row above `index` one level up (its folder), or -1 at the top. */
function parentIndex(rows: readonly Row[], index: number): number {
  const depth = rows[index]?.depth ?? 0;
  for (let i = index - 1; i >= 0; i--) if (rows[i]!.depth < depth) return i;
  return -1;
}

export interface CodeWindowProps {
  bot: BotSummary;
  /** The disk root the tree starts at: Files, Downloads or Documents. */
  root: string;
}

export function CodeWindow({ bot, root }: CodeWindowProps) {
  const slug = bot.slug;
  const [listing, setListing] = useState<Record<string, DiskEntry[]>>({});
  const [expanded, setExpanded] = useState<string[]>([]);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [focus, setFocus] = useState(root);
  const [open, setOpen] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [edits, setEdits] = useState<RecentEdit[]>([]);
  const [follow, setFollow] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const touched = useRef(0);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  // The latest values, read by the event listeners that outlive a render.
  const openRef = useRef(open);
  const followRef = useRef(follow);
  const editsRef = useRef(edits);
  const expandedRef = useRef(expanded);
  useEffect(() => {
    openRef.current = open;
    followRef.current = follow;
    editsRef.current = edits;
    expandedRef.current = expanded;
  }, [open, follow, edits, expanded]);

  const touch = () => {
    touched.current = Date.now();
  };

  const loadDir = useCallback(
    (dir: string) =>
      invoke("crew:disk", slug, dir).then(
        (r) => {
          setTreeError(null);
          setListing((prev) => ({ ...prev, [dir]: r.entries }));
        },
        (e) => setTreeError(errorText(e)),
      ),
    [slug],
  );

  // The tree: the root and every open folder, listed again when the disk changes.
  useEffect(() => {
    const reloadAll = () => {
      void loadDir(root);
      for (const dir of expandedRef.current) void loadDir(dir);
    };
    reloadAll();
    return on("crew:disk", (p) => {
      if (p.slug === slug) reloadAll();
    });
  }, [slug, root, loadDir]);

  // The bot's edits: keep the list current, reload the open file when it changed, and follow the newest edit.
  useEffect(() => {
    let live = true;
    const refresh = async (fromEvent: boolean) => {
      const list = await invoke("crew:edits", slug).catch(() => null);
      if (!live || !list) return;
      const before = editsRef.current.find((e) => e.path === openRef.current);
      const after = list.find((e) => e.path === openRef.current);
      if (after && after.at !== before?.at) setVersion((v) => v + 1);
      setEdits(list);
      const latest = list[0];
      if (fromEvent && followRef.current && latest && latest.path !== openRef.current && Date.now() - touched.current > FOLLOW_IDLE_MS) {
        setOpen(latest.path);
      }
    };
    void refresh(false);
    const off = on("crew:edits", (p) => {
      if (p.slug === slug) void refresh(true);
    });
    return () => {
      live = false;
      off();
    };
  }, [slug]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(t);
  }, []);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (dir: string, depth: number) => {
      for (const entry of listing[dir] ?? []) {
        const isOpen = entry.kind === "folder" && expanded.includes(entry.path);
        out.push({ entry, depth, isOpen });
        if (isOpen) walk(entry.path, depth + 1);
      }
    };
    walk(root, 0);
    return out;
  }, [listing, expanded, root]);

  const focusIndex = rows.findIndex((r) => r.entry.path === focus);
  const tabPath = focusIndex >= 0 ? focus : rows[0]?.entry.path;

  const toggle = (path: string, isOpen: boolean) => {
    if (isOpen) {
      setExpanded((x) => x.filter((p) => p !== path));
    } else {
      setExpanded((x) => [...x, path]);
      void loadDir(path);
    }
  };

  const pick = (path: string) => {
    setOpen(path);
  };

  const activate = (row: Row) => {
    if (row.entry.kind === "folder") toggle(row.entry.path, row.isOpen);
    else pick(row.entry.path);
  };

  const moveTo = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setFocus(row.entry.path);
    itemRefs.current.get(row.entry.path)?.focus();
  };

  const onTreeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = Math.max(0, focusIndex);
    const row = rows[i];
    if (!row) return;
    const folder = row.entry.kind === "folder";
    const next = rows[i + 1];
    switch (e.key) {
      case "ArrowDown":
        moveTo(stepIndex(rows.length, i, 1));
        break;
      case "ArrowUp":
        moveTo(stepIndex(rows.length, i, -1));
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(rows.length - 1);
        break;
      case "ArrowRight":
        if (folder && !row.isOpen) toggle(row.entry.path, false);
        else if (folder && next && next.depth > row.depth) moveTo(i + 1);
        break;
      case "ArrowLeft":
        if (folder && row.isOpen) toggle(row.entry.path, true);
        else if (parentIndex(rows, i) >= 0) moveTo(parentIndex(rows, i));
        break;
      case "Enter":
      case " ":
        activate(row);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const current = open ? edits.find((e) => e.path === open) : undefined;
  const changed = useMemo(() => linesIn(current?.lines ?? []), [current]);
  const listed = root in listing;

  return (
    <div className="cw" role="group" aria-label="Code" onPointerDownCapture={touch} onKeyDownCapture={touch}>
      <div className="cw-tree" role="tree" aria-label={`${root}, the bot's files`} onKeyDown={onTreeKey}>
        {treeError && <p className="cw-note">{treeError}</p>}
        {listed && rows.length === 0 && !treeError && <p className="cw-note">Nothing in {root} yet.</p>}
        {rows.map(({ entry, depth, isOpen }) => {
          const path = entry.path;
          const folder = entry.kind === "folder";
          const selected = !folder && open === path;
          return (
            <div
              key={path}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={folder ? isOpen : undefined}
              aria-selected={selected}
              tabIndex={path === tabPath ? 0 : -1}
              title={entry.name}
              ref={(el) => {
                if (el) itemRefs.current.set(path, el);
                else itemRefs.current.delete(path);
              }}
              className={`cw-row${selected ? " is-open" : ""}`}
              style={{ "--depth": depth } as CSSProperties}
              onFocus={() => setFocus(path)}
              onClick={() => {
                setFocus(path);
                activate({ entry, depth, isOpen });
              }}
            >
              <span className={`cw-caret${folder ? "" : " is-spacer"}${isOpen ? " is-open" : ""}`} aria-hidden="true" />
              <FileIcon name={folder ? (isOpen ? "folder-open" : "folder") : fileIconFor(entry.kind)} size={16} />
              <span className="cw-name">{entry.name}</span>
            </div>
          );
        })}
      </div>

      <div className="cw-view">
        <div className="cw-bar">
          <span className="cw-path" title={open ?? undefined}>{open ?? "No file open"}</span>
          <button type="button" className="cw-follow" aria-pressed={follow} onClick={() => setFollow((f) => !f)}>
            Follow
          </button>
        </div>
        {current && <p className="cw-changed">{`Changed by ${bot.name} ${agoText(now - Date.parse(current.at))}`}</p>}
        {open ? (
          <CodeFile key={open} slug={slug} path={open} changed={changed} version={version} />
        ) : (
          <p className="vw-note">Pick a file on the left.</p>
        )}
      </div>
    </div>
  );
}

interface CodeFileProps {
  slug: string;
  path: string;
  changed: Set<number>;
  /** Bumped when the bot changes this file; the text is read again. */
  version: number;
}

/** One text file, numbered, with the lines the bot changed marked. Read again when `version` changes. */
function CodeFile({ slug, path, changed, version }: CodeFileProps) {
  const { url, error } = useDiskUrl(slug, path);
  const [file, setFile] = useState<{ text: string; truncated: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const name = path.split("/").pop() ?? path;

  useEffect(() => {
    if (!url) return;
    let live = true;
    readText(url)
      .then((r) => {
        if (!live) return;
        setLoadError(null);
        setFile(r);
      })
      .catch((e) => {
        if (live) setLoadError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [url, version]);

  const failure = error ?? loadError;
  if (failure) return <p className="vw-note">{`Could not open this file. ${failure}`}</p>;
  if (!file) return <p className="vw-note">Loading…</p>;
  return (
    <>
      <NumberedText name={name} text={file.text} changed={changed} />
      {file.truncated && <p className="vw-foot">Showing the first 1 MB.</p>}
    </>
  );
}
