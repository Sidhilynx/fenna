// Fenna Whiteboard's profile for the shell's assistant host (@opendeck/shell/main).

const path = require("node:path");
const { app } = require("electron");

function mcpServer(boardRoot) {
  const args = app?.isPackaged
    ? [path.join(process.resourcesPath, "mcp", "fenna-whiteboard-mcp.cjs"), `--board=${boardRoot}`]
    : ["--experimental-strip-types", path.join(__dirname, "..", "..", "..", "..", "packages", "board-mcp", "src", "cli.ts"), `--board=${boardRoot}`];
  return { command: process.execPath, args, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

const note =
  "You are the assistant inside Fenna Whiteboard, a whiteboard open on the user's screen. Work only through the Fenna Whiteboard tools: there is no shell, no files and no web here. Every change you save appears on their screen as you make it. The context says which items they have selected; \"this\" means that selection. Leave x and y out to have items placed for you, and fix anything a result asks you to check. Reply in short, plain sentences saying what you changed.";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const count = (list, word) => plural(Array.isArray(list) ? list.length : 1, word);

function toolLabel(tool, p) {
  switch (tool) {
    case "read_board":
      return "Read the board";
    case "add_items":
      return `Added ${count(p.items, "item")}`;
    case "edit_items":
      return `Changed ${count(p.items, "item")}`;
    case "delete_items":
      return `Deleted ${count(p.ids, "item")}`;
    case "arrange":
      return p.layout === "flow" ? "Laid out the diagram" : "Arranged items";
    case "read_comments":
      return "Read the comments";
    case "comment":
      return p.thread ? "Replied to a comment" : "Left a comment";
    case "rename_board":
      return "Renamed the board";
    case "format_guide":
      return "Read the format guide";
    default:
      return null;
  }
}

module.exports = { id: "fenna-whiteboard", mcpServer, note, toolLabel };
