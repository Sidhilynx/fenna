// bot.md: a bot's settings (front matter) and how it works (the body).
//
//   ---
//   name: Research
//   job: Tracks competitor pricing every Monday
//   avatar: lantern         # the pixel face and its color; chosen from the name when left out
//   color: ochre
//   schedule: mondays 10:00
//   brain:
//     cli: claude
//     model: sonnet
//     effort: medium
//   connectors:
//     - fenna-docs
//     - name: calendar          # a connector installed on this computer
//       allow: [list_events]    # runs without asking
//       ask: [create_event]     # waits for the person's approval each call
//       off: [delete_event]     # hidden from the bot
//       default: ask            # tools the connector adds later
//   logins:
//     - name: example-mail      # a login in this computer's vault
//       level: ask              # allow: Crew signs in without asking; ask: each time
//   askBefore:
//     - Signing up for trials
//   wallpaper: clay
//   ---
//   Visit each pricing page, compare with last week, …

import {
  AVATARS,
  AVATAR_COLORS,
  BOT_KEYS,
  BRAIN_KEYS,
  CLI_KINDS,
  COMMAND_CONNECTOR_KEYS,
  EFFORT_RE,
  ENV_KEY_RE,
  FENNA_APPS,
  GRANT_KEYS,
  LIMITS,
  LOGIN_GRANT_KEYS,
  LOGIN_LEVELS,
  MODEL_RE,
  TOOL_LEVELS,
  TOOL_NAME_RE,
  URL_CONNECTOR_KEYS,
  WALLPAPERS,
  type Avatar,
  type AvatarColor,
  type CliKind,
  type Diagnostic,
  type FennaAppId,
  type LoginLevel,
  type ToolLevel,
  type Wallpaper,
} from "./schema.ts";
import { connectorNameProblem, connectorUrlProblem, type Grant } from "./connector.ts";
import { formatSchedule, parseSchedule } from "./schedule.ts";
import { isSlug } from "./slug.ts";
import { closest, parseYaml, splitFrontMatter, stringifyYaml, type YamlMap, type YamlValue } from "./yaml.ts";

/** What a bot is given: a Fenna app (built in), or a grant of a connector installed on this computer. */
export type Connector = { type: "fenna"; app: FennaAppId } | Grant;

/**
 * A whole connector written in an older bot.md. It is read so the app can
 * move it to the computer's connectors (keeping a grant in its place); it
 * is never written back.
 */
export type LegacyConnector =
  | { type: "command"; name: string; command: string; args: string[]; env: Record<string, string> }
  | { type: "url"; name: string; url: string };

/** A bot's grant of one login in this computer's vault, by the login's name. */
export interface LoginGrant {
  name: string;
  level: LoginLevel;
}

export interface Brain {
  cli: CliKind;
  /** Empty: the CLI's default model. */
  model: string;
  /** Empty: the model's default effort. */
  effort: string;
}

export interface Bot {
  name: string;
  job: string;
  /** The pixel-art face; when bot.md leaves them out they come from the name (defaultAvatar). */
  avatar: Avatar;
  color: AvatarColor;
  /** A line in the schedule grammar (schedule.ts), canonical form. */
  schedule: string;
  brain: Brain;
  connectors: Connector[];
  /** Vault logins it may use; any other login is invisible to it. */
  logins: LoginGrant[];
  askBefore: string[];
  wallpaper: Wallpaper;
  /** The body: how it works, in the person's words. */
  how: string;
}

/** A small stable string hash (FNV-1a), so the same name always gets the same face. */
function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** The face a bot of this name has when none is chosen: stable, from the name alone. */
export function defaultAvatar(name: string): { avatar: Avatar; color: AvatarColor } {
  const h = hashName(String(name ?? "").trim().toLowerCase());
  return { avatar: AVATARS[h % AVATARS.length]!, color: AVATAR_COLORS[Math.floor(h / AVATARS.length) % AVATAR_COLORS.length]! };
}

/**
 * The face for a new bot: a design no bot in `used` has when one is free (else the name's own),
 * and the color the fewest of them have (the name's own color wins a tie).
 */
