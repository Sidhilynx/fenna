// The doc MCP server. Any MCP client (Claude Code, Codex, Antigravity, a
// local model's runner) gets the same tools; nothing here is tied to one
// provider.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Diagnostic, TabRef } from "@opendeck/doc";
import { FONT_CHOICES, OPTION_COLORS } from "@opendeck/doc";
import { INSTRUCTIONS, formatGuide } from "./guide.ts";
import { type BlockEdit, DocStore, StoreError } from "./store.ts";

export { DocStore, StoreError, versionOf } from "./store.ts";
export { INSTRUCTIONS, formatGuide } from "./guide.ts";

/** Said first when the doc is in Suggesting mode, so the model knows its edit is not final. */
const SUGGESTED = "The doc is in Suggesting mode: your changes were saved as suggestions (<ins>/<del> marks) for the user to accept or reject. ";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

function describeProblems(ds: Diagnostic[]): string {
  return ds.map((d) => `- line ${d.line}:${d.col} ${d.path ? `(${d.path}) ` : ""}${d.message}`).join("\n");
}

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

const TabId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/).describe("a tab id: a letter, then letters, digits, - or _");
const BlockId = z.string().min(1).max(24).describe("a block id, as read_tab shows it");
const Html = z.string().min(1).max(400_000);

interface TabTree {
  id: string;
  title: string;
  children?: TabTree[];
}
const TabTreeSchema: z.ZodType<TabTree> = z.lazy(() => z.object({ id: TabId, title: z.string().max(200), children: z.array(TabTreeSchema).optional() }));
const withChildren = (t: TabTree): TabRef => ({ id: t.id, title: t.title, children: (t.children ?? []).map(withChildren) });

