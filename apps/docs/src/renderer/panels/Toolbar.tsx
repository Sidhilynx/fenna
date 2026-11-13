// The bar floating at the bottom of the page: text style and fonts, table,
// image, checklist, dropdown, more blocks, the Comments column, and Ask
// (named for the connected AI), which opens a box to describe a change.

import { useState } from "react";
import { DROPDOWN_TEMPLATES, OPTION_COLORS } from "@opendeck/doc";
import { Dialog, Icon, type IconName, MenuButton, type MenuEntry, shortcut } from "@opendeck/shell";
import { insertDate, insertDivider, insertDropdown, insertTable, pickImages, setStyle, styleAt, toggleList } from "../editor/commands.ts";
import { restoreSelection } from "../editor/page.ts";
import { addDropdown, getState, setFont, setState, setWide, togglePanel, useDocs } from "../store.ts";
import { AskBar } from "./AskBar.tsx";
import { useAssistant } from "./assistant.tsx";

const STYLES: [string, "p" | "h1" | "h2" | "h3", IconName][] = [
  ["Text", "p", "text"],
  ["Heading 1", "h1", "heading1"],
  ["Heading 2", "h2", "heading2"],
  ["Heading 3", "h3", "heading3"],
];

export function Toolbar() {
  const fonts = useDocs((s) => s.doc?.index.fonts);
  const wide = useDocs((s) => s.doc?.index.wide ?? false);
  const dropdowns = useDocs((s) => s.doc?.index.dropdowns ?? []);
  const asking = useDocs((s) => s.asking);
  const comments = useDocs((s) => s.comments);
  const ai = useAssistant();
  const setAsking = (v: boolean) => setState({ asking: v, inlineAsk: null });
  const [newDropdown, setNewDropdown] = useState(false);

  const textEntries = (): MenuEntry[] => {
    const now = styleAt();
    return [
      { heading: "Style" },
      ...STYLES.map(([label, tag, icon]) => ({ label, icon: <Icon name={icon} size={16} />, checked: now === tag, shortcut: shortcut(`Mod+Alt+${tag === "p" ? "0" : tag[1]}`), onSelect: () => setStyle(tag) })),
      "separator",
      { heading: "Headings" },
      { label: "Serif", checked: fonts?.headings === "serif", onSelect: () => void setFont("headings", "serif") },
      { label: "Sans", checked: fonts?.headings === "sans", onSelect: () => void setFont("headings", "sans") },
      "separator",
      { heading: "Text" },
      { label: "Serif", checked: fonts?.text === "serif", onSelect: () => void setFont("text", "serif") },
      { label: "Sans", checked: fonts?.text === "sans", onSelect: () => void setFont("text", "sans") },
    ];
  };

  const useTemplate = async (key: string) => {
    const t = DROPDOWN_TEMPLATES.find((d) => d.id === key)!;
    // The doc's own copy of a template, if it has one already.
    const existing = getState().doc?.index.dropdowns.find((d) => d.name === t.name);
    const dd = existing ?? (await addDropdown({ template: key }));
    if (dd) insertDropdown(dd);
  };

  const dropdownEntries = (): MenuEntry[] => [
    { heading: "Document dropdowns" },
    ...dropdowns.map((d) => ({ label: d.name, hint: d.options.map((o) => o.label).join(", "), onSelect: () => insertDropdown(d) })),
    { label: "New dropdown…", icon: <Icon name="plus" size={16} />, onSelect: () => setNewDropdown(true) },
    "separator",
    { heading: "Templates" },
    ...DROPDOWN_TEMPLATES.map((t) => ({ label: t.name, aside: String(t.options.length), onSelect: () => void useTemplate(t.id) })),
  ];

  const moreEntries = (): MenuEntry[] => {
    const now = styleAt();
    return [
      { label: "Bulleted list", icon: <Icon name="list" size={16} />, checked: now === "ul", shortcut: shortcut("Mod+Shift+8"), onSelect: () => toggleList("ul") },
      { label: "Numbered list", icon: <Icon name="numbered" size={16} />, checked: now === "ol", shortcut: shortcut("Mod+Shift+7"), onSelect: () => toggleList("ol") },
      "separator",
      { label: "Quote", icon: <Icon name="quote" size={16} />, checked: now === "blockquote", onSelect: () => setStyle(now === "blockquote" ? "p" : "blockquote") },
      { label: "Code block", icon: <Icon name="code" size={16} />, checked: now === "pre", onSelect: () => setStyle(now === "pre" ? "p" : "pre") },
      { label: "Divider", icon: <Icon name="divider" size={16} />, onSelect: insertDivider },
      "separator",
      { label: "Date", icon: <Icon name="calendar" size={16} />, onSelect: () => insertDate() },
      "separator",
      { label: "Make page wide", icon: <Icon name="wide" size={16} />, checked: wide, onSelect: () => void setWide(!wide) },
    ];
  };

  // Buttons keep the caret where it was in the text.
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="tb-wrap">
      {asking && <AskBar onClose={() => setAsking(false)} />}
      <div className="tb" role="toolbar" aria-label="Insert and format">
        <MenuButton className="icon-btn" label="Text style and fonts" title="Text style and fonts" entries={textEntries}>
          <Icon name="textSize" />
        </MenuButton>
        <span className="tb-sep" aria-hidden />
        <button className="icon-btn" onMouseDown={keep} onClick={() => insertTable()} title="Table" aria-label="Insert table">
          <Icon name="table" />
        </button>
        <button className="icon-btn" onMouseDown={keep} onClick={() => void pickImages()} title="Image" aria-label="Insert image">
          <Icon name="image" />
        </button>
        <button className="icon-btn" onMouseDown={keep} onClick={() => toggleList("check")} title={`Checklist (${shortcut("Mod+Shift+9")})`} aria-label="Checklist">
          <Icon name="checklist" />
        </button>
        <MenuButton className="icon-btn" label="Dropdown" title="Dropdown" entries={dropdownEntries}>
          <Icon name="dropdown" />
        </MenuButton>
        <MenuButton className="icon-btn" label="More blocks" title="More" entries={moreEntries}>
          <Icon name="dots" />
        </MenuButton>
        <button className="icon-btn" aria-pressed={comments} onMouseDown={keep} onClick={() => togglePanel("comments")} title="Comments" aria-label="Comments">
          <Icon name="chat" />
        </button>
        <button
          className={`tb-ask${asking ? " on" : ""}`}
          aria-pressed={asking}
          onMouseDown={keep}
          onClick={() => {
            restoreSelection();
            setAsking(!asking);
          }}
          aria-label={`Ask ${ai.name}`}
        >
          Ask<span className="tb-ask-name"> {ai.name}</span>
        </button>
      </div>
      {newDropdown && <NewDropdownDialog onClose={() => setNewDropdown(false)} />}
    </div>
  );
}

