// A doc as Markdown (CommonMark plus GitHub's tables and task lists). Each
// tab becomes a section under its title; suggestions are shown as they would
// read once accepted, and comments are left out.

import { type DocIndex, type LoadedDoc, flattenTabs, tabLabel } from "./doc.ts";
import { type DocNode, type ElementNode, elementChildren } from "./tab.ts";

const escapeText = (s: string) => s.replace(/([\\`*_[\]<>#|])/g, "\\$1");

function inlineMd(nodes: DocNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === "text") return escapeText(n.text);
      const kids = inlineMd(n.children);
      switch (n.tag) {
        case "b":
          return kids.trim() ? `**${kids}**` : kids;
        case "i":
          return kids.trim() ? `*${kids}*` : kids;
        case "s":
          return kids.trim() ? `~~${kids}~~` : kids;
        case "u":
          return kids;
        case "code": {
          const t = n.children.map((c) => (c.type === "text" ? c.text : "")).join("");
          const fence = t.includes("`") ? "``" : "`";
          return `${fence}${t}${fence}`;
        }
        case "a":
          return `[${kids}](${n.attrs.href})`;
        case "br":
          return "  \n";
        case "del":
          return "";
        default:
          return kids;
      }
    })
    .join("");
}

function listMd(list: ElementNode, indent: string): string[] {
  const lines: string[] = [];
  const ordered = list.tag === "ol";
  const check = list.attrs["data-checklist"] !== undefined;
  let n = Number(list.attrs.start ?? 1);
  for (const li of elementChildren(list)) {
    const text = li.children.filter((c) => !(c.type === "element" && (c.tag === "ul" || c.tag === "ol")));
    const marker = ordered ? `${n++}.` : "-";
    const box = check ? (li.attrs["data-checked"] !== undefined ? "[x] " : "[ ] ") : "";
    lines.push(`${indent}${marker} ${box}${inlineMd(text)}`);
    for (const sub of elementChildren(li).filter((c) => c.tag === "ul" || c.tag === "ol")) lines.push(...listMd(sub, indent + " ".repeat(marker.length + 1)));
  }
  return lines;
}

function cellMd(c: ElementNode): string {
  return inlineMd(c.children).replace(/\s*\n\s*/g, " ") || " ";
}

export function blockMd(b: ElementNode, headingShift = 0): string {
  switch (b.tag) {
    case "h1":
    case "h2":
    case "h3":
      return `${"#".repeat(Math.min(6, Number(b.tag[1]) + headingShift))} ${inlineMd(b.children)}`;
    case "p":
      return inlineMd(b.children);
    case "ul":
    case "ol":
      return listMd(b, "").join("\n");
    case "blockquote":
      return `> ${inlineMd(b.children).replace(/\n/g, "\n> ")}`;
    case "pre": {
      const t = b.children.map((c) => (c.type === "text" ? c.text : "")).join("");
      const fence = t.includes("```") ? "~~~" : "```";
      return `${fence}${b.attrs["data-lang"] ?? ""}\n${t}\n${fence}`;
    }
    case "hr":
      return "---";
    case "table": {
      const rows = elementChildren(b);
      if (!rows.length) return "";
      const width = Math.max(...rows.map((r) => elementChildren(r).length));
      const line = (r: ElementNode) => `| ${Array.from({ length: width }, (_, i) => { const c = elementChildren(r)[i]; return c ? cellMd(c) : " "; }).join(" | ")} |`;
      return [line(rows[0]!), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
    }
    case "figure": {
      const img = elementChildren(b).find((c) => c.tag === "img");
      const cap = elementChildren(b).find((c) => c.tag === "figcaption");
      const alt = img?.attrs.alt ?? (cap ? inlineMd(cap.children) : "");
      return `![${alt.replace(/[[\]]/g, "")}](${img?.attrs.src ?? ""})${cap ? `\n\n*${inlineMd(cap.children)}*` : ""}`;
    }
    default:
      return "";
  }
}

/** One tab's blocks as Markdown. */
export function tabMd(tab: ElementNode, headingShift = 0): string {
  return elementChildren(tab)
    .map((b) => blockMd(b, headingShift))
    .filter((s) => s !== "")
    .join("\n\n");
}

/** The whole doc: its title, then each tab under its title (headings inside a tab move down a level). */
export function docMd(doc: Pick<LoadedDoc, "tabs"> & { index: DocIndex }): string {
  const parts = [`# ${escapeText(doc.index.title)}`];
  const flat = flattenTabs(doc.index.tabs);
  const many = flat.length > 1;
  for (const f of flat) {
    const t = doc.tabs.get(f.ref.id)?.tab;
    if (!t) continue;
    if (many) parts.push(`${"#".repeat(Math.min(6, 2 + f.depth))} ${escapeText(tabLabel(doc.index.tabs, f.ref.id))}`);
    const body = tabMd(t, many ? 1 + f.depth + 1 : 1);
    if (body) parts.push(body);
  }
  return parts.join("\n\n") + "\n";
}
