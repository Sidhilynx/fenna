#!/usr/bin/env node
// A tiny MCP server over stdio for testing Fenna Crew's connectors: notes
// kept in one file. list_notes only reads; add_note changes the file;
// clear_notes deletes everything. It needs NOTES_TOKEN (a stand-in secret)
// and keeps its notes in NOTES_DIR. --many adds 60 more read-only tools with
// long names; --crash-after=N exits after N tool calls.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

if (!process.env.NOTES_TOKEN) {
  process.stderr.write("NOTES_TOKEN is not set. Give the notes server its token.\n");
  process.exit(1);
}
const dir = process.env.NOTES_DIR || process.cwd();
const file = path.join(dir, "notes.txt");
const crashAfter = Number(process.argv.find((a) => a.startsWith("--crash-after="))?.slice(14) || 0);
let calls = 0;
const counted = (fn) => async (...args) => {
  calls++;
  if (crashAfter && calls > crashAfter) process.exit(3);
  return fn(...args);
};
const text = (t) => ({ content: [{ type: "text", text: t }] });
const read = () => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : []);

const server = new McpServer({ name: "notes", version: "1.0.0" });
server.registerTool(
  "list_notes",
  { title: "List notes", description: "Lists every note, one per line.", inputSchema: {}, annotations: { readOnlyHint: true } },
  counted(async () => {
    const notes = read();
    return text(notes.length ? notes.map((n, i) => `${i + 1}. ${n}`).join("\n") : "No notes yet.");
  }),
);
server.registerTool(
  "add_note",
  { title: "Add a note", description: "Adds one note to the end of the list.", inputSchema: { text: z.string().min(1).max(500) }, annotations: { readOnlyHint: false, destructiveHint: false } },
  counted(async ({ text: note }) => {
    mkdirSync(dir, { recursive: true });
    appendFileSync(file, note.replace(/\s+/g, " ").trim() + "\n");
    return text(`Added. There are ${read().length} notes.`);
  }),
);
server.registerTool(
  "clear_notes",
  { title: "Clear all notes", description: "Deletes every note. Can't be undone.", inputSchema: {}, annotations: { destructiveHint: true } },
  counted(async () => {
    rmSync(file, { force: true });
    return text("Every note was deleted.");
  }),
);
if (process.argv.includes("--many")) {
  for (let i = 1; i <= 60; i++) {
    server.registerTool(
      `look_up_a_rather_long_named_record_number_${String(i).padStart(2, "0")}`,
      { description: `Looks up record ${i}. A long description that goes on to show how the list wraps and clamps when a connector has many tools with long names and long words.`, inputSchema: {}, annotations: { readOnlyHint: true } },
      counted(async () => text(`Record ${i}.`)),
    );
  }
}
await server.connect(new StdioServerTransport());
