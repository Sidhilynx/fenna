import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { ROLES, createTeams } = require("../src/main/teams.cjs");

const REPO = "D:\\code\\site";
const OTHER = "https://example.com/owner/other.git";

let dir: string;
let file: string;
let clock: Date;
let now: () => Date;
let teams: ReturnType<typeof createTeams>;

function fresh(): ReturnType<typeof createTeams> {
  return createTeams({ file, now });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "teams-"));
  file = path.join(dir, "teams.json");
  clock = new Date("2026-11-21T09:00:00.000Z");
  now = () => clock;
  teams = fresh();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ROLES", () => {
  it("lists the four roles in order, each with a title and a duty", () => {
    expect(Object.keys(ROLES)).toEqual(["lead", "builder", "tester", "reviewer"]);
    for (const [name, role] of Object.entries(ROLES) as [string, { title: string; duty: string }][]) {
      expect(role.title).toBe(name);
      expect(role.duty.length).toBeGreaterThan(0);
    }
  });

  it("gives each duty two to four sentences", () => {
    for (const role of Object.values(ROLES) as { duty: string }[]) {
      const sentences = role.duty.match(/[.!?](\s|$)/g) || [];
      expect(sentences.length).toBeGreaterThanOrEqual(2);
      expect(sentences.length).toBeLessThanOrEqual(4);
    }
  });

  it("is frozen", () => {
    expect(Object.isFrozen(ROLES)).toBe(true);
  });
});

