// The cards a bot puts in front of the person: a question with choices, an
// approval, an offer to save a login. The same cards show in the Inbox and
// in the chat. An answer is taken once; if the computer already took
// another, the card says so.

import { useState } from "react";
import type { ApprovalSource } from "../../../crew/src/shared/contract.ts";
import { invoke } from "../../../crew/src/shared/api.ts";
import { useAct, useStore } from "../state.tsx";
import { haptic, Working } from "../ui.tsx";

const BY: Record<string, string> = { person: "", timeout: "No answer in time", stopped: "The run stopped" };
const ALWAYS: ApprovalSource[] = ["connector", "login", "project"];

export function AskCard({ id, question, options, multi, answer }: { id: string; question: string; options: string[]; multi: boolean; answer: { by: string; answer: string[] } | null }) {
  const { link, toast } = useStore();
  const act = useAct();
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string[] | null>(null);

  async function send(list: string[]) {
    if (!list.length) return;
    setBusy(true);
    const ok = await act(invoke("crew:answer", id, list));
    setBusy(false);
    if (ok === null) return;
    if (!ok) {
      toast("This was already answered.");
      return;
    }
    haptic("ok");
    setSent(list);
  }

  const done = answer ?? (sent ? { by: "person", answer: sent } : null);
  return (
    <div className="card px-frame" role="group" aria-label="A question">
      <p className="card-q">{question}</p>
      {done ? (
        <p className="card-done">{done.answer.length ? done.answer.join(", ") : BY[done.by] || "Dismissed"}</p>
      ) : (
        <>
          {options.length > 0 && (
            <div className="card-opts" role={multi ? "group" : undefined}>
              {options.map((o) =>
                multi ? (
                  <button key={o} type="button" className="btn card-opt" aria-pressed={picked.includes(o)} disabled={busy || !link.ready} onClick={() => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]))}>
                    {o}
                  </button>
                ) : (
                  <button key={o} type="button" className="btn card-opt" disabled={busy || !link.ready} onClick={() => void send([o])}>
                    {o}
                  </button>
                ),
              )}
            </div>
          )}
          {multi && options.length > 0 && (
            <button type="button" className="btn primary block" disabled={busy || !picked.length || !link.ready} onClick={() => void send(picked)}>
              {busy ? <Working label="Sending" /> : picked.length === 1 ? "Send 1 choice" : picked.length ? `Send ${picked.length} choices` : "Send choices"}
            </button>
          )}
          <div className="card-type">
            <input className="field" value={text} placeholder={options.length ? "Or write an answer" : "Write an answer"} onChange={(e) => setText(e.target.value)} disabled={busy || !link.ready} enterKeyHint="send" onKeyDown={(e) => e.key === "Enter" && text.trim() && void send([text.trim()])} />
            <button type="button" className="btn" disabled={busy || !text.trim() || !link.ready} onClick={() => void send([text.trim()])}>
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function ApprovalCard({ id, action, details, source, decision }: { id: string; action: string; details: string; source: ApprovalSource; decision: { by: string; allowed: boolean; always: boolean } | null }) {
  const { link, toast } = useStore();
  const act = useAct();
  const [busy, setBusy] = useState<"yes" | "always" | "no" | null>(null);
  const [mine, setMine] = useState<{ allowed: boolean; always: boolean } | null>(null);
  const [open, setOpen] = useState(false);

  async function decide(allowed: boolean, always: boolean) {
    setBusy(allowed ? (always ? "always" : "yes") : "no");
    const ok = await act(invoke("crew:decide", id, allowed, always));
    setBusy(null);
    if (ok === null) return;
    if (!ok) {
      toast("This was already answered.");
      return;
    }
    haptic(allowed ? "ok" : "no");
    setMine({ allowed, always });
  }

  const done = decision ?? (mine ? { by: "person", ...mine } : null);
  const long = details.length > 160;
  return (
    <div className="card px-frame" role="group" aria-label="An approval">
      <p className="card-kicker">Approve</p>
      <p className="card-q">{action}</p>
      {details && (
        <>
          <p className={open || !long ? "card-details" : "card-details clamp"}>{details}</p>
          {long && (
            <button type="button" className="card-more" onClick={() => setOpen((o) => !o)}>
              {open ? "Show less" : "Show all"}
            </button>
          )}
        </>
      )}
      {done ? (
        <p className="card-done">{BY[done.by] || (done.allowed ? (done.always ? "Approved, always for this bot" : "Approved") : "Denied")}</p>
      ) : (
        <div className="m-btns card-acts">
          <button type="button" className="btn" disabled={!!busy || !link.ready} onClick={() => void decide(false, false)}>
            {busy === "no" ? <Working label="Denying" /> : "Deny"}
          </button>
          <button type="button" className="btn primary" disabled={!!busy || !link.ready} onClick={() => void decide(true, false)}>
            {busy === "yes" ? <Working label="Approving" /> : "Approve"}
          </button>
          {ALWAYS.includes(source) && (
            <button type="button" className="btn ghost card-always" disabled={!!busy || !link.ready} onClick={() => void decide(true, true)}>
              {busy === "always" ? <Working label="Approving" /> : "Always for this bot"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function OfferCard({ id, origin, username, existing }: { id: string; origin: string; username: string; existing: string | null }) {
  const { link } = useStore();
  const act = useAct();
  const [busy, setBusy] = useState(false);
  const host = origin.replace(/^https?:\/\//, "");

  async function answer(save: boolean) {
    setBusy(true);
    const r = await act(invoke("crew:saveOffer", id, save));
    setBusy(false);
    if (r !== null) haptic(save ? "ok" : "tap");
  }

  return (
    <div className="card px-frame" role="group" aria-label="Save a login">
      <p className="card-kicker">Login</p>
      <p className="card-q">Save the login for {host}?</p>
      <p className="card-details">
        {username ? `As ${username}. ` : ""}
        {existing ? "This updates the saved password." : "Bots use it without seeing the password."}
      </p>
      <div className="m-btns card-acts">
        <button type="button" className="btn" disabled={busy || !link.ready} onClick={() => void answer(false)}>
          Not now
        </button>
        <button type="button" className="btn primary" disabled={busy || !link.ready} onClick={() => void answer(true)}>
          Save
        </button>
      </div>
    </div>
  );
}
