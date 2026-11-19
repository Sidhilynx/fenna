// Viewers for files on the bot's disk: images, video and audio, text, and PDF.
// Body only: the window frame (title bar, close) is drawn by the desktop, so
// nothing here draws one. Every file is loaded from its crewfile URL, which the
// main process hands out for a disk path (crew:diskUrl).

import { useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";
import type { BotSummary, DiskEntry } from "../shared/contract.ts";
import { errorText, invoke } from "../shared/api.ts";
import { FileIcon } from "./FileIcon.tsx";
import { fileIconFor } from "./fileIcons.ts";

const TEXT_LIMIT = 1024 * 1024;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;

/** The crewfile URL of a disk entry, or the reason it has none. */
function useDiskUrl(slug: string, path: string): { url: string | null; error: string | null } {
  const [state, setState] = useState<{ key: string; url: string | null; error: string | null }>({ key: "", url: null, error: null });
  const key = `${slug}\n${path}`;
  useEffect(() => {
    let live = true;
    invoke("crew:diskUrl", slug, path)
      .then((url) => live && setState({ key, url, error: null }))
      .catch((e) => live && setState({ key, url: null, error: errorText(e) }));
    return () => {
      live = false;
    };
  }, [key]);
  if (state.key !== key) return { url: null, error: null };
  return { url: state.url, error: state.error };
}

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

export interface ImageViewerProps {
  bot: BotSummary;
  entry: DiskEntry;
  /** The other images in the same folder; ← and → move through them. */
  siblings?: DiskEntry[];
  /** The image on screen changed (with ← or →), so the window can retitle itself. */
  onChange?(entry: DiskEntry): void;
}

export function ImageViewer({ bot, entry, siblings, onChange }: ImageViewerProps) {
  const images = siblings && siblings.length ? siblings : [entry];
  const [path, setPath] = useState(entry.path);
  useEffect(() => setPath(entry.path), [entry.path]);
  const current = images.find((e) => e.path === path) ?? entry;
  const index = images.indexOf(current);
  const { url, error } = useDiskUrl(bot.slug, current.path);

  const [mode, setMode] = useState<"fit" | "zoom">("fit");
  const [zoom, setZoom] = useState(1);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Ctrl and wheel zoom; the listener is native so the page does not scroll too.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setMode("zoom");
      setZoom(clampZoom(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    setNatural(null);
    setBroken(false);
  }, [current.path]);

  const step = (by: number) => {
    const next = images[(index + by + images.length) % images.length];
    if (!next || next.path === current.path) return;
    setPath(next.path);
    onChange?.(next);
  };

  const zoomBy = (factor: number) => {
    setMode("zoom");
    setZoom((z) => clampZoom(z * factor));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" && images.length > 1) step(1);
    else if (e.key === "ArrowLeft" && images.length > 1) step(-1);
    else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(1 / 1.25);
    else if (e.key === "0") setMode("fit");
    else return;
    e.preventDefault();
  };

  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
  };

  const shownZoom = mode === "fit" ? null : zoom;
  const imgStyle = mode === "zoom" && natural ? { width: `${Math.round(natural.w * zoom)}px` } : undefined;

  return (
    <div className="vw vw-image" tabIndex={0} onKeyDown={onKeyDown} aria-label={`${current.name}, image`}>
      <div className="vw-bar">
        <button type="button" className="btn ghost" aria-pressed={mode === "fit"} onClick={() => setMode("fit")}>
          Fit
        </button>
        <button
          type="button"
          className="btn ghost"
          aria-pressed={mode === "zoom" && zoom === 1}
          onClick={() => {
            setMode("zoom");
            setZoom(1);
          }}
        >
          100%
        </button>
        <button type="button" className="btn ghost" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
          −
        </button>
        <button type="button" className="btn ghost" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
          +
        </button>
        {shownZoom !== null && <span className="vw-readout">{`${Math.round(shownZoom * 100)}%`}</span>}
        {images.length > 1 && (
          <span className="vw-count">
            <button type="button" className="btn ghost" aria-label="Previous image" onClick={() => step(-1)}>
              Previous
            </button>
            <span>{`${index + 1} of ${images.length}`}</span>
            <button type="button" className="btn ghost" aria-label="Next image" onClick={() => step(1)}>
              Next
            </button>
          </span>
        )}
      </div>
      <div ref={stageRef} className={`vw-stage ${mode}`}>
        {error || broken ? (
          <p className="vw-note">{error ? `Could not open this image. ${error}` : "Can't show this image."}</p>
        ) : url ? (
          <img className="vw-img" src={url} alt={current.name} style={imgStyle} onLoad={onLoad} onError={() => setBroken(true)} draggable={false} />
        ) : (
          <p className="vw-note">Loading…</p>
        )}
      </div>
    </div>
  );
}

