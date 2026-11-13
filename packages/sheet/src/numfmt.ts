// Dates as serial numbers and the format patterns people type ("#,##0.00",
// "0%", "yyyy-mm-dd", "$#,##0;($#,##0)"). No other module is imported here,
// so both the formula engine (TEXT) and cell display can use it.

/** Days from 1899-12-30, the serial day 0 every spreadsheet uses. */
const EPOCH_OFFSET = 25569;
const DAY_MS = 86_400_000;

/** A serial number as a wall-clock date (read its UTC fields), or null when out of range. */
export function serialToDate(n: number): Date | null {
  if (!Number.isFinite(n) || n < -693593 || n > 2958465) return null;
  const d = new Date(Math.round((n - EPOCH_OFFSET) * DAY_MS));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A wall-clock date (its UTC fields) as a serial number. */
export function dateToSerial(d: Date): number {
  return d.getTime() / DAY_MS + EPOCH_OFFSET;
}

export function serialOf(year: number, month: number, day: number, h = 0, m = 0, s = 0): number {
  return dateToSerial(new Date(Date.UTC(year, month - 1, day, h, m, s)));
}

export type DateOrder = "mdy" | "dmy" | "ymd";

export interface ParsedDate {
  serial: number;
  /** The display that matches how it was typed. */
  kind: "date" | "date_short" | "date_full" | "time" | "datetime";
}

function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function fullYear(y: string): number {
  const n = Number(y);
  if (y.length > 2) return n;
  return n < 50 ? 2000 + n : 1900 + n;
}

function monthOf(name: string): { m: number; full: boolean } | null {
  const low = name.toLowerCase().replace(/\.$/, "");
  const i = MONTHS.findIndex((mo) => mo.toLowerCase() === low || mo.slice(0, 3).toLowerCase() === low || (low === "sept" && mo === "September"));
  return i < 0 ? null : { m: i + 1, full: low.length > 4 || low === MONTHS[i]!.toLowerCase() };
}

function timeOf(h: string, m: string, s: string | undefined, ap: string | undefined): number | null {
  let hh = Number(h);
  const mm = Number(m);
  const ss = Number(s ?? 0);
  if (ap) {
    if (hh < 1 || hh > 12) return null;
    hh = (hh % 12) + (ap.toLowerCase() === "pm" ? 12 : 0);
  }
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return (hh * 3600 + mm * 60 + ss) / 86_400;
}

const TIME = String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?`;

/** A date or time as people type it ("3/15/2026", "2026-03-15", "Mar 15, 2026", "2:30 PM"), or null. */
export function parseDateText(raw: string, order: DateOrder = "mdy"): ParsedDate | null {
  const s = raw.trim();
  let m = new RegExp(`^${TIME}$`, "i").exec(s);
  if (m) {
    const t = timeOf(m[1]!, m[2]!, m[3], m[4]);
    return t === null ? null : { serial: t, kind: "time" };
  }
  m = new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})(?:[T ]${TIME})?$`, "i").exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!validDay(y, mo, d)) return null;
    const t = m[4] ? timeOf(m[4], m[5]!, m[6], m[7]) : 0;
    if (t === null) return null;
    return { serial: serialOf(y, mo, d) + t, kind: m[4] ? "datetime" : "date" };
  }
  m = new RegExp(`^(\\d{1,4})([/.-])(\\d{1,2})\\2(\\d{1,4})(?:\\s+${TIME})?$`, "i").exec(s);
  if (m) {
    const a = m[1]!;
    const b = m[3]!;
    const c = m[4]!;
    let y: number;
    let mo: number;
    let d: number;
    if (a.length === 4 || order === "ymd") [y, mo, d] = [fullYear(a), Number(b), Number(c)];
    else if (order === "dmy") [y, mo, d] = [fullYear(c), Number(b), Number(a)];
    else [y, mo, d] = [fullYear(c), Number(a), Number(b)];
    if (!validDay(y, mo, d)) return null;
    const t = m[5] ? timeOf(m[5], m[6]!, m[7], m[8]) : 0;
    if (t === null) return null;
    return { serial: serialOf(y, mo, d) + t, kind: m[5] ? "datetime" : "date" };
  }
  m = /^([A-Za-z]{3,9}\.?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = monthOf(m[1]!);
    const [y, d] = [Number(m[3]), Number(m[2])];
    if (!mo || !validDay(y, mo.m, d)) return null;
    return { serial: serialOf(y, mo.m, d), kind: mo.full ? "date_full" : "date_short" };
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9}\.?),?\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = monthOf(m[2]!);
    const [y, d] = [Number(m[3]), Number(m[1])];
    if (!mo || !validDay(y, mo.m, d)) return null;
    return { serial: serialOf(y, mo.m, d), kind: mo.full ? "date_full" : "date_short" };
  }
  return null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Whether a pattern formats dates or times rather than plain numbers. */
