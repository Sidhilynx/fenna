// A deck is a folder:
//
//   deck.json            the index: title, slide order, sections, theme
//   slides/<id>.html     one <section> per slide (slide.ts)
//   assets/<file>        images and font files the slides name
//
// Nothing here touches a file system: callers hand in a DeckReader, so the
// same code runs in the Electron main process, the renderer and the MCP
// server.

import { type Declaration, type ValueContext, color, fontFamily, parseStyle } from "./css.ts";
import { PROPERTIES } from "./schema.ts";
import { type Diagnostic, type ElementNode, ID_RE, parseSlide } from "./slide.ts";

export const FORMAT = "fenna-slides/0";
/** The marker decks had before the Fenna name; still read, and written back as FORMAT. */
export const LEGACY_FORMAT = "opendeck/0";

export interface FontFace {
  family: string;
  /** "google" loads it from Google Fonts; a path loads a file from assets/. */
  source: "google" | string;
  weights?: number[];
}

export interface Theme {
  /** Named colors; slides use them as var(--name), so a theme change recolors the deck. */
  colors: Record<string, string>;
  fonts: FontFace[];
  /** Named text styles; an element with data-style="name" takes these, its own inline styles win. */
  textStyles: Record<string, string>;
}

export interface Section {
  title: string;
  /** Id of the section's first slide. */
  start: string;
}

export interface DeckIndex {
  format: typeof FORMAT;
  title: string;
  slides: string[];
  sections: Section[];
  theme: Theme;
}

export interface IndexResult {
  index: DeckIndex | null;
  errors: string[];
}

const COLOR_NAME_RE = /^[a-z][a-z0-9-]{0,39}$/;
const STYLE_NAME_RE = /^[a-z][a-z0-9-]{0,39}$/;
const FONT_FILE_RE = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(woff2?|ttf|otf)$/;

export function emptyIndex(title = "Untitled deck"): DeckIndex {
  return { format: FORMAT, title, slides: [], sections: [], theme: { colors: {}, fonts: [], textStyles: {} } };
}

export function valueContext(index: DeckIndex): ValueContext {
  return { colorTokens: new Set(Object.keys(index.theme.colors)), families: new Set(index.theme.fonts.map((f) => f.family)) };
}

/** Check a parsed deck.json. Unknown keys are dropped; anything wrong is an error. */
export function checkIndex(raw: unknown): IndexResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { index: null, errors: ["deck.json must be a JSON object"] };
  const o = raw as Record<string, unknown>;
  if (o.format !== FORMAT && o.format !== LEGACY_FORMAT) errors.push(`format must be "${FORMAT}"`);
  const title = typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 200) : (errors.push("title must be a non-empty string"), "");

  const slides: string[] = [];
  if (!Array.isArray(o.slides)) errors.push("slides must be an array of slide ids");
  else {
    for (const id of o.slides) {
      if (typeof id !== "string" || !ID_RE.test(id)) errors.push(`slide id ${JSON.stringify(id)} is not valid`);
      else if (slides.includes(id)) errors.push(`slide "${id}" is listed twice`);
      else slides.push(id);
    }
  }

  const sections: Section[] = [];
  if (o.sections !== undefined) {
    if (!Array.isArray(o.sections)) errors.push("sections must be an array");
    else
      for (const s of o.sections) {
        const sec = s as Partial<Section>;
        if (typeof sec?.title !== "string" || typeof sec.start !== "string") errors.push("each section is {title, start}");
        else if (!slides.includes(sec.start)) errors.push(`section "${sec.title}" starts at unknown slide "${sec.start}"`);
        else sections.push({ title: sec.title.slice(0, 200), start: sec.start });
      }
  }

  const theme: Theme = { colors: {}, fonts: [], textStyles: {} };
  const t = (o.theme ?? {}) as Partial<Record<keyof Theme, unknown>>;
  const noTokens: ValueContext = { colorTokens: new Set(), families: new Set() };
  if (t.colors && typeof t.colors === "object") {
    for (const [name, value] of Object.entries(t.colors as Record<string, unknown>)) {
      if (!COLOR_NAME_RE.test(name)) errors.push(`theme color name "${name}" must be lowercase letters, digits and -`);
      else if (typeof value !== "string" || color(value, noTokens) !== null) errors.push(`theme color ${name} must be a hex/rgb/hsl color`);
      else theme.colors[name] = value;
    }
  }
  if (Array.isArray(t.fonts)) {
    if (t.fonts.length > 6) errors.push("a deck declares at most 6 font families");
    for (const f of t.fonts.slice(0, 6) as Partial<FontFace>[]) {
      if (typeof f?.family !== "string" || fontFamily(f.family, noTokens) !== null) errors.push(`font family ${JSON.stringify(f?.family)} is not valid`);
      else if (f.source !== "google" && !(typeof f.source === "string" && FONT_FILE_RE.test(f.source)))
        errors.push(`font ${f.family}: source is "google" or a file in assets/ (.woff2, .woff, .ttf, .otf)`);
      else {
        const face: FontFace = { family: f.family, source: f.source };
        if (Array.isArray(f.weights)) face.weights = f.weights.filter((w): w is number => typeof w === "number" && w >= 100 && w <= 900);
        theme.fonts.push(face);
      }
    }
  }
  const ctx: ValueContext = { colorTokens: new Set(Object.keys(theme.colors)), families: new Set(theme.fonts.map((f) => f.family)) };
  if (t.textStyles && typeof t.textStyles === "object") {
    for (const [name, value] of Object.entries(t.textStyles as Record<string, unknown>)) {
      if (!STYLE_NAME_RE.test(name)) {
        errors.push(`text style name "${name}" must be lowercase letters, digits and -`);
        continue;
      }
      if (typeof value !== "string") {
        errors.push(`text style ${name} must be a style string`);
        continue;
      }
      const problems = checkTextStyle(value, ctx);
      if (problems.length) errors.push(...problems.map((p) => `text style ${name}: ${p}`));
      else theme.textStyles[name] = value;
    }
  }

  if (errors.length) return { index: null, errors };
  return { index: { format: FORMAT, title, slides, sections, theme }, errors };
}

