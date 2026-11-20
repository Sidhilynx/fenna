// A bot's commands: the Processes window (what runs now and what ran, with a
// port to open and Stop), the Console window (their live output, one tab per
// command) and the notice that a command started listening on a port while
// the person watches the computer. The window frames are drawn by the desk;
// these are the bodies.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "@opendeck/shell";
import { errorText, invoke } from "../shared/api.ts";
import type { BotSummary, ProcessInfo } from "../shared/contract.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import { bufText, cleanOutput, headerLine, isFollowing, lastLines, portUrl, statusText, runTime, formatDuration, type OutBuf } from "./processModel.ts";
import { stopProcess, useBotProcesses } from "./processStore.ts";

/** A tick each second while something runs, so running times count up. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [live]);
  return now;
}

/** Opens the bot's browser on a port a command listens on. */
export function openLocalPort(slug: string, port: number, open: (app: string) => void): void {
  open("browser");
  invoke("crew:navigate", slug, portUrl(port)).catch((e) => toast(errorText(e)));
}

const PROC_TAIL_LINES = 3;

function ProcessRow({ bot, proc, buf, now, onOpenPort }: { bot: BotSummary; proc: ProcessInfo; buf: OutBuf | undefined; now: number; onOpenPort(port: number): void }) {
  const running = proc.status === "running";
  const stop = () => stopProcess(bot.slug, proc.id);
  const tail = lastLines(buf ? bufText(buf) : proc.tail, PROC_TAIL_LINES);
  return (
    <li
      className="proc"
      tabIndex={0}
      aria-label={`${proc.command}, ${statusText(proc)}`}
      onKeyDown={(e: KeyboardEvent<HTMLLIElement>) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Delete" && running) {
          e.preventDefault();
          stop();
        }
      }}
    >
      <div className="proc-main">
        <span className="proc-cmd ell" title={proc.command}>
          {proc.command}
        </span>
        <span className={`proc-status ${proc.status}`}>{statusText(proc)}</span>
        <span className="proc-time">{formatDuration(runTime(proc, now))}</span>
        {proc.port !== null && (
          <button type="button" className="proc-port" onClick={() => onOpenPort(proc.port!)} title={`Open ${portUrl(proc.port)} in ${bot.name}'s browser`}>
            localhost:{proc.port}
          </button>
        )}
        {running && (
          <button type="button" className="btn small stop" onClick={stop} aria-label={`Stop ${proc.command}`}>
            <PixelIcon name="stop" size={12} />
            Stop
          </button>
        )}
      </div>
      <div className="proc-sub ell">{proc.project}</div>
      {tail.length > 0 && <pre className="proc-tail">{tail.join("\n")}</pre>}
    </li>
  );
}

export function ProcessesWindow({ bot, onOpenPort }: { bot: BotSummary; onOpenPort(port: number): void }) {
  const { list, out, error } = useBotProcesses(bot.slug);
  const now = useNow(!!list?.some((p) => p.status === "running"));
  if (!list) return <p className="hint ">{error || "Loading"}</p>;
  if (!list.length) {
    return <p className="hint ">{`Nothing is running. When ${bot.name} runs a command in a project, it shows here.`}</p>;
  }
  return (
    <div className="win-fill">
      <ul className="proc-list" aria-label={`${bot.name}'s processes`}>
        {list.map((p) => (
          <ProcessRow key={p.id} bot={bot} proc={p} buf={out[p.id]} now={now} onOpenPort={onOpenPort} />
        ))}
      </ul>
    </div>
  );
}

function ConsoleOutput({ proc, buf, now }: { proc: ProcessInfo; buf: OutBuf | undefined; now: number }) {
  const logRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  // New output scrolls the console down while it follows the end.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (following && el) el.scrollTop = el.scrollHeight;
  }, [buf, following]);

  const segs = buf?.segs ?? [];
  return (
    <div className="term-screen con-screen">
      <div className="term-body">
        <div
          className="term-log con-log"
          role="log"
          aria-label={`Output of ${proc.command}`}
          tabIndex={0}
          ref={logRef}
          onScroll={(e) => setFollowing(isFollowing(e.currentTarget.scrollTop, e.currentTarget.scrollHeight, e.currentTarget.clientHeight))}
        >
          <div className="con-head">{headerLine(proc, now)}</div>
          {buf?.cut && <p className="con-cut">Earlier output is not shown.</p>}
          {segs.length > 0 ? (
            <pre className="con-out">
              {segs.map((s, i) => (
                <span key={i} className={s.stream === "err" ? "con-err" : undefined}>
                  {cleanOutput(s.text)}
                </span>
              ))}
            </pre>
          ) : (
            <p className="con-cut">{proc.status === "running" ? "No output yet." : "No output."}</p>
          )}
        </div>
        {!following && (
          <button type="button" className="term-jump" onClick={() => setFollowing(true)}>
            Jump to latest
          </button>
        )}
      </div>
    </div>
  );
}

export function ConsoleWindow({ bot }: { bot: BotSummary }) {
  const { list, out, error } = useBotProcesses(bot.slug);
  const [picked, setPicked] = useState<string | null>(null);
  const now = useNow(!!list?.some((p) => p.status === "running"));
  if (!list) return <p className="hint ">{error || "Loading"}</p>;
  if (!list.length) {
    return <p className="hint ">{`Nothing has run yet. When ${bot.name} runs a command in a project, its output shows here.`}</p>;
  }
  const current = list.find((p) => p.id === picked) ?? list[0]!;
  return (
    <div className="win-fill con">
      <div className="con-tabs" role="tablist" aria-label="Commands">
        {list.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            className="con-tab"
            aria-selected={p.id === current.id}
            title={p.command}
            onClick={() => setPicked(p.id)}
          >
            <span className="ell">{p.command}</span>
          </button>
        ))}
      </div>
      <ConsoleOutput key={current.id} proc={current} buf={out[current.id]} now={now} />
    </div>
  );
}

interface Notice {
  key: string;
  text: string;
  port: number;
}

/**
 * A quiet note over the desktop when a command starts listening on a port.
 * Only commands that start while the person is watching are announced; the
 * ones already running when the desk opens are not.
 */
export function PortNotices({ bot, open }: { bot: BotSummary; open(app: string): void }) {
  const { list } = useBotProcesses(bot.slug);
  const [notes, setNotes] = useState<Notice[]>([]);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!list) return;
    const keys = list.filter((p) => p.status === "running" && p.port !== null).map((p) => `${p.id}:${p.port}`);
    if (!seen.current) {
      seen.current = new Set(keys);
      return;
    }
    const fresh = list.filter((p) => p.status === "running" && p.port !== null && !seen.current!.has(`${p.id}:${p.port}`));
    if (!fresh.length) return;
    for (const k of keys) seen.current.add(k);
    setNotes((n) => [...n, ...fresh.map((p) => ({ key: `${p.id}:${p.port}`, text: `${p.project} is running on localhost:${p.port}`, port: p.port! }))]);
  }, [list]);

  if (!notes.length) return null;
  const dismiss = (key: string) => setNotes((n) => n.filter((x) => x.key !== key));
  return (
    <div className="port-notes" role="status">
      {notes.map((n) => (
        <div key={n.key} className="port-note">
          <span className="port-text">{n.text}</span>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              dismiss(n.key);
              openLocalPort(bot.slug, n.port, open);
            }}
          >
            Open
          </button>
          <button type="button" className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={() => dismiss(n.key)}>
            <PixelIcon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
