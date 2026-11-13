// Doc tab → browser markup. One renderer for every surface: the editor's
// page, Home's thumbnails, the PDF and HTML exports. The editor gets a few
// extra hooks (chips that can't be typed into, a <br> in empty blocks so the
// caret has somewhere to go, each image's file path kept beside its address)
// that sanitizeBlocks folds back when it reads the page.

import type { Dropdown } from "./schema.ts";
import { type DocNode, type ElementNode, serializeNode } from "./tab.ts";

export interface MarkupOptions {
  /** Where images are served from: "odasset://<token>/" in the app, "" for files beside the page. */
  assetBase: string;
  dropdowns: Dropdown[];
  /** The editor's page (contenteditable): adds its hooks. */
  editable?: boolean;
  /** Images as data: URIs, by file path (a standalone export). */
  images?: Map<string, string>;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function attrs(a: Record<string, string>): string {
  return Object.entries(a)
    .map(([k, v]) => ` ${k}="${escAttr(v)}"`)
    .join("");
}

function inlineMarkup(nodes: DocNode[], o: MarkupOptions): string {
  return nodes.map((n) => nodeMarkup(n, o)).join("");
}

function nodeMarkup(n: DocNode, o: MarkupOptions): string {
  if (n.type === "text") return esc(n.text);
  const kids = () => inlineMarkup(n.children, o);
  const ce = o.editable ? ` contenteditable="false"` : "";
  switch (n.tag) {
    case "span": {
      if (n.attrs["data-text"] !== undefined) return `<span data-text="${escAttr(n.attrs["data-text"])}">${kids()}</span>`;
      const dd = o.dropdowns.find((d) => d.id === n.attrs["data-dropdown"]);
      const opt = dd?.options.find((x) => x.id === n.attrs["data-value"]);
      return `<span class="od-chip"${attrs(n.attrs)} data-color="${opt?.color ?? "gray"}"${ce}>${kids()}</span>`;
    }
    case "time":
      return `<time class="od-date"${attrs(n.attrs)}${ce}>${kids()}</time>`;
    case "a":
      return `<a${attrs(n.attrs)}${o.editable ? "" : ` target="_blank" rel="noopener"`}>${kids()}</a>`;
    default:
      return serializeNode({ ...n, children: [] }).replace(/<\/[a-z0-9]+>$/, "") + (n.tag === "br" ? "" : `${kids()}</${n.tag}>`);
  }
}

/** Inline content of a block; an empty one gets a <br> in the editor so it can hold the caret. */
function textMarkup(nodes: DocNode[], o: MarkupOptions): string {
  const s = inlineMarkup(nodes, o);
  return s || (o.editable ? "<br>" : "");
}

function listMarkup(n: ElementNode, o: MarkupOptions): string {
  const items = n.children
    .filter((c): c is ElementNode => c.type === "element")
    .map((li) => {
      const text = li.children.filter((c) => !(c.type === "element" && (c.tag === "ul" || c.tag === "ol")));
      const nested = li.children.filter((c): c is ElementNode => c.type === "element" && (c.tag === "ul" || c.tag === "ol"));
      return `<li${attrs(li.attrs)}>${textMarkup(text, o)}${nested.map((l) => listMarkup(l, o)).join("")}</li>`;
    })
    .join("");
  return `<${n.tag}${attrs(n.attrs)}>${items}</${n.tag}>`;
}

export function blockMarkup(b: ElementNode, o: MarkupOptions): string {
  switch (b.tag) {
    case "ul":
    case "ol":
      return listMarkup(b, o);
    case "hr":
      return `<hr${attrs(b.attrs)}${o.editable ? ` contenteditable="false"` : ""}>`;
    case "pre": {
      const text = b.children.map((c) => (c.type === "text" ? c.text : "")).join("");
      return `<pre${attrs(b.attrs)}>${esc(text)}${o.editable && (!text || text.endsWith("\n")) ? "<br>" : ""}</pre>`;
    }
    case "table": {
      const rows = b.children
        .filter((c): c is ElementNode => c.type === "element")
        .map((tr) => `<tr>${tr.children.map((c) => (c.type === "element" ? `<${c.tag}>${textMarkup(c.children, o)}</${c.tag}>` : "")).join("")}</tr>`)
        .join("");
      return `<table${attrs(b.attrs)}><tbody>${rows}</tbody></table>`;
    }
    case "figure": {
      const img = b.children.find((c): c is ElementNode => c.type === "element" && c.tag === "img");
      const cap = b.children.find((c): c is ElementNode => c.type === "element" && c.tag === "figcaption");
      const file = img?.attrs.src ?? "";
      const url = o.images?.get(file) ?? o.assetBase + file;
      const width = b.attrs["data-width"];
      const style = width ? ` style="--od-w:${Number(width)}%"` : "";
      const image = `<img src="${escAttr(url)}" data-src="${escAttr(file)}" alt="${escAttr(img?.attrs.alt ?? "")}" draggable="false">`;
      const caption = cap ? `<figcaption${o.editable ? ` contenteditable="true"` : ""}>${textMarkup(cap.children, o)}</figcaption>` : "";
      return `<figure${attrs(b.attrs)}${style}${o.editable ? ` contenteditable="false"` : ""}>${image}${caption}</figure>`;
    }
    default:
      return `<${b.tag}${attrs(b.attrs)}>${textMarkup(b.children, o)}</${b.tag}>`;
  }
}

/** A tab's blocks as markup, ready to put inside the page's <article>. */
export function tabMarkup(tab: ElementNode, o: MarkupOptions): string {
  return tab.children
    .filter((c): c is ElementNode => c.type === "element")
    .map((b) => blockMarkup(b, o))
    .join("");
}
