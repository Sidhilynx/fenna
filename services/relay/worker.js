// The relay on Cloudflare: one Durable Object per computer (its hub), with
// hibernating WebSockets so an idle hub costs nothing. The hub's logic is
// hub.js; this file gives it sockets, keeps the allow list in the object's
// storage, and sends notifications through FCM. deploy.mjs bundles it.

import { checkJoin, createHub } from "./hub.js";
import { createFcm } from "./fcm.js";

let fcm = null;
function pushWith(env) {
  if (!env.FCM_SERVICE_ACCOUNT) return async () => ({ ok: false, error: "push is not set up" });
  if (!fcm) fcm = createFcm({ serviceAccount: env.FCM_SERVICE_ACCOUNT });
  return fcm;
}

export class Hub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.hubId = null;
    this.st = { allow: null, pairingUntil: 0 };
    this.hub = null;
    // A ping is answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      this.hubId = (await ctx.storage.get("hub")) || null;
      this.st = (await ctx.storage.get("state")) || { allow: null, pairingUntil: 0 };
    });
  }

  logic() {
    if (this.hub) return this.hub;
    this.hub = createHub(this.hubId, {
      sockets: () => this.ctx.getWebSockets().filter((ws) => {
        const m = ws.deserializeAttachment();
        return m && !m.gone;
      }),
      meta: (ws) => {
        const m = ws.deserializeAttachment();
        return m && !m.gone ? m : null;
      },
      setMeta: (ws, m) => ws.serializeAttachment(m),
      send: (ws, text) => {
        try {
          ws.send(text);
        } catch {
          /* the socket closed while we spoke */
        }
      },
      close: (ws, code, reason) => {
        try {
          ws.close(code, reason);
        } catch {
          /* already closed */
        }
      },
      state: () => this.st,
      save: async (st) => {
        this.st = st;
        await this.ctx.storage.put("state", st);
      },
      push: (token, data) => pushWith(this.env)(token, data),
    });
    return this.hub;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const hubId = url.pathname.split("/")[3];
    if (!this.hubId) {
      this.hubId = hubId;
      await this.ctx.storage.put("hub", hubId);
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    this.logic().open(server, url.searchParams.get("id"), url.searchParams.get("role"));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    await this.logic().message(ws, typeof message === "string" ? message : null);
  }

  async webSocketClose(ws, code) {
    const m = ws.deserializeAttachment();
    if (m) ws.serializeAttachment({ ...m, gone: true });
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "closed");
    } catch {
      /* already closed */
    }
    this.logic().closed(m);
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws, 1011);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response("Fenna relay\n", { headers: { "content-type": "text/plain" } });
    const m = /^\/v1\/hub\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
    if (!m) return new Response("Not found\n", { status: 404 });
    if (request.headers.get("upgrade") !== "websocket") return new Response("This address takes WebSocket connections.\n", { status: 426 });
    const problem = checkJoin(m[1], url.searchParams.get("id"), url.searchParams.get("role"));
    if (problem) return new Response(`${problem}\n`, { status: 400 });
    return env.HUB.get(env.HUB.idFromName(m[1])).fetch(request);
  },
};
