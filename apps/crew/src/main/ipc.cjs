// The page's calls (src/shared/contract.ts, "Calls"). Every argument is
// checked here; errors reject with a message the page can show as it is.

const fs = require("node:fs");
const path = require("node:path");
const { assistantCatalog } = require("@opendeck/shell/main/agent.cjs");
const F = require("./format.cjs");
const { searchRegistry } = require("./registry.cjs");
const { chatFileName, chatMarkdown } = require("./store.cjs");
const { createSiteIcons, originOf } = require("./siteicons.cjs");

const MAX_MESSAGE = 20_000;

const str = (v, what, max = 200) => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${what} is missing.`);
  if (v.length > max) throw new Error(`${what} is too long (${v.length} characters; the most is ${max}).`);
  return v;
};
const vaultName = (v) => {
  if (!F.isSlug(v)) throw new Error(`"${String(v).slice(0, 60)}" is not a login's name.`);
  return v;
};
const slugArg = (v) => {
  if (!F.isSlug(v)) throw new Error(`"${String(v).slice(0, 60)}" is not a bot or team folder name.`);
  return v;
};

/** The face fields of a bot's input or patch: each, when given, is one of the ids, in any case. */
function lookArgs(o) {
  const out = {};
  for (const [key, list, label] of [["avatar", F.AVATARS, "an avatar"], ["color", F.AVATAR_COLORS, "a color"]]) {
    if (o[key] === undefined || o[key] === "") continue;
    const v = typeof o[key] === "string" ? o[key].trim().toLowerCase() : "";
    if (!list.includes(v)) throw new Error(`"${String(o[key]).slice(0, 30)}" is not ${label}. Use one of: ${list.join(", ")}.`);
    out[key] = v;
  }
  return out;
}

/**
 * @param {object} o
 * @param {Electron.IpcMain} o.ipcMain
 * @param {(e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => void} o.assertSender
 * @param {ReturnType<import("./crew.cjs").createCrew>} o.crew
 * @param {{ get(): object, set(patch: object): object }} o.settings
 * @param {(dir: string) => Promise<string>} o.reveal
 */
