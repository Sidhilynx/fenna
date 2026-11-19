// The connectors' running programs (or web sessions), kept by the main
// process and shared by every bot. A connector starts on first use, stays
// up while bots use it, is restarted if it stops on its own while in use,
// and is stopped after a while unused. Bots never reach a connector
// directly: the gateway (gateway.cjs) calls through here.

const { execFile } = require("node:child_process");

const IDLE_MS = 10 * 60_000;
const SWEEP_MS = 60_000;
/** Restart a connector that stopped on its own if a bot used it this recently. */
const IN_USE_MS = 5 * 60_000;
const RESTART_DELAYS_MS = [1000, 5000, 15_000];

/** Summaries of a connector's tools, as its file keeps them. */
function summarize(tools) {
  return tools.map((t) => ({
    name: t.name,
    title: String(t.title || "").slice(0, 200),
    description: String(t.description || "").slice(0, 4000),
    readOnly: t.annotations && t.annotations.readOnlyHint === true,
    destructive: !!(t.annotations && t.annotations.destructiveHint === true),
  }));
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") execFile("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true }, () => {});
  else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/**
 * @param {object} o
 * @param {ReturnType<import("./connectors.cjs").createConnectorStore>} o.connectors
 * @param {{ connectServer(spec: object, opts?: object): Promise<object> }} o.client  packages/crew-mcp's client
 * @param {() => void} o.onChange  a connector's status or tools changed
 * @param {() => number} [o.clock]
 * @param {number} [o.idleMs]
 */
function createConnections({ connectors, client, onChange, clock = Date.now, idleMs = IDLE_MS }) {
  /** @type {Map<string, { conn: object|null, starting: Promise<object>|null, tools: object[], lastUsed: number, busy: number, restarts: number[], timer: any }>} */
  const live = new Map();

  const scrub = (c, text) => {
    let out = String(text);
    for (const s of connectors.secretsOf(c.name)) out = out.split(s).join("•••");
    return out;
  };

  /** A signed-in connector whose sign-in no longer works is signed out, so the page offers Sign in again. */
  function signedOut(c, err) {
    if (err && err.signIn && c.oauth && c.oauth.signedIn) {
      connectors.setOAuth(c.name, { signedIn: false });
      onChange();
    }
  }

  function entryOf(name) {
    let e = live.get(name);
    if (!e) {
      e = { conn: null, starting: null, tools: [], lastUsed: 0, busy: 0, restarts: [], timer: null };
      live.set(name, e);
    }
    return e;
  }

  async function start(name, e) {
    const c = connectors.get(name);
    if (!c) throw new Error(`The connector "${name}" isn't installed on this computer any more.`);
    let conn;
    try {
      conn = await client.connectServer(await connectors.spec(c));
      e.tools = await conn.listTools();
    } catch (err) {
      if (conn) {
        killTree(conn.pid);
        await conn.close();
      }
      signedOut(c, err);
      const message = scrub(c, err.message);
      connectors.setChecked(name, { status: "error", error: message });
      onChange();
      throw new Error(message);
    }
    e.conn = conn;
    connectors.setChecked(name, { status: "ready", error: "", tools: summarize(e.tools) });
    conn.onExit((why) => {
      if (e.conn !== conn) return;
      e.conn = null;
      killTree(conn.pid);
      const recent = clock() - e.lastUsed < IN_USE_MS;
      const now = clock();
      e.restarts = e.restarts.filter((t) => now - t < 5 * 60_000);
      const again = recent && e.restarts.length < RESTART_DELAYS_MS.length;
      connectors.setChecked(name, { status: "error", error: scrub(c, `${why}${again ? " Crew is starting it again." : " It starts again the next time a bot uses it."}`) });
      onChange();
      if (!again) return;
      const delay = RESTART_DELAYS_MS[e.restarts.length];
      e.restarts.push(now);
      clearTimeout(e.timer);
      e.timer = setTimeout(() => {
        if (live.get(name) === e && !e.conn && !e.starting) ensure(name).catch(() => undefined);
      }, delay);
    });
    conn.onToolsChanged(() => {
      if (e.conn !== conn) return;
      conn.listTools().then(
        (tools) => {
          e.tools = tools;
          connectors.setChecked(name, { status: "ready", error: "", tools: summarize(tools) });
          onChange();
        },
        () => undefined,
      );
    });
    onChange();
    return e;
  }

  /** The running connector, started if it isn't. Throws with what is wrong. */
  function ensure(name) {
    const e = entryOf(name);
    e.lastUsed = clock();
    if (e.conn) return Promise.resolve(e);
    if (!e.starting) {
      onChange();
      e.starting = start(name, e).finally(() => {
        e.starting = null;
      });
    }
    return e.starting;
  }

  async function stop(name) {
    const e = live.get(name);
    if (!e) return;
    live.delete(name);
    clearTimeout(e.timer);
    const conn = e.conn;
    e.conn = null;
    if (conn) {
      killTree(conn.pid);
      await conn.close();
    }
    onChange();
  }

  const sweep = setInterval(() => {
    const now = clock();
    for (const [name, e] of live) if (e.conn && !e.busy && now - e.lastUsed > idleMs) void stop(name);
  }, SWEEP_MS);
  if (sweep.unref) sweep.unref();

  return {
    ensure,
    stop,

    /** Its tools as the connector gives them now (name, title, description, inputSchema, annotations). */
    async tools(name) {
      return (await ensure(name)).tools;
    },

    /** Call one tool; the result is MCP content. */
    async call(name, tool, args, { signal } = {}) {
      const e = await ensure(name);
      e.busy++;
      e.lastUsed = clock();
      try {
        return await e.conn.callTool(tool, args, { signal });
      } finally {
        e.busy--;
        e.lastUsed = clock();
      }
    },

    /**
     * Start a connector that isn't saved yet (or saved but to be checked
     * again), list its tools and stop it. Throws with what to fix.
     */
    async test(c) {
      let conn;
      try {
        conn = await client.connectServer(await connectors.spec(c));
        return summarize(await conn.listTools());
      } catch (err) {
        signedOut(c, err);
        const out = new Error(scrub(c, err.message));
        if (err.signIn) out.signIn = true;
        throw out;
      } finally {
        if (conn) {
          killTree(conn.pid);
          await conn.close();
        }
      }
    },

    running(name) {
      const e = live.get(name);
      return !!(e && e.conn);
    },

    starting(name) {
      const e = live.get(name);
      return !!(e && e.starting);
    },

    scrub(name, text) {
      const c = connectors.get(name);
      return c ? scrub(c, text) : String(text);
    },

    async stopAll() {
      clearInterval(sweep);
      await Promise.all([...live.keys()].map(stop));
    },
  };
}

module.exports = { createConnections };