export function createServer(root: string): McpServer {
  const store = new DocStore(root);
  const server = new McpServer({ name: "fenna-docs", version: "0.9.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "doc_overview",
    {
      title: "Doc overview",
      description: "The doc's title, fonts, dropdowns, and every tab in order with its id, title, depth, word count and outline (each heading's block id and text). Start here.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => guard(async () => json(await store.overview())),
  );

  server.registerTool(
    "format_guide",
    {
      title: "Doc format guide",
      description: "Every block and text mark a tab may use, and how to write docs that read well. Read once before writing.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => text(formatGuide()),
  );

  server.registerTool(
    "read_tab",
    {
      title: "Read a tab",
      description: "A tab's HTML (every block with its id), its version (pass it to edit_blocks or write_tab as expected_version) and any problems.",
      inputSchema: { id: TabId },
      annotations: { readOnlyHint: true },
    },
    ({ id }) => guard(async () => json(await store.readTab(id))),
  );

  server.registerTool(
    "edit_blocks",
    {
      title: "Edit blocks",
      description:
        'Change part of a tab, leaving the rest exactly as it is. Use it for every change short of rewriting a whole tab. Edits:\n' +
        '- {op:"replace_text", find, with, block?, nth?}: change words. `find` is html quoted exactly as read_tab shows it, inside one block (tags such as <b> included); it must appear once (or name the block, or pass nth). Best for rewording, fixing a figure, adding a link.\n' +
        '- {op:"replace", block, html}: rewrite whole blocks. The first new block keeps the old id, so comments stay.\n' +
        '- {op:"insert_after"|"insert_before", block, html}, {op:"append", html}: add blocks.\n' +
        '- {op:"delete", block}: remove a block.\n' +
        'html is one or more blocks. All edits land together, or none do. Example: {tab:"plan", edits:[{op:"replace_text", find:"ships in May", with:"ships in <b>June</b>"}, {op:"append", html:"<h2>Risks</h2><ul><li>Legal review runs long</li></ul>"}]}',
      inputSchema: {
        tab: TabId,
        edits: z
          .array(
            z.discriminatedUnion("op", [
              z.object({
                op: z.literal("replace_text"),
                find: z.string().min(1).max(20_000).describe("html exactly as read_tab shows it, within one block"),
                with: z.string().max(400_000).describe("the html to put in its place; may be empty"),
                block: BlockId.optional().describe("only look in this block"),
                nth: z.number().int().min(1).optional().describe("which match, when find appears more than once (1 is the first)"),
              }),
              z.object({ op: z.literal("replace"), block: BlockId, html: Html }),
              z.object({ op: z.literal("insert_after"), block: BlockId, html: Html }),
              z.object({ op: z.literal("insert_before"), block: BlockId, html: Html }),
              z.object({ op: z.literal("append"), html: Html }),
              z.object({ op: z.literal("delete"), block: BlockId }),
            ]),
          )
          .min(1)
          .max(50),
        expected_version: z.string().optional().describe("the version read_tab gave; refused if the tab changed since"),
      },
    },
    ({ tab, edits, expected_version }) =>
      guard(async () => {
        const r = await store.editBlocks(tab, edits as BlockEdit[], expected_version);
        return text(`${r.suggested ? SUGGESTED : ""}Saved tab "${tab}" (version ${r.version}, ${r.blocks} blocks).${r.changed.length ? ` New or replaced blocks: ${r.changed.join(", ")}.` : ""}`);
      }),
  );

  server.registerTool(
    "write_tab",
    {
      title: "Write a tab",
      description:
        'Create a tab, or replace one whole. html is exactly one <article id="<id>"> of blocks. A new tab goes after `after` (a tab id), or as the last child of `parent`, or at the end. title sets the tab\'s title. Refused, with line-numbered problems, if anything is outside the format.',
      inputSchema: {
        id: TabId,
        html: Html,
        title: z.string().max(200).optional(),
        after: TabId.optional(),
        parent: TabId.optional(),
        expected_version: z.string().optional().describe("the version read_tab gave; refused if the tab changed since"),
      },
    },
    ({ id, html, title, after, parent, expected_version }) =>
      guard(async () => {
        const r = await store.writeTab(id, html, { title, after, parent, expectedVersion: expected_version });
        const warn = r.warnings.length ? `\nWarnings (saved anyway):\n${describeProblems(r.warnings)}` : "";
        return text(`${r.suggested ? SUGGESTED : ""}${r.created ? "Created" : "Saved"} tab "${id}" (version ${r.version}, ${r.blocks.length} blocks).${warn}`);
      }),
  );

  server.registerTool(
    "check_tab",
    {
      title: "Check a tab",
      description: "Check tab HTML against the format without saving it.",
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
    "delete_tab",
    {
      title: "Delete a tab",
      description: "Delete a tab and every tab nested under it. A doc keeps at least one tab.",
      inputSchema: { id: TabId },
      annotations: { destructiveHint: true },
    },
    ({ id }) =>
      guard(async () => {
        const removed = await store.deleteTab(id);
        return text(`Deleted ${removed.join(", ")}.`);
      }),
  );

  server.registerTool(
    "read_comments",
    {
      title: "Read comments",
      description:
        "The comment threads people left on the doc: each thread's id, the tab and block it is on, the words it was left on (quote), and its comments in order (by user or assistant). Open threads only, unless include_resolved. Use it when asked to act on comments, feedback or review notes; then make the changes with edit_blocks and answer with comment.",
      inputSchema: { tab: TabId.optional().describe("only this tab's threads"), include_resolved: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ tab, include_resolved }) => guard(async () => json(await store.readComments(tab, include_resolved))),
  );

  server.registerTool(
    "comment",
    {
      title: "Comment",
      description:
        'Reply to a thread, or start one on a block, the way a reviewer would. Reply: {thread, text}. Start: {tab, block, quote?, text}, where quote is a few words exactly as they read in that block (plain text) and leaving it out comments on the whole block. resolve: true closes the thread; only resolve a thread a person wrote in when they asked you to. Use comments for questions and notes; make changes to the text with edit_blocks, not here. Example: {tab:"plan", block:"p-3", quote:"by June", text:"Is June firm? The risks tab says July."}',
      inputSchema: {
        thread: z.string().min(1).max(80).optional().describe("the thread to reply to (read_comments gives ids)"),
        tab: TabId.optional(),
        block: BlockId.optional(),
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
    "update_doc",
    {
      title: "Update doc settings",
      description:
        "Change the doc's title, fonts (headings and text: serif or sans), page width (wide), dropdowns (the full list), or tabs (titles, order and nesting: list every tab exactly once). Refused if a tab would break (e.g. it uses a dropdown option you removed).",
      inputSchema: {
        title: z.string().min(1).max(200).optional(),
        fonts: z.object({ headings: z.enum(FONT_CHOICES as [string, ...string[]]).optional(), text: z.enum(FONT_CHOICES as [string, ...string[]]).optional() }).optional(),
        wide: z.boolean().optional(),
        dropdowns: z
          .array(z.object({ id: z.string(), name: z.string(), options: z.array(z.object({ id: z.string(), label: z.string(), color: z.enum(OPTION_COLORS) })) }))
          .optional(),
        tabs: z.array(TabTreeSchema).optional(),
      },
      annotations: { idempotentHint: true },
    },
    ({ title, fonts, wide, dropdowns, tabs }) =>
      guard(async () => {
        const index = await store.updateDoc({ title, fonts: fonts as never, wide, dropdowns, tabs: tabs?.map(withChildren) });
        return json({ saved: true, title: index.title, fonts: index.fonts, wide: index.wide, dropdowns: index.dropdowns, tabs: index.tabs });
      }),
  );

  return server;
}
