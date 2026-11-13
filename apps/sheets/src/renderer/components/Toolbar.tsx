// The toolbar floating at the bottom of the sheet, the quick bar over it on
// an empty sheet, and the Ask box. What the toolbar offers follows the
// selection (cells get the cell types; whole columns get filter, insert and
// wrap), and in a narrow window the less used groups move into "…".

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon, type IconName, Menu, type MenuEntry, type MenuPrompt, shortcut } from "@opendeck/shell";
import { AssistantMark, useAssistant } from "../assistant.ts";
import {
  askFor,
  currentSheet,
  importCsvFile,
  importXlsxFile,
  insertColsAt,
  insertRowsAt,
  mergeSelection,
  selectionBounds,
  selectionRangeStr,
  setCellType,
  setState,
  styleSelection,
  toggleStyleProp,
  unmergeSelection,
  useSheets,
} from "../store.ts";
import { AskBar } from "./AskBar.tsx";
import { BordersPanel } from "./BordersPanel.tsx";
import { ColorPanel } from "./ColorPanel.tsx";
import {
  activeStyle,
  alignEntries,
  cellMenuEntries,
  chartEntries,
  commentOnSelection,
  dropdownEntries,
  filterEntries,
  insertDate,
  insertEntries,
  numberFormatEntries,
  ruleEntries,
  underlineEntries,
  wrapEntries,
} from "./menus.tsx";

type Open =
  | { kind: "menu"; anchor: HTMLElement; entries: MenuEntry[]; label: string; prompt?: MenuPrompt }
  | { kind: "color"; anchor: HTMLElement; which: "color" | "fill" }
  | { kind: "borders"; anchor: HTMLElement };

const ALIGN_ICON: Record<string, IconName> = { auto: "alignLeft", left: "alignLeft", center: "alignCenter", right: "alignRight" };

