// The Comments column, opened by the comment button on the bar: every
// thread in the doc, filtered to open or resolved and to this tab or all,
// with the new comment being written at the top. Choosing a thread goes to
// its words. While it is open, the threads show here instead of the margin.

import { useState } from "react";
import { findTab, tabLabel } from "@opendeck/doc";
import { Icon, MenuButton, ThreadCard, shortcut } from "@opendeck/shell";
import { type DocThread, addComment, deleteThread, getComments, openThread, resolveThread, setAskAssistant, useComments } from "../editor/comments.ts";
import { pageEl } from "../editor/page.ts";
import { goToTab, togglePanel, useDocs } from "../store.ts";
import { useAssistant } from "./assistant.tsx";

type Show = "open" | "resolved" | "all";

/** Go to a thread's words and open it. */
async function goTo(t: DocThread) {
  await goToTab(t.tab);
  openThread(t.id);
  requestAnimationFrame(() => {
    const el = pageEl()?.querySelector<HTMLElement>(`:scope > [id="${CSS.escape(t.block)}"]`);
    el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
}

export function CommentsPanel() {
  const ai = useAssistant();
  const tab = useDocs((s) => s.tab);
  const tabs = useDocs((s) => s.doc?.index.tabs ?? []);
  const threads = useComments((s) => s.threads);
  const open = useComments((s) => s.open);
  const working = useComments((s) => s.working);
  const ask = useComments((s) => s.askAssistant);
  const [show, setShow] = useState<Show>("open");
  const [everyTab, setEveryTab] = useState(true);

  const draft = open && "draft" in open ? open.draft : null;
  const openId = open && "thread" in open ? open.thread : null;
  const list = threads.filter((t) => (show === "all" || (show === "resolved") === t.resolved) && (everyTab || t.tab === tab) && findTab(tabs, t.tab));
  const openCount = threads.filter((t) => !t.resolved).length;

  const none = show === "open" ? "No open comments" : show === "resolved" ? "No resolved comments" : "No comments";

  return (
    <aside className="cp" aria-label="Comments">
      <header className="cp-head">
        <h2 className="cp-title">
          Comments{openCount > 0 && <span className="cp-count">{openCount}</span>}
        </h2>
        <MenuButton
          className="icon-btn"
          label="Filter comments"
          title="Filter"
          align="end"
          entries={() => [
            { heading: "Show" },
            { label: "Open", checked: show === "open", onSelect: () => setShow("open") },
            { label: "Resolved", checked: show === "resolved", onSelect: () => setShow("resolved") },
            { label: "All", checked: show === "all", onSelect: () => setShow("all") },
            "separator",
            { heading: "Tabs" },
            { label: "All tabs", checked: everyTab, onSelect: () => setEveryTab(true) },
            { label: "This tab", checked: !everyTab, onSelect: () => setEveryTab(false) },
          ]}
        >
          <Icon name="filter" size={16} />
        </MenuButton>
        <MenuButton
          className="icon-btn"
          label="More"
          title="More"
          align="end"
          entries={() => [
            { label: `Send new comments to ${ai.name}`, checked: ask, onSelect: () => setAskAssistant(!ask) },
            "separator",
            { label: "Resolve all open", disabled: openCount === 0, onSelect: () => getComments().threads.forEach((t) => !t.resolved && resolveThread(t.id)) },
          ]}
        >
          <Icon name="dots" size={16} />
        </MenuButton>
        <button className="icon-btn" title="Close" aria-label="Close comments" onClick={() => togglePanel("comments", false)}>
          <Icon name="close" size={16} />
        </button>
      </header>
      <div className="cp-list">
        {draft && draft.tab === tab && (
          <ThreadCard
            key="draft"
            className="cp-card"
            thread={null}
            quote={draft.quote || undefined}
            askAssistant={ask}
            onAskAssistant={setAskAssistant}
            onSend={(text) => addComment({ draft }, text)}
            onClose={() => openThread(null)}
          />
        )}
        {list.map((t) => (
          <div key={t.id} className="cp-item">
            {(everyTab || t.resolved) && (
              <div className="cp-where">
                {everyTab && <span className="cp-tab">{tabLabel(tabs, t.tab)}</span>}
                {t.resolved && <span className="cp-resolved">Resolved</span>}
              </div>
            )}
            <ThreadCard
              className="cp-card"
              thread={t}
              quote={t.quote || undefined}
              working={working[t.id]}
              askAssistant={ask}
              onAskAssistant={setAskAssistant}
              collapsed={t.id !== openId}
              autoFocus={false}
              onExpand={() => void goTo(t)}
              onSend={(text) => addComment({ thread: t.id }, text)}
              onResolve={t.resolved ? undefined : () => resolveThread(t.id)}
              onDelete={() => deleteThread(t.id)}
              onClose={() => openThread(null)}
            />
          </div>
        ))}
        {!list.length && !(draft && draft.tab === tab) && (
          <div className="cp-empty">
            <p>{none}</p>
            <p className="cp-hint">Select text and press {shortcut("Mod+Alt+M")} to comment.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
