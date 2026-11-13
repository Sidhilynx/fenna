// The Fenna Docs subset: which blocks a doc tab may hold, which inline marks
// text may carry, and the attributes each takes.
//
// This table is the single source of truth. The validator enforces it, the
// editor's toolbar and menus are built from it, the MCP server's guide
// describes it, and every exporter only ever sees what it allows. A doc has
// no inline styles at all: how text looks comes from the doc's fonts and the
// block it is in.

export const FORMAT = "fenna-docs/0";
/** The marker docs had before the Fenna name; still read, and written back as FORMAT. */
export const LEGACY_FORMAT = "opendoc/0";

export const LIMITS = {
  blocksPerTab: 5000,
  tabs: 200,
  tabDepth: 3,
  textChars: 400_000,
  tableRows: 200,
  tableCols: 20,
  listDepth: 6,
  titleChars: 200,
  dropdowns: 50,
  dropdownOptions: 30,
} as const;

/** What a block is, as the editor and the AI think about it. */
export type BlockKind = "heading" | "text" | "list" | "checklist" | "quote" | "code" | "divider" | "table" | "image";

export interface BlockSpec {
  kind: BlockKind;
  /** What the block holds: inline content, these tags, plain text, or nothing. */
  children: "inline" | "text" | "none" | readonly string[];
  /** Attributes beyond id. */
  attrs?: readonly string[];
  /** Shown in menus and to the AI. */
  label: string;
}

/** Blocks: the direct children of a tab's <article>. Each carries an id. */
export const BLOCKS: Record<string, BlockSpec> = {
  h1: { kind: "heading", children: "inline", label: "Heading 1" },
  h2: { kind: "heading", children: "inline", label: "Heading 2" },
  h3: { kind: "heading", children: "inline", label: "Heading 3" },
  p: { kind: "text", children: "inline", label: "Text" },
  ul: { kind: "list", children: ["li"], attrs: ["data-checklist"], label: "Bulleted list" },
  ol: { kind: "list", children: ["li"], attrs: ["start"], label: "Numbered list" },
  blockquote: { kind: "quote", children: "inline", label: "Quote" },
  pre: { kind: "code", children: "text", attrs: ["data-lang"], label: "Code block" },
  hr: { kind: "divider", children: "none", label: "Divider" },
  table: { kind: "table", children: ["tr"], label: "Table" },
  figure: { kind: "image", children: ["img", "figcaption"], attrs: ["data-width"], label: "Image" },
};

/** Elements that live inside blocks (list items, table rows and cells, an image and its caption). */
export const PARTS: Record<string, { children: "inline" | "none" | readonly string[]; attrs?: readonly string[] }> = {
  li: { children: "inline", attrs: ["data-checked"] },
  tr: { children: ["th", "td"] },
  th: { children: "inline" },
  td: { children: "inline" },
  img: { children: "none", attrs: ["src", "alt"] },
  figcaption: { children: "inline" },
};

export interface InlineSpec {
  /** "inline": more inline content; "text": plain text only; "none": empty. */
  children: "inline" | "text" | "none";
  attrs?: readonly string[];
  /** Required attributes. */
  required?: readonly string[];
  label: string;
}

/** Marks and pieces inside text. */
export const INLINE: Record<string, InlineSpec> = {
  b: { children: "inline", label: "Bold" },
  i: { children: "inline", label: "Italic" },
  u: { children: "inline", label: "Underline" },
  s: { children: "inline", label: "Strikethrough" },
  code: { children: "text", label: "Code" },
  a: { children: "inline", attrs: ["href"], required: ["href"], label: "Link" },
  br: { children: "none", label: "Line break" },
  time: { children: "text", attrs: ["datetime"], required: ["datetime"], label: "Date" },
  span: { children: "text", attrs: ["data-dropdown", "data-value"], required: ["data-dropdown", "data-value"], label: "Dropdown" },
  mark: { children: "inline", label: "Highlight" },
  ins: { children: "inline", attrs: ["data-sid", "data-by", "data-at"], required: ["data-sid"], label: "Suggested insertion" },
  del: { children: "inline", attrs: ["data-sid", "data-by", "data-at"], required: ["data-sid"], label: "Suggested deletion" },
};

/** Tags a writer might reach for, and what to use instead. */
export const SUGGESTIONS: Record<string, string> = {
  strong: "use <b>",
  em: "use <i>",
  strike: "use <s>",
  h4: "use <h3> (three heading levels)",
  h5: "use <h3> (three heading levels)",
  h6: "use <h3> (three heading levels)",
  div: "use <p> for text; blocks sit directly in <article>",
  section: "blocks sit directly in <article>",
  img: "wrap it: <figure><img src=\"assets/…\" alt=\"…\"><figcaption>…</figcaption></figure>",
  thead: "put <tr> directly in <table>; a first row of <th> is the header",
  tbody: "put <tr> directly in <table>",
  font: "a doc has no inline styles",
};

/** Colors text may take: <span data-text="red">…</span>. Each app maps them to its own tokens. */
export const TEXT_COLORS = ["red", "yellow", "green", "teal", "purple"] as const;
export type TextColor = (typeof TEXT_COLORS)[number];

export type FontChoice = "serif" | "sans";
export const FONT_CHOICES: readonly FontChoice[] = ["serif", "sans"];

/** Colors a dropdown option may take (names; each app maps them to its own tokens). */
export const OPTION_COLORS = ["gray", "blue", "green", "yellow", "orange", "red", "purple"] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

export interface DropdownOption {
  id: string;
  label: string;
  color: OptionColor;
}

export interface Dropdown {
  id: string;
  name: string;
  options: DropdownOption[];
}

/** Ready-made dropdowns offered when adding one. */
export const DROPDOWN_TEMPLATES: readonly Dropdown[] = [
  {
    id: "status",
    name: "Status",
    options: [
      { id: "not-started", label: "Not started", color: "gray" },
      { id: "in-progress", label: "In progress", color: "blue" },
      { id: "done", label: "Done", color: "green" },
    ],
  },
  {
    id: "priority",
    name: "Priority",
    options: [
      { id: "low", label: "Low", color: "gray" },
      { id: "medium", label: "Medium", color: "yellow" },
      { id: "high", label: "High", color: "red" },
    ],
  },
];

export const TAB_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const BLOCK_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;
export const OPTION_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const IMAGE_SRC_RE = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g|webp|gif|svg|avif)$/i;
export const HREF_RE = /^(https?:\/\/\S+|mailto:\S+|#[A-Za-z][A-Za-z0-9_-]{0,63})$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
