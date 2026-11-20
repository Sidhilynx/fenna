// The chat with one bot, narrow, beside the bot's computer, so the person can
// keep talking while watching it work. It is the same conversation as the chat
// page: the same run log, the same composer, the same sends.

import { invoke } from "../shared/api.ts";
import { BrainNotice, Composer, Messages, usePending } from "./Chat.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { botOf, useBotDetail, useCrew, waitingFor } from "./crew.tsx";
import { useRuns } from "./transcript.ts";

export function ChatDock({ slug, onClose }: { slug: string; onClose(): void }) {
  const { overview } = useCrew();
  const bot = botOf(overview, slug);
  const runState = useRuns(slug);
  const { detail } = useBotDetail(bot);
  const { pending, send } = usePending(slug, runState.runs);

  if (!bot) return null;

  return (
    <aside className="chat-dock" aria-label="Chat">
      <header className="chat-dock-head">
        <h2 className="chat-dock-title">Chat</h2>
        <button type="button" className="icon-btn" aria-label="Close chat" title="Close chat" onClick={onClose}>
          <PixelIcon name="close" size={12} />
        </button>
      </header>
      <Messages bot={bot} waiting={waitingFor(overview, slug)} pending={pending} runState={runState} library={detail?.library} compact />
      <BrainNotice bot={bot} />
      <Composer name={bot.name} running={bot.running || bot.queued} onSend={send} attachable onStop={() => void invoke("crew:stop", slug).catch(() => undefined)} />
    </aside>
  );
}
