// The contract between Fenna Crew's main process and its page. Every call
// the page makes and every event it receives is typed here; the README's
// "IPC contract" section says the same in words. The page talks through
// the shell's preload (window.shell.invoke / send / on); api.ts wraps it.

import type { ApprovalSource, Avatar, AvatarColor, Bot, CliKind, Connector, ConnectorTool, ConnectorType, Diagnostic, FennaAppId, Grant, LibraryKind, LoginGrant, LoginLevel, Mood, NewBotInput, RunEvent, RunTrigger, Team, ThreadMessage, ToolLevel, VaultItemInput, Wallpaper } from "@opendeck/crew";

export type { ApprovalSource, Avatar, AvatarColor, Bot, CliKind, Connector, ConnectorTool, ConnectorType, Diagnostic, Grant, LibraryKind, LoginGrant, LoginLevel, Mood, NewBotInput, RunEvent, RunTrigger, Team, ThreadMessage, ToolLevel, VaultItemInput, Wallpaper };

/** The page size of a bot's browser while nobody watches it live, in CSS pixels. While the person watches, it follows their view (crew:viewport). */
export const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

// ── Overview: everything the sidebar, the crew grid and the banner need ──

export interface BotSummary {
  slug: string;
  name: string;
  job: string;
  /** The pixel-art face and its color (from bot.md, or chosen from the name when it leaves them out). */
  avatar: Avatar;
  color: AvatarColor;
  /** The face: need (waiting on the person) > work (running or queued) > sleep (next run over an hour away) > idle. */
  mood: Mood;
  /** One line under the name, ready to show: "Needs you: approve Send the reply", "Asleep until Fri 17:00", the bot's own status… */
  statusLine: string;
  /** The bot's own last status (set_status, or its last reply's first line). */
  status: string;
  /** The schedule line as bot.md keeps it ("weekdays 09:00, 13:00"). */
  schedule: string;
  /** In plain words ("Weekdays at 09:00 and 13:00"). */
  scheduleLabel: string;
  /** ISO time of the next scheduled run, or null (manual). */
  nextRun: string | null;
  lastRunAt: string | null;
  running: boolean;
  /** The chat the running run belongs to. */
  runningChat: string | null;
  queued: boolean;
  /** How many asks and approvals wait on the person. */
  needs: number;
  wallpaper: Wallpaper;
  brain: Bot["brain"];
  /** Slugs of the teams this bot leads. */
  leads: string[];
  /** Slugs of the teams this bot is in (as lead or member). */
  teams: string[];
  /** bot.md problems; a bot with an error can't run until it is fixed. */
  diagnostics: Diagnostic[];
  /** The bot's browser, if it has been opened since the app started. */
  browser: BrowserState | null;
  /** The person's chat new messages go to. */
  currentChat: string;
  /** The runs chat (id "runs") first, then the person's chats, oldest first. */
  chats: ChatSummary[];
}

export interface ChatSummary {
  id: string;
  /** The first words the person wrote; "" for the runs chat and a new chat. */
  title: string;
  startedAt: string | null;
  /** How full its context was after its last run (Claude Code reports it). */
  usage: { used: number; window: number | null; at: string } | null;
  /** It was compacted: it continues from a summary. */
  compacted: boolean;
}

export interface TeamSummary {
  slug: string;
  name: string;
  lead: string;
  members: string[];
  purpose: string;
  diagnostics: Diagnostic[];
}

export type Waiting =
  | { id: string; kind: "ask"; slug: string; botName: string; runId: string; at: string; expiresAt: string; question: string; options: string[]; multi: boolean }
  | { id: string; kind: "approval"; slug: string; botName: string; runId: string; at: string; expiresAt: string; action: string; details: string; source: ApprovalSource; tool: string | null };

/**
 * The person sent a sign-in form while in control of a bot's browser: Crew
 * offers to save it to the vault for that bot. The password stays in the
 * main process; the page never gets it.
 */
export interface SaveOffer {
  id: string;
  slug: string;
  botName: string;
  origin: string;
  /** As the form had it ("" when the page had no username field). */
  username: string;
  /** A login already in the vault for this site and username (saving updates its password), or null. */
  existing: string | null;
  at: string;
}

export interface Settings {
  /** Start Crew (hidden, in the tray) when the person signs in to the computer. */
  openAtLogin: boolean;
  /** Show a system notification when a bot waits on the person and the window is out of sight. */
  notifications: boolean;
  /** At most this many runs at once (1 to 4); the rest queue. Read when Crew starts. */
  maxConcurrent: number;
  /** The New bot form starts with this CLI, model and effort ("" is the CLI's own choice). */
  defaultCli: CliKind;
  defaultModel: string;
  defaultEffort: string;
  /** Send an anonymous count once a day (PRIVACY.md). Off when FENNA_NO_USAGE=1. */
  usageCounts: boolean;
  /** The person has answered the first-start notice about the counts. */
  /** FENNA_NO_USAGE=1 is set: counts are off and the switch can't change it (read only). */
  usageLocked: boolean;
  /** Where Crew keeps its files (read only). */
  storagePath: string;
  /** The vault is encrypted with the system's secure storage (read only). */
  vaultEncrypted: boolean;
}

export interface WorkspaceFile {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  edited: string;
}

export interface Overview {
  bots: BotSummary[];
  teams: TeamSummary[];
  /** Everything waiting on the person, oldest first: the banner and the badges. */
  waiting: Waiting[];
  /** Logins the person sent while in control, waiting for Save or Not now (forgotten after 10 minutes). */
  offers: SaveOffer[];
  /** Slugs in the order they will run. */
  queue: string[];
  settings: Settings;
  /** No bot has run yet: show the welcome (Fenna greets the person). */
  firstLaunch: boolean;
}

