// The slide on the canvas. Unlike SlideView (thumbnails, present, print), it
// keeps its DOM across changes and patches it in place, and when a change
// came from outside (the AI) it animates it: see motion.ts.

import { type RefObject, useLayoutEffect, useMemo, useRef } from "react";
import { type ElementNode, type Theme, SLIDE_HEIGHT, SLIDE_WIDTH } from "@opendeck/format";
import { slideMarkup } from "@opendeck/render";
import { assetBase } from "../api.ts";
import { type MotionHooks, animateSlide, patchSlide } from "./motion.ts";
import type { RemoteChange } from "./store.ts";

/** A remote change older than this is not animated (the user arrived later). */
const FRESH_MS = 2000;
/** Read when used: each deck serves its assets at its own address. */
const opts = () => ({ assetBase: assetBase(), annotate: true });

interface Props {
  slideId: string;
  slide: ElementNode;
  theme: Theme;
  width: number;
  remote: RemoteChange | null;
  hooks: MotionHooks;
  /** Finishes any running animation at once (the canvas calls it before the user acts). */
  settleRef: RefObject<(() => void) | null>;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function LiveSlide({ slideId, slide, theme, width, remote, hooks, settleRef }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const shown = useRef<{ id: string; html: string } | null>(null);
  const animated = useRef(0);
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  const html = useMemo(() => slideMarkup(slide, theme, opts()), [slide, theme]);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const was = shown.current;
    if (was && was.id === slideId && was.html === html) return;
    settleRef.current?.();
    settleRef.current = null;
    shown.current = { id: slideId, html };
    const sameSlide = was?.id === slideId;
    const fresh = remote && remote.slideId === slideId && remote.at > animated.current && Date.now() - remote.at < FRESH_MS;
    if (fresh && !reducedMotion()) {
      animated.current = remote.at;
      // Arriving from another slide: start from this slide's earlier version (or from empty, if it is new).
      const from = sameSlide ? undefined : remote.prev ? slideMarkup(remote.prev, theme, opts()) : null;
      settleRef.current = animateSlide(el, html, from, {
        cursor: (c) => hooksRef.current.cursor(c),
        settled: () => hooksRef.current.settled(),
      });
    } else if (sameSlide) patchSlide(el, html);
    else el.innerHTML = html;
  }, [slideId, html, remote, theme, settleRef]);

  // Leaving the canvas: nothing may keep running against a detached slide.
  useLayoutEffect(
    () => () => {
      settleRef.current?.();
      settleRef.current = null;
    },
    [settleRef],
  );

  const scale = width / SLIDE_WIDTH;
  return (
    <div className="slide-frame" style={{ width, height: SLIDE_HEIGHT * scale }}>
      <div ref={host} className="slide-scale" style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT, transform: `scale(${scale})` }} />
    </div>
  );
}
