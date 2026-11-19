// Living edges: one transparent layer over the whole page that makes the
// pixel frames of Crew's components move. Around every framed thing on
// screen (buttons, fields, cards, bubbles, dialogs, menus, windows…) stray
// pixels jitter by one step and a torn segment now and then glitches out
// from a side or a corner. What the
// pointer is over, or what has focus, moves more. A component hidden under
// a dialog or menu shows nothing. Steps, not smooth motion; asleep while the
// window is hidden; off under prefers-reduced-motion.

import { useEffect, useRef } from "react";

/** The framed components that get living edges. */
const SELECTOR = [
  ".btn:not(.ghost)",
  ".field",
  ".composer",
  ".msg.you",
  ".doc-card",
  ".card",
  ".thumb",
  ".dialog",
  ".menu",
  ".pdt-pop",
  ".px-panel",
  ".px-tag",
  ".px-loader",
  ".px-switch",
  ".ctx-meter",
  ".chat-pick",
  ".tab[aria-selected='true']",
  ".row[aria-current='page']",
  ".seg",
  ".win",
  ".conn-card",
  ".tile",
  ".choice",
  ".pdt-spin-value",
  ".pdt-day.on",
].join(",");

const STEP_MS = 90;
const PX = 2;
const MAX_ELEMENTS = 120;

interface Edge {
  /** A torn segment showing for a few more steps. */
  tear: { side: number; along: number; len: number; out: number; left: number } | null;
}

/** A point on the outline of a box, `d` pixels along its perimeter from the top-left corner, clockwise, just outside the frame. */
function along(r: DOMRect, d: number): [number, number] {
  const w = Math.round(r.width) + PX * 2;
  const h = Math.round(r.height) + PX * 2;
  const x0 = Math.round(r.left) - PX * 2;
  const y0 = Math.round(r.top) - PX * 2;
  const p = ((d % (2 * (w + h))) + 2 * (w + h)) % (2 * (w + h));
  if (p < w) return [x0 + p, y0];
  if (p < w + h) return [x0 + w, y0 + (p - w)];
  if (p < 2 * w + h) return [x0 + w - (p - w - h), y0 + h];
  return [x0, y0 + h - (p - 2 * w - h)];
}

export function PixelEdges() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const edges = new WeakMap<Element, Edge>();
    let timer = 0;
    let lit = "";
    let sel = "";

    const readInk = () => {
      const s = getComputedStyle(document.documentElement);
      lit = s.getPropertyValue("--text").trim() || getComputedStyle(canvas).color;
      sel = s.getPropertyValue("--sel").trim() || lit;
    };

    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /** Whether the element is the thing actually on top at its centre (not covered by a dialog, menu or window). */
    const onTop = (el: Element, r: DOMRect) => {
      const x = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2));
      const y = Math.min(window.innerHeight - 1, Math.max(0, r.top + Math.min(r.height / 2, 12)));
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    };

    const dot = (x: number, y: number, a: number, ink: string) => {
      ctx.globalAlpha = a;
      ctx.fillStyle = ink;
      ctx.fillRect(x, y, PX, PX);
    };

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const els = document.querySelectorAll(SELECTOR);
      let n = 0;
      for (const el of els) {
        if (n >= MAX_ELEMENTS) break;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) continue;
        if (!onTop(el, r)) continue;
        n++;
        const hot = el.matches(":hover, :focus-visible, :focus-within, [aria-expanded='true']");
        const ink = hot ? sel : lit;
        let e = edges.get(el);
        if (!e) {
          e = { tear: null };
          edges.set(el, e);
        }
        const perimeter = 2 * (r.width + r.height) + PX * 8;

        // Jitter: a stray pixel or two flickering at a random place on the edge.
        const strays = hot ? 4 : Math.random() < 0.6 ? 1 : 0;
        for (let i = 0; i < strays; i++) {
          const [x, y] = along(r, Math.random() * perimeter);
          const out = Math.random() < 0.5 ? 0 : PX;
          dot(x + (Math.random() < 0.5 ? -out : out), y + (Math.random() < 0.5 ? -out : out), 0.35 + Math.random() * 0.4, ink);
        }

        // The tear: a short segment that glitches out from a side or corner for a few steps.
        if (!e.tear && Math.random() < (hot ? 0.3 : 0.06)) {
          const corner = Math.random() < 0.5;
          const side = (Math.random() * 4) | 0;
          const w = Math.round(r.width) + PX * 2;
          const h = Math.round(r.height) + PX * 2;
          const sideLen = side % 2 === 0 ? w : h;
          e.tear = { side, along: corner ? (Math.random() < 0.5 ? 0 : Math.max(0, sideLen - 10)) : Math.random() * Math.max(1, sideLen - 10), len: 3 + ((Math.random() * 4) | 0), out: PX * (1 + ((Math.random() * 2) | 0)), left: 1 + ((Math.random() * 3) | 0) };
        }
        if (e.tear) {
          const t = e.tear;
          const w = Math.round(r.width) + PX * 2;
          const h = Math.round(r.height) + PX * 2;
          const x0 = Math.round(r.left) - PX * 2;
          const y0 = Math.round(r.top) - PX * 2;
          const jag = (Math.random() < 0.5 ? -1 : 1) * PX;
          for (let i = 0; i < t.len; i++) {
            const k = t.along + i * PX;
            const lift = i % 2 ? jag : 0;
            if (t.side === 0) dot(x0 + k, y0 - t.out + lift, 0.8, ink);
            else if (t.side === 1) dot(x0 + w + t.out + lift, y0 + k, 0.8, ink);
            else if (t.side === 2) dot(x0 + w - k, y0 + h + t.out + lift, 0.8, ink);
            else dot(x0 - t.out + lift, y0 + h - k, 0.8, ink);
          }
          t.left--;
          if (t.left <= 0) e.tear = null;
        }
      }
      ctx.globalAlpha = 1;
    };

    const run = () => {
      window.clearInterval(timer);
      timer = 0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (still.matches || document.hidden) return;
      timer = window.setInterval(tick, STEP_MS);
    };

    size();
    readInk();
    const mo = new MutationObserver(readInk);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", readInk);
    window.addEventListener("resize", size);
    document.addEventListener("visibilitychange", run);
    still.addEventListener("change", run);
    run();
    return () => {
      window.clearInterval(timer);
      mo.disconnect();
      scheme.removeEventListener("change", readInk);
      window.removeEventListener("resize", size);
      document.removeEventListener("visibilitychange", run);
      still.removeEventListener("change", run);
    };
  }, []);

  return <canvas ref={ref} className="px-edges" aria-hidden />;
}
