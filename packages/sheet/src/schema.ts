// The Fenna Sheets format: single source of truth for workbook metadata, sheets,
// cells, styles, smart chips, borders, number formats, conditional rules, and charts.

export const FORMAT = "fenna-sheets/0";
/** The marker workbooks had before the Fenna name; still read, and written back as FORMAT. */
export const LEGACY_FORMAT = "opensheet/0";

export const LIMITS = {
  sheets: 100,
  maxRows: 100_000,
  maxCols: 500,
  defaultRows: 1000,
  defaultCols: 26,
  defaultColWidth: 104,
  defaultRowHeight: 26,
  titleChars: 200,
  dropdowns: 100,
  dropdownOptions: 50,
  people: 200,
  rulesPerSheet: 100,
  chartsPerSheet: 50,
} as const;

export const FONT_SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 36] as const;

export const ALIGN_H = ["auto", "left", "center", "right"] as const;
export type AlignH = (typeof ALIGN_H)[number];

export const ALIGN_V = ["top", "middle", "bottom"] as const;
export type AlignV = (typeof ALIGN_V)[number];

export const WRAP_MODES = ["overflow", "wrap"] as const;
export type WrapMode = (typeof WRAP_MODES)[number];

export const BORDER_STYLES = ["thin", "medium", "thick", "dashed", "dotted", "double"] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

export interface BorderSide {
  style: BorderStyle;
  color?: string;
}

export interface CellBorders {
  top?: BorderSide;
  right?: BorderSide;
  bottom?: BorderSide;
  left?: BorderSide;
}

export const NUMBER_FORMAT_KINDS = [
  "auto",
  "number",
  "number_rounded",
  "number_parens",
  "percent",
  "scientific",
  "currency",
  "currency_rounded",
  "date",
  "date_short",
  "date_full",
  "month_day",
  "month_year",
  "time",
  "datetime",
  "duration",
  "custom",
] as const;
export type NumberFormatKind = (typeof NUMBER_FORMAT_KINDS)[number];

export interface NumberFormatSpec {
  kind: NumberFormatKind;
  label: string;
  example: string;
  group: "auto" | "number" | "currency" | "datetime" | "custom";
}

export const NUMBER_FORMATS: readonly NumberFormatSpec[] = [
  { kind: "auto", label: "Automatic", example: "1234.5", group: "auto" },
  { kind: "number", label: "Number", example: "1,234.50", group: "number" },
  { kind: "number_rounded", label: "Number (rounded)", example: "1,235", group: "number" },
  { kind: "number_parens", label: "Number (parentheses)", example: "(1,234.50)", group: "number" },
  { kind: "percent", label: "Percent", example: "12.50%", group: "number" },
  { kind: "scientific", label: "Scientific", example: "1.23E+03", group: "number" },
  { kind: "currency", label: "Currency", example: "$1,234.50", group: "currency" },
  { kind: "currency_rounded", label: "Currency (rounded)", example: "$1,235", group: "currency" },
  { kind: "date", label: "Date", example: "3/15/2026", group: "datetime" },
  { kind: "date_short", label: "Date (short month)", example: "Mar 15, 2026", group: "datetime" },
  { kind: "date_full", label: "Date (full month)", example: "March 15, 2026", group: "datetime" },
  { kind: "month_day", label: "Month and day", example: "Mar 15", group: "datetime" },
  { kind: "month_year", label: "Month and year", example: "Mar 2026", group: "datetime" },
  { kind: "time", label: "Time", example: "2:30 PM", group: "datetime" },
  { kind: "datetime", label: "Date and time", example: "3/15/2026 2:30 PM", group: "datetime" },
  { kind: "duration", label: "Duration", example: "25:01:03", group: "datetime" },
];

export const CELL_TYPES = ["auto", "checkbox", "dropdown", "person", "date"] as const;
export type CellType = (typeof CELL_TYPES)[number];

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontSize?: number;
  color?: string;
  fill?: string;
  alignH?: AlignH;
  alignV?: AlignV;
  wrap?: WrapMode;
  borders?: CellBorders;
  numFmt?: NumberFormatKind;
  customFmt?: string;
}

