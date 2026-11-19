// The bot's terminal: a dark screen with the commands the person types and
// the ones the bot runs, as they happen. The prompt is the folder it runs in.
// The window frame draws the title bar; this is the body only. Mount it with
// key={bot.slug} so a different bot starts a fresh screen.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { errorText, invoke, on } from "../shared/api.ts";
import type { BotSummary, DiskListing, TermEntry } from "../shared/contract.ts";
import { Avatar } from "./Avatar.tsx";
import { atBottom, completeLast, folderFor, historyLines, historyStep, historyValue, lastWord, mergeEntries, shortCwd, type NameEntry } from "./termModel.ts";

/** The folder a new terminal starts in: the bot's workspace. */
const START_CWD = "Files";
/** Most names the Tab list shows before it says how many more there are. */
const HINT_MAX = 20;

// The prompt's chevron, drawn one pixel at a time on a 5 by 5 grid.
const CHEVRON = ["x....", ".x...", "..x..", ".x...", "x...."];
const CHEVRON_PIXELS = CHEVRON.flatMap((row, y) => [...row].flatMap((c, x) => (c === "x" ? [{ x, y }] : [])));

function Chevron() {
  return (
    <svg className="term-chev" width="10" height="10" viewBox="0 0 5 5" shapeRendering="crispEdges" aria-hidden="true">
      {CHEVRON_PIXELS.map((p) => (
        <rect key={`${p.x},${p.y}`} x={p.x} y={p.y} width={1} height={1} />
      ))}
    </svg>
  );
}

