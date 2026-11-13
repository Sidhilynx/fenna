// The comments store, shared by every app: the open document's threads,
// which one is open on screen, and asking the assistant from a comment.
//
// Every change is written to comments.json at once. A comment sent to the
// assistant starts a run with what the thread points at as its context; the
// run's reply is added to the thread, and its edits land in the document as
// any other edit does. The app says how to read and write the file, what a
// thread's anchor is, and what the assistant is told about it.

import { useSyncExternalStore } from "react";
import { type AgentEvent, type AgentKind, agent, readyAssistant, runOnce } from "../agents.ts";
import { assistantOf, parseChats } from "../chats.ts";
import { readPref, writePref } from "../prefs.ts";
import { COMMENTS_FILE, type Comment, MAX_COMMENT, type Thread, parseThreads, serializeThreads } from "./threads.ts";

export interface CommentsState<A extends object> {
  /** The document the threads belong to. */
  root: string | null;
  threads: Thread<A>[];
  /** The thread shown on screen, or a new comment being written (its anchor). */
  open: { thread: string } | { draft: A } | null;
  /** Assistant runs in progress, by thread id: what it's doing now. */
  working: Record<string, string>;
  askAssistant: boolean;
}

export interface CommentsConfig<A extends object> {
  read(rel: string): Promise<string | null>;
  write(rel: string, text: string): Promise<unknown>;
  onChanged(fn: (paths: string[]) => void): () => void;
  /** Check a stored thread's anchor fields; null drops the thread. */
  anchor(raw: Record<string, unknown>): A | null;
  /** What the assistant is told about this thread (null: it points at nothing now, don't ask). */
  context(thread: Thread<A>): unknown | null;
  /** After the assistant replied: the anchor as it should be now (it may have rewritten the text). */
  reanchor?(thread: Thread<A>): A;
  /** Told to the assistant before the comment. */
  note: string;
  toast(text: string): void;
}

export interface CommentsStore<A extends object> {
  get(): CommentsState<A>;
  use<T>(select: (s: CommentsState<A>) => T): T;
  load(root: string | null): Promise<void>;
  /** Open the comment box for a new thread on `anchor`. */
  draft(anchor: A): void;
  openThread(id: string | null): void;
  setAskAssistant(v: boolean): void;
  /** Add a comment: to the open draft (starting a thread) or to a thread. Returns the thread's id. */
  add(to: { draft: A } | { thread: string }, text: string): string | null;
  resolve(id: string): void;
  remove(id: string): void;
  /** Change threads in place (e.g. move anchors after an edit). */
  update(fn: (threads: Thread<A>[]) => Thread<A>[]): void;
}

const uid = () => crypto.randomUUID().slice(0, 12);
const NO_ASSISTANT = "No assistant is ready. Open the chat to install Claude Code, Codex or Antigravity, or to sign in.";

/** The assistant of the chat in front in the panel if it can answer, else the first that can. */
async function pickAssistant(): Promise<{ kind: AgentKind; model: string; effort: string } | null> {
  const chosen = assistantOf(parseChats(await agent.loadChat().catch(() => null)));
  const kind = await readyAssistant(chosen.kind);
  if (!kind) return null;
  return kind === chosen.kind ? { kind, model: chosen.model, effort: chosen.effort } : { kind, model: "", effort: "" };
}

