// Connectors installed on this computer, and what a bot is granted of them.
//
// A connector is installed once, as <Crew>/connectors/<name>.json: how to
// reach it (a command this computer starts, or a web address), the values
// it needs (environment or headers; secret ones stored encrypted by the
// app, never here in plain text), and the tools it offered when last seen.
// A bot's bot.md holds only grants: the connector's name and, per tool,
// allow, ask or off (bot.ts).

import {
  CONNECTOR_NAME_RE,
  CONNECTOR_TYPES,
  ENV_KEY_RE,
  FENNA_APPS,
  HEADER_KEY_RE,
  LIMITS,
  RESERVED_SERVERS,
  TOOL_NAME_RE,
  type ConnectorType,
  type Diagnostic,
  type ToolLevel,
} from "./schema.ts";

/** One tool a connector offers, as last seen. readOnly and destructive are its MCP annotations (hints, not promises). */
export interface ConnectorTool {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  destructive: boolean;
}

/**
 * An environment value (command) or header (url). In a connector file a
 * secret value is the app's encrypted text; coming from the page it is
 * the plain value, or empty with keep set to leave the stored one as it is.
 */
export interface ConnectorValue {
  key: string;
  value: string;
  secret: boolean;
  keep?: boolean;
}

/**
 * A web connector whose server signs people in with OAuth. The tokens are
 * never here: the app keeps them encrypted beside this file. This only says
 * that it signs in, whether someone is signed in, and as whom.
 */
export interface ConnectorOAuth {
  /** A client id the person pasted (for servers that don't let apps register), or "" when Crew registers itself. */
  clientId: string;
  signedIn: boolean;
  /** Who signed in, when the server says ("person@example.com"), or "". */
  account: string;
}

/** A client id as OAuth allows it: visible ASCII, no spaces. */
export const CLIENT_ID_RE = /^[!-~]{1,200}$/;

export const CONNECTOR_STATUSES = ["ready", "error", "untested"] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];

export interface MachineConnector {
  name: string;
  type: ConnectorType;
  /** command connectors */
  command: string;
  args: string[];
  env: ConnectorValue[];
  /** url connectors */
  url: string;
  headers: ConnectorValue[];
  /** url connectors that sign in with OAuth; null otherwise. */
  oauth: ConnectorOAuth | null;
  /** Where it came from: "command", "url", "registry <server name>", or "bot <slug>" (moved out of an older bot.md). */
  origin: string;
  tools: ConnectorTool[];
  status: ConnectorStatus;
  /** Why it last failed, saying how to fix it. */
  error: string;
  /** ISO time it was last started or tested. */
  checkedAt: string | null;
}

/** A bot's grant of one installed connector. Tools not listed get `default` (tools the connector adds later). */
export interface Grant {
  type: "grant";
  name: string;
  tools: Record<string, ToolLevel>;
  default: ToolLevel;
}

const FENNA_IDS = FENNA_APPS.map((a) => a.id) as readonly string[];

/** Why a connector name can't be used, or null when it can. */
export function connectorNameProblem(name: string): string | null {
  if (!CONNECTOR_NAME_RE.test(name)) return `A connector's name is lowercase letters, digits and dashes, starting with a letter, up to 32 characters (like "calendar"); "${name.slice(0, 40)}" isn't.`;
  if ((RESERVED_SERVERS as readonly string[]).includes(name) || FENNA_IDS.includes(name)) return `The name "${name}" is taken by Fenna Crew itself. Pick another name.`;
  return null;
}

/** Why a web address can't be a connector, or null when it can: https, or http on this computer only. */
export function connectorUrlProblem(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return null;
    if (u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) return null;
  } catch {
    /* said below */
  }
  return `The address should start with https:// (http:// only for localhost), like https://mcp.example.com/mcp.`;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

