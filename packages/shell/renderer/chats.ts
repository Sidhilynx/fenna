// The assistant's conversations for one open document: every chat it has
// had, which of them are open as tabs in the panel, and which one is in
// front. Saved by the main process per document folder (agent:saveChat); these functions are the only
// way the panel changes it, and parseChats reads any saved version back,
// including the single chat older versions kept.

import type { AgentKind } from "./agents.ts";

export type ChatItem =
  | { role: "user"; text: string; about?: string }
  | { role: "assistant"; text: string }
  | { role: "tool"; id: string; label: string; status: "running" | "done" | "failed" }
  | { role: "error"; text: string; fix?: "signin" | "install" };

export interface Chat {
  id: string;
  /** Who answers in this chat (null: the first assistant installed). */
  kind: AgentKind | null;
  model: string;
  effort: string;
  /** The CLI's own conversation, resumed on the next message. */
  sessionId: string | null;
  sessionKind: AgentKind | null;
  items: ChatItem[];
  /** Last activity (ms since epoch). */
  at: number;
}

export interface ChatBook {
  chats: Chat[];
  /** Chats shown as tabs, in tab order. */
  open: string[];
  active: string;
}

/** Chats kept per document; the oldest closed ones go first. */
export const MAX_CHATS = 50;
const KINDS: readonly string[] = ["antigravity", "claude", "codex"];

const isKind = (v: unknown): v is AgentKind => typeof v === "string" && KINDS.includes(v);
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

export function newChat(from?: Pick<Chat, "kind" | "model" | "effort">, now = Date.now()): Chat {
  return { id: `c${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: from?.kind ?? null, model: from?.model ?? "", effort: from?.effort ?? "", sessionId: null, sessionKind: null, items: [], at: now };
}

/** A chat's name: its first message, one line; "New chat" until there is one. */
export function chatTitle(c: Chat): string {
  const first = c.items.find((i) => i.role === "user");
  return first ? first.text.replace(/\s+/g, " ").trim() || "New chat" : "New chat";
}

function cleanItem(raw: unknown): ChatItem | null {
  const i = raw as Record<string, unknown> | null;
  if (!i || typeof i !== "object") return null;
  if (i.role === "user" && typeof i.text === "string") return { role: "user", text: i.text, ...(typeof i.about === "string" ? { about: i.about } : {}) };
  if (i.role === "assistant" && typeof i.text === "string") return { role: "assistant", text: i.text };
  if (i.role === "error" && typeof i.text === "string") return i.fix === "signin" || i.fix === "install" ? { role: "error", text: i.text, fix: i.fix } : { role: "error", text: i.text };
  // A step still "running" in a saved file was cut off when the app closed.
  if (i.role === "tool" && typeof i.id === "string" && (i.status === "done" || i.status === "failed")) return { role: "tool", id: i.id, label: str(i.label), status: i.status };
  return null;
}

function cleanChat(raw: unknown, now: number): Chat | null {
  const c = raw as Record<string, unknown> | null;
  if (!c || typeof c !== "object" || !Array.isArray(c.items)) return null;
  return {
    id: typeof c.id === "string" && c.id ? c.id.slice(0, 40) : newChat(undefined, now).id,
    kind: isKind(c.kind) ? c.kind : null,
    model: str(c.model, 80),
    effort: str(c.effort, 12),
    sessionId: typeof c.sessionId === "string" ? c.sessionId.slice(0, 80) : null,
    sessionKind: isKind(c.sessionKind) ? c.sessionKind : null,
    items: c.items.map(cleanItem).filter((i): i is ChatItem => !!i),
    at: typeof c.at === "number" && Number.isFinite(c.at) ? c.at : now,
  };
}

/** Whatever was saved (or nothing) as a book with at least one open, active chat. */
export function parseChats(raw: unknown, now = Date.now()): ChatBook {
  const r = raw as Record<string, unknown> | null;
  let chats: Chat[] = [];
  let open: string[] = [];
  let active = "";
  if (r && typeof r === "object" && Array.isArray(r.chats)) {
    chats = r.chats.map((c) => cleanChat(c, now)).filter((c): c is Chat => !!c);
    const ids = new Set(chats.map((c) => c.id));
    chats = chats.filter((c, i) => chats.findIndex((d) => d.id === c.id) === i);
    open = Array.isArray(r.open) ? [...new Set(r.open.filter((id): id is string => typeof id === "string" && ids.has(id)))] : [];
    active = typeof r.active === "string" && open.includes(r.active) ? r.active : (open[0] ?? "");
  } else {
    // The single chat earlier versions saved.
    const one = r && typeof r === "object" ? cleanChat({ ...r, id: undefined }, now) : null;
    if (one) chats = [one];
  }
  if (!open.length) {
    // The latest conversation stays in front (an older version's single chat, say).
    const chat = [...chats].sort((a, b) => b.at - a.at)[0] ?? newChat(undefined, now);
    if (!chats.includes(chat)) chats = [...chats, chat];
    open = [chat.id];
    active = chat.id;
  }
  return { chats, open, active };
}

export function activeChat(book: ChatBook): Chat {
  return book.chats.find((c) => c.id === book.active) ?? book.chats[0]!;
}

export function updateChat(book: ChatBook, id: string, fn: (c: Chat) => Chat): ChatBook {
  return { ...book, chats: book.chats.map((c) => (c.id === id ? fn(c) : c)) };
}

/** A new chat as a tab after the active one, in front; it keeps the active chat's assistant, model and effort. */
export function addChat(book: ChatBook, now = Date.now()): ChatBook {
  const chat = newChat(activeChat(book), now);
  const at = book.open.indexOf(book.active) + 1;
  const open = [...book.open.slice(0, at), chat.id, ...book.open.slice(at)];
  const closed = book.chats.filter((c) => !open.includes(c.id)).sort((a, b) => a.at - b.at);
  const drop = new Set(closed.slice(0, Math.max(0, book.chats.length + 1 - MAX_CHATS)).map((c) => c.id));
  return { chats: [...book.chats.filter((c) => !drop.has(c.id)), chat], open, active: chat.id };
}

/** Bring a chat (open or from history) to the front. */
export function showChat(book: ChatBook, id: string): ChatBook {
  if (!book.chats.some((c) => c.id === id)) return book;
  const open = book.open.includes(id) ? book.open : [...book.open, id];
  return { ...book, open, active: id };
}

/** Close a chat's tab (it stays in history). The last tab closed leaves a new, empty chat. */
export function closeChat(book: ChatBook, id: string, now = Date.now()): ChatBook {
  const at = book.open.indexOf(id);
  if (at < 0) return book;
  const open = book.open.filter((x) => x !== id);
  // An empty chat closed is simply gone: there is nothing to look back at.
  const closing = book.chats.find((c) => c.id === id);
  const chats = closing && !closing.items.length ? book.chats.filter((c) => c.id !== id) : book.chats;
  if (!open.length) {
    const chat = newChat(closing, now);
    return { chats: [...chats, chat], open: [chat.id], active: chat.id };
  }
  const active = book.active === id ? open[Math.min(at, open.length - 1)]! : book.active;
  return { chats, open, active };
}

export function reorderChats(book: ChatBook, ids: string[]): ChatBook {
  const same = ids.length === book.open.length && ids.every((id) => book.open.includes(id));
  return same ? { ...book, open: ids } : book;
}

/** Who a comment thread asks: the assistant, model and effort of the chat in front. */
export function assistantOf(book: ChatBook): { kind: AgentKind | null; model: string; effort: string } {
  const c = activeChat(book);
  return { kind: c.kind, model: c.model, effort: c.effort };
}
