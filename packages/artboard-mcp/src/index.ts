// The Fenna Design MCP server. Any MCP client (Claude Code, Codex,
// Antigravity, a local model's runner) gets the same tools; nothing here is
// tied to one provider.
//
// The tools follow the shape of a file editor: read an artboard as the HTML
// on disk, change it by quoting exact text, or write it whole. Every write is
// checked against the format and refused with line-numbered problems.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Diagnostic } from "@opendeck/artboard";
import { INSTRUCTIONS, formatGuide } from "./guide.ts";
import { DesignStore, StoreError } from "./store.ts";

export { DesignStore, StoreError, versionOf } from "./store.ts";
export { INSTRUCTIONS, formatGuide } from "./guide.ts";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

function describeProblems(ds: Diagnostic[]): string {
  return ds.map((d) => `- line ${d.line}:${d.col} ${d.path ? `(${d.path}) ` : ""}${d.message}`).join("\n");
}

const warningsNote = (ws: Diagnostic[]) => (ws.length ? `\nWarnings (saved anyway; worth fixing):\n${describeProblems(ws)}` : "");

/** Run a tool body; StoreErrors come back as tool errors the model can act on. */
async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof StoreError) {
      const detail = e.diagnostics.length ? `\n${describeProblems(e.diagnostics)}` : "";
      return { ...text(`${e.message}${detail}`), isError: true };
    }
    throw e;
  }
}

const File = z.string().min(1).max(130).describe('an artboard\'s file name, as design_overview lists it, e.g. "Card.html"');
const Html = z.string().min(1).max(400_000);
const Version = z.string().optional().describe("the version read_artboards gave; refused if the artboard changed since");
const Size = z.number().min(16).max(8000);
const Coord = z.number().min(-1_000_000).max(1_000_000);

