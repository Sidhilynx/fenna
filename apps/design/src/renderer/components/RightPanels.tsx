// The column at the right: the properties panel, the chat, the comments, or
// version history. One at a time; its close button and Esc put it away.

import { useCallback, useState } from "react";
import { ChatPanel, Icon, MenuButton, ThreadCard, shortcut, type ChatView } from "@opendeck/shell";
import { useAssistant } from "../assistant.ts";
import { comments, threadQuote, threadTarget, type DesignThread } from "../comments.ts";
import { PropertiesPanel } from "../panels/PropertiesPanel.tsx";
import { boardRect, getState, restoreVersion, reveal, selectLayers, setAgent, setPage, setPanel, setState, useDesign } from "../store.ts";
import { designView, selectionLabel } from "./AskBar.tsx";

function PanelHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="rp-head">
      <h2 className="rp-title">{title}</h2>
      {children}
      <button className="icon-btn" title="Close (Esc)" aria-label={`Close ${title.toLowerCase()}`} onClick={() => setPanel(null)}>
        <Icon name="close" size={16} />
      </button>
    </header>
  );
}

// ── Chat ─────────────────────────────────────────────────────────────────

const SUGGESTIONS = ["Make a 1080 × 1080 social post for a launch", "Design a phone settings screen, light and dark", "Change the accent color across the design", "Tighten the copy on the selected artboard"];

function view(): ChatView | null {
  const context = designView(true);
  if (!context) return null;
  const what = selectionLabel();
  const title = getState().index.title;
  return { context, label: what ? `${title} · ${what}` : title };
}

function AssistantPanel() {
  const draft = useDesign((s) => s.chatDraft);
  useDesign((s) => s.selection);
  useDesign((s) => s.page);
  const taken = useCallback(() => setState({ chatDraft: "" }), []);
  return (
    <aside className="rp rp-chat" aria-label="Chat">
      <ChatPanel noun="design" view={view()} suggestions={SUGGESTIONS} intro="Ask for new artboards, or for changes to what you’ve selected." placeholder="Ask for a change, or describe a design to make" draft={draft} onDraftTaken={taken} onWorking={setAgent} />
    </aside>
  );
}

// ── Comments ─────────────────────────────────────────────────────────────

type Show = "open" | "resolved" | "all";

function goTo(t: DesignThread) {
  comments.openThread(t.id);
  const s = getState();
  const board = s.index.boards[t.file];
  if (!board) return;
  if (board.page !== s.page) setPage(board.page);
  selectLayers(t.file, [threadTarget(t)?.address ?? ""]);
  const r = boardRect(t.file);
  if (r) reveal(r);
}

function CommentsPanel() {
  const ai = useAssistant();
  const threads = comments.use((s) => s.threads);
  const working = comments.use((s) => s.working);
  const ask = comments.use((s) => s.askAssistant);
  useDesign((s) => s.boards);
  const hasSelection = useDesign((s) => !!s.selection && s.selection.kind !== "notes");
  const [show, setShow] = useState<Show>("open");
  const list = threads.filter((t) => show === "all" || (show === "resolved") === t.resolved);
  const openCount = threads.filter((t) => !t.resolved).length;
  return (
    <aside className="rp" aria-label="Comments">
      <PanelHead title={show === "resolved" ? "Resolved comments" : show === "all" ? "All comments" : openCount ? `Comments · ${openCount}` : "Comments"}>
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
            { label: `Send new comments to ${ai.name}`, checked: ask, onSelect: () => comments.setAskAssistant(!ask) },
          ]}
        >
          <Icon name="filter" size={16} />
        </MenuButton>
      </PanelHead>
      <div className="rp-body cm-list">
        {list.map((t) => (
          <div key={t.id} className="cm-item">
            {t.resolved && <div className="cm-resolved">Resolved</div>}
            <ThreadCard
              className="cm-card"
              thread={t}
              quote={threadQuote(t)}
              working={working[t.id]}
              askAssistant={ask}
              onAskAssistant={comments.setAskAssistant}
              collapsed
              autoFocus={false}
              onExpand={() => goTo(t)}
              onSend={(text) => comments.add({ thread: t.id }, text)}
              onResolve={t.resolved ? undefined : () => comments.resolve(t.id)}
              onDelete={() => comments.remove(t.id)}
              onClose={() => comments.openThread(null)}
            />
          </div>
        ))}
        {!list.length && (
          <div className="rp-empty">
            <p>{show === "resolved" ? "No resolved comments" : show === "open" && threads.length ? "No open comments" : "No comments yet"}</p>
            <p className="rp-hint">Press the comment button, then click an artboard or a layer on it{hasSelection ? `, or press ${shortcut("Mod+Alt+M")} to comment on the selection` : ""}.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Version history ──────────────────────────────────────────────────────

function when(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `Today at ${time}`;
  if (diff === 1) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) })} at ${time}`;
}

function HistoryPanel() {
  const history = useDesign((s) => s.history);
  return (
    <aside className="rp" aria-label="Version history">
      <PanelHead title="Version history" />
      <div className="rp-body vh-list">
        {history.map((v, i) => (
          <div key={v.id} className="vh-item">
            <div className="vh-when">
              {when(v.at)}
              {i === 0 && <span className="vh-current">Current</span>}
            </div>
            <div className="vh-who">
              <span className="c-avatar">{v.author.slice(0, 1).toUpperCase()}</span>
              <span>{v.author}</span>
              <span className="vh-what">
                · {v.label} · {v.index.order.length === 1 ? "1 artboard" : `${v.index.order.length} artboards`}
              </span>
            </div>
            {i > 0 && (
              <MenuButton className="icon-btn vh-more" label="Version actions" title="More" align="end" entries={() => [{ label: "Restore this version", onSelect: () => restoreVersion(v) }]}>
                <Icon name="dots" size={16} />
              </MenuButton>
            )}
          </div>
        ))}
        {!history.length && <div className="rp-empty">Versions appear here as the design changes.</div>}
      </div>
    </aside>
  );
}

export function RightPanels() {
  const panel = useDesign((s) => s.panel);
  if (panel === "properties") return <PropertiesPanel />;
  if (panel === "comments") return <CommentsPanel />;
  if (panel === "history") return <HistoryPanel />;
  if (panel === "chat") return <AssistantPanel />;
  return null;
}
