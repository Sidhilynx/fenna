#!/usr/bin/env node
// fenna-crew-mcp --server=crew|browser|gateway (stdio)
// Started by the Fenna Crew app for each run, with OPENDECK_CREW_PIPE (where
// the app listens), OPENDECK_CREW_TOKEN (this run's secret) and, for crew,
// OPENDECK_CREW_LIBRARY (the bot's library folder) in its environment.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connectLink, createBrowserServer, createCrewServer, createGatewayServer } from "./index.ts";

const which = process.argv.find((a) => a.startsWith("--server="))?.slice(9);
const pipe = process.env.OPENDECK_CREW_PIPE;
const token = process.env.OPENDECK_CREW_TOKEN;
const library = process.env.OPENDECK_CREW_LIBRARY;
if ((which !== "crew" && which !== "browser" && which !== "gateway") || !pipe || !token || (which === "crew" && !library)) {
  process.stderr.write("usage: fenna-crew-mcp --server=crew|browser|gateway, started by Fenna Crew (needs OPENDECK_CREW_PIPE, OPENDECK_CREW_TOKEN and, for crew, OPENDECK_CREW_LIBRARY)\n");
  process.exit(2);
}
const link = connectLink(pipe, token);
const server = which === "crew" ? createCrewServer(link, { library: library! }) : which === "gateway" ? createGatewayServer(link) : createBrowserServer(link);
server.connect(new StdioServerTransport()).catch((e: unknown) => {
  process.stderr.write(`fenna-crew-mcp: ${(e as Error).message}\n`);
  process.exit(1);
});
