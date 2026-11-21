// What the crew, browser and gateway MCP servers ask the app to do, for one
// run. ctx is the run the request's token belongs to: { slug, runId, team, chain }.

const F = require("./format.cjs");
const { watchLine, todoLine } = require("./watches.cjs");
const { noUsage } = require("./usage.cjs");

const MAX_HANDOFFS = 6;
const quoteList = (xs) => xs.map((x) => `"${x}"`).join(", ");
const minutes = (ms) => `${Math.round(ms / 60_000)} minutes`;

/** A sentence, then the items one line each (ids first), or the words for an empty list. */
const listed = (sentence, items, line, empty) => [sentence, items.length ? items.map(line).join("\n") : empty].filter(Boolean).join("\n");
const countOf = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const botNameOf = (store, slug) => {
  const r = store.readBot(slug);
  return (r && r.bot && r.bot.name) || slug;
};

/** A new shortcut id from its label: lowercase words joined by dashes, unused in the desktop. */
function newShortcutId(label, taken) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "shortcut";
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}

const shortcutTarget = (s) => (s.kind === "web" ? s.url : s.kind === "doc" ? s.path : s.app);

/** The sentence, then one line per shortcut: "id  kind  label  target". */
function desktopText(sentence, items) {
  if (!items.length) return sentence;
  return `${sentence}\n${items.map((s) => `${s.id}  ${s.kind}  ${s.label}  ${shortcutTarget(s)}`).join("\n")}`;
}

/**
 * Waiting on the person for one approval, with both ends in the run log.
 * Shared by request_approval, create_bot and the gateway's ask tools.
 * @param {object} o
 * @param {ReturnType<import("./store.cjs").createStore>} o.store
 * @param {ReturnType<import("./runner.cjs").createRunner>} o.runner
 * @param {ReturnType<import("./waits.cjs").createWaits>} o.waits
 * @param {() => Date} [o.now]
 * @returns {(ctx: object, a: { action: string, details: string, source: string, tool: string|null }) => Promise<{ allowed: boolean, always: boolean, by: string }>}
 */
function createApprover({ store, runner, waits, usage = noUsage, now = () => new Date() }) {
  return async function approve(ctx, { action, details, source, tool }) {
    const w = waits.add({ kind: "approval", slug: ctx.slug, botName: botNameOf(store, ctx.slug), runId: ctx.runId, action, details, source, tool });
    runner.record(ctx.runId, { type: "approval", at: w.record.at, approvalId: w.id, action, details, source, tool });
    const r = await w.done;
    const allowed = r.by === "person" && !!(r.value && r.value.allowed);
    const always = allowed && !!(r.value && r.value.always);
    if (r.by === "person") {
      usage.count("approvals");
      if (!allowed) usage.count("approvals_denied");
    }
    runner.record(ctx.runId, { type: "decision", at: now().toISOString(), approvalId: w.id, allowed, always, by: r.by });
    return { allowed, always, by: r.by };
  };
}

/**
 * @param {object} o
 * @param {ReturnType<import("./store.cjs").createStore>} o.store
 * @param {ReturnType<import("./runner.cjs").createRunner>} o.runner
 * @param {ReturnType<import("./waits.cjs").createWaits>} o.waits
 * @param {ReturnType<typeof createApprover>} o.approve
 * @param {{ act(slug: string, method: string, params: object): Promise<{ text: string, image?: object }> }} o.browsers
 * @param {{ handOff(from: string, to: string, paths: string[], names: { from: string, to: string }): { files: object[] } }} o.disk  copies a hand-off's files (disk.cjs)
 * @param {{ handle(ctx: object, method: string, params: object): Promise<object> }} o.gateway
 * @param {{ has(method: string): boolean, handle(ctx: object, method: string, params: object): Promise<object>, scrub(slug: string, r: object): object }} [o.logins]
 *   the browser's logins, sign_in and fill_code (the vault)
 * @param {() => void} o.onChange
 * @param {ReturnType<import("./watches.cjs").createWatches>} o.watches  the bot's watches and to-do list
 * @param {{ search(slug: string, query: string, opts?: object): { entry: object, snippet?: string }[] }} o.search  the bot's disk search (search.cjs)
 * @param {{ read(slug: string, p: object): Promise<object>, importSheet(slug: string, p: object): Promise<object>, exportFile(slug: string, p: object): Promise<object>, writeFile(slug: string, p: object): object, editFile(slug: string, p: object): object }} o.files  the bot's files (files.cjs)
 * @param {{ exec(slug: string, line: string, cwd: string|null, who: string): Promise<{ out: string, cwd: string }> }} o.shell  the bot's terminal (shell.cjs)
 * @param {{ handle(ctx: object, p: object): Promise<{ text: string }> }} o.appHost  the bot's apps: list, open, snapshot, click, type, press, close (appHost.cjs)
 * @param {{ command(ctx: object, p: object): Promise<{ text: string }>, processes(ctx: object, p: object): { text: string } }} o.projects  node, npm and npx in the bot's projects (projects.cjs)
 * @param {() => Date} [o.now]
 */
