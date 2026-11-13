// The chat column, shared by every app on the shell: chat with the user's
// own AI (Claude Code, Codex or Antigravity, on their plan), which works on
// the open document through the app's MCP server while they watch. One
// document keeps many conversations: the open ones are tabs along the top,
// the rest are in History. Each message carries what the user is looking at
// (the app's `view`) so "this" means what's on their screen. After Arsaze's
// chat column.
//
// The app supplies only its words and its view; install, sign-in, pickers,
// chat tabs, history and the conversation itself are the shell's.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentChoice, AgentLogo, AgentSetup, Logo, accountEntries, statusWord } from "./AgentSetup.tsx";
import { type AgentEvent, type AgentKind, AGENTS, AGENT_KINDS, agent, effortLabel, modelLogo } from "./agents.ts";
import { type Chat, type ChatBook, type ChatItem, activeChat, addChat, chatTitle, closeChat, parseChats, reorderChats, showChat, updateChat } from "./chats.ts";
import { ChatTabs } from "./ChatTabs.tsx";
import { relativeTime } from "./homeText.ts";
import { Icon } from "./ui/icons.tsx";
import { type MenuEntry, MenuButton } from "./ui/Menu.tsx";
import { useAgents } from "./useAgents.ts";
import "./chat.css";

const HISTORY_MAX = 30;
const LAST_KIND_KEY = "shell.assistant";

function lastKind(): AgentKind | null {
  try {
    const k = localStorage.getItem(LAST_KIND_KEY);
    return AGENT_KINDS.includes(k as AgentKind) ? (k as AgentKind) : null;
  } catch {
    return null;
  }
}
function rememberKind(k: AgentKind) {
  try {
    localStorage.setItem(LAST_KIND_KEY, k);
  } catch {
    /* a convenience only */
  }
}

export interface ChatView {
  /** Sent with the message: what the user is looking at (data the AI reads). */
  context: unknown;
  /** The same in a few words, shown above the composer and on the message. */
  label: string;
}

export interface ChatPanelProps {
  /** What the app's documents are called: "deck", "doc", "sheet". */
  noun: string;
  /** What the user is looking at now, or null. */
  view: ChatView | null;
  /** Shown in an empty chat; a tap sends one. */
  suggestions: string[];
  /** The empty chat's one line ("Ask for a new deck, or for changes to what you've selected."). */
  intro: string;
  /** The composer's placeholder. */
  placeholder: string;
  /** Words to put in the composer (unsent), e.g. a draft written on Home; taken once. */
  draft?: string;
  onDraftTaken?(): void;
  /** The assistant started (its name) or stopped (null) working on the document. */
  onWorking?(who: { name: string } | null): void;
  className?: string;
}

/** "0:14" since the reply started; mounted only while one runs. */
function WorkingClock() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.floor((now - start) / 1000);
  return <span className="as-clock">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</span>;
}

