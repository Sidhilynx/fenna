// The tabs: every tab in the doc, nested as it is, with the open tab's
// headings beneath it. Each tab has a "…" menu (rename, duplicate, add a
// subtab, move, delete); a name is edited in place.

import { useEffect, useRef, useState } from "react";
import { type ElementNode, type TabRef, LIMITS, flattenTabs, tabLabel, tabMoves, textOf } from "@opendeck/doc";
import { Icon, MenuButton, type MenuEntry } from "@opendeck/shell";
import { pageEl } from "../editor/page.ts";
import { addTab, deleteTab, duplicateTab, goToTab, moveTab, renameTab, useDocs } from "../store.ts";

/** Headings of a tab, for its outline. */
export function outlineOf(tab: ElementNode | null | undefined): { id: string; level: number; text: string }[] {
  if (!tab) return [];
  return (tab.children as ElementNode[]).filter((b) => /^h[1-3]$/.test(b.tag)).map((b) => ({ id: b.attrs.id!, level: Number(b.tag[1]), text: textOf(b).replace(/\s+/g, " ").trim() || "Untitled heading" }));
}

export function scrollToBlock(id: string) {
  const el = pageEl()?.querySelector<HTMLElement>(`:scope > [id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/** A tab's "…" menu. */
export function tabEntries(tabs: TabRef[], id: string, onRename: () => void): MenuEntry[] {
  const flat = flattenTabs(tabs);
  const moves = tabMoves(tabs, id);
  const depth = flat.find((f) => f.ref.id === id)?.depth ?? 0;
  return [
    { label: "Rename", onSelect: onRename },
    { label: "Duplicate", onSelect: () => void duplicateTab(id) },
    { label: "Add subtab", disabled: depth + 1 >= LIMITS.tabDepth, onSelect: () => void addTab({ parent: id }) },
    {
      label: "Move",
      disabled: !(moves.up || moves.down || moves.into || moves.out),
      submenu: [
        { label: "Move up", disabled: !moves.up, onSelect: () => void moveTab(id, "up") },
        { label: "Move down", disabled: !moves.down, onSelect: () => void moveTab(id, "down") },
        { label: moves.intoTitle ? `Move into “${moves.intoTitle}”` : "Move into the tab above", disabled: !moves.into, onSelect: () => void moveTab(id, "into") },
        { label: "Move out one level", disabled: !moves.out, onSelect: () => void moveTab(id, "out") },
      ],
    },
    "separator",
    { label: "Delete tab", danger: true, disabled: flat.length <= 1, onSelect: () => void deleteTab(id) },
  ];
}

export function Sidebar() {
  const tabs = useDocs((s) => s.doc?.index.tabs ?? []);
  const current = useDocs((s) => s.tab);
  const outline = useDocs((s) => outlineOf(s.tab ? s.doc?.tabs.get(s.tab)?.tab : null));
  const [renaming, setRenaming] = useState<string | null>(null);
  const nav = useRef<HTMLElement>(null);
  const flat = flattenTabs(tabs);

  // The open tab stays in view, however long the list (opened from a link, the outline menu or the AI).
  useEffect(() => {
    nav.current?.querySelector(".sb-row.on")?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <nav ref={nav} className="sb" aria-label="Tabs">
      <ul className="sb-list" role="tree" aria-label="Tabs">
        {flat.map((f) => (
          <li key={f.ref.id} role="treeitem" aria-selected={f.ref.id === current} aria-level={f.depth + 1}>
            {renaming === f.ref.id ? (
              <RenameField id={f.ref.id} initial={f.ref.title || tabLabel(tabs, f.ref.id)} depth={f.depth} onDone={() => setRenaming(null)} />
            ) : (
              <div className={`sb-row${f.ref.id === current ? " on" : ""}`} style={{ paddingLeft: 10 + f.depth * 14 }}>
                <button className="sb-tab" onClick={() => void goToTab(f.ref.id)} onDoubleClick={() => setRenaming(f.ref.id)} title={tabLabel(tabs, f.ref.id)}>
                  {tabLabel(tabs, f.ref.id)}
                </button>
                <MenuButton className="icon-btn sb-more" label={`${tabLabel(tabs, f.ref.id)} options`} title="Tab options" entries={() => tabEntries(tabs, f.ref.id, () => setRenaming(f.ref.id))}>
                  <Icon name="dots" size={16} />
                </MenuButton>
              </div>
            )}
            {f.ref.id === current && outline.length > 0 && (
              <ul className="sb-outline" aria-label="Headings">
                {outline.map((h) => (
                  <li key={h.id}>
                    <button className="sb-heading" style={{ paddingLeft: 22 + f.depth * 14 + (h.level - 1) * 12 }} onClick={() => scrollToBlock(h.id)} title={h.text}>
                      {h.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <button className="sb-new" onClick={() => void addTab({ after: flat[flat.length - 1]?.ref.id ?? null })} disabled={flat.length >= LIMITS.tabs}>
        <Icon name="plus" size={16} /> New tab
      </button>
    </nav>
  );
}

function RenameField({ id, initial, depth, onDone }: { id: string; initial: string; depth: number; onDone(): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const save = () => {
    onDone();
    if (value.trim() && value.trim() !== initial) void renameTab(id, value);
  };
  return (
    <input
      ref={ref}
      id={`rename-${id}`}
      className="sb-rename"
      style={{ marginLeft: 4 + depth * 14 }}
      value={value}
      maxLength={200}
      aria-label="Tab name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") onDone();
      }}
    />
  );
}