function readValues(raw: unknown, what: "environment value" | "header", keyRe: RegExp, max: number, d: Diagnostic[]): ConnectorValue[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    d.push({ severity: "error", message: `The ${what}s should be a list of { key, value, secret }.` });
    return [];
  }
  if (raw.length > max) d.push({ severity: "error", message: `A connector can have at most ${max} ${what}s; this one has ${raw.length}.` });
  const out: ConnectorValue[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, max)) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const key = str(r.key).trim();
    if (!key && !str(r.value)) continue;
    if (!keyRe.test(key)) {
      d.push({
        severity: "error",
        message: what === "header" ? `"${key.slice(0, 40)}" is not a header name. Use letters, digits and dashes, like Authorization.` : `"${key.slice(0, 40)}" is not an environment name. Use letters, digits and _, starting with a letter, like API_TOKEN.`,
      });
      continue;
    }
    const lower = what === "header" ? key.toLowerCase() : key;
    if (seen.has(lower)) {
      d.push({ severity: "error", message: `The ${what} ${key} is given twice. Keep one.` });
      continue;
    }
    seen.add(lower);
    const value = str(r.value);
    if (value.length > 8000) {
      d.push({ severity: "error", message: `The ${what} ${key} is ${value.length} characters; the most is 8000.` });
      continue;
    }
    if (/[\r\n]/.test(value) && what === "header") {
      d.push({ severity: "error", message: `The header ${key} can't hold a line break.` });
      continue;
    }
    out.push({ key, value, secret: r.secret === true, ...(r.keep === true ? { keep: true } : {}) });
  }
  return out;
}

function readTools(raw: unknown): ConnectorTool[] {
  if (!Array.isArray(raw)) return [];
  const out: ConnectorTool[] = [];
  for (const t of raw.slice(0, LIMITS.connectorTools)) {
    const r = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    const name = str(r.name);
    if (!TOOL_NAME_RE.test(name)) continue;
    out.push({ name, title: str(r.title).slice(0, 200), description: str(r.description).slice(0, LIMITS.toolDescription), readOnly: r.readOnly === true, destructive: r.destructive === true });
  }
  return out;
}

/**
 * Check a connector, from its file or from what the person typed. Errors say
 * what to fix; a connector with an error is not saved or started.
 */
export function checkConnector(input: unknown): { connector: MachineConnector; diagnostics: Diagnostic[] } {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d: Diagnostic[] = [];
  const name = str(r.name).trim();
  const nameProblem = connectorNameProblem(name);
  if (nameProblem) d.push({ severity: "error", message: nameProblem });
  const type = str(r.type) as ConnectorType;
  if (!(CONNECTOR_TYPES as readonly string[]).includes(type)) d.push({ severity: "error", message: `A connector is either "command" (a program this computer starts) or "url" (a server on the web).` });

  let command = "";
  let args: string[] = [];
  let env: ConnectorValue[] = [];
  let url = "";
  let headers: ConnectorValue[] = [];
  let oauth: ConnectorOAuth | null = null;
  if (type === "command") {
    command = str(r.command).trim();
    if (!command || command.length > 500 || /[\r\n]/.test(command)) d.push({ severity: "error", message: `Say which program starts it, like npx, uvx, node or a full path.` });
    const rawArgs = r.args === undefined ? [] : r.args;
    if (!Array.isArray(rawArgs) || rawArgs.some((a) => typeof a !== "string") || rawArgs.length > LIMITS.args || rawArgs.some((a) => (a as string).length > LIMITS.arg)) {
      d.push({ severity: "error", message: `The arguments should be a list of words, like -y @example/calendar-mcp, at most ${LIMITS.args}.` });
    } else args = rawArgs as string[];
    env = readValues(r.env, "environment value", ENV_KEY_RE, LIMITS.env, d);
  } else if (type === "url") {
    url = str(r.url).trim();
    const urlProblem = connectorUrlProblem(url);
    if (urlProblem) d.push({ severity: "error", message: urlProblem });
    headers = readValues(r.headers, "header", HEADER_KEY_RE, LIMITS.headers, d);
    if (r.oauth && typeof r.oauth === "object") {
      const o = r.oauth as Record<string, unknown>;
      const clientId = str(o.clientId).trim();
      if (clientId && !CLIENT_ID_RE.test(clientId)) d.push({ severity: "error", message: `"${clientId.slice(0, 40)}" is not a client ID: it is up to 200 visible characters with no spaces, as the server's app settings show it.` });
      oauth = { clientId: CLIENT_ID_RE.test(clientId) ? clientId : "", signedIn: o.signedIn === true, account: str(o.account).slice(0, 200) };
    }
  }
  const status = (CONNECTOR_STATUSES as readonly string[]).includes(str(r.status)) ? (str(r.status) as ConnectorStatus) : "untested";
  const checkedAt = typeof r.checkedAt === "string" && !Number.isNaN(Date.parse(r.checkedAt)) ? new Date(r.checkedAt).toISOString() : null;
  return {
    connector: { name, type, command, args, env, url, headers, oauth, origin: str(r.origin).slice(0, 200), tools: readTools(r.tools), status, error: str(r.error).slice(0, 2000), checkedAt },
    diagnostics: d,
  };
}

