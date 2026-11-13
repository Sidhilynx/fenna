// Fenna Sheets' profile for the shell's assistant host (@opendeck/shell/main).

const path = require("node:path");
const { app } = require("electron");

function mcpServer(sheetRoot) {
  const args = app?.isPackaged
    ? [path.join(process.resourcesPath, "mcp", "fenna-sheets-mcp.cjs"), `--sheet=${sheetRoot}`]
    : ["--experimental-strip-types", path.join(__dirname, "..", "..", "..", "..", "packages", "sheet-mcp", "src", "cli.ts"), `--sheet=${sheetRoot}`];
  return { command: process.execPath, args, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

const note =
  "You are the assistant inside Fenna Sheets, a spreadsheet open on the user's screen. Work only through the Fenna Sheets tools: there is no shell, no files and no web here. Every change you save appears on their screen as you make it. The context says which sheet and cells they have selected; \"this\" means that selection. Use real formulas for anything computed. Reply in short, plain sentences saying what you changed.";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function toolLabel(tool, p) {
  switch (tool) {
    case "workbook_overview":
      return "Looked at the workbook";
    case "format_guide":
      return "Read the sheet format";
    case "read_range":
      return p.range ? `Read ${p.range}` : "Read the sheet";
    case "find":
      return `Searched for “${String(p.query ?? "").slice(0, 40)}”`;
    case "write_cells": {
      const n = (p.cells && typeof p.cells === "object" ? Object.keys(p.cells).length : 0) + (Array.isArray(p.rows?.values) ? p.rows.values.reduce((a, r) => a + (Array.isArray(r) ? r.length : 0), 0) : 0);
      return n ? `Wrote ${plural(n, "cell")}` : "Wrote cells";
    }
    case "format_cells":
      return Array.isArray(p.ranges) ? `Formatted ${p.ranges.join(", ").slice(0, 60)}` : "Formatted cells";
    case "clear_cells":
      return `Cleared ${p.range ?? "cells"}`;
    case "edit_structure":
      return Array.isArray(p.ops) && p.ops.length === 1 ? `Edited the sheet (${String(p.ops[0].op).replace(/_/g, " ")})` : "Edited the sheet";
    case "manage_rules":
      return "Updated conditional formatting";
    case "manage_charts":
      return "Updated charts";
    case "add_sheet":
      return `Added sheet “${p.title ?? ""}”`;
    case "delete_sheet":
      return `Deleted sheet “${p.sheet ?? ""}”`;
    case "update_workbook":
      return "Changed workbook settings";
    case "read_comments":
      return "Read the comments";
    case "comment":
      return p.thread ? "Replied to a comment" : "Left a comment";
    default:
      return null;
  }
}

module.exports = { id: "fenna-sheets", mcpServer, note, toolLabel };
