# @opendeck/artboard-mcp

The Fenna Design MCP server: any AI that speaks MCP reads and edits a design
folder through it, and the app shows each change as it lands.

```
node --experimental-strip-types packages/artboard-mcp/src/cli.ts --design <folder>
```

Eleven tools, shaped like a file editor (the same shape as the slides
server):

| Tool | For |
|---|---|
| `design_overview` | Start here: pages, artboards with place and size, tweaks, text styles |
| `format_guide` | Every element and property, generated from `@opendeck/artboard` |
| `read_artboards` | An artboard's root element as HTML, with its version |
| `edit_artboard` | Replace exact text (`find` / `with`), all edits or none |
| `write_artboard` | A new artboard, or one replaced whole; placed beside the others |
| `check_artboard` | The problems a write would give, without saving |
| `delete_artboards` | Remove artboards |
| `arrange_artboards` | Move, resize, rename, re-page, reorder |
| `read_comments`, `comment` | Review threads on artboards and layers |
| `update_design` | Title, pages, tweaks (CSS variables), text styles |

Every write is checked against the format and lands whole or not at all. A
write that names the version it read is refused if the file changed since.
A file that can't be read as an artboard is shown whole and only ever
replaced by a valid one.

The interface is designed and changed only by Claude models (see
`docs/process.md`); a change is done when the agent tasks in
`docs/apps/design.md` pass and the transcripts are in a review.
