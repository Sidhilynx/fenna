# @opendeck/workspace-mcp

The Fenna Workspace unified MCP server: any AI client (Antigravity, Claude Desktop, Cursor, Claude Code) can connect over MCP (stdio) to read and edit all five Fenna formats — Slides, Docs, Sheets, Whiteboards, and Designs — through a single unified connection.

## CLI Usage

```bash
# Connect to a workspace folder with multiple documents
npx fenna-workspace-mcp --workspace ./my-workspace

# Or connect directly to any single document folder
npx fenna-workspace-mcp --path ./examples/sample-doc
```
