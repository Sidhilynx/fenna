// Typing on the canvas: the rendered element becomes contenteditable, and
// when typing ends its DOM is turned back into the format's inline subset.
// Browsers produce all sorts of markup while editing (<div> per line,
// <strong>, <font>, spans with every computed style, &nbsp;); this keeps only
// what the format means: text, line breaks, b/i/u, links, colored spans, and
// list items.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const SAFE_HREF = /^(https?:\/\/\S+|mailto:\S+|#slide-\d{1,3})$/;
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([^()]*\)|hsla?\([^()]*\)|var\(--[a-z][a-z0-9-]*\))$/i;

/** Inline content of an element, cleaned. Block children (from Enter) become line breaks. */
export function cleanInline(root: Node): string {
  let out = "";
  const walk = (n: Node, atStart: boolean) => {
    for (const c of [...n.childNodes]) {
      if (c.nodeType === Node.TEXT_NODE) {
        out += esc((c.textContent ?? "").replace(/ /g, " ").replace(/​/g, ""));
        continue;
      }
      if (c.nodeType !== Node.ELEMENT_NODE) continue;
      const el = c as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "br") {
        out += "<br>";
        continue;
      }
      if (tag === "div" || tag === "p") {
        // A new line the browser made for Enter.
        if (out && !out.endsWith("<br>") && !atStart) out += "<br>";
        walk(el, false);
        continue;
      }
      const wrap = (open: string, close: string) => {
        const before = out;
        out = "";
        walk(el, false);
        const inner = out;
        out = before + (inner ? open + inner + close : "");
      };
      if (tag === "b" || tag === "strong") wrap("<b>", "</b>");
      else if (tag === "i" || tag === "em") wrap("<i>", "</i>");
      else if (tag === "u") wrap("<u>", "</u>");
      else if (tag === "a") {
        const href = el.getAttribute("href") ?? "";
        if (SAFE_HREF.test(href)) wrap(`<a href="${escAttr(href)}">`, "</a>");
        else walk(el, false);
      } else if (tag === "span" || tag === "font") {
        const color = el.style.color && COLOR.test(el.style.color.replace(/\s+/g, "")) ? el.style.color : (el.getAttribute("color") ?? "");
        const bold = el.style.fontWeight === "bold" || Number(el.style.fontWeight) >= 600;
        const italic = el.style.fontStyle === "italic";
        let open = "";
        let close = "";
        if (color && COLOR.test(color.replace(/\s+/g, ""))) {
          open += `<span style="color:${escAttr(color.replace(/\s+/g, ""))}">`;
          close = "</span>" + close;
        }
        if (bold) {
          open += "<b>";
          close = "</b>" + close;
        }
        if (italic) {
          open += "<i>";
          close = "</i>" + close;
        }
        if (open) wrap(open, close);
        else walk(el, false);
      } else walk(el, false);
    }
  };
  walk(root, true);
  return out.replace(/(<br>)+$/, "").trim();
}

/** A list's items, cleaned; nested lists keep their nesting. */
export function cleanList(list: HTMLElement): string {
  const items: string[] = [];
  for (const c of [...list.children]) {
    const tag = c.tagName.toLowerCase();
    if (tag !== "li") continue;
    const clone = c.cloneNode(true) as HTMLElement;
    const nested = [...clone.querySelectorAll(":scope > ul, :scope > ol")] as HTMLElement[];
    for (const n of nested) n.remove();
    const inner = cleanInline(clone);
    const sub = nested.map((n) => `<${n.tagName.toLowerCase()}>${cleanList(n)}</${n.tagName.toLowerCase()}>`).join("");
    if (inner || sub) items.push(`<li>${inner}${sub}</li>`);
  }
  return items.join("") || "<li></li>";
}

/** Put the caret where the user double-clicked, or at the end. */
export function placeCaret(el: HTMLElement, at?: { x: number; y: number }) {
  const sel = window.getSelection();
  if (!sel) return;
  let range: Range | null = null;
  if (at && "caretRangeFromPoint" in document) range = document.caretRangeFromPoint(at.x, at.y);
  if (!range || !el.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

export function selectAllIn(el: HTMLElement) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}
