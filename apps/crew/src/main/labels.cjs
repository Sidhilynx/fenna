// A bot's tool calls in plain words, for the quiet step lines in its chat
// and its Activity window: "Opened example.com", "Wrote a doc".

const short = (s, n = 40) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

function host(url) {
  try {
    return new URL(/^[a-z]+:/i.test(url) ? url : `https://${url}`).host;
  } catch {
    return short(url, 40);
  }
}

const fileName = (p) => short(String(p || "").split(/[\\/]/).filter(Boolean).pop() || "a file", 40);

const REPO_ACTIONS = {
  list: () => "Looked at its repos",
  status: (p) => `Checked ${short(p.name, 30)}`,
  link: (p) => `Asked to work on ${short(p.path, 50)}`,
  clone: (p) => `Asked to clone ${short(p.url, 50)}`,
  sync: (p) => `Fetched the latest of ${short(p.name, 30)}`,
  push: (p) => `Asked to push ${short(p.branch || "its branch", 40)}`,
  remove: (p) => `Removed ${short(p.name, 30)}`,
  policy: (p) => `Checked the GitHub rules for ${short(p.name, 30)}`,
  allow_shell: () => "Asked to run its own commands",
};

const GITHUB_ACTIONS = {
  issues: () => "Read the issues",
  issue: (p) => `Read issue #${p.number}`,
  pr: (p) => `Read pull request #${p.number}`,
  pr_create: (p) => `Asked to open a pull request: ${short(p.title, 50)}`,
  comment: (p) => `Commented on #${p.number}`,
  merge: (p) => `Asked to merge #${p.number}`,
};

const CREW = {
  repo: (p) => (REPO_ACTIONS[p.action] || (() => "Used its repos"))(p),
  github: (p) => (GITHUB_ACTIONS[p.action] || (() => "Used GitHub"))(p),
  app_windows: (p) => (p.action === "capture" ? `Looked at ${short(p.window, 40) || "an app window"}` : p.action === "click" ? `Clicked in ${short(p.window, 40)}` : p.action === "type" ? `Typed in ${short(p.window, 40)}` : p.action === "press" ? `Pressed ${short(p.key, 20)}` : "Looked at the open app windows"),
  team: (p) => (p.action === "assign" ? `Asked to make ${short(p.bot, 30)} the ${p.role}` : p.action === "publish" ? "Wrote the shipped list" : p.action === "shipped" ? "Read what the crew shipped" : "Looked at its team"),
  ask_human: () => "Asked you a question",
  request_approval: (p) => `Asked you to approve: ${short(p.action, 60)}`,
  message_bot: (p) => {
    const n = Array.isArray(p.files) ? p.files.length : 0;
    return `Handed a task to ${short(p.bot, 30)}${n ? `, with ${n} ${n === 1 ? "file" : "files"}` : ""}`;
  },
  create_bot: (p) => `Asked to create ${short(p.name, 30)}`,
  remember: () => "Saved a note to memory",
  set_status: (p) => short(p.status, 80),
  new_document: (p) => `Made the ${p.kind === "deck" ? "deck" : p.kind === "sheet" ? "sheet" : "doc"} “${short(p.title)}”`,
  read_file: (p) => `Read ${short(String(p.path || "").split("/").pop(), 60)}`,
  import_sheet: (p) => `Made a sheet from ${short(String(p.path || "").split("/").pop(), 60)}`,
  export_file: (p) => `Saved a ${p.format === "csv" ? "CSV" : "Excel"} copy`,
  write_file: (p) => `Wrote ${short(String(p.path || "").split("/").pop(), 60)}`,
  edit_file: (p) => `Edited ${short(String(p.path || "").split("/").pop(), 60)}`,
  meeting: (p) =>
    p.action === "join" ? "Asked to join a call" : p.action === "share" ? `Shared ${p.document || "a document"} in the call` : p.action === "stop_sharing" ? "Stopped sharing" : p.action === "say" ? "Wrote in the call's chat" : p.action === "leave" ? "Left the call" : "Checked the call",
  watch: (p) => (p.action === "add" ? "Added a watch" : p.action === "remove" ? "Removed a watch" : "Looked at its watches"),
  todo: (p) => (p.action === "list" ? "Looked at its to-do list" : "Updated the to-do list"),
  command: (p) => `Ran ${short(p.command, 60)}${p.background ? " in the background" : ""}`,
  processes: (p) => (p.action === "stop" ? "Stopped a command" : p.action === "output" ? "Read a command's output" : "Looked at its commands"),
};

const BROWSER = {
  open: (p) => `Opened ${host(p.url)}${p.new_tab ? " in a new tab" : ""}`,
  snapshot: () => "Read the page",
  click: () => "Clicked on the page",
  type: (p) => `Typed “${short(p.text, 30)}”`,
  press: (p) => `Pressed ${short(p.key, 20)}`,
  scroll: (p) => (p.ref ? "Scrolled to an element" : `Scrolled ${p.direction === "up" ? "up" : "down"}`),
  back: () => "Went back",
  screenshot: () => "Looked at the screen",
  tabs: () => "Looked at its tabs",
  switch_tab: (p) => `Switched to tab ${Number(p.tab) || ""}`.trim(),
  close_tab: (p) => (p.tab ? `Closed tab ${Number(p.tab)}` : "Closed a tab"),
  logins: () => "Looked for its logins",
  sign_in: (p) => `Asked Crew to sign in with ${short(p.login, 30) || "a login"}`,
  fill_code: () => "Asked Crew for a sign-in code",
};

