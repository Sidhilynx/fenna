// The small part of YAML that bot.md and team.md front matter use: maps,
// lists (block or `[a, b]`), and strings. Every scalar stays a string; the
// schema decides what it means. Anything outside this subset is an error
// that says how to write it instead, never a silent guess.

export type YamlValue = string | YamlValue[] | YamlMap;
export interface YamlMap {
  [key: string]: YamlValue;
}
export interface YamlProblem {
  line: number;
  message: string;
}

interface Line {
  no: number;
  indent: number;
  text: string;
}

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(?:\s+(.*)|\s*)$/;

function stripComment(raw: string): string {
  let quote = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#" && (i === 0 || raw[i - 1] === " ")) {
      return raw.slice(0, i).trimEnd();
    }
  }
  return raw.trimEnd();
}

function splitFlow(inner: string): string[] | null {
  const parts: string[] = [];
  let cur = "";
  let quote = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (quote) {
      cur += c;
      if (c === "\\" && quote === '"') cur += inner[++i] ?? "";
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ",") {
      parts.push(cur.trim());
      cur = "";
    } else if (c === "[" || c === "]" || c === "{" || c === "}") {
      return null;
    } else {
      cur += c;
    }
  }
  if (quote) return null;
  if (cur.trim() || parts.length) parts.push(cur.trim());
  return parts;
}

function scalar(raw: string, line: number, problems: YamlProblem[]): string {
  const t = raw.trim();
  if (t.startsWith('"')) {
    try {
      const v: unknown = JSON.parse(t);
      if (typeof v === "string") return v;
    } catch {
      /* reported below */
    }
    problems.push({ line, message: `The quoted text on line ${line} is not closed or has a bad escape. Write it as "text", with \\" for a quote inside.` });
    return t.replace(/^"|"$/g, "");
  }
  if (t.startsWith("'")) {
    if (t.length < 2 || !t.endsWith("'")) {
      problems.push({ line, message: `The quoted text on line ${line} is not closed. End it with '.` });
      return t.slice(1);
    }
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (t === "|" || t === ">" || t.startsWith("|") || t.startsWith(">")) {
    problems.push({ line, message: `Line ${line} starts a multi-line value, which settings can't hold. Keep it on one line, or put long text in the body below the closing ---.` });
    return "";
  }
  if (t.startsWith("&") || t.startsWith("*") || t.startsWith("!")) {
    problems.push({ line, message: `Line ${line} uses a YAML anchor or tag, which settings can't hold. Write the value out in full.` });
    return "";
  }
  return t;
}

function value(raw: string, line: number, problems: YamlProblem[]): YamlValue {
  const t = raw.trim();
  if (t === "{}") return {};
  if (t.startsWith("[")) {
    if (!t.endsWith("]")) {
      problems.push({ line, message: `The list on line ${line} is not closed. Write it as [a, b, c] on one line, or one "- item" per line.` });
      return [];
    }
    const parts = splitFlow(t.slice(1, -1));
    if (!parts) {
      problems.push({ line, message: `The list on line ${line} can only hold plain values. Write nested lists or maps as indented "- item" lines.` });
      return [];
    }
    return parts.map((p) => scalar(p, line, problems));
  }
  if (t.startsWith("{")) {
    problems.push({ line, message: `Line ${line} uses {key: value} on one line. Write each key on its own indented line instead.` });
    return {};
  }
  return scalar(t, line, problems);
}

/** Parse front matter text. `firstLine` is the file line the text starts on, for messages. */
export function parseYaml(text: string, firstLine = 1): { value: YamlMap; problems: YamlProblem[]; keyLines: Record<string, number> } {
  const problems: YamlProblem[] = [];
  const keyLines: Record<string, number> = {};
  const lines: Line[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const no = firstLine + i;
    const lead = /^[ \t]*/.exec(raw)![0];
    if (lead.includes("\t")) {
      problems.push({ line: no, message: `Line ${no} is indented with a tab. Indent with spaces.` });
      return;
    }
    const body = stripComment(raw.slice(lead.length));
    if (!body) return;
    lines.push({ no, indent: lead.length, text: body });
  });

  let pos = 0;
  let topMap: YamlMap | null = null;

  function block(indent: number): YamlValue {
    const first = lines[pos]!;
    return first.text === "-" || first.text.startsWith("- ") ? list(indent) : map(indent);
  }

  function childOf(line: Line): YamlValue {
    const next = lines[pos];
    if (next && next.indent > line.indent) return block(next.indent);
    return "";
  }

  function map(indent: number): YamlMap {
    const out: YamlMap = {};
    if (topMap === null) topMap = out;
    while (pos < lines.length) {
      const line = lines[pos]!;
      if (line.indent < indent) break;
      if (line.indent > indent) {
        problems.push({ line: line.no, message: `Line ${line.no} is indented more than the line above it needs. Line it up with the other keys.` });
        pos++;
        continue;
      }
      if (line.text === "-" || line.text.startsWith("- ")) {
        problems.push({ line: line.no, message: `Line ${line.no} is a list item where a "key: value" line was expected. Indent it under its key.` });
        pos++;
        continue;
      }
      const m = KEY_RE.exec(line.text);
      pos++;
      if (!m) {
        problems.push({ line: line.no, message: `Line ${line.no} should be "key: value". Put a colon and a space after the key.` });
        continue;
      }
      const key = m[1]!;
      if (Object.prototype.hasOwnProperty.call(out, key)) problems.push({ line: line.no, message: `"${key}" is set twice (line ${line.no}). Keep one.` });
      if (out === topMap) keyLines[key] = line.no;
      out[key] = m[2] !== undefined && m[2].trim() !== "" ? value(m[2], line.no, problems) : childOf(line);
    }
    return out;
  }

  function list(indent: number): YamlValue[] {
    const out: YamlValue[] = [];
    while (pos < lines.length) {
      const line = lines[pos]!;
      if (line.indent < indent) break;
      if (line.indent > indent || !(line.text === "-" || line.text.startsWith("- "))) {
        problems.push({ line: line.no, message: `Line ${line.no} should be a list item ("- value") lined up with the items above it.` });
        pos++;
        continue;
      }
      const rest = line.text.slice(1).trimStart();
      if (!rest) {
        pos++;
        out.push(childOf(line));
        continue;
      }
      if (KEY_RE.test(rest) && !rest.startsWith('"') && !rest.startsWith("'")) {
        // "- key: value" starts a map whose keys line up with "key".
        const inner = line.indent + (line.text.length - rest.length);
        lines[pos] = { no: line.no, indent: inner, text: rest };
        out.push(map(inner));
        continue;
      }
      pos++;
      out.push(value(rest, line.no, problems));
    }
    return out;
  }

  if (!lines.length) return { value: {}, problems, keyLines };
  const top = lines[0]!;
  if (top.text === "-" || top.text.startsWith("- ")) {
    problems.push({ line: top.no, message: `Settings start with a list item on line ${top.no}. They should be "key: value" lines.` });
    return { value: {}, problems, keyLines };
  }
  const result = map(top.indent);
  while (pos < lines.length) {
    const line = lines[pos++]!;
    problems.push({ line: line.no, message: `Line ${line.no} is indented less than the first setting. Line it up with the other keys.` });
  }
  return { value: result, problems, keyLines };
}

