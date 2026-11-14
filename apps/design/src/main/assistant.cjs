// Fenna Design's profile for the shell's assistant host (@opendeck/shell/main).

const path = require("node:path");
const { app } = require("electron");

function mcpServer(designRoot) {
  const args = app?.isPackaged
    ? [path.join(process.resourcesPath, "mcp", "fenna-design-mcp.cjs"), `--design=${designRoot}`]
    : ["--experimental-strip-types", path.join(__dirname, "..", "..", "..", "..", "packages", "artboard-mcp", "src", "cli.ts"), `--design=${designRoot}`];
  return { command: process.execPath, args, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

const note =
  "You are the assistant inside Fenna Design, an artboard canvas open on the user's screen. Work only through the Fenna Design tools: there is no shell, no files and no web here. Every change you save appears on their screen as you make it. The context says which artboard or element they have selected; \"this\" means that selection. Reply in short, plain sentences saying what you changed.";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const count = (list, word) => plural(Array.isArray(list) ? list.length : 1, word);

function toolLabel(tool, p = {}) {
  switch (tool) {
    case "design_overview":
      return "Read the design overview";
    case "format_guide":
      return "Read the design format guide";
    case "read_artboards":
      return `Read ${count(p.files, "artboard")}`;
    case "edit_artboard":
      return `Edited artboard ${p.file || "artboard"}`;
    case "write_artboard":
      return `Saved artboard ${p.file || "artboard"}`;
    case "check_artboard":
      return `Checked artboard ${p.file || "artboard"}`;
    case "delete_artboards":
      return `Deleted ${count(p.files, "artboard")}`;
    case "arrange_artboards":
      return "Arranged artboards";
    case "read_comments":
      return "Read the comments";
    case "comment":
      return p.thread ? "Replied to a comment" : "Left a comment";
    case "update_design":
      return "Updated design settings";
    default:
      return null;
  }
}

module.exports = { id: "fenna-design", mcpServer, note, toolLabel };

