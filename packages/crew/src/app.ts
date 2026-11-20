// An app's manifest (app.json) and its grant. An app is a folder
// Files/Apps/<name>/ on a bot's disk with web files and this file. The rules
// are checked here, with fix-it messages, so the bot, the page and the tests
// all read the same answer. Nothing here touches the disk.

export const APP_DOCUMENTS = ["none", "read", "write"] as const;
export type AppDocuments = (typeof APP_DOCUMENTS)[number];
/** The JSON Schema types a tool's input may use for each property. */
export const APP_TOOL_TYPES = ["string", "number", "boolean", "array", "object"] as const;
export type AppToolType = (typeof APP_TOOL_TYPES)[number];

export const APP_LIMITS = {
  name: 32,
  title: 60,
  icon: 40,
  entry: 200,
  description: 300,
  origins: 10,
  originLength: 200,
  tools: 20,
  toolDescription: 300,
  propertyDescription: 300,
} as const;

/** What the person allows an app: its documents, the web origins it may reach, and whether it may message the bot. */
export interface AppGrant {
  documents: AppDocuments;
  /** Exact origins: https://host or https://host:port. */
  network: string[];
  bot: boolean;
}

export interface AppToolProperty {
  type: AppToolType;
  description?: string;
}

export interface AppToolInput {
  type: "object";
  description?: string;
  properties: Record<string, AppToolProperty>;
  required: string[];
}

export interface AppToolDef {
  name: string;
  description: string;
  input: AppToolInput;
}

export interface AppManifest {
  name: string;
  title: string;
  icon: string;
  /** A path inside the app's folder, relative, like index.html. */
  entry: string;
  description: string;
  permissions: AppGrant;
  tools: AppToolDef[];
}

/** An app with no permissions: no documents, no network, no bot. What an app with no grant runs with. */
export const NO_GRANT: AppGrant = { documents: "none", network: [], bot: false };