/** How much of the toolbar fits: 2 everything, 1 without the contextual group, 0 without charts and rules too. */
function useFit(host: React.RefObject<HTMLElement | null>): number {
  const [fit, setFit] = useState(2);
  useEffect(() => {
    const el = host.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setFit(w >= 800 ? 2 : w >= 620 ? 1 : 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [host]);
  return fit;
}

export function Toolbar() {
  const sheet = useSheets((s) => currentSheet(s));
  const mode = useSheets((s) => s.selection.mode);
  const asking = useSheets((s) => s.asking);
  const editing = useSheets((s) => !!s.editing);
  const rightPanel = useSheets((s) => s.rightPanel);
  useSheets((s) => s.selection);
  useSheets((s) => s.workbook);
  const ai = useAssistant();
  const [open, setOpen] = useState<Open | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const fit = useFit(host);
  if (!sheet) return null;

  const style = activeStyle();
  const empty = Object.keys(sheet.cells).length === 0;
  const close = () => setOpen(null);
  const menu = (e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, label: string, entries: () => MenuEntry[], prompt?: MenuPrompt) => {
    const anchor = e.currentTarget;
    setOpen((o) => (o?.kind === "menu" && o.anchor === anchor ? null : { kind: "menu", anchor, entries: entries(), label, prompt }));
  };
  const ask = (lead: string): MenuPrompt => ({ placeholder: `Ask ${ai.name} to ${lead}`, onSubmit: (t) => askFor(t) });

  const button = (p: { icon: ReactNode; title: string; on?: boolean; label?: string; onClick(e: React.MouseEvent<HTMLButtonElement>): void; caret?: boolean; menuFor?: string }) => (
    <button
      className={`tb-btn${p.on ? " on" : ""}${p.caret ? " caret" : ""}`}
      title={p.title}
      aria-label={p.label ?? p.title}
      aria-pressed={p.on === undefined ? undefined : p.on}
      aria-haspopup={p.menuFor ? "menu" : undefined}
      aria-expanded={p.menuFor ? open?.kind === "menu" && open.label === p.menuFor : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={p.onClick}
    >
      {p.icon}
      {p.caret && <Icon name="chevronDown" size={12} className="tb-caret" />}
    </button>
  );

  const colorBar = (which: "color" | "fill", glyph: IconName, title: string) => {
    const value = which === "color" ? style.color : style.fill;
    return (
      <button
        className={`tb-btn tb-color${open?.kind === "color" && open.which === which ? " on" : ""}`}
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const anchor = e.currentTarget;
          setOpen((o) => (o?.kind === "color" && o.which === which ? null : { kind: "color", anchor, which }));
        }}
      >
        <Icon name={glyph} size={18} />
        <span className={`tb-swatch${value ? "" : " none"}`} style={value ? { background: value } : undefined} />
      </button>
    );
  };

  const contextual = mode === "cols" || mode === "rows";
  const b = selectionBounds();
  const groupMore: MenuEntry[] = [];
  if (fit < 1) {
    groupMore.push(
      { label: "Borders", icon: <Icon name="borders" size={16} />, onSelect: () => host.current && setOpen({ kind: "borders", anchor: host.current.querySelector<HTMLElement>(".tb-more-wrap button") ?? host.current }) },
      { label: "Conditional formatting", icon: <Icon name="condFormat" size={16} />, submenu: ruleEntries() },
      { label: "Chart", icon: <Icon name="chartBar" size={16} />, submenu: chartEntries(<AssistantMark size={16} />) },
    );
  }
  if (fit < 2 && contextual) groupMore.push({ label: "Filter and sort", icon: <Icon name="filter" size={16} />, submenu: filterEntries() }, { label: "Text wrapping", icon: <Icon name="wrapText" size={16} />, submenu: wrapEntries() });
  const merged = sheet.merges.some((m) => m.r1 <= b.r2 && m.r2 >= b.r1 && m.c1 <= b.c2 && m.c2 >= b.c1);
  const moreEntries = (): MenuEntry[] => [
    ...groupMore,
    ...(groupMore.length ? ["separator" as const] : []),
    { label: merged ? "Unmerge cells" : "Merge cells", icon: <Icon name="merge" size={16} />, disabled: !merged && b.r1 === b.r2 && b.c1 === b.c2, onSelect: () => void (merged ? unmergeSelection() : mergeSelection()) },
    { label: "Insert", icon: <Icon name="plus" size={16} />, submenu: insertEntries() },
    { label: "More actions", icon: <Icon name="dots" size={16} />, submenu: cellMenuEntries(mode === "cols" ? "col" : mode === "rows" ? "row" : "cell") },
  ];

  return (
    <div ref={host} className="tb-layer">
      {empty && !asking && !editing && (
        <div className="tb-quick" role="toolbar" aria-label="Start">
          <button className="tb-quick-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => setState({ asking: true })}>
            <AssistantMark size={16} /> Ask {ai.name}
          </button>
          <button className="tb-quick-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => void importCsvFile()}>
            <Icon name="csv" size={16} /> Import CSV
          </button>
          <button className="tb-quick-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => void importXlsxFile()}>
            <Icon name="excel" size={16} /> Import from Excel
          </button>
        </div>
      )}
      {asking && <AskBar />}
      <div
        className="tb-dock"
        role="toolbar"
        aria-label="Format"
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          const list = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
          const i = list.indexOf(document.activeElement as HTMLButtonElement);
          if (i < 0) return;
          e.preventDefault();
          list[(i + (e.key === "ArrowRight" ? 1 : list.length - 1)) % list.length]?.focus();
        }}
      >
        {button({ icon: <Icon name="bold" size={18} />, title: `Bold (${shortcut("Mod+B")})`, label: "Bold", on: !!style.bold, onClick: () => void toggleStyleProp("bold") })}
        {button({ icon: <Icon name="italic" size={18} />, title: `Italic (${shortcut("Mod+I")})`, label: "Italic", on: !!style.italic, onClick: () => void toggleStyleProp("italic") })}
        <span className="tb-split">
          {button({ icon: <Icon name="underline" size={18} />, title: `Underline (${shortcut("Mod+U")})`, label: "Underline", on: !!style.underline, onClick: () => void toggleStyleProp("underline") })}
          <button className="tb-btn tb-chev" title="Underline and strikethrough" aria-label="Underline and strikethrough" aria-haspopup="menu" onMouseDown={(e) => e.preventDefault()} onClick={(e) => menu(e, "Underline", underlineEntries)}>
            <Icon name="chevronDown" size={12} />
          </button>
        </span>
        {button({ icon: <Icon name={ALIGN_ICON[style.alignH ?? "auto"]!} size={18} />, title: "Alignment, size and wrapping", caret: true, menuFor: "Alignment", onClick: (e) => menu(e, "Alignment", alignEntries) })}
        <span className="tb-sep" />
        {colorBar("color", "textColor", "Text color")}
        {colorBar("fill", "fillBucket", "Fill color")}
        {fit >= 1 && (
          <>
            {button({ icon: <Icon name="borders" size={18} />, title: "Borders", on: open?.kind === "borders", onClick: (e) => setOpen(open?.kind === "borders" ? null : { kind: "borders", anchor: e.currentTarget }) })}
            {button({ icon: <Icon name="condFormat" size={18} />, title: "Conditional formatting", menuFor: "Conditional formatting", onClick: (e) => menu(e, "Conditional formatting", ruleEntries, ask("make a rule")) })}
            {button({ icon: <Icon name="chartBar" size={18} />, title: "Chart", menuFor: "Chart", onClick: (e) => menu(e, "Chart", () => chartEntries(<AssistantMark size={16} />), ask("make a chart")) })}
          </>
        )}
        <span className="tb-sep" />
        {button({
          icon: <Icon name="number" size={18} />,
          title: "Number format",
          caret: true,
          menuFor: "Number format",
          onClick: (e) => menu(e, "Number format", numberFormatEntries, { placeholder: "Find a format, or describe one", filter: true, onSubmit: (t) => askFor(`Format ${selectionRangeStr()} as: ${t}`) }),
        })}
        {fit >= 2 &&
          (contextual ? (
            <>
              {button({ icon: <Icon name="filter" size={18} />, title: "Filter and sort", on: !!sheet.filter, menuFor: "Filter", onClick: (e) => menu(e, "Filter", filterEntries, ask("show the rows you want")) })}
              {mode === "cols"
                ? button({
                    icon: <Icon name="insertColRight" size={18} />,
                    title: "Insert column",
                    caret: true,
                    menuFor: "Insert column",
                    onClick: (e) =>
                      menu(e, "Insert column", () => [
                        { label: "Insert column left", icon: <Icon name="insertColLeft" size={16} />, shortcut: shortcut("Mod+Alt+="), onSelect: () => void insertColsAt(b.c1, b.c2 - b.c1 + 1) },
                        { label: "Insert column right", icon: <Icon name="insertColRight" size={16} />, onSelect: () => void insertColsAt(b.c2 + 1, b.c2 - b.c1 + 1) },
                      ]),
                  })
                : button({
                    icon: <Icon name="insertRowBelow" size={18} />,
                    title: "Insert row",
                    caret: true,
                    menuFor: "Insert row",
                    onClick: (e) =>
                      menu(e, "Insert row", () => [
                        { label: "Insert row above", icon: <Icon name="insertRowAbove" size={16} />, shortcut: shortcut("Mod+Alt+="), onSelect: () => void insertRowsAt(b.r1, b.r2 - b.r1 + 1) },
                        { label: "Insert row below", icon: <Icon name="insertRowBelow" size={16} />, onSelect: () => void insertRowsAt(b.r2 + 1, b.r2 - b.r1 + 1) },
                      ]),
                  })}
              {button({ icon: <Icon name="wrapText" size={18} />, title: "Text wrapping", caret: true, menuFor: "Text wrapping", onClick: (e) => menu(e, "Text wrapping", wrapEntries) })}
            </>
          ) : (
            <>
              <span className="tb-sep" />
              {button({ icon: <Icon name="dropdownChip" size={18} />, title: "Dropdown", menuFor: "Dropdown", onClick: (e) => menu(e, "Dropdown", () => dropdownEntries()) })}
              {button({ icon: <Icon name="person" size={18} />, title: "Person", onClick: () => void setCellType({ t: "person" }) })}
              {button({ icon: <Icon name="calendar" size={18} />, title: "Date", onClick: () => void insertDate() })}
              {button({ icon: <Icon name="checkbox" size={18} />, title: "Checkbox", onClick: () => void setCellType({ t: "checkbox" }) })}
            </>
          ))}
        <span className="tb-more-wrap">{button({ icon: <Icon name="dots" size={18} />, title: "More", menuFor: "More", onClick: (e) => menu(e, "More", moreEntries) })}</span>
        <span className="tb-sep" />
        {button({ icon: <Icon name="chat" size={18} />, title: `Comment (${shortcut("Mod+Alt+M")})`, on: rightPanel === "comments", onClick: commentOnSelection })}
        <button className={`tb-ask${asking ? " on" : ""}`} aria-pressed={asking} onMouseDown={(e) => e.preventDefault()} onClick={() => setState({ asking: !asking })} title={`Ask ${ai.name} (${shortcut("Mod+K")})`}>
          Ask {ai.name}
        </button>
      </div>
      {open?.kind === "menu" && <Menu anchor={open.anchor} entries={open.entries} label={open.label} prompt={open.prompt} onClose={close} />}
      {open?.kind === "color" && (
        <ColorPanel
          anchor={open.anchor}
          none={open.which === "fill" ? "None" : "Automatic"}
          value={open.which === "fill" ? style.fill : style.color}
          onPick={(c) => void styleSelection(open.which === "fill" ? { fill: c } : { color: c })}
          onClose={close}
        />
      )}
      {open?.kind === "borders" && <BordersPanel anchor={open.anchor} onClose={close} />}
    </div>
  );
}
