// A bot's reply, formatted: the tree from md.ts rendered as React elements.
// Links show their text and address but never navigate the app window.
// Pipe tables are read here, before md.ts; code blocks get a copy button.

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { parseInline, parseMarkdown, type Block, type Inline } from "./md.ts";

function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, k) => {
    switch (n.t) {
      case "text":
        return <Fragment key={k}>{n.v}</Fragment>;
      case "br":
        return <br key={k} />;
      case "b":
        return <strong key={k}>{inline(n.c)}</strong>;
      case "i":
        return <em key={k}>{inline(n.c)}</em>;
      case "code":
        return <code key={k}>{n.v}</code>;
      case "link":
        return (
          <span key={k} className="md-link" title={n.url}>
            {inline(n.c)}
          </span>
        );
    }
  });
}

export type Part = { t: "md"; text: string } | { t: "table"; head: string[]; rows: string[][] };

const ROW = /^\s*\|.*\|\s*$/;
const RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const FENCE = /^\s*```/;

/** The cells of one table row, without the outer pipes. */
const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** The reply cut into prose and pipe tables. A header row over a rule line makes a table; fenced code is never read as one. */
export function splitTables(src: string): Part[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const parts: Part[] = [];
  let prose: string[] = [];
  let fenced = false;
  const flush = () => {
    if (prose.length) parts.push({ t: "md", text: prose.join("\n") });
    prose = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FENCE.test(line)) {
      fenced = !fenced;
      prose.push(line);
      continue;
    }
    if (!fenced && ROW.test(line) && RULE.test(lines[i + 1] ?? "")) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && ROW.test(lines[i] ?? "")) rows.push(cells(lines[i++] ?? ""));
      i--;
      parts.push({ t: "table", head, rows });
      continue;
    }
    prose.push(line);
  }
  flush();
  return parts;
}

/** A code block: a copy button above it, and the code scrolls sideways instead of wrapping. */
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // The clipboard is not allowed here; the code stays selectable.
    }
  };
  return (
    <div className="md-code">
      <div className="md-code-head">
        <button type="button" className="btn small ghost"aria-label={copied ? "Copied" : "Copy code"} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="md-pre" tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function block(b: Block, k: number): ReactNode {
  switch (b.t) {
    case "p":
      return <p key={k}>{inline(b.c)}</p>;
    case "h":
      return (
        <p key={k} className="md-h">
          {inline(b.c)}
        </p>
      );
    case "ul":
      return (
        <ul key={k}>
          {b.items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={k} start={b.start}>
          {b.items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ol>
      );
    case "pre":
      return <CodeBlock key={k} code={b.v} />;
  }
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="md-table" tabIndex={0}>
      <table>
        <thead>
          <tr>
            {head.map((h, j) => (
              <th key={j}>{inline(parseInline(h))}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, j) => (
            <tr key={j}>
              {r.map((c, n) => (
                <td key={n}>{inline(parseInline(c))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  const parts = useMemo(() => splitTables(text), [text]);
  return (
    <div className="md">
      {parts.map((p, n) =>
        p.t === "table" ? (
          <Table key={n} head={p.head} rows={p.rows} />
        ) : (
          <Fragment key={n}>{parseMarkdown(p.text).map((b, k) => block(b, k))}</Fragment>
        ),
      )}
    </div>
  );
}
