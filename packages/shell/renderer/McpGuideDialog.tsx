// Modal dialog showing clients how to connect external AI tools (Claude Desktop,
// Cursor, Antigravity, Claude Code) to Fenna's MCP server for the open document.

import { useState } from "react";
import { Dialog } from "./ui/Dialog.tsx";
import { Icon } from "./ui/icons.tsx";
import "./mcp-guide.css";

export interface McpAppDef {
  noun: string;
  nouns: string;
  appName: string;
  id: string;
  cli: string;
  flag: string;
  description: string;
  tools: Array<{ name: string; description: string }>;
}

export const MCP_APPS: Record<string, McpAppDef> = {
  deck: {
    noun: "deck",
    nouns: "decks",
    appName: "Fenna Slides",
    id: "fenna-slides",
    cli: "fenna-slides-mcp",
    flag: "deck",
    description: "Read, edit, format and arrange slide decks directly on your computer.",
    tools: [
      { name: "deck_overview", description: "Title, dimensions, theme colors, font families, sections, and slide status" },
      { name: "format_guide", description: "Complete syntax guide for slide elements, shapes, styles, and layout properties" },
      { name: "read_slides", description: "Read full HTML markup and structure of requested slides" },
      { name: "write_slide", description: "Create or replace an individual slide with formatted HTML" },
      { name: "write_slides", description: "Batch write multiple slides atomically" },
      { name: "check_slide", description: "Lint and validate slide markup for layout and schema errors without saving" },
      { name: "delete_slides", description: "Delete slides from the deck by ID" },
      { name: "arrange_slides", description: "Reorder slides in the deck" },
      { name: "update_deck", description: "Update deck title, theme colors, and fonts" },
    ],
  },
  doc: {
    noun: "doc",
    nouns: "docs",
    appName: "Fenna Docs",
    id: "fenna-docs",
    cli: "fenna-docs-mcp",
    flag: "doc",
    description: "Read, edit, draft and review document tabs and content blocks.",
    tools: [
      { name: "doc_overview", description: "Document title, tabs, word count, and section layout" },
      { name: "format_guide", description: "Syntax guide for doc blocks (headings, lists, quotes, code, tables)" },
      { name: "read_tab", description: "Read a tab's title, text, and formatted blocks" },
      { name: "edit_blocks", description: "Insert, replace exact text, or modify blocks in a tab" },
      { name: "write_tab", description: "Create or overwrite an entire tab" },
      { name: "check_tab", description: "Validate tab content against schema without saving" },
      { name: "delete_tab", description: "Remove a tab from the document" },
      { name: "update_doc", description: "Update document title, properties, and layout" },
      { name: "read_comments", description: "Read review threads and feedback comments" },
      { name: "comment", description: "Add a comment, or reply and resolve a thread" },
    ],
  },
  sheet: {
    noun: "sheet",
    nouns: "sheets",
    appName: "Fenna Sheets",
    id: "fenna-sheets",
    cli: "fenna-sheets-mcp",
    flag: "sheet",
    description: "Read, compute, format and edit spreadsheet tables, formulas, and cells.",
    tools: [
      { name: "sheet_overview", description: "Workbook sheets, grid dimensions, named ranges, and rules" },
      { name: "format_guide", description: "Guide for formulas, cell styles, number formats, and conditional rules" },
      { name: "read_sheet", description: "Read cell values, calculated results, formulas, and styling" },
      { name: "edit_cells", description: "Set values, formulas, and formatting for cells and ranges" },
      { name: "add_sheet", description: "Create a new worksheet tab in the workbook" },
      { name: "delete_sheet", description: "Remove a worksheet tab" },
      { name: "rename_sheet", description: "Rename a worksheet tab" },
      { name: "read_comments", description: "Read comments left on cells" },
      { name: "comment", description: "Leave a comment or reply on cell ranges" },
    ],
  },
  board: {
    noun: "board",
    nouns: "boards",
    appName: "Fenna Whiteboard",
    id: "fenna-whiteboard",
    cli: "fenna-whiteboard-mcp",
    flag: "board",
    description: "Read, arrange, create and edit infinite canvas diagrams, sticky notes, and cards.",
    tools: [
      { name: "read_board", description: "Read frames, sticky notes, cards, text, shapes, connectors, and health" },
      { name: "format_guide", description: "Guide for shapes, colors, connectors, and frame schemas" },
      { name: "add_items", description: "Add sticky notes, cards, shapes, frames, and arrows atomically" },
      { name: "edit_items", description: "Move, resize, recolor, or modify text on items by ID" },
      { name: "delete_items", description: "Remove items by ID" },
      { name: "arrange", description: "Auto-layout items into grid, row, column, or flow" },
      { name: "read_comments", description: "Read review threads on items" },
      { name: "comment", description: "Add or resolve comments" },
      { name: "rename_board", description: "Update the whiteboard's title" },
    ],
  },
  design: {
    noun: "design",
    nouns: "designs",
    appName: "Fenna Design",
    id: "fenna-design",
    cli: "fenna-design-mcp",
    flag: "design",
    description: "Read, arrange, design and modify artboards, layouts, styles, and HTML screens.",
    tools: [
      { name: "design_overview", description: "Design pages, artboards with positions and dimensions, tweaks, styles" },
      { name: "format_guide", description: "Guide for artboard HTML, CSS properties, components, and layout" },
      { name: "read_artboards", description: "Read an artboard's HTML markup and version" },
      { name: "edit_artboard", description: "Replace exact text or markup in an artboard" },
      { name: "write_artboard", description: "Create a new artboard or replace one completely" },
      { name: "check_artboard", description: "Validate artboard HTML without saving" },
      { name: "delete_artboards", description: "Remove artboards by ID" },
      { name: "arrange_artboards", description: "Move, resize, rename, re-page, or reorder artboards" },
      { name: "read_comments", description: "Read design comments and review threads" },
      { name: "comment", description: "Add or reply to comments on artboards or layers" },
      { name: "update_design", description: "Update design tokens, tweaks, and typography" },
    ],
  },
  workspace: {
    noun: "workspace",
    nouns: "workspaces",
    appName: "Fenna Workspace",
    id: "fenna-workspace",
    cli: "fenna-workspace-mcp",
    flag: "workspace",
    description: "Read, edit, format and analyze Slides, Docs, Sheets, Whiteboards, and Designs through one unified connection.",
    tools: [
      { name: "workspace_overview", description: "Discover all documents in the workspace" },
      { name: "format_guide", description: "Format guide across all five Fenna products" },
      { name: "deck_overview", description: "Read slide deck outline, theme, and slides" },
      { name: "read_slides", description: "Read slide HTML from a deck" },
      { name: "write_slide", description: "Create or replace a slide in a deck" },
      { name: "doc_overview", description: "Read document tabs, outline, and hierarchy" },
      { name: "read_tab", description: "Read document tab HTML" },
      { name: "write_tab", description: "Create or replace a document tab" },
      { name: "sheet_overview", description: "Read sheet tabs, dimensions, and overview" },
      { name: "read_range", description: "Read cell values and formulas from a sheet" },
      { name: "write_cells", description: "Write values and formulas into a sheet" },
      { name: "board_overview", description: "Read whiteboard item count and layout" },
      { name: "read_board", description: "Read whiteboard sticky notes, shapes, and frames" },
      { name: "add_board_items", description: "Add items to a whiteboard" },
      { name: "design_overview", description: "Read artboards and pages from a design" },
      { name: "read_artboard", description: "Read artboard HTML" },
      { name: "write_artboard", description: "Create or replace an artboard" },
    ],
  },
};

