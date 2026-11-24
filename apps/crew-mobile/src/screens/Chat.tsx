// A bot's chat: its runs in the chat the person is in (or the Runs chat),
// with step lines, question and approval cards, and a composer. The history
// and live events come from the desktop's own model (transcript.ts).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RUNS_CHAT } from "@opendeck/crew";
import { invoke } from "../../../crew/src/shared/api.ts";
import type { BotSummary } from "../../../crew/src/shared/contract.ts";
import { buildItems, chatName, useRuns, type Item, type Step } from "../../../crew/src/renderer/transcript.ts";
import { Markdown } from "../../../crew/src/renderer/Markdown.tsx";
import { greeting } from "../../../crew/src/renderer/greeting.ts";
import { clock, when } from "../../../crew/src/renderer/text.ts";
import { useAct, useStore } from "../state.tsx";
import { ConnBar, Empty, Header, haptic, IconButton, PixelIcon, Sheet, Working } from "../ui.tsx";
import { ApprovalCard, AskCard } from "./Cards.tsx";

export function Chat({ slug }: { slug: string }) {
  const { bot, gen, pop } = useStore();
  const b = bot(slug);
  const [viewing, setViewing] = useState<string | null>(null);
  if (!b) {
    return (
      <>
        <Header back title="Chat" />
        <Empty title="This bot is gone" sub="It was deleted on your computer.">
          <button type="button" className="btn" onClick={pop}>
            Back
          </button>
        </Empty>
      </>
    );
  }
  const chat = viewing ?? b.currentChat;
  return <ChatView key={`${gen}:${chat}`} bot={b} chat={chat} onView={setViewing} />;
}

