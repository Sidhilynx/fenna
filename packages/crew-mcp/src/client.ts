// Fenna Crew's side of a connector: the app's main process starts each
// installed connector once (a program over stdio, or a server on the web)
// and talks to it with this client. Every bot reaches it through the
// gateway server, never directly. Errors are rewritten to say how to fix
// them.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { SignInNeeded, connectionProvider, type AuthStore } from "./oauth.ts";

export { SignInError, SignInNeeded, accountOf, signIn, signOut, supportsOAuth, type AuthData, type AuthStore, type SignInOptions, type SignInProblem } from "./oauth.ts";

const VERSION = "0.9.4";
const STDERR_KEPT = 4000;
/** How long a connector may take to start and answer. */
const START_TIMEOUT_MS = 30_000;
/** How long one tool call may take before it is given up (progress notifications reset it). */
const CALL_TIMEOUT_MS = 10 * 60_000;

/** How to reach one connector, with its secret values already decrypted. */
export interface ServerSpec {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** A web connector the person signed in to: where its tokens are kept (refreshed as needed). */
  auth?: AuthStore;
}

/** A tool as the connector offers it: what the gateway shows the bot. */
export interface RemoteTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
}

export interface CallResult {
  content: unknown[];
  isError: boolean;
}

export interface Connection {
  /** The started program's process id (command connectors). */
  readonly pid: number | null;
  listTools(): Promise<RemoteTool[]>;
  callTool(name: string, args: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<CallResult>;
  close(): Promise<void>;
  /** Called once when the connection ends without close() (the program quit or crashed). */
  onExit(fn: (why: string) => void): void;
  /** Called when the connector says its tool list changed. */
  onToolsChanged(fn: () => void): void;
}

/** A connection error from connectServer; signIn is set when the server wants the person to sign in (401, 403, or tokens that can't be refreshed). */
export interface ConnectError extends Error {
  signIn?: boolean;
}

const tail = (s: string, n = 600) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? "…" + t.slice(-n) : t;
};

/** A connection problem in words that say how to fix it. */
export function explainError(e: unknown, spec: ServerSpec, stderr = ""): string {
  const err = e as { message?: string; code?: unknown; cause?: { code?: string } } | null;
  const msg = String(err?.message ?? e);
  const code = err?.code ?? err?.cause?.code;
  const said = stderr.trim() ? ` It said: ${tail(stderr)}` : "";
  if (spec.command) {
    if (code === "ENOENT" || /ENOENT|not recognized as an internal or external command/i.test(msg + stderr))
      return `Couldn't start "${spec.command}": it isn't installed, or isn't on this computer's PATH. Install it (npx comes with Node.js, uvx with uv) or give its full path.`;
    if (code === "EACCES") return `"${spec.command}" can't be run: this computer doesn't allow it. Check the file's permissions, or give another program.`;
    if (/timed out|timeout/i.test(msg)) return `It started but didn't answer within ${Math.round(START_TIMEOUT_MS / 1000)} seconds.${said} Check that the command starts an MCP server over stdio, and that the first run isn't still downloading (try again once it has).`;
    if (/closed|exit/i.test(msg)) return `It stopped before it answered.${said || " It printed nothing."} Check the command, its arguments and the values it needs.`;
    return `It couldn't connect: ${tail(msg, 300)}.${said}`;
  }
  let host = spec.url ?? "";
  try {
    host = new URL(spec.url ?? "").host;
  } catch {
    /* as typed */
  }
  if (e instanceof SignInNeeded || e instanceof UnauthorizedError) return spec.auth ? `${host} needs you to sign in again. Open Connectors and choose Sign in on this connector.` : `${host} needs you to sign in. Choose Sign in on the connector.`;
  const status = typeof code === "number" ? code : Number(/\b(40[0-9]|41[0-9]|5\d\d)\b/.exec(msg)?.[1] ?? 0);
  if (status === 401 || status === 403)
    return spec.auth
      ? `${host} didn't accept the sign-in (${status}). Sign out and sign in again.`
      : `${host} says this needs signing in (${status}). Choose Sign in on the connector if it offers one, or add the header it asks for, often Authorization with the value "Bearer <your token>", marked secret.`;
  if (status === 404 || status === 405) return `Nothing at that address speaks MCP (${status}). Check the address; it often ends in /mcp or /sse.`;
  if (status >= 500) return `${host} had a problem (${status}). Try again later.`;
  if (/timed out|timeout|abort/i.test(msg)) return `${host} didn't answer within ${Math.round(START_TIMEOUT_MS / 1000)} seconds. Check the address and your connection.`;
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|ECONNRESET|certificate/i.test(msg + String(code ?? "")))
    return `Couldn't reach ${host}. Check the address and your connection.`;
  return `It couldn't connect: ${tail(msg, 300)}.`;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/** Start (or reach) one connector and complete the MCP handshake. Throws with an explained message. */