/** Read a connector file. `connector` is null when the file isn't JSON at all. */
export function parseConnectorFile(src: string): { connector: MachineConnector | null; diagnostics: Diagnostic[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(src);
  } catch (e) {
    return { connector: null, diagnostics: [{ severity: "error", message: `The connector file can't be read (${(e as Error).message}). Remove the connector and add it again.` }] };
  }
  return checkConnector(raw);
}

export function serializeConnectorFile(c: MachineConnector): string {
  const values = (list: ConnectorValue[]) => list.map((v) => ({ key: v.key, value: v.value, secret: v.secret }));
  const out: Record<string, unknown> = { name: c.name, type: c.type };
  if (c.type === "command") Object.assign(out, { command: c.command, args: c.args, env: values(c.env) });
  else Object.assign(out, { url: c.url, headers: values(c.headers), ...(c.oauth ? { oauth: { clientId: c.oauth.clientId, signedIn: c.oauth.signedIn, account: c.oauth.account } } : {}) });
  Object.assign(out, { origin: c.origin, status: c.status, error: c.error, checkedAt: c.checkedAt, tools: c.tools });
  return JSON.stringify(out, null, 2) + "\n";
}

/** What a tool starts as when a bot is granted its connector: read-only tools run, everything else asks. */
export function defaultLevel(tool: Pick<ConnectorTool, "readOnly" | "destructive">): ToolLevel {
  return tool.readOnly && !tool.destructive ? "allow" : "ask";
}

/** A new grant of a connector with these tools, each at its default level; tools added later ask. */
export function newGrant(name: string, tools: ConnectorTool[]): Grant {
  return { type: "grant", name, tools: Object.fromEntries(tools.map((t) => [t.name, defaultLevel(t)])), default: "ask" };
}

/** The level a grant gives one tool. */
export function levelOf(grant: Grant, tool: string): ToolLevel {
  return Object.prototype.hasOwnProperty.call(grant.tools, tool) ? grant.tools[tool]! : grant.default;
}

function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(6, "0").slice(-6);
}

/** The most characters a tool name the gateway shows can have (CLIs add their own prefix, like mcp__gateway__). */
export const GATEWAY_NAME_MAX = 50;

/** The name the gateway gives a connector's tool: "<connector>__<tool>", made safe and short enough for every CLI. */
export function gatewayToolName(connector: string, tool: string): string {
  const full = `${connector}__${tool.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  if (full.length <= GATEWAY_NAME_MAX) return full;
  return `${full.slice(0, GATEWAY_NAME_MAX - 7)}_${shortHash(`${connector}/${tool}`)}`;
}
