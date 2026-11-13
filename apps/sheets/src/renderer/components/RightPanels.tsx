// The column at the right: the chat, the comments, conditional formatting,
// or version history. One at a time; the header's close button and Esc put
// it away.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ColorScaleRule,
  type ConditionalRule,
  formatCellRef,
  formatCellValue,
  HIGHLIGHT_CONDITIONS,
  HIGHLIGHT_LABELS,
  type HighlightCondition,
  type HighlightRule,
  parseRangeRef,
} from "@opendeck/sheet";
import { ChatPanel, type ChatView, Icon, MenuButton, ThreadCard, shortcut } from "@opendeck/shell";
import { refreshAssistant, useAssistant } from "../assistant.ts";
import { comments, type SheetThread } from "../comments.ts";
import {
  addRule,
  askFor,
  currentSheet,
  deleteRule,
  getState,
  type HistorySnapshot,
  openRules,
  restoreVersion,
  selectionRangeStr,
  setActiveSheet,
  setAgent,
  setRightPanel,
  setSelection,
  setState,
  updateRule,
  useSheets,
} from "../store.ts";
import { sheetContext } from "./AskBar.tsx";
import { ColorPanel } from "./ColorPanel.tsx";

function PanelHead({ title, onBack, children }: { title: string; onBack?(): void; children?: React.ReactNode }) {
  return (
    <header className="rp-head">
      {onBack && (
        <button className="icon-btn" title="Back" aria-label="Back" onClick={onBack}>
          <Icon name="arrowLeft" size={16} />
        </button>
      )}
      <h2 className="rp-title">{title}</h2>
      {children}
      <button className="icon-btn" title="Close (Esc)" aria-label={`Close ${title.toLowerCase()}`} onClick={() => setRightPanel(null)}>
        <Icon name="close" size={16} />
      </button>
    </header>
  );
}

// ── Chat ─────────────────────────────────────────────────────────────────────

const SUGGESTIONS = ["Build a monthly budget with totals", "Add a column that totals each row", "Highlight overdue tasks in red", "Chart the selected cells"];

function sheetView(): ChatView | null {
  const s = getState();
  const sheet = currentSheet(s);
  const ctx = sheetContext(true);
  if (!sheet || !ctx) return null;
  return { context: ctx, label: `${sheet.title} · ${selectionRangeStr(s.selection)}` };
}

function AssistantPanel() {
  const draft = useSheets((s) => s.chatDraft);
  useSheets((s) => `${s.activeSheetId}|${selectionRangeStr(s.selection)}`);
  const taken = useCallback(() => setState({ chatDraft: "" }), []);
  return (
    <aside className="rp rp-chat" aria-label="Chat">
      <ChatPanel
        noun="sheet"
        view={sheetView()}
        suggestions={SUGGESTIONS}
        intro="Ask for a new sheet, or for changes to the cells you’ve selected."
        placeholder="Ask for a change, or describe a sheet to build"
        draft={draft}
        onDraftTaken={taken}
        onWorking={setAgent}
      />
    </aside>
  );
}

// ── Comments ─────────────────────────────────────────────────────────────────

type Show = "open" | "resolved" | "all";

function goTo(t: SheetThread) {
  const r = parseRangeRef(t.range);
  comments.openThread(t.id);
  if (!r || !getState().workbook?.sheets.has(t.sheetId)) return;
  setActiveSheet(t.sheetId);
  setSelection({ anchor: { r: r.r1, c: r.c1 }, focus: { r: r.r2, c: r.c2 }, mode: "cells" });
}

