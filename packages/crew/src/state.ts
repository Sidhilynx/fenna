// state.json: what the app remembers about a bot between runs. Written by
// the app, never by hand, so reading is forgiving: a broken or partial file
// gives the defaults for what can't be read, and says so.
//
// A bot has chats. The person talks in one of theirs at a time (`current`)
// and can start a new one; each chat keeps its own CLI conversations. Runs
// nobody typed (schedule, watches, hand-offs, group chats) go to the one
// "runs" chat, so they never fill the person's context.

import { CLI_KINDS, LIMITS, MOODS, type CliKind, type Diagnostic, type Mood } from "./schema.ts";

/** How full a chat's context was after its last run: tokens used, and the model's window when the CLI says it. */
export interface ChatUsage {
  used: number;
  window: number | null;
  at: string;
}

export interface Chat {
  /** RUNS_CHAT, MAIN_CHAT, or a newChatId(). */
  id: string;
  /** The first words the person wrote in it; "" until then. */
  title: string;
  startedAt: string | null;
  /** The conversation each CLI keeps for this chat, resumed on its next run. */
  sessions: Partial<Record<CliKind, string>>;
  usage: ChatUsage | null;
  /** What the chat said before it was compacted; given to the next fresh conversation, then kept until the next compact. */
  summary: string;
}

export interface BotState {
  chats: Chat[];
  /** The person's chat that new messages go to. Never RUNS_CHAT. */
  current: string;
  /** The mood the bot last set for itself (set_status). */
  mood: Mood;
  /** The bot's own one-line status. */
  status: string;
  /** ISO times. */
  lastRunAt: string | null;
  /** The scheduled time the scheduler last woke the bot for. */
  lastScheduledAt: string | null;
}

export const SESSION_RE = /^[\w-]{1,80}$/;
export const CHAT_ID_RE = /^[a-z0-9-]{1,40}$/;
/** The chat runs nobody typed go to. */
export const RUNS_CHAT = "runs";
/** The person's first chat, and where runs from before chats existed belong. */
export const MAIN_CHAT = "main";
export const MAX_CHATS = 200;
export const MAX_SUMMARY = 20_000;

export function emptyChat(id: string, startedAt: string | null = null): Chat {
  return { id, title: "", startedAt, sessions: {}, usage: null, summary: "" };
}

export function emptyState(): BotState {
  return { chats: [emptyChat(RUNS_CHAT), emptyChat(MAIN_CHAT)], current: MAIN_CHAT, mood: "idle", status: "", lastRunAt: null, lastScheduledAt: null };
}

/** A new chat's id from its start time: "c-<base36 ms>", unique enough per bot, sortable. */
export function newChatId(now: Date, taken: readonly string[] = []): string {
  let ms = now.getTime();
  while (taken.includes(`c-${ms.toString(36)}`)) ms++;
  return `c-${ms.toString(36)}`;
}

/** The chat a run belongs to: its own `chat`, or for older run logs, the person's first chat for what they typed and the runs chat for the rest. */
export function chatOfRun(start: { trigger: string; team: string | null; chat?: string }): string {
  if (start.chat && CHAT_ID_RE.test(start.chat)) return start.chat;
  return (start.trigger === "person" && !start.team) || start.trigger === "welcome" ? MAIN_CHAT : RUNS_CHAT;
}

/** The chat with this id, created (and kept in state) when missing. */
export function chatIn(state: BotState, id: string): Chat {
  let c = state.chats.find((x) => x.id === id);
  if (!c) {
    c = emptyChat(id);
    state.chats.push(c);
  }
  return c;
}

const isoOrNull = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

function readSessions(v: unknown): Partial<Record<CliKind, string>> {
  const out: Partial<Record<CliKind, string>> = {};
  if (!v || typeof v !== "object") return out;
  for (const k of CLI_KINDS) {
    const s = (v as Record<string, unknown>)[k];
    if (typeof s === "string" && SESSION_RE.test(s)) out[k] = s;
  }
  return out;
}

function readUsage(v: unknown): ChatUsage | null {
  if (!v || typeof v !== "object") return null;
  const u = v as Record<string, unknown>;
  const used = Number(u.used);
  const window = u.window === null || u.window === undefined ? null : Number(u.window);
  const at = isoOrNull(u.at);
  if (!Number.isFinite(used) || used < 0 || !at) return null;
  return { used: Math.round(used), window: window !== null && Number.isFinite(window) && window > 0 ? Math.round(window) : null, at };
}

function readChat(v: unknown): Chat | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  if (typeof c.id !== "string" || !CHAT_ID_RE.test(c.id)) return null;
  return {
    id: c.id,
    title: typeof c.title === "string" ? c.title.slice(0, 80) : "",
    startedAt: isoOrNull(c.startedAt),
    sessions: readSessions(c.sessions),
    usage: readUsage(c.usage),
    summary: typeof c.summary === "string" ? c.summary.slice(0, MAX_SUMMARY) : "",
  };
}

export function parseState(src: string | null): { state: BotState; diagnostics: Diagnostic[] } {
  const state = emptyState();
  if (src === null || !src.trim()) return { state, diagnostics: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(src);
  } catch (e) {
    return { state, diagnostics: [{ severity: "warning", message: `state.json could not be read (${(e as Error).message}); starting fresh. Past conversations are not resumed.` }] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { state, diagnostics: [{ severity: "warning", message: "state.json is not an object; starting fresh." }] };
  const r = raw as Record<string, unknown>;
  const d: Diagnostic[] = [];
  if (Array.isArray(r.chats)) {
    const seen = new Set<string>();
    const chats = r.chats.map(readChat).filter((c): c is Chat => !!c && !seen.has(c.id) && !!seen.add(c.id));
    // Keep the runs chat, the main chat and the newest of the rest.
    const fixed = chats.filter((c) => c.id === RUNS_CHAT || c.id === MAIN_CHAT);
    const rest = chats.filter((c) => c.id !== RUNS_CHAT && c.id !== MAIN_CHAT).slice(-(MAX_CHATS - 2));
    state.chats = [...fixed, ...rest];
    if (!state.chats.some((c) => c.id === RUNS_CHAT)) state.chats.unshift(emptyChat(RUNS_CHAT));
    if (!state.chats.some((c) => c.id !== RUNS_CHAT)) state.chats.push(emptyChat(MAIN_CHAT));
  } else {
    // Before chats: one conversation per CLI, which becomes the person's first chat.
    chatIn(state, MAIN_CHAT).sessions = readSessions(r.sessions);
  }
  const current = typeof r.current === "string" ? r.current : MAIN_CHAT;
  state.current = state.chats.some((c) => c.id === current && c.id !== RUNS_CHAT) ? current : state.chats.filter((c) => c.id !== RUNS_CHAT).at(-1)!.id;
  if (typeof r.mood === "string" && (MOODS as readonly string[]).includes(r.mood)) state.mood = r.mood as Mood;
  else if (r.mood !== undefined) d.push({ severity: "warning", message: `state.json mood "${String(r.mood)}" is not one of ${MOODS.join(", ")}; using idle.` });
  if (typeof r.status === "string") state.status = r.status.slice(0, LIMITS.status);
  state.lastRunAt = isoOrNull(r.lastRunAt);
  state.lastScheduledAt = isoOrNull(r.lastScheduledAt);
  return { state, diagnostics: d };
}

export function serializeState(state: BotState): string {
  return JSON.stringify(state, null, 2) + "\n";
}
