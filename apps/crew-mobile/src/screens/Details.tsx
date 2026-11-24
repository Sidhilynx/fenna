// A bot's Details, pushed over its chat: the desktop's Details for one bot, on
// the phone. Each edit is one crew:update and says "Saved" when it lands. The
// screen reloads when the bot changes on the computer, at most once a second.

import "./details.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CLI_NAMES, FENNA_APPS, formatSchedule, levelOf, LIMITS, LOGIN_LEVEL_NOTES, newGrant, parseSchedule, TOOL_LEVEL_NOTES, TOOL_LEVELS, type Connector } from "@opendeck/crew";
import { errorText, invoke, on } from "../../../crew/src/shared/api.ts";
import type { Bot, BotDetail, CliStatus, ConnectorTool, ConnectorView, Grant, LibraryItem, LibraryText, LoginGrant, LoginLevel, RunSummary, SkillView, Todo, ToolLevel, VaultItemView, Watch, WatchSpec } from "../../../crew/src/shared/contract.ts";
import { clock, KIND_LABEL, when, whenNext } from "../../../crew/src/renderer/text.ts";
import { useAct, useStore } from "../state.tsx";
import { ConnBar, Empty, Face, Header, IconButton, Row, Section, Sheet, Working } from "../ui.tsx";
import { BrainPicker, effortLabel, FacePicker, faceName, Seg, SchedulePicker, scheduleProblem, SegField, useClis, type Brain, type FaceChoice } from "./pickers.tsx";

const OFFLINE = "Your computer isn't reachable right now.";

const TRIGGER_LABEL: Record<RunSummary["trigger"], string> = { person: "You asked", schedule: "Schedule", bot: "Another bot", watch: "Watch", welcome: "Welcome", compact: "Compact", app: "App", meeting: "Call", meeting_end: "Call ended" };
const OUTCOME_LABEL: Record<RunSummary["outcome"], string> = { done: "Done", error: "Failed", stopped: "Stopped", running: "Running" };
const LEVEL_LABEL: Record<ToolLevel, string> = { allow: "Allow", ask: "Ask", off: "Off" };
const LOGIN_WORD: Record<LoginLevel, string> = { allow: "Allow", ask: "Ask" };

// ── Times, watches and text ───────────────────────────────────────────

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

/** A watch in plain words: "Checks example.com every 5 min". */
function describeWatch(spec: WatchSpec): string {
  switch (spec.kind) {
    case "notification":
      return `Notifications from ${hostOf(spec.origin)}${spec.match ? ` containing “${spec.match}”` : ""}`;
    case "element":
      return `Changes to an element on ${hostOf(spec.url)}`;
    case "page":
      return `Checks ${hostOf(spec.url)} every ${spec.every} min`;
    case "timer":
      return spec.every ? `Every ${spec.every} min` : `Timer, ${clock(spec.at)}`;
  }
}

function firedLine(w: Watch): string {
  if (!w.count || !w.fired) return "Not fired yet";
  return `Fired ${w.count} ${w.count === 1 ? "time" : "times"} · last ${clock(w.fired)}`;
}

/** The first lines of a text, joined: the row's sub line. */
function firstLines(text: string, n: number): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, n)
    .join(" ");
}

/** "example.com and 2 more", for a login's sites. */
function loginSites(origins: string[]): string {
  const site = (o: string) => o.replace(/^https:\/\//, "");
  if (!origins.length) return "";
  return origins.length === 1 ? site(origins[0]!) : `${site(origins[0]!)} and ${origins.length - 1} more`;
}

/** "2 Allow · 1 Ask", the levels a grant gives its tools. */
function countsLine(grant: Grant, tools: ConnectorTool[]): string {
  if (!tools.length) return "No tools yet";
  return TOOL_LEVELS.map((l) => [l, tools.filter((t) => levelOf(grant, t.name) === l).length] as const)
    .filter(([, n]) => n > 0)
    .map(([l, n]) => `${n} ${LEVEL_LABEL[l]}`)
    .join(" · ");
}

// ── Loading ───────────────────────────────────────────────────────────

/** A call's result, loaded again only when `key` changes; setData takes what an event brings. */
function useLoad<T>(load: () => Promise<T>, key = "") {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    load().then(
      (d) => {
        if (!live) return;
        setData(d);
        setError("");
      },
      (e) => {
        if (live) setError(errorText(e));
      },
    );
    return () => {
      live = false;
    };
  }, [key]);
  return { data, error, setData };
}

