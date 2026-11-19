// The windows on a bot's computer, as data: where each one is, which is in
// front, which is minimized or maximized, and the order of the taskbar. The
// reducer is pure; the page keeps one state per bot and the frame and taskbar
// only read it. Where a window was is remembered by its key, per bot.

export const MIN_W = 320;
export const MIN_H = 220;
/** How much of a window's title bar must stay on the desktop when it is dragged. */
const GRAB_W = 96;
const GRAB_H = 40;
const CASCADE = 32;
const CASCADE_STEPS = 8;
const DESK_KEEP = 200;

export const DEFAULT_SIZE: AppSize = { w: 640, h: 480 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The area windows live in: the desktop above the taskbar. */
export interface Size {
  width: number;
  height: number;
}

export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface AppSize {
  w: number;
  h: number;
  /** Opens maximized the first time. */
  max?: boolean;
}

/** Where a window goes back to: its normal bounds and whether it was maximized. */
export interface Placement extends Rect {
  max: boolean;
}

export interface WindowState extends Rect {
  id: string;
  app: string;
  key: string;
  title: string;
  /** Stacking order: the higher, the nearer the front. */
  z: number;
  min: boolean;
  max: boolean;
  props: Record<string, unknown>;
}

export interface WindowsState {
  /** Taskbar order. */
  windows: WindowState[];
  focus: string | null;
  top: number;
  seq: number;
  desk: Size;
  /** A maximized window's normal bounds, by window id. */
  saved: Record<string, Rect>;
  /** Normal bounds by window key, kept across sessions. */
  placements: Record<string, Placement>;
}

export type WindowAction =
  | { type: "open"; app: string; key?: string; title: string; props?: Record<string, unknown>; size?: AppSize }
  | { type: "close"; id: string }
  | { type: "focus"; id: string }
  | { type: "move"; id: string; x: number; y: number }
  | { type: "resize"; id: string; rect: Rect }
  | { type: "minimize"; id: string }
  | { type: "restore"; id: string }
  | { type: "maximize"; id: string }
  | { type: "unmaximize"; id: string }
  | { type: "reorder"; id: string; to: number }
  | { type: "retitle"; id: string; title: string }
  | { type: "desk"; size: Size };

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const full = (desk: Size): Rect => ({ x: 0, y: 0, w: desk.width, h: desk.height });

/** A window's size and place kept inside the desktop. Its size never goes below the minimum. */
export function fitRect(r: Rect, desk: Size): Rect {
  const w = clamp(r.w, MIN_W, Math.max(MIN_W, desk.width));
  const h = clamp(r.h, MIN_H, Math.max(MIN_H, desk.height));
  return { x: clamp(r.x, 0, Math.max(0, desk.width - w)), y: clamp(r.y, 0, Math.max(0, desk.height - h)), w, h };
}

/** A dragged window, kept with its title bar on the desktop: at least a grab's width is always in view. */
export function moveRect(r: Rect, desk: Size): Rect {
  return { ...r, x: clamp(r.x, GRAB_W - r.w, desk.width - GRAB_W), y: clamp(r.y, 0, desk.height - GRAB_H) };
}

/** The bounds after dragging an edge or corner by (dx, dy), from the bounds where the drag began. The opposite edge stays put. */
export function resizeRect(start: Rect, edge: Edge, dx: number, dy: number, desk: Size): Rect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (edge.includes("w")) left = clamp(start.x + dx, 0, right - MIN_W);
  if (edge.includes("e")) right = clamp(right + dx, left + MIN_W, Math.max(left + MIN_W, desk.width));
  if (edge.includes("n")) top = clamp(start.y + dy, 0, bottom - MIN_H);
  if (edge.includes("s")) bottom = clamp(bottom + dy, top + MIN_H, Math.max(top + MIN_H, desk.height));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function cascade(n: number, size: AppSize, desk: Size): Rect {
  // Centred on the desktop, each new window a step down and right of the last.
  const step = (n % CASCADE_STEPS) * CASCADE - ((CASCADE_STEPS - 1) * CASCADE) / 4;
  const x = Math.round((desk.width - size.w) / 2 + step);
  const y = Math.round((desk.height - size.h) / 3 + step);
  return fitRect({ x, y, w: size.w, h: size.h }, desk);
}

/** The window that should have focus when the front one goes: the front-most visible one, or none. */
function frontmost(windows: readonly WindowState[]): string | null {
  let best: WindowState | null = null;
  for (const w of windows) if (!w.min && (!best || w.z > best.z)) best = w;
  return best?.id ?? null;
}

function raise(s: WindowsState, id: string): WindowsState {
  if (s.focus === id) return s;
  return { ...s, focus: id, top: s.top + 1, windows: s.windows.map((w) => (w.id === id ? { ...w, z: s.top } : w)) };
}

/** Sets a window's bounds and remembers them as its normal place for its key. */
function place(s: WindowsState, win: WindowState, rect: Rect): WindowsState {
  return {
    ...s,
    windows: s.windows.map((w) => (w.id === win.id ? { ...w, ...rect } : w)),
    placements: { ...s.placements, [win.key]: { ...rect, max: false } },
  };
}

function patch(s: WindowsState, id: string, change: Partial<WindowState>): WindowsState {
  return { ...s, windows: s.windows.map((w) => (w.id === id ? { ...w, ...change } : w)) };
}

export function initialWindows(placements: Record<string, Placement> = {}, desk: Size = { width: 1200, height: 800 }): WindowsState {
  return { windows: [], focus: null, top: 1, seq: 1, desk, saved: {}, placements };
}

export function windowsReducer(s: WindowsState, a: WindowAction): WindowsState {
  switch (a.type) {
    case "open": {
      const key = a.key ?? a.app;
      const existing = s.windows.find((w) => w.key === key);
      if (existing) {
        const next = patch(s, existing.id, { title: a.title, props: a.props ?? existing.props, min: false });
        return raise(next, existing.id);
      }
      const id = `w${s.seq}`;
      const size = a.size ?? DEFAULT_SIZE;
      const placed = s.placements[key];
      const normal = placed ? fitRect(placed, s.desk) : cascade(s.windows.length, size, s.desk);
      const max = placed ? placed.max : !!size.max;
      const win: WindowState = { id, app: a.app, key, title: a.title, ...(max ? full(s.desk) : normal), z: s.top, min: false, max, props: a.props ?? {} };
      return {
        ...s,
        seq: s.seq + 1,
        top: s.top + 1,
        windows: [...s.windows, win],
        focus: id,
        saved: max ? { ...s.saved, [id]: normal } : s.saved,
      };
    }

    case "close": {
      const win = s.windows.find((w) => w.id === a.id);
      if (!win) return s;
      const windows = s.windows.filter((w) => w.id !== a.id);
      const saved = { ...s.saved };
      delete saved[a.id];
      return { ...s, windows, saved, focus: s.focus === a.id ? frontmost(windows) : s.focus };
    }

    case "focus": {
      const win = s.windows.find((w) => w.id === a.id);
      if (!win || win.min) return s;
      return raise(s, a.id);
    }

    case "move": {
      const win = s.windows.find((w) => w.id === a.id);
      if (!win || win.max || win.min) return s;
      return place(s, win, moveRect({ x: a.x, y: a.y, w: win.w, h: win.h }, s.desk));
    }

    case "resize": {
      const win = s.windows.find((w) => w.id === a.id);
      if (!win || win.max || win.min) return s;
      return place(s, win, fitRect(a.rect, s.desk));
    }

    case "minimize": {
      const win = s.windows.find((w) => w.id === a.id);
      if (!win || win.min) return s;
      const next = patch(s, a.id, { min: true });
      return { ...next, focus: s.focus === a.id ? frontmost(next.windows) : s.focus };
    }

    case "restore": {
      const win = s.windows.find((w) => w.id === a.id);
      if (!win) return s;
      return raise(patch(s, a.id, { min: false }), a.id);
    }

    case "maximize": {
      const win = s.windows.find((w) => w.id === a.id);
      if (!win || win.max || win.min) return s;
      const normal: Rect = { x: win.x, y: win.y, w: win.w, h: win.h };
      const next = patch(s, a.id, { ...full(s.desk), max: true });
      return raise(
        { ...next, saved: { ...s.saved, [a.id]: normal }, placements: { ...s.placements, [win.key]: { ...normal, max: true } } },
        a.id,
      );
    }

    case "unmaximize": {
      const win = s.windows.find((w) => w.id === a.id);
      if (!win || !win.max || win.min) return s;
      const normal = fitRect(s.saved[a.id] ?? cascade(0, DEFAULT_SIZE, s.desk), s.desk);
      const saved = { ...s.saved };
      delete saved[a.id];
      const next = patch({ ...s, saved }, a.id, { ...normal, max: false });
      return raise({ ...next, placements: { ...s.placements, [win.key]: { ...normal, max: false } } }, a.id);
    }

    case "reorder": {
      const from = s.windows.findIndex((w) => w.id === a.id);
      if (from < 0) return s;
      const to = clamp(a.to, 0, s.windows.length - 1);
      if (to === from) return s;
      const windows = [...s.windows];
      const [moved] = windows.splice(from, 1);
      windows.splice(to, 0, moved!);
      return { ...s, windows };
    }

    case "retitle": {
      const win = s.windows.find((w) => w.id === a.id);
      if (!win || win.title === a.title) return s;
      return patch(s, a.id, { title: a.title });
    }

    case "desk": {
      const { width, height } = a.size;
      if (width === s.desk.width && height === s.desk.height) return s;
      const windows = s.windows.map((w) => (w.max ? { ...w, ...full(a.size) } : { ...w, ...fitRect(w, a.size) }));
      return { ...s, desk: { width, height }, windows };
    }
  }
}

/** Each window's place in the stack, 0 at the back. Windows keep their own z; this only numbers them for rendering. */
export function stackRank(windows: readonly WindowState[]): Map<string, number> {
  const sorted = [...windows].sort((a, b) => a.z - b.z);
  return new Map(sorted.map((w, i) => [w.id, i]));
}

// ── Remembering placements per bot ──────────────────────────────────────

type Store = Pick<Storage, "getItem" | "setItem">;

export const placementsKey = (slug: string): string => `fenna:windows:${slug}`;

function browserStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const isPlacement = (v: unknown): v is Placement => {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return ["x", "y", "w", "h"].every((k) => typeof p[k] === "number" && Number.isFinite(p[k])) && typeof p.max === "boolean";
};

/** The remembered placements for a bot. Nothing when the browser has none, or the saved text is broken. */
export function readPlacements(slug: string, store: Store | null = browserStore()): Record<string, Placement> {
  try {
    const raw = store?.getItem(placementsKey(slug));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, Placement> = {};
    for (const [key, value] of Object.entries(parsed)) if (isPlacement(value)) out[key] = value;
    return out;
  } catch {
    return {};
  }
}

/** Keeps the placements for a bot. A browser that refuses the write just forgets positions. */
export function writePlacements(slug: string, placements: Record<string, Placement>, store: Store | null = browserStore()): void {
  try {
    const kept = Object.entries(placements).slice(-DESK_KEEP);
    store?.setItem(placementsKey(slug), JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* windows still work; they open at their default places next time */
  }
}