export function pickAvatar(name: string, used: readonly { avatar: string; color: string }[]): { avatar: Avatar; color: AvatarColor } {
  const own = defaultAvatar(name);
  const taken = new Set(used.map((u) => u.avatar));
  const start = AVATARS.indexOf(own.avatar);
  let avatar = own.avatar;
  for (let i = 0; i < AVATARS.length; i++) {
    const a = AVATARS[(start + i) % AVATARS.length]!;
    if (!taken.has(a)) {
      avatar = a;
      break;
    }
  }
  const count = (c: string) => used.filter((u) => u.color === c).length;
  const ownAt = AVATAR_COLORS.indexOf(own.color);
  let color = own.color;
  for (let i = 0; i < AVATAR_COLORS.length; i++) {
    const c = AVATAR_COLORS[(ownAt + i) % AVATAR_COLORS.length]!;
    if (count(c) < count(color)) color = c;
  }
  return { avatar, color };
}

function choice<T extends string>(v: YamlValue | undefined, key: string, list: readonly T[], fallback: T, d: Diagnostic[], line?: number): T {
  if (v === undefined || v === "") return fallback;
  const w = typeof v === "string" ? v.trim().toLowerCase() : "";
  if ((list as readonly string[]).includes(w)) return w as T;
  const near = w ? closest(w, list) : null;
  d.push({ severity: "warning", ...(line ? { line } : {}), message: `${key} "${w.slice(0, 30)}" is not one we have; using ${fallback}.${near ? ` Did you mean "${near}"?` : ""} ${key === "avatar" ? "Avatars" : "Colors"}: ${list.join(", ")}.` });
  return fallback;
}

const FENNA_IDS = FENNA_APPS.map((a) => a.id) as readonly string[];

const isMap = (v: YamlValue | undefined): v is YamlMap => !!v && typeof v === "object" && !Array.isArray(v);
const asList = (v: YamlValue | undefined): YamlValue[] | null => (v === undefined || v === "" ? [] : Array.isArray(v) ? v : null);

function unknownKeys(map: YamlMap, allowed: readonly string[], where: string, out: Diagnostic[], line?: number) {
  for (const k of Object.keys(map)) {
    if (allowed.includes(k)) continue;
    const near = closest(k, allowed);
    out.push({
      severity: "warning",
      ...(line ? { line } : {}),
      message: `Unknown ${where} "${k}"; it is ignored.${near ? ` Did you mean "${near}"?` : ""} ${where === "setting" ? "Settings" : "Keys"}: ${allowed.join(", ")}.`,
    });
  }
}

function text(v: YamlValue | undefined, key: string, max: number, out: Diagnostic[], line?: number, required = false): string {
  const at = line ? { line } : {};
  if (v === undefined || v === "") {
    if (required) out.push({ severity: "error", ...at, message: `Add "${key}:" with a value.` });
    return "";
  }
  if (typeof v !== "string") {
    out.push({ severity: "error", ...at, message: `"${key}" should be one line of text, not a list or map.` });
    return "";
  }
  const t = v.trim();
  if (t.length > max) {
    out.push({ severity: "error", ...at, message: `"${key}" is ${t.length} characters; the most is ${max}. Shorten it.` });
    return t.slice(0, max);
  }
  return t;
}

function readGrant(v: YamlMap, name: string, out: Diagnostic[], line?: number): Grant | null {
  const at = line ? { line } : {};
  unknownKeys(v, GRANT_KEYS, `key in connector "${name}"`, out, line);
  const tools: Record<string, ToolLevel> = {};
  for (const level of TOOL_LEVELS) {
    const list = asList(v[level]);
    if (!list || list.some((t) => typeof t !== "string")) {
      out.push({ severity: "error", ...at, message: `Connector "${name}" ${level} should be a list of tool names, like [list_events, get_event].` });
      return null;
    }
    for (const raw of list as string[]) {
      const tool = raw.trim();
      if (!tool) continue;
      if (!TOOL_NAME_RE.test(tool)) {
        out.push({ severity: "error", ...at, message: `Connector "${name}" has "${tool.slice(0, 40)}" under ${level}, which is not a tool name: letters, digits, _ . - and /, up to 128 characters.` });
        return null;
      }
      const was = tools[tool];
      if (was && was !== level) {
        out.push({ severity: "error", ...at, message: `Connector "${name}" lists the tool "${tool}" under both ${was} and ${level}. Keep it in one.` });
        return null;
      }
      tools[tool] = level;
    }
  }
  if (Object.keys(tools).length > LIMITS.grantTools) {
    out.push({ severity: "error", ...at, message: `Connector "${name}" lists ${Object.keys(tools).length} tools; the most is ${LIMITS.grantTools}. Leave the rest to default.` });
    return null;
  }
  let level: ToolLevel = "ask";
  if (v.default !== undefined && v.default !== "") {
    const d = typeof v.default === "string" ? v.default.trim().toLowerCase() : "";
    if (!(TOOL_LEVELS as readonly string[]).includes(d)) {
      const near = d ? closest(d, TOOL_LEVELS) : null;
      out.push({ severity: "error", ...at, message: `Connector "${name}" default "${d.slice(0, 20)}" is not a level.${near ? ` Did you mean "${near}"?` : ""} It is what tools the connector adds later start as: ${TOOL_LEVELS.join(", ")}.` });
      return null;
    }
    level = d as ToolLevel;
  }
  return { type: "grant", name, tools, default: level };
}