// ── Sheet pieces ──────────────────────────────────────────────────────

type Open =
  | { k: "about" }
  | { k: "face" }
  | { k: "how" }
  | { k: "schedule" }
  | { k: "brain" }
  | { k: "connector"; name: string }
  | { k: "login"; name: string }
  | { k: "memory" }
  | { k: "library"; item: LibraryItem }
  | { k: "delete" };

/** The save and cancel pair of an editing sheet. Save is disabled while the computer can't be reached or another change is running. */
function SaveActs({ saving, blocked, onSave, onClose }: { saving: boolean; blocked: boolean; onSave(): void; onClose(): void }) {
  return (
    <>
      <button type="button" className="btn" onClick={onClose}>
        Cancel
      </button>
      <button type="button" className="btn primary" disabled={blocked} onClick={onSave}>
        {saving ? <Working label="Saving" /> : "Save"}
      </button>
    </>
  );
}

function Offline({ ready }: { ready: boolean }) {
  return ready ? null : (
    <p className="m-help" role="status">
      {OFFLINE}
    </p>
  );
}

/** What every sheet that saves gets from the screen. */
interface Edit {
  ready: boolean;
  /** The key of the change running now, or null. */
  busy: string | null;
  save(key: string, patch: Partial<Bot>): Promise<boolean>;
  close(): void;
}

