// Spreadsheet formula engine: tokenizer, recursive-descent parser, evaluator
// with cross-sheet refs, whole-column and whole-row ranges, cycle detection,
// the built-in functions listed in FUNCTIONS, and formula shifting.

import { dateToSerial, formatPattern, parseDateText, serialOf, serialToDate } from "./numfmt.ts";
import { formatCellRef, letterToCol, parseCellRef, type SheetData } from "./schema.ts";

export type ScalarValue = string | number | boolean | null;

const ERROR_TEXT: Record<string, string> = {
  "#DIV/0!": "Division by zero",
  "#VALUE!": "A value has the wrong type, such as text where a number is needed",
  "#N/A": "No match was found",
  "#REF!": "The reference is not valid",
  "#NUM!": "The number is out of range",
  "#NAME?": "Unknown name",
  "#ERROR!": "The formula could not be read",
};

export class FormulaError {
  readonly code: string;
  /** Why, in words a person or a model can act on ("Unknown function SUMM"). */
  readonly message: string;
  constructor(code: string, message = "") {
    this.code = code;
    this.message = message || ERROR_TEXT[code] || "";
  }
  toString() {
    return this.code;
  }
}

export type EvalValue = ScalarValue | FormulaError;

export interface FunctionMeta {
  name: string;
  sig: string;
  desc: string;
}

export const FUNCTIONS: readonly FunctionMeta[] = [
  { name: "SUM", sig: "SUM(value1, [value2, ...])", desc: "Sum of the numbers" },
  { name: "AVERAGE", sig: "AVERAGE(value1, [value2, ...])", desc: "Mean of the numbers" },
  { name: "MIN", sig: "MIN(value1, [value2, ...])", desc: "Smallest number" },
  { name: "MAX", sig: "MAX(value1, [value2, ...])", desc: "Largest number" },
  { name: "MEDIAN", sig: "MEDIAN(value1, [value2, ...])", desc: "Middle number" },
  { name: "PRODUCT", sig: "PRODUCT(value1, [value2, ...])", desc: "Product of the numbers" },
  { name: "COUNT", sig: "COUNT(value1, [value2, ...])", desc: "How many numbers" },
  { name: "COUNTA", sig: "COUNTA(value1, [value2, ...])", desc: "How many cells are not empty" },
  { name: "COUNTBLANK", sig: "COUNTBLANK(range)", desc: "How many cells are empty" },
  { name: "COUNTUNIQUE", sig: "COUNTUNIQUE(value1, [value2, ...])", desc: "How many different values" },
  { name: "COUNTIF", sig: "COUNTIF(range, criterion)", desc: "How many cells match, e.g. \">100\" or \"Done\"" },
  { name: "COUNTIFS", sig: "COUNTIFS(range1, criterion1, [range2, criterion2, ...])", desc: "How many rows match every criterion" },
  { name: "SUMIF", sig: "SUMIF(range, criterion, [sum_range])", desc: "Sum where the range matches" },
  { name: "SUMIFS", sig: "SUMIFS(sum_range, range1, criterion1, ...)", desc: "Sum where every criterion matches" },
  { name: "AVERAGEIF", sig: "AVERAGEIF(range, criterion, [average_range])", desc: "Mean where the range matches" },
  { name: "AVERAGEIFS", sig: "AVERAGEIFS(average_range, range1, criterion1, ...)", desc: "Mean where every criterion matches" },
  { name: "MAXIFS", sig: "MAXIFS(max_range, range1, criterion1, ...)", desc: "Largest where every criterion matches" },
  { name: "MINIFS", sig: "MINIFS(min_range, range1, criterion1, ...)", desc: "Smallest where every criterion matches" },
  { name: "SUMPRODUCT", sig: "SUMPRODUCT(range1, [range2, ...])", desc: "Sum of the products of matching cells" },
  { name: "LARGE", sig: "LARGE(range, n)", desc: "The nth largest number" },
  { name: "SMALL", sig: "SMALL(range, n)", desc: "The nth smallest number" },
  { name: "RANK", sig: "RANK(value, range, [ascending])", desc: "Position of a value in a range (1 is the largest)" },
  { name: "STDEV", sig: "STDEV(value1, [value2, ...])", desc: "Sample standard deviation" },
  { name: "STDEVP", sig: "STDEVP(value1, [value2, ...])", desc: "Population standard deviation" },
  { name: "VAR", sig: "VAR(value1, [value2, ...])", desc: "Sample variance" },
  { name: "VARP", sig: "VARP(value1, [value2, ...])", desc: "Population variance" },
  { name: "ROUND", sig: "ROUND(value, [places])", desc: "Round to a number of decimal places" },
  { name: "ROUNDUP", sig: "ROUNDUP(value, [places])", desc: "Round away from zero" },
  { name: "ROUNDDOWN", sig: "ROUNDDOWN(value, [places])", desc: "Round toward zero" },
  { name: "TRUNC", sig: "TRUNC(value, [places])", desc: "Cut off decimals without rounding" },
  { name: "INT", sig: "INT(value)", desc: "Round down to a whole number" },
  { name: "CEILING", sig: "CEILING(value, [factor])", desc: "Round up to a multiple of factor" },
  { name: "FLOOR", sig: "FLOOR(value, [factor])", desc: "Round down to a multiple of factor" },
  { name: "MOD", sig: "MOD(dividend, divisor)", desc: "Remainder after division" },
  { name: "ABS", sig: "ABS(value)", desc: "Absolute value" },
  { name: "SIGN", sig: "SIGN(value)", desc: "1, 0 or -1 by the sign of a number" },
  { name: "SQRT", sig: "SQRT(value)", desc: "Square root" },
  { name: "POWER", sig: "POWER(base, exponent)", desc: "A number raised to a power" },
  { name: "EXP", sig: "EXP(value)", desc: "e raised to a power" },
  { name: "LN", sig: "LN(value)", desc: "Natural logarithm" },
  { name: "LOG", sig: "LOG(value, [base])", desc: "Logarithm (base 10 unless given)" },
  { name: "LOG10", sig: "LOG10(value)", desc: "Base-10 logarithm" },
  { name: "PI", sig: "PI()", desc: "The number pi" },
  { name: "RAND", sig: "RAND()", desc: "A random number from 0 to 1" },
  { name: "RANDBETWEEN", sig: "RANDBETWEEN(low, high)", desc: "A random whole number in a range" },
  { name: "PMT", sig: "PMT(rate, periods, present_value, [future_value], [end_or_start])", desc: "Payment per period for a loan" },
  { name: "IF", sig: "IF(condition, value_if_true, [value_if_false])", desc: "One value if a condition holds, another if not" },
  { name: "IFS", sig: "IFS(condition1, value1, [condition2, value2, ...])", desc: "The value of the first condition that holds" },
  { name: "SWITCH", sig: "SWITCH(expression, case1, value1, [..., default])", desc: "The value whose case matches the expression" },
  { name: "CHOOSE", sig: "CHOOSE(index, value1, [value2, ...])", desc: "The value at a position" },
  { name: "AND", sig: "AND(condition1, [condition2, ...])", desc: "TRUE if every condition holds" },
  { name: "OR", sig: "OR(condition1, [condition2, ...])", desc: "TRUE if any condition holds" },
  { name: "NOT", sig: "NOT(condition)", desc: "The opposite of a condition" },
  { name: "IFERROR", sig: "IFERROR(value, [value_if_error])", desc: "A fallback when a value is an error" },
  { name: "IFNA", sig: "IFNA(value, [value_if_na])", desc: "A fallback when a value is #N/A" },
  { name: "ISBLANK", sig: "ISBLANK(value)", desc: "TRUE if the cell is empty" },
  { name: "ISNUMBER", sig: "ISNUMBER(value)", desc: "TRUE if the value is a number" },
  { name: "ISTEXT", sig: "ISTEXT(value)", desc: "TRUE if the value is text" },
  { name: "ISLOGICAL", sig: "ISLOGICAL(value)", desc: "TRUE if the value is TRUE or FALSE" },
  { name: "ISERROR", sig: "ISERROR(value)", desc: "TRUE if the value is any error" },
  { name: "ISERR", sig: "ISERR(value)", desc: "TRUE if the value is an error other than #N/A" },
  { name: "ISNA", sig: "ISNA(value)", desc: "TRUE if the value is #N/A" },
  { name: "N", sig: "N(value)", desc: "The value as a number (text is 0)" },
  { name: "T", sig: "T(value)", desc: "The value if it is text, else empty" },
  { name: "VALUE", sig: "VALUE(text)", desc: "Text that looks like a number, as a number" },
  { name: "TEXT", sig: "TEXT(value, format)", desc: "A number as text in a format, e.g. \"#,##0.00\" or \"mmm d\"" },
  { name: "CONCAT", sig: "CONCAT(text1, [text2, ...])", desc: "Join text" },
  { name: "CONCATENATE", sig: "CONCATENATE(text1, [text2, ...])", desc: "Join text" },
  { name: "TEXTJOIN", sig: "TEXTJOIN(delimiter, ignore_empty, text1, [text2, ...])", desc: "Join text with a delimiter" },
  { name: "LEFT", sig: "LEFT(text, [count])", desc: "First characters of text" },
  { name: "RIGHT", sig: "RIGHT(text, [count])", desc: "Last characters of text" },
  { name: "MID", sig: "MID(text, start, count)", desc: "Characters from a position (1 is the first)" },
  { name: "LEN", sig: "LEN(text)", desc: "Length of text" },
  { name: "TRIM", sig: "TRIM(text)", desc: "Text without extra spaces" },
  { name: "UPPER", sig: "UPPER(text)", desc: "Text in capitals" },
  { name: "LOWER", sig: "LOWER(text)", desc: "Text in lower case" },
  { name: "PROPER", sig: "PROPER(text)", desc: "Text with each word capitalized" },
  { name: "EXACT", sig: "EXACT(text1, text2)", desc: "TRUE if two texts match exactly" },
  { name: "REPT", sig: "REPT(text, times)", desc: "Text repeated" },
  { name: "SUBSTITUTE", sig: "SUBSTITUTE(text, search, replacement, [occurrence])", desc: "Text with matches replaced" },
  { name: "FIND", sig: "FIND(search, text, [start])", desc: "Position of text (case-sensitive)" },
  { name: "SEARCH", sig: "SEARCH(search, text, [start])", desc: "Position of text (any case)" },
  { name: "VLOOKUP", sig: "VLOOKUP(key, range, column, [is_sorted])", desc: "Find a key in the first column and return a column of its row; FALSE for an exact match" },
  { name: "HLOOKUP", sig: "HLOOKUP(key, range, row, [is_sorted])", desc: "Find a key in the first row and return a row of its column" },
  { name: "XLOOKUP", sig: "XLOOKUP(key, lookup_range, result_range, [if_not_found])", desc: "Find a key and return the matching cell of another range" },
  { name: "INDEX", sig: "INDEX(range, row, [column])", desc: "The cell at a row and column of a range" },
  { name: "MATCH", sig: "MATCH(key, range, [match_type])", desc: "Position of a key in a range (0 for an exact match)" },
  { name: "ROW", sig: "ROW([cell])", desc: "Row number of a cell, or of this cell" },
  { name: "COLUMN", sig: "COLUMN([cell])", desc: "Column number of a cell, or of this cell" },
  { name: "ROWS", sig: "ROWS(range)", desc: "How many rows a range has" },
  { name: "COLUMNS", sig: "COLUMNS(range)", desc: "How many columns a range has" },
  { name: "TODAY", sig: "TODAY()", desc: "Today, in the sheet's time zone" },
  { name: "NOW", sig: "NOW()", desc: "Now, in the sheet's time zone" },
  { name: "DATE", sig: "DATE(year, month, day)", desc: "A date" },
  { name: "TIME", sig: "TIME(hour, minute, second)", desc: "A time of day" },
  { name: "DATEVALUE", sig: "DATEVALUE(text)", desc: "Text such as \"2026-03-15\" as a date" },
  { name: "YEAR", sig: "YEAR(date)", desc: "Year of a date" },
  { name: "MONTH", sig: "MONTH(date)", desc: "Month of a date (1-12)" },
  { name: "DAY", sig: "DAY(date)", desc: "Day of the month (1-31)" },
  { name: "WEEKDAY", sig: "WEEKDAY(date, [type])", desc: "Day of the week (1 is Sunday)" },
  { name: "HOUR", sig: "HOUR(time)", desc: "Hour of a time (0-23)" },
  { name: "MINUTE", sig: "MINUTE(time)", desc: "Minute of a time" },
  { name: "SECOND", sig: "SECOND(time)", desc: "Second of a time" },
  { name: "EDATE", sig: "EDATE(date, months)", desc: "A date some months before or after" },
  { name: "EOMONTH", sig: "EOMONTH(date, months)", desc: "Last day of the month, some months before or after" },
  { name: "DAYS", sig: "DAYS(end_date, start_date)", desc: "Days between two dates" },
  { name: "DATEDIF", sig: "DATEDIF(start_date, end_date, unit)", desc: "Whole years (\"Y\"), months (\"M\") or days (\"D\") between dates" },
  { name: "NETWORKDAYS", sig: "NETWORKDAYS(start_date, end_date)", desc: "Weekdays between two dates, both counted" },
];

