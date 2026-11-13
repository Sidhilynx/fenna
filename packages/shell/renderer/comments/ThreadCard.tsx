// One comment thread as a card: its comments, the assistant's progress, and
// the reply box with "Send to assistant". Shared by every app; the app
// decides where the card sits (beside a pin on a slide, in a doc's margin).

import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icons.tsx";
import { MenuButton } from "../ui/Menu.tsx";
import { type ThreadBase, MAX_COMMENT, ago } from "./threads.ts";
import "./comments.css";

export interface ThreadCardProps {
  /** The thread, or null for a new comment being written. */
  thread: ThreadBase | null;
  /** What the assistant is doing on this thread, while it works. */
  working?: string;
  /** The text the thread points at, shown above the comments. */
  quote?: string;
  askAssistant: boolean;
  onAskAssistant(v: boolean): void;
  onSend(text: string): void;
  onResolve?(): void;
  onDelete?(): void;
  onClose(): void;
  /** Focus the reply box when shown. */
  autoFocus?: boolean;
  /** Only the first comment and a count, until the card is opened. */
  collapsed?: boolean;
  onExpand?(): void;
  className?: string;
}

export function ThreadCard({ thread, working, quote, askAssistant, onAskAssistant, onSend, onResolve, onDelete, onClose, autoFocus = true, collapsed = false, onExpand, className = "" }: ThreadCardProps) {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const count = thread?.comments.length ?? 0;

  useEffect(() => {
    if (autoFocus && !collapsed) input.current?.focus();
  }, [autoFocus, collapsed]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [count, working]);

  const send = () => {
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };

  if (collapsed && thread) {
    const first = thread.comments[0]!;
    return (
      <button className={`cm-card cm-collapsed ${className}`} onClick={onExpand} aria-label={`Comment thread, ${count} ${count === 1 ? "comment" : "comments"}`}>
        <span className="cm-meta">
          <span className="cm-author">{first.author === "you" ? "You" : "Assistant"}</span>
          <span className="cm-time">{ago(first.at)}</span>
          {count > 1 && <span className="cm-count">{count - 1} {count === 2 ? "reply" : "replies"}</span>}
        </span>
        <span className="cm-text cm-clamp">{first.text}</span>
        {working !== undefined && <span className="cm-working">{working}…</span>}
      </button>
    );
  }

  return (
    <div
      className={`cm-card ${className}`}
      role="dialog"
      aria-label={thread ? "Comment thread" : "New comment"}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {thread && (
        <div className="cm-head">
          {onResolve && (
            <button className="icon-btn" title="Resolve" aria-label="Resolve" onClick={onResolve}>
              <Icon name="check" size={16} />
            </button>
          )}
          <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
          {onDelete && (
            <MenuButton className="icon-btn" label="More" title="More" align="end" entries={[{ label: "Delete thread", icon: <Icon name="trash" size={16} />, danger: true, onSelect: onDelete }]}>
              <Icon name="dots" size={16} />
            </MenuButton>
          )}
        </div>
      )}
      {quote && <div className="cm-quote">{quote}</div>}
      {thread && (
        <div className="cm-list" ref={list} role="log" aria-live="polite">
          {thread.comments.map((c) => (
            <div key={c.id} className={`cm-item${c.error ? " error" : ""}`}>
              <span className={`cm-avatar${c.author === "you" ? "" : " ai"}`} aria-hidden>
                <Icon name={c.author === "you" ? "person" : "sparkle"} size={14} />
              </span>
              <div className="cm-body">
                <div className="cm-meta">
                  <span className="cm-author">{c.author === "you" ? "You" : "Assistant"}</span>
                  <span className="cm-time">{ago(c.at)}</span>
                </div>
                <div className="cm-text">{c.text}</div>
              </div>
            </div>
          ))}
          {working !== undefined && (
            <div className="cm-working" aria-label="Assistant working">
              {working}…
            </div>
          )}
        </div>
      )}
      <form
        className="cm-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={input}
          value={text}
          rows={Math.min(6, Math.max(2, text.split("\n").length))}
          maxLength={MAX_COMMENT}
          placeholder={thread ? "Reply" : "Add a comment"}
          aria-label={thread ? "Reply" : "Comment"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="cm-actions">
          <label className="cm-ask">
            <input type="checkbox" checked={askAssistant} onChange={(e) => onAskAssistant(e.target.checked)} />
            Send to assistant
          </label>
          <button type="submit" className="cm-send-btn" disabled={!text.trim() || working !== undefined} title="Send (Enter)" aria-label="Send">
            <Icon name="arrowUp" size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
