// A bot's desktop icons: the grid of shortcuts on its computer, the hook that
// keeps them in step with the main process, and the dialog that adds one back.
// Icons sit on a grid of cells. A saved cell (pos) keeps its icon there; the
// rest fill the first free cells, column by column.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Menu, toast } from "@opendeck/shell";
import { FENNA_APPS } from "@opendeck/crew";
import { DESKTOP_APPS, DESKTOP_MAX, SHORTCUT_LABEL_MAX, type DesktopApp, type DesktopShortcut } from "../shared/contract.ts";
import { errorText, invoke, on } from "../shared/api.ts";
import { FileIcon } from "./FileIcon.tsx";
import { appIconFor } from "./fileIcons.ts";
import { PixelIcon } from "./PixelIcon.tsx";

const APP_LABEL: Record<DesktopApp, string> = { browser: "Browser", files: "Files", library: "Documents", terminal: "Terminal", activity: "Activity", clock: "Clock", connectors: "Connectors", trash: "Trash" };

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

export const CELL_W = 96;
export const CELL_H = 104;
const GRID_PAD = 16;
const ICON_W = 72;
const DRAG_START_PX = 4;
const STEP: Record<string, [number, number] | undefined> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

export interface Cell {
  col: number;
  row: number;
}

/** The browser is the one icon a desktop always keeps. */
export const isFixed = (item: DesktopShortcut): boolean => item.kind === "app" && item.app === "browser";

/**
 * Where each icon sits in a grid of cols by rows. An icon with a saved cell keeps it, if that cell is on
 * the grid and no earlier icon has it. Every other icon takes the first free cell, column by column.
 */
export function layoutDesktop(items: readonly DesktopShortcut[], cols: number, rows: number): Map<string, Cell> {
  const out = new Map<string, Cell>();
  const taken = new Set<string>();
  const key = (c: number, r: number) => `${c},${r}`;
  for (const item of items) {
    const p = item.pos;
    if (!p || p.col >= cols || p.row >= rows || taken.has(key(p.col, p.row))) continue;
    out.set(item.id, { col: p.col, row: p.row });
    taken.add(key(p.col, p.row));
  }
  let col = 0;
  let row = 0;
  for (const item of items) {
    if (out.has(item.id)) continue;
    while (taken.has(key(col, row))) {
      row++;
      if (row >= rows) {
        row = 0;
        col++;
      }
    }
    out.set(item.id, { col, row });
    taken.add(key(col, row));
    row++;
    if (row >= rows) {
      row = 0;
      col++;
    }
  }
  return out;
}

/**
 * The shortcuts with the icon `id` moved to cell `to`. If another icon is there, the two swap cells.
 * Every icon gets its cell saved, so the layout is the same next time.
 */
export function moveIcon(items: readonly DesktopShortcut[], layout: ReadonlyMap<string, Cell>, id: string, to: Cell): DesktopShortcut[] {
  const from = layout.get(id);
  if (!from) return [...items];
  const next = new Map(layout);
  const other = [...layout].find(([otherId, c]) => otherId !== id && c.col === to.col && c.row === to.row);
  next.set(id, to);
  if (other) next.set(other[0], from);
  return items.map((item) => ({ ...item, pos: next.get(item.id) }));
}

/** A web address the person typed, as a link the bot's browser can open. Adds https:// when there is no scheme. */
export function websiteShortcutUrl(text: string): { url: string } | { error: string } {
  const t = text.trim();
  if (!t) return { error: "Type a web address, like example.com." };
  if (/\s/.test(t)) return { error: "A web address has no spaces. Check it, like example.com." };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: "Type a web address, like example.com." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "Only web addresses (http or https) can go on the desktop." };
  if (!url.hostname) return { error: "Type a web address, like example.com." };
  return { url: url.href };
}

/** A short id like "s-k3j9x2" that no shortcut already has. */
export function newShortcutId(taken: readonly string[], random: () => number = Math.random): string {
  for (;;) {
    let id = "s-";
    for (let i = 0; i < 6; i++) id += ID_CHARS[Math.floor(random() * ID_CHARS.length)];
    if (!taken.includes(id)) return id;
  }
}

const originOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};

const favicons = new Map<string, Promise<string | null>>();
function faviconOf(origin: string): Promise<string | null> {
  let icon = favicons.get(origin);
  if (!icon) {
    icon = invoke("crew:siteIcon", origin).catch(() => null);
    favicons.set(origin, icon);
  }
  return icon;
}

/** The first pick of the nearest icon in an arrow direction. Columns are found by their left edge. */
function nearestIn(from: DOMRect, rects: [string, DOMRect][], key: string): string | null {
  const vertical = key === "ArrowUp" || key === "ArrowDown";
  const step = key === "ArrowUp" || key === "ArrowLeft" ? -1 : 1;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const [id, r] of rects) {
    const dx = r.left - from.left;
    const dy = r.top - from.top;
    const along = vertical ? dy : dx;
    const across = vertical ? dx : dy;
    if (Math.sign(along) !== step || Math.abs(along) < 4) continue;
    if (vertical && Math.abs(across) > 4) continue;
    const score = Math.abs(along) + Math.abs(across) / 1000;
    if (score < bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

/** The desktop's shortcuts, kept in step with the main process. Nothing is saved until the list has loaded. */
export function useDesktop(slug: string): { items: DesktopShortcut[]; ready: boolean; save(items: DesktopShortcut[]): void } {
  const [items, setItems] = useState<DesktopShortcut[]>([]);
  const [ready, setReady] = useState(false);
  const latest = useRef<DesktopShortcut[] | null>(null);

  useEffect(() => {
    let live = true;
    latest.current = null;
    setItems([]);
    setReady(false);
    const show = (list: DesktopShortcut[]) => {
      latest.current = list;
      setItems(list);
      setReady(true);
    };
    invoke("crew:desktop", slug).then(
      (list) => {
        if (live) show(list);
      },
      (e) => {
        if (live) toast(errorText(e));
      },
    );
    const off = on("crew:desktop", (p) => {
      if (live && p.slug === slug) show(p.items);
    });
    return () => {
      live = false;
      off();
    };
  }, [slug]);

  const save = useCallback(
    (next: DesktopShortcut[]) => {
      const prev = latest.current;
      if (!prev) return;
      latest.current = next;
      setItems(next);
      invoke("crew:setDesktop", slug, next).then(
        (saved) => {
          latest.current = saved;
          setItems(saved);
        },
        (e) => {
          latest.current = prev;
          setItems(prev);
          toast(errorText(e));
        },
      );
    },
    [slug],
  );

  return { items, ready, save };
}

/** An icon's picture at `size` px: the Fenna app's own icon, a site's favicon, or a pixel icon. */
export function ShortcutArt({ item, size }: { item: DesktopShortcut; size: number }) {
  const origin = item.kind === "web" ? originOf(item.url) : "";
  const [favicon, setFavicon] = useState<string | null>(null);

  useEffect(() => {
    setFavicon(null);
    if (!origin) return;
    let live = true;
    void faviconOf(origin).then((src) => {
      if (live) setFavicon(src);
    });
    return () => {
      live = false;
    };
  }, [origin]);

  if (item.kind === "fenna" || item.kind === "app") return <FileIcon name={appIconFor(item.app)} size={size} />;
  if (favicon) {
    const px = Math.round((size * 2) / 3);
    return <img className="desk-favicon" src={favicon} alt="" width={px} height={px} draggable={false} onError={() => setFavicon(null)} />;
  }
  return <FileIcon name={item.kind === "web" ? "drive" : "doc"} size={size} />;
}

interface MenuAt {
  id: string;
  x: number;
  y: number;
}

export function DesktopIcons({
  slug,
  items,
  save,
  onOpen,
}: {
  slug: string;
  items: DesktopShortcut[];
  save(items: DesktopShortcut[]): void;
  onOpen(item: DesktopShortcut): void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [grid, setGrid] = useState({ cols: 1, rows: 1 });
  const box = useRef<HTMLDivElement>(null);
  const press = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const skipClick = useRef(false);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const refocus = useRef<string | null>(null);
  const renameDone = useRef(true);
  const layout = useMemo(() => layoutDesktop(items, grid.cols, grid.rows), [items, grid]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () =>
      setGrid({
        cols: Math.max(1, Math.floor((el.clientWidth - GRID_PAD) / CELL_W)),
        rows: Math.max(1, Math.floor((el.clientHeight - GRID_PAD) / CELL_H)),
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setSelected(null);
    setMenu(null);
    setRenaming(null);
  }, [slug]);

  useEffect(() => {
    if (!refocus.current) return;
    refs.current.get(refocus.current)?.focus();
    refocus.current = null;
  }, [items]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(null);
      refs.current.get(menu.id)?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const indexOf = (id: string) => items.findIndex((i) => i.id === id);
  const focusItem = (id: string) => refs.current.get(id)?.focus();
  const choose = (id: string) => {
    setSelected(id);
    focusItem(id);
  };

  const moveTo = (id: string, to: Cell) => {
    const from = layout.get(id);
    if (!from || (from.col === to.col && from.row === to.row)) return;
    refocus.current = id;
    save(moveIcon(items, layout, id, to));
  };

  const inGrid = (c: Cell) => c.col >= 0 && c.row >= 0 && c.col < grid.cols && c.row < grid.rows;

  const dropAt = (id: string, dx: number, dy: number) => {
    const from = layout.get(id);
    if (!from) return;
    const to = {
      col: Math.max(0, Math.min(grid.cols - 1, from.col + Math.round(dx / CELL_W))),
      row: Math.max(0, Math.min(grid.rows - 1, from.row + Math.round(dy / CELL_H))),
    };
    moveTo(id, to);
  };

  const remove = (item: DesktopShortcut) => {
    if (isFixed(item)) return;
    const index = indexOf(item.id);
    const next = items.filter((i) => i.id !== item.id);
    const neighbour = next[Math.min(index, next.length - 1)] ?? null;
    setSelected(neighbour?.id ?? null);
    refocus.current = neighbour?.id ?? null;
    save(next);
  };

  const startRename = (item: DesktopShortcut) => {
    renameDone.current = false;
    setSelected(item.id);
    setRenaming(item.id);
  };

  const finishRename = (item: DesktopShortcut, raw: string, back: boolean) => {
    if (renameDone.current) return;
    renameDone.current = true;
    setRenaming(null);
    const label = raw.trim().slice(0, SHORTCUT_LABEL_MAX).trim();
    if (label && label !== item.label) save(items.map((i) => (i.id === item.id ? { ...i, label } : i)));
    if (back) focusItem(item.id);
  };

  const nearest = (id: string, key: string): string | null => {
    const from = refs.current.get(id)?.getBoundingClientRect();
    if (!from) return null;
    const rects: [string, DOMRect][] = [];
    for (const other of items) {
      const r = other.id === id ? null : refs.current.get(other.id)?.getBoundingClientRect();
      if (r) rects.push([other.id, r]);
    }
    return nearestIn(from, rects, key);
  };

  const openMenu = (id: string, x: number, y: number) => {
    setSelected(id);
    setMenu({ id, x, y });
  };

  const onItemKey = (e: ReactKeyboardEvent<HTMLDivElement>, item: DesktopShortcut) => {
    switch (e.key) {
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight": {
        e.preventDefault();
        if (e.altKey) {
          const from = layout.get(item.id);
          const step = STEP[e.key];
          if (from && step) {
            const to = { col: from.col + step[0], row: from.row + step[1] };
            if (inGrid(to)) moveTo(item.id, to);
          }
          return;
        }
        const next = nearest(item.id, e.key);
        if (next) choose(next);
        return;
      }
      case "Enter":
        e.preventDefault();
        onOpen(item);
        return;
      case "F2":
        e.preventDefault();
        startRename(item);
        return;
      case "Delete":
        e.preventDefault();
        remove(item);
        return;
      case "ContextMenu":
      case "F10": {
        if (e.key === "F10" && !e.shiftKey) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        openMenu(item.id, r.left + 8, r.bottom - 8);
        return;
      }
      default:
    }
  };

  const menuItem = menu ? items.find((i) => i.id === menu.id) : undefined;

  return (
    <>
      <div
        ref={box}
        className="desk-icons"
        role="listbox"
        aria-label="Desktop"
        aria-orientation="vertical"
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected(null);
        }}
      >
        {items.map((item, index) => {
          const isRenaming = renaming === item.id;
          const cell = layout.get(item.id) ?? { col: 0, row: 0 };
          const moving = drag?.id === item.id ? drag : null;
          const tabStop = selected ? selected === item.id : index === 0;
          return (
            <div
              key={item.id}
              ref={(el) => {
                if (el) refs.current.set(item.id, el);
                else refs.current.delete(item.id);
              }}
              role="option"
              aria-selected={selected === item.id}
              aria-label={item.label}
              tabIndex={tabStop ? 0 : -1}
              className={`desk-icon${moving ? " dragging" : ""}`}
              style={{
                left: GRID_PAD + cell.col * CELL_W + (CELL_W - ICON_W) / 2,
                top: GRID_PAD + cell.row * CELL_H,
                ...(moving ? { transform: `translate(${moving.dx}px, ${moving.dy}px)` } : {}),
              }}
              onClick={() => {
                if (skipClick.current) {
                  skipClick.current = false;
                  return;
                }
                choose(item.id);
              }}
              onDoubleClick={() => {
                if (!isRenaming) onOpen(item);
              }}
              onKeyDown={(e) => {
                if (!isRenaming) onItemKey(e, item);
              }}
              onContextMenu={(e: ReactMouseEvent<HTMLDivElement>) => {
                e.preventDefault();
                e.stopPropagation();
                openMenu(item.id, e.clientX, e.clientY);
              }}
              onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
                if (isRenaming || e.button !== 0) return;
                skipClick.current = false;
                press.current = { id: item.id, x: e.clientX, y: e.clientY, moved: false };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e: ReactPointerEvent<HTMLDivElement>) => {
                const p = press.current;
                if (!p || p.id !== item.id) return;
                const dx = e.clientX - p.x;
                const dy = e.clientY - p.y;
                if (!p.moved) {
                  if (Math.hypot(dx, dy) < DRAG_START_PX) return;
                  p.moved = true;
                }
                setDrag({ id: item.id, dx, dy });
              }}
              onPointerUp={(e: ReactPointerEvent<HTMLDivElement>) => {
                const p = press.current;
                press.current = null;
                if (!p || p.id !== item.id || !p.moved) return;
                skipClick.current = true;
                setDrag(null);
                dropAt(item.id, e.clientX - p.x, e.clientY - p.y);
              }}
              onPointerCancel={() => {
                press.current = null;
                setDrag(null);
              }}
            >
              <span className={`desk-mark${item.kind === "fenna" ? " plain" : ""}`}>
                <ShortcutArt item={item} size={48} />
              </span>
              {isRenaming ? (
                <input
                  className="field small desk-rename"
                  aria-label="Name"
                  maxLength={SHORTCUT_LABEL_MAX}
                  defaultValue={item.label}
                  autoFocus
                  spellCheck={false}
                  onFocus={(e) => e.currentTarget.select()}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      finishRename(item, e.currentTarget.value, true);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      renameDone.current = true;
                      setRenaming(null);
                      focusItem(item.id);
                    }
                  }}
                  onBlur={(e) => finishRename(item, e.currentTarget.value, false)}
                />
              ) : (
                <span className="desk-label">{item.label}</span>
              )}
            </div>
          );
        })}
      </div>

      {menu && menuItem && (
        <Menu
          entries={[
            { label: "Open", onSelect: () => onOpen(menuItem) },
            { label: "Rename", onSelect: () => startRename(menuItem) },
            ...(isFixed(menuItem) ? [] : [{ label: "Remove", onSelect: () => remove(menuItem), danger: true }]),
          ]}
          anchor={{ x: menu.x, y: menu.y }}
          label={menuItem.label}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

const targetKey = (s: DesktopShortcut): string => (s.kind === "app" ? `app:${s.app}` : s.kind === "fenna" ? `fenna:${s.app}` : `${s.kind}:${s.id}`);

export function AddShortcutDialog({ items, save, onClose }: { items: DesktopShortcut[]; save(items: DesktopShortcut[]): void; onClose(): void }) {
  const [mode, setMode] = useState<"web" | "built">("web");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const full = items.length >= DESKTOP_MAX;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const addWebsite = (e: FormEvent) => {
    e.preventDefault();
    if (full) return;
    const made = websiteShortcutUrl(address);
    if ("error" in made) {
      setError(made.error);
      return;
    }
    const label = (name.trim() || new URL(made.url).hostname).slice(0, SHORTCUT_LABEL_MAX);
    save([...items, { id: newShortcutId(items.map((i) => i.id)), kind: "web", url: made.url, label }]);
    onClose();
  };

  const present = new Set(items.map(targetKey));
  const candidates: DesktopShortcut[] = [
    ...DESKTOP_APPS.filter((app) => !present.has(`app:${app}`)).map((app): DesktopShortcut => ({ id: "", kind: "app", app, label: APP_LABEL[app] })),
    ...FENNA_APPS.filter((a) => !present.has(`fenna:${a.id}`)).map((a): DesktopShortcut => ({ id: "", kind: "fenna", app: a.id, label: a.name })),
  ];

  const addBuiltIn = (c: DesktopShortcut) => {
    if (full) return;
    save([...items, { ...c, id: newShortcutId(items.map((i) => i.id)) }]);
    onClose();
  };

  return (
    <div className="desk-modal-scrim" onClick={onClose}>
      <div className="desk-modal-card" role="dialog" aria-modal="true" aria-label="Add to desktop" onClick={(e) => e.stopPropagation()}>
        <div className="desk-modal-head">
          <span className="desk-modal-title">Add to desktop</span>
          <button type="button" className="icon-btn win-btn" aria-label="Close" onClick={onClose}>
            <PixelIcon name="close" size={12} />
          </button>
        </div>

        <div className="desk-choices" role="group" aria-label="What to add">
          <button type="button" className="desk-choice" aria-pressed={mode === "web"} onClick={() => setMode("web")}>
            Website
          </button>
          <button type="button" className="desk-choice" aria-pressed={mode === "built"} onClick={() => setMode("built")}>
            Built-in
          </button>
        </div>

        {mode === "web" ? (
          <form className="desk-form" onSubmit={addWebsite} noValidate>
            <label className="lab">
              Name
              <input className="field" value={name} maxLength={SHORTCUT_LABEL_MAX} placeholder="Optional" spellCheck={false} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="lab">
              Address
              <input
                className="field"
                value={address}
                autoFocus
                placeholder="example.com"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!error}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setError("");
                }}
              />
            </label>
            {error && <div className="form-error" role="alert">{error}</div>}
            {full && <div className="form-error" role="alert">The desktop is full. Remove an icon first.</div>}
            <div className="desk-modal-actions">
              <button type="button" className="btn small" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn small primary" disabled={full}>
                Add website
              </button>
            </div>
          </form>
        ) : (
          <div className="desk-form">
            {full && <div className="form-error" role="alert">The desktop is full. Remove an icon first.</div>}
            {candidates.length ? (
              <div className="desk-pick-list" role="group" aria-label="Built-in windows and Fenna apps">
                {candidates.map((c) => (
                  <button key={targetKey(c)} type="button" className="desk-pick" disabled={full} onClick={() => addBuiltIn(c)}>
                    <span className="desk-pick-art">
                      <ShortcutArt item={c} size={24} />
                    </span>
                    <span className="ell">{c.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="desk-empty">Nothing else to add.</p>
            )}
            <div className="desk-modal-actions">
              <button type="button" className="btn small" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
