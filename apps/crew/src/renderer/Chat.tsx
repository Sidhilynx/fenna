// The conversation with one bot: its messages, its steps as quiet lines,
// questions and approvals inline, and the composer. The panel beside it is
// Panel.tsx.

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { CLI_NAMES, RUNS_CHAT, type Avatar as AvatarId, type AvatarColor } from "@opendeck/crew";
import { MenuButton, toast, type MenuEntry } from "@opendeck/shell";
import { errorText, invoke, on } from "../shared/api.ts";
import type { BotSummary, ChatSummary, LibraryItem, MeetingView, Waiting } from "../shared/contract.ts";
import { ApprovalCard, AskCard } from "./Cards.tsx";
import { Avatar } from "./Avatar.tsx";
import { PendingFiles, SendingFiles, SentFiles, pickFiles, usePreviews } from "./AttachChips.tsx";
import { DocCards } from "./DocCard.tsx";
import { docCardAnchors } from "./docCards.ts";
import { greeting } from "./greeting.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import { Markdown } from "./Markdown.tsx";
import { openMention } from "./mentions.ts";
import { Panel } from "./Panel.tsx";
import { PixelDots } from "./PixelMotion.tsx";
import { botOf, useBotDetail, useCrew, waitingFor } from "./crew.tsx";
import { buildItems, useRuns, type Item, type RunLog, type Step } from "./transcript.ts";
import { PixelField } from "./PixelField.tsx";

/** A bot a message can name with @ in a group chat. */
export interface Mentionable {
  name: string;
  avatar: AvatarId | null;
  color: AvatarColor | null;
}

