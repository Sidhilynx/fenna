// The "Delete bot" confirmation, opened from the bot panel and from a bot's menu in the sidebar.

import { Dialog, toast } from "@opendeck/shell";
import { errorText, invoke } from "../shared/api.ts";
import type { BotSummary } from "../shared/contract.ts";
import { useCrew } from "./crew.tsx";

export function DeleteBotDialog({ bot, onClose }: { bot: BotSummary; onClose(): void }) {
  const { go } = useCrew();
  return (
    <Dialog title={`Delete ${bot.name}?`} onClose={onClose} width={420}>
      <p className="dialog-text">Its folder, files and runs go to the trash. You can restore them from there. Its browser sign-ins are forgotten.</p>
      <div className="form-acts">
        <button type="button" className="btn" onClick={onClose} data-autofocus>
          Keep it
        </button>
        <button
          type="button"
          className="btn primary danger-fill"
          onClick={() => {
            onClose();
            void invoke("crew:delete", bot.slug).then(() => go({ name: "crew" }), (e) => toast(errorText(e)));
          }}
        >
          Delete {bot.name}
        </button>
      </div>
    </Dialog>
  );
}
