// Fenna Crew's services, put together: the bot store, the runner and its
// queue, the scheduler, what bots wait on the person for, each bot's
// browser, the connectors installed on this computer and the gateway bots
// reach them through, the vault of the person's logins, and the pipe their
// MCP servers talk to. main.cjs adds the window, the tray and the page's
// calls (ipc.cjs).

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startRun } = require("@opendeck/shell/main/agent.cjs");
const { createStore } = require("./store.cjs");
const { createWaits } = require("./waits.cjs");
const { createLink } = require("./link.cjs");
const { createRunner } = require("./runner.cjs");
const { createApprover, createHandlers } = require("./handlers.cjs");
const { createScheduler } = require("./scheduler.cjs");
const { createServers } = require("./servers.cjs");
const { createBrowsers } = require("./browser.cjs");
const { createViews } = require("./views.cjs");
const { createConnectorStore } = require("./connectors.cjs");
const { createSkillStore, grantsOf, revokeAll } = require("./skills.cjs");
const { createConnections } = require("./connections.cjs");
const { createGateway } = require("./gateway.cjs");
const { createVault } = require("./vault.cjs");
const { createLogins } = require("./logins.cjs");
const { createProjects } = require("./projects.cjs");
const { createRepos } = require("./repos.cjs");
const { createGithub } = require("./github.cjs");
const { createTeams } = require("./teams.cjs");
const { createAppWindows } = require("./appwindows.cjs");
const { createDesktopInput } = require("./desktop-input.cjs");
const osSandbox = require("./os-sandbox.cjs");
const { createToolLabel } = require("./labels.cjs");
const { createAppHost } = require("./appHost.cjs");
const { createApps } = require("./apps.cjs");
const { createTeamChat } = require("./team-chat.cjs");
const { createWatches } = require("./watches.cjs");
const { createDisk, freeOnDrive } = require("./disk.cjs");
const { createNotices } = require("./notices.cjs");
const { createShell } = require("./shell.cjs");
const { createSearch } = require("./search.cjs");
const { createFiles } = require("./files.cjs");
const { createReplay } = require("./replay.cjs");
const { noUsage } = require("./usage.cjs");
const F = require("./format.cjs");

/** How long an offer to save a login waits for the person. */
const OFFER_MS = 10 * 60_000;

const LEAD = {
  name: "Fenna",
  job: "Leads the crew: plans the work and hands it to the right bot",
  how: "Help the person get started and keep the crew working together. When they say what they want help with, suggest one or two bots with a clear job and schedule each, and create them with create_bot once they agree. When they ask for something that fits another bot's job, hand it over with message_bot and report back what it said. When they want an app, a tool or a small website made, that is Builder's job: say so, and hand it to Builder.",
  schedule: "manual",
  avatar: "beacon",
  color: "clay",
  wallpaper: "slate",
};

/** Ships with Crew: builds apps, tools and small websites on its own computer (docs/spec/crew-apps.md). */
const BUILDER = {
  name: "Builder",
  job: "Builds apps, tools and small websites for you, tests them, and keeps them working",
  how: [
    "You build software for the person on your own computer, so they only have to say what they want.",
    "An app is something they open and use: make Files/Apps/<name>/ with an app.json and web files using write_file (the app tool's description has the format). Ask only for the permissions it needs. Give it tools when the person, or you, will want to use it from chat. Then open it with the app tool, try every feature, fix what is wrong, and take out your test data. Tell the person to open it from your desktop and press Allow.",
    "A website or a program goes in Files/Projects/<name>/ and runs with the command tool (node, npm, npx). Plain HTML, CSS and JavaScript with a small Node server work; build tools that start other programs, like Vite or Next.js, don't work here yet, so don't use them. Start a server in the background and check it in your browser.",
    "When the person asks for a change, read the files first, change them with edit_file, and test again. When they ask for something an app you made can do, use that app's tools.",
    "Keep a short list of what you have built, and what each app's tools do, with remember.",
  ].join("\n\n"),
  schedule: "manual",
  avatar: "crate",
  color: "ochre",
  wallpaper: "indigo",
  projects: "on",
};
/** Marks a crew that has been given the Builder, so a person who deletes it doesn't get it back. */
const BUILDER_MARK = "builder-added.json";

