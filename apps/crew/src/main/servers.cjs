// The MCP servers each run gets: crew and browser (packages/crew-mcp), fenna
// (the Fenna apps, rooted in the bot's library, through
// packages/workspace-mcp), and gateway when the bot is granted connectors.
// Connectors are never handed to the CLI: the gateway lists the bot's
// allowed and ask tools and the app runs every call, so the same rules hold
// on Claude Code, Codex and Antigravity, and every server here is trusted.
// In development the servers run from source; the packaged app carries them
// bundled (scripts/build-mcp.mjs) and runs them on Electron's own Node.

const fs = require("node:fs");
const path = require("node:path");

/** Seconds a crew, browser or gateway tool call may wait (ask_human, approvals, sign-ins, hand-offs), past the app's own 15-minute wait. */
const CREW_TOOL_TIMEOUT_SEC = 1000;

/**
 * @param {object} o
 * @param {{ pipe: string }} o.link
 * @param {{ botDir(slug: string): string }} o.store
 * @param {{ has(name: string): boolean }} o.connectors
 * @param {{ ensure(name: string): Promise<unknown> }} o.connections
 * @param {boolean} o.packaged
 * @param {string} o.resources  process.resourcesPath
 * @param {string} o.repo       the repository root (development)
 * @param {string} o.homes      where each bot's Antigravity home lives
 * @param {{ list(slug: string): { grant: object | null }[] } | null} [o.apps]  the bot's apps: granted ones need the gateway too
 */
function createServers({ link, store, connectors, connections, packaged, resources, repo, homes, apps = null }) {
  const node = process.execPath;
  const script = (bundle, source) => (packaged ? [path.join(resources, "mcp", bundle)] : ["--experimental-strip-types", path.join(repo, source)]);
  const crewArgs = (which) => [...script("fenna-crew-mcp.cjs", "packages/crew-mcp/src/cli.ts"), `--server=${which}`];

  return function serversFor({ slug, bot, token }) {
    const library = path.join(store.botDir(slug), "library");
    fs.mkdirSync(library, { recursive: true });
    const linkEnv = { ELECTRON_RUN_AS_NODE: "1", OPENDECK_CREW_PIPE: link.pipe, OPENDECK_CREW_TOKEN: token };
    const servers = {
      crew: { command: node, args: crewArgs("crew"), env: { ...linkEnv, OPENDECK_CREW_LIBRARY: library }, timeoutSec: CREW_TOOL_TIMEOUT_SEC },
      // sign_in can wait for the person's approval, like the crew tools.
      browser: { command: node, args: crewArgs("browser"), env: linkEnv, timeoutSec: CREW_TOOL_TIMEOUT_SEC },
    };
    if (bot.connectors.some((c) => c.type === "fenna")) {
      servers.fenna = { command: node, args: [...script("fenna-workspace-mcp.cjs", "packages/workspace-mcp/src/cli.ts"), `--workspace=${library}`], env: { ELECTRON_RUN_AS_NODE: "1" } };
    }
    const granted = bot.connectors.filter((c) => c.type === "grant" && connectors.has(c.name));
    const appsGranted = !!apps && apps.list(slug).some((a) => a.grant);
    if (granted.length || appsGranted) {
      servers.gateway = { command: node, args: crewArgs("gateway"), env: linkEnv, timeoutSec: CREW_TOOL_TIMEOUT_SEC };
      // Start them now, while the CLI starts, so the gateway's first list doesn't wait.
      for (const g of granted) connections.ensure(g.name).catch(() => undefined);
    }
    return {
      servers,
      trusted: Object.keys(servers),
      home: path.join(homes, slug),
      // Claude Code's own limit on one MCP tool call, so a question or an approval can wait for the person.
      env: { MCP_TOOL_TIMEOUT: String(CREW_TOOL_TIMEOUT_SEC * 1000) },
    };
  };
}

module.exports = { createServers };