/** A text style may only carry text and appearance properties a text element takes. */
function checkTextStyle(style: string, ctx: ValueContext): string[] {
  const out: string[] = [];
  const parsed = parseStyle(style);
  out.push(...parsed.errors);
  for (const d of parsed.decls) {
    const prop = PROPERTIES[d.name];
    if (!prop || !prop.on.includes("p") || prop.group === "layout" || prop.group === "size") out.push(`${d.name} can't be part of a text style`);
    else {
      const r = prop.check(d.value, ctx);
      if (r) out.push(`${d.name}: ${r}`);
    }
  }
  return out;
}

/** The declarations an element ends up with: its text style, then its own inline ones. */
export function resolvedStyle(el: ElementNode, theme: Theme): Declaration[] {
  const name = el.attrs["data-style"];
  const base = name && theme.textStyles[name] ? parseStyle(theme.textStyles[name]).decls : [];
  const out = base.map((d) => ({ ...d }));
  for (const d of el.style) {
    const at = out.findIndex((b) => b.name === d.name);
    if (at >= 0) out[at] = { ...d };
    else out.push({ ...d });
  }
  return out;
}

// ── Loading a whole deck ────────────────────────────────────────────────

export interface DeckReader {
  /** The text of a file relative to the deck folder, or null when it doesn't exist. */
  read(path: string): Promise<string | null>;
  /** File names directly inside a folder of the deck (e.g. "slides"). */
  list(dir: string): Promise<string[]>;
}

export interface LoadedSlide {
  id: string;
  slide: ElementNode | null;
  diagnostics: Diagnostic[];
  /** The slide's file text as found on disk. */
  source: string;
}

export interface LoadedDeck {
  index: DeckIndex;
  /** In deck order, then any slide files the index doesn't list (shown last). */
  slides: LoadedSlide[];
  problems: string[];
}

export async function loadDeck(reader: DeckReader): Promise<LoadedDeck> {
  const problems: string[] = [];
  const text = await reader.read("deck.json");
  let index = emptyIndex();
  if (text === null) problems.push("deck.json is missing; showing the slide files in name order");
  else {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      problems.push(`deck.json is not valid JSON: ${(e as Error).message}`);
    }
    if (raw !== undefined) {
      const r = checkIndex(raw);
      if (r.index) index = r.index;
      else problems.push(...r.errors);
    }
  }

  const files = (await reader.list("slides")).filter((f) => /\.html$/.test(f)).map((f) => f.slice(0, -5)).filter((id) => ID_RE.test(id));
  const ordered = [...index.slides.filter((id) => files.includes(id)), ...files.filter((id) => !index.slides.includes(id)).sort()];
  for (const id of index.slides) if (!files.includes(id)) problems.push(`slide "${id}" is in deck.json but slides/${id}.html is missing`);

  const ctx = valueContext(index);
  const slides: LoadedSlide[] = [];
  for (const id of ordered) {
    const source = (await reader.read(`slides/${id}.html`)) ?? "";
    const r = parseSlide(source, ctx);
    if (r.slide && r.slide.attrs.id !== id)
      r.diagnostics.push({ severity: "error", code: "id-mismatch", message: `the section's id must be "${id}", the file's name`, line: r.slide.line, col: r.slide.col, path: "section" });
    slides.push({ id, slide: r.slide, diagnostics: r.diagnostics, source });
  }
  return { index, slides, problems };
}
