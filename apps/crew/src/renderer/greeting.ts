// The first words a bot says in a chat with no messages yet. Shown, never saved.
// A bot that ships with Crew or came from a template says what it does; a bot
// the person wrote (or whose job they have since changed) just says hi.

import { BOT_TEMPLATES } from "./templates.ts";

/** The jobs of the two bots that ship with Crew. They mirror LEAD.job and BUILDER.job in apps/crew/src/main/crew.cjs; keep them in step. */
export const BUILT_IN_JOBS = {
  lead: "Leads the crew: plans the work and hands it to the right bot",
  builder: "Builds apps, tools and small websites for you, tests them, and keeps them working",
} as const;

/** What each known bot does, in its own words, by its job as first written. */
const SAYS: Record<string, string> = {
  [BUILT_IN_JOBS.lead]: "I plan the work and hand it to the right bot. Tell me what you want help with.",
  [BUILT_IN_JOBS.builder]: "I build apps, tools and small websites for you, test them, and keep them working. Tell me what to make.",
  "hn-digest": "Each morning I read the Hacker News front page and write the five stories worth your time to a doc.",
  "page-watch": "Every Monday I check a page and write what changed since last week. Tell me which page.",
  "price-tracker": "Each weekday I look up the prices of a few products and log them in a sheet. Tell me which ones.",
  "pr-summary": "I go through the open pull requests on your repo and write a short note on each one. Tell me which repo.",
  "meeting-notes": "Before your first meeting I write a one-page brief on the people and topics.",
};

export function greeting(bot: { name: string; job: string }): string {
  const job = bot.job.trim();
  const template = BOT_TEMPLATES.find((t) => t.job.trim() === job);
  const says = SAYS[job] ?? (template ? SAYS[template.id] : undefined);
  return says ? `Hi, I'm ${bot.name}. ${says}` : "Hi.";
}
