// @opendeck/crew, the bot folder format. From source in development (Electron's
// Node strips the types); the packaged app carries it bundled beside the MCP
// servers (scripts/build-mcp.mjs).

const path = require("node:path");
const electron = require("electron");

const packaged = typeof electron === "object" && electron.app && electron.app.isPackaged;

module.exports = packaged ? require(path.join(process.resourcesPath, "mcp", "crew-format.cjs")) : require("@opendeck/crew");
