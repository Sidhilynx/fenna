// The activity replay: one past run of a bot, step by step. The large picture
// is how the bot's browser looked after the chosen step, or a calm line when
// that step had no picture. The scrubber and the list move through the steps,
// and Play runs them on. Body only: the window around it belongs to Activity.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { errorText, invoke } from "../shared/api.ts";
import type { ReplayStep } from "../shared/contract.ts";

/** How long each step stays on screen while playing, at 1x. */
export const PLAY_MS = 1200;

/** The time of a step with seconds, in the person's clock; "" for a time that isn't one. */
export function stepTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/** The step a key moves to from step `i` of `count`, or null when the key does nothing here. */
export function moveIndex(i: number, key: string, count: number): number | null {
  if (count === 0) return null;
  const last = count - 1;
  if (key === "ArrowLeft") return Math.max(0, i - 1);
  if (key === "ArrowRight") return Math.min(last, i + 1);
  if (key === "Home") return 0;
  if (key === "End") return last;
  return null;
}

export function Replay({ bot, runId }: { bot: string; runId: string }) {
  const [steps, setSteps] = useState<ReplayStep[] | null>(null);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // A new run starts at its last step: how it ended.
  useEffect(() => {
    let alive = true;
    setSteps(null);
    setError("");
    setPlaying(false);
    invoke("crew:replay", bot, runId).then(
      (list) => {
        if (!alive) return;
        setSteps(list);
        setIndex(Math.max(0, list.length - 1));
      },
      (e) => {
        if (alive) setError(errorText(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [bot, runId]);

  const count = steps ? steps.length : 0;

  // While playing, each step stays for PLAY_MS (half as long at 2x), and playing stops at the last one.
  useEffect(() => {
    if (!playing || count === 0) return;
    if (index >= count - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIndex((i) => Math.min(count - 1, i + 1)), PLAY_MS / speed);
    return () => clearTimeout(t);
  }, [playing, index, count, speed]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (error) return <p className="hint">{error}</p>;
  if (!steps) return <p className="hint">Loading…</p>;
  if (!steps.length) return <p className="hint">Nothing to replay.</p>;

  const step: ReplayStep = steps[index] ?? { at: "", label: "" };

  /** A manual move: playback stops, and the step is shown. */
  const go = (i: number) => {
    setPlaying(false);
    setIndex(Math.max(0, Math.min(count - 1, i)));
  };

  const togglePlay = () => {
    if (playing) setPlaying(false);
    else {
      if (index >= count - 1) setIndex(0);
      setPlaying(true);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = moveIndex(index, e.key, count);
    if (next === null) return;
    e.preventDefault();
    go(next);
  };

  const scrub = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = r.width > 0 ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0;
    go(Math.round(f * (count - 1)));
  };

  return (
    <div className="replay" onKeyDown={onKey}>
      <div className="replay-main">
        <div className="replay-stage">
          {step.frame ? (
            <img key={index} className="replay-frame" src={step.frame} alt={step.label} />
          ) : (
            <div className="replay-empty">
              <p>{step.label}</p>
              <p className="hint">No picture for this step.</p>
            </div>
          )}
        </div>
        <div className="replay-caption">
          <span className="replay-label">{step.label}</span>
          <span className="replay-count">
            {index + 1} of {count}
          </span>
        </div>
        {step.url ? <p className="replay-url hint">{step.url}</p> : null}

        <div className="replay-controls">
          <button type="button" className="replay-play" onClick={togglePlay}>
            {playing ? "Pause" : "Play"}
          </button>
          <div className="replay-speed" role="group" aria-label="Speed">
            {([1, 2] as const).map((s) => (
              <button key={s} type="button" aria-pressed={speed === s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>
                {s}x
              </button>
            ))}
          </div>
        </div>

        <div
          className="replay-scrub"
          role="slider"
          tabIndex={0}
          aria-label="Step"
          aria-valuemin={1}
          aria-valuemax={count}
          aria-valuenow={index + 1}
          aria-valuetext={`${index + 1} of ${count}: ${step.label}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            scrub(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons) scrub(e);
          }}
        >
          {steps.map((s, i) => (
            <span key={i} aria-hidden="true" className={`replay-tick${s.frame ? " has-frame" : ""}${i === index ? " on" : ""}`} />
          ))}
        </div>
      </div>

      <ol className="replay-list">
        {steps.map((s, i) => (
          <li key={i}>
            <button
              type="button"
              ref={i === index ? activeRef : undefined}
              aria-current={i === index ? "step" : undefined}
              className={`replay-row${i === index ? " on" : ""}`}
              onClick={() => go(i)}
            >
              <span className="replay-time">{stepTime(s.at)}</span>
              <span className="replay-text">
                <span className="replay-label">{s.label}</span>
                {s.url ? <span className="replay-url">{s.url}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