// ── One bot ────────────────────────────────────────────────────────────

export interface LibraryItem {
  /** Folder name inside the bot's library. */
  path: string;
  kind: LibraryKind;
  title: string;
  /** ISO time it last changed. */
  edited: string;
}

// ── Apps a bot makes (Files/Apps/<name>/, see docs/spec/crew-apps.md) ──

/** What an app asks for, and what a grant gives it. */
export interface AppGrant {
  documents: "none" | "read" | "write";
  /** Exact origins, like https://api.example.com. */
  network: string[];
  /** The app may send the bot a message. */
  bot: boolean;
}

/** One tool an app defines for the bot; `input` is a JSON Schema object. */
export interface AppToolDef {
  name: string;
  description: string;
  input: Record<string, unknown>;
}

/** An app's app.json, as checked. */
export interface AppManifest {
  name: string;
  title: string;
  icon: string;
  entry: string;
  description: string;
  permissions: AppGrant;
  tools: AppToolDef[];
}

/** One app of a bot, for the person's view. */
export interface AppInfo {
  name: string;
  title: string;
  icon: string;
  description: string;
  entry: string;
  /** What is wrong with app.json; with any problem the app does not run. */
  problems: string[];
  /** What the person allowed, or null. */
  grant: AppGrant | null;
  /** The manifest asks for more than the grant allows: the app waits for the person. */
  pending: boolean;
  /** What the manifest asks for: the grant to allow. */
  permissions: AppGrant;
  tools: AppToolDef[];
  /** ISO time its files last changed. */
  updatedAt: string;
}

/** The windows built into a bot's computer that a desktop shortcut can open. */
export const DESKTOP_APPS = ["browser", "files", "library", "terminal", "activity", "clock", "connectors", "trash", "processes", "console", "code"] as const;
export type DesktopApp = (typeof DESKTOP_APPS)[number];
export const DESKTOP_MAX = 48;
export const SHORTCUT_LABEL_MAX = 40;

/**
 * One icon on a bot's desktop, in grid order. The person and the bot both
 * add, rename, move and remove them; they are kept in the bot's folder
 * (desktop.json). app opens a built-in window, fenna opens the Library on
 * that kind, web opens the URL in the bot's browser, doc opens a library
 * document in its editor.
 */
export type DesktopShortcut = (
  | { id: string; kind: "app"; app: DesktopApp; label: string }
  | { id: string; kind: "fenna"; app: FennaAppId; label: string }
  | { id: string; kind: "web"; url: string; label: string }
  | { id: string; kind: "doc"; path: string; label: string }
  | { id: string; kind: "userapp"; app: string; label: string }
) & {
  /** Where the person put it on the desktop grid (0-based column and row); unset icons fill the first free cells. */
  pos?: { col: number; row: number };
};

// ── The bot's disk ─────────────────────────────────────────────────────
// A bot's computer has one disk: its own folder, shown as top folders
// Files (its workspace), Documents (its library of Fenna documents),
// Downloads (Files/downloads) and Trash. Paths in these calls are disk paths
// with "/" ("Files/notes/a.txt", "Documents/q3-report"); Crew resolves them
// inside the bot's folder and refuses anything else.

