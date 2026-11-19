// teams/<slug>/team.md: a team's name, its lead, its members, and (the
// body) what the team is for. A person's message to a team goes to the lead, or to the members it @mentions.
// The lead may also be listed under members; it is kept as the lead only.
//
//   ---
//   name: Launch
//   lead: fenna
//   members:
//     - research
//     - inbox
//   ---
//   Get the release out and reach the first partners.

import { LIMITS, TEAM_KEYS, type Diagnostic } from "./schema.ts";
import { isSlug } from "./slug.ts";
import { closest, parseYaml, splitFrontMatter, stringifyYaml } from "./yaml.ts";

export interface Team {
  name: string;
  lead: string;
  members: string[];
  purpose: string;
}

/** Check a team's fields; `known` is every bot slug that exists, when the caller has it. */
export function checkTeam(team: Team, known?: readonly string[]): { team: Team; diagnostics: Diagnostic[] } {
  const d: Diagnostic[] = [];
  const name = String(team.name ?? "").trim();
  if (!name) d.push({ severity: "error", message: `Add "name:" with the team's name.` });
  else if (name.length > LIMITS.name) d.push({ severity: "error", message: `The team name is ${name.length} characters; the most is ${LIMITS.name}. Shorten it.` });
  const exists = (slug: string, role: string) => {
    if (!isSlug(slug)) {
      d.push({ severity: "error", message: `${role} "${slug}" is not a bot folder name. Use the bot's folder name, like "research".` });
      return false;
    }
    if (known && !known.includes(slug)) {
      const near = closest(slug, known);
      d.push({ severity: "error", message: `${role} "${slug}" is not a bot here.${near ? ` Did you mean "${near}"?` : ""}` });
      return false;
    }
    return true;
  };
  const lead = String(team.lead ?? "").trim();
  if (!lead) d.push({ severity: "error", message: `Add "lead:" with the folder name of the bot that leads the team.` });
  else exists(lead, "lead");
  const members: string[] = [];
  for (const m of team.members ?? []) {
    const s = String(m).trim();
    if (!s) continue;
    if (s === lead) continue;
    if (members.includes(s)) {
      d.push({ severity: "warning", message: `Member "${s}" is listed twice.` });
      continue;
    }
    if (exists(s, "Member")) members.push(s);
  }
  if (members.length > LIMITS.teamMembers) d.push({ severity: "error", message: `A team can have at most ${LIMITS.teamMembers} members besides the lead.` });
  const purpose = String(team.purpose ?? "").trim().slice(0, LIMITS.how);
  return { team: { name: name.slice(0, LIMITS.name), lead, members: members.slice(0, LIMITS.teamMembers), purpose }, diagnostics: d };
}

export function parseTeam(src: string, known?: readonly string[]): { team: Team | null; diagnostics: Diagnostic[] } {
  const fm = splitFrontMatter(src);
  if (!fm) return { team: null, diagnostics: [{ severity: "error", line: 1, message: `team.md must start with "---", then name, lead and members, then "---".` }] };
  const y = parseYaml(fm.yaml, 2);
  const d: Diagnostic[] = y.problems.map((p) => ({ severity: "error" as const, line: p.line, message: p.message }));
  for (const k of Object.keys(y.value)) {
    if ((TEAM_KEYS as readonly string[]).includes(k)) continue;
    const near = closest(k, TEAM_KEYS);
    d.push({ severity: "warning", ...(y.keyLines[k] ? { line: y.keyLines[k] } : {}), message: `Unknown setting "${k}"; it is ignored.${near ? ` Did you mean "${near}"?` : ""} Settings: ${TEAM_KEYS.join(", ")}.` });
  }
  const v = y.value;
  const members = v.members === undefined || v.members === "" ? [] : Array.isArray(v.members) ? v.members : null;
  if (!members || members.some((m) => typeof m !== "string")) d.push({ severity: "error", message: `members should be a list of bot folder names, one "- research" per line.` });
  const r = checkTeam(
    {
      name: typeof v.name === "string" ? v.name : "",
      lead: typeof v.lead === "string" ? v.lead : "",
      members: (members ?? []).filter((m): m is string => typeof m === "string"),
      purpose: fm.body,
    },
    known,
  );
  return { team: r.team, diagnostics: [...d, ...r.diagnostics] };
}

export function serializeTeam(team: Team): string {
  const body = team.purpose.trim();
  return `---\n${stringifyYaml({ name: team.name, lead: team.lead, members: [...team.members] })}---\n${body ? `\n${body}\n` : ""}`;
}

/** A group chat's @mention words that mean everyone. */
export const MENTION_ALL = ["all", "everyone"] as const;

/**
 * Who a message in a group chat is for. `people` is the lead and the members, in order, each with its folder
 * name and display name. An "@name" (any case, the whole name, spaces allowed, the longest name first; the folder
 * name works too) picks that bot; "@all" or "@everyone" picks everyone. The result is in order of first mention,
 * and empty when the text mentions nobody (then it goes to the lead).
 */
export function mentionedBots(text: string, people: readonly { slug: string; name: string }[]): string[] {
  const names = people
    .flatMap((p) => [{ key: p.name.trim().toLowerCase(), slug: p.slug }, { key: p.slug.toLowerCase(), slug: p.slug }])
    .filter((n) => n.key)
    .sort((a, b) => b.key.length - a.key.length);
  const lower = text.toLowerCase();
  const word = /[\p{L}\p{N}_]/u;
  const found: string[] = [];
  for (let at = lower.indexOf("@"); at !== -1; at = lower.indexOf("@", at + 1)) {
    if (at > 0 && word.test(lower[at - 1]!)) continue;
    const rest = lower.slice(at + 1);
    const ends = (len: number) => !word.test(rest[len] ?? " ");
    const all = MENTION_ALL.find((w) => rest.startsWith(w) && ends(w.length));
    if (all) {
      for (const p of people) if (!found.includes(p.slug)) found.push(p.slug);
      continue;
    }
    const hit = names.find((n) => rest.startsWith(n.key) && ends(n.key.length));
    if (hit && !found.includes(hit.slug)) found.push(hit.slug);
  }
  return found;
}
