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
  watch: (p) => (p.action === "add" ? "Added a watch" : p.action === "remove" ? "Removed a watch" : "Looked at its watches"),
  todo: (p) => (p.action === "list" ? "Looked at its to-do list" : "Updated the to-do list"),
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

/** The shell's toolLabel hook: (tool, params, server) → words, or null for the tool's own name. */
function toolLabel(tool, params, server) {
  const p = params || {};
  const table = server === "crew" ? CREW : server === "browser" ? BROWSER : server === "fenna" ? FENNA : null;
  if (table && Object.prototype.hasOwnProperty.call(table, tool)) return table[tool](p);
  if (table) return null;
  if (server === "gateway") {
    const i = String(tool).indexOf("__");
    if (i > 0) return `${tool.slice(0, i)}: ${tool.slice(i + 2).replace(/_/g, " ")}`;
  }
  return `${server}: ${String(tool).replace(/_/g, " ")}`;
}

module.exports = { toolLabel };