function ChatView({ bot, chat, onView }: { bot: BotSummary; chat: string; onView(id: string): void }) {
  const { overview, link, push } = useStore();
  const act = useAct();
  const runState = useRuns(bot.slug, chat);
  const { runs, more, loaded, delta, error, earlier } = runState;
  const names = (s: string) => overview?.bots.find((x) => x.slug === s)?.name ?? s;
  const built = useMemo(() => buildItems(runs, names), [runs, overview?.bots]);
  // While the computer is away, the chat as it was last seen, rather than nothing.
  const key = `${bot.slug}:${chat}`;
  useEffect(() => {
    if (loaded && !error) lastSeen.set(key, built);
  }, [key, loaded, error, built]);
  const old = error ? lastSeen.get(key) : undefined;
  const items = old ?? built;
  const [chats, setChats] = useState(false);
  const runsChat = chat === RUNS_CHAT;
  const runningHere = bot.running && bot.runningChat === chat;
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  // Keep the newest message in view, unless the person scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [items, delta, runningHere, loaded]);

  async function newChat() {
    setChats(false);
    const id = await act(invoke("crew:newChat", bot.slug));
    if (id) onView(id);
  }

  async function open(id: string) {
    setChats(false);
    if (id !== RUNS_CHAT) await act(invoke("crew:openChat", bot.slug, id));
    onView(id);
  }

  const current = bot.chats.find((c) => c.id === chat);
  return (
    <>
      <Header
        back
        bot={bot}
        title={bot.name}
        sub={bot.statusLine}
        actions={
          <>
            <IconButton icon="browser" label="Screen" onClick={() => push({ name: "screen", slug: bot.slug })} />
            <IconButton icon="more" label="Details" onClick={() => push({ name: "details", slug: bot.slug })} />
          </>
        }
      />
      <ConnBar />
      <div className="chat-bar">
        <button type="button" className="chat-pick" onClick={() => setChats(true)} aria-haspopup="dialog">
          <PixelIcon name={runsChat ? "clock" : "bots"} size={14} />
          <span className="ell">{current ? chatName(current) : "Chat"}</span>
          <PixelIcon name="chevron-down" size={14} />
        </button>
        <span className="grow" />
        {bot.running || bot.queued ? (
          <button type="button" className="btn chat-run" disabled={!link.ready} onClick={() => void act(invoke("crew:stop", bot.slug)).then(() => haptic("tap"))}>
            <PixelIcon name="stop" size={14} /> Stop
          </button>
        ) : (
          <button type="button" className="btn chat-run" disabled={!link.ready} onClick={() => void act(invoke("crew:run", bot.slug)).then((r) => r && haptic("tap"))}>
            <PixelIcon name="run" size={14} /> Run now
          </button>
        )}
      </div>

      <div
        className="m-body chat-body"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {more && (
          <button type="button" className="btn chat-earlier" onClick={earlier} disabled={!link.ready}>
            Earlier messages
          </button>
        )}
        {!loaded ? (
          <div className="chat-loading">
            <Working label="Loading the chat" />
          </div>
        ) : (
          <ol className="chat-list">
            {error && !old && <li className="chat-note danger">{error}</li>}
            {old && <li className="chat-note">This chat as it was when your computer was last reachable.</li>}
            {!items.length && !error && (runsChat ? <li className="chat-note">Runs nobody typed show here: schedules, watches and hand-offs.</li> : <BotSays text={greeting(bot)} />)}
            {items.map((it) => (
              <ChatItem key={it.key} item={it} />
            ))}
            {delta && <BotSays text={delta.text} live />}
            {runningHere && !delta && bot.mood !== "need" && (
              <li className="chat-working">
                <Working label="Working" />
                <span className="ell">Working…</span>
              </li>
            )}
          </ol>
        )}
      </div>

      {runsChat ? null : <Composer slug={bot.slug} chat={chat} />}

      {chats && (
        <Sheet title="Chats" onClose={() => setChats(false)}>
          <ul className="chat-chats">
            <li>
              <button type="button" className="btn primary block" onClick={() => void newChat()} disabled={!link.ready}>
                New chat
              </button>
            </li>
            {[...bot.chats].filter((c) => c.id !== RUNS_CHAT).reverse().map((c) => (
              <li key={c.id}>
                <button type="button" className="m-row" aria-current={c.id === chat ? "true" : undefined} onClick={() => void open(c.id)}>
                  <span className="m-row-text">
                    <span className="m-row-title ell">{chatName(c)}</span>
                    {c.startedAt && <span className="m-row-sub">{when(c.startedAt)}</span>}
                  </span>
                  {c.id === chat && <PixelIcon name="check" size={16} />}
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="m-row" aria-current={chat === RUNS_CHAT ? "true" : undefined} onClick={() => void open(RUNS_CHAT)}>
                <span className="m-row-text">
                  <span className="m-row-title">Runs</span>
                  <span className="m-row-sub">Schedules, watches and hand-offs</span>
                </span>
                {chat === RUNS_CHAT && <PixelIcon name="check" size={16} />}
              </button>
            </li>
          </ul>
        </Sheet>
      )}
    </>
  );
}

function BotSays({ text, live = false }: { text: string; live?: boolean }) {
  return (
    <li className={live ? "chat-bot live" : "chat-bot"}>
      <Markdown text={text} />
    </li>
  );
}

function ChatItem({ item }: { item: Item }) {
  switch (item.kind) {
    case "you":
      return (
        <li className="chat-you">
          <div className="chat-you-bubble">
            {item.text}
            {item.attachments.length > 0 && <span className="chat-files">{item.attachments.map((a) => a.name).join(", ")}</span>}
          </div>
          <time className="chat-time">{clock(item.at)}</time>
        </li>
      );
    case "bot":
      return <BotSays text={item.text} />;
    case "note":
      return <li className="chat-note">{item.text}</li>;
    case "steps":
      return <Steps steps={item.steps} />;
    case "ask":
      return (
        <li>
          <AskCard id={item.askId} question={item.question} options={item.options} multi={item.multi} answer={item.answer} />
        </li>
      );
    case "approval":
      return (
        <li>
          <ApprovalCard id={item.approvalId} action={item.action} details={item.details} source={item.source} decision={item.decision} />
        </li>
      );
    case "end":
      return <li className="chat-note danger">{item.outcome === "stopped" ? `Stopped${item.message ? `: ${item.message}` : ""}` : item.message || "The run failed."}</li>;
    default:
      return null;
  }
}

/** Each chat as last loaded, by bot and chat, for while the computer is away. */
const lastSeen = new Map<string, Item[]>();

const SHOWN_STEPS = 3;

function Steps({ steps }: { steps: Step[] }) {
  const [all, setAll] = useState(false);
  const hidden = all ? 0 : Math.max(0, steps.length - SHOWN_STEPS);
  return (
    <li className="chat-steps">
      {hidden > 0 && (
        <button type="button" className="chat-step-more" onClick={() => setAll(true)}>
          {hidden} more step{hidden === 1 ? "" : "s"}
        </button>
      )}
      {steps.slice(hidden).map((s) => (
        <div key={s.id} className={`chat-step ${s.status}`}>
          {s.status === "running" ? <Working label="Running" /> : <PixelIcon name={s.status === "done" ? "check" : "close"} size={12} />}
          <span className="ell">{s.label}</span>
        </div>
      ))}
    </li>
  );
}

/** The message box. What was typed stays until the computer says it got it; a failure leaves it there to send again. */
function Composer({ slug, chat }: { slug: string; chat: string }) {
  const { link, toast } = useStore();
  const draftKey = `crew.draft.${slug}`;
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(draftKey) ?? "";
    } catch {
      return "";
    }
  });
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      if (text) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    } catch {
      /* the draft just isn't kept */
    }
  }, [text, draftKey]);

  // Grow with the text, up to five lines.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 136)}px`;
  }, [text]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await invoke("crew:send", slug, body, chat);
      setText("");
      haptic("ok");
      if (r.queued) toast("Queued. It runs when a slot is free.");
    } catch (e) {
      haptic("fail");
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="composer">
      <textarea
        ref={box}
        className="field composer-box"
        rows={1}
        value={text}
        placeholder={link.ready ? "Message" : "Your computer isn't reachable"}
        onChange={(e) => setText(e.target.value)}
        disabled={sending}
        aria-label="Message"
      />
      <button type="button" className="composer-send" aria-label="Send" disabled={!text.trim() || sending || !link.ready} onClick={() => void send()}>
        {sending ? <Working label="Sending" /> : <PixelIcon name="send" size={20} />}
      </button>
    </div>
  );
}
