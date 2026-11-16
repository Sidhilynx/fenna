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
import { type AgentEvent, type AgentKind, type AttachedImage, AGENTS, AGENT_KINDS, agent, effortLabel, modelLogo } from "./agents.ts";
import { type Chat, type ChatBook, type ChatItem, activeChat, addChat, chatTitle, closeChat, parseChats, reorderChats, showChat, updateChat } from "./chats.ts";
import { ChatTabs } from "./ChatTabs.tsx";
import { relativeTime } from "./homeText.ts";
import { McpGuideDialog } from "./McpGuideDialog.tsx";
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
  /** Path to the open document folder, for the MCP guide and external agents. */
  docPath?: string | null;
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

export function ChatPanel({ noun, view, suggestions, intro, placeholder, draft: incoming, docPath, onDraftTaken, onWorking, className = "" }: ChatPanelProps) {
  const agents = useAgents();
  const [book, setBook] = useState<ChatBook | null>(null);
  const [draft, setDraft] = useState("");
  const [run, setRun] = useState<{ id: string; chat: string; kind: AgentKind } | null>(null);
  const [streaming, setStreaming] = useState("");
  const [focused, setFocused] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [width, setWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("fenna.chatWidth");
      if (saved) {
        const n = parseInt(saved, 10);
        if (!isNaN(n) && n >= 280 && n <= 1000) return n;
      }
    } catch {}
    return 360;
  });
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const early = useRef<AgentEvent[]>([]);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [previewModalImg, setPreviewModalImg] = useState<{ src: string; name: string } | null>(null);

  const addImageFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    for (const file of imageFiles) {
      const reader = new FileReader();
      reader.onload = () => {
        const data = typeof reader.result === "string" ? reader.result : "";
        if (data) {
          setAttachedImages((prev) => [
            ...prev.slice(0, 9),
            { name: file.name, mimeType: file.type || "image/png", data },
          ]);
        }
      };
      reader.readAsDataURL(file);
    }
  }, []);

  useEffect(() => {
    if (!previewModalImg) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewModalImg(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewModalImg]);

  useEffect(() => {
    document.documentElement.style.setProperty("--chat-w", `${width}px`);
  }, [width]);

  const applyWidth = useCallback((newW: number) => {
    const minW = 280;
    const maxW = Math.min(840, Math.max(360, window.innerWidth - 320));
    const clamped = Math.max(minW, Math.min(maxW, newW));
    setWidth(clamped);
    document.documentElement.style.setProperty("--chat-w", `${clamped}px`);
    try {
      localStorage.setItem("fenna.chatWidth", `${clamped}px`);
    } catch {}
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {}
    setResizing(true);
    document.body.classList.add("chat-resizing");

    const onPointerMove = (ev: PointerEvent) => {
      const newWidth = Math.round(window.innerWidth - ev.clientX);
      const minW = 280;
      const maxW = Math.min(840, Math.max(360, window.innerWidth - 320));
      const clamped = Math.max(minW, Math.min(maxW, newWidth));
      setWidth(clamped);
      document.documentElement.style.setProperty("--chat-w", `${clamped}px`);
    };

    const onPointerUp = (ev: PointerEvent) => {
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {}
      setResizing(false);
      document.body.classList.remove("chat-resizing");
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("pointercancel", onPointerUp);

      const finalW = Math.round(window.innerWidth - ev.clientX);
      const minW = 280;
      const maxW = Math.min(840, Math.max(360, window.innerWidth - 320));
      const clamped = Math.max(minW, Math.min(maxW, finalW));
      setWidth(clamped);
      document.documentElement.style.setProperty("--chat-w", `${clamped}px`);
      try {
        localStorage.setItem("fenna.chatWidth", `${clamped}px`);
      } catch {}
    };

    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
    target.addEventListener("pointercancel", onPointerUp);
  }, []);

  const onResetWidth = useCallback(() => {
    setWidth(360);
    document.documentElement.style.setProperty("--chat-w", "360px");
    try {
      localStorage.removeItem("fenna.chatWidth");
    } catch {}
  }, []);

  const toggleWide = useCallback(() => {
    if (width > 420) {
      applyWidth(360);
    } else {
      applyWidth(560);
    }
  }, [width, applyWidth]);

  const onResizerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 32 : 16;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        applyWidth(width + step);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        applyWidth(width - step);
      } else if (e.key === "Home" || e.key === "0") {
        e.preventDefault();
        onResetWidth();
      }
    },
    [width, applyWidth, onResetWidth],
  );

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
    const hasImages = attachedImages.length > 0;
    if ((!t && !hasImages) || busy || !kind || !ready || !chat || !book) return;
    const context = view?.context ?? null;
    const currentImages = [...attachedImages];
    setDraft("");
    setAttachedImages([]);
    // A conversation belongs to one assistant; switching starts its session over.
    const sessionId = chat.sessionKind === kind ? chat.sessionId : null;
    const userItem: ChatItem = {
      role: "user",
      text: t || "Attached reference image(s).",
      ...(view?.label ? { about: view.label } : {}),
      ...(hasImages ? { images: currentImages } : {}),
    };
    edit(chat.id, (c) => ({ ...c, kind, items: [...c.items, userItem], at: Date.now() }));
    early.current = [];
    try {
      const id = await agent.send({
        kind,
        model: model?.value ?? "",
        effort: chat.effort,
        text: t,
        context,
        sessionId,
        images: hasImages ? currentImages : undefined,
      });
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
      <div
        className={`as-resizer${resizing ? " dragging" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize assistant column"
        aria-valuenow={width}
        aria-valuemin={280}
        aria-valuemax={840}
        tabIndex={0}
        title="Drag to resize, double-click to reset"
        onPointerDown={onPointerDown}
        onDoubleClick={onResetWidth}
        onKeyDown={onResizerKeyDown}
      />
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
              <div className="as-head-actions">
                <button
                  type="button"
                  className="ct-btn"
                  title={width > 420 ? "Compact chat" : "Expand chat"}
                  aria-label={width > 420 ? "Compact chat" : "Expand chat"}
                  onClick={toggleWide}
                >
                  <Icon name={width > 420 ? "resize" : "wide"} />
                </button>
                <button
                  type="button"
                  className="ct-btn"
                  title="MCP setup guide"
                  aria-label="MCP setup guide"
                  onClick={() => setShowMcp(true)}
                >
                  <Icon name="code" />
                </button>
                <MenuButton className="ct-btn" label="Chat history" title="Chat history" align="end" entries={historyEntries}>
                  <Icon name="history" />
                </MenuButton>
              </div>
            }
          />
        )}
      </header>

      <div className="as-list" ref={listRef} role="log" aria-live="polite">
        {chat && !chat.items.length && !kind ? (
          <AgentChoice agents={agents} noun={noun} onPick={pick} onMcpGuide={() => setShowMcp(true)} />
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
                  {it.images && it.images.length > 0 && (
                    <div className="as-user-images">
                      {it.images.map((img, imgIdx) => (
                        <img
                          key={imgIdx}
                          src={img.data}
                          alt={img.name}
                          className="as-user-img"
                          title={`Click to preview ${img.name}`}
                          onClick={() => setPreviewModalImg({ src: img.data, name: img.name })}
                        />
                      ))}
                    </div>
                  )}
                  {it.text && <div className="as-bubble">{it.text}</div>}
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
        <div
          className={`as-composer${focused ? " focus" : ""}${dragOver ? " drag-over" : ""}`}
          onDragOver={(e) => {
            if (e.dataTransfer?.types?.includes("Files")) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer?.files?.length) {
              addImageFiles(e.dataTransfer.files);
            }
          }}
        >
          {view?.label && (
            <div className="as-context" title="Sent with your message so the assistant knows what you mean">
              {view.label}
            </div>
          )}
          {attachedImages.length > 0 && (
            <div className="as-attachments" aria-label="Attached images">
              {attachedImages.map((img, idx) => (
                <div key={idx} className="as-attach-item">
                  <img
                    src={img.data}
                    alt={img.name}
                    className="as-attach-thumb"
                    onClick={() => setPreviewModalImg({ src: img.data, name: img.name })}
                    title={`Click to preview: ${img.name}`}
                  />
                  <button
                    type="button"
                    className="as-attach-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAttachedImages((prev) => prev.filter((_, i) => i !== idx));
                    }}
                    title={`Remove ${img.name}`}
                    aria-label={`Remove ${img.name}`}
                  >
                    <Icon name="close" size={10} />
                  </button>
                </div>
              ))}
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
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              const imageFiles: File[] = [];
              for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item && item.type.startsWith("image/")) {
                  const file = item.getAsFile();
                  if (file) imageFiles.push(file);
                }
              }
              if (imageFiles.length > 0) {
                addImageFiles(imageFiles);
              }
            }}
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
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) addImageFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="as-tools">
            <div className="as-pickers">
              <button
                type="button"
                className="as-attach-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Attach reference image"
                aria-label="Attach reference image"
              >
                <Icon name="image" size={15} />
              </button>
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
              <button
                type="submit"
                className={`as-send${(draft.trim() || attachedImages.length > 0) && ready ? " ready" : ""}`}
                disabled={(!draft.trim() && attachedImages.length === 0) || !ready}
                aria-label="Send"
              >
                <Icon name="arrowUp" size={15} />
              </button>
            )}
          </div>
        </div>
      </form>
      {previewModalImg && (
        <div className="as-img-modal" role="dialog" aria-modal="true" aria-label={previewModalImg.name} onClick={() => setPreviewModalImg(null)}>
          <div className="as-img-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="as-img-modal-header">
              <span className="as-img-modal-title">{previewModalImg.name}</span>
              <button type="button" className="as-img-modal-close" onClick={() => setPreviewModalImg(null)} aria-label="Close image preview">
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="as-img-modal-body">
              <img src={previewModalImg.src} alt={previewModalImg.name} />
            </div>
          </div>
        </div>
      )}
      {showMcp && <McpGuideDialog open={showMcp} onClose={() => setShowMcp(false)} noun={noun} docPath={docPath} />}
    </aside>
  );
}
