// The menus behind the toolbar and the right-click menu, built from the
// format's own lists (number formats, font sizes, wrap modes, dropdowns).

import {
  CHART_TYPES,
  type CellStyle,
  colToLetter,
  DEFAULT_FONT_SIZE,
  DROPDOWN_TEMPLATES,
  FONT_SIZES,
  formatCellRef,
  formatCellValue,
  localeInfo,
  NUMBER_FORMATS,
  type NumberFormatKind,
  serialOf,
  type SheetData,
  timeZoneOption,
  WRAP_MODES,
} from "@opendeck/sheet";
import { Icon, type IconName, type MenuEntry, shortcut } from "@opendeck/shell";
import { comments } from "../comments.ts";
import {
  activeCellRef,
  addChartFromSelection,
  askFor,
  clearSelection,
  copySelection,
  currentSheet,
  deleteColsAt,
  deleteRowsAt,
  ensureTemplateDropdown,
  freezeAt,
  getState,
  groupSelection,
  insertColsAt,
  insertRowsAt,
  mergeSelection,
  moveColumn,
  openRules,
  pasteSelection,
  selectionBounds,
  selectionHasData,
  selectionRangeStr,
  setCellType,
  setRightPanel,
  setState,
  sortActiveSheet,
  styleSelection,
  tableAround,
  toggleFilter,
  toggleStyleProp,
  ungroupSelection,
  unmergeSelection,
} from "../store.ts";

const icon = (name: IconName) => <Icon name={name} size={16} />;

/** The style of the active cell, for checks and asides. */
export function activeStyle(): CellStyle {
  return currentSheet()?.cells[activeCellRef()]?.s ?? {};
}

/** Start a comment on the selection. */
export function commentOnSelection() {
  const sheet = currentSheet();
  if (!sheet) return;
  comments.draft({ sheetId: sheet.id, range: selectionRangeStr() });
  setRightPanel("comments");
}

// ── Number formats ───────────────────────────────────────────────────────────

const SAMPLE_DATE = serialOf(2026, 3, 15, 14, 30);
const SAMPLE_DURATION = (25 * 3600 + 63) / 86_400;
const FORMAT_ICON: Partial<Record<NumberFormatKind, IconName>> = { percent: "percent", scientific: "superscript", time: "clock", datetime: "calendar", duration: "timer" };

/** What a format looks like in this workbook's locale. */
function example(kind: NumberFormatKind): string {
  const wb = getState().workbook;
  if (!wb) return "";
  const group = NUMBER_FORMATS.find((f) => f.kind === kind)?.group;
  const n = kind === "percent" ? 0.125 : kind === "duration" ? SAMPLE_DURATION : group === "datetime" ? SAMPLE_DATE : 1234.5;
  return formatCellValue(n, { s: { numFmt: kind } }, wb.index);
}

function formatItem(kind: NumberFormatKind, current: NumberFormatKind): MenuEntry {
  const f = NUMBER_FORMATS.find((x) => x.kind === kind)!;
  const group = f.group;
  return {
    label: f.label,
    icon: icon(FORMAT_ICON[kind] ?? (group === "currency" ? "dollar" : group === "datetime" ? "calendar" : "number")),
    aside: example(kind),
    checked: current === kind,
    onSelect: () => void styleSelection({ numFmt: kind, customFmt: undefined }),
  };
}

export function numberFormatEntries(): MenuEntry[] {
  const wb = getState().workbook;
  const cur = activeStyle().numFmt ?? "auto";
  const group = (g: "number" | "currency" | "datetime") => NUMBER_FORMATS.filter((f) => f.group === g).map((f) => formatItem(f.kind, cur));
  const inGroup = (g: string) => NUMBER_FORMATS.some((f) => f.group === g && f.kind === cur);
  return [
    { label: "Checkbox", icon: icon("checkbox"), onSelect: () => void setCellType({ t: "checkbox" }) },
    { label: "Dropdown", icon: icon("dropdownChip"), submenu: dropdownEntries() },
    { label: "Person", icon: icon("person"), onSelect: () => void setCellType({ t: "person" }) },
    "separator",
    formatItem("auto", cur),
    "separator",
    { label: "Number", icon: icon("number"), checked: inGroup("number") || undefined, submenu: group("number") },
    { label: "Currency", icon: icon("dollar"), checked: inGroup("currency") || undefined, submenu: group("currency") },
    { label: "Date and time", icon: icon("calendar"), checked: inGroup("datetime") || undefined, submenu: group("datetime") },
    "separator",
    { label: "Custom format", icon: icon("sliders"), checked: cur === "custom" || undefined, onSelect: () => setState({ dialog: "customFormat" }) },
    "separator",
    { heading: "Sheet settings" },
    { label: "Locale", icon: icon("globe"), aside: wb ? localeInfo(wb.index.locale).label : "", onSelect: () => setState({ dialog: "locale" }) },
    { label: "Time zone", icon: icon("clock"), aside: wb ? timeZoneOption(wb.index.timeZone).name : "", onSelect: () => setState({ dialog: "timezone" }) },
  ];
}

