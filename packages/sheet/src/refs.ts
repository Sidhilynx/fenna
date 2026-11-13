// References that follow the cells they point at. When rows or columns are
// inserted, deleted or moved, every formula on every sheet that points at
// them is rewritten, the way a spreadsheet does it: a reference to a deleted
// cell becomes #REF!, a range loses the deleted part, and $ locks don't stop
// a reference from following its cell (they only matter when copying).

import { colToLetter, letterToCol, parseCellRef } from "./schema.ts";

export type Axis = "row" | "col";

/** Where an index goes: its new index, or null when it was deleted. */
export type IndexMap = (i: number) => number | null;

export interface SheetName {
  id: string;
  title: string;
}

/** Insert `count` at `at` (count > 0) or delete `-count` starting at `at` (count < 0). */
export function shiftMap(at: number, count: number): IndexMap {
  if (count >= 0) return (i) => (i >= at ? i + count : i);
  const n = -count;
  return (i) => (i < at ? i : i < at + n ? null : i - n);
}

/** Swap two indexes. */
export function swapMap(a: number, b: number): IndexMap {
  return (i) => (i === a ? b : i === b ? a : i);
}

interface End {
  row: number | null;
  col: number | null;
  absRow: boolean;
  absCol: boolean;
}

function endOf(text: string): End | null {
  const cell = parseCellRef(text);
  if (cell) return { row: cell.row, col: cell.col, absRow: cell.absRow, absCol: cell.absCol };
  const col = /^(\$?)([A-Za-z]{1,3})$/.exec(text);
  if (col) {
    const c = letterToCol(col[2]!);
    return c >= 0 ? { row: null, col: c, absRow: false, absCol: col[1] === "$" } : null;
  }
  const row = /^(\$?)(\d{1,6})$/.exec(text);
  if (row && Number(row[2]) >= 1) return { row: Number(row[2]) - 1, col: null, absRow: row[1] === "$", absCol: false };
  return null;
}

function endText(e: End): string {
  const c = e.col === null ? "" : `${e.absCol ? "$" : ""}${colToLetter(e.col)}`;
  const r = e.row === null ? "" : `${e.absRow ? "$" : ""}${e.row + 1}`;
  return c + r;
}

/** Where the first surviving index from `from` toward `to` went (insert and delete keep order). */
function survive(map: IndexMap, from: number, to: number): number | null {
  const dir = to >= from ? 1 : -1;
  for (let k = from; dir > 0 ? k <= to : k >= to; k += dir) {
    const v = map(k);
    if (v !== null) return v;
  }
  return null;
}

/** Ranges up to this long are mapped cell by cell; longer ones (rows only) by their ends. */
const SCAN = 5000;

/** A reference ("B2", "B2:D9", "B:B", "2:5") after the move, or null when all of it was deleted. */
export function remapRef(ref: string, axis: Axis, map: IndexMap): string | null {
  const parts = ref.split(":");
  if (parts.length > 2) return ref;
  const a = endOf(parts[0]!);
  const b = parts.length === 2 ? endOf(parts[1]!) : null;
  if (!a || (parts.length === 2 && !b)) return ref;
  const key = axis === "row" ? "row" : "col";
  if (!b) {
    if (a[key] === null) return ref;
    const v = map(a[key]!);
    return v === null ? null : endText({ ...a, [key]: v });
  }
  if (a[key] === null || b[key] === null) return ref;
  const lo = Math.min(a[key]!, b[key]!);
  const hi = Math.max(a[key]!, b[key]!);
  // The range covers wherever its surviving cells went: a range over a swapped pair keeps its span.
  let s2: number | null = null;
  let e2: number | null = null;
  if (hi - lo <= SCAN) {
    for (let k = lo; k <= hi; k++) {
      const v = map(k);
      if (v === null) continue;
      s2 = s2 === null ? v : Math.min(s2, v);
      e2 = e2 === null ? v : Math.max(e2, v);
    }
  } else {
    s2 = survive(map, lo, hi);
    e2 = survive(map, hi, lo);
  }
  if (s2 === null || e2 === null) return null;
  const first = a[key]! <= b[key]! ? a : b;
  const last = first === a ? b : a;
  return `${endText({ ...first, [key]: s2 })}:${endText({ ...last, [key]: e2 })}`;
}

/** The same, for a range written without a sheet name (rules, charts, filters). */
export function remapRange(range: string, axis: Axis, map: IndexMap): string | null {
  return remapRef(range.trim().toUpperCase(), axis, map);
}

const same = (name: string, s: SheetName) => {
  const low = name.trim().toLowerCase();
  return low === s.id.toLowerCase() || low === s.title.trim().toLowerCase();
};

/**
 * Rewrite the references in a formula that point at `target`. `home` is the
 * sheet the formula is on: its unprefixed references point at home.
 */
export function remapFormula(formula: string, home: SheetName, target: SheetName, axis: Axis, map: IndexMap): string {
  if (!formula.startsWith("=")) return formula;
  const src = formula;
  let out = "";
  let i = 0;
  const homeIsTarget = home.id === target.id;
  const refAt = (j: number) => {
    let k = j;
    while (k < src.length && /[A-Za-z0-9$]/.test(src[k]!)) k++;
    if (src[k] === ":" && /[A-Za-z0-9$]/.test(src[k + 1] ?? "")) {
      k++;
      while (k < src.length && /[A-Za-z0-9$]/.test(src[k]!)) k++;
    }
    return k;
  };
  const emit = (ref: string, prefix: string, onTarget: boolean) => {
    if (!onTarget) {
      out += prefix + ref;
      return;
    }
    const next = remapRef(ref, axis, map);
    out += next === null ? "#REF!" : prefix + next;
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '"' && src[j + 1] === '"') j += 2;
        else if (src[j] === '"') break;
        else j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let name = "";
      while (j < src.length) {
        if (src[j] === "'" && src[j + 1] === "'") {
          name += "'";
          j += 2;
        } else if (src[j] === "'") break;
        else name += src[j++];
      }
      if (src[j + 1] === "!") {
        const end = refAt(j + 2);
        emit(src.slice(j + 2, end), src.slice(i, j + 2), same(name, target));
        i = end;
        continue;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch) || (/\d/.test(ch) && !/[A-Za-z0-9_.]/.test(src[i - 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.$]/.test(src[j]!)) j++;
      const word = src.slice(i, j);
      if (src[j] === "!") {
        const end = refAt(j + 1);
        emit(src.slice(j + 1, end), `${word}!`, same(word, target));
        i = end;
        continue;
      }
      if (src[j] === "(" || /^(TRUE|FALSE)$/i.test(word) || word.includes(".") || word.includes("_")) {
        out += word;
        i = j;
        continue;
      }
      const end = refAt(i);
      const ref = src.slice(i, end);
      // A plain number is not a reference; "2:5" is.
      if (/^\d+$/.test(ref)) {
        out += ref;
        i = end;
        continue;
      }
      emit(ref, "", homeIsTarget);
      i = end;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
