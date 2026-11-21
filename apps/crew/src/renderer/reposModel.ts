// The Repos part of a bot's Details: the text and rules the section shows, as
// pure functions. No React and no DOM here, so the tests can check every rule.

import type { RepoInfo, TeamMember } from "../shared/contract.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "main · 3 changed · Fix login". Empty parts are left out; no commits says so. */
export function repoLine(repo: Pick<RepoInfo, "branch" | "changed" | "last">): string {
  const parts = [repo.branch, repo.changed > 0 ? `${repo.changed} changed` : "", repo.last ? repo.last.subject : "No commits yet"];
  return parts.filter(Boolean).join(" · ");
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", then "3 Mar" (with the year when it isn't this one). */
export function shortDate(at: string, now: Date = new Date()): string {
  const when = new Date(at);
  const t = when.getTime();
  if (Number.isNaN(t)) return "";
  const min = Math.floor((now.getTime() - t) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  const day = `${when.getDate()} ${MONTHS[when.getMonth()]}`;
  return when.getFullYear() === now.getFullYear() ? day : `${day} ${when.getFullYear()}`;
}

/** A path kept to its last folders when it is longer than max: "…\Repos\site". */
export function shortPath(path: string, max = 40): string {
  if (path.length <= max) return path;
  const tail = path.slice(-(max - 1));
  const cut = tail.search(/[\\/]/);
  return `…${cut > 0 ? tail.slice(cut) : tail}`;
}

/** A remote address without its scheme or ".git": "github.com/owner/repo". */
export function shortUrl(url: string, max = 40): string {
  return shortPath(url.replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/\/+$/, ""), max);
}

/** Sync needs somewhere to fetch from: the folder it came from, or its remote. */
export function canSync(repo: Pick<RepoInfo, "source" | "origin">): boolean {
  return Boolean(repo.source || repo.origin);
}

/** "Team: lead fenna, builder builder-2", or nothing when the repo has no team. */
export function teamLine(members: TeamMember[]): string {
  return members.length ? `Team: ${members.map((m) => `${m.role} ${m.slug}`).join(", ")}` : "";
}

/** The main process refuses to remove a repo with uncommitted changes with this wording. */
export function isUncommittedError(message: string): boolean {
  return /uncommitted changes/.test(message);
}

/** Only https links open from the shipped log; anything else is shown as plain text. */
export function isHttpsUrl(url: string): boolean {
  return url.startsWith("https://");
}
