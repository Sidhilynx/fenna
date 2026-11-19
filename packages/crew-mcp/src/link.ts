// The line to the Fenna Crew app. Each run gets a secret token; both MCP
// servers of the run send it with every request over a local named pipe
// (Windows) or unix socket, never a network port. One JSON object per line:
//
//   → { id, token, method, params }
//   ← { id, result } | { id, error }
//
// A result is { text }, { text, image: { data, mimeType } }, or, for the
// gateway, { text, data } with data in the shape the method gives.

import net from "node:net";

export interface LinkResult {
  text: string;
  image?: { data: string; mimeType: string };
  data?: unknown;
}

export interface Link {
  call(method: string, params: Record<string, unknown>): Promise<LinkResult>;
}

/** Thrown for answers the model can act on (the app said why it refused). */
export class LinkError extends Error {}

const MAX_LINE = 32 * 1024 * 1024;

export function connectLink(pipe: string, token: string): Link {
  let socket: net.Socket | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve(r: LinkResult): void; reject(e: Error): void }>();
  let buf = "";

  const failAll = (message: string) => {
    for (const p of pending.values()) p.reject(new LinkError(message));
    pending.clear();
  };

  const open = (): net.Socket => {
    if (socket && !socket.destroyed) return socket;
    const s = net.createConnection(pipe);
    s.setEncoding("utf8");
    s.on("data", (d: string) => {
      buf += d;
      if (buf.length > MAX_LINE) {
        buf = "";
        failAll("The app sent an answer too large to read.");
        return;
      }
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg: { id?: number; result?: LinkResult; error?: string };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const p = msg.id !== undefined ? pending.get(msg.id) : undefined;
        if (!p) continue;
        pending.delete(msg.id!);
        if (typeof msg.error === "string") p.reject(new LinkError(msg.error));
        else if (msg.result && typeof msg.result.text === "string") p.resolve(msg.result);
        else p.reject(new LinkError("The app gave an answer this server can't read."));
      }
    });
    s.on("error", () => failAll("Fenna Crew is not running, so this tool can't reach it. Finish with what you have."));
    s.on("close", () => failAll("Fenna Crew closed the connection. Finish with what you have."));
    socket = s;
    return s;
  };

  return {
    call(method, params) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        open().write(JSON.stringify({ id, token, method, params }) + "\n");
      });
    },
  };
}
