// A bot's own computer: a small desktop of our own. Desktop icons sit on the
// wallpaper; each app opens in a window the person can move, resize, minimize
// and close, with a button per open window on the taskbar. The person can watch,
// or take control. Apps are listed once in APPS below.

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AgentLogo, modelLogo, toast } from "@opendeck/shell";
import { errorText, invoke, on, send } from "../shared/api.ts";
import { FENNA_APPS, LIMITS } from "@opendeck/crew";
import { DEFAULT_VIEWPORT, type AppInfo, type BotSummary, type BrowserTab, type ControlInput, type DesktopShortcut, type DiskEntry, type FileKind, type LibraryItem, type Modifier, type RunEvent, type SaveOffer } from "../shared/contract.ts";
import { Avatar, Face } from "./Avatar.tsx";
import { ChatDock } from "./ChatDock.tsx";
import { ConnectorsWindow } from "./ConnectorsWindow.tsx";
import { AddShortcutDialog, DesktopIcons, useDesktop } from "./Desktop.tsx";
import { AppLauncher } from "./AppLauncher.tsx";
import { ClockApp } from "./ClockApp.tsx";
import { CodeWindow } from "./CodeWindow.tsx";
import { EditorWindow } from "./EditorWindow.tsx";
import { UserApp, useApps } from "./UserApp.tsx";
import { appTitleOf, syncAppIcons, userAppIcon } from "./userApps.ts";
import { FileManager } from "./FileManager.tsx";
import { NotificationBell } from "./NotificationCenter.tsx";
import { Replay } from "./Replay.tsx";
import { Terminal } from "./Terminal.tsx";
import { ConsoleWindow, PortNotices, ProcessesWindow, openLocalPort } from "./Processes.tsx";
import { FileInfo, ImageViewer, MediaPlayer, PdfViewer, TableViewer, TextViewer } from "./Viewers.tsx";
import { WallpaperPicker, useCustomWallpaper } from "./WallpaperPicker.tsx";
import { WindowFrame } from "./WindowFrame.tsx";
import { PixelIcon, gridRuns } from "./PixelIcon.tsx";
import { FileIcon } from "./FileIcon.tsx";
import { appIconFor, fileIconFor, type FileIconName } from "./fileIcons.ts";
import { botOf, useBotDetail, useCrew, waitingFor } from "./crew.tsx";
import { useLiveCanvas, useScreen, useWatch } from "./screens.ts";
import { wallStyle } from "./Thumb.tsx";
import { appToolLine, commandLine, loginLine, useRuns, type RunLog } from "./transcript.ts";
import { brainLabel, clock, toUrl, wakeLine, when } from "./util.ts";
import { initialWindows, readPlacements, stackRank, windowsReducer, writePlacements, type AppSize, type WindowAction, type WindowState } from "./windows.ts";
import { PixelField } from "./PixelField.tsx";
import { PixelLoader } from "./PixelMotion.tsx";

interface Line {
  key: string;
  at: string;
  text: string;
  head?: boolean;
  /** On a run's first line: the run, for its replay. */
  runId?: string;
}

/** "Today", or "Mon 16 Nov": the day a run began. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.toDateString() === new Date().toDateString()) return "Today";
  return `${d.toLocaleDateString([], { weekday: "short" })} ${d.toLocaleDateString([], { day: "numeric", month: "short" })}`;
}

/** What a run did, in plain lines, newest last. */
function activity(runs: RunLog[], names: (slug: string) => string): Line[] {
  const out: Line[] = [];
  for (const run of runs) {
    const tools = new Map<string, Line>();
    run.events.forEach((e: RunEvent, i) => {
      const key = `${run.key}:${i}`;
      switch (e.type) {
        case "start": {
          const why = e.trigger === "schedule" ? "Schedule" : e.trigger === "person" ? "You asked" : e.trigger === "bot" ? `${e.from ? names(e.from) : "Another bot"} asked` : e.trigger === "watch" ? "Watch" : e.trigger === "app" ? "An app" : "Hello";
          out.push({ key: `${key}:head`, at: e.at, text: `${dayLabel(e.at)} · ${why}`, head: true, runId: run.runId });
          out.push({
            key,
            at: e.at,
            text:
              e.trigger === "schedule"
                ? "Woke up on schedule"
                : e.trigger === "person"
                ? "You sent a message"
                : e.trigger === "bot"
                ? `${e.from ? names(e.from) : "Another bot"} asked for help`
                : e.trigger === "watch"
                ? wakeLine(e.text)
                : e.trigger === "app"
                  ? `An app sent: ${e.text}`
                  : "Said hello",
          });
          break;
        }
        case "tool": {
          const line = tools.get(e.id);
          const text = e.status === "failed" ? `${e.label} (failed)` : e.label;
          if (line) line.text = text;
          else {
            const l = { key, at: e.at, text };
            tools.set(e.id, l);
            out.push(l);
          }
          break;
        }
        case "ask":
          out.push({ key, at: e.at, text: `Asked you: ${e.question}` });
          break;
        case "approval":
          out.push({ key, at: e.at, text: `Asked you to approve: ${e.action}` });
          break;
        case "decision":
          out.push({ key, at: e.at, text: e.by === "person" ? (e.allowed ? "You approved" : "You denied") : "Timed out" });
          break;
        case "handoff":
          out.push({ key, at: e.at, text: `Handed work to ${names(e.to)}` });
          break;
        case "handback":
          out.push({ key, at: e.at, text: `${names(e.from)} answered` });
          break;
        case "login":
          out.push({ key, at: e.at, text: loginLine(e) });
          break;
        case "app_tool":
          out.push({ key, at: e.at, text: appToolLine(e) });
          break;
        case "command":
          out.push({ key, at: e.at, text: commandLine(e) });
          break;
        case "end":
          out.push({ key, at: e.at, text: e.outcome === "done" ? "Finished run" : e.outcome === "stopped" ? "Stopped" : `Failed: ${e.message || "error"}` });
          break;
        default:
          break;
      }
    });
  }
  return out.slice(-80);
}