function readLegacy(v: YamlMap, name: string, out: Diagnostic[], line?: number): LegacyConnector | null {
  const at = line ? { line } : {};
  if (v.command !== undefined && v.url !== undefined) {
    out.push({ severity: "error", ...at, message: `Connector "${name}" has both command and url. A connector is one or the other; install it on the Connectors page and keep only its name here.` });
    return null;
  }
  if (v.url !== undefined) {
    unknownKeys(v, URL_CONNECTOR_KEYS, `key in connector "${name}"`, out, line);
    const url = typeof v.url === "string" ? v.url.trim() : "";
    const problem = connectorUrlProblem(url);
    if (problem) {
      out.push({ severity: "error", ...at, message: `Connector "${name}": ${problem}` });
      return null;
    }
    return { type: "url", name, url };
  }
  unknownKeys(v, COMMAND_CONNECTOR_KEYS, `key in connector "${name}"`, out, line);
  const command = typeof v.command === "string" ? v.command.trim() : "";
  if (!command || command.length > 500) {
    out.push({ severity: "error", ...at, message: `Connector "${name}" command should be the program to start, like npx or a full path.` });
    return null;
  }
  const rawArgs = asList(v.args);
  if (!rawArgs || rawArgs.some((a) => typeof a !== "string") || rawArgs.length > LIMITS.args || rawArgs.some((a) => (a as string).length > LIMITS.arg)) {
    out.push({ severity: "error", ...at, message: `Connector "${name}" args should be a list of words, like [-y, some-server], at most ${LIMITS.args}.` });
    return null;
  }
  const env: Record<string, string> = {};
  if (v.env !== undefined && v.env !== "") {
    if (!isMap(v.env) || Object.keys(v.env).length > LIMITS.env) {
      out.push({ severity: "error", ...at, message: `Connector "${name}" env should be indented KEY: value lines, at most ${LIMITS.env}.` });
      return null;
    }
    for (const [k, val] of Object.entries(v.env)) {
      if (!ENV_KEY_RE.test(k) || typeof val !== "string") {
        out.push({ severity: "error", ...at, message: `Connector "${name}" env "${k}" should be NAME: value, with letters, digits and _ in the name.` });
        return null;
      }
      env[k] = val;
    }
  }
  return { type: "command", name, command, args: rawArgs as string[], env };
}

/** One connectors entry: a Fenna app, a grant, or (older files) a whole connector, which becomes a grant of the same name. */
function readConnector(v: YamlValue, i: number, out: Diagnostic[], legacy: LegacyConnector[], line?: number): Connector | null {
  const at = line ? { line } : {};
  const n = i + 1;
  if (typeof v === "string") {
    const id = v.trim();
    if (FENNA_IDS.includes(id)) return { type: "fenna", app: id as FennaAppId };
    const near = closest(id, FENNA_IDS);
    out.push({
      severity: "error",
      ...at,
      message: `Connector ${n} "${id}" is not a Fenna app.${near ? ` Did you mean "${near}"?` : ""} Fenna apps: ${FENNA_IDS.join(", ")}. For a connector installed on this computer write a map, "- name: ${/^[a-z][a-z0-9-]*$/.test(id) ? id : "calendar"}", with allow, ask and off lists of its tools.`,
    });
    return null;
  }
  if (!isMap(v)) {
    out.push({ severity: "error", ...at, message: `Connector ${n} should be a Fenna app name, or a map with the name of a connector installed on this computer.` });
    return null;
  }
  const name = typeof v.name === "string" ? v.name.trim() : "";
  const problem = connectorNameProblem(name);
  if (problem) {
    out.push({ severity: "error", ...at, message: `Connector ${n}: ${problem}` });
    return null;
  }
  if (v.command === undefined && v.url === undefined) return readGrant(v, name, out, line);
  const old = readLegacy(v, name, out, line);
  if (!old) return null;
  legacy.push(old);
  return { type: "grant", name, tools: {}, default: "ask" };
}

