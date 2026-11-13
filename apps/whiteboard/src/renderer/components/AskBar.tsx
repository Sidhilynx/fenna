// "Ask": a request to the AI about what's selected (or the board), without
// opening the chat. Its edits land on the board as they happen; its reply
// shows here. Follow-ups stay in one conversation until the box closes.

import { useEffect, useRef, useState } from "react";
import { KIND_LABELS, type BoardItem } from "@opendeck/board";
import { type AgentEvent, Icon, agent, runOnce, shortcut } from "@opendeck/shell";
import { refreshAssistant, useAssistant } from "../assistant.ts";
import { getState, selectedItems, setAgent, setPanel, setState, useBoard, viewCenter } from "../store.ts";

type Status = { kind: "idle" } | { kind: "working"; label: string; runId: string | null } | { kind: "done"; text: string; error: boolean };

const NOTE =
  'This is a quick request from the Ask box on the user\'s whiteboard, not the chat. The context names the board and the items they selected; "this" and "these" mean those items. Make the change with the Fenna Whiteboard tools (read_board first if you need more than the context gives), then reply in one short sentence saying what you changed.';

/** What an item says, in a few words. */
function gist(it: BoardItem): string {
  const t = it.kind === "frame" ? it.title : it.kind === "connector" ? (it.label ?? "") : it.kind === "table" ? it.cells.map((r) => r.join(" | ")).join(" / ") : "text" in it ? (it.text ?? "") : "";
  return t.length > 160 ? `${t.slice(0, 159)}…` : t;
}

/** What the AI is told the user is looking at: the board, the selection (up to 40 items), and the middle of the screen. */
export function boardContext(withSelection: boolean) {
  const s = getState();
  if (!s.meta) return null;
  const c = viewCenter();
  const base = { board: s.meta.title, items: s.items.length, screenCenter: { x: Math.round(c.x), y: Math.round(c.y) } };
  const sel = withSelection ? selectedItems().slice(0, 40) : [];
  if (!sel.length) return base;
  return { ...base, selection: sel.map((it) => ({ id: it.id, kind: it.kind, ...(gist(it) ? { text: gist(it) } : {}) })) };
}

export function AskBar() {
  const ai = useAssistant();
  const title = useBoard((s) => s.meta?.title ?? "");
  const count = useBoard((s) => s.selection.length);
  const first = useBoard((s) => (s.selection[0] ? s.byId.get(s.selection[0]) : undefined));
  const request = useBoard((s) => s.askRequest);
  const [text, setText] = useState("");
  const [about, setAbout] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const session = useRef<string | null>(null);
  const taken = useRef(0);

  const close = () => setState({ asking: false, askRequest: null });

  const send = async (words: string) => {
    const t = words.trim();
    if (!t || status.kind === "working") return;
    setStatus({ kind: "working", label: "Thinking", runId: null });
    const chosen = await refreshAssistant();
    if (!chosen.kind) return setStatus({ kind: "done", text: "No AI is connected. Open the chat to install Claude Code, Codex or Antigravity, or to sign in.", error: true });
    setAgent({ name: chosen.kind });
    let reply = "";
    const on = (ev: AgentEvent) => {
      if (ev.type === "session") session.current = ev.sessionId;
      else if (ev.type === "text") reply = reply ? `${reply}\n\n${ev.text}` : ev.text;
      else if (ev.type === "tool" && ev.status === "running") setStatus({ kind: "working", label: ev.label ?? "Working", runId: ev.runId });
      else if (ev.type === "done") setStatus({ kind: "done", text: reply || "Done.", error: false });
      else if (ev.type === "error") setStatus({ kind: "done", text: ev.message, error: true });
      else if (ev.type === "stopped") setStatus({ kind: "done", text: reply || "Stopped.", error: !reply });
      if (ev.type !== "text" && ev.type !== "delta") setStatus((st) => (st.kind === "working" && !st.runId ? { ...st, runId: ev.runId } : st));
    };
    setText("");
    await runOnce({ kind: chosen.kind, model: chosen.model, effort: chosen.effort, text: `${NOTE}\n\n${t}`, context: boardContext(about), sessionId: session.current }, on);
    setAgent(null);
    input.current?.focus();
  };

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (!request || request.n === taken.current) return;
    taken.current = request.n;
    void send(request.text);
  });

  const stop = () => {
    if (status.kind === "working" && status.runId) void agent.stop(status.runId);
  };

  const what = count === 0 ? "Whole board" : count === 1 && first ? `${KIND_LABELS[first.kind]}${gist(first) ? ` · ${gist(first).split("\n")[0]}` : ""}` : `${count} items`;

  return (
    <div
      className="ask"
      role="dialog"
      aria-label={`Ask ${ai.name}`}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        if (status.kind === "working") stop();
        else close();
      }}
    >
      {about && (
        <div className="ask-chips">
          <span className="ask-chip">
            <Icon name="frame" size={14} />
            <span className="ask-chip-title">{title}</span>
            <span className="ask-chip-what">{what}</span>
            {count > 0 && (
              <button className="ask-chip-x" title="Ask about the whole board instead" aria-label="Leave the selection out of the request" onClick={() => setAbout(false)}>
                <Icon name="close" size={12} />
              </button>
            )}
          </span>
        </div>
      )}
      {status.kind !== "idle" && (
        <div className={`ask-status${status.kind === "done" && status.error ? " error" : ""}`} role="status">
          <span className="ask-reply">{status.kind === "working" ? `${status.label}…` : status.text}</span>
          {status.kind === "done" && (
            <button className="btn ghost ask-chat" onClick={() => setPanel("chat")}>
              Open chat
            </button>
          )}
        </div>
      )}
      <form
        className="ask-row"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          ref={input}
          value={text}
          placeholder={status.kind === "working" ? `${status.label}…` : count ? "Describe a change to the selection" : "Describe what to add or change"}
          aria-label="Describe a change"
          maxLength={4000}
          readOnly={status.kind === "working"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {status.kind === "working" ? (
          <button type="button" className="ask-send" onClick={stop} title="Stop (Esc)" aria-label="Stop">
            <Icon name="stop" size={16} />
          </button>
        ) : (
          <button type="submit" className="ask-send" disabled={!text.trim()} title={`Send (Enter) · close ${shortcut("Mod+K")}`} aria-label="Send">
            <Icon name="send" size={16} />
          </button>
        )}
      </form>
    </div>
  );
}