/** Every crew gets the Builder once: new ones on first launch, older ones on their first start with it. */
function giveBuilder(store, root) {
  const mark = path.join(root, BUILDER_MARK);
  if (fs.existsSync(mark)) return;
  const has = store.slugs().some((s) => store.readBot(s)?.bot?.name === BUILDER.name);
  if (!has) store.createBot({ ...BUILDER, cli: "claude" });
  fs.writeFileSync(mark, `${JSON.stringify({ at: new Date().toISOString() })}\n`);
}

/**
 * The OS sandbox a coding run's CLI runs in, for the folder it works in. It
 * can write there, in Crew's assistant folder (the CLIs' homes), temp, the
 * usual tool caches and its AI's own settings, and can't read the person's
 * keys. None on Windows or without bubblewrap: each AI's own limits apply.
 */
function codingSandbox(userData) {
  const available = osSandbox.detect(process.platform);
  if (!available.bwrap && !available.sandboxExec) return () => null;
  const home = os.homedir();
  const caches = [".claude", ".claude.json", ".codex", ".gemini", ".cache", ".npm", ".pub-cache", ".gradle", ".cargo", ".rustup", ".m2", "go", ".nuget", ".dart-tool", "Library/Caches"].map((d) => path.join(home, d)).filter((d) => fs.existsSync(d));
  return (dir) => (command, args) =>
    osSandbox.wrap({ platform: process.platform, command, args, writable: [dir, path.join(userData, "assistant"), os.tmpdir(), ...caches], readDeny: osSandbox.defaultReadDeny(home).filter((p) => fs.existsSync(p)), available });
}

/**
 * @param {object} o
 * @param {string} o.root           the Crew folder (<userData>/Crew, or OPENDECK_CREW_ROOT)
 * @param {string} o.userData
 * @param {boolean} o.packaged
 * @param {string} o.resources
 * @param {string} o.repo
 * @param {(channel: string, payload: unknown) => void} o.broadcast  to every page
 * @param {() => Electron.WebFrameMain | null} [o.liveTarget]  the page's frame a bot's live screen is drawn in (GPU frames)
 * @param {object} o.secrets  the system's secure storage (connectors.cjs says what it holds)
 * @param {{ connectServer(spec: object, opts?: object): Promise<object>, signIn(o: object): Promise<{ account: string|null }>, signOut(o: object): Promise<void>, supportsOAuth(url: string): Promise<boolean> }} o.client  the MCP client connectors are started and signed in with
 * @param {(url: string) => Promise<void>} [o.openExternal]  open an address in the person's default browser (sign-in)
 * @param {(dir: string) => Promise<void>} [o.trash]
 * @param {() => object} o.settings
 * @param {{ writeText(text: string): void, readText(): string }} [o.clipboard]  copying from the vault
 * @param {number} [o.waitTimeoutMs]
 * @param {(waiting: object[], offers: object[]) => void} [o.onNeeds]  told everything that waits on the person each time the overview changes (system notifications)
 * @param {object} [o.usage]  counts events for the anonymous usage counts (usage.cjs)
 * @param {object | null} [o.sandbox]  runs the bots' scripts (`run` in the terminal); null: scripts aren't available
 */
