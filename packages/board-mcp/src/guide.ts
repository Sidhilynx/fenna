// What a model is told about the Fenna Whiteboard format. The reference part is
// generated from @opendeck/board, so it can't drift from what the validator
// and the renderer accept.

import {
  ALIGNS,
  CAPS,
  DEFAULT_SIZES,
  FILL_COLORS,
  INK_COLORS,
  ITEM_KINDS,
  KIND_FIELDS,
  KIND_LABELS,
  LINE_STYLES,
  ROUTES,
  SHAPE_DEFAULTS,
  SHAPE_KINDS,
  SIDES,
  STICKERS,
  TEXT_SIZE_PX,
  TEXT_SIZES,
} from "@opendeck/board";

/** Short form, sent as the server's instructions on connect. */
export const INSTRUCTIONS = `You edit a Fenna Whiteboard whiteboard: an infinite canvas in a folder on the user's computer. The user sees every change on screen as you save it.
Items are sticky notes, text, shapes, frames (labelled areas that hold items), connectors (arrows between items), pen drawings, tables, stickers and images. Each has a stable id. Positions are board units (1 unit = 1 pixel at 100%); x grows right, y grows down.
The board is the person's work: add to it. Never delete, move or reword what is already there unless they asked for that change; a new request goes beside what is on the board. Never rename the board unless asked.
Start with read_board. Add with add_items, change with edit_items, remove with delete_items, lay out with arrange. Leave x and y out and items are placed for you: inside their frame (which grows to fit), or beside what is already on the board. To lay out a flowchart, add the shapes and connectors, then arrange them with layout "flow".
Every result ends with what to check (overlaps, text that doesn't fit); fix those before you finish. Comments: read_comments lists what people asked; answer with comment.
Call format_guide when you need the exact fields of a kind.`;

const list = (xs: readonly string[]) => xs.join(", ");

export function formatGuide(): string {
  const kinds = ITEM_KINDS.map((k) => `- ${k} (${KIND_LABELS[k]}): ${KIND_FIELDS[k].join(", ")}`).join("\n");
  const shapes = SHAPE_KINDS.map((s) => `- ${s}: ${SHAPE_DEFAULTS[s].use}, ${SHAPE_DEFAULTS[s].width}×${SHAPE_DEFAULTS[s].height}`).join("\n");
  const sizes = TEXT_SIZES.map((s) => `${s} ${TEXT_SIZE_PX[s]}px`).join(", ");
  return `# The Fenna Whiteboard format

## Every item
id (letters, digits, - and _; leave it out when adding and one is made), kind, and for all but connectors a box: x, y, width, height (board units), rotation (degrees), locked, frame (the id of the frame it sits in), group (items with the same group move together), link (a web address).

## Kinds and their fields
${kinds}

## Text
size: ${sizes} (default body). bold, italic, list (each line a bullet), align: ${list(ALIGNS)}. Newlines in text are kept. A text item's height follows its text; set its width and the words wrap.

## Colors (names, never hex)
- Fills (sticky color, shape fill, frame color, table header): ${list(FILL_COLORS)}. Shapes also take fill "none".
- Inks (text color, line color, shape stroke, pen): ${list(INK_COLORS)}. "default" is white on the dark theme and near-black on the light one.

## Shapes
${shapes}
Text inside a shape is centred. stroke (an ink) draws an outline; lineStyle: ${list(LINE_STYLES)}.

## Frames
title, color. Set an item's frame to put it in one; leave its x and y out and it is placed in the frame's next free spot, the frame growing to fit. Moving a frame moves what it holds. Frames don't nest.

## Connectors
from and to: {"item": "<id>"} to attach to an item (it follows when the item moves), with an optional side: ${list(SIDES)}; or {"x": …, "y": …} for a free end.
route: ${list(ROUTES)} (default elbow). startCap / endCap: ${list(CAPS)} (default: no start, an arrow at the end). label: a few words on the line. lineStyle, color.

## Others
- drawing: points is a flat list x, y, x, y … relative to the box's top left.
- table: cells is rows of text, the first row the header; every row has as many cells. color fills the header.
- sticker: sticker is one of ${list(STICKERS.map((s) => s.id))}. Square, ${DEFAULT_SIZES.sticker.width}×${DEFAULT_SIZES.sticker.height} by default.
- image: src names a file already in the board's assets folder ("assets/photo.png").

## Default sizes
Sticky ${DEFAULT_SIZES.sticky.width}×${DEFAULT_SIZES.sticky.height}, frame fits what it holds, text ${DEFAULT_SIZES.text.width} wide.

## Making a good board
- Group related notes in frames with short titles; one idea per sticky, a few words each.
- Keep items apart (24 units between notes, 60–80 between shapes in a diagram) and aligned in rows or columns; let add_items and arrange place them.
- Use shapes by meaning (pill for start and end, diamond for a decision, rect for a step), connect them, then arrange with layout "flow".
- Never change the words people wrote unless they asked; move or regroup instead.`;
}
