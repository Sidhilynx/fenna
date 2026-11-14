// "Ask": a request to the AI about what's selected (or the page), without
// opening the chat. Its edits land on the canvas as they happen; its reply
// shows here. Follow-ups stay in one conversation until the box closes.

import { useEffect, useRef, useState } from "react";
import { getAt } from "@opendeck/format";
import { layerLabel, serializeBlock, type ElementNode } from "@opendeck/artboard";
import { type AgentEvent, Icon, agent, runOnce, shortcut } from "@opendeck/shell";
import { refreshAssistant, useAssistant } from "../assistant.ts";
import { getState, pageBoards, setAgent, setPanel, setState, useDesign } from "../store.ts";

type Status = { kind: "idle" } | { kind: "working"; label: string; runId: string | null } | { kind: "done"; text: string; error: boolean };

const NOTE =
  'This is a quick request from the Ask box on the user\'s design canvas, not the chat. The context names the design, the page they are on and what they selected; "this" and "these" mean that selection. Make the change with the Fenna Design tools (read_artboards first), then reply in one short sentence saying what you changed.';

/** What the selection is, in a few words: "Main · Heading “Hello from a canvas”". */
export function selectionLabel(): string {
  const s = getState();
  const sel = s.selection;
  if (sel?.kind === "boards") return sel.files.length === 1 ? (s.index.boards[sel.files[0]!]?.title ?? "") : `${sel.files.length} artboards`;
  if (sel?.kind === "layers") {
    const root = s.boards.get(sel.file)?.doc?.root;
    const el = root && sel.addresses.length === 1 ? (getAt(root, sel.addresses[0]!) as ElementNode | null) : null;
    return `${s.index.boards[sel.file]?.title ?? ""} · ${el ? layerLabel(el) : `${sel.addresses.length} layers`}`;
  }
  return "";
}

/** What the AI is told the user is looking at: the design, the page, its artboards, and the selection (layers as their HTML). */
export function designView(withSelection: boolean) {
  const s = getState();
  if (!s.ready) return null;
  const base = {
    design: s.index.title,
    page: s.index.pages.find((p) => p.id === s.page)?.name ?? s.page,
    artboards: pageBoards(s).map((f) => ({ file: f, title: s.index.boards[f]!.title, size: `${s.index.boards[f]!.w}×${s.index.boards[f]!.h}` })),
  };
  const sel = withSelection ? s.selection : null;
  if (sel?.kind === "boards") return { ...base, selectedArtboards: sel.files };
  if (sel?.kind === "layers") {
    const root = s.boards.get(sel.file)?.doc?.root;
    const layers = root ? sel.addresses.slice(0, 20).map((a) => getAt(root, a) as ElementNode | null).filter((el): el is ElementNode => !!el).map((el) => ({ layer: layerLabel(el), html: serializeBlock(el).slice(0, 1500) })) : [];
    return { ...base, selected: { file: sel.file, layers } };
  }
  return base;
}

export function AskBar() {
  const ai = useAssistant();
  const title = useDesign((s) => s.index.title);
  const what = useDesign(() => selectionLabel());
  const request = useDesign((s) => s.askRequest);
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
    await runOnce({ kind: chosen.kind, model: chosen.model, effort: chosen.effort, text: `${NOTE}\n\n${t}`, context: designView(about), sessionId: session.current }, on);
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
            <span className="ask-chip-what">{what || "This page"}</span>
            {what && (
              <button className="ask-chip-x" title="Ask about the whole page instead" aria-label="Leave the selection out of the request" onClick={() => setAbout(false)}>
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
          placeholder={status.kind === "working" ? `${status.label}…` : "Describe a change"}
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