type Token =
  | { kind: "num"; v: number }
  | { kind: "str"; v: string }
  | { kind: "ident"; v: string }
  | { kind: "sheetRef"; sheet: string; ref: string }
  | { kind: "op"; v: string }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" }
  | { kind: "colon" }
  | { kind: "err"; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      i++;
      let s = "";
      while (i < src.length) {
        if (src[i] === '"' && src[i + 1] === '"') {
          s += '"';
          i += 2;
        } else if (src[i] === '"') {
          i++;
          break;
        } else {
          s += src[i++];
        }
      }
      out.push({ kind: "str", v: s });
      continue;
    }
    if (ch === "'") {
      i++;
      let sheet = "";
      while (i < src.length) {
        if (src[i] === "'" && src[i + 1] === "'") {
          sheet += "'";
          i += 2;
        } else if (src[i] === "'") {
          i++;
          break;
        } else {
          sheet += src[i++];
        }
      }
      if (src[i] === "!") {
        i++;
        let ref = "";
        while (i < src.length && /[A-Za-z0-9$:]/.test(src[i]!)) ref += src[i++];
        out.push({ kind: "sheetRef", sheet, ref });
        continue;
      }
      throw new FormulaError("#NAME?", `A quoted sheet name must be followed by ! and a cell, like '${sheet}'!A1`);
    }
    if (/\d/.test(ch) || (ch === "." && /\d/.test(src[i + 1] ?? ""))) {
      let num = "";
      while (i < src.length && /[\d.]/.test(src[i]!)) num += src[i++];
      if ((src[i] === "e" || src[i] === "E") && /[+-]?\d/.test(src.slice(i + 1, i + 3))) {
        num += src[i++];
        if (src[i] === "+" || src[i] === "-") num += src[i++];
        while (i < src.length && /\d/.test(src[i]!)) num += src[i++];
      }
      out.push({ kind: "num", v: Number(num) });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let id = "";
      while (i < src.length && /[A-Za-z0-9_$.]/.test(src[i]!)) id += src[i++];
      if (src[i] === "!") {
        i++;
        let ref = "";
        while (i < src.length && /[A-Za-z0-9$:]/.test(src[i]!)) ref += src[i++];
        out.push({ kind: "sheetRef", sheet: id, ref });
        continue;
      }
      out.push({ kind: "ident", v: id });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ kind: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(ch)) {
      out.push({ kind: "op", v: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      out.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      out.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (ch === "," || ch === ";") {
      out.push({ kind: "comma" });
      i++;
      continue;
    }
    if (ch === ":") {
      out.push({ kind: "colon" });
      i++;
      continue;
    }
    if (src.startsWith("#REF!", i)) {
      out.push({ kind: "err", v: "#REF!" });
      i += 5;
      continue;
    }
    throw new FormulaError("#ERROR!", `Unexpected character ${ch}`);
  }
  return out;
}

type ArgValue = EvalValue | EvalValue[][];

function isErr(v: unknown): v is FormulaError {
  return v instanceof FormulaError;
}

function toNum(v: EvalValue): number | FormulaError {
  if (isErr(v)) return v;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : new FormulaError("#VALUE!");
}

function toStr(v: EvalValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

function toBool(v: EvalValue): boolean | FormulaError {
  if (isErr(v)) return v;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v === null || v === "") return false;
  const up = String(v).trim().toUpperCase();
  if (up === "TRUE") return true;
  if (up === "FALSE") return false;
  return new FormulaError("#VALUE!");
}

function flattenArgs(args: ArgValue[]): EvalValue[] {
  const out: EvalValue[] = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      for (const row of a) for (const cell of row) out.push(cell);
    } else {
      out.push(a);
    }
  }
  return out;
}

