// The two things a bot can stop and ask the person: a question with
// choices (ask_human) and an approval (the bot's own request_approval, a
// connector tool on ask, or a vault login on ask). Answered ones stay in the
// chat as one quiet line. A login's card names the site and the login,
// never the password.

import { useState } from "react";
import { errorText, invoke } from "../shared/api.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import type { Item } from "./transcript.ts";

type Ask = Extract<Item, { kind: "ask" }>;
type Approval = Extract<Item, { kind: "approval" }>;

function by(who: string): string {
  return who === "timeout" ? "No answer in time" : who === "stopped" ? "Stopped before you answered" : "You";
}

export function AskCard({ item, waiting }: { item: Ask; waiting: boolean }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (item.answer) {
    const said = item.answer.answer.join(", ");
    return (
      <div className="step done-line">
        <PixelIcon name="check" size={12} />
        <span className="ell" title={item.question}>
          {item.question} · {item.answer.by === "person" ? `You answered${said ? `: ${said}` : ""}` : by(item.answer.by)}
        </span>
      </div>
    );
  }
  if (!waiting) {
    return (
      <div className="step done-line">
        <PixelIcon name="close" size={12} />
        <span className="ell" title={item.question}>
          {item.question} · Not answered
        </span>
      </div>
    );
  }

  const send = async (answer: string[]) => {
    setBusy(true);
    setError("");
    try {
      if (!(await invoke("crew:answer", item.askId, answer))) setError("That question is no longer waiting.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (o: string) => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));

  return (
    <div className="card" role="group" aria-label="Question from the bot">
      <div className="card-head">
        <PixelIcon name="question" size={12} />
        <span>Question</span>
      </div>
      <div className="card-body">
        <span className="card-title">{item.question}</span>
        <div className="choices">
          {item.options.map((o) => {
            const on = item.multi && picked.includes(o);
            return (
              <button key={o} type="button" className="btn choice" aria-pressed={item.multi ? on : undefined} disabled={busy} onClick={() => (item.multi ? toggle(o) : void send([o]))}>
                {item.multi && <span className="choice-box" aria-hidden>{on && <PixelIcon name="check" size={10} />}</span>}
                {o}
              </button>
            );
          })}
        </div>
        <form
          className="card-type"
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (t) void send([t]);
          }}
        >
          <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder={item.options.length ? "Or type your own" : "Type your answer"} aria-label="Your answer" disabled={busy} />
          <button type="submit" className="btn" disabled={busy || !text.trim()}>
            Send
          </button>
        </form>
        {item.multi && (
          <div className="card-acts">
            <button type="button" className="btn primary" disabled={busy || !picked.length} onClick={() => void send(picked)}>
              Send{picked.length ? ` ${picked.length}` : ""}
            </button>
          </div>
        )}
        {error && <span className="card-error">{error}</span>}
      </div>
    </div>
  );
}

export function ApprovalCard({ item, waiting }: { item: Approval; waiting: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (item.decision) {
    const d = item.decision;
    return (
      <div className="step done-line">
        <PixelIcon name={d.allowed ? "check" : "close"} size={12} />
        <span className="ell" title={item.action}>
          {d.by === "person" ? `You ${d.allowed ? "approved" : "denied"}` : by(d.by)}
          {d.always && d.allowed ? " for this bot from now on" : ""} · {item.action}
        </span>
      </div>
    );
  }
  if (!waiting) {
    return (
      <div className="step done-line">
        <PixelIcon name="close" size={12} />
        <span className="ell" title={item.action}>
          {item.action} · Not answered
        </span>
      </div>
    );
  }

  const decide = async (allowed: boolean, always = false) => {
    setBusy(true);
    setError("");
    try {
      if (!(await invoke("crew:decide", item.approvalId, allowed, always))) setError("That request is no longer waiting.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const fromConnector = item.source === "connector";
  const fromLogin = item.source === "login";
  const [connector, tool] = fromConnector && item.tool ? item.tool.split("/") : ["", ""];
  const sub = fromConnector ? `Uses ${tool} from ${connector}.` : fromLogin ? "Uses a login from your vault, on this site only." : "";
  const always = fromConnector ? `Allow ${tool} for this bot without asking` : "Sign in to this site for this bot without asking";
  return (
    <div className="card" role="group" aria-label="Approval needed">
      <div className="card-head">
        <PixelIcon name="shield" size={12} />
        <span>Approval</span>
      </div>
      <div className="card-body">
        <span className="card-title">{item.action}</span>
        {sub && <span className="card-sub">{sub}</span>}
        {item.details && <div className="card-details">{item.details}</div>}
        <div className="card-acts">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void decide(true)}>
            Approve
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void decide(false)}>
            Deny
          </button>
          {(fromConnector || fromLogin) && (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void decide(true, true)} title={always}>
              Always for this bot
            </button>
          )}
        </div>
        {error && <span className="card-error">{error}</span>}
      </div>
    </div>
  );
}