export function createCommentsStore<A extends object>(cfg: CommentsConfig<A>): CommentsStore<A> {
  let state: CommentsState<A> = { root: null, threads: [], open: null, working: {}, askAssistant: readPref("commentAsk", true) };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<CommentsState<A>>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };

  let unwatch: (() => void) | null = null;
  let saving = Promise.resolve();

  function save(threads: Thread<A>[]) {
    set({ threads });
    const text = serializeThreads(threads);
    // Writes go out in order, so the file always ends up holding the latest threads.
    saving = saving.then(() => cfg.write(COMMENTS_FILE, text).then(() => undefined)).catch((e: Error) => cfg.toast(`Couldn’t save comments: ${e.message}`));
  }

  const updateOne = (id: string, fn: (t: Thread<A>) => Thread<A>) => save(state.threads.map((t) => (t.id === id ? fn(t) : t)));

  function reply(id: string, text: string, error = false) {
    updateOne(id, (t) => ({ ...t, ...(cfg.reanchor ? cfg.reanchor(t) : {}), comments: [...t.comments, { id: uid(), author: "ai", text: text.slice(0, MAX_COMMENT), at: Date.now(), ...(error ? { error: true } : {}) }] }));
  }

  function setWorking(id: string, label: string | null) {
    const working = { ...state.working };
    if (label === null) delete working[id];
    else working[id] = label;
    set({ working });
  }

  async function ask(id: string) {
    const thread = state.threads.find((t) => t.id === id);
    if (!thread || state.working[id] !== undefined) return;
    const context = cfg.context(thread);
    if (context === null) return;
    setWorking(id, "Thinking");
    const who = await pickAssistant();
    if (!who) {
      setWorking(id, null);
      return reply(id, NO_ASSISTANT, true);
    }
    const last = thread.comments[thread.comments.length - 1]!;
    const clip = (t: string, max: number) => t.replace(/\s+/g, " ").trim().slice(0, max);
    const withThread = { ...(context as object), commentThread: thread.comments.slice(-8, -1).map((c) => ({ from: c.author === "you" ? "user" : "assistant", text: clip(c.text, 400) })) };
    const sessionId = thread.session?.kind === who.kind ? thread.session.id : null;

    let text = "";
    const finish = (msg: string | null, error = false) => {
      setWorking(id, null);
      if (msg) reply(id, msg, error);
    };
    const handle = (ev: AgentEvent) => {
      if (ev.type === "session") updateOne(id, (t) => ({ ...t, session: { kind: who.kind, id: ev.sessionId } }));
      else if (ev.type === "text") text = text ? `${text}\n\n${ev.text}` : ev.text;
      else if (ev.type === "tool" && ev.status === "running") setWorking(id, ev.label ?? "Working");
      else if (ev.type === "done") {
        if (ev.sessionId) updateOne(id, (t) => ({ ...t, session: { kind: who.kind, id: ev.sessionId! } }));
        finish(text || "Done.");
      } else if (ev.type === "error") finish(ev.message, true);
      else if (ev.type === "stopped") finish(text || "Stopped.", !text);
    };
    await runOnce({ kind: who.kind, model: who.model, effort: who.effort, text: `${cfg.note}\n\n${last.text}`, context: withThread, sessionId }, handle);
  }

  return {
    get: () => state,
    use: <T>(select: (s: CommentsState<A>) => T) =>
      useSyncExternalStore(
        (l) => (listeners.add(l), () => listeners.delete(l)),
        () => select(state),
      ),
    async load(root) {
      if (root === state.root) return;
      set({ root, threads: [], open: null, working: {} });
      unwatch?.();
      unwatch = null;
      if (!root) return;
      const read = async () => {
        const text = await cfg.read(COMMENTS_FILE);
        if (state.root === root) set({ threads: parseThreads(text, cfg.anchor) });
      };
      await read();
      unwatch = cfg.onChanged((paths) => {
        if (paths.includes(COMMENTS_FILE)) void read();
      });
    },
    draft: (anchor) => set({ open: { draft: anchor } }),
    openThread: (id) => set({ open: id ? { thread: id } : null }),
    setAskAssistant(v) {
      writePref("commentAsk", v);
      set({ askAssistant: v });
    },
    add(to, text) {
      const t = text.trim().slice(0, MAX_COMMENT);
      if (!t) return null;
      const comment: Comment = { id: uid(), author: "you", text: t, at: Date.now() };
      let id: string;
      if ("draft" in to) {
        id = uid();
        save([...state.threads, { ...to.draft, id, resolved: false, comments: [comment] } as Thread<A>]);
        set({ open: { thread: id } });
      } else {
        id = to.thread;
        updateOne(id, (th) => ({ ...th, resolved: false, comments: [...th.comments, comment] }));
      }
      if (state.askAssistant) void ask(id);
      return id;
    },
    resolve(id) {
      updateOne(id, (t) => ({ ...t, resolved: true }));
      if (state.open && "thread" in state.open && state.open.thread === id) set({ open: null });
    },
    remove(id) {
      save(state.threads.filter((t) => t.id !== id));
      if (state.open && "thread" in state.open && state.open.thread === id) set({ open: null });
    },
    update(fn) {
      const next = fn(state.threads);
      if (next.length !== state.threads.length || next.some((t, i) => t !== state.threads[i])) save(next);
    },
  };
}
