// Editing or Suggesting, at the page's top right; and accepting or
// rejecting every suggestion in the tab at once.

import { acceptAll, rejectAll, suggestionsOf } from "@opendeck/doc";
import { Icon, MenuButton } from "@opendeck/shell";
import { currentTab, editTab, setMode, useDocs } from "../store.ts";

function decideAll(accept: boolean) {
  void editTab(accept ? "Accept all suggestions" : "Reject all suggestions", (blocks) => {
    const tab = { type: "element" as const, tag: "article", attrs: {}, children: blocks };
    return (accept ? acceptAll(tab) : rejectAll(tab)).children as typeof blocks;
  });
}

export function ModeMenu() {
  const mode = useDocs((s) => s.mode);
  const pending = useDocs((s) => {
    const t = currentTab(s)?.tab;
    return t ? suggestionsOf(t).length : 0;
  });
  return (
    <MenuButton
      className="btn mode-btn"
      label="Editing mode"
      align="end"
      entries={() => [
        { label: "Editing", hint: "Change the text directly", icon: <Icon name="pencil" size={16} />, checked: mode === "edit", onSelect: () => void setMode("edit") },
        { label: "Suggesting", hint: "Edits, yours and the AI’s, become suggestions", icon: <Icon name="suggest" size={16} />, checked: mode === "suggest", onSelect: () => void setMode("suggest") },
        "separator",
        { label: "Accept all suggestions", disabled: !pending, onSelect: () => decideAll(true) },
        { label: "Reject all suggestions", disabled: !pending, onSelect: () => decideAll(false) },
      ]}
    >
      <Icon name={mode === "edit" ? "pencil" : "suggest"} size={16} />
      {mode === "edit" ? "Editing" : "Suggesting"}
      <Icon name="chevronDown" size={14} />
    </MenuButton>
  );
}
