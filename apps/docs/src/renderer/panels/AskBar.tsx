// "Describe a change": one request to the assistant about what's on screen
// (the selection, or the tab), without opening the chat. Its edits land on
// the page as they happen; its reply shows here in a line or two.

import { useEffect, useRef, useState } from "react";
import { type AgentEvent, Icon, agent, assistantOf, parseChats, readyAssistant, runOnce } from "@opendeck/shell";
import { restoreSelection } from "../editor/page.ts";
import { getState, setAgent, togglePanel } from "../store.ts";

type Status = { kind: "idle" } | { kind: "working"; label: string; runId: string | null } | { kind: "done"; text: string; error: boolean };

const NOTE = "This is a quick request from the box under the user's page, not the chat. Make the change with edit_blocks (to the selected blocks when there is a selection), then reply in one short sentence saying what you changed.";

/** What the assistant is told the user is looking at. */
export function pageContext() {
  const s = getState();
  return {
    tab: s.tab ? { id: s.tab } : null,
    selection: s.selection.blocks.length ? { blocks: s.selection.blocks, text: s.selection.text } : null,
  };
}

export function AskBar({ onClose }: { onClose(): void }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);

  const send = async () => {
    const t = text.trim();
    if (!t || status.kind === "working") return;
    setStatus({ kind: "working", label: "Thinking", runId: null });
    const chosen = assistantOf(parseChats(await agent.loadChat().catch(() => null)));
    const kind = await readyAssistant(chosen.kind);
    if (!kind) return setStatus({ kind: "done", text: "No assistant is ready. Open the chat to install one or sign in.", error: true });
    const same = kind === chosen.kind;
    setAgent({ name: kind });
    let reply = "";
    const on = (ev: AgentEvent) => {
      if (ev.type === "text") reply = reply ? `${reply}\n\n${ev.text}` : ev.text;
      else if (ev.type === "tool" && ev.status === "running") setStatus({ kind: "working", label: ev.label ?? "Working", runId: ev.runId });
      else if (ev.type === "done") setStatus({ kind: "done", text: reply || "Done.", error: false });
      else if (ev.type === "error") setStatus({ kind: "done", text: ev.message, error: true });
      else if (ev.type === "stopped") setStatus({ kind: "done", text: reply || "Stopped.", error: !reply });
      if (ev.type !== "text" && ev.type !== "delta") setStatus((st) => (st.kind === "working" && !st.runId ? { ...st, runId: ev.runId } : st));
    };
    setText("");
    await runOnce({ kind, model: same ? chosen.model : "", effort: same ? chosen.effort : "", text: `${NOTE}\n\n${t}`, context: pageContext(), sessionId: null }, on);
    setAgent(null);
  };

  const stop = () => status.kind === "working" && status.runId && void agent.stop(status.runId);

  return (
    <div className="ask" role="dialog" aria-label="Ask the assistant">
      {status.kind !== "idle" && (
        <div className={`ask-status${status.kind === "done" && status.error ? " error" : ""}`} role="status">
          {status.kind === "working" ? <span className="ask-working">{status.label}…</span> : <span className="ask-reply">{status.text}</span>}
          {status.kind === "done" && (
            <button className="btn ghost ask-chat" onClick={() => togglePanel("chat", true)}>
              Open chat
            </button>
          )}
        </div>
      )}
      <form
        className="ask-box"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          ref={input}
          id="ask-input"
          value={text}
          placeholder={getState().selection.text ? "Describe a change to the selection" : "Describe a change"}
          aria-label="Describe a change"
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              restoreSelection();
              onClose();
            }
          }}
        />
        {status.kind === "working" ? (
          <button type="button" className="ask-send" onClick={stop} title="Stop" aria-label="Stop">
            <Icon name="stop" size={16} />
          </button>
        ) : (
          <button type="submit" className="ask-send" disabled={!text.trim()} title="Send (Enter)" aria-label="Send">
            <Icon name="arrowUp" size={16} />
          </button>
        )}
      </form>
    </div>
  );
}
