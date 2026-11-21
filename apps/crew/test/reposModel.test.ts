import { describe, expect, it } from "vitest";
import type { RepoInfo } from "../src/shared/contract.ts";
import { canSync, isHttpsUrl, isUncommittedError, repoLine, shortDate, shortPath, shortUrl, teamLine } from "../src/renderer/reposModel.ts";

const last = { hash: "abc1234", subject: "Fix login", at: "2026-11-20T10:00:00Z" };

describe("repoLine", () => {
  it("joins branch, changes and the last commit subject", () => {
    expect(repoLine({ branch: "main", changed: 3, last })).toBe("main · 3 changed · Fix login");
  });

  it("leaves out the changes part when nothing is uncommitted", () => {
    expect(repoLine({ branch: "main", changed: 0, last })).toBe("main · Fix login");
  });

  it("says so when the repo has no commits yet", () => {
    expect(repoLine({ branch: "main", changed: 2, last: null })).toBe("main · 2 changed · No commits yet");
  });

  it("drops an empty branch name", () => {
    expect(repoLine({ branch: "", changed: 0, last: null })).toBe("No commits yet");
  });
});

describe("shortDate", () => {
  const now = new Date(2026, 10, 21, 12, 0);
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("says just now under a minute, and minutes, hours and days after", () => {
    expect(shortDate(ago(30_000), now)).toBe("just now");
    expect(shortDate(ago(5 * 60_000), now)).toBe("5 min ago");
    expect(shortDate(ago(3 * 3_600_000), now)).toBe("3 h ago");
    expect(shortDate(ago(2 * 86_400_000), now)).toBe("2 d ago");
  });

  it("treats a time just ahead of this computer's clock as just now", () => {
    expect(shortDate(new Date(now.getTime() + 60_000).toISOString(), now)).toBe("just now");
  });

  it("shows day and month past a week, and the year only when it is not this one", () => {
    expect(shortDate(new Date(2026, 2, 3, 9).toISOString(), now)).toBe("3 Mar");
    expect(shortDate(new Date(2025, 2, 3, 9).toISOString(), now)).toBe("3 Mar 2025");
  });

  it("returns nothing for a date it cannot read", () => {
    expect(shortDate("not a date", now)).toBe("");
  });
});

describe("shortPath", () => {
  it("keeps a short path whole", () => {
    expect(shortPath("Files/Repos/site", 40)).toBe("Files/Repos/site");
  });

  it("keeps the last folders of a long path, starting at a folder boundary", () => {
    const short = shortPath("C:\\Users\\someone\\Documents\\projects\\my-app-repository", 30);
    expect(short.length).toBeLessThanOrEqual(30);
    expect(short.startsWith("…\\")).toBe(true);
    expect(short.endsWith("my-app-repository")).toBe(true);
  });

  it("cuts a single long folder name without a separator", () => {
    const short = shortPath("x".repeat(60), 20);
    expect(short).toHaveLength(20);
    expect(short.startsWith("…")).toBe(true);
  });
});

describe("shortUrl", () => {
  it("drops the scheme, .git and trailing slashes", () => {
    expect(shortUrl("https://github.com/owner/repo.git")).toBe("github.com/owner/repo");
    expect(shortUrl("https://github.com/owner/repo/")).toBe("github.com/owner/repo");
  });

  it("keeps an ssh address readable", () => {
    expect(shortUrl("git@github.com:owner/repo.git")).toBe("git@github.com:owner/repo");
  });
});

describe("canSync", () => {
  const none: Pick<RepoInfo, "source" | "origin"> = { source: null, origin: null };
  it("needs a source folder or a remote", () => {
    expect(canSync({ ...none, source: "D:\\code\\app" })).toBe(true);
    expect(canSync({ ...none, origin: "https://github.com/owner/repo" })).toBe(true);
    expect(canSync(none)).toBe(false);
  });
});

describe("teamLine", () => {
  it("is empty without a team", () => {
    expect(teamLine([])).toBe("");
  });

  it("lists role then slug", () => {
    expect(
      teamLine([
        { role: "lead", slug: "fenna" },
        { role: "builder", slug: "builder-2" },
      ]),
    ).toBe("Team: lead fenna, builder builder-2");
  });
});

describe("isUncommittedError", () => {
  it("recognises the refusal to remove a repo with changes", () => {
    expect(isUncommittedError("Files/Repos/site has uncommitted changes. Commit them, or call remove with force: true.")).toBe(true);
    expect(isUncommittedError('There is no repo "site".')).toBe(false);
  });
});

describe("isHttpsUrl", () => {
  it("opens only https links", () => {
    expect(isHttpsUrl("https://github.com/owner/repo/pull/3")).toBe(true);
    expect(isHttpsUrl("http://example.com")).toBe(false);
    expect(isHttpsUrl("HTTPS://example.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
  });
});