/** The person signed in while in control: save that login to the vault for this bot? */
function SaveCard({ offer }: { offer: SaveOffer }) {
  const [username, setUsername] = useState(offer.username);
  const [busy, setBusy] = useState(false);
  const site = offer.origin.replace(/^https?:\/\//, "");
  const answer = (save: boolean) => {
    setBusy(true);
    invoke("crew:saveOffer", offer.id, save, save ? { username } : {}).then(
      (r) => r.item && toast(`${offer.existing ? "Updated" : "Saved"} ${r.item.label} in the vault.`),
      (e) => {
        setBusy(false);
        toast(errorText(e));
      },
    );
  };
  return (
    <div className="save-card px-panel" role="group" aria-label={`Save login for ${offer.botName}`}>
      <span className="card-title">Save login for {offer.botName}?</span>
      <span className="card-sub">{site}</span>
      <input className="field" aria-label="Username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" spellCheck={false} autoComplete="off" maxLength={LIMITS.vaultUsername} />
      <div className="card-acts">
        <button type="button" className="btn primary" disabled={busy} onClick={() => answer(true)}>
          Save
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => answer(false)}>
          Not now
        </button>
      </div>
    </div>
  );
}

const mods = (e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): Modifier[] => {
  const m: Modifier[] = [];
  if (e.shiftKey) m.push("shift");
  if (e.ctrlKey) m.push("control");
  if (e.altKey) m.push("alt");
  if (e.metaKey) m.push("meta");
  return m;
};
const BUTTONS = ["left", "middle", "right"] as const;
const RESIZE_SETTLE_MS = 150;

interface Shortcuts {
  newTab(): void;
  closeTab(): void;
  focusAddress(): void;
}