/** One logins entry: a map with the login's name and level, or (short form) just the name, which asks. */
function readLogin(v: YamlValue, i: number, out: Diagnostic[], line?: number): LoginGrant | null {
  const at = line ? { line } : {};
  const n = i + 1;
  const example = `"- name: example-mail" with "level: ask" (or allow) under it`;
  if (typeof v === "string") {
    const name = v.trim();
    if (!isSlug(name)) {
      out.push({ severity: "error", ...at, message: `Login ${n} "${String(name).slice(0, 40)}" is not a login name: lowercase letters, digits and dashes, as the Vault page shows it. Write ${example}.` });
      return null;
    }
    return { name, level: "ask" };
  }
  if (!isMap(v)) {
    out.push({ severity: "error", ...at, message: `Login ${n} should be a map: ${example}.` });
    return null;
  }
  const name = typeof v.name === "string" ? v.name.trim() : "";
  unknownKeys(v, LOGIN_GRANT_KEYS, `key in login "${name || n}"`, out, line);
  if (!isSlug(name)) {
    out.push({ severity: "error", ...at, message: `Login ${n} ${name ? `name "${String(name).slice(0, 40)}" is not a login name` : "has no name"}: lowercase letters, digits and dashes, as the Vault page shows it. Write ${example}.` });
    return null;
  }
  let level: LoginLevel = "ask";
  if (v.level !== undefined && v.level !== "") {
    const l = typeof v.level === "string" ? v.level.trim().toLowerCase() : "";
    if (!(LOGIN_LEVELS as readonly string[]).includes(l)) {
      const near = l ? closest(l, LOGIN_LEVELS) : null;
      out.push({ severity: "error", ...at, message: `Login "${name}" level "${l.slice(0, 20)}" is not a level.${near ? ` Did you mean "${near}"?` : ""} Levels: allow (Crew signs in without asking), ask (the person approves each time).` });
      return null;
    }
    level = l as LoginLevel;
  }
  return { name, level };
}