// ── Cell types ───────────────────────────────────────────────────────────────

export function dropdownEntries(at?: { r: number; c: number }): MenuEntry[] {
  const wb = getState().workbook;
  const own = wb?.index.dropdowns ?? [];
  const lists = [...own, ...DROPDOWN_TEMPLATES.filter((t) => !own.some((d) => d.id === t.id))];
  const sheet = currentSheet();
  const cell = sheet?.cells[at ? formatCellRef(at.r, at.c) : activeCellRef()];
  const current = cell?.t === "dropdown" ? cell.dropdownId : undefined;
  return [
    ...lists.map((d) => ({
      label: d.name,
      checked: d.id === current || undefined,
      aside: `${d.options.length} option${d.options.length === 1 ? "" : "s"}`,
      onSelect: async () => {
        const made = own.some((o) => o.id === d.id) ? d : await ensureTemplateDropdown(d.id);
        if (made) await setCellType({ t: "dropdown", dropdownId: made.id }, at);
      },
    })),
    "separator" as const,
    { label: "New dropdown…", icon: icon("plus"), onSelect: () => setState({ dialog: "newDropdown" }) },
  ];
}

export function insertEntries(): MenuEntry[] {
  return [
    { label: "Dropdown", icon: icon("dropdownChip"), submenu: dropdownEntries() },
    { label: "Person", icon: icon("person"), onSelect: () => void setCellType({ t: "person" }) },
    { label: "Date", icon: icon("calendar"), onSelect: () => void insertDate() },
    { label: "Checkbox", icon: icon("checkbox"), onSelect: () => void setCellType({ t: "checkbox" }) },
  ];
}

/** Date cells, filled with today where empty. */
export async function insertDate() {
  const now = new Date();
  const today = serialOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const sheet = currentSheet();
  const empty = !sheet?.cells[activeCellRef()]?.v;
  await setCellType({ t: "date", ...(empty ? { v: today } : {}) });
}

// ── Text ─────────────────────────────────────────────────────────────────────

const WRAP_LABEL: Record<(typeof WRAP_MODES)[number], string> = { overflow: "Overflow", wrap: "Wrap" };

export function wrapEntries(): MenuEntry[] {
  const cur = activeStyle().wrap ?? "overflow";
  return WRAP_MODES.map((w) => ({ label: WRAP_LABEL[w], checked: cur === w, onSelect: () => void styleSelection({ wrap: w }) }));
}

export function alignEntries(): MenuEntry[] {
  const s = activeStyle();
  const h = s.alignH ?? "auto";
  const v = s.alignV ?? "top";
  const size = s.fontSize ?? DEFAULT_FONT_SIZE;
  return [
    { label: "Left", icon: icon("alignLeft"), checked: h === "left", onSelect: () => void styleSelection({ alignH: "left" }) },
    { label: "Center", icon: icon("alignCenter"), checked: h === "center", onSelect: () => void styleSelection({ alignH: "center" }) },
    { label: "Right", icon: icon("alignRight"), checked: h === "right", onSelect: () => void styleSelection({ alignH: "right" }) },
    { label: "Automatic", hint: "By what each cell holds", icon: icon("autoAlign"), checked: h === "auto", onSelect: () => void styleSelection({ alignH: undefined }) },
    "separator",
    { label: "Top", icon: icon("alignTop"), checked: v === "top", onSelect: () => void styleSelection({ alignV: undefined }) },
    { label: "Middle", icon: icon("alignMiddle"), checked: v === "middle", onSelect: () => void styleSelection({ alignV: "middle" }) },
    { label: "Bottom", icon: icon("alignBottom"), checked: v === "bottom", onSelect: () => void styleSelection({ alignV: "bottom" }) },
    "separator",
    {
      label: "Font size",
      icon: icon("textSize"),
      aside: String(size),
      submenu: FONT_SIZES.map((n) => ({ label: String(n), checked: n === size, onSelect: () => void styleSelection({ fontSize: n === DEFAULT_FONT_SIZE ? undefined : n }) })),
    },
    { label: "Text wrapping", icon: icon("wrapText"), aside: WRAP_LABEL[s.wrap ?? "overflow"], submenu: wrapEntries() },
  ];
}

