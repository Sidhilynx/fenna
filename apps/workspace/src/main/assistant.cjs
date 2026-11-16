// Fenna Workspace profile for the shell's assistant host (@opendeck/shell/main):
// how the user's own AI reaches the open workspace (Fenna Workspace unified MCP server),
// what it is told first, and plain words for each of Fenna Workspace's tools.

const path = require("node:path");
const { app } = require("electron");

/** How a CLI starts our MCP server for the open workspace / document: Electron's own Node runs it. */
function mcpServer(workspaceRoot) {
  // Installed: the bundled server shipped with the app. Development: the TypeScript source.
  const args = app?.isPackaged
    ? [path.join(process.resourcesPath, "mcp", "fenna-workspace-mcp.cjs"), `--workspace=${workspaceRoot}`]
    : ["--experimental-strip-types", path.join(__dirname, "..", "..", "..", "..", "packages", "workspace-mcp", "src", "cli.ts"), `--workspace=${workspaceRoot}`];
  return { command: process.execPath, args, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

const note =
  "You are the assistant inside Fenna Workspace, an all-in-one office workspace open on the user's screen. Work only through the Fenna Workspace MCP tools: read, edit, and create Slides, Docs, Sheets, Whiteboards, and Designs. Start by calling workspace_overview. Reply in short, plain sentences: say what you changed, not how the tools work. Never invent facts, figures, quotes or names; use [bracketed placeholders] and say so.";

/** One of Fenna Workspace's tools as the user should read it in the chat. */
function toolLabel(tool, p = {}) {
  switch (tool) {
    case "workspace_overview":
      return "Looked at the workspace";
    case "workspace_guide":
      return "Read workspace guide";
    case "deck_overview":
      return "Looked at the deck";
    case "format_guide":
      return "Read the format guide";
    case "read_slides":
      return `Read ${Array.isArray(p.ids) ? p.ids.join(", ") : "slides"}`;
    case "write_slide":
      return `Wrote slide “${p.id ?? ""}”`;
    case "edit_slide":
      return "Edited a slide";
    case "doc_overview":
      return "Looked at the doc";
    case "read_tab":
      return `Read “${p.id ?? "tab"}”`;
    case "write_tab":
      return `Wrote tab “${p.title || p.id || ""}”`;
    case "edit_blocks":
      return Array.isArray(p.edits) ? `Edited ${p.edits.length} block${p.edits.length === 1 ? "" : "s"}` : "Edited blocks";
    case "sheet_overview":
      return "Looked at the sheet";
    case "read_range":
      return `Read range ${p.range ?? ""}`;
    case "write_cells":
      return "Wrote cells to the sheet";
    case "board_overview":
      return "Looked at the whiteboard";
    case "read_board":
      return "Read the whiteboard";
    case "add_board_items":
      return "Added items to the whiteboard";
    case "design_overview":
      return "Looked at the design canvas";
    case "read_artboard":
      return `Read artboard “${p.name || p.file || ""}”`;
    case "write_artboard":
      return `Saved artboard “${p.name || p.file || ""}”`;
    case "edit_artboard":
      return `Edited artboard “${p.name || p.file || ""}”`;
    default:
      return null;
  }
}

module.exports = { id: "fenna-workspace", mcpServer, note, toolLabel };
