// Where a run's MCP servers (packages/crew-mcp) reach the app: a local named
// pipe (Windows) or unix socket, never a network port. Each run gets a
// secret token; a request without a live token is refused. One JSON object
// per line:  → { id, token, method, params }   ← { id, result } | { id, error }

const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const MAX_LINE = 8 * 1024 * 1024;

/**
 * @param {{ handle: (ctx: object, method: string, params: object) => Promise<{ text: string, image?: object }> }} o
 */
function createLink({ handle }) {
  const id = `${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const pipe = process.platform === "win32" ? `\\\\.\\pipe\\fenna-crew-${id}` : path.join(os.tmpdir(), `fenna-crew-${id}.sock`);
  /** @type {Map<string, object>} token → the run it belongs to */
  const tokens = new Map();
  const sockets = new Set();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    let buf = "";
    const reply = (msg) => {
      if (!socket.destroyed) socket.write(JSON.stringify(msg) + "\n");
    };
    socket.on("data", (d) => {
      buf += d;
      if (buf.length > MAX_LINE) {
        socket.destroy();
        return;
      }
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (!msg || typeof msg.id !== "number") continue;
        const ctx = typeof msg.token === "string" ? tokens.get(msg.token) : undefined;
        if (!ctx) {
          reply({ id: msg.id, error: "This run has ended, so its tools no longer work. Finish your reply." });
          continue;
        }
        if (typeof msg.method !== "string" || !msg.params || typeof msg.params !== "object") {
          reply({ id: msg.id, error: "Bad request." });
          continue;
        }
        Promise.resolve()
          .then(() => handle(ctx, msg.method, msg.params))
          .then(
            (result) => reply({ id: msg.id, result }),
            (e) => reply({ id: msg.id, error: String((e && e.message) || e) }),
          );
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });

  return {
    pipe,
    listen() {
      if (process.platform !== "win32") fs.rmSync(pipe, { force: true });
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(pipe, () => {
          if (process.platform !== "win32") fs.chmodSync(pipe, 0o600);
          resolve();
        });
      });
    },
    /** A new secret for a run; requests carrying it are handled with ctx. */
    issue(ctx) {
      const token = crypto.randomBytes(24).toString("hex");
      tokens.set(token, ctx);
      return token;
    },
    revoke(token) {
      tokens.delete(token);
    },
    close() {
      tokens.clear();
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

module.exports = { createLink };