/** Name a dropdown and its options (one per line), then put it at the caret. */
function NewDropdownDialog({ onClose }: { onClose(): void }) {
  const [name, setName] = useState("");
  const [options, setOptions] = useState("");
  const lines = [...new Set(options.split("\n").map((l) => l.trim()).filter(Boolean))].slice(0, 30);
  const ok = name.trim() && lines.length > 0;
  const create = async () => {
    if (!ok) return;
    onClose();
    const ids = new Set<string>();
    const opts = lines.map((label, i) => {
      let id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || `option-${i + 1}`;
      for (let k = 2; ids.has(id); k++) id = `${id.replace(/-\d+$/, "")}-${k}`;
      ids.add(id);
      return { id, label: label.slice(0, 60), color: OPTION_COLORS[i % OPTION_COLORS.length]! };
    });
    const made = await addDropdown({ name, options: opts });
    if (made) insertDropdown(made);
  };
  return (
    <Dialog title="New dropdown" onClose={onClose} width={400}>
      <form
        className="dd-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label htmlFor="dd-name">Name</label>
        <input id="dd-name" data-autofocus value={name} maxLength={60} placeholder="Status" onChange={(e) => setName(e.target.value)} />
        <label htmlFor="dd-options">Options, one per line</label>
        <textarea id="dd-options" rows={5} value={options} placeholder={"Not started\nIn progress\nDone"} onChange={(e) => setOptions(e.target.value)} />
        <div className="link-actions">
          <button type="submit" className="btn primary" disabled={!ok}>
            Add dropdown
          </button>
        </div>
      </form>
    </Dialog>
  );
}