export async function connectServer(spec: ServerSpec, { timeoutMs = START_TIMEOUT_MS }: { timeoutMs?: number } = {}): Promise<Connection> {
  let stderr = "";
  let closedByUs = false;
  let exitFn: ((why: string) => void) | null = null;
  let exited = false;
  const client = new Client({ name: "fenna-crew", version: VERSION }, { capabilities: {} });

  const attempt = (transport: Transport) => withTimeout(client.connect(transport), timeoutMs, "Starting it");

  let pid: number | null = null;
  try {
    if (spec.command) {
      const t = new StdioClientTransport({ command: spec.command, args: spec.args ?? [], env: { ...getDefaultEnvironment(), ...(spec.env ?? {}) }, stderr: "pipe" });
      t.stderr?.on("data", (d: Buffer | string) => {
        stderr = (stderr + d.toString()).slice(-STDERR_KEPT);
      });
      await attempt(t);
      pid = t.pid;
    } else {
      const url = new URL(spec.url ?? "");
      const requestInit = { headers: spec.headers ?? {} };
      const authProvider = spec.auth ? await connectionProvider(url.href, spec.auth) : undefined;
      try {
        await attempt(new StreamableHTTPClientTransport(url, { requestInit, authProvider }));
      } catch (first) {
        const status = (first as { code?: unknown }).code;
        if (status === 401 || status === 403 || first instanceof SignInNeeded || first instanceof UnauthorizedError) throw first;
        // An older server: the two-endpoint SSE transport.
        try {
          await attempt(new SSEClientTransport(url, { requestInit, authProvider }));
        } catch {
          throw first;
        }
      }
    }
  } catch (e) {
    await client.close().catch(() => undefined);
    const err: ConnectError = new Error(explainError(e, spec, stderr));
    const status = (e as { code?: unknown } | null)?.code;
    if (!spec.command && (e instanceof SignInNeeded || e instanceof UnauthorizedError || status === 401 || status === 403)) err.signIn = true;
    throw err;
  }

  client.onclose = () => {
    if (closedByUs || exited) return;
    exited = true;
    exitFn?.(spec.command ? `It stopped.${stderr.trim() ? ` It said: ${tail(stderr)}` : ""}` : "The server closed the connection.");
  };
  let changed: (() => void) | null = null;
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    changed?.();
  });

  return {
    pid,
    async listTools() {
      const out: RemoteTool[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const r = await client.listTools(cursor ? { cursor } : {}, { timeout: timeoutMs });
        for (const t of r.tools) {
          out.push({
            name: t.name,
            title: t.title ?? (t.annotations?.title as string | undefined) ?? "",
            description: t.description ?? "",
            inputSchema: (t.inputSchema ?? { type: "object" }) as Record<string, unknown>,
            annotations: (t.annotations ?? {}) as Record<string, unknown>,
          });
        }
        cursor = r.nextCursor;
        if (!cursor) break;
      }
      return out;
    },
    async callTool(name, args, opts = {}) {
      const r = await client.callTool({ name, arguments: args }, undefined, { signal: opts.signal, timeout: CALL_TIMEOUT_MS, resetTimeoutOnProgress: true });
      const content = Array.isArray(r.content) ? r.content : r.toolResult !== undefined ? [{ type: "text", text: JSON.stringify(r.toolResult) }] : [];
      return { content, isError: r.isError === true };
    },
    async close() {
      closedByUs = true;
      await client.close().catch(() => undefined);
    },
    onExit(fn) {
      exitFn = fn;
    },
    onToolsChanged(fn) {
      changed = fn;
    },
  };
}
