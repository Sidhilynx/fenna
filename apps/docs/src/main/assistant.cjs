// Fenna Docs' profile for the shell's assistant host (@opendeck/shell/main):
// how the user's own AI reaches the open doc (Fenna Docs' MCP server), what it
// is told first, and plain words for each of Fenna Docs' tools.

const path = require("node:path");
const { app } = require("electron");

/** How a CLI starts our MCP server for the open doc: Electron's own Node runs it. */
function mcpServer(docRoot) {
  // Installed: the bundled server shipped with the app. Development: the TypeScript source.
  const args = app?.isPackaged
    ? [path.join(process.resourcesPath, "mcp", "fenna-docs-mcp.cjs"), `--doc=${docRoot}`]
    : ["--experimental-strip-types", path.join(__dirname, "..", "..", "..", "..", "packages", "doc-mcp", "src", "cli.ts"), `--doc=${docRoot}`];
  return { command: process.execPath, args, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

const note =
  "You are the assistant inside Fenna Docs, a document editor open on the user's screen. Work only through the Fenna Docs MCP tools: there is no shell, no files and no web here. Every change you make appears on their screen as you make it. Before the first time you write, call format_guide. To change part of a tab, use edit_blocks: replace_text for words you quote exactly, whole-block ops otherwise. Reply in short, plain sentences: say what you changed, not how the tools work. Never invent facts, figures, quotes or names; use [bracketed placeholders] and say so.";

/** One of Fenna Docs' tools as the user should read it in the chat. */
function toolLabel(tool, p) {
  switch (tool) {
    case "doc_overview":
      return "Looked at the doc";
    case "format_guide":
      return "Read the doc format";
    case "read_tab":
      return `Read “${p.id ?? "a tab"}”`;
    case "edit_blocks":
      return Array.isArray(p.edits) ? `Edited ${p.edits.length} block${p.edits.length === 1 ? "" : "s"}` : "Edited blocks";
    case "write_tab":
      return `Wrote tab “${p.title || p.id || ""}”`;
    case "check_tab":
      return "Checked a tab";
    case "delete_tab":
      return `Deleted tab “${p.id ?? ""}”`;
    case "update_doc":
      return "Updated doc settings";
    case "read_comments":
      return "Read the comments";
    case "comment":
      return p.thread ? (p.resolve ? "Replied and resolved a comment" : "Replied to a comment") : "Left a comment";
    default:
      return null;
  }
}

module.exports = { id: "fenna-docs", mcpServer, note, toolLabel };