export function isDatePattern(pattern: string): boolean {
  return /[ydhs]|m(?!\w*[#0])/i.test(pattern.replace(/"[^"]*"|\\./g, "").replace(/am\/pm|a\/p/gi, "h"));
}

function formatDatePattern(n: number, pattern: string): string {
  const d = serialToDate(n);
  if (!d) return String(n);
  const tokens = pattern.match(/"[^"]*"|\\.|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|am\/pm|a\/p|\[h\]|./gi) ?? [];
  const ampm = tokens.some((t) => /^(am\/pm|a\/p)$/i.test(t));
  // "m" after an hour or before a second means minutes.
  const isMinute = (i: number) => {
    for (let j = i - 1; j >= 0; j--) {
      const t = tokens[j]!.toLowerCase();
      if (/^h+$|^\[h\]$/.test(t)) return true;
      if (/^[ydm]/.test(t) && t !== ":" ) return false;
    }
    for (let j = i + 1; j < tokens.length; j++) {
      const t = tokens[j]!.toLowerCase();
      if (/^s+$/.test(t)) return true;
      if (/^[ydhm]/.test(t)) return false;
    }
    return false;
  };
  const pad = (v: number, w = 2) => String(v).padStart(w, "0");
  const h24 = d.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return tokens
    .map((tok, i) => {
      const t = tok.toLowerCase();
      if (tok.startsWith('"')) return tok.slice(1, -1);
      if (tok.startsWith("\\")) return tok.slice(1);
      switch (t) {
        case "yyyy":
          return String(d.getUTCFullYear());
        case "yy":
          return pad(d.getUTCFullYear() % 100);
        case "mmmm":
          return MONTHS[d.getUTCMonth()]!;
        case "mmm":
          return MONTHS[d.getUTCMonth()]!.slice(0, 3);
        case "mm":
          return isMinute(i) ? pad(d.getUTCMinutes()) : pad(d.getUTCMonth() + 1);
        case "m":
          return isMinute(i) ? String(d.getUTCMinutes()) : String(d.getUTCMonth() + 1);
        case "dddd":
          return DAYS[d.getUTCDay()]!;
        case "ddd":
          return DAYS[d.getUTCDay()]!.slice(0, 3);
        case "dd":
          return pad(d.getUTCDate());
        case "d":
          return String(d.getUTCDate());
        case "hh":
          return pad(ampm ? h12 : h24);
        case "h":
          return String(ampm ? h12 : h24);
        case "[h]":
          return String(Math.floor(n * 24));
        case "ss":
          return pad(d.getUTCSeconds());
        case "s":
          return String(d.getUTCSeconds());
        case "am/pm":
          return h24 < 12 ? "AM" : "PM";
        case "a/p":
          return h24 < 12 ? "A" : "P";
        default:
          return tok;
      }
    })
    .join("");
}

function literal(s: string): string {
  return s.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1").replace(/_./g, " ");
}

function formatNumberSection(n: number, section: string, locale: string, negative: boolean): string {
  const core = /[#0?][#0?,]*(?:\.[#0?]*)?|\.[#0?]+/.exec(section);
  if (!core) return literal(section);
  const before = section.slice(0, core.index);
  const after = section.slice(core.index + core[0].length);
  const percent = section.includes("%");
  const decimals = (core[0].split(".")[1] ?? "").length;
  const minDecimals = (core[0].split(".")[1] ?? "").replace(/[#?]/g, "").length;
  const grouping = core[0].includes(",");
  const value = Math.abs(percent ? n * 100 : n);
  const body = new Intl.NumberFormat(locale, { useGrouping: grouping, minimumFractionDigits: minDecimals, maximumFractionDigits: decimals }).format(value);
  return `${negative ? "-" : ""}${literal(before)}${body}${literal(after)}`;
}

/** Format a number with a spreadsheet pattern. Unknown pieces are kept as text. */
export function formatPattern(n: number, pattern: string, locale = "en-US"): string {
  const sections = pattern.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  let section = sections[0] ?? "";
  let negative = n < 0;
  if (n < 0 && sections[1] !== undefined) {
    section = sections[1];
    negative = false;
  } else if (n === 0 && sections[2] !== undefined) {
    section = sections[2];
  }
  if (isDatePattern(section)) return formatDatePattern(n, section);
  if (section.toLowerCase() === "general" || section === "") return String(Number(n.toPrecision(12)));
  return formatNumberSection(n, section, locale, negative);
}
