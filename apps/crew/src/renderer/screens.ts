// Every bot's screen as the page sees it: who is watching what, the latest
// frames, the bot's cursor and its browser state. One watcher per page and
// bot exists in the main process, so every view that wants a bot's screen
// asks here, and the strongest ask wins (live over thumbnail over nothing).

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { invoke, on } from "../shared/api.ts";
import type { BrowserState, CursorEvent, FrameEvent, Overview, WatchMode } from "../shared/contract.ts";

interface Screen {
  /** Blob URL of the latest thumbnail. */
  thumb: string | null;
  browser: BrowserState | null;
  cursor: CursorEvent | null;
  /** Counts cursor events, so a repeated target still moves the view on. */
  cursorSeq: number;
}

const EMPTY: Screen = { thumb: null, browser: null, cursor: null, cursorSeq: 0 };
const screens = new Map<string, Screen>();
const subs = new Map<string, Set<() => void>>();
/** A live frame: the JPEG, its pixel size, and the page's size in CSS pixels when it was painted. */
interface Live {
  jpeg: Blob;
  w: number;
  h: number;
  view: { width: number; height: number };
}
const liveSubs = new Map<string, Set<(f: Live) => void>>();
const lastLive = new Map<string, Live>();
const wants = new Map<string, Map<symbol, "live" | "thumb">>();
const applied = new Map<string, WatchMode>();
const frameListeners: Array<() => void> = [];

const get = (slug: string): Screen => screens.get(slug) ?? EMPTY;
const patch = (slug: string, p: Partial<Screen>) => {
  screens.set(slug, { ...get(slug), ...p });
  subs.get(slug)?.forEach((f) => f());
};

function start() {
  if (frameListeners.length) return;
  frameListeners.push(
    on("crew:frame", (f: FrameEvent) => {
      const blob = new Blob([f.jpeg as Uint8Array<ArrayBuffer>], { type: "image/jpeg" });
      if (f.kind === "live") {
        // An older main process sends no view size; its pages were laid out at the default.
        const live = { jpeg: blob, w: f.width, h: f.height, view: { width: f.viewWidth || f.width, height: f.viewHeight || f.height } };
        lastLive.set(f.slug, live);
        liveSubs.get(f.slug)?.forEach((fn) => fn(live));
        return;
      }
      const old = get(f.slug).thumb;
      patch(f.slug, { thumb: URL.createObjectURL(blob) });
      if (old) URL.revokeObjectURL(old);
    }),
    on("crew:browser", (b) => {
      // A browser with no tabs left shows no picture of its old page.
      const old = b.state.tabs.length ? null : get(b.slug).thumb;
      patch(b.slug, b.state.tabs.length ? { browser: b.state } : { browser: b.state, thumb: null });
      if (old) URL.revokeObjectURL(old);
    }),
    on("crew:cursor", (c) => patch(c.slug, { cursor: c, cursorSeq: get(c.slug).cursorSeq + 1 })),
  );
}

/** Take the browser states that come with the overview. */
export function absorbOverview(o: Overview) {
  for (const b of o.bots) {
    const cur = get(b.slug).browser;
    if (b.browser && JSON.stringify(cur) !== JSON.stringify(b.browser)) patch(b.slug, { browser: b.browser });
  }
}

function settle(slug: string) {
  const w = wants.get(slug);
  const modes = w ? [...w.values()] : [];
  const mode: WatchMode = modes.includes("live") ? "live" : modes.includes("thumb") ? "thumb" : "off";
  if ((applied.get(slug) ?? "off") === mode) return;
  applied.set(slug, mode);
  if (mode === "off") {
    lastLive.delete(slug);
    const t = get(slug).thumb;
    if (t) {
      URL.revokeObjectURL(t);
      patch(slug, { thumb: null });
    }
  }
  invoke("crew:watch", slug, mode).then((state) => patch(slug, { browser: state }), () => undefined);
}

/** Ask for a bot's screen while `active`; stops when it is not. */
export function useWatch(slug: string, mode: "live" | "thumb", active = true) {
  useEffect(() => {
    if (!active) return;
    start();
    const me = Symbol("watch");
    const w = wants.get(slug) ?? new Map();
    w.set(me, mode);
    wants.set(slug, w);
    settle(slug);
    return () => {
      w.delete(me);
      if (!w.size) wants.delete(slug);
      settle(slug);
    };
  }, [slug, mode, active]);
}

export function useScreen(slug: string): Screen {
  start();
  return useSyncExternalStore(
    (fn) => {
      const set = subs.get(slug) ?? new Set();
      set.add(fn);
      subs.set(slug, set);
      return () => {
        set.delete(fn);
      };
    },
    () => get(slug),
  );
}

/**
 * A bot's live screen on a canvas (give it data-live={slug}): GPU frames are
 * drawn onto it by the shell's preload, JPEG frames here, each at its own
 * pixel size. `view` is the page's size in CSS pixels for the frame on the canvas
 * (null until the first one): lay the canvas out and map input with it.
 */
export function useLiveCanvas(slug: string, active: boolean) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<{ width: number; height: number } | null>(() => lastLive.get(slug)?.view ?? null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let busy = false;
    let pending: Live | null = null;
    const draw = async (f: Live) => {
      const canvas = ref.current;
      if (!canvas) return;
      if (busy) {
        pending = f;
        return;
      }
      busy = true;
      try {
        const bmp = await createImageBitmap(f.jpeg);
        if (alive && ref.current) {
          if (canvas.width !== f.w || canvas.height !== f.h) {
            canvas.width = f.w;
            canvas.height = f.h;
          }
          canvas.getContext("2d")?.drawImage(bmp, 0, 0, f.w, f.h);
          setView((v) => (v && v.width === f.view.width && v.height === f.view.height ? v : f.view));
        }
        bmp.close();
      } catch {
        /* a frame that can't be decoded is skipped; the next one replaces it */
      } finally {
        busy = false;
        if (pending && alive) {
          const p = pending;
          pending = null;
          void draw(p);
        }
      }
    };
    const set = liveSubs.get(slug) ?? new Set();
    set.add(draw);
    liveSubs.set(slug, set);
    const last = lastLive.get(slug);
    if (last) void draw(last);
    // GPU frames are drawn onto the canvas by the shell's preload; only their page size comes here.
    const canvas = ref.current;
    const onGpu = () => {
      const width = Number(canvas?.dataset.viewWidth);
      const height = Number(canvas?.dataset.viewHeight);
      if (width > 0 && height > 0) setView((v) => (v && v.width === width && v.height === height ? v : { width, height }));
    };
    canvas?.addEventListener("liveframe", onGpu);
    return () => {
      alive = false;
      set.delete(draw);
      canvas?.removeEventListener("liveframe", onGpu);
    };
  }, [slug, active]);
  return { ref, view };
}
