// The Fenna Whiteboard MCP server. Any MCP client (Claude Code, Codex, Antigravity,
// a local model's runner) gets the same tools; nothing here is tied to one
// provider. Lists in schemas and descriptions come from @opendeck/board.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FILL_COLORS, ITEM_KINDS, SHAPE_KINDS } from "@opendeck/board";
import { INSTRUCTIONS, formatGuide } from "./guide.ts";
import { BoardStore, StoreError } from "./store.ts";

export { BoardStore, StoreError, layoutProblems, versionOf } from "./store.ts";
export { INSTRUCTIONS, formatGuide } from "./guide.ts";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 1));

/** Run a tool body; StoreErrors come back as tool errors the model can act on. */
async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof StoreError) return { ...text(e.message), isError: true };
    throw e;
  }
}

/**
 * registerTool, but each tool refuses argument names it doesn't take and says
 * which it does: a guessed name ("reply" for "text") must fail, not be dropped.
 */
function strictTools(server: McpServer): McpServer["registerTool"] {
  const register = server.registerTool.bind(server);
  return ((name: string, config: { inputSchema?: z.ZodRawShape }, cb: never) => {
    const shape = config.inputSchema;
    const takes = shape && Object.keys(shape).length ? `it takes ${Object.keys(shape).join(", ")}` : "it takes no arguments";
    const inputSchema =
      shape &&
      z.strictObject(shape, {
        error: (iss) => (iss.code === "unrecognized_keys" ? `${name} has no argument ${iss.keys.map((k) => `"${k}"`).join(", ")}; ${takes}` : undefined),
      });
    return register(name, { ...config, inputSchema } as never, cb);
  }) as McpServer["registerTool"];
}

const Version = z.string().max(40).optional().describe("the version read_board (or your last change) gave; the change is refused if someone changed the board since");
const Id = z.string().min(1).max(64);
const Item = z.record(z.string(), z.unknown());

