// The AI box on the page: "@Claude  Tell Claude what to write or edit",
// opened at a line by typing "@" and choosing the AI, by the AI mark beside
// a line, or by the empty page's hint. On an empty line it takes that line's
// place; under a line with words it sits just below them, about that line.
// The lines after it move down to make room; its edits land on the page as
// they happen, and its reply shows in the box. Follow-ups stay in one
// conversation until the box closes.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type AgentEvent, Icon, agent, runOnce } from "@opendeck/shell";
import { blockText } from "../editor/caret.ts";
import { onLayout, pageEl } from "../editor/page.ts";
import { getState, setAgent, setState, togglePanel, useDocs } from "../store.ts";
import { refreshAssistant, useAssistant } from "./assistant.tsx";

type Status = { kind: "idle" } | { kind: "working"; label: string; runId: string | null } | { kind: "done"; text: string; error: boolean };

const GAP = 8;

/** Close the box, putting the caret back on its line. */
export function closeInlineAsk() {
  const at = getState().inlineAsk;
  if (!at) return;
  setState({ inlineAsk: null });
  const page = pageEl();
  const block = page?.querySelector<HTMLElement>(`:scope > [id="${CSS.escape(at.block)}"]`);
  if (!page || !block) return;
  page.focus({ preventScroll: true });
  const r = document.createRange();
  r.selectNodeContents(block);
  r.collapse(false);
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

export function openInlineAsk(block: string) {
  setState({ inlineAsk: { block }, asking: false });
}

export function InlineAsk() {
  const at = useDocs((s) => s.inlineAsk);
  if (!at) return null;
  return <Box key={at.block} block={at.block} />;
}

function Box({ block }: { block: string }) {
  const ai = useAssistant();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [place, setPlace] = useState<{ top: number; width: number; push: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const session = useRef<string | null>(null);
  // Whether the line is empty: the box takes its place. Once it has words (typed, or written by the AI), the box sits under it.
  const empty = useRef(false);

  useEffect(() => void refreshAssistant(), []);

  // Sit at the line, and move the lines after it down by the box's height.
  useLayoutEffect(() => {
    const measure = () => {
      const page = pageEl();
      const wrap = page?.parentElement;
      const el = page?.querySelector<HTMLElement>(`:scope > [id="${CSS.escape(block)}"]`);
      if (!page || !wrap || !el || !box.current) {
        // The line went (the AI replaced it). While it works the box stays where it was; after, it closes.
        if (!el && status.kind !== "working") setState({ inlineAsk: null });
        return;
      }
      empty.current = !blockText(el).trim() && !el.querySelector("img, table, hr, time, span[data-dropdown]");
      const w = wrap.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const h = box.current.offsetHeight;
      const top = empty.current ? r.top - w.top - 4 : r.bottom - w.top + GAP;
      const push = Math.max(0, empty.current ? h - r.height : h + GAP * 2);
      setPlace((p) => (p && p.top === top && p.width === r.width && p.push === push ? p : { top, width: r.width, push }));
    };
    measure();
    const off = onLayout(measure);
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => {
      off();
      ro.disconnect();
    };
  }, [block, status.kind]);

  // Once placed (it is hidden while measured, and a hidden field can't take focus): focus it and keep it on screen.
  const placed = place !== null;
  useEffect(() => {
    if (!placed) return;
    input.current?.focus({ preventScroll: true });
    box.current?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [placed]);

  const send = async () => {
    const t = text.trim();
    if (!t || status.kind === "working") return;
    setStatus({ kind: "working", label: "Thinking", runId: null });
    const chosen = await refreshAssistant();
    if (!chosen.kind) return setStatus({ kind: "done", text: "No AI is connected. Open the chat to install Claude Code, Codex or Antigravity, or to sign in.", error: true });
    const s = getState();
    const el = pageEl()?.querySelector<HTMLElement>(`:scope > [id="${CSS.escape(block)}"]`);
    const words = el ? blockText(el).replace(/\s+/g, " ").trim().slice(0, 600) : "";
    const note = empty.current
      ? `The user typed this in a box on their page, on the empty line with block id "${block}". Write what they ask for there: replace that empty block with your blocks using edit_blocks. Then reply in one short sentence saying what you wrote.`
      : `The user typed this in a box on their page, under the block with id "${block}" ("${words}"). It is about that block: change it, or add after it, as asked, using edit_blocks. Then reply in one short sentence saying what you did.`;
    setAgent({ name: chosen.kind });
    let reply = "";
    const on = (ev: AgentEvent) => {
      if (ev.type === "session") session.current = ev.sessionId;
      else if (ev.type === "text") reply = reply ? `${reply}\n\n${ev.text}` : ev.text;
      else if (ev.type === "tool" && ev.status === "running") setStatus({ kind: "working", label: ev.label ?? "Writing", runId: ev.runId });
      else if (ev.type === "done") setStatus({ kind: "done", text: reply || "Done.", error: false });
      else if (ev.type === "error") setStatus({ kind: "done", text: ev.message, error: true });
      else if (ev.type === "stopped") setStatus({ kind: "done", text: reply || "Stopped.", error: !reply });
      if (ev.type !== "text" && ev.type !== "delta") setStatus((st) => (st.kind === "working" && !st.runId ? { ...st, runId: ev.runId } : st));
    };
    setText("");
    const context = { tab: s.tab ? { id: s.tab } : null, selection: { blocks: [block], text: words } };
    await runOnce({ kind: chosen.kind, model: chosen.model, effort: chosen.effort, text: `${note}\n\n${t}`, context, sessionId: session.current }, on);
    setAgent(null);
    input.current?.focus({ preventScroll: true });
  };

  const stop = () => {
    if (status.kind === "working" && status.runId) void agent.stop(status.runId);
  };

  return (
    <>
      {place && <style>{`.dp-body > [id="${CSS.escape(block)}"] { margin-bottom: ${place.push + 12}px; }`}</style>}
      <div
        ref={box}
        className="ia"
        role="dialog"
        aria-label={`Ask ${ai.name}`}
        style={place ? { top: place.top, width: place.width } : { visibility: "hidden" }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (status.kind === "working") stop();
            else closeInlineAsk();
          }
        }}
      >
        <form
          className="ia-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <span className="ia-tag">@{ai.name}</span>
          <textarea
            ref={input}
            className="ia-input"
            value={text}
            rows={1}
            maxLength={4000}
            placeholder={status.kind === "working" ? `${status.label}…` : `Tell ${ai.name} what to write or edit`}
            aria-label={`Tell ${ai.name} what to write or edit`}
            readOnly={status.kind === "working"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
              // Backspace in an empty box: back to the line, as if the "@" was never chosen.
              if (e.key === "Backspace" && !text && status.kind !== "working") {
                e.preventDefault();
                closeInlineAsk();
              }
            }}
            onBlur={() => {
              // Clicking away closes the box, unless it is working or holds words not yet sent.
              requestAnimationFrame(() => {
                if (!box.current?.contains(document.activeElement) && !text.trim() && status.kind !== "working") setState({ inlineAsk: null });
              });
            }}
          />
          <div className="ia-foot">
            {status.kind === "done" && (
              <span className={`ia-reply${status.error ? " error" : ""}`} role="status">
                {status.text}
              </span>
            )}
            {status.kind === "done" && status.error && (
              <button type="button" className="btn ghost ia-chat" onClick={() => togglePanel("chat", true)}>
                Open chat
              </button>
            )}
            {status.kind !== "done" && <span className="dt-fill" />}
            {status.kind === "working" ? (
              <button type="button" className="ia-send" onClick={stop} title="Stop (Esc)" aria-label="Stop">
                <Icon name="stop" size={14} />
              </button>
            ) : (
              <button type="submit" className="ia-send" disabled={!text.trim()} title="Send (Enter)" aria-label="Send">
                <Icon name="arrowUp" size={16} />
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
