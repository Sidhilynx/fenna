// Fenna Workspace unified MCP server: exposes tools for all five Fenna formats.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StoreError } from "@opendeck/mcp";
import { WorkspaceStore } from "./store.ts";

export { WorkspaceStore, detectKind } from "./store.ts";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof StoreError) {
      return { ...text((e as Error).message), isError: true };
    }
    return { ...text(String((e as Error)?.message || e)), isError: true };
  }
}

export const INSTRUCTIONS = `Fenna Workspace unified MCP server.
Read, edit, draft, and format across all five Fenna formats:
- Slides: deck_overview, read_slides, write_slide, edit_slide
- Docs: doc_overview, read_tab, write_tab, edit_blocks
- Sheets: sheet_overview, read_range, write_cells
- Whiteboard: board_overview, read_board, add_board_items
- Design: design_overview, read_artboard, write_artboard

Start by calling workspace_overview to see the available documents in the workspace.
Tools take an optional 'path' parameter (relative or absolute). If omitted, the tool automatically targets the single document of that kind in the workspace.`;

export function createServer(workspaceRoot: string): McpServer {
  const store = new WorkspaceStore(workspaceRoot);
  const server = new McpServer(
    { name: "fenna-workspace-mcp", version: "0.9.2" },
    { instructions: INSTRUCTIONS },
  );

  // ── Workspace Tools ───────────────────────────────────────────
  server.registerTool(
    "workspace_overview",
    {
      title: "Workspace overview",
      description: "List all documents (Slides, Docs, Sheets, Whiteboards, Designs) found in this workspace.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guard(async () => {
        const docs = await store.listDocuments();
        return json({
          workspace: store.root,
          documents: docs,
        });
      }),
  );

  server.registerTool(
    "workspace_guide",
    {
      title: "Workspace format guide",
      description: "Overview of Fenna's five document formats, how they store files, and cross-document workflows.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      text(`Fenna Workspace Formats:
1. Slides (deck): slides/<id>.html, deck.json. Use read_slides, write_slide, edit_slide.
2. Docs (doc): tabs/<id>.html, doc.json. Use read_tab, write_tab, edit_blocks.
3. Sheets (sheet): sheet.json, sheets/<id>.json. Use read_range, write_cells.
4. Whiteboard (board): board.json, canvas.json. Use read_board, add_board_items.
5. Design (design): design.json, artboards/<id>.html. Use read_artboard, write_artboard.`),
  );

  // ── Slides Tools ──────────────────────────────────────────────
  server.registerTool(
    "deck_overview",
    {
      title: "Deck overview",
      description: "Slide deck title, theme, sections, and slide list.",
      inputSchema: { path: z.string().optional().describe("Path to deck folder") },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guard(async () => {
        const s = await store.getDeckStore(args.path);
        const { deck, slides } = await s.summaries();
        return json({
          title: deck.index.title,
          canvas: "1920x1080",
          theme: deck.index.theme,
          sections: deck.index.sections,
          slides,
        });
      }),
  );

  server.registerTool(
    "read_slides",
    {
      title: "Read slides",
      description: "Read full HTML for slides in a deck.",
      inputSchema: {
        ids: z.array(z.string()).min(1).max(10).describe("Slide ids to read"),
        path: z.string().optional().describe("Path to deck folder"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guard(async () => {
        const s = await store.getDeckStore(args.path);
        const out = await Promise.all(args.ids.map((id) => s.readSlide(id)));
        return json(out);
      }),
  );

  server.registerTool(
    "write_slide",
    {
      title: "Write slide",
      description: "Create or replace a slide with formatted HTML.",
      inputSchema: {
        id: z.string().describe("Slide ID"),
        html: z.string().describe("Full slide HTML"),
        after: z.string().optional().describe("Slide ID to insert after"),
        path: z.string().optional().describe("Path to deck folder"),
      },
    },
    (args) =>
      guard(async () => {
        const s = await store.getDeckStore(args.path);
        const res = await s.writeSlide(args.id, args.html, { after: args.after });
        return json(res);
      }),
  );

  server.registerTool(
    "edit_slide",
    {
      title: "Edit slide text",
      description: "Replace exact text in a slide.",
      inputSchema: {
        id: z.string().describe("Slide ID"),
        find: z.string().describe("Exact string to replace"),
        replace: z.string().describe("Replacement string"),
        path: z.string().optional().describe("Path to deck folder"),
      },
    },
    (args) =>
      guard(async () => {
        const s = await store.getDeckStore(args.path);
        const res = await s.editSlide(args.id, [{ find: args.find, with: args.replace }]);
        return json(res);
      }),
  );

  // ── Docs Tools ────────────────────────────────────────────────
  server.registerTool(
    "doc_overview",
    {
      title: "Doc overview",
      description: "Document tabs, hierarchy, and outlines.",
      inputSchema: { path: z.string().optional().describe("Path to doc folder") },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guard(async () => {
        const s = await store.getDocStore(args.path);
        const o = await s.overview();
        return json(o);
      }),
  );

  server.registerTool(
    "read_tab",
    {
      title: "Read document tab",
      description: "Read full HTML of a document tab.",
      inputSchema: {
        id: z.string().describe("Tab ID"),
        path: z.string().optional().describe("Path to doc folder"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guard(async () => {
        const s = await store.getDocStore(args.path);
        const t = await s.readTab(args.id);
        return json(t);
      }),
  );

  server.registerTool(
    "write_tab",
    {
      title: "Write document tab",
      description: "Create or replace a document tab with HTML.",
      inputSchema: {
        id: z.string().describe("Tab ID"),
        html: z.string().describe("Full tab HTML"),
        path: z.string().optional().describe("Path to doc folder"),
      },
    },
    (args) =>
      guard(async () => {
        const s = await store.getDocStore(args.path);
        const res = await s.writeTab(args.id, args.html);
        return json(res);
      }),
  );

  server.registerTool(
    "edit_blocks",
    {
      title: "Edit document blocks",
      description: "Replace exact text within document blocks by block id.",
      inputSchema: {
        id: z.string().describe("Tab ID"),
        edits: z.array(z.object({ id: z.string(), find: z.string(), replace: z.string() })),
        path: z.string().optional().describe("Path to doc folder"),
      },
    },
    (args) =>
      guard(async () => {
        const s = await store.getDocStore(args.path);
        const edits = args.edits.map((e) => ({ op: "replace_text" as const, block: e.id, find: e.find, with: e.replace }));
        const res = await s.editBlocks(args.id, edits);
        return json(res);
      }),
  );

  // ── Sheets Tools ──────────────────────────────────────────────
  server.registerTool(
    "sheet_overview",
    {
      title: "Sheet overview",
      description: "Workbook title, sheets, and dimensions.",
      inputSchema: { path: z.string().optional().describe("Path to sheet folder") },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guard(async () => {
        const s = await store.getSheetStore(args.path);
        const o = await s.overview();
        return json(o);
      }),
  );

  server.registerTool(
    "read_range",
    {
      title: "Read sheet cells",
      description: "Read values and formulas for a cell range (e.g. A1:D10).",
      inputSchema: {
        sheet: z.string().describe("Sheet ID or title"),
        range: z.string().optional().describe("Range in A1 notation (e.g. A1:C5)"),
        path: z.string().optional().describe("Path to sheet folder"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guard(async () => {
        const s = await store.getSheetStore(args.path);
        const r = await s.readRange(args.sheet, args.range);
        return json(r);
      }),
  );

  server.registerTool(
    "write_cells",
    {
      title: "Write sheet cells",
      description: "Set values or formulas for cells.",
      inputSchema: {
        sheet: z.string().describe("Sheet ID or title"),
        cells: z.record(z.string(), z.any()).describe("Cell map, e.g. { A1: { value: 100 }, B1: { formula: '=A1*2' } }"),
        path: z.string().optional().describe("Path to sheet folder"),
      },
    },
    (args) =>
      guard(async () => {
        const s = await store.getSheetStore(args.path);
        const res = await s.writeCells(args.sheet, { cells: args.cells });
        return json(res);
      }),
  );

  // ── Whiteboard Tools ──────────────────────────────────────────
  server.registerTool(
    "board_overview",
    {
      title: "Whiteboard overview",
      description: "Whiteboard item counts and layout.",
      inputSchema: { path: z.string().optional().describe("Path to board folder") },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guard(async () => {
        const s = await store.getBoardStore(args.path);
        const loaded = await s.load();
        return json({
          title: loaded.meta.title,
          itemCount: loaded.items.length,
          version: loaded.version,
        });
      }),
  );

  server.registerTool(
    "read_board",
    {
      title: "Read whiteboard items",
      description: "Read sticky notes, cards, text, shapes, and frames on the whiteboard.",
      inputSchema: {
        frame: z.string().optional().describe("Filter by frame id"),
        path: z.string().optional().describe("Path to board folder"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guard(async () => {
        const s = await store.getBoardStore(args.path);
        const r = await s.read({ frame: args.frame });
        return json(r);
      }),
  );

  server.registerTool(
    "add_board_items",
    {
      title: "Add whiteboard items",
      description: "Add sticky notes, text, cards, shapes, or connectors to the board.",
      inputSchema: {
        items: z.array(z.record(z.string(), z.any())).min(1).describe("List of items to add"),
        path: z.string().optional().describe("Path to board folder"),
      },
    },
    (args) =>
      guard(async () => {
        const s = await store.getBoardStore(args.path);
        const res = await s.add(args.items as any);
        return json(res);
      }),
  );

  // ── Design Tools ──────────────────────────────────────────────
  server.registerTool(
    "design_overview",
    {
      title: "Design overview",
      description: "Artboards, pages, and order in a Fenna Design document.",
      inputSchema: { path: z.string().optional().describe("Path to design folder") },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guard(async () => {
        const s = await store.getDesignStore(args.path);
        const o = await s.overview();
        return json(o);
      }),
  );

  server.registerTool(
    "read_artboard",
    {
      title: "Read artboard",
      description: "Read full HTML of an artboard file.",
      inputSchema: {
        name: z.string().describe("Artboard filename (e.g. card.html)"),
        path: z.string().optional().describe("Path to design folder"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guard(async () => {
        const s = await store.getDesignStore(args.path);
        const a = await s.readArtboard(args.name);
        return json(a);
      }),
  );

  server.registerTool(
    "write_artboard",
    {
      title: "Write artboard",
      description: "Create or replace an artboard with HTML.",
      inputSchema: {
        name: z.string().describe("Artboard filename"),
        html: z.string().describe("Full artboard HTML"),
        path: z.string().optional().describe("Path to design folder"),
      },
    },
    (args) =>
      guard(async () => {
        const s = await store.getDesignStore(args.path);
        const res = await s.writeArtboard(args.name, args.html);
        return json(res);
      }),
  );

  return server;
}
