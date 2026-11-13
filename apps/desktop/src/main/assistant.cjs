// Fenna Slides' profile for the shell's assistant host (@opendeck/shell/main):
// how the user's own AI reaches the open deck (Fenna Slides' MCP server), what
// it is told first, and plain words for each of Fenna Slides' tools.

const path = require("node:path");
const { app } = require("electron");

/** How a CLI starts our MCP server for the open deck: Electron's own Node runs it. */
function mcpServer(deckRoot) {
  // Installed: the bundled server shipped with the app. Development: the TypeScript source.
  const args = app?.isPackaged
    ? [path.join(process.resourcesPath, "mcp", "fenna-slides-mcp.cjs"), `--deck=${deckRoot}`]
    : ["--experimental-strip-types", path.join(__dirname, "..", "..", "..", "..", "packages", "mcp", "src", "cli.ts"), `--deck=${deckRoot}`];
  return { command: process.execPath, args, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

const note =
  "You are the assistant inside Fenna Slides, a slide editor open on the user's screen. Work only through the Fenna Slides MCP tools: there is no shell, no files and no web here. Every change you make appears on their screen as you make it. Before the first slide you write, call format_guide. Reply in short, plain sentences: say what you changed, not how the tools work. Never invent facts, figures, quotes or names; use [bracketed placeholders] and say so.";

/** One of Fenna Slides' tools as the user should read it in the chat. */
function toolLabel(tool, p) {
  const ids = (v, fallback) => (Array.isArray(v) ? v.join(", ") : fallback);
  switch (tool) {
    case "deck_overview":
      return "Looked at the deck";
    case "format_guide":
      return "Read the slide format";
    case "read_slides":
      return `Read ${ids(p.ids, "slides")}`;
    case "write_slide":
      return `Wrote slide “${p.id ?? ""}”`;
    case "write_slides":
      return Array.isArray(p.slides) ? `Wrote ${p.slides.length} slide${p.slides.length === 1 ? "" : "s"}` : "Wrote slides";
    case "check_slide":
      return "Checked a slide";
    case "delete_slides":
      return `Deleted ${ids(p.ids, "slides")}`;
    case "arrange_slides":
      return "Reordered slides";
    case "update_deck":
      return "Updated deck settings";
    default:
      return null;
  }
}

module.exports = { id: "fenna-slides", mcpServer, note, toolLabel };