export function Terminal({ bot }: { bot: BotSummary }) {
  const [entries, setEntries] = useState<TermEntry[]>([]);
  const [cwd, setCwd] = useState(START_CWD);
  /** When the person last cleared the screen (ISO time); lines before it are not shown. */
  const [clearAt, setClearAt] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [caret, setCaret] = useState({ pos: 0, scroll: 0 });
  const [hint, setHint] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [stuck, setStuck] = useState(true);
  const [historyFailed, setHistoryFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  /** While the person walks the history: the position and the line they had started typing. */
  const recall = useRef<{ pos: number; draft: string } | null>(null);
  const cwdTouched = useRef(false);

  useEffect(() => {
    let alive = true;
    invoke("crew:termHistory", bot.slug).then(
      (list) => {
        if (!alive) return;
        setEntries((prev) => mergeEntries(prev, list));
        const last = list.filter((e) => e.who === "person").at(-1);
        if (last && !cwdTouched.current) setCwd(last.cwd);
      },
      () => {
        if (alive) setHistoryFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [bot.slug]);

  // The bot's commands arrive as they run; the person's come back from crew:term.
  useEffect(
    () =>
      on("crew:term", (ev) => {
        if (ev.slug === bot.slug) setEntries((prev) => mergeEntries(prev, [ev.entry]));
      }),
    [bot.slug],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stuck) el.scrollTop = el.scrollHeight;
  }, [entries, clearAt, stuck]);

  const visible = clearAt === null ? entries : entries.filter((e) => e.at >= clearAt);
  const pos = Math.min(caret.pos, value.length);

  function syncCaret(el: HTMLInputElement) {
    setCaret({ pos: el.selectionStart ?? el.value.length, scroll: el.scrollLeft });
  }

  function setLine(next: string) {
    setValue(next);
    setCaret({ pos: next.length, scroll: 0 });
    setHint([]);
  }

  async function run(raw: string) {
    const line = raw.trim();
    recall.current = null;
    setLine("");
    if (!line) return;
    if (line === "clear") {
      setClearAt(new Date().toISOString());
      return;
    }
    setStuck(true);
    setBusy(true);
    try {
      const entry = await invoke("crew:term", bot.slug, line, cwd);
      setEntries((prev) => mergeEntries(prev, [entry]));
      cwdTouched.current = true;
      setCwd(entry.cwd);
    } catch (e) {
      const failed: TermEntry = { id: `local-${Date.now()}`, at: new Date().toISOString(), who: "person", cwd, line, out: errorText(e), ok: false };
      setEntries((prev) => mergeEntries(prev, [failed]));
    } finally {
      setBusy(false);
    }
  }

  function walk(dir: "up" | "down") {
    const history = historyLines(entries);
    if (!history.length) return;
    const start = recall.current ?? { pos: history.length, draft: value };
    const next = historyStep(history, start.pos, dir);
    recall.current = { pos: next, draft: start.draft };
    setLine(historyValue(history, next, start.draft));
  }

  async function complete() {
    const line = value;
    const { dir } = folderFor(cwd, lastWord(line).word);
    let listing: DiskListing;
    try {
      listing = await invoke("crew:disk", bot.slug, dir);
    } catch {
      return;
    }
    if (inputRef.current?.value !== line) return;
    const names: NameEntry[] = listing.entries.map((e) => ({ name: e.name, isDir: e.kind === "folder" }));
    const done = completeLast(line, names);
    recall.current = null;
    setLine(done.line);
    setHint(done.matches);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    const key = e.key.toLowerCase();
    if (e.ctrlKey && key === "l") {
      e.preventDefault();
      setClearAt(new Date().toISOString());
      return;
    }
    if (e.ctrlKey && key === "c") {
      // With text selected, Ctrl+C copies it as usual; otherwise it clears the line.
      const el = e.currentTarget;
      if (el.selectionStart !== el.selectionEnd || window.getSelection()?.toString()) return;
      e.preventDefault();
      recall.current = null;
      setLine("");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (!busy) void run(value);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      walk(e.key === "ArrowUp" ? "up" : "down");
      return;
    }
    // Tab finishes a word; with nothing typed it moves focus as usual.
    if (e.key === "Tab" && !e.shiftKey && lastWord(value).word) {
      e.preventDefault();
      void complete();
    }
  }

  const hintText = hint.slice(0, HINT_MAX).join("  ") + (hint.length > HINT_MAX ? `  and ${hint.length - HINT_MAX} more` : "");

  return (
    <div className="term">
      <div
        className="term-screen"
        onClick={() => {
          if (!window.getSelection()?.toString()) inputRef.current?.focus();
        }}
      >
        <div className="term-body">
          <div
            className="term-log"
            role="log"
            aria-live="polite"
            aria-label="Terminal output"
            ref={logRef}
            onScroll={(e) => setStuck(atBottom(e.currentTarget.scrollTop, e.currentTarget.scrollHeight, e.currentTarget.clientHeight))}
          >
            {clearAt === null && (
              <div className="term-boot">
                <Avatar avatar={bot.avatar} color={bot.color} size={24} title={bot.name} />
                <span>Type help</span>
              </div>
            )}
            {historyFailed && <p className="term-note">Earlier commands did not load. New ones still run.</p>}
            {visible.map((e) => (
              <div className="term-entry" key={e.id}>
                <div className="term-prompt">
                  <span className="term-who">
                    {e.who === "bot" ? <Avatar avatar={bot.avatar} color={bot.color} size={16} title={`${bot.name} ran this`} /> : <span className="term-sr">You ran this</span>}
                  </span>
                  <span className="term-cwd" title={e.cwd}>
                    {shortCwd(e.cwd)}
                  </span>
                  <Chevron />
                  <span className="term-cmd">{e.line}</span>
                </div>
                {e.out && <pre className={e.ok ? "term-out" : "term-out term-out-err"}>{e.out}</pre>}
              </div>
            ))}
          </div>
          {!stuck && (
            <button
              type="button"
              className="term-jump"
              onClick={() => {
                setStuck(true);
                inputRef.current?.focus();
              }}
            >
              Jump to latest
            </button>
          )}
        </div>
        <div className="term-input-wrap">
          {hint.length > 0 && <div className="term-hint">{hintText}</div>}
          <div className="term-prompt">
            <span className="term-who" />
            <span className="term-cwd" title={cwd}>
              {shortCwd(cwd)}
            </span>
            <Chevron />
            <div className="term-field">
              <input
                ref={inputRef}
                className="term-input"
                aria-label="Command"
                value={value}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                onChange={(e) => {
                  recall.current = null;
                  setValue(e.target.value);
                  syncCaret(e.currentTarget);
                  if (hint.length) setHint([]);
                }}
                onSelect={(e) => syncCaret(e.currentTarget)}
                onKeyDown={onKeyDown}
              />
              <div className="term-text" aria-hidden="true" style={{ transform: `translateX(${-caret.scroll}px)` }}>
                <span>{value.slice(0, pos)}</span>
                <span className="term-caret" />
                <span>{value.slice(pos)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
