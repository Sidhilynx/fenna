// What a cell shows (its value in the cell's number format, the sheet's
// locale and time zone) and what typing into a cell means: "=SUM(A1:A3)" is
// a formula, "3/15/2026" a date, "$1,200" money, "12%" a percentage.

import type { CellData, NumberFormatKind, WorkbookIndex } from "./schema.ts";
import { type EvalValue, FormulaError } from "./formula.ts";
import { type DateOrder, formatPattern, parseDateText, serialToDate } from "./numfmt.ts";

export interface LocaleOption {
  id: string;
  label: string;
  currency: string;
}

export const LOCALES: readonly LocaleOption[] = [
  { id: "zh-CN", label: "Chinese (China)", currency: "CNY" },
  { id: "nl-NL", label: "Dutch (Netherlands)", currency: "EUR" },
  { id: "en-AU", label: "English (Australia)", currency: "AUD" },
  { id: "en-CA", label: "English (Canada)", currency: "CAD" },
  { id: "en-HK", label: "English (Hong Kong)", currency: "HKD" },
  { id: "en-IN", label: "English (India)", currency: "INR" },
  { id: "en-IE", label: "English (Ireland)", currency: "EUR" },
  { id: "en-NZ", label: "English (New Zealand)", currency: "NZD" },
  { id: "en-PH", label: "English (Philippines)", currency: "PHP" },
  { id: "en-SG", label: "English (Singapore)", currency: "SGD" },
  { id: "en-ZA", label: "English (South Africa)", currency: "ZAR" },
  { id: "en-GB", label: "English (United Kingdom)", currency: "GBP" },
  { id: "en-US", label: "English (United States)", currency: "USD" },
  { id: "et-EE", label: "Estonian (Estonia)", currency: "EUR" },
  { id: "fr-FR", label: "French (France)", currency: "EUR" },
  { id: "de-DE", label: "German (Germany)", currency: "EUR" },
  { id: "it-IT", label: "Italian (Italy)", currency: "EUR" },
  { id: "ja-JP", label: "Japanese (Japan)", currency: "JPY" },
  { id: "ko-KR", label: "Korean (South Korea)", currency: "KRW" },
  { id: "pt-BR", label: "Portuguese (Brazil)", currency: "BRL" },
  { id: "es-ES", label: "Spanish (Spain)", currency: "EUR" },
  { id: "sv-SE", label: "Swedish (Sweden)", currency: "SEK" },
];

export function localeInfo(localeId: string): LocaleOption {
  return LOCALES.find((l) => l.id === localeId) ?? LOCALES.find((l) => l.id === "en-US")!;
}

/** The order people in a locale write dates in: 3/15/2026, 15/3/2026 or 2026/3/15. */
export function dateOrder(localeId: string): DateOrder {
  if (/^en-(US|PH)$/.test(localeId)) return "mdy";
  if (/^(ja|ko|zh|sv)-|^en-CA$/.test(localeId)) return "ymd";
  return "dmy";
}

/** Old names some systems still report, and the names zones go by now. */
const ZONE_ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Pacific/Truk": "Pacific/Chuuk",
};

/** A time zone by the name it goes by now ("Asia/Calcutta" is "Asia/Kolkata"). */
export function canonicalZone(tz: string): string {
  return ZONE_ALIASES[tz] ?? tz;
}

/** The computer's own locale, if we know it, and time zone: what a new sheet starts with. */
export function systemSettings(): { locale: string; timeZone: string } {
  let locale = "en-US";
  let timeZone = "UTC";
  try {
    const o = Intl.DateTimeFormat().resolvedOptions();
    timeZone = canonicalZone(o.timeZone || "UTC");
    const exact = LOCALES.find((l) => l.id.toLowerCase() === o.locale.toLowerCase());
    const lang = LOCALES.find((l) => l.id.split("-")[0] === o.locale.split("-")[0]);
    locale = exact?.id ?? lang?.id ?? "en-US";
  } catch {
    // An old runtime without Intl options: United States English, UTC.
  }
  return { locale, timeZone };
}

export interface TimeZoneOption {
  id: string;
  /** "Kolkata (India Standard Time)" */
  label: string;
  /** "India Standard Time" */
  name: string;
}

function zoneName(tz: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "long" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
    return part?.value ?? tz;
  } catch {
    return tz;
  }
}

let zoneCache: TimeZoneOption[] | null = null;

