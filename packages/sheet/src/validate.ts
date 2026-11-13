// Checking cells that come from outside the editor (an AI through MCP, a
// hand-edited file): every problem is said in words that say how to fix it,
// and values are put in the form the files keep (dates as serial numbers,
// dropdown choices as their labels).

import { dateOrder, parseUserInput } from "./format.ts";
import { FUNCTIONS, unknownFunction } from "./formula.ts";
import { parseDateText } from "./numfmt.ts";
import {
  ALIGN_H,
  ALIGN_V,
  BORDER_STYLES,
  CELL_KEYS,
  CELL_TYPES,
  type CellData,
  type CellStyle,
  type Dropdown,
  DROPDOWN_TEMPLATES,
  FONT_SIZES,
  NUMBER_FORMAT_KINDS,
  type NumberFormatKind,
  STYLE_KEYS,
  WRAP_MODES,
} from "./schema.ts";

export interface CellContext {
  dropdowns: readonly Dropdown[];
  /** Sheet ids and titles a formula may name. */
  sheets: readonly { id: string; title: string }[];
  locale: string;
}

const FN_NAMES = new Set(FUNCTIONS.map((f) => f.name));
const ALIASES = new Set(["AVG", "STDEV.S", "STDEV.P", "VAR.S", "VAR.P", "TRUE", "FALSE"]);