/** Every key a cell style may have, as the files write them. */
export const STYLE_KEYS = ["bold", "italic", "underline", "strike", "fontSize", "color", "fill", "alignH", "alignV", "wrap", "borders", "numFmt", "customFmt"] as const satisfies readonly (keyof CellStyle)[];

/** Every key a cell may have. */
export const CELL_KEYS = ["v", "f", "t", "s", "dropdownId", "person", "note"] as const satisfies readonly (keyof CellData)[];

/** Font size a cell has when it sets none, in points. */
export const DEFAULT_FONT_SIZE = 10;

export interface PersonValue {
  name: string;
  email?: string;
}

export interface CellData {
  /** Raw scalar value (string, number, boolean, or null). */
  v?: string | number | boolean | null;
  /** Formula string starting with '='. */
  f?: string;
  /** Interactive cell type (checkbox, dropdown, person, date). */
  t?: CellType;
  /** Visual formatting for this cell. */
  s?: CellStyle;
  /** Dropdown definition id when t === 'dropdown'. */
  dropdownId?: string;
  /** Person metadata when t === 'person'. */
  person?: PersonValue;
  /** Optional cell note. */
  note?: string;
}

export interface MergeRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export const HIGHLIGHT_CONDITIONS = [
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "neq",
  "between",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "empty",
  "not_empty",
  "formula",
] as const;
export type HighlightCondition = (typeof HIGHLIGHT_CONDITIONS)[number];

export const HIGHLIGHT_LABELS: Record<HighlightCondition, string> = {
  gt: "Greater than",
  gte: "Greater than or equal to",
  lt: "Less than",
  lte: "Less than or equal to",
  eq: "Equal to",
  neq: "Not equal to",
  between: "Is between",
  contains: "Text contains",
  not_contains: "Text does not contain",
  starts_with: "Text starts with",
  ends_with: "Text ends with",
  empty: "Is empty",
  not_empty: "Is not empty",
  formula: "Custom formula is",
};

export interface HighlightRule {
  id: string;
  kind: "highlight";
  range: string;
  condition: HighlightCondition;
  values: string[];
  style: Pick<CellStyle, "fill" | "color" | "bold" | "italic">;
}

export interface ColorScaleRule {
  id: string;
  kind: "colorScale";
  range: string;
  minColor: string;
  midColor?: string;
  maxColor: string;
}

export type ConditionalRule = HighlightRule | ColorScaleRule;