function toMatrix(a: ArgValue): EvalValue[][] {
  return Array.isArray(a) ? a : [[a]];
}

function firstScalar(a: ArgValue): EvalValue {
  if (!Array.isArray(a)) return a;
  return a[0]?.[0] ?? null;
}

function matchCriteria(val: EvalValue, criteriaRaw: EvalValue): boolean {
  if (isErr(val)) return false;
  const crit = toStr(criteriaRaw);
  const opMatch = /^(<=|>=|<>|<|>|=)(.*)$/.exec(crit);
  if (opMatch) {
    const op = opMatch[1]!;
    const rhsRaw = opMatch[2]!.trim();
    const rhsNum = Number(rhsRaw);
    const valNum = typeof val === "number" ? val : typeof val === "string" && val.trim() !== "" && Number.isFinite(Number(val)) ? Number(val) : NaN;
    if (rhsRaw !== "" && Number.isFinite(rhsNum) && Number.isFinite(valNum)) {
      if (op === "=") return valNum === rhsNum;
      if (op === "<>") return valNum !== rhsNum;
      if (op === "<") return valNum < rhsNum;
      if (op === "<=") return valNum <= rhsNum;
      if (op === ">") return valNum > rhsNum;
      if (op === ">=") return valNum >= rhsNum;
    }
    const a = toStr(val).toLowerCase();
    const b = rhsRaw.toLowerCase();
    if (op === "=") return a === b;
    if (op === "<>") return a !== b;
    if (op === "<") return a < b;
    if (op === "<=") return a <= b;
    if (op === ">") return a > b;
    if (op === ">=") return a >= b;
  }
  if (typeof criteriaRaw === "number" && typeof val === "number") return val === criteriaRaw;
  if (typeof criteriaRaw === "boolean" && typeof val === "boolean") return val === criteriaRaw;
  const pattern = crit.toLowerCase();
  if (pattern.includes("*") || pattern.includes("?")) {
    const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    return re.test(toStr(val).toLowerCase());
  }
  return toStr(val).toLowerCase() === pattern;
}

/** A date or time value as a serial number: numbers as they are, text as typed dates are read. */
function toSerial(v: EvalValue): number | FormulaError {
  if (isErr(v)) return v;
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim()) {
    const p = parseDateText(v, "ymd") ?? parseDateText(v, "mdy");
    if (p) return p.serial;
  }
  return new FormulaError("#VALUE!", `${toStr(v) || "An empty cell"} is not a date`);
}

function parseDateValue(v: EvalValue): Date | null {
  const n = toSerial(v);
  return isErr(n) ? null : serialToDate(n);
}

const toExcelSerial = dateToSerial;

function nowInZone(timeZone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    return new Date(Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second")));
  } catch {
    return new Date();
  }
}

export interface EvalContext {
  sheetId: string;
  sheets: Map<string, SheetData>;
  timeZone: string;
  /** Values worked out so far: sheet id → cell → value. */
  cache: Map<string, Map<string, EvalValue>>;
  visiting: Set<string>;
  /** The cell being evaluated, for ROW() and COLUMN() without a reference. */
  cell?: { row: number; col: number };
  /** Last used row per sheet, so A:A reads only as far as there is data. */
  lastRow?: Map<string, number>;
}

function lastRowOf(ctx: EvalContext, sheet: SheetData): number {
  ctx.lastRow ??= new Map();
  let n = ctx.lastRow.get(sheet.id);
  if (n === undefined) {
    n = -1;
    // Keys are already clean ("B12"), so the row is the digits.
    for (const ref of Object.keys(sheet.cells)) {
      let i = 0;
      while (i < ref.length && ref.charCodeAt(i) > 57) i++;
      const row = Number(ref.slice(i)) - 1;
      if (row > n) n = row;
    }
    ctx.lastRow.set(sheet.id, n);
  }
  return n;
}

function resolveSheet(ctx: EvalContext, nameOrId: string): SheetData | null {
  const byId = ctx.sheets.get(nameOrId);
  if (byId) return byId;
  const low = nameOrId.trim().toLowerCase();
  for (const s of ctx.sheets.values()) {
    if (s.title.trim().toLowerCase() === low || s.id.toLowerCase() === low) return s;
  }
  return null;
}

export function evalCell(ctx: EvalContext, sheetId: string, ref: string): EvalValue {
  const cleanRef = /[$a-z]/.test(ref) ? ref.replace(/\$/g, "").toUpperCase() : ref;
  let known = ctx.cache.get(sheetId);
  if (!known) {
    known = new Map();
    ctx.cache.set(sheetId, known);
  }
  const hit = known.get(cleanRef);
  if (hit !== undefined || known.has(cleanRef)) return hit ?? null;
  const sheet = ctx.sheets.get(sheetId);
  if (!sheet) return new FormulaError("#REF!", "That sheet no longer exists");
  const cell = sheet.cells[cleanRef];
  if (!cell) {
    known.set(cleanRef, null);
    return null;
  }
  if (typeof cell.f === "string" && cell.f.startsWith("=")) {
    const key = `${sheetId}!${cleanRef}`;
    if (ctx.visiting.has(key)) return new FormulaError("#REF!", `Circular reference: ${cleanRef} depends on its own value`);
    ctx.visiting.add(key);
    const outer = ctx.cell;
    const at = parseCellRef(cleanRef);
    ctx.cell = at ? { row: at.row, col: at.col } : undefined;
    let val: EvalValue;
    try {
      val = evalFormulaString(cell.f, ctx, sheetId);
    } finally {
      ctx.visiting.delete(key);
      ctx.cell = outer;
    }
    known.set(cleanRef, val);
    return val;
  }
  const v = cell.v ?? null;
  known.set(cleanRef, v);
  return v;
}

function evalRange(ctx: EvalContext, sheetId: string, r1: number, c1: number, r2: number, c2: number): EvalValue[][] {
  const sr = Math.min(r1, r2);
  const er = Math.max(r1, r2);
  const sc = Math.min(c1, c2);
  const ec = Math.max(c1, c2);
  const rows: EvalValue[][] = [];
  for (let r = sr; r <= er; r++) {
    const row: EvalValue[] = [];
    for (let c = sc; c <= ec; c++) {
      row.push(evalCell(ctx, sheetId, formatCellRef(r, c)));
    }
    rows.push(row);
  }
  return rows;
}

