// Teams: bots that work on the same repo take roles, like a small software
// team, and the crew keeps a log of what it shipped so the log can be shown
// publicly. Both live in one JSON file (teams.json in the crew's folder), so
// a bot's prompt and the public page always read the same truth.
//
// A repo is named by any string id the caller picks (its source path or
// origin URL). One bot has one role per repo; a repo may have many builders,
// but at most one lead, one tester and one reviewer.

const fs = require("node:fs");
const path = require("node:path");

/** The roles on a team, in the order they are listed. */
const ROLES = Object.freeze({
  lead: {
    title: "lead",
    duty: "You keep the roadmap in a Fenna Doc named \"<repo> roadmap\" and turn the person's goals into small issues. Assign each issue to a builder with message_bot, and check progress every day. You never merge; the person merges every pull request.",
  },
  builder: {
    title: "builder",
    duty: "Take one issue at a time and work on your own branch named fenna/<issue>-<topic>. Run the repo's tests and build, push with repo {action: \"push\"} and open a draft pull request. Then tell the tester with message_bot.",
  },
  tester: {
    title: "tester",
    duty: "Run the app the builder changed and capture its windows with app_windows at two sizes, 1440x900 and 1000x700. Write your findings as comments on the pull request, then say pass or fail to the builder and the lead.",
  },
  reviewer: {
    title: "reviewer",
    duty: "Read the diff of each pull request and check that the tests cover what changed. Request changes or approve on the pull request, and say why in one line. You never merge.",
  },
});

const LIMITED = new Set(["lead", "tester", "reviewer"]);
const KINDS = ["push", "pr", "merge", "issue", "release"];
const LOG_MAX = 1000;
const LIMIT_DEFAULT = 50;

