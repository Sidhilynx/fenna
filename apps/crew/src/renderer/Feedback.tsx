// Send feedback: a good or not-good choice and a few words, sent when the person presses Send.

import { useState } from "react";
import { Dialog } from "@opendeck/shell";
import { errorText, invoke } from "../shared/api.ts";

const MAX_TEXT = 1000;

type Rating = "up" | "down";

export function FeedbackDialog({ onClose }: { onClose(): void }) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const empty = !rating && !text.trim();

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      await invoke("crew:feedback", { rating, text: text.trim() });
      setSent(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="How is Crew working for you?" onClose={onClose} width={480}>
      {sent ? (
        <>
          <p className="fb-done" role="status">
            Sent. Thank you.
          </p>
          <div className="form-acts">
            <button type="button" className="btn primary" data-autofocus onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <div className="nb-form">
          <div className="toggles" role="group" aria-label="Rating">
            <button type="button" className="toggle" aria-pressed={rating === "up"} data-autofocus onClick={() => setRating(rating === "up" ? null : "up")}>
              Good
            </button>
            <button type="button" className="toggle" aria-pressed={rating === "down"} onClick={() => setRating(rating === "down" ? null : "down")}>
              Not good
            </button>
          </div>
          <div className="nb-field">
            <textarea className="field" rows={5} maxLength={MAX_TEXT} value={text} aria-label="Your feedback" placeholder="What works, what doesn't, what is missing" onChange={(e) => setText(e.target.value)} />
            <span className="hint fb-count">
              {text.length} / {MAX_TEXT}
            </span>
          </div>
          <p className="hint">Sends your text, the app version and your system. Nothing else.</p>
          {error && (
            <p className="hint fb-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-acts">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn primary" disabled={busy || empty} onClick={() => void send()}>
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