export const DISK_ROOTS = ["Files", "Documents", "Downloads", "Trash"] as const;
export type DiskRoot = (typeof DISK_ROOTS)[number];
/** On a bot's disk: "table" is a spreadsheet or delimited file (csv, tsv, xlsx, xls); "code" includes json. */
export const FILE_KINDS = ["folder", "doc", "sheet", "deck", "board", "design", "image", "video", "audio", "pdf", "text", "table", "code", "archive", "other"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
/** Disk sizes the person can give a bot, in GB. */
export const DISK_QUOTAS_GB = [1, 2, 5, 10, 20, 50] as const;

export interface DiskEntry {
  /** Disk path, e.g. "Files/notes/a.txt". A Fenna document is one entry (not a folder) under Documents. */
  path: string;
  name: string;
  kind: FileKind;
  size: number;
  /** ISO time it last changed. */
  edited: string;
  /** For a Fenna document: its title. */
  title?: string;
  /** For an entry in Trash: where it came from. */
  from?: string;
}

export interface DiskListing {
  entries: DiskEntry[];
  /** Bytes the bot's disk uses, and its size. */
  used: number;
  quota: number;
}

/** A file the bot changed in the last 15 minutes (write_file, edit_file), newest first in the list. */
export interface RecentEdit {
  /** Disk path, e.g. "Files/Apps/todo/index.html". */
  path: string;
  /** ISO time of the bot's latest change to it. */
  at: string;
  /** The changed lines, 1-based and inclusive: [from, to]. */
  lines: [number, number][];
}

export type DiskOp =
  | { op: "mkdir"; path: string }
  | { op: "rename"; path: string; name: string }
  | { op: "move"; paths: string[]; to: string }
  | { op: "copy"; paths: string[]; to: string }
  | { op: "trash"; paths: string[] }
  | { op: "restore"; paths: string[] }
  | { op: "emptyTrash" }
  /** Files the person dropped in from their computer (bytes, at most 200 MB each). */
  | { op: "import"; to: string; files: { name: string; bytes: ArrayBuffer }[] };

// ── Watches, timers and todos ─────────────────────────────────────────
// A bot waits for things without looking: Crew watches and wakes it (a run
// with trigger "watch") when one fires. Kept in the bot's folder
// (watches.json, todos.json); the bot manages them with its watch and todo
// tools, the person sees and removes them in the bot's Details.

export const WATCH_KINDS = ["notification", "element", "page", "timer"] as const;
/** A command the bot started in one of its projects (projects.cjs). `tail` is the end of its output. */
export interface ProcessInfo {
  id: string;
  slug: string;
  /** The project's folder name, under Files/Projects. */
  project: string;
  command: string;
  background: boolean;
  status: "running" | "exited" | "stopped" | "failed";
  exitCode: number | null;
  /** The port it listens on, once its output names one. */
  port: number | null;
  startedAt: string;
  endedAt: string | null;
  tail: string;
}

export type WatchKind = (typeof WATCH_KINDS)[number];
/** The most watches a bot can have, and the shortest page check interval in minutes. */
export const WATCH_MAX = 20;
export const PAGE_EVERY_MIN = 5;

/**
 * notification: a site in the bot's browser shows a notification (origin, optional text it must contain).
 * element: the text of one element on an open tab changes (selector found from a snapshot ref when added).
 * page: a web address, loaded every `every` minutes; fires when its text changes.
 * timer: fires once at `at` (ISO), or every `every` minutes when repeat.
 */
export type WatchSpec =
  | { kind: "notification"; origin: string; match?: string }
  | { kind: "element"; origin: string; url: string; selector: string }
  | { kind: "page"; url: string; every: number }
  | { kind: "timer"; at: string; every?: number };

export type Watch = WatchSpec & {
  id: string;
  /** What the bot should do when it fires, in its own words (shown to it on wake). */
  note: string;
  created: string;
  /** ISO time it last fired, and how many times. */
  fired: string | null;
  count: number;
  /** For element and page: the text seen last (capped at 4 KB). */
  last?: string;
  /** The chat it was set in: its wake-ups show there. */
  chat?: string;
  /** For notification and element: whether a tab on its site is open, so Crew can hear it. */
  listening?: boolean;
};

/** A site notification seen in a bot's browser. */
export interface SiteNotification {
  origin: string;
  title: string;
  body: string;
  at: string;
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  /** Optional ISO date it is due. */
  due?: string;
  created: string;
}

// ── The bot's terminal, search and replay ──────────────────────────────

/** One command in a bot's terminal, typed by the person or run by the bot (its terminal tool). */
export interface TermEntry {
  id: string;
  at: string;
  who: "person" | "bot";
  /** The folder it ran in, as a disk path. */
  cwd: string;
  line: string;
  out: string;
  ok: boolean;
}

export interface SearchHit {
  entry: DiskEntry;
  /** A line of text around the match, for text files and documents. */
  snippet?: string;
}

/** One step of a run, for the replay: what the bot did and how its browser looked just after. */
export interface ReplayStep {
  at: string;
  label: string;
  /** A small picture of the bot's browser after the step (a crewfile: URL), when it was browsing. */
  frame?: string;
  url?: string;
}

/** A library document opened in its editor inside the bot's computer. */
export interface EditorOpen {
  /** The editor page to load into the webview (a file: URL). */
  src: string;
  kind: LibraryKind;
  title: string;
}

/** A library file as read-only plain text (up to 200 KB) with a one-line summary; decks have no text. */
export interface LibraryText {
  text: string;
  summary: string;
  truncated: boolean;
}

export interface RunSummary {
  /** The run file's name, used to page history. */
  file: string;
  at: string;
  trigger: RunTrigger;
  /** What started it: the person's words, the hand-off, or "" for a schedule. */
  text: string;
  outcome: "done" | "error" | "stopped" | "running";
  /** The run's last reply, first 300 characters. */
  reply: string;
}

export interface BotDetail {
  summary: BotSummary;
  /** The settings as bot.md holds them (bot.how is the body); null when bot.md has no front matter to read (see summary.diagnostics). */
  bot: Bot | null;
  memory: string;
  library: LibraryItem[];
  /** The 20 most recent runs, newest first. */
  runs: RunSummary[];
  /** Where the bot's folder is on disk. */
  folder: string;
}

export interface HistoryPage {
  /** The chat these runs belong to. */
  chat: string;
  /** Oldest first; each run's events in order. */
  runs: { file: string; events: RunEvent[] }[];
  /** There are older runs: pass the first file as `before` to get them. */
  more: boolean;
}

// ── Live events ────────────────────────────────────────────────────────

/** A run event as it happens (the same objects the run log keeps), or streamed text. */
export interface LiveEvent {
  slug: string;
  runId: string;
  event: RunEvent | { type: "delta"; at: string; text: string };
}

/** One tab of a bot's browser. */
export interface BrowserTab {
  /** Stable while the tab is open; never reused for another tab of this bot. */
  id: number;
  /** "" for an empty tab. */
  url: string;
  /** "" when the page has none. */
  title: string;
  loading: boolean;
  /** The page's icon as a small data: URL, or null. */
  favicon: string | null;
  /** The page is making sound (whether or not it is heard). */
  audible: boolean;
  /** The person muted this tab. */
  muted: boolean;
  /** Its sound reaches the speakers now: audible, the bot's computer is open in a visible window, and nothing is muted. */
  heard: boolean;
}

/** A bot's browser. url, title, loading, canGoBack and canGoForward are the active tab's. */
export interface BrowserState {
  url: string;
  title: string;
  loading: boolean;
  /** The person has control: the bot's browser tools are paused. */
  control: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Open tabs, in order (at most LIMITS.browserTabs). Empty before the browser has opened. */
  tabs: BrowserTab[];
  /** The tab the bot acts on and the screen shows; null with no tabs. */
  active: number | null;
  /** The size the pages lay out at, in CSS pixels. Cursor positions and input use it. */
  view: { width: number; height: number };
  /** The person muted the whole bot. Sound is heard only while its computer is open in a visible window, and never from what is muted. */
  muted: boolean;
}

/** The person's view of a bot's screen: its size in CSS pixels and the screen's pixel ratio. */
export interface ViewportSize {
  width: number;
  height: number;
  scale: number;
}

/** Where the bot is about to act, in page pixels (BrowserState.view), so the page can move its cursor there. */
export interface CursorEvent {
  slug: string;
  /** The tab it acts in. */
  tab: number | null;
  x: number;
  y: number;
  action: "click" | "type" | "scroll" | "press" | "open";
  /** What it is acting on, short: "link “More information”". */
  target: string;
}

export interface FrameEvent {
  slug: string;
  /** The tab it shows (always the active one). */
  tab: number;
  /** A JPEG of the page: thumbnails (320 wide), and live frames only when the GPU gives no texture. Live frames normally arrive as GPU textures drawn straight onto <canvas data-live="<slug>"> by the shell's preload, which then fires "liveframe" with data-view-width and data-view-height. */
  jpeg: Uint8Array;
  /** The JPEG's size in pixels. */
  width: number;
  height: number;
  /** The page's size in CSS pixels when it was painted: map input and the cursor with these. */
  viewWidth: number;
  viewHeight: number;
  kind: "live" | "thumb";
}

export type WatchMode = "live" | "thumb" | "off";

/** The person's mouse and keys, sent while in control. x and y are page pixels (BrowserState.view). */
export type ControlInput =
  | { type: "mouseDown" | "mouseUp"; x: number; y: number; button: "left" | "right" | "middle"; clickCount: number; modifiers?: Modifier[] }
  | { type: "mouseMove"; x: number; y: number; modifiers?: Modifier[] }
  | { type: "mouseWheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "keyDown" | "keyUp"; key: string; modifiers?: Modifier[] }
  | { type: "char"; key: string; modifiers?: Modifier[] };
export type Modifier = "shift" | "control" | "alt" | "meta";

// ── Connectors and CLIs ────────────────────────────────────────────────
// Connectors are installed once on this computer (<userData>/Crew/connectors)
// and granted to bots in bot.md (Grant: per-tool allow / ask / off). Bots
// reach them only through Crew's gateway.

/** An environment value or header as the page sees it. A secret's value is never sent: value is "" and set says whether one is saved. */
export interface ConnectorValueView {
  key: string;
  value: string;
  secret: boolean;
  set: boolean;
}

/** A web connector's sign-in, as the page may see it (never a token). */
export interface ConnectorAuth {
  /** The server signs people in with OAuth (Sign in / Sign out apply). */
  oauth: boolean;
  signedIn: boolean;
  /** Who signed in, when the server says; "" otherwise. */
  account: string;
  /** A client ID the person pasted, or "" when Crew registered itself. */
  clientId: string;
  /** Waiting for the person to finish signing in in their browser. */
  signingIn: boolean;
}

/** "starting": Crew is starting it now; "untested": saved but never started. */
export type ConnectorState = "ready" | "error" | "untested" | "starting";

export interface ConnectorView {
  name: string;
  type: ConnectorType;
  command: string;
  args: string[];
  url: string;
  env: ConnectorValueView[];
  headers: ConnectorValueView[];
  auth: ConnectorAuth;
  /** "command", "url", "registry <server name>", or "bot <slug>" (moved out of an older bot.md). */
  origin: string;
  /** As last seen; readOnly and destructive are the tool's own hints. */
  tools: ConnectorTool[];
  status: ConnectorState;
  /** Why it last failed, saying how to fix it ("" when it didn't). */
  error: string;
  checkedAt: string | null;
  /** Its program (or web session) is up now, for the bots using it. */
  running: boolean;
  /** Bots it is granted to. */
  usedBy: { slug: string; name: string }[];
}

/**
 * A value as the person types it. A secret is sent once, in its plain text,
 * and stored encrypted; when editing, keep: true with value "" leaves the
 * saved one as it is.
 */
export interface ConnectorValueInput {
  key: string;
  value: string;
  secret: boolean;
  keep?: boolean;
}

/** What the add and edit forms send. command and args for "command", url and headers for "url". */
export interface ConnectorInput {
  name: string;
  type: ConnectorType;
  command?: string;
  args?: string[];
  env?: ConnectorValueInput[];
  url?: string;
  headers?: ConnectorValueInput[];
  /** url only: a client ID for servers that don't let apps register themselves. */
  oauth?: { clientId: string };
  origin?: string;
}

/** After saving: the connector (null when it couldn't connect and wasn't saved) and why it couldn't connect ("" when it did). */
export interface ConnectorSaveResult {
  connector: ConnectorView | null;
  error: string;
  /** The server asks the person to sign in: it was saved, and crew:connectorSignIn comes next. */
  needsSignIn: boolean;
}

/** After signing in: the connector as it is now, why it didn't work ("" when it did), and whether the server needs a pasted client ID. */
export interface ConnectorSignInResult {
  connector: ConnectorView;
  error: string;
  needsClientId: boolean;
}

// ── Skills ─────────────────────────────────────────────────────────────
// Skills installed on this computer (<userData>/Crew/skills/<name>/): the open
// Agent Skills format, a folder with SKILL.md. A bot is granted some by name
// in bot.md; before its run they are copied onto its disk at Files/Skills/<name>/.

export interface SkillFile {
  path: string;
  size: number;
}

/** An installed skill as the page sees it. */
export interface SkillView {
  name: string;
  description: string;
  files: SkillFile[];
  size: number;
  /** Bots granted it. */
  usedBy: { slug: string; name: string }[];
}

/** An installed skill in full: its instructions (SKILL.md after its front matter) as well. */
export interface SkillDetail extends SkillView {
  body: string;
}

/** A skill read from a folder, a file or an address, shown in full before it is added. Add it with crew:skillAdd(id). */
export interface SkillPreview {
  id: string;
  name: string;
  description: string;
  body: string;
  files: SkillFile[];
  size: number;
  /** A skill of this name is installed; adding replaces it. */
  replaces: boolean;
}

// ── The vault ──────────────────────────────────────────────────────────
// The person's site logins, once per computer (<userData>/Crew/vault.dat,
// encrypted). Bots are granted them by name in bot.md (LoginGrant: allow or
// ask); Crew fills them into the page, so no bot ever sees a password.

/** A login as the page sees it: never a secret. */
export interface VaultItemView {
  name: string;
  label: string;
  origins: string[];
  username: string;
  /** Always MASK ("••••••••") when there is one, "" otherwise: the page never gets the password from here (Reveal asks for it). */
  password: string;
  hasPassword: boolean;
  /** It has a 2-factor setup key, so Crew can fill sign-in codes. */
  hasTotp: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  /** Bots granted it, and at which level. */
  usedBy: { slug: string; name: string; level: LoginLevel }[];
}

export interface RegistryEntry {
  name: string;
  title: string;
  description: string;
  version: string;
  repository: string | null;
  /** A connector to fill in and install, or null when the server has nothing Crew can start. */
  connector: ConnectorInput | null;
  /** Why connector is null, or what still needs doing (a value to fill in, a program it needs). */
  note: string;
}

export interface CliStatus {
  kind: CliKind;
  name: string;
  installed: boolean;
  signedIn: boolean | null;
  version: string | null;
  account: { email: string | null; plan: string | null } | null;
  /** `local`: a model this computer serves (Ollama, LM Studio), run through Codex. */
  models: { value: string; label: string; description: string; efforts: string[]; defaultEffort: string | null; local?: { provider: "ollama" | "lmstudio"; sizeBytes: number | null; paramsB: number | null } }[];
}

/** The Usage page's range: the last 7 days, the last 30 days, or the last 12 weeks. */
export type UsageRange = "7d" | "30d" | "12w";

/** Numbers from the runs' logs (runstats.cjs). A null means no run reported it, never zero. */
export interface UsageRow {
  runs: number;
  ok: number;
  failed: number;
  stopped: number;
  /** Runs with no end line: still running, or cut off when Crew quit. */
  unfinished: number;
  /** Time from start to end, over the runs that ended. */
  ms: number;
  /** Input (cached input included) and output tokens, summed over the runs that reported them. */
  tokens: { input: number; output: number } | null;
  /** How many runs reported tokens. */
  tokenRuns: number;
  /** The CLI's API-equivalent cost estimate, summed over the runs that reported one. Not what a plan bills. */
  costUsd: number | null;
}

export interface UsageCli extends UsageRow {
  cli: CliKind;
  name: string;
}

export interface UsageBot {
  slug: string;
  name: string;
  runs: number;
  ms: number;
  /** The CLI this bot ran with most often in the range. */
  cli: CliKind | null;
}

export interface UsageBucket {
  /** Local midnight of the day, or of the Monday of the week. */
  start: number;
  runs: number;
  ms: number;
}

export interface LimitHit {
  /** When the run stopped. */
  at: string;
  slug: string;
  name: string;
  cli: CliKind;
  message: string;
  /** When the message states a reset time, the next such time; else null. */
  resetsAt: string | null;
}

export interface RunStats {
  range: UsageRange;
  generatedAt: string;
  /** Every run the bots have, in all time (not only the range). */
  runsEver: number;
  totals: UsageRow & { limitHits: number };
  clis: UsageCli[];
  bots: UsageBot[];
  /** The last 30 days, oldest first. */
  days: UsageBucket[];
  /** The last 12 weeks, oldest first. */
  weeks: UsageBucket[];
  /** Newest first, at most 200. */
  limitHits: LimitHit[];
}

/** One fact to bring into a bot's memory. category is one of the import categories, or "other". */
export interface MemoryFact {
  category: string;
  text: string;
}

/** What a piece of text held: the facts, how many secret-looking lines were left out, how many were past the cap. */
export interface MemoryParse {
  format: "fenna" | "json" | "text" | "empty";
  facts: MemoryFact[];
  secretsLeftOut: number;
  tooMany: number;
}

/** A memory file a CLI on this computer keeps, found by a scan (never read until ticked). */
export interface MemorySource {
  id: string;
  group: string;
  label: string;
  path: string;
  size: number;
}

/** A ticked memory file, read: its heading source, its facts, or the reason it could not be read. */
export interface MemoryRead extends MemoryParse {
  id: string;
  source: string;
  error?: string;
}

/** Facts to add, grouped by where they came from (one dated heading each in memory.md). */
export interface MemoryImportGroup {
  source: string;
  facts: MemoryFact[];
}

// ── Calls ──────────────────────────────────────────────────────────────

/** Every invoke channel: arguments and what it resolves to. Errors reject with a message to show. */
export interface Calls {
  "crew:overview": { args: []; result: Overview };
  "crew:bot": { args: [slug: string]; result: BotDetail };
  "crew:history": { args: [slug: string, opts?: { before?: string; limit?: number; chat?: string }]; result: HistoryPage };
  "crew:create": { args: [input: NewBotInput]; result: { slug: string } };
  "crew:update": { args: [slug: string, patch: Partial<Bot>]; result: BotDetail };
  "crew:delete": { args: [slug: string]; result: true };
  /** A message to the bot; when the bot is waiting on its question, the message answers it (answered: true) instead of starting a run. */
  "crew:send": { args: [slug: string, text: string, chat?: string, files?: { name: string; bytes: ArrayBuffer }[]]; result: { runId: string; queued: boolean; answered?: boolean } };
  "crew:newChat": { args: [slug: string]; result: string };
  "crew:openChat": { args: [slug: string, chat: string]; result: true };
  "crew:compact": { args: [slug: string, chat: string]; result: { runId: string } };
  "crew:run": { args: [slug: string]; result: { runId: string; queued: boolean } };
  "crew:greet": { args: []; result: { runId: string } | null };
  "crew:stop": { args: [slug: string]; result: boolean };
  "crew:answer": { args: [id: string, answer: string[]]; result: boolean };
  "crew:decide": { args: [id: string, allowed: boolean, always?: boolean]; result: boolean };
  "crew:forget": { args: [slug: string]; result: true };
  /** A copy of the bot ("<Name> copy"): same settings and memory, a new face; no runs or library. */
  "crew:duplicate": { args: [slug: string]; result: { slug: string } };
  /** Asks where to save, then writes the chat as Markdown. The saved path, or null when the person cancels. */
  "crew:exportChat": { args: [slug: string]; result: string | null };
  "crew:teamCreate": { args: [team: Team]; result: { slug: string } };
  "crew:teamUpdate": { args: [slug: string, patch: Partial<Team>]; result: TeamSummary };
  "crew:teamDelete": { args: [slug: string]; result: true };
  "crew:teamSend": { args: [slug: string, text: string]; result: { runId: string; queued: boolean } };
  "crew:teamThread": { args: [slug: string]; result: ThreadMessage[] };
  "crew:registrySearch": { args: [query: string]; result: RegistryEntry[] };
  "crew:connectors": { args: []; result: ConnectorView[] };
  "crew:connectorSave": { args: [input: ConnectorInput, opts?: { replace?: string; force?: boolean }]; result: ConnectorSaveResult };
  "crew:connectorTest": { args: [name: string]; result: ConnectorView };
  "crew:connectorSignIn": { args: [name: string, opts?: { clientId?: string }]; result: ConnectorSignInResult };
  "crew:connectorSignInCancel": { args: [name: string]; result: boolean };
  "crew:connectorSignOut": { args: [name: string]; result: ConnectorView };
  "crew:connectorRemove": { args: [name: string]; result: { bots: string[] } };
  "crew:skills": { args: []; result: SkillView[] };
  "crew:skill": { args: [name: string]; result: SkillDetail };
  /** The pickers: the preview of what the person chose, or null when they cancel. */
  "crew:skillFolder": { args: []; result: SkillPreview | null };
  "crew:skillFile": { args: []; result: SkillPreview | null };
  /** An https address: a raw SKILL.md, or a GitHub folder (…/tree/…). */
  "crew:skillUrl": { args: [url: string]; result: SkillPreview };
  "crew:skillAdd": { args: [id: string]; result: SkillView };
  "crew:skillRemove": { args: [name: string]; result: { bots: string[] } };
  "crew:vault": { args: []; result: VaultItemView[] };
  "crew:vaultSave": { args: [input: VaultItemInput, opts?: { replace?: string }]; result: VaultItemView };
  "crew:vaultRemove": { args: [name: string]; result: { bots: string[] } };
  "crew:vaultReveal": { args: [name: string]; result: { password: string } };
  "crew:vaultCopy": { args: [name: string, what: "username" | "password" | "code"]; result: { copied: true; clearsIn: number | null; secondsLeft: number | null } };
  "crew:siteIcon": { args: [origin: string]; result: string | null };
  "crew:saveOffer": { args: [id: string, save: boolean, opts?: { username?: string }]; result: { item: VaultItemView | null } };
  "crew:reveal": { args: [slug: string, path?: string]; result: true };
  "crew:watch": { args: [slug: string, mode: WatchMode]; result: BrowserState };
  "crew:control": { args: [slug: string, on: boolean]; result: BrowserState };
  "crew:navigate": { args: [slug: string, url: string]; result: BrowserState };
  "crew:browserGo": { args: [slug: string, what: "back" | "forward" | "reload" | "stop"]; result: BrowserState };
  "crew:mute": { args: [slug: string, tab: number | null, muted: boolean]; result: BrowserState };
  "crew:meetings": { args: []; result: MeetingView[] };
  "crew:meeting": { args: [slug: string, action: "leave" | "stop_sharing"]; result: MeetingView | null };
  "crew:accounts": { args: []; result: AccountView[] };
  "crew:account": { args: [slug: string, action: "check" | "sign_in" | "sign_out"]; result: AccountView | null };
  "crew:closeBrowser": { args: [slug: string]; result: boolean };
  "crew:tab": { args: [slug: string, action: "new" | "switch" | "close", id?: number]; result: BrowserState };
  "crew:settings": { args: []; result: Settings };
  "crew:setSettings": { args: [patch: Partial<Settings>]; result: Settings };
  /** The first-start notice about usage counts: OK, Turn off, or open the page that lists what is sent. */
  "crew:usageDetails": { args: []; result: true };
  /** Send feedback; rejects with what to tell the person when it could not be sent. */
  "crew:feedback": { args: [input: { rating: "up" | "down" | null; text: string }]; result: boolean };
  "crew:libraryText": { args: [slug: string, id: string]; result: LibraryText };
  "crew:workspace": { args: [slug: string]; result: WorkspaceFile[] };
  "crew:workspaceRead": { args: [slug: string, relPath: string]; result: string };
  "crew:workspaceWrite": { args: [slug: string, relPath: string, content: string]; result: { path: string; size: number; edited: string } };
  "crew:workspaceReveal": { args: [slug: string, relPath?: string]; result: boolean };
  "crew:clis": { args: [fresh?: boolean]; result: CliStatus[] };
  /** The Usage page: runs, time, tokens and cost per CLI and bot, the day and week buckets, and limit hits. */
  "crew:runStats": { args: [range?: UsageRange]; result: RunStats };
  "crew:memoryPrompt": { args: []; result: string };
  "crew:memoryParse": { args: [text: string]; result: MemoryParse };
  "crew:memoryScan": { args: []; result: MemorySource[] };
  "crew:memoryRead": { args: [ids: string[]]; result: MemoryRead[] };
  "crew:memoryImport": { args: [slugs: string[], groups: MemoryImportGroup[]]; result: { bots: { slug: string; added: number; skipped: number }[] } };
  "crew:desktop": { args: [slug: string]; result: DesktopShortcut[] };
  "crew:watches": { args: [slug: string]; result: { watches: Watch[]; todos: Todo[]; notifications: SiteNotification[] } };
  "crew:disk": { args: [slug: string, dir: string]; result: DiskListing };
  /** The files the bot changed in the last 15 minutes, with the lines it changed (the Code window marks them). */
  "crew:edits": { args: [slug: string]; result: RecentEdit[] };
  "crew:diskOp": { args: [slug: string, op: DiskOp]; result: DiskListing };
  /** A URL the page can load a file from (images, video, audio, text): crewfile://<slug>/<disk path>. */
  "crew:diskUrl": { args: [slug: string, path: string]; result: string };
  "crew:setQuota": { args: [slug: string, gb: number]; result: DiskListing };
  /** Copies a file on the bot's disk to a place the person picks in a save dialog; returns where it went, or null when they cancel. */
  "crew:saveCopy": { args: [slug: string, path: string]; result: string | null };
  /** A native drag of these files (disk paths) out of the Crew window, to the desktop or Explorer; resolves when the drag ends. */
  "crew:dragOut": { args: [slug: string, paths: string[]]; result: void };
  /** A new Fenna document in the bot's Documents; returns its library folder name. */
  "crew:newDoc": { args: [slug: string, kind: LibraryKind, title: string]; result: { path: string } };
  /** The person runs a command in the bot's terminal. */
  "crew:term": { args: [slug: string, line: string, cwd: string]; result: TermEntry };
  "crew:termHistory": { args: [slug: string]; result: TermEntry[] };
  "crew:diskSearch": { args: [slug: string, query: string]; result: SearchHit[] };
  "crew:replay": { args: [slug: string, runId: string]; result: ReplayStep[] };
  "crew:removeWatch": { args: [slug: string, id: string]; result: Watch[] };
  "crew:setTodo": { args: [slug: string, id: string, patch: { done?: boolean; remove?: boolean }]; result: Todo[] };
  "crew:setDesktop": { args: [slug: string, items: DesktopShortcut[]]; result: DesktopShortcut[] };
  /** Points a webview (by its webContents id) at a library document and returns the editor page to load. */
  "crew:editor": { args: [slug: string, path: string, webContentsId: number]; result: EditorOpen };
  /** A bot's notification center: its notices, newest first, and how many are unread. */
  "crew:notices": { args: [slug: string]; result: NoticeState };
  /** The apps in a bot's Files/Apps folder, with their grants and problems. */
  "crew:apps": { args: [slug: string]; result: AppInfo[] };
  /** Sets (or with null, revokes) the grant of one app; returns the bot's apps after it. */
  "crew:appGrant": { args: [slug: string, name: string, grant: AppGrant | null]; result: AppInfo[] };
  "crew:clearNotices": { args: [slug: string]; result: NoticeState };
  /** The person opened the notification center: everything is read. */
  "crew:readNotices": { args: [slug: string]; result: NoticeState };
  /** A one-time reminder: a timer watch at `at` (ISO) whose note is the person's words. */
  "crew:addReminder": { args: [slug: string, input: { at: string; note: string }]; result: Watch };
  /** A bot's commands, newest first. */
  "crew:processes": { args: [slug: string]; result: ProcessInfo[] };
  /** Stops a running command; resolves to the bot's commands after it. */
  "crew:stopProcess": { args: [slug: string, id: string]; result: ProcessInfo[] };
  /** A bot's repos (Files/Repos) and whether its own shell may run unsandboxed. */
  "crew:repos": { args: [slug: string]; result: ReposView };
  /** Links a git folder on this computer as the bot's own copy; with no folder, Crew asks with a folder dialog. */
  "crew:repoLink": { args: [slug: string, folder?: string]; result: ReposView };
  "crew:repoClone": { args: [slug: string, url: string]; result: ReposView };
  /** Fetches the latest branches from where the repo came from. */
  "crew:repoSync": { args: [slug: string, name: string]; result: ReposView };
  /** Moves the repo to Trash; force also throws away uncommitted changes. */
  "crew:repoRemove": { args: [slug: string, name: string, force?: boolean]; result: ReposView };
  "crew:repoPolicy": { args: [slug: string, name: string, policy: Partial<RepoPolicy>]; result: ReposView };
  /** Lets the bot's own shell run without a sandbox (only where its AI can't sandbox). */
  "crew:repoShell": { args: [slug: string, on: boolean]; result: ReposView };
  /** The team on a repo, by its key (RepoInfo.key). */
  "crew:repoTeam": { args: [key: string]; result: TeamMember[] };
  /** What the crew shipped, newest first; one repo by its key, or all. */
  "crew:shipped": { args: [key?: string]; result: ShippedEntry[] };
}

/** What the GitHub loop may do on its own for one repo. */
export interface RepoPolicy {
  comment: "auto" | "ask";
  draftOnly: boolean;
  merge: "ask" | "never";
}

/** One of a bot's repos, as the Repos screen shows it. */
export interface RepoInfo {
  name: string;
  /** Files/Repos/<name> on the bot's disk. */
  path: string;
  branch: string;
  branches: string[];
  /** Files changed and not committed. */
  changed: number;
  last: { hash: string; subject: string; at: string } | null;
  /** The folder on this computer it was copied from, if linked. */
  source: string | null;
  /** Its remote (GitHub or other), if any. */
  origin: string | null;
  /** The id teams and the shipped log use: origin, else source. */
  key: string;
  policy: RepoPolicy;
}

export interface ReposView {
  repos: RepoInfo[];
  /** The person allowed the bot's own shell to run unsandboxed. */
  shell: boolean;
  /** The bot's AI can't sandbox its shell on this computer, so the shell needs that allowance. */
  shellNeeded: boolean;
}

export type TeamRole = "lead" | "builder" | "tester" | "reviewer";

export interface TeamMember {
  slug: string;
  role: TeamRole;
}

export interface ShippedEntry {
  repoKey: string;
  slug: string;
  kind: "push" | "pr" | "merge" | "issue" | "release";
  title: string;
  url: string;
  at: string;
}

/** Every event channel and its payload. */
export interface Events {
  "crew:changed": Overview;
  "crew:event": LiveEvent;
  "crew:cursor": CursorEvent;
  "crew:frame": FrameEvent;
  "crew:browser": { slug: string; state: BrowserState };
  "crew:connectors": ConnectorView[];
  /** The skills installed on this computer changed (added, replaced or removed). */
  "crew:skills": SkillView[];
  "crew:vault": VaultItemView[];
  /** The person clicked a notification: show this bot's chat. */
  "crew:open": { slug: string };
  /** A bot's desktop changed (the person or the bot moved, added or removed a shortcut). */
  "crew:desktop": { slug: string; items: DesktopShortcut[] };
  /** A bot's watches or todos changed. */
  "crew:watches": { slug: string };
  /** A bot's call changed: joined, people, sharing; null when it left. */
  "crew:meeting": { slug: string; meeting: MeetingView | null };
  "crew:account": { slug: string; account: AccountView | null };
  /** Something changed on a bot's disk (the person, the bot or a download). */
  "crew:disk": { slug: string };
  /** A bot's repos changed (linked, cloned, synced, removed, policy or shell). */
  "crew:repos": { slug: string };
  /** The bot wrote or edited a file (the Code window reloads it, and follows the change). */
  "crew:edits": { slug: string };
  /** A command ran in a bot's terminal (the person's or the bot's). */
  "crew:term": { slug: string; entry: TermEntry };
  /** A bot's notices changed (a new one, cleared, or read). */
  "crew:notices": { slug: string };
  /** A bot's apps changed (made, edited, granted, revoked). */
  "crew:apps": { slug: string };
  /** The bot opened one of its apps in its hidden window: the person's view shows it too. */
  "crew:appOpened": { slug: string; name: string };
  /** A command's status changed (started, ended, stopped, or its port is known). */
  "crew:process": { slug: string; info: ProcessInfo };
  /** New output of a command, as it is written. */
  "crew:processOutput": { slug: string; id: string; stream: "out" | "err"; text: string };
}

/** Fire-and-forget messages from the page. */
export interface Sends {
  "crew:input": [slug: string, input: ControlInput];
  "crew:viewport": [slug: string, size: ViewportSize];
  /** The page has this bot's computer open (true) or left it (false). A bot is heard only while it is open. */
  "crew:present": [slug: string, open: boolean];
}

// ── Processes: commands a bot runs in its projects ─────────────────────

/** One command a bot ran in a project (Files/Projects/<project>). tail is its last lines of output. */
export interface ProcessInfo {
  id: string;
  slug: string;
  project: string;
  command: string;
  background: boolean;
  status: "running" | "exited" | "stopped" | "failed";
  exitCode: number | null;
  /** The port it listens on (seen in its output), or null. */
  port: number | null;
  /** ISO times. */
  startedAt: string;
  endedAt: string | null;
  tail: string;
}

// ── Notices: a bot's notification center ──────────────────────────────

/** What a notice is about: a site's notification, a finished download, an ended run, a fired watch, a reminder (a timer watch). */
export const NOTICE_KINDS = ["site", "download", "run", "watch", "reminder", "account"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export interface Notice {
  id: string;
  /** ISO time it happened. */
  at: string;
  kind: NoticeKind;
  title: string;
  body: string;
  /** For site notices: the site's origin (its icon is looked up with it). */
  origin?: string;
  /** For downloads: the file's path in the bot's workspace. */
  path?: string;
}

export interface NoticeState {
  /** Newest first, at most 100. */
  items: Notice[];
  unread: number;
}

/** Where a bot's own Google account stands in its browser (accounts.cjs). */
export type AccountState = "missing" | "unknown" | "signed_out" | "signing_in" | "signed_in" | "other_account" | "needs_you";

/** A bot's own Google account: the vault login bot.md names, and its browser's sign-in. Never holds a secret. */
export interface AccountView {
  slug: string;
  /** The vault login's name (bot.md `account`). */
  login: string;
  /** The login's username, lowercased; "" when it isn't in the vault. */
  email: string;
  state: AccountState;
  /** other_account: who the browser is signed in as, when Google says. */
  signedInAs: string | null;
  /** needs_you: what the person has to do, in one sentence; "" otherwise. */
  message: string;
  /** When the browser was last checked, ISO; null before the first check. */
  checkedAt: string | null;
}

/** A bot in a video call (meetings.cjs). */
export interface MeetingView {
  slug: string;
  code: string;
  url: string;
  /** stuck: Meet wants a sign-in, or its Join button couldn't be pressed; the person can take control and do it. */
  state: "joining" | "waiting" | "stuck" | "incall" | "ended";
  people: number | null;
  captions: boolean;
  /** The title of the document it is sharing, or null. */
  sharing: string | null;
  /** Its transcript on the bot's disk, like Files/Meetings/2026-11-21 14.05 abc-defg-hij.md */
  transcript: string;
  /** The chat its wakes go to. */
  chat: string;
  startedAt: string;
}