/** An app's name, which is also its folder name: lowercase letters, digits and dashes. */
export const APP_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
const NAME_RE = APP_NAME_RE;
const ICON_RE = /^[a-z][a-z0-9-]{0,39}$/;
const TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
const ORIGIN_RE = /^https?:\/\/[^/?#@\s]+$/;
const TOP_KEYS = ["name", "title", "icon", "entry", "description", "permissions", "tools"];
const PERMISSION_KEYS = ["documents", "network", "bot"];
const TOOL_KEYS = ["name", "description", "input"];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A value as the messages show it: JSON, cut short. */
function shown(v: unknown): string {
  if (v === undefined) return "missing";
  const s = JSON.stringify(v) ?? String(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

/** Whether a path is a relative path inside a folder: no drive, no root, no backslash, no .. or empty parts. */
export function insideFolder(p: string): boolean {
  if (!p || p.startsWith("/") || p.includes("\\") || p.includes(":")) return false;
  return p.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

/** The origin of an address, or null when it isn't a web address. */
function originOf(o: string): string | null {
  try {
    return new URL(o).origin;
  } catch {
    return null;
  }
}

/**
 * app.json text checked against every rule. `app` is null when there is any
 * problem; each problem says what is wrong and what to write instead.
 */
export function parseAppManifest(text: string): { app: AppManifest | null; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { app: null, problems: [`app.json is not valid JSON (${(e as Error).message}).`] };
  }
  if (!isObj(raw)) return { app: null, problems: ['app.json must be one JSON object, like {"name": "notes", "title": "Notes"}.'] };
  const problems: string[] = [];
  for (const k of Object.keys(raw)) {
    if (!TOP_KEYS.includes(k)) problems.push(`"${k}" isn't a field of app.json. Use ${TOP_KEYS.join(", ")}.`);
  }

  const { name, title, icon, entry, description, permissions, tools } = raw;
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    problems.push(`name is ${shown(name)}. Use lowercase letters, digits and dashes, starting with a letter, up to ${APP_LIMITS.name} characters, like invoice-tracker.`);
  }
  if (typeof title !== "string" || !title.trim()) problems.push('title is missing. Say what the app is called, like "Invoice tracker".');
  else if (title.trim().length > APP_LIMITS.title) problems.push(`title is ${title.trim().length} characters. The most is ${APP_LIMITS.title}.`);
  if (icon !== undefined && (typeof icon !== "string" || !ICON_RE.test(icon))) {
    problems.push(`icon is ${shown(icon)}. Use the name of one of Crew's icons, like sheet, doc or board, or leave it out.`);
  }
  const entryPath = entry === undefined ? "index.html" : entry;
  if (typeof entryPath !== "string" || !insideFolder(entryPath) || entryPath.length > APP_LIMITS.entry) {
    problems.push(`entry is ${shown(entry)}. Use a relative path inside the app's folder, like index.html or pages/home.html.`);
  }
  if (description !== undefined && (typeof description !== "string" || description.length > APP_LIMITS.description)) {
    problems.push(`description must be text of at most ${APP_LIMITS.description} characters.`);
  }

  const grant = checkPermissions(permissions, problems);
  const toolDefs = checkTools(tools, problems);

  if (problems.length) return { app: null, problems };
  return {
    app: {
      name: name as string,
      title: (title as string).trim(),
      icon: typeof icon === "string" ? icon : "app",
      entry: entryPath as string,
      description: typeof description === "string" ? description.trim() : "",
      permissions: grant,
      tools: toolDefs,
    },
    problems,
  };
}

function checkPermissions(v: unknown, problems: string[]): AppGrant {
  const out: AppGrant = { documents: "none", network: [], bot: false };
  if (v === undefined) return out;
  if (!isObj(v)) {
    problems.push(`permissions is ${shown(v)}. Write it as an object, like {"documents": "read", "network": [], "bot": false}.`);
    return out;
  }
  for (const k of Object.keys(v)) {
    if (!PERMISSION_KEYS.includes(k)) problems.push(`permissions.${k} isn't a permission. Use ${PERMISSION_KEYS.join(", ")}.`);
  }
  if (v.documents !== undefined) {
    if (typeof v.documents === "string" && (APP_DOCUMENTS as readonly string[]).includes(v.documents)) out.documents = v.documents as AppDocuments;
    else problems.push(`permissions.documents is ${shown(v.documents)}. Use none, read or write.`);
  }
  if (v.network !== undefined) {
    if (!Array.isArray(v.network)) {
      problems.push(`permissions.network is ${shown(v.network)}. Write a list of origins, like ["https://api.example.com"].`);
    } else if (v.network.length > APP_LIMITS.origins) {
      problems.push(`permissions.network has ${v.network.length} origins. The most is ${APP_LIMITS.origins}.`);
    } else {
      v.network.forEach((o, i) => {
        const ok = typeof o === "string" && o.length <= APP_LIMITS.originLength && ORIGIN_RE.test(o) && originOf(o) === o;
        if (!ok) problems.push(`permissions.network[${i}] is ${shown(o)}. Write just the origin: https://host or https://host:port, with no path or slash.`);
        else if (!out.network.includes(o)) out.network.push(o);
      });
    }
  }
  if (v.bot !== undefined) {
    if (typeof v.bot === "boolean") out.bot = v.bot;
    else problems.push(`permissions.bot is ${shown(v.bot)}. Use true or false.`);
  }
  return out;
}

function checkTools(v: unknown, problems: string[]): AppToolDef[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    problems.push(`tools is ${shown(v)}. Write a list of tools, each with a name, a description and an input.`);
    return [];
  }
  if (v.length > APP_LIMITS.tools) problems.push(`tools has ${v.length} tools. The most is ${APP_LIMITS.tools}.`);
  const out: AppToolDef[] = [];
  const seen = new Set<string>();
  v.forEach((t, i) => {
    const at = `tools[${i}]`;
    if (!isObj(t)) {
      problems.push(`${at} is ${shown(t)}. Write it as an object with name, description and input.`);
      return;
    }
    for (const k of Object.keys(t)) {
      if (!TOOL_KEYS.includes(k)) problems.push(`${at}.${k} isn't a tool field. Use name, description or input.`);
    }
    const before = problems.length;
    if (typeof t.name !== "string" || !TOOL_NAME_RE.test(t.name)) {
      problems.push(`${at}.name is ${shown(t.name)}. Use lowercase letters, digits and underscores, starting with a letter, like overdue_invoices.`);
    } else if (seen.has(t.name)) {
      problems.push(`${at}.name "${t.name}" is already a tool. Give each tool its own name.`);
    }
    if (typeof t.description !== "string" || !t.description.trim() || t.description.length > APP_LIMITS.toolDescription) {
      problems.push(`${at}.description must be one to ${APP_LIMITS.toolDescription} characters, saying what the tool does.`);
    }
    const input = checkInput(t.input ?? { type: "object" }, at, problems);
    if (problems.length === before && typeof t.name === "string" && typeof t.description === "string") {
      seen.add(t.name);
      out.push({ name: t.name, description: t.description.trim(), input });
    }
  });
  return out;
}

function checkInput(v: unknown, at: string, problems: string[]): AppToolInput {
  const out: AppToolInput = { type: "object", properties: {}, required: [] };
  if (!isObj(v)) {
    problems.push(`${at}.input is ${shown(v)}. Write a JSON Schema object with "type": "object" and its properties.`);
    return out;
  }
  if (v.type !== "object") {
    problems.push(`${at}.input.type is ${shown(v.type)}. A tool's input is an object: use "type": "object".`);
    return out;
  }
  if (v.description !== undefined) {
    if (typeof v.description === "string") out.description = v.description;
    else problems.push(`${at}.input.description must be text.`);
  }
  if (v.properties !== undefined) {
    if (!isObj(v.properties)) {
      problems.push(`${at}.input.properties is ${shown(v.properties)}. Write each property as an object, like {"days": {"type": "number"}}.`);
    } else {
      for (const [key, p] of Object.entries(v.properties)) {
        if (!isObj(p)) {
          problems.push(`${at}.input.properties.${key} is ${shown(p)}. Write it as an object with a type, like {"type": "string"}.`);
          continue;
        }
        if (typeof p.type !== "string" || !(APP_TOOL_TYPES as readonly string[]).includes(p.type)) {
          problems.push(`${at}.input.properties.${key}.type is ${shown(p.type)}. Use string, number, boolean, array or object.`);
          continue;
        }
        const prop: AppToolProperty = { type: p.type as AppToolType };
        if (p.description !== undefined) {
          if (typeof p.description === "string" && p.description.length <= APP_LIMITS.propertyDescription) prop.description = p.description;
          else problems.push(`${at}.input.properties.${key}.description must be text of at most ${APP_LIMITS.propertyDescription} characters.`);
        }
        out.properties[key] = prop;
      }
    }
  }
  if (v.required !== undefined) {
    if (!Array.isArray(v.required) || !v.required.every((r) => typeof r === "string")) {
      problems.push(`${at}.input.required must be a list of property names.`);
    } else {
      for (const r of v.required as string[]) {
        if (!(r in out.properties)) problems.push(`${at}.input.required names "${r}", which isn't a property. Add it to properties or take it out of required.`);
        else out.required.push(r);
      }
    }
  }
  return out;
}

/** Whether a grant allows everything the manifest asks for: documents at least as high, every origin, and the bot if asked. */
export function grantCovers(grant: AppGrant, manifest: AppManifest): boolean {
  const rank: Record<AppDocuments, number> = { none: 0, read: 1, write: 2 };
  const asked = manifest.permissions;
  return rank[grant.documents] >= rank[asked.documents] && asked.network.every((o) => grant.network.includes(o)) && (!asked.bot || grant.bot);
}

/** The text of a value with keys sorted, so the same manifest always gives the same text. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * A short fingerprint of a manifest, kept with a grant so a changed manifest
 * can be seen. Not a security hash: it only tells two manifests apart.
 */
export function manifestHash(manifest: AppManifest): string {
  const text = canonical(manifest);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
