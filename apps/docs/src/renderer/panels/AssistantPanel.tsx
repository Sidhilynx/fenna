// Fenna Docs' chat column: the shell's ChatPanel, told what a doc is and what
// the user is looking at (the tab, the selection) so "this" means what's on
// their screen.

import { useCallback } from "react";
import { tabLabel } from "@opendeck/doc";
import { type ChatView, ChatPanel } from "@opendeck/shell";
import { getState, setAgent, setState, useDocs } from "../store.ts";

const SUGGESTIONS = ["Draft a one-page project brief", "Tighten the wording in this section", "Turn this list into a table", "Add a summary at the top"];

function docView(): ChatView | null {
  const s = getState();
  if (!s.doc || !s.tab) return null;
  const name = tabLabel(s.doc.index.tabs, s.tab);
  const sel = s.selection;
  const label = sel.text ? `${name} · “${sel.text.slice(0, 28)}${sel.text.length > 28 ? "…" : ""}”` : name;
  return { context: { tab: { id: s.tab, title: name }, tabCount: s.doc.tabs.size, selection: sel.blocks.length ? sel : null }, label };
}

export function AssistantPanel() {
  const draft = useDocs((s) => s.chatDraft);
  useDocs((s) => `${s.tab}|${s.selection.text}|${s.selection.blocks.join()}`);
  const taken = useCallback(() => setState({ chatDraft: "" }), []);
  return (
    <ChatPanel
      noun="doc"
      view={docView()}
      suggestions={SUGGESTIONS}
      intro="Ask for a new doc, or for changes to what you’ve selected."
      placeholder="Ask for an edit, or describe what to write"
      draft={draft}
      onDraftTaken={taken}
      onWorking={setAgent}
    />
  );
}