function createHandlers({ store, runner, waits, approve, browsers, gateway, appHost, logins = null, onChange, onDesktop, watches, search, files, shell, projects, repos = null, disk, usage = noUsage, now = () => new Date() }) {
  const iso = () => now().toISOString();
  const botName = (slug) => botNameOf(store, slug);

  const handlers = {
    async ask(ctx, p) {
      const question = String(p.question || "").slice(0, 1000);
      const options = Array.isArray(p.options) ? p.options.map(String).slice(0, 8) : [];
      const multi = !!p.multi;
      const w = waits.add({ kind: "ask", slug: ctx.slug, botName: botName(ctx.slug), runId: ctx.runId, question, options, multi });
      runner.record(ctx.runId, { type: "ask", at: w.record.at, askId: w.id, question, options, multi });
      const r = await w.done;
      const answer = r.by === "person" && Array.isArray(r.value) ? r.value.map(String) : [];
      if (r.by === "person") usage.count("questions");
      runner.record(ctx.runId, { type: "answer", at: iso(), askId: w.id, answer, by: r.by });
      if (r.by === "timeout") return { text: `No answer after ${minutes(waits.timeoutMs)}. Don't act on this question; say in your reply what you need from the person.` };
      if (r.by === "stopped") return { text: "The run was stopped before the person answered." };
      if (!answer.length) return { text: "The person dismissed the question without answering. Carry on without it, or say what you need in your reply." };
      return { text: `The person answered: ${quoteList(answer)}.` };
    },

    async approval(ctx, p) {
      const action = String(p.action || "").slice(0, 200);
      const r = await approve(ctx, { action, details: String(p.details || "").slice(0, 4000), source: "bot", tool: null });
      if (r.allowed) return { text: `Approved by the person. Go ahead with exactly this: ${action}` };
      if (r.by === "timeout") return { text: `No answer after ${minutes(waits.timeoutMs)}, so it is not approved. Don't do it; say in your reply that it waits for the person's approval.` };
      if (r.by === "stopped") return { text: "The run was stopped; not approved." };
      return { text: "Denied by the person. Don't do it, and don't try another way. Say in your reply that it was not approved." };
    },

    async message(ctx, p) {
      const target = String(p.bot || "").trim().toLowerCase();
      const text = String(p.message || "").trim();
      const slugs = store.slugs();
      if (!slugs.includes(target)) {
        const near = F.closest(target, slugs);
        throw new Error(`There is no bot "${target}".${near ? ` Did you mean "${near}"?` : ""} Bots: ${slugs.filter((s) => s !== ctx.slug).join(", ") || "none"}.`);
      }
      if (target === ctx.slug) throw new Error("That is you. Do the work yourself, or pick another bot.");
      if (!text) throw new Error("Write the task in message.");
      const files = Array.isArray(p.files) ? p.files.map((f) => String(f).trim()).filter(Boolean) : [];
      // One count per message from the person (or per scheduled run), shared by every bot it reaches.
      if (!ctx.chain) ctx.chain = { count: { n: 0 }, stack: [ctx.slug] };
      const chain = ctx.chain;
      if (chain.count.n >= MAX_HANDOFFS) throw new Error(`This request has already been handed on ${MAX_HANDOFFS} times, the most allowed. Finish it with what you have.`);
      if (chain.stack.includes(target)) throw new Error(`${botName(target)} is waiting on you for this. Put your answer in your reply instead of messaging it.`);
      // Files are copied before the hand-off counts: a refusal copies nothing and counts for nothing.
      const copied = files.length ? disk.handOff(ctx.slug, target, files, { from: botName(ctx.slug), to: botName(target) }).files : [];
      chain.count.n++;
      runner.record(ctx.runId, { type: "handoff", at: iso(), to: target, text });
      if (copied.length) runner.record(ctx.runId, { type: "files", at: iso(), from: ctx.slug, to: target, files: copied });
      if (ctx.team) store.appendThread(ctx.team, { at: iso(), from: ctx.slug, to: target, text });
      const sub = runner.enqueue({ slug: target, trigger: "bot", text, from: ctx.slug, team: ctx.team, files: copied, chain: { count: chain.count, stack: [...chain.stack, target] } });
      const sent = copied.length ? `Copied ${countOf(copied.length, "file")} to ${botName(target)}: ${copied.map((f) => f.toPath).join(", ")}. Your files are unchanged.\n\n` : "";
      let timer;
      const timeout = new Promise((r) => (timer = setTimeout(() => r(null), waits.timeoutMs)));
      const r = await Promise.race([sub.done, timeout]);
      clearTimeout(timer);
      if (!r) return { text: `${sent}${botName(target)} hasn't finished after ${minutes(waits.timeoutMs)}. Its reply will be in its own chat; carry on without it.` };
      const reply = r.text || (r.message ? `(no reply: ${r.message})` : "(no reply)");
      runner.record(ctx.runId, { type: "handback", at: iso(), from: target, text: reply });
      if (ctx.team) store.appendThread(ctx.team, { at: iso(), from: target, to: ctx.slug, text: reply });
      if (r.outcome !== "done") return { text: `${sent}${botName(target)} could not finish (${r.outcome}${r.message ? `: ${r.message}` : ""}). What it said: ${reply}` };
      return { text: `${sent}${botName(target)} replied:\n${reply}` };
    },

    async create_bot(ctx, p) {
      const me = store.readBot(ctx.slug);
      const input = {
        name: String(p.name || ""),
        job: String(p.job || ""),
        how: String(p.how || ""),
        schedule: String(p.schedule || "manual"),
        cli: p.cli || (me && me.bot ? me.bot.brain.cli : "claude"),
        askBefore: Array.isArray(p.askBefore) ? p.askBefore.map(String) : [],
      };
      if (p.avatar) input.avatar = String(p.avatar).toLowerCase();
      if (p.color) input.color = String(p.color).toLowerCase();
      if (Array.isArray(p.connectors)) input.connectors = p.connectors.map((app) => ({ type: "fenna", app: String(app) }));
      const check = F.newBot(input);
      const errors = check.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
      if (errors.length) throw new Error(`The bot can't be created as asked: ${errors.join(" ")}`);
      const s = F.parseSchedule(check.bot.schedule);
      const when = "error" in s ? check.bot.schedule : F.describeSchedule(s.schedule);
      const details = [`Job: ${check.bot.job}`, `Schedule: ${when}`, `Brain: ${F.CLI_NAMES[check.bot.brain.cli]}`, check.bot.askBefore.length ? `Asks before: ${check.bot.askBefore.join("; ")}` : "", check.bot.how ? `How it works: ${check.bot.how}` : ""].filter(Boolean).join("\n");
      const r = await approve(ctx, { action: `Create a bot named ${check.bot.name}`, details, source: "bot", tool: null });
      if (!r.allowed) return { text: r.by === "timeout" ? `No answer after ${minutes(waits.timeoutMs)}; the bot was not created.` : "The person said no; the bot was not created." };
      const slug = store.createBot(input);
      usage.count("bots_created");
      usage.reached("bot");
      onChange();
      return { text: `Created ${check.bot.name} (folder "${slug}"). It runs: ${when}. Hand it a first task with message_bot {bot: "${slug}", …} if the person wants it to start now.` };
    },

    async remember(ctx, p) {
      const note = String(p.note || "").trim();
      if (!note) throw new Error("Write the note to remember.");
      store.appendMemory(ctx.slug, note, now());
      return { text: "Saved to memory." };
    },

    async status(ctx, p) {
      const status = String(p.status || "").trim().slice(0, F.LIMITS.status);
      const mood = F.MOODS.includes(p.mood) ? p.mood : null;
      store.patchState(ctx.slug, (s) => {
        s.status = status;
        if (mood) s.mood = mood;
      });
      runner.markStatus(ctx.runId, mood);
      runner.record(ctx.runId, { type: "status", at: iso(), status, mood: mood || "work" });
      onChange();
      return { text: "Status set." };
    },

    async library_changed() {
      onChange();
      return { text: "ok" };
    },

    /** The bot's desktop: list, add, remove, rename or move shortcuts. Positions start at 1. */
    desktop(ctx, p) {
      const items = store.readDesktop(ctx.slug);
      const find = (id) => {
        const key = String(id ?? "");
        if (!key) throw new Error("Say which shortcut, by the id that list shows.");
        const i = items.findIndex((s) => s.id === key);
        if (i < 0) throw new Error(`No shortcut with id ${key}. Shortcuts: ${items.map((s) => s.id).join(", ") || "none"}.`);
        return i;
      };
      const label = String(p.label ?? "").trim();
      let next;
      let said;
      switch (p.action) {
        case "list":
          return { text: desktopText(`${items.length} shortcut${items.length === 1 ? "" : "s"} on the desktop.`, items) };
        case "add": {
          const id = newShortcutId(label, new Set(items.map((s) => s.id)));
          const target = p.kind === "web" ? { url: p.url } : p.kind === "doc" ? { path: p.path } : { app: p.app };
          next = [...items, { id, kind: p.kind, ...target, label }];
          said = `Added "${label}" as ${id}.`;
          break;
        }
        case "remove": {
          const i = find(p.id);
          next = items.filter((_, j) => j !== i);
          said = `Removed "${items[i].label}" from the desktop.`;
          break;
        }
        case "rename": {
          const i = find(p.id);
          next = items.map((s, j) => (j === i ? { ...s, label } : s));
          said = `Renamed ${items[i].id} to "${label}".`;
          break;
        }
        case "move": {
          const i = find(p.id);
          const to = p.to;
          if (!Number.isInteger(to) || to < 1 || to > items.length) throw new Error(`Move to a position from 1 to ${items.length}; 1 is the first shortcut.`);
          next = items.filter((_, j) => j !== i);
          next.splice(to - 1, 0, items[i]);
          said = `Moved ${items[i].label} to position ${to}.`;
          break;
        }
        default:
          throw new Error(`Use the action list, add, remove, rename or move, not "${p.action}".`);
      }
      const saved = store.writeDesktop(ctx.slug, next);
      onDesktop(ctx.slug, saved);
      return { text: desktopText(said, saved) };
    },

    /** Waits for things: add a watch (it is armed now), list them, or remove one by id. */
    async watch(ctx, p) {
      let said = "";
      if (p.action === "add") {
        const w = await watches.add(ctx.slug, { kind: p.kind, note: p.note, origin: p.origin, match: p.match, url: p.url, every: p.every, ref: p.ref, at: p.at, in: p.in });
        said = `Watching ${w.id} (${w.kind}). Crew wakes you when it fires; end your turn now.`;
      } else if (p.action === "remove") {
        await watches.remove(ctx.slug, String(p.id ?? ""));
        said = `Removed watch ${p.id}.`;
      } else if (p.action !== "list") throw new Error(`Use the action add, list or remove, not "${p.action}".`);
      const all = watches.list(ctx.slug);
      return { text: listed(said || (all.length ? `${countOf(all.length, "watch")}:` : ""), all, watchLine, "No watches.") };
    },

    /** The bot's to-do list: add, list, done, undone or remove (by id). */
    todo(ctx, p) {
      let said = "";
      if (p.action === "add") {
        watches.addTodo(ctx.slug, p.text);
        said = "Added it to your to-do list.";
      } else if (p.action === "done" || p.action === "undone") {
        watches.setTodo(ctx.slug, String(p.id ?? ""), { done: p.action === "done" });
        said = p.action === "done" ? `Marked ${p.id} done.` : `Marked ${p.id} open again.`;
      } else if (p.action === "remove") {
        watches.setTodo(ctx.slug, String(p.id ?? ""), { remove: true });
        said = `Removed ${p.id} from your to-do list.`;
      } else if (p.action !== "list") throw new Error(`Use the action add, list, done, undone or remove, not "${p.action}".`);
      const all = watches.todos(ctx.slug);
      return { text: listed(said || (all.length ? `${countOf(all.length, "to-do")}:` : ""), all, todoLine, "Your to-do list is empty.") };
    },

    /** Find files and documents on the bot's disk by name or by the text in them. */
    search_files(ctx, p) {
      const query = String(p.query ?? "").trim();
      if (!query) throw new Error("Say what to search for, like \"budget\" or \"invoice 4417\".");
      const hits = search.search(ctx.slug, query, { limit: 20 });
      if (!hits.length) return { text: `Nothing on your disk matches "${query}".` };
      const lines = hits.map((h) => `${h.entry.path}  ${h.entry.kind}${h.snippet ? `  ${h.snippet}` : ""}`);
      return { text: [`${countOf(hits.length, "match")} for "${query}":`, ...lines].join("\n") };
    },

    /** A file on the bot's disk: text, CSV, Excel or an image, a page at a time (files.cjs). */
    read_file(ctx, p) {
      return files.read(ctx.slug, p);
    },

    /** An .xlsx or .csv on the bot's disk, made into a Fenna sheet in its Documents (files.cjs). */
    import_sheet(ctx, p) {
      return files.importSheet(ctx.slug, p);
    },

    /** A Fenna sheet from Documents, saved to Files as .xlsx or .csv (files.cjs). */
    export_file(ctx, p) {
      return files.exportFile(ctx.slug, p);
    },

    /** A text file in Files or Downloads, created or replaced whole (files.cjs). */
    write_file(ctx, p) {
      return files.writeFile(ctx.slug, p);
    },

    /** An exact text replacement in a text file in Files or Downloads (files.cjs). */
    edit_file(ctx, p) {
      return files.editFile(ctx.slug, p);
    },

    /** The bot's apps: test them in a hidden window (appHost.cjs). */
    app(ctx, p) {
      if (!appHost) throw new Error("Apps are not available on this computer yet.");
      return appHost.handle(ctx, p);
    },

    /** Run node, npm or npx in one of the bot's projects (projects.cjs): one command, foreground or background. */
    command(ctx, p) {
      return projects.command(ctx, p);
    },

    /** The bot's running and recent processes: list, stop one, or read its output. */
    processes(ctx, p) {
      return projects.processes(ctx, p);
    },

    /** The bot's repos (repos.cjs): list, status, link, clone, push, remove. */
    repo(ctx, p) {
      if (!repos) throw new Error("Repos are not available on this computer yet.");
      return repos.handle(ctx, p);
    },

    /** Claude Code's question about one of its own tool calls in a coding run: the answer is its permission JSON. */
    async approve_tool(ctx, p) {
      const answer = repos ? await repos.checkTool(ctx, p) : { behavior: "deny", message: "Your own tools are off. Use Crew's tools." };
      return { text: JSON.stringify(answer) };
    },

    /** The bot's terminal: one line over its own disk. The output, then the folder it ended in. */
    async terminal(ctx, p) {
      const line = typeof p.line === "string" ? p.line : "";
      if (!line.trim()) throw new Error("Say the command to run, like ls -l Files.");
      const e = await shell.exec(ctx.slug, line, typeof p.cwd === "string" && p.cwd ? p.cwd : null, "bot");
      const body = !e.out || e.out.endsWith("\n") ? e.out : `${e.out}\n`;
      return { text: `${body}[cwd: ${e.cwd}]` };
    },
  };

  /** Handle one request from a run's MCP server. */
  return async function handle(ctx, method, params) {
    if (method.startsWith("browser.")) {
      const action = method.slice(8);
      if (logins && logins.has(action)) return logins.handle(ctx, action, params);
      if (!logins) return browsers.act(ctx.slug, action, params);
      // Nothing the bot reads from its browser carries a secret Crew filled into it.
      try {
        return logins.scrub(ctx.slug, await browsers.act(ctx.slug, action, params));
      } catch (e) {
        throw new Error(logins.scrub(ctx.slug, { text: (e && e.message) || String(e) }).text);
      }
    }
    if (method.startsWith("gateway.")) return gateway.handle(ctx, method, params);
    const fn = Object.prototype.hasOwnProperty.call(handlers, method) ? handlers[method] : null;
    if (!fn) throw new Error(`Unknown request "${method}".`);
    return fn(ctx, params);
  };
}

module.exports = { createHandlers, createApprover, MAX_HANDOFFS };