/** Every time zone the runtime knows, by city. */
export function listTimeZones(): TimeZoneOption[] {
  if (zoneCache) return zoneCache;
  let ids: string[] = [];
  try {
    ids = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    ids = [];
  }
  ids = [...new Set(ids.map(canonicalZone))];
  if (!ids.includes("UTC")) ids = ["UTC", ...ids];
  zoneCache = ids
    .map((id) => {
      const name = zoneName(id);
      const city = id === "UTC" ? "UTC" : (id.split("/").pop() ?? id).replace(/_/g, " ");
      return { id, name, label: id === "UTC" ? "UTC (Coordinated Universal Time)" : `${city} (${name})` };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return zoneCache;
}

export function timeZoneOption(tz: string): TimeZoneOption {
  return listTimeZones().find((t) => t.id === tz) ?? { id: tz, name: zoneName(tz), label: tz };
}

const DATE_FORMATS: Partial<Record<NumberFormatKind, Intl.DateTimeFormatOptions>> = {
  date: { year: "numeric", month: "numeric", day: "numeric" },
  date_short: { year: "numeric", month: "short", day: "numeric" },
  date_full: { year: "numeric", month: "long", day: "numeric" },
  month_day: { month: "short", day: "numeric" },
  month_year: { month: "short", year: "numeric" },
  time: { hour: "numeric", minute: "2-digit" },
  datetime: { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" },
};

/** A serial number shown as a date or time. Serials are wall-clock values, so they are read as UTC. */
function formatDate(n: number, fmt: NumberFormatKind, locale: string): string {
  const d = serialToDate(n);
  const opts = DATE_FORMATS[fmt];
  if (!d || !opts) return String(n);
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(d).replace(/ /g, " ");
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function formatDuration(n: number): string {
  const total = Math.round(n * 86_400);
  const abs = Math.abs(total);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return `${total < 0 ? "-" : ""}${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** The number format a cell shows with: its own, or a date cell's default. */
export function cellFormat(cell: CellData | undefined): NumberFormatKind {
  return cell?.s?.numFmt ?? (cell?.t === "date" ? "date_short" : "auto");
}

export function formatCellValue(val: EvalValue, cell: CellData | undefined, index: Pick<WorkbookIndex, "locale" | "timeZone">): string {
  if (val instanceof FormulaError) return val.code;
  if (val === null || val === undefined || val === "") return "";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  const fmt = cellFormat(cell);
  const loc = localeInfo(index.locale);

  if (typeof val === "string") {
    // Text that reads as a date, in a cell formatted as one (an older file, or a date typed before the format was set).
    if (DATE_FORMATS[fmt]) {
      const p = parseDateText(val, dateOrder(loc.id)) ?? parseDateText(val, "ymd");
      if (p) return formatDate(p.serial, fmt, loc.id);
    }
    return val;
  }

  const num = (min: number, max: number, style?: "percent" | "currency") =>
    new Intl.NumberFormat(loc.id, { minimumFractionDigits: min, maximumFractionDigits: max, ...(style ? { style } : {}), ...(style === "currency" ? { currency: loc.currency } : {}) }).format(val);

  switch (fmt) {
    case "auto":
      return String(Number(val.toPrecision(12)));
    case "number":
      return num(2, 2);
    case "number_rounded":
      return num(0, 0);
    case "number_parens":
      return val < 0 ? `(${new Intl.NumberFormat(loc.id, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(-val)})` : num(2, 2);
    case "percent":
      return num(2, 2, "percent");
    case "scientific":
      return val.toExponential(2).toUpperCase().replace(/E([+-])(\d)$/, (_, sign: string, d: string) => `E${sign}0${d}`);
    case "currency":
      return num(2, 2, "currency");
    case "currency_rounded":
      return num(0, 0, "currency");
    case "duration":
      return formatDuration(val);
    case "custom":
      return cell?.s?.customFmt ? formatPattern(val, cell.s.customFmt, loc.id) : String(val);
    default:
      return formatDate(val, fmt, loc.id);
  }
}

export interface ParsedInput {
  f?: string;
  v?: string | number | boolean | null;
  /** The format what was typed implies ("$5" is currency), for a cell that has none yet. */
  fmt?: NumberFormatKind;
}

const CURRENCY = /^(-)?\(?([$€£₹¥])\s?(-?[\d,]*\.?\d+)\)?$|^(-)?([\d,]*\.?\d+)\s?([€£₹¥])$/;

/** What typing `raw` into a cell means. `locale` decides whether 3/4 is March 4th or April 3rd. */
export function parseUserInput(raw: string, locale = "en-US"): ParsedInput {
  const trimmed = raw.trim();
  if (trimmed === "") return { v: null };
  if (raw.startsWith("'")) return { v: raw.slice(1) };
  if (trimmed.startsWith("=") && trimmed.length > 1) return { f: trimmed };
  if (/^true$/i.test(trimmed)) return { v: true };
  if (/^false$/i.test(trimmed)) return { v: false };
  const pct = /^(-?[\d,]*\.?\d+)\s*%$/.exec(trimmed);
  if (pct) {
    const n = Number(pct[1]!.replace(/,/g, ""));
    if (Number.isFinite(n)) return { v: n / 100, fmt: "percent" };
  }
  const money = CURRENCY.exec(trimmed);
  if (money) {
    const digits = (money[3] ?? money[5] ?? "").replace(/,/g, "");
    const n = Number(digits);
    if (Number.isFinite(n)) {
      const neg = !!(money[1] || money[4]) || /^\(.*\)$/.test(trimmed);
      return { v: neg ? -Math.abs(n) : n, fmt: digits.includes(".") ? "currency" : "currency_rounded" };
    }
  }
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return { v: n };
  }
  if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed.replace(/,/g, ""));
    if (Number.isFinite(n)) return { v: n, fmt: trimmed.includes(".") ? "number" : "number_rounded" };
  }
  const date = parseDateText(trimmed, dateOrder(locale));
  if (date) return { v: date.serial, fmt: date.kind };
  return { v: raw };
}