describe("assign", () => {
  it("gives a bot a role on a repo and returns it", () => {
    expect(teams.assign(REPO, "ada", "lead")).toEqual({ repoKey: REPO, slug: "ada", role: "lead" });
    expect(teams.roleOf(REPO, "ada")).toBe("lead");
  });

  it("rejects a role that is not in ROLES and lists the roles", () => {
    expect(() => teams.assign(REPO, "ada", "designer")).toThrow(/isn't a role\. The roles are lead, builder, tester, reviewer\./);
  });

  it("refuses a second lead and names the first", () => {
    teams.assign(REPO, "ada", "lead");
    expect(() => teams.assign(REPO, "bob", "lead")).toThrow(`${REPO} already has a lead: ada. Unassign it first.`);
    expect(teams.roleOf(REPO, "bob")).toBeNull();
  });

  it("allows only one tester and one reviewer per repo", () => {
    teams.assign(REPO, "tim", "tester");
    expect(() => teams.assign(REPO, "tom", "tester")).toThrow(`${REPO} already has a tester: tim. Unassign it first.`);
    teams.assign(REPO, "rae", "reviewer");
    expect(() => teams.assign(REPO, "ray", "reviewer")).toThrow(`${REPO} already has a reviewer: rae. Unassign it first.`);
  });

  it("allows many builders on one repo", () => {
    teams.assign(REPO, "b1", "builder");
    teams.assign(REPO, "b2", "builder");
    teams.assign(REPO, "b3", "builder");
    expect(teams.teamOf(REPO).map((m) => m.slug)).toEqual(["b1", "b2", "b3"]);
  });

  it("gives a bot one role per repo: a different role is refused until unassigned", () => {
    teams.assign(REPO, "ada", "builder");
    expect(() => teams.assign(REPO, "ada", "tester")).toThrow("ada is already the builder on D:\\code\\site. Unassign it first.");
    expect(teams.roleOf(REPO, "ada")).toBe("builder");
  });

  it("does nothing when a bot is given the role it already has", () => {
    teams.assign(REPO, "ada", "lead");
    expect(teams.assign(REPO, "ada", "lead")).toEqual({ repoKey: REPO, slug: "ada", role: "lead" });
    expect(teams.teamOf(REPO)).toEqual([{ slug: "ada", role: "lead" }]);
  });

  it("keeps roles separate per repo, so one bot can lead one repo and build another", () => {
    teams.assign(REPO, "ada", "lead");
    teams.assign(OTHER, "ada", "builder");
    expect(teams.roleOf(REPO, "ada")).toBe("lead");
    expect(teams.roleOf(OTHER, "ada")).toBe("builder");
  });

  it("frees a seat when its holder is unassigned", () => {
    teams.assign(REPO, "ada", "lead");
    teams.unassign(REPO, "ada");
    expect(teams.assign(REPO, "bob", "lead").role).toBe("lead");
  });

  it("requires a repo key and a bot name", () => {
    expect(() => teams.assign("", "ada", "lead")).toThrow(/repoKey is required/);
    expect(() => teams.assign(REPO, "  ", "lead")).toThrow(/slug is required/);
  });
});

describe("unassign", () => {
  it("removes a bot and returns true", () => {
    teams.assign(REPO, "ada", "lead");
    expect(teams.unassign(REPO, "ada")).toBe(true);
    expect(teams.roleOf(REPO, "ada")).toBeNull();
    expect(teams.teamOf(REPO)).toEqual([]);
  });

  it("returns false for a bot that is not on the team, and changes nothing", () => {
    teams.assign(REPO, "ada", "lead");
    expect(teams.unassign(REPO, "bob")).toBe(false);
    expect(teams.unassign("nowhere", "ada")).toBe(false);
    expect(teams.roleOf(REPO, "ada")).toBe("lead");
  });

  it("removes the repo from the file once its team is empty", () => {
    teams.assign(REPO, "ada", "lead");
    teams.unassign(REPO, "ada");
    expect(JSON.parse(readFileSync(file, "utf8")).teams).toEqual({});
  });
});

describe("teamOf and roleOf", () => {
  it("sorts by role order, then by slug", () => {
    teams.assign(REPO, "zed", "reviewer");
    teams.assign(REPO, "b2", "builder");
    teams.assign(REPO, "tess", "tester");
    teams.assign(REPO, "b1", "builder");
    teams.assign(REPO, "ada", "lead");
    expect(teams.teamOf(REPO)).toEqual([
      { slug: "ada", role: "lead" },
      { slug: "b1", role: "builder" },
      { slug: "b2", role: "builder" },
      { slug: "tess", role: "tester" },
      { slug: "zed", role: "reviewer" },
    ]);
  });

  it("returns an empty list for a repo with no team", () => {
    expect(teams.teamOf("nowhere")).toEqual([]);
  });

  it("returns null for a bot with no role, and for an unknown repo", () => {
    teams.assign(REPO, "ada", "lead");
    expect(teams.roleOf(REPO, "bob")).toBeNull();
    expect(teams.roleOf("nowhere", "ada")).toBeNull();
  });

  it("does not treat object keys like toString as roles", () => {
    expect(teams.roleOf(REPO, "toString")).toBeNull();
    expect(() => teams.assign(REPO, "ada", "toString")).toThrow(/isn't a role/);
  });
});

describe("promptFor", () => {
  it("is empty for a bot with no role", () => {
    teams.assign(REPO, "ada", "lead");
    expect(teams.promptFor(REPO, "bob")).toBe("");
  });

  it("says the role, its duty and the teammates", () => {
    teams.assign(REPO, "ada", "lead");
    teams.assign(REPO, "bob", "builder");
    teams.assign(REPO, "cy", "builder");
    expect(teams.promptFor(REPO, "bob")).toBe(
      `Team on ${REPO}: you are the builder. ${ROLES.builder.duty} Teammates: lead ada, builder cy.`,
    );
  });

  it("says there are no teammates yet when the bot is alone", () => {
    teams.assign(REPO, "ada", "tester");
    expect(teams.promptFor(REPO, "ada")).toBe(
      `Team on ${REPO}: you are the tester. ${ROLES.tester.duty} Teammates: none yet.`,
    );
  });

  it("never lists the bot as its own teammate", () => {
    teams.assign(REPO, "ada", "reviewer");
    expect(teams.promptFor(REPO, "ada")).not.toContain("reviewer ada");
  });
});

describe("ship", () => {
  it("records what shipped with the current time by default", () => {
    const e = teams.ship({ repoKey: REPO, slug: "ada", kind: "pr", title: "Fix login", url: "https://github.com/o/r/pull/3" });
    expect(e).toEqual({
      at: "2026-11-21T09:00:00.000Z",
      repoKey: REPO,
      slug: "ada",
      kind: "pr",
      title: "Fix login",
      url: "https://github.com/o/r/pull/3",
    });
    expect(teams.shipped()).toEqual([e]);
  });

  it("uses the time it is given", () => {
    const e = teams.ship({ repoKey: REPO, slug: "ada", kind: "merge", title: "A", url: "https://x.test/1", at: "2026-01-02T03:04:05.000Z" });
    expect(e.at).toBe("2026-01-02T03:04:05.000Z");
  });

  it("accepts each kind and refuses others", () => {
    for (const kind of ["push", "pr", "merge", "issue", "release"]) {
      expect(() => teams.ship({ repoKey: REPO, slug: "ada", kind, title: "t", url: "https://x.test" })).not.toThrow();
    }
    expect(() => teams.ship({ repoKey: REPO, slug: "ada", kind: "deploy", title: "t", url: "https://x.test" })).toThrow(
      /The kind must be one of push, pr, merge, issue, release, not "deploy"/,
    );
  });

  it("refuses an empty title or url", () => {
    expect(() => teams.ship({ repoKey: REPO, slug: "ada", kind: "pr", title: " ", url: "https://x.test" })).toThrow(/title is required/);
    expect(() => teams.ship({ repoKey: REPO, slug: "ada", kind: "pr", title: "t", url: "" })).toThrow(/url is required/);
  });

  it("keeps only the newest 1000 entries", () => {
    const entry = (i: number) => ({ repoKey: REPO, slug: "ada", kind: "push", title: `t${i}`, url: "https://x.test", at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() });
    writeFileSync(file, JSON.stringify({ teams: {}, log: Array.from({ length: 1000 }, (_, i) => entry(i)) }));
    for (let i = 1000; i < 1005; i++) teams.ship(entry(i));
    const all = teams.shipped({ limit: 5000 });
    expect(all).toHaveLength(1000);
    expect(all[0].title).toBe("t1004");
    expect(all[999].title).toBe("t5");
    expect(all.some((e) => e.title === "t0")).toBe(false);
  });
});

describe("shipped", () => {
  beforeEach(() => {
    teams.ship({ repoKey: REPO, slug: "ada", kind: "issue", title: "old", url: "https://x.test/1", at: "2026-11-01T00:00:00.000Z" });
    teams.ship({ repoKey: OTHER, slug: "bob", kind: "release", title: "other", url: "https://x.test/2", at: "2026-11-30T00:00:00.000Z" });
    teams.ship({ repoKey: REPO, slug: "cy", kind: "pr", title: "newest", url: "https://x.test/3", at: "2026-11-20T00:00:00.000Z" });
    teams.ship({ repoKey: REPO, slug: "ada", kind: "merge", title: "middle", url: "https://x.test/4", at: "2026-11-10T00:00:00.000Z" });
  });

  it("returns entries newest first, by time not by when they were written", () => {
    expect(teams.shipped().map((e) => e.title)).toEqual(["other", "newest", "middle", "old"]);
  });

  it("filters to one repo", () => {
    expect(teams.shipped({ repoKey: REPO }).map((e) => e.title)).toEqual(["newest", "middle", "old"]);
    expect(teams.shipped({ repoKey: "nowhere" })).toEqual([]);
  });

  it("applies the limit, 50 by default", () => {
    expect(teams.shipped({ limit: 2 }).map((e) => e.title)).toEqual(["other", "newest"]);
    expect(teams.shipped({ limit: 0 })).toEqual([]);
    expect(teams.shipped()).toHaveLength(4);
  });

  it("returns copies, so changing a result does not change the log", () => {
    teams.shipped()[0].title = "changed";
    expect(teams.shipped()[0].title).toBe("other");
  });

  it("keeps the write order for entries with the same time", () => {
    const t = createTeams({ file: path.join(dir, "same-time.json"), now });
    t.ship({ repoKey: REPO, slug: "a", kind: "push", title: "first", url: "https://x.test", at: "2026-05-05T00:00:00.000Z" });
    t.ship({ repoKey: REPO, slug: "a", kind: "push", title: "second", url: "https://x.test", at: "2026-05-05T00:00:00.000Z" });
    expect(t.shipped({ repoKey: REPO }).map((e) => e.title)).toEqual(["second", "first"]);
  });
});

describe("shippedMarkdown", () => {
  it("writes one list line per entry, with the date, kind, linked title and slug", () => {
    teams.ship({ repoKey: REPO, slug: "ada", kind: "pr", title: "Fix login", url: "https://github.com/o/r/pull/3", at: "2026-11-21T09:00:00.000Z" });
    expect(teams.shippedMarkdown()).toBe("- 2026-11-21 \u00B7 pr \u00B7 [Fix login](https://github.com/o/r/pull/3) \u00B7 by ada");
  });

  it("lists newest first and respects the repo filter and limit", () => {
    teams.ship({ repoKey: REPO, slug: "ada", kind: "push", title: "one", url: "https://x.test/1", at: "2026-11-01T00:00:00.000Z" });
    teams.ship({ repoKey: REPO, slug: "bob", kind: "push", title: "two", url: "https://x.test/2", at: "2026-11-02T00:00:00.000Z" });
    teams.ship({ repoKey: OTHER, slug: "cy", kind: "push", title: "three", url: "https://x.test/3", at: "2026-11-03T00:00:00.000Z" });
    const md = teams.shippedMarkdown({ repoKey: REPO, limit: 1 });
    expect(md).toBe("- 2026-11-02 \u00B7 push \u00B7 [two](https://x.test/2) \u00B7 by bob");
    expect(teams.shippedMarkdown({ repoKey: REPO }).split("\n")).toHaveLength(2);
  });

  it("does not print the repo key, which is a path on the person's computer", () => {
    teams.ship({ repoKey: REPO, slug: "ada", kind: "pr", title: "t", url: "https://x.test", at: "2026-11-21T00:00:00.000Z" });
    expect(teams.shippedMarkdown()).not.toContain("code");
  });

  it("escapes brackets in the title and encodes spaces and parentheses in the link", () => {
    teams.ship({ repoKey: REPO, slug: "ada", kind: "pr", title: "Add [beta] flag", url: "https://x.test/a b(1)", at: "2026-11-21T00:00:00.000Z" });
    expect(teams.shippedMarkdown()).toBe("- 2026-11-21 \u00B7 pr \u00B7 [Add \\[beta\\] flag](https://x.test/a%20b%281%29) \u00B7 by ada");
  });

  it("is empty when nothing has shipped", () => {
    expect(teams.shippedMarkdown()).toBe("");
  });
});

describe("the file", () => {
  it("survives a missing file as an empty team and log", () => {
    expect(existsSync(file)).toBe(false);
    expect(teams.teamOf(REPO)).toEqual([]);
    expect(teams.shipped()).toEqual([]);
    expect(teams.shippedMarkdown()).toBe("");
  });

  it("treats corrupt JSON as empty and recovers on the next write", () => {
    writeFileSync(file, "{not json");
    expect(teams.teamOf(REPO)).toEqual([]);
    expect(teams.shipped()).toEqual([]);
    expect(teams.assign(REPO, "ada", "lead").role).toBe("lead");
    expect(teams.roleOf(REPO, "ada")).toBe("lead");
  });

  it("treats a file of the wrong shape as empty", () => {
    writeFileSync(file, JSON.stringify([1, 2, 3]));
    expect(teams.teamOf(REPO)).toEqual([]);
    expect(teams.shipped()).toEqual([]);
  });

  it("drops malformed teams and log entries, and keeps the good ones", () => {
    writeFileSync(
      file,
      JSON.stringify({
        teams: {
          [REPO]: { ada: "lead", bob: "wizard", cy: 7 },
          [OTHER]: "not an object",
        },
        log: [
          { at: "2026-11-21T00:00:00.000Z", repoKey: REPO, slug: "ada", kind: "pr", title: "good", url: "https://x.test" },
          { at: "2026-11-21T00:00:00.000Z", repoKey: REPO, slug: "ada", kind: "deploy", title: "bad kind", url: "https://x.test" },
          null,
          "junk",
        ],
      }),
    );
    expect(teams.teamOf(REPO)).toEqual([{ slug: "ada", role: "lead" }]);
    expect(teams.teamOf(OTHER)).toEqual([]);
    expect(teams.shipped().map((e) => e.title)).toEqual(["good"]);
  });

  it("is read fresh by a new instance, so the data persists", () => {
    teams.assign(REPO, "ada", "lead");
    teams.ship({ repoKey: REPO, slug: "ada", kind: "issue", title: "Roadmap", url: "https://x.test" });
    const again = fresh();
    expect(again.roleOf(REPO, "ada")).toBe("lead");
    expect(again.shipped()[0].title).toBe("Roadmap");
  });

  it("writes atomically: no temporary file is left behind", () => {
    teams.assign(REPO, "ada", "lead");
    teams.ship({ repoKey: REPO, slug: "ada", kind: "push", title: "t", url: "https://x.test" });
    teams.unassign(REPO, "ada");
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(dir)).toEqual(["teams.json"]);
  });

  it("creates the folder when it does not exist yet", () => {
    const nested = createTeams({ file: path.join(dir, "deep", "teams.json"), now });
    nested.assign(REPO, "ada", "lead");
    expect(existsSync(path.join(dir, "deep", "teams.json"))).toBe(true);
  });
});