function callBuiltin(name: string, args: ArgValue[], ctx: EvalContext): ArgValue {
  const fn = name.toUpperCase();
  const nums = (onlyNumbers = false): number[] | FormulaError => {
    const out: number[] = [];
    for (const v of flattenArgs(args)) {
      if (isErr(v)) return v;
      if (typeof v === "number") out.push(v);
      else if (!onlyNumbers && typeof v === "boolean") out.push(v ? 1 : 0);
    }
    return out;
  };

  switch (fn) {
    case "SUM": {
      const n = nums(true);
      if (isErr(n)) return n;
      return n.reduce((a, b) => a + b, 0);
    }
    case "AVERAGE":
    case "AVG": {
      const n = nums(true);
      if (isErr(n)) return n;
      return n.length ? n.reduce((a, b) => a + b, 0) / n.length : new FormulaError("#DIV/0!");
    }
    case "MIN": {
      const n = nums(true);
      if (isErr(n)) return n;
      return n.length ? Math.min(...n) : 0;
    }
    case "MAX": {
      const n = nums(true);
      if (isErr(n)) return n;
      return n.length ? Math.max(...n) : 0;
    }
    case "MEDIAN": {
      const n = nums(true);
      if (isErr(n)) return n;
      if (!n.length) return new FormulaError("#NUM!");
      const s = [...n].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
    }
    case "PRODUCT": {
      const n = nums(true);
      if (isErr(n)) return n;
      return n.length ? n.reduce((a, b) => a * b, 1) : 0;
    }
    case "SUMPRODUCT": {
      if (!args.length) return new FormulaError("#VALUE!");
      const mats = args.map(toMatrix);
      const rCount = mats[0]!.length;
      const cCount = mats[0]![0]?.length ?? 0;
      let total = 0;
      for (let r = 0; r < rCount; r++) {
        for (let c = 0; c < cCount; c++) {
          let prod = 1;
          for (const m of mats) {
            const v = m[r]?.[c] ?? 0;
            if (isErr(v)) return v;
            prod *= typeof v === "number" ? v : 0;
          }
          total += prod;
        }
      }
      return total;
    }
    case "COUNT": {
      let c = 0;
      for (const v of flattenArgs(args)) if (typeof v === "number") c++;
      return c;
    }
    case "COUNTA": {
      let c = 0;
      for (const v of flattenArgs(args)) if (v !== null && v !== "") c++;
      return c;
    }
    case "COUNTBLANK": {
      let c = 0;
      for (const v of flattenArgs(args)) if (v === null || v === "") c++;
      return c;
    }
    case "COUNTIF": {
      if (args.length < 2) return new FormulaError("#VALUE!");
      const range = flattenArgs([args[0]!]);
      const crit = firstScalar(args[1]!);
      let c = 0;
      for (const v of range) if (matchCriteria(v, crit)) c++;
      return c;
    }
    case "SUMIF": {
      if (args.length < 2) return new FormulaError("#VALUE!");
      const range = flattenArgs([args[0]!]);
      const crit = firstScalar(args[1]!);
      const sumRange = args[2] !== undefined ? flattenArgs([args[2]]) : range;
      let sum = 0;
      for (let i = 0; i < range.length; i++) {
        if (matchCriteria(range[i]!, crit)) {
          const v = sumRange[i];
          if (typeof v === "number") sum += v;
        }
      }
      return sum;
    }
    case "AVERAGEIF": {
      if (args.length < 2) return new FormulaError("#VALUE!");
      const range = flattenArgs([args[0]!]);
      const crit = firstScalar(args[1]!);
      const avgRange = args[2] !== undefined ? flattenArgs([args[2]]) : range;
      let sum = 0;
      let cnt = 0;
      for (let i = 0; i < range.length; i++) {
        if (matchCriteria(range[i]!, crit)) {
          const v = avgRange[i];
          if (typeof v === "number") {
            sum += v;
            cnt++;
          }
        }
      }
      return cnt ? sum / cnt : new FormulaError("#DIV/0!");
    }
    case "SUMIFS": {
      if (args.length < 3 || args.length % 2 === 0) return new FormulaError("#VALUE!");
      const target = flattenArgs([args[0]!]);
      const pairs: [EvalValue[], EvalValue][] = [];
      for (let i = 1; i < args.length; i += 2) {
        pairs.push([flattenArgs([args[i]!]), firstScalar(args[i + 1]!)]);
      }
      let sum = 0;
      for (let i = 0; i < target.length; i++) {
        if (pairs.every(([r, c]) => matchCriteria(r[i] ?? null, c))) {
          const v = target[i];
          if (typeof v === "number") sum += v;
        }
      }
      return sum;
    }
    case "COUNTIFS": {
      if (args.length < 2 || args.length % 2 !== 0) return new FormulaError("#VALUE!");
      const pairs: [EvalValue[], EvalValue][] = [];
      for (let i = 0; i < args.length; i += 2) {
        pairs.push([flattenArgs([args[i]!]), firstScalar(args[i + 1]!)]);
      }
      const len = pairs[0]![0].length;
      let cnt = 0;
      for (let i = 0; i < len; i++) {
        if (pairs.every(([r, c]) => matchCriteria(r[i] ?? null, c))) cnt++;
      }
      return cnt;
    }
    case "ROUND":
    case "ROUNDUP":
    case "ROUNDDOWN": {
      const n = toNum(firstScalar(args[0] ?? null));
      if (isErr(n)) return n;
      const p = args[1] !== undefined ? toNum(firstScalar(args[1])) : 0;
      if (isErr(p)) return p;
      const f = Math.pow(10, Math.trunc(p));
      if (fn === "ROUND") return Math.round(n * f) / f;
      if (fn === "ROUNDUP") return (n >= 0 ? Math.ceil(n * f) : Math.floor(n * f)) / f;
      return (n >= 0 ? Math.floor(n * f) : Math.ceil(n * f)) / f;
    }
    case "ABS": {
      const n = toNum(firstScalar(args[0] ?? null));
      return isErr(n) ? n : Math.abs(n);
    }
    case "SQRT": {
      const n = toNum(firstScalar(args[0] ?? null));
      if (isErr(n)) return n;
      return n < 0 ? new FormulaError("#NUM!") : Math.sqrt(n);
    }
    case "POWER": {
      const a = toNum(firstScalar(args[0] ?? null));
      const b = toNum(firstScalar(args[1] ?? null));
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      return Math.pow(a, b);
    }
    case "MOD": {
      const a = toNum(firstScalar(args[0] ?? null));
      const b = toNum(firstScalar(args[1] ?? null));
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      return b === 0 ? new FormulaError("#DIV/0!") : a - b * Math.floor(a / b);
    }
    case "INT": {
      const n = toNum(firstScalar(args[0] ?? null));
      return isErr(n) ? n : Math.floor(n);
    }
    case "SIGN": {
      const n = toNum(firstScalar(args[0] ?? null));
      return isErr(n) ? n : Math.sign(n);
    }
    case "PI":
      return Math.PI;
    case "RAND":
      return Math.random();
    case "RANDBETWEEN": {
      const lo = toNum(firstScalar(args[0] ?? null));
      const hi = toNum(firstScalar(args[1] ?? null));
      if (isErr(lo)) return lo;
      if (isErr(hi)) return hi;
      return Math.floor(Math.random() * (Math.floor(hi) - Math.ceil(lo) + 1)) + Math.ceil(lo);
    }
    case "IF": {
      const cond = toBool(firstScalar(args[0] ?? null));
      if (isErr(cond)) return cond;
      return cond ? firstScalar(args[1] ?? true) : firstScalar(args[2] ?? false);
    }
    case "IFS": {
      for (let i = 0; i + 1 < args.length; i += 2) {
        const cond = toBool(firstScalar(args[i]!));
        if (isErr(cond)) return cond;
        if (cond) return firstScalar(args[i + 1]!);
      }
      return new FormulaError("#N/A");
    }
    case "AND": {
      for (const v of flattenArgs(args)) {
        if (v === null) continue;
        const b = toBool(v);
        if (isErr(b)) return b;
        if (!b) return false;
      }
      return true;
    }
    case "OR": {
      for (const v of flattenArgs(args)) {
        if (v === null) continue;
        const b = toBool(v);
        if (isErr(b)) return b;
        if (b) return true;
      }
      return false;
    }
    case "NOT": {
      const b = toBool(firstScalar(args[0] ?? null));
      return isErr(b) ? b : !b;
    }
    case "TRUE":
      return true;
    case "FALSE":
      return false;
    case "IFERROR": {
      const v = firstScalar(args[0] ?? null);
      return isErr(v) ? firstScalar(args[1] ?? "") : v;
    }
    case "IFNA": {
      const v = firstScalar(args[0] ?? null);
      return isErr(v) && v.code === "#N/A" ? firstScalar(args[1] ?? "") : v;
    }
    case "ISBLANK": {
      const v = firstScalar(args[0] ?? null);
      return v === null || v === "";
    }
    case "ISNUMBER":
      return typeof firstScalar(args[0] ?? null) === "number";
    case "ISTEXT":
      return typeof firstScalar(args[0] ?? null) === "string";
    case "ISERROR":
      return isErr(firstScalar(args[0] ?? null));
    case "CONCAT":
    case "CONCATENATE":
      return flattenArgs(args)
        .map((v) => (isErr(v) ? "" : toStr(v)))
        .join("");
    case "TEXTJOIN": {
      const delim = toStr(firstScalar(args[0] ?? ""));
      const ignoreEmpty = Boolean(toBool(firstScalar(args[1] ?? true)));
      const parts = flattenArgs(args.slice(2)).map((v) => toStr(v));
      return (ignoreEmpty ? parts.filter((p) => p !== "") : parts).join(delim);
    }
    case "LEFT": {
      const s = toStr(firstScalar(args[0] ?? ""));
      const n = args[1] !== undefined ? toNum(firstScalar(args[1])) : 1;
      if (isErr(n)) return n;
      return s.slice(0, Math.max(0, Math.trunc(n)));
    }
    case "RIGHT": {
      const s = toStr(firstScalar(args[0] ?? ""));
      const n = args[1] !== undefined ? toNum(firstScalar(args[1])) : 1;
      if (isErr(n)) return n;
      const count = Math.max(0, Math.trunc(n));
      return count === 0 ? "" : s.slice(-count);
    }
    case "MID": {
      const s = toStr(firstScalar(args[0] ?? ""));
      const start = toNum(firstScalar(args[1] ?? 1));
      const len = toNum(firstScalar(args[2] ?? 0));
      if (isErr(start)) return start;
      if (isErr(len)) return len;
      if (start < 1 || len < 0) return new FormulaError("#VALUE!");
      return s.slice(Math.trunc(start) - 1, Math.trunc(start) - 1 + Math.trunc(len));
    }
    case "LEN":
      return toStr(firstScalar(args[0] ?? "")).length;
    case "TRIM":
      return toStr(firstScalar(args[0] ?? "")).trim().replace(/\s+/g, " ");
    case "UPPER":
      return toStr(firstScalar(args[0] ?? "")).toUpperCase();
    case "LOWER":
      return toStr(firstScalar(args[0] ?? "")).toLowerCase();
    case "PROPER":
      return toStr(firstScalar(args[0] ?? "")).replace(/\w\S*/g, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
    case "SUBSTITUTE": {
      const s = toStr(firstScalar(args[0] ?? ""));
      const search = toStr(firstScalar(args[1] ?? ""));
      const repl = toStr(firstScalar(args[2] ?? ""));
      if (!search) return s;
      if (args[3] === undefined) return s.split(search).join(repl);
      const occ = toNum(firstScalar(args[3]));
      if (isErr(occ)) return occ;
      let idx = 0;
      let count = 0;
      while ((idx = s.indexOf(search, idx)) !== -1) {
        count++;
        if (count === Math.trunc(occ)) return s.slice(0, idx) + repl + s.slice(idx + search.length);
        idx += search.length;
      }
      return s;
    }
    case "FIND":
    case "SEARCH": {
      const needle = toStr(firstScalar(args[0] ?? ""));
      const hay = toStr(firstScalar(args[1] ?? ""));
      const start = args[2] !== undefined ? toNum(firstScalar(args[2])) : 1;
      if (isErr(start)) return start;
      const pos =
        fn === "FIND"
          ? hay.indexOf(needle, Math.max(0, Math.trunc(start) - 1))
          : hay.toLowerCase().indexOf(needle.toLowerCase(), Math.max(0, Math.trunc(start) - 1));
      return pos === -1 ? new FormulaError("#VALUE!") : pos + 1;
    }
    case "REPT": {
      const s = toStr(firstScalar(args[0] ?? ""));
      const n = toNum(firstScalar(args[1] ?? 0));
      if (isErr(n)) return n;
      return n < 0 ? new FormulaError("#VALUE!") : s.repeat(Math.trunc(n));
    }
    case "VALUE": {
      const n = toNum(firstScalar(args[0] ?? null));
      return n;
    }
    case "VLOOKUP": {
      const key = firstScalar(args[0] ?? null);
      const mat = toMatrix(args[1] ?? null);
      const colIdx = toNum(firstScalar(args[2] ?? 1));
      if (isErr(colIdx)) return colIdx;
      const c = Math.trunc(colIdx) - 1;
      if (c < 0 || c >= (mat[0]?.length ?? 0)) return new FormulaError("#REF!");
      const approx = args[3] !== undefined ? Boolean(toBool(firstScalar(args[3]))) : true;
      if (!approx) {
        for (const row of mat) {
          if (toStr(row[0] ?? null).toLowerCase() === toStr(key).toLowerCase()) return row[c] ?? null;
        }
        return new FormulaError("#N/A");
      }
      let best: EvalValue[] | null = null;
      for (const row of mat) {
        const v = row[0] ?? null;
        if (typeof v === "number" && typeof key === "number" && v <= key) best = row;
        else if (toStr(v).toLowerCase() <= toStr(key).toLowerCase()) best = row;
      }
      return best ? (best[c] ?? null) : new FormulaError("#N/A");
    }
    case "HLOOKUP": {
      const key = firstScalar(args[0] ?? null);
      const mat = toMatrix(args[1] ?? null);
      const rowIdx = toNum(firstScalar(args[2] ?? 1));
      if (isErr(rowIdx)) return rowIdx;
      const r = Math.trunc(rowIdx) - 1;
      if (r < 0 || r >= mat.length) return new FormulaError("#REF!");
      const firstRow = mat[0] ?? [];
      for (let c = 0; c < firstRow.length; c++) {
        if (toStr(firstRow[c] ?? null).toLowerCase() === toStr(key).toLowerCase()) return mat[r]?.[c] ?? null;
      }
      return new FormulaError("#N/A");
    }
    case "XLOOKUP": {
      const key = firstScalar(args[0] ?? null);
      const lookup = flattenArgs([args[1] ?? null]);
      const ret = flattenArgs([args[2] ?? null]);
      for (let i = 0; i < lookup.length; i++) {
        if (toStr(lookup[i] ?? null).toLowerCase() === toStr(key).toLowerCase()) return ret[i] ?? null;
      }
      return args[3] !== undefined ? firstScalar(args[3]) : new FormulaError("#N/A");
    }
    case "INDEX": {
      const mat = toMatrix(args[0] ?? null);
      const r = toNum(firstScalar(args[1] ?? 1));
      const c = args[2] !== undefined ? toNum(firstScalar(args[2])) : 1;
      if (isErr(r)) return r;
      if (isErr(c)) return c;
      const ri = Math.trunc(r) - 1;
      const ci = Math.trunc(c) - 1;
      if (ri < 0 || ri >= mat.length || ci < 0 || ci >= (mat[0]?.length ?? 0)) return new FormulaError("#REF!");
      return mat[ri]?.[ci] ?? null;
    }
    case "MATCH": {
      const key = firstScalar(args[0] ?? null);
      const arr = flattenArgs([args[1] ?? null]);
      const type = args[2] !== undefined ? toNum(firstScalar(args[2])) : 1;
      if (isErr(type)) return type;
      if (type === 0 || typeof key !== "number") {
        for (let i = 0; i < arr.length; i++) {
          if (toStr(arr[i] ?? null).toLowerCase() === toStr(key).toLowerCase()) return i + 1;
        }
        return new FormulaError("#N/A", `${toStr(key)} is not in the range`);
      }
      let best = -1;
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (typeof v !== "number") continue;
        if (type > 0 ? v <= key : v >= key) best = i;
        else break;
      }
      return best >= 0 ? best + 1 : new FormulaError("#N/A", `Nothing in the range is ${type > 0 ? "at most" : "at least"} ${key}`);
    }
    case "TODAY": {
      const d = nowInZone(ctx.timeZone);
      const dayOnly = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      return toExcelSerial(dayOnly);
    }
    case "NOW":
      return toExcelSerial(nowInZone(ctx.timeZone));
    case "DATE": {
      const y = toNum(firstScalar(args[0] ?? 1970));
      const m = toNum(firstScalar(args[1] ?? 1));
      const d = toNum(firstScalar(args[2] ?? 1));
      if (isErr(y)) return y;
      if (isErr(m)) return m;
      if (isErr(d)) return d;
      return toExcelSerial(new Date(Date.UTC(Math.trunc(y), Math.trunc(m) - 1, Math.trunc(d))));
    }
    case "YEAR":
    case "MONTH":
    case "DAY": {
      const d = parseDateValue(firstScalar(args[0] ?? null));
      if (!d) return new FormulaError("#VALUE!");
      if (fn === "YEAR") return d.getUTCFullYear();
      if (fn === "MONTH") return d.getUTCMonth() + 1;
      return d.getUTCDate();
    }
    case "AVERAGEIFS":
    case "MAXIFS":
    case "MINIFS": {
      if (args.length < 3 || args.length % 2 === 0) return new FormulaError("#VALUE!", `${fn} takes a range, then pairs of range and criterion`);
      const target = flattenArgs([args[0]!]);
      const pairs: [EvalValue[], EvalValue][] = [];
      for (let i = 1; i < args.length; i += 2) pairs.push([flattenArgs([args[i]!]), firstScalar(args[i + 1]!)]);
      const hits: number[] = [];
      for (let i = 0; i < target.length; i++) {
        const v = target[i];
        if (typeof v === "number" && pairs.every(([r, c]) => matchCriteria(r[i] ?? null, c))) hits.push(v);
      }
      if (fn === "AVERAGEIFS") return hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : new FormulaError("#DIV/0!", "No cells match");
      if (!hits.length) return 0;
      return fn === "MAXIFS" ? Math.max(...hits) : Math.min(...hits);
    }
    case "COUNTUNIQUE": {
      const seen = new Set<string>();
      for (const v of flattenArgs(args)) if (v !== null && v !== "" && !isErr(v)) seen.add(typeof v === "string" ? `s:${v.toLowerCase()}` : `${typeof v}:${v}`);
      return seen.size;
    }
    case "LARGE":
    case "SMALL": {
      const n = toNum(firstScalar(args[1] ?? null));
      if (isErr(n)) return n;
      const list = flattenArgs([args[0] ?? null]).filter((v): v is number => typeof v === "number").sort((a, b) => (fn === "LARGE" ? b - a : a - b));
      const k = Math.trunc(n);
      return k >= 1 && k <= list.length ? list[k - 1]! : new FormulaError("#NUM!", `${fn} asks for item ${k} of ${list.length}`);
    }
    case "RANK": {
      const v = toNum(firstScalar(args[0] ?? null));
      if (isErr(v)) return v;
      const asc = args[2] !== undefined && Boolean(toBool(firstScalar(args[2])));
      const list = flattenArgs([args[1] ?? null]).filter((x): x is number => typeof x === "number");
      if (!list.includes(v)) return new FormulaError("#N/A", "The value is not in the range");
      return list.filter((x) => (asc ? x < v : x > v)).length + 1;
    }
    case "STDEV":
    case "STDEV.S":
    case "STDEVP":
    case "STDEV.P":
    case "VAR":
    case "VAR.S":
    case "VARP":
    case "VAR.P": {
      const n = nums(true);
      if (isErr(n)) return n;
      const pop = fn.endsWith("P");
      if (n.length < (pop ? 1 : 2)) return new FormulaError("#DIV/0!", "Not enough numbers");
      const mean = n.reduce((a, b) => a + b, 0) / n.length;
      const variance = n.reduce((a, b) => a + (b - mean) ** 2, 0) / (n.length - (pop ? 0 : 1));
      return fn.startsWith("VAR") ? variance : Math.sqrt(variance);
    }
    case "TRUNC": {
      const n = toNum(firstScalar(args[0] ?? null));
      const p = args[1] !== undefined ? toNum(firstScalar(args[1])) : 0;
      if (isErr(n)) return n;
      if (isErr(p)) return p;
      const f = Math.pow(10, Math.trunc(p));
      return Math.trunc(n * f) / f;
    }
    case "CEILING":
    case "FLOOR": {
      const n = toNum(firstScalar(args[0] ?? null));
      const f = args[1] !== undefined ? toNum(firstScalar(args[1])) : 1;
      if (isErr(n)) return n;
      if (isErr(f)) return f;
      if (f === 0) return 0;
      return (fn === "CEILING" ? Math.ceil(n / f) : Math.floor(n / f)) * f;
    }
    case "EXP": {
      const n = toNum(firstScalar(args[0] ?? null));
      return isErr(n) ? n : Math.exp(n);
    }
    case "LN":
    case "LOG10":
    case "LOG": {
      const n = toNum(firstScalar(args[0] ?? null));
      if (isErr(n)) return n;
      if (n <= 0) return new FormulaError("#NUM!", "Logarithms need a number above 0");
      if (fn === "LN") return Math.log(n);
      const base = fn === "LOG" && args[1] !== undefined ? toNum(firstScalar(args[1])) : 10;
      if (isErr(base)) return base;
      return Math.log(n) / Math.log(base);
    }
    case "PMT": {
      const rate = toNum(firstScalar(args[0] ?? null));
      const nper = toNum(firstScalar(args[1] ?? null));
      const pv = toNum(firstScalar(args[2] ?? null));
      const fv = args[3] !== undefined ? toNum(firstScalar(args[3])) : 0;
      const type = args[4] !== undefined ? toNum(firstScalar(args[4])) : 0;
      for (const x of [rate, nper, pv, fv, type]) if (isErr(x)) return x;
      const [r, n, p, f, t] = [rate, nper, pv, fv, type] as number[];
      if (n === 0) return new FormulaError("#NUM!", "PMT needs at least one period");
      if (r === 0) return -(p! + f!) / n!;
      const g = Math.pow(1 + r!, n!);
      return -(r! * (p! * g + f!)) / ((1 + r! * (t ? 1 : 0)) * (g - 1));
    }
    case "SWITCH": {
      const v = firstScalar(args[0] ?? null);
      if (isErr(v)) return v;
      let i = 1;
      for (; i + 1 < args.length; i += 2) {
        const c = firstScalar(args[i]!);
        if (toStr(c).toLowerCase() === toStr(v).toLowerCase()) return firstScalar(args[i + 1]!);
      }
      return i < args.length ? firstScalar(args[i]!) : new FormulaError("#N/A", "No case matches");
    }
    case "CHOOSE": {
      const n = toNum(firstScalar(args[0] ?? null));
      if (isErr(n)) return n;
      const k = Math.trunc(n);
      return k >= 1 && k < args.length ? firstScalar(args[k]!) : new FormulaError("#VALUE!", `CHOOSE has no value number ${k}`);
    }
    case "ISERR": {
      const v = firstScalar(args[0] ?? null);
      return isErr(v) && v.code !== "#N/A";
    }
    case "ISNA": {
      const v = firstScalar(args[0] ?? null);
      return isErr(v) && v.code === "#N/A";
    }
    case "ISLOGICAL":
      return typeof firstScalar(args[0] ?? null) === "boolean";
    case "N": {
      const v = firstScalar(args[0] ?? null);
      if (isErr(v)) return v;
      return typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : 0;
    }
    case "T": {
      const v = firstScalar(args[0] ?? null);
      return typeof v === "string" ? v : "";
    }
    case "EXACT":
      return toStr(firstScalar(args[0] ?? "")) === toStr(firstScalar(args[1] ?? ""));
    case "TEXT": {
      const v = firstScalar(args[0] ?? null);
      if (isErr(v)) return v;
      const pattern = toStr(firstScalar(args[1] ?? ""));
      const n = typeof v === "number" ? v : typeof v === "string" ? toSerial(v) : toNum(v);
      if (isErr(n)) return toStr(v);
      return formatPattern(n, pattern);
    }
    case "DATEVALUE": {
      const v = firstScalar(args[0] ?? null);
      const n = toSerial(v);
      return isErr(n) ? n : Math.floor(n);
    }
    case "TIME": {
      const h = toNum(firstScalar(args[0] ?? 0));
      const m = toNum(firstScalar(args[1] ?? 0));
      const s = toNum(firstScalar(args[2] ?? 0));
      if (isErr(h)) return h;
      if (isErr(m)) return m;
      if (isErr(s)) return s;
      const total = (Math.trunc(h) * 3600 + Math.trunc(m) * 60 + Math.trunc(s)) / 86_400;
      return total - Math.floor(total);
    }
    case "HOUR":
    case "MINUTE":
    case "SECOND": {
      const n = toSerial(firstScalar(args[0] ?? null));
      if (isErr(n)) return n;
      const secs = Math.round((n - Math.floor(n)) * 86_400);
      if (fn === "HOUR") return Math.floor(secs / 3600) % 24;
      if (fn === "MINUTE") return Math.floor(secs / 60) % 60;
      return secs % 60;
    }
    case "WEEKDAY": {
      const d = parseDateValue(firstScalar(args[0] ?? null));
      if (!d) return new FormulaError("#VALUE!", "WEEKDAY needs a date");
      const type = args[1] !== undefined ? toNum(firstScalar(args[1])) : 1;
      if (isErr(type)) return type;
      const day = d.getUTCDay();
      if (type === 2) return day === 0 ? 7 : day;
      if (type === 3) return day === 0 ? 6 : day - 1;
      return day + 1;
    }
    case "EDATE":
    case "EOMONTH": {
      const d = parseDateValue(firstScalar(args[0] ?? null));
      const k = toNum(firstScalar(args[1] ?? 0));
      if (!d) return new FormulaError("#VALUE!", `${fn} needs a date`);
      if (isErr(k)) return k;
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + Math.trunc(k);
      if (fn === "EOMONTH") return serialOf(y, m + 2, 0);
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      return serialOf(y, m + 1, Math.min(d.getUTCDate(), last));
    }
    case "DAYS": {
      const end = toSerial(firstScalar(args[0] ?? null));
      const start = toSerial(firstScalar(args[1] ?? null));
      if (isErr(end)) return end;
      if (isErr(start)) return start;
      return Math.floor(end) - Math.floor(start);
    }
    case "DATEDIF": {
      const a = parseDateValue(firstScalar(args[0] ?? null));
      const b = parseDateValue(firstScalar(args[1] ?? null));
      const unit = toStr(firstScalar(args[2] ?? "D")).toUpperCase();
      if (!a || !b) return new FormulaError("#VALUE!", "DATEDIF needs two dates");
      if (b < a) return new FormulaError("#NUM!", "The end date is before the start date");
      let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
      if (b.getUTCDate() < a.getUTCDate()) months--;
      const days = Math.floor((b.getTime() - a.getTime()) / 86_400_000);
      if (unit === "Y") return Math.floor(months / 12);
      if (unit === "M") return months;
      if (unit === "D") return days;
      if (unit === "YM") return months % 12;
      if (unit === "MD") {
        const anchor = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() - (b.getUTCDate() < a.getUTCDate() ? 1 : 0), a.getUTCDate()));
        return Math.floor((b.getTime() - anchor.getTime()) / 86_400_000);
      }
      if (unit === "YD") {
        const anchor = new Date(Date.UTC(b.getUTCFullYear() - (new Date(Date.UTC(b.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())) > b ? 1 : 0), a.getUTCMonth(), a.getUTCDate()));
        return Math.floor((b.getTime() - anchor.getTime()) / 86_400_000);
      }
      return new FormulaError("#NUM!", `Unknown DATEDIF unit "${unit}". Use Y, M, D, YM, MD or YD`);
    }
    case "NETWORKDAYS": {
      const a = toSerial(firstScalar(args[0] ?? null));
      const b = toSerial(firstScalar(args[1] ?? null));
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      const [lo, hi] = a <= b ? [Math.floor(a), Math.floor(b)] : [Math.floor(b), Math.floor(a)];
      if (hi - lo > 100_000) return new FormulaError("#NUM!", "The dates are too far apart");
      let n = 0;
      for (let d = lo; d <= hi; d++) {
        const wd = serialToDate(d)!.getUTCDay();
        if (wd !== 0 && wd !== 6) n++;
      }
      return a <= b ? n : -n;
    }
    case "ROW":
      return (ctx.cell?.row ?? 0) + 1;
    case "COLUMN":
      return (ctx.cell?.col ?? 0) + 1;
    case "ROWS":
      return toMatrix(args[0] ?? null).length;
    case "COLUMNS":
      return toMatrix(args[0] ?? null)[0]?.length ?? 0;
    default:
      return new FormulaError("#NAME?", unknownFunction(fn));
  }
}

