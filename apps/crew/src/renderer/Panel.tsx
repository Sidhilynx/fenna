// The panel beside a chat. Its header holds the bot's few actions (watch it
// work, share, hide the panel); the tabs are Details (who it is, its brain,
// its schedule, what it asks first), Library (the files it made), Computer
// (its screen, to open) and Advanced (everything else, and the danger
// actions). Its left edge drags, or moves with the arrow keys, to resize it.

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Dialog, MenuButton, toast, type MenuEntry } from "@opendeck/shell";
import { FENNA_APPS, SCHEDULE_EXAMPLES, type Bot } from "@opendeck/crew";
import { errorText, invoke, on } from "../shared/api.ts";
import type { BotDetail, BotSummary, RunSummary } from "../shared/contract.ts";
import { BrainPicker } from "./BrainPicker.tsx";
import { FaceButton } from "./FacePicker.tsx";
import { Grants, LoginGrants } from "./Grants.tsx";
import { Glyph } from "./Glyph.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { Thumb } from "./Thumb.tsx";
import { BotWatches } from "./Watches.tsx";
import { KIND_ICON } from "./pixelIcons.ts";
import { useBotDetail, useCrew } from "./crew.tsx";
import { KIND_LABEL, when, whenNext } from "./util.ts";

const WIDTH_KEY = "fenna:panel-width";
const DEFAULT_WIDTH = 360;
const clampWidth = (w: number) => Math.max(290, Math.min(680, Math.round(w)));

type Tab = "details" | "library" | "computer" | "advanced";
const TABS: { id: Tab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "library", label: "Library" },
  { id: "computer", label: "Computer" },
  { id: "advanced", label: "Advanced" },
];

/** Open a bot's chat once the overview lists it (a bot just made isn't there until the next push). */
function openWhenListed(slug: string, open: () => void) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    off();
    window.clearTimeout(timer);
    open();
  };
  const off = on("crew:changed", (o) => o.bots.some((b) => b.slug === slug) && finish());
  const timer = window.setTimeout(finish, 2000);
}

export function Panel({ bot, onClose }: { bot: BotSummary; onClose(): void }) {
  const { go } = useCrew();
  const [tab, setTab] = useState<Tab>("details");
  const { detail, setDetail, error } = useBotDetail(bot);
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      return clampWidth(Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH);
    } catch {
      return DEFAULT_WIDTH;
    }
  });
  const width = useRef(panelWidth);
  width.current = panelWidth;

  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length]!;
    setTab(t.id);
    requestAnimationFrame(() => document.getElementById(`tab-${t.id}`)?.focus());
  };

  const remember = () => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width.current));
    } catch {
      // The width just isn't remembered.
    }
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => setPanelWidth(clampWidth(window.innerWidth - ev.clientX));
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      remember();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onHandleKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowLeft" ? 16 : e.key === "ArrowRight" ? -16 : 0;
    if (!step) return;
    e.preventDefault();
    width.current = clampWidth(width.current + step);
    setPanelWidth(width.current);
    remember();
  };

  const shareEntries: MenuEntry[] = [
    {
      label: "Export chat as Markdown",
      onSelect: () => {
        invoke("crew:exportChat", bot.slug).then(
          (file) => file && toast(`Saved to ${file}`),
          (e) => toast(errorText(e)),
        );
      },
    },
    {
      label: "Duplicate bot",
      onSelect: () => {
        invoke("crew:duplicate", bot.slug).then(
          ({ slug }) => openWhenListed(slug, () => go({ name: "chat", slug })),
          (e) => toast(errorText(e)),
        );
      },
    },
  ];

  return (
    <aside className="panel resizable-panel" style={{ width: `min(${panelWidth}px, 38vw)` }} aria-label={`${bot.name} details`}>
      <div className="panel-drag-handle" role="separator" aria-orientation="vertical" aria-label="Resize panel" tabIndex={0} onMouseDown={startResize} onKeyDown={onHandleKey} />
      <div className="panel-head">
        <button type="button" className="icon-btn" aria-label={`Watch ${bot.name} work`} title="Watch it work" onClick={() => go({ name: "computer", slug: bot.slug })}>
          <Glyph name="eye" />
        </button>
        <MenuButton className="icon-btn" label="Share" title="Share" align="end" entries={shareEntries}>
          <PixelIcon name="share" />
        </MenuButton>
        <button type="button" className="icon-btn" aria-label="Hide details panel" title="Hide details panel" onClick={onClose}>
          <PixelIcon name="panel" />
        </button>
      </div>
      <div className="tabs" role="tablist" aria-label="Bot panel" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button key={t.id} id={`tab-${t.id}`} type="button" role="tab" className="tab" aria-selected={tab === t.id} aria-controls="panel-body" tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel-body" id="panel-body" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "details" && <Details bot={bot} detail={detail} setDetail={setDetail} loadError={error} />}
        {tab === "library" && <Library bot={bot} detail={detail} loadError={error} />}
        {tab === "computer" && <ComputerTab bot={bot} />}
        {tab === "advanced" && <Advanced bot={bot} detail={detail} setDetail={setDetail} loadError={error} />}
      </div>
    </aside>
  );
}