function AboutSheet({ cfg, ready, busy, save, close }: Edit & { cfg: Bot }) {
  const [name, setName] = useState(cfg.name);
  const [job, setJob] = useState(cfg.job);
  const submit = async () => {
    if (await save("about", { name: name.trim(), job: job.trim() })) close();
  };
  return (
    <Sheet
      title="Name and job"
      onClose={close}
      actions={<SaveActs saving={busy === "about"} blocked={!ready || busy !== null || !name.trim()} onSave={() => void submit()} onClose={close} />}
    >
      <label className="m-field">
        <span className="m-label">Name</span>
        <input className="field" value={name} maxLength={LIMITS.name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="m-field">
        <span className="m-label">Job</span>
        <input className="field" value={job} maxLength={LIMITS.job} onChange={(e) => setJob(e.target.value)} />
      </label>
      <Offline ready={ready} />
    </Sheet>
  );
}

function FaceSheet({ cfg, ready, busy, save, close }: Edit & { cfg: Bot }) {
  const [draft, setDraft] = useState<FaceChoice>({ avatar: cfg.avatar, color: cfg.color });
  const submit = async () => {
    if (await save("face", { avatar: draft.avatar, color: draft.color })) close();
  };
  return (
    <Sheet title="Face" onClose={close} actions={<SaveActs saving={busy === "face"} blocked={!ready || busy !== null} onSave={() => void submit()} onClose={close} />}>
      <FacePicker value={draft} onChange={setDraft} />
      <Offline ready={ready} />
    </Sheet>
  );
}

function HowSheet({ cfg, ready, busy, save, close }: Edit & { cfg: Bot }) {
  const [text, setText] = useState(cfg.how);
  const submit = async () => {
    if (await save("how", { how: text.trim() })) close();
  };
  return (
    <Sheet title="How it works" onClose={close} actions={<SaveActs saving={busy === "how"} blocked={!ready || busy !== null} onSave={() => void submit()} onClose={close} />}>
      <textarea className="field dt-big" value={text} maxLength={LIMITS.how} placeholder="Say how the job is done, in your own words." aria-label="How it works" onChange={(e) => setText(e.target.value)} />
      <Offline ready={ready} />
    </Sheet>
  );
}

function ScheduleSheet({ cfg, ready, busy, save, close }: Edit & { cfg: Bot }) {
  const [draft, setDraft] = useState(cfg.schedule);
  const submit = async () => {
    const r = parseSchedule(draft);
    if ("error" in r) return;
    if (await save("schedule", { schedule: formatSchedule(r.schedule) })) close();
  };
  const blocked = !ready || busy !== null || scheduleProblem(draft) !== null;
  return (
    <Sheet title="Schedule" onClose={close} actions={<SaveActs saving={busy === "schedule"} blocked={blocked} onSave={() => void submit()} onClose={close} />}>
      <SchedulePicker value={draft} onChange={setDraft} />
      <Offline ready={ready} />
    </Sheet>
  );
}

function BrainSheet({ cfg, clis, clisError, ready, busy, save, close }: Edit & { cfg: Bot; clis: CliStatus[] | null; clisError: string }) {
  const [draft, setDraft] = useState<Brain>(cfg.brain);
  const submit = async () => {
    if (await save("brain", { brain: draft })) close();
  };
  return (
    <Sheet title="Brain" onClose={close} actions={<SaveActs saving={busy === "brain"} blocked={!ready || busy !== null || !clis} onSave={() => void submit()} onClose={close} />}>
      {clis ? <BrainPicker value={draft} clis={clis} onChange={setDraft} /> : <p className="m-help">{clisError || "Looking for your CLIs…"}</p>}
      <Offline ready={ready} />
    </Sheet>
  );
}

/** One connector: its tools at allow, ask or off, or the grant taken away. */
function ConnectorSheet({ name, view, cfg, ready, busy, save, close }: Edit & { name: string; view: ConnectorView | undefined; cfg: Bot }) {
  const current = cfg.connectors.find((c): c is Grant => c.type === "grant" && c.name === name) ?? null;
  const [draft, setDraft] = useState<Grant | null>(current);
  const others = cfg.connectors.filter((c) => !(c.type === "grant" && c.name === name));
  const submit = async () => {
    if (!draft) return;
    const next: Connector[] = cfg.connectors.map((c) => (c.type === "grant" && c.name === name ? draft : c));
    if (!current) next.push(draft);
    if (await save("connectors", { connectors: next })) close();
  };
  const remove = async () => {
    if (await save("connectors", { connectors: others })) close();
  };
  const tools = view?.tools ?? [];
  return (
    <Sheet
      title={name}
      onClose={close}
      actions={
        draft ? (
          <SaveActs saving={busy === "connectors"} blocked={!ready || busy !== null} onSave={() => void submit()} onClose={close} />
        ) : (
          <button type="button" className="btn" onClick={close}>
            Close
          </button>
        )
      }
    >
      {view?.error && <p className="dt-error">{view.error}</p>}
      {!view && <p className="m-help">Not installed on this computer.</p>}
      {draft && view && (
        <>
          {!tools.length && <p className="m-help">No tools yet.</p>}
          {tools.map((t) => (
            <div key={t.name} className="dt-tool">
              <span className="dt-tool-name" title={t.description || t.name}>
                {t.name}
              </span>
              <Seg
                label={`${t.name}: what ${cfg.name} may do`}
                options={TOOL_LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l], title: TOOL_LEVEL_NOTES[l] }))}
                value={levelOf(draft, t.name)}
                disabled={!ready || busy !== null}
                onPick={(l) => setDraft({ ...draft, tools: { ...draft.tools, [t.name]: l } })}
              />
            </div>
          ))}
          <div className="dt-tool">
            <span className="dt-tool-name">Tools it adds later</span>
            <Seg
              label={`Tools ${name} adds later`}
              options={TOOL_LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l], title: TOOL_LEVEL_NOTES[l] }))}
              value={draft.default}
              disabled={!ready || busy !== null}
              onPick={(l) => setDraft({ ...draft, default: l })}
            />
          </div>
        </>
      )}
      {!draft && view && (
        <button type="button" className="btn block" disabled={!ready || busy !== null} onClick={() => setDraft(newGrant(name, view.tools))}>
          Give it to {cfg.name}
        </button>
      )}
      {current && (
        <button type="button" className="btn dt-remove" disabled={!ready || busy !== null} onClick={() => void remove()}>
          {busy === "connectors" ? <Working label="Saving" /> : "Remove from this bot"}
        </button>
      )}
      <Offline ready={ready} />
    </Sheet>
  );
}