/** "Unknown function SUMM. Did you mean SUM?" */
export function unknownFunction(name: string): string {
  const up = name.toUpperCase();
  const near = FUNCTIONS.map((f) => ({ f: f.name, d: editDistance(up, f.name) }))
    .filter((x) => x.d <= Math.max(1, Math.floor(up.length / 3)))
    .sort((a, b) => a.d - b.d)[0];
  return `Unknown function ${up}.${near ? ` Did you mean ${near.f}?` : ""}`;
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}

export function evalFormulaString(formula: string, ctx: EvalContext, sheetId = ctx.sheetId): EvalValue {
  const src = formula.startsWith("=") ? formula.slice(1).trim() : formula.trim();
  if (!src) return "";
  try {
    const tokens = tokenize(src);
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];

    const parseExpr = (): ArgValue => parseCompare();

    const parseCompare = (): ArgValue => {
      let left = parseConcat();
      while (peek()?.kind === "op" && ["=", "<>", "<", "<=", ">", ">="].includes((peek() as { v: string }).v)) {
        const op = (next() as { v: string }).v;
        const right = parseConcat();
        const a = firstScalar(left);
        const b = firstScalar(right);
        if (isErr(a)) return a;
        if (isErr(b)) return b;
        const eq = typeof a === typeof b ? a === b : toStr(a).toLowerCase() === toStr(b).toLowerCase();
        if (op === "=") left = eq;
        else if (op === "<>") left = !eq;
        else {
          const na = typeof a === "number" ? a : Number(a);
          const nb = typeof b === "number" ? b : Number(b);
          const cmp = Number.isFinite(na) && Number.isFinite(nb) && a !== null && b !== null ? na - nb : toStr(a).localeCompare(toStr(b));
          if (op === "<") left = cmp < 0;
          else if (op === "<=") left = cmp <= 0;
          else if (op === ">") left = cmp > 0;
          else left = cmp >= 0;
        }
      }
      return left;
    };

    const parseConcat = (): ArgValue => {
      let left = parseAdd();
      while (peek()?.kind === "op" && (peek() as { v: string }).v === "&") {
        next();
        const right = parseAdd();
        const a = firstScalar(left);
        const b = firstScalar(right);
        if (isErr(a)) return a;
        if (isErr(b)) return b;
        left = toStr(a) + toStr(b);
      }
      return left;
    };

    const parseAdd = (): ArgValue => {
      let left = parseMul();
      while (peek()?.kind === "op" && ((peek() as { v: string }).v === "+" || (peek() as { v: string }).v === "-")) {
        const op = (next() as { v: string }).v;
        const right = parseMul();
        const a = toNum(firstScalar(left));
        const b = toNum(firstScalar(right));
        if (isErr(a)) return a;
        if (isErr(b)) return b;
        left = op === "+" ? a + b : a - b;
      }
      return left;
    };

    const parseMul = (): ArgValue => {
      let left = parsePow();
      while (peek()?.kind === "op" && ((peek() as { v: string }).v === "*" || (peek() as { v: string }).v === "/")) {
        const op = (next() as { v: string }).v;
        const right = parsePow();
        const a = toNum(firstScalar(left));
        const b = toNum(firstScalar(right));
        if (isErr(a)) return a;
        if (isErr(b)) return b;
        if (op === "/" && b === 0) return new FormulaError("#DIV/0!");
        left = op === "*" ? a * b : a / b;
      }
      return left;
    };

    const parsePow = (): ArgValue => {
      let left = parseUnary();
      if (peek()?.kind === "op" && (peek() as { v: string }).v === "^") {
        next();
        const right = parsePow();
        const a = toNum(firstScalar(left));
        const b = toNum(firstScalar(right));
        if (isErr(a)) return a;
        if (isErr(b)) return b;
        left = Math.pow(a, b);
      }
      return left;
    };

    const parseUnary = (): ArgValue => {
      if (peek()?.kind === "op" && ((peek() as { v: string }).v === "-" || (peek() as { v: string }).v === "+")) {
        const op = (next() as { v: string }).v;
        const v = toNum(firstScalar(parseUnary()));
        if (isErr(v)) return v;
        return op === "-" ? -v : v;
      }
      let v = parsePrimary();
      if (peek()?.kind === "op" && (peek() as { v: string }).v === "%") {
        next();
        const n = toNum(firstScalar(v));
        v = isErr(n) ? n : n / 100;
      }
      return v;
    };

    // One end of a reference: a cell (B2), a whole column (B) or a whole row (2).
    const endOf = (text: string): { row: number | null; col: number | null } | null => {
      const cell = parseCellRef(text);
      if (cell) return { row: cell.row, col: cell.col };
      const col = /^\$?([A-Za-z]{1,3})$/.exec(text);
      if (col) {
        const c = letterToCol(col[1]!);
        return c >= 0 ? { row: null, col: c } : null;
      }
      const row = /^\$?(\d{1,6})$/.exec(text);
      if (row && Number(row[1]) >= 1) return { row: Number(row[1]) - 1, col: null };
      return null;
    };

    const refValue = (sid: string, from: string, to: string | null): ArgValue => {
      const a = endOf(from);
      const b = to === null ? a : endOf(to);
      if (!a || !b) return new FormulaError("#REF!", `${to === null ? from : `${from}:${to}`} is not a cell or range`);
      if (to === null) {
        if (a.row === null || a.col === null) return new FormulaError("#NAME?", `Unknown name ${from}`);
        return evalCell(ctx, sid, formatCellRef(a.row, a.col));
      }
      const sheet = ctx.sheets.get(sid);
      if (!sheet) return new FormulaError("#REF!", "That sheet no longer exists");
      // An open end (B2:B, A:A) runs from the given end, or the first row or column.
      const r1 = a.row !== null && b.row !== null ? Math.min(a.row, b.row) : (a.row ?? b.row ?? 0);
      const c1 = a.col !== null && b.col !== null ? Math.min(a.col, b.col) : (a.col ?? b.col ?? 0);
      const r2 = a.row === null || b.row === null ? Math.max(r1, a.row ?? 0, b.row ?? 0, lastRowOf(ctx, sheet)) : Math.max(a.row, b.row);
      const c2 = a.col === null || b.col === null ? Math.max(c1, sheet.cols - 1) : Math.max(a.col, b.col);
      if ((r2 - r1 + 1) * (c2 - c1 + 1) > 2_000_000) return new FormulaError("#REF!", "The range is too large");
      return evalRange(ctx, sid, r1, c1, r2, c2);
    };

    const sheetOf = (name: string) => resolveSheet(ctx, name);

    const parsePrimary = (): ArgValue => {
      const t = peek();
      if (!t) throw new FormulaError("#ERROR!", "The formula ends too early");
      if (t.kind === "num") {
        next();
        if (peek()?.kind === "colon" && tokens[pos + 1]?.kind === "num") {
          next();
          const end = next() as { kind: "num"; v: number };
          return refValue(sheetId, String(t.v), String(end.v));
        }
        return t.v;
      }
      if (t.kind === "str") {
        next();
        return t.v;
      }
      if (t.kind === "err") {
        next();
        return new FormulaError("#REF!", "A cell this formula used was deleted");
      }
      if (t.kind === "lparen") {
        next();
        const v = parseExpr();
        if (peek()?.kind !== "rparen") throw new FormulaError("#ERROR!", "A ( is never closed");
        next();
        return v;
      }
      if (t.kind === "sheetRef") {
        next();
        const target = sheetOf(t.sheet);
        if (!target) return new FormulaError("#REF!", `No sheet is called "${t.sheet}"`);
        const parts = t.ref.split(":");
        return refValue(target.id, parts[0]!, parts.length === 2 ? parts[1]! : null);
      }
      if (t.kind === "ident") {
        next();
        if (peek()?.kind === "lparen") {
          next();
          const name = t.v.toUpperCase();
          // ROW(B5) and COLUMN(B5) need the reference, not its value.
          if ((name === "ROW" || name === "COLUMN") && peek()?.kind !== "rparen") {
            const r = peek()!;
            const text = r.kind === "ident" ? r.v : r.kind === "sheetRef" ? r.ref.split(":")[0]! : "";
            const at = endOf(text);
            if (at) {
              next();
              if (peek()?.kind === "colon") {
                next();
                next();
              }
              if (peek()?.kind !== "rparen") throw new FormulaError("#ERROR!", `${name} takes one cell`);
              next();
              const v = name === "ROW" ? at.row : at.col;
              return v === null ? 1 : v + 1;
            }
          }
          const args: ArgValue[] = [];
          if (peek()?.kind !== "rparen") {
            while (true) {
              args.push(parseExpr());
              if (peek()?.kind === "comma") next();
              else break;
            }
          }
          if (peek()?.kind !== "rparen") throw new FormulaError("#ERROR!", `${name}( is never closed`);
          next();
          return callBuiltin(t.v, args, ctx);
        }
        if (t.v.toUpperCase() === "TRUE") return true;
        if (t.v.toUpperCase() === "FALSE") return false;
        if (peek()?.kind === "colon") {
          next();
          const endTok = next();
          const endText = endTok?.kind === "ident" ? endTok.v : endTok?.kind === "num" ? String(endTok.v) : null;
          if (endText === null) return new FormulaError("#REF!", `${t.v}: needs an end, like ${t.v}:${t.v}`);
          return refValue(sheetId, t.v, endText);
        }
        return refValue(sheetId, t.v, null);
      }
      if (t.kind === "rparen") throw new FormulaError("#ERROR!", "An extra ) or a missing value");
      if (t.kind === "comma") throw new FormulaError("#ERROR!", "A value is missing before a comma");
      throw new FormulaError("#ERROR!", `Unexpected ${t.kind === "op" ? t.v : ":"}`);
    };

    const res = parseExpr();
    if (pos < tokens.length) return new FormulaError("#ERROR!", "Unexpected text after the formula; check for a missing operator or comma");
    return firstScalar(res);
  } catch (e) {
    if (e instanceof FormulaError) return e;
    return new FormulaError("#ERROR!", "The formula could not be read");
  }
}

