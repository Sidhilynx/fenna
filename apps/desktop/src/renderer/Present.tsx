// Full-screen show.
//
// Advancing first plays the slide's builds (pinned elements with
// data-build, in their order), then moves to the next slide with that
// slide's transition: fade, push, or morph (elements with the same id on
// both slides glide from where they were to where they are). Skipped slides
// are left out. Keys: → ↓ Space PageDown Enter forward; ← ↑ PageUp Backspace
// back; Home/End; a number then Enter jumps; B blacks the screen; Esc leaves.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type LoadedDeck, SLIDE_HEIGHT, SLIDE_WIDTH } from "@opendeck/format";
import { SlideView } from "./SlideView.tsx";
import { Icon } from "@opendeck/shell";

interface Props {
  deck: LoadedDeck;
  start: number;
  onExit(at: number): void;
}

const DURATION = 420;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Build steps on a rendered slide: pinned elements with data-build, by order then position. */
function buildSteps(root: HTMLElement): HTMLElement[] {
  const els = [...root.querySelectorAll<HTMLElement>(".od-slide > [data-build]")];
  return els
    .map((el, i) => ({ el, i, order: Number(/\b(\d{1,2})\b/.exec(el.dataset.build ?? "")?.[1] ?? 99) }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map((x) => x.el);
}

const BUILD_FROM: Record<string, string> = {
  fade: "opacity:0",
  rise: "opacity:0;translate:0 48px",
  drop: "opacity:0;translate:0 -48px",
  scale: "opacity:0;scale:0.85",
  left: "opacity:0;translate:-96px 0",
  right: "opacity:0;translate:96px 0",
};

export function Present({ deck, start, onExit }: Props) {
  const shown = deck.slides.map((s, i) => ({ s, i })).filter(({ s }) => s.slide && s.slide.attrs.hidden === undefined);
  const [pos, setPos] = useState(() => Math.max(0, shown.findIndex(({ i }) => i >= start)));
  const [prev, setPrev] = useState<{ pos: number; dir: 1 | -1 } | null>(null);
  const [built, setBuilt] = useState(0);
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [black, setBlack] = useState(false);
  const [chrome, setChrome] = useState(false);
  const [typed, setTyped] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const curId = shown[pos]?.s.id;

  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, []);

  const exit = useCallback(() => onExit(shown[pos]?.i ?? start), [onExit, shown, pos, start]);

  const steps = useCallback(() => (stageRef.current ? buildSteps(stageRef.current.querySelector(".present-slide.in") as HTMLElement) : []), []);

  const go = useCallback(
    (to: number, dir: 1 | -1) => {
      const n = Math.max(0, Math.min(shown.length - 1, to));
      if (n === pos) return;
      setPrev({ pos, dir });
      setPos(n);
      // Going back shows the slide fully built.
      setBuilt(dir < 0 ? Number.MAX_SAFE_INTEGER : 0);
    },
    [pos, shown.length],
  );

  const forward = useCallback(() => {
    const total = steps().length;
    if (built < total) setBuilt((b) => b + 1);
    else go(pos + 1, 1);
  }, [built, steps, go, pos]);

  const back = useCallback(() => {
    if (built > 0 && built !== Number.MAX_SAFE_INTEGER && built <= steps().length) setBuilt((b) => b - 1);
    else go(pos - 1, -1);
  }, [built, steps, go, pos]);

  // Apply build state to the incoming slide's elements.
  useLayoutEffect(() => {
    const list = steps();
    list.forEach((el, k) => {
      const visible = k < built;
      const effect = (el.dataset.build ?? "fade").split(/\s+/)[0]!;
      el.style.transition = reduced() ? "none" : `opacity ${DURATION}ms cubic-bezier(.2,0,0,1), translate ${DURATION}ms cubic-bezier(.2,0,0,1), scale ${DURATION}ms cubic-bezier(.2,0,0,1)`;
      if (visible) {
        el.style.opacity = "";
        el.style.translate = "";
        el.style.scale = "";
      } else
        for (const decl of (BUILD_FROM[effect] ?? BUILD_FROM.fade!).split(";")) {
          const [k2, v] = decl.split(":") as [string, string];
          el.style.setProperty(k2, v);
        }
    });
  }, [built, curId, steps]);

  // Morph: elements with an id on both slides glide from their old box to their new one.
  useLayoutEffect(() => {
    if (!prev || reduced()) return;
    const stage = stageRef.current;
    const incoming = stage?.querySelector<HTMLElement>(".present-slide.in");
    const outgoing = stage?.querySelector<HTMLElement>(".present-slide.out");
    const transition = shown[pos]?.s.slide?.attrs["data-transition"];
    if (!incoming || !outgoing || transition !== "morph") return;
    const scale = incoming.getBoundingClientRect().width / SLIDE_WIDTH;
    for (const el of incoming.querySelectorAll<HTMLElement>("[id]")) {
      const old = outgoing.querySelector<HTMLElement>(`[id="${CSS.escape(el.id)}"]`);
      if (!old) continue;
      const a = old.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const dx = (a.left - b.left) / scale;
      const dy = (a.top - b.top) / scale;
      const sx = a.width / Math.max(1, b.width);
      const sy = a.height / Math.max(1, b.height);
      el.animate([{ transformOrigin: "0 0", translate: `${dx}px ${dy}px`, scale: `${sx} ${sy}` }, { transformOrigin: "0 0", translate: "0 0", scale: "1 1" }], { duration: 560, easing: "cubic-bezier(.2,0,0,1)" });
      old.style.visibility = "hidden";
    }
  }, [prev, pos, shown]);

  // Drop the outgoing slide once its transition is over.
  useEffect(() => {
    if (!prev) return;
    const t = setTimeout(() => setPrev(null), reduced() ? 0 : DURATION + 160);
    return () => clearTimeout(t);
  }, [prev]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) return setTyped((t) => (t + e.key).slice(-3));
      if (e.key === "Enter" && typed) {
        go(Number(typed) - 1, Number(typed) - 1 > pos ? 1 : -1);
        setTyped("");
      } else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) forward();
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) back();
      else if (e.key === "Home") go(0, -1);
      else if (e.key === "End") go(shown.length - 1, 1);
      else if (e.key.toLowerCase() === "b" || e.key === ".") setBlack((b) => !b);
      else if (e.key === "Escape") exit();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [forward, back, go, exit, typed, pos, shown.length]);

  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) exit();
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [exit]);

  const showChrome = () => {
    setChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), 1800);
  };

  const width = Math.min(view.w, (view.h * SLIDE_WIDTH) / SLIDE_HEIGHT);
  const cur = shown[pos];
  const old = prev ? shown[prev.pos] : null;
  const transition = cur?.s.slide?.attrs["data-transition"] ?? "fade";
  const anim = !prev || reduced() ? "" : transition === "push" ? (prev.dir > 0 ? "push-next" : "push-prev") : transition === "none" ? "" : "fade";

  return (
    <div
      ref={stageRef}
      className={`present${chrome ? " chrome" : ""}`}
      onMouseMove={showChrome}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".present-bar")) return;
        const link = (e.target as HTMLElement).closest("a");
        if (link) {
          const n = /^#slide-(\d+)$/.exec(link.getAttribute("href") ?? "");
          if (n) {
            e.preventDefault();
            const target = shown.findIndex(({ i }) => i === Number(n[1]) - 1);
            if (target >= 0) go(target, target > pos ? 1 : -1);
          }
          return; // web links open in the browser
        }
        if (e.clientX < window.innerWidth / 4) back();
        else forward();
      }}
    >
      {old?.s.slide && (
        <div key={`out-${old.s.id}`} className={`present-slide out ${anim}`} style={{ width }}>
          <SlideView slide={old.s.slide} theme={deck.index.theme} width={width} />
        </div>
      )}
      {cur?.s.slide && (
        <div key={`in-${cur.s.id}`} className={`present-slide in ${anim}`} style={{ width }}>
          <SlideView slide={cur.s.slide} theme={deck.index.theme} width={width} />
        </div>
      )}
      {black && <div className="present-black" />}
      <div className="present-bar" aria-hidden={!chrome}>
        <button className="icon-btn" onClick={back} aria-label="Previous">
          <Icon name="chevronLeft" />
        </button>
        <span className="present-count">
          {typed ? `Go to ${typed}…` : `${pos + 1} / ${shown.length}`}
        </span>
        <button className="icon-btn" onClick={forward} aria-label="Next">
          <Icon name="chevronRight" />
        </button>
        <button className="icon-btn" onClick={exit} aria-label="End show">
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}