export function createServer(root: string): McpServer {
  const store = new DesignStore(root);
  const server = new McpServer({ name: "fenna-design", version: "0.9.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "design_overview",
    {
      title: "Design overview",
      description:
        "Start here. The design's title, its pages, every artboard in order (file, title, page, position x/y and size w/h on the canvas, open comment count, problem counts), the tweaks (CSS variables), the text styles, and the sticky notes people left on the canvas.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => guard(async () => json(await store.overview())),
  );

  server.registerTool(
    "format_guide",
    {
      title: "Artboard format guide",
      description: "Every element and style property an artboard may use, with an example, and how to make designs that fit and read well. Read it once before your first write.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => text(formatGuide()),
  );

  server.registerTool(
    "read_artboards",
    {
      title: "Read artboards",
      description:
        "Up to 10 artboards, each as the HTML of its root element exactly as edit_artboard sees it, with its version (pass it back as expected_version) and any problems. Read an artboard before you change it; quote edit_artboard's `find` from this text. Example: {files:[\"Card.html\"]}",
      inputSchema: { files: z.array(File).min(1).max(10) },
      annotations: { readOnlyHint: true },
    },
    ({ files }) =>
      guard(async () => {
        const parts: string[] = [];
        for (const name of files) {
          const r = await store.readArtboard(name);
          const problems = r.diagnostics.length ? `\nProblems:\n${describeProblems(r.diagnostics)}` : "";
          parts.push(`=== "${r.file}" · ${r.board.title} · ${r.board.w}×${r.board.h} (version ${r.version}) ===\n${r.html}${problems}`);
        }
        return text(parts.join("\n\n"));
      }),
  );

  server.registerTool(
    "edit_artboard",
    {
      title: "Edit an artboard",
      description:
        "Change part of one artboard and leave the rest exactly as it is. Use it for every change short of a redesign: rewording, a color, a size, adding or removing one element. " +
        "Each edit replaces `find` (copied exactly from read_artboards, tags and attributes included; it must appear once, or pass nth) with `with`. Edits apply in order and land together, or none do. " +
        'Example: {file:"Card.html", edits:[{find:"Hello from a canvas", with:"Hello, world"}, {find:"font-size:22px", with:"font-size:20px"}]}',
      inputSchema: {
        file: File,
        edits: z
          .array(
            z.object({
              find: z.string().min(1).max(100_000).describe("text exactly as read_artboards shows it"),
              with: z.string().max(400_000).describe("what to put in its place; may be empty"),
              nth: z.number().int().min(1).optional().describe("which match, when find appears more than once (1 is the first)"),
            }),
          )
          .min(1)
          .max(50),
        expected_version: Version,
      },
    },
    ({ file, edits, expected_version }) =>
      guard(async () => {
        const r = await store.editArtboard(file, edits, expected_version);
        return text(`Saved "${r.file}" (version ${r.version}, ${r.board.w}×${r.board.h}).${warningsNote(r.warnings)}`);
      }),
  );

  server.registerTool(
    "write_artboard",
    {
      title: "Write an artboard",
      description:
        "Create an artboard, or replace one whole. html is its ONE root element (a <div> with width and height in px) in the format format_guide describes. " +
        "A new artboard goes on the first page, beside the others, unless page / x / y say where; its size is w×h, or the root's own width and height. title is the name shown above it. To change part of an existing artboard, use edit_artboard instead. " +
        'Example: {file:"Post.html", title:"Social post", html:"<div style=\\"width:1080px;height:1080px;padding:96px;background:#f4f1ea\\"><h1 data-style=\\"Heading 1\\" style=\\"margin:0\\">Open studio</h1></div>"}',
      inputSchema: {
        file: File,
        html: Html,
        title: z.string().min(1).max(200).optional(),
        page: z.string().max(200).optional().describe("a page's id or name; default: the page it is on, or the first"),
        x: Coord.optional(),
        y: Coord.optional(),
        w: Size.optional().describe("width in px; default: the root's width"),
        h: Size.optional().describe("height in px; default: the root's height"),
        expand: z.enum(["fit", "fill"]).optional().describe('"fill": a web page that grows down with its content (h is then its least height)'),
        after: z.string().max(130).optional().describe('for a new artboard: the file it follows in the order, or "start"; default: the end'),
        expected_version: Version,
      },
    },
    ({ file, html, expected_version, ...place }) =>
      guard(async () => {
        const r = await store.writeArtboard(file, html, { ...place, expectedVersion: expected_version });
        return text(`${r.created ? "Created" : "Saved"} "${r.file}" (version ${r.version}): "${r.board.title}", ${r.board.w}×${r.board.h} at ${r.board.x},${r.board.y} on page ${r.board.page}.${warningsNote(r.warnings)}`);
      }),
  );

  server.registerTool(
    "check_artboard",
    {
      title: "Check an artboard",
      description: "Check artboard HTML against the format without saving it: the same problems and warnings a write would give. Use it to try markup you are unsure of.",
      inputSchema: { html: Html },
      annotations: { readOnlyHint: true },
    },
    ({ html }) =>
      guard(async () => {
        const r = await store.check(html);
        return text(r.diagnostics.length ? describeProblems(r.diagnostics) : "No problems.");
      }),
  );

  server.registerTool(
    "delete_artboards",
    {
      title: "Delete artboards",
      description: "Delete artboards by file name. Only when the user asked for it; there is no undo from here.",
      inputSchema: { files: z.array(File).min(1).max(40) },
      annotations: { destructiveHint: true },
    },
    ({ files }) =>
      guard(async () => {
        const gone = await store.deleteArtboards(files);
        return text(`Deleted ${gone.join(", ")}.`);
      }),
  );

  server.registerTool(
    "arrange_artboards",
    {
      title: "Arrange artboards",
      description:
        "Move, resize, rename or re-page artboards on the canvas without touching their content, and optionally set the order they are listed and exported in. Give only what changes. order, when given, lists every file once. " +
        'Example: {artboards:[{file:"Post.html", x:1040, y:80}, {file:"Card.html", title:"Card, light"}]}',
      inputSchema: {
        artboards: z
          .array(z.object({ file: File, x: Coord.optional(), y: Coord.optional(), w: Size.optional(), h: Size.optional(), page: z.string().max(200).optional().describe("a page's id or name"), title: z.string().min(1).max(200).optional() }))
          .max(40)
          .optional(),
        order: z.array(File).max(40).optional(),
      },
      annotations: { idempotentHint: true },
    },
    ({ artboards, order }) =>
      guard(async () => {
        if (!artboards?.length && !order) throw new StoreError("nothing to do: give artboards (what to move, resize or rename) or order");
        const index = await store.arrange(artboards ?? [], order);
        return text(`Arranged. ${index.order.map((f) => `${f}: ${index.boards[f]!.w}×${index.boards[f]!.h} at ${index.boards[f]!.x},${index.boards[f]!.y} on ${index.boards[f]!.page}`).join("; ")}.`);
      }),
  );

  server.registerTool(
    "read_comments",
    {
      title: "Read comments",
      description:
        "The comment threads people left on the design, in artboard order: each thread's id, its artboard, the layer it is on (what it is and its HTML), and its comments in order (by user or assistant). Open threads only, unless include_resolved. Use it when asked to act on comments, feedback or review notes; make the changes with edit_artboard, then answer each thread with comment.",
      inputSchema: { file: File.optional().describe("only this artboard's threads"), include_resolved: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ file, include_resolved }) => guard(async () => json(await store.readComments(file, include_resolved))),
  );

  server.registerTool(
    "comment",
    {
      title: "Comment",
      description:
        'Reply to a thread, or start one on an artboard, the way a reviewer would. Reply: {thread, text}. Start: {file, quote?, text}, where quote is a few words of one layer as they read on the artboard (plain text); leave it out to comment on the whole artboard. resolve: true closes the thread; only resolve a thread a person wrote in when they asked you to. Comments are for questions and notes; change the artboard with edit_artboard. Example: {thread:"t-card-copy", text:"Shortened it to one sentence."}',
      inputSchema: {
        thread: z.string().min(1).max(80).optional().describe("the thread to reply to (read_comments gives ids)"),
        file: File.optional(),
        quote: z.string().max(400).optional(),
        text: z.string().max(4000).optional(),
        resolve: z.boolean().optional(),
      },
    },
    (input) =>
      guard(async () => {
        const r = await store.comment(input);
        return text(`${input.thread ? "Replied in" : "Started"} thread ${r.thread} (${r.comments} comment${r.comments === 1 ? "" : "s"}${r.resolved ? ", resolved" : ""}).`);
      }),
  );

  server.registerTool(
    "update_design",
    {
      title: "Update design settings",
      description:
        "Change the design's title, pages, tweaks or text styles. tweaks and textStyles set the entries you give and keep the others (null removes one): a tweak is a CSS variable every artboard can use as var(--name), so changing it recolors the whole design at once. pages is the full list in order, each {id?, name}; leave id out for a new page. Refused if an artboard would break (it uses a tweak you removed) or a page that still holds artboards would go. " +
        'Example: {tweaks:{"--accent":"#2563eb"}}',
      inputSchema: {
        title: z.string().min(1).max(200).optional(),
        pages: z.array(z.object({ id: z.string().max(40).optional(), name: z.string().min(1).max(200) })).min(1).max(20).optional(),
        tweaks: z.record(z.string(), z.string().nullable()).optional().describe('{"--accent":"#2563eb"}: a color or a length'),
        textStyles: z.record(z.string(), z.string().nullable()).optional().describe('{"Body":"font-size: 20px; line-height: 1.5;"}: text properties only'),
      },
      annotations: { idempotentHint: true },
    },
    (patch) =>
      guard(async () => {
        const { index, using } = await store.updateDesign(patch);
        const used = Object.entries(using).map(([name, files]) => `${name} is used by ${files.join(", ")}`);
        const unused = Object.keys(patch.tweaks ?? {}).map((k) => (k.startsWith("--") ? k : `--${k}`)).filter((k) => k in index.tweaks && !using[k]);
        const notes = [...used, ...unused.map((k) => `no artboard uses var(${k}) yet: edit the layers that should follow it`)];
        return json({ saved: true, title: index.title, pages: index.pages, tweaks: index.tweaks, textStyles: index.textStyles, ...(notes.length ? { notes } : {}) });
      }),
  );

  return server;
}