export function underlineEntries(): MenuEntry[] {
  const s = activeStyle();
  return [
    { label: "Underline", icon: icon("underline"), shortcut: shortcut("Mod+U"), checked: !!s.underline, onSelect: () => void toggleStyleProp("underline") },
    { label: "Strikethrough", icon: icon("strike"), shortcut: shortcut("Mod+Shift+X"), checked: !!s.strike, onSelect: () => void toggleStyleProp("strike") },
  ];
}

// ── Charts, rules, filters ───────────────────────────────────────────────────

const CHART_LABEL: Record<(typeof CHART_TYPES)[number], string> = { bar: "Bar chart", line: "Line chart", area: "Area chart", pie: "Pie chart" };
const CHART_ICON: Record<(typeof CHART_TYPES)[number], IconName> = { bar: "chartBar", line: "chartLine", area: "chartLine", pie: "chartBar" };

export function chartEntries(aiMark: React.ReactNode): MenuEntry[] {
  const data = selectionHasData();
  return [
    ...(data ? [] : [{ note: "Select cells with data to chart first." } as const]),
    ...CHART_TYPES.map((t) => ({ label: CHART_LABEL[t], icon: icon(CHART_ICON[t]), disabled: !data, onSelect: () => void addChartFromSelection(t) })),
    "separator" as const,
    {
      label: "Quick chart",
      icon: aiMark,
      onSelect: () => askFor(data ? `Make a chart of ${selectionRangeStr()} that shows it best.` : "Make a chart that shows this sheet's data best."),
    },
  ];
}

export function ruleEntries(): MenuEntry[] {
  return [
    { label: "Add highlight rule", icon: icon("highlightRule"), onSelect: () => openRules({ view: "edit", id: null, kind: "highlight" }) },
    { label: "Add color scale rule", icon: icon("colorScale"), onSelect: () => openRules({ view: "edit", id: null, kind: "colorScale" }) },
    "separator",
    { label: "Show rules", icon: icon("condFormat"), onSelect: () => openRules({ view: "list" }) },
  ];
}

export function filterEntries(): MenuEntry[] {
  const sheet = currentSheet();
  const col = selectionBounds().c1;
  const table = sheet ? tableAround(sheet) : null;
  return [
    ...(sheet?.filter
      ? [{ label: "Remove filter", icon: icon("filter"), onSelect: () => void toggleFilter() }]
      : table
        ? [{ label: "Create a filter", icon: icon("filter"), aside: table, onSelect: () => void toggleFilter() }]
        : [{ note: "No table here to filter" } as const]),
    { heading: "Sort", aside: `By column ${colToLetter(col)}` },
    { label: "Ascending", icon: icon("sortAsc"), onSelect: () => void sortActiveSheet(col, true) },
    { label: "Descending", icon: icon("sortDesc"), onSelect: () => void sortActiveSheet(col, false) },
    { label: "Custom sort", icon: icon("sliders"), onSelect: () => setState({ dialog: "customSort" }) },
  ];
}

// ── The right-click menu ─────────────────────────────────────────────────────

export type MenuTarget = "cell" | "col" | "row";

/** The menu for a right-click on cells, column headers or row headers (and the toolbar's "More actions"). */
/** Group the selected columns or rows, and ungroup them when they are in a group. */
function groupEntries(kind: "col" | "row", sheet: SheetData, b: { r1: number; r2: number; c1: number; c2: number }): MenuEntry[] {
  const [a, z, groups, word] = kind === "col" ? [b.c1, b.c2, sheet.colGroups, "column"] : [b.r1, b.r2, sheet.rowGroups, "row"];
  const plural = z > a ? `${word}s` : word;
  const inGroup = groups.some((g) => g.start <= z && g.end >= a);
  return [
    { label: `Group ${plural}`, icon: icon("group"), shortcut: shortcut("Alt+Shift+Right"), onSelect: () => void groupSelection(kind) },
    ...(inGroup ? [{ label: `Ungroup ${plural}`, icon: icon("group"), shortcut: shortcut("Alt+Shift+Left"), onSelect: () => void ungroupSelection(kind) }] : []),
  ];
}

