// The bot's disk, as a file manager. Body only: the window frame around it
// (title bar, move, resize, close) is drawn by the desktop. Sidebar with the
// top folders and the disk usage; a toolbar with back, forward, up, the path
// and a filter; the folder as a grid or a list. Everything has a keyboard path.
// Files open through onOpen (the lead routes them to an editor or a viewer).

import { useEffect, useMemo, useRef, useState, type DragEvent, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { Icon, Menu, MenuButton, readPref, toast, writePref, type MenuEntry } from "@opendeck/shell";
import { DISK_QUOTAS_GB, DISK_ROOTS, type BotSummary, type DiskEntry, type DiskListing, type DiskOp, type DiskRoot, type SearchHit } from "../shared/contract.ts";
import { errorText, invoke, on } from "../shared/api.ts";
import { FileIcon } from "./FileIcon.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { fileIconFor, rootIconFor } from "./fileIcons.ts";
import {
  baseName,
  canDrop,
  countWords,
  crumbsFor,
  filterEntries,
  formatGb,
  formatSize,
  formatWhen,
  joinPath,
  kindLabel,
  nameProblem,
  nextFolderName,
  parentOf,
  rootOf,
  selectRange,
  sortEntries,
  stepIndex,
  type Sort,
  type SortKey,
} from "./diskPaths.ts";

/** A file dragged from the person's computer is "Files"; one dragged inside the window carries this type. */
const DRAG_TYPE = "application/x-crew-disk";
const MAX_IMPORT = 200 * 1024 * 1024;
const GB = 1024 * 1024 * 1024;
const TRASH = "Trash";

type View = "grid" | "list";
type Clip = { mode: "copy" | "cut"; paths: string[] };
type Band = { x0: number; y0: number; x1: number; y1: number };
type MenuAt = { at: { x: number; y: number } | HTMLElement; paths: string[] };

export interface FileManagerProps {
  bot: BotSummary;
  /** The folder to open first; default "Files". */
  start?: string;
  /** A file was opened (not a folder). */
  onOpen(entry: DiskEntry): void;
}

export function FileManager({ bot, start = "Files", onOpen }: FileManagerProps) {
  const slug = bot.slug;
  const [history, setHistory] = useState({ stack: [start], at: 0 });
  const dir = history.stack[history.at] ?? start;
  const inTrash = rootOf(dir) === TRASH;

  const [listing, setListing] = useState<DiskListing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; draft: string } | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [sort, setSort] = useState<Sort>({ key: "name", dir: 1 });
  const [view, setView] = useState<View>(() => (readPref("crew.files.list", false) ? "list" : "grid"));
  const [clip, setClip] = useState<Clip | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [band, setBand] = useState<Band | null>(null);
  const [dropping, setDropping] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const dirRef = useRef(dir);
  const reqRef = useRef(0);
  const dragRef = useRef<string[]>([]);
  const dragDepth = useRef(0);
  const bandBase = useRef<string[]>([]);
  const itemEls = useRef(new Map<string, HTMLElement>());
  const itemsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dirRef.current = dir;
  }, [dir]);

  // A new start (the lead opened the window somewhere else) starts a new history.
  useEffect(() => {
    setHistory({ stack: [start], at: 0 });
  }, [start, slug]);

  const load = (path: string) => {
    const id = ++reqRef.current;
    invoke("crew:disk", slug, path)
      .then((l) => {
        if (id !== reqRef.current) return;
        setListing(l);
        setLoadError(null);
        const names = new Set(l.entries.map((e) => e.path));
        setSelected((prev) => prev.filter((p) => names.has(p)));
      })
      .catch((e) => {
        if (id !== reqRef.current) return;
        setListing(null);
        setLoadError(errorText(e));
      });
  };

  useEffect(() => {
    setSelected([]);
    setAnchor(null);
    setCursor(null);
    setRenaming(null);
    setQuery("");
    setListing(null);
    load(dir);
  }, [dir, slug]);

  // The whole disk, from two letters on, 250 ms after the person stops typing.
  const term = query.trim();
  const terms = term.split(/\s+/).filter(Boolean);
  useEffect(() => {
    setHits(null);
    if (term.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      invoke("crew:diskSearch", slug, term)
        .then((r) => {
          if (live) setHits(r);
        })
        .catch((e) => {
          if (!live) return;
          setHits([]);
          toast(errorText(e));
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term, slug]);

  useEffect(() => on("crew:disk", (p) => {
    if (p.slug === slug) load(dirRef.current);
  }), [slug]);

  const apply = (op: DiskOp): Promise<DiskListing | null> =>
    invoke("crew:diskOp", slug, op)
      .then((l) => {
        setListing(l);
        return l;
      })
      .catch((e) => {
        toast(errorText(e));
        return null;
      });

  const entries = listing?.entries ?? [];
  const shown = useMemo(() => sortEntries(filterEntries(entries, query), sort), [entries, query, sort]);
  const order = shown.map((e) => e.path);
  const isSelected = (p: string) => selected.includes(p);
  const tabPath = cursor && order.includes(cursor) ? cursor : order[0];
  const byPath = (p: string) => entries.find((e) => e.path === p);

  const navigate = (to: string) => {
    if (to === dirRef.current) return;
    setHistory((h) => ({ stack: [...h.stack.slice(0, h.at + 1), to], at: h.at + 1 }));
  };
  const back = () => setHistory((h) => (h.at > 0 ? { ...h, at: h.at - 1 } : h));
  const forward = () => setHistory((h) => (h.at < h.stack.length - 1 ? { ...h, at: h.at + 1 } : h));
  const up = () => {
    const p = parentOf(dir);
    if (p) navigate(p);
  };

  const open = (e: DiskEntry) => {
    if (e.kind === "folder") {
      navigate(e.path);
      return;
    }
    if (inTrash) {
      toast("Restore it to open it.");
      return;
    }
    onOpen(e);
  };

  const select = (paths: string[], nextAnchor: string | null) => {
    setSelected(paths);
    setAnchor(nextAnchor);
  };

  const trash = (paths: string[]) => {
    if (!paths.length || inTrash) return;
    void apply({ op: "trash", paths });
  };

  const restore = (paths: string[]) => {
    if (paths.length) void apply({ op: "restore", paths });
  };

  const newFolder = async () => {
    if (inTrash) return;
    const name = nextFolderName(entries.map((e) => e.name));
    const path = joinPath(dir, name);
    const l = await apply({ op: "mkdir", path });
    if (!l) return;
    select([path], path);
    setCursor(path);
    setRenaming({ path, draft: name });
  };

  /** Returns false when the field should stay open (a bad name typed with Enter). */
  const commitRename = (path: string, draft: string, fromBlur: boolean): boolean => {
    const name = draft.trim();
    if (name === baseName(path) || !name) {
      setRenaming(null);
      return true;
    }
    const problem = nameProblem(name);
    if (problem && !fromBlur) {
      toast(problem);
      return false;
    }
    setRenaming(null);
    if (problem) return true;
    void apply({ op: "rename", path, name }).then((l) => {
      if (!l) return;
      const next = joinPath(parentOf(path) ?? dir, name);
      select([next], next);
      setCursor(next);
    });
    return true;
  };

  const paste = () => {
    if (!clip || inTrash) return;
    if (!canDrop(clip.paths, dir, clip.mode === "cut" ? "move" : "copy")) {
      toast(clip.mode === "copy" ? "Can't put a folder inside itself." : "Those are already here.");
      return;
    }
    const mode = clip.mode;
    void apply(mode === "cut" ? { op: "move", paths: clip.paths, to: dir } : { op: "copy", paths: clip.paths, to: dir }).then((l) => {
      if (l && mode === "cut") setClip(null);
    });
  };

  const copyOrCut = (mode: "copy" | "cut", paths: string[]) => {
    if (paths.length) setClip({ mode, paths });
  };

  /** Moves or copies paths onto a folder, or to the trash when dropped on the Trash root. */
  const dropPaths = (paths: string[], target: string, copy: boolean) => {
    if (target === TRASH) {
      trash(paths);
      return;
    }
    if (rootOf(target) === TRASH) return;
    if (!canDrop(paths, target, copy ? "copy" : "move")) return;
    void apply({ op: copy ? "copy" : "move", paths, to: target });
  };

  const importFiles = async (list: FileList | File[], to: string) => {
    if (rootOf(to) === TRASH) {
      toast("Drop files into Files or Documents.");
      return;
    }
    const files = Array.from(list);
    const tooBig = files.find((f) => f.size > MAX_IMPORT);
    if (tooBig) toast(`${tooBig.name} is over 200 MB, so it was not added.`);
    const ok = files.filter((f) => f.size <= MAX_IMPORT);
    if (!ok.length) return;
    setProgress(`Adding ${ok.length} ${ok.length === 1 ? "file" : "files"}…`);
    try {
      const bytes = await Promise.all(ok.map(async (f) => ({ name: f.name, bytes: await f.arrayBuffer() })));
      const l = await apply({ op: "import", to, files: bytes });
      if (l) toast(`Added ${ok.length} ${ok.length === 1 ? "file" : "files"}.`);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setProgress(null);
    }
  };

  const setQuota = (gb: number) => {
    invoke("crew:setQuota", slug, gb)
      .then((l) => {
        setListing(l);
        toast(`Disk is ${gb} GB.`);
      })
      .catch((e) => toast(errorText(e)));
  };

  const quotaEntries: MenuEntry[] = (listing ? DISK_QUOTAS_GB : []).map((gb) => ({
    label: formatGb(gb),
    checked: listing ? Math.round(listing.quota / GB) === gb : false,
    onSelect: () => setQuota(gb),
  }));

  // Keyboard and pointer selection.
  const clickItem = (e: MouseEvent, path: string) => {
    if (renaming) return;
    setCursor(path);
    if (e.shiftKey && anchor) setSelected(selectRange(order, anchor, path));
    else if (e.ctrlKey || e.metaKey) {
      setSelected(isSelected(path) ? selected.filter((p) => p !== path) : [...selected, path]);
      setAnchor(path);
    } else select([path], path);
  };

  const focusItem = (path: string) => itemEls.current.get(path)?.focus();

  const columns = (): number => {
    if (view !== "grid") return 1;
    const els = order.map((p) => itemEls.current.get(p));
    const first = els[0];
    if (!first) return 1;
    let n = 0;
    for (const el of els) {
      if (!el || el.offsetTop !== first.offsetTop) break;
      n++;
    }
    return Math.max(1, n);
  };

  const moveCursor = (by: number, extend: boolean) => {
    if (!order.length) return;
    const idx = cursor ? order.indexOf(cursor) : -1;
    const from = idx < 0 ? (by > 0 ? -1 : order.length) : idx;
    const next = order[stepIndex(order.length, from, by)];
    if (next === undefined) return;
    if (extend && anchor) setSelected(selectRange(order, anchor, next));
    else select([next], next);
    setCursor(next);
    focusItem(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const mod = e.ctrlKey || e.metaKey;
    const current = cursor ? byPath(cursor) : undefined;
    const handled = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (e.altKey && e.key === "ArrowLeft") return handled(back);
    if (e.altKey && e.key === "ArrowRight") return handled(forward);
    if (e.altKey && e.key === "ArrowUp") return handled(up);
    if (mod && e.key.toLowerCase() === "a") return handled(() => select([...order], order[0] ?? null));
    if (mod && e.shiftKey && e.key.toLowerCase() === "n") return handled(() => void newFolder());
    if (mod && e.key.toLowerCase() === "c") return handled(() => copyOrCut("copy", selected));
    if (mod && e.key.toLowerCase() === "x") return handled(() => copyOrCut("cut", selected));
    if (mod && e.key.toLowerCase() === "v") return handled(paste);
    switch (e.key) {
      case "ArrowRight":
        return handled(() => moveCursor(1, e.shiftKey));
      case "ArrowLeft":
        return handled(() => moveCursor(-1, e.shiftKey));
      case "ArrowDown":
        return handled(() => moveCursor(columns(), e.shiftKey));
      case "ArrowUp":
        return handled(() => moveCursor(-columns(), e.shiftKey));
      case "Home":
        return handled(() => moveCursor(-order.length, e.shiftKey));
      case "End":
        return handled(() => moveCursor(order.length, e.shiftKey));
      case "Enter":
        if (current) handled(() => open(current));
        return;
      case "F2":
        if (current && !inTrash) handled(() => setRenaming({ path: current.path, draft: current.name }));
        return;
      case "Delete":
        if (selected.length) handled(() => trash(selected));
        return;
      case "Backspace":
        return handled(up);
      case "Escape":
        if (selected.length) handled(() => select([], null));
        return;
      case "F10":
      case "ContextMenu":
        if (current || e.key === "ContextMenu") {
          const el = current ? itemEls.current.get(current.path) : undefined;
          handled(() => setMenu({ at: el ?? (e.currentTarget as HTMLElement), paths: current && !isSelected(current.path) ? [current.path] : selected }));
        }
        return;
    }
  };

  // Rubber band selection in the grid.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (view !== "grid" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".fm-item")) return;
    const additive = e.ctrlKey || e.shiftKey;
    bandBase.current = additive ? selected : [];
    if (!additive) select([], null);
    setBand({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
    itemsRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!band) return;
    const next = { ...band, x1: e.clientX, y1: e.clientY };
    setBand(next);
    const r = {
      left: Math.min(next.x0, next.x1),
      right: Math.max(next.x0, next.x1),
      top: Math.min(next.y0, next.y1),
      bottom: Math.max(next.y0, next.y1),
    };
    const hits = order.filter((p) => {
      const el = itemEls.current.get(p);
      if (!el) return false;
      const b = el.getBoundingClientRect();
      return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
    });
    setSelected([...new Set([...bandBase.current, ...hits])]);
  };

  const endBand = () => setBand(null);

  // Drag and drop.
  const onItemDragStart = (e: DragEvent, path: string) => {
    if (renaming) {
      e.preventDefault();
      return;
    }
    const paths = isSelected(path) ? selected : [path];
    if (!isSelected(path)) select([path], path);
    dragRef.current = paths;
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
    e.dataTransfer.effectAllowed = "copyMove";
  };

  const isOsFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  const onTargetOver = (e: DragEvent, target: string) => {
    if (isOsFiles(e)) {
      if (rootOf(target) === TRASH) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      return;
    }
    if (!dragRef.current.length) return;
    const copy = e.ctrlKey || e.metaKey;
    const ok = target === TRASH ? !dragRef.current.every((p) => rootOf(p) === TRASH) : rootOf(target) !== TRASH && canDrop(dragRef.current, target, copy ? "copy" : "move");
    if (!ok) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = copy ? "copy" : "move";
  };

  const onTargetDrop = (e: DragEvent, target: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropping(false);
    dragDepth.current = 0;
    if (isOsFiles(e)) {
      void importFiles(e.dataTransfer.files, target);
      return;
    }
    const paths = dragRef.current;
    dragRef.current = [];
    dropPaths(paths, target, e.ctrlKey || e.metaKey);
  };

  const onMainDragEnter = (e: DragEvent) => {
    if (!isOsFiles(e) || inTrash) return;
    dragDepth.current++;
    setDropping(true);
  };

  const onMainDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropping(false);
  };

  // Menus.
  const itemMenu = (paths: string[]): MenuEntry[] => {
    const single = paths.length === 1 && paths[0] !== undefined ? byPath(paths[0]) : undefined;
    if (inTrash) {
      return [
        { label: "Restore", onSelect: () => restore(paths), disabled: !paths.length },
        "separator",
        { label: "Empty trash", onSelect: () => void apply({ op: "emptyTrash" }), danger: true },
      ];
    }
    return [
      ...(single ? [{ label: "Open", onSelect: () => open(single), shortcut: "Enter" }] : []),
      ...(single ? [{ label: "Rename", onSelect: () => setRenaming({ path: single.path, draft: single.name }), shortcut: "F2" }] : []),
      { label: "Copy", onSelect: () => copyOrCut("copy", paths), shortcut: "Ctrl+C" },
      { label: "Cut", onSelect: () => copyOrCut("cut", paths), shortcut: "Ctrl+X" },
      "separator",
      { label: "Move to trash", onSelect: () => trash(paths), shortcut: "Del", danger: true },
    ];
  };

  const backgroundMenu: MenuEntry[] = inTrash
    ? [{ label: "Empty trash", onSelect: () => void apply({ op: "emptyTrash" }), danger: true }]
    : [
        { label: "New folder", onSelect: () => void newFolder(), shortcut: "Ctrl+Shift+N" },
        { label: "Paste", onSelect: paste, shortcut: "Ctrl+V", disabled: !clip },
      ];

  const menuEntries = menu ? (menu.paths.length ? itemMenu(menu.paths) : backgroundMenu) : [];

  const openMenu = (e: MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (renaming) return;
    if (!isSelected(path)) select([path], path);
    setCursor(path);
    const paths = isSelected(path) ? selected : [path];
    setMenu({ at: { x: e.clientX, y: e.clientY }, paths });
  };

  const bandBox = (() => {
    if (!band) return null;
    const box = itemsRef.current?.getBoundingClientRect();
    if (!box || !itemsRef.current) return null;
    const left = Math.min(band.x0, band.x1);
    const top = Math.min(band.y0, band.y1);
    return {
      left: left - box.left + itemsRef.current.scrollLeft,
      top: top - box.top + itemsRef.current.scrollTop,
      width: Math.abs(band.x1 - band.x0),
      height: Math.abs(band.y1 - band.y0),
    };
  })();

  const emptyText = (): string => {
    if (loadError) return `Could not open this folder. ${loadError}`;
    if (!listing) return "Loading…";
    if (query.trim() && entries.length) return `Nothing matches "${query.trim()}".`;
    if (dir === TRASH) return "Nothing in Trash.";
    if (dir === "Documents") return "No documents yet.";
    if (dir === "Downloads") return "Nothing downloaded yet.";
    if (dir === "Files") return "No files yet.";
    return "This folder is empty.";
  };

  const sortBy = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  };

  const sortLabel = (key: SortKey, label: string) => {
    const active = sort.key === key;
    return (
      <button type="button" className="fm-sort" aria-label={`Sort by ${label.toLowerCase()}`} onClick={() => sortBy(key)} aria-pressed={active}>
        {label}
        {active && <span aria-hidden>{sort.dir === 1 ? "▲" : "▼"}</span>}
      </button>
    );
  };

  const crumbs = crumbsFor(dir);
  const usedPct = listing && listing.quota > 0 ? Math.min(100, (listing.used / listing.quota) * 100) : 0;
  const empty = shown.length === 0;

  const renameField = (path: string, draft: string) => (
    <RenameField
      key={path}
      value={draft}
      onChange={(v) => setRenaming({ path, draft: v })}
      onCommit={(fromBlur) => commitRename(path, draft, fromBlur)}
      onCancel={() => setRenaming(null)}
    />
  );

  const itemIcon = (e: DiskEntry, size: number) => (
    <FileIcon name={e.path === "Files/downloads" ? rootIconFor("Downloads") : fileIconFor(e.kind)} size={size} />
  );

  const itemProps = (e: DiskEntry) => ({
    ref: (el: HTMLDivElement | null) => {
      if (el) itemEls.current.set(e.path, el);
      else itemEls.current.delete(e.path);
    },
    role: "option" as const,
    "aria-selected": isSelected(e.path),
    "aria-label": e.name,
    tabIndex: e.path === tabPath ? 0 : -1,
    draggable: renaming?.path !== e.path,
    onClick: (ev: MouseEvent) => clickItem(ev, e.path),
    onDoubleClick: () => open(e),
    onContextMenu: (ev: MouseEvent) => openMenu(ev, e.path),
    onDragStart: (ev: DragEvent) => onItemDragStart(ev, e.path),
    onDragEnd: () => {
      dragRef.current = [];
      setDropping(false);
    },
    onDragOver: (ev: DragEvent) => {
      if (e.kind === "folder") onTargetOver(ev, e.path);
    },
    onDrop: (ev: DragEvent) => {
      if (e.kind === "folder") onTargetDrop(ev, e.path);
    },
    onFocus: () => setCursor(e.path),
    "data-path": e.path,
    "data-kind": e.kind,
  });

  return (
    <div className="fm">
      <aside className="fm-side" aria-label="Disk">
        <nav className="fm-roots" aria-label="Top folders">
          {DISK_ROOTS.map((root: DiskRoot) => {
            const current = rootOf(dir) === root;
            return (
              <button
                key={root}
                type="button"
                className="fm-root"
                aria-current={current ? "page" : undefined}
                onClick={() => navigate(root)}
                onDragOver={(ev) => onTargetOver(ev, root)}
                onDrop={(ev) => onTargetDrop(ev, root)}
              >
                <FileIcon name={rootIconFor(root)} size={16} />
                <span>{root}</span>
              </button>
            );
          })}
        </nav>
        <div className="fm-usage">
          <div
            className="fm-meter"
            role="meter"
            aria-label="Disk space used"
            aria-valuemin={0}
            aria-valuemax={listing?.quota ?? 0}
            aria-valuenow={listing?.used ?? 0}
            aria-valuetext={listing ? `${formatSize(listing.used)} of ${formatSize(listing.quota)}` : undefined}
          >
            <span style={{ width: `${usedPct}%` }} />
          </div>
          <p className="fm-usage-text">{listing ? `${formatSize(listing.used)} of ${formatSize(listing.quota)}` : "Checking the disk"}</p>
          <MenuButton className="btn ghost fm-change" label="Disk size" entries={quotaEntries}>
            Change
          </MenuButton>
        </div>
      </aside>

      <section className="fm-body">
        <div className="fm-toolbar">
          <div className="fm-nav">
            <button type="button" className="icon-btn" aria-label="Back" title="Back" disabled={history.at === 0} onClick={back}>
              <span className="fm-flip"><PixelIcon name="chevron-right" size={14} /></span>
            </button>
            <button type="button" className="icon-btn" aria-label="Forward" title="Forward" disabled={history.at >= history.stack.length - 1} onClick={forward}>
              <PixelIcon name="chevron-right" size={14} />
            </button>
            <button type="button" className="icon-btn" aria-label="Up" title="Up" disabled={!parentOf(dir)} onClick={up}>
              <span className="fm-up"><PixelIcon name="chevron-down" size={14} /></span>
            </button>
          </div>
          <nav className="fm-crumbs" aria-label="Path">
            {crumbs.map((c, i) => (
              <span key={c.path} className="fm-crumb-wrap">
                {i > 0 && <span className="fm-sep" aria-hidden>/</span>}
                <button type="button" className="fm-crumb" aria-current={i === crumbs.length - 1 ? "page" : undefined} onClick={() => navigate(c.path)}>
                  {c.label}
                </button>
              </span>
            ))}
          </nav>
          <input
            type="search"
            className="fm-filter"
            placeholder="Search"
            aria-label="Search"
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Escape") setQuery("");
            }}
          />
          <div className="fm-actions">
            {inTrash && (
              <button type="button" className="btn ghost" onClick={() => void apply({ op: "emptyTrash" })}>
                Empty trash
              </button>
            )}
            {!inTrash && (
              <button type="button" className="btn ghost" onClick={() => void newFolder()}>
                <Icon name="plus" size={14} />
                New folder
              </button>
            )}
            <button type="button" className="icon-btn" aria-label="Grid view" title="Grid view" aria-pressed={view === "grid"} onClick={() => { setView("grid"); writePref("crew.files.list", false); }}>
              <Icon name="grid" size={16} />
            </button>
            <button type="button" className="icon-btn" aria-label="List view" title="List view" aria-pressed={view === "list"} onClick={() => { setView("list"); writePref("crew.files.list", true); }}>
              <Icon name="list" size={16} />
            </button>
          </div>
        </div>

        {term.length >= 2 && (
          <section className="fm-search" aria-label="Search the whole disk">
            <p className="fm-search-title">Search the whole disk</p>
            {hits === null && <p className="fm-search-note">Searching…</p>}
            {hits?.length === 0 && <p className="fm-search-note">Nothing on the disk matches "{term}".</p>}
            {hits?.map((h) => (
              <button key={h.entry.path} type="button" className="fm-hit" onClick={() => open(h.entry)}>
                <span className="fm-hit-icon">{itemIcon(h.entry, 16)}</span>
                <span className="fm-hit-text">
                  <span className="fm-hit-line">
                    <span className="fm-hit-name">{h.entry.title || h.entry.name}</span>
                    <span className="fm-hit-path">{parentOf(h.entry.path) ?? ""}</span>
                  </span>
                  {h.snippet && (
                    <span className="fm-hit-snippet">
                      <Marked text={h.snippet} words={terms} />
                    </span>
                  )}
                </span>
              </button>
            ))}
          </section>
        )}

        <div
          ref={itemsRef}
          className={`fm-items ${view}`}
          role="listbox"
          aria-multiselectable
          aria-label={dir}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endBand}
          onPointerCancel={endBand}
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest(".fm-item") && !band) select([], null);
          }}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest(".fm-item")) return;
            e.preventDefault();
            setMenu({ at: { x: e.clientX, y: e.clientY }, paths: [] });
          }}
          onDragEnter={onMainDragEnter}
          onDragLeave={onMainDragLeave}
          onDragOver={(e) => {
            if (isOsFiles(e) && !inTrash) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            if (!isOsFiles(e)) return;
            e.preventDefault();
            setDropping(false);
            dragDepth.current = 0;
            void importFiles(e.dataTransfer.files, dir);
          }}
        >
          {view === "list" && !empty && (
            <div className="fm-head" role="presentation">
              {sortLabel("name", "Name")}
              {sortLabel("kind", "Kind")}
              {sortLabel("size", "Size")}
              {sortLabel("edited", "Modified")}
            </div>
          )}

          {shown.map((e) => {
            const isRenaming = renaming?.path === e.path;
            const name = isRenaming ? renameField(e.path, renaming.draft) : <span className="fm-name">{e.name}</span>;
            if (view === "grid") {
              return (
                <div key={e.path} {...itemProps(e)} className={`fm-item${isSelected(e.path) ? " is-selected" : ""}`}>
                  {itemIcon(e, 48)}
                  {name}
                </div>
              );
            }
            return (
              <div key={e.path} {...itemProps(e)} className={`fm-item fm-row${isSelected(e.path) ? " is-selected" : ""}`}>
                <span className="fm-cell fm-cell-name">
                  {itemIcon(e, 16)}
                  {name}
                </span>
                <span className="fm-cell fm-cell-kind">{kindLabel(e.kind)}</span>
                <span className="fm-cell fm-cell-size">{e.kind === "folder" ? "" : formatSize(e.size)}</span>
                <span className="fm-cell fm-cell-when">{formatWhen(e.edited)}</span>
              </div>
            );
          })}

          {empty && (
            <p className="fm-empty">
              {emptyText()}
              {loadError && (
                <>
                  {" "}
                  <button type="button" className="btn ghost" onClick={() => navigate("Files")}>
                    Go to the top folder
                  </button>
                </>
              )}
            </p>
          )}

          {bandBox && <div className="fm-band" style={bandBox} aria-hidden />}
          {dropping && <div className="fm-drop" aria-hidden>Drop to add</div>}
        </div>

        <footer className="fm-status" aria-live="polite">
          <span>{progress ?? countWords(shown.length, selected.length)}</span>
        </footer>
      </section>

      {menu && <Menu entries={menuEntries} anchor={menu.at} onClose={() => setMenu(null)} label="File menu" />}
    </div>
  );
}

/** The text with each word of the query in bold. */
function Marked({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const alt = [...words].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${alt.join("|")})`, "i"));
  return (
    <>
      {parts.map((part, i) => (i % 2 ? <mark key={i} className="fm-mark">{part}</mark> : part))}
    </>
  );
}

function RenameField({ value, onChange, onCommit, onCancel }: { value: string; onChange(v: string): void; onCommit(fromBlur: boolean): boolean; onCancel(): void }) {
  const done = useRef(false);
  const finish = (fn: () => boolean | void) => {
    if (done.current) return;
    if (fn() !== false) done.current = true;
  };
  return (
    <input
      className="fm-rename"
      aria-label="Name"
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(() => onCommit(false));
        if (e.key === "Escape") finish(onCancel);
      }}
      onFocus={(e: FocusEvent<HTMLInputElement>) => {
        const dot = e.target.value.lastIndexOf(".");
        e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
      }}
      onBlur={() => finish(() => onCommit(true))}
    />
  );
}