function createCrew({ root, userData, packaged, resources, repo, broadcast, liveTarget, secrets, client, openExternal = async () => {}, trash, settings, clipboard = null, waitTimeoutMs, onNeeds = () => {}, sandbox = null, usage = noUsage, electron = null }) {
  // Connectors belong to this computer, not to a crew folder, so they live under userData always.
  const connectors = createConnectorStore({ dir: path.join(userData, "Crew", "connectors"), secrets });
  const store = createStore(root, { trash, migrate: (slug, legacy) => connectors.migrate(slug, legacy) });
  let changeTimer = null;
  let connTimer = null;
  let views = null;
  const onChange = () => {
    if (changeTimer) return;
    changeTimer = setTimeout(() => {
      changeTimer = null;
      const overview = views.overview();
      broadcast("crew:changed", overview);
      onNeeds(overview.waiting, overview.offers);
    }, 80);
  };
  const onConnectorsChange = () => {
    if (connTimer) return;
    connTimer = setTimeout(() => {
      connTimer = null;
      broadcast("crew:connectors", connectorViews());
    }, 80);
  };
  const connections = createConnections({ connectors, client, onChange: onConnectorsChange });
  // Skills belong to this computer too: <userData>/Crew/skills/<name>/, beside the connectors.
  const skills = createSkillStore({ dir: path.join(userData, "Crew", "skills") });
  let vaultTimer = null;
  const onVaultChange = () => {
    if (vaultTimer) return;
    vaultTimer = setTimeout(() => {
      vaultTimer = null;
      broadcast("crew:vault", vaultViews());
    }, 80);
  };
  // Logins belong to this computer too, in their own encrypted file.
  const vault = createVault({ file: path.join(userData, "Crew", "vault.dat"), secrets, onChange: onVaultChange });
  /** id → a login the person sent while in control, waiting for Save or Not now. Only here, in memory. */
  const offers = new Map();
  const onDesktop = (slug, items) => broadcast("crew:desktop", { slug, items });
  const waits = createWaits({ onChange, ...(waitTimeoutMs ? { timeoutMs: waitTimeoutMs } : {}) });
  // A change on a bot's disk may make, change or remove one of its apps (apps is set below, once its runner exists).
  let apps = null;
  const diskBroadcast = (channel, payload) => {
    broadcast(channel, payload);
    if (channel === "crew:disk" && payload && payload.slug && apps) apps.touched(payload.slug);
  };
  const disk = createDisk({ store, broadcast: diskBroadcast, settingsFile: path.join(userData, "Crew", "disk-quotas.json") });
  const shell = createShell({ disk, store, broadcast, sandbox });
  const notices = createNotices({ botDir: (slug) => store.botDir(slug), broadcast, now: () => new Date() });
  const search = createSearch({ disk });
  const files = createFiles({ disk, broadcast: diskBroadcast });
  const browsers = createBrowsers({
    workspaceDir: (slug) => store.workspaceDir(slug),
    diskFree: (slug) => disk.free(slug),
    driveFree: freeOnDrive,
    onFrame: (_slug, frame) => broadcast("crew:frame", frame),
    onCursor: (_slug, c) => broadcast("crew:cursor", c),
    onState: (slug, state) => broadcast("crew:browser", { slug, state }),
    onCapture: (slug, login) => offerSave(slug, login),
    onSiteNotification: (slug, n) => {
      notices.add(slug, { kind: "site", title: n.title, body: n.body, origin: n.origin });
      watches.onNotification(slug, n);
    },
    onTitleCount: (slug, n) => watches.onTitleCount(slug, n),
    onDownload: (slug, rec) => notices.add(slug, rec.state === "done" ? { kind: "download", title: rec.name, path: rec.path } : { kind: "download", title: "Download failed", body: `${rec.name}: ${rec.reason}` }),
    onElementChange: (slug, watchId, text) => watches.onElementChange(slug, watchId, text),
    onStep: (slug, step) => replay.onStep(slug, step),
    liveTarget,
  });
  let handle = null;
  let gateway = null;
  let logins = null;
  let projects = null;
  let repos = null;
  let teams = null;
  const link = createLink({ handle: (ctx, method, params) => handle(ctx, method, params) });
  // The bot's apps (apps.cjs). Their sessions and the page's calls need Electron, which main passes in; without it no bot has apps.
  // The runner is looked up at call time: it is created below, after the apps that its run tools need.
  apps = electron ? createApps({ disk, store, broadcast, runner: { enqueue: (o) => runner.enqueue(o) }, session: electron.session, ipcMain: electron.ipcMain }) : null;
  const appHost = apps ? createAppHost({ apps, broadcast }) : null;
  const appTitle = (slug, name) => {
    const m = apps && name ? apps.manifest(slug, name) : null;
    return (m && m.app && m.app.title) || null;
  };
  // Repos are made below with the approver; a run started before that has none.
  const serversFor = createServers({ link, store, connectors, connections, packaged, resources, repo, homes: path.join(userData, "assistant", "agy-crew"), apps, repos: { codingFor: (slug, cli) => (repos ? repos.codingFor(slug, cli) : null) } });
  const runner = createRunner({
    store,
    startRun,
    repoNames: (slug) => (repos ? repos.names(slug) : []),
    teamNotes: (slug) => (repos && teams ? repos.names(slug).map((n) => teams.promptFor(repos.whereOf(slug, n).key, slug)).filter(Boolean).join("\n") : ""),
    serversFor,
    link,
    waits,
    toolLabel: createToolLabel({ appTitle }),
    onChange,
    maxConcurrent: Math.max(1, Math.min(4, Number(settings && settings().maxConcurrent) || 2)),
    installed: (name) => connectors.has(name),
    skillsFor: (slug, granted) => skills.syncInto(store.workspaceDir(slug), granted),
    usage,
    onEnd: (runId) => {
      if (gateway) gateway.endRun(runId);
      if (logins) logins.endRun(runId);
      if (projects) projects.endRun(runId);
      watches.runEnded();
    },
    emitLive: (slug, runId, event) => {
      broadcast("crew:event", { slug, runId, event });
      if (event.type === "end") notices.add(slug, { kind: "run", title: event.outcome === "error" ? "Run failed" : event.outcome === "stopped" ? "Run stopped" : "Run finished", body: event.message || "" });
    },
  });
  const replay = createReplay({ store, runner });
  const approve = createApprover({ store, runner, waits, usage });
  gateway = createGateway({ store, connectors, connections, approve, runner, onChange, apps, appHost });
  logins = createLogins({ store, vault, browsers, approve, runner, onChange });
  projects = createProjects({ disk, store, runner, approve, browsers, broadcast });
  teams = createTeams({ file: path.join(userData, "crew-teams.json") });
  repos = createRepos({
    disk,
    store,
    approve,
    broadcast,
    sandboxFor: codingSandbox(userData),
    onShip: (e) => {
      const w = repos.whereOf(e.slug, e.name);
      teams.ship({ repoKey: w.key, slug: e.slug, kind: e.kind, title: e.title, url: e.url });
    },
  });
  const github = createGithub({ approve });
  const appWindows = createAppWindows({ desktopCapturer: electron ? electron.desktopCapturer : null, input: electron ? createDesktopInput() : null });
  const watches = createWatches({ store, runner, browsers, broadcast, onFire: (slug, w, what) => notices.add(slug, { kind: w.kind === "timer" ? "reminder" : "watch", title: w.note, body: what }) });
  handle = createHandlers({ store, runner, waits, approve, browsers, gateway, appHost, logins, onChange, onDesktop, watches, search, files, shell, projects, repos, github, teams, appWindows, disk, usage });
  const scheduler = createScheduler({ store, runner });
  const teamChat = createTeamChat({ store, runner, onChange });
  views = createViews({ store, runner, waits, scheduler, browsers, settings, offers: () => offerViews() });

  /** Bots granted each login: name → [{ slug, name, level }]. */
  function grantsByLogin() {
    const out = new Map();
    for (const slug of store.slugs()) {
      const r = store.readBot(slug);
      if (!r || !r.bot) continue;
      for (const g of r.bot.logins || []) {
        if (!out.has(g.name)) out.set(g.name, []);
        out.get(g.name).push({ slug, name: r.bot.name || slug, level: g.level });
      }
    }
    return out;
  }

  function vaultViews() {
    const used = grantsByLogin();
    return vault.list().map((i) => vault.view(i, used.get(i.name) || []));
  }

  const botName = (slug) => {
    const r = store.readBot(slug);
    return (r && r.bot && r.bot.name) || slug;
  };

  /** What the page may see of an offer: never the password. */
  function offerViews() {
    return [...offers.values()].map((o) => ({ id: o.id, slug: o.slug, botName: botName(o.slug), origin: o.origin, username: o.username, existing: o.existing, at: o.at }));
  }

  /** Offer to save a login the person just sent while in control (one per bot and site; the newest wins). */
  function offerSave(slug, login) {
    const origin = F.originOf(login.origin);
    if (!origin || !("origin" in F.checkOrigin(origin))) return;
    for (const [id, o] of offers) {
      if (o.slug === slug && o.origin === origin) {
        clearTimeout(o.timer);
        offers.delete(id);
      }
    }
    const known = vault.match(origin, login.username);
    const id = crypto.randomUUID();
    const o = { id, slug, origin, username: login.username, password: login.password, existing: known ? known.name : null, at: new Date().toISOString(), timer: null };
    // Not answered in 10 minutes: forgotten.
    o.timer = setTimeout(() => {
      offers.delete(id);
      onChange();
    }, OFFER_MS);
    offers.set(id, o);
    onChange();
  }

  /** Copied secrets are cleared from the clipboard after this long, if it still holds them. */
  const CLEAR_CLIPBOARD_MS = 30_000;
  let clipTimer = null;

  /** Bots granted each connector: name → [{ slug, name }]. */
  function grantsByConnector() {
    const out = new Map();
    for (const slug of store.slugs()) {
      const r = store.readBot(slug);
      if (!r || !r.bot) continue;
      for (const c of r.bot.connectors) {
        if (c.type !== "grant") continue;
        if (!out.has(c.name)) out.set(c.name, []);
        out.get(c.name).push({ slug, name: r.bot.name || slug });
      }
    }
    return out;
  }

  /** name → the sign-in waiting on the person's browser, to cancel it. */
  const signingIn = new Map();

  function connectorView(c, used = grantsByConnector()) {
    return connectors.view(c, { usedBy: used.get(c.name) || [], running: connections.running(c.name), starting: connections.starting(c.name), signingIn: signingIn.has(c.name) });
  }

  const hostOf = (url) => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  };

  function connectorViews() {
    const used = grantsByConnector();
    return connectors.list().map((c) => connectorView(c, used));
  }

  function skillViews() {
    const used = grantsOf(store);
    return skills.list().map((s) => ({ ...s, usedBy: used.get(s.name) || [] }));
  }

  return {
    notices,
    appHost,
    apps,
    store,
    disk,
    files,
    shell,
    search,
    replay,
    waits,
    browsers,
    logins,
    link,
    runner,
    scheduler,
    views,
    onChange,
    onDesktop,
    watches,
    projects,
    get repos() {
      return repos;
    },
    get teams() {
      return teams;
    },

    connectors: {
      list: connectorViews,

      /**
       * Add a connector (or change one: replace names it). Crew starts it and
       * lists its tools first; if that fails nothing is saved unless force,
       * and error says how to fix it. Bad input throws.
       */
      async save(input, { replace = null, force = false } = {}) {
        const c = await connectors.prepare(input, { replace });
        let needsSignIn = false;
        try {
          c.tools = await connections.test(c);
          c.status = "ready";
        } catch (e) {
          // A server that signs people in is saved as it is, waiting for Sign in.
          needsSignIn = !!(e.signIn && c.type === "url" && (await client.supportsOAuth(c.url)));
          if (!force && !needsSignIn) return { connector: null, error: e.message, needsSignIn: false };
          c.status = "error";
          // "Sign in needed" says it on the connector; error is kept for what went wrong.
          c.error = needsSignIn ? "" : e.message;
          if (needsSignIn) c.oauth = { clientId: c.oauth ? c.oauth.clientId : "", signedIn: false, account: "" };
        }
        c.checkedAt = new Date().toISOString();
        if (replace !== null) await connections.stop(replace);
        connectors.save(c);
        onConnectorsChange();
        return { connector: connectorView(c), error: needsSignIn ? `${hostOf(c.url)} asks you to sign in. Choose Sign in to do it in your browser.` : c.error, needsSignIn };
      },

      /**
       * Sign in to a web connector in the person's default browser. Resolves
       * once they finish (or it fails, is cancelled, or times out). clientId:
       * one the person pasted, for servers that don't let apps register.
       */
      async signIn(name, { clientId } = {}) {
        const c = connectors.get(name);
        if (!c) throw new Error(`There is no connector "${name}".`);
        if (c.type !== "url") throw new Error(`${name} is a program on this computer; only web connectors sign in.`);
        if (clientId !== undefined && clientId !== "" && !F.CLIENT_ID_RE.test(clientId)) throw new Error("That is not a client ID: it is up to 200 visible characters with no spaces.");
        signingIn.get(name)?.abort();
        const abort = new AbortController();
        signingIn.set(name, abort);
        const id = clientId !== undefined ? clientId : c.oauth ? c.oauth.clientId : "";
        connectors.setOAuth(name, { clientId: id, signedIn: false, account: "" });
        onConnectorsChange();
        try {
          await connections.stop(name);
          const r = await client.signIn({ url: c.url, store: connectors.authStore(name), clientId: id || undefined, openBrowser: (url) => openExternal(url), signal: abort.signal });
          connectors.setOAuth(name, { signedIn: true, account: r.account || "" });
          try {
            connectors.setChecked(name, { status: "ready", error: "", tools: await connections.test(connectors.get(name)) });
          } catch (e) {
            connectors.setChecked(name, { status: "error", error: e.message });
          }
          return { connector: connectorView(connectors.get(name)), error: "", needsClientId: false };
        } catch (e) {
          if (e.code !== "cancelled") connectors.setChecked(name, { status: "error", error: e.message });
          return { connector: connectorView(connectors.get(name)), error: e.message, needsClientId: e.code === "no_registration" };
        } finally {
          if (signingIn.get(name) === abort) signingIn.delete(name);
          onConnectorsChange();
        }
      },

      /** Stop waiting for a sign-in the person started. */
      signInCancel(name) {
        const a = signingIn.get(name);
        if (!a) return false;
        a.abort();
        return true;
      },

      /** Forget the sign-in (and ask the server to revoke it); bots can't use it until someone signs in again. */
      async signOut(name) {
        const c = connectors.get(name);
        if (!c || !c.oauth) throw new Error(`${name} has no sign-in.`);
        await connections.stop(name);
        await client.signOut({ url: c.url, store: connectors.authStore(name) });
        connectors.setOAuth(name, { signedIn: false, account: "" });
        connectors.setChecked(name, { status: "error", error: "" });
        onConnectorsChange();
        return connectorView(connectors.get(name));
      },

      /** Start it again (apart from any copy bots are using), list its tools, and keep the outcome. */
      async test(name) {
        const c = connectors.get(name);
        if (!c) throw new Error(`There is no connector "${name}".`);
        try {
          connectors.setChecked(name, { status: "ready", error: "", tools: await connections.test(c) });
        } catch (e) {
          connectors.setChecked(name, { status: "error", error: e.message });
        }
        onConnectorsChange();
        return connectorView(connectors.get(name));
      },

      /** Stop it, take it away from every bot it was granted to, and delete it. Returns those bots' names. */
      async remove(name) {
        if (!connectors.get(name)) throw new Error(`There is no connector "${name}".`);
        signingIn.get(name)?.abort();
        const bots = grantsByConnector().get(name) || [];
        for (const b of bots) {
          const r = store.readBot(b.slug);
          if (r && r.bot) store.updateBot(b.slug, { connectors: r.bot.connectors.filter((c) => !(c.type === "grant" && c.name === name)) });
        }
        await connections.stop(name);
        connectors.remove(name);
        onConnectorsChange();
        onChange();
        return { bots: bots.map((b) => b.name) };
      },
    },

    skills: {
      list: skillViews,

      /** One installed skill: its instructions and files, and the bots that have it. */
      get(name) {
        const s = skills.get(name);
        return { ...s, usedBy: grantsOf(store).get(name) || [] };
      },

      /** Read a folder, a file or an address into a preview to show before anything is added. */
      prepare: (source) => skills.prepare(source),

      /** Add the previewed skill (replacing one of its name). */
      commit(id) {
        const { name } = skills.commit(id);
        broadcast("crew:skills", skillViews());
        return skillViews().find((s) => s.name === name);
      },

      /** Take a skill away from this computer and from every bot that had it. Returns those bots' names. */
      remove(name) {
        if (!skills.has(name)) throw new Error(`There is no skill "${name}".`);
        const bots = revokeAll(store, name);
        skills.remove(name);
        broadcast("crew:skills", skillViews());
        onChange();
        return { bots };
      },
    },

    vault: {
      list: vaultViews,

      /** Why the vault can't be opened, or "". */
      problem: () => vault.problem(),

      /** Add a login, or change one (replace: its name). Bad input throws with what to fix. */
      async save(input, { replace = null } = {}) {
        const item = await vault.save(input, { replace });
        onChange();
        return vault.view(item, grantsByLogin().get(item.name) || []);
      },

      /** Take it away from every bot granted it, and delete it. Returns those bots' names. */
      async remove(name) {
        if (!vault.has(name)) throw new Error(`There is no login "${String(name).slice(0, 40)}".`);
        const bots = grantsByLogin().get(name) || [];
        for (const b of bots) {
          const r = store.readBot(b.slug);
          if (r && r.bot) store.updateBot(b.slug, { logins: (r.bot.logins || []).filter((g) => g.name !== name) });
        }
        await vault.remove(name);
        onChange();
        return { bots: bots.map((b) => b.name) };
      },

      /** The password, for the person who clicked Reveal. Never sent to a bot. */
      async reveal(name) {
        return { password: (await vault.secrets(name)).password };
      },

      /** Copy the username, password or current code to the clipboard, cleared after 30 seconds if it still holds it. */
      async copy(name, what) {
        if (!clipboard) throw new Error("Copying isn't available here.");
        const i = vault.get(name);
        if (!i) throw new Error(`There is no login "${String(name).slice(0, 40)}".`);
        let text = i.username;
        let secondsLeft = null;
        if (what === "password") text = (await vault.secrets(name)).password;
        else if (what === "code") {
          const c = await vault.code(name);
          text = c.code;
          secondsLeft = c.secondsLeft;
        }
        if (!text) throw new Error("There is nothing to copy.");
        clipboard.writeText(text);
        clearTimeout(clipTimer);
        if (what !== "username") {
          clipTimer = setTimeout(() => {
            if (clipboard.readText() === text) clipboard.writeText("");
          }, CLEAR_CLIPBOARD_MS);
        }
        return { copied: true, clearsIn: what === "username" ? null : CLEAR_CLIPBOARD_MS / 1000, secondsLeft };
      },

      /**
       * Answer an offer to save a login sent during take control. Save adds it
       * to the vault (or updates the one with the same site and username) and
       * grants it to the bot on "ask". The person may correct the username.
       */
      async answerOffer(id, save, { username } = {}) {
        const o = offers.get(id);
        if (!o) return { item: null };
        clearTimeout(o.timer);
        offers.delete(id);
        onChange();
        if (!save) return { item: null };
        const user = typeof username === "string" ? username.trim() : o.username;
        const known = vault.match(o.origin, user);
        const item = known
          ? await vault.save({ label: known.label, origins: known.origins, username: user, password: o.password, keepTotp: true, notes: known.notes }, { replace: known.name })
          : await vault.save({ label: new URL(o.origin).host, origins: [o.origin], username: user, password: o.password });
        const r = store.readBot(o.slug);
        if (r && r.bot && !(r.bot.logins || []).some((g) => g.name === item.name)) store.updateBot(o.slug, { logins: [...(r.bot.logins || []), { name: item.name, level: "ask" }] });
        onChange();
        onVaultChange();
        return { item: vault.view(item, grantsByLogin().get(item.name) || []) };
      },
    },

    /** Folders, the pipe, the lead bot on first launch, and the schedule. */
    async start() {
      store.ensure();
      await vault.load();
      if (!store.slugs().length) store.createBot({ ...LEAD, cli: "claude" });
      giveBuilder(store, root);
      await link.listen();
      scheduler.start();
      watches.start();
    },

    /**
     * Fenna's first hello, once: only while no bot has ever run. `signedIn`
     * lists the CLIs the person can use; the lead moves to the first of them
     * when its own CLI is not among them.
     */
    greet(signedIn = []) {
      const o = views.overview();
      if (!o.firstLaunch) return null;
      const lead = store.slugs().find((s) => {
        const r = store.readBot(s);
        return r && r.bot && r.bot.name === LEAD.name;
      });
      if (!lead || runner.running(lead) || runner.isQueued(lead)) return null;
      // The bots Crew ships with move to a CLI the person has signed in to.
      for (const slug of store.slugs()) {
        const cur = store.readBot(slug);
        if (!cur || !cur.bot || (cur.bot.name !== LEAD.name && cur.bot.name !== BUILDER.name)) continue;
        if (signedIn.length && !signedIn.includes(cur.bot.brain.cli)) store.updateBot(slug, { brain: { cli: signedIn[0], model: "", effort: "" } });
      }
      return { runId: runner.enqueue({ slug: lead, trigger: "welcome" }).runId };
    },

    /** A person's message to a group chat (a team); see team-chat.cjs. */
    teamSend(slug, text) {
      return teamChat.send(slug, text);
    },

    stop() {
      for (const o of offers.values()) clearTimeout(o.timer);
      offers.clear();
      scheduler.stop();
      watches.stop();
      if (appHost) appHost.closeAll();
      if (apps) apps.stop();
      shell.flush();
      notices.flush();
      runner.stopAll();
      projects.killAll();
      browsers.closeAll();
      link.close();
      void connections.stopAll();
    },
  };
}

module.exports = { createCrew, giveBuilder, BUILDER };