export interface MediaPlayerProps {
  bot: BotSummary;
  entry: DiskEntry;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** A video or audio file with our own small controls. Space plays and pauses; ← and → seek 5 seconds. */
export function MediaPlayer({ bot, entry }: MediaPlayerProps) {
  const isVideo = entry.kind === "video";
  const { url, error } = useDiskUrl(bot.slug, entry.path);
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [failed, setFailed] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => setFailed(true));
    else el.pause();
  };

  const seekBy = (by: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = Math.min(Math.max(0, el.currentTime + by), Number.isFinite(el.duration) ? el.duration : el.currentTime);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "BUTTON" || tag === "INPUT") return;
    if (e.key === " ") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      seekBy(5);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      seekBy(-5);
    }
  };

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapRef.current?.requestFullscreen?.();
  };

  const shownError = error ?? (failed ? "Can't play this file." : null);

  return (
    <div ref={wrapRef} className={`vw vw-media${isVideo ? " is-video" : ""}${full ? " is-full" : ""}`} tabIndex={0} onKeyDown={onKeyDown} aria-label={`${entry.name}, ${isVideo ? "video" : "audio"}`}>
      <div className="vw-screen">
        {shownError ? (
          <p className="vw-note">{shownError}</p>
        ) : url ? (
          isVideo ? (
            <video
              ref={mediaRef}
              className="vw-video"
              src={url}
              playsInline
              onClick={toggle}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onDurationChange={(e) => setDuration(e.currentTarget.duration)}
              onError={() => setFailed(true)}
            />
          ) : (
            <div className="vw-audio">
              <FileIcon name={fileIconFor(entry.kind)} size={48} />
              <audio
                ref={mediaRef}
                src={url}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onDurationChange={(e) => setDuration(e.currentTarget.duration)}
                onError={() => setFailed(true)}
              />
              <span className="vw-audio-name">{entry.name}</span>
            </div>
          )
        ) : (
          <p className="vw-note">Loading…</p>
        )}
      </div>
      <div className="vw-controls">
        <button type="button" className="btn ghost vw-play" onClick={toggle} disabled={!url || !!shownError}>
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          className="vw-seek"
          aria-label="Seek"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          disabled={!url || !!shownError}
          onChange={(e) => {
            const el = mediaRef.current;
            if (el) el.currentTime = Number(e.target.value);
          }}
        />
        <span className="vw-time">{`${formatTime(time)} / ${formatTime(duration)}`}</span>
        <input
          type="range"
          className="vw-volume"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVolume(v);
            if (mediaRef.current) mediaRef.current.volume = v;
          }}
        />
        {isVideo && (
          <button type="button" className="btn ghost" onClick={toggleFull} aria-pressed={full} disabled={!url || !!shownError}>
            {full ? "Exit full screen" : "Full screen"}
          </button>
        )}
      </div>
    </div>
  );
}

export interface TextViewerProps {
  bot: BotSummary;
  entry: DiskEntry;
}

/** The first 1 MB of a text file, read-only, in monospace. */
export function TextViewer({ bot, entry }: TextViewerProps) {
  const { url, error } = useDiskUrl(bot.slug, entry.path);
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let live = true;
    setText(null);
    setLoadError(null);
    (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const chunks: Uint8Array[] = [];
      let total = 0;
      let cut = false;
      if (res.body) {
        const reader = res.body.getReader();
        while (total < TEXT_LIMIT) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          chunks.push(value);
          total += value.byteLength;
        }
        cut = total >= TEXT_LIMIT;
        if (cut) await reader.cancel();
      } else {
        const all = new Uint8Array(await res.arrayBuffer());
        cut = all.byteLength > TEXT_LIMIT;
        chunks.push(all);
        total = all.byteLength;
      }
      const joined = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) {
        joined.set(c, at);
        at += c.byteLength;
      }
      const bytes = joined.subarray(0, Math.min(total, TEXT_LIMIT));
      const decoded = new TextDecoder("utf-8").decode(bytes);
      if (!live) return;
      if (decoded.includes("\u0000")) {
        setLoadError("Not a text file.");
        return;
      }
      setTruncated(cut);
      setText(decoded);
    })().catch((e) => {
      if (live) setLoadError(errorText(e));
    });
    return () => {
      live = false;
    };
  }, [url]);

  const failure = error ?? loadError;

  return (
    <div className="vw vw-text" tabIndex={0} aria-label={`${entry.name}, text`}>
      {failure ? (
        <p className="vw-note">{`Could not open this file. ${failure}`}</p>
      ) : text === null ? (
        <p className="vw-note">Loading…</p>
      ) : (
        <>
          <pre className="vw-pre">{text}</pre>
          {truncated && <p className="vw-foot">Showing the first 1 MB.</p>}
        </>
      )}
    </div>
  );
}

export interface PdfViewerProps {
  bot: BotSummary;
  entry: DiskEntry;
}

/**
 * A PDF in the page's own viewer. Best effort: it shows where the embedded
 * PDF viewer is available (Chromium), and says so where it is not.
 */
export function PdfViewer({ bot, entry }: PdfViewerProps) {
  const { url, error } = useDiskUrl(bot.slug, entry.path);
  if (error) return <div className="vw vw-pdf"><p className="vw-note">{`Could not open this file. ${error}`}</p></div>;
  if (!url) return <div className="vw vw-pdf"><p className="vw-note">Loading…</p></div>;
  return (
    <div className="vw vw-pdf">
      <iframe className="vw-frame" src={url} title={entry.name} />
    </div>
  );
}