/** Read bot settings from parsed front matter. */
export function readBotSettings(raw: YamlMap, how: string, keyLines: Record<string, number> = {}): { bot: Bot; diagnostics: Diagnostic[]; legacy: LegacyConnector[] } {
  const d: Diagnostic[] = [];
  const ln = (k: string) => keyLines[k];
  unknownKeys(raw, BOT_KEYS, "setting", d);
  for (const w of d) {
    const k = /"([^"]+)"/.exec(w.message)?.[1];
    if (k && keyLines[k]) w.line = keyLines[k];
  }

  const name = text(raw.name, "name", LIMITS.name, d, ln("name"), true);
  const job = text(raw.job, "job", LIMITS.job, d, ln("job"), true);

  const look = defaultAvatar(name);
  const avatar = choice(raw.avatar, "avatar", AVATARS, look.avatar, d, ln("avatar"));
  const color = choice(raw.color, "color", AVATAR_COLORS, look.color, d, ln("color"));

  let schedule = "manual";
  if (raw.schedule !== undefined && raw.schedule !== "") {
    const r = parseSchedule(typeof raw.schedule === "string" ? raw.schedule : "");
    if ("error" in r) d.push({ severity: "error", ...(ln("schedule") ? { line: ln("schedule") } : {}), message: `schedule: ${r.error}` });
    else schedule = formatSchedule(r.schedule);
  }

  const brain: Brain = { cli: "claude", model: "", effort: "" };
  const at = ln("brain") ? { line: ln("brain") } : {};
  if (!isMap(raw.brain)) {
    d.push({ severity: "error", ...at, message: `Add "brain:" with an indented "cli:" line: ${CLI_KINDS.join(", ")}.` });
  } else {
    unknownKeys(raw.brain, BRAIN_KEYS, "key in brain", d, ln("brain"));
    const cli = typeof raw.brain.cli === "string" ? raw.brain.cli.trim().toLowerCase() : "";
    if ((CLI_KINDS as readonly string[]).includes(cli)) brain.cli = cli as CliKind;
    else {
      const near = cli ? closest(cli, CLI_KINDS) : null;
      d.push({ severity: "error", ...at, message: `brain.cli ${cli ? `"${cli}" is not one we run` : "is missing"}.${near ? ` Did you mean "${near}"?` : ""} Use one of: ${CLI_KINDS.join(", ")}.` });
    }
    const model = typeof raw.brain.model === "string" ? raw.brain.model.trim() : "";
    if (MODEL_RE.test(model)) brain.model = model;
    else d.push({ severity: "error", ...at, message: `brain.model "${model.slice(0, 40)}" has characters a model name can't have. Leave it empty for the default.` });
    const effort = typeof raw.brain.effort === "string" ? raw.brain.effort.trim().toLowerCase() : "";
    if (EFFORT_RE.test(effort)) brain.effort = effort;
    else d.push({ severity: "error", ...at, message: `brain.effort should be one word like low, medium or high, or empty for the default.` });
  }

  const connectors: Connector[] = [];
  const legacy: LegacyConnector[] = [];
  const rawConn = asList(raw.connectors);
  if (!rawConn) d.push({ severity: "error", ...(ln("connectors") ? { line: ln("connectors") } : {}), message: `connectors should be a list, one "- item" per line.` });
  else {
    if (rawConn.length > LIMITS.connectors) d.push({ severity: "error", ...(ln("connectors") ? { line: ln("connectors") } : {}), message: `A bot can have at most ${LIMITS.connectors} connectors; this one has ${rawConn.length}.` });
    const seen = new Set<string>();
    rawConn.slice(0, LIMITS.connectors).forEach((c, i) => {
      const conn = readConnector(c, i, d, legacy, ln("connectors"));
      if (!conn) return;
      const key = conn.type === "fenna" ? conn.app : conn.name;
      if (seen.has(key)) {
        d.push({ severity: "warning", ...(ln("connectors") ? { line: ln("connectors") } : {}), message: `Connector "${key}" is listed twice; the second is ignored.` });
        return;
      }
      seen.add(key);
      connectors.push(conn);
    });
  }

  const logins: LoginGrant[] = [];
  const rawLogins = asList(raw.logins);
  const loginAt = ln("logins") ? { line: ln("logins") } : {};
  if (!rawLogins) d.push({ severity: "error", ...loginAt, message: `logins should be a list, one "- name: example-mail" per login, with "level: allow" or "level: ask" under it.` });
  else {
    if (rawLogins.length > LIMITS.logins) d.push({ severity: "error", ...loginAt, message: `A bot can have at most ${LIMITS.logins} logins; this one has ${rawLogins.length}.` });
    rawLogins.slice(0, LIMITS.logins).forEach((v, i) => {
      const g = readLogin(v, i, d, ln("logins"));
      if (!g) return;
      if (logins.some((x) => x.name === g.name)) {
        d.push({ severity: "warning", ...loginAt, message: `Login "${g.name}" is listed twice; the second is ignored.` });
        return;
      }
      logins.push(g);
    });
  }

  const askBefore: string[] = [];
  const rawAsk = asList(raw.askBefore);
  const askAt = ln("askBefore") ? { line: ln("askBefore") } : {};
  if (!rawAsk || rawAsk.some((a) => typeof a !== "string")) d.push({ severity: "error", ...askAt, message: `askBefore should be a list of actions, one "- Sending email" per line.` });
  else {
    if (rawAsk.length > LIMITS.askBefore) d.push({ severity: "error", ...askAt, message: `askBefore can list at most ${LIMITS.askBefore} actions; this one lists ${rawAsk.length}.` });
    for (const a of rawAsk.slice(0, LIMITS.askBefore) as string[]) {
      const t = a.trim();
      if (!t) continue;
      if (t.length > LIMITS.askBeforeItem) d.push({ severity: "error", ...askAt, message: `askBefore item "${t.slice(0, 30)}…" is ${t.length} characters; the most is ${LIMITS.askBeforeItem}.` });
      askBefore.push(t.slice(0, LIMITS.askBeforeItem));
    }
  }

  let wallpaper: Wallpaper = WALLPAPERS[0];
  if (raw.wallpaper !== undefined && raw.wallpaper !== "") {
    const w = typeof raw.wallpaper === "string" ? raw.wallpaper.trim().toLowerCase() : "";
    if ((WALLPAPERS as readonly string[]).includes(w)) wallpaper = w as Wallpaper;
    else d.push({ severity: "warning", ...(ln("wallpaper") ? { line: ln("wallpaper") } : {}), message: `wallpaper "${w}" is not one we have; using ${WALLPAPERS[0]}. Wallpapers: ${WALLPAPERS.join(", ")}.` });
  }

  const body = how.trim();
  if (body.length > LIMITS.how) d.push({ severity: "error", message: `How it works is ${body.length} characters; the most is ${LIMITS.how}. Move reference material into memory.md or the library.` });

  return { bot: { name, job, avatar, color, schedule, brain, connectors, logins, askBefore, wallpaper, how: body.slice(0, LIMITS.how) }, diagnostics: d, legacy };
}