function registerIpc({ ipcMain, assertSender, crew, settings, reveal, saveDialog, disk, search, shell }) {
  const { store, runner, waits, browsers, views, replay } = crew;
  const siteIcons = createSiteIcons({ dir: path.join(require("electron").app.getPath("userData"), "Crew", "siteicons") });
  // The save dialog, in Documents, over the window that asked; null when the person cancels.
  const saveFile =
    saveDialog ||
    (async (e, defaultName) => {
      const { app, BrowserWindow, dialog } = require("electron");
      const win = BrowserWindow.fromWebContents(e.sender);
      const options = { defaultPath: path.join(app.getPath("documents"), defaultName), filters: [{ name: "Markdown", extensions: ["md"] }] };
      const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      return r.canceled || !r.filePath ? null : r.filePath;
    });
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (e, ...args) => {
      assertSender(e);
      return fn(e, ...args);
    });

  handle("crew:overview", () => views.overview());
  handle("crew:bot", (_e, slug) => views.bot(slugArg(slug)));
  handle("crew:history", (_e, slug, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    return views.history(slugArg(slug), { before: typeof o.before === "string" ? o.before : undefined, limit: Number(o.limit) || 10, chat: typeof o.chat === "string" ? chatArg(slugArg(slug), o.chat) : undefined });
  });

  handle("crew:create", (_e, input) => {
    if (!input || typeof input !== "object") throw new Error("Say the bot's name and job.");
    const slug = store.createBot({ ...input, ...lookArgs(input) });
    crew.onChange();
    return { slug };
  });
  handle("crew:update", (_e, slug, patch) => {
    const p = patch && typeof patch === "object" ? patch : {};
    store.updateBot(slugArg(slug), { ...p, ...lookArgs(p) });
    crew.onChange();
    return views.bot(slug);
  });
  handle("crew:delete", async (_e, slug) => {
    slugArg(slug);
    runner.stop(slug);
    browsers.close(slug);
    crew.logins.forget(slug);
    crew.watches.forget(slug);
    await store.deleteBot(slug);
    crew.onChange();
    return true;
  });
  handle("crew:duplicate", (_e, slug) => {
    const copy = store.duplicateBot(slugArg(slug));
    crew.onChange();
    return { slug: copy };
  });
  handle("crew:exportChat", async (e, slug) => {
    const bot = store.readBot(slugArg(slug));
    if (!bot) throw new Error(`There is no bot "${slug}".`);
    const name = bot.bot ? bot.bot.name : slug;
    const file = await saveFile(e, chatFileName(name));
    if (!file) return null;
    fs.writeFileSync(file, chatMarkdown(name, store.allRuns(slug)), "utf8");
    return file;
  });
  /** A new chat for the person, unless their current one is still empty. */
  function newChat(slug) {
    let id = "";
    const said = views.history(slug, { limit: 1 }).runs.length > 0;
    store.patchState(slug, (s) => {
      const cur = F.chatIn(s, s.current);
      if (!said && !cur.title && !Object.keys(cur.sessions).length && !cur.summary) {
        id = cur.id;
        return;
      }
      id = F.newChatId(new Date(), s.chats.map((c) => c.id));
      s.chats.push(F.emptyChat(id, new Date().toISOString()));
      s.current = id;
      const mine = s.chats.filter((c) => c.id !== F.RUNS_CHAT && c.id !== F.MAIN_CHAT);
      if (mine.length > F.MAX_CHATS - 2) s.chats = s.chats.filter((c) => c !== mine[0]);
    });
    crew.onChange();
    return id;
  }
  function chatArg(slug, chat) {
    if (typeof chat !== "string" || !store.readState(slug).chats.some((c) => c.id === chat)) throw new Error("That chat no longer exists. Pick another from the list.");
    return chat;
  }

  handle("crew:forget", (_e, slug) => {
    newChat(slugArg(slug));
    return true;
  });
  handle("crew:newChat", (_e, slug) => newChat(slugArg(slug)));
  handle("crew:openChat", (_e, slug, chat) => {
    const id = chatArg(slugArg(slug), chat);
    if (id !== F.RUNS_CHAT) {
      store.patchState(slug, (s) => {
        s.current = id;
      });
      crew.onChange();
    }
    return true;
  });
  handle("crew:compact", (_e, slug, chat) => {
    const id = chatArg(slugArg(slug), chat);
    const r = store.readBot(slug);
    const c = store.readState(slug).chats.find((x) => x.id === id);
    if (!r || !r.bot || !c || !c.sessions[r.bot.brain.cli]) throw new Error("Nothing to compact yet: this chat has no conversation with this brain.");
    if (runner.running(slug) || runner.isQueued(slug)) throw new Error("Wait for the bot to finish, then compact.");
    return { runId: runner.enqueue({ slug, trigger: "compact", chat: id }).runId };
  });

  handle("crew:send", (_e, slug, text, chat) => {
    const s = slugArg(slug);
    const r = runner.enqueue({ slug: s, trigger: "person", text: str(text, "The message", MAX_MESSAGE), chat: chat === undefined ? null : chatArg(s, chat) });
    return { runId: r.runId, queued: r.queued };
  });
  handle("crew:run", (_e, slug) => {
    const r = runner.enqueue({ slug: slugArg(slug), trigger: "schedule" });
    return { runId: r.runId, queued: r.queued };
  });
  handle("crew:greet", async () => {
    const list = await Promise.all(F.CLI_KINDS.map((k) => assistantCatalog(k).catch(() => null)));
    return crew.greet(list.filter((c) => c && c.signedIn).map((c) => c.kind));
  });
  handle("crew:stop", (_e, slug) => {
    browsers.stopMedia(slugArg(slug));
    return runner.stop(slug);
  });
  handle("crew:answer", (_e, id, answer) => {
    const w = waits.get(id);
    if (!w || w.kind !== "ask") return false;
    const list = Array.isArray(answer) ? answer.filter((a) => typeof a === "string" && a.trim()).map((a) => a.slice(0, 2000)).slice(0, 8) : [];
    return waits.answer(id, list);
  });
  handle("crew:decide", (_e, id, allowed, always) => {
    const w = waits.get(id);
    if (!w || w.kind !== "approval") return false;
    return waits.answer(id, { allowed: allowed === true, always: always === true && (w.source === "connector" || w.source === "login") });
  });

  handle("crew:teamCreate", (_e, team) => {
    if (!team || typeof team !== "object") throw new Error("Say the team's name, lead and members.");
    const slug = store.createTeam({ name: team.name, lead: team.lead, members: Array.isArray(team.members) ? team.members : [], purpose: typeof team.purpose === "string" ? team.purpose : "" });
    crew.onChange();
    return { slug };
  });
  handle("crew:teamUpdate", (_e, slug, patch) => {
    store.updateTeam(slugArg(slug), patch && typeof patch === "object" ? patch : {});
    crew.onChange();
    const t = views.team(slug);
    return { slug: t.slug, name: t.name, lead: t.lead, members: t.members, purpose: t.purpose, diagnostics: t.diagnostics };
  });
  handle("crew:teamDelete", async (_e, slug) => {
    await store.deleteTeam(slugArg(slug));
    crew.onChange();
    return true;
  });
  handle("crew:teamSend", (_e, slug, text) => crew.teamSend(slugArg(slug), str(text, "The message", MAX_MESSAGE)));
  handle("crew:teamThread", (_e, slug) => store.readThread(slugArg(slug)));

  handle("crew:registrySearch", (_e, query) => searchRegistry(str(query, "The search", 100)));
  handle("crew:connectors", () => crew.connectors.list());
  handle("crew:connectorSave", (_e, input, opts) => {
    if (!input || typeof input !== "object") throw new Error("Say the connector's name and how to reach it.");
    const o = opts && typeof opts === "object" ? opts : {};
    const replace = o.replace === undefined || o.replace === null ? null : str(o.replace, "The connector's name", 40);
    return crew.connectors.save(input, { replace, force: o.force === true });
  });
  handle("crew:connectorTest", (_e, name) => crew.connectors.test(str(name, "The connector's name", 40)));
  handle("crew:connectorSignIn", (_e, name, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    if (o.clientId !== undefined && typeof o.clientId !== "string") throw new Error("The client ID should be text.");
    return crew.connectors.signIn(str(name, "The connector's name", 40), { clientId: o.clientId === undefined ? undefined : o.clientId.trim() });
  });
  handle("crew:connectorSignInCancel", (_e, name) => crew.connectors.signInCancel(str(name, "The connector's name", 40)));
  handle("crew:connectorSignOut", (_e, name) => crew.connectors.signOut(str(name, "The connector's name", 40)));
  handle("crew:connectorRemove", (_e, name) => crew.connectors.remove(str(name, "The connector's name", 40)));
  handle("crew:vault", () => {
    const problem = crew.vault.problem();
    if (problem) throw new Error(problem);
    return crew.vault.list();
  });
  handle("crew:vaultSave", (_e, input, opts) => {
    if (!input || typeof input !== "object") throw new Error("Say the login's label, site, username and password.");
    const o = opts && typeof opts === "object" ? opts : {};
    const replace = o.replace === undefined || o.replace === null ? null : vaultName(o.replace);
    return crew.vault.save(input, { replace });
  });
  handle("crew:vaultRemove", (_e, name) => crew.vault.remove(vaultName(name)));
  handle("crew:vaultReveal", (_e, name) => crew.vault.reveal(vaultName(name)));
  handle("crew:vaultCopy", (_e, name, what) => {
    if (!["username", "password", "code"].includes(what)) throw new Error('Copy "username", "password" or "code".');
    return crew.vault.copy(vaultName(name), what);
  });
  handle("crew:siteIcon", (_e, origin) => {
    const site = originOf(origin);
    if (!site) throw new Error("A site icon needs a site address, like https://www.example.com.");
    return siteIcons.get(site);
  });
  handle("crew:saveOffer", (_e, id, save, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    if (o.username !== undefined && (typeof o.username !== "string" || o.username.length > F.LIMITS.vaultUsername)) throw new Error("The username should be text, at most 200 characters.");
    return crew.vault.answerOffer(str(id, "The offer", 80), save === true, { username: o.username });
  });
  handle("crew:reveal", async (_e, slug, rel) => {
    const dir = store.botDir(slugArg(slug));
    if (rel !== undefined && rel !== null) {
      if (typeof rel !== "string" || !/^[\w.-]{1,80}$/.test(rel) || rel.startsWith(".")) throw new Error("That is not a file in the library.");
      await reveal(path.join(dir, "library", rel));
    } else await reveal(dir);
    return true;
  });

  handle("crew:libraryText", (_e, slug, id) => store.libraryText(slugArg(slug), id));
  handle("crew:workspace", (_e, slug) => store.workspaceFiles(slugArg(slug)));
  handle("crew:workspaceRead", (_e, slug, relPath) => {
    if (typeof relPath !== "string" || !relPath.trim()) throw new Error("Say which file.");
    return store.readWorkspaceFile(slugArg(slug), relPath.trim());
  });
  handle("crew:workspaceWrite", (_e, slug, relPath, content) => {
    if (typeof relPath !== "string" || !relPath.trim()) throw new Error("Say which file.");
    return store.writeWorkspaceFile(slugArg(slug), relPath.trim(), String(content || ""));
  });
  handle("crew:workspaceReveal", async (_e, slug, rel) => {
    const ws = store.workspaceDir(slugArg(slug));
    const target = rel ? path.join(ws, rel) : ws;
    await reveal(target);
    return true;
  });

  handle("crew:desktop", (_e, slug) => store.readDesktop(slugArg(slug)));
  handle("crew:setDesktop", (_e, slug, items) => {
    const s = slugArg(slug);
    const saved = store.writeDesktop(s, items);
    crew.onDesktop(s, saved);
    return saved;
  });

  handle("crew:disk", (_e, slug, dir) => {
    if (dir !== undefined && dir !== null && (typeof dir !== "string" || dir.length > 4096)) throw new Error("That folder isn't a path on the bot's disk.");
    return disk.list(slugArg(slug), dir || "");
  });
  handle("crew:diskOp", (_e, slug, op) => {
    if (!op || typeof op !== "object" || Array.isArray(op)) throw new Error('Say what to do, like { op: "mkdir", path: "Files/notes" }.');
    return disk.op(slugArg(slug), op);
  });
  handle("crew:diskUrl", (_e, slug, p) => disk.url(slugArg(slug), str(p, "The file", 4096)));
  handle("crew:setQuota", (_e, slug, gb) => disk.setQuota(slugArg(slug), gb));
  handle("crew:newDoc", (_e, slug, kind, title) => disk.newDoc(slugArg(slug), kind, typeof title === "string" ? title : ""));
  handle("crew:term", (_e, slug, line, cwd) => {
    if (cwd !== undefined && cwd !== null && (typeof cwd !== "string" || cwd.length > 4096)) throw new Error("That folder isn't a path on the bot's disk.");
    return shell.exec(slugArg(slug), str(line, "The command", 4000), cwd || null, "person");
  });
  handle("crew:termHistory", (_e, slug) => shell.history(slugArg(slug)));
  handle("crew:diskSearch", (_e, slug, query) => {
    if (typeof query !== "string" || query.length > 200) throw new Error("Say what to search for, up to 200 characters.");
    return search.search(slugArg(slug), query, { limit: 50 });
  });
  handle("crew:replay", (_e, slug, runId) => replay.steps(slugArg(slug), str(runId, "The run", 80)));

  handle("crew:watches", (_e, slug) => {
    const s = slugArg(slug);
    return { watches: crew.watches.list(s), todos: crew.watches.todos(s), notifications: browsers.notifications(s) };
  });
  handle("crew:removeWatch", (_e, slug, id) => crew.watches.remove(slugArg(slug), str(id, "The watch's id", 40)));
  handle("crew:setTodo", (_e, slug, id, patch) => {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error('Send what to change, like { done: true } or { remove: true }.');
    return crew.watches.setTodo(slugArg(slug), str(id, "The to-do's id", 40), patch);
  });

  handle("crew:watch", (e, slug, mode) => {
    if (!["live", "thumb", "off"].includes(mode)) throw new Error('Watch mode is "live", "thumb" or "off".');
    return browsers.watch(slugArg(slug), e.sender.id, mode);
  });
  handle("crew:control", (_e, slug, on) => browsers.setControl(slugArg(slug), on === true));
  handle("crew:navigate", (_e, slug, url) => browsers.navigate(slugArg(slug), str(url, "The address", 4000)));
  handle("crew:browserGo", (_e, slug, what) => {
    if (!["back", "forward", "reload", "stop"].includes(what)) throw new Error('Go "back", "forward", "reload" or "stop".');
    return browsers.history(slugArg(slug), what);
  });
  handle("crew:mute", (_e, slug, tab, muted) => {
    if (tab !== null && !Number.isInteger(tab)) throw new Error("Say which tab, or null for every tab.");
    return browsers.setMuted(slugArg(slug), tab, muted === true);
  });
  // The person closed the browser window: close its tabs too, unless the bot is using them now. Sign-ins stay (the session persists).
  handle("crew:closeBrowser", (_e, slug) => {
    if (runner.running(slugArg(slug))) return false;
    browsers.close(slug);
    crew.onChange();
    return true;
  });
  handle("crew:tab", (_e, slug, action, id) => {
    if (!["new", "switch", "close"].includes(action)) throw new Error('A tab action is "new", "switch" or "close".');
    if (action !== "new" && !Number.isInteger(id)) throw new Error("Say which tab.");
    return browsers.tab(slugArg(slug), action, id);
  });
  ipcMain.on("crew:present", (e, slug, on) => {
    try {
      assertSender(e);
    } catch {
      return;
    }
    if (F.isSlug(slug)) browsers.setPresent(slug, e.sender.id, on === true);
  });
  ipcMain.on("crew:viewport", (e, slug, view) => {
    try {
      assertSender(e);
    } catch {
      return;
    }
    if (F.isSlug(slug)) browsers.setViewport(slug, view);
  });
  ipcMain.on("crew:input", (e, slug, input) => {
    try {
      assertSender(e);
    } catch {
      return;
    }
    if (F.isSlug(slug)) browsers.input(slug, input);
  });

  handle("crew:settings", () => settings.get());
  handle("crew:setSettings", (_e, patch) => {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Send the settings to change as an object, like { notifications: false }.");
    const out = settings.set(patch);
    crew.onChange();
    return out;
  });
  handle("crew:clis", async (_e, fresh) => {
    const list = await Promise.all(F.CLI_KINDS.map((k) => assistantCatalog(k, { fresh: fresh === true }).catch(() => null)));
    return list.filter(Boolean).map((c) => ({ kind: c.kind, name: c.name, installed: c.installed, signedIn: c.signedIn, version: c.version, account: c.account, models: c.models }));
  });
}

module.exports = { registerIpc };