export const CHART_TYPES = ["bar", "line", "area", "pie"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartSpec {
  id: string;
  type: ChartType;
  title: string;
  range: string;
  x: number;
  y: number;
  w: number;
  h: number;
  headerRow?: boolean;
}

export interface FilterSpec {
  range: string;
  columnFilters: Record<string, string[]>;
}

export interface GroupRange {
  start: number;
  end: number;
  collapsed?: boolean;
}

export interface SheetData {
  id: string;
  title: string;
  rows: number;
  cols: number;
  rowHeights: Record<number, number>;
  colWidths: Record<number, number>;
  frozenRows: number;
  frozenCols: number;
  showGridlines: boolean;
  color?: string;
  cells: Record<string, CellData>;
  merges: MergeRange[];
  rules: ConditionalRule[];
  charts: ChartSpec[];
  filter: FilterSpec | null;
  colGroups: GroupRange[];
  rowGroups: GroupRange[];
}

export const OPTION_COLORS = ["gray", "blue", "green", "yellow", "orange", "red", "purple"] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

export interface DropdownOption {
  id: string;
  label: string;
  color: OptionColor;
}

export interface Dropdown {
  id: string;
  name: string;
  options: DropdownOption[];
}

export const DROPDOWN_TEMPLATES: readonly Dropdown[] = [
  {
    id: "status",
    name: "Status",
    options: [
      { id: "not-started", label: "Not started", color: "gray" },
      { id: "in-progress", label: "In progress", color: "blue" },
      { id: "done", label: "Done", color: "green" },
    ],
  },
  {
    id: "priority",
    name: "Priority",
    options: [
      { id: "low", label: "Low", color: "gray" },
      { id: "medium", label: "Medium", color: "yellow" },
      { id: "high", label: "High", color: "red" },
    ],
  },
];

export interface SheetRef {
  id: string;
  title: string;
  color?: string;
}

export interface WorkbookIndex {
  format: typeof FORMAT;
  title: string;
  locale: string;
  timeZone: string;
  sheets: SheetRef[];
  dropdowns: Dropdown[];
  people: PersonValue[];
}

/** Standard 8-grayscale + 4x8 color palette for cell text, fill and borders. */
export const CELL_COLOR_PALETTE: readonly (readonly string[])[] = [
  ["#111111", "#262626", "#3a3a3a", "#525252", "#737373", "#a3a3a3", "#d4d4d4", "#ffffff"],
  ["#451a1a", "#452315", "#422d10", "#17381b", "#0f382e", "#112b4a", "#261b4d", "#45142d"],
  ["#8c2626", "#8c3f1c", "#855814", "#1b6b26", "#116b56", "#1a5394", "#463196", "#8a2356"],
  ["#c23636", "#bf5624", "#b57818", "#238a31", "#168c70", "#226dc2", "#5d42c7", "#bd3176"],
  ["#e84a4a", "#e66f35", "#db961d", "#2ca83d", "#1dad8b", "#3185e6", "#795ce8", "#e04692"],
];

export const SHEET_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const CELL_REF_RE = /^(\$?)([A-Z]{1,3})(\$?)(\d{1,6})$/;
export const RANGE_REF_RE = /^(\$?[A-Z]{1,3}\$?\d{1,6})(?::(\$?[A-Z]{1,3}\$?\d{1,6}))?$/;

/** Convert 0-based column index (0 -> A, 25 -> Z, 26 -> AA) to letters. */
export function colToLetter(col: number): string {
  let n = col + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Convert column letters (A -> 0, Z -> 25, AA -> 26) to 0-based index, or -1 if invalid. */
export function letterToCol(letters: string): number {
  const s = letters.toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(s)) return -1;
  let col = 0;
  for (let i = 0; i < s.length; i++) {
    col = col * 26 + (s.charCodeAt(i) - 64);
  }
  return col - 1;
}

export interface ParsedCellRef {
  row: number;
  col: number;
  absRow: boolean;
  absCol: boolean;
}

export function parseCellRef(ref: string): ParsedCellRef | null {
  const m = CELL_REF_RE.exec(ref.trim().toUpperCase());
  if (!m) return null;
  const col = letterToCol(m[2]!);
  const row = Number(m[4]!) - 1;
  if (col < 0 || col >= LIMITS.maxCols || row < 0 || row >= LIMITS.maxRows) return null;
  return { row, col, absCol: m[1] === "$", absRow: m[3] === "$" };
}

export function formatCellRef(row: number, col: number, absRow = false, absCol = false): string {
  return `${absCol ? "$" : ""}${colToLetter(col)}${absRow ? "$" : ""}${row + 1}`;
}

export interface ParsedRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export function parseRangeRef(range: string): ParsedRange | null {
  const m = RANGE_REF_RE.exec(range.trim().toUpperCase());
  if (!m) return null;
  const a = parseCellRef(m[1]!);
  if (!a) return null;
  const b = m[2] ? parseCellRef(m[2]) : a;
  if (!b) return null;
  return {
    r1: Math.min(a.row, b.row),
    c1: Math.min(a.col, b.col),
    r2: Math.max(a.row, b.row),
    c2: Math.max(a.col, b.col),
  };
}

export function formatRangeRef(r: ParsedRange): string {
  const a = formatCellRef(Math.min(r.r1, r.r2), Math.min(r.c1, r.c2));
  const b = formatCellRef(Math.max(r.r1, r.r2), Math.max(r.c1, r.c2));
  return a === b ? a : `${a}:${b}`;
}

export function cellInRange(row: number, col: number, r: ParsedRange): boolean {
  return row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2;
}

export function expandRange(range: string, maxCells = 10_000): string[] {
  const r = parseRangeRef(range);
  if (!r) return [];
  const out: string[] = [];
  for (let row = r.r1; row <= r.r2; row++) {
    for (let col = r.c1; col <= r.c2; col++) {
      out.push(formatCellRef(row, col));
      if (out.length >= maxCells) return out;
    }
  }
  return out;
}