function CommentsPanel() {
  const ai = useAssistant();
  const threads = comments.use((s) => s.threads);
  const open = comments.use((s) => s.open);
  const working = comments.use((s) => s.working);
  const ask = comments.use((s) => s.askAssistant);
  const wb = useSheets((s) => s.workbook);
  const activeId = useSheets((s) => s.activeSheetId);
  const values = useSheets((s) => s.evaluated);
  const [show, setShow] = useState<Show>("open");
  const [everySheet, setEverySheet] = useState(true);
  const draft = open && "draft" in open ? open.draft : null;
  const openId = open && "thread" in open ? open.thread : null;
  const list = threads.filter((t) => (show === "all" || (show === "resolved") === t.resolved) && (everySheet || t.sheetId === activeId) && wb?.sheets.has(t.sheetId));
  const openCount = threads.filter((t) => !t.resolved).length;
  const where = (sheetId: string, range: string) => {
    const title = wb?.index.sheets.find((s) => s.id === sheetId)?.title ?? sheetId;
    const p = parseRangeRef(range);
    const sheet = wb?.sheets.get(sheetId)?.sheet;
    const ref = p ? formatCellRef(p.r1, p.c1) : range;
    const cell = sheet?.cells[ref];
    const text = cell && wb ? formatCellValue(values.get(sheetId)?.get(ref) ?? cell.v ?? null, cell, wb.index) : "";
    return `${wb && wb.index.sheets.length > 1 ? `${title} · ` : ""}${range}${text ? ` · ${text.length > 40 ? `${text.slice(0, 39)}…` : text}` : ""}`;
  };
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
            { heading: "Sheets" },
            { label: "All sheets", checked: everySheet, onSelect: () => setEverySheet(true) },
            { label: "This sheet", checked: !everySheet, onSelect: () => setEverySheet(false) },
            "separator",
            { label: `Send new comments to ${ai.name}`, checked: ask, onSelect: () => comments.setAskAssistant(!ask) },
          ]}
        >
          <Icon name="filter" size={16} />
        </MenuButton>
      </PanelHead>
      <div className="rp-body cm-list">
        {draft && (
          <ThreadCard
            key="draft"
            className="cm-card"
            thread={null}
            quote={where(draft.sheetId, draft.range)}
            askAssistant={ask}
            onAskAssistant={comments.setAskAssistant}
            onSend={(text) => {
              const id = comments.add({ draft }, text);
              if (id) comments.openThread(id);
            }}
            onClose={() => comments.openThread(null)}
          />
        )}
        {list.map((t) => (
          <div key={t.id} className="cm-item">
            {t.resolved && <div className="cm-resolved">Resolved</div>}
            <ThreadCard
              className="cm-card"
              thread={t}
              quote={where(t.sheetId, t.range)}
              working={working[t.id]}
              askAssistant={ask}
              onAskAssistant={comments.setAskAssistant}
              collapsed={t.id !== openId}
              autoFocus={false}
              onExpand={() => goTo(t)}
              onSend={(text) => comments.add({ thread: t.id }, text)}
              onResolve={t.resolved ? undefined : () => comments.resolve(t.id)}
              onDelete={() => comments.remove(t.id)}
              onClose={() => comments.openThread(null)}
            />
          </div>
        ))}
        {!list.length && !draft && (
          <div className="rp-empty">
            <p>{show === "open" ? (threads.length ? "No open comments" : "No comments yet") : show === "resolved" ? "No resolved comments" : "No comments yet"}</p>
            <p className="rp-hint">Select cells and press {shortcut("Mod+Alt+M")} to comment.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Conditional formatting ───────────────────────────────────────────────────

const DEFAULT_HIGHLIGHT = { fill: "#17381b", color: "#6ee07e" };
const SCALES: { name: string; min: string; mid?: string; max: string }[] = [
  { name: "Red to green", min: "#c23636", mid: "#b57818", max: "#238a31" },
  { name: "Green to red", min: "#238a31", mid: "#b57818", max: "#c23636" },
  { name: "White to blue", min: "#ffffff", max: "#226dc2" },
  { name: "White to green", min: "#ffffff", max: "#238a31" },
];

function ruleText(rule: ConditionalRule): string {
  if (rule.kind === "colorScale") return "Color scale";
  const v = rule.condition === "between" ? `${rule.values[0] ?? ""} and ${rule.values[1] ?? ""}` : (rule.values[0] ?? "");
  return `${HIGHLIGHT_LABELS[rule.condition]}${rule.condition === "empty" || rule.condition === "not_empty" ? "" : ` ${v}`}`;
}

function Swatch({ value, none, label, onPick }: { value: string | undefined; none: string; label: string; onPick(c: string | undefined): void }) {
  const [open, setOpen] = useState<HTMLElement | null>(null);
  return (
    <>
      <button className="rp-swatch-btn" aria-label={label} title={label} onClick={(e) => setOpen(open ? null : e.currentTarget)}>
        <span className={`rp-swatch${value ? "" : " none"}`} style={value ? { background: value } : undefined} />
        <span>{label}</span>
      </button>
      {open && <ColorPanel anchor={open} place="beside" none={none} value={value} onPick={onPick} onClose={() => setOpen(null)} />}
    </>
  );
}

function RuleEditor({ id, kind }: { id: string | null; kind: "highlight" | "colorScale" }) {
  const sheet = useSheets((s) => currentSheet(s));
  const existing = sheet?.rules.find((r) => r.id === id) ?? null;
  const h = existing?.kind === "highlight" ? existing : null;
  const c = existing?.kind === "colorScale" ? existing : null;
  const [range, setRange] = useState(existing?.range ?? selectionRangeStr());
  const [condition, setCondition] = useState<HighlightCondition>(h?.condition ?? "gt");
  const [v1, setV1] = useState(h?.values[0] ?? "");
  const [v2, setV2] = useState(h?.values[1] ?? "");
  const [style, setStyle] = useState<HighlightRule["style"]>(h?.style ?? DEFAULT_HIGHLIGHT);
  const [scale, setScale] = useState({ min: c?.minColor ?? SCALES[0]!.min, mid: c ? c.midColor : SCALES[0]!.mid, max: c?.maxColor ?? SCALES[0]!.max });
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  if (!sheet) return null;
  const back = () => openRules({ view: "list" });
  const parsed = parseRangeRef(range.replace(/\s+/g, ""));
  const needs = condition === "empty" || condition === "not_empty" ? 0 : condition === "between" ? 2 : 1;
  const ok = !!parsed && (needs < 1 || v1.trim() !== "") && (needs < 2 || v2.trim() !== "");
  const save = async () => {
    if (!ok) return;
    const ruleId = existing?.id ?? `rule-${crypto.randomUUID().slice(0, 6)}`;
    const cleanRange = range.replace(/\s+/g, "").toUpperCase();
    const rule: ConditionalRule =
      kind === "highlight"
        ? ({ id: ruleId, kind: "highlight", range: cleanRange, condition, values: [v1, v2].slice(0, needs), style } satisfies HighlightRule)
        : ({ id: ruleId, kind: "colorScale", range: cleanRange, minColor: scale.min, ...(scale.mid ? { midColor: scale.mid } : {}), maxColor: scale.max } satisfies ColorScaleRule);
    await (existing ? updateRule(rule) : addRule(rule));
    back();
  };
  return (
    <aside className="rp" aria-label="Conditional formatting">
      <PanelHead title={kind === "highlight" ? "Highlight rule" : "Color scale rule"} onBack={back} />
      <form
        className="rp-body rp-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="rp-field">
          <span>Apply to</span>
          <span className="rp-inline">
            <input ref={first} value={range} onChange={(e) => setRange(e.target.value)} aria-invalid={!parsed} spellCheck={false} placeholder="B2:B20" />
            <button type="button" className="btn ghost" onClick={() => setRange(selectionRangeStr())}>
              Use selection
            </button>
          </span>
          {!parsed && <span className="rp-error">Write a range like B2:B20.</span>}
        </label>
        {kind === "highlight" ? (
          <>
            <div className="rp-field">
              <span>Format cells if</span>
              <MenuButton className="btn rp-select" label="Condition" entries={() => HIGHLIGHT_CONDITIONS.map((k) => ({ label: HIGHLIGHT_LABELS[k], checked: k === condition, onSelect: () => setCondition(k) }))}>
                <span>{HIGHLIGHT_LABELS[condition]}</span>
                <Icon name="chevronDown" size={14} />
              </MenuButton>
            </div>
            {needs > 0 && (
              <label className="rp-field">
                <span>{condition === "formula" ? "Formula (THIS is the cell)" : needs === 2 ? "From" : "Value"}</span>
                <input value={v1} onChange={(e) => setV1(e.target.value)} placeholder={condition === "formula" ? "=THIS>AVERAGE($B$2:$B$20)" : "0"} spellCheck={false} />
              </label>
            )}
            {needs > 1 && (
              <label className="rp-field">
                <span>To</span>
                <input value={v2} onChange={(e) => setV2(e.target.value)} placeholder="100" />
              </label>
            )}
            <div className="rp-field">
              <span>Style</span>
              <div className="rp-style">
                <span className="rp-preview" style={{ background: style.fill, color: style.color, fontWeight: style.bold ? 600 : undefined, fontStyle: style.italic ? "italic" : undefined }}>
                  123
                </span>
                <button type="button" className={`icon-btn${style.bold ? " on" : ""}`} aria-pressed={!!style.bold} title="Bold" aria-label="Bold" onClick={() => setStyle({ ...style, bold: !style.bold || undefined })}>
                  <Icon name="bold" size={16} />
                </button>
                <button type="button" className={`icon-btn${style.italic ? " on" : ""}`} aria-pressed={!!style.italic} title="Italic" aria-label="Italic" onClick={() => setStyle({ ...style, italic: !style.italic || undefined })}>
                  <Icon name="italic" size={16} />
                </button>
              </div>
              <div className="rp-swatches">
                <Swatch value={style.color} none="Automatic" label="Text" onPick={(c) => setStyle({ ...style, color: c })} />
                <Swatch value={style.fill} none="None" label="Fill" onPick={(c) => setStyle({ ...style, fill: c })} />
              </div>
            </div>
          </>
        ) : (
          <div className="rp-field">
            <span>Colors</span>
            <span className="rp-scale" style={{ background: `linear-gradient(90deg, ${scale.min}, ${scale.mid ?? scale.min}, ${scale.max})` }} aria-hidden />
            <div className="rp-swatches">
              <Swatch value={scale.min} none="White" label="Lowest" onPick={(c) => setScale({ ...scale, min: c ?? "#ffffff" })} />
              <Swatch value={scale.mid} none="None" label="Middle" onPick={(c) => setScale({ ...scale, mid: c })} />
              <Swatch value={scale.max} none="White" label="Highest" onPick={(c) => setScale({ ...scale, max: c ?? "#ffffff" })} />
            </div>
            <div className="rp-presets">
              {SCALES.map((p) => (
                <button key={p.name} type="button" className="rp-preset" title={p.name} aria-label={p.name} style={{ background: `linear-gradient(90deg, ${p.min}, ${p.mid ?? p.min}, ${p.max})` }} onClick={() => setScale({ min: p.min, mid: p.mid, max: p.max })} />
              ))}
            </div>
          </div>
        )}
        <div className="rp-actions">
          {existing && (
            <button type="button" className="btn ghost danger" onClick={() => void deleteRule(existing.id).then(back)}>
              Delete
            </button>
          )}
          <span className="rp-fill" />
          <button type="button" className="btn ghost" onClick={back}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ok}>
            Done
          </button>
        </div>
      </form>
    </aside>
  );
}

function RulesPanel() {
  const view = useSheets((s) => s.rules);
  const sheet = useSheets((s) => currentSheet(s));
  const ai = useAssistant();
  const [ask, setAsk] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (view.view === "create") input.current?.focus();
  }, [view.view]);
  if (!sheet) return null;
  if (view.view === "edit") return <RuleEditor key={view.id ?? `new-${view.kind}`} id={view.id} kind={view.kind} />;
  if (view.view === "create")
    return (
      <aside className="rp" aria-label="Conditional formatting">
        <PanelHead title="Create rule" onBack={() => openRules({ view: "list" })} />
        <div className="rp-body">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!ask.trim()) return;
              void refreshAssistant();
              askFor(`Add a conditional formatting rule on ${selectionRangeStr()}: ${ask.trim()}`);
              setAsk("");
            }}
          >
            <input ref={input} className="rp-ask" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={`Ask ${ai.name} to make a rule`} aria-label={`Ask ${ai.name} to make a rule`} />
          </form>
          <button className="rp-choice" onClick={() => openRules({ view: "edit", id: null, kind: "highlight" })}>
            <Icon name="highlightRule" size={16} /> Add highlight rule
          </button>
          <button className="rp-choice" onClick={() => openRules({ view: "edit", id: null, kind: "colorScale" })}>
            <Icon name="colorScale" size={16} /> Add color scale rule
          </button>
        </div>
      </aside>
    );
  return (
    <aside className="rp" aria-label="Conditional formatting">
      <PanelHead title="Conditional formatting" />
      <div className="rp-body">
        <button className="rp-choice" onClick={() => openRules({ view: "create" })}>
          <Icon name="plus" size={16} /> Create rule
        </button>
        {sheet.rules.map((rule) => (
          <div key={rule.id} className="rp-rule">
            <button className="rp-rule-open" onClick={() => openRules({ view: "edit", id: rule.id, kind: rule.kind })}>
              {rule.kind === "highlight" ? (
                <span className="rp-preview small" style={{ background: rule.style.fill, color: rule.style.color, fontWeight: rule.style.bold ? 600 : undefined }}>
                  123
                </span>
              ) : (
                <span className="rp-preview small" style={{ background: `linear-gradient(90deg, ${rule.minColor}, ${rule.midColor ?? rule.minColor}, ${rule.maxColor})` }} />
              )}
              <span className="rp-rule-text">
                <span>{ruleText(rule)}</span>
                <span className="rp-rule-range">{rule.range}</span>
              </span>
            </button>
            <button className="icon-btn rp-rule-del" title="Delete rule" aria-label={`Delete rule on ${rule.range}`} onClick={() => void deleteRule(rule.id)}>
              <Icon name="trash" size={15} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

// ── Version history ──────────────────────────────────────────────────────────

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
  const history = useSheets((s) => s.history);
  return (
    <aside className="rp" aria-label="Version history">
      <PanelHead title="Version history" />
      <div className="rp-body vh-list">
        {history.map((snap: HistorySnapshot, i) => (
          <div key={snap.id} className="vh-item">
            <div className="vh-when">
              {when(snap.at)}
              {i === 0 && <span className="vh-current">Current</span>}
            </div>
            <div className="vh-who">
              <span className="c-avatar">{snap.author.slice(0, 1).toUpperCase()}</span>
              <span>{snap.author}</span>
              {snap.label && <span className="vh-what">· {snap.label}</span>}
            </div>
            {i > 0 && (
              <MenuButton className="icon-btn vh-more" label="Version actions" title="More" align="end" entries={() => [{ label: "Restore this version", onSelect: () => void restoreVersion(snap) }]}>
                <Icon name="dots" size={16} />
              </MenuButton>
            )}
          </div>
        ))}
        {!history.length && <div className="rp-empty">Versions appear here as the sheet changes.</div>}
      </div>
    </aside>
  );
}

export function RightPanels() {
  const panel = useSheets((s) => s.rightPanel);
  if (panel === "rules") return <RulesPanel />;
  if (panel === "comments") return <CommentsPanel />;
  if (panel === "history") return <HistoryPanel />;
  if (panel === "chat") return <AssistantPanel />;
  return null;
}