const FENNA = {
  workspace_overview: () => "Looked at the library",
  workspace_guide: () => "Read the format guide",
  doc_overview: () => "Read a doc",
  read_tab: () => "Read a doc",
  write_tab: () => "Wrote a doc",
  edit_blocks: () => "Edited a doc",
  sheet_overview: () => "Read a sheet",
  read_range: () => "Read a sheet",
  write_cells: () => "Updated a sheet",
  deck_overview: () => "Read a deck",
  read_slides: () => "Read a deck",
  write_slide: () => "Wrote a slide",
  edit_slide: () => "Edited a slide",
};

/** The brain's own tools in a coding run (Claude Code, Antigravity, Codex): what the person sees in the chat. */
// A command as the person reads it, without the folder change in front: `cd "C:/x" && npm test` → "Ran npm test".
const ran = (cmd) => `Ran ${short(String(cmd ?? "").replace(/^\s*(?:(?:cd|pushd|set-location|sl)\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*)+/i, ""), 70)}`;
const NATIVE = {
  Bash: (p) => ran(p.command),
  PowerShell: (p) => ran(p.command),
  Read: (p) => `Read ${fileName(p.file_path)}`,
  Edit: (p) => `Edited ${fileName(p.file_path)}`,
  MultiEdit: (p) => `Edited ${fileName(p.file_path)}`,
  Write: (p) => `Wrote ${fileName(p.file_path)}`,
  NotebookEdit: (p) => `Edited ${fileName(p.notebook_path)}`,
  Glob: (p) => `Looked for ${short(p.pattern, 50)}`,
  Grep: (p) => `Searched the code for ${short(p.pattern, 50)}`,
  LS: (p) => `Listed ${fileName(p.path)}`,
  TodoWrite: () => "Updated its to-do list",
  run_command: (p) => ran(p.CommandLine),
  command_status: () => "Checked a command",
  view_file: (p) => `Read ${fileName(p.AbsolutePath || p.TargetFile)}`,
  view_file_outline: (p) => `Read ${fileName(p.AbsolutePath || p.TargetFile)}`,
  list_dir: (p) => `Listed ${fileName(p.DirectoryPath)}`,
  grep_search: (p) => `Searched the code for ${short(p.Query, 50)}`,
  find_by_name: (p) => `Looked for ${short(p.Pattern, 50)}`,
  write_to_file: (p) => `Wrote ${fileName(p.TargetFile)}`,
  replace_file_content: (p) => `Edited ${fileName(p.TargetFile)}`,
  multi_replace_file_content: (p) => `Edited ${fileName(p.TargetFile)}`,
  command_execution: (p) => ran(p.command),
  file_change: (p) => {
    const n = Array.isArray(p.changes) ? p.changes.length : 0;
    return n === 1 ? `Edited ${fileName(p.changes[0].path)}` : `Edited ${n} files`;
  },
};

/**
 * The shell's toolLabel hook, with the app titles of the bot whose run it is
 * (appTitle(slug, name) → title or null): (tool, params, server, slug) →
 * words, or null for the tool's own name.
 */
function createToolLabel({ appTitle = () => null } = {}) {
  return function toolLabel(tool, params, server, slug = "") {
    const p = params || {};
    const title = (name) => (name ? appTitle(slug, String(name)) : null) || short(name, 40) || "the app";
    if (server === "crew" && tool === "app") {
      switch (p.action) {
        case "list":
          return "Looked at its apps";
        case "open":
          return `Opened the app ${title(p.name)}`;
        case "snapshot":
          return `Read ${title(p.name)}`;
        case "click":
          return `Clicked in ${title(p.name)}`;
        case "type":
          return `Typed in ${title(p.name)}`;
        case "press":
          return `Pressed ${short(p.key, 20)} in ${title(p.name)}`;
        case "close":
          return `Closed ${title(p.name)}`;
        default:
          return null;
      }
    }
    // The brain's own tools have no server; the shell names the run's first server ("crew") for them.
    if ((!server || server === "crew") && Object.prototype.hasOwnProperty.call(NATIVE, tool)) return NATIVE[tool](p);
    const table = server === "crew" ? CREW : server === "browser" ? BROWSER : server === "fenna" ? FENNA : null;
    if (table && Object.prototype.hasOwnProperty.call(table, tool)) return table[tool](p);
    if (table) return null;
    if (server === "gateway") {
      const name = String(tool);
      if (name.startsWith("app__")) {
        const rest = name.slice(5);
        const i = rest.indexOf("__");
        if (i > 0) return `Used ${title(rest.slice(0, i))}: ${rest.slice(i + 2).replace(/_/g, " ")}`;
      }
      const i = name.indexOf("__");
      if (i > 0) return `${name.slice(0, i)}: ${name.slice(i + 2).replace(/_/g, " ")}`;
    }
    return server ? `${server}: ${String(tool).replace(/_/g, " ")}` : String(tool).replace(/_/g, " ");
  };
}

const toolLabel = createToolLabel();

module.exports = { toolLabel, createToolLabel };
