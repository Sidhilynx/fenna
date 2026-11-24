// @opendeck/crew-link, the phone link's keys, pairing codes and relay client.
// From source in development (Electron's Node strips the types); the packaged
// app carries it bundled beside the MCP servers (scripts/build-mcp.mjs).

const path = require("node:path");

let electron = null;
try {
  electron = require("electron");
} catch {
  electron = null;
}
const packaged = typeof electron === "object" && electron && electron.app && electron.app.isPackaged;

module.exports = packaged ? require(path.join(process.resourcesPath, "mcp", "crew-link.cjs")) : require("@opendeck/crew-link");