/** Shift relative cell references in a formula by (dRow, dCol), keeping $ locks intact. */
export function shiftFormula(formula: string, dRow: number, dCol: number): string {
  if (!formula.startsWith("=") || (dRow === 0 && dCol === 0)) return formula;
  return formula.replace(/'[^']*'!|\b[A-Za-z_][A-Za-z0-9_]*!|"([^"]|"")*"|(\$?)([A-Z]{1,3})(\$?)(\d{1,6})\b/gi, (m, _q, absC, colStr, absR, rowStr) => {
    if (!colStr || !rowStr) return m;
    const parsed = parseCellRef(`${absC}${colStr}${absR}${rowStr}`);
    if (!parsed) return m;
    const nextRow = parsed.absRow ? parsed.row : Math.max(0, parsed.row + dRow);
    const nextCol = parsed.absCol ? parsed.col : Math.max(0, parsed.col + dCol);
    return formatCellRef(nextRow, nextCol, parsed.absRow, parsed.absCol);
  });
}

/** Evaluate every cell with a formula in the workbook and return a map of sheetId -> (ref -> EvalValue). */
export function evaluateAll(sheets: Map<string, SheetData>, timeZone = "UTC"): Map<string, Map<string, EvalValue>> {
  const ctx: EvalContext = { sheetId: "", sheets, timeZone, cache: new Map(), visiting: new Set() };
  const result = new Map<string, Map<string, EvalValue>>();
  for (const [id, sheet] of sheets) {
    const sheetVals = new Map<string, EvalValue>();
    for (const ref of Object.keys(sheet.cells)) {
      sheetVals.set(ref, evalCell(ctx, id, ref));
    }
    result.set(id, sheetVals);
  }
  return result;
}

