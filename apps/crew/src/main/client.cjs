// The MCP client the app starts connectors with (packages/crew-mcp,
// client.ts). From source in development; the packaged app carries it
// bundled beside the MCP servers (scripts/build-mcp.mjs).

const path = require("node:path");
const electron = require("electron");

const packaged = typeof electron === "object" && electron.app && electron.app.isPackaged;

module.exports = packaged ? require(path.join(process.resourcesPath, "mcp", "crew-client.cjs")) : require("@opendeck/crew-mcp/client");
