// The relay on Node, for development, tests and anyone hosting their own.
// The same hub as the Worker (hub.js); hubs and their allow lists live in
// memory. Run: node services/relay/server.mjs [port] (default 8787), then
// start Crew with FENNA_RELAY_URL=ws://127.0.0.1:8787.

import http from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { checkJoin, createHub } from "./hub.js";

/**
 * @param {{ port?: number, host?: string, push?: (token: string, data: object) => Promise<{ ok: boolean, error?: string }>, log?: (line: string) => void }} [o]
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void>, hubs: Map<string, object> }>}
 */
export function startRelay({ port = 8787, host = "127.0.0.1", push = async () => ({ ok: false, error: "push is not set up" }), log = () => {} } = {}) {
  /** @type {Map<string, { hub: ReturnType<typeof createHub>, sockets: Set<any>, meta: Map<any, any>, holder: { state: { allow: string[] | null, pairingUntil: number } } }>} */
  const hubs = new Map();

  function hubOf(hubId) {
    let h = hubs.get(hubId);
    if (h) return h;
    const sockets = new Set();
    const meta = new Map();
    const holder = { state: { allow: null, pairingUntil: 0 } };
    const hub = createHub(hubId, {
      sockets: () => [...sockets],
      meta: (s) => meta.get(s) || null,
      setMeta: (s, m) => meta.set(s, m),
      send: (s, text) => {
        if (s.readyState === 1) s.send(text);
      },
      close: (s, code, reason) => {
        try {
          s.close(code, reason);
        } catch {
          s.terminate();
        }
      },
      state: () => holder.state,
      save: (st) => {
        holder.state = st;
      },
      push,
    });
    h = { hub, sockets, meta, holder };
    hubs.set(hubId, h);
    return h;
  }

  const server = http.createServer((req, res) => {
    res.writeHead(req.url === "/" ? 200 : 404, { "content-type": "text/plain" });
    res.end(req.url === "/" ? "Fenna relay\n" : "Not found\n");
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_100_000 });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://relay");
    const m = /^\/v1\/hub\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
    const problem = m ? checkJoin(m[1], url.searchParams.get("id"), url.searchParams.get("role")) : "Not found.";
    if (problem) {
      socket.write(`HTTP/1.1 400 Bad Request\r\ncontent-type: text/plain\r\n\r\n${problem}\n`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const h = hubOf(m[1]);
      h.sockets.add(ws);
      ws.on("message", (data, isBinary) => {
        void h.hub.message(ws, isBinary ? null : data.toString("utf8")).catch((e) => log(`relay: ${e && e.message}`));
      });
      ws.on("close", () => {
        const meta = h.meta.get(ws);
        h.sockets.delete(ws);
        h.meta.delete(ws);
        h.hub.closed(meta);
      });
      ws.on("error", () => {});
      h.hub.open(ws, url.searchParams.get("id"), url.searchParams.get("role"));
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        url: `ws://${host}:${p}`,
        port: p,
        hubs,
        close: () =>
          new Promise((done) => {
            for (const ws of wss.clients) ws.terminate();
            wss.close();
            server.close(() => done());
          }),
      });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2]) || 8787;
  const host = process.env.RELAY_HOST || "127.0.0.1";
  const r = await startRelay({ port, host, log: (l) => console.error(l) });
  console.error(`Fenna relay on ${r.url}`);
}
