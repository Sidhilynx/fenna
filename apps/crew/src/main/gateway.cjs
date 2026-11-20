// The gateway's side in the app: what the `gateway` MCP server of a run
// asks for. It lists, for the running bot, the tools of its granted
// connectors on allow or ask (never off), and runs each call through the
// connector the app keeps, asking the person first when the tool is on
// ask. Every call is logged in the bot's run (connector, tool, level,
// outcome, how long; never argument or secret values).

const F = require("./format.cjs");

/** How long listing waits for a connector to start before leaving it out of this run. */
const LIST_WAIT_MS = 25_000;
const DETAILS_MAX = 2000;
const ASK_NOTE = "The person approves each call of this tool before it runs; the call waits for their answer.";

const words = (tool) => String(tool).replace(/[_.\/-]+/g, " ").trim();

/** An app's tool's gateway name: app__<app>__<tool>, short enough for every CLI. */
const appToolName = (app, tool) => F.gatewayToolName(`app__${app}`, tool);

function within(p, ms) {
  let timer;
  return Promise.race([p, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("not ready")), ms)))]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} o
 * @param {ReturnType<import("./store.cjs").createStore>} o.store
 * @param {ReturnType<import("./connectors.cjs").createConnectorStore>} o.connectors
 * @param {ReturnType<import("./connections.cjs").createConnections>} o.connections
 * @param {(ctx: object, a: { action: string, details: string, source: string, tool: string|null }) => Promise<{ allowed: boolean, always: boolean, by: string }>} o.approve
 * @param {{ record(runId: string, event: object): void }} o.runner
 * @param {() => void} o.onChange
 * @param {() => Date} [o.now]
 * @param {number} [o.listWaitMs]
 * @param {ReturnType<import("./apps.cjs").createApps>} [o.apps]  the bot's apps; their tools on a granted app are listed as app__<app>__<tool>
 * @param {ReturnType<import("./appHost.cjs").createAppHost>} [o.appHost]  runs an app's tool in its hidden window
 */
