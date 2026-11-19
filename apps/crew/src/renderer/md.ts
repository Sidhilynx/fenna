// The small part of Markdown a bot's reply uses, parsed into a tree the chat
// renders as React elements (never as HTML): paragraphs, headings, lists,
// code blocks, and bold, italic, code and links inside a line.

export type Inline =
  | { t: "text"; v: string }
  | { t: "br" }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; c: Inline[]; url: string };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][]; start: number }
  | { t: "pre"; v: string };

const FENCE = /^\s*```/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const at = (n: number) => lines[n] ?? "";
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "p", c: inlineLines(para) });
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = at(i);
    if (FENCE.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(at(i))) body.push(at(i++));
      blocks.push({ t: "pre", v: body.join("\n") });
      i++;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      blocks.push({ t: "h", c: parseInline((h[1] ?? "").replace(/\s+#+\s*$/, "")) });
      i++;
      continue;
    }
    const num = NUMBERED.exec(line);
    if (BULLET.test(line) || num) {
      flush();
      const ordered = !BULLET.test(line);
      const re = ordered ? NUMBERED : BULLET;
      const items: Inline[][] = [];
      let m = re.exec(at(i));
      while (i < lines.length && m) {
        items.push(parseInline((ordered ? m[2] : m[1]) ?? ""));
        i++;
        m = re.exec(at(i));
      }
      blocks.push(ordered ? { t: "ol", items, start: Number(num?.[1] ?? 1) } : { t: "ul", items });
      continue;
    }
    if (line.trim() === "") flush();
    else para.push(line);
    i++;
  }
  flush();
  return blocks;
}

function inlineLines(lines: string[]): Inline[] {
  const out: Inline[] = [];
  lines.forEach((l, n) => {
    if (n) out.push({ t: "br" });
    out.push(...parseInline(l));
  });
  return out;
}

export function parseInline(s: string): Inline[] {
  const c = (n: number) => s.charAt(n);
  const out: Inline[] = [];
  let text = "";
  const push = (node: Inline) => {
    if (text) out.push({ t: "text", v: text });
    text = "";
    out.push(node);
  };
  let i = 0;
  while (i < s.length) {
    const ch = c(i);
    if (ch === "\\" && /[\\`*_[\]()#+\-.!]/.test(c(i + 1))) {
      text += c(i + 1);
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) {
        push({ t: "code", v: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && c(i + 1) === ch) {
      const end = s.indexOf(ch + ch, i + 2);
      if (end > i + 2) {
        push({ t: "b", c: parseInline(s.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" || (ch === "_" && !/\w/.test(c(i - 1)))) {
      const end = findClose(s, ch, i + 1);
      if (end > i + 1 && c(i + 1) !== " ") {
        push({ t: "i", c: parseInline(s.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const close = s.indexOf("](", i + 1);
      const end = close > i ? s.indexOf(")", close + 2) : -1;
      if (close > i && end > close + 2) {
        push({ t: "link", c: parseInline(s.slice(i + 1, close)), url: s.slice(close + 2, end).trim() });
        i = end + 1;
        continue;
      }
    }
    text += ch;
    i++;
  }
  if (text) out.push({ t: "text", v: text });
  return out;
}

function findClose(s: string, ch: string, from: number): number {
  for (let j = from; j < s.length; j++) {
    if (s.charAt(j) !== ch || s.charAt(j - 1) === " " || s.charAt(j + 1) === ch) continue;
    if (ch === "_" && /\w/.test(s.charAt(j + 1))) continue;
    return j;
  }
  return -1;
}