export function createServer(root: string): McpServer {
  const store = new BoardStore(root);
  const server = new McpServer({ name: "fenna-whiteboard", version: "0.9.0" }, { instructions: INSTRUCTIONS });
  const tool = strictTools(server);

  tool(
    "read_board",
    {
      title: "Read the board",
      description:
        "Start here, and read again to check your work. Returns the title, a version (pass it to your next change), the frames with what they hold, every item exactly as the file keeps it (ids, kinds, positions, text, colors), how many comments are open, and problems on the board (overlaps, text that doesn't fit). On a big board narrow it with frame, ids or area. Example: {} or {frame: \"f-ideas\"}",
      inputSchema: {
        frame: Id.optional().describe("only this frame and what it holds"),
        ids: z.array(Id).max(500).optional().describe("only these items"),
        area: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).strict().optional().describe("only items touching this box"),
        limit: z.number().int().min(1).max(1000).optional().describe("most items to return (default 300)"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => guard(async () => json(await store.read(args))),
  );

  tool(
    "add_items",
    {
      title: "Add items",
      description: `Put new items on the board, all in one call: kinds ${ITEM_KINDS.join(", ")}. Each item is written as the file keeps it (format_guide lists the fields). Leave out id and one is made; leave out x and y and it is placed for you: in its frame's next free spot (set frame, the frame grows to fit) or beside the board. Items in one call can refer to each other: give your own ids ("f-went", "s-1") and use them as a connector's from/to or a sticky's frame. Colors are names: ${FILL_COLORS.join(", ")} for stickies, shapes and frames. Shapes: ${SHAPE_KINDS.join(", ")}. All or nothing: if one item is wrong, nothing is added and every problem is listed. Not for changing items (edit_items). Example: {items: [{id: "f-went", kind: "frame", title: "Went well", color: "green"}, {kind: "sticky", text: "Fast release", color: "green", frame: "f-went"}, {id: "a", kind: "shape", shape: "pill", text: "Start"}, {id: "b", kind: "shape", shape: "rect", text: "Enter email"}, {kind: "connector", from: {item: "a"}, to: {item: "b"}}]}`,
      inputSchema: { items: z.array(Item).min(1).max(500), version: Version },
    },
    ({ items, version }) => guard(async () => text((await store.add(items, version)).text)),
  );

  tool(
    "edit_items",
    {
      title: "Change items",
      description:
        "Change items by id: give only the fields to change; null removes a field. Move (x, y), resize (width, height), change text, colors, size, a connector's ends, label or caps. Set frame to put an item in a frame (without x and y it goes to the frame's next free spot). Moving a frame moves what it holds. A text item's height follows its text. An item can't change kind (delete it and add another). All or nothing. Example: {items: [{id: \"s-12\", text: \"Ship on Friday\", color: \"green\"}, {id: \"c-3\", label: \"no\", lineStyle: \"dashed\"}]}",
      inputSchema: { items: z.array(Item).min(1).max(500).describe("each {id, …fields to change}"), version: Version },
    },
    ({ items, version }) => guard(async () => text((await store.edit(items, version)).text)),
  );

  tool(
    "delete_items",
    {
      title: "Delete items",
      description:
        "Delete items by id, only ones the person asked to remove or that you added yourself; never clear the board to start a new request (add beside what is there instead). Connectors with an end on a deleted item go too. Deleting a frame keeps what it held on the board (outside any frame) unless with_contents is true. Example: {ids: [\"s-4\", \"s-5\"]}",
      inputSchema: { ids: z.array(Id).min(1).max(1000), with_contents: z.boolean().optional(), version: Version },
      annotations: { destructiveHint: true },
    },
    ({ ids, with_contents, version }) => guard(async () => text((await store.remove(ids, !!with_contents, version)).text)),
  );

  tool(
    "arrange",
    {
      title: "Arrange items",
      description:
        'Lay items out neatly without changing them. layout: "grid" (rows, reading order kept), "row", "column", or "flow" (follows the connectors: each item below, or right of, what points at it; for flowcharts and diagrams). Give ids, or a frame: with only a frame, its contents are arranged inside it; with ids and a frame, those items move into the frame and are arranged there; the frame is resized to fit either way. Start at x, y if given. Example: {frame: "f-ideas", layout: "grid", columns: 3} or {ids: ["a", "b", "c", "d"], layout: "flow"}',
      inputSchema: {
        layout: z.enum(["grid", "row", "column", "flow"], { error: (iss) => (iss.input === undefined ? "arrange needs layout: grid, row, column or flow (one call per layout; it takes layout, ids, frame, columns, gap, direction, x, y, version)" : `layout ${JSON.stringify(iss.input)} is not one of grid, row, column, flow`) }),
        ids: z.array(Id).min(1).max(1000).optional().describe("the items, in the order to place them"),
        frame: Id.optional(),
        columns: z.number().int().min(1).max(50).optional().describe("grid only"),
        gap: z.number().min(0).max(400).optional().describe("space between items (default 24; 64 for flow)"),
        direction: z.enum(["down", "right"]).optional().describe("flow only (default down)"),
        x: z.number().optional(),
        y: z.number().optional(),
        version: Version,
      },
    },
    ({ version, ...opts }) => guard(async () => text((await store.arrange(opts, version)).text)),
  );

  tool(
    "read_comments",
    {
      title: "Read comments",
      description:
        "The comment threads people left on items: each thread's id, the item it's on (id, kind, text), and its comments in order (by user or assistant). Open threads only, unless include_resolved. Use it when asked to act on comments; then make the change and answer with comment.",
      inputSchema: { include_resolved: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ include_resolved }) => guard(async () => json(await store.readComments(!!include_resolved))),
  );

  tool(
    "comment",
    {
      title: "Comment",
      description:
        "Reply to a thread, or start one on an item, the way a reviewer would. Reply: {thread, text}. Start: {item, text}. resolve: true closes the thread; resolve a person's thread only when you did what it asked. Changes go on the board; this is for saying what you did or asking. Example: {thread: \"t-12\", text: \"Added real-time sync to the note.\", resolve: true}",
      inputSchema: { thread: z.string().min(1).max(80).optional(), item: Id.optional(), text: z.string().max(4000).optional(), resolve: z.boolean().optional() },
    },
    (input) =>
      guard(async () => {
        const t = await store.comment(input);
        return text(`${input.thread ? "Replied in" : "Started"} thread ${t.id} (${t.comments.length} comment${t.comments.length === 1 ? "" : "s"}${t.resolved ? ", resolved" : ""}).`);
      }),
  );

  tool(
    "rename_board",
    {
      title: "Rename the board",
      description: 'Give the board a new title (shown in the window and on Home), only when the person asks for it. Example: {title: "Q4 retro"}',
      inputSchema: { title: z.string().min(1).max(200) },
      annotations: { idempotentHint: true },
    },
    ({ title }) => guard(async () => text(await store.rename(title))),
  );

  tool(
    "format_guide",
    {
      title: "Board format guide",
      description: "Every kind of item and its fields, the color names, shape kinds, connector options and sticker names, with notes on making a tidy board. Read it before your first add if you are unsure of a field.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => text(formatGuide()),
  );

  return server;
}