function createGateway({ store, connectors, connections, approve, runner, onChange, now = () => new Date(), listWaitMs = LIST_WAIT_MS, apps = null, appHost = null }) {
  /** runId → (gateway name → { connector, tool, title }) as last listed. */
  const runs = new Map();
  /** runId → calls in flight, to stop when the run ends. */
  const inflight = new Map();

  const grantsOf = (slug) => {
    const r = store.readBot(slug);
    return r && r.bot ? r.bot.connectors.filter((c) => c.type === "grant") : [];
  };

  /** The run's tools: granted connectors' tools on allow or ask. */
  async function list(ctx) {
    const grants = grantsOf(ctx.slug).filter((g) => connectors.has(g.name));
    const found = await Promise.all(
      grants.map(async (g) => {
        let tools;
        try {
          tools = await within(connections.tools(g.name), listWaitMs);
        } catch {
          return [];
        }
        return tools.filter((t) => F.levelOf(g, t.name) !== "off").map((t) => ({ g, t, level: F.levelOf(g, t.name) }));
      }),
    );
    const map = new Map();
    const tools = [];
    for (const { g, t, level } of found.flat()) {
      let name = F.gatewayToolName(g.name, t.name);
      for (let i = 2; map.has(name); i++) name = `${F.gatewayToolName(g.name, t.name).slice(0, F.GATEWAY_NAME_MAX - 3)}_${i}`;
      map.set(name, { connector: g.name, tool: t.name, title: t.title || "" });
      const description = [t.description, level === "ask" ? ASK_NOTE : ""].filter(Boolean).join("\n\n");
      tools.push({ name, ...(t.title ? { title: t.title } : {}), description, inputSchema: t.inputSchema, annotations: t.annotations });
    }
    if (apps && appHost) {
      for (const a of apps.list(ctx.slug)) {
        if (!a.grant) continue;
        for (const t of a.tools) {
          const name = appToolName(a.name, t.name);
          map.set(name, { app: a.name, tool: t.name, title: a.title || a.name });
          tools.push({ name, title: `${a.title || a.name}: ${words(t.name)}`, description: t.description, inputSchema: t.input });
        }
      }
    }
    runs.set(ctx.runId, map);
    return tools;
  }

  /** An app's tool: no approval card (it runs sealed in the app's own window), logged as an app_tool event. */
  async function callApp(ctx, hit, args) {
    const started = Date.now();
    const log = (ok) => runner.record(ctx.runId, { type: "app_tool", at: now().toISOString(), app: hit.app, tool: hit.tool, ok, ms: Date.now() - started });
    if (!apps.grantOf(ctx.slug, hit.app)) {
      log(false);
      throw new Error(`The person has not allowed ${hit.app}'s permissions, or has taken them back, so its tool ${hit.tool} can't run. Don't try it again; say in your reply that the app needs its permissions allowed.`);
    }
    try {
      const json = await appHost.callTool(ctx.slug, hit.app, hit.tool, args);
      log(true);
      return { text: "", data: { content: [{ type: "text", text: json }], isError: false } };
    } catch (e) {
      log(false);
      throw e;
    }
  }

  function setAlways(slug, connector, tool) {
    const r = store.readBot(slug);
    if (!r || !r.bot) return;
    const connectorsNext = r.bot.connectors.map((c) => (c.type === "grant" && c.name === connector ? { ...c, tools: { ...c.tools, [tool]: "allow" } } : c));
    store.updateBot(slug, { connectors: connectorsNext });
    onChange();
  }

  async function call(ctx, p) {
    const name = String(p.name || "");
    const args = p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments) ? p.arguments : {};
    let map = runs.get(ctx.runId);
    if (!map || !map.has(name)) {
      await list(ctx);
      map = runs.get(ctx.runId);
    }
    const hit = map.get(name);
    if (!hit) {
      const near = F.closest(name, [...map.keys()]);
      throw new Error(`There is no connector tool "${name.slice(0, 80)}" for you.${near ? ` Did you mean "${near}"?` : ""} Yours: ${[...map.keys()].join(", ") || "none"}.`);
    }
    if (hit.app) return callApp(ctx, hit, args);
    // The level now, not when listed: the person may have changed it during the run.
    const grant = grantsOf(ctx.slug).find((g) => g.name === hit.connector);
    const level = grant && connectors.has(hit.connector) ? F.levelOf(grant, hit.tool) : "off";
    const started = Date.now();
    const log = (outcome, message = null) =>
      runner.record(ctx.runId, { type: "connector", at: now().toISOString(), bot: ctx.slug, connector: hit.connector, tool: hit.tool, level: level === "off" ? "ask" : level, outcome, ms: Date.now() - started, message });
    if (level === "off") {
      log("denied", "Turned off for this bot.");
      throw new Error(`The person turned ${hit.tool} from ${hit.connector} off for you. Don't use it, and don't try another way.`);
    }
    if (level === "ask") {
      let details = JSON.stringify(args, null, 2);
      if (details.length > DETAILS_MAX) details = details.slice(0, DETAILS_MAX) + "…";
      const r = await approve(ctx, { action: `${hit.title || words(hit.tool)} (${hit.connector})`, details: details === "{}" ? "" : details, source: "connector", tool: `${hit.connector}/${hit.tool}` });
      if (!r.allowed) {
        const outcome = r.by === "timeout" ? "timeout" : r.by === "stopped" ? "stopped" : "denied";
        log(outcome);
        if (outcome === "timeout") throw new Error(`The person didn't answer in time, so ${hit.tool} did not run. Don't do it another way; say in your reply that it waits for their approval.`);
        if (outcome === "stopped") throw new Error("The run was stopped before the person answered.");
        throw new Error(`Denied by the person: ${hit.tool} did not run. Don't do it, and don't try another way. Say in your reply that it was not approved.`);
      }
      if (r.always) setAlways(ctx.slug, hit.connector, hit.tool);
    }
    const ac = new AbortController();
    let set = inflight.get(ctx.runId);
    if (!set) inflight.set(ctx.runId, (set = new Set()));
    set.add(ac);
    try {
      const res = await connections.call(hit.connector, hit.tool, args, { signal: ac.signal });
      const firstText = res.isError ? (res.content.find((c) => c && c.type === "text") || {}).text : null;
      log(res.isError ? "failed" : "done", firstText ? connections.scrub(hit.connector, String(firstText)).slice(0, 300) : null);
      return { text: "", data: { content: res.content, isError: res.isError } };
    } catch (e) {
      const message = connections.scrub(hit.connector, (e && e.message) || String(e));
      log(ac.signal.aborted ? "stopped" : "failed", message.slice(0, 300));
      throw new Error(`${hit.connector} couldn't run ${hit.tool}: ${message}`);
    } finally {
      set.delete(ac);
    }
  }

  return {
    async handle(ctx, method, params) {
      if (method === "gateway.list") {
        const tools = await list(ctx);
        return { text: `${tools.length} tools`, data: { tools } };
      }
      if (method === "gateway.call") return call(ctx, params);
      throw new Error(`Unknown request "${method}".`);
    },

    /** A run ended: stop its calls in flight and forget its tools. */
    endRun(runId) {
      for (const ac of inflight.get(runId) || []) ac.abort();
      inflight.delete(runId);
      runs.delete(runId);
    },
  };
}

module.exports = { createGateway };