/** A name that must be a non-empty string. */
function text(v, what) {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${what} is required: give a name, not an empty value.`);
  return v;
}

/** Whether a log entry read from disk has the shape ship() writes. */
function isEntry(e) {
  return (
    !!e &&
    typeof e === "object" &&
    typeof e.at === "string" &&
    typeof e.repoKey === "string" &&
    typeof e.slug === "string" &&
    KINDS.includes(e.kind) &&
    typeof e.title === "string" &&
    typeof e.url === "string"
  );
}

/** Newest-first sort key: the entry's time, then its place in the log. */
const when = (e) => Date.parse(e.at) || 0;

/**
 * The team and shipping log, kept in one JSON file. Reads never throw: a
 * missing or corrupt file is an empty team and an empty log. Writes go to a
 * temporary file that is then renamed over the real one.
 * @param {object} o
 * @param {string} o.file  the JSON path, e.g. <crew>/teams.json
 * @param {() => Date} [o.now]  the clock (tests pass a fixed one)
 */
function createTeams({ file, now = () => new Date() }) {
  text(file, "file");

  /** The state on disk, with anything malformed dropped. */
  function read() {
    let v = null;
    try {
      v = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      v = null;
    }
    const teams = Object.create(null);
    const src = v && typeof v === "object" && v.teams && typeof v.teams === "object" ? v.teams : {};
    for (const [repoKey, members] of Object.entries(src)) {
      if (!members || typeof members !== "object") continue;
      const team = Object.create(null);
      for (const [slug, role] of Object.entries(members)) {
        if (typeof role === "string" && Object.hasOwn(ROLES, role)) team[slug] = role;
      }
      if (Object.keys(team).length) teams[repoKey] = team;
    }
    const log = v && Array.isArray(v.log) ? v.log.filter(isEntry) : [];
    return { teams, log };
  }

  /** Write the state atomically: a temporary file, then a rename over the real one. */
  function write(state) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ teams: state.teams, log: state.log }, null, 2)}\n`);
    fs.renameSync(tmp, file);
  }

  /**
   * Give a bot a role on a repo. Assigning the role it already has does
   * nothing. A bot with another role there must be unassigned first, and a
   * lead, tester or reviewer seat that is taken must be freed first.
   */
  function assign(repoKey, slug, role) {
    const key = text(repoKey, "repoKey");
    const who = text(slug, "slug");
    if (!Object.hasOwn(ROLES, role)) {
      throw new Error(`"${String(role).slice(0, 40)}" isn't a role. The roles are ${Object.keys(ROLES).join(", ")}.`);
    }
    const state = read();
    const team = state.teams[key] || Object.create(null);
    const have = team[who];
    if (have === role) return { repoKey: key, slug: who, role };
    if (have) throw new Error(`${who} is already the ${have} on ${key}. Unassign it first.`);
    if (LIMITED.has(role)) {
      const holder = Object.keys(team).find((s) => team[s] === role);
      if (holder) throw new Error(`${key} already has a ${role}: ${holder}. Unassign it first.`);
    }
    team[who] = role;
    state.teams[key] = team;
    write(state);
    return { repoKey: key, slug: who, role };
  }

  /** Take a bot off a repo's team. Returns false when it was not on the team. */
  function unassign(repoKey, slug) {
    const key = text(repoKey, "repoKey");
    const who = text(slug, "slug");
    const state = read();
    const team = state.teams[key];
    if (!team || !Object.hasOwn(team, who)) return false;
    delete team[who];
    if (!Object.keys(team).length) delete state.teams[key];
    write(state);
    return true;
  }

  /** The team on a repo: [{ slug, role }], by role order and then slug. */
  function teamOf(repoKey) {
    const key = text(repoKey, "repoKey");
    const team = read().teams[key] || {};
    const order = Object.keys(ROLES);
    return Object.keys(team)
      .map((slug) => ({ slug, role: team[slug] }))
      .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  }

  /** The role a bot has on a repo, or null. */
  function roleOf(repoKey, slug) {
    const team = read().teams[text(repoKey, "repoKey")] || {};
    const who = text(slug, "slug");
    return Object.hasOwn(team, who) ? team[who] : null;
  }

  /** The part of a bot's prompt that says what its role is and who its teammates are; "" when it has no role. */
  function promptFor(repoKey, slug) {
    const key = text(repoKey, "repoKey");
    const who = text(slug, "slug");
    const mine = roleOf(key, who);
    if (!mine) return "";
    const mates = teamOf(key)
      .filter((m) => m.slug !== who)
      .map((m) => `${m.role} ${m.slug}`);
    return `Team on ${key}: you are the ${ROLES[mine].title}. ${ROLES[mine].duty} Teammates: ${mates.join(", ") || "none yet"}.`;
  }

  /**
   * Record something the crew shipped. The log keeps the newest 1000 entries.
   * @param {{ repoKey: string, slug: string, kind: string, title: string, url: string, at?: string }} e
   */
  function ship({ repoKey, slug, kind, title, url, at } = {}) {
    const key = text(repoKey, "repoKey");
    const who = text(slug, "slug");
    if (!KINDS.includes(kind)) throw new Error(`The kind must be one of ${KINDS.join(", ")}, not "${String(kind).slice(0, 20)}".`);
    const entry = {
      at: at === undefined ? now().toISOString() : text(at, "at"),
      repoKey: key,
      slug: who,
      kind,
      title: text(title, "title"),
      url: text(url, "url"),
    };
    const state = read();
    state.log.push(entry);
    state.log = state.log.slice(-LOG_MAX);
    write(state);
    return entry;
  }

  /** The newest shipped entries, optionally for one repo. Newest first. */
  function shipped({ repoKey, limit = LIMIT_DEFAULT } = {}) {
    const n = Math.max(0, Math.floor(Number(limit)) || 0);
    const key = repoKey === undefined ? null : text(repoKey, "repoKey");
    return read()
      .log.map((e, i) => ({ e, i }))
      .filter(({ e }) => !key || e.repoKey === key)
      .sort((a, b) => when(b.e) - when(a.e) || b.i - a.i)
      .slice(0, n)
      .map(({ e }) => ({ ...e }));
  }

  /** The shipped log as a Markdown list for a public page: "- 2026-11-21 · pr · [Title](url) · by slug". */
  function shippedMarkdown({ repoKey, limit } = {}) {
    return shipped({ repoKey, limit })
      .map((e) => {
        const label = e.title.replace(/[[\]]/g, (c) => `\\${c}`);
        const href = e.url.replace(/[\s()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
        return `- ${e.at.slice(0, 10)} · ${e.kind} · [${label}](${href}) · by ${e.slug}`;
      })
      .join("\n");
  }

  return { assign, unassign, teamOf, roleOf, promptFor, ship, shipped, shippedMarkdown };
}

module.exports = { ROLES, createTeams };
