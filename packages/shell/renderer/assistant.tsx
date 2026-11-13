// Which AI the user has connected, as an app's page shows it: "Ask Claude"
// on a button, "@Claude" in a hint, its maker's mark beside a line. It is the
// chat's assistant when that one can answer, else the first that can; with
// none connected, plain "AI" and the app's own icon.

import { useSyncExternalStore } from "react";
import { AGENTS, AGENT_KINDS, type AgentKind, agent, isReady, readyAssistant } from "./agents.ts";
import { assistantOf, parseChats } from "./chats.ts";

export interface Assistant {
  /** null: nothing is connected yet. */
  kind: AgentKind | null;
  /** What the user calls it: "Claude", "Codex", "Antigravity", or "AI". */
  name: string;
  logo: { src: string; invert: boolean };
  /** The model and effort chosen in the chat, for that assistant. */
  model: string;
  effort: string;
}

const SHORT: Record<AgentKind, string> = { claude: "Claude", codex: "Codex", antigravity: "Antigravity" };

export interface AssistantSource {
  useAssistant(): Assistant;
  getAssistant(): Assistant;
  /** Look again (the chat may have switched assistant, or one was installed or signed in). */
  refreshAssistant(): Promise<Assistant>;
  /** The connected AI's mark (or the app's icon), sized for a line or a menu row. */
  AssistantMark(props: { size?: number }): React.JSX.Element;
}

/** One per app: `key` remembers the last answer between launches, `icon` stands in when none is connected. */
export function createAssistant({ key, icon }: { key: string; icon: string }): AssistantSource {
  const none: Assistant = { kind: null, name: "AI", logo: { src: icon, invert: false }, model: "", effort: "" };
  const of = (kind: AgentKind | null, model = "", effort = ""): Assistant =>
    kind ? { kind, name: SHORT[kind], logo: { src: AGENTS[kind].logo, invert: AGENTS[kind].invert }, model, effort } : none;

  // Finding which AI can answer takes a few seconds; until then, the one found last time.
  const remembered = (() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  })();
  let current = AGENT_KINDS.find((k) => k === remembered) ? of(remembered as AgentKind) : none;
  const listeners = new Set<() => void>();
  let checking: Promise<Assistant> | null = null;

  const refreshAssistant = (): Promise<Assistant> => {
    checking ??= (async () => {
      try {
        const chosen = assistantOf(parseChats(await agent.loadChat().catch(() => null)));
        const chosenReady = chosen.kind && isReady(await agent.catalog(chosen.kind).catch(() => null));
        const next = chosenReady ? of(chosen.kind, chosen.model, chosen.effort) : of(await readyAssistant(null));
        if (next.kind !== current.kind || next.model !== current.model || next.effort !== current.effort) {
          current = next;
          try {
            localStorage.setItem(key, next.kind ?? "");
          } catch {
            // Private storage off: it is found again next time.
          }
          for (const l of listeners) l();
        }
        return current;
      } finally {
        checking = null;
      }
    })();
    return checking;
  };

  let watching = false;
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    if (!watching) {
      watching = true;
      void refreshAssistant();
      window.addEventListener("focus", () => void refreshAssistant());
    }
    return () => listeners.delete(fn);
  };

  const useAssistant = () => useSyncExternalStore(subscribe, () => current);

  function AssistantMark({ size = 16 }: { size?: number }) {
    const a = useAssistant();
    return <img src={a.logo.src} alt="" width={size} height={size} className={`as-logo${a.logo.invert ? " invert" : ""}${a.kind ? "" : " app"}`} draggable={false} />;
  }

  return { useAssistant, getAssistant: () => current, refreshAssistant, AssistantMark };
}
