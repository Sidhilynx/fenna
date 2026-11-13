// The MCP server. Any MCP client (Claude Code, Codex, Antigravity, a local
// model's runner) gets the same tools; nothing here is tied to one provider.
//
// The tools follow the shape of a file editor: read a slide as the HTML on
// disk, change it by quoting exact text, or write it whole. Every write is
// checked against the format and refused with line-numbered problems.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Diagnostic } from "@opendeck/format";
import { INSTRUCTIONS, formatGuide } from "./guide.ts";
import { DeckStore, StoreError } from "./store.ts";

export { DeckStore, StoreError, versionOf } from "./store.ts";
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

const SlideId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/).describe("a slide id: a letter, then letters, digits, - or _");
const Html = z.string().min(1).max(400_000);
const Version = z.string().optional().describe("the version read_slides gave; refused if the slide changed since");

export function createServer(root: string): McpServer {
  const store = new DeckStore(root);
  const server = new McpServer({ name: "fenna-slides", version: "0.9.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "deck_overview",
    {
      title: "Deck overview",
      description:
        "Start here. The deck's title, theme (colors, fonts, text styles), sections, and every slide in order with its id, title, open comment count and problem counts.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guard(async () => {
        const { deck, slides } = await store.summaries();
        const open = await store.openComments();
        return json({
          title: deck.index.title,
          canvas: "1920x1080",
          theme: deck.index.theme,
          sections: deck.index.sections,
          slides: slides.map((s) => ({ ...s, comments: open[s.id] ?? 0 })),
          problems: deck.problems,
        });
      }),
  );

  server.registerTool(
    "format_guide",
    {
      title: "Slide format guide",
      description: "Every element and style property a slide may use, and how to design slides that read well. Read it once before your first write.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => text(formatGuide()),
  );

  server.registerTool(
    "read_slides",
    {
      title: "Read slides",
      description:
        "Up to 10 slides, each as the exact HTML in its file, with its version (pass it back as expected_version) and any problems. Read a slide before you change it; quote edit_slide's `find` from this text.",
      inputSchema: { ids: z.array(SlideId).min(1).max(10) },
      annotations: { readOnlyHint: true },
    },
    ({ ids }) =>
      guard(async () => {
        const parts: string[] = [];
        for (const id of ids) {
          const r = await store.readSlide(id);
          const problems = r.diagnostics.length ? `\nProblems:\n${describeProblems(r.diagnostics)}` : "";
          parts.push(`=== slide "${id}" (version ${r.version}) ===\n${r.html.trimEnd()}${problems}`);
        }
        return text(parts.join("\n\n"));
      }),
  );

  server.registerTool(
    "edit_slide",
    {
      title: "Edit a slide",
      description:
        "Change part of one slide and leave the rest exactly as it is. Use it for every change short of redesigning a slide: rewording, a color, a size, adding or removing one element, speaker notes. " +
        "Each edit replaces `find` (copied exactly from read_slides, tags and attributes included; it must appear once, or pass nth) with `with`. Edits apply in order and land together, or none do. " +
        'Example: {id:"plan", edits:[{find:"ships in May", with:"ships in June"}, {find:"font-size:28px", with:"font-size:32px", nth:2}]}',
      inputSchema: {
        id: SlideId,
        edits: z
          .array(
            z.object({
              find: z.string().min(1).max(100_000).describe("text exactly as read_slides shows it"),
              with: z.string().max(400_000).describe("what to put in its place; may be empty"),
              nth: z.number().int().min(1).optional().describe("which match, when find appears more than once (1 is the first)"),
            }),
          )
          .min(1)
          .max(50),
        expected_version: Version,
      },
    },
    ({ id, edits, expected_version }) =>
      guard(async () => {
        const r = await store.editSlide(id, edits, expected_version);
        return text(`Saved slide "${id}" (version ${r.version}).${warningsNote(r.warnings)}`);
      }),
  );

  server.registerTool(
    "write_slide",
    {
      title: "Write a slide",
      description:
        'Create a slide, or replace one whole. html is exactly one <section id="<id>"> in the slide format. A new id goes after `after` (a slide id, or "start"; default: the end). To change part of an existing slide, use edit_slide instead.',
      inputSchema: {
        id: SlideId,
        html: Html,
        after: z.string().optional(),
        expected_version: Version,
      },
    },
    ({ id, html, after, expected_version }) =>
      guard(async () => {
        const r = await store.writeSlide(id, html, { after, expectedVersion: expected_version });
        return text(`${r.created ? "Created" : "Saved"} slide "${id}" (version ${r.version}).${warningsNote(r.warnings)}`);
      }),
  );

  server.registerTool(
    "write_slides",
    {
      title: "Write several slides",
      description:
        "Create or replace up to 12 slides in one call; use it to build a deck. Each item is {id, html, after?}; new slides go in the order given, each after the previous new one unless `after` says otherwise. Each slide is checked on its own: the valid ones are saved, the others come back with their problems.",
      inputSchema: {
        slides: z.array(z.object({ id: SlideId, html: Html, after: z.string().optional() })).min(1).max(12),
      },
    },
    ({ slides }) =>
      guard(async () => {
        const lines: string[] = [];
        let prev: string | undefined;
        let failed = 0;
        for (const s of slides) {
          try {
            const r = await store.writeSlide(s.id, s.html, { after: s.after ?? prev });
            prev = s.id;
            lines.push(`${r.created ? "Created" : "Saved"} "${s.id}"${r.warnings.length ? ` (warnings: ${r.warnings.map((w) => w.message).join("; ")})` : ""}`);
          } catch (e) {
            if (!(e instanceof StoreError)) throw e;
            failed++;
            lines.push(`NOT saved "${s.id}": ${e.message}${e.diagnostics.length ? `\n${describeProblems(e.diagnostics)}` : ""}`);
          }
        }
        return { ...text(lines.join("\n")), ...(failed === slides.length ? { isError: true } : {}) };
      }),
  );

  server.registerTool(
    "check_slide",
    {
      title: "Check a slide",
      description: "Check slide HTML against the format without saving it: the same problems and warnings a write would give.",
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
    "delete_slides",
    {
      title: "Delete slides",
      description: "Delete slides by id. Sections that started on them move to the next slide. Only when the user asked for it.",
      inputSchema: { ids: z.array(SlideId).min(1).max(100) },
      annotations: { destructiveHint: true },
    },
    ({ ids }) =>
      guard(async () => {
        await store.deleteSlides(ids);
        return text(`Deleted ${ids.length} slide${ids.length === 1 ? "" : "s"}.`);
      }),
  );

  server.registerTool(
    "arrange_slides",
    {
      title: "Reorder slides",
      description: "Set the slide order. List every slide id exactly once (deck_overview gives them).",
      inputSchema: { order: z.array(SlideId).min(1).max(500) },
      annotations: { idempotentHint: true },
    },
    ({ order }) =>
      guard(async () => {
        await store.arrange(order);
        return text("Reordered.");
      }),
  );

  server.registerTool(
    "read_comments",
    {
      title: "Read comments",
      description:
        "The comment threads people left on the deck, in slide order: each thread's id, its slide, the element it is on (its tag and words), and its comments in order (by user or assistant). Open threads only, unless include_resolved. Use it when asked to act on comments, feedback or review notes; make the changes with edit_slide, then answer each thread with comment.",
      inputSchema: { slide: SlideId.optional().describe("only this slide's threads"), include_resolved: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ slide, include_resolved }) => guard(async () => json(await store.readComments(slide, include_resolved))),
  );

  server.registerTool(
    "comment",
    {
      title: "Comment",
      description:
        'Reply to a thread, or start one on a slide, the way a reviewer would. Reply: {thread, text}. Start: {slide, quote?, text}, where quote is a few words of one element as they read on the slide (plain text); leave it out to comment on the whole slide. resolve: true closes the thread; only resolve a thread a person wrote in when they asked you to. Comments are for questions and notes; change the slide with edit_slide. Example: {slide:"roadmap", quote:"Fourth", text:"Is the fourth tool still planned for this year?"}',
      inputSchema: {
        thread: z.string().min(1).max(80).optional().describe("the thread to reply to (read_comments gives ids)"),
        slide: SlideId.optional(),
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
    "update_deck",
    {
      title: "Update deck settings",
      description:
        "Change the deck's title, sections or theme. sections is the full list, each {title, start: the id of its first slide}. theme.colors / theme.fonts / theme.textStyles each replace that part whole (send the full map). Refused if a slide would break (e.g. it uses a color you removed).",
      inputSchema: {
        title: z.string().min(1).max(200).optional(),
        sections: z.array(z.object({ title: z.string().max(200), start: SlideId })).optional(),
        theme: z
          .object({
            colors: z.record(z.string(), z.string()).optional(),
            fonts: z.array(z.object({ family: z.string(), source: z.string(), weights: z.array(z.number()).optional() })).optional(),
            textStyles: z.record(z.string(), z.string()).optional(),
          })
          .optional(),
      },
      annotations: { idempotentHint: true },
    },
    (patch) =>
      guard(async () => {
        const index = await store.updateDeck(patch);
        return json({ saved: true, title: index.title, sections: index.sections, theme: index.theme });
      }),
  );

  return server;
}