const PLAIN_RE = /^[^\s"'#&*!|>%@`[\]{},?:-][^#]*$/;

function quote(s: string): string {
  if (s !== "" && PLAIN_RE.test(s) && s === s.trim() && !s.includes(": ") && !s.endsWith(":")) return s;
  return JSON.stringify(s);
}

function emit(v: YamlValue, indent: number, out: string[], key: string | null): void {
  const pad = " ".repeat(indent);
  const head = key === null ? "" : `${key}:`;
  if (typeof v === "string") {
    out.push(`${pad}${head}${head ? " " : ""}${quote(v)}`);
    return;
  }
  if (Array.isArray(v)) {
    if (!v.length) {
      out.push(`${pad}${head} []`);
      return;
    }
    out.push(`${pad}${head}`);
    for (const item of v) {
      if (typeof item === "string") out.push(`${pad}  - ${quote(item)}`);
      else if (Array.isArray(item)) {
        out.push(`${pad}  -`);
        emit(item, indent + 4, out, null);
      } else {
        const sub: string[] = [];
        emitMap(item, indent + 4, sub);
        if (!sub.length) out.push(`${pad}  - {}`);
        else out.push(`${pad}  - ${sub[0]!.trimStart()}`, ...sub.slice(1));
      }
    }
    return;
  }
  if (!Object.keys(v).length) {
    out.push(`${pad}${head} {}`);
    return;
  }
  out.push(`${pad}${head}`);
  emitMap(v, indent + 2, out);
}

function emitMap(m: YamlMap, indent: number, out: string[]): void {
  for (const [k, v] of Object.entries(m)) emit(v, indent, out, k);
}

/** Write a map as front matter lines (no --- fences). Keys keep their order. */
export function stringifyYaml(m: YamlMap): string {
  const out: string[] = [];
  emitMap(m, 0, out);
  return out.length ? out.join("\n") + "\n" : "";
}

/** Split a Markdown file into its front matter and body. */
export function splitFrontMatter(text: string): { yaml: string; body: string; bodyLine: number } | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trimEnd() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === "---");
  if (end < 0) return null;
  return { yaml: lines.slice(1, end).join("\n"), body: lines.slice(end + 1).join("\n"), bodyLine: end + 2 };
}

/** The closest of `options` to `word`, if close enough to be a likely typo. */
export function closest(word: string, options: readonly string[]): string | null {
  const w = word.toLowerCase();
  let best: string | null = null;
  let bestD = Infinity;
  for (const o of options) {
    const d = distance(w, o.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best !== null && bestD <= Math.max(2, Math.floor(w.length / 3)) ? best : null;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}