/** `attachable`: the composer takes files (Attach, paste, drop), sent with the message. */
export function Composer({ name, running, onSend, onStop, mentions, hint, attachable = false }: { name: string; running: boolean; onSend(text: string, files: File[]): Promise<void>; onStop?(): void; mentions?: Mentionable[]; hint?: string; attachable?: boolean }) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(-1);
  const landing = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const previews = usePreviews(files);

  const addFiles = (picked: File[]) => {
    const room = pickFiles(files.length, picked);
    setError(room.error);
    if (room.files.length) setFiles((cur) => [...cur, ...room.files]);
  };
  const removeFile = (f: File) => {
    setFiles((cur) => cur.filter((x) => x !== f));
    setError("");
    ta.current?.focus();
  };
  const dropped = (e: { dataTransfer: DataTransfer | null }) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  const open = mentions ? openMention(text, caret) : null;
  const q = open?.query.toLowerCase() ?? "";
  const matches = open && open.start !== dismissed && mentions ? mentions.filter((m) => m.name.toLowerCase().replace(/s/g, "").includes(q.replace(/s/g, ""))) : [];
  const shown = matches.length > 0;
  const at = Math.min(active, Math.max(0, matches.length - 1));

  const insert = (m: Mentionable) => {
    if (!open) return;
    const word = `@${m.avatar ? m.name : "all"} `;
    setText(text.slice(0, open.start) + word + text.slice(caret));
    landing.current = open.start + word.length;
    setActive(0);
  };

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    if (landing.current !== null) {
      el.setSelectionRange(landing.current, landing.current);
      setCaret(landing.current);
      landing.current = null;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const submit = async () => {
    const t = text.trim();
    if ((!t && !files.length) || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSend(t, files);
      setText("");
      setFiles([]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const drop = attachable
    ? {
        onDragOver: (e: DragEvent<HTMLDivElement>) => {
          if (!dropped(e.nativeEvent)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDragging(true);
        },
        onDragLeave: (e: DragEvent<HTMLDivElement>) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: (e: DragEvent<HTMLDivElement>) => {
          if (!dropped(e.nativeEvent)) return;
          e.preventDefault();
          setDragging(false);
          addFiles(Array.from(e.dataTransfer.files));
        },
      }
    : {};

  return (
    <div className={dragging ? "composer-wrap dropping" : "composer-wrap"} {...drop}>
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
      {files.length > 0 && <PendingFiles files={files} previews={previews} onRemove={removeFile} />}
      {shown && (
        <ul className="mention-list" role="listbox" id="crew-mentions" aria-label="Mention">
          {matches.map((m, i) => (
            <li key={m.name} id={`crew-mention-${i}`} role="option" aria-selected={i === at} className="mention-item" onMouseDown={(e) => { e.preventDefault(); insert(m); }}>
              {m.avatar && m.color ? <Avatar avatar={m.avatar} color={m.color} size={16} /> : <span className="mention-all" aria-hidden>@</span>}
              <span className="ell">{m.name}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="composer">
        {attachable && (
          <>
            <button type="button" className="btn ghost small att-btn" onClick={() => picker.current?.click()}>
              Attach
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              tabIndex={-1}
              onChange={(e) => {
                addFiles(Array.from(e.currentTarget.files ?? []));
                e.currentTarget.value = "";
              }}
            />
          </>
        )}
        <label className="sr" htmlFor="crew-msg">
          Message {name}
        </label>
        <textarea
          id="crew-msg"
          ref={ta}
          rows={1}
          value={text}
          placeholder={`Message ${name}`}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setActive(0);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onPaste={(e) => {
            const pasted = attachable ? Array.from(e.clipboardData.files) : [];
            if (!pasted.length) return;
            e.preventDefault();
            addFiles(pasted);
          }}
          role={mentions ? "combobox" : undefined}
          aria-expanded={mentions ? shown : undefined}
          aria-controls={shown ? "crew-mentions" : undefined}
          aria-activedescendant={shown ? `crew-mention-${at}` : undefined}
          onKeyDown={(e) => {
            if (shown) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActive((at + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
                return;
              }
              if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                insert(matches[at]!);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                if (open) setDismissed(open.start);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {running && onStop && (
          <button type="button" className="icon-btn stop-btn" aria-label="Stop" title="Stop the run" onClick={onStop}>
            <PixelIcon name="stop" />
          </button>
        )}
        <button type="button" className="icon-btn send-btn" aria-label="Send" title="Send" disabled={(!text.trim() && !files.length) || busy} onClick={() => void submit()}>
          <PixelIcon name="send" />
        </button>
      </div>
      {dragging && <p className="composer-hint att-drop">Drop to attach</p>}
      {hint && <p className="composer-hint">{hint}</p>}
    </div>
  );
}

export function BrainNotice({ bot }: { bot: BotSummary }) {
  const { clis, openCli } = useCrew();
  const [error, setError] = useState("");
  const mine = clis.find((c) => c.kind === bot.brain.cli);
  if (!mine || (mine.installed && mine.signedIn !== false)) return null;
  const other = clis.find((c) => c.kind !== bot.brain.cli && c.installed && c.signedIn === true);
  const name = CLI_NAMES[bot.brain.cli];
  const swap = () => {
    if (!other) return;
    setError("");
    invoke("crew:update", bot.slug, { brain: { cli: other.kind, model: "", effort: "" } }).then(
      () => undefined,
      (e) => setError(errorText(e)),
    );
  };
  return (
    <div className="brain-notice" role="status">
      <PixelIcon name="attention" size={12} />
      <span className="brain-text">{mine.installed ? `${name} isn't signed in on this computer.` : `${name} isn't installed on this computer.`}</span>
      {other && (
        <button type="button" className="btn small" onClick={swap}>
          Use {CLI_NAMES[other.kind]}
        </button>
      )}
      <button type="button" className="btn small ghost" onClick={openCli}>
        Sign in
      </button>
      {error && <span className="card-error">{error}</span>}
    </div>
  );
}

function Steps({ steps, last }: { steps: Step[]; last: boolean }) {
  const [open, setOpen] = useState(false);
  const folded = steps.length > 5 && !last && !open;
  const failed = steps.filter((s) => s.status === "failed").length;
  return (
    <div className="steps">
      {folded ? (
        <button type="button" className="step step-fold" onClick={() => setOpen(true)}>
          <PixelIcon name="chevron-down" size={12} />
          {steps.length} steps{failed ? `, ${failed} failed` : ""}
        </button>
      ) : (
        steps.map((s) => (
          <div key={s.id} className={`step ${s.status}`}>
            {s.status === "done" ? <PixelIcon name="check" size={12} /> : s.status === "failed" ? <PixelIcon name="close" size={12} /> : <span className="step-dot" aria-hidden />}
            <span className="ell" title={s.label}>
              {s.label}
              {s.status === "failed" ? " (failed)" : ""}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

export type Pending = { key: number; text: string; files: { name: string; size: number }[]; queued: boolean; target: number };

/** The person's messages sent this session that the run log doesn't show yet, and the send that adds one. */
export function usePending(slug: string, runs: RunLog[], chat?: string) {
  const [pending, setPending] = useState<Pending[]>([]);
  const seq = useRef(0);
  const youCount = runs.reduce((n, r) => n + r.events.filter((e) => e.type === "start" && e.trigger === "person" && (e.text || e.attachments?.length)).length, 0);

  useEffect(() => setPending([]), [slug, chat]);

  const send = async (text: string, picked: File[] = []) => {
    const files = await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: await f.arrayBuffer() })));
    const r = await invoke("crew:send", slug, text, chat, files.length ? files : undefined);
    // It answered the bot's open question: the answer shows under the question, not as a new message.
    if (r.answered) return;
    const target = Math.max(youCount, ...pending.map((p) => p.target)) + 1;
    setPending((p) => [...p, { key: ++seq.current, text, files: picked.map((f) => ({ name: f.name, size: f.size })), queued: r.queued, target }]);
  };
  return { pending, send };
}

const NO_LIBRARY: LibraryItem[] = [];

/** The bot's messages, steps, questions and approvals, with its library's documents under the reply that made them. `compact` is the narrow dock. */
export function Messages({ bot, chat, waiting, pending, runState, library = NO_LIBRARY, compact = false }: { bot: BotSummary; chat?: string; waiting: Waiting[]; pending: Pending[]; runState: ReturnType<typeof useRuns>; library?: LibraryItem[]; compact?: boolean }) {
  const { overview } = useCrew();
  const { runs, more, loaded, delta, error, earlier } = runState;
  const runningHere = bot.running && bot.runningChat === (chat ?? bot.currentChat);
  const names = (s: string) => botOf(overview, s)?.name ?? s;
  const items = useMemo(() => buildItems(runs, names), [runs, overview.bots]);
  const cardsAt = useMemo(() => docCardAnchors(items, runs, library, Date.now()), [items, runs, library]);
  const face = compact ? 16 : 24;
  const youCount = items.filter((i) => i.kind === "you").length;
  const shownPending = pending.filter((p) => youCount < p.target);
  const waitIds = new Set(waiting.map((w) => w.id));
  const faced = useMemo(() => {
    const seen = new Set<string>();
    const first = new Set<string>();
    for (const it of items) {
      if (it.kind === "bot" && !seen.has(it.runId)) {
        seen.add(it.runId);
        first.add(it.key);
      }
    }
    return { first, runs: seen };
  }, [items]);

  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    stick.current = true;
  }, [bot.slug]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, delta, shownPending.length, bot.running, loaded]);

  const lastIndex = items.length - 1;
  const lastStepsAt = items.map((i) => i.kind).lastIndexOf("steps");

  const draw = (it: Item, i: number) => {
    switch (it.kind) {
      case "you":
        return (
          <div key={it.key} className="msg you">
            {it.text}
            {it.attachments.length > 0 && <SentFiles bot={bot} files={it.attachments} at={it.at} />}
          </div>
        );
      case "note":
        return (
          <div key={it.key} className="note">
            {it.text}
          </div>
        );
      case "bot":
        return (
          <div key={it.key} className="msg bot">
            <span className="msg-face">{faced.first.has(it.key) && <Avatar avatar={bot.avatar} color={bot.color} size={face} title={bot.name} />}</span>
            <div className="msg-text">
              <Markdown text={it.text} />
            </div>
          </div>
        );
      case "steps":
        return <Steps key={it.key} steps={it.steps} last={i === lastStepsAt && i >= lastIndex - 1} />;
      case "ask":
        return <AskCard key={it.key} item={it} waiting={waitIds.has(it.askId)} />;
      case "approval":
        return <ApprovalCard key={it.key} item={it} waiting={waitIds.has(it.approvalId)} />;
      case "end":
        return (
          <div key={it.key} className={`step end ${it.outcome}`} role={it.outcome === "error" ? "alert" : undefined}>
            {it.outcome === "error" ? <PixelIcon name="close" size={12} /> : <PixelIcon name="stop" size={12} />}
            <span>{it.outcome === "error" ? `The run failed${it.message ? `: ${it.message}` : "."}` : "Stopped."}</span>
          </div>
        );
    }
  };

  return (
    <div
      className={compact ? "messages compact" : "messages"}
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className="thread">
        {more && (
          <button type="button" className="btn ghost earlier" onClick={earlier}>
            Earlier messages
          </button>
        )}
        {loaded &&
          !items.length &&
          !shownPending.length &&
          !runningHere &&
          (chat === RUNS_CHAT ? (
            <p className="thread-empty">Scheduled and watch runs show here.</p>
          ) : (
            <div className="msg bot">
              <span className="msg-face">
                <Avatar avatar={bot.avatar} color={bot.color} size={face} title={bot.name} />
              </span>
              <div className="msg-text">
                <Markdown text={greeting(bot)} />
              </div>
            </div>
          ))}
        {error && <p className="composer-error">{error}</p>}
        {items.map((it, i) => (
          <Fragment key={it.key}>
            {draw(it, i)}
            {cardsAt.has(it.key) && <DocCards slug={bot.slug} items={cardsAt.get(it.key)!} indent={compact ? "dock" : "chat"} />}
          </Fragment>
        ))}
        {delta && (
          <div className="msg bot live">
            <span className="msg-face">{!faced.runs.has(delta.runId) && <Avatar avatar={bot.avatar} color={bot.color} mood="work" size={face} title={bot.name} />}</span>
            <div className="msg-text">
              <Markdown text={delta.text} />
            </div>
          </div>
        )}
        {shownPending.map((p) => (
          <div key={p.key} className="msg you pending">
            {p.text}
            {p.files.length > 0 && <SendingFiles files={p.files} />}
            {p.queued && <span className="msg-meta">Waiting for a free slot</span>}
          </div>
        ))}
        {runningHere && !delta && (
          <div className="working" role="status">
            <Avatar avatar={bot.avatar} color={bot.color} mood="work" size={face} title={bot.name} />
            <PixelDots />
            <span className="ell">{bot.statusLine}</span>
          </div>
        )}
        {bot.queued && !bot.running && (
          <div className="working queued" role="status">
            <Avatar avatar={bot.avatar} color={bot.color} mood="sleep" size={face} title={bot.name} />
            <span>Waiting for a free slot</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** What the person chose for the details panel this session; until then it follows the window width. */
let panelChoice: boolean | null = null;

/** A chat's name in the list: the person's first words, or what kind of chat it is. */
export function chatName(c: ChatSummary): string {
  if (c.id === RUNS_CHAT) return "Runs";
  if (c.title) return c.title;
  return c.startedAt ? "New chat" : "Earlier chat";
}

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** How full the chat's context is, as ten pixel blocks. Shown only when the CLI reports its window. */
function UsageMeter({ usage }: { usage: ChatSummary["usage"] }) {
  if (!usage?.window) return null;
  const share = Math.min(1, usage.used / usage.window);
  const lit = Math.max(share > 0 ? 1 : 0, Math.round(share * 10));
  const label = `Context ${Math.round(share * 100)}% full (${k(usage.used)} of ${k(usage.window)} tokens)`;
  return (
    <span className={`ctx-meter${share >= 0.8 ? " full" : ""}`} role="meter" aria-label="Context" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-valuetext={label} title={label}>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < lit ? "on" : undefined} />
      ))}
    </span>
  );
}

function ChatHead({ bot, viewing, onView, onPanel }: { bot: BotSummary; viewing: string; onView(id: string): void; onPanel?(): void }) {
  const shown = bot.chats.find((c) => c.id === viewing);
  const mine = bot.chats.filter((c) => c.id !== RUNS_CHAT).reverse();
  const runs = bot.chats.find((c) => c.id === RUNS_CHAT);
  const busy = bot.running || bot.queued;
  const fail = (e: unknown) => toast(errorText(e));
  const newChat = () => invoke("crew:newChat", bot.slug).then(onView, fail);
  const compact = () => invoke("crew:compact", bot.slug, viewing).then(() => undefined, fail);
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" }) : undefined);

  const entries = (): MenuEntry[] => [
    { label: "New chat", icon: <PixelIcon name="plus" />, onSelect: () => void newChat() },
    { label: "Compact this chat", icon: <PixelIcon name="duplicate" />, disabled: busy || viewing === RUNS_CHAT || !shown?.usage, onSelect: () => void compact() },
    "separator",
    ...(runs ? [{ label: "Runs", icon: <PixelIcon name="clock" />, checked: viewing === RUNS_CHAT, onSelect: () => onView(RUNS_CHAT) }] : []),
    ...mine.map((c) => ({ label: chatName(c), aside: day(c.startedAt), checked: c.id === viewing, onSelect: () => onView(c.id) })),
  ];

  return (
    <header className="chat-head">
      <MenuButton className="btn ghost chat-pick" label={`Chats. Showing ${shown ? chatName(shown) : "chat"}`} title="Chats" entries={entries}>
        <PixelIcon name={viewing === RUNS_CHAT ? "clock" : "bots"} size={14} />
        <span className="ell">{shown ? chatName(shown) : "Chat"}</span>
        {shown?.compacted && <span className="px-tag">Compacted</span>}
        <PixelIcon name="chevron-down" size={12} />
      </MenuButton>
      <span className="grow" />
      {viewing !== RUNS_CHAT && <UsageMeter usage={shown?.usage ?? null} />}
      <button type="button" className="icon-btn" aria-label="New chat" title="New chat" onClick={() => void newChat()}>
        <PixelIcon name="plus" />
      </button>
      {onPanel && (
        <button type="button" className="icon-btn" aria-label="Show details panel" title="Show details panel" onClick={onPanel}>
          <PixelIcon name="panel" />
        </button>
      )}
    </header>
  );
}

const CALL_STATE: Record<MeetingView["state"], string> = { joining: "Joining a call", waiting: "Waiting to be let in", incall: "In a call", ended: "Left the call" };

/** The bot's call, if it is in one: where it is, and the person's Stop sharing and Leave. */
function CallStrip({ slug }: { slug: string }) {
  const [call, setCall] = useState<MeetingView | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void invoke("crew:meetings").then((list) => live && setCall(list.find((m) => m.slug === slug) ?? null), () => undefined);
    const off = on("crew:meeting", (p) => p.slug === slug && setCall(p.meeting));
    return () => {
      live = false;
      off();
    };
  }, [slug]);
  if (!call) return null;
  const act = (action: "leave" | "stop_sharing") => {
    setBusy(true);
    invoke("crew:meeting", slug, action).then(
      (m) => setCall(m),
      (e) => toast(errorText(e)),
    ).finally(() => setBusy(false));
  };
  const facts = [call.code, call.people !== null ? `${call.people} ${call.people === 1 ? "person" : "people"}` : "", call.sharing ? `Sharing ${call.sharing}` : ""].filter(Boolean);
  return (
    <div className="call-strip" role="status">
      <span className="call-state">{CALL_STATE[call.state]}</span>
      <span className="call-facts ell">{facts.join(" · ")}</span>
      <span className="grow" />
      {call.sharing && (
        <button type="button" className="btn small ghost" disabled={busy} onClick={() => act("stop_sharing")}>
          Stop sharing
        </button>
      )}
      <button type="button" className="btn small" disabled={busy} onClick={() => act("leave")}>
        Leave
      </button>
    </div>
  );
}

export function Chat({ slug }: { slug: string }) {
  const { overview } = useCrew();
  const bot = botOf(overview, slug);
  const [panel, setPanelState] = useState(() => panelChoice ?? window.innerWidth >= 1180);
  const setPanel = (open: boolean) => {
    panelChoice = open;
    setPanelState(open);
  };
  const current = bot?.currentChat ?? "";
  const [runsView, setRunsView] = useState(false);
  useEffect(() => setRunsView(false), [slug, current]);
  const viewing = runsView ? RUNS_CHAT : current;
  const runState = useRuns(slug, viewing || undefined);
  const { detail } = useBotDetail(bot);
  const { pending, send } = usePending(slug, runState.runs, viewing || undefined);

  if (!bot) return null;

  const view = (id: string) => {
    if (id === RUNS_CHAT) return setRunsView(true);
    setRunsView(false);
    if (id !== current) void invoke("crew:openChat", slug, id).catch((e) => toast(errorText(e)));
  };

  return (
    <>
      <main className="main chat px-host">
        <PixelField density={1.2} alpha={0.28} glitch={0.03} />
        <ChatHead bot={bot} viewing={viewing} onView={view} onPanel={panel ? undefined : () => setPanel(true)} />
        <CallStrip slug={slug} />
        <Messages bot={bot} chat={viewing} waiting={waitingFor(overview, slug)} pending={pending} runState={runState} library={detail?.library} />
        <BrainNotice bot={bot} />
        <Composer name={bot.name} running={bot.running || bot.queued} onSend={send} attachable onStop={() => void invoke("crew:stop", slug).catch(() => undefined)} />
      </main>
      {panel && <Panel bot={bot} onClose={() => setPanel(false)} />}
    </>
  );
}