/**
 * Parse a bot.md file. `bot` is null only when there is no front matter to
 * read. `legacy` holds connectors written the older way (a whole command
 * or url); `bot.connectors` has a grant of the same name in each one's
 * place, for the app to install.
 */
export function parseBot(src: string): { bot: Bot | null; diagnostics: Diagnostic[]; legacy: LegacyConnector[] } {
  const fm = splitFrontMatter(src);
  if (!fm) {
    return {
      bot: null,
      diagnostics: [{ severity: "error", line: 1, message: `bot.md must start with a line "---", then its settings (name, job, schedule, brain…), then "---", then how it works.` }],
      legacy: [],
    };
  }
  const y = parseYaml(fm.yaml, 2);
  const r = readBotSettings(y.value, fm.body, y.keyLines);
  const diagnostics: Diagnostic[] = [...y.problems.map((p) => ({ severity: "error" as const, line: p.line, message: p.message })), ...r.diagnostics];
  return { bot: r.bot, diagnostics, legacy: r.legacy };
}

function connectorYaml(c: Connector): YamlValue {
  if (c.type === "fenna") return c.app;
  const m: YamlMap = { name: c.name };
  for (const level of TOOL_LEVELS) {
    const tools = Object.keys(c.tools).filter((t) => c.tools[t] === level);
    if (tools.length) m[level] = tools;
  }
  m.default = c.default;
  return m;
}

/** The bot's settings as front matter values, in BOT_KEYS order. */
export function botYaml(bot: Bot): YamlMap {
  const brain: YamlMap = { cli: bot.brain.cli };
  if (bot.brain.model) brain.model = bot.brain.model;
  if (bot.brain.effort) brain.effort = bot.brain.effort;
  const out: YamlMap = {
    name: bot.name,
    job: bot.job,
    avatar: bot.avatar,
    color: bot.color,
    schedule: bot.schedule,
    brain,
    connectors: bot.connectors.map(connectorYaml),
  };
  // Written only when it has some, so a bot.md without logins stays as it was.
  const logins = bot.logins ?? [];
  if (logins.length) out.logins = logins.map((g) => ({ name: g.name, level: g.level }));
  out.askBefore = [...bot.askBefore];
  out.wallpaper = bot.wallpaper;
  return out;
}

export function serializeBot(bot: Bot): string {
  const body = bot.how.trim();
  return `---\n${stringifyYaml(botYaml(bot))}---\n${body ? `\n${body}\n` : ""}`;
}

/** Check a bot built in code (from the UI or a tool call) with the same rules as a file. */
export function checkBot(bot: Bot): { bot: Bot; diagnostics: Diagnostic[] } {
  const r = readBotSettings(botYaml(bot), bot.how);
  return { bot: r.bot, diagnostics: r.diagnostics };
}

export interface NewBotInput {
  name: string;
  job: string;
  how?: string;
  avatar?: Avatar;
  color?: AvatarColor;
  schedule?: string;
  cli?: CliKind;
  model?: string;
  effort?: string;
  connectors?: Connector[];
  logins?: LoginGrant[];
  askBefore?: string[];
  wallpaper?: Wallpaper;
}

/** A bot from the few things a person says when creating one, with the defaults filled in. */
export function newBot(input: NewBotInput): { bot: Bot; diagnostics: Diagnostic[] } {
  const r = parseSchedule(input.schedule ?? "manual");
  const name = String(input.name ?? "").trim();
  const look = defaultAvatar(name);
  const draft: Bot = {
    name,
    job: String(input.job ?? "").trim(),
    avatar: input.avatar ?? look.avatar,
    color: input.color ?? look.color,
    schedule: "error" in r ? String(input.schedule) : formatSchedule(r.schedule),
    brain: { cli: input.cli ?? "claude", model: input.model ?? "", effort: input.effort ?? "" },
    connectors: input.connectors ?? FENNA_APPS.map((a) => ({ type: "fenna" as const, app: a.id })),
    logins: input.logins ?? [],
    askBefore: input.askBefore ?? [],
    wallpaper: input.wallpaper ?? WALLPAPERS[0],
    how: String(input.how ?? "").trim(),
  };
  return checkBot(draft);
}