function ComputerTab({ bot }: { bot: BotSummary }) {
  const { go } = useCrew();
  return (
    <div className="computer-tab">
      <Thumb bot={bot} label={`Open ${bot.name}'s computer`} onOpen={() => go({ name: "computer", slug: bot.slug })}>
        <span className="thumb-open">Open</span>
      </Thumb>
      <span className="caption ell" title={bot.statusLine}>
        {bot.statusLine}
      </span>
    </div>
  );
}

function Library({ bot, detail, loadError }: { bot: BotSummary; detail: BotDetail | null; loadError: string }) {
  if (!detail) return <p className="hint">{loadError || "Loading"}</p>;
  if (!detail.library.length) {
    return (
      <p className="hint">No files yet. Docs, sheets and decks {bot.name} makes show up here.</p>
    );
  }
  return (
    <div className="lib">
      {detail.library.map((f) => (
        <button
          key={f.path}
          type="button"
          className="row lib-row"
          title="Show in folder"
          onClick={() => invoke("crew:reveal", bot.slug, f.path).catch((e) => toast(errorText(e)))}
        >
          <span className="lib-icon">
            <PixelIcon name={KIND_ICON[f.kind]} />
          </span>
          <span className="row-text">
            <span className="row-name ell">{f.title}</span>
            <span className="row-sub">
              {KIND_LABEL[f.kind]} · {when(f.edited)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

const TRIGGER_LABEL: Record<RunSummary["trigger"], string> = { person: "You asked", schedule: "Schedule", bot: "Another bot", watch: "Watch", welcome: "Welcome", compact: "Compact" };
const OUTCOME_LABEL: Record<RunSummary["outcome"], string> = { done: "Done", error: "Failed", stopped: "Stopped", running: "Running" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dsec">
      <h3 className="dsec-title">{title}</h3>
      {children}
    </section>
  );
}

function Runs({ runs }: { runs: RunSummary[] }) {
  if (!runs.length) return <p className="hint">No runs yet.</p>;
  return (
    <ul className="runs">
      {runs.map((r) => (
        <li key={r.file} className="run">
          <span className="run-when">{when(r.at)}</span>
          <span className="run-what ell" title={r.text || r.reply}>
            {TRIGGER_LABEL[r.trigger]}
            {r.text ? `: ${r.text}` : ""}
          </span>
          <span className={`run-outcome ${r.outcome}`}>{OUTCOME_LABEL[r.outcome]}</span>
        </li>
      ))}
    </ul>
  );
}

/** Saving a change to bot.md: what it says when it fails, and a short "Saved" when it works. */
function useSaver(bot: BotSummary, setDetail: (d: BotDetail) => void) {
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const timer = useRef(0);
  const save = async (patch: Partial<Bot>): Promise<boolean> => {
    try {
      setDetail(await invoke("crew:update", bot.slug, patch));
      setError("");
      setSaved(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setSaved(false), 1600);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };
  return { save, error, saved };
}

function Problems({ bot, saveError }: { bot: BotSummary; saveError: string }) {
  return (
    <>
      {bot.diagnostics.length > 0 && (
        <div className="problems" role="alert">
          {bot.diagnostics.map((d, i) => (
            <p key={i} className={d.severity}>
              {d.severity === "error" ? "Problem: " : "Note: "}
              {d.message}
              {d.line ? ` (line ${d.line})` : ""}
            </p>
          ))}
        </div>
      )}
      {saveError && (
        <p className="problems-line" role="alert">
          Not saved. {saveError}
        </p>
      )}
    </>
  );
}

const act = (p: Promise<unknown>) => p.then(() => undefined, (e) => toast(errorText(e)));

/** Text that turns into a field when clicked: Enter or leaving saves, Escape cancels. */
function Inline({ value, display, label, placeholder, className, maxLength, onSave }: { value: string; display?: string; label: string; placeholder: string; className: string; maxLength: number; onSave(v: string): Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  const shown = display ?? value;

  const commit = () => {
    setEditing(false);
    if (cancelled.current) return;
    const next = draft.trim();
    if (next !== value) void onSave(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className={`inline-text ${className}${shown ? "" : " empty-value"}`}
        title="Click to edit"
        aria-label={`${label}: ${shown || placeholder}. Edit`}
        onClick={() => {
          cancelled.current = false;
          setDraft(value);
          setEditing(true);
        }}
      >
        <span className="ell">{shown || placeholder}</span>
      </button>
    );
  }
  return (
    <input
      className={`field inline-input ${className}`}
      autoFocus
      value={draft}
      maxLength={maxLength}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function Details({ bot, detail, setDetail, loadError }: { bot: BotSummary; detail: BotDetail | null; setDetail(d: BotDetail): void; loadError: string }) {
  const { clis } = useCrew();
  const { save, error, saved } = useSaver(bot, setDetail);
  const [ask, setAsk] = useState("");

  if (!detail) return <p className="hint">{loadError || "Loading"}</p>;
  const cfg = detail.bot;

  if (!cfg) {
    return (
      <div className="details">
        <Problems bot={bot} saveError={error} />
        <p className="hint">bot.md can't be read, so its settings can't be edited here. Fix the file, then come back.</p>
        <button type="button" className="btn" onClick={() => void act(invoke("crew:reveal", bot.slug))}>
          Show its folder
        </button>
      </div>
    );
  }

  const next = bot.nextRun ? ` · Next ${whenNext(bot.nextRun)}` : "";

  return (
    <div className="details">
      <Problems bot={bot} saveError={error} />

      <div className="ident">
        <FaceButton avatar={bot.avatar} color={bot.color} mood={bot.mood} size={40} onChange={(f) => void save(f)} />
        <div className="ident-text">
          <Inline className="ident-name" value={cfg.name} label="Name" placeholder="Name" maxLength={40} onSave={(v) => save({ name: v })} />
          <Inline className="ident-job" value={cfg.job} label="Job" placeholder="What is its job?" maxLength={200} onSave={(v) => save({ job: v })} />
        </div>
      </div>

      <Section title="Brain">
        <BrainPicker value={cfg.brain} clis={clis} onChange={(brain) => void save({ brain })} />
      </Section>

      <Section title="Schedule">
        <div className="inline">
          <Inline
            className="sched"
            value={cfg.schedule}
            display={`${bot.scheduleLabel || "Only when you ask"}${next}`}
            label="Schedule"
            placeholder="Only when you ask"
            maxLength={200}
            onSave={(v) => save({ schedule: v })}
          />
          <MenuButton className="icon-btn" label="Schedule examples" title="Schedule examples" align="end" entries={SCHEDULE_EXAMPLES.map((s) => ({ label: s, checked: s === cfg.schedule, onSelect: () => void save({ schedule: s }) }))}>
            <PixelIcon name="chevron-down" size={12} />
          </MenuButton>
        </div>
      </Section>

      <BotWatches bot={bot} />

      <Section title="Ask me before">
        <ul className="chips">
          {cfg.askBefore.map((a) => (
            <li key={a} className="chip">
              <span className="ell" title={a}>
                {a}
              </span>
              <button type="button" className="icon-btn" aria-label={`Remove ${a}`} title="Remove" onClick={() => void save({ askBefore: cfg.askBefore.filter((x) => x !== a) })}>
                <PixelIcon name="close" size={12} />
              </button>
            </li>
          ))}
          {!cfg.askBefore.length && <li className="hint">Nothing. It acts without asking.</li>}
        </ul>
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            const t = ask.trim();
            if (!t) return;
            void save({ askBefore: [...cfg.askBefore, t] }).then((ok) => ok && setAsk(""));
          }}
        >
          <input className="field" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Add one, like sending an email" aria-label="Add something to ask before" />
          <button type="submit" className="btn" disabled={!ask.trim()}>
            Add
          </button>
        </form>
      </Section>

      <div className="dsec-acts">
        <button type="button" className="btn primary" disabled={bot.running || bot.queued} onClick={() => void act(invoke("crew:run", bot.slug))}>
          Run now
        </button>
        {saved && (
          <span className="saved" role="status">
            Saved
          </span>
        )}
      </div>
    </div>
  );
}

function Advanced({ bot, detail, setDetail, loadError }: { bot: BotSummary; detail: BotDetail | null; setDetail(d: BotDetail): void; loadError: string }) {
  const { go } = useCrew();
  const { save, error, saved } = useSaver(bot, setDetail);
  const [deleting, setDeleting] = useState(false);

  if (!detail) return <p className="hint">{loadError || "Loading"}</p>;
  const cfg = detail.bot;
  if (!cfg) return <p className="hint">bot.md can't be read, so its settings can't be edited here. Fix the file, then come back.</p>;
  const connectors = cfg.connectors;

  return (
    <div className="details">
      <Problems bot={bot} saveError={error} />

      <Section title="How it works">
        <textarea
          key={`how:${cfg.how}`}
          className="field area"
          rows={4}
          defaultValue={cfg.how}
          placeholder="Say how the job is done, in your own words."
          aria-label="How it works"
          onBlur={(e) => e.currentTarget.value.trim() !== cfg.how && void save({ how: e.currentTarget.value })}
        />
      </Section>

      <Section title="Connectors">
        <div className="dfield">
          <span className="pick-label">Fenna apps</span>
          <span className="toggles">
            {FENNA_APPS.map((a) => {
              const on = connectors.some((c) => c.type === "fenna" && c.app === a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  className="toggle"
                  aria-pressed={on}
                  onClick={() => void save({ connectors: on ? connectors.filter((c) => !(c.type === "fenna" && c.app === a.id)) : [...connectors, { type: "fenna", app: a.id }] })}
                >
                  {a.name}
                </button>
              );
            })}
          </span>
        </div>
        <Grants botName={bot.name} connectors={connectors} save={(next) => void save({ connectors: next })} />
      </Section>

      <Section title="Logins">
        <LoginGrants botName={bot.name} logins={cfg.logins ?? []} save={(next) => void save({ logins: next })} />
      </Section>

      <Section title="Memory">
        {detail.memory.trim() ? (
          <div className="memory">
            <pre>{detail.memory}</pre>
          </div>
        ) : (
          <p className="hint">Nothing yet.</p>
        )}
      </Section>

      <Section title="Runs">
        <Runs runs={detail.runs} />
      </Section>

      <div className="dsec-acts">
        <button type="button" className="btn" onClick={() => void act(invoke("crew:workspaceReveal", bot.slug))}>
          Show in folder
        </button>
        <button type="button" className="btn" onClick={() => void act(invoke("crew:forget", bot.slug).then(() => toast("Next time it starts a fresh conversation.")))}>
          Start fresh
        </button>
        <button type="button" className="btn danger" onClick={() => setDeleting(true)}>
          Delete bot
        </button>
        {saved && (
          <span className="saved" role="status">
            Saved
          </span>
        )}
      </div>

      {deleting && (
        <Dialog title={`Delete ${bot.name}?`} onClose={() => setDeleting(false)} width={420}>
          <p className="dialog-text">Its folder, files and runs go to the trash. You can restore them from there. Its browser sign-ins are forgotten.</p>
          <div className="form-acts">
            <button type="button" className="btn" onClick={() => setDeleting(false)} data-autofocus>
              Keep it
            </button>
            <button
              type="button"
              className="btn primary danger-fill"
              onClick={() => {
                setDeleting(false);
                void invoke("crew:delete", bot.slug).then(() => go({ name: "crew" }), (e) => toast(errorText(e)));
              }}
            >
              Delete {bot.name}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
