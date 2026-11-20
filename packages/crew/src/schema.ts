// The lists everything else reads: the app, its MCP server and the UI take
// these, never their own copies (AGENTS.md rule 1).

export const CLI_KINDS = ["claude", "codex", "antigravity"] as const;
export type CliKind = (typeof CLI_KINDS)[number];
export const CLI_NAMES: Record<CliKind, string> = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity" };

/** How a bot's face looks: resting, working (eyes move), asleep, or waiting on the person. */
export const MOODS = ["idle", "work", "sleep", "need"] as const;
export type Mood = (typeof MOODS)[number];

/** A bot's pixel-art face: one of these designs, drawn in one of AVATAR_COLORS. The UI holds the pixels. */
export const AVATARS = [
  "sprout", "pebble", "lantern", "kettle", "moth", "owl", "rover", "kite",
  "cactus", "octo", "beacon", "acorn", "comet", "shell", "cloud", "crate",
] as const;
export type Avatar = (typeof AVATARS)[number];
/** The colors a face can be; the UI maps each name to a body and a shade token in both themes. */
export const AVATAR_COLORS = ["clay", "rust", "ochre", "olive", "moss", "sea", "slate", "iris", "plum", "stone"] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

/** Desktop backgrounds a bot can have; the UI maps each name to its own token. */
export const WALLPAPERS = ["slate", "teal", "clay", "indigo", "graphite", "moss"] as const;
export type Wallpaper = (typeof WALLPAPERS)[number];

/** The Fenna apps a bot can use on the files in its library; `use` tells the bot when to pick each one. */
export const FENNA_APPS = [
  {
    id: "fenna-docs",
    name: "Fenna Docs",
    kind: "doc",
    marker: "doc.json",
    use: "Writing people read: reports, notes, letters, plans. Not for numbers in rows (Sheets) or a talk (Slides).",
  },
  {
    id: "fenna-sheets",
    name: "Fenna Sheets",
    kind: "sheet",
    marker: "sheet.json",
    use: "Rows and numbers: lists, trackers, budgets, anything to sort, total or chart.",
  },
  {
    id: "fenna-slides",
    name: "Fenna Slides",
    kind: "deck",
    marker: "deck.json",
    use: "Presenting to people: a short deck with one idea per slide.",
  },
  {
    id: "fenna-whiteboard",
    name: "Fenna Whiteboard",
    kind: "board",
    marker: "board.json",
    use: "Thinking visually: diagrams, flows, mind maps, sticky-note boards.",
  },
  {
    id: "fenna-design",
    name: "Fenna Design",
    kind: "design",
    marker: "design.json",
    use: "Visual pieces made to be looked at: a poster, social post, banner, page mock-up.",
  },
] as const;
export type FennaAppId = (typeof FENNA_APPS)[number]["id"];
export type LibraryKind = (typeof FENNA_APPS)[number]["kind"];

/** bot.md settings, in the order they are written. */
export const BOT_KEYS = ["name", "job", "avatar", "color", "schedule", "brain", "connectors", "logins", "projects", "askBefore", "wallpaper"] as const;
export const BRAIN_KEYS = ["cli", "model", "effort"] as const;
/** A bot's grant of a connector installed on this computer: its name, then tool names under allow, ask or off. */
export const GRANT_KEYS = ["name", "allow", "ask", "off", "default"] as const;
/** The older form, where a bot held a whole connector; moved to the computer's connectors on load. */
export const COMMAND_CONNECTOR_KEYS = ["name", "command", "args", "env"] as const;
export const URL_CONNECTOR_KEYS = ["name", "url"] as const;

/** How a bot may use one tool of a connector: run it, ask the person before each call, or not see it at all. */
export const TOOL_LEVELS = ["allow", "ask", "off"] as const;
export type ToolLevel = (typeof TOOL_LEVELS)[number];
/** What each level means, in the words the UI shows. */
export const TOOL_LEVEL_NOTES: Record<ToolLevel, string> = {
  allow: "Runs without asking.",
  ask: "Waits for your approval each time.",
  off: "Hidden from the bot.",
};
/** How a connector is reached: a program this computer starts, or a server on the web. */
export const CONNECTOR_TYPES = ["command", "url"] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];
export const TEAM_KEYS = ["name", "lead", "members"] as const;

/** A bot's grant of one vault login: its name and level. */
export const LOGIN_GRANT_KEYS = ["name", "level"] as const;
/** How a bot may use a login from the vault: Crew fills it without asking, or asks the person each time. Not granted: the bot can't see it. */
export const LOGIN_LEVELS = ["allow", "ask"] as const;
export type LoginLevel = (typeof LOGIN_LEVELS)[number];
/** What each level means, in the words the UI shows. */
export const LOGIN_LEVEL_NOTES: Record<LoginLevel, string> = {
  allow: "Fills it in without asking.",
  ask: "Waits for your approval each time.",
};
/** Whether a bot may run node, npm and npx in its projects (off unless the person turns it on). */
export const PROJECTS_LEVELS = ["on", "off"] as const;
export type ProjectsLevel = (typeof PROJECTS_LEVELS)[number];
/** The hash a sign-in code (TOTP, RFC 6238) is made with. */
export const TOTP_ALGORITHMS = ["SHA1", "SHA256", "SHA512"] as const;
export type TotpAlgorithm = (typeof TOTP_ALGORITHMS)[number];

export const LIMITS = {
  name: 40,
  job: 200,
  how: 20_000,
  askBefore: 20,
  askBeforeItem: 120,
  connectors: 20,
  grantTools: 500,
  connectorTools: 500,
  toolDescription: 4000,
  headers: 40,
  args: 40,
  arg: 1000,
  env: 40,
  teamMembers: 12,
  status: 140,
  memory: 200_000,
  /** Tabs one bot's browser can have open. */
  browserTabs: 8,
  /** Logins one bot can be granted. */
  logins: 20,
  /** Files one hand-off between bots may copy (folders count the files inside), and its size in MB. */
  handoffFiles: 20,
  handoffMB: 500,
  vaultItems: 500,
  vaultLabel: 80,
  vaultOrigins: 10,
  vaultUsername: 200,
  vaultPassword: 1000,
  vaultNotes: 2000,
} as const;

/** Model and effort are passed to a CLI on its command line, so they are held to safe characters. */
export const MODEL_RE = /^[\w.:@/[\]-]{0,80}$/;
export const EFFORT_RE = /^[a-z]{0,12}$/;
export const CONNECTOR_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** An HTTP header name (RFC 9110 token). */
export const HEADER_KEY_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
/** A tool name as MCP servers give them. */
export const TOOL_NAME_RE = /^[A-Za-z0-9_./-]{1,128}$/;
/** Names the app gives its own servers; a connector can't take them. */
export const RESERVED_SERVERS = ["crew", "browser", "fenna", "gateway"] as const;

export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  line?: number;
}
