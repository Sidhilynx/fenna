// A bot's reply, formatted: the tree from md.ts rendered as React elements.
// Links show their text and address but never navigate the app window.

import { Fragment, useMemo, type ReactNode } from "react";
import { parseMarkdown, type Inline } from "./md.ts";

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

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="md">
      {blocks.map((b, k) => {
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
            return (
              <pre key={k} className="md-pre">
                {b.v}
              </pre>
            );
        }
      })}
    </div>
  );
}
