// A living pixel layer: small square blocks on a grid that flicker on and
// off, jitter by one cell, and now and then a band of them glitches sideways.
// It sits behind a surface (position: absolute; inset: 0), never takes
// clicks, draws in a theme token's colour, ticks in whole steps (not smooth
// motion), sleeps while hidden or off screen, and under
// prefers-reduced-motion draws one still frame.

import { useEffect, useRef } from "react";

export interface PixelFieldProps {
  /** Blocks per 10,000 square pixels of the surface. */
  density?: number;
  /** Block size in CSS pixels; blocks sit on a grid of this size. */
  cell?: number;
  /** The CSS custom property the blocks are drawn in. */
  color?: string;
  /** Strongest opacity of a block, 0 to 1. */
  alpha?: number;
  /** Milliseconds between steps. */
  step?: number;
  /** How often (0 to 1, per step) a band glitches sideways. */
  glitch?: number;
  className?: string;
}

interface Block {
  x: number;
  y: number;
  /** Brightness level 0..3; 0 is off. */
  lit: number;
}

const LEVELS = [0, 0.35, 0.65, 1];

export function PixelField({ density = 6, cell = 3, color = "--text-3", alpha = 0.5, step = 110, glitch = 0.06, className }: PixelFieldProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !parent || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let blocks: Block[] = [];
    let cols = 0;
    let rows = 0;
    let band: { row: number; height: number; shift: number; left: number } | null = null;
    let timer = 0;
    let visible = true;
    let ink = "";

    const readInk = () => {
      const style = getComputedStyle(canvas);
      ink = style.getPropertyValue(color).trim() || style.color;
    };

    const layout = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      // Its size on screen comes from CSS (the parent's box), never from here: a fixed width could
      // overflow the parent, add a scrollbar, and loop with this resize.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.max(1, Math.floor(w / cell));
      rows = Math.max(1, Math.floor(h / cell));
      const n = Math.min(1500, Math.round(((w * h) / 10_000) * density));
      blocks = Array.from({ length: n }, () => ({ x: (Math.random() * cols) | 0, y: (Math.random() * rows) | 0, lit: (Math.random() * 4) | 0 }));
      readInk();
      draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = ink;
      for (const b of blocks) {
        if (!b.lit) continue;
        let x = b.x;
        if (band && b.y >= band.row && b.y < band.row + band.height) x += band.shift;
        ctx.globalAlpha = LEVELS[b.lit]! * alpha;
        ctx.fillRect(x * cell, b.y * cell, cell, cell);
      }
      // The glitch band also tears a short run of solid blocks.
      if (band) {
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillRect((band.left + band.shift) * cell, band.row * cell, Math.min(12, cols) * cell, cell);
      }
      ctx.globalAlpha = 1;
    };

    const tick = () => {
      for (const b of blocks) {
        const r = Math.random();
        if (r < 0.18) b.lit = (b.lit + 1) % 4;
        else if (r < 0.26) {
          // Vibrate: one cell in any direction, kept on the surface.
          b.x = Math.min(cols - 1, Math.max(0, b.x + (((Math.random() * 3) | 0) - 1)));
          b.y = Math.min(rows - 1, Math.max(0, b.y + (((Math.random() * 3) | 0) - 1)));
        }
      }
      if (band) band = null;
      else if (Math.random() < glitch) {
        band = { row: (Math.random() * rows) | 0, height: 1 + ((Math.random() * 3) | 0), shift: (Math.random() < 0.5 ? -1 : 1) * (2 + ((Math.random() * 4) | 0)), left: (Math.random() * cols) | 0 };
      }
      draw();
    };

    const run = () => {
      window.clearInterval(timer);
      timer = 0;
      if (still.matches || !visible || document.hidden) return;
      timer = window.setInterval(tick, step);
    };

    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(parent);
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((e) => {
      visible = e.some((x) => x.isIntersecting);
      run();
    });
    io?.observe(canvas);
    // The theme can change while the layer lives; its colour follows.
    const mo = new MutationObserver(() => {
      readInk();
      draw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const onVis = () => run();
    document.addEventListener("visibilitychange", onVis);
    still.addEventListener("change", run);
    run();
    return () => {
      window.clearInterval(timer);
      ro.disconnect();
      io?.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      still.removeEventListener("change", run);
    };
  }, [density, cell, color, alpha, step, glitch]);

  return <canvas ref={ref} className={`px-field${className ? ` ${className}` : ""}`} aria-hidden />;
}
