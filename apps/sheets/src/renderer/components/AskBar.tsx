// "Describe a change": a request to the AI about what's on screen (the
// selection, or the whole sheet), without opening the chat. Its edits land
// on the sheet as they happen; its reply shows here. Follow-ups stay in one
// conversation until the box closes.

import { useEffect, useRef, useState } from "react";
import { formatCellRef, formatCellValue } from "@opendeck/sheet";
import { type AgentEvent, Icon, agent, runOnce, shortcut } from "@opendeck/shell";
import { refreshAssistant, useAssistant } from "../assistant.ts";
import { currentSheet, getState, selectionRangeStr, selectionRect, setAgent, setRightPanel, setState, useSheets } from "../store.ts";

type Status = { kind: "idle" } | { kind: "working"; label: string; runId: string | null } | { kind: "done"; text: string; error: boolean };

const NOTE =
  "This is a quick request from the box under the user's sheet, not the chat. The context names the sheet and the cells they selected; \"this\" and \"these\" mean those cells. Make the change with the Fenna Sheets tools, using formulas for anything computed, then reply in one short sentence saying what you changed.";

/** What the AI is told the user is looking at: the sheet, and the selection with what it shows (up to 60 cells). */
export function sheetContext(withSelection: boolean) {
  const s = getState();
  const sheet = currentSheet(s);
  if (!s.workbook || !sheet) return null;
  const base = { workbook: s.workbook.index.title, sheet: { id: sheet.id, title: sheet.title } };
  if (!withSelection) return base;
  const b = selectionRect();
  const values = s.evaluated.get(sheet.id);
  const shows: Record<string, string> = {};
  let n = 0;
  for (let r = b.r1; r <= b.r2 && n < 60; r++)
    for (let c = b.c1; c <= b.c2 && n < 60; c++) {
      const ref = formatCellRef(r, c);
      const cell = sheet.cells[ref];
      if (!cell) continue;
      shows[ref] = formatCellValue(values?.get(ref) ?? cell.v ?? null, cell, s.workbook.index);
      n++;
    }
  return { ...base, selection: selectionRangeStr(), ...(n ? { selectionShows: shows } : {}) };
}

export function AskBar() {
  const ai = useAssistant();
  const sheet = useSheets((s) => currentSheet(s));
  const title = useSheets((s) => s.workbook?.index.title ?? "");
  const range = useSheets((s) => selectionRangeStr(s.selection));
  const request = useSheets((s) => s.askRequest);
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
    await runOnce({ kind: chosen.kind, model: chosen.model, effort: chosen.effort, text: `${NOTE}\n\n${t}`, context: sheetContext(about), sessionId: session.current }, on);
    setAgent(null);
    input.current?.focus();
  };

  useEffect(() => {
    input.current?.focus();
  }, []);

  // A request handed over by a menu's prompt ("Ask Claude to make a chart").
  useEffect(() => {
    if (!request || request.n === taken.current) return;
    taken.current = request.n;
    void send(request.text);
  });

  const stop = () => {
    if (status.kind === "working" && status.runId) void agent.stop(status.runId);
  };

  const empty = sheet ? Object.keys(sheet.cells).length === 0 : true;

  return (
    <div
      className="ask"
      role="dialog"
      aria-label={`Ask ${ai.name}`}
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
            <Icon name="sheet" size={14} />
            <span className="ask-chip-title">{title}</span>
            <span className="ask-chip-what">{empty ? "Blank sheet" : `${sheet?.title ?? ""} · ${range}`}</span>
            <button className="ask-chip-x" title="Ask about the whole workbook instead" aria-label="Remove the selection from the request" onClick={() => setAbout(false)}>
              <Icon name="close" size={12} />
            </button>
          </span>
        </div>
      )}
      {status.kind !== "idle" && (
        <div className={`ask-status${status.kind === "done" && status.error ? " error" : ""}`} role="status">
          <span className="ask-reply">{status.kind === "working" ? `${status.label}…` : status.text}</span>
          {status.kind === "done" && (
            <button className="btn ghost ask-chat" onClick={() => setRightPanel("chat")}>
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
