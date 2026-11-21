// A skill: the open "Agent Skills" format. A folder with SKILL.md, whose
// front matter gives its name and description, and whose body is the
// instructions a bot follows; other files may sit beside it. Crew keeps
// skills once per computer (apps/crew, skills.cjs) and a bot is granted some
// by name in bot.md.
//
//   ---
//   name: weekly-report
//   description: The format for the weekly status report
//   ---
//   Start with the three wins of the week, then the risks…
//
// A SKILL.md without front matter is still a skill: its name comes from the
// folder or file, its description from the first paragraph.

import { CONNECTOR_NAME_RE, LIMITS, type Diagnostic } from "./schema.ts";
import { parseYaml, splitFrontMatter } from "./yaml.ts";

/** The file every skill has. */
export const SKILL_FILE = "SKILL.md";

/** Why a skill name can't be used, or null when it can. The same rule as a connector's name. */
export function skillNameProblem(name: string): string | null {
  if (CONNECTOR_NAME_RE.test(name)) return null;
  return `A skill's name is lowercase letters, digits and dashes, starting with a letter, up to 32 characters (like "weekly-report"); "${name.slice(0, 40)}" isn't.`;
}

export interface SkillDoc {
  name: string;
  description: string;
  /** SKILL.md after its front matter: the instructions. */
  body: string;
  diagnostics: Diagnostic[];
}

/** The first paragraph of a body, joined on one line, or else its first heading. */
function firstParagraph(body: string): string {
  const para: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      if (para.length) break;
      continue;
    }
    para.push(line);
  }
  if (!para.length) return (/^#+\s*(.+)$/m.exec(body)?.[1] ?? "").trim();
  return para.join(" ").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Read a SKILL.md. `folderName` is the name it takes when its front matter
 * gives none. Errors say what to fix; a skill with an error is not added.
 */
export function parseSkill(src: string, folderName: string): SkillDoc {
  const d: Diagnostic[] = [];
  const fm = splitFrontMatter(src);
  if (!fm) {
    const body = src.trim();
    const description = firstParagraph(body).slice(0, LIMITS.skillDescription);
    if (!description) d.push({ severity: "error", message: `SKILL.md needs a description: a first paragraph that says what the skill is for.` });
    return { name: folderName, description, body, diagnostics: nameProblems(folderName, d) };
  }

  const y = parseYaml(fm.yaml, 2);
  for (const p of y.problems) d.push({ severity: "error", line: p.line, message: p.message });
  const raw = y.value;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : folderName;
  const description = typeof raw.description === "string" ? raw.description.trim().replace(/\s+/g, " ") : "";
  if (!description) d.push({ severity: "error", message: `Add "description:" to the front matter of SKILL.md: one line saying what the skill is for.` });
  else if (description.length > LIMITS.skillDescription) d.push({ severity: "error", message: `The description is ${description.length} characters; the most is ${LIMITS.skillDescription}. Shorten it.` });
  return { name, description: description.slice(0, LIMITS.skillDescription), body: fm.body.trim(), diagnostics: nameProblems(name, d) };
}

function nameProblems(name: string, d: Diagnostic[]): Diagnostic[] {
  const problem = skillNameProblem(name);
  if (problem) d.push({ severity: "error", message: problem });
  return d;
}