function nearest(word: string, options: readonly string[]): string | null {
  const low = word.toLowerCase();
  let best: string | null = null;
  let bestD = Infinity;
  for (const o of options) {
    const d = distance(low, o.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best !== null && bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return row[b.length]!;
}

const unknownKey = (key: string, allowed: readonly string[], what: string) => {
  const near = nearest(key, allowed);
  return `Unknown ${what} \`${key}\`.${near ? ` Did you mean \`${near}\`?` : ""} Allowed: ${allowed.join(", ")}`;
};

/** Problems in a formula that are certain before it runs: unknown functions and sheets, unbalanced brackets. */
export function lintFormula(f: string, sheets: CellContext["sheets"]): string[] {
  const problems: string[] = [];
  if (!f.startsWith("=")) return ["A formula starts with ="];
  const bare = f.replace(/"(?:[^"]|"")*"/g, '""');
  let depth = 0;
  for (const ch of bare.replace(/'(?:[^']|'')*'/g, "''")) {
    if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0) break;
  }
  if (depth !== 0) problems.push(depth > 0 ? "A ( is never closed" : "There is a ) with no ( before it");
  for (const m of bare.replace(/'(?:[^']|'')*'!/g, "").matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)) {
    const name = m[1]!.toUpperCase();
    if (!FN_NAMES.has(name) && !ALIASES.has(name)) problems.push(unknownFunction(name));
  }
  const names = sheets.flatMap((s) => [s.id, s.title]);
  for (const m of bare.matchAll(/'((?:[^']|'')*)'!|([A-Za-z_][A-Za-z0-9_.]*)!/g)) {
    const name = (m[1] ?? m[2] ?? "").replace(/''/g, "'");
    if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) {
      const near = nearest(name, sheets.map((s) => s.title));
      problems.push(`No sheet is called "${name}".${near ? ` Did you mean '${near}'?` : ""} Sheets: ${sheets.map((s) => `'${s.title}'`).join(", ")}`);
    }
  }
  return problems;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const fullHex = (c: string) => (c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c).toLowerCase();

/** A color as files keep it ("#1a5394"), or null if it isn't a hex color. */
export function hexColor(v: unknown): string | null {
  return typeof v === "string" && HEX.test(v) ? fullHex(v) : null;
}

function checkStyle(raw: unknown, problems: string[]): CellStyle | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    problems.push("s must be an object of style keys, like {\"bold\": true}");
    return undefined;
  }
  const out: CellStyle = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(STYLE_KEYS as readonly string[]).includes(k)) {
      problems.push(unknownKey(k, STYLE_KEYS, "style key"));
      continue;
    }
    if (v === null || v === undefined) continue;
    switch (k) {
      case "bold":
      case "italic":
      case "underline":
      case "strike":
        if (typeof v !== "boolean") problems.push(`${k} must be true or false`);
        else if (v) out[k] = true;
        break;
      case "fontSize":
        if (typeof v !== "number" || !(FONT_SIZES as readonly number[]).includes(v)) problems.push(`fontSize must be one of ${FONT_SIZES.join(", ")} (points)`);
        else out.fontSize = v;
        break;
      case "color":
      case "fill":
        if (typeof v !== "string" || !HEX.test(v)) problems.push(`${k} must be a hex color like "#1a5394"`);
        else out[k] = fullHex(v);
        break;
      case "alignH":
        if (!(ALIGN_H as readonly unknown[]).includes(v)) problems.push(`alignH must be one of ${ALIGN_H.join(", ")}`);
        else out.alignH = v as CellStyle["alignH"];
        break;
      case "alignV":
        if (!(ALIGN_V as readonly unknown[]).includes(v)) problems.push(`alignV must be one of ${ALIGN_V.join(", ")}`);
        else out.alignV = v as CellStyle["alignV"];
        break;
      case "wrap":
        if (!(WRAP_MODES as readonly unknown[]).includes(v)) problems.push(`wrap must be one of ${WRAP_MODES.join(", ")}`);
        else out.wrap = v as CellStyle["wrap"];
        break;
      case "numFmt":
        if (!(NUMBER_FORMAT_KINDS as readonly unknown[]).includes(v)) {
          const near = typeof v === "string" ? nearest(v, NUMBER_FORMAT_KINDS) : null;
          problems.push(`Unknown numFmt ${JSON.stringify(v)}.${near ? ` Did you mean "${near}"?` : ""} Allowed: ${NUMBER_FORMAT_KINDS.join(", ")}. For a pattern such as "0.0%", use numFmt "custom" with customFmt`);
        } else out.numFmt = v as CellStyle["numFmt"];
        break;
      case "customFmt":
        if (typeof v !== "string" || v.length > 100) problems.push('customFmt must be a pattern like "#,##0.00" or "yyyy-mm-dd"');
        else out.customFmt = v;
        break;
      case "borders": {
        if (typeof v !== "object") {
          problems.push('borders must be like {"bottom": {"style": "thin", "color": "#737373"}}');
          break;
        }
        const borders: NonNullable<CellStyle["borders"]> = {};
        for (const [side, b] of Object.entries(v as Record<string, unknown>)) {
          if (!["top", "right", "bottom", "left"].includes(side)) {
            problems.push(unknownKey(side, ["top", "right", "bottom", "left"], "border side"));
            continue;
          }
          const bb = b as { style?: unknown; color?: unknown } | null;
          if (!bb) continue;
          if (!(BORDER_STYLES as readonly unknown[]).includes(bb.style)) {
            problems.push(`border style must be one of ${BORDER_STYLES.join(", ")}`);
            continue;
          }
          if (bb.color !== undefined && (typeof bb.color !== "string" || !HEX.test(bb.color))) {
            problems.push('border color must be a hex color like "#737373"');
            continue;
          }
          borders[side as "top"] = { style: bb.style as never, ...(bb.color ? { color: fullHex(bb.color as string) } : {}) };
        }
        if (Object.keys(borders).length) out.borders = borders;
        break;
      }
    }
  }
  if (out.customFmt && out.numFmt !== "custom") out.numFmt = "custom";
  return Object.keys(out).length ? out : undefined;
}

export function findDropdown(id: string, dropdowns: readonly Dropdown[]): Dropdown | null {
  return dropdowns.find((d) => d.id === id) ?? DROPDOWN_TEMPLATES.find((d) => d.id === id) ?? null;
}

/**
 * Check one cell as written from outside, and return it the way the files keep it.
 * `raw` is a cell object, or shorthand: a number, true/false, text, or "=formula".
 */
export function checkCellInput(raw: unknown, ctx: CellContext): { cell: CellData | null; problems: string[]; fmt?: NumberFormatKind } {
  const problems: string[] = [];
  if (raw === null) return { cell: null, problems };
  if (typeof raw === "string") {
    // Text means what typing it would: "=SUM(…)" a formula, "2026-03-15" a date, "$1,200" money.
    const typed = parseUserInput(raw, ctx.locale);
    if (typed.f) problems.push(...lintFormula(typed.f, ctx.sheets));
    return { cell: typed.f ? { f: typed.f } : { v: typed.v ?? null }, problems, ...(typed.fmt ? { fmt: typed.fmt } : {}) };
  }
  if (typeof raw === "number") return Number.isFinite(raw) ? { cell: { v: raw }, problems } : { cell: null, problems: ["Numbers must be finite"] };
  if (typeof raw === "boolean") return { cell: { v: raw }, problems };
  if (typeof raw !== "object" || Array.isArray(raw)) return { cell: null, problems: ['A cell is a value, "=formula", null, or an object like {"v": 12, "s": {"bold": true}}'] };

  const o = raw as Record<string, unknown>;
  const cell: CellData = {};
  for (const k of Object.keys(o)) if (!(CELL_KEYS as readonly string[]).includes(k)) problems.push(unknownKey(k, CELL_KEYS, "cell key"));

  if (o.v !== undefined && o.v !== null) {
    if (typeof o.v === "number" && !Number.isFinite(o.v)) problems.push("v must be a finite number");
    else if (!["string", "number", "boolean"].includes(typeof o.v)) problems.push("v must be text, a number, or true/false");
    else cell.v = o.v as CellData["v"];
  }
  if (o.f !== undefined && o.f !== null) {
    if (typeof o.f !== "string" || !o.f.startsWith("=")) problems.push('f must be a formula starting with =, like "=SUM(B2:B9)"');
    else {
      problems.push(...lintFormula(o.f, ctx.sheets));
      cell.f = o.f;
      delete cell.v;
    }
  }
  if (o.t !== undefined && o.t !== null && o.t !== "auto") {
    if (!(CELL_TYPES as readonly unknown[]).includes(o.t)) problems.push(`t must be one of ${CELL_TYPES.join(", ")}`);
    else cell.t = o.t as CellData["t"];
  }
  const style = checkStyle(o.s, problems);
  if (style) cell.s = style;
  if (typeof o.note === "string" && o.note.trim()) cell.note = o.note.slice(0, 2000);

  if (cell.t === "checkbox") {
    if (cell.v === undefined || cell.v === null) cell.v = false;
    else if (typeof cell.v === "string" && /^(true|false)$/i.test(cell.v)) cell.v = /^true$/i.test(cell.v);
    if (typeof cell.v !== "boolean" && !cell.f) problems.push("A checkbox's v is true or false");
  }
  if (cell.t === "dropdown") {
    const id = typeof o.dropdownId === "string" ? o.dropdownId : "";
    const dd = findDropdown(id, ctx.dropdowns);
    if (!dd) {
      const all = [...ctx.dropdowns.map((d) => d.id), ...DROPDOWN_TEMPLATES.map((d) => d.id).filter((t) => !ctx.dropdowns.some((d) => d.id === t))];
      problems.push(`A dropdown cell needs dropdownId, one of: ${all.join(", ")}. Make a new one with update_workbook first`);
    } else {
      cell.dropdownId = dd.id;
      if (cell.v !== undefined && cell.v !== null && cell.v !== "") {
        const opt = dd.options.find((op) => op.label.toLowerCase() === String(cell.v).toLowerCase() || op.id === String(cell.v));
        if (!opt) problems.push(`"${String(cell.v)}" is not an option of dropdown ${dd.id}. Options: ${dd.options.map((op) => op.label).join(", ")}`);
        else cell.v = opt.label;
      }
    }
  } else if (o.dropdownId !== undefined) problems.push('dropdownId only goes with t: "dropdown"');
  if (cell.t === "person") {
    const p = o.person as { name?: unknown; email?: unknown } | undefined;
    const name = typeof p?.name === "string" ? p.name.trim() : typeof cell.v === "string" ? cell.v.trim() : "";
    if (!name) problems.push('A person cell needs person: {"name": "…", "email"?: "…"}');
    else {
      cell.person = { name, ...(typeof p?.email === "string" && p.email.trim() ? { email: p.email.trim() } : {}) };
      cell.v = name;
    }
  } else if (o.person !== undefined) problems.push('person only goes with t: "person"');
  if (cell.t === "date" && typeof cell.v === "string") {
    const d = parseDateText(cell.v, "ymd") ?? parseDateText(cell.v, dateOrder(ctx.locale));
    if (!d) problems.push(`"${cell.v}" is not a date. Write dates as "2026-03-15"`);
    else cell.v = d.serial;
  }
  return { cell, problems };
}

/** Functions whose result is in the same unit as what they read: a SUM of money is money, a COUNT of it is not. */
const KEEPS_FORMAT = new Set(["SUM", "SUMIF", "SUMIFS", "AVERAGE", "AVERAGEIF", "AVERAGEIFS", "MIN", "MAX", "MINIFS", "MAXIFS", "MEDIAN", "LARGE", "SMALL", "ROUND", "ROUNDUP", "ROUNDDOWN", "TRUNC", "CEILING", "FLOOR", "ABS"]);

/**
 * The number format a new formula takes from the cells it reads, the way a
 * total under a column of money shows as money. Only for formulas whose result
 * keeps the unit: a SUM, MAX or ROUND of the cells, or adding and subtracting
 * them. Cells on other sheets are not looked at.
 */
export function impliedFormat(formula: string, cells: Readonly<Record<string, CellData>>): NumberFormatKind | undefined {
  const body = formula
    .replace(/^=\s*/, "")
    .replace(/"[^"]*"/g, '""')
    .replace(/(?:'[^']*'|[A-Za-z0-9_.]+)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/gi, "0");
  const fn = /^([A-Z][A-Z0-9.]*)\s*\(/i.exec(body)?.[1]?.toUpperCase();
  if (fn ? !KEEPS_FORMAT.has(fn) : /[*/^&]/.test(body)) return undefined;
  for (const m of body.matchAll(/(^|[^A-Za-z0-9_!.'$])\$?([A-Z]{1,3})\$?(\d+)(?![A-Za-z0-9_(])/gi)) {
    const fmt = cells[`${m[2]!.toUpperCase()}${m[3]}`]?.s?.numFmt;
    if (fmt && fmt !== "auto") return fmt;
  }
  return undefined;
}
