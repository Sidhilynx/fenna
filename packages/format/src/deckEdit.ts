// Deck-level edits on the index: where slides sit and which section they
// open. Pure functions; the app and the MCP server both write the result.

import type { DeckIndex, Theme } from "./deck.ts";
import { uniqueId } from "./edit.ts";

function copy(index: DeckIndex): DeckIndex {
  return { ...index, slides: [...index.slides], sections: index.sections.map((s) => ({ ...s })), theme: index.theme };
}

/** Put a slide id into the order at a position (default: the end). */
export function placeSlide(index: DeckIndex, id: string, at = index.slides.length): DeckIndex {
  const next = copy(index);
  next.slides = next.slides.filter((s) => s !== id);
  next.slides.splice(Math.max(0, Math.min(next.slides.length, at)), 0, id);
  return next;
}

/**
 * Take slides out of the order. A section that opened on a removed slide
 * moves to the next remaining slide, or goes when none is left after it.
 */
export function unplaceSlides(index: DeckIndex, ids: string[]): DeckIndex {
  const gone = new Set(ids);
  const next = copy(index);
  const seen = new Set<string>();
  next.sections = index.sections.flatMap((s) => {
    let start = s.start;
    if (gone.has(start)) {
      const from = index.slides.indexOf(start);
      const after = index.slides.slice(from).find((x) => !gone.has(x));
      if (!after) return [];
      start = after;
    }
    if (seen.has(start)) return [];
    seen.add(start);
    return [{ ...s, start }];
  });
  next.slides = index.slides.filter((s) => !gone.has(s));
  return next;
}

/** Move slides (kept in their relative order) so the first lands at `to` in the remaining order. */
export function moveSlides(index: DeckIndex, ids: string[], to: number): DeckIndex {
  const moving = index.slides.filter((s) => ids.includes(s));
  const rest = index.slides.filter((s) => !ids.includes(s));
  const at = Math.max(0, Math.min(rest.length, to));
  const next = copy(index);
  next.slides = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  // A section must still start on a slide; if its first slide moved away, keep the section where it was.
  next.sections = next.sections.filter((s, i, all) => all.findIndex((o) => o.start === s.start) === i);
  return next;
}

/** A fresh slide id from a title or kind, unique in the deck. */
export function newSlideId(index: DeckIndex, base = "slide"): string {
  const slug = base
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join("-")
    .replace(/^[^a-z]+/, "");
  return uniqueId(slug || "slide", index.slides);
}

/** Start a section at a slide (or rename it if one starts there). Empty title removes it. */
export function setSection(index: DeckIndex, start: string, title: string): DeckIndex {
  const next = copy(index);
  const at = next.sections.findIndex((s) => s.start === start);
  const t = title.trim();
  if (!t) {
    if (at >= 0) next.sections.splice(at, 1);
  } else if (at >= 0) next.sections[at] = { title: t, start };
  else next.sections.push({ title: t, start });
  next.sections.sort((a, b) => next.slides.indexOf(a.start) - next.slides.indexOf(b.start));
  return next;
}

// ── New-slide layouts ───────────────────────────────────────────────────

export interface Layout {
  key: string;
  label: string;
  html(id: string): string;
}

/**
 * Starting points for a new slide. They use the deck's own text styles and
 * theme colors when it has them (title, body, eyebrow, display; ink/paper/
 * accent or the first dark/light colors), so a new slide already looks like
 * the rest of the deck.
 */
export function layouts(theme: Theme): Layout[] {
  const has = (s: string) => s in theme.textStyles;
  const style = (name: string, fallback: string) => (has(name) ? ` data-style="${name}"` : ` style="${fallback}"`);
  const colors = Object.keys(theme.colors);
  const pick = (...names: string[]) => names.find((n) => colors.includes(n));
  const bgName = pick("paper", "background", "bg", "light", "surface");
  const inkName = pick("ink", "text", "foreground", "dark");
  const accentName = pick("accent", "brand", "primary");
  const bg = bgName ? `var(--${bgName})` : "#f7f7f5";
  const ink = inkName ? `var(--${inkName})` : "#161616";
  const accent = accentName ? `var(--${accentName})` : ink;
  const section = (id: string, inner: string, extra = "justify-content:space-between;gap:64px", bgc = bg, fg = ink) =>
    `<section id="${id}" data-transition="fade" style="background:${bgc};color:${fg};padding:128px;${extra}">${inner}</section>`;
  const title = (t: string) => `<h2${style("title", "font-size:72px;font-weight:600;line-height:1.1")}>${t}</h2>`;
  const body = (t: string, extra = "") => `<p${has("body") ? ` data-style="body"${extra ? ` style="${extra}"` : ""}` : ` style="font-size:32px;line-height:1.4;${extra}"`}>${t}</p>`;
  const eyebrow = (t: string) => `<p${has("eyebrow") ? ` data-style="eyebrow" style="color:${accent}"` : ` style="font-size:24px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:${accent}"`}>${t}</p>`;
  const display = (t: string) => `<h1${style("display", "font-size:120px;font-weight:600;line-height:1.05")}>${t}</h1>`;

  return [
    { key: "blank", label: "Blank", html: (id) => section(id, "", "gap:48px") },
    { key: "title", label: "Title", html: (id) => section(id, `<div style="gap:40px">${display("Presentation title")}${body("A one-line subtitle", "width:960px")}</div>`, "justify-content:center;gap:48px", ink, bg) },
    { key: "section", label: "Section", html: (id) => section(id, `${eyebrow("Section 01")}${display("Section title")}`, "justify-content:center;gap:32px", ink, bg) },
    { key: "title-body", label: "Title + body", html: (id) => section(id, `${title("Heading")}${body("Body copy goes here. Double-click any text to edit it.", "width:960px")}<div style="flex:1"></div>`, "gap:48px") },
    {
      key: "bullets",
      label: "Key points",
      html: (id) => section(id, `${title("Key points")}<ul style="font-size:40px;line-height:1.35"><li>First point</li><li>Second point</li><li>Third point</li></ul><div style="flex:1"></div>`, "gap:56px"),
    },
    {
      key: "two-columns",
      label: "Two columns",
      html: (id) =>
        section(
          id,
          `${title("Compare")}<div style="display:flex;flex-direction:row;gap:64px"><div style="flex:1;gap:16px"><h3 style="font-size:44px">Left</h3>${body("Left column copy.")}</div><div style="flex:1;gap:16px"><h3 style="font-size:44px">Right</h3>${body("Right column copy.")}</div></div><div style="flex:1"></div>`,
          "gap:64px",
        ),
    },
    {
      key: "big-number",
      label: "Big number",
      html: (id) => section(id, `<h1 style="font-size:280px;font-weight:600;line-height:1;color:${accent}">[00%]</h1>${body("What the number means, in one sentence.", "width:960px")}`, "justify-content:center;gap:32px"),
    },
    {
      key: "quote",
      label: "Quote",
      html: (id) => section(id, `<h2${style("display", "font-size:88px;font-weight:500;line-height:1.1")} style="width:1500px">“A quote worth a whole slide.”</h2>${body("— [Name], [Role]")}`, "justify-content:center;gap:48px"),
    },
    {
      key: "table",
      label: "Table",
      html: (id) =>
        section(
          id,
          `${title("Table")}<table style="font-size:32px"><tr><th>Column</th><th>Column</th><th>Column</th></tr><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr></table><div style="flex:1"></div>`,
          "gap:56px",
        ),
    },
  ];
}
