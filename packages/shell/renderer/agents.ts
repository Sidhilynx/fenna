/// <reference path="./assets.d.ts" />
// The assistants the shell can run (the user's own Claude Code, Codex or
// Antigravity) as the page knows them: names, the makers' marks, and the
// typed calls to the main process's assistant host (../main/agent.cjs).

import antigravityLogo from "./assets/agents/antigravity.svg";
import chatgptLogo from "./assets/agents/chatgpt.png";
import claudeLogo from "./assets/agents/claude.png";
import codexLogo from "./assets/agents/codex.png";
import geminiLogo from "./assets/agents/gemini.png";
import { bridge } from "./bridge.ts";

export type AgentKind = "claude" | "codex" | "antigravity";
export const AGENT_KINDS: readonly AgentKind[] = ["claude", "codex", "antigravity"];

/** Each CLI as the user knows it. `invert`: a white mark, inverted on the light theme. */
export const AGENTS: Record<AgentKind, { name: string; logo: string; invert: boolean; plan: string; signInWith: string; maker: string }> = {
  claude: { name: "Claude Code", logo: claudeLogo, invert: true, plan: "Claude Pro or Max plan", signInWith: "your Claude account", maker: "Anthropic" },
  codex: { name: "Codex", logo: codexLogo, invert: true, plan: "ChatGPT plan", signInWith: "your ChatGPT account", maker: "OpenAI" },
  antigravity: { name: "Antigravity", logo: antigravityLogo, invert: false, plan: "Google account", signInWith: "your Google account", maker: "Google" },
};

/** The maker's mark for a model's name (Antigravity offers several makers), else the assistant's own. */
export function modelLogo(kind: AgentKind, label: string): { src: string; invert: boolean } {
  const l = label.toLowerCase();
  if (/claude|opus|sonnet|haiku|fable/.test(l)) return { src: claudeLogo, invert: true };
  if (/gpt|openai/.test(l)) return { src: chatgptLogo, invert: true };
  if (/gemini/.test(l)) return { src: geminiLogo, invert: true };
  return { src: AGENTS[kind].logo, invert: AGENTS[kind].invert };
}

const EFFORT_LABELS: Record<string, string> = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra" };
export const effortLabel = (e: string) => EFFORT_LABELS[e] ?? e.charAt(0).toUpperCase() + e.slice(1);

/** A model a CLI offers, with the efforts it takes (from the CLI itself). */
export interface AgentModel {
  value: string;
  label: string;
  description: string;
  efforts: string[];
  defaultEffort: string | null;
}

/** Everything known about one CLI on this computer. */
export interface AgentCatalog {
  kind: AgentKind;
  name: string;
  installed: boolean;
  /** The app's own copy (installed from the chat), not one already on the computer. */
  own: boolean;
  version: string | null;
  /** null: couldn't tell. */
  signedIn: boolean | null;
  /** Signed in with an API key, which bills per use instead of the plan. */
  apiKey: boolean;
  account: { email: string | null; plan: string | null } | null;
  models: AgentModel[];
  /** Claude Code: this computer's account, or one of the app's own. */
  accountMode: "computer" | "own";
  installing: boolean;
}

export type AgentEvent = { runId: string } & (
  | { type: "session"; sessionId: string }
  | { type: "delta"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; label?: string; status: "running" | "done" | "failed" }
  | { type: "done"; sessionId: string | null }
  | { type: "error"; message: string; fix: "signin" | "install" | null }
  | { type: "stopped" }
);

export type SetupEvent =
  | { type: "install"; kind: AgentKind; line: string }
  | { type: "signin"; kind: AgentKind; state: "waiting" | "done" | "failed"; url?: string | null; needsCode?: boolean; catalog?: AgentCatalog };

const call = <T>(channel: string, ...args: unknown[]) => bridge().invoke<T>(channel, ...args);

export const agent = {
  catalog: (kind: AgentKind, fresh = false) => call<AgentCatalog>("agent:catalog", kind, fresh),
  install: (kind: AgentKind) => call<AgentCatalog>("agent:install", kind),
  signIn: (kind: AgentKind) => call<boolean>("agent:signIn", kind),
  signInCode: (kind: AgentKind, code: string) => call<boolean>("agent:signInCode", kind, code),
  signInCancel: (kind: AgentKind) => call<boolean>("agent:signInCancel", kind),
  signOut: (kind: AgentKind) => call<AgentCatalog>("agent:signOut", kind),
  setAccountMode: (kind: AgentKind, mode: "computer" | "own") => call<AgentCatalog>("agent:setAccountMode", kind, mode),
  openUrl: (url: string) => call<void>("agent:openUrl", url),
  send: (msg: { kind: AgentKind; model: string; effort: string; text: string; context: unknown; sessionId: string | null }) => call<string>("agent:send", msg),
  stop: (runId: string) => call<void>("agent:stop", runId),
  loadChat: () => call<unknown>("agent:loadChat"),
  saveChat: (book: unknown) => call<boolean>("agent:saveChat", book),
  onEvent: (fn: (ev: AgentEvent) => void) => bridge().on<AgentEvent>("agent:event", fn),
  onSetup: (fn: (ev: SetupEvent) => void) => bridge().on<SetupEvent>("agent:setup", fn),
};

/** Can this CLI answer now? */
export const isReady = (c: AgentCatalog | null | undefined): boolean => !!c && c.installed && c.signedIn !== false && !c.apiKey;

/** `preferred` if it can answer now, else the first that can; null when none can. */
export async function readyAssistant(preferred: AgentKind | null): Promise<AgentKind | null> {
  const order = preferred ? [preferred, ...AGENT_KINDS.filter((k) => k !== preferred)] : AGENT_KINDS;
  for (const k of order) if (isReady(await agent.catalog(k).catch(() => null))) return k;
  return null;
}

/**
 * Run one message to the end, outside the chat panel (a comment thread, say):
 * `on` sees every event of this run, and the promise settles when it ends.
 * Events that arrive before the run id is known are held, not lost.
 */
export function runOnce(msg: Parameters<typeof agent.send>[0], on: (ev: AgentEvent) => void): Promise<void> {
  return new Promise((resolve) => {
    let runId: string | null = null;
    const early: AgentEvent[] = [];
    const handle = (ev: AgentEvent) => {
      on(ev);
      if (ev.type === "done" || ev.type === "error" || ev.type === "stopped") {
        off();
        resolve();
      }
    };
    const off = agent.onEvent((ev) => {
      if (runId === null) early.push(ev);
      else if (ev.runId === runId) handle(ev);
    });
    agent.send(msg).then(
      (id) => {
        runId = id;
        for (const ev of early.splice(0)) if (ev.runId === id) handle(ev);
      },
      (e: Error) => handle({ runId: "", type: "error", message: e.message, fix: null }),
    );
  });
}
