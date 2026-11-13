// Conditional formatting evaluator: highlight rules and 2/3-stop color scales.

import { evalFormulaString, type EvalContext, type EvalValue, FormulaError } from "./formula.ts";
import { cellInRange, formatCellRef, parseRangeRef, type CellStyle, type ConditionalRule, type HighlightRule, type SheetData } from "./schema.ts";

function toNumeric(v: EvalValue): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function matchHighlight(rule: HighlightRule, val: EvalValue, ref: string, sheet: SheetData, allSheets: Map<string, SheetData>, timeZone: string): boolean {
  if (val instanceof FormulaError) return false;
  const s = val === null || val === undefined ? "" : String(val);
  const v0 = rule.values[0] ?? "";
  const v1 = rule.values[1] ?? "";
  const numVal = toNumeric(val);
  const n0 = v0.trim() !== "" ? Number(v0) : NaN;
  const n1 = v1.trim() !== "" ? Number(v1) : NaN;

  switch (rule.condition) {
    case "empty":
      return s.trim() === "";
    case "not_empty":
      return s.trim() !== "";
    case "gt":
      return numVal !== null && Number.isFinite(n0) && numVal > n0;
    case "gte":
      return numVal !== null && Number.isFinite(n0) && numVal >= n0;
    case "lt":
      return numVal !== null && Number.isFinite(n0) && numVal < n0;
    case "lte":
      return numVal !== null && Number.isFinite(n0) && numVal <= n0;
    case "between":
      return numVal !== null && Number.isFinite(n0) && Number.isFinite(n1) && numVal >= Math.min(n0, n1) && numVal <= Math.max(n0, n1);
    case "eq":
      if (numVal !== null && Number.isFinite(n0)) return numVal === n0;
      return s.toLowerCase() === v0.toLowerCase();
    case "neq":
      if (numVal !== null && Number.isFinite(n0)) return numVal !== n0;
      return s.toLowerCase() !== v0.toLowerCase();
    case "contains":
      return v0 !== "" && s.toLowerCase().includes(v0.toLowerCase());
    case "not_contains":
      return v0 === "" || !s.toLowerCase().includes(v0.toLowerCase());
    case "starts_with":
      return v0 !== "" && s.toLowerCase().startsWith(v0.toLowerCase());
    case "ends_with":
      return v0 !== "" && s.toLowerCase().endsWith(v0.toLowerCase());
    case "formula": {
      if (!v0.trim()) return false;
      const ctx: EvalContext = { sheetId: sheet.id, sheets: allSheets, timeZone, cache: new Map(), visiting: new Set() };
      const f = v0.startsWith("=") ? v0 : `=${v0}`;
      const res = evalFormulaString(f.replace(/\bTHIS\b/gi, ref), ctx, sheet.id);
      return res === true || (typeof res === "number" && res !== 0);
    }
  }
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    return [parseInt(h[0]! + h[0]!, 16), parseInt(h[1]! + h[1]!, 16), parseInt(h[2]! + h[2]!, 16)];
  }
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}

function lerpColor(a: string, b: string, t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  const r = Math.round(r1 + (r2 - r1) * clamped);
  const g = Math.round(g1 + (g2 - g1) * clamped);
  const bl = Math.round(b1 + (b2 - b1) * clamped);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

/** Precompute conditional styles for a sheet given evaluated cell values. */
export function evaluateConditionalRules(
  sheet: SheetData,
  values: Map<string, EvalValue>,
  allSheets: Map<string, SheetData>,
  timeZone: string,
): Map<string, Partial<CellStyle>> {
  const out = new Map<string, Partial<CellStyle>>();
  for (const rule of sheet.rules) {
    const parsed = parseRangeRef(rule.range);
    if (!parsed) continue;
    if (rule.kind === "colorScale") {
      const nums: { ref: string; v: number }[] = [];
      for (let r = parsed.r1; r <= parsed.r2; r++) {
        for (let c = parsed.c1; c <= parsed.c2; c++) {
          const ref = formatCellRef(r, c);
          const n = toNumeric(values.get(ref) ?? sheet.cells[ref]?.v ?? null);
          if (n !== null) nums.push({ ref, v: n });
        }
      }
      if (!nums.length) continue;
      let min = Infinity;
      let max = -Infinity;
      for (const item of nums) {
        if (item.v < min) min = item.v;
        if (item.v > max) max = item.v;
      }
      const span = max - min;
      for (const item of nums) {
        const t = span === 0 ? 0.5 : (item.v - min) / span;
        let fill: string;
        if (rule.midColor) {
          fill = t <= 0.5 ? lerpColor(rule.minColor, rule.midColor, t * 2) : lerpColor(rule.midColor, rule.maxColor, (t - 0.5) * 2);
        } else {
          fill = lerpColor(rule.minColor, rule.maxColor, t);
        }
        out.set(item.ref, { ...out.get(item.ref), fill });
      }
      continue;
    }

    for (let r = parsed.r1; r <= parsed.r2; r++) {
      for (let c = parsed.c1; c <= parsed.c2; c++) {
        const ref = formatCellRef(r, c);
        if (!cellInRange(r, c, parsed)) continue;
        const val = values.get(ref) ?? sheet.cells[ref]?.v ?? null;
        if (matchHighlight(rule, val, ref, sheet, allSheets, timeZone)) {
          out.set(ref, { ...out.get(ref), ...rule.style });
        }
      }
    }
  }
  return out;
}

export function ruleSummary(rule: ConditionalRule): string {
  if (rule.kind === "colorScale") return `Color scale (${rule.range})`;
  return `${rule.condition} ${rule.values.join(" & ")} (${rule.range})`;
}