export function cellMenuEntries(kind: MenuTarget): MenuEntry[] {
  const sheet = currentSheet();
  if (!sheet) return [];
  const b = selectionBounds();
  const cols = b.c2 - b.c1 + 1;
  const rows = b.r2 - b.r1 + 1;
  const colName = cols > 1 ? `columns ${colToLetter(b.c1)}–${colToLetter(b.c2)}` : `column ${colToLetter(b.c1)}`;
  const rowName = rows > 1 ? `rows ${b.r1 + 1}–${b.r2 + 1}` : `row ${b.r1 + 1}`;
  const s = activeStyle();
  const merged = sheet.merges.some((m) => m.r1 <= b.r2 && m.r2 >= b.r1 && m.c1 <= b.c2 && m.c2 >= b.c1);
  const n = (count: number, word: string) => (count > 1 ? `${count} ${word}s` : word);

  const freeze: MenuEntry[] =
    kind === "col"
      ? [sheet.frozenCols === b.c2 + 1 ? { label: "Unfreeze columns", icon: icon("pin"), onSelect: () => void freezeAt(sheet.frozenRows, 0) } : { label: `Freeze columns A to ${colToLetter(b.c2)}`, icon: icon("pin"), onSelect: () => void freezeAt(sheet.frozenRows, b.c2 + 1) }]
      : kind === "row"
        ? [sheet.frozenRows === b.r2 + 1 ? { label: "Unfreeze rows", icon: icon("pin"), onSelect: () => void freezeAt(0, sheet.frozenCols) } : { label: `Freeze rows 1 to ${b.r2 + 1}`, icon: icon("pin"), onSelect: () => void freezeAt(b.r2 + 1, sheet.frozenCols) }]
        : [
            {
              label: "Freeze",
              icon: icon("pin"),
              submenu: [
                { label: `Up to row ${b.r1 + 1}`, checked: sheet.frozenRows === b.r1 + 1, onSelect: () => void freezeAt(b.r1 + 1, sheet.frozenCols) },
                { label: `Up to column ${colToLetter(b.c1)}`, checked: sheet.frozenCols === b.c1 + 1, onSelect: () => void freezeAt(sheet.frozenRows, b.c1 + 1) },
                "separator",
                { label: "No frozen rows or columns", disabled: !sheet.frozenRows && !sheet.frozenCols, onSelect: () => void freezeAt(0, 0) },
              ],
            },
          ];

  const insert: MenuEntry[] =
    kind === "col"
      ? [
          { label: `Insert ${n(cols, "column")} left`, icon: icon("insertColLeft"), shortcut: shortcut("Mod+Alt+="), onSelect: () => void insertColsAt(b.c1, cols) },
          { label: `Insert ${n(cols, "column")} right`, icon: icon("insertColRight"), onSelect: () => void insertColsAt(b.c2 + 1, cols) },
        ]
      : kind === "row"
        ? [
            { label: `Insert ${n(rows, "row")} above`, icon: icon("insertRowAbove"), shortcut: shortcut("Mod+Alt+="), onSelect: () => void insertRowsAt(b.r1, rows) },
            { label: `Insert ${n(rows, "row")} below`, icon: icon("insertRowBelow"), onSelect: () => void insertRowsAt(b.r2 + 1, rows) },
          ]
        : [
            { label: `Insert ${n(rows, "row")} above`, icon: icon("insertRowAbove"), onSelect: () => void insertRowsAt(b.r1, rows) },
            { label: `Insert ${n(cols, "column")} left`, icon: icon("insertColLeft"), onSelect: () => void insertColsAt(b.c1, cols) },
          ];

  const remove: MenuEntry[] =
    kind === "col"
      ? [{ label: `Delete ${colName}`, icon: icon("deleteCol"), shortcut: shortcut("Mod+Alt+-"), onSelect: () => void deleteColsAt(b.c1, cols) }]
      : kind === "row"
        ? [{ label: `Delete ${rowName}`, icon: icon("deleteRow"), shortcut: shortcut("Mod+Alt+-"), onSelect: () => void deleteRowsAt(b.r1, rows) }]
        : [
            { label: `Delete ${rowName}`, icon: icon("deleteRow"), onSelect: () => void deleteRowsAt(b.r1, rows) },
            { label: `Delete ${colName}`, icon: icon("deleteCol"), onSelect: () => void deleteColsAt(b.c1, cols) },
          ];

  return [
    { label: "Comment", icon: icon("chat"), shortcut: shortcut("Mod+Alt+M"), onSelect: commentOnSelection },
    "separator",
    { label: "Cut", icon: icon("cut"), shortcut: shortcut("Mod+X"), onSelect: () => copySelection(true) },
    { label: "Copy", icon: icon("copy"), shortcut: shortcut("Mod+C"), onSelect: () => copySelection(false) },
    { label: "Paste", icon: icon("paste"), shortcut: shortcut("Mod+V"), onSelect: () => void pasteSelection(false) },
    { label: "Paste values only", icon: icon("pasteValues"), shortcut: shortcut("Mod+Shift+V"), onSelect: () => void pasteSelection(true) },
    "separator",
    ...freeze,
    ...(kind === "cell" ? [{ label: merged ? "Unmerge cells" : "Merge cells", icon: icon("merge"), disabled: !merged && b.r1 === b.r2 && b.c1 === b.c2, onSelect: () => void (merged ? unmergeSelection() : mergeSelection()) }] : []),
    "separator",
    ...insert,
    ...(kind === "col"
      ? [
          "separator" as const,
          { label: "Move column left", icon: icon("arrowLeft"), disabled: b.c1 === 0 || cols > 1, onSelect: () => void moveColumn(b.c1, -1) },
          { label: "Move column right", icon: icon("arrowRight"), disabled: b.c1 >= sheet.cols - 1 || cols > 1, onSelect: () => void moveColumn(b.c1, 1) },
        ]
      : []),
    "separator",
    {
      label: "Clear",
      icon: icon("eraser"),
      submenu: [
        { label: "Contents", shortcut: "Backspace", onSelect: () => void clearSelection("contents") },
        { label: "Formatting", shortcut: shortcut("Mod+\\"), onSelect: () => void clearSelection("formatting") },
      ],
    },
    ...remove,
    ...(kind === "cell"
      ? []
      : [
          "separator" as const,
          kind === "col"
            ? { label: cols > 1 ? "Resize columns" : "Resize column", icon: icon("resize"), onSelect: () => setState({ dialog: "resizeCol" }) }
            : { label: rows > 1 ? "Resize rows" : "Resize row", icon: icon("resize"), onSelect: () => setState({ dialog: "resizeRow" }) },
          ...groupEntries(kind, sheet, b),
        ]),
    "separator",
    {
      label: "Sort sheet",
      icon: icon("sortAsc"),
      aside: `By column ${colToLetter(b.c1)}`,
      submenu: [
        { label: "Ascending", onSelect: () => void sortActiveSheet(b.c1, true) },
        { label: "Descending", onSelect: () => void sortActiveSheet(b.c1, false) },
        "separator",
        { label: "Custom sort", onSelect: () => setState({ dialog: "customSort" }) },
      ],
    },
    { label: sheet.filter ? "Remove filter" : "Filter", icon: icon("filter"), onSelect: () => void toggleFilter() },
    "separator",
    {
      label: "Formatting",
      icon: icon("textSize"),
      submenu: [
        { label: "Bold", shortcut: shortcut("Mod+B"), checked: !!s.bold, onSelect: () => void toggleStyleProp("bold") },
        { label: "Italic", shortcut: shortcut("Mod+I"), checked: !!s.italic, onSelect: () => void toggleStyleProp("italic") },
        { label: "Underline", shortcut: shortcut("Mod+U"), checked: !!s.underline, onSelect: () => void toggleStyleProp("underline") },
        { label: "Strikethrough", shortcut: shortcut("Mod+Shift+X"), checked: !!s.strike, onSelect: () => void toggleStyleProp("strike") },
        { heading: "Text wrapping" },
        ...wrapEntries(),
      ],
    },
  ];
}
