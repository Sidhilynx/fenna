# @opendeck/board-mcp

The Fenna Whiteboard MCP server: any AI that speaks MCP can read and change a
whiteboard folder through it, while the person watches each change land in
the app.

```
fenna-whiteboard-mcp --board=<folder>          (stdio)
```

## Tools

| Tool | What it does |
| --- | --- |
| `read_board` | Title, version, frames, every item as the file keeps it, open comment count, layout problems. Narrow with `frame`, `ids` or `area`. |
| `add_items` | Adds items in one all-or-nothing call. Items may refer to each other by the ids given. Without x and y they are placed: in their frame (which grows) or beside the board. |
| `edit_items` | Changes fields by id; `null` removes one. A moved frame takes what it holds; an item given a frame and no position goes to the frame's next free spot. |
| `delete_items` | Deletes by id, with the connectors left hanging. A deleted frame's contents stay unless `with_contents`. |
| `arrange` | `grid`, `row`, `column`, or `flow` (along the connectors, for diagrams); into and inside a frame, which is resized to fit. |
| `read_comments` / `comment` | The threads people left on items; reply, start one, resolve. |
| `rename_board` | The board's title. |
| `format_guide` | Every kind and field, color and shape name, generated from `@opendeck/board`. |

## How it is shaped

- Few tools, shaped like the work: a model needs about as many calls as a
  person needs actions (a retro board is one `add_items`).
- Reads return items in the file's own form; edits name items by id and
  change only the fields given. Passing `version` makes a change fail if the
  board changed since it was read.
- Every tool refuses argument names it doesn't take and lists the ones it
  does. Items are checked against the schema before anything is written; a
  wrong field or value fails the whole call with "did you mean" and the
  allowed list.
- Results are short: what changed, new ids and positions, and a "Check:"
  list (overlaps, text that doesn't fit, items outside their frame) so the
  model can see its own work without a picture.
- Lists in descriptions and checks come from `@opendeck/board`.
- Writes are atomic (temp file, then rename). A canvas.json that can't be
  read is never written over.