function Stage({ bot, control, shortcuts }: { bot: BotSummary; control: boolean; shortcuts: Shortcuts }) {
  const slug = bot.slug;
  const { ref: canvas, view: frameView } = useLiveCanvas(slug, true);
  const { browser, cursor, cursorSeq } = useScreen(slug);
  const area = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const move = useRef<number | null>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let first = true;
    const report = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      setBox({ width: r.width, height: r.height });
      const sendNow = () => send("crew:viewport", slug, { width: Math.floor(r.width), height: Math.floor(r.height), scale: window.devicePixelRatio || 1 });
      if (timer) clearTimeout(timer);
      if (first) {
        first = false;
        sendNow();
      } else timer = setTimeout(sendNow, RESIZE_SETTLE_MS);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [slug]);

  const view = frameView ?? browser?.view ?? DEFAULT_VIEWPORT;
  const scale = box ? Math.min(1, box.width / view.width, box.height / view.height) : 1;
  const has = frameView !== null;

  const point = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    return { x: clamp(((e.clientX - r.left) / r.width) * view.width, view.width), y: clamp(((e.clientY - r.top) / r.height) * view.height, view.height) };
  };
  const out = (input: ControlInput) => send("crew:input", slug, input);
  const pointRef = useRef(point);
  pointRef.current = point;

  useEffect(() => {
    const el = stage.current;
    if (!el || !control) return;
    el.focus();
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      out({ type: "mouseWheel", ...pointRef.current(e), deltaX: e.deltaX, deltaY: e.deltaY });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [control, slug]);

  const onBotTab = !cursor || cursor.tab === undefined || cursor.tab === null || cursor.tab === browser?.active;
  const showCursor = !control && cursor && onBotTab && (bot.running || bot.mood === "need");
  const w = view.width * scale;
  const flip = cursor ? cursor.x * scale > w - 130 : false;

  return (
    <div className="stage-area" ref={area}>
      {has && browser && !browser.url && (
        <div className="stage-empty">{control ? "Type an address to start." : "Nothing open in this tab."}</div>
      )}
      <div
        ref={stage}
        className={`stage${control ? " live" : ""}`}
        style={{ width: w, height: view.height * scale }}
        tabIndex={control ? 0 : -1}
        role={control ? "application" : undefined}
        onMouseDown={(e) => {
          if (!control) return;
          e.preventDefault();
          stage.current?.focus();
          out({ type: "mouseDown", ...point(e), button: BUTTONS[e.button] ?? "left", clickCount: Math.max(1, e.detail), modifiers: mods(e) });
        }}
        onMouseUp={(e) => control && out({ type: "mouseUp", ...point(e), button: BUTTONS[e.button] ?? "left", clickCount: Math.max(1, e.detail), modifiers: mods(e) })}
        onMouseMove={(e) => {
          if (!control || move.current !== null) return;
          const p = point(e);
          const m = mods(e);
          move.current = requestAnimationFrame(() => {
            move.current = null;
            out({ type: "mouseMove", ...p, modifiers: m });
          });
        }}
        onContextMenu={(e) => control && e.preventDefault()}
        onKeyDown={(e) => {
          if (!control) return;
          if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "g") return;
          const k = e.key.toLowerCase();
          e.preventDefault();
          e.stopPropagation();
          if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (k === "t" || k === "w" || k === "l")) {
            if (k === "t") shortcuts.newTab();
            else if (k === "w") shortcuts.closeTab();
            else shortcuts.focusAddress();
            return;
          }
          out({ type: "keyDown", key: e.key, modifiers: mods(e) });
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) out({ type: "char", key: e.key, modifiers: mods(e) });
        }}
        onKeyUp={(e) => {
          if (!control) return;
          e.preventDefault();
          out({ type: "keyUp", key: e.key, modifiers: mods(e) });
        }}
      >
        <canvas ref={canvas} className="stage-canvas" data-live={slug} width={view.width} height={view.height} />
        {!has && (
          <div className="stage-note" role="status" aria-label={`Opening ${bot.name}'s browser`}>
            <PixelLoader />
          </div>
        )}
        {showCursor && (
          <div className="bot-cursor" style={{ transform: `translate(${cursor.x * scale}px, ${cursor.y * scale}px)` }} aria-hidden>
            {cursor.action === "click" && <span key={cursorSeq} className="cursor-ring" />}
            <svg width="20" height="20" viewBox="0 0 20 20">
              <path className="cursor-shape" d="M3 2v14l4-4 3 6 2.2-1-3-6H15z" />
            </svg>
            <span className={`cursor-tag${flip ? " flip" : ""}`} title={cursor.target}>
              {bot.name}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const tabLabel = (t: BrowserTab) => t.title || t.url.replace(/^https?:\/\//, "").replace(/\/$/, "") || "New tab";

// Pixel marks the icon set does not have yet (12 by 12, one string per row, as PixelIcon's).
const PX_MARKS = {
  reload: [
    "............",
    "........xxx.",
    "...xxxx..x..",
    "..x.........",
    "..x.........",
    "..x......x..",
    "..x......x..",
    "..x......x..",
    "..x......x..",
    "...xxxxxx...",
    "............",
    "............",
  ],
  sound: [
    "............",
    "......x.....",
    ".....xx.....",
    "....xxx..x..",
    ".xxxxxx.x...",
    ".xxxxxx.x...",
    ".xxxxxx.x...",
    ".xxxxxx.x...",
    "....xxx..x..",
    ".....xx.....",
    "......x.....",
    "............",
  ],
  muted: [
    "............",
    "......x.....",
    ".....xx.....",
    "....xxx.....",
    ".xxxxxx.x..x",
    ".xxxxxx.xx..",
    ".xxxxxx.xx..",
    ".xxxxxx.x..x",
    "....xxx.....",
    ".....xx.....",
    "......x.....",
    "............",
  ],
} as const;

function PxMark({ name, size = 16 }: { name: keyof typeof PX_MARKS; size?: number }) {
  return (
    <svg className="pixel-icon" width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" fill="currentColor" aria-hidden focusable="false">
      {gridRuns(PX_MARKS[name]).map((r) => (
        <rect key={`${r.x},${r.y}`} x={r.x} y={r.y} width={r.w} height={1} />
      ))}
    </svg>
  );
}

function Browser({ bot, control }: { bot: BotSummary; control: boolean }) {
  const { browser } = useScreen(bot.slug);
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const focusAddress = useRef(false);

  useEffect(() => {
    if (!editing) setAddress(browser?.url ?? "");
  }, [browser?.url, browser?.active, editing]);

  useEffect(() => {
    if (control && focusAddress.current && input.current) {
      focusAddress.current = false;
      input.current.focus();
    }
  });

  const fail = (e: unknown) => toast(errorText(e));
  const tabs = browser?.tabs ?? [];
  const active = browser?.active ?? null;
  const loading = !!browser?.loading;
  const secure = !!browser?.url?.startsWith("https://");
  const full = tabs.length >= LIMITS.browserTabs;
  const fullText = `${LIMITS.browserTabs} tabs max. Close one first.`;

  const go = (what: "back" | "forward" | "reload" | "stop") => void invoke("crew:browserGo", bot.slug, what).catch(fail);
  const tab = (action: "new" | "switch" | "close", id?: number) => {
    if (action === "new") focusAddress.current = true;
    invoke("crew:tab", bot.slug, action, id).then(() => {
      if (action === "new") input.current?.focus();
    }, fail);
  };
  const shortcuts: Shortcuts = {
    newTab: () => !full && tab("new"),
    closeTab: () => active !== null && tab("close", active),
    focusAddress: () => input.current?.focus(),
  };

  return (
    <section className="browser-window" aria-label={`${bot.name}'s browser`}>
      <div className="tabstrip">
        <div className="btabs-list" role="tablist">
          {tabs.map((t) => {
            const on = t.id === active;
            return (
              <div
                key={t.id}
                role="tab"
                aria-selected={on}
                tabIndex={control ? (on ? 0 : -1) : undefined}
                className={`btab${on ? " on" : ""}`}
                onClick={() => !on && tab("switch", t.id)}
                onKeyDown={(e) => {
                  if (!control || on || (e.key !== "Enter" && e.key !== " ")) return;
                  e.preventDefault();
                  tab("switch", t.id);
                }}
              >
                {t.favicon ? (
                  <img className="btab-icon" src={t.favicon} alt="" aria-hidden />
                ) : (
                  <span className="btab-icon">
                    <PixelIcon name="site" size={12} />
                  </span>
                )}
                <span className="btab-title ell">{tabLabel(t)}</span>
                {control && (
                  <button type="button" className="btab-close" aria-label={`Close ${tabLabel(t)}`} onClick={(e) => { e.stopPropagation(); tab("close", t.id); }}>
                    <PixelIcon name="close" size={10} />
                  </button>
                )}
              </div>
            );
          })}
          <button type="button" className="icon-btn btab-new" aria-label="New tab" title={full ? fullText : "New tab"} disabled={!control || full} onClick={() => tab("new")}>
            <PixelIcon name="plus" size={13} />
          </button>
        </div>
      </div>
      <div className="toolbar">
        <button type="button" className="icon-btn win-btn btn-back" aria-label="Back" disabled={!control || !browser?.canGoBack} onClick={() => go("back")}>
          <PixelIcon name="chevron-right" size={14} />
        </button>
        <button type="button" className="icon-btn win-btn" aria-label="Forward" disabled={!control || !browser?.canGoForward} onClick={() => go("forward")}>
          <PixelIcon name="chevron-right" size={14} />
        </button>
        <button type="button" className="icon-btn win-btn" aria-label={loading ? "Stop loading" : "Reload"} disabled={!control || !browser?.url} onClick={() => go(loading ? "stop" : "reload")}>
          {loading ? <PixelIcon name="close" size={14} /> : <PxMark name="reload" size={14} />}
        </button>
        {control ? (
          <form
            className="address"
            onSubmit={(e) => {
              e.preventDefault();
              const url = toUrl(address);
              if (!url) return;
              input.current?.blur();
              invoke("crew:navigate", bot.slug, url).then((st) => setAddress(st.url), fail);
            }}
          >
            <PixelIcon name={secure ? "lock" : "site"} size={12} />
            <input
              ref={input}
              className="address-input"
              value={address}
              aria-label="Address"
              spellCheck={false}
              onFocus={(e) => {
                setEditing(true);
                e.currentTarget.select();
              }}
              onBlur={() => setEditing(false)}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Search or type a web address"
            />
          </form>
        ) : (
          <div className="address" title={browser?.url || undefined}>
            <PixelIcon name={secure ? "lock" : "site"} size={12} />
            <span className="address-text ell">{browser?.url || "No page open"}</span>
          </div>
        )}
      </div>
      <div className={`load-bar${loading ? " on" : ""}`} aria-hidden />
      <Stage bot={bot} control={control} shortcuts={shortcuts} />
    </section>
  );
}

function ActivityWindow({ bot, onReplay }: { bot: BotSummary; onReplay(runId: string, title: string): void }) {
  const { overview, go } = useCrew();
  const { runs } = useRuns(bot.slug, undefined, 3);
  const names = (s: string) => botOf(overview, s)?.name ?? s;
  const lines = useMemo(() => activity(runs, names), [runs, overview.bots]);
  const logRef = useRef<HTMLDivElement>(null);
  const waiting = waitingFor(overview, bot.slug);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines.length, waiting.length]);

  return (
    <div className="win-fill">
      {(bot.running || bot.queued) && (
        <div className="win-bar">
          <span className="grow" />
          <button type="button" className="btn stop small" onClick={() => void invoke("crew:stop", bot.slug).catch((e) => toast(errorText(e)))}>
            Stop
          </button>
        </div>
      )}
      <div className="act-body" ref={logRef} role="log" aria-label={`${bot.name}'s activity`} tabIndex={0}>
        {lines.map((l) =>
          l.head ? (
            <div key={l.key} className="act-run">
              <span className="grow">{l.text}</span>
              {l.runId && (
                <button type="button" className="btn small" onClick={() => onReplay(l.runId!, l.text)}>
                  Replay
                </button>
              )}
            </div>
          ) : (
            <div key={l.key} className="act-line">
              <span className="act-time">{clock(l.at)}</span>
              <span className="act-text">{l.text}</span>
            </div>
          ),
        )}
        {!lines.length && <p className="hint">Nothing yet. What {bot.name} does shows up here.</p>}
        {waiting.length > 0 && (
          <div className="act-wait">
            <span className="wait-dot" aria-hidden />
            <span className="grow ell">{waiting[0]!.kind === "ask" ? waiting[0]!.question : waiting[0]!.action}</span>
            <button type="button" className="btn primary small" onClick={() => go({ name: "chat", slug: bot.slug })}>
              Respond in chat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const MENU_W = 160;
const MENU_H = 76;
const TASK_MENU_W = 168;
const TASK_MENU_H = 112;

/** What an app is opened with: its own props, as the window keeps them. */
export type AppProps = Record<string, unknown>;

/** What an app's body gets besides its own props. */
export interface AppEnv {
  bot: BotSummary;
  control: boolean;
  library: LibraryItem[];
  /** False until the bot's library has loaded. */
  loaded: boolean;
  /** Opens a library document's editor window. */
  openDoc(path: string): void;
  /** Opens a file from the bot's disk in the app that shows it. */
  openFile(entry: DiskEntry): void;
  /** Opens another app's window (see APPS). */
  open(app: string, props?: AppProps, key?: string, title?: string): void;
  /** Sets the title this window shows (a document's title is set by its editor). */
  retitle(title: string): void;
  /** The bot's own apps (Files/Apps); null until they have loaded. */
  apps: AppInfo[] | null;
  /** Closes this window. */
  close(): void;
}

/**
 * An app a bot's computer can open. To add one: add an entry to APPS with its
 * title, its icon, the size it opens at (and whether it opens maximized) and a
 * render that returns only the body, since the window frame draws the title
 * bar. Open it with openApp("<id>", props). A window's place is remembered by
 * its key, which defaults to the app id.
 */
export interface AppDef {
  title: string;
  /** The same colour pixel icon the desktop shows for it, in the title bar and on the taskbar. */
  icon: FileIconName | ((props: AppProps, env: AppEnv) => FileIconName);
  size: AppSize;
  render(props: AppProps, env: AppEnv): ReactNode;
}

const hint = (text: string) => <p className="hint">{text}</p>;
const docOf = (props: AppProps, env: AppEnv): LibraryItem | null => env.library.find((f) => f.path === String(props.path)) ?? null;

const DOC_KINDS = new Set<FileKind>(["doc", "sheet", "deck", "board", "design"]);

/** The taskbar clock: the time, which opens the Clock app. */
function TaskClock({ onOpen }: { onOpen(): void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <button type="button" className="task task-clock" aria-label="Clock" title={now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} onClick={onOpen}>
      {clock(now.toISOString())}
    </button>
  );
}

export const APPS: Record<string, AppDef> = {
  browser: {
    title: "Browser",
    icon: "browser",
    size: { w: 1000, h: 700, max: true },
    render: (_p, env) => <Browser bot={env.bot} control={env.control} />,
  },
  files: {
    title: "Files",
    icon: (props) => (props.start === "Documents" ? "documents" : props.start === "Trash" ? "trash" : "files"),
    size: { w: 980, h: 620 },
    render: (props, env) => <FileManager bot={env.bot} start={typeof props.start === "string" ? props.start : "Files"} onOpen={env.openFile} />,
  },
  activity: {
    title: "Activity",
    icon: "activity",
    size: { w: 560, h: 520 },
    render: (_p, env) => <ActivityWindow bot={env.bot} onReplay={(runId, title) => env.open("replay", { runId }, `replay:${runId}`, `Replay · ${title}`)} />,
  },
  connectors: {
    title: "Connectors",
    icon: "connectors",
    size: { w: 640, h: 600 },
    render: (_p, env) => <ConnectorsWindow bot={env.bot} />,
  },
  editor: {
    title: "Document",
    icon: (props, env) => {
      const item = docOf(props, env);
      return item ? appIconFor(FENNA_APPS.find((a) => a.kind === item.kind)?.id ?? "fenna-docs") : "doc";
    },
    size: { w: 1000, h: 700, max: true },
    render: (props, env) => {
      const item = docOf(props, env);
      if (item) return <EditorWindow key={item.path} bot={env.bot} item={item} onTitle={env.retitle} />;
      return hint(env.loaded ? "That document is no longer in the Library." : "Loading…");
    },
  },
  launcher: {
    title: "App",
    icon: (props) => appIconFor(FENNA_APPS.find((a) => a.id === props.app)?.id ?? "fenna-docs"),
    size: { w: 720, h: 520 },
    render: (props, env) => {
      const app = FENNA_APPS.find((a) => a.id === props.app);
      return app ? <AppLauncher bot={env.bot} app={app.id} onOpenDoc={env.openDoc} /> : hint("That app isn't on this computer.");
    },
  },
  viewer: {
    title: "Viewer",
    icon: (props) => fileIconFor((props.entry as DiskEntry | undefined)?.kind ?? "other"),
    size: { w: 820, h: 560 },
    render: (props, env) => {
      const entry = props.entry as DiskEntry | undefined;
      if (!entry) return hint("Nothing to show.");
      if (entry.kind === "image") return <ImageViewer key={entry.path} bot={env.bot} entry={entry} onChange={(e) => env.retitle(e.name)} />;
      if (entry.kind === "video" || entry.kind === "audio") return <MediaPlayer key={entry.path} bot={env.bot} entry={entry} />;
      if (entry.kind === "pdf") return <PdfViewer key={entry.path} bot={env.bot} entry={entry} />;
      if (entry.kind === "table") return <TableViewer key={entry.path} bot={env.bot} entry={entry} />;
      if (entry.kind === "text" || entry.kind === "code") return <TextViewer key={entry.path} bot={env.bot} entry={entry} />;
      return <FileInfo key={entry.path} bot={env.bot} entry={entry} />;
    },
  },
  terminal: {
    title: "Terminal",
    icon: "terminal",
    size: { w: 820, h: 520 },
    render: (_p, env) => <Terminal key={env.bot.slug} bot={env.bot} />,
  },
  code: {
    title: "Code",
    icon: "code",
    size: { w: 980, h: 620 },
    render: (props, env) => <CodeWindow bot={env.bot} root={typeof props.root === "string" ? props.root : "Files"} />,
  },
  replay: {
    title: "Replay",
    icon: "activity",
    size: { w: 980, h: 640 },
    render: (props, env) => <Replay bot={env.bot.slug} runId={String(props.runId ?? "")} />,
  },
  clock: {
    title: "Clock",
    icon: "clock",
    size: { w: 760, h: 560 },
    render: (_p, env) => <ClockApp bot={env.bot} />,
  },
  processes: {
    title: "Processes",
    icon: "activity",
    size: { w: 680, h: 520 },
    render: (_p, env) => <ProcessesWindow bot={env.bot} onOpenPort={(port) => openLocalPort(env.bot.slug, port, env.open)} />,
  },
  console: {
    title: "Console",
    icon: "terminal",
    size: { w: 820, h: 540 },
    render: (_p, env) => <ConsoleWindow bot={env.bot} />,
  },
  userapp: {
    title: "App",
    icon: (props, env) => userAppIcon(env.apps?.find((a) => a.name === String(props.name))?.icon ?? ""),
    size: { w: 960, h: 640 },
    render: (props, env) => <UserApp bot={env.bot} name={String(props.name ?? "")} apps={env.apps} review={props.review === true} onClose={env.close} onTitle={env.retitle} />,
  },
};

function iconOf(win: WindowState, env: AppEnv): FileIconName {
  const def = APPS[win.app];
  if (!def) return "doc";
  return typeof def.icon === "function" ? def.icon(win.props, env) : def.icon;
}

const toggleWindow = (win: WindowState): WindowAction => (win.min ? { type: "restore", id: win.id } : { type: "minimize", id: win.id });

/** A built-in window another view asks the desk to open, with its props (the Details panel's "Open in Code"). */
export interface DeskLaunch {
  app: string;
  props?: AppProps;
  /** The window's key (its place is remembered by it); defaults to the app id. */
  key?: string;
  title?: string;
}

export function Computer({ slug, open, launch }: { slug: string; open?: string; launch?: DeskLaunch }) {
  // Each bot has its own desk, so its windows start fresh when the bot changes.
  return <ComputerDesk key={slug} slug={slug} open={open} launch={launch} />;
}

function ComputerDesk({ slug, open, launch }: { slug: string; open?: string; launch?: DeskLaunch }) {
  const { overview, go } = useCrew();
  const bot = botOf(overview, slug);
  const screen = useScreen(slug);
  const { detail } = useBotDetail(bot);
  const { apps } = useApps(slug);
  const appsRef = useRef(apps);
  appsRef.current = apps;

  const [wins, dispatch] = useReducer(windowsReducer, slug, (s: string) => initialWindows(readPlacements(s)));
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [taskMenu, setTaskMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [taskDrag, setTaskDrag] = useState<string | null>(null);
  const { customBg } = useCustomWallpaper(slug);
  const [dock, setDock] = useState(false);
  const [adding, setAdding] = useState(false);
  const desk = useDesktop(slug);
  const layer = useRef<HTMLDivElement>(null);
  const control = !!screen.browser?.control;
  const controlRef = useRef(control);
  controlRef.current = control;
  const seq0 = useRef(screen.cursorSeq);
  const library = detail?.library ?? [];
  const focused = wins.windows.find((w) => w.id === wins.focus) ?? null;
  const focusedApp = useRef<string | null>(null);
  focusedApp.current = focused?.app ?? null;
  const browserShown = wins.windows.some((w) => w.key === "browser" && !w.min);
  const ready = !!bot;

  useWatch(slug, "live", browserShown);
  useEffect(() => {
    send("crew:present", slug, true);
    return () => send("crew:present", slug, false);
  }, [slug]);

  // The windows keep to the area above the taskbar, which is this layer's size.
  useLayoutEffect(() => {
    const el = layer.current;
    if (!el) return;
    const report = () => {
      if (el.clientWidth < 1 || el.clientHeight < 1) return;
      dispatch({ type: "desk", size: { width: el.clientWidth, height: el.clientHeight } });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  useEffect(() => writePlacements(slug, wins.placements), [slug, wins.placements]);

  const running = !!bot?.running;
  const url = screen.browser?.url ?? "";

  const openApp = (app: string, props: AppProps = {}, key: string = app, title?: string) => {
    const def = APPS[app];
    if (!def) return;
    dispatch({ type: "open", app, key, title: title ?? def.title, props, size: def.size });
  };
  const openDoc = (path: string) => openApp("editor", { path }, `editor:${path}`, library.find((f) => f.path === path)?.title ?? path);
  const openFile = (entry: DiskEntry) => {
    if (DOC_KINDS.has(entry.kind)) openDoc(entry.path.split("/").slice(1).join("/"));
    else openApp("viewer", { entry }, `viewer:${entry.path}`, entry.name);
  };

  // The bot's browser comes to the front when it starts browsing, unless the person is editing a document.
  useEffect(() => {
    if (screen.cursorSeq !== seq0.current || (running && url)) {
      if (focusedApp.current !== "editor") openApp("browser");
    }
  }, [screen.cursorSeq, running, url]);

  // A document card in the chat opens its document here.
  useEffect(() => {
    if (open) openDoc(open);
  }, [open]);

  // A window another view asks for (the Panel's "Open in Code").
  useEffect(() => {
    if (launch) openApp(launch.app, launch.props ?? {}, launch.key, launch.title);
  }, [launch]);

  // An app's window opens from its desktop icon, the Details panel, and when the bot opens its app to test it.
  const openUserApp = (name: string, review = false) => openApp("userapp", { name, review }, `userapp:${name}`, appTitleOf(appsRef.current ?? [], name));
  useEffect(
    () =>
      on("crew:appOpened", (p) => {
        if (p.slug === slug) openUserApp(p.name);
      }),
    [slug],
  );

  // Every app the bot has gets an icon on the desktop, once it has loaded both the apps and the desktop.
  useEffect(() => {
    if (!desk.ready || !apps) return;
    const next = syncAppIcons(desk.items, apps);
    if (next !== desk.items) desk.save(next);
  }, [desk.ready, apps]);

  // The bot's browser is open from the start when it already has tabs.
  useEffect(() => {
    if ((screen.browser ?? bot?.browser)?.tabs?.length) openApp("browser");
  }, []);

  const giveBack = () => invoke("crew:control", slug, false).catch(() => undefined);
  useEffect(
    () => () => {
      if (controlRef.current) void giveBack();
    },
    [slug],
  );

  useEffect(() => {
    if (!control) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        void giveBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [control, slug]);

  useEffect(() => {
    if (!picker && !menu && !taskMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPicker(false);
      setMenu(null);
      setTaskMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picker, menu, taskMenu]);

  if (!bot) return null;
  const offers = overview.offers.filter((o) => o.slug === slug);
  const fail = (e: unknown) => toast(errorText(e));
  const tabCount = screen.browser?.tabs?.length ?? 0;
  const browserOpen = tabCount > 0;
  const muted = !!screen.browser?.muted;
  const brain = brainLabel(bot.brain);
  const brainLogo = modelLogo(bot.brain.cli, bot.brain.model);

  const envFor = (win: WindowState): AppEnv => ({
    bot,
    control,
    library,
    loaded: !!detail,
    openDoc,
    openFile,
    open: openApp,
    retitle: (title) => dispatch({ type: "retitle", id: win.id, title }),
    apps,
    close: () => closeWin(win),
  });

  const closeWin = (win: WindowState) => {
    if (win.app === "browser") {
      if (controlRef.current) void giveBack();
      // Closing the window closes the browser, unless the bot is using it right now.
      void invoke("crew:closeBrowser", slug).catch(() => undefined);
    }
    dispatch({ type: "close", id: win.id });
  };

  // There is something to control only while the bot's browser has tabs, or its window is open here.
  const canControl = browserOpen || browserShown;
  const takeControl = async () => {
    if (!canControl) return;
    if (!browserShown) openApp("browser");
    try {
      await invoke("crew:watch", slug, "live");
      await invoke("crew:control", slug, true);
    } catch (e) {
      fail(e);
    }
  };

  const dynamicWallStyle: CSSProperties = {
    ...wallStyle(bot),
    ...(customBg ? { "--wall-img": "none", backgroundImage: `url(${customBg})`, backgroundSize: "cover", backgroundPosition: "center" } as CSSProperties : {}),
  };

  const openShortcut = (item: DesktopShortcut) => {
    if (item.kind === "app" && item.app === "library") openApp("files", { start: "Documents" }, "files:Documents", "Documents");
    else if (item.kind === "app" && item.app === "trash") openApp("files", { start: "Trash" }, "files:Trash", "Trash");
    else if (item.kind === "app") openApp(item.app);
    else if (item.kind === "fenna") openApp("launcher", { app: item.app }, `launcher:${item.app}`, item.label);
    else if (item.kind === "doc") openDoc(item.path);
    else if (item.kind === "userapp") openUserApp(item.app);
    else if (item.kind === "web") {
      openApp("browser");
      invoke("crew:navigate", slug, item.url).catch(fail);
    }
  };

  const showDesktop = () => {
    for (const w of wins.windows) if (!w.min) dispatch({ type: "minimize", id: w.id });
  };

  const ranks = stackRank(wins.windows);
  const taskWin = taskMenu ? wins.windows.find((w) => w.id === taskMenu.id) : undefined;

  return (
    <main className="main desk-view">
      <div className="desk-bar">
        <button type="button" className="btn desk-back" onClick={() => go({ name: "crew" })}>
          <PixelIcon name="chevron-right" size={12} />
          Crew
        </button>
        <span className="vr" />
        <Face avatar={bot.avatar} color={bot.color} mood={bot.mood} size={24} />
        <span className="desk-title">
          <span className="desk-name ell">{bot.name}'s computer</span>
          <span className={`desk-status ell${bot.mood === "need" ? " need" : ""}`} title={bot.statusLine}>
            {bot.statusLine}
          </span>
        </span>
        <span className="grow" />
        <div className="seg" role="group" aria-label="Who is at the keyboard">
          <button type="button" className="seg-btn" aria-pressed={!control} onClick={() => control && void giveBack()}>
            Watching
          </button>
          <button
            type="button"
            className="seg-btn"
            aria-pressed={control}
            disabled={!control && !canControl}
            title={!control && !canControl ? "Open the browser first" : undefined}
            onClick={() => !control && void takeControl()}
          >
            Take control
          </button>
        </div>
        <span className="grow" />
        <button type="button" className="btn desk-chat" aria-pressed={dock} onClick={() => setDock(!dock)}>
          Chat
        </button>
        {(bot.running || bot.queued) && (
          <button type="button" className="btn stop" onClick={() => void invoke("crew:stop", slug).catch(fail)}>
            <PixelIcon name="stop" size={12} />
            Stop
          </button>
        )}
      </div>

      <div className="desk-row">
        <div
          className={`desktop${control ? " control" : ""}`}
          style={dynamicWallStyle}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest(".win, .taskbar, .save-cards, .control-banner, .desk-modal-scrim")) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: Math.max(0, Math.min(e.clientX - r.left, r.width - MENU_W)), y: Math.max(0, Math.min(e.clientY - r.top, r.height - MENU_H)) });
          }}
        >
          <PixelField className="flat" color="--desk-ink" density={2.5} alpha={0.4} cell={3} glitch={0.08} />
          <DesktopIcons slug={slug} items={desk.items} apps={apps} save={desk.save} onOpen={openShortcut} />

          <div className="win-layer" ref={layer}>
            {wins.windows.map((win) => {
              const env = envFor(win);
              return (
                <div key={win.id} className="win-slot" hidden={win.min}>
                <WindowFrame
                  win={win}
                  rank={ranks.get(win.id) ?? 0}
                  focused={win.id === wins.focus}
                  icon={iconOf(win, env)}
                  desk={wins.desk}
                  dispatch={dispatch}
                  onClose={() => closeWin(win)}
                >
                  {APPS[win.app]?.render(win.props, env) ?? null}
                </WindowFrame>
                </div>
              );
            })}
            <PortNotices bot={bot} open={openApp} />
          </div>

          {menu && (
            <>
              <div className="desk-menu-scrim" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
              <div className="desk-menu px-panel" role="menu" style={{ left: menu.x, top: menu.y }}>
                <button
                  type="button"
                  role="menuitem"
                  className="desk-menu-item"
                  autoFocus
                  onClick={() => {
                    setMenu(null);
                    setPicker(true);
                  }}
                >
                  Wallpaper
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="desk-menu-item"
                  onClick={() => {
                    setMenu(null);
                    setAdding(true);
                  }}
                >
                  Add shortcut
                </button>
              </div>
            </>
          )}

          {adding && <AddShortcutDialog items={desk.items} save={desk.save} onClose={() => setAdding(false)} />}

          {picker && <WallpaperPicker bot={bot} onClose={() => setPicker(false)} />}

          {taskMenu && taskWin && (
            <>
              <div
                className="desk-item-scrim"
                onClick={() => setTaskMenu(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setTaskMenu(null);
                }}
              />
              <div
                className="desk-menu desk-item-menu px-panel"
                role="menu"
                aria-label={taskWin.title}
                style={{
                  left: Math.max(8, Math.min(taskMenu.x, window.innerWidth - TASK_MENU_W - 8)),
                  top: Math.max(8, Math.min(taskMenu.y - TASK_MENU_H, window.innerHeight - TASK_MENU_H - 8)),
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="desk-menu-item"
                  autoFocus
                  onClick={() => {
                    setTaskMenu(null);
                    dispatch(toggleWindow(taskWin));
                  }}
                >
                  {taskWin.min ? "Restore" : "Minimize"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="desk-menu-item"
                  onClick={() => {
                    setTaskMenu(null);
                    dispatch({ type: taskWin.max ? "unmaximize" : "maximize", id: taskWin.id });
                  }}
                >
                  {taskWin.max ? "Restore size" : "Maximize"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="desk-menu-item"
                  onClick={() => {
                    setTaskMenu(null);
                    closeWin(taskWin);
                  }}
                >
                  Close
                </button>
              </div>
            </>
          )}

          {offers.length > 0 && (
            <div className="save-cards">
              {offers.map((o) => (
                <SaveCard key={o.id} offer={o} />
              ))}
            </div>
          )}

          {control && (
            <div className="control-banner px-panel" role="status">
              <span>You are in control. {bot.name} is paused.</span>
              <button type="button" className="btn primary small" onClick={() => void giveBack()} title="Give back (Ctrl+Alt+G)" aria-keyshortcuts="Control+Alt+G">
                Give back
              </button>
            </div>
          )}

          <div className="taskbar">
            <button type="button" className="task-face-btn" aria-label="Desktop" title="Desktop" onClick={showDesktop}>
              <Avatar avatar={bot.avatar} color={bot.color} mood={bot.mood} size={24} title={bot.name} />
            </button>

            {wins.windows.map((win, index) => {
              const on = win.id === wins.focus && !win.min;
              const env = envFor(win);
              return (
                <button
                  key={win.id}
                  type="button"
                  className={`task${on ? " active" : ""}${win.min ? " minimized" : ""}`}
                  aria-label={win.title}
                  title={win.title}
                  draggable
                  onClick={() => dispatch(on ? { type: "minimize", id: win.id } : { type: "restore", id: win.id })}
                  onMouseDown={(e) => {
                    if (e.button === 1) e.preventDefault();
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) closeWin(win);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setTaskMenu({ id: win.id, x: e.clientX, y: e.clientY });
                  }}
                  onKeyDown={(e) => {
                    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                      e.preventDefault();
                      dispatch({ type: "reorder", id: win.id, to: index + (e.key === "ArrowRight" ? 1 : -1) });
                    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                      e.preventDefault();
                      const r = e.currentTarget.getBoundingClientRect();
                      setTaskMenu({ id: win.id, x: r.left, y: r.top });
                    }
                  }}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", win.id);
                    setTaskDrag(win.id);
                  }}
                  onDragOver={(e) => {
                    if (taskDrag) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (taskDrag) dispatch({ type: "reorder", id: taskDrag, to: index });
                    setTaskDrag(null);
                  }}
                  onDragEnd={() => setTaskDrag(null)}
                >
                  <FileIcon name={iconOf(win, env)} size={20} />
                  <span className={`task-dot${win.app === "activity" && bot.running ? " run-dot" : ""}`} />
                </button>
              );
            })}

            <span className="grow" />

            {browserOpen && (
              <button
                type="button"
                className="task task-mute"
                aria-label={muted ? `Unmute ${bot.name}` : `Mute ${bot.name}`}
                aria-pressed={muted}
                title={muted ? "Unmute sound" : "Mute sound"}
                onClick={() => void invoke("crew:mute", slug, null, !muted).catch(fail)}
              >
                <PxMark name={muted ? "muted" : "sound"} size={16} />
              </button>
            )}
            <span className="task-brain" role="img" title={brain} aria-label={brain}>
              {bot.brain.model ? (
                <img src={brainLogo.src} alt="" width={16} height={16} className={`as-logo${brainLogo.invert ? " invert" : ""}`} draggable={false} />
              ) : (
                <AgentLogo kind={bot.brain.cli} size={16} />
              )}
            </span>
            <NotificationBell bot={bot} />
            <TaskClock onOpen={() => openApp("clock")} />
          </div>
        </div>
        {dock && <ChatDock slug={slug} onClose={() => setDock(false)} />}
      </div>
    </main>
  );
}
