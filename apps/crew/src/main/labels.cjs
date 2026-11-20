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

const CREW = {
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
    return `${server}: ${String(tool).replace(/_/g, " ")}`;
  };
}

const toolLabel = createToolLabel();

module.exports = { toolLabel, createToolLabel };