/** One vault login: not given, allowed, or allowed with a question each time. */
function LoginSheet({ name, item, cfg, ready, busy, save, close }: Edit & { name: string; item: VaultItemView | undefined; cfg: Bot }) {
  const grant = (cfg.logins ?? []).find((g) => g.name === name);
  const [draft, setDraft] = useState<LoginLevel | "none">(grant?.level ?? "none");
  const submit = async () => {
    const logins = cfg.logins ?? [];
    let next: LoginGrant[];
    if (draft === "none") next = logins.filter((g) => g.name !== name);
    else if (grant) next = logins.map((g) => (g.name === name ? { name, level: draft } : g));
    else next = [...logins, { name, level: draft }];
    if (await save("logins", { logins: next })) close();
  };
  const sub = item ? [item.username, loginSites(item.origins)].filter(Boolean).join(" · ") : "Not in the vault on this computer";
  return (
    <Sheet
      title={item?.label ?? name}
      onClose={close}
      actions={<SaveActs saving={busy === "logins"} blocked={!ready || busy !== null} onSave={() => void submit()} onClose={close} />}
    >
      <p className="m-help">{sub}</p>
      <SegField<"none" | LoginLevel>
        label={`${cfg.name} may use it`}
        options={[
          { value: "none", label: "Not given" },
          { value: "allow", label: "Allow", title: LOGIN_LEVEL_NOTES.allow },
          { value: "ask", label: "Ask", title: LOGIN_LEVEL_NOTES.ask },
        ]}
        value={draft}
        disabled={!ready || busy !== null}
        onPick={setDraft}
      />
      {draft !== "none" && <p className="m-help">{LOGIN_LEVEL_NOTES[draft]}</p>}
      <Offline ready={ready} />
    </Sheet>
  );
}

function MemorySheet({ text, close }: { text: string; close(): void }) {
  return (
    <Sheet title="Memory" onClose={close}>
      <div className="dt-text">{text}</div>
    </Sheet>
  );
}

function LibrarySheet({ slug, item, close }: { slug: string; item: LibraryItem; close(): void }) {
  const text = useLoad<LibraryText>(() => invoke("crew:libraryText", slug, item.path), item.path);
  return (
    <Sheet title={item.title} onClose={close}>
      <p className="m-help">
        {KIND_LABEL[item.kind]} · {when(item.edited)}
      </p>
      {text.data ? (
        <>
          {text.data.summary && <p className="dt-summary">{text.data.summary}</p>}
          {text.data.text ? <div className="dt-text">{text.data.text}</div> : <p className="m-help">No text to show.</p>}
          {text.data.truncated && <p className="m-help">Only the start is shown.</p>}
        </>
      ) : text.error ? (
        <p className="dt-error">{text.error}</p>
      ) : (
        <Working label="Loading" />
      )}
    </Sheet>
  );
}

function DeleteSheet({ name, ready, busy, onDelete, close }: { name: string; ready: boolean; busy: boolean; onDelete(): void; close(): void }) {
  return (
    <Sheet
      title={`Delete ${name}?`}
      onClose={close}
      actions={
        <>
          <button type="button" className="btn" onClick={close}>
            Keep
          </button>
          <button type="button" className="btn m-danger-fill" disabled={!ready || busy} onClick={onDelete}>
            {busy ? <Working label="Deleting" /> : "Delete"}
          </button>
        </>
      }
    >
      <p>Its files move to the trash on your computer.</p>
      <Offline ready={ready} />
    </Sheet>
  );
}

/** Adds one item to "Ask me before". */
function AskAdd({ items, disabled, saving, onAdd }: { items: string[]; disabled: boolean; saving: boolean; onAdd(text: string): Promise<boolean> }) {
  const [text, setText] = useState("");
  const t = text.trim();
  const full = items.length >= LIMITS.askBefore;
  return (
    <>
      <form
        className="dt-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!t || items.includes(t) || full) return;
          void onAdd(t).then((ok) => {
            if (ok) setText("");
          });
        }}
      >
        <input className="field" value={text} maxLength={LIMITS.askBeforeItem} placeholder="Sending an email" aria-label="Add something to ask before" disabled={disabled || full} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn" disabled={disabled || full || !t || items.includes(t)}>
          {saving ? <Working label="Saving" /> : "Add"}
        </button>
      </form>
      {full && <p className="m-help">Up to {LIMITS.askBefore}. Remove one to add another.</p>}
    </>
  );
}