type ClientKind = "claude" | "cursor" | "antigravity" | "claudecode" | "tools";

export interface McpGuideDialogProps {
  open: boolean;
  onClose(): void;
  noun: string;
  docPath?: string | null;
}

export function McpGuideDialog({ open, onClose, noun, docPath }: McpGuideDialogProps) {
  const [selectedApp, setSelectedApp] = useState<string>(noun in MCP_APPS ? noun : "deck");
  const [client, setClient] = useState<ClientKind>("claude");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!open) return null;

  const appDef = MCP_APPS[selectedApp] ?? MCP_APPS.deck!;
  const targetFolder = docPath ? docPath : `<path-to-your-${appDef.noun}>`;

  const copy = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((k) => (k === key ? null : k));
    }, 2000);
  };

  const claudeDesktopJson = JSON.stringify(
    {
      mcpServers: {
        [appDef.id]: {
          command: "npx",
          args: ["-y", appDef.cli, `--${appDef.flag}=${targetFolder}`],
        },
      },
    },
    null,
    2,
  );

  const cursorJson = JSON.stringify(
    {
      mcpServers: {
        [appDef.id]: {
          command: "npx",
          args: ["-y", appDef.cli, `--${appDef.flag}=${targetFolder}`],
        },
      },
    },
    null,
    2,
  );

  const antigravityJson = JSON.stringify(
    {
      mcpServers: {
        [appDef.id]: {
          command: "npx",
          args: ["-y", appDef.cli, `--${appDef.flag}=${targetFolder}`],
        },
      },
    },
    null,
    2,
  );

  const claudeCodeCmd = `claude mcp add ${appDef.id} -- npx -y ${appDef.cli} --${appDef.flag}="${targetFolder}"`;

  return (
    <Dialog title="MCP Setup Guide" onClose={onClose} width={640}>
      <div className="mcp-guide">
        <header className="mcp-hero">
          <h3 className="mcp-hero-title">
            <span>{appDef.appName}</span>
            <span className="mcp-badge">{appDef.id}</span>
          </h3>
          <p className="mcp-hero-sub">
            Any AI client that speaks the Model Context Protocol (MCP) can read and edit your open {appDef.noun} directly on this machine.
          </p>
        </header>

        {docPath ? (
          <div className="mcp-folder-card">
            <span className="mcp-folder-icon">
              <Icon name="folder" size={16} />
            </span>
            <div className="mcp-folder-info">
              <span className="mcp-folder-label">Open {appDef.noun} Folder</span>
              <span className="mcp-folder-path" title={docPath}>
                {docPath}
              </span>
            </div>
            <button
              type="button"
              className={`mcp-copy-btn${copiedKey === "folder" ? " copied" : ""}`}
              onClick={() => copy("folder", docPath)}
            >
              <Icon name={copiedKey === "folder" ? "check" : "copy"} size={13} />
              <span>{copiedKey === "folder" ? "Copied" : "Copy"}</span>
            </button>
          </div>
        ) : (
          <div className="mcp-apps">
            {Object.keys(MCP_APPS).map((k) => (
              <button
                key={k}
                type="button"
                className={`mcp-app-pill${selectedApp === k ? " active" : ""}`}
                onClick={() => setSelectedApp(k)}
              >
                {MCP_APPS[k]!.appName}
              </button>
            ))}
          </div>
        )}

        <nav className="mcp-tabs" role="tablist" aria-label="MCP Client Options">
          <button
            type="button"
            role="tab"
            aria-selected={client === "claude"}
            className={`mcp-tab${client === "claude" ? " active" : ""}`}
            onClick={() => setClient("claude")}
          >
            Claude Desktop
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={client === "cursor"}
            className={`mcp-tab${client === "cursor" ? " active" : ""}`}
            onClick={() => setClient("cursor")}
          >
            Cursor
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={client === "antigravity"}
            className={`mcp-tab${client === "antigravity" ? " active" : ""}`}
            onClick={() => setClient("antigravity")}
          >
            Antigravity
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={client === "claudecode"}
            className={`mcp-tab${client === "claudecode" ? " active" : ""}`}
            onClick={() => setClient("claudecode")}
          >
            Claude Code
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={client === "tools"}
            className={`mcp-tab${client === "tools" ? " active" : ""}`}
            onClick={() => setClient("tools")}
          >
            Tools ({appDef.tools.length})
          </button>
        </nav>

        {client === "claude" && (
          <div className="mcp-body">
            <ol className="mcp-steps">
              <li>Open your Claude Desktop configuration file.</li>
              <li>Add the server block inside <code>mcpServers</code>:</li>
            </ol>
            <div className="mcp-path-hint">
              <span>Config location:</span>
              <code>%APPDATA%\Claude\claude_desktop_config.json</code>
            </div>
            <div className="mcp-code-block">
              <div className="mcp-code-head">
                <code>claude_desktop_config.json</code>
                <button
                  type="button"
                  className={`mcp-copy-btn${copiedKey === "claude" ? " copied" : ""}`}
                  onClick={() => copy("claude", claudeDesktopJson)}
                >
                  <Icon name={copiedKey === "claude" ? "check" : "copy"} size={13} />
                  <span>{copiedKey === "claude" ? "Copied" : "Copy config"}</span>
                </button>
              </div>
              <pre>
                <code>{claudeDesktopJson}</code>
              </pre>
            </div>
            <ol className="mcp-steps" start={3}>
              <li>Restart Claude Desktop. The hammer icon will show the {appDef.appName} tools.</li>
            </ol>
          </div>
        )}

        {client === "cursor" && (
          <div className="mcp-body">
            <ol className="mcp-steps">
              <li>In Cursor, open <strong>Cursor Settings &gt; Features &gt; MCP</strong> (or <code>.cursor/mcp.json</code>).</li>
              <li>Paste the configuration block:</li>
            </ol>
            <div className="mcp-code-block">
              <div className="mcp-code-head">
                <code>.cursor/mcp.json</code>
                <button
                  type="button"
                  className={`mcp-copy-btn${copiedKey === "cursor" ? " copied" : ""}`}
                  onClick={() => copy("cursor", cursorJson)}
                >
                  <Icon name={copiedKey === "cursor" ? "check" : "copy"} size={13} />
                  <span>{copiedKey === "cursor" ? "Copied" : "Copy config"}</span>
                </button>
              </div>
              <pre>
                <code>{cursorJson}</code>
              </pre>
            </div>
            <ol className="mcp-steps" start={3}>
              <li>Click <strong>Connect</strong> or reload Cursor. The agent can now edit your {appDef.noun}.</li>
            </ol>
          </div>
        )}

        {client === "antigravity" && (
          <div className="mcp-body">
            <ol className="mcp-steps">
              <li>Open your Antigravity MCP configuration file:</li>
            </ol>
            <div className="mcp-path-hint">
              <span>Config location:</span>
              <code>~/.gemini/config/mcp_config.json</code>
            </div>
            <div className="mcp-code-block">
              <div className="mcp-code-head">
                <code>mcp_config.json</code>
                <button
                  type="button"
                  className={`mcp-copy-btn${copiedKey === "antigravity" ? " copied" : ""}`}
                  onClick={() => copy("antigravity", antigravityJson)}
                >
                  <Icon name={copiedKey === "antigravity" ? "check" : "copy"} size={13} />
                  <span>{copiedKey === "antigravity" ? "Copied" : "Copy config"}</span>
                </button>
              </div>
              <pre>
                <code>{antigravityJson}</code>
              </pre>
            </div>
            <ol className="mcp-steps" start={2}>
              <li>Run your turn in Antigravity. It calls {appDef.id} tools to read and update your file.</li>
            </ol>
          </div>
        )}

        {client === "claudecode" && (
          <div className="mcp-body">
            <ol className="mcp-steps">
              <li>Run this single command in your terminal:</li>
            </ol>
            <div className="mcp-code-block">
              <div className="mcp-code-head">
                <span>Terminal CLI</span>
                <button
                  type="button"
                  className={`mcp-copy-btn${copiedKey === "claudecode" ? " copied" : ""}`}
                  onClick={() => copy("claudecode", claudeCodeCmd)}
                >
                  <Icon name={copiedKey === "claudecode" ? "check" : "copy"} size={13} />
                  <span>{copiedKey === "claudecode" ? "Copied" : "Copy command"}</span>
                </button>
              </div>
              <pre>
                <code>{claudeCodeCmd}</code>
              </pre>
            </div>
            <ol className="mcp-steps" start={2}>
              <li>Start <code>claude</code> in that directory and prompt it freely.</li>
            </ol>
          </div>
        )}

        {client === "tools" && (
          <div className="mcp-tools-wrap">
            <table className="mcp-tools-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {appDef.tools.map((t) => (
                  <tr key={t.name}>
                    <td>
                      <span className="mcp-tool-name">{t.name}</span>
                    </td>
                    <td>{t.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <footer className="mcp-foot">
          <span className="mcp-foot-note">
            <Icon name="sparkle" size={14} />
            <span>Local stdio only · Files stay on your machine · Live updates on screen</span>
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
