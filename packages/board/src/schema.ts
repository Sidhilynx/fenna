// The Fenna Whiteboard format: the one place that says what a board can hold. The
// editor, the validator, the renderer and the MCP server all read their
// lists from here.
//
// A board is a folder:
//   board.json     { format, title, settings }
//   canvas.json    { items: [...] }  every item with a stable id; z-order is array order
//   comments.json  the shell's thread format; a thread points at an item or a spot
//   history.json   versions, newest first
//   assets/        images
// Coordinates are board units: 1 unit is 1 CSS pixel at 100% zoom.

export const FORMAT = "fenna-whiteboard/0";
/** The marker boards had before the Fenna name; still read, and written back as FORMAT. */
export const LEGACY_FORMAT = "openboard/0";

export const LIMITS = {
  items: 50_000,
  titleChars: 200,
  textChars: 20_000,
  linkChars: 2_000,
  points: 5_000,
  tableCells: 2_500,
  /** No coordinate is further than this from the origin. */
  coord: 10_000_000,
  /** No item is wider or taller than this. */
  size: 1_000_000,
  minSize: 8,
} as const;

export const ITEM_KINDS = ["sticky", "text", "shape", "frame", "connector", "drawing", "table", "sticker", "image"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const KIND_LABELS: Record<ItemKind, string> = {
  sticky: "Sticky note",
  text: "Text",
  shape: "Shape",
  frame: "Frame",
  connector: "Connector",
  drawing: "Drawing",
  table: "Table",
  sticker: "Sticker",
  image: "Image",
};

/** In the order the shape library shows them. */
export const SHAPE_KINDS = ["square", "circle", "pill", "diamond", "rect", "hexagon", "parallelogram", "cylinder", "drum", "document", "cloud", "person"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  square: "Square",
  circle: "Circle",
  pill: "Pill",
  diamond: "Diamond",
  rect: "Rectangle",
  hexagon: "Hexagon",
  parallelogram: "Parallelogram",
  cylinder: "Cylinder",
  drum: "Drum",
  document: "Document",
  cloud: "Cloud",
  person: "Person",
};

/** A new shape's size, and what each kind is usually for (told to the AI). */
export const SHAPE_DEFAULTS: Record<ShapeKind, { width: number; height: number; use: string }> = {
  square: { width: 160, height: 160, use: "a box" },
  circle: { width: 160, height: 160, use: "a state, a start or end point" },
  pill: { width: 200, height: 80, use: "start or end of a flowchart" },
  diamond: { width: 180, height: 140, use: "a decision" },
  rect: { width: 200, height: 100, use: "a step, a process" },
  hexagon: { width: 200, height: 110, use: "preparation, a stage" },
  parallelogram: { width: 210, height: 100, use: "input or output" },
  cylinder: { width: 140, height: 160, use: "a database" },
  drum: { width: 200, height: 110, use: "stored data, a queue" },
  document: { width: 200, height: 130, use: "a document, a report" },
  cloud: { width: 220, height: 140, use: "the internet, an external service" },
  person: { width: 120, height: 160, use: "a person, a role" },
};

/** Text sizes, as the "Body" menu lists them. */
export const TEXT_SIZES = ["small", "body", "large", "title", "huge"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const TEXT_SIZE_PX: Record<TextSize, number> = { small: 14, body: 16, large: 28, title: 48, huge: 96 };
export const TEXT_SIZE_LABELS: Record<TextSize, string> = { small: "Small", body: "Body", large: "Large", title: "Title", huge: "Huge" };

export const ALIGNS = ["left", "center", "right"] as const;
export type Align = (typeof ALIGNS)[number];

/**
 * Colors are named, never raw hex, so a board reads the same in both themes.
 * Fills are the pale colors of stickies, shapes and frames; inks are for text,
 * lines and pen strokes and are drawn darker on a light background.
 */
export const FILL_COLORS = ["yellow", "orange", "pink", "green", "blue", "purple", "gray"] as const;
export type FillColor = (typeof FILL_COLORS)[number];
export const INK_COLORS = ["default", "orange", "blue", "green", "purple"] as const;
export type InkColor = (typeof INK_COLORS)[number];

export const COLOR_LABELS: Record<FillColor | InkColor, string> = {
  yellow: "Yellow",
  orange: "Orange",
  pink: "Pink",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  gray: "Gray",
  default: "Default",
};

export type Theme = "dark" | "light";

export const FILL_VALUES: Record<FillColor, string> = {
  yellow: "#fbe38e",
  orange: "#f7bd94",
  pink: "#f5b8d0",
  green: "#b7e3a8",
  blue: "#acd4f6",
  purple: "#cbc0fb",
  gray: "#d6d6d6",
};

export const INK_VALUES: Record<Theme, Record<InkColor, string>> = {
  dark: { default: "#ededed", orange: "#f0a476", blue: "#8ec4f2", green: "#9fd897", purple: "#c4b4fa" },
  light: { default: "#1d1d1d", orange: "#c95f27", blue: "#2a72c4", green: "#2f8a39", purple: "#6a4fd0" },
};

/** The default color of each kind that has one. */
export const DEFAULT_COLORS = {
  sticky: "yellow",
  shape: "gray",
  frame: "gray",
  table: "gray",
} as const satisfies Record<string, FillColor>;

export const LINE_STYLES = ["solid", "dashed"] as const;
export type LineStyle = (typeof LINE_STYLES)[number];

/** What a connector's end looks like. */
export const CAPS = ["none", "arrow", "dot"] as const;
export type Cap = (typeof CAPS)[number];

/** elbow: right angles with rounded corners; straight: one line. */
export const ROUTES = ["elbow", "straight"] as const;
export type Route = (typeof ROUTES)[number];

/** Where a connector meets an item; auto picks the side facing the other end. */
export const SIDES = ["auto", "top", "right", "bottom", "left"] as const;
export type Side = (typeof SIDES)[number];

/** Stickers: drawn by render.ts, named here. */
export const STICKERS = [
  { id: "heart", label: "Heart" },
  { id: "star", label: "Star" },
  { id: "thumbs-up", label: "Thumbs up" },
  { id: "thumbs-down", label: "Thumbs down" },
  { id: "plus-one", label: "Plus one" },
  { id: "check", label: "Check" },
  { id: "cross", label: "Cross" },
  { id: "question", label: "Question" },
  { id: "warning", label: "Warning" },
  { id: "idea", label: "Idea" },
  { id: "flag", label: "Flag" },
  { id: "pin", label: "Pin" },
  { id: "target", label: "Target" },
  { id: "trophy", label: "Trophy" },
  { id: "rocket", label: "Rocket" },
  { id: "clock", label: "Clock" },
  { id: "smile", label: "Smile" },
  { id: "sad", label: "Sad" },
  { id: "fire", label: "Fire" },
  { id: "bolt", label: "Bolt" },
  { id: "arrow-right", label: "Arrow right" },
  { id: "arrow-up", label: "Arrow up" },
  { id: "speech", label: "Speech" },
  { id: "eyes", label: "Eyes" },
] as const;
export type StickerId = (typeof STICKERS)[number]["id"];
export const STICKER_IDS = STICKERS.map((s) => s.id) as readonly StickerId[];

// ── Items ────────────────────────────────────────────────────────────────

/** Every item but a connector has a box. Rotation turns it about its centre. */
export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise. */
  rotation?: number;
  locked?: boolean;
  /** The frame this item sits in; it moves with the frame. */
  frame?: string;
  /** Items with the same group id are selected and moved together. */
  group?: string;
  link?: string;
}

/** How text inside an item is set. */
export interface TextStyle {
  size?: TextSize;
  bold?: boolean;
  italic?: boolean;
  align?: Align;
  /** Each line is a bullet. */
  list?: boolean;
}

export interface StickyItem extends Box, TextStyle {
  kind: "sticky";
  text: string;
  color?: FillColor;
  /** Who wrote it, shown small at the bottom. */
  author?: string;
}

export interface TextItem extends Box, TextStyle {
  kind: "text";
  text: string;
  color?: InkColor;
}

export interface ShapeItem extends Box, TextStyle {
  kind: "shape";
  shape: ShapeKind;
  text?: string;
  /** "none" leaves the shape open. */
  fill?: FillColor | "none";
  /** The outline; none when absent. */
  stroke?: InkColor;
  lineStyle?: LineStyle;
  /** Text color; dark on a fill, ink when the shape is open. */
  color?: InkColor;
}

export interface FrameItem extends Box {
  kind: "frame";
  title: string;
  color?: FillColor;
}

/** A connector's end: on an item (it follows the item), or at a fixed spot. */
export type End = { item: string; side?: Side } | { x: number; y: number };

export interface ConnectorItem {
  id: string;
  kind: "connector";
  from: End;
  to: End;
  route?: Route;
  lineStyle?: LineStyle;
  color?: InkColor;
  startCap?: Cap;
  endCap?: Cap;
  label?: string;
  locked?: boolean;
  frame?: string;
  group?: string;
}

export interface DrawingItem extends Box {
  kind: "drawing";
  /** x, y pairs relative to the box's top left, in the box's own units. */
  points: number[];
  color?: InkColor;
  lineStyle?: LineStyle;
}

export interface TableItem extends Box {
  kind: "table";
  /** Rows of cells; the first row is the header. Every row has as many cells. */
  cells: string[][];
  size?: TextSize;
  align?: Align;
  /** The header row's fill. */
  color?: FillColor;
}

export interface StickerItem extends Box {
  kind: "sticker";
  sticker: StickerId;
}

export interface ImageItem extends Box {
  kind: "image";
  /** A file in the board's assets folder: "assets/photo.png". */
  src: string;
  alt?: string;
}

export type BoardItem = StickyItem | TextItem | ShapeItem | FrameItem | ConnectorItem | DrawingItem | TableItem | StickerItem | ImageItem;
export type BoxItem = Exclude<BoardItem, ConnectorItem>;

/** The fields each kind takes, beside id and kind: what the validator accepts and the guide lists. */
const BOX_FIELDS = ["x", "y", "width", "height", "rotation", "locked", "frame", "group", "link"] as const;
const TEXT_FIELDS = ["size", "bold", "italic", "align", "list"] as const;
export const KIND_FIELDS: Record<ItemKind, readonly string[]> = {
  sticky: [...BOX_FIELDS, ...TEXT_FIELDS, "text", "color", "author"],
  text: [...BOX_FIELDS, ...TEXT_FIELDS, "text", "color"],
  shape: [...BOX_FIELDS, ...TEXT_FIELDS, "shape", "text", "fill", "stroke", "lineStyle", "color"],
  frame: [...BOX_FIELDS, "title", "color"],
  connector: ["from", "to", "route", "lineStyle", "color", "startCap", "endCap", "label", "locked", "frame", "group"],
  drawing: [...BOX_FIELDS, "points", "color", "lineStyle"],
  table: [...BOX_FIELDS, "cells", "size", "align", "color"],
  sticker: [...BOX_FIELDS, "sticker"],
  image: [...BOX_FIELDS, "src", "alt"],
};

/** Sizes a new item of each kind starts at. */
export const DEFAULT_SIZES: Record<Exclude<ItemKind, "connector" | "shape">, { width: number; height: number }> = {
  sticky: { width: 200, height: 200 },
  text: { width: 240, height: 24 },
  frame: { width: 640, height: 420 },
  drawing: { width: 100, height: 100 },
  table: { width: 480, height: 120 },
  sticker: { width: 96, height: 96 },
  image: { width: 320, height: 240 },
};

// ── The board ────────────────────────────────────────────────────────────

export interface BoardSettings {
  /** Single-key tool shortcuts (V, H, T …). */
  shortcuts: boolean;
  /** A chime when the timer ends. */
  chime: boolean;
}

export interface BoardMeta {
  format: typeof FORMAT;
  title: string;
  settings: BoardSettings;
}

export const DEFAULT_SETTINGS: BoardSettings = { shortcuts: true, chime: true };

/** A comment thread's anchor: an item, or a spot on the board. */
export interface BoardAnchor {
  item?: string;
  x?: number;
  y?: number;
}

/** A version in history.json. */
export interface BoardVersion {
  id: string;
  at: number;
  author: string;
  label: string;
  title: string;
  items: BoardItem[];
}