/** A row with a switch: the whole row is the label. */
function SwitchRow({ title, sub, checked, disabled, onChange }: { title: string; sub?: string; checked: boolean; disabled: boolean; onChange(v: boolean): void }) {
  return (
    <label className="m-row dt-switch-row">
      <span className="m-row-text">
        <span className="m-row-title ell">{title}</span>
        {sub && <span className="m-row-sub">{sub}</span>}
      </span>
      <input type="checkbox" className="m-switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

// ── The screen ────────────────────────────────────────────────────────

export function Details({ slug }: { slug: string }) {
  const store = useStore();
  const { link, overview, gen, pop, home, toast } = store;
  const act = useAct();
  const ready = link.ready;
  const [detail, setDetail] = useState<BotDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [watchTick, setWatchTick] = useState(0);
  const seen = useRef("");
  const timer = useRef(0);
  const { clis, error: clisError } = useClis();
  const connectors = useLoad(() => invoke("crew:connectors"));
  const skills = useLoad(() => invoke("crew:skills"));
  const vault = useLoad(() => invoke("crew:vault"));
  const watches = useLoad(() => invoke("crew:watches", slug), `${slug}:${watchTick}`);

  // The bot itself, again after a change on the computer (one reload a second at most).
  useEffect(() => {
    let live = true;
    invoke("crew:bot", slug).then(
      (d) => {
        if (!live) return;
        seen.current = JSON.stringify(d.summary);
        setDetail(d);
        setLoadError("");
      },
      (e) => {
        if (live) setLoadError(errorText(e));
      },
    );
    return () => {
      live = false;
    };
  }, [slug, gen, tick]);

  useEffect(() => {
    const offChanged = on("crew:changed", (o) => {
      const s = o.bots.find((b) => b.slug === slug);
      const key = s ? JSON.stringify(s) : "";
      if (key === seen.current || timer.current) return;
      timer.current = window.setTimeout(() => {
        timer.current = 0;
        setTick((t) => t + 1);
      }, 1000);
    });
    const offWatches = on("crew:watches", (e) => {
      if (e.slug === slug) setWatchTick((t) => t + 1);
    });
    const offConnectors = on("crew:connectors", (c) => connectors.setData(c));
    const offSkills = on("crew:skills", (s) => skills.setData(s));
    const offVault = on("crew:vault", (v) => vault.setData(v));
    return () => {
      offChanged();
      offWatches();
      offConnectors();
      offSkills();
      offVault();
      window.clearTimeout(timer.current);
      timer.current = 0;
    };
    // The setters of the loaders never change; the rest is read when the screen opens.
  }, [slug]);

  /** One call that changes something: "busy" while it runs, the result or null. */
  async function run<T>(key: string, call: Promise<T>): Promise<T | null> {
    setBusy(key);
    const r = await act(call);
    setBusy(null);
    return r;
  }

  /** A crew:update: the bot as it is now, shown at once, and "Saved". */
  const save = async (key: string, patch: Partial<Bot>): Promise<boolean> => {
    const d = await run(key, invoke("crew:update", slug, patch));
    if (!d) return false;
    seen.current = JSON.stringify(d.summary);
    setDetail(d);
    toast("Saved");
    return true;
  };

  const gone = overview !== null && !overview.bots.some((b) => b.slug === slug);
  if (gone) {
    return (
      <>
        <Header back title="Details" />
        <ConnBar />
        <div className="m-body">
          <Empty title="This bot is gone">
            <button type="button" className="btn" onClick={pop}>
              Back to crew
            </button>
          </Empty>
        </div>
      </>
    );
  }

  if (!detail) {
    return (
      <>
        <Header back title="Details" />
        <ConnBar />
        <div className="m-body">
          {loadError ? (
            <Empty title={loadError}>
              <button type="button" className="btn" onClick={() => setTick((t) => t + 1)}>
                Try again
              </button>
            </Empty>
          ) : (
            <div className="dt-loading">
              <Working label="Loading…" />
              <span>Loading…</span>
            </div>
          )}
        </div>
      </>
    );
  }

  const s = detail.summary;
  const cfg = detail.bot;
  const working = busy !== null;
  const grantOf = (name: string) => cfg?.connectors.find((c): c is Grant => c.type === "grant" && c.name === name);
  const installed = new Map((connectors.data ?? []).map((c) => [c.name, c]));
  const modelName = (() => {
    if (!cfg) return "";
    const cli = clis?.find((c) => c.kind === cfg.brain.cli);
    return cli?.models.find((m) => m.value === cfg.brain.model)?.label ?? (cfg.brain.model || "Default");
  })();

  const newChat = async () => {
    if (!ready) return toast(OFFLINE);
    const id = await run("newchat", invoke("crew:newChat", slug));
    if (id) toast("New chat started");
  };
  const duplicate = async () => {
    if (!ready) return toast(OFFLINE);
    const copy = await run("duplicate", invoke("crew:duplicate", slug));
    if (copy) toast(`Made a copy of ${s.name}`);
  };
  const removeWatch = async (id: string) => {
    const list = await run(`watch:${id}`, invoke("crew:removeWatch", slug, id));
    if (list) {
      watches.setData((w) => (w ? { ...w, watches: list } : w));
      toast("Saved");
    }
  };
  const setTodo = async (id: string, patch: { done?: boolean; remove?: boolean }) => {
    const list = await run(`todo:${id}`, invoke("crew:setTodo", slug, id, patch));
    if (list) {
      watches.setData((w) => (w ? { ...w, todos: list } : w));
      toast("Saved");
    }
  };
  const deleteBot = async () => {
    const r = await run("delete", invoke("crew:delete", slug));
    if (r) {
      toast(`Deleted ${s.name}`);
      home();
    }
  };

  const common = { ready, busy, close: () => setOpen(null) };
  let sheet: ReactNode = null;
  if (open?.k === "memory") sheet = <MemorySheet text={detail.memory} close={common.close} />;
  else if (open?.k === "library") sheet = <LibrarySheet slug={slug} item={open.item} close={common.close} />;
  else if (open?.k === "delete") sheet = <DeleteSheet name={s.name} ready={ready} busy={busy === "delete"} onDelete={() => void deleteBot()} close={common.close} />;
  else if (cfg && open) {
    const edit = { ...common, save, cfg };
    if (open.k === "about") sheet = <AboutSheet {...edit} />;
    else if (open.k === "face") sheet = <FaceSheet {...edit} />;
    else if (open.k === "how") sheet = <HowSheet {...edit} />;
    else if (open.k === "schedule") sheet = <ScheduleSheet {...edit} />;
    else if (open.k === "brain") sheet = <BrainSheet {...edit} clis={clis} clisError={clisError} />;
    else if (open.k === "connector") sheet = <ConnectorSheet {...edit} name={open.name} view={installed.get(open.name)} />;
    else if (open.k === "login") sheet = <LoginSheet {...edit} name={open.name} item={vault.data?.find((v) => v.name === open.name)} />;
  }

  const todos = watches.data?.todos ?? [];

  return (
    <>
      <Header back title="Details" sub={s.name} bot={s} />
      <ConnBar />
      <div className="m-body">
        {s.diagnostics.length > 0 && (
          <div className="dt-problems" role="alert">
            {s.diagnostics.map((d, i) => (
              <p key={i} className={d.severity === "error" ? "dt-problem" : "dt-note"}>
                {d.severity === "error" ? "Problem: " : "Note: "}
                {d.message}
                {d.line ? ` (line ${d.line})` : ""}
              </p>
            ))}
          </div>
        )}

        {!cfg && <p className="m-help dt-pad">bot.md can't be read, so its settings can't be edited here. Fix it on your computer.</p>}

        {cfg && (
          <>
            <Section title="About">
              <Row lead={<Face avatar={cfg.avatar} color={cfg.color} mood={s.mood} size={40} />} title={cfg.name} sub={cfg.job || "Add a job"} onClick={() => setOpen({ k: "about" })} />
              <Row title="Face" right={faceName(cfg.avatar, cfg.color)} onClick={() => setOpen({ k: "face" })} />
            </Section>

            <Section title="How it works">
              <Row
                title={cfg.how ? "Edit" : "Write how it works"}
                sub={cfg.how ? firstLines(cfg.how, 3) : "Say how the job is done, in your own words."}
                onClick={() => setOpen({ k: "how" })}
              />
            </Section>

            <Section title="Schedule">
              <Row title={s.scheduleLabel || "Only when asked"} sub={s.nextRun ? `Next ${whenNext(s.nextRun)}` : undefined} onClick={() => setOpen({ k: "schedule" })} />
            </Section>

            <Section title="Brain">
              <Row title={`${CLI_NAMES[cfg.brain.cli]} · ${modelName}`} sub={cfg.brain.effort ? effortLabel(cfg.brain.effort) : "Default effort"} onClick={() => setOpen({ k: "brain" })} />
            </Section>

            <Section title="Ask me before">
              {cfg.askBefore.length ? (
                cfg.askBefore.map((a) => (
                  <Row
                    key={a}
                    title={a}
                    right={busy === "ask" ? <Working label="Saving" /> : <IconButton icon="close" label={`Remove ${a}`} disabled={!ready || working} onClick={() => void save("ask", { askBefore: cfg.askBefore.filter((x) => x !== a) })} />}
                  />
                ))
              ) : (
                <p className="m-help dt-pad">Nothing. It acts without asking.</p>
              )}
              <div className="dt-pad">
                <AskAdd items={cfg.askBefore} disabled={!ready || working} saving={busy === "ask"} onAdd={(t) => save("ask", { askBefore: [...cfg.askBefore, t] })} />
              </div>
            </Section>

            <Section title="Connectors" action={busy === "connectors" ? <Working label="Saving" /> : undefined}>
              {FENNA_APPS.map((a) => {
                const on = cfg.connectors.some((c) => c.type === "fenna" && c.app === a.id);
                return (
                  <SwitchRow
                    key={a.id}
                    title={a.name}
                    sub={a.use}
                    checked={on}
                    disabled={!ready || working}
                    onChange={(v) => void save("connectors", { connectors: v ? [...cfg.connectors, { type: "fenna", app: a.id }] : cfg.connectors.filter((c) => !(c.type === "fenna" && c.app === a.id)) })}
                  />
                );
              })}
              {connectors.data === null && <p className="m-help dt-pad">{connectors.error || "Loading…"}</p>}
              {connectors.data?.map((c) => {
                const g = grantOf(c.name);
                return <Row key={c.name} title={c.name} sub={g ? countsLine(g, c.tools) : "Not given to this bot"} onClick={() => setOpen({ k: "connector", name: c.name })} />;
              })}
              {cfg.connectors
                .filter((c): c is Grant => c.type === "grant" && !installed.has(c.name))
                .map((g) => (
                  <Row key={g.name} title={g.name} sub="Not installed on this computer" onClick={() => setOpen({ k: "connector", name: g.name })} />
                ))}
              {connectors.data?.length === 0 && !cfg.connectors.some((c) => c.type === "grant") && <p className="m-help dt-pad">No connectors on this computer.</p>}
            </Section>

            <Section title="Skills" action={busy === "skills" ? <Working label="Saving" /> : undefined}>
              {skills.data === null && <p className="m-help dt-pad">{skills.error || "Loading…"}</p>}
              {skills.data && (
                <SkillRows skills={skills.data} granted={cfg.skills ?? []} disabled={!ready || working} onChange={(next) => void save("skills", { skills: next })} />
              )}
            </Section>

            <Section title="Logins" action={busy === "logins" ? <Working label="Saving" /> : undefined}>
              {vault.data === null && <p className="m-help dt-pad">{vault.error || "Loading…"}</p>}
              {vault.data?.map((item) => {
                const g = (cfg.logins ?? []).find((x) => x.name === item.name);
                return (
                  <Row
                    key={item.name}
                    title={item.label}
                    sub={[item.username, loginSites(item.origins)].filter(Boolean).join(" · ") || item.name}
                    right={g ? LOGIN_WORD[g.level] : undefined}
                    onClick={() => setOpen({ k: "login", name: item.name })}
                  />
                );
              })}
              {(cfg.logins ?? [])
                .filter((g) => !(vault.data ?? []).some((v) => v.name === g.name))
                .map((g) => (
                  <Row key={g.name} title={g.name} sub="Not in the vault on this computer" right={LOGIN_WORD[g.level]} onClick={() => setOpen({ k: "login", name: g.name })} />
                ))}
              {vault.data?.length === 0 && !(cfg.logins ?? []).length && <p className="m-help dt-pad">No logins in the vault on this computer.</p>}
              <p className="m-help dt-pad">{cfg.name} never sees a password.</p>
            </Section>
          </>
        )}

        <Section title="Memory">
          {detail.memory.trim() ? (
            <Row title={detail.memory.trim().split("\n")[0]!} sub={firstLines(detail.memory.trim().split("\n").slice(1).join("\n"), 2) || undefined} onClick={() => setOpen({ k: "memory" })} />
          ) : (
            <p className="m-help dt-pad">Nothing yet.</p>
          )}
        </Section>

        <Section title="Library">
          {detail.library.length ? (
            detail.library.map((item) => <Row key={item.path} title={item.title} sub={`${KIND_LABEL[item.kind]} · ${when(item.edited)}`} onClick={() => setOpen({ k: "library", item })} />)
          ) : (
            <p className="m-help dt-pad">No files yet.</p>
          )}
        </Section>

        <Section title="Watching" action={busy?.startsWith("watch:") ? <Working label="Removing" /> : undefined}>
          {watches.data === null && <p className="m-help dt-pad">{watches.error || "Loading…"}</p>}
          {watches.data && !watches.data.watches.length && <p className="m-help dt-pad">No watches yet.</p>}
          {watches.data?.watches.map((w) => {
            const desc = describeWatch(w);
            return (
              <Row
                key={w.id}
                title={desc}
                sub={[w.note, firedLine(w)].filter(Boolean).join(" · ")}
                right={busy === `watch:${w.id}` ? <Working label="Removing" /> : <IconButton icon="close" label={`Remove watch: ${desc}`} disabled={!ready || working} onClick={() => void removeWatch(w.id)} />}
              />
            );
          })}
        </Section>

        {todos.length > 0 && (
          <Section title="To do" action={busy?.startsWith("todo:") ? <Working label="Saving" /> : undefined}>
            {todos.map((t: Todo) => (
              <div key={t.id} className="m-row dt-todo">
                <label className="dt-check-row">
                  <input type="checkbox" className="dt-check" checked={t.done} disabled={!ready || working} onChange={(e) => void setTodo(t.id, { done: e.target.checked })} />
                  <span className={`dt-todo-text${t.done ? " is-done" : ""}`}>{t.text}</span>
                </label>
                {t.due && <span className="m-row-right">Due {whenNext(t.due)}</span>}
                <IconButton icon="close" label={`Remove to do: ${t.text}`} disabled={!ready || working} onClick={() => void setTodo(t.id, { remove: true })} />
              </div>
            ))}
          </Section>
        )}

        <Section title="Recent runs">
          {detail.runs.length ? (
            detail.runs.map((r) => (
              <Row
                key={r.file}
                title={`${TRIGGER_LABEL[r.trigger]}${r.text ? `: ${r.text}` : ""}`}
                sub={[when(r.at), r.reply.split("\n")[0]].filter(Boolean).join(" · ")}
                right={OUTCOME_LABEL[r.outcome]}
                chevron={false}
              />
            ))
          ) : (
            <p className="m-help dt-pad">No runs yet.</p>
          )}
        </Section>

        <Section title="Danger">
          <Row title="Start a new chat" right={busy === "newchat" ? <Working label="Starting" /> : undefined} chevron={false} onClick={() => void newChat()} />
          <Row title="Duplicate" right={busy === "duplicate" ? <Working label="Copying" /> : undefined} chevron={false} onClick={() => void duplicate()} />
          <Row title={`Delete ${s.name}`} danger chevron={false} onClick={() => setOpen({ k: "delete" })} />
        </Section>
      </div>
      {sheet}
    </>
  );
}

/** Skills as switches: the installed ones, and any granted that are no longer installed. */
function SkillRows({ skills, granted, disabled, onChange }: { skills: SkillView[]; granted: string[]; disabled: boolean; onChange(next: string[]): void }) {
  const installed = new Map(skills.map((s) => [s.name, s]));
  const names = [...skills.map((s) => s.name), ...granted.filter((n) => !installed.has(n))];
  if (!names.length) return <p className="m-help dt-pad">No skills on this computer.</p>;
  return (
    <>
      {names.map((name) => {
        const s = installed.get(name);
        return (
          <SwitchRow
            key={name}
            title={name}
            sub={s ? s.description || undefined : "Not installed on this computer"}
            checked={granted.includes(name)}
            disabled={disabled}
            onChange={(v) => onChange(v ? [...granted, name] : granted.filter((n) => n !== name))}
          />
        );
      })}
    </>
  );
}