export function ChatPanel({ noun, view, suggestions, intro, placeholder, draft: incoming, onDraftTaken, onWorking, className = "" }: ChatPanelProps) {
  const agents = useAgents();
  const [book, setBook] = useState<ChatBook | null>(null);
  const [draft, setDraft] = useState("");
  const [run, setRun] = useState<{ id: string; chat: string; kind: AgentKind } | null>(null);
  const [streaming, setStreaming] = useState("");
  const [focused, setFocused] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const early = useRef<AgentEvent[]>([]);

  useEffect(() => {
    void agent
      .loadChat()
      .then((saved) => setBook(parseChats(saved)))
      .catch(() => setBook(parseChats(null)));
  }, []);

  useEffect(() => {
    if (book) void agent.saveChat(book);
  }, [book]);

  useEffect(() => {
    if (!incoming) return;
    setDraft(incoming);
    onDraftTaken?.();
    inputRef.current?.focus();
  }, [incoming, onDraftTaken]);

  const chat: Chat | null = book ? activeChat(book) : null;
  // Who answers: this chat's choice, else the one picked last time; none yet means the user picks.
  const kind: AgentKind | null = chat?.kind ?? lastKind();
  const ready = !!kind && agents.stepOf(kind).step === "ready";
  const catalog = kind ? agents.catalogs[kind] : undefined;
  const kindModels = catalog?.models ?? [];
  const model = kindModels.find((m) => m.value === chat?.model) ?? kindModels[0] ?? null;
  const busy = run !== null;

  // Follow the conversation to its newest message; an empty chat (the picker) starts at its top.
  useEffect(() => {
    if (chat?.items.length) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat?.items.length, chat?.id, streaming]);

  const edit = useCallback((id: string, fn: (c: Chat) => Chat) => setBook((b) => (b ? updateChat(b, id, fn) : b)), []);
  const push = useCallback((id: string, item: ChatItem) => edit(id, (c) => ({ ...c, items: [...c.items, item], at: Date.now() })), [edit]);

  const onEvent = useCallback(
    (ev: AgentEvent) => {
      if (!run) {
        early.current.push(ev);
        return;
      }
      if (ev.runId !== run.id) return;
      const id = run.chat;
      if (ev.type === "delta") return setStreaming((s) => s + ev.text);
      if (ev.type === "text") {
        setStreaming("");
        push(id, { role: "assistant", text: ev.text });
      } else if (ev.type === "session") edit(id, (c) => ({ ...c, sessionId: ev.sessionId, sessionKind: run.kind }));
      else if (ev.type === "tool")
        edit(id, (c) => {
          const at = c.items.findIndex((i) => i.role === "tool" && i.id === ev.id);
          if (at < 0) return { ...c, items: [...c.items, { role: "tool", id: ev.id, label: ev.label ?? "Working", status: ev.status }] };
          const items = [...c.items];
          const prev = items[at] as Extract<ChatItem, { role: "tool" }>;
          items[at] = { ...prev, status: ev.status, label: ev.label ?? prev.label };
          return { ...c, items };
        });
      else if (ev.type === "error") {
        push(id, ev.fix ? { role: "error", text: ev.message, fix: ev.fix } : { role: "error", text: ev.message });
        if (ev.fix === "signin") agents.markExpired(run.kind);
        if (ev.fix === "install") void agents.load(run.kind, true);
      }
      if (ev.type === "done" || ev.type === "error" || ev.type === "stopped") {
        if (ev.type === "done" && ev.sessionId) edit(id, (c) => ({ ...c, sessionId: ev.sessionId }));
        onWorking?.(null);
        setRun(null);
        setStreaming("");
      }
    },
    [run, edit, push, onWorking, agents],
  );

  useEffect(() => agent.onEvent(onEvent), [onEvent]);
  // Events that came before send() returned the run id.
  useEffect(() => {
    if (!run) return;
    for (const ev of early.current.splice(0)) if (ev.runId === run.id) onEvent(ev);
  }, [run, onEvent]);
  // Closing the panel stops listening to the run, so the document stops showing it.
  useEffect(() => () => onWorking?.(null), [onWorking]);

  const pick = (k: AgentKind) => {
    rememberKind(k);
    if (chat) edit(chat.id, (c) => ({ ...c, kind: k, model: "", effort: "" }));
  };

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy || !kind || !ready || !chat || !book) return;
    const context = view?.context ?? null;
    setDraft("");
    // A conversation belongs to one assistant; switching starts its session over.
    const sessionId = chat.sessionKind === kind ? chat.sessionId : null;
    edit(chat.id, (c) => ({ ...c, kind, items: [...c.items, { role: "user", text: t, ...(view?.label ? { about: view.label } : {}) }], at: Date.now() }));
    early.current = [];
    try {
      const id = await agent.send({ kind, model: model?.value ?? "", effort: chat.effort, text: t, context, sessionId });
      setRun({ id, chat: chat.id, kind });
      onWorking?.({ name: AGENTS[kind].name });
    } catch (e) {
      push(chat.id, { role: "error", text: (e as Error).message });
    }
  };

  const setChoice = (patch: Partial<Pick<Chat, "kind" | "model" | "effort">>) => chat && edit(chat.id, (c) => ({ ...c, ...patch }));

  const engineEntries = (): MenuEntry[] =>
    AGENT_KINDS.map((k) => ({
      label: AGENTS[k].name,
      icon: <AgentLogo kind={k} />,
      checked: k === kind,
      hint: agents.stepOf(k).step === "ready" ? `Your ${AGENTS[k].plan}, on this computer` : statusWord(agents, k),
      onSelect: () => {
        rememberKind(k);
        setChoice({ kind: k, model: "", effort: "" });
      },
    }));
  const modelEntries = (): MenuEntry[] =>
    kind
      ? kindModels.map((m) => {
          const logo = modelLogo(kind, m.label);
          return { label: m.label, hint: m.description || undefined, icon: <Logo src={logo.src} invert={logo.invert} />, checked: m.value === model?.value, onSelect: () => setChoice({ model: m.value, effort: "" }) };
        })
      : [];
  const effortEntries = (): MenuEntry[] =>
    model
      ? [
          { label: model.defaultEffort ? `Default (${effortLabel(model.defaultEffort)})` : "Default", checked: !chat?.effort, onSelect: () => setChoice({ effort: "" }) },
          ...model.efforts.map((e) => ({ label: effortLabel(e), checked: chat?.effort === e, onSelect: () => setChoice({ effort: e }) })),
        ]
      : [];

  const historyEntries = (): MenuEntry[] => {
    if (!book) return [];
    const past = [...book.chats].filter((c) => c.items.length).sort((a, b) => b.at - a.at).slice(0, HISTORY_MAX);
    return past.length
      ? [{ heading: `Chats in this ${noun}` }, ...past.map((c) => ({ label: chatTitle(c), hint: relativeTime(c.at), checked: c.id === book.active, onSelect: () => setBook((b) => (b ? showChat(b, c.id) : b)) }))]
      : [{ heading: `No earlier chats in this ${noun}` }];
  };

  const tabs = useMemo(() => (book ? book.open.map((id) => book.chats.find((c) => c.id === id)!).map((c) => ({ id: c.id, title: chatTitle(c), running: run?.chat === c.id })) : []), [book, run]);
  const name = kind ? AGENTS[kind].name : "Assistant";
  const shortModel = model?.label.replace(/^Default · /, "") ?? "";
  const replyKind = run?.kind ?? kind;

  return (
    <aside className={`chat-panel ${className}`.trim()} aria-label="Assistant">
      <header className="as-head">
        {book && (
          <ChatTabs
            tabs={tabs}
            activeId={book.active}
            locked={busy}
            onSelect={(id) => setBook((b) => (b ? showChat(b, id) : b))}
            onClose={(id) => setBook((b) => (b ? closeChat(b, id) : b))}
            onReorder={(ids) => setBook((b) => (b ? reorderChats(b, ids) : b))}
            onNew={() => setBook((b) => (b ? addChat(b) : b))}
            trailing={
              <MenuButton className="ct-btn" label="Chat history" title="Chat history" align="end" entries={historyEntries}>
                <Icon name="history" />
              </MenuButton>
            }
          />
        )}
      </header>

      <div className="as-list" ref={listRef} role="log" aria-live="polite">
        {chat && !chat.items.length && !kind ? (
          <AgentChoice agents={agents} noun={noun} onPick={pick} />
        ) : chat && !chat.items.length ? (
          <div className="as-empty">
            <p>{intro}</p>
            <div className="as-suggest">
              {suggestions.map((s) => (
                <button key={s} className="as-chip" onClick={() => void send(s)} disabled={!ready || busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chat?.items.map((it, i) => {
            if (it.role === "user")
              return (
                <div key={i} className="as-user">
                  {it.about && <div className="as-about">{it.about}</div>}
                  <div className="as-bubble">{it.text}</div>
                </div>
              );
            if (it.role === "assistant") {
              const first = i === 0 || chat.items[i - 1]!.role === "user";
              const who = chat.sessionKind ?? kind;
              return (
                <div key={i} className="as-reply">
                  {first && who && (
                    <div className="as-who">
                      <AgentLogo kind={who} size={16} />
                      <span>{AGENTS[who].name}</span>
                    </div>
                  )}
                  <div className="as-text">{it.text}</div>
                </div>
              );
            }
            if (it.role === "tool")
              return (
                <div key={i} className={`as-step ${it.status}`}>
                  <span className="as-step-mark" aria-hidden />
                  {it.label}
                </div>
              );
            return (
              <div key={i} className="as-error" role="alert">
                <Icon name="warning" size={14} /> {it.text}
              </div>
            );
          })
        )}
        {busy && run?.chat === chat?.id && replyKind && (
          <div className="as-reply live">
            <div className="as-who">
              <AgentLogo kind={replyKind} size={16} />
              <span>{AGENTS[replyKind].name}</span>
              <span className="as-working" aria-label="Working">
                <span />
              </span>
              <WorkingClock />
            </div>
            {streaming && <div className="as-text">{streaming}</div>}
          </div>
        )}
      </div>

      <form
        className="as-foot"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        {kind && <AgentSetup agents={agents} kind={kind} />}
        <div className={`as-composer${focused ? " focus" : ""}`}>
          {view?.label && (
            <div className="as-context" title="Sent with your message so the assistant knows what you mean">
              {view.label}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={draft}
            rows={2}
            placeholder={busy ? `${name} is working` : kind ? placeholder : "Pick who answers to start"}
            aria-label="Message"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setDraft(e.target.value);
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(draft);
              }
              if (e.key === "Escape") inputRef.current?.blur();
            }}
          />
          <div className="as-tools">
            <div className="as-pickers">
              <MenuButton className="as-pick" label="Who answers" title={`Who answers in this chat: ${name}`} entries={engineEntries}>
                {kind && <AgentLogo kind={kind} />}
                <span>{name}</span>
                <Icon name="chevronDown" size={12} />
              </MenuButton>
              {kind && ready && model && kindModels.length > 1 && (
                <MenuButton className="as-pick" label="Model" title={`Model: ${model.label}`} entries={modelEntries}>
                  <Logo {...modelLogo(kind, model.label)} size={13} />
                  <span>{shortModel}</span>
                  <Icon name="chevronDown" size={12} />
                </MenuButton>
              )}
              {ready && model && model.efforts.length > 0 && (
                <MenuButton className="as-pick" label="Effort" title="How hard it thinks" entries={effortEntries}>
                  <span>{chat?.effort ? effortLabel(chat.effort) : "Effort"}</span>
                  <Icon name="chevronDown" size={12} />
                </MenuButton>
              )}
              {kind && ready && (
                <MenuButton className="as-pick icon" label={`${AGENTS[kind].name} account`} title={`${AGENTS[kind].name} account`} entries={() => accountEntries(agents, kind)}>
                  <Icon name="dots" size={14} />
                </MenuButton>
              )}
            </div>
            {busy ? (
              <button type="button" className="as-send ready" onClick={() => run && void agent.stop(run.id)} aria-label="Stop" title="Stop">
                <Icon name="stop" size={12} />
              </button>
            ) : (
              <button type="submit" className={`as-send${draft.trim() && ready ? " ready" : ""}`} disabled={!draft.trim() || !ready} aria-label="Send">
                <Icon name="arrowUp" size={15} />
              </button>
            )}
          </div>
        </div>
      </form>
    </aside>
  );
}
